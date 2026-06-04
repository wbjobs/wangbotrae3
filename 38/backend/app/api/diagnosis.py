import logging
import os
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from app.celery_app import process_batch_task as celery_process_batch_task
from app.models.schemas import (
    ApiResponse,
    BatchTask,
    BatchTaskCreate,
)
from app.services.device_service import device_service
from app.services.diagnosis_service import diagnosis_service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/batch", response_model=ApiResponse[BatchTask])
async def create_batch_diagnosis(
    device_id: str = Form(...),
    file: UploadFile = File(...),
) -> ApiResponse[BatchTask]:
    try:
        device_exists = await device_service.device_exists(device_id)
        if not device_exists:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Device {device_id} not found",
            )

        if file.size is None:
            file_size = 0
        else:
            file_size = file.size

        allowed_formats = {".csv", ".json", ".parquet"}
        file_ext = os.path.splitext(file.filename or "")[1].lower()
        if file_ext not in allowed_formats:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported file format. Allowed: {', '.join(allowed_formats)}",
            )

        task_create = BatchTaskCreate(
            device_id=device_id,
            file_name=file.filename or f"upload_{file_ext}",
            file_size=file_size,
        )

        task = await diagnosis_service.create_batch_task(task_create, file)

        try:
            celery_process_batch_task.delay(task.id)
            logger.info(f"Dispatched batch task {task.id} to Celery")
        except Exception as e:
            logger.warning(f"Failed to dispatch to Celery, running inline: {e}")
            import asyncio
            asyncio.create_task(diagnosis_service.process_batch_task(task.id))

        return ApiResponse[BatchTask](
            code=status.HTTP_201_CREATED,
            message="Batch task created successfully",
            data=task,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create batch task: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create batch task: {str(e)}",
        )


@router.get("/batch/{task_id}", response_model=ApiResponse[BatchTask])
async def get_batch_task_status(task_id: str) -> ApiResponse[BatchTask]:
    try:
        task = await diagnosis_service.get_batch_task(task_id)
        return ApiResponse[BatchTask](
            code=status.HTTP_200_OK,
            message="success",
            data=task,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get batch task {task_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.get("/batch/{task_id}/download")
async def download_batch_results(task_id: str) -> FileResponse:
    try:
        result_path = diagnosis_service.get_result_file_path(task_id)
        if not result_path or not os.path.exists(result_path):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Result file not found or task not completed",
            )

        task = await diagnosis_service.get_batch_task(task_id)
        filename = f"{task.file_name.rsplit('.', 1)[0]}_results.json"

        return FileResponse(
            path=result_path,
            filename=filename,
            media_type="application/json",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to download results for task {task_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
