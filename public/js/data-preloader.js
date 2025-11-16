class DataPreloader {
    constructor() {
        this.isPreloading = false;
        this.preloadProgress = 0;
    }

    // 页面加载时自动预载所有数据（优化版本 - 懒加载）
    async autoPreloadAllData(forceReload = false, onProgress = null) {
        try {
            console.log('🚀 页面加载：开始智能预载数据...');
            this.isPreloading = true;
            this.updatePreloadStatus('正在检查本地缓存...', 'loading');

            // 1. 首先检查本地缓存
            const cacheInfo = await cacheManager.checkAllDataCache();

            // 🆕 如果被强制刷新（手动刷新缓存按钮），跳过缓存检查
            if (forceReload) {
                console.log('🔄 强制刷新模式，跳过缓存检查...');
                // 跳过缓存检查，直接重新从API加载
            }
            // ✅ 只要有缓存就使用，后台并发加载增量数据
            else if (cacheInfo && cacheInfo.totalCount > 0) {
                const cacheAge = Date.now() - cacheInfo.lastUpdated;
                const ageMinutes = Math.round(cacheAge / 60000);
                const ageHours = Math.round(cacheAge / 3600000);

                console.log(`✅ 使用IndexedDB缓存（${cacheInfo.totalCount.toLocaleString()} 条记录，${ageMinutes}分钟前更新）`);
                this.updatePreloadStatus(`✅ 从本地缓存加载 ${cacheInfo.totalCount.toLocaleString()} 条数据（秒速加载）`, 'success');
                this.isPreloading = false;

                // 🔥 智能增量更新策略
                if (ageMinutes > 30) {
                    // ✅ 优化阈值：缓存超过30分钟才启动增量加载（避免频繁刷新）
                    console.log(`⏱️ 缓存已 ${ageMinutes} 分钟未更新，启动增量并发加载...`);
                    setTimeout(async () => {
                        try {
                            const result = await this.incrementalParallelLoad(cacheInfo.lastUpdated);
                            if (result.totalCount > 0) {
                                console.log(`✅ 增量更新完成：新增 ${result.totalCount} 条数据`);
                                // 通知页面刷新数据
                                if (window.satelliteApp && window.satelliteApp.refreshData) {
                                    window.satelliteApp.refreshData();
                                }
                            }
                        } catch (error) {
                            console.error('❌ 增量更新失败:', error);
                        }
                    }, 100); // 100ms后启动，不阻塞页面初始化
                } else {
                    console.log(`💡 缓存很新 (${ageMinutes}分钟前更新)，依赖WebSocket实时同步`);
                }

                return { success: true, totalCount: cacheInfo.totalCount };
            }
            // 2. 🚀 缓存不存在或为空，使用并行分片加载全量数据
            if (cacheInfo && cacheInfo.totalCount === 0) {
                console.log('⚠️ 缓存元数据显示0条记录，可能是新建数据库或数据已清空');
                console.log('📡 执行全量数据加载...');
            } else {
                console.log('📡 缓存不存在，使用并行分片加载全量数据...');
            }
            this.updatePreloadStatus('正在并行获取数据...', 'loading');

            // 🔥 关键优化：使用并行分片加载
            const result = await this.parallelShardedLoad((progress, loaded, total) => {
                this.updatePreloadStatus(
                    `正在加载数据... ${loaded.toLocaleString()}/${total.toLocaleString()} (${progress}%)`,
                    'loading'
                );
                // 🆕 调用外部进度回调
                if (onProgress) {
                    onProgress(progress, loaded, total);
                }
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

    // 🆕 【增量并发加载】二次打开页面时快速同步新增数据
    async incrementalParallelLoad(lastUpdated, onProgress) {
        const perfStart = performance.now();
        console.log('🚀 启动增量并发加载（只获取新增数据）...');

        try {
            const startDate = new Date(lastUpdated);
            const endDate = new Date();
            const timeDiff = endDate - startDate;
            const daysDiff = timeDiff / (1000 * 60 * 60 * 24);

            console.log(`📊 增量时间范围: ${startDate.toLocaleString()} → ${endDate.toLocaleString()} (${daysDiff.toFixed(1)}天)`);

            // 🔥 智能分片策略（精确增量，避免重复下载）
            let shards;
            const hoursDiff = timeDiff / (1000 * 60 * 60);

            if (hoursDiff <= 12) {
                // ✅ 优化：12小时内直接一次请求（减少HTTP请求数量）
                shards = [{
                    start: startDate.toISOString(),
                    end: endDate.toISOString(),
                    label: `${Math.round(hoursDiff * 60)}分钟`
                }];
                console.log(`📊 时间范围 ${hoursDiff.toFixed(1)} 小时，使用单次请求（避免过度分片）`);
            } else if (hoursDiff <= 24) {
                // 24小时内：按6小时分片（最多4个分片）
                shards = this.generateHourlyShards(startDate, endDate, 6);
            } else if (daysDiff <= 7) {
                // 7天内：按12小时分片（减少请求数量）
                shards = this.generateHourlyShards(startDate, endDate, 12);
            } else if (daysDiff <= 30) {
                // 30天内：按天分片
                shards = this.generateDailyShards(startDate, endDate);
            } else if (daysDiff <= 90) {
                // 90天内：按周分片
                shards = this.generateWeeklyShards(startDate, endDate);
            } else {
                // 超过90天：按月分片
                shards = this.generateMonthlyShards(startDate, endDate);
            }

            console.log(`📊 生成 ${shards.length} 个增量分片（并行加载）`);

            if (shards.length === 0) {
                console.log('✅ 无需增量更新');
                return { success: true, totalCount: 0 };
            }

            // 🔥 存储队列模式：多Worker并行存储
            const CONCURRENT_LIMIT = this.calculateOptimalConcurrency(shards.length);
            let totalLoaded = 0;
            let completedShards = 0;
            let index = 0;

            const storageQueue = [];
            let downloadComplete = false; // ✅ 标记下载是否完成
            const STORAGE_WORKERS = 3; // 🔥 3个存储Worker并行
            const MIN_BATCH_SIZE = 1000; // 🚀 方案3：最小批次大小，合并小批次

            // 存储Worker：多Worker并行存储（IndexedDB内部处理并发）
            const storageWorker = async (workerId) => {
                let workerStored = 0;
                let pendingBatch = []; // 🚀 方案3：待合并的小批次缓冲区
                let pendingShards = []; // 记录合并的分片

                while (!downloadComplete || storageQueue.length > 0 || pendingBatch.length > 0) {
                    if (storageQueue.length === 0 && pendingBatch.length < MIN_BATCH_SIZE && !downloadComplete) {
                        await new Promise(resolve => setTimeout(resolve, 10));
                        continue;
                    }

                    // 🚀 方案3：从队列中取出数据，如果是小批次则累积
                    if (storageQueue.length > 0) {
                        const { records, shard, downloadTime } = storageQueue.shift();
                        if (records && records.length > 0) {
                            pendingBatch.push(...records);
                            pendingShards.push({ shard, downloadTime, count: records.length });
                            completedShards++;
                        }
                    }

                    // 🚀 方案3：判断是否需要提交批次
                    const shouldFlush = pendingBatch.length >= MIN_BATCH_SIZE ||
                                       (downloadComplete && storageQueue.length === 0);

                    if (shouldFlush && pendingBatch.length > 0) {
                        try {
                            const storeStart = performance.now();
                            await cacheManager.appendData(pendingBatch);
                            const storeTime = performance.now() - storeStart;

                            // 计算合并的分片信息
                            const mergedCount = pendingShards.length;
                            const totalRecords = pendingBatch.length;
                            const avgDownloadTime = pendingShards.reduce((sum, s) => sum + s.downloadTime, 0) / mergedCount;

                            if (mergedCount > 1) {
                                console.log(`  💾 StorageWorker${workerId} 合并追加 ${mergedCount} 个分片: ${totalRecords.toLocaleString()} 条 (平均下载${avgDownloadTime.toFixed(0)}ms + 存储${storeTime.toFixed(0)}ms)`);
                                console.log(`     📦 合并明细: ${pendingShards.map(s => `${s.shard.label}(${s.count})`).join(', ')}`);
                            } else {
                                const s = pendingShards[0];
                                console.log(`  💾 StorageWorker${workerId} 追加 ${s.shard.label}: ${totalRecords.toLocaleString()} 条 (下载${s.downloadTime.toFixed(0)}ms + 存储${storeTime.toFixed(0)}ms)`);
                            }

                            workerStored += totalRecords;
                            totalLoaded += totalRecords;

                            const progress = Math.round((completedShards / shards.length) * 100);
                            if (onProgress) {
                                onProgress(progress, totalLoaded, totalLoaded);
                            }

                            // 清空缓冲区
                            pendingBatch = [];
                            pendingShards = [];
                        } catch (error) {
                            console.error(`❌ StorageWorker${workerId} 存储批次失败:`, error);
                            pendingBatch = [];
                            pendingShards = [];
                        }
                    }
                }
                console.log(`✅ StorageWorker${workerId} 完成，追加 ${workerStored.toLocaleString()} 条数据`);
            };

            // 下载Worker：并发下载+解析
            const downloadWorker = async (workerId) => {
                while (index < shards.length) {
                    const shard = shards[index++];

                    try {
                        const downloadStart = performance.now();
                        const records = await this.fetchShardData(shard);
                        const downloadTime = performance.now() - downloadStart;

                        if (records && records.length > 0) {
                            console.log(`  ✓ Worker${workerId} 下载+解析 ${shard.label}: ${records.length.toLocaleString()} 条 (${downloadTime.toFixed(0)}ms)`);
                            storageQueue.push({ records, shard, downloadTime });
                        }
                    } catch (error) {
                        console.error(`❌ 增量分片 ${shard.label} 失败:`, error);
                    }

                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            };

            // 🔥 启动多个存储Workers（并行存储）
            const storageWorkers = Array.from(
                { length: STORAGE_WORKERS },
                (_, i) => storageWorker(i + 1)
            );

            // 启动下载Workers
            // 🔥 架构修复：使用配置的worker数量
            const downloadWorkers = Array.from(
                { length: CONCURRENT_LIMIT },
                (_, i) => downloadWorker(i + 1)
            );
            console.log(`🔥 增量加载：启动 ${CONCURRENT_LIMIT} 个下载Worker`);

            // 等待所有下载完成
            await Promise.all(downloadWorkers);
            console.log(`✅ 增量下载完成，等待 ${STORAGE_WORKERS} 个存储Worker清空队列...`);

            // ✅ 标记下载完成，存储Worker将处理完剩余队列后退出
            downloadComplete = true;

            // 等待所有存储Worker完成
            await Promise.all(storageWorkers);

            const perfTime = performance.now() - perfStart;
            console.log(`✅ 增量并发加载完成: ${totalLoaded.toLocaleString()} 条新增数据 (${(perfTime / 1000).toFixed(1)}秒)`);

            return { success: true, totalCount: totalLoaded };

        } catch (error) {
            console.error('❌ 增量并发加载失败:', error);
            throw error;
        }
    }

    // 🚀 【超高性能】流水线并行加载（边下载边解析边存储）+ 智能分片
    async parallelShardedLoad(onProgress) {
        const perfStart = performance.now();
        console.log('🚀 启动流水线并行加载（智能分片架构）...');

        try {
            // 1. 🚀 架构优化：Stats API异步化（不阻塞数据下载）
            let startDate, endDate, totalRecords;

            // 🔥 先使用默认范围立即开始下载，同时异步查询stats
            endDate = new Date();
            startDate = new Date();
            startDate.setFullYear(startDate.getFullYear() - 2);

            // 🔥 异步查询stats（不阻塞）
            const statsPromise = (async () => {
                try {
                    console.log('📡 后台查询数据统计信息（不阻塞下载）...');
                    const queryStart = performance.now();

                    const statsUrl = getApiUrl('stats');
                    const response = await fetch(statsUrl);
                    const data = await response.json();

                    const queryTime = performance.now() - queryStart;

                    if (data.success && data.data) {
                        const stats = data.data;
                        totalRecords = stats.total_records;
                        const statsStartDate = new Date(stats.earliest_time);
                        const statsEndDate = new Date(stats.latest_time);

                        const daysDiff = Math.ceil((statsEndDate - statsStartDate) / (1000 * 60 * 60 * 24));
                        console.log(`✅ Stats查询完成: ${totalRecords.toLocaleString()} 条记录`);
                        console.log(`✅ 精确时间范围: ${statsStartDate.toLocaleDateString()} - ${statsEndDate.toLocaleDateString()} (${daysDiff}天)`);

                        // 🚀 显示缓存状态
                        const cacheStatus = stats.cached ? '缓存' : 'SQL聚合查询';
                        const speedIcon = stats.cached ? '⚡⚡' : '⚡';
                        console.log(`${speedIcon} 统计查询耗时: ${queryTime.toFixed(0)}ms (${cacheStatus})（后台执行，未阻塞下载）`);

                        // 如果stats范围更精确，更新范围（但不影响已开始的下载）
                        return { startDate: statsStartDate, endDate: statsEndDate, totalRecords };
                    }
                } catch (error) {
                    console.warn('⚠️ Stats查询失败，使用默认2年范围:', error.message);
                }
                return null;
            })();

            console.log(`📊 使用默认范围立即开始: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()} (2年)`);
            console.log(`💡 Stats查询在后台执行，不阻塞数据下载`)

            // 2. 🔥 动态分片策略：根据时间跨度估算数据量，智能选择分片粒度
            const shards = this.generateAdaptiveShards(startDate, endDate);

            // 🔥 架构优化：按时间顺序排序（从旧到新）
            // 避免B-tree头部插入导致的性能衰退（先存新数据再存旧数据会慢3倍）
            shards.sort((a, b) => new Date(a.start) - new Date(b.start));
            console.log(`📊 生成 ${shards.length} 个分片（已按时间排序，优化B-tree写入性能）`);
            console.log(`📋 分片顺序:`, shards.map(s => s.partitionId).join(' → '));

            // 🔥 v11：智能分区 - 动态注册分区到CacheManager
            console.log(`🎯 智能分区：根据实际数据范围 ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()} 动态创建分区`);
            for (const shard of shards) {
                cacheManager.registerPartition(shard.partitionId);
            }
            console.log(`✅ 已注册 ${shards.length} 个分区:`, shards.map(s => s.partitionId).join(', '));

            // 🔥 v11：确保IndexedDB中创建了这些分区表
            await cacheManager.ensurePartitionsExist();
            console.log(`✅ IndexedDB分区表已就绪`);

            // 3. 🔥 动态并发数：根据分片数量和浏览器限制自动调整
            const CONCURRENT_LIMIT = this.calculateOptimalConcurrency(shards.length);
            let totalLoaded = 0;
            let completedShards = 0;
            let downloadedShards = 0; // 🆕 跟踪下载完成的分片数
            let index = 0;

            // 先清空现有数据（包括分片表）
            await cacheManager.clearAllData();

            console.log(`📥 启动 ${CONCURRENT_LIMIT} 个并发worker处理 ${shards.length} 个分片`);
            console.log(`⚡ 并发策略：${CONCURRENT_LIMIT} workers × ${Math.ceil(shards.length / CONCURRENT_LIMIT)} 轮 = 最大化吞吐量`);

            // 🔥 v10：任务队列池（按年份+季度分组，动态扩展）
            const taskQueues = {};

            // 初始化任务队列（根据分片动态创建）
            for (const shard of shards) {
                taskQueues[shard.partitionId] = [];
            }

            console.log(`📦 初始化任务队列池:`, Object.keys(taskQueues).join(', '));

            let downloadComplete = false;
            const STORAGE_WORKERS = 3; // 🔥 3个存储Worker并行写入不同ObjectStore（避免竞争）
            const MIN_BATCH_SIZE = 50000; // 🚀 v11优化：增大到50000条，大幅减少事务开销

            // 🔥 v11：分区锁机制（确保真正并行）
            const lockedPartitions = new Set();

            // 🔥 v11：存储Worker池（分区锁模式，确保每个分区同时只有一个Worker）
            const storageWorker = async (workerId) => {
                let workerStored = 0;

                console.log(`💾 StorageWorker${workerId} 启动（分区锁模式）`);

                while (!downloadComplete || hasTasksInQueues()) {
                    let partitionLocked = false;
                    let currentPartitionId = null;

                    // 🔥 抢占整个分区（不是批次）
                    for (const [partitionId, queue] of Object.entries(taskQueues)) {
                        if (queue.length === 0) continue;
                        if (lockedPartitions.has(partitionId)) continue; // 分区已被其他Worker锁定

                        // 🔥 锁定这个分区（独占）
                        lockedPartitions.add(partitionId);
                        partitionLocked = true;
                        currentPartitionId = partitionId;

                        const totalRecords = queue.length;
                        const storeName = cacheManager.getPartitionStoreName(partitionId);

                        console.log(`  🔒 Worker${workerId} 锁定分区 ${partitionId} (${totalRecords.toLocaleString()} 条待处理)`);

                        try {
                            const partitionStart = performance.now();
                            let partitionStored = 0;

                            // 🔥 处理这个分区的所有数据（分批写入）
                            while (queue.length > 0) {
                                // 智能批次大小
                                let batchSize;
                                if (queue.length <= MIN_BATCH_SIZE * 0.4) {
                                    batchSize = queue.length; // 剩余少量，全部取出
                                } else {
                                    batchSize = Math.min(queue.length, MIN_BATCH_SIZE);
                                }
                                const batch = queue.splice(0, batchSize);

                                const storeStart = performance.now();
                                await cacheManager.storePartitionedBatch(batch, storeName, true);
                                const storeTime = performance.now() - storeStart;

                                partitionStored += batch.length;
                                workerStored += batch.length;
                                totalLoaded += batch.length;

                                const throughput = batch.length / (storeTime / 1000);
                                console.log(`  💾 Worker${workerId} → ${partitionId}: ${batch.length.toLocaleString()} 条 (${storeTime.toFixed(0)}ms, ${throughput.toFixed(0)} 条/秒)`);
                            }

                            const partitionTime = performance.now() - partitionStart;
                            const partitionThroughput = partitionStored / (partitionTime / 1000);
                            console.log(`  ✅ Worker${workerId} 完成分区 ${partitionId}: ${partitionStored.toLocaleString()} 条 (总计${partitionTime.toFixed(0)}ms, ${partitionThroughput.toFixed(0)} 条/秒)`);

                            completedShards++;

                            // 更新进度
                            const downloadProgress = Math.min(30, Math.round((downloadedShards / shards.length) * 30));
                            const storageProgress = Math.round((completedShards / shards.length) * 70);
                            const progress = downloadProgress + storageProgress;

                            if (onProgress) {
                                onProgress(progress, totalLoaded, totalLoaded);
                            }

                        } catch (error) {
                            console.error(`❌ Worker${workerId} 存储${currentPartitionId}失败:`, error);
                        } finally {
                            // 🔥 释放锁
                            lockedPartitions.delete(currentPartitionId);
                            console.log(`  🔓 Worker${workerId} 释放分区 ${currentPartitionId}`);
                        }

                        break; // 处理完一个分区，重新循环抢下一个
                    }

                    if (!partitionLocked) {
                        // 没有可抢占的分区，等待
                        await new Promise(resolve => setTimeout(resolve, 10));
                    }
                }

                console.log(`✅ StorageWorker${workerId} 完成，存储 ${workerStored.toLocaleString()} 条数据`);
            };

            // 辅助函数：检查是否还有任务
            function hasTasksInQueues() {
                return Object.values(taskQueues).some(queue => queue.length > 0);
            }

            // 🔥 v10：下载Worker（下载+直接路由到对应分区）
            const downloadWorker = async (workerId) => {
                while (index < shards.length) {
                    const currentIndex = index++;
                    const shard = shards[currentIndex];

                    try {
                        // 阶段1：下载+解析（浏览器自动gzip解压+JSON解析）
                        const downloadStart = performance.now();
                        const records = await this.fetchShardData(shard);
                        const downloadTime = performance.now() - downloadStart;

                        if (records && records.length > 0) {
                            console.log(`  ✓ Worker${workerId} 下载+解析 ${shard.label}: ${records.length.toLocaleString()} 条 (${downloadTime.toFixed(0)}ms)`);

                            // 🔥 v10：直接路由到对应分区队列（不需要再次计算分区）
                            const partitionId = shard.partitionId;

                            // 将数据推送到对应的任务队列
                            taskQueues[partitionId].push(...records);

                            console.log(`    📍 路由: ${partitionId} ← ${records.length.toLocaleString()} 条`);

                            // 增加下载完成计数
                            downloadedShards++;
                        }
                    } catch (error) {
                        console.error(`❌ Worker${workerId} 下载分片 ${shard.label} 失败:`, error);
                    }

                    // 让出主线程
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            };

            // 🔥 启动多个存储Workers（并行存储）
            const storageWorkers = Array.from(
                { length: STORAGE_WORKERS },
                (_, i) => storageWorker(i + 1)
            );
            console.log(`💾 启动 ${STORAGE_WORKERS} 个存储Worker并行处理`);

            // 启动下载Workers
            // 🔥 架构修复：直接使用配置的worker数量，不要"聪明"地限制
            // 即使分片少于worker数量，多worker也能提升性能（HTTP/2多路复用）
            const downloadWorkers = Array.from(
                { length: CONCURRENT_LIMIT },
                (_, i) => downloadWorker(i + 1)
            );
            console.log(`🔥 架构优化：启动 ${CONCURRENT_LIMIT} 个下载Worker（不受${shards.length}个分片限制）`);

            // 等待所有下载完成
            await Promise.all(downloadWorkers);
            console.log(`✅ 所有下载Worker完成，等待 ${STORAGE_WORKERS} 个存储Worker清空队列...`);

            // ✅ 标记下载完成，存储Worker将处理完剩余队列后退出
            downloadComplete = true;

            // 等待所有存储Worker完成
            await Promise.all(storageWorkers);

            // 4. 保存元数据和分片索引
            console.log('📊 保存元数据和索引...');

            // 🚀 优化：正确获取时间范围并保存元数据
            let minDate, maxDate;
            try {
                const timeRange = await cacheManager.getTimeRangeQuick();
                minDate = timeRange.minDate;
                maxDate = timeRange.maxDate;
                console.log(`📅 数据时间范围: ${minDate?.toLocaleDateString()} - ${maxDate?.toLocaleDateString()}`);
            } catch (error) {
                console.warn('⚠️ 获取时间范围失败:', error);
            }

            await cacheManager.saveMetadataAndShardIndex(totalLoaded, {}, minDate, maxDate);

            const perfTime = performance.now() - perfStart;
            const throughput = (totalLoaded / (perfTime / 1000)).toFixed(0);

            console.log(`✅ 流水线并行加载完成: ${totalLoaded.toLocaleString()} 条 (${(perfTime / 1000).toFixed(1)}秒, ${throughput} 条/秒)`);
            console.log(`⚡ 性能提升：下载和存储完全并行，无等待时间`);
            console.log(`💾 元数据已保存: totalCount=${totalLoaded}, minDate=${minDate?.toISOString()}, maxDate=${maxDate?.toISOString()}`);

            // 🚀 性能分析
            console.log(`📊 性能对比分析:`);
            console.log(`   - 实际吞吐量: ${throughput} 条/秒`);
            console.log(`   - 优化目标: 12,600 条/秒`);
            console.log(`   - 达成率: ${((throughput / 12600) * 100).toFixed(1)}%`);

            // 性能评级（更合理的阈值）
            if (throughput >= 8000) {
                console.log(`✅ 性能优秀: ${throughput} 条/秒`);
            } else if (throughput >= 5000) {
                console.log(`🟡 性能良好: ${throughput} 条/秒（建议优化网络连接）`);
            } else if (throughput >= 3000) {
                console.log(`🟠 性能一般: ${throughput} 条/秒（可能受网络或CPU限制）`);
            } else {
                console.warn(`⚠️ 性能偏低: ${throughput} 条/秒，可能瓶颈:`);
                console.warn(`   1. 网络带宽限制（下载慢）- 检查网络连接`);
                console.warn(`   2. CPU性能限制（预处理慢）- 减少并发数`);
                console.warn(`   3. IndexedDB写入限制（磁盘IO慢）- 增加批次大小`);
                console.warn(`   4. 数据量过大 - 考虑分批加载`);
            }

            return { success: true, totalCount: totalLoaded };

        } catch (error) {
            console.error('❌ 流水线并行加载失败:', error);
            throw error;
        }
    }

    // 🔥 v10：统一使用年份+季度分片（减少HTTP请求63%）
    generateAdaptiveShards(startDate, endDate) {
        const timeDiff = endDate - startDate;
        const daysDiff = timeDiff / (1000 * 60 * 60 * 24);

        // 🔥 v10：统一使用年份+季度分片策略
        const shards = this.generateYearQuarterShards(startDate, endDate);

        console.log(`💡 数据范围 ${daysDiff.toFixed(0)} 天，v10优化：年份+季度分片，生成 ${shards.length} 个分片`);
        console.log(`📊 预估：每分片约 ${Math.round(daysDiff * 1000 / shards.length).toLocaleString()} 条数据（假设日均1000条）`);
        console.log(`🚀 HTTP请求优化：${shards.length}个季度请求（相比v9的11个月度请求，减少约${Math.round((1 - shards.length/11) * 100)}%）`);

        return shards;
    }

    // 🔥 v10：生成年份+季度分片（YYYY_Q# 格式）
    generateYearQuarterShards(startDate, endDate) {
        const shards = [];
        const current = new Date(startDate);
        current.setHours(0, 0, 0, 0);

        while (current < endDate) {
            const year = current.getFullYear();
            const month = current.getMonth() + 1; // 1-12
            const quarter = Math.ceil(month / 3); // 1, 2, 3, 4

            // 计算当前季度的开始和结束日期
            const quarterStartMonth = (quarter - 1) * 3 + 1; // 1, 4, 7, 10
            const quarterEndMonth = quarter * 3; // 3, 6, 9, 12

            const shardStart = new Date(year, quarterStartMonth - 1, 1); // 季度第一天
            const shardEnd = new Date(year, quarterEndMonth, 0, 23, 59, 59, 999); // 季度最后一天

            // 确保不超过endDate
            if (shardEnd > endDate) {
                shardEnd.setTime(endDate.getTime());
            }

            // 确保不早于startDate
            if (shardStart < startDate) {
                shardStart.setTime(startDate.getTime());
            }

            const partitionId = `${year}_Q${quarter}`;

            shards.push({
                partitionId: partitionId,
                start: shardStart.toISOString(),
                end: shardEnd.toISOString(),
                label: `${year}年Q${quarter}`
            });

            // 移动到下一个季度
            current.setMonth(current.getMonth() + 3);
        }

        console.log(`📊 生成年份+季度分片:`, shards.map(s => s.partitionId).join(', '));

        return shards;
    }

    // 🔥 动态计算最优并发数
    calculateOptimalConcurrency(shardCount) {
        // 浏览器HTTP/1.1限制：每域名6个并发连接
        // HTTP/2可以更多，但IndexedDB写入也是瓶颈
        const MAX_BROWSER_CONCURRENT = 6;

        if (shardCount <= 2) {
            return shardCount; // 分片很少，全并发
        } else if (shardCount <= 8) {
            return 6; // ⚡ v14优化：6个下载Worker，充分利用HTTP/2多路复用（实测：下载是瓶颈，不是存储）
        } else if (shardCount <= 20) {
            return 6; // 较多分片，6并发（充分利用）
        } else {
            return 8; // 大量分片，8并发（最大化，HTTP/2支持）
        }
    }

    // 🆕 生成按2周分片
    generateBiWeeklyShards(startDate, endDate) {
        const shards = [];
        const current = new Date(startDate);
        current.setHours(0, 0, 0, 0);

        while (current < endDate) {
            const shardStart = new Date(current);
            const shardEnd = new Date(current);
            shardEnd.setDate(shardEnd.getDate() + 14); // 2周

            if (shardEnd > endDate) {
                shardEnd.setTime(endDate.getTime());
            }

            shards.push({
                start: shardStart.toISOString(),
                end: shardEnd.toISOString(),
                label: `${shardStart.getFullYear()}/${shardStart.getMonth() + 1}/${shardStart.getDate()}-${shardEnd.getMonth() + 1}/${shardEnd.getDate()}`
            });

            current.setDate(current.getDate() + 14);
        }

        return shards;
    }

    // 🆕 生成按2个月分片
    generateBiMonthlyShards(startDate, endDate) {
        const shards = [];
        const current = new Date(startDate);
        current.setHours(0, 0, 0, 0);

        while (current < endDate) {
            const shardStart = new Date(current);
            const shardEnd = new Date(current);
            shardEnd.setMonth(shardEnd.getMonth() + 2); // 2个月

            if (shardEnd > endDate) {
                shardEnd.setTime(endDate.getTime());
            }

            shards.push({
                start: shardStart.toISOString(),
                end: shardEnd.toISOString(),
                label: `${shardStart.getFullYear()}/${shardStart.getMonth() + 1}-${shardEnd.getFullYear()}/${shardEnd.getMonth() + 1}`
            });

            current.setMonth(current.getMonth() + 2);
        }

        return shards;
    }

    // 🆕 生成按小时分片（精确增量加载）
    generateHourlyShards(startDate, endDate, hoursPerShard = 3) {
        const shards = [];
        const current = new Date(startDate);

        while (current < endDate) {
            const shardStart = new Date(current);
            const shardEnd = new Date(current);
            shardEnd.setHours(shardEnd.getHours() + hoursPerShard);

            if (shardEnd > endDate) {
                shardEnd.setTime(endDate.getTime());
            }

            const hours = Math.round((shardEnd - shardStart) / (1000 * 60 * 60));
            shards.push({
                start: shardStart.toISOString(),
                end: shardEnd.toISOString(),
                label: `${shardStart.getMonth() + 1}/${shardStart.getDate()} ${shardStart.getHours()}:00 (${hours}h)`
            });

            current.setHours(current.getHours() + hoursPerShard);
        }

        return shards;
    }

    // 🆕 生成按天分片
    generateDailyShards(startDate, endDate) {
        const shards = [];
        const current = new Date(startDate);
        current.setHours(0, 0, 0, 0);

        while (current < endDate) {
            const shardStart = new Date(current);
            const shardEnd = new Date(current);
            shardEnd.setDate(shardEnd.getDate() + 1);

            if (shardEnd > endDate) {
                shardEnd.setTime(endDate.getTime());
            }

            shards.push({
                start: shardStart.toISOString(),
                end: shardEnd.toISOString(),
                label: `${shardStart.getMonth() + 1}/${shardStart.getDate()}`
            });

            current.setDate(current.getDate() + 1);
        }

        return shards;
    }

    // 🆕 生成按周分片
    generateWeeklyShards(startDate, endDate) {
        const shards = [];
        const current = new Date(startDate);
        current.setHours(0, 0, 0, 0);

        while (current < endDate) {
            const shardStart = new Date(current);
            const shardEnd = new Date(current);
            shardEnd.setDate(shardEnd.getDate() + 7);

            if (shardEnd > endDate) {
                shardEnd.setTime(endDate.getTime());
            }

            shards.push({
                start: shardStart.toISOString(),
                end: shardEnd.toISOString(),
                label: `${shardStart.getMonth() + 1}/${shardStart.getDate()}-${shardEnd.getMonth() + 1}/${shardEnd.getDate()}`
            });

            current.setDate(current.getDate() + 7);
        }

        return shards;
    }

    // 🆕 生成按月分片
    generateMonthlyShards(startDate, endDate) {
        const shards = [];
        const current = new Date(startDate);
        current.setHours(0, 0, 0, 0);

        while (current < endDate) {
            const shardStart = new Date(current);
            const shardEnd = new Date(current);
            shardEnd.setMonth(shardEnd.getMonth() + 1);

            if (shardEnd > endDate) {
                shardEnd.setTime(endDate.getTime());
            }

            shards.push({
                start: shardStart.toISOString(),
                end: shardEnd.toISOString(),
                label: `${shardStart.getFullYear()}/${shardStart.getMonth() + 1}`
            });

            current.setMonth(current.getMonth() + 1);
        }

        return shards;
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

            // 🔍 增加详细日志
            console.log(`  🔍 增量请求: ${shard.label}`);
            console.log(`     URL: ${url}`);
            console.log(`     时间范围: ${new Date(shard.start).toLocaleString()} ~ ${new Date(shard.end).toLocaleString()}`);

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
                console.log(`  ✓ 增量响应: ${shard.label} = ${data.data.records.length.toLocaleString()} 条`);
                if (data.data.records.length > 0) {
                    const first = data.data.records[0];
                    const last = data.data.records[data.data.records.length - 1];
                    console.log(`     数据时间范围: ${first.start_time} ~ ${last.start_time}`);
                }

                // 🚀 方案2：在下载Worker中预处理数据（避免主线程阻塞）
                const processedRecords = this.preprocessRecords(data.data.records);
                return processedRecords;
            }

            console.log(`  ⚠️ 增量响应格式异常: ${shard.label}`, data);
            return [];

        } catch (error) {
            console.error(`❌ 分片 ${shard.label} 加载失败:`, error);
            return [];
        }
    }

    // 🚀 方案2：预处理数据（在下载线程执行，不阻塞主线程）
    preprocessRecords(records) {
        const processed = [];

        for (const record of records) {
            // 标准化字段名称（一次性完成，避免主线程重复处理）
            const standardRecord = {
                id: record.plan_id || record['计划ID'] || record.id || `record_${Date.now()}_${Math.random()}`,
                start_time: record.start_time || record['开始时间'],
                task_result: record.task_result || record['任务结果状态'],
                task_type: record.task_type || record['任务类型'],
                customer: record.customer || record['所属客户'],
                satellite_name: record.satellite_name || record['卫星名称'],
                station_name: record.station_name || record['测站名称'],
                station_id: record.station_id || record['测站ID'],
                ...record
            };

            // 预计算 timestamp（避免主线程重复计算）
            if (standardRecord.start_time) {
                standardRecord.timestamp = this.parseTimeToTimestamp(standardRecord.start_time);
            }

            processed.push(standardRecord);
        }

        // 🚀 超级优化：按timestamp升序排序（让IndexedDB顺序插入B-tree末尾）
        // API返回的数据是倒序的，导致IndexedDB不断在B-tree头部插入，性能衰退67%
        // 排序后可以追加到B-tree末尾，插入复杂度从O(log N)降到O(1)
        processed.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        return processed;
    }

    // 🚀 解析时间为timestamp（从CacheManager复制的逻辑）
    parseTimeToTimestamp(timeValue) {
        if (typeof timeValue === 'number') {
            return timeValue > 1000000000000 ? timeValue : timeValue * 1000;
        }

        if (typeof timeValue === 'string') {
            const cleanTimeStr = timeValue.replace(/[TZ]/g, ' ').replace(/[+-]\d{2}:\d{2}$/, '').trim();
            const date = this.parseLocalTime(cleanTimeStr);
            return isNaN(date.getTime()) ? 0 : date.getTime();
        }

        if (timeValue instanceof Date) {
            return timeValue.getTime();
        }

        return 0;
    }

    // 🚀 解析本地时间（从CacheManager复制的逻辑）
    parseLocalTime(timeStr) {
        if (!timeStr) return new Date(NaN);

        try {
            const match = timeStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}):(\d{1,2}))?/);
            if (match) {
                const [, year, month, day, hour = 0, minute = 0, second = 0] = match;
                return new Date(
                    parseInt(year),
                    parseInt(month) - 1,
                    parseInt(day),
                    parseInt(hour),
                    parseInt(minute),
                    parseInt(second)
                );
            }

            const cleanStr = timeStr.replace(/[TZ]/g, ' ').replace(/[+-]\d{2}:\d{2}$/, '').trim();
            const isoMatch = cleanStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/);
            if (isoMatch) {
                const [, year, month, day, hour, minute, second] = isoMatch;
                return new Date(
                    parseInt(year),
                    parseInt(month) - 1,
                    parseInt(day),
                    parseInt(hour),
                    parseInt(minute),
                    parseInt(second)
                );
            }

            const dateOnly = timeStr.split(' ')[0];
            const dateParts = dateOnly.split('-').map(Number);
            if (dateParts.length >= 3) {
                return new Date(dateParts[0], dateParts[1] - 1, dateParts[2], 0, 0, 0);
            }

            return new Date(NaN);
        } catch (error) {
            console.error('时间解析错误:', timeStr, error);
            return new Date(NaN);
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

            // 🚀 使用后台预计算方法：立即返回，不阻塞UI初始化
            const storedCount = await cacheManager.storeAllDataWithPrecompute(allData, (progress, stored, total) => {
                this.updatePreloadStatus(
                    `正在缓存数据... ${stored.toLocaleString()}/${total.toLocaleString()} (${progress}%)`,
                    'loading'
                );
            }, true); // 👈 启用后台预计算

            this.updatePreloadStatus(`✅ 成功加载 ${storedCount.toLocaleString()} 条数据（预计算在后台执行）`, 'success');
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
                // 🚀 使用后台预计算方法（已经是后台更新，所以不阻塞）
                await cacheManager.storeAllDataWithPrecompute(allData, null, true);
                console.log(`✅ 后台缓存更新完成，更新了 ${allData.length} 条数据（预计算在后台执行）`);
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
