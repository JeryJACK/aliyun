// 图表数据API - 阿里云函数计算版本
const { handleCors, handleError, sendSuccess } = require('./lib/auth');
const { getChartData, initDatabase } = require('./lib/db-mysql');

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
        end: function() {}
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
        const { type, startDate, endDate, limit } = req.query;
        
        if (!type) {
            res.status(400).json({ error: '缺少图表类型参数' });
            return {
                statusCode: res.statusCode,
                headers: res.headers,
                body: res.body
            };
        }
        
        // 构建查询选项
        const options = {
            limit: parseInt(limit) || 50
        };
        
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

        // 获取图表数据
        const chartData = await getChartData(type, options);
        
        // 返回成功响应
        sendSuccess(res, chartData, '获取图表数据成功');
        
        return {
            statusCode: res.statusCode,
            headers: res.headers,
            body: res.body
        };

    } catch (error) {
        console.error('获取图表数据失败:', error);
        handleError(res, error, '获取图表数据失败');
        return {
            statusCode: res.statusCode,
            headers: res.headers,
            body: res.body
        };
    }
};