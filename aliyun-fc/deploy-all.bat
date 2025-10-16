@echo off
chdir /d "%~dp0"

echo ========================================
echo 部署所有阿里云函数
echo ========================================
echo.

echo [1/5] 部署 login 函数...
call s deploy login
if errorlevel 1 (
    echo 错误: login 函数部署失败
    pause
    exit /b 1
)
echo.

echo [2/5] 部署 stats 函数...
call s deploy stats
if errorlevel 1 (
    echo 错误: stats 函数部署失败
    pause
    exit /b 1
)
echo.

echo [3/5] 部署 chart-data 函数...
call s deploy chart-data
if errorlevel 1 (
    echo 错误: chart-data 函数部署失败
    pause
    exit /b 1
)
echo.

echo [4/5] 部署 records 函数...
call s deploy records
if errorlevel 1 (
    echo 错误: records 函数部署失败
    pause
    exit /b 1
)
echo.

echo [5/5] 部署 import 函数...
call s deploy import
if errorlevel 1 (
    echo 错误: import 函数部署失败
    pause
    exit /b 1
)
echo.

echo ========================================
echo 所有函数部署完成！
echo ========================================
echo.
pause
