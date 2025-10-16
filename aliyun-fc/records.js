// 记录查询API - 阿里云函数计算版本
const { handleCors, handleError, sendSuccess } = require('./lib/auth');
const { getRecords, initDatabase } = require('./lib/db-mysql');

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

    // 调试日志
    console.log('Raw Event Keys:', Object.keys(event));
    console.log('HTTP Method fields:', {
        httpMethod: event.httpMethod,
        method: event.method,
        requestContext: event.requestContext
    });

    // 提取 HTTP 方法 - 尝试多个可能的字段
    let httpMethod = 'GET'; // 默认值
    if (event.httpMethod) {
        httpMethod = event.httpMethod.toUpperCase();
    } else if (event.method) {
        httpMethod = event.method.toUpperCase();
    } else if (event.requestContext?.http?.method) {
        httpMethod = event.requestContext.http.method.toUpperCase();
    }

    console.log('Extracted HTTP Method:', httpMethod);

    // OPTIONS 请求由 s.yml 中的 CORS 配置自动处理，不需要在代码中处理

    const req = {
        method: httpMethod,
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
        const {
            page,
            limit,
            startDate,
            endDate,
            customer,
            satellite,
            station,
            status
        } = req.query;

        // 构建查询选项
        const options = {
            page: parseInt(page) || 1,
            limit: Math.min(parseInt(limit) || 50, 100) // 最大限制100条
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

        if (customer) options.customer = customer;
        if (satellite) options.satellite = satellite;
        if (station) options.station = station;
        if (status) options.status = status;

        // 获取记录数据
        const result = await getRecords(options);

        // 返回成功响应
        sendSuccess(res, result, '获取记录列表成功');

        // 确保返回时包含CORS头
        return {
            statusCode: res.statusCode,
            headers: res.headers,
            body: res.body
        };

    } catch (error) {
        console.error('获取记录列表失败:', error);
        handleError(res, error, '获取记录列表失败');

        // 确保错误响应也包含CORS头
        return {
            statusCode: res.statusCode,
            headers: res.headers,
            body: res.body
        };
    }
};