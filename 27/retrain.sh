#!/bin/bash

AUDIO_CLASSIFIER_RETRAIN_SCRIPT_PATH="$(dirname "$0")"
cd "$AUDIO_CLASSIFIER_RETRAIN_SCRIPT_PATH"

echo "=============================================="
echo "  Audio Classifier Retrain Pipeline"
echo "=============================================="
echo "Started at: $(date)"
echo ""

echo "[1/4] Loading feedback data from database..."
FEEDBACK_COUNT=$(python -c "
from database import FeedbackDatabase
db = FeedbackDatabase()
fb = db.get_unprocessed_feedback(limit=1000)
print(len(fb))
db.close()
")

if [ "$FEEDBACK_COUNT" -eq "0" ]; then
    echo "No unprocessed feedback found. Exiting."
    exit 0
fi

echo "Found $FEEDBACK_COUNT feedback samples"
echo ""

echo "[2/4] Running fine-tuning with PyTorch..."
python retrain.py \
    --base-model model/audio_classifier.onnx \
    --output-model model/audio_classifier_finetuned.onnx \
    --limit 1000 \
    --mark-processed

RETRAIN_EXIT=$?
if [ $RETRAIN_EXIT -ne 0 ]; then
    echo "ERROR: Training failed with exit code $RETRAIN_EXIT"
    exit $RETRAIN_EXIT
fi
echo ""

echo "[3/4] Verifying new model..."
if [ ! -f "model/audio_classifier_finetuned.onnx" ]; then
    echo "ERROR: Fine-tuned model not found"
    exit 1
fi

MODEL_SIZE=$(du -h model/audio_classifier_finetuned.onnx | cut -f1)
echo "New model size: $MODEL_SIZE"
echo ""

echo "[4/4] Triggering hot-swap via API..."
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

echo ""
echo "=============================================="
echo "  Retrain pipeline completed successfully"
echo "  Completed at: $(date)"
echo "=============================================="
