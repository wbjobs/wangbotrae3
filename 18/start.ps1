$env:PYTHONPATH = "e:\solo3\18"

Write-Host "=== Starting Redis ===" -ForegroundColor Cyan
Start-Process -FilePath "redis-server" -ArgumentList "--port 6379" -NoNewWindow

Write-Host "=== Starting FastAPI Backend ===" -ForegroundColor Cyan
Start-Process -FilePath "python" -ArgumentList "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload" -NoNewWindow

Write-Host "=== Starting Celery Worker ===" -ForegroundColor Cyan
Start-Process -FilePath "celery" -ArgumentList "-A", "backend.celery_app", "worker", "--loglevel=info", "--concurrency=1", "-P", "solo" -NoNewWindow

Write-Host "=== Starting Frontend Dev Server ===" -ForegroundColor Cyan
Set-Location e:\solo3\18\frontend
Start-Process -FilePath "npm" -ArgumentList "start" -NoNewWindow

Write-Host ""
Write-Host "All services started:" -ForegroundColor Green
Write-Host "  Backend API:    http://localhost:8000" -ForegroundColor Yellow
Write-Host "  API Docs:       http://localhost:8000/docs" -ForegroundColor Yellow
Write-Host "  Frontend:       http://localhost:3000" -ForegroundColor Yellow
Write-Host "  Redis:          localhost:6379" -ForegroundColor Yellow
