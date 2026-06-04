import asyncio
import subprocess
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Any, List, Optional

from fastapi import FastAPI, File, UploadFile, HTTPException, status, Body
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from config import CLASSES, MAX_WORKERS
from worker import WorkerPool, TooManyRequestsError
from database import FeedbackDatabase
from model_manager import DualBufferModelManager
from schemas import (
    FeedbackCreate,
    FeedbackResponse,
    FeedbackStatsResponse,
    TrainingTriggerResponse,
    ModelVersionResponse,
    HealthResponse,
    DetectResponse,
)


TRAINING_INTERVAL_HOURS = 24
MIN_FEEDBACK_FOR_TRAINING = 5


class HotSwapRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    model_path: str
    version: Optional[str] = None


worker_pool: WorkerPool = WorkerPool(max_workers=MAX_WORKERS)
db: FeedbackDatabase = FeedbackDatabase()
model_manager: DualBufferModelManager = DualBufferModelManager()

background_tasks: Dict[str, asyncio.Task] = {}
training_lock = asyncio.Lock()


async def run_retraining_pipeline() -> Dict[str, Any]:
    async with training_lock:
        feedback_stats = db.get_feedback_stats()
        unprocessed_count = feedback_stats["unprocessed_feedback"]

        if unprocessed_count < MIN_FEEDBACK_FOR_TRAINING:
            return {
                "success": False,
                "message": f"Not enough feedback for training. Need {MIN_FEEDBACK_FOR_TRAINING}, have {unprocessed_count}",
                "feedback_count": unprocessed_count,
            }

        training_id = str(uuid.uuid4())[:8]
        output_model = Path(f"model/audio_classifier_finetuned_{training_id}.onnx")

        try:
            proc = await asyncio.create_subprocess_exec(
                "python", "retrain.py",
                "--base-model", "model/audio_classifier.onnx",
                "--output-model", str(output_model),
                "--limit", "1000",
                "--mark-processed",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )

            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                return {
                    "success": False,
                    "message": f"Training failed: {stderr.decode()}",
                    "feedback_count": unprocessed_count,
                    "training_id": training_id,
                }

            if not output_model.exists():
                return {
                    "success": False,
                    "message": "Training completed but output model not found",
                    "feedback_count": unprocessed_count,
                    "training_id": training_id,
                }

            new_version = await model_manager.hot_swap_model(output_model)

            db.add_model_version(
                version=new_version,
                model_path=str(output_model),
                feedback_count=unprocessed_count,
            )

            return {
                "success": True,
                "message": f"Model trained and hot-swapped successfully. New version: {new_version}",
                "feedback_count": unprocessed_count,
                "training_id": training_id,
                "new_version": new_version,
            }

        except Exception as e:
            return {
                "success": False,
                "message": f"Training error: {str(e)}",
                "feedback_count": unprocessed_count,
                "training_id": training_id,
            }


async def scheduled_training_worker():
    while True:
        try:
            next_run = datetime.now() + timedelta(hours=TRAINING_INTERVAL_HOURS)
            while datetime.now() < next_run:
                await asyncio.sleep(60)

            result = await run_retraining_pipeline()
            print(f"[{datetime.now().isoformat()}] Scheduled training result: {result}")

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[{datetime.now().isoformat()}] Scheduled training error: {e}")
            await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await worker_pool.start()

    active_version = worker_pool.get_active_model_version()
    if active_version:
        db.add_model_version(
            version=active_version,
            model_path=str(Path("model/audio_classifier.onnx").resolve()),
            feedback_count=0,
        )

    training_task = asyncio.create_task(scheduled_training_worker())
    background_tasks["scheduled_training"] = training_task

    yield

    for task in background_tasks.values():
        if not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    await worker_pool.stop()
    db.close()


app = FastAPI(
    title="Audio Event Detection API",
    description="Detect glass break, dog bark, knock, car horn, and baby cry in audio files with incremental learning feedback loop",
    version="2.0.0",
    lifespan=lifespan,
)


@app.exception_handler(TooManyRequestsError)
async def too_many_requests_handler(request, exc):
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={
            "success": False,
            "error": "Too many concurrent requests",
            "message": str(exc),
        },
    )


@app.get("/health", response_model=HealthResponse)
async def health_check():
    model_status = worker_pool.get_model_status()
    avg_time = worker_pool.get_average_inference_time()
    feedback_stats = db.get_feedback_stats()
    active_model = db.get_active_model_version()

    active_model_resp = None
    if active_model:
        active_model_resp = ModelVersionResponse(
            id=active_model["id"],
            version=active_model["version"],
            model_path=active_model["model_path"],
            created_at=active_model["created_at"],
            active=bool(active_model["active"]),
            feedback_count=active_model["feedback_count"],
        )

    return HealthResponse(
        status="healthy" if model_status["loaded"] else "degraded",
        model_loaded=model_status["loaded"],
        model_details=model_status,
        queue_size=worker_pool.get_queue_size(),
        max_workers=MAX_WORKERS,
        average_inference_time_ms=round(avg_time * 1000, 2),
        supported_classes=CLASSES,
        active_model_version=active_model_resp,
        feedback_stats=FeedbackStatsResponse(
            total_feedback=feedback_stats["total_feedback"],
            unprocessed_feedback=feedback_stats["unprocessed_feedback"],
            class_distribution=feedback_stats["class_distribution"],
        ),
    )


