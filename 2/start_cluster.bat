@echo off
echo ============================================
echo Starting Distributed Scheduler Cluster
echo ============================================
echo.

echo Cleaning old data...
if exist data\node1 rmdir /s /q data\node1
if exist data\node2 rmdir /s /q data\node2

echo.
echo Starting Node 1 (HTTP: 8080, Gossip: 9090)...
start "Node1" cmd /k scheduler.exe --http-addr localhost:8080 --gossip-addr localhost:9090 --data-dir ./data/node1 --workers 10

echo Waiting for Node 1 to start...
timeout /t 3 /nobreak

echo.
echo Starting Node 2 (HTTP: 8081, Gossip: 9091) connecting to Node 1...
start "Node2" cmd /k scheduler.exe --http-addr localhost:8081 --gossip-addr localhost:9091 --data-dir ./data/node2 --workers 10 --peers localhost:9090

echo.
echo ============================================
echo Cluster started!
echo Node 1: http://localhost:8080
echo Node 2: http://localhost:8081
echo ============================================
echo.
echo Available test scripts:
echo   test.bat         - Basic task submission test
echo   test_failover.bat - Failover/recovery test
echo.
pause
