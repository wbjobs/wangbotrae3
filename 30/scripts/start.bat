@echo off
chcp 65001 >nul
echo ========================================
echo   剪贴板历史中心 - 启动脚本
echo ========================================
echo.
echo [1/2] 正在启动守护服务 (端口 8765)...
start "Clipboard Daemon" cmd /k "node src\daemon\index.js"
timeout /t 3 /nobreak >nul
echo.
echo [2/2] 正在启动Web前端 (端口 3000)...
start "Clipboard Web" cmd /k "node src\web\server.js"
timeout /t 2 /nobreak >nul
echo.
echo ========================================
echo   启动完成！
echo   守护服务: http://localhost:8765
echo   Web前端:  http://localhost:3000
echo ========================================
echo.
echo 按任意键退出...
pause >nul
