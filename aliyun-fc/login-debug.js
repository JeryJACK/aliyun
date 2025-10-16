// 调试版本 - 检查文件结构
const fs = require('fs');
const path = require('path');

exports.handler = async (event, context) => {
    try {
        // 列出 /code 目录的内容
        const codeDir = '/code';
        const files = fs.readdirSync(codeDir);

        const fileList = files.map(file => {
            const fullPath = path.join(codeDir, file);
            const stats = fs.statSync(fullPath);
            return {
                name: file,
                type: stats.isDirectory() ? 'directory' : 'file',
                size: stats.size
            };
        });

        // 如果有 lib 目录,列出其内容
        let libFiles = [];
        if (files.includes('lib')) {
            const libDir = path.join(codeDir, 'lib');
            libFiles = fs.readdirSync(libDir);
        }

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: true,
                codeDirectory: codeDir,
                files: fileList,
                libFiles: libFiles,
                currentFile: __filename,
                currentDir: __dirname
            }, null, 2)
        };
    } catch (error) {
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: false,
                error: error.message,
                stack: error.stack
            }, null, 2)
        };
    }
};
