// 认证和工具函数
// 适配阿里云函数计算环境

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * 处理 CORS - 为所有响应添加 CORS 头
 */
exports.handleCors = function(req, res) {
    // 设置 CORS 头 - 允许所有来源
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24小时

    // 处理预检请求(OPTIONS)
    if (req.method === 'OPTIONS') {
        res.status(200);
        res.body = '';
        return true; // 返回true表示这是预检请求,直接返回
    }

    return false; // 返回false表示继续处理正常请求
}

/**
 * 生成 JWT Token
 */
exports.generateToken = function(user) {
    return jwt.sign(
        { 
            userId: user.id, 
            username: user.username, 
            role: user.role 
        },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
}

/**
 * 验证 JWT Token
 */
exports.verifyToken = function(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
}

/**
 * 验证请求认证
 */
exports.verifyAuth = function(req, res) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
        res.status(401).json({ error: '缺少认证令牌' });
        return false;
    }
    
    const token = authHeader.split(' ')[1]; // Bearer token
    if (!token) {
        res.status(401).json({ error: '无效的认证令牌格式' });
        return false;
    }
    
    const decoded = verifyToken(token);
    if (!decoded) {
        res.status(401).json({ error: '认证令牌无效或已过期' });
        return false;
    }
    
    // 将用户信息添加到请求对象
    req.user = decoded;
    return true;
}

/**
 * 密码哈希
 */
exports.hashPassword = async function(password) {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
}

/**
 * 验证密码
 */
exports.verifyPassword = async function(password, hash) {
    return await bcrypt.compare(password, hash);
}

/**
 * 发送成功响应
 */
exports.sendSuccess = function(res, data, message = '操作成功') {
    res.status(200).json({
        success: true,
        message,
        data
    });
}

/**
 * 处理错误响应
 */
exports.handleError = function(res, error, message = '服务器内部错误') {
    console.error('Error:', error);
    
    // 根据错误类型返回不同的状态码
    let statusCode = 500;
    let errorMessage = message;
    
    if (error.message) {
        if (error.message.includes('duplicate') || error.message.includes('UNIQUE')) {
            statusCode = 409;
            errorMessage = '数据已存在';
        } else if (error.message.includes('not found') || error.message.includes('不存在')) {
            statusCode = 404;
            errorMessage = '数据不存在';
        } else if (error.message.includes('invalid') || error.message.includes('无效')) {
            statusCode = 400;
            errorMessage = '请求参数无效';
        }
    }
    
    res.status(statusCode).json({
        success: false,
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}

/**
 * 解析请求体（支持 JSON 和 form-data）
 */
exports.parseRequestBody = async function(req) {
    return new Promise((resolve, reject) => {
        if (req.method === 'GET') {
            resolve({});
            return;
        }
        
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                if (body) {
                    const contentType = req.headers['content-type'] || '';
                    if (contentType.includes('application/json')) {
                        resolve(JSON.parse(body));
                    } else {
                        // 处理其他格式
                        resolve({ raw: body });
                    }
                } else {
                    resolve({});
                }
            } catch (error) {
                reject(error);
            }
        });
        
        req.on('error', reject);
    });
}

/**
 * 验证必需字段
 */
exports.validateRequiredFields = function(data, requiredFields) {
    const missing = [];
    
    for (const field of requiredFields) {
        if (!data[field] || (typeof data[field] === 'string' && data[field].trim() === '')) {
            missing.push(field);
        }
    }
    
    if (missing.length > 0) {
        throw new Error(`缺少必需字段: ${missing.join(', ')}`);
    }
    
    return true;
}

/**
 * 格式化日期
 */
exports.formatDate = function(date) {
    if (!date) return null;
    
    if (typeof date === 'string') {
        date = new Date(date);
    }
    
    if (isNaN(date.getTime())) {
        return null;
    }
    
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * 分页参数验证
 */
exports.validatePagination = function(query) {
    const page = parseInt(query.page) || 1;
    const limit = Math.min(parseInt(query.limit) || 50, 100); // 最大限制100条
    
    return {
        page: Math.max(page, 1),
        limit: Math.max(limit, 1)
    };
}

/**
 * 清理敏感信息
 */
exports.sanitizeUser = function(user) {
    if (!user) return null;
    
    const { password_hash, ...sanitized } = user;
    return sanitized;
}