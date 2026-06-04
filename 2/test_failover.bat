@echo off
echo ============================================
echo Distributed Scheduler Failover Test
echo ============================================
echo.

echo Step 1: Check cluster node status...
curl http://localhost:8080/api/v1/nodes/status
echo.
echo.

echo Step 2: Submit a task that will be processed by node2...
curl -X POST http://localhost:8080/api/v1/tasks ^
  -H "Content-Type: application/json" ^
  -d "{\"name\": \"process_file_B.txt\", \"payload\": \"data for node2\"}"
echo.
echo.

echo Step 3: List all tasks to see the status...
curl http://localhost:8080/api/v1/tasks
echo.
echo.

echo Step 4: Manually trigger node2 failure (for testing)...
curl -X POST http://localhost:8080/api/v1/nodes/fail ^
  -H "Content-Type: application/json" ^
  -d "{\"node_http_addr\": \"localhost:8081\"}"
echo.
echo.

echo Waiting for task recovery (3 seconds)...
timeout /t 3 /nobreak

echo.
echo Step 5: Check node status again - node2 should be dead...
curl http://localhost:8080/api/v1/nodes/status
echo.
echo.

echo Step 6: Check tasks - the task should be recovered and reassigned...
curl http://localhost:8080/api/v1/tasks
echo.
echo.

echo ============================================
echo Test completed!
echo ============================================
pause
