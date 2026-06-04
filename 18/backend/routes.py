import os
import uuid
import json
import shutil
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse

from .config import UPLOAD_DIR, RESULT_DIR, TASK_STATUS_DIR
from .schemas import EstimationRequest, TaskStatusResponse, ExportFormat
from .tasks import estimate_material_task

router = APIRouter(prefix="/api/v1", tags=["material-estimation"])


@router.post("/upload", summary="Upload multi-view images")
async def upload_images(
    images: List[UploadFile] = File(..., description="Multi-view images (at least 8)"),
):
    if len(images) < 8:
        raise HTTPException(status_code=400, detail="At least 8 images are required")

    task_id = str(uuid.uuid4())
    task_upload_dir = UPLOAD_DIR / task_id
    task_upload_dir.mkdir(parents=True, exist_ok=True)

    image_paths = []
    for i, img in enumerate(images):
        ext = os.path.splitext(img.filename or f"view_{i}.png")[1] or ".png"
        save_path = task_upload_dir / f"view_{i:03d}{ext}"
        with open(save_path, "wb") as f:
            content = await img.read()
            f.write(content)
        image_paths.append(str(save_path))

    return {
        "task_id": task_id,
        "num_images": len(image_paths),
        "image_paths": image_paths,
        "message": "Images uploaded successfully",
    }


@router.post("/estimate", summary="Start material estimation task")
async def start_estimation(
    task_id: str = Form(...),
    brdf_type: str = Form("disney"),
    image_size: int = Form(256),
    num_iterations: int = Form(200),
    learning_rate: float = Form(0.01),
    export_format: str = Form("materialx"),
    cameras_json: Optional[str] = Form(None),
    initial_base_color: Optional[str] = Form(None),
    initial_roughness: Optional[float] = Form(None),
    initial_metallic: Optional[float] = Form(None),
    use_multiscale: bool = Form(True),
    scales_json: Optional[str] = Form(None),
    scale_iters_json: Optional[str] = Form(None),
    grad_clip_norm: float = Form(1.0),
    early_stopping: bool = Form(True),
    early_stopping_patience: int = Form(50),
    early_stopping_tol: float = Form(1e-4),
    optimizer_type: str = Form("adam"),
):
    task_upload_dir = UPLOAD_DIR / task_id
    if not task_upload_dir.exists():
        raise HTTPException(status_code=404, detail="Upload session not found")

    image_paths = sorted([
        str(task_upload_dir / f) for f in os.listdir(task_upload_dir)
        if f.lower().endswith((".png", ".jpg", ".jpeg", ".bmp", ".tiff"))
    ])

    if len(image_paths) < 8:
        raise HTTPException(status_code=400, detail="At least 8 images required")

    cameras = None
    if cameras_json:
        try:
            cameras = json.loads(cameras_json)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid cameras JSON")

    init_bc = None
    if initial_base_color:
        try:
            init_bc = json.loads(initial_base_color)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid initial_base_color JSON")

    scales = None
    if scales_json:
        try:
            scales = json.loads(scales_json)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid scales JSON")

    scale_iters = None
    if scale_iters_json:
        try:
            scale_iters = json.loads(scale_iters_json)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid scale_iters JSON")

    request_params = {
        "brdf_type": brdf_type,
        "image_size": image_size,
        "num_iterations": num_iterations,
        "learning_rate": learning_rate,
        "export_format": export_format,
        "cameras": cameras,
        "initial_base_color": init_bc,
        "initial_roughness": initial_roughness,
        "initial_metallic": initial_metallic,
        "use_multiscale": use_multiscale,
        "scales": scales,
        "scale_iters": scale_iters,
        "grad_clip_norm": grad_clip_norm,
        "early_stopping": early_stopping,
        "early_stopping_patience": early_stopping_patience,
        "early_stopping_tol": early_stopping_tol,
        "optimizer_type": optimizer_type,
    }

    task = estimate_material_task.delay(task_id, image_paths, request_params)

    return {
        "task_id": task_id,
        "celery_task_id": task.id,
        "status": "SUBMITTED",
        "message": "Estimation task submitted",
    }


@router.get("/status/{task_id}", summary="Get task status", response_model=TaskStatusResponse)
async def get_task_status(task_id: str):
    status_path = TASK_STATUS_DIR / f"{task_id}.json"
    if not status_path.exists():
        raise HTTPException(status_code=404, detail="Task not found")

    with open(status_path, "r") as f:
        status_data = json.load(f)

    return TaskStatusResponse(**status_data)


@router.get("/results/{task_id}", summary="Get estimation result info")
async def get_result(task_id: str):
    result_dir = RESULT_DIR / task_id
    if not result_dir.exists():
        raise HTTPException(status_code=404, detail="Result not found")

    files = os.listdir(result_dir)
    texture_files = [f for f in files if f.endswith(".png")]
    materialx_file = [f for f in files if f.endswith(".mtlx")]
    mdl_file = [f for f in files if f.endswith(".mdl")]
    loss_file = [f for f in files if f == "loss_history.json"]

    loss_history = None
    if loss_file:
        with open(result_dir / "loss_history.json", "r") as f:
            loss_history = json.load(f)

    return {
        "task_id": task_id,
        "textures": texture_files,
        "materialx": materialx_file[0] if materialx_file else None,
        "mdl": mdl_file[0] if mdl_file else None,
        "loss_history": loss_history,
    }


@router.get("/results/{task_id}/download/{filename}", summary="Download result file")
async def download_result_file(task_id: str, filename: str):
    file_path = RESULT_DIR / task_id / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    media_type = "application/octet-stream"
    if filename.endswith(".png"):
        media_type = "image/png"
    elif filename.endswith(".mtlx"):
        media_type = "text/xml"
    elif filename.endswith(".mdl"):
        media_type = "text/plain"
    elif filename.endswith(".json"):
        media_type = "application/json"

    return FileResponse(
        path=str(file_path),
        media_type=media_type,
        filename=filename,
    )


@router.get("/results/{task_id}/preview", summary="Get rendered preview comparison")
async def get_preview_comparison(task_id: str, view_index: int = 0):
    result_dir = RESULT_DIR / task_id
    if not result_dir.exists():
        raise HTTPException(status_code=404, detail="Result not found")

    upload_dir = UPLOAD_DIR / task_id
    original_images = sorted([
        f for f in os.listdir(upload_dir)
        if f.lower().endswith((".png", ".jpg", ".jpeg"))
    ]) if upload_dir.exists() else []

    preview_data = {
        "task_id": task_id,
        "view_index": view_index,
        "original_image": f"/api/v1/results/{task_id}/download/{original_images[view_index]}" if view_index < len(original_images) else None,
        "base_color_map": f"/api/v1/results/{task_id}/download/base_color.png" if (result_dir / "base_color.png").exists() else None,
        "roughness_map": f"/api/v1/results/{task_id}/download/roughness.png" if (result_dir / "roughness.png").exists() else None,
        "metallic_map": f"/api/v1/results/{task_id}/download/metallic.png" if (result_dir / "metallic.png").exists() else None,
        "normal_map": f"/api/v1/results/{task_id}/download/normal.png" if (result_dir / "normal.png").exists() else None,
    }

    return preview_data


@router.delete("/tasks/{task_id}", summary="Delete task and its data")
async def delete_task(task_id: str):
    for d in [UPLOAD_DIR / task_id, RESULT_DIR / task_id, TASK_STATUS_DIR / f"{task_id}.json"]:
        if d.exists():
            if d.is_dir():
                shutil.rmtree(d)
            else:
                d.unlink()

    return {"message": f"Task {task_id} deleted"}
