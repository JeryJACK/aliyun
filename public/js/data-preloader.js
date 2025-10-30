class DataPreloader {
    constructor() {
        this.isPreloading = false;
        this.preloadProgress = 0;
    }

    // 页面加载时自动预载所有数据（优化版本 - 懒加载）
    async autoPreloadAllData(forceReload = false) {
        try {
            console.log('🚀 页面加载：开始智能预载数据...');
            this.isPreloading = true;
            this.updatePreloadStatus('正在检查本地缓存...', 'loading');

            // 1. 首先检查本地缓存
            const cacheInfo = await cacheManager.checkAllDataCache();
            const cacheAge = cacheInfo ? Date.now() - cacheInfo.lastUpdated : Infinity;

            // 🆕 如果被强制刷新（手动刷新缓存按钮），跳过缓存检查
            if (forceReload) {
                console.log('🔄 强制刷新模式，跳过缓存检查...');
                // 跳过缓存检查，直接重新从API加载
            }
            // 🆕 缓存有效期1分钟（不是轮询！只在页面加载时检查一次）
            // 注意：补同步会更新lastUpdated，所以补同步后cacheAge几乎为0，会直接使用IndexedDB
            else if (cacheAge < 1 * 60 * 1000) {
                console.log(`✅ 使用IndexedDB缓存（${Math.round(cacheAge / 1000)}秒前更新）`);
                this.updatePreloadStatus(`✅ 从本地缓存加载 ${cacheInfo.totalCount} 条数据（秒速加载）`, 'success');
                this.isPreloading = false;

                // 后台静默更新（不阻塞）
                setTimeout(() => this.backgroundUpdate(), 5000);
                return { success: true, totalCount: cacheInfo.totalCount };
            }

            // 2. 🚀 缓存过期或不存在，使用并行分片加载（最快！）
            console.log('📡 缓存过期或不存在，使用并行分片加载全量数据...');
            this.updatePreloadStatus('正在并行获取数据...', 'loading');

            // 🔥 关键优化：使用并行分片加载
            const result = await this.parallelShardedLoad((progress, loaded, total) => {
                this.updatePreloadStatus(
                    `正在加载数据... ${loaded.toLocaleString()}/${total.toLocaleString()} (${progress}%)`,
                    'loading'
                );
            });

            this.updatePreloadStatus(`✅ 成功加载全量数据（${result.totalCount.toLocaleString()} 条）`, 'success');
            this.isPreloading = false;

            console.log('🎯 全量数据已缓存，支持跨页面完整共享');

            return { success: true, totalCount: result.totalCount };

        } catch (error) {
            console.error('❌ 数据预载失败:', error);
            this.updatePreloadStatus('❌ 最近数据加载失败，尝试降级方案...', 'warning');

            // 降级：尝试加载全量数据
            try {
                const result = await this.fallbackLoadAll();
                this.isPreloading = false;
                return result;
            } catch (fallbackError) {
                console.error('❌ 降级方案也失败:', fallbackError);
                this.updatePreloadStatus(`❌ 数据预载失败: ${fallbackError.message}`, 'error');
                this.isPreloading = false;
                throw fallbackError;
            }
        }
    }

    // 🚀 【超高性能】流水线并行加载（边下载边解析边存储）
    async parallelShardedLoad(onProgress) {
        const perfStart = performance.now();
        console.log('🚀 启动流水线并行加载（边下边存）...');

        try {
            // 1. 计算需要加载的时间范围（过去2年）
            const endDate = new Date();
            const startDate = new Date();
            startDate.setFullYear(startDate.getFullYear() - 2);

            // 2. 按季度分片（8个季度）
            const shards = this.generateQuarterlyShards(startDate, endDate);
            console.log(`📊 生成 ${shards.length} 个季度分片（流水线并行）`);

            // 3. 🔥 流水线并行：边下载边存储
            const CONCURRENT_LIMIT = 4;
            let totalLoaded = 0;
            let completedShards = 0;

            // 先清空现有数据
            await cacheManager.clearAllData();

            // 创建流水线任务队列
            const pipeline = [];

            for (let i = 0; i < shards.length; i += CONCURRENT_LIMIT) {
                const batch = shards.slice(i, i + CONCURRENT_LIMIT);
                console.log(`📥 流水线批次 ${Math.floor(i / CONCURRENT_LIMIT) + 1}: 并行下载+存储 ${batch.length} 个分片`);

                // 🔥 关键优化：每个分片独立的"下载→存储"流水线
                const batchPipelines = batch.map(async (shard, idx) => {
                    try {
                        // 阶段1：下载并解析（浏览器自动gzip解压）
                        const downloadStart = performance.now();
                        const records = await this.fetchShardData(shard);
                        const downloadTime = performance.now() - downloadStart;

                        if (records && records.length > 0) {
                            console.log(`  ✓ 下载 ${shard.label}: ${records.length.toLocaleString()} 条 (${downloadTime.toFixed(0)}ms)`);

                            // 阶段2：立即存储（不等待其他分片）
                            const storeStart = performance.now();
                            await cacheManager.storeBatch(records, {});
                            const storeTime = performance.now() - storeStart;

                            console.log(`  💾 存储 ${shard.label}: ${records.length.toLocaleString()} 条 (${storeTime.toFixed(0)}ms)`);

                            // 更新计数和进度
                            totalLoaded += records.length;
                            completedShards++;

                            const progress = Math.round((completedShards / shards.length) * 100);
                            if (onProgress) {
                                onProgress(progress, totalLoaded, totalLoaded);
                            }

                            return records.length;
                        }
                        return 0;

                    } catch (error) {
                        console.error(`❌ 分片 ${shard.label} 流水线失败:`, error);
                        return 0;
                    }
                });

                // 等待这一批流水线全部完成
                await Promise.all(batchPipelines);

                // 让出主线程
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            // 4. 保存元数据和分片索引
            console.log('📊 保存元数据和索引...');
            await cacheManager.saveMetadataAndShardIndex(totalLoaded, {});

            const perfTime = performance.now() - perfStart;
            console.log(`✅ 流水线并行加载完成: ${totalLoaded.toLocaleString()} 条 (${(perfTime / 1000).toFixed(1)}秒, ${(totalLoaded / (perfTime / 1000)).toFixed(0)} 条/秒)`);
            console.log(`⚡ 性能提升：下载和存储完全并行，无等待时间`);

            return { success: true, totalCount: totalLoaded };

        } catch (error) {
            console.error('❌ 流水线并行加载失败:', error);
            throw error;
        }
    }

    // 🆕 生成季度分片
    generateQuarterlyShards(startDate, endDate) {
        const shards = [];
        const current = new Date(startDate);

        while (current < endDate) {
            const shardStart = new Date(current);
            const shardEnd = new Date(current);
            shardEnd.setMonth(shardEnd.getMonth() + 3); // 3个月一个分片

            if (shardEnd > endDate) {
                shardEnd.setTime(endDate.getTime());
            }

            shards.push({
                start: shardStart.toISOString(),
                end: shardEnd.toISOString(),
                label: `${shardStart.getFullYear()}Q${Math.floor(shardStart.getMonth() / 3) + 1}`
            });

            current.setMonth(current.getMonth() + 3);
        }

        return shards;
    }

    // 🆕 请求单个分片数据
    async fetchShardData(shard) {
        try {
            const url = getApiUrl('records') +
                `?startDate=${shard.start}&endDate=${shard.end}&no_limit=true`;

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Accept-Encoding': 'gzip, deflate, br'
                }
            });

            if (!response.ok) {
                console.warn(`⚠️ 分片 ${shard.label} 请求失败: ${response.status}`);
                return [];
            }

            const data = await response.json();

            if (data.success && data.data.records) {
                console.log(`✓ 分片 ${shard.label}: ${data.data.records.length.toLocaleString()} 条`);
                return data.data.records;
            }

            return [];

        } catch (error) {
            console.error(`❌ 分片 ${shard.label} 加载失败:`, error);
            return [];
        }
    }

    // 🆕 后台懒加载历史数据（不阻塞主流程）
    async loadHistoricalData() {
        try {
            console.log('🔄 后台任务：开始加载历史数据...');

            // 获取当前缓存的数据范围
            const metadata = await cacheManager.getMetadataFast();
            if (!metadata || !metadata.minDate) {
                console.log('⚠️ 无法获取元数据，跳过历史数据加载');
                return;
            }

            // 计算需要加载的历史数据时间范围
            const currentOldestDate = metadata.minDate;
            const targetDate = new Date();
            targetDate.setFullYear(targetDate.getFullYear() - 2); // 加载2年历史数据

            if (currentOldestDate <= targetDate) {
                console.log('✅ 历史数据已完整，无需加载');
                return;
            }

            // 加载更早的数据
            console.log(`📡 加载历史数据: ${targetDate.toLocaleDateString()} ~ ${currentOldestDate.toLocaleDateString()}`);

            const url = getApiUrl('records') +
                `?startDate=${targetDate.toISOString()}&endDate=${currentOldestDate.toISOString()}&no_limit=true`;

            const response = await fetch(url, {
                headers: {
                    'Accept': 'application/json',
                    'Accept-Encoding': 'gzip, deflate, br'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.success && data.data.records && data.data.records.length > 0) {
                const historicalRecords = data.data.records;
                console.log(`✅ 获取 ${historicalRecords.length} 条历史数据`);

                // 追加到缓存
                await cacheManager.appendData(historicalRecords);
                console.log('✅ 历史数据已追加到缓存');

                // 通知其他页面数据已更新
                if (window.sharedDataManager) {
                    window.sharedDataManager.notifyDataUpdate('insert', historicalRecords);
                }
            } else {
                console.log('ℹ️ 无更多历史数据');
            }

        } catch (error) {
            console.error('⚠️ 后台加载历史数据失败（非致命）:', error);
        }
    }

    // 🆕 降级方案：加载全量数据
    async fallbackLoadAll() {
        console.log('🔄 使用降级方案：加载全量数据...');
        this.updatePreloadStatus('正在从数据库获取全部数据...', 'loading');

        const allData = await this.fetchAllDataFromAPI();

        if (allData && allData.length > 0) {
            console.log(`📥 成功获取 ${allData.length.toLocaleString()} 条数据`);
            this.updatePreloadStatus(`正在缓存 ${allData.length.toLocaleString()} 条数据...`, 'loading');

            // 🚀 使用新的预计算方法
            const storedCount = await cacheManager.storeAllDataWithPrecompute(allData, (progress, stored, total) => {
                this.updatePreloadStatus(
                    `正在缓存数据... ${stored.toLocaleString()}/${total.toLocaleString()} (${progress}%)`,
                    'loading'
                );
            });

            this.updatePreloadStatus(`✅ 成功加载 ${storedCount.toLocaleString()} 条数据（已预计算统计）`, 'success');
            return { success: true, totalCount: storedCount };
        } else {
            throw new Error('无法获取数据');
        }
    }

    // 后台静默更新缓存
    async backgroundUpdate() {
        try {
            console.log('🔄 后台静默更新缓存...');
            const allData = await this.fetchAllDataFromAPI();

            if (allData && allData.length > 0) {
                // 🚀 使用新的预计算方法
                await cacheManager.storeAllDataWithPrecompute(allData);
                console.log(`✅ 后台缓存更新完成，更新了 ${allData.length} 条数据（已预计算统计）`);
            }
        } catch (error) {
            console.warn('⚠️ 后台缓存更新失败:', error);
        }
    }

    // 从API获取所有数据（无分页限制）
    async fetchAllDataFromAPI() {
        try {
            console.log('📡 开始从API一次性获取所有数据（无条数限制）...');
            
            // 构建API参数（获取所有数据）
            const params = {
                // 不传limit参数，后端将返回所有数据
                order_by: 'start_time',
                sort: 'ASC',
                // 确保获取全部数据的标记
                no_limit: true,
                fetch_all: true
            };

            console.log('🔍 API调用参数:', params);

            // 一次性获取所有数据
            const allData = await this.fetchSinglePageFromAPI(params);

            if (allData && allData.length > 0) {
                console.log(`✅ 成功一次性获取 ${allData.length} 条记录`);
                return allData;
            } else {
                console.log('⚠️ 未获取到任何数据');
                return [];
            }

        } catch (error) {
            console.error('❌ 获取全数据失败:', error);
            // 如果一次性获取失败，回退到分页获取
            console.log('🔄 一次性获取失败，回退到分页获取模式...');
            return await this.fetchAllDataWithPagination();
        }
    }

    // 备用的分页获取方法
    async fetchAllDataWithPagination() {
        try {
            console.log('📡 使用分页模式获取所有数据...');
            
            let allData = [];
            let offset = 0;
            const pageSize = 10000; // 使用较大的页面大小
            let hasMore = true;
            let currentPage = 1;
            let consecutiveEmptyPages = 0;
            const maxEmptyPages = 5;

            while (hasMore) {
                console.log(`📄 [页面 ${currentPage}] 获取数据 (offset: ${offset}, 已累计: ${allData.length} 条)...`);

                const params = {
                    offset: offset,
                    limit: pageSize,
                    order_by: 'start_time',
                    sort: 'ASC'
                };

                const pageData = await this.fetchSinglePageFromAPI(params);

                if (pageData && pageData.length > 0) {
                    allData.push(...pageData);
                    console.log(`✅ [页面 ${currentPage}] 获取 ${pageData.length} 条，累计: ${allData.length} 条`);
                    
                    consecutiveEmptyPages = 0;
                    offset += pageSize;
                    currentPage++;
                } else {
                    consecutiveEmptyPages++;
                    if (consecutiveEmptyPages >= maxEmptyPages) {
                        hasMore = false;
                        console.log(`🏁 数据获取完成，总计: ${allData.length} 条记录`);
                    } else {
                        offset += pageSize;
                        currentPage++;
                    }
                }

                // 添加短暂延迟
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            
            return allData;

        } catch (error) {
            console.error('❌ 分页获取数据失败:', error);
            throw error;
        }
    }

    // 单页API调用函数
    async fetchSinglePageFromAPI(params) {
        try {
            const cleanParams = {};
            for (const [key, value] of Object.entries(params)) {
                if (value !== undefined && value !== null && value !== '') {
                    cleanParams[key] = value;
                }
            }

            const qs = new URLSearchParams(cleanParams).toString();
            const url = getApiUrl('records');
            const response = await fetch(`${url}?${qs}`, {
                method: 'GET',
                mode: 'cors',
                credentials: 'omit',
                headers: {
                    'Accept': 'application/json',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || '获取数据失败');
            }

            const records = result.data.records || [];
            return records;
            
        } catch (error) {
            console.error('❌ 单页API调用失败:', error);
            throw error;
        }
    }

    // 更新预载状态显示
    updatePreloadStatus(message, type = 'info') {
        const dbLoading = document.getElementById('dbLoading');
        const dbLoadingText = document.getElementById('dbLoadingText');
        const dbLoadingProgressBar = document.getElementById('dbLoadingProgressBar');

        if (dbLoading) {
            if (dbLoadingText) {
                dbLoadingText.textContent = message;
            }

            // 隐藏进度条（预载状态不需要进度条）
            if (dbLoadingProgressBar) {
                dbLoadingProgressBar.classList.add('hidden');
            }

            // 根据类型更新样式
            dbLoading.className = 'mb-6 p-3 rounded-lg';
            switch (type) {
                case 'loading':
                    dbLoading.classList.add('bg-primary/10', 'text-primary');
                    dbLoading.classList.remove('hidden');
                    break;
                case 'success':
                    dbLoading.classList.add('bg-success/10', 'text-success');
                    // 3秒后隐藏成功消息
                    setTimeout(() => dbLoading.classList.add('hidden'), 3000);
                    break;
                case 'warning':
                    dbLoading.classList.add('bg-warning/10', 'text-warning');
                    break;
                case 'error':
                    dbLoading.classList.add('bg-danger/10', 'text-danger');
                    break;
                default:
                    dbLoading.classList.add('bg-primary/10', 'text-primary');
                    break;
            }
        }
    }
}

// ==================== WebSocket 实时同步管理器 ====================
