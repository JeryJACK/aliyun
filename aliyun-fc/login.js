// 用户登录API - 阿里云函数计算版本
const { handleCors, handleError, sendSuccess, parseRequestBody, validateRequiredFields, generateToken, verifyPassword } = require('./lib/auth');
const { getUserByUsername, initDatabase } = require('./lib/db-mysql');

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

    // 打印event用于调试
    console.log('Parsed Event:', JSON.stringify(event, null, 2));

    // 模拟 Express 的 req/res 对象
    const req = {
        method: (event.httpMethod || event.method || event.requestContext?.http?.method || 'GET').toUpperCase(),
        headers: event.headers || {},
        query: event.queryParameters || event.queryStringParameters || {},
        body: event.body
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
        
        if (req.method === 'GET') {
            res.status(200).json({
                message: '登录API正常运行',
                usage: 'POST /login with JSON body { username, password }',
                version: '1.0.0'
            });
            return {
                statusCode: res.statusCode,
                headers: res.headers,
                body: res.body
            };
        }

        if (req.method !== 'POST') {
            res.status(405).json({ error: '只允许POST请求' });
            return {
                statusCode: res.statusCode,
                headers: res.headers,
                body: res.body
            };
        }

        // 确保数据库已初始化
        await initDatabase();
        
        // 解析请求体
        const body = req.body ? JSON.parse(req.body) : {};
        
        // 验证必需字段
        validateRequiredFields(body, ['username', 'password']);
        
        const { username, password } = body;
        
        // 查找用户
        const user = await getUserByUsername(username);
        if (!user) {
            res.status(401).json({ error: '用户名或密码错误' });
            return {
                statusCode: res.statusCode,
                headers: res.headers,
                body: res.body
            };
        }
        
        // 验证密码
        const isValidPassword = await verifyPassword(password, user.password_hash);
        if (!isValidPassword) {
            res.status(401).json({ error: '用户名或密码错误' });
            return {
                statusCode: res.statusCode,
                headers: res.headers,
                body: res.body
            };
        }
        
        // 生成令牌
        const token = generateToken(user);
        
        // 返回成功响应
        sendSuccess(res, {
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role
            }
        }, '登录成功');
        
        return {
            statusCode: res.statusCode,
            headers: res.headers,
            body: res.body
        };

    } catch (error) {
        console.error('登录失败:', error);
        handleError(res, error, '登录失败');
        return {
            statusCode: res.statusCode,
            headers: res.headers,
            body: res.body
        };
    }
};