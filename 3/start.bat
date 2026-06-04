@echo off
chcp 65001 >nul 2>&1
echo ============================================
echo   化学实验模拟器 - 启动脚本
echo ============================================
echo.

echo [1/3] 检查Python环境...
python --version >nul 2>&1
if errorlevel 1 (
    echo 错误: 未找到Python，请先安装Python 3.10+
    pause
    exit /b 1
)

echo [2/3] 安装后端依赖...
pip install -r server\requirements.txt -q

echo [3/3] 安装前端依赖...
call npm install

echo.
echo ============================================
echo   启动服务...
echo ============================================

echo 启动后端WebSocket服务器 (端口 8765)...
start "Chemistry Backend" cmd /c "cd /d %~dp0server && python server.py"

timeout /t 2 /nobreak >nul

echo 启动前端开发服务器 (端口 3000)...
call npx vite --host

pause
