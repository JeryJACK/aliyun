// 认证工具模块
// 支持 Vercel + Postgres 的认证功能

import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * 生成JWT令牌
 */
function generateToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { 
        expiresIn: '24h',
        issuer: 'satellite-data-system'
    });
}

/**
 * 验证JWT令牌
 */
function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        throw new Error('无效的访问令牌');
    }
}

/**
 * 从请求中提取token
 */
function extractToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return null;
    }
    
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }
    
    return authHeader;
}

/**
 * 中间件：验证用户身份
 */
function verifyAuth(req, res, next) {
    try {
        const token = extractToken(req);
        
        if (!token) {
            return res.status(401).json({ error: '需要提供访问令牌' });
        }
        
        const decoded = verifyToken(token);
        req.user = decoded;
        
        if (next) {
            next();
        }
        
        return true;
    } catch (error) {
        console.error('Token verification failed:', error);
        return res.status(401).json({ error: '无效的访问令牌' });
    }
}

/**
 * 密码加密（使用bcrypt）
 */
async function hashPassword(password) {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
}

/**
 * 密码验证
 */
async function verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash);
}

/**
 * CORS 头设置
 */
function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * 处理预检请求
 */
function handleCors(req, res) {
    setCorsHeaders(res);
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return true;
    }
    
    return false;
}

/**
 * 统一错误处理
 */
function handleError(res, error, defaultMessage = '服务器内部错误') {
    console.error('API Error:', error);
    
    const statusCode = error.statusCode || 500;
    const message = error.message || defaultMessage;
    
    res.status(statusCode).json({ 
        error: message,
        timestamp: new Date().toISOString()
    });
}

/**
 * 统一成功响应
 */
function sendSuccess(res, data = null, message = 'Success') {
    const response = {
        success: true,
        message,
        timestamp: new Date().toISOString()
    };
    
    if (data !== null) {
        response.data = data;
    }
    
    res.status(200).json(response);
}

export {
    generateToken,
    verifyToken,
    extractToken,
    verifyAuth,
    hashPassword,
    verifyPassword,
    setCorsHeaders,
    handleCors,
    handleError,
    sendSuccess
};