// 全局数据共享管理器
// 用于跨页面共享数据和实时更新，避免重复从 IndexedDB 加载

class SharedDataManager {
    constructor() {
        this.channel = null;
        this.data = null;
        this.dataLoadedAt = null;
        this.metadata = {
            recordCount: 0,
            lastUpdated: null,
            source: null // 'index' or 'trend-analysis'
        };

        // 事件回调
        this.onDataUpdate = null; // 数据更新回调 (operation, record)
        this.onBatchUpdate = null; // 批量更新回调 (records, count)
        this.onDataReload = null; // 数据重载回调
        this.onProgressiveLoad = null; // 渐进式加载回调 (newRecord) - 实时接收每条新数据
        this.onDataRequest = null; // 🆕 数据请求回调 - 当其他页面请求数据时触发

        // 🆕 数据请求等待队列
        this.dataRequestPromises = new Map(); // requestId -> {resolve, reject, timeout}

        this.initBroadcastChannel();
        this.loadMetadata();
    }

    // 初始化广播频道
    initBroadcastChannel() {
        if (typeof BroadcastChannel === 'undefined') {
            console.warn('⚠️ 浏览器不支持 BroadcastChannel，跨页面数据共享可能受限');
            return;
        }

        try {
            this.channel = new BroadcastChannel('satellite_data_sync');

            this.channel.onmessage = (event) => {
                this.handleBroadcastMessage(event.data);
            };

            console.log('✅ 广播频道已初始化');
        } catch (error) {
            console.warn('⚠️ 初始化广播频道失败:', error);
        }
    }

    // 处理广播消息
    handleBroadcastMessage(message) {
        console.log('📡 收到广播消息:', message);

        switch (message.type) {
            case 'data_loaded':
                // 其他页面加载了数据
                this.metadata = message.metadata;
                this.saveMetadata();
                console.log(`📊 数据已加载 (来源: ${message.metadata.source})`);
                break;

            case 'data_updated':
                // 其他页面更新了数据（直接接收数据记录）
                console.log(`📡 收到数据更新广播: ${message.operation}`, message.record?.id || message.record?.plan_id);
                if (this.onDataUpdate) {
                    this.onDataUpdate(message.operation, message.record);
                }
                break;

            case 'batch_update':
                // 其他页面批量更新了数据
                console.log(`📡 收到批量更新广播: ${message.count} 条`);
                if (this.onBatchUpdate) {
                    this.onBatchUpdate(message.records, message.count);
                }
                break;

            case 'data_reloaded':
                // 其他页面重载了数据
                this.metadata = message.metadata;
                this.saveMetadata();
                if (this.onDataReload) {
                    this.onDataReload();
                }
                console.log('🔄 数据已在其他页面重载');
                break;

            case 'request_metadata':
                // 其他页面请求元数据
                this.broadcastMetadata();
                break;

            case 'progressive_load':
                // 渐进式加载：接收单条新数据
                console.log(`📊 收到渐进式加载数据: ${message.count}/${message.total}`);
                if (this.onProgressiveLoad) {
                    this.onProgressiveLoad(message.record);
                }
                // 更新元数据
                this.metadata.recordCount = message.count;
                this.metadata.lastUpdated = Date.now();
                this.saveMetadata();
                break;

            case 'request_data':
                // 🆕 其他页面请求完整数据
                console.log(`📨 收到数据请求: ${message.requestId} (来自: ${message.source})`);

                // 检查是否有数据可以响应
                if (this.data && this.data.length > 0) {
                    // 有内存数据，直接响应
                    this.broadcast({
                        type: 'data_response',
                        requestId: message.requestId,
                        data: this.data,
                        metadata: this.metadata,
                        timestamp: Date.now()
                    });
                    console.log(`✅ 已响应数据请求 ${message.requestId}: ${this.data.length} 条记录（内存）`);
                } else if (this.onDataRequest) {
                    // 没有内存数据，通知应用层处理（可能需要从 IndexedDB 加载）
                    console.log(`⚠️ 内存数据为空，通知应用层处理数据请求 ${message.requestId}`);
                    this.onDataRequest(message.requestId, message.source);
                } else {
                    console.log(`❌ 无法响应数据请求 ${message.requestId}: 数据未加载`);
                }
                break;

            case 'data_response':
                // 🆕 收到数据响应
                console.log(`📦 收到数据响应: ${message.requestId}, ${message.data?.length || 0} 条记录`);
                const promise = this.dataRequestPromises.get(message.requestId);
                if (promise) {
                    clearTimeout(promise.timeout);
                    promise.resolve({
                        data: message.data,
                        metadata: message.metadata
                    });
                    this.dataRequestPromises.delete(message.requestId);
                }
                break;

            default:
                console.warn('⚠️ 未知广播消息类型:', message.type);
        }
    }

    // 保存元数据到 sessionStorage
    saveMetadata() {
        try {
            sessionStorage.setItem('sharedDataMetadata', JSON.stringify(this.metadata));
        } catch (error) {
            console.warn('保存元数据失败:', error);
        }
    }

    // 加载元数据从 sessionStorage
    loadMetadata() {
        try {
            const saved = sessionStorage.getItem('sharedDataMetadata');
            if (saved) {
                this.metadata = JSON.parse(saved);
                console.log('📋 加载共享数据元数据:', this.metadata);
            }
        } catch (error) {
            console.warn('加载元数据失败:', error);
        }
    }

