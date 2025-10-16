const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 函数配置
const functions = [
    { name: 'login', file: 'login.js' },
    { name: 'stats', file: 'stats.js' },
    { name: 'chart-data', file: 'chart-data.js' },
    { name: 'records', file: 'records.js' },
    { name: 'import', file: 'import.js' }
];

// 输出目录
const outputDir = path.join(__dirname, '..', 'fc-packages');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

console.log('开始创建压缩包...\n');

functions.forEach(func => {
    const zipName = `${func.name}.zip`;
    const zipPath = path.join(outputDir, zipName);

    // 删除旧的zip
    if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
    }

    // 使用PowerShell但指定正确的路径格式
    // 方法：先切换到aliyun-fc目录，然后压缩相对路径
    const psCommand = `
        Set-Location '${__dirname}';
        $ProgressPreference = 'SilentlyContinue';
        Compress-Archive -Path '${func.file}','lib','node_modules','package.json' -DestinationPath '${zipPath}' -Force
    `.trim();

    console.log(`正在创建 ${zipName}...`);

    try {
        execSync(`powershell -Command "${psCommand}"`, {
            cwd: __dirname,
            stdio: 'inherit'
        });
        console.log(`✓ ${zipName} 创建成功\n`);
    } catch (error) {
        console.error(`✗ ${zipName} 创建失败:`, error.message);
    }
});

console.log('\n所有压缩包已创建到:', outputDir);
