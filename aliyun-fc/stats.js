// 统计数据API - 阿里云函数计算版本
const { handleCors, handleError, sendSuccess } = require('./lib/auth');
const { getStats, initDatabase } = require('./lib/db-mysql');

// 阿里云函数计算入口函数
exports.handler = async (event, context) => {
    // 如果event是Buffer，先转换为JSON对象
    if (Buffer.isBuffer(event)) {
        try {
            event = JSON.parse(event.toString('utf-8'));
        } catch (e) {
            console.error('Failed to parse Buffer event:', e);
        }
    }

    // 模拟 Express 的 req/res 对象
    const req = {
        method: (event.httpMethod || event.method || 'GET').toUpperCase(),
        headers: event.headers || {},
        query: event.queryParameters || event.queryStringParameters || {}
    };

    const res = {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json'
        },
        body: '',
        status: function(code) {
            this.statusCode = code;
            return this;
        },
        setHeader: function(name, value) {
            this.headers[name] = value;
        },
        json: function(data) {
            this.body = JSON.stringify(data);
        },
        end: function() {
            // 函数计算环境下不需要显式结束响应
        }
    };

    try {
        // CORS 由 s.yml 配置自动处理
        
        if (req.method !== 'GET') {
            res.status(405).json({ error: '只允许GET请求' });
            return {
                statusCode: res.statusCode,
                headers: res.headers,
                body: res.body
            };
        }

        // 确保数据库已初始化
        await initDatabase();
        
        // 解析查询参数
        const { startDate, endDate } = req.query;

        // 构建查询选项
        const options = {};
        
        if (startDate) {
            const parsedStartDate = new Date(startDate);
            if (!isNaN(parsedStartDate.getTime())) {
                options.startDate = parsedStartDate;
            }
        }
        
        if (endDate) {
            const parsedEndDate = new Date(endDate);
            if (!isNaN(parsedEndDate.getTime())) {
                options.endDate = parsedEndDate;
            }
        }

        // 获取统计数据
        const stats = await getStats(options);
        
        // 处理统计数据
        const processedStats = {
            total_records: parseInt(stats.total_records) || 0,
            total_plans: parseInt(stats.total_plans) || 0,
            total_failures: parseInt(stats.total_failures) || 0,
            earliest_time: stats.earliest_time,
            latest_time: stats.latest_time,
            // 计算成功率
            success_rate: stats.total_records > 0 
                ? ((stats.total_records - stats.total_failures) / stats.total_records * 100).toFixed(2)
                : 0
        };

        // 返回成功响应
        sendSuccess(res, processedStats, '获取统计数据成功');
        
        return {
            statusCode: res.statusCode,
            headers: res.headers,
            body: res.body
        };

    } catch (error) {
        console.error('获取统计数据失败:', error);
        handleError(res, error, '获取统计数据失败');
        return {
            statusCode: res.statusCode,
            headers: res.headers,
            body: res.body
        };
    }
};