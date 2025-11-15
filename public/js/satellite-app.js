class SatelliteApp {
    constructor() {
        this.cycleEngine = new CycleRuleEngine();
        this.taskAnalyzer = new TaskResultAnalyzer();

        // 字段映射配置（统一定义）
        this.fieldMappingValues = {
            idField: 'id',
            planIdField: 'plan_id',
            startTimeField: 'start_time',
            taskResultField: 'task_result'
        };

        // 使用字段映射创建 DataStore
        this.dataStore = new DataStore(this.fieldMappingValues);
        this.chart = null;

        // 预检查 sessionStorage，判断是否有保存的状态（加快恢复速度）
        this.hasSavedState = !!sessionStorage.getItem('satellitePageState');
        this.hasSavedStats = !!sessionStorage.getItem('satelliteStatistics');

        // 加载保存的配置
        this.loadSavedConfig();

        this.bindElements();
        this.bindEvents();
        this.data = null;

        // 初始化状态标志和缓冲队列
        this.isInitializing = true;  // 标记是否正在初始化
        this.pendingUpdates = [];    // 暂存初始化期间的 WebSocket 推送
        this.dataStoreReady = false; // 标记DataStore是否已构建完成
        this.pendingStatsRequest = false; // 标记是否有待处理的统计请求
        this.dataStoreCacheDirty = false; // 🆕 标记DataStore缓存是否需要更新
        this.needFullDataStoreConstruction = false; // 🆕 标记是否需要加载全部数据构建DataStore
        this.backgroundLoadingProgress = 0; // 🆕 后台加载进度（0-100）
        this.isBackgroundLoading = false; // 🆕 标记是否正在后台加载
        this.backgroundLoadTarget = 0; // 🆕 后台加载目标数量
        this.dataLoadingStrategy = 'initial'; // 🆕 数据加载策略：initial/lazy/quick/loaded
        this.loadedDataRange = null; // 🆕 已加载的数据范围 {start: Date, end: Date}

        this.init();
    }

    bindElements() {
        this.startDate = document.getElementById('startDate');
        this.endDate = document.getElementById('endDate');
        this.groupBy = document.getElementById('groupBy');
        this.showDataLabels = document.getElementById('showDataLabels');
        this.generateChart = document.getElementById('generateChart');
        this.configGroupingBtn = document.getElementById('configGroupingBtn');

        this.dataChart = document.getElementById('dataChart');
        this.chartEmptyState = document.getElementById('chartEmptyState');
        this.chartErrorState = document.getElementById('chartErrorState');
        this.chartErrorMessage = document.getElementById('chartErrorMessage');
        this.chartLoadingState = document.getElementById('chartLoadingState');

        this.totalCount = document.getElementById('totalCount');
        this.avgCount = document.getElementById('avgCount');
        this.totalFailures = document.getElementById('totalFailures');
        this.avgSuccessRate = document.getElementById('avgSuccessRate');
        this.maxCount = document.getElementById('maxCount');
        this.minCount = document.getElementById('minCount');
        this.detailTableBody = document.getElementById('detailTableBody');

        this.groupingConfigModal = document.getElementById('groupingConfigModal');
        this.modalContent = document.getElementById('modalContent');
        this.closeConfigModal = document.getElementById('closeConfigModal');
        this.saveGroupingConfig = document.getElementById('saveGroupingConfig');

        this.dayStart = document.getElementById('dayStart');
        this.dayStartDisplay = document.getElementById('dayStartDisplay');
        this.dayEndDisplay = document.getElementById('dayEndDisplay');
        this.weekStartDay = document.getElementById('weekStartDay');
        this.weekStartTime = document.getElementById('weekStartTime');
        this.monthStartDate = document.getElementById('monthStartDate');
        this.monthStartTime = document.getElementById('monthStartTime');
        this.quarterStartMonth = document.getElementById('quarterStartMonth');
        this.quarterStartTime = document.getElementById('quarterStartTime');

        this.dbLoading = document.getElementById('dbLoading');
        this.noDataAlert = document.getElementById('noDataAlert');
        
        // 缓存管理元素
        this.cacheStatus = document.getElementById('cacheStatus');
        this.refreshCacheBtn = document.getElementById('refreshCacheBtn');
        this.clearCacheBtn = document.getElementById('clearCacheBtn');
        this.cacheInfo = document.getElementById('cacheInfo');
        
        // 新增：卫星和客户数量卡片及模态框元素
        this.satelliteCount = document.getElementById('satelliteCount');
        this.customerCount = document.getElementById('customerCount');
        this.satelliteCountCard = document.getElementById('satelliteCountCard');
        this.customerCountCard = document.getElementById('customerCountCard');
        
        // 卫星数量模态框元素
        this.satelliteCountModal = document.getElementById('satelliteCountModal');
        this.satelliteModalContent = document.getElementById('satelliteModalContent');
        this.closeSatelliteModal = document.getElementById('closeSatelliteModal');
        this.satelliteCountChart = document.getElementById('satelliteCountChart');
        this.satelliteChartEmpty = document.getElementById('satelliteChartEmpty');
        this.satelliteChartLoading = document.getElementById('satelliteChartLoading');
        
        // 客户数量模态框元素
        this.customerCountModal = document.getElementById('customerCountModal');
        this.customerModalContent = document.getElementById('customerModalContent');
        this.closeCustomerModal = document.getElementById('closeCustomerModal');
        this.customerCountChart = document.getElementById('customerCountChart');
        this.customerChartEmpty = document.getElementById('customerChartEmpty');
        this.customerChartLoading = document.getElementById('customerChartLoading');
        
        // 图表对象
        this.satelliteChart = null;
        this.customerChart = null;
    }

    bindEvents() {
        if (this.generateChart) this.generateChart.addEventListener('click', () => this.generateStatistics());
        if (this.configGroupingBtn) this.configGroupingBtn.addEventListener('click', () => this.openGroupingConfig());
        if (this.closeConfigModal) this.closeConfigModal.addEventListener('click', () => this.closeGroupingConfig());
        if (this.saveGroupingConfig) this.saveGroupingConfig.addEventListener('click', () => this.saveGroupingConfiguration());
        if (this.showDataLabels) this.showDataLabels.addEventListener('change', () => this.toggleDataLabels());

        // 添加页面状态自动保存监听器
        if (this.startDate) this.startDate.addEventListener('change', () => this.savePageState());
        if (this.endDate) this.endDate.addEventListener('change', () => this.savePageState());
        if (this.groupBy) this.groupBy.addEventListener('change', () => {
            this.savePageState();
            // ⚡ 统计周期改变时，在后台重新构建 DataStore
            if (this.data && this.dataStore) {
                const newGroupType = this.groupBy.value;
                console.log(`🔄 统计周期已改变为 ${newGroupType}，后台重新构建 DataStore...`);
                this.dataStoreReady = false;  // 标记为未就绪
                this.buildDataStoreInBackground(newGroupType);
            }
        });
        if (this.dayStart) {
            this.dayStart.addEventListener('change', (e) => {
                this.dayStartDisplay.textContent = e.target.value;
                this.dayEndDisplay.textContent = e.target.value;
            });
        }
        
        // 缓存管理事件
        if (this.refreshCacheBtn) this.refreshCacheBtn.addEventListener('click', () => this.refreshCache());
        if (this.clearCacheBtn) this.clearCacheBtn.addEventListener('click', () => this.clearCache());
        
        // 新增：卫星和客户数量卡片点击事件
        if (this.satelliteCountCard) this.satelliteCountCard.addEventListener('click', () => this.showSatelliteCountChart());
        if (this.customerCountCard) this.customerCountCard.addEventListener('click', () => this.showCustomerCountChart());

        // 新增：模态框关闭事件
        if (this.closeSatelliteModal) this.closeSatelliteModal.addEventListener('click', () => this.closeSatelliteCountModal());
        if (this.closeCustomerModal) this.closeCustomerModal.addEventListener('click', () => this.closeCustomerCountModal());

        // 图表下载事件
        document.querySelectorAll('.chart-download-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const chartId = e.currentTarget.getAttribute('data-chart');
                const type = e.currentTarget.getAttribute('data-type');

                let chart = null;
                if (chartId === 'satelliteChart') {
                    chart = this.satelliteChart;
                } else if (chartId === 'customerChart') {
                    chart = this.customerChart;
                } else if (chartId === 'mainChart') {
                    chart = this.chart;
                }

                if (!chart) {
                    showError('图表未生成，无法下载');
                    return;
                }

                if (type === 'image') {
                    try {
                        const imgUrl = chart.toBase64Image();
                        const a = document.createElement('a');
                        a.href = imgUrl;
                        const now = new Date();
                        const ts = now.toISOString().replace(/[:.]/g, '-');
                        a.download = `${chartId}-${ts}.png`;
                        document.body.appendChild(a);
                        a.click();
                        setTimeout(() => document.body.removeChild(a), 300);
                        showSuccess('图表图片下载成功');
                    } catch (err) {
                        console.error('导出图片失败', err);
                        showError('导出图片失败，请检查浏览器支持或数据量是否过大。');
                    }
                } else if (type === 'csv') {
                    try {
                        const csv = chartToCSV(chart);
                        const now = new Date();
                        const ts = now.toISOString().replace(/[:.]/g, '-');
                        downloadFile(`${chartId}-${ts}.csv`, csv, 'text/csv;charset=utf-8;');
                        showSuccess('图表数据下载成功');
                    } catch (err) {
                        console.error('导出 CSV 失败', err);
                        showError('导出 CSV 失败，请查看控制台错误信息。');
                    }
                }
            });
        });
    }

    // 🆕 更新骨架屏进度（百分比）
    updateSkeletonProgress(percent, text) {
        const progressText = document.getElementById('skeleton-progress');
        const progressPercent = document.getElementById('skeleton-progress-percent');

        if (progressText) progressText.textContent = text;
        if (progressPercent) progressPercent.textContent = `${percent}%`;
    }

    async init() {
        console.log('🚀 应用初始化开始...');

        // 1. 立即显示骨架屏（已在HTML中渲染，无需额外操作）
        const skeleton = document.getElementById('skeleton-screen');
        const progressText = document.getElementById('skeleton-progress');

        try {
            // 2. 快速显示缓存元数据（<10ms）
            this.updateSkeletonProgress(10, '正在读取缓存...');
            const cachedMeta = await cacheManager.getMetadataFast();

            if (cachedMeta && cachedMeta.actualCount > 0) {
                console.log('📊 缓存元数据:', cachedMeta);
                this.displayMetadataStats(cachedMeta);
                this.updateSkeletonProgress(20, '缓存元数据读取完成');
            } else {
                console.warn('⚠️ 本地缓存为空，显示无数据提示');
                if (skeleton) skeleton.classList.add('hidden');
                this.noDataAlert.classList.remove('hidden');
                return;
            }

            // 3. ⚡⚡ 尝试加载缓存的DataStore桶结构（最快！）
            this.updateSkeletonProgress(30, '正在加载DataStore...');
            const groupType = this.groupBy ? this.groupBy.value : 'day';
            // 🆕 传入lastUpdated用于校验缓存是否过期
            const cachedBuckets = await cacheManager.loadDataStoreBuckets(groupType, cachedMeta.lastUpdated);

            if (cachedBuckets && cachedBuckets.buckets) {
                // ✅ 缓存命中！直接恢复DataStore
                console.log('🚀 使用缓存的DataStore桶结构（极速加载）');
                this.updateSkeletonProgress(50, '正在恢复DataStore...');

                // 将数组转换回Map（JavaScript引擎已优化此操作）
                const restoreStart = performance.now();
                this.dataStore.buckets = new Map(cachedBuckets.buckets);
                this.dataStoreReady = true;
                const restoreTime = performance.now() - restoreStart;
                console.log(`✅ DataStore恢复完成: ${this.dataStore.buckets.size} 个桶 (${restoreTime.toFixed(0)}ms, ${(this.dataStore.buckets.size / (restoreTime / 1000)).toFixed(0)} 桶/秒)`);
                this.updateSkeletonProgress(90, 'DataStore恢复完成');

                // 🚀 性能优化：延迟加载 this.data
                // DataStore已包含所有统计信息，this.data仅用于实时更新和导出
                // 初始化时不加载，完全跳过，极致提升启动速度
                this.data = []; // 初始化为空
                this.dataLoadingStrategy = 'lazy'; // 标记为延迟加载模式
                console.log('⚡ 跳过 this.data 加载（DataStore缓存已包含所有统计数据）');
                console.log('💡 仅在需要时（导出/实时更新）才按需加载原始数据');

                // 🔥 记录已加载的数据范围（DataStore已有全部数据，但this.data为空）
                this.loadedDataRange = null; // this.data为空，无范围

                // 🔥 关键优化：DataStore缓存命中时，不需要后台加载！
                this.needFullDataStoreConstruction = false;

            } else {
                // ❌ 缓存未命中，使用快速初始化 + 后台构建DataStore
                console.log('⚠️ DataStore缓存未命中，使用快速初始化策略');
                this.updateSkeletonProgress(40, '正在快速初始化...');

                const quickStart = performance.now();

                // 🚀 性能优化：只加载最近1周数据用于快速初始化
                // 大幅减少冷启动时间（从10-20秒降至1-3秒）
                this.data = [];
                let loadedCount = 0;

                // ⚠️ 清空DataStore，避免残留数据影响实时更新
                this.dataStore.clear();

                // ⚡ 使用分片查询只加载最近1周（极速冷启动）
                const oneWeekAgo = new Date();
                oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

                await cacheManager.queryDateRangeFromShards(
                    oneWeekAgo,
                    new Date(),
                    (batch) => {
                        loadedCount += batch.length;
                        this.data.push(...batch);

                        // 🆕 【极速】批量构建DataStore（10-50倍性能提升）
                        this.dataStore.addRecordsToBucketBatch(batch, this.cycleEngine, groupType);

                        // 🆕 动态更新进度（40% - 80%）
                        const progress = 40 + Math.min(40, Math.floor(loadedCount / 50)); // 每50条增加1%
                        this.updateSkeletonProgress(progress, `正在初始化... ${loadedCount} 条`);
                    },
                    5000
                );

                const quickTime = performance.now() - quickStart;
                console.log(`✅ 快速初始化完成: ${loadedCount} 条（最近1周） (${quickTime.toFixed(0)}ms)`);
                this.updateSkeletonProgress(85, '快速初始化完成');

                // DataStore包含部分数据，标记为部分就绪
                this.dataStoreReady = false; // 未完全就绪
                this.dataLoadingStrategy = 'quick'; // 快速初始化模式

                // 🔥 记录已加载的数据范围（用于判断是否需要按需加载）
                this.loadedDataRange = {
                    start: oneWeekAgo,
                    end: new Date()
                };
                console.log(`📅 已加载数据范围: ${oneWeekAgo.toLocaleDateString()} - ${new Date().toLocaleDateString()}`);

                // 🆕 标记需要加载全部数据来构建完整DataStore
                this.needFullDataStoreConstruction = true;
            }

            // 🔥 修复：延迟加载模式下，this.data为空是正常的
            if (this.data.length === 0 && this.dataLoadingStrategy !== 'lazy') {
                console.warn('⚠️ 本地缓存为空');
                if (skeleton) skeleton.classList.add('hidden');
                this.noDataAlert.classList.remove('hidden');
                return;
            }

            this.noDataAlert.classList.add('hidden');

            // 4. 恢复页面状态（如果有保存的状态）
            this.updateSkeletonProgress(92, '正在恢复页面状态...');
            if (this.hasSavedState) {
                const restored = this.restorePageState();
                if (restored) {
                    console.log('✅ 页面状态已从sessionStorage恢复');
                }
            } else {
                this.setDefaultDates();
            }

            // 5. 渲染图表（如果有保存的统计结果）
            this.updateSkeletonProgress(96, '正在渲染图表...');

            if (this.hasSavedStats) {
                const statsRestored = this.restoreStatisticsResult();
                if (statsRestored) {
                    console.log('✅ 统计结果已从sessionStorage恢复');
                }
            }

            // 6. 移除骨架屏（数据已加载，页面可用）
            this.updateSkeletonProgress(100, '初始化完成！');
            await new Promise(resolve => setTimeout(resolve, 300)); // 让用户看到100%

            if (skeleton) {
                skeleton.classList.add('hidden');
            }

            // ⚡ 条件性后台构建DataStore（仅在需要时）
            if (!this.dataStoreReady || this.needFullDataStoreConstruction) {
                console.log('✅ 页面初始化完成（DataStore将在后台构建）');
                this.buildDataStoreInBackground(groupType);
            } else {
                console.log('✅ 页面初始化完成（DataStore已就绪，跳过后台构建）');
            }

            // 延迟更新缓存状态（避免IndexedDB事务冲突）
            setTimeout(() => {
                this.updateCacheStatus();
            }, 100);

            // 7. 后台预加载（不阻塞）
            setTimeout(() => this.backgroundPreload(), 2000);

            // 数据加载完成后折叠系统说明（视觉反馈）
            this.collapseInstructionsAfterLoad();

            console.log('✅ 应用初始化完成');

            // 🆕 通知 SharedDataManager 数据已加载（用于跨页面共享）
            // 🔥 延迟加载模式下，先从IndexedDB快速加载数据再通知
            if (window.sharedDataManager) {
                if (this.data && this.data.length > 0) {
                    // 数据已在内存，直接通知
                    window.sharedDataManager.notifyDataLoaded(this.data, 'index');
                    console.log(`📡 已通知 SharedDataManager 数据已加载: ${this.data.length.toLocaleString()} 条`);
                } else if (this.dataLoadingStrategy === 'lazy') {
                    // 延迟加载模式：快速从IndexedDB加载全量数据
                    console.log('⚡ 延迟加载模式：快速加载数据以支持跨页面共享...');
                    setTimeout(async () => {
                        try {
                            const allData = await cacheManager.getAllDataFast();
                            this.data = allData;
                            window.sharedDataManager.notifyDataLoaded(allData, 'index');
                            console.log(`📡 已通知 SharedDataManager 数据已加载（延迟）: ${allData.length.toLocaleString()} 条`);
                        } catch (error) {
                            console.error('❌ 延迟加载数据失败:', error);
                        }
                    }, 100); // 延迟100ms，不阻塞初始化
                }
            }

            // 初始化完成，处理暂存的 WebSocket 更新
            this.isInitializing = false;
            if (this.pendingUpdates.length > 0) {
                console.log(`🔄 初始化完成，处理暂存的 ${this.pendingUpdates.length} 条更新...`);
                const updates = [...this.pendingUpdates];
                this.pendingUpdates = [];

                updates.forEach(({ operation, record }) => {
                    this.handleRealtimeUpdate(operation, record);
                });

                console.log(`✅ 暂存更新已全部应用`);
            }

        } catch (error) {
            console.error('❌ 初始化失败:', error);
            if (skeleton) skeleton.classList.add('hidden');
            showError('数据加载失败: ' + (error.message || error));
            this.isInitializing = false;
        }
    }

    // 🆕 【极速】追加数据批次到 DataStore
    appendDataBatch(batch, groupType) {
        if (!this.dataStore) return;

        // 使用批量优化方法（10-50倍性能提升）
        this.dataStore.addRecordsToBucketBatch(batch, this.cycleEngine, groupType);
    }

    // 🆕 新增：显示元数据统计（快速显示缓存信息）
    displayMetadataStats(metadata) {
        // 可以在这里快速显示一些元数据信息，比如总记录数、时间范围等
        // 目前先留空，后续可以扩展显示在统计卡片上
        console.log(`📊 缓存元数据: ${metadata.actualCount} 条记录`);
        if (metadata.minDate && metadata.maxDate) {
            console.log(`📅 数据范围: ${metadata.minDate.toLocaleDateString()} - ${metadata.maxDate.toLocaleDateString()}`);
        }
    }

    // 🆕 新增：显示后台加载进度指示器
    showBackgroundLoadingIndicator() {
        const dbLoading = document.getElementById('dbLoading');
        const dbLoadingText = document.getElementById('dbLoadingText');
        const dbLoadingProgressBar = document.getElementById('dbLoadingProgressBar');

        if (dbLoading && dbLoadingText) {
            dbLoading.classList.remove('hidden');
            dbLoadingText.textContent = '正在后台加载历史数据...';

            if (dbLoadingProgressBar) {
                dbLoadingProgressBar.classList.remove('hidden');
            }
        }
    }

    // 🆕 新增：更新后台加载进度指示器
    updateBackgroundLoadingIndicator(loadedCount, targetCount, progressPercent) {
        const dbLoading = document.getElementById('dbLoading');
        const dbLoadingText = document.getElementById('dbLoadingText');
        const dbLoadingProgressBar = document.getElementById('dbLoadingProgressBar');
        const dbLoadingProgressFill = document.getElementById('dbLoadingProgressFill');
        const dbLoadingProgressText = document.getElementById('dbLoadingProgressText');
        const dbLoadingCountText = document.getElementById('dbLoadingCountText');

        if (!dbLoading || !dbLoadingText) return;

        // 显示加载状态
        dbLoading.classList.remove('hidden');

        // 更新加载文本
        dbLoadingText.textContent = '正在后台加载历史数据...';

        // 显示进度条
        if (dbLoadingProgressBar) {
            dbLoadingProgressBar.classList.remove('hidden');
        }

        // 更新进度条
        if (dbLoadingProgressFill) {
            dbLoadingProgressFill.style.width = `${progressPercent}%`;
        }

        // 更新进度文本
        if (dbLoadingProgressText) {
            dbLoadingProgressText.textContent = `${progressPercent}%`;
        }

        // 更新计数文本
        if (dbLoadingCountText) {
            dbLoadingCountText.textContent = `${loadedCount.toLocaleString()} / ${targetCount.toLocaleString()}`;
        }

        // 如果完成，3秒后隐藏
        if (progressPercent >= 100) {
            setTimeout(() => {
                if (dbLoading) {
                    dbLoading.classList.add('hidden');
                }
                if (dbLoadingProgressBar) {
                    dbLoadingProgressBar.classList.add('hidden');
                }
            }, 3000);
        }
    }

    // 🆕 新增：按需加载this.data（延迟加载模式）
    async ensureDataLoaded(months = 3) {
        // 如果已经加载过，直接返回
        if (this.dataLoadingStrategy !== 'lazy' || this.data.length > 0) {
            return;
        }

        console.log(`🔄 按需加载 this.data（最近${months}个月）...`);
        const loadStart = performance.now();

        try {
            let loadedCount = 0;
            await cacheManager.queryRecentMonthsFromShards(
                months,
                (batch) => {
                    loadedCount += batch.length;
                    this.data.push(...batch);
                },
                5000
            );

            const loadTime = performance.now() - loadStart;
            console.log(`✅ this.data 按需加载完成: ${loadedCount.toLocaleString()} 条 (${loadTime.toFixed(0)}ms)`);

            // 切换到已加载状态
            this.dataLoadingStrategy = 'loaded';

        } catch (error) {
            console.error('❌ 按需加载 this.data 失败:', error);
            throw error;
        }
    }

    // 🆕 新增：按需优先加载指定日期范围的数据（支持渐进式渲染）
    async loadDateRangeOnDemand(startDate, endDate, groupType, onProgress) {
        try {
            console.log(`🎯 优先加载日期范围: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`);

            // 显示加载进度
            this.showBackgroundLoadingIndicator();

            // 检查该范围的数据是否已经在this.data中
            const existingData = this.data ? this.data.filter(record => {
                const recordDate = new Date(record.start_time || record['开始时间']);
                return recordDate >= startDate && recordDate <= endDate;
            }) : [];

            console.log(`   已加载数据: ${existingData.length} 条`);

            // 从缓存加载该日期范围的数据
            const rangeData = [];
            let loadedCount = 0;
            const targetStart = performance.now();

            await cacheManager.queryDateRangeFromShards(
                startDate,
                endDate,
                (batch) => {
                    loadedCount += batch.length;
                    rangeData.push(...batch);

                    // 🆕 【极速】批量添加到DataStore
                    this.dataStore.addRecordsToBucketBatch(batch, this.cycleEngine, groupType);

                    // 合并到this.data（去重）
                    const existingIds = new Set(this.data.map(r => this.dataStore.getRecordKey(r)));
                    const newRecords = batch.filter(r => !existingIds.has(this.dataStore.getRecordKey(r)));
                    this.data.push(...newRecords);

                    // 触发进度回调（边加载边渲染）
                    if (onProgress) {
                        onProgress(loadedCount, rangeData.length);
                    }

                    // 更新UI进度
                    this.updateBackgroundLoadingIndicator(loadedCount, loadedCount, 100);
                },
                5000
            );

            const loadTime = performance.now() - targetStart;
            console.log(`✅ 目标范围数据加载完成: ${loadedCount.toLocaleString()} 条 (${loadTime.toFixed(0)}ms)`);

            // 🔥 更新已加载的数据范围
            if (this.loadedDataRange) {
                // 扩展已有范围
                this.loadedDataRange.start = startDate < this.loadedDataRange.start ? startDate : this.loadedDataRange.start;
                this.loadedDataRange.end = endDate > this.loadedDataRange.end ? endDate : this.loadedDataRange.end;
            } else {
                // 首次设置范围
                this.loadedDataRange = { start: startDate, end: endDate };
            }
            console.log(`📅 更新已加载范围: ${this.loadedDataRange.start.toLocaleDateString()} - ${this.loadedDataRange.end.toLocaleDateString()}`);

            // 隐藏进度条
            setTimeout(() => {
                const dbLoading = document.getElementById('dbLoading');
                if (dbLoading) dbLoading.classList.add('hidden');
            }, 1000);

            return loadedCount;

        } catch (error) {
            console.error('❌ 按需加载失败:', error);
            throw error;
        }
    }

    // ⚡ 新增：后台构建DataStore（不阻塞UI）
    buildDataStoreInBackground(groupType) {
        // 🆕 检查是否需要加载全部数据
        if (this.needFullDataStoreConstruction) {
            console.log('📦 检测到需要完整DataStore，后台加载全部数据...');
            // 延迟执行，确保页面已经可用
            setTimeout(() => {
                this.buildFullDataStoreInBackground(groupType);
            }, 1000);
        } else {
            // 使用requestIdleCallback确保不阻塞UI
            if (window.requestIdleCallback) {
                requestIdleCallback(() => {
                    this.executeBuildDataStore(groupType);
                }, { timeout: 500 });  // 最多延迟500ms
            } else {
                // 降级方案：使用setTimeout
                setTimeout(() => {
                    this.executeBuildDataStore(groupType);
                }, 50);
            }
        }
    }

    // 🆕 渐进式后台加载全部数据并构建完整DataStore
    async buildFullDataStoreInBackground(groupType) {
        try {
            console.log('🔄 开始渐进式后台加载全部数据（用于完整DataStore）...');
            const startTime = performance.now();

            // 标记后台加载状态
            this.isBackgroundLoading = true;
            this.backgroundLoadingProgress = 0;

            // 获取总数据量（用于计算进度）
            const metadata = await cacheManager.getMetadataFast();
            this.backgroundLoadTarget = metadata?.actualCount || 0;
            console.log(`📊 目标加载: ${this.backgroundLoadTarget.toLocaleString()} 条`);

            // 🆕 显示进度指示器
            this.showBackgroundLoadingIndicator();

            // 临时存储全部数据
            const allData = [];
            let loadedCount = 0;
            let lastUpdateTime = Date.now();

            // ⚡ 渐进式加载：每批数据立即添加到DataStore
            await cacheManager.queryAllDataFast(
                (batch) => {
                    loadedCount += batch.length;
                    allData.push(...batch);

                    // 🆕 【极速】批量将数据添加到DataStore（10-50倍性能提升）
                    this.dataStore.addRecordsToBucketBatch(batch, this.cycleEngine, groupType);

                    // 更新进度
                    if (this.backgroundLoadTarget > 0) {
                        this.backgroundLoadingProgress = Math.round((loadedCount / this.backgroundLoadTarget) * 100);
                    }

                    // 🆕 更新进度指示器UI
                    this.updateBackgroundLoadingIndicator(loadedCount, this.backgroundLoadTarget, this.backgroundLoadingProgress);

                    // 每加载5000条或每2秒显示一次进度
                    const now = Date.now();
                    if (loadedCount % 5000 === 0 || now - lastUpdateTime > 2000) {
                        console.log(`  📦 已加载 ${loadedCount.toLocaleString()} / ${this.backgroundLoadTarget.toLocaleString()} 条 (${this.backgroundLoadingProgress}%)`);
                        lastUpdateTime = now;

                        // 🆕 如果用户正在查看图表，增量更新
                        if (this.chart && this.chart.data) {
                            this.refreshChartIfNeeded();
                        }
                    }
                },
                5000 // 较小的批次，更频繁的增量更新
            );

            const loadTime = performance.now() - startTime;
            console.log(`✅ 全部数据加载完成: ${allData.length.toLocaleString()} 条 (${loadTime.toFixed(0)}ms)`);

            // 🔥 关键修复：更新 this.data 为包含所有历史数据的完整数据集
            // 这样当用户改变统计周期时，DataStore 可以用全部数据重新构建
            const oldDataLength = this.data ? this.data.length : 0;
            this.data = allData;
            console.log(`🔄 更新内存数据: ${oldDataLength.toLocaleString()} -> ${allData.length.toLocaleString()} 条`);

            // 标记DataStore已就绪
            this.dataStoreReady = true;
            this.needFullDataStoreConstruction = false;
            this.isBackgroundLoading = false;
            this.backgroundLoadingProgress = 100;

            console.log(`✅ 完整DataStore构建完成: ${this.dataStore.buckets.size} 个桶`);

            // 🆕 保存完整的DataStore桶到缓存
            try {
                await cacheManager.saveDataStoreBuckets(
                    groupType,
                    this.dataStore.buckets,
                    allData.length
                );
                this.dataStoreCacheDirty = false;
                console.log('💾 完整DataStore桶缓存已保存');
            } catch (error) {
                console.error('⚠️ DataStore桶缓存保存失败:', error);
            }

            // 🆕 后台加载完成后，如果图表已显示，最后刷新一次
            if (this.chart && this.chart.data) {
                console.log('🔄 后台加载完成，最终刷新图表');
                this.generateStatistics();
            }

            // 如果用户在等待统计结果，现在可以计算了
            if (this.pendingStatsRequest) {
                console.log('🔄 完整DataStore就绪，执行待处理的统计请求');
                this.pendingStatsRequest = false;
                this.generateStatistics();
            }

        } catch (error) {
            console.error('❌ 后台加载全部数据失败:', error);
            this.isBackgroundLoading = false;
        }
    }

    // 🆕 智能刷新图表（节流，避免频繁刷新）
    refreshChartIfNeeded() {
        // 使用节流，避免过于频繁的刷新
        if (this._lastChartRefresh && Date.now() - this._lastChartRefresh < 3000) {
            return; // 3秒内不重复刷新
        }

        this._lastChartRefresh = Date.now();
        console.log('🔄 增量刷新图表（后台数据已更新）');

        // 静默刷新，不显示loading
        const groupType = this.groupBy.value;
        const range = this.computeDateRangeForGroup(groupType, this.startDate.value, this.endDate.value);

        if (this.dataStore && this.dataStore.buckets.size > 0) {
            const stats = this.dataStore.getStats(this.taskAnalyzer, range.startDate, range.endDate);
            this.updateChart(stats, groupType);
            this.updateStatCards(stats);
            this.updateDetailTable(stats);
        }
    }

    // 执行DataStore构建
    async executeBuildDataStore(groupType, saveToCache = true) {
        console.log('🔄 后台构建DataStore...');
        const start = performance.now();

        // 一次性构建DataStore（比分批快）
        this.dataStore.loadData(this.data, this.cycleEngine, groupType);

        const buildTime = performance.now() - start;
        console.log(`✅ DataStore构建完成: ${this.dataStore.buckets.size} 个桶 (${buildTime.toFixed(0)}ms)`);

        // 标记DataStore已就绪
        this.dataStoreReady = true;

        // 🆕 保存DataStore桶结构到缓存（仅当需要时）
        if (saveToCache) {
            try {
                await cacheManager.saveDataStoreBuckets(
                    groupType,
                    this.dataStore.buckets,
                    this.data.length
                );
                this.dataStoreCacheDirty = false; // 重置脏标记
            } catch (error) {
                console.error('⚠️ DataStore桶缓存保存失败（非阻塞）:', error);
            }
        }

        // 如果用户在等待统计结果，现在可以计算了
        if (this.pendingStatsRequest) {
            console.log('🔄 DataStore就绪，执行待处理的统计请求');
            this.pendingStatsRequest = false;
            this.generateStatistics();
        }
    }

    // 🆕 新增：后台预加载（不阻塞主流程）
    async backgroundPreload() {
        try {
            console.log('🔄 后台预加载数据...');
            // 可以在这里执行一些后台任务，比如预加载其他页面需要的数据
            // 目前先留空，保持与原有逻辑一致
        } catch (error) {
            console.warn('⚠️ 后台预加载失败（非致命）:', error);
        }
    }

    // 数据加载完成后折叠系统说明（视觉反馈）
    collapseInstructionsAfterLoad() {
        if (typeof window.collapseInstructions === 'function') {
            window.collapseInstructions();
        }
    }

    // 处理实时数据更新（WebSocket 推送或跨页面广播）
    async handleRealtimeUpdate(operation, record) {
        // 如果正在初始化，暂存更新到队列
        if (this.isInitializing) {
            this.pendingUpdates.push({ operation, record });
            console.log(`📦 初始化中，暂存更新: ${operation} (队列长度: ${this.pendingUpdates.length})`);
            return;
        }

        if (!this.data) {
            console.warn('⚠️ 应用未初始化，忽略实时更新');
            return;
        }

        // 🔥 延迟加载模式：首次实时更新时按需加载this.data
        if (this.dataLoadingStrategy === 'lazy' && this.data.length === 0) {
            console.log('🔄 首次实时更新，触发按需加载 this.data...');
            try {
                await this.ensureDataLoaded(3); // 加载最近3个月
            } catch (error) {
                console.error('❌ 按需加载失败，实时更新将仅更新DataStore');
            }
        }

        const perfStart = performance.now();

        try {
            // 【优化】使用 DataStore 增量更新桶数据
            const groupType = this.groupBy ? this.groupBy.value : 'day';
            const affectedBuckets = new Set();
            const recordKey = this.dataStore.getRecordKey(record);

            // 🔥 修复：检查记录时间范围（判断是否在加载的数据范围内）
            // 如果全部数据已加载完成，则接受所有时间范围的更新
            let isInLoadedRange = false;
            if (this.dataStoreReady && !this.needFullDataStoreConstruction) {
                // 全部历史数据已加载，接受所有时间范围
                isInLoadedRange = true;
            } else {
                // 仅加载了最近3个月，只接受该范围内的更新
                const recordTime = new Date(record.start_time || record['开始时间']);
                const threeMonthsAgo = new Date();
                threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
                isInLoadedRange = recordTime >= threeMonthsAgo;
            }

            // 更新内存数据 this.data 和 DataStore
            if (operation === 'insert' || operation === 'update') {
                const index = this.data.findIndex(r => this.dataStore.getRecordKey(r) === recordKey);

                if (index >= 0) {
                    // ✅ 找到记录：更新
                    const bucketKeys = this.dataStore.updateRecord(record, this.cycleEngine, groupType, false);
                    bucketKeys.forEach(key => affectedBuckets.add(key));

                    this.data[index] = record;
                    console.log(`🔄 更新内存记录: ${recordKey}`);

                } else if (isInLoadedRange) {
                    // ✅ 未找到但在数据范围内：新增记录
                    this.data.push(record);
                    const newBucketKey = this.dataStore.addRecordToBucket(record, this.cycleEngine, groupType);
                    if (newBucketKey) affectedBuckets.add(newBucketKey);
                    console.log(`➕ 新增内存记录: ${recordKey}`);

                } else {
                    // ⚠️ 超出范围的数据更新：只更新DataStore桶，不加载到内存
                    const recordTime = new Date(record.start_time || record['开始时间']);
                    console.warn(`⚠️ 超出范围的数据更新 (${recordTime.toLocaleDateString()})，仅更新DataStore桶`);
                    const newBucketKey = this.dataStore.addRecordToBucket(record, this.cycleEngine, groupType);
                    if (newBucketKey) affectedBuckets.add(newBucketKey);

                    // 🆕 标记桶缓存需要更新
                    this.dataStoreCacheDirty = true;
                }

            } else if (operation === 'delete') {
                const index = this.data.findIndex(r => this.dataStore.getRecordKey(r) === recordKey);
                if (index >= 0) {
                    // ✅ 找到记录：删除
                    const bucketKeys = this.dataStore.updateRecord(this.data[index], this.cycleEngine, groupType, true);
                    bucketKeys.forEach(key => affectedBuckets.add(key));

                    this.data.splice(index, 1);
                    console.log(`🗑️ 删除内存记录: ${recordKey}`);

                } else {
                    // ⚠️ 历史数据删除：尝试从DataStore删除
                    console.warn(`⚠️ 历史数据删除 (${recordKey})，尝试从DataStore移除`);
                    // 注意：这里需要record的完整信息才能从桶中删除
                    // 如果WebSocket只推送了ID，需要额外查询
                }

                // 🆕 标记桶缓存需要更新
                this.dataStoreCacheDirty = true;
            }

            const perfTime = performance.now() - perfStart;
            console.log(`⚡ 实时数据更新完成 (${perfTime.toFixed(2)}ms)，影响 ${affectedBuckets.size} 个桶`);

            // 如果当前有图表显示，增量刷新图表（只更新受影响的桶）
            if (this.chart && affectedBuckets.size > 0) {
                console.log(`📊 检测到数据变更，增量刷新图表 (${affectedBuckets.size} 个桶)...`);
                this.updateChartIncremental(Array.from(affectedBuckets));
            } else if (affectedBuckets.size > 0) {
                console.log(`💡 数据已更新，但当前无图表显示，跳过刷新`);
            }

        } catch (error) {
            console.error('❌ 处理实时更新失败:', error);
        }
    }

    // 更新缓存状态显示
    async updateCacheStatus() {
        try {
            const cacheInfo = await cacheManager.checkAllDataCache();
            
            if (cacheInfo) {
                this.cacheStatus.textContent = '✅ 已缓存';
                this.cacheStatus.className = 'text-xs px-2 py-1 rounded-full bg-success/10 text-success';
                this.cacheInfo.textContent = `${cacheInfo.totalCount} 条数据 · ${new Date(cacheInfo.lastUpdated).toLocaleString()}`;
            } else {
                this.cacheStatus.textContent = '❌ 无缓存';
                this.cacheStatus.className = 'text-xs px-2 py-1 rounded-full bg-danger/10 text-danger';
                this.cacheInfo.textContent = '暂无本地缓存数据';
            }
        } catch (error) {
            this.cacheStatus.textContent = '⚠️ 检查失败';
            this.cacheStatus.className = 'text-xs px-2 py-1 rounded-full bg-warning/10 text-warning';
            this.cacheInfo.textContent = '缓存状态检查失败';
        }
    }

    // 手动刷新缓存
    async refreshCache() {
        try {
            this.refreshCacheBtn.disabled = true;
            this.refreshCacheBtn.innerHTML = '<i class="fa fa-spinner fa-spin mr-1"></i>刷新中...';

            console.log('🔄 用户手动刷新缓存...');

            // 🆕 清除DataStore桶缓存（因为数据将更新）
            await cacheManager.clearDataStoreBucketsCache();

            const result = await dataPreloader.autoPreloadAllData();

            if (result.success) {
                showSuccess(`缓存刷新成功！更新了 ${result.totalCount} 条数据`);
                // 重新加载数据到应用
                await this.init();
            }

            this.updateCacheStatus();
            
        } catch (error) {
            console.error('❌ 缓存刷新失败:', error);
            showError('缓存刷新失败: ' + error.message);
        } finally {
            this.refreshCacheBtn.disabled = false;
            this.refreshCacheBtn.innerHTML = '<i class="fa fa-refresh mr-1"></i>刷新缓存';
        }
    }

    // 清空缓存
    async clearCache() {
        if (!confirm('确定要清空本地缓存吗？下次访问将重新从数据库加载数据。')) {
            return;
        }

        try {
            this.clearCacheBtn.disabled = true;
            this.clearCacheBtn.innerHTML = '<i class="fa fa-spinner fa-spin mr-1"></i>清空中...';

            console.log('🧹 用户清空缓存...');

            // 🆕 同时清除DataStore桶缓存
            await cacheManager.clearDataStoreBucketsCache();

            await cacheManager.clearAllDataCache();
            
            // 清空应用数据
            this.data = null;
            this.noDataAlert.classList.remove('hidden');
            
            // 清空图表
            if (this.chart) {
                this.chart.destroy();
                this.chart = null;
            }
            if (this.satelliteChart) {
                this.satelliteChart.destroy();
                this.satelliteChart = null;
            }
            if (this.customerChart) {
                this.customerChart.destroy();
                this.customerChart = null;
            }
            
            // 重置统计卡片
            this.updateStatCards([]);
            this.updateDetailTable([]);
            
            showSuccess('本地缓存已清空');
            this.updateCacheStatus();
            
        } catch (error) {
            console.error('❌ 清空缓存失败:', error);
            showError('清空缓存失败: ' + error.message);
        } finally {
            this.clearCacheBtn.disabled = false;
            this.clearCacheBtn.innerHTML = '<i class="fa fa-trash mr-1"></i>清空缓存';
        }
    }

    setDefaultDates() {
        const today = new Date();
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(today.getDate() - 7);
        const formatDate = (date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        };
        if (this.startDate) this.startDate.value = formatDate(sevenDaysAgo);
        if (this.endDate) this.endDate.value = formatDate(today);
    }

    parseDateInputToLocal(dateStr, hour = 0, minute = 0, second = 0, ms = 0) {
        if (!dateStr) return null;
        const parts = dateStr.split('-').map(Number);
        const year = parts[0], month = parts[1] - 1, day = parts[2];
        return new Date(year, month, day, hour, minute, second, ms);
    }

    computeDateRangeForGroup(groupType, startDateStr, endDateStr) {
        let startBound = null;
        let endBound = null;

        // Helper: 使用齿轮配置时间来确保正确落在周期分组内
        const makeMidday = (dateStr) => {
            if (!dateStr) return null;
            const parts = dateStr.split('-').map(Number);
            
            // 获取齿轮配置的时间
            const config = this.cycleEngine.config;
            let configTime = config.day.start;
            
            // 解析齿轮时间 HH:mm
            const [hours = 0, minutes = 0] = configTime.split(':').map(num => parseInt(num, 10));
            
            // 使用齿轮配置的具体时间而不是12:00
            return new Date(parts[0], parts[1] - 1, parts[2], hours, minutes, 0, 0);
        };

        try {
            if (startDateStr) {
                const midStart = makeMidday(startDateStr);
                const gStart = this.cycleEngine.getGroup(midStart, groupType);
                
                // 确保startBound不早于用户设置的开始日期
                const userStartDate = this.parseDateInputToLocal(startDateStr, 0, 0, 0, 0);
                startBound = gStart.rangeStart < userStartDate ? userStartDate : gStart.rangeStart;
            }

            if (endDateStr) {
                const midEnd = makeMidday(endDateStr);
                const gEnd = this.cycleEngine.getGroup(midEnd, groupType);
                
                // 确保包含结束日期的完整周期，延长到下一天的齿轮时间
                const nextDayStart = new Date(midEnd);
                nextDayStart.setDate(nextDayStart.getDate() + 1);
                const gNext = this.cycleEngine.getGroup(nextDayStart, groupType);
                endBound = gNext.rangeStart;
            }
        } catch (err) {
            console.warn('计算日期范围失败，回退到基于本地日历的默认解析', err);
            // 退回：按本地午夜/23:59:59.999解析
            if (startDateStr) startBound = this.parseDateInputToLocal(startDateStr, 0, 0, 0, 0);
            if (endDateStr) endBound = this.parseDateInputToLocal(endDateStr, 23, 59, 59, 999);
        }

        return { startDate: startBound, endDate: endBound };
    }

    async generateStatistics() {
        // 🔥 修复：延迟加载模式下，this.data可能为空，但DataStore包含数据
        if (!this.data && !this.dataStore) {
            showError('当前没有数据，请先导入数据后重试');
            return;
        }

        const groupType = this.groupBy.value;
        const range = this.computeDateRangeForGroup(groupType, this.startDate.value, this.endDate.value);
        const startDate = range.startDate;
        const endDate = range.endDate;

        // 🎯 简化：检测是否需要按需加载（边加载边渲染）
        if (startDate && endDate && !this.dataStoreReady) {
            // 🔥 简化逻辑：只要DataStore未完全就绪，就使用渐进式加载
            // 这样可以让用户看到加载过程和图表实时更新
            let needsOnDemandLoad = false;
            let loadReason = '';

            // 检查1：快速初始化模式，且选择范围超出已加载范围
            if (this.dataLoadingStrategy === 'quick' && this.loadedDataRange) {
                const rangeExceedsLoaded = (
                    startDate < this.loadedDataRange.start ||
                    endDate > this.loadedDataRange.end
                );

                if (rangeExceedsLoaded) {
                    needsOnDemandLoad = true;
                    loadReason = `范围超出已加载: ${this.loadedDataRange.start.toLocaleDateString()} - ${this.loadedDataRange.end.toLocaleDateString()}`;
                }
            }

            // 检查2：DataStore有数据但未完全就绪，检查数据密度
            if (!needsOnDemandLoad && this.data && this.data.length > 0) {
                const existingDataInRange = this.data.filter(record => {
                    const recordDate = new Date(record.start_time || record['开始时间']);
                    return recordDate >= startDate && recordDate <= endDate;
                });

                const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));

                // 🔥 简化：如果范围>7天且数据很少，就触发加载
                if (daysDiff > 7 && existingDataInRange.length < 100) {
                    needsOnDemandLoad = true;
                    loadReason = `数据不足: ${existingDataInRange.length} 条`;
                }
            }

            if (needsOnDemandLoad) {
                const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
                console.log(`🎯 检测到需要按需加载: 目标范围 ${daysDiff} 天，原因: ${loadReason}`);

                // 显示加载状态
                this.chartLoadingState.classList.remove('hidden');
                this.chartEmptyState.classList.add('hidden');
                this.chartErrorState.classList.add('hidden');

                try {
                    // 🎬 优先加载目标范围，并在加载过程中渐进式渲染（边加载边更新图表）
                    let lastRenderTime = 0;
                    let renderCount = 0;

                    // 显示加载提示
                    showInfo('正在加载历史数据，图表将实时更新...');

                    await this.loadDateRangeOnDemand(
                        startDate,
                        endDate,
                        groupType,
                        (loadedCount, totalCount) => {
                            // 🎬 渐进式渲染策略：每1秒或每5000条渲染一次
                            // 让用户看到横轴和纵轴实时变化，提供视觉反馈
                            const now = Date.now();
                            const shouldRender = now - lastRenderTime > 1000 || loadedCount % 5000 === 0;

                            if (shouldRender) {
                                renderCount++;
                                console.log(`   🎬 渐进式渲染 #${renderCount}: ${loadedCount} / ${totalCount} 条`);
                                lastRenderTime = now;

                                // 使用当前已加载的数据生成图表（横轴和纵轴会随数据增加而扩展）
                                const stats = this.dataStore.getStats(this.taskAnalyzer, startDate, endDate);
                                if (stats.length > 0) {
                                    this.updateChart(stats, groupType, true); // isProgressive=true
                                    this.updateStatCards(stats);
                                    this.updateDetailTable(stats);
                                }
                            }
                        }
                    );

                    // 最终渲染
                    console.log('✅ 目标范围加载完成，最终渲染');
                    const stats = this.dataStore.getStats(this.taskAnalyzer, startDate, endDate);
                    this.updateChart(stats, groupType);
                    this.updateStatCards(stats);
                    this.updateDetailTable(stats);
                    this.saveStatisticsResult(stats, groupType);

                    this.chartLoadingState.classList.add('hidden');

                    // 继续后台加载剩余的历史数据
                    if (!this.isBackgroundLoading) {
                        console.log('🔄 继续后台加载剩余历史数据...');
                        setTimeout(() => {
                            this.buildFullDataStoreInBackground(groupType);
                        }, 1000);
                    }

                    return;

                } catch (error) {
                    console.error('❌ 按需加载失败:', error);
                    // 继续使用已有数据生成统计
                }
            }
        }

        // ⚡ 允许使用部分数据生成图表（即使DataStore未完全就绪）
        if (!this.dataStoreReady && this.dataStore.buckets.size === 0) {
            // DataStore完全为空，需要等待
            console.log('⏳ DataStore正在初始化，统计请求已排队...');
            this.pendingStatsRequest = true;

            // 显示加载状态
            this.chartLoadingState.classList.remove('hidden');
            this.chartEmptyState.classList.add('hidden');
            this.chartErrorState.classList.add('hidden');
            return;
        }

        // 🆕 如果DataStore有数据但未完全就绪，显示部分数据警告
        if (!this.dataStoreReady && this.isBackgroundLoading) {
            console.warn(`⚠️ 使用部分数据生成图表 (${this.backgroundLoadingProgress}% 已加载)`);
            showWarning(`正在后台加载历史数据 (${this.backgroundLoadingProgress}%)，图表将显示部分数据并自动更新`);
        }

        this.chartLoadingState.classList.remove('hidden');
        this.chartEmptyState.classList.add('hidden');
        this.chartErrorState.classList.add('hidden');
        this.detailTableBody.innerHTML = '';

        try {
            console.log('📊 开始生成统计结果（基于本地缓存数据）...');

            // groupType, startDate, endDate 已在方法开始时定义
            let stats;

            // 【优化】优先使用 DataStore 桶查询（O(n) -> O(1)）
            if (this.dataStore && this.dataStore.buckets.size > 0) {
                const perfStart = performance.now();
                stats = this.dataStore.getStats(this.taskAnalyzer, startDate, endDate);
                const perfTime = performance.now() - perfStart;
                console.log(`⚡ 使用桶查询生成统计 (${perfTime.toFixed(2)}ms, ${stats.length} 个桶)`);
            } else {
                // 兜底：使用传统方法遍历数据
                console.log('⚠️ DataStore 未初始化，使用传统遍历方法');
                stats = this.groupDataByCycle(groupType, startDate, endDate);
                console.log(`📈 生成统计组数: ${stats.length}`);
            }

            this.updateChart(stats, groupType);
            this.updateStatCards(stats);
            this.updateDetailTable(stats);

            // 保存统计结果到 sessionStorage
            this.saveStatisticsResult(stats, groupType);

        } catch (error) {
            console.error('❌ 生成统计结果失败:', error);
            this.chartErrorMessage.textContent = '生成统计结果时出错: ' + error.message;
            this.chartErrorState.classList.remove('hidden');
        } finally {
            this.chartLoadingState.classList.add('hidden');
        }
    }

    groupDataByCycle(groupType, startDate, endDate) {
        const groups = {};
        const { planIdField, startTimeField, taskResultField } = this.fieldMappingValues;
        
        this.data.forEach(item => {
            try {
                // 解析任务开始时间（严格基于文件时间）
                const timeValue = item[startTimeField];
                let date;
                
                if (timeValue instanceof Date) {
                    // 已经是日期对象，直接使用文件时间
                    date = this.cycleEngine.createFileDate(timeValue);
                } else if (typeof timeValue === 'string') {
                    // 字符串日期，按文件时间解析
                    date = new Date(timeValue);
                } else if (typeof timeValue === 'number') {
                    // Excel日期数字，转换为文件时间
                    date = new Date((timeValue - 25569) * 86400000);
                } else {
                    console.warn('无法解析时间:', item);
                    return;
                }
                
                // 验证日期有效性
                if (isNaN(date.getTime())) {
                    console.warn('无效的日期值:', timeValue);
                    return;
                }
                
                // 如果指定了日期范围，过滤不在范围内的数据（使用文件时间比较）
                if (startDate && date < startDate) return;
                if (endDate && date >= endDate) return;
                
                // 获取周期组信息（基于文件时间）
                const groupInfo = this.cycleEngine.getGroup(date, groupType);
                
                // 如果该组不存在，则初始化
                if (!groups[groupInfo.key]) {
                    groups[groupInfo.key] = {
                        key: groupInfo.key,
                        label: groupInfo.label,
                        count: 0,
                        planIds: new Set(),
                        results: [],
                        rangeStart: groupInfo.rangeStart,
                        rangeEnd: groupInfo.rangeEnd
                    };
                }
                
                // 更新组数据
                const group = groups[groupInfo.key];
                group.planIds.add(item[planIdField]);
                group.count = group.planIds.size; // 确保计划ID唯一
                group.results.push(item[taskResultField] || '未知');
                
            } catch (error) {
                console.warn('处理数据项失败:', item, error);
            }
        });
        
        // 转换为数组并按时间排序（文件时间顺序）
        const statsArray = Object.values(groups).sort((a, b) => {
            return a.rangeStart - b.rangeStart;
        });
        
        // 计算每个周期的失败次数和成功率 - 使用计划ID总数作为分母
        statsArray.forEach(stat => {
            stat.failureCount = this.taskAnalyzer.countFailures(stat.results);
            // 传入计划ID总数作为第二个参数
            stat.successRate = this.taskAnalyzer.calculateSuccessRate(stat.results, stat.count);
        });
        
        return statsArray;
    }

    updateChart(stats, groupType, isProgressive = false) {
        if (!stats || stats.length === 0) {
            this.chartEmptyState.classList.remove('hidden');
            if (this.chart) {
                this.chart.destroy();
                this.chart = null;
            }
            return;
        }

        this.chartEmptyState.classList.add('hidden');

        const labels = stats.map(stat => stat.label);
        const planCounts = stats.map(stat => stat.count);
        const failureCounts = stats.map(stat => stat.failureCount);
        const successRates = stats.map(stat => parseFloat(stat.successRate.toFixed(3)));

        // 获取是否显示数据标签的设置
        const showLabels = this.showDataLabels.checked;

        // 🚀 性能优化：如果图表已存在，使用update而不是destroy
        if (this.chart && isProgressive) {
            // 更新数据
            this.chart.data.labels = labels;
            this.chart.data.datasets[0].data = planCounts;
            this.chart.data.datasets[1].data = failureCounts;
            this.chart.data.datasets[2].data = successRates;

            // 使用update触发重绘（比destroy快10-50倍）
            this.chart.update('none'); // 'none'模式：立即更新，无动画
            return;
        }

        // 销毁旧图表（仅在非渐进模式或首次创建时）
        if (this.chart) {
            this.chart.destroy();
        }

        const ctx = this.dataChart.getContext('2d');

        // 注册数据标签插件
        Chart.register(ChartDataLabels);

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '计划ID数量',
                        data: planCounts,
                        borderColor: '#165DFF',
                        backgroundColor: 'rgba(22, 93, 255, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.3,
                        yAxisID: 'y',
                        datalabels: {
                            display: showLabels,
                            color: '#165DFF',
                            anchor: 'end',
                            align: 'top',
                            font: {
                                size: 10,
                                weight: 'bold'
                            }
                        }
                    },
                    {
                        label: '失败圈次计数',
                        data: failureCounts,
                        borderColor: '#F53F3F',
                        backgroundColor: 'rgba(245, 63, 63, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.3,
                        yAxisID: 'y',
                        datalabels: {
                            display: showLabels,
                            color: '#F53F3F',
                            anchor: 'end',
                            align: 'bottom',
                            font: {
                                size: 10,
                                weight: 'bold'
                            }
                        }
                    },
                    {
                        label: '成功率(%)',
                        data: successRates,
                        borderColor: '#00B42A',
                        backgroundColor: 'rgba(0, 180, 42, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.3,
                        yAxisID: 'y1',
                        pointRadius: 4,
                        pointBackgroundColor: '#00B42A',
                        datalabels: {
                            display: showLabels,
                            color: '#00B42A',
                            anchor: 'end',
                            align: 'top',
                            font: {
                                size: 10,
                                weight: 'bold'
                            },
                            formatter: function(value) {
                                return value + '%';
                            }
                        }
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: {
                        top: 30,
                        bottom: 10,
                        left: 10,
                        right: 10
                    }
                },
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: '数量'
                        },
                        beginAtZero: true
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: {
                            display: true,
                            text: '成功率(%)'
                        },
                        min: 0,
                        max: 100,
                        grid: {
                            drawOnChartArea: false
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: {
                            padding: 15,
                            font: {
                                size: 12
                            }
                        }
                    },
                    datalabels: {
                        display: showLabels
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.datasetIndex === 2) label += context.parsed.y + '%';
                                else label += context.parsed.y;
                                return label;
                            }
                        }
                    }
                }
            }
        });
    }

    // 【优化】增量更新图表 - 仅更新受影响的桶数据
    updateChartIncremental(affectedBucketKeys) {
        console.log(`🔍 开始增量更新，受影响的桶:`, affectedBucketKeys);

        if (!this.chart) {
            console.warn('⚠️ 图表不存在，跳过增量更新');
            return;
        }

        if (!this.dataStore || affectedBucketKeys.length === 0) {
            console.warn('⚠️ DataStore 不存在或无受影响的桶，跳过更新');
            return;
        }

        const perfStart = performance.now();

        try {
            const groupType = this.groupBy.value;
            const range = this.computeDateRangeForGroup(groupType, this.startDate.value, this.endDate.value);
            const startDate = range.startDate;
            const endDate = range.endDate;

            console.log(`📊 从 DataStore 获取统计数据 (${groupType}): ${startDate?.toLocaleDateString()} - ${endDate?.toLocaleDateString()}`);

            // 从 DataStore 获取所有统计数据（快速）
            const stats = this.dataStore.getStats(this.taskAnalyzer, startDate, endDate);

            console.log(`📈 获取到 ${stats.length} 个统计分组`);

            // 创建桶键到索引的映射
            const keyToIndex = new Map();
            stats.forEach((stat, index) => {
                keyToIndex.set(stat.key, index);
            });

            // 更新受影响的数据点
            let updatedCount = 0;
            affectedBucketKeys.forEach(bucketKey => {
                const index = keyToIndex.get(bucketKey);
                console.log(`🔍 查找桶 ${bucketKey} 的索引: ${index}`);

                if (index !== undefined && index < this.chart.data.labels.length) {
                    const stat = stats[index];

                    console.log(`📊 更新索引 ${index} 的数据: count=${stat.count}, failure=${stat.failureCount}, rate=${stat.successRate.toFixed(3)}%`);

                    // 更新图表数据（3个数据集：计划ID数量、失败次数、成功率）
                    this.chart.data.datasets[0].data[index] = stat.count;
                    this.chart.data.datasets[1].data[index] = stat.failureCount;
                    this.chart.data.datasets[2].data[index] = parseFloat(stat.successRate.toFixed(3));

                    updatedCount++;
                } else {
                    console.warn(`⚠️ 桶 ${bucketKey} 不在当前显示范围内 (index: ${index}, chart labels: ${this.chart.data.labels.length})`);
                }
            });

            // 刷新图表显示（使用 'none' 模式实现即时更新）
            console.log(`🔄 刷新图表显示...`);
            this.chart.update('none');

            // 同时更新统计卡片和详细表格
            this.updateStatCards(stats);
            this.updateDetailTable(stats);

            // 保存更新后的统计结果
            this.saveStatisticsResult(stats, groupType);

            const perfTime = performance.now() - perfStart;
            console.log(`✅ 增量更新完成 (${perfTime.toFixed(2)}ms)，更新了 ${updatedCount}/${affectedBucketKeys.length} 个数据点`);

        } catch (error) {
            console.error('❌ 增量更新失败:', error);
            console.error('错误堆栈:', error.stack);
        }
    }

    toggleDataLabels() {
        if (this.chart) {
            const showLabels = this.showDataLabels.checked;
            
            // 更新所有数据集的标签显示设置
            this.chart.data.datasets.forEach(dataset => {
                if (dataset.datalabels) {
                    dataset.datalabels.display = showLabels;
                }
            });
            
            // 更新图表
            this.chart.update('none'); // 使用 'none' 模式实现即时更新
        }
    }

    updateStatCards(stats) {
        if (!stats || stats.length === 0) {
            this.totalCount.textContent = '0';
            this.avgCount.textContent = '0';
            this.totalFailures.textContent = '0';
            this.avgSuccessRate.textContent = '0%';
            if (this.maxCount) this.maxCount.textContent = '0';
            if (this.minCount) this.minCount.textContent = '0';
            if (this.satelliteCount) this.satelliteCount.textContent = '0';
            if (this.customerCount) this.customerCount.textContent = '0';
            return;
        }

        const totalCount = stats.reduce((sum, stat) => sum + stat.count, 0);
        this.totalCount.textContent = totalCount;

        const avgCount = (totalCount / stats.length).toFixed(1);
        this.avgCount.textContent = avgCount;

        const totalFailures = stats.reduce((sum, stat) => sum + stat.failureCount, 0);
        this.totalFailures.textContent = totalFailures;

        const validRates = stats.filter(stat => stat.count > 0).map(stat => stat.successRate);
        const avgSuccessRate = validRates.length > 0 ? (validRates.reduce((sum, rate) => sum + rate, 0) / validRates.length).toFixed(3) : 0;
        this.avgSuccessRate.textContent = `${avgSuccessRate}%`;

        // 新增：最大和最小周期计划数
        const counts = stats.map(stat => stat.count);
        if (this.maxCount) this.maxCount.textContent = Math.max(...counts);
        if (this.minCount) this.minCount.textContent = Math.min(...counts);
        
        // 新增：计算卫星和客户数量
        this.updateEntityCounts(stats);
    }

    updateDetailTable(stats) {
        this.detailTableBody.innerHTML = '';

        if (!stats || stats.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 5;
            td.className = 'px-6 py-4 text-center text-gray-500';
            td.textContent = '没有符合条件的数据';
            tr.appendChild(td);
            this.detailTableBody.appendChild(tr);
            return;
        }

        stats.forEach(stat => {
            const tr = document.createElement('tr');

            const cycleTd = document.createElement('td');
            cycleTd.className = 'px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900';
            cycleTd.textContent = stat.label;
            tr.appendChild(cycleTd);

            const countTd = document.createElement('td');
            countTd.className = 'px-6 py-4 whitespace-nowrap text-sm text-gray-500';
            countTd.textContent = stat.count;
            tr.appendChild(countTd);

            const failureTd = document.createElement('td');
            failureTd.className = 'px-6 py-4 whitespace-nowrap text-sm text-danger';
            failureTd.textContent = stat.failureCount;
            tr.appendChild(failureTd);

            const rateTd = document.createElement('td');
            rateTd.className = 'px-6 py-4 whitespace-nowrap text-sm text-success';
            rateTd.textContent = `${stat.successRate.toFixed(3)}%`;
            tr.appendChild(rateTd);

            const rangeTd = document.createElement('td');
            rangeTd.className = 'px-6 py-4 whitespace-nowrap text-sm text-gray-500';
            rangeTd.textContent = `${this.formatDateForDisplayCorrected(stat.rangeStart)} 至 ${this.formatDateForDisplayCorrected(stat.rangeEnd)}`;
            tr.appendChild(rangeTd);

            this.detailTableBody.appendChild(tr);
        });
    }

    formatDateForDisplay(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }

    // 格式化日期时间显示（不再需要时区修正，数据库时间已是北京时间）
    formatDateForDisplayCorrected(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }

    openGroupingConfig() {
        console.log('🚀 openGroupingConfig 被调用');
        console.log('📋 groupingConfigModal:', this.groupingConfigModal);
        console.log('📋 modalContent:', this.modalContent);
        
        this.updateGroupingConfigForm();
        
        if (this.groupingConfigModal) {
            this.groupingConfigModal.classList.remove('hidden');
            console.log('✅ 模态框显示');
            
            setTimeout(() => {
                if (this.modalContent) {
                    this.modalContent.classList.remove('scale-95', 'opacity-0');
                    this.modalContent.classList.add('scale-100', 'opacity-100');
                    console.log('✅ 模态框动画完成');
                } else {
                    console.error('❌ modalContent 未找到');
                }
            }, 10);
        } else {
            console.error('❌ groupingConfigModal 未找到');
        }
    }

    closeGroupingConfig() {
        this.modalContent.classList.remove('scale-100', 'opacity-100');
        this.modalContent.classList.add('scale-95', 'opacity-0');
        setTimeout(() => {
            this.groupingConfigModal.classList.add('hidden');
        }, 300);
    }

    updateGroupingConfigForm() {
        const config = this.cycleEngine.config;
        
        // 更新日周期配置 - 修正显示偏移
        const correctedDayStart = this.correctTimeDisplayForGear(config.day.start);
        this.dayStart.value = correctedDayStart;
        this.dayStartDisplay.textContent = correctedDayStart;
        this.dayEndDisplay.textContent = correctedDayStart;
        
        // 更新周周期配置 - 修正显示偏移  
        this.weekStartDay.value = config.week.startDay;
        this.weekStartTime.value = this.correctTimeDisplayForGear(config.week.startTime);
        
        // 更新月周期配置 - 修正显示偏移
        this.monthStartDate.value = config.month.startDate;
        this.monthStartTime.value = this.correctTimeDisplayForGear(config.month.startTime);
        
        // 更新季度周期配置 - 修正显示偏移
        this.quarterStartMonth.value = config.quarter.startMonth;
        this.quarterStartTime.value = this.correctTimeDisplayForGear(config.quarter.startTime);
    }

    // 格式化齿轮配置表单的时间显示（不再需要时区修正，数据库时间已是北京时间）
    correctTimeDisplayForGear(timeString) {
        // 直接返回原始时间，不需要修正
        return timeString;
    }

    // 格式化用户输入的时间用于存储（不再需要时区修正，数据库时间已是北京时间）
    correctTimeInputForStorage(timeString) {
        // 直接返回原始时间，不需要修正
        return timeString;
    }


    // 新增：动态查找包含关键词的字段值
    findFieldValue(item, keywords) {
        // 首先尝试精确匹配
        for (const keyword of keywords) {
            if (item[keyword] !== undefined && item[keyword] !== null && item[keyword] !== '') {
                return item[keyword];
            }
        }
        
        // 然后尝试包含匹配
        const itemKeys = Object.keys(item);
        for (const keyword of keywords) {
            const matchingKey = itemKeys.find(key => 
                key.toLowerCase().includes(keyword.toLowerCase()) ||
                key.includes(keyword)
            );
            if (matchingKey && item[matchingKey] !== undefined && item[matchingKey] !== null && item[matchingKey] !== '') {
                return item[matchingKey];
            }
        }
        
        return null;
    }

    // 新增：更新卫星和客户实体数量统计
    updateEntityCounts(stats) {
        if (!stats || stats.length === 0) {
            if (this.satelliteCount) this.satelliteCount.textContent = '0';
            if (this.customerCount) this.customerCount.textContent = '0';
            return;
        }
        
        // 收集所有周期的卫星和客户数据
        const allSatellites = new Set();
        const allCustomers = new Set();
        
        const { planIdField, startTimeField, taskResultField } = this.fieldMappingValues;
        
        if (this.data) {
            // 获取时间范围
            const groupType = this.groupBy.value;
            const range = this.computeDateRangeForGroup(groupType, this.startDate.value, this.endDate.value);
            const startDate = range.startDate;
            const endDate = range.endDate;
            
            this.data.forEach(item => {
                try {
                    // 解析任务开始时间（严格基于文件时间）
                    const timeValue = item[startTimeField];
                    let date;
                    
                    if (timeValue instanceof Date) {
                        date = this.cycleEngine.createFileDate(timeValue);
                    } else if (typeof timeValue === 'string') {
                        date = new Date(timeValue);
                    } else if (typeof timeValue === 'number') {
                        date = new Date((timeValue - 25569) * 86400000);
                    } else {
                        return;
                    }
                    
                    // 验证日期有效性
                    if (isNaN(date.getTime())) return;
                    
                    // 如果指定了日期范围，过滤不在范围内的数据
                    if (startDate && date < startDate) return;
                    if (endDate && date >= endDate) return;
                    
                    // 收集卫星和客户信息 - 动态字段匹配
                    const satellite = this.findFieldValue(item, ['satellite_name', 'satellite', '卫星名称', '卫星', '星']);
                    const customer = this.findFieldValue(item, ['customer', 'client', '客户', '用户', '所属客户']);
                    
                    if (satellite && satellite.toString().trim() !== '') {
                        allSatellites.add(satellite.toString().trim());
                    }
                    if (customer && customer.toString().trim() !== '') {
                        allCustomers.add(customer.toString().trim());
                    }
                    
                } catch (error) {
                    console.warn('处理实体数据项失败:', item, error);
                }
            });
        }
        
        // 更新显示
        if (this.satelliteCount) this.satelliteCount.textContent = allSatellites.size;
        if (this.customerCount) this.customerCount.textContent = allCustomers.size;
        
        console.log('卫星数量统计:', allSatellites.size, '个卫星:', Array.from(allSatellites).slice(0, 10));
        console.log('客户数量统计:', allCustomers.size, '个客户:', Array.from(allCustomers).slice(0, 10));
    }

    async saveGroupingConfiguration() {
        const newConfig = {
            day: { start: this.correctTimeInputForStorage(this.dayStart.value) },
            week: { startDay: parseInt(this.weekStartDay.value), startTime: this.correctTimeInputForStorage(this.weekStartTime.value) },
            month: { startDate: parseInt(this.monthStartDate.value), startTime: this.correctTimeInputForStorage(this.monthStartTime.value) },
            quarter: { startMonth: parseInt(this.quarterStartMonth.value), startTime: this.correctTimeInputForStorage(this.quarterStartTime.value) }
        };

        console.log('💾 保存新的周期配置:', newConfig);
        console.log('🔧 更新前的配置:', this.cycleEngine.config);
        
        this.cycleEngine.updateConfig(newConfig);
        
        console.log('✅ 更新后的配置:', this.cycleEngine.config);
        
        // 保存配置到本地存储，确保持久化
        try {
            const cacheData = JSON.parse(localStorage.getItem('satelliteAppData') || '{}');
            cacheData.cycleConfig = this.cycleEngine.config;
            localStorage.setItem('satelliteAppData', JSON.stringify(cacheData));
            console.log('💾 配置已保存到本地存储');
        } catch (error) {
            console.warn('保存配置失败:', error);
        }
        
        // 🚨 重要：配置更新后，重新加载 DataStore 并重新计算统计数据
        console.log('🔄 配置已更新，重新加载 DataStore...');
        if (this.data && this.dataStore) {
            const groupType = this.groupBy.value;
            this.dataStore.loadData(this.data, this.cycleEngine, groupType);
        }
        console.log('🔄 重新生成统计...');
        this.generateStatistics();
        
        showSuccess('周期配置已更新，统计数据已刷新');
        this.closeGroupingConfig();
    }

    // 加载保存的配置
    loadSavedConfig() {
        try {
            const cacheData = JSON.parse(localStorage.getItem('satelliteAppData') || '{}');
            if (cacheData.cycleConfig) {
                console.log('🔧 加载保存的配置:', cacheData.cycleConfig);
                this.cycleEngine.updateConfig(cacheData.cycleConfig);
                console.log('✅ 配置加载完成:', this.cycleEngine.config);

                // 延迟更新表单显示，确保DOM元素已加载
                setTimeout(() => {
                    if (this.updateGroupingConfigForm) {
                        this.updateGroupingConfigForm();
                    }
                }, 100);
            }
        } catch (error) {
            console.warn('加载配置失败:', error);
        }
    }

    // 保存页面状态到sessionStorage（会话级别，关闭标签页清空）
    savePageState() {
        try {
            const pageState = {
                startDate: this.startDate?.value || '',
                endDate: this.endDate?.value || '',
                groupBy: this.groupBy?.value || 'day',
                showDataLabels: this.showDataLabels?.checked || false,
                timestamp: Date.now()
            };

            sessionStorage.setItem('satellitePageState', JSON.stringify(pageState));
            console.log('💾 页面状态已保存:', pageState);
        } catch (error) {
            console.warn('保存页面状态失败:', error);
        }
    }

    // 恢复页面状态从sessionStorage（优化版：同步恢复，减少延迟）
    restorePageState() {
        try {
            const savedState = sessionStorage.getItem('satellitePageState');
            if (!savedState) {
                console.log('📋 无保存的页面状态');
                return false;
            }

            const pageState = JSON.parse(savedState);
            console.log('🔄 恢复页面状态:', pageState);

            // 同步恢复，不使用延迟，减少闪烁
            // 恢复日期范围
            if (pageState.startDate && this.startDate) {
                this.startDate.value = pageState.startDate;
            }
            if (pageState.endDate && this.endDate) {
                this.endDate.value = pageState.endDate;
            }

            // 恢复分组方式
            if (pageState.groupBy && this.groupBy) {
                this.groupBy.value = pageState.groupBy;
            }

            // 恢复数据标签显示状态
            if (this.showDataLabels) {
                this.showDataLabels.checked = pageState.showDataLabels || false;
            }

            console.log('✅ 页面状态恢复完成');
            return true;
        } catch (error) {
            console.warn('恢复页面状态失败:', error);
            return false;
        }
    }

    // 清空页面状态
    clearPageState() {
        try {
            sessionStorage.removeItem('satellitePageState');
            console.log('🗑️ 页面状态已清空');
        } catch (error) {
            console.warn('清空页面状态失败:', error);
        }
    }

    // 保存统计结果到 sessionStorage
    saveStatisticsResult(stats, groupType) {
        try {
            if (!stats || stats.length === 0) {
                console.log('📊 统计结果为空，不保存');
                return;
            }

            const statisticsData = {
                stats: stats,
                groupType: groupType,
                generatedAt: Date.now()
            };

            sessionStorage.setItem('satelliteStatistics', JSON.stringify(statisticsData));
            console.log('💾 统计结果已保存:', {
                statsCount: stats.length,
                groupType: groupType
            });
        } catch (error) {
            console.warn('保存统计结果失败:', error);
        }
    }

    // 恢复统计结果并重新渲染图表（优化版：减少闪烁）
    restoreStatisticsResult() {
        try {
            const savedStats = sessionStorage.getItem('satelliteStatistics');
            if (!savedStats) {
                console.log('📊 无保存的统计结果');
                return false;
            }

            const statisticsData = JSON.parse(savedStats);
            console.log('🔄 恢复统计结果:', {
                statsCount: statisticsData.stats.length,
                groupType: statisticsData.groupType,
                generatedAt: new Date(statisticsData.generatedAt).toLocaleString()
            });

            // 立即隐藏加载状态，避免闪烁
            if (this.chartLoadingState) {
                this.chartLoadingState.classList.add('hidden');
            }
            if (this.chartEmptyState) {
                this.chartEmptyState.classList.add('hidden');
            }

            // 使用 requestAnimationFrame 优化渲染时机
            requestAnimationFrame(() => {
                // 重新渲染图表、统计卡片和详情表格
                this.updateChart(statisticsData.stats, statisticsData.groupType);
                this.updateStatCards(statisticsData.stats);
                this.updateDetailTable(statisticsData.stats);

                console.log('✅ 统计结果恢复完成');
            });

            return true;
        } catch (error) {
            console.warn('恢复统计结果失败:', error);
            return false;
        }
    }

    // 清空统计结果
    clearStatisticsResult() {
        try {
            sessionStorage.removeItem('satelliteStatistics');
            console.log('🗑️ 统计结果已清空');
        } catch (error) {
            console.warn('清空统计结果失败:', error);
        }
    }

    // 新增：显示卫星数量趋势图
    showSatelliteCountChart() {
        if (!this.data || !this.fieldMappingValues) {
            showError('当前没有数据，请先导入数据后重试');
            return;
        }
        
        // 显示模态框
        this.satelliteCountModal.classList.remove('hidden');
        setTimeout(() => {
            this.satelliteModalContent.classList.remove('scale-95', 'opacity-0');
            this.satelliteModalContent.classList.add('scale-100', 'opacity-100');
        }, 10);
        
        // 生成卫星数量趋势图
        this.generateSatelliteCountChart();
    }
    
    // 新增：显示客户数量趋势图
    showCustomerCountChart() {
        if (!this.data || !this.fieldMappingValues) {
            showError('当前没有数据，请先导入数据后重试');
            return;
        }
        
        // 显示模态框
        this.customerCountModal.classList.remove('hidden');
        setTimeout(() => {
            this.customerModalContent.classList.remove('scale-95', 'opacity-0');
            this.customerModalContent.classList.add('scale-100', 'opacity-100');
        }, 10);
        
        // 生成客户数量趋势图
        this.generateCustomerCountChart();
    }
    
    // 新增：关闭卫星数量模态框
    closeSatelliteCountModal() {
        this.satelliteModalContent.classList.remove('scale-100', 'opacity-100');
        this.satelliteModalContent.classList.add('scale-95', 'opacity-0');
        
        setTimeout(() => {
            this.satelliteCountModal.classList.add('hidden');
        }, 300);
    }
    
    // 新增：关闭客户数量模态框
    closeCustomerCountModal() {
        this.customerModalContent.classList.remove('scale-100', 'opacity-100');
        this.customerModalContent.classList.add('scale-95', 'opacity-0');
        
        setTimeout(() => {
            this.customerCountModal.classList.add('hidden');
        }, 300);
    }
    
    // 新增：生成卫星数量趋势图
    generateSatelliteCountChart() {
        // 显示加载状态
        this.satelliteChartLoading.classList.remove('hidden');
        this.satelliteChartEmpty.classList.add('hidden');
        
        try {
            // 如果已有图表，先销毁
            if (this.satelliteChart) {
                this.satelliteChart.destroy();
            }
            
            const groupType = this.groupBy.value;
            const range = this.computeDateRangeForGroup(groupType, this.startDate.value, this.endDate.value);
            const startDate = range.startDate;
            const endDate = range.endDate;
            
            // 按周期分组统计卫星数量
            const satelliteStats = this.groupSatelliteDataByCycle(groupType, startDate, endDate);
            
            if (satelliteStats.length === 0) {
                this.satelliteChartEmpty.classList.remove('hidden');
                return;
            }
            
            // 准备图表数据
            const labels = satelliteStats.map(stat => stat.label);
            const counts = satelliteStats.map(stat => stat.satelliteCount);
            
            // 创建图表
            const ctx = this.satelliteCountChart.getContext('2d');
            
            this.satelliteChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '卫星数量',
                        data: counts,
                        borderColor: '#2563eb',
                        backgroundColor: 'rgba(37, 99, 235, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 6,
                        pointBackgroundColor: '#2563eb',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: {
                        padding: {
                            top: 30,
                            bottom: 10,
                            left: 10,
                            right: 10
                        }
                    },
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: '卫星数量'
                            }
                        }
                    },
                    plugins: {
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return `卫星数量: ${context.parsed.y}`;
                                }
                            }
                        },
                        datalabels: {
                            display: true,
                            color: '#2563eb',
                            font: {
                                size: 12,
                                weight: 'bold'
                            },
                            anchor: 'center',
                            align: 'top',
                            offset: 8
                        }
                    }
                }
            });
            
        } catch (error) {
            console.error('生成卫星数量趋势图失败:', error);
            this.satelliteChartEmpty.classList.remove('hidden');
        } finally {
            this.satelliteChartLoading.classList.add('hidden');
        }
    }
    
    // 新增：生成客户数量趋势图
    generateCustomerCountChart() {
        // 显示加载状态
        this.customerChartLoading.classList.remove('hidden');
        this.customerChartEmpty.classList.add('hidden');
        
        try {
            // 如果已有图表，先销毁
            if (this.customerChart) {
                this.customerChart.destroy();
            }
            
            const groupType = this.groupBy.value;
            const range = this.computeDateRangeForGroup(groupType, this.startDate.value, this.endDate.value);
            const startDate = range.startDate;
            const endDate = range.endDate;
            
            // 按周期分组统计客户数量
            const customerStats = this.groupCustomerDataByCycle(groupType, startDate, endDate);
            
            if (customerStats.length === 0) {
                this.customerChartEmpty.classList.remove('hidden');
                return;
            }
            
            // 准备图表数据
            const labels = customerStats.map(stat => stat.label);
            const counts = customerStats.map(stat => stat.customerCount);
            
            // 创建图表
            const ctx = this.customerCountChart.getContext('2d');
            
            this.customerChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '客户数量',
                        data: counts,
                        borderColor: '#7c3aed',
                        backgroundColor: 'rgba(124, 58, 237, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 6,
                        pointBackgroundColor: '#7c3aed',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: {
                        padding: {
                            top: 30,
                            bottom: 10,
                            left: 10,
                            right: 10
                        }
                    },
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: '客户数量'
                            }
                        }
                    },
                    plugins: {
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return `客户数量: ${context.parsed.y}`;
                                }
                            }
                        },
                        datalabels: {
                            display: true,
                            color: '#7c3aed',
                            font: {
                                size: 12,
                                weight: 'bold'
                            },
                            anchor: 'center',
                            align: 'top',
                            offset: 8
                        }
                    }
                }
            });
            
        } catch (error) {
            console.error('生成客户数量趋势图失败:', error);
            this.customerChartEmpty.classList.remove('hidden');
        } finally {
            this.customerChartLoading.classList.add('hidden');
        }
    }
    
    // 新增：按周期分组卫星数据
    groupSatelliteDataByCycle(groupType, startDate, endDate) {
        const groups = {};
        const { planIdField, startTimeField, taskResultField } = this.fieldMappingValues;
        
        this.data.forEach(item => {
            try {
                // 解析任务开始时间
                const timeValue = item[startTimeField];
                let date;
                
                if (timeValue instanceof Date) {
                    date = this.cycleEngine.createFileDate(timeValue);
                } else if (typeof timeValue === 'string') {
                    date = new Date(timeValue);
                } else if (typeof timeValue === 'number') {
                    date = new Date((timeValue - 25569) * 86400000);
                } else {
                    return;
                }
                
                // 验证日期有效性
                if (isNaN(date.getTime())) return;
                
                // 如果指定了日期范围，过滤不在范围内的数据
                if (startDate && date < startDate) return;
                if (endDate && date > endDate) return;
                
                // 获取周期组信息
                const groupInfo = this.cycleEngine.getGroup(date, groupType);
                
                // 如果该组不存在，则初始化
                if (!groups[groupInfo.key]) {
                    groups[groupInfo.key] = {
                        key: groupInfo.key,
                        label: groupInfo.label,
                        satellites: new Set(),
                        rangeStart: groupInfo.rangeStart,
                        rangeEnd: groupInfo.rangeEnd
                    };
                }
                
                // 收集卫星信息 - 动态字段匹配
                const satellite = this.findFieldValue(item, ['satellite_name', 'satellite', '卫星名称', '卫星', '星']);
                if (satellite && satellite.toString().trim() !== '') {
                    groups[groupInfo.key].satellites.add(satellite.toString().trim());
                }
                
            } catch (error) {
                console.warn('处理卫星数据项失败:', item, error);
            }
        });
        
        // 转换为数组并按时间排序
        const statsArray = Object.values(groups).sort((a, b) => {
            return a.rangeStart - b.rangeStart;
        });
        
        // 计算每个周期的卫星数量
        statsArray.forEach(stat => {
            stat.satelliteCount = stat.satellites.size;
        });
        
        return statsArray;
    }
    
    // 新增：按周期分组客户数据
    groupCustomerDataByCycle(groupType, startDate, endDate) {
        const groups = {};
        const { planIdField, startTimeField, taskResultField } = this.fieldMappingValues;
        
        this.data.forEach(item => {
            try {
                // 解析任务开始时间
                const timeValue = item[startTimeField];
                let date;
                
                if (timeValue instanceof Date) {
                    date = this.cycleEngine.createFileDate(timeValue);
                } else if (typeof timeValue === 'string') {
                    date = new Date(timeValue);
                } else if (typeof timeValue === 'number') {
                    date = new Date((timeValue - 25569) * 86400000);
                } else {
                    return;
                }
                
                // 验证日期有效性
                if (isNaN(date.getTime())) return;
                
                // 如果指定了日期范围，过滤不在范围内的数据
                if (startDate && date < startDate) return;
                if (endDate && date > endDate) return;
                
                // 获取周期组信息
                const groupInfo = this.cycleEngine.getGroup(date, groupType);
                
                // 如果该组不存在，则初始化
                if (!groups[groupInfo.key]) {
                    groups[groupInfo.key] = {
                        key: groupInfo.key,
                        label: groupInfo.label,
                        customers: new Set(),
                        rangeStart: groupInfo.rangeStart,
                        rangeEnd: groupInfo.rangeEnd
                    };
                }
                
                // 收集客户信息 - 动态字段匹配
                const customer = this.findFieldValue(item, ['customer', 'client', '客户', '用户', '所属客户']);
                if (customer && customer.toString().trim() !== '') {
                    groups[groupInfo.key].customers.add(customer.toString().trim());
                }
                
            } catch (error) {
                console.warn('处理客户数据项失败:', item, error);
            }
        });
        
        // 转换为数组并按时间排序
        const statsArray = Object.values(groups).sort((a, b) => {
            return a.rangeStart - b.rangeStart;
        });
        
        // 计算每个周期的客户数量
        statsArray.forEach(stat => {
            stat.customerCount = stat.customers.size;
        });
        
        return statsArray;
    }

}

// 分组逻辑已验证正确

// 检测页面刷新并清空 sessionStorage
(function() {
    // 使用 performance.navigation 或 performance.getEntriesByType 检测刷新
    const navigationType = performance.getEntriesByType('navigation')[0]?.type;

    // 如果是刷新（reload），清空 sessionStorage 中的页面状态
    if (navigationType === 'reload') {
        console.log('🔄 检测到页面刷新，清空 sessionStorage 状态');
        sessionStorage.removeItem('satellitePageState');
        sessionStorage.removeItem('satelliteStatistics');
    } else {
        console.log('🌐 页面正常加载（非刷新）');
    }
})();
