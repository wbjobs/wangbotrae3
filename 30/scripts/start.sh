#!/bin/bash
echo "========================================"
echo "  剪贴板历史中心 - 启动脚本"
echo "========================================"
echo ""
echo "[1/2] 正在启动守护服务 (端口 8765)..."
osascript -e 'tell app "Terminal" to do script "cd '$(pwd)' && node src/daemon/index.js"' 2>/dev/null || \
  node src/daemon/index.js &
DAEMON_PID=$!
sleep 3
echo ""
echo "[2/2] 正在启动Web前端 (端口 3000)..."
osascript -e 'tell app "Terminal" to do script "cd '$(pwd)' && node src/web/server.js"' 2>/dev/null || \
  node src/web/server.js &
WEB_PID=$!
sleep 2
echo ""
echo "========================================"
echo "  启动完成！"
echo "  守护服务: http://localhost:8765"
echo "  Web前端:  http://localhost:3000"
echo "========================================"
echo ""
echo "守护服务 PID: $DAEMON_PID"
echo "Web前端 PID: $WEB_PID"
echo ""
echo "按 Ctrl+C 停止所有服务"
trap "kill $DAEMON_PID $WEB_PID 2>/dev/null; exit" INT
wait
