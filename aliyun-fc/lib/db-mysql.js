// MySQL 数据库连接和操作工具
// 适配阿里云函数计算 + RDS MySQL

const mysql = require('mysql2/promise');

// 数据库连接配置
const dbConfig = {
    host: (process.env.MYSQL_HOST || '').trim(),
    port: parseInt((process.env.MYSQL_PORT || '3306').trim()) || 3306,
    user: (process.env.MYSQL_USER || '').trim(),
    password: (process.env.MYSQL_PASSWORD || '').trim(),
    database: (process.env.MYSQL_DATABASE || '').trim(),
    charset: 'utf8mb4',
    timezone: '+08:00' // 北京时间
};

// 连接池配置
let pool = null;

function createPool() {
    if (!pool) {
        // 调试：打印数据库配置（隐藏密码）
        console.log('Database Config:', {
            host: dbConfig.host,
            port: dbConfig.port,
            user: dbConfig.user,
            password: '***',
            database: dbConfig.database
        });

        pool = mysql.createPool({
            ...dbConfig,
            waitForConnections: true,
            connectionLimit: 5,
            queueLimit: 0,
            acquireTimeout: 10000,
            timeout: 10000
        });
    }
    return pool;
}

/**
 * 执行查询
 */
exports.query = async function(sql, params = []) {
    const connection = createPool();
    try {
        // 使用 query 而不是 execute,避免参数绑定问题
        const [results] = await connection.query(sql, params);
        return results;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
}

/**
 * 获取数据库连接（用于事务）
 */
exports.getConnection = async function() {
    const connection = createPool();
    return await connection.getConnection();
}

/**
 * 数据库初始化检查
 */
exports.initDatabase = async function() {
    try {
        // 检查用户表是否存在
        const tables = await exports.query("SHOW TABLES LIKE 'users'");
        if (tables.length === 0) {
            console.log('数据库表不存在，请先运行初始化脚本');
            return false;
        }
        console.log('数据库连接正常');
        return true;
    } catch (error) {
        console.error('数据库初始化检查失败:', error);
        return false;
    }
}

/**
 * 用户认证相关
 */
exports.getUserByUsername = async function(username) {
    const results = await exports.query(
        'SELECT id, username, password_hash, role FROM users WHERE username = ?',
        [username]
    );
    return results.length > 0 ? results[0] : null;
}

exports.createUser = async function(username, password_hash, role = 'admin') {
    const result = await exports.query(
        'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
        [username, password_hash, role]
    );
    return result;
}

/**
 * 获取统计数据
 */
exports.getStats = async function(options = {}) {
    let whereClause = '';
    const params = [];
    
    if (options.startDate || options.endDate) {
        const conditions = [];
        if (options.startDate) {
            conditions.push('start_time >= ?');
            params.push(options.startDate);
        }
        if (options.endDate) {
            conditions.push('start_time <= ?');
            params.push(options.endDate);
        }
        whereClause = 'WHERE ' + conditions.join(' AND ');
    }

    const sql = `
        SELECT 
            COUNT(DISTINCT plan_id) as total_plans,
            COUNT(*) as total_records,
            COUNT(CASE WHEN task_result IN ('因设备故障失败', '因操作失误失败', '未跟踪', '因卫星方原因失败', '任务成功数据处理失误') THEN 1 END) as total_failures,
            MIN(start_time) as earliest_time,
            MAX(start_time) as latest_time
        FROM satellite_records 
        ${whereClause}
    `;
    
    const results = await exports.query(sql, params);
    return results[0] || {
        total_plans: 0,
        total_records: 0,
        total_failures: 0,
        earliest_time: null,
        latest_time: null
    };
}

/**
 * 获取图表数据
 */
exports.getChartData = async function(type, options = {}) {
    const { startDate, endDate, limit = 50 } = options;
    let whereClause = '';
    const params = [];
    
    if (startDate || endDate) {
        const conditions = [];
        if (startDate) {
            conditions.push('start_time >= ?');
            params.push(startDate);
        }
        if (endDate) {
            conditions.push('start_time <= ?');
            params.push(endDate);
        }
        whereClause = 'WHERE ' + conditions.join(' AND ');
    }

    let sql = '';
    
    switch (type) {
        case 'daily':
            sql = `
                SELECT 
                    DATE(start_time) as date,
                    COUNT(DISTINCT plan_id) as plan_count,
                    COUNT(CASE WHEN task_result IN ('因设备故障失败', '因操作失误失败', '未跟踪', '因卫星方原因失败', '任务成功数据处理失误') THEN 1 END) as failure_count
                FROM satellite_records 
                ${whereClause}
                GROUP BY DATE(start_time)
                ORDER BY date DESC
                LIMIT ?
            `;
            params.push(limit);
            break;
            
        case 'customer':
            sql = `
                SELECT 
                    customer,
                    COUNT(DISTINCT plan_id) as plan_count,
                    COUNT(CASE WHEN task_result IN ('因设备故障失败', '因操作失误失败', '未跟踪', '因卫星方原因失败', '任务成功数据处理失误') THEN 1 END) as failure_count
                FROM satellite_records 
                ${whereClause}
                GROUP BY customer
                ORDER BY plan_count DESC
                LIMIT ?
            `;
            params.push(limit);
            break;
            
        case 'satellite':
            sql = `
                SELECT 
                    satellite_name,
                    COUNT(DISTINCT plan_id) as plan_count,
                    COUNT(CASE WHEN task_result IN ('因设备故障失败', '因操作失误失败', '未跟踪', '因卫星方原因失败', '任务成功数据处理失误') THEN 1 END) as failure_count
                FROM satellite_records 
                ${whereClause}
                GROUP BY satellite_name
                ORDER BY plan_count DESC
                LIMIT ?
            `;
            params.push(limit);
            break;
            
        case 'station':
            sql = `
                SELECT 
                    station_name,
                    COUNT(DISTINCT plan_id) as plan_count,
                    COUNT(CASE WHEN task_result IN ('因设备故障失败', '因操作失误失败', '未跟踪', '因卫星方原因失败', '任务成功数据处理失误') THEN 1 END) as failure_count
                FROM satellite_records 
                ${whereClause}
                GROUP BY station_name
                ORDER BY plan_count DESC
                LIMIT ?
            `;
            params.push(limit);
            break;
            
        default:
            throw new Error(`不支持的图表类型: ${type}`);
    }

    const results = await exports.query(sql, params);
    return results;
}

/**
 * 获取记录列表
 */
exports.getRecords = async function(options = {}) {
    const { 
        page = 1, 
        limit = 50, 
        startDate, 
        endDate, 
        customer, 
        satellite, 
        station, 
        status 
    } = options;
    
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    
    if (startDate) {
        conditions.push('start_time >= ?');
        params.push(startDate);
    }
    if (endDate) {
        conditions.push('start_time <= ?');
        params.push(endDate);
    }
    if (customer) {
        conditions.push('customer LIKE ?');
        params.push(`%${customer}%`);
    }
    if (satellite) {
        conditions.push('satellite_name LIKE ?');
        params.push(`%${satellite}%`);
    }
    if (station) {
        conditions.push('station_name LIKE ?');
        params.push(`%${station}%`);
    }
    if (status) {
        conditions.push('task_result = ?');
        params.push(status);
    }
    
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    
    // 获取总数
    const countSql = `SELECT COUNT(*) as total FROM satellite_records ${whereClause}`;
    const countResult = await exports.query(countSql, params);
    const total = countResult[0].total;
    
    // 获取记录 - 使用 LIMIT offset, count 语法
    const sql = `SELECT plan_id, customer, satellite_name, station_name, station_id, start_time, task_type, task_result, created_at FROM satellite_records ${whereClause} ORDER BY start_time DESC LIMIT ?, ?`;

    // MySQL LIMIT 语法: LIMIT offset, row_count
    const recordParams = [...params, parseInt(offset), parseInt(limit)];

    console.log('Query params:', { limit: parseInt(limit), offset: parseInt(offset), recordParams, sql });

    const records = await exports.query(sql, recordParams);

    return {
        records,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
    };
}

/**
 * 插入单条记录
 */
exports.insertRecord = async function(record) {
    const sql = `
        INSERT INTO satellite_records 
        (plan_id, customer, satellite_name, station_name, station_id, start_time, task_type, task_result, raw_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        customer = VALUES(customer),
        satellite_name = VALUES(satellite_name),
        station_name = VALUES(station_name),
        station_id = VALUES(station_id),
        start_time = VALUES(start_time),
        task_type = VALUES(task_type),
        task_result = VALUES(task_result),
        raw_data = VALUES(raw_data),
        updated_at = CURRENT_TIMESTAMP
    `;

    const result = await exports.query(sql, [
        record.plan_id,
        record.customer,
        record.satellite_name,
        record.station_name,
        record.station_id,
        record.start_time,
        record.task_type,
        record.task_result,
        JSON.stringify(record.raw_data)
    ]);
    
    return result;
}

/**
 * 批量插入记录
 */
exports.insertRecordsBatch = async function(records) {
    if (!records || records.length === 0) {
        return { affectedRows: 0 };
    }

    const connection = await exports.getConnection();
    try {
        await connection.beginTransaction();
        
        const sql = `
            INSERT INTO satellite_records 
            (plan_id, customer, satellite_name, station_name, station_id, start_time, task_type, task_result, raw_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
            customer = VALUES(customer),
            satellite_name = VALUES(satellite_name),
            station_name = VALUES(station_name),
            station_id = VALUES(station_id),
            start_time = VALUES(start_time),
            task_type = VALUES(task_type),
            task_result = VALUES(task_result),
            raw_data = VALUES(raw_data),
            updated_at = CURRENT_TIMESTAMP
        `;
        
        let totalAffectedRows = 0;
        for (const record of records) {
            const [result] = await connection.execute(sql, [
                record.plan_id,
                record.customer,
                record.satellite_name,
                record.station_name,
                record.station_id,
                record.start_time,
                record.task_type,
                record.task_result,
                JSON.stringify(record.raw_data)
            ]);
            totalAffectedRows += result.affectedRows;
        }
        
        await connection.commit();
        return { affectedRows: totalAffectedRows };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * 清空所有记录
 */
exports.clearAllRecords = async function() {
    const result = await exports.query('DELETE FROM satellite_records');
    return result;
}

/**
 * 导出数据
 */
exports.exportData = async function(options = {}) {
    const { startDate, endDate, format = 'json' } = options;
    
    const conditions = [];
    const params = [];
    
    if (startDate) {
        conditions.push('start_time >= ?');
        params.push(startDate);
    }
    if (endDate) {
        conditions.push('start_time <= ?');
        params.push(endDate);
    }
    
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    
    const sql = `
        SELECT plan_id, customer, satellite_name, station_name, station_id, 
               start_time, task_type, task_result
        FROM satellite_records 
        ${whereClause}
        ORDER BY start_time DESC
    `;

    const records = await exports.query(sql, params);
    return records;
}