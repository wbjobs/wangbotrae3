@echo off
echo ========================================
echo  混沌测试平台 - 启动脚本 (Windows)
echo ========================================
echo.

echo [1/3] 检查Docker是否运行...
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误: 未检测到Docker，请先安装并启动Docker Desktop
    pause
    exit /b 1
)
echo Docker已就绪
echo.

echo [2/3] 启动服务...
docker-compose up -d --build
if %errorlevel% neq 0 (
    echo 错误: 服务启动失败
    pause
    exit /b 1
)
echo.

echo [3/3] 等待服务就绪...
timeout /t 15 /nobreak >nul
echo.

echo ========================================
echo  服务启动完成！
echo ========================================
echo.
echo 前端地址: http://localhost:3000
echo 后端API: http://localhost:8000
echo API文档: http://localhost:8000/docs
echo InfluxDB: http://localhost:8086
echo.
echo 查看日志: docker-compose logs -f
echo 停止服务: docker-compose down
echo.
pause
