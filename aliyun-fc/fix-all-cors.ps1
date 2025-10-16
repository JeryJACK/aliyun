# 批量移除所有函数中的代码层 CORS 头
# 保留 s.yml 中的 CORS 配置

$files = @("chart-data.js", "login.js", "import.js")

foreach ($file in $files) {
    Write-Host "处理 $file..." -ForegroundColor Yellow

    $content = Get-Content $file -Raw

    # 移除 res.headers 中的 CORS 头
    $content = $content -replace "(?s)'Content-Type': 'application/json',\s*'Access-Control-Allow-Origin': '\*',\s*'Access-Control-Allow-Methods': '.*?',\s*'Access-Control-Allow-Headers': '.*?',\s*'Access-Control-Max-Age': '\d+'", "'Content-Type': 'application/json'"

    # 移除 OPTIONS 处理块
    $content = $content -replace "(?s)// 立即处理 OPTIONS 预检请求.*?}\s*}", "// CORS 由 s.yml 配置自动处理"

    # 移除 handleCors 调用
    $content = $content -replace "// 处理CORS - 为所有其他响应添加CORS头\s*handleCors\(req, res\);\s*", "// CORS 由 s.yml 配置自动处理`n        "

    Set-Content $file $content -NoNewline
    Write-Host "  ✓ $file 已更新" -ForegroundColor Green
}

Write-Host "`n所有文件已更新！" -ForegroundColor Green
Write-Host "现在需要重新部署所有函数。" -ForegroundColor Yellow
