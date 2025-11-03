class WebSocketSyncManager {
    constructor(cacheManager) {
        this.cacheManager = cacheManager;
        this.ws = null;
        this.wsUrl = this.getWebSocketUrl();
        this.reconnectInterval = 5000; // 5秒重连间隔
        this.reconnectTimer = null;
        this.isConnected = false;
        this.isReconnecting = false;
        this.heartbeatInterval = null;
        this.missedHeartbeats = 0;
        this.maxMissedHeartbeats = 3;

        // 事件回调
        this.onSyncUpdate = null; // 收到数据更新时的回调
        this.onConnectionChange = null; // 连接状态变化回调

        // 🆕 初始化页面可见性监听
        this.initVisibilityListener();
    }

    // 🆕 初始化页面可见性监听（页面关闭时保存时间戳）
    initVisibilityListener() {
        // 监听页面可见性变化
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                // 页面隐藏时保存时间戳
                this.savePageLeaveTime();
                console.log('👋 页面隐藏，保存离开时间戳');
            } else {
                // 页面重新可见时触发补同步
                console.log('👀 页面可见，检查是否需要补同步');
                this.checkAndPerformCatchup();
            }
        });

        // 监听页面卸载（浏览器关闭）
        window.addEventListener('beforeunload', () => {
            this.savePageLeaveTime();
        });

        // 监听页面进入后台（iOS Safari）
        window.addEventListener('pagehide', () => {
            this.savePageLeaveTime();
        });
    }

    // 🆕 保存页面离开时间
    savePageLeaveTime() {
        try {
            const now = Date.now();
            localStorage.setItem('satellitePageLeaveTime', now.toString());
            console.log(`💾 保存页面离开时间: ${new Date(now).toLocaleString()}`);
        } catch (error) {
            console.error('❌ 保存页面离开时间失败:', error);
        }
    }

    // 🆕 检查并执行补同步
    async checkAndPerformCatchup(onProgress) {
        try {
            const leaveTime = localStorage.getItem('satellitePageLeaveTime');
            if (!leaveTime) {
                console.log('ℹ️ 无页面离开时间记录');
                return { hasNewData: false, count: 0 };
            }

            const leaveTimestamp = parseInt(leaveTime);
            const now = Date.now();
            const awayDuration = now - leaveTimestamp;

            // 如果离开超过30秒，触发补同步
            if (awayDuration > 30000) {
                console.log(`🔄 页面离开 ${Math.round(awayDuration / 1000)} 秒，触发补同步`);
                const result = await this.performCatchupSync(onProgress);
                return result || { hasNewData: false, count: 0 };
            } else {
                console.log(`ℹ️ 页面离开时间短 (${Math.round(awayDuration / 1000)}秒)，无需补同步`);
                return { hasNewData: false, count: 0 };
            }
        } catch (error) {
            console.error('❌ 检查补同步失败:', error);
            return { hasNewData: false, count: 0 };
        }
    }

    // 获取 WebSocket URL（根据环境自动配置）
    getWebSocketUrl() {
        // 本地开发环境
        if (CONFIG.isDevelopment) {
            return 'ws://localhost:3000/ws';
        }

        // 使用 config.js 中的 getWebSocketUrl 函数
        // 该函数会根据页面协议自动处理 ws/wss 转换
        if (typeof window.getWebSocketUrl === 'function') {
            return window.getWebSocketUrl();
        }

        // GitHub Pages 环境 - 使用配置的 WebSocket 地址
        if (CONFIG.isGitHubPages && CONFIG.API_ENDPOINTS.websocket) {
            return CONFIG.API_ENDPOINTS.websocket;
        }

        // 默认值（禁用 WebSocket）
        return null;
    }

    // 启动 WebSocket 连接
    connect() {
        if (!this.wsUrl) {
            console.warn('⚠️ WebSocket URL 未配置，跳过实时同步');
            return;
        }

        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
            console.log('🔗 WebSocket 已连接，无需重复连接');
            return;
        }

        try {
            console.log(`🔗 正在连接 WebSocket: ${this.wsUrl}`);
            this.ws = new WebSocket(this.wsUrl);

            this.ws.onopen = () => this.handleOpen();
            this.ws.onmessage = (event) => this.handleMessage(event);
            this.ws.onclose = (event) => this.handleClose(event);
            this.ws.onerror = (error) => this.handleError(error);

        } catch (error) {
            console.error('❌ WebSocket 连接失败:', error);
            this.scheduleReconnect();
        }
    }

    // 连接成功处理
    async handleOpen() {
        console.log('✅ WebSocket 连接成功');
        this.isConnected = true;
        this.isReconnecting = false;
        this.missedHeartbeats = 0;

        // 通知连接状态变化
        if (this.onConnectionChange) {
            this.onConnectionChange(true);
        }

        // 启动心跳检测
        this.startHeartbeat();

        // 🆕 WebSocket 连接成功后，不需要再次执行补同步
        // 因为在页面初始化阶段（main-init.js）已经执行过一次完整的补同步
        console.log('💡 WebSocket 连接成功，后续数据更新将通过实时推送获取');
    }

    // 接收消息处理
    async handleMessage(event) {
        try {
            const message = JSON.parse(event.data);
            console.log('📨 收到 WebSocket 消息:', message);

            switch (message.type) {
                case 'heartbeat':
                    // 心跳响应
                    this.missedHeartbeats = 0;
                    break;

                case 'data_change':
                    // 数据变更通知
                    await this.handleDataChange(message.data);
                    break;

                case 'batch_update':
                    // 批量更新通知
                    await this.handleBatchUpdate(message.data);
                    break;

                default:
                    console.warn('⚠️ 未知消息类型:', message.type);
            }
        } catch (error) {
            console.error('❌ 处理 WebSocket 消息失败:', error);
        }
    }

    // 处理数据变更
    async handleDataChange(changeData) {
        const { operation, record } = changeData;

        try {
            // 统一转换为小写，支持大小写不敏感
            const op = operation.toLowerCase();

            switch (op) {
                case 'insert':
                case 'update':
                    await this.cacheManager.updateRecord(record);
                    console.log(`🔄 实时同步：${op === 'insert' ? '新增' : '更新'} 记录 ID: ${record.id}`);
                    break;

                case 'delete':
                    await this.cacheManager.deleteRecord(record.id);
                    console.log(`🔄 实时同步：删除记录 ID: ${record.id}`);
                    break;

                default:
                    console.warn('⚠️ 未知操作类型:', operation);
            }

            // 触发更新回调（使用统一的小写操作类型）
            if (this.onSyncUpdate) {
                this.onSyncUpdate({ operation: op, record });
            }

        } catch (error) {
            console.error('❌ 处理数据变更失败:', error);
        }
    }

    // 处理批量更新
    async handleBatchUpdate(batchData) {
        const { records } = batchData;

        try {
            const count = await this.cacheManager.batchUpdateRecords(records);
            console.log(`🔄 批量实时同步：更新 ${count} 条记录`);

            // 触发更新回调
            if (this.onSyncUpdate) {
                this.onSyncUpdate({ operation: 'batch_update', count });
            }

        } catch (error) {
            console.error('❌ 批量更新失败:', error);
        }
    }

    // 连接关闭处理
    handleClose(event) {
        console.log(`🔌 WebSocket 连接关闭 (code: ${event.code}, reason: ${event.reason})`);
        this.isConnected = false;
        this.stopHeartbeat();

        // 通知连接状态变化
        if (this.onConnectionChange) {
            this.onConnectionChange(false);
        }

        // 非正常关闭时自动重连
        if (!event.wasClean && !this.isReconnecting) {
            this.scheduleReconnect();
        }
    }

    // 错误处理
    handleError(error) {
        console.error('❌ WebSocket 错误:', error);
    }

    // 安排重连
    scheduleReconnect() {
        if (this.isReconnecting) return;

        this.isReconnecting = true;
        console.log(`🔄 将在 ${this.reconnectInterval / 1000} 秒后重连...`);

        this.reconnectTimer = setTimeout(() => {
            console.log('🔄 尝试重新连接 WebSocket...');
            this.connect();
        }, this.reconnectInterval);
    }

    // 启动心跳检测
    startHeartbeat() {
        this.stopHeartbeat();

        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.missedHeartbeats++;

                if (this.missedHeartbeats >= this.maxMissedHeartbeats) {
                    console.warn('⚠️ 心跳超时，关闭连接并重连');
                    this.ws.close();
                    return;
                }

                // 发送心跳
                this.send({ type: 'heartbeat', timestamp: Date.now() });
            }
        }, 30000); // 每30秒发送心跳
    }

    // 停止心跳检测
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    // 断线补同步（获取断线期间的变更）- 🔥 使用分片并行加载
    async performCatchupSync(onProgress) {
        const perfStart = performance.now();

        try {
            const lastSyncTime = await this.cacheManager.getLastSyncTime();
            console.log(`🔄 开始断线补同步，最后同步时间: ${new Date(lastSyncTime).toLocaleString()}`);

            // 计算时间范围
            const startDate = new Date(lastSyncTime);
            const endDate = new Date();
            const timeDiff = endDate - startDate;
            const hoursDiff = timeDiff / (1000 * 60 * 60);
            const daysDiff = timeDiff / (1000 * 60 * 60 * 24);

            console.log(`📊 补同步时间范围: ${startDate.toLocaleString()} → ${endDate.toLocaleString()} (${daysDiff.toFixed(1)}天)`);

            // 如果时间差小于1分钟，无需补同步
            if (timeDiff < 60000) {
                console.log('✅ 数据已是最新，无需补同步');
                return { hasNewData: false, count: 0 };
            }

            // 🔥 智能分片策略（使用与 incrementalParallelLoad 相同的逻辑）
            let shards;
            if (hoursDiff <= 3) {
                // 3小时内：直接一次请求
                shards = [{
                    start: startDate.toISOString(),
                    end: endDate.toISOString(),
                    label: `${Math.round(hoursDiff * 60)}分钟`
                }];
            } else if (hoursDiff <= 24) {
                // 24小时内：按3小时分片
                shards = this.generateHourlyShards(startDate, endDate, 3);
            } else if (daysDiff <= 7) {
                // 7天内：按6小时分片
                shards = this.generateHourlyShards(startDate, endDate, 6);
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

            console.log(`📊 生成 ${shards.length} 个补同步分片（并行加载）`);

            if (shards.length === 0) {
                return { hasNewData: false, count: 0 };
            }

            // 🔥 并行加载策略（与全量加载相同）
            const CONCURRENT_LIMIT = this.calculateOptimalConcurrency(shards.length);
            let totalLoaded = 0;
            let completedShards = 0;
            let index = 0;

            const storageQueue = [];
            let downloadComplete = false;
            const STORAGE_WORKERS = 3;

            // 存储Worker：多Worker并行存储
            const storageWorker = async (workerId) => {
                while (!downloadComplete || storageQueue.length > 0) {
                    if (storageQueue.length === 0) {
                        await new Promise(resolve => setTimeout(resolve, 10));
                        continue;
                    }

                    const { records, shard, downloadTime } = storageQueue.shift();
                    if (!records) continue;

                    try {
                        const storeStart = performance.now();
                        await this.cacheManager.appendData(records);
                        const storeTime = performance.now() - storeStart;

                        console.log(`  💾 StorageWorker${workerId} 追加 ${shard.label}: ${records.length.toLocaleString()} 条 (下载${downloadTime.toFixed(0)}ms + 存储${storeTime.toFixed(0)}ms)`);

                        totalLoaded += records.length;
                        completedShards++;

                        const progress = Math.round((completedShards / shards.length) * 100);
                        if (onProgress) {
                            onProgress(progress, totalLoaded, totalLoaded);
                        }
                    } catch (error) {
                        console.error(`❌ StorageWorker${workerId} 存储分片 ${shard.label} 失败:`, error);
                    }
                }
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
                        console.error(`❌ 补同步分片 ${shard.label} 失败:`, error);
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
            const downloadWorkers = Array.from(
                { length: Math.min(CONCURRENT_LIMIT, shards.length) },
                (_, i) => downloadWorker(i + 1)
            );

            // 等待所有下载完成
            await Promise.all(downloadWorkers);
            console.log(`✅ 补同步下载完成，等待 ${STORAGE_WORKERS} 个存储Worker清空队列...`);

            // 标记下载完成
            downloadComplete = true;

            // 等待所有存储Worker完成
            await Promise.all(storageWorkers);

            const perfTime = performance.now() - perfStart;
            console.log(`✅ 补同步完成: ${totalLoaded.toLocaleString()} 条新增数据 (${(perfTime / 1000).toFixed(1)}秒)`);

            return { hasNewData: totalLoaded > 0, count: totalLoaded };

        } catch (error) {
            console.error('❌ 断线补同步失败:', error);
            console.error('💡 错误详情:', error.message);
            console.warn('💡 补同步失败不影响页面使用，数据将依赖增量并发加载');
            return { hasNewData: false, count: 0 };
        }
    }

    // 🆕 辅助方法：生成按小时分片
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

    // 🆕 辅助方法：生成按天分片
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

    // 🆕 辅助方法：生成按周分片
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

    // 🆕 辅助方法：生成按月分片
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

    // 🆕 辅助方法：计算最优并发数
    calculateOptimalConcurrency(shardCount) {
        if (shardCount <= 2) {
            return shardCount;
        } else if (shardCount <= 8) {
            return 4;
        } else if (shardCount <= 20) {
            return 6;
        } else {
            return 8;
        }
    }

    // 🆕 辅助方法：请求单个分片数据
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
                return data.data.records;
            }

            return [];

        } catch (error) {
            console.error(`❌ 分片 ${shard.label} 加载失败:`, error);
            return [];
        }
    }

    // 发送消息
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        } else {
            console.warn('⚠️ WebSocket 未连接，无法发送消息');
        }
    }

    // 断开连接
    disconnect() {
        console.log('🔌 主动断开 WebSocket 连接');
        this.isReconnecting = false;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.stopHeartbeat();

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.isConnected = false;

        // 通知连接状态变化
        if (this.onConnectionChange) {
            this.onConnectionChange(false);
        }
    }
}

