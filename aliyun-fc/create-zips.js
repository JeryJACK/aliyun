const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

// 函数配置
const functions = [
    { name: 'login', mainFile: 'login.js' },
    { name: 'stats', mainFile: 'stats.js' },
    { name: 'chart-data', mainFile: 'chart-data.js' },
    { name: 'records', mainFile: 'records.js' },
    { name: 'import', mainFile: 'import.js' }
];

// 输出目录
const outputDir = path.join(__dirname, '..', 'fc-packages');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// 创建zip文件的函数
function createZip(funcConfig) {
    return new Promise((resolve, reject) => {
        const zipPath = path.join(outputDir, `${funcConfig.name}.zip`);
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', {
            zlib: { level: 9 } // 最大压缩
        });

        output.on('close', () => {
            console.log(`✓ ${funcConfig.name}.zip 创建成功 (${(archive.pointer() / 1024 / 1024).toFixed(2)} MB)`);
            resolve();
        });

        archive.on('error', (err) => {
            reject(err);
        });

        archive.pipe(output);

        // 添加主函数文件
        archive.file(funcConfig.mainFile, { name: funcConfig.mainFile });

        // 添加lib目录
        archive.directory('lib/', 'lib/');

        // 添加node_modules目录
        archive.directory('node_modules/', 'node_modules/');

        // 添加package.json
        archive.file('package.json', { name: 'package.json' });

        archive.finalize();
    });
}

// 主函数
async function main() {
    console.log('开始创建符合Unix标准的zip包...\n');

    for (const func of functions) {
        try {
            await createZip(func);
        } catch (error) {
            console.error(`✗ ${func.name}.zip 创建失败:`, error.message);
        }
    }

    console.log(`\n所有压缩包已创建到: ${outputDir}`);
    console.log('\n这些zip包使用正斜杠(/)作为路径分隔符，兼容Linux环境！');
}

main();
