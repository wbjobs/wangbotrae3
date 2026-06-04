@echo off
echo ========================================
echo 停止供应链碳排放分析系统
echo ========================================
echo.

echo 正在停止所有服务...
docker-compose down

echo.
echo 所有服务已停止。
pause
