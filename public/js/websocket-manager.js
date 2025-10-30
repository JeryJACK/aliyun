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
    async checkAndPerformCatchup() {
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
                const result = await this.performCatchupSync();
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

        // 执行断线补同步
        await this.performCatchupSync();
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

    // 断线补同步（获取断线期间的变更）
    async performCatchupSync() {
        try {
            const lastSyncTime = await this.cacheManager.getLastSyncTime();
            console.log(`🔄 开始断线补同步，最后同步时间: ${new Date(lastSyncTime).toLocaleString()}`);

            // 调用后端补同步 API
            const catchupUrl = CONFIG.isGitHubPages
                ? CONFIG.API_ENDPOINTS.catchup || `${CONFIG.API_ENDPOINTS.records}/changes`
                : `${CONFIG.API_BASE_URL}/satellite/changes`;

            const response = await fetch(`${catchupUrl}?since=${lastSyncTime}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                console.warn(`⚠️ 补同步请求失败 (${response.status}): ${response.statusText}`);
                console.warn('💡 提示：补同步功能可选，不影响页面正常使用');
                return { hasNewData: false, count: 0 };
            }

            const result = await response.json();
            if (result.success && result.data && result.data.changes) {
                const changes = result.data.changes;

                if (changes.length > 0) {
                    console.log(`📦 收到 ${changes.length} 条补同步变更`);

                    // 批量更新
                    await this.cacheManager.batchUpdateRecords(changes);

                    // 🆕 返回有新数据的标志
                    return { hasNewData: true, count: changes.length };
                } else {
                    console.log('✅ 无需补同步，数据已是最新');
                    return { hasNewData: false, count: 0 };
                }
            }

            return { hasNewData: false, count: 0 };

        } catch (error) {
            console.error('❌ 断线补同步失败:', error);
            console.error('💡 错误详情:', error.message);
            console.warn('💡 补同步失败不影响页面使用，数据将依赖增量并发加载');
            return { hasNewData: false, count: 0 };
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