    // 【优化】通知数据已加载（异步共享，0.几毫秒响应）
    notifyDataLoaded(data, source) {
        const perfStart = performance.now();

        this.data = data;
        this.dataLoadedAt = Date.now();
        this.metadata = {
            recordCount: Array.isArray(data) ? data.length : 0,
            lastUpdated: this.dataLoadedAt,
            source: source
        };

        // 异步保存元数据（不阻塞）
        queueMicrotask(() => {
            this.saveMetadata();
        });

        // 立即广播给其他页面（不等待保存完成）
        this.broadcast({
            type: 'data_loaded',
            metadata: this.metadata
        });

        const perfTime = performance.now() - perfStart;
        console.log(`✅ 数据已加载并共享: ${this.metadata.recordCount} 条 (来源: ${source}, 耗时: ${perfTime.toFixed(2)}ms)`);
    }

    // 【新增】渐进式数据加载：加载一条广播一条
    notifyProgressiveLoad(record, currentCount, totalCount) {
        // 异步广播（不阻塞加载）
        queueMicrotask(() => {
            this.broadcast({
                type: 'progressive_load',
                record: record,
                count: currentCount,
                total: totalCount,
                timestamp: Date.now()
            });
        });
    }

    // 【优化】通知数据已更新（异步广播，0.几毫秒响应）
    notifyDataUpdate(update) {
        const perfStart = performance.now();

        this.metadata.lastUpdated = Date.now();

        // 异步保存元数据（不阻塞）
        queueMicrotask(() => {
            this.saveMetadata();
        });

        // 立即广播给其他页面（不等待保存完成）
        this.broadcast({
            type: 'data_updated',
            operation: update.operation,  // 'insert', 'update', 'delete'
            record: update.record,        // 完整的数据记录
            timestamp: Date.now()
        });

        const perfTime = performance.now() - perfStart;
        console.log(`📡 广播数据更新: ${update.operation} (耗时: ${perfTime.toFixed(2)}ms)`, update.record?.id || update.record?.plan_id);
    }

    // 通知批量数据更新
    notifyBatchUpdate(records, count) {
        this.metadata.lastUpdated = Date.now();
        this.saveMetadata();

        // 广播批量更新
        this.broadcast({
            type: 'batch_update',
            records: records,
            count: count,
            timestamp: Date.now()
        });

        console.log(`📡 广播批量更新: ${count} 条记录`);
    }

    // 通知数据已重载
    notifyDataReload(source) {
        this.dataLoadedAt = Date.now();
        this.metadata.lastUpdated = this.dataLoadedAt;
        this.metadata.source = source;
        this.saveMetadata();

        // 广播给其他页面
        this.broadcast({
            type: 'data_reloaded',
            metadata: this.metadata
        });

        console.log('🔄 数据重载已广播');
    }

    // 请求元数据（从其他页面）
    requestMetadata() {
        this.broadcast({
            type: 'request_metadata'
        });
    }

    // 🆕 请求完整数据（从其他页面）
    // 返回 Promise，超时时间默认 3 秒
    requestData(source = 'unknown', timeout = 3000) {
        return new Promise((resolve, reject) => {
            const requestId = `data_request_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            console.log(`📤 请求数据: ${requestId} (来源: ${source})`);

            // 设置超时
            const timeoutId = setTimeout(() => {
                this.dataRequestPromises.delete(requestId);
                console.log(`⏱️ 数据请求超时: ${requestId}`);
                reject(new Error('数据请求超时'));
            }, timeout);

            // 保存 Promise 处理器
            this.dataRequestPromises.set(requestId, {
                resolve,
                reject,
                timeout: timeoutId
            });

            // 广播数据请求
            this.broadcast({
                type: 'request_data',
                requestId,
                source,
                timestamp: Date.now()
            });
        });
    }

    // 广播元数据
    broadcastMetadata() {
        if (this.metadata.recordCount > 0) {
            this.broadcast({
                type: 'data_loaded',
                metadata: this.metadata
            });
        }
    }

    // 发送广播消息
    broadcast(message) {
        if (!this.channel) return;

        try {
            this.channel.postMessage(message);
        } catch (error) {
            console.warn('广播消息失败:', error);
        }
    }

    // 检查数据是否可用（最近5分钟内加载的）
    isDataFresh() {
        if (!this.metadata.lastUpdated) return false;

        const age = Date.now() - this.metadata.lastUpdated;
        const maxAge = 5 * 60 * 1000; // 5分钟

        return age < maxAge;
    }

    // 获取元数据
    getMetadata() {
        return this.metadata;
    }

    // 清空数据
    clearData() {
        this.data = null;
        this.dataLoadedAt = null;
        this.metadata = {
            recordCount: 0,
            lastUpdated: null,
            source: null
        };
        this.saveMetadata();

        // 广播清空事件
        this.broadcast({
            type: 'data_cleared'
        });

        console.log('🗑️ 共享数据已清空');
    }

    // 关闭广播频道
    close() {
        if (this.channel) {
            this.channel.close();
            this.channel = null;
            console.log('🔌 广播频道已关闭');
        }
    }
}

// 创建全局单例
if (typeof window !== 'undefined') {
    window.sharedDataManager = new SharedDataManager();
}
