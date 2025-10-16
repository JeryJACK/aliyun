# Deploy records function to Aliyun FC
Set-Location -Path $PSScriptRoot
Write-Host "Current directory: $(Get-Location)" -ForegroundColor Cyan
Write-Host "Deploying records function..." -ForegroundColor Yellow

s deploy records -y

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nRecords function deployed successfully!" -ForegroundColor Green
} else {
    Write-Host "`nDeployment failed with exit code: $LASTEXITCODE" -ForegroundColor Red
}

Read-Host "`nPress Enter to exit"
