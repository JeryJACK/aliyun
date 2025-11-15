/**
 * SharedWorker - 跨标签页数据共享
 * 功能：所有标签页共享同一份数据，减少内存占用和重复加载
 *
 * ⚠️ 重要：实时更新功能保持不变
 * - WebSocket 推送的 INSERT/UPDATE/DELETE 操作会通过此 Worker 广播给所有标签页
 * - 每个标签页仍然可以独立处理实时更新
 */

// 全局数据存储
let globalData = null;
let isDataLoaded = false;
let loadingPromise = null;

// 连接的端口列表（每个标签页一个端口）
const ports = [];

// 监听新连接
self.onconnect = function(e) {
    const port = e.ports[0];
    ports.push(port);

    console.log(`📡 SharedWorker: 新标签页连接，当前连接数: ${ports.length}`);

    port.onmessage = async function(event) {
        const { type, data, clientId } = event.data;

        try {
            switch (type) {
                case 'GET_DATA':
                    await handleGetData(port, clientId);
                    break;

                case 'LOAD_DATA':
                    await handleLoadData(port, data.records, clientId);
                    break;

                case 'UPDATE_RECORD':
                    await handleUpdateRecord(port, data.record, clientId);
                    break;

                case 'DELETE_RECORD':
                    await handleDeleteRecord(port, data.recordId, clientId);
                    break;

                case 'INSERT_RECORD':
                    await handleInsertRecord(port, data.record, clientId);
                    break;

                case 'CLEAR_DATA':
                    await handleClearData(port, clientId);
                    break;

                case 'GET_STATUS':
                    port.postMessage({
                        type: 'STATUS',
                        isLoaded: isDataLoaded,
                        recordCount: globalData ? globalData.length : 0,
                        connections: ports.length
                    });
                    break;

                default:
                    port.postMessage({
                        type: 'ERROR',
                        error: `未知的消息类型: ${type}`
                    });
            }
        } catch (error) {
            port.postMessage({
                type: 'ERROR',
                error: error.message,
                stack: error.stack
            });
        }
    };

    // 端口关闭时清理
    port.onmessageerror = function() {
        const index = ports.indexOf(port);
        if (index > -1) {
            ports.splice(index, 1);
            console.log(`📡 SharedWorker: 标签页断开，剩余连接数: ${ports.length}`);
        }
    };

    // 如果已经有数据，立即发送给新标签页
    if (isDataLoaded && globalData) {
        port.postMessage({
            type: 'DATA_READY',
            records: globalData,
            recordCount: globalData.length,
            cached: true
        });
    }
};

/**
 * 获取数据（如果未加载，等待加载完成）
 */
async function handleGetData(port, clientId) {
    if (isDataLoaded && globalData) {
        // 数据已加载，直接返回
        port.postMessage({
            type: 'DATA_READY',
            records: globalData,
            recordCount: globalData.length,
            cached: true,
            clientId: clientId
        });
    } else if (loadingPromise) {
        // 正在加载，等待加载完成
        await loadingPromise;
        port.postMessage({
            type: 'DATA_READY',
            records: globalData,
            recordCount: globalData.length,
            cached: true,
            clientId: clientId
        });
    } else {
        // 未加载，返回空数据状态
        port.postMessage({
            type: 'NO_DATA',
            message: '数据未加载，请从 IndexedDB 或 API 加载',
            clientId: clientId
        });
    }
}

/**
 * 加载数据到 SharedWorker
 */
async function handleLoadData(port, records, clientId) {
    loadingPromise = new Promise((resolve) => {
        globalData = records;
        isDataLoaded = true;
        resolve();
    });

    await loadingPromise;
    loadingPromise = null;

    console.log(`📊 SharedWorker: 数据已加载 - ${records.length} 条记录`);

    // 通知所有标签页数据已就绪
    broadcastToAll({
        type: 'DATA_LOADED',
        recordCount: records.length,
        clientId: clientId
    });
}

/**
 * 更新单条记录（实时更新功能）
 */
async function handleUpdateRecord(port, record, clientId) {
    if (!globalData) {
        port.postMessage({
            type: 'ERROR',
            error: '数据未加载，无法更新记录',
            clientId: clientId
        });
        return;
    }

    // 查找并更新记录
    const index = globalData.findIndex(r => r.id === record.id || r.plan_id === record.plan_id);

    if (index >= 0) {
        // 更新现有记录
        globalData[index] = { ...globalData[index], ...record };
        console.log(`🔄 SharedWorker: 更新记录 ID: ${record.id || record.plan_id}`);
    } else {
        // 记录不存在，添加新记录（INSERT 操作）
        globalData.push(record);
        console.log(`➕ SharedWorker: 插入新记录 ID: ${record.id || record.plan_id}`);
    }

    // 广播给所有标签页（实时更新）
    broadcastToAll({
        type: 'RECORD_UPDATED',
        operation: index >= 0 ? 'update' : 'insert',
        record: record,
        clientId: clientId
    }, port); // 排除发送者
}

/**
 * 插入新记录（实时更新功能）
 */
async function handleInsertRecord(port, record, clientId) {
    if (!globalData) {
        globalData = [];
        isDataLoaded = true;
    }

    globalData.push(record);
    console.log(`➕ SharedWorker: 插入新记录 ID: ${record.id || record.plan_id}`);

    // 广播给所有标签页（实时更新）
    broadcastToAll({
        type: 'RECORD_UPDATED',
        operation: 'insert',
        record: record,
        clientId: clientId
    }, port);
}

/**
 * 删除记录（实时更新功能）
 */
async function handleDeleteRecord(port, recordId, clientId) {
    if (!globalData) {
        port.postMessage({
            type: 'ERROR',
            error: '数据未加载，无法删除记录',
            clientId: clientId
        });
        return;
    }

    // 查找并删除记录
    const index = globalData.findIndex(r => r.id === recordId || r.plan_id === recordId);

    if (index >= 0) {
        const deletedRecord = globalData.splice(index, 1)[0];
        console.log(`🗑️ SharedWorker: 删除记录 ID: ${recordId}`);

        // 广播给所有标签页（实时更新）
        broadcastToAll({
            type: 'RECORD_UPDATED',
            operation: 'delete',
            record: deletedRecord,
            recordId: recordId,
            clientId: clientId
        }, port);
    } else {
        port.postMessage({
            type: 'ERROR',
            error: `记录不存在: ${recordId}`,
            clientId: clientId
        });
    }
}

/**
 * 清空数据
 */
async function handleClearData(port, clientId) {
    globalData = null;
    isDataLoaded = false;
    console.log(`🧹 SharedWorker: 数据已清空`);

    // 通知所有标签页
    broadcastToAll({
        type: 'DATA_CLEARED',
        clientId: clientId
    });
}

/**
 * 广播消息给所有连接的标签页
 * @param {Object} message - 要广播的消息
 * @param {MessagePort} excludePort - 排除的端口（可选，通常是发送者）
 */
function broadcastToAll(message, excludePort = null) {
    ports.forEach(port => {
        if (port !== excludePort) {
            try {
                port.postMessage(message);
            } catch (error) {
                console.error('广播消息失败:', error);
            }
        }
    });
}

console.log('✅ SharedWorker 已初始化');
