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

// ⚡ 性能优化：初始化应用 - 渐进式加载策略
document.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log('🌟 页面加载完成，开始渐进式初始化...');
        const perfStart = performance.now();

        // 🆕 初始化进度显示
        const progressPercent = document.getElementById('skeleton-progress-percent');
        const progressText = document.getElementById('skeleton-progress');
        if (progressPercent) progressPercent.textContent = '0%';
        if (progressText) progressText.textContent = '正在初始化...';

        // ⚡ 性能优化：使用 requestIdleCallback 延迟非关键任务
        // 优先级：快速显示界面 > 加载数据 > WebSocket连接

        // ==================== 阶段1：快速检查缓存（<50ms） ====================
        if (progressPercent) progressPercent.textContent = '5%';
        if (progressText) progressText.textContent = '正在检查本地缓存...';

        // ⚡ 优化：将补同步检查延迟到数据加载后（非阻塞）
        // const catchupResult = await wsSyncManager.checkAndPerformCatchup();
        let catchupResult = { hasNewData: false, count: 0 };

        // 🆕 优化：补同步已经更新了IndexedDB，不需要重新下载全量数据！
        if (catchupResult.hasNewData) {
            console.log(`✅ 补同步已更新 ${catchupResult.count} 条数据到IndexedDB`);
            // 清除DataStore桶缓存，因为统计数据可能变化
            await cacheManager.clearDataStoreBucketsCache();
        }

        // ==================== 阶段2：加载数据和初始化应用 ====================
        // 开始加载数据（不需要forceReload，直接使用IndexedDB）
        await dataPreloader.autoPreloadAllData();

        // 初始化应用
        window.app = new SatelliteApp();

        const perfTime = performance.now() - perfStart;
        console.log(`✅ 应用初始化完成，耗时 ${perfTime.toFixed(0)}ms`);

        // ==================== 阶段3：延迟初始化非关键功能（WebSocket） ====================
        // ⚡ 性能优化：使用 requestIdleCallback 延迟WebSocket连接（非阻塞）
        const initWebSocket = () => {
            console.log('🔌 延迟启动 WebSocket 实时同步...');

            // 先执行补同步，再连接WebSocket
            wsSyncManager.checkAndPerformCatchup().then((result) => {
                catchupResult = result;
                if (catchupResult.hasNewData) {
                    console.log(`✅ 后台补同步完成: ${catchupResult.count} 条数据`);
                    cacheManager.clearDataStoreBucketsCache();
                }
                // 启动 WebSocket 连接
                wsSyncManager.connect();
            });
        };

        // 使用 requestIdleCallback 或 setTimeout 延迟执行
        if ('requestIdleCallback' in window) {
            requestIdleCallback(initWebSocket, { timeout: 2000 });
        } else {
            setTimeout(initWebSocket, 500);
        }

        // 监听实时同步更新（WebSocket 推送）
        wsSyncManager.onSyncUpdate = (update) => {
            const { operation, record, count } = update;

            // 🆕 处理补同步完成事件（现在补同步已在数据加载前完成，这里主要处理WebSocket连接后的补同步）
            if (operation === 'catchup_sync') {
                console.log(`✅ WebSocket补同步完成: ${count} 条变更`);

                // 🆕 优化：增量更新，不重新init整个应用（更快！）
                if (count > 0 && window.app) {
                    console.log('🔄 增量更新UI...');
                    showInfo(`已同步 ${count} 条新数据`);

                    // 1. 清除DataStore桶缓存（因为分组统计可能变了）
                    cacheManager.clearDataStoreBucketsCache();

                    // 2. 如果有图表显示，智能刷新图表（带节流，避免频繁刷新）
                    if (window.app.chart) {
                        window.app.refreshChartIfNeeded();
                        console.log('📊 图表已增量刷新');
                    }

                    // 3. 更新统计卡片（无需重新加载数据）
                    window.app.updateCacheStatus();
                }
                return;
            }

            console.log(`📡 WebSocket 推送: ${operation}`, record?.id || record?.plan_id);

            // 1. 更新内存数据并刷新图表
            if (window.app && window.app.data) {
                window.app.handleRealtimeUpdate(operation, record);
            }

            // 2. 广播给其他页面（trend-analysis.html 等）
            if (typeof window.sharedDataManager !== 'undefined') {
                window.sharedDataManager.notifyDataUpdate({
                    operation: operation,
                    record: record
                });
            }
        };

        // 监听跨页面数据广播（来自 trend-analysis.html 等其他页面）
        if (typeof window.sharedDataManager !== 'undefined') {
            window.sharedDataManager.onDataUpdate = (operation, record) => {
                console.log(`📡 收到跨页面广播: ${operation}`, record?.id || record?.plan_id);

                // 更新内存数据并刷新图表
                if (window.app && window.app.data) {
                    window.app.handleRealtimeUpdate(operation, record);
                }
            };

            // 🆕 监听数据请求（其他页面请求共享数据）
            window.sharedDataManager.onDataRequest = async (requestId, source) => {
                console.log(`📨 收到来自 ${source} 的数据请求: ${requestId}`);

                // 如果 this.data 为空（延迟加载模式），快速从 IndexedDB 加载
                if (window.app && (!window.app.data || window.app.data.length === 0)) {
                    console.log('⚡ this.data 为空，快速加载数据以响应请求...');

                    try {
                        // 快速加载所有数据（使用游标，比查询快）
                        const loadStart = performance.now();
                        const allData = await cacheManager.getAllDataFast();
                        window.app.data = allData;

                        const loadTime = performance.now() - loadStart;
                        console.log(`✅ 数据加载完成: ${allData.length.toLocaleString()} 条 (${loadTime.toFixed(0)}ms)`);

                        // 响应数据请求
                        window.sharedDataManager.data = allData;
                        window.sharedDataManager.broadcast({
                            type: 'data_response',
                            requestId: requestId,
                            data: allData,
                            metadata: window.sharedDataManager.metadata,
                            timestamp: Date.now()
                        });
                        console.log(`✅ 已响应数据请求 ${requestId}: ${allData.length} 条记录（按需加载）`);

                    } catch (error) {
                        console.error('❌ 按需加载数据失败:', error);
                    }
                }
            };

            console.log('✅ SharedDataManager 跨页面同步已配置');
        }

        // 监听连接状态变化
        wsSyncManager.onConnectionChange = (connected) => {
            const statusText = connected ? '已连接' : '未连接';
            console.log(`🔌 WebSocket 状态: ${statusText}`);

            // 可选：在页面上显示连接状态指示器
            // 例如：在页面右上角显示一个绿点/红点
            updateConnectionIndicator(connected);
        };

        // 添加连接状态指示器到页面
        function updateConnectionIndicator(connected) {
            let indicator = document.getElementById('ws-connection-indicator');

            // 如果指示器不存在，创建一个
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.id = 'ws-connection-indicator';
                indicator.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    z-index: 9999;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                    transition: all 0.3s ease;
                `;
                indicator.title = 'WebSocket 连接状态';
                document.body.appendChild(indicator);
            }

            // 更新指示器颜色
            if (connected) {
                indicator.style.backgroundColor = '#10b981'; // 绿色
                indicator.title = 'WebSocket 已连接 - 实时同步开启';
            } else {
                indicator.style.backgroundColor = '#ef4444'; // 红色
                indicator.title = 'WebSocket 未连接 - 正在重连...';
            }
        }

        console.log('✅ WebSocket 实时同步已配置');
    } catch (error) {
        console.error('❌ 应用初始化失败:', error);
        // 即使预载失败也要初始化应用
        window.app = new SatelliteApp();
    }

    // 【优化】系统说明默认折叠，立即可用
    const instructionsToggle = document.getElementById('instructionsToggle');
    const instructionsContent = document.getElementById('instructionsContent');
    const instructionsIcon = document.getElementById('instructionsIcon');
    let isExpanded = false; // 默认折叠
    let autoCollapseTimer = null; // 自动折叠定时器

    // 折叠/展开函数
    function toggleInstructions() {
        if (isExpanded) {
            instructionsContent.style.maxHeight = '0px';
            instructionsIcon.classList.remove('fa-chevron-up');
            instructionsIcon.classList.add('fa-chevron-down');
            instructionsIcon.style.transform = 'rotate(0deg)';
        } else {
            instructionsContent.style.maxHeight = instructionsContent.scrollHeight + 'px';
            instructionsIcon.classList.remove('fa-chevron-down');
            instructionsIcon.classList.add('fa-chevron-up');
            instructionsIcon.style.transform = 'rotate(0deg)';
        }
        isExpanded = !isExpanded;
    }

    // 【优化】初始设置为展开状态，数据加载完成后自动折叠
    instructionsContent.style.maxHeight = instructionsContent.scrollHeight + 'px';
    instructionsIcon.classList.remove('fa-chevron-down');
    instructionsIcon.classList.add('fa-chevron-up');
    isExpanded = true;

    // 点击标题切换折叠状态 + 1秒后自动折叠
    instructionsToggle.addEventListener('click', () => {
        // 切换折叠状态
        toggleInstructions();
