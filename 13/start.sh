#!/bin/bash

echo "========================================"
echo " 混沌测试平台 - 启动脚本 (Linux/Mac)"
echo "========================================"
echo ""

echo "[1/3] 检查Docker是否运行..."
if ! command -v docker &> /dev/null; then
    echo "错误: 未检测到Docker，请先安装Docker"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo "错误: Docker未运行，请先启动Docker"
    exit 1
fi
echo "Docker已就绪"
echo ""

echo "[2/3] 启动服务..."
docker-compose up -d --build
if [ $? -ne 0 ]; then
    echo "错误: 服务启动失败"
    exit 1
fi
echo ""

echo "[3/3] 等待服务就绪..."
sleep 15
echo ""

echo "========================================"
echo " 服务启动完成！"
echo "========================================"
echo ""
echo "前端地址: http://localhost:3000"
echo "后端API: http://localhost:8000"
echo "API文档: http://localhost:8000/docs"
echo "InfluxDB: http://localhost:8086"
echo ""
echo "查看日志: docker-compose logs -f"
echo "停止服务: docker-compose down"
echo ""
