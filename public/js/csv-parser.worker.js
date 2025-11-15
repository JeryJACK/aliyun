/**
 * CSV 解析 Web Worker
 * 功能：在后台线程解析 CSV 数据，不阻塞主线程
 */

// Worker 消息处理
self.onmessage = async function(e) {
    const { type, data } = e.data;

    try {
        switch (type) {
            case 'PARSE_CSV':
                await parseCSV(data);
                break;

            case 'PARSE_CSV_GZIP':
                await parseCSVGzip(data);
                break;

            default:
                self.postMessage({
                    type: 'ERROR',
                    error: `未知的消息类型: ${type}`
                });
        }
    } catch (error) {
        self.postMessage({
            type: 'ERROR',
            error: error.message,
            stack: error.stack
        });
    }
};

/**
 * 解析普通 CSV 数据
 */
async function parseCSV(csvString) {
    const perfStart = performance.now();

    // 发送进度消息
    self.postMessage({
        type: 'PROGRESS',
        message: '开始解析 CSV 数据...',
        progress: 0
    });

    // 分割为行
    const lines = csvString.split('\n').filter(line => line.trim());

    if (lines.length === 0) {
        self.postMessage({
            type: 'COMPLETE',
            records: [],
            parseTime: performance.now() - perfStart
        });
        return;
    }

    // 第一行是表头
    const headers = parseCSVLine(lines[0]);
    const records = [];

    // 分批处理，避免阻塞太久
    const batchSize = 5000;
    let processedCount = 0;
    let errorCount = 0; // 跟踪解析错误数量
    const totalLines = lines.length - 1; // 减去表头行

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        try {
            const values = parseCSVLine(line);
            const record = {};

            // 将值映射到对应的表头
            headers.forEach((header, index) => {
                record[header] = values[index] || '';
            });

            records.push(record);
            processedCount++;

            // 每处理一批，发送进度更新
            if (processedCount % batchSize === 0) {
                const progress = Math.floor((i / lines.length) * 100);
                self.postMessage({
                    type: 'PROGRESS',
                    message: `已解析 ${processedCount} 条记录...`,
                    progress: progress,
                    errorCount: errorCount
                });

                // 让出线程，避免长时间阻塞
                await new Promise(resolve => setTimeout(resolve, 0));
            }

        } catch (error) {
            errorCount++;
            console.warn(`解析第 ${i + 1} 行失败:`, error.message);

            // 如果错误率超过 10%，立即停止并报告
            if (errorCount > totalLines * 0.1) {
                const errorRate = ((errorCount / (i - 1)) * 100).toFixed(2);
                self.postMessage({
                    type: 'ERROR',
                    error: `CSV 解析错误率过高 (${errorRate}%)，已停止解析`,
                    errorCount: errorCount,
                    processedLines: i - 1,
                    errorRate: parseFloat(errorRate)
                });
                return;
            }
        }
    }

    const parseTime = performance.now() - perfStart;
    const errorRate = totalLines > 0 ? ((errorCount / totalLines) * 100).toFixed(2) : 0;

    console.log(`✅ CSV 解析完成: 成功 ${records.length} 条, 失败 ${errorCount} 条, 错误率: ${errorRate}%`);

    // 发送完成消息
    self.postMessage({
        type: 'COMPLETE',
        records: records,
        recordCount: records.length,
        parseTime: parseTime,
        errorCount: errorCount,
        totalLines: totalLines,
        errorRate: parseFloat(errorRate)
    });
}

/**
 * 解析 Gzip 压缩的 CSV 数据
 */
async function parseCSVGzip(compressedData) {
    const perfStart = performance.now();

    self.postMessage({
        type: 'PROGRESS',
        message: '解压 Gzip 数据...',
        progress: 0
    });

    try {
        // 浏览器原生支持 DecompressionStream (Chrome 80+)
        if (typeof DecompressionStream !== 'undefined') {
            // 将 Base64 转换为 ArrayBuffer
            const binaryString = atob(compressedData);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // 使用 DecompressionStream 解压
            const stream = new Blob([bytes]).stream();
            const decompressedStream = stream.pipeThrough(
                new DecompressionStream('gzip')
            );

            // 读取解压后的数据
            const reader = decompressedStream.getReader();
            const chunks = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }

            // 合并所有块
            const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            const result = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                result.set(chunk, offset);
                offset += chunk.length;
            }

            // 转换为字符串
            const csvString = new TextDecoder('utf-8').decode(result);
            const decompressTime = performance.now() - perfStart;

            self.postMessage({
                type: 'PROGRESS',
                message: `解压完成 (${decompressTime.toFixed(0)}ms)，开始解析...`,
                progress: 50
            });

            // 解析 CSV
            await parseCSV(csvString);

        } else {
            // 浏览器不支持 DecompressionStream，回退到普通解析
            self.postMessage({
                type: 'ERROR',
                error: '浏览器不支持 DecompressionStream，请使用现代浏览器'
            });
        }

    } catch (error) {
        self.postMessage({
            type: 'ERROR',
            error: `解压失败: ${error.message}`
        });
    }
}

/**
 * 解析 CSV 行（支持引号转义）
 */
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                // 转义的引号 ""
                current += '"';
                i++; // 跳过下一个引号
            } else {
                // 切换引号状态
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            // 字段分隔符
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    // 添加最后一个字段
    result.push(current.trim());

    return result;
}

// Worker 就绪消息
self.postMessage({
    type: 'READY',
    message: 'CSV Parser Worker 已就绪'
});