// 全局实例
const cacheManager = new CacheManager();
const dataPreloader = new DataPreloader();
const wsSyncManager = new WebSocketSyncManager(cacheManager);

// ==================== 原有的API函数（改为从缓存获取）====================

// 从本地缓存获取数据的通用函数（重构为仅使用本地缓存）
async function fetchDataFromAPI(params = {}) {
    try {
        console.log('📍 从本地缓存获取数据:', params);
        
        // 从本地缓存查询数据
        const filters = {};
        
        // 时间范围过滤
        if (params.start_date) {
            filters.startDate = params.start_date;
        }
        if (params.end_date) {
            filters.endDate = params.end_date;
        }
        
        // 从缓存获取数据
        const records = await cacheManager.queryAllData(filters);
        
        // 构建返回结果，保持原有API格式
        return {
            success: true,
            data: {
                records: records,
                count: records.length
            }
        };
        
    } catch (error) {
        console.error('❌ 从本地缓存获取数据失败:', error);
        showError('从本地缓存获取数据失败: ' + error.message);
        return {
            success: false,
            data: {
                records: [],
                count: 0
            }
        };
    }
}

async function fetchStatsFromAPI(params = {}) {
    try {
        const qs = new URLSearchParams(params).toString();
        const url = getApiUrl('stats');
        const response = await fetch(`${url}?${qs}`, {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || '获取统计数据失败');
        }

        return result.data;
    } catch (error) {
        console.error('获取统计数据失败:', error);
        showError('获取统计数据失败: ' + error.message);
        return null;
    }
}

