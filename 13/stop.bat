@echo off
echo ========================================
echo  混沌测试平台 - 停止脚本 (Windows)
echo ========================================
echo.

echo 正在停止所有服务...
docker-compose down
if %errorlevel% neq 0 (
    echo 警告: 停止过程中出现错误
) else (
    echo 所有服务已停止
)
echo.
pause
