#!/bin/bash
export PYTHONPATH="$(dirname $0)"

echo "=== Starting Redis ==="
redis-server --port 6379 &
sleep 1

echo "=== Starting FastAPI Backend ==="
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload &
sleep 2

echo "=== Starting Celery Worker ==="
celery -A backend.celery_app worker --loglevel=info --concurrency=1 &
sleep 2

echo "=== Starting Frontend Dev Server ==="
cd frontend && npm start &

echo ""
echo "All services started:"
echo "  Backend API:    http://localhost:8000"
echo "  API Docs:       http://localhost:8000/docs"
echo "  Frontend:       http://localhost:3000"
echo "  Redis:          localhost:6379"

wait
