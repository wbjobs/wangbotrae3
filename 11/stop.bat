@echo off
echo ========================================
echo   多端音轨同步校对系统 - 停止脚本
echo ========================================
echo.

echo 正在停止服务...
docker-compose down

echo.
echo 服务已停止
echo.
pause