@app.post("/detect", response_model=DetectResponse)
async def detect_audio(file: UploadFile = File(...)):
    import time

    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No file provided",
        )

    if not file.filename.lower().endswith(".wav"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only WAV format is supported",
        )

    start_time = time.time()

    audio_bytes = await file.read()

    try:
        detections = await worker_pool.submit(audio_bytes)
    except TooManyRequestsError:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Processing failed: {str(e)}",
        )

    processing_time = (time.time() - start_time) * 1000

    return DetectResponse(
        success=True,
        detections=detections,
        processing_time_ms=round(processing_time, 2),
    )


@app.post("/feedback", response_model=FeedbackResponse)
async def submit_feedback(feedback: FeedbackCreate):
    audio_path = Path(feedback.audio_path)
    if not audio_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Audio file not found: {feedback.audio_path}",
        )

    try:
        feedback_id = db.add_feedback(
            audio_path=str(audio_path.resolve()),
            correct_class=feedback.correct_class,
            wrong_start_time=feedback.wrong_start_time,
            wrong_end_time=feedback.wrong_end_time,
            correct_start_time=feedback.correct_start_time,
            correct_end_time=feedback.correct_end_time,
            confidence=feedback.confidence,
            comment=feedback.comment,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    feedback_data = db.get_unprocessed_feedback(limit=1000)
    for fb in feedback_data:
        if fb["id"] == feedback_id:
            return FeedbackResponse(
                id=fb["id"],
                audio_path=fb["audio_path"],
                correct_class=fb["correct_class"],
                wrong_start_time=fb["wrong_start_time"],
                wrong_end_time=fb["wrong_end_time"],
                correct_start_time=fb["correct_start_time"],
                correct_end_time=fb["correct_end_time"],
                confidence=fb["confidence"],
                comment=fb["comment"],
                created_at=fb["created_at"],
                processed=bool(fb["processed"]),
                processed_at=fb["processed_at"],
            )

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Feedback saved but could not retrieve",
    )


@app.get("/feedback/stats", response_model=FeedbackStatsResponse)
async def get_feedback_stats():
    stats = db.get_feedback_stats()
    return FeedbackStatsResponse(
        total_feedback=stats["total_feedback"],
        unprocessed_feedback=stats["unprocessed_feedback"],
        class_distribution=stats["class_distribution"],
    )


@app.get("/feedback/list", response_model=List[FeedbackResponse])
async def list_feedback(processed: Optional[bool] = None, limit: int = 100):
    all_feedback = db.get_unprocessed_feedback(limit=limit)
    result = []
    for fb in all_feedback:
        if processed is None or bool(fb["processed"]) == processed:
            result.append(FeedbackResponse(
                id=fb["id"],
                audio_path=fb["audio_path"],
                correct_class=fb["correct_class"],
                wrong_start_time=fb["wrong_start_time"],
                wrong_end_time=fb["wrong_end_time"],
                correct_start_time=fb["correct_start_time"],
                correct_end_time=fb["correct_end_time"],
                confidence=fb["confidence"],
                comment=fb["comment"],
                created_at=fb["created_at"],
                processed=bool(fb["processed"]),
                processed_at=fb["processed_at"],
            ))
    return result


@app.post("/admin/trigger-training", response_model=TrainingTriggerResponse)
async def trigger_training():
    result = await run_retraining_pipeline()
    return TrainingTriggerResponse(
        success=result["success"],
        message=result["message"],
        feedback_count=result["feedback_count"],
        training_id=result.get("training_id"),
        new_version=result.get("new_version"),
    )


@app.post("/admin/hot-swap-model")
async def hot_swap_model(request: HotSwapRequest):
    model_path = Path(request.model_path)
    if not model_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model file not found: {request.model_path}",
        )

    try:
        new_version = await model_manager.hot_swap_model(model_path, request.version)
        db.add_model_version(
            version=new_version,
            model_path=str(model_path.resolve()),
            feedback_count=0,
        )
        return {
            "success": True,
            "message": f"Model hot-swapped successfully",
            "new_version": new_version,
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Hot swap failed: {str(e)}",
        )


@app.get("/admin/model-versions", response_model=List[ModelVersionResponse])
async def get_model_versions(limit: int = 10):
    versions = db.get_model_history(limit=limit)
    return [
        ModelVersionResponse(
            id=v["id"],
            version=v["version"],
            model_path=v["model_path"],
            created_at=v["created_at"],
            active=bool(v["active"]),
            feedback_count=v["feedback_count"],
        )
        for v in versions
    ]


@app.get("/admin/model-status")
async def get_model_status():
    return {
        "model_manager": model_manager.get_status(),
        "worker_pool": worker_pool.get_model_status(),
        "active_version": worker_pool.get_active_model_version(),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
    )
