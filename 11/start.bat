@echo off
echo ========================================
echo   多端音轨同步校对系统 - 启动脚本
echo ========================================
echo.

echo [1/3] 检查Docker是否运行...
docker ps >nul 2>&1
if %errorlevel% neq 0 (
    echo Docker未运行，请先启动Docker Desktop
    pause
    exit /b 1
)
echo Docker运行正常
echo.

echo [2/3] 启动服务...
docker-compose up -d
if %errorlevel% neq 0 (
    echo 服务启动失败
    pause
    exit /b 1
)
echo.

echo [3/3] 等待服务就绪...
timeout /t 10 /nobreak >nul
echo.

echo ========================================
echo   服务启动完成！
echo ========================================
echo.
echo 前端地址: http://localhost:5173
echo 后端API:  http://localhost:3000
echo 数据库:   localhost:5432
echo.
echo 查看日志: docker-compose logs -f
echo 停止服务: docker-compose down
echo.
pause
