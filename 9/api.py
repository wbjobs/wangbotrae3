import logging
import os
import uuid
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import UPLOAD_DIR, OUTPUT_DIR, MAX_VIDEO_DURATION, ModelType, ScaleFactor, PrecisionType
from config import DEFAULT_BITRATE_BUDGET_MBPS, MIN_BITRATE_BUDGET_MBPS, MAX_BITRATE_BUDGET_MBPS
from task_queue import get_task_queue, TaskStatus

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Video Super-Resolution API",
    description="Video super-resolution service using ESPCN/EDSR models with ONNX Runtime and TensorRT support",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TaskSubmitResponse(BaseModel):
    task_id: str
    message: str


class TaskStatusResponse(BaseModel):
    task_id: str
    status: str
    progress: float
    message: str
    created_at: Optional[str]
    started_at: Optional[str]
    completed_at: Optional[str]
    result: Optional[dict]
    error: Optional[str]


class QueueStatusResponse(BaseModel):
    queue_size: int
    active_count: int


@app.on_event("startup")
async def startup_event():
    get_task_queue()
    logger.info("API started")


@app.on_event("shutdown")
async def shutdown_event():
    task_queue = get_task_queue()
    task_queue.stop()
    logger.info("API shutdown")


@app.get("/")
async def root():
    return {
        "service": "Video Super-Resolution API",
        "version": "1.0.0",
        "endpoints": {
            "POST /upload": "Upload video and submit task",
            "GET /status/{task_id}": "Get task status",
            "GET /download/{task_id}": "Download processed video",
            "GET /queue": "Get queue status",
            "POST /cancel/{task_id}": "Cancel task"
        }
    }


@app.post("/upload", response_model=TaskSubmitResponse)
async def upload_video(
    file: UploadFile = File(...),
    model: ModelType = Query(default="espcn", description="Model type: espcn or edsr"),
    scale: ScaleFactor = Query(default=2, description="Upscale factor: 2 or 4"),
    precision: Optional[PrecisionType] = Query(default=None, description="Precision: fp32, fp16, int8 (auto if not specified)"),
    bitrate_budget: Optional[float] = Query(default=None, description=f"Bitrate budget in Mbps ({MIN_BITRATE_BUDGET_MBPS}-{MAX_BITRATE_BUDGET_MBPS}, default: {DEFAULT_BITRATE_BUDGET_MBPS})")
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    
    if bitrate_budget is not None:
        if bitrate_budget < MIN_BITRATE_BUDGET_MBPS or bitrate_budget > MAX_BITRATE_BUDGET_MBPS:
            raise HTTPException(
                status_code=400,
                detail=f"Bitrate budget must be between {MIN_BITRATE_BUDGET_MBPS} and {MAX_BITRATE_BUDGET_MBPS} Mbps"
            )
    
    ext = Path(file.filename).suffix.lower()
    if ext not in ['.mp4', '.avi', '.mov', '.mkv', '.webm']:
        raise HTTPException(status_code=400, detail="Unsupported video format")
    
    file_id = str(uuid.uuid4())
    input_filename = f"{file_id}{ext}"
    input_path = UPLOAD_DIR / input_filename
    
    try:
        with open(input_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
    except Exception as e:
        logger.error(f"Failed to save file: {e}")
        raise HTTPException(status_code=500, detail="Failed to save uploaded file")
    
    file_size = input_path.stat().st_size
    if file_size == 0:
        input_path.unlink()
        raise HTTPException(status_code=400, detail="Empty file")
    
    try:
        task_queue = get_task_queue()
        task_id = task_queue.submit(
            input_path=str(input_path),
            model_type=model,
            scale=scale,
            precision=precision,
            bitrate_budget=bitrate_budget
        )
    except RuntimeError as e:
        input_path.unlink()
        raise HTTPException(status_code=503, detail=str(e))
    
    return TaskSubmitResponse(
        task_id=task_id,
        message="Video uploaded successfully, processing started"
    )


@app.get("/status/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(task_id: str):
    task_queue = get_task_queue()
    status = task_queue.get_status(task_id)
    
    if not status:
        raise HTTPException(status_code=404, detail="Task not found")
    
    return TaskStatusResponse(**status)


@app.get("/download/{task_id}")
async def download_result(task_id: str):
    task_queue = get_task_queue()
    status = task_queue.get_status(task_id)
    
    if not status:
        raise HTTPException(status_code=404, detail="Task not found")
    
    if status["status"] != TaskStatus.COMPLETED.value:
        raise HTTPException(status_code=400, detail=f"Task not completed. Current status: {status['status']}")
    
    result = status.get("result", {})
    output_path = result.get("output_path")
    
    if not output_path or not Path(output_path).exists():
        raise HTTPException(status_code=404, detail="Output file not found")
    
    output_filename = f"superres_{task_id}.mp4"
    return FileResponse(
        path=output_path,
        media_type="video/mp4",
        filename=output_filename
    )


@app.get("/queue", response_model=QueueStatusResponse)
async def get_queue_status():
    task_queue = get_task_queue()
    return QueueStatusResponse(
        queue_size=task_queue.get_queue_size(),
        active_count=task_queue.get_active_count()
    )


@app.post("/cancel/{task_id}")
async def cancel_task(task_id: str):
    task_queue = get_task_queue()
    success = task_queue.cancel_task(task_id)
    
    if not success:
        status = task_queue.get_status(task_id)
        if not status:
            raise HTTPException(status_code=404, detail="Task not found")
        raise HTTPException(status_code=400, detail=f"Cannot cancel task. Current status: {status['status']}")
    
    return {"task_id": task_id, "message": "Task cancelled successfully"}


@app.get("/health")
async def health_check():
    task_queue = get_task_queue()
    return {
        "status": "healthy",
        "queue_size": task_queue.get_queue_size(),
        "active_count": task_queue.get_active_count()
    }
