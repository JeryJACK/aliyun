# PowerShell script to deploy all Aliyun FC functions
# UTF-8 encoding to avoid character issues

Set-Location -Path $PSScriptRoot
$ErrorActionPreference = "Continue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deploying All Aliyun Functions" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Current directory: $(Get-Location)" -ForegroundColor Yellow
Write-Host ""

# Check if s.yml exists
if (-Not (Test-Path "s.yml")) {
    Write-Host "Error: s.yml file not found!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Array of functions to deploy
$functions = @("login", "stats", "chart-data", "records", "import")
$successCount = 0
$failCount = 0

for ($i = 0; $i -lt $functions.Length; $i++) {
    $funcName = $functions[$i]
    $num = $i + 1

    Write-Host "[$num/5] Deploying $funcName function..." -ForegroundColor Yellow

    # Use -t parameter to explicitly specify the config file
    $output = & s deploy $funcName -t s.yml -y 2>&1

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Success: $funcName deployed successfully" -ForegroundColor Green
        $successCount++
    } else {
        Write-Host "  Error: $funcName deployment failed" -ForegroundColor Red
        Write-Host "  Output: $output" -ForegroundColor Red
        $failCount++
    }

    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deployment Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Success: $successCount / $($functions.Length)" -ForegroundColor Green
Write-Host "  Failed:  $failCount / $($functions.Length)" -ForegroundColor $(if ($failCount -gt 0) { "Red" } else { "Green" })
Write-Host ""

if ($failCount -eq 0) {
    Write-Host "All functions deployed successfully!" -ForegroundColor Green
} else {
    Write-Host "Some functions failed to deploy. Check logs above." -ForegroundColor Red
}

Write-Host ""
Read-Host "Press Enter to exit"
