@echo off
echo ============================================
echo DAG Task Dependency Test
echo ============================================
echo.

echo Step 1: Submit a simple DAG with 3 tasks (A -^> B, A -^> C)...
curl -X POST http://localhost:8080/api/v1/dags ^
  -H "Content-Type: application/json" ^
  -d "{\"dag_id\": \"test-dag-001\", \"timeout\": \"5m\", \"tasks\": [{\"id\": \"task-a\", \"name\": \"ExtractData\", \"payload\": \"extract from db\"}, {\"id\": \"task-b\", \"name\": \"TransformData\", \"payload\": \"transform data\", \"dependencies\": [\"task-a\"]}, {\"id\": \"task-c\", \"name\": \"LoadData\", \"payload\": \"load to warehouse\", \"dependencies\": [\"task-a\"]}]}"
echo.
echo.

timeout /t 3 /nobreak

echo Step 2: Check DAG status...
curl http://localhost:8080/api/v1/dags/test-dag-001
echo.
echo.

echo Step 3: Try to submit a DAG with circular dependency (should fail)...
curl -X POST http://localhost:8080/api/v1/dags ^
  -H "Content-Type: application/json" ^
  -d "{\"dag_id\": \"test-dag-cycle\", \"timeout\": \"1m\", \"tasks\": [{\"id\": \"task-x\", \"name\": \"TaskX\", \"payload\": \"x\", \"dependencies\": [\"task-y\"]}, {\"id\": \"task-y\", \"name\": \"TaskY\", \"payload\": \"y\", \"dependencies\": [\"task-x\"]}]}"
echo.
echo.

echo Step 4: List all DAGs...
curl http://localhost:8080/api/v1/dags
echo.
echo.

echo ============================================
echo Test completed!
echo ============================================
pause
