from typing import Optional

from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel

from ..services import database as db

router = APIRouter(prefix="/api/projects", tags=["annotations"])


class AnnotationCreate(BaseModel):
    label: str
    color: str = "#FF8C42"
    box_min: Optional[list[float]] = None
    box_max: Optional[list[float]] = None
    points: Optional[list] = None


class AnnotationUpdate(BaseModel):
    label: Optional[str] = None
    color: Optional[str] = None
    box_min: Optional[list[float]] = None
    box_max: Optional[list[float]] = None
    points: Optional[list] = None


@router.post("/{project_id}/annotations")
async def create_annotation(project_id: str, body: AnnotationCreate):
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    annotation = db.create_annotation(
        project_id=project_id,
        label=body.label,
        color=body.color,
        box_min=body.box_min,
        box_max=body.box_max,
        points=body.points,
    )
    return annotation


@router.get("/{project_id}/annotations")
async def list_annotations(project_id: str):
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    annotations = db.get_annotations(project_id)
    return {"annotations": annotations}


@router.put("/{project_id}/annotations/{annotation_id}")
async def update_annotation(project_id: str, annotation_id: str, body: AnnotationUpdate):
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    existing = db.get_annotation(annotation_id)
    if not existing or existing["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Annotation not found")

    annotation = db.update_annotation(
        annotation_id=annotation_id,
        label=body.label,
        color=body.color,
        box_min=body.box_min,
        box_max=body.box_max,
        points=body.points,
    )
    return annotation


@router.delete("/{project_id}/annotations/{annotation_id}")
async def delete_annotation(project_id: str, annotation_id: str):
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    existing = db.get_annotation(annotation_id)
    if not existing or existing["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Annotation not found")

    db.delete_annotation(annotation_id)
    return {"success": True}
