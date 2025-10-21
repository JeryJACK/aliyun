// 配置文件 - API端点配置
// 支持不同环境的API地址切换

const CONFIG = {
    // 阿里云函数计算 API 端点 - Web 函数独立 URL 模式
    API_BASE_URL: '',  // Web 函数模式下不使用基础 URL

    // 独立函数 URL 配置（阿里云 Web 函数）
    API_ENDPOINTS: {
        login: 'https://login-paixjucluh.cn-hangzhou.fcapp.run',
        stats: 'https://stats-paixwbwiuk.cn-hangzhou.fcapp.run',
        chartData: 'https://chart-data-tqmcgirdnn.cn-hangzhou.fcapp.run',
        records: 'https://records-bsjjdmpsel.cn-hangzhou.fcapp.run',
        import: 'https://import-rlctokgdul.cn-hangzhou.fcapp.run',
        export: 'https://stats-paixwbwiuk.cn-hangzhou.fcapp.run/export',
        clear: 'https://stats-paixwbwiuk.cn-hangzhou.fcapp.run/clear',

        // WebSocket 实时同步配置
        websocket: 'wss://ws.nxjyx.com.cn/ws',  // WebSocket SSL 服务器地址（使用域名，SSL 证书有效）
        catchup: 'https://ws.nxjyx.com.cn/api/satellite/changes'  // 断线补同步 API（已实现并测试通过）
    },
    
    // 请求配置
    REQUEST_TIMEOUT: 30000, // 30秒超时
    
    // 分页配置
    DEFAULT_PAGE_SIZE: 50,
    MAX_PAGE_SIZE: 100,
    
    // 缓存配置
    CACHE_DURATION: 5 * 60 * 1000, // 5分钟缓存
    
    // 错误重试配置
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000,
    
    // 环境检测
    isDevelopment: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
    isGitHubPages: window.location.hostname.includes('github.io')
};

// 根据环境自动配置API地址（本地开发时使用）
if (CONFIG.isDevelopment) {
    CONFIG.API_BASE_URL = 'http://localhost:3000/api';
}

// 构建完整的API URL - 支持独立 URL 模式
function getApiUrl(endpoint) {
    // 如果是本地开发环境
    if (CONFIG.isDevelopment && CONFIG.API_BASE_URL) {
        const endpointPath = typeof CONFIG.API_ENDPOINTS[endpoint] === 'string' && CONFIG.API_ENDPOINTS[endpoint].startsWith('http')
            ? CONFIG.API_ENDPOINTS[endpoint].split('/').pop()
            : CONFIG.API_ENDPOINTS[endpoint];
        return `${CONFIG.API_BASE_URL}/${endpointPath}`;
    }

    // Web 函数独立 URL 模式（生产环境）
    // 直接返回完整的函数 URL
    const url = CONFIG.API_ENDPOINTS[endpoint];
    if (url && url.startsWith('http')) {
        return url;
    }

    // 兼容旧格式
    return `${CONFIG.API_BASE_URL}${url || endpoint}`;
}

// 通用请求函数
async function apiRequest(endpoint, options = {}) {
    const url = getApiUrl(endpoint);
    const defaultOptions = {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
        timeout: CONFIG.REQUEST_TIMEOUT
    };
    
    // 添加认证token
    const token = localStorage.getItem('auth_token');
    if (token) {
        defaultOptions.headers['Authorization'] = `Bearer ${token}`;
    }
    
    const finalOptions = { ...defaultOptions, ...options };
    
    // 合并headers
    if (options.headers) {
        finalOptions.headers = { ...defaultOptions.headers, ...options.headers };
    }
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), finalOptions.timeout);
        
        const response = await fetch(url, {
            ...finalOptions,
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        return data;
    } catch (error) {
        console.error(`API请求失败 [${endpoint}]:`, error);
        throw error;
    }
}

