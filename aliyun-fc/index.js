// HTTP 服务器入口 - 用于 Web 函数模式
import express from 'express';
import { handler as loginHandler } from './login.js';
import { handler as statsHandler } from './stats.js';
import { handler as chartDataHandler } from './chart-data.js';
import { handler as recordsHandler } from './records.js';
import { handler as importHandler } from './import.js';

const app = express();
const PORT = process.env.PORT || 9000;

// 解析 JSON 请求体
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 包装函数处理器为 Express 中间件
function wrapHandler(handler) {
    return async (req, res) => {
        // 构造 FC event 对象
        const event = {
            httpMethod: req.method,
            method: req.method,
            headers: req.headers,
            queryParameters: req.query,
            body: JSON.stringify(req.body),
            path: req.path,
            requestURI: req.originalUrl
        };

        // 构造 FC context 对象
        const context = {
            requestId: req.get('x-fc-request-id') || 'local-' + Date.now(),
            function: {
                name: process.env.FC_FUNCTION_NAME || 'local',
                handler: process.env.FC_FUNCTION_HANDLER || 'index.handler',
                memory: parseInt(process.env.FC_FUNCTION_MEMORY_SIZE || '512'),
                timeout: parseInt(process.env.FC_FUNCTION_TIMEOUT || '60')
            },
            service: {
                name: process.env.FC_SERVICE_NAME || 'local',
                logProject: process.env.FC_SERVICE_LOG_PROJECT || '',
                logStore: process.env.FC_SERVICE_LOG_STORE || ''
            },
            region: process.env.FC_REGION || 'cn-hangzhou',
            accountId: process.env.FC_ACCOUNT_ID || ''
        };

        try {
            // 调用函数处理器
            const result = await handler(event, context);

            // 返回响应
            res.status(result.statusCode || 200);

            // 设置响应头
            if (result.headers) {
                Object.keys(result.headers).forEach(key => {
                    res.setHeader(key, result.headers[key]);
                });
            }

            // 返回响应体
            if (result.body) {
                if (result.headers && result.headers['Content-Type'] === 'application/json') {
                    res.send(result.body);
                } else {
                    res.send(result.body);
                }
            } else {
                res.end();
            }
        } catch (error) {
            console.error('Handler error:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: error.message
            });
        }
    };
}

// 健康检查
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 路由映射
app.post('/login', wrapHandler(loginHandler));
app.options('/login', wrapHandler(loginHandler));

app.get('/stats', wrapHandler(statsHandler));
app.options('/stats', wrapHandler(statsHandler));

app.get('/chart-data', wrapHandler(chartDataHandler));
app.options('/chart-data', wrapHandler(chartDataHandler));

app.get('/records', wrapHandler(recordsHandler));
app.options('/records', wrapHandler(recordsHandler));

app.post('/import', wrapHandler(importHandler));
app.options('/import', wrapHandler(importHandler));

// 404 处理
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        path: req.path
    });
});

// 错误处理
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        message: err.message
    });
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Health check: http://0.0.0.0:${PORT}/health`);
});
