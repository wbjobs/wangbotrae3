#!/bin/bash

echo "========================================"
echo " 混沌测试平台 - 停止脚本 (Linux/Mac)"
echo "========================================"
echo ""

echo "正在停止所有服务..."
docker-compose down
if [ $? -ne 0 ]; then
    echo "警告: 停止过程中出现错误"
else
    echo "所有服务已停止"
fi
