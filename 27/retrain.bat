@echo off
setlocal

set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

echo ==============================================
echo   Audio Classifier Retrain Pipeline
echo ==============================================
echo Started at: %date% %time%
echo.

echo [1/4] Loading feedback data from database...
for /f "delims=" %%i in ('python -c "from database import FeedbackDatabase; db = FeedbackDatabase(); fb = db.get_unprocessed_feedback(limit=1000); print(len(fb)); db.close()"') do set FEEDBACK_COUNT=%%i

if "%FEEDBACK_COUNT%"=="0" (
    echo No unprocessed feedback found. Exiting.
    exit /b 0
)

echo Found %FEEDBACK_COUNT% feedback samples
echo.

echo [2/4] Running fine-tuning with PyTorch...
python retrain.py ^
    --base-model model/audio_classifier.onnx ^
    --output-model model/audio_classifier_finetuned.onnx ^
    --limit 1000 ^
    --mark-processed

if %errorlevel% neq 0 (
    echo ERROR: Training failed with exit code %errorlevel%
    exit /b %errorlevel%
)
echo.

echo [3/4] Verifying new model...
if not exist "model/audio_classifier_finetuned.onnx" (
    echo ERROR: Fine-tuned model not found
    exit /b 1
)

for %%A in ("model/audio_classifier_finetuned.onnx") do set MODEL_SIZE=%%~zA
echo New model size: %MODEL_SIZE% bytes
echo.

echo [4/4] Triggering hot-swap via API...
python -c "
import asyncio
import httpx
from pathlib import Path

async def trigger_hot_swap():
    model_path = Path('model/audio_classifier_finetuned.onnx').resolve()
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            'http://localhost:8000/admin/hot-swap-model',
            json={'model_path': str(model_path)}
        )
        print(f'Status: {response.status_code}')
        print(response.json())

asyncio.run(trigger_hot_swap())
"

echo.
echo ==============================================
echo   Retrain pipeline completed successfully
echo   Completed at: %date% %time%
echo ==============================================

endlocal
