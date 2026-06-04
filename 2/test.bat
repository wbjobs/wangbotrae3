@echo off
echo Starting Distributed Scheduler Test...

echo.
echo === Step 1: Submit a new task ===
curl -X POST http://localhost:8080/api/v1/tasks ^
  -H "Content-Type: application/json" ^
  -d "{\"name\": \"process_file_A.txt\", \"payload\": \"file content here\"}"

echo.
echo.
echo === Step 2: Submit the same task again (should be duplicate) ===
curl -X POST http://localhost:8080/api/v1/tasks ^
  -H "Content-Type: application/json" ^
  -d "{\"name\": \"process_file_A.txt\", \"payload\": \"file content here\"}"

echo.
echo.
echo === Step 3: List all tasks ===
curl http://localhost:8080/api/v1/tasks

echo.
echo.
echo === Step 4: Check node health ===
curl http://localhost:8080/api/v1/health

echo.
echo.
echo Test completed!
pause
