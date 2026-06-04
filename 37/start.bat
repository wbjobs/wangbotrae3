@echo off
echo ========================================
echo 供应链碳排放分析系统
echo ========================================
echo.

echo [1/5] 启动 PostgreSQL 和 Redis...
docker-compose up -d postgres redis
timeout /t 10 /nobreak

echo.
echo [2/5] 启动后端服务...
docker-compose up -d backend
timeout /t 5 /nobreak

echo.
echo [3/5] 启动 Celery 工作进程...
docker-compose up -d celery_worker
timeout /t 5 /nobreak

echo.
echo [4/5] 启动前端服务...
docker-compose up -d frontend
timeout /t 10 /nobreak

echo.
echo [5/5] 检查服务状态...
docker-compose ps

echo.
echo ========================================
echo 系统启动完成！
echo.
echo 前端地址: http://localhost:3000
echo API文档: http://localhost:8000/docs
echo ========================================
echo.
pause
