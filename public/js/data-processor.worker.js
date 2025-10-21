/**
 * 数据处理 Web Worker
 * 功能：处理大数据量的数据转换和预处理，不阻塞主线程
 */

// Worker 消息处理
self.onmessage = async function(e) {
    const { type, data } = e.data;

    try {
        switch (type) {
            case 'PROCESS_RECORDS':
                await processRecords(data.records, data.options);
                break;

            case 'BATCH_CONVERT':
                await batchConvert(data.records);
                break;

            default:
                self.postMessage({
                    type: 'ERROR',
                    error: `未知的消息类型: ${type}`
                });
        }
    } catch (error) {
        self.postMessage({
            type: 'ERROR',
            error: error.message,
            stack: error.stack
        });
    }
};

/**
 * 处理记录：标准化格式 + 添加时间戳
 */
async function processRecords(records, options = {}) {
    const perfStart = performance.now();

    self.postMessage({
        type: 'PROGRESS',
        message: '开始处理数据...',
        progress: 0,
        processedCount: 0
    });

    const processedRecords = [];
    const batchSize = 5000;
    let processedCount = 0;

    for (let i = 0; i < records.length; i++) {
        const record = records[i];

        // 标准化记录格式
        const standardRecord = {
            id: record.id || record.plan_id || `record_${i}`,
            plan_id: record.plan_id || record.id,
            start_time: record.start_time,
            task_result: record.task_result,
            task_type: record.task_type,
            customer: record.customer,
            satellite_name: record.satellite_name,
            station_name: record.station_name,
            station_id: record.station_id,
            created_at: record.created_at,
            updated_at: record.updated_at
        };

        // 添加时间戳（用于快速排序和查询）
        if (standardRecord.start_time) {
            standardRecord.timestamp = parseTimeToTimestamp(standardRecord.start_time);
        }

        processedRecords.push(standardRecord);
        processedCount++;

        // 每处理一批，发送进度更新
        if (processedCount % batchSize === 0) {
            const progress = Math.floor((i / records.length) * 100);
            self.postMessage({
                type: 'PROGRESS',
                message: `已处理 ${processedCount} 条记录...`,
                progress: progress,
                processedCount: processedCount
            });

            // 让出线程，避免长时间阻塞
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    // 按时间升序排序（默认启用，提升图表分组和查询性能）
    if (options.sort !== false) {
        self.postMessage({
            type: 'PROGRESS',
            message: '正在排序数据...',
            progress: 95
        });

        processedRecords.sort((a, b) => a.timestamp - b.timestamp);
        console.log(`✅ Worker: 数据已按时间排序 (${processedRecords.length} 条)`);
    }

    const processTime = performance.now() - perfStart;

    // 发送完成消息
    self.postMessage({
        type: 'COMPLETE',
        records: processedRecords,
        recordCount: processedRecords.length,
        processTime: processTime
    });
}

/**
 * 批量转换记录格式（轻量级处理）
 */
async function batchConvert(records) {
    const perfStart = performance.now();
    const converted = [];

    for (const record of records) {
        // 简单的格式转换
        converted.push({
            ...record,
            timestamp: parseTimeToTimestamp(record.start_time)
        });
    }

    const convertTime = performance.now() - perfStart;

    self.postMessage({
        type: 'COMPLETE',
        records: converted,
        recordCount: converted.length,
        convertTime: convertTime
    });
}

/**
 * 解析时间为时间戳（与主线程逻辑一致）
 */
function parseTimeToTimestamp(timeValue) {
    if (!timeValue) return 0;

    // 已经是时间戳
    if (typeof timeValue === 'number') {
        return timeValue > 1000000000000 ? timeValue : timeValue * 1000;
    }

    // 日期对象
    if (timeValue instanceof Date) {
        return timeValue.getTime();
    }

    // 字符串解析
    if (typeof timeValue === 'string') {
        // 清理时间字符串
        const cleanTimeStr = timeValue.replace(/[TZ]/g, ' ').replace(/[+-]\d{2}:\d{2}$/, '').trim();

        // 尝试解析 YYYY-MM-DD HH:mm:ss 格式
        const match = cleanTimeStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}):(\d{1,2}))?/);

        if (match) {
            const [, year, month, day, hour = 0, minute = 0, second = 0] = match;
            // 直接构造本地时间，不经过 UTC 转换
            const date = new Date(
                parseInt(year),
                parseInt(month) - 1,
                parseInt(day),
                parseInt(hour),
                parseInt(minute),
                parseInt(second)
            );
            return date.getTime();
        }

        // 回退：尝试直接解析
        const parsed = new Date(cleanTimeStr);
        return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
    }

    return 0;
}

// Worker 就绪消息
self.postMessage({
    type: 'READY',
    message: 'Data Processor Worker 已就绪'
});
