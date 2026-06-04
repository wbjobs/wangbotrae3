import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status

from app.models.schemas import (
    ApiResponse,
    Device,
    DeviceCreate,
    DeviceUpdate,
    PaginatedResponse,
)
from app.services.device_service import device_service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("", response_model=ApiResponse[PaginatedResponse[Device]])
async def get_devices(
    status: Optional[str] = Query(None, description="Filter by device status"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
) -> ApiResponse[PaginatedResponse[Device]]:
    try:
        devices, total = await device_service.get_all_devices(
            status=status,
            page=page,
            page_size=page_size,
        )
        return ApiResponse[PaginatedResponse[Device]](
            code=status.HTTP_200_OK,
            message="success",
            data=PaginatedResponse[Device](
                items=devices,
                total=total,
                page=page,
                page_size=page_size,
            ),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch devices: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.get("/{device_id}", response_model=ApiResponse[Device])
async def get_device(device_id: str) -> ApiResponse[Device]:
    try:
        device = await device_service.get_device_by_id(device_id)
        return ApiResponse[Device](
            code=status.HTTP_200_OK,
            message="success",
            data=device,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch device {device_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.post("", response_model=ApiResponse[Device])
async def create_device(device_create: DeviceCreate) -> ApiResponse[Device]:
    try:
        device = await device_service.create_device(device_create)
        return ApiResponse[Device](
            code=status.HTTP_201_CREATED,
            message="Device created successfully",
            data=device,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create device: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.put("/{device_id}", response_model=ApiResponse[Device])
async def update_device(
    device_id: str, device_update: DeviceUpdate
) -> ApiResponse[Device]:
    try:
        device = await device_service.update_device(device_id, device_update)
        return ApiResponse[Device](
            code=status.HTTP_200_OK,
            message="Device updated successfully",
            data=device,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update device {device_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.delete("/{device_id}", response_model=ApiResponse[None])
async def delete_device(device_id: str) -> ApiResponse[None]:
    try:
        await device_service.delete_device(device_id)
        return ApiResponse[None](
            code=status.HTTP_200_OK,
            message="Device deleted successfully",
            data=None,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete device {device_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
