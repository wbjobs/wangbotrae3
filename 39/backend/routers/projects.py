import os
import json
import asyncio
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from fastapi.responses import JSONResponse

from ..services import database as db
from ..services import pointcloud as pc

router = APIRouter(prefix="/api/projects", tags=["projects"])

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")


async def _reconstruct_pointcloud(project_id: str, bscan_path: str, params: dict) -> None:
    try:
        with open(bscan_path, "r") as f:
            bscan_data = json.load(f)

        points, colors = await asyncio.to_thread(pc.bscan_to_pointcloud, bscan_data, params)

        if len(points) > 0:
            points, colors = await asyncio.to_thread(pc.filter_pointcloud, points, colors)
            await asyncio.to_thread(pc.save_pointcloud, project_id, points, colors)
            await asyncio.to_thread(db.update_project_status, project_id, "completed", len(points))
        else:
            await asyncio.to_thread(db.update_project_status, project_id, "completed", 0)
    except Exception as e:
        await asyncio.to_thread(db.update_project_status, project_id, "failed", 0)


@router.post("")
async def create_project(
    file: UploadFile = File(...),
    name: str = Form(...),
    dielectric_constant: float = Form(6.0),
    filter_window: float = Form(5.0),
    fitting_threshold: float = Form(0.3),
):
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    project = db.create_project(
        name=name,
        filename=file.filename or "unknown.json",
        dielectric_constant=dielectric_constant,
        filter_window=filter_window,
        fitting_threshold=fitting_threshold,
    )

    project_id = project["id"]
    project_dir = os.path.join(UPLOAD_DIR, project_id)
    os.makedirs(project_dir, exist_ok=True)

    bscan_path = os.path.join(project_dir, "bscan.json")
    content = await file.read()
    with open(bscan_path, "wb") as f:
        f.write(content)

    params = {
        "dielectric_constant": dielectric_constant,
        "filter_window": filter_window,
        "fitting_threshold": fitting_threshold,
    }

    asyncio.create_task(_reconstruct_pointcloud(project_id, bscan_path, params))

    return project


@router.get("")
async def list_projects():
    projects = db.get_projects()
    return {"projects": projects}


@router.get("/{project_id}/status")
async def get_project_status(project_id: str):
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return {
        "id": project["id"],
        "status": project["status"],
        "point_count": project["point_count"],
    }


@router.get("/{project_id}/pointcloud")
async def get_pointcloud(
    project_id: str,
    slice_index: int = Query(0, ge=0),
    slice_count: int = Query(8, ge=1),
):
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project["status"] != "completed":
        raise HTTPException(status_code=400, detail="Point cloud not ready")

    result = pc.load_pointcloud_slice(project_id, slice_index, slice_count)
    if result is None:
        raise HTTPException(status_code=404, detail="Point cloud file not found")

    return result


@router.get("/{project_id}/bscan-preview")
async def get_bscan_preview(project_id: str):
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    bscan_path = os.path.join(UPLOAD_DIR, project_id, "bscan.json")
    if not os.path.exists(bscan_path):
        raise HTTPException(status_code=404, detail="B-scan file not found")

    with open(bscan_path, "r") as f:
        bscan_data = json.load(f)

    preview_base64 = await asyncio.to_thread(pc.generate_bscan_preview, bscan_data)

    return {"preview": f"data:image/png;base64,{preview_base64}"}