// 带重试机制的请求函数
async function apiRequestWithRetry(endpoint, options = {}, retryCount = 0) {
    try {
        return await apiRequest(endpoint, options);
    } catch (error) {
        if (retryCount < CONFIG.MAX_RETRIES && !error.name === 'AbortError') {
            console.warn(`请求失败，${CONFIG.RETRY_DELAY}ms后重试 (${retryCount + 1}/${CONFIG.MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
            return apiRequestWithRetry(endpoint, options, retryCount + 1);
        }
        throw error;
    }
}

// 简化的API方法
const API = {
    // 用户认证
    login: (username, password) => apiRequest('login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
    }),
    
    // 获取统计数据
    getStats: (params = {}) => {
        const searchParams = new URLSearchParams(params);
        const endpoint = `stats?${searchParams.toString()}`;
        return apiRequestWithRetry(endpoint);
    },
    
    // 获取图表数据
    getChartData: (type, params = {}) => {
        const searchParams = new URLSearchParams({ type, ...params });
        const endpoint = `chartData?${searchParams.toString()}`;
        return apiRequestWithRetry(endpoint);
    },
    
    // 获取记录列表
    getRecords: (params = {}) => {
        const searchParams = new URLSearchParams(params);
        const endpoint = `records?${searchParams.toString()}`;
        return apiRequestWithRetry(endpoint);
    },
    
    // 导入数据
    importData: (data) => apiRequest('import', {
        method: 'POST',
        body: JSON.stringify({ data })
    }),
    
    // 导入Excel文件
    importExcel: (formData) => apiRequest('import', {
        method: 'POST',
        headers: {}, // 让浏览器自动设置Content-Type
        body: formData
    }),
    
    // 导出数据
    exportData: (params = {}) => {
        const searchParams = new URLSearchParams(params);
        const endpoint = `export?${searchParams.toString()}`;
        return apiRequest(endpoint);
    },
    
    // 清空数据
    clearData: () => apiRequest('clear', {
        method: 'POST'
    })
};

// 认证相关工具函数
const Auth = {
    // 保存token
    saveToken: (token) => {
        localStorage.setItem('auth_token', token);
    },
    
    // 获取token
    getToken: () => {
        return localStorage.getItem('auth_token');
    },
    
    // 移除token
    removeToken: () => {
        localStorage.removeItem('auth_token');
    },
    
    // 检查是否已登录
    isLoggedIn: () => {
        const token = Auth.getToken();
        if (!token) return false;
        
        try {
            // 简单检查token格式（实际应用中应该验证token有效性）
            const payload = JSON.parse(atob(token.split('.')[1]));
            const now = Math.floor(Date.now() / 1000);
            return payload.exp > now;
        } catch (error) {
            return false;
        }
    },
    
    // 登出
    logout: () => {
        Auth.removeToken();
        window.location.href = 'login.html';
    }
};

// 错误处理工具
const ErrorHandler = {
    // 显示错误消息
    showError: (message, details = null) => {
        console.error('错误:', message, details);
        
        // 创建错误提示元素
        const errorDiv = document.createElement('div');
        errorDiv.className = 'fixed top-4 right-4 bg-red-500 text-white px-4 py-2 rounded shadow-lg z-50';
        errorDiv.innerHTML = `
            <div class="flex items-center">
                <span class="mr-2">❌</span>
                <span>${message}</span>
                <button class="ml-4 text-white hover:text-gray-200" onclick="this.parentElement.parentElement.remove()">
                    ✕
                </button>
            </div>
        `;
        
        document.body.appendChild(errorDiv);
        
        // 5秒后自动移除
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 5000);
    },
    
    // 处理API错误
    handleApiError: (error) => {
        if (error.message?.includes('401')) {
            ErrorHandler.showError('认证已过期，请重新登录');
            Auth.logout();
        } else if (error.message?.includes('403')) {
            ErrorHandler.showError('没有权限执行此操作');
        } else if (error.message?.includes('404')) {
            ErrorHandler.showError('请求的资源不存在');
        } else if (error.message?.includes('500')) {
            ErrorHandler.showError('服务器内部错误，请稍后重试');
        } else if (error.name === 'AbortError') {
            ErrorHandler.showError('请求超时，请检查网络连接');
        } else {
            ErrorHandler.showError(error.message || '未知错误');
        }
    }
};

// 获取 WebSocket URL（根据页面协议自动选择 ws 或 wss）
function getWebSocketUrl() {
    let wsUrl = CONFIG.API_ENDPOINTS.websocket;

    // 本地开发环境
    if (CONFIG.isDevelopment) {
        // 如果是 HTTPS 页面，禁用 WebSocket（因为本地开发服务器通常不支持 WSS）
        if (window.location.protocol === 'https:') {
            console.warn('⚠️ HTTPS 页面无法连接到本地 WebSocket (ws://localhost)');
            console.warn('💡 WebSocket 实时同步已禁用');
            return null;
        }
        // HTTP 页面使用 ws://
        return 'ws://localhost:3000/ws';
    }

    // 如果页面是 HTTPS，但 WebSocket 服务器不支持 WSS，返回 null 禁用 WebSocket
    // 注意：HTTPS 页面无法连接到 WS（非安全）协议，只能连接 WSS（安全）协议
    if (window.location.protocol === 'https:' && wsUrl && wsUrl.startsWith('ws://')) {
        console.warn('⚠️ HTTPS 页面无法连接到非安全的 WebSocket (ws://)');
        console.warn('💡 WebSocket 实时同步已禁用，将使用轮询模式');
        return null; // 返回 null 禁用 WebSocket
    }

    // 生产环境使用配置的 WSS URL
    console.log('🔐 使用安全 WebSocket 连接 (WSS):', wsUrl);
    return wsUrl;
}

// 导出配置和API
window.CONFIG = CONFIG;
window.getApiUrl = getApiUrl;
window.getWebSocketUrl = getWebSocketUrl;
window.API = API;
window.Auth = Auth;
window.ErrorHandler = ErrorHandler;