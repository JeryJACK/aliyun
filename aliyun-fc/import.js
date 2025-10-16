// 数据导入API - 阿里云函数计算版本
const { handleCors, handleError, sendSuccess, parseRequestBody, verifyAuth } = require('./lib/auth');
const { insertRecord, insertRecordsBatch, initDatabase } = require('./lib/db-mysql');
const XLSX = require('xlsx');

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
        method: (event.httpMethod || event.method || 'POST').toUpperCase(),
        headers: event.headers || {},
        query: event.queryParameters || event.queryStringParameters || {},
        body: event.body,
        isBase64Encoded: event.isBase64Encoded || false
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
        
        if (req.method !== 'POST') {
            res.status(405).json({ error: '只允许POST请求' });
            return {
                statusCode: res.statusCode,
                headers: res.headers,
                body: res.body
            };
        }

        // 验证认证
        if (!verifyAuth(req, res)) {
            return {
                statusCode: res.statusCode,
                headers: res.headers,
                body: res.body
            };
        }

        // 确保数据库已初始化
        await initDatabase();
        
        let data;
        let importType = 'json';
        
        // 处理不同的数据格式
        if (req.headers['content-type']?.includes('multipart/form-data')) {
            // 处理文件上传 (Excel)
            const body = req.isBase64Encoded ? Buffer.from(req.body, 'base64') : req.body;
            
            // 这里需要解析 multipart 数据，简化处理假设直接是 Excel 二进制数据
            const workbook = XLSX.read(body, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            data = XLSX.utils.sheet_to_json(worksheet);
            importType = 'excel';
        } else {
            // JSON 数据
            const body = req.body ? JSON.parse(req.body) : {};
            data = body.data || body;
        }
        
        if (!Array.isArray(data)) {
            data = [data];
        }
        
        if (data.length === 0) {
            res.status(400).json({ error: '没有要导入的数据' });
            return {
                statusCode: res.statusCode,
                headers: res.headers,
                body: res.body
            };
        }
        
        // 数据验证和转换
        const processedRecords = [];
        const errors = [];
        
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            
            try {
                // 数据字段映射和验证
                const record = {
                    plan_id: row.plan_id || row['计划ID'] || row['Plan ID'] || `auto_${Date.now()}_${i}`,
                    customer: row.customer || row['客户'] || row['Customer'] || '',
                    satellite_name: row.satellite_name || row['卫星名称'] || row['Satellite'] || '',
                    station_name: row.station_name || row['测站名称'] || row['Station'] || '',
                    station_id: row.station_id || row['测站ID'] || row['Station ID'] || '',
                    start_time: parseDateTime(row.start_time || row['开始时间'] || row['Start Time']),
                    task_type: row.task_type || row['任务类型'] || row['Task Type'] || '',
                    task_result: row.task_result || row['任务结果'] || row['Result'] || '',
                    raw_data: row
                };
                
                // 验证必需字段
                if (!record.plan_id || !record.customer || !record.satellite_name) {
                    errors.push(`第${i + 1}行: 缺少必需字段 (计划ID、客户、卫星名称)`);
                    continue;
                }
                
                processedRecords.push(record);
            } catch (error) {
                errors.push(`第${i + 1}行处理失败: ${error.message}`);
            }
        }
        
        if (processedRecords.length === 0) {
            res.status(400).json({ 
                error: '没有有效的数据可以导入',
                details: errors
            });
            return {
                statusCode: res.statusCode,
                headers: res.headers,
                body: res.body
            };
        }
        
        // 批量插入数据
        const result = await insertRecordsBatch(processedRecords);
        
        // 返回成功响应
        sendSuccess(res, {
            total_rows: data.length,
            processed_rows: processedRecords.length,
            affected_rows: result.affectedRows,
            errors: errors.length > 0 ? errors : undefined
        }, `成功导入 ${processedRecords.length} 条记录`);
        
        return {
            statusCode: res.statusCode,
            headers: res.headers,
            body: res.body
        };

    } catch (error) {
        console.error('数据导入失败:', error);
        handleError(res, error, '数据导入失败');
        return {
            statusCode: res.statusCode,
            headers: res.headers,
            body: res.body
        };
    }
};

/**
 * 解析日期时间
 */
function parseDateTime(dateStr) {
    if (!dateStr) return new Date();
    
    // 尝试不同的日期格式
    const formats = [
        // ISO 格式
        /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/,
        // 中文格式
        /^\d{4}年\d{1,2}月\d{1,2}日/,
        // 简单格式
        /^\d{4}-\d{1,2}-\d{1,2}/,
        /^\d{4}\/\d{1,2}\/\d{1,2}/
    ];
    
    const str = String(dateStr).trim();
    
    // 尝试直接解析
    let date = new Date(str);
    if (!isNaN(date.getTime())) {
        return date;
    }
    
    // 处理中文格式
    if (str.includes('年') && str.includes('月') && str.includes('日')) {
        const match = str.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
        if (match) {
            date = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
            if (!isNaN(date.getTime())) {
                return date;
            }
        }
    }
    
    // 如果无法解析，返回当前时间
    console.warn(`无法解析日期格式: ${dateStr}`);
    return new Date();
}