import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.models.schemas import (
    ApiResponse,
    DiagnosisResult,
    HistoryFilter,
    PaginatedResponse,
)
from app.services.history_service import history_service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("", response_model=ApiResponse[PaginatedResponse[DiagnosisResult]])
async def get_history(
    filter: HistoryFilter = Depends(),
) -> ApiResponse[PaginatedResponse[DiagnosisResult]]:
    try:
        paginated_result = await history_service.get_history(filter)
        return ApiResponse[PaginatedResponse[DiagnosisResult]](
            code=status.HTTP_200_OK,
            message="success",
            data=paginated_result,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch history: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.get("/{result_id}", response_model=ApiResponse[DiagnosisResult])
async def get_history_result(result_id: str) -> ApiResponse[DiagnosisResult]:
    try:
        result = await history_service.get_result_by_id(result_id)
        return ApiResponse[DiagnosisResult](
            code=status.HTTP_200_OK,
            message="success",
            data=result,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch result {result_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.delete("/{result_id}", response_model=ApiResponse[None])
async def delete_history_result(result_id: str) -> ApiResponse[None]:
    try:
        await history_service.delete_result(result_id)
        return ApiResponse[None](
            code=status.HTTP_200_OK,
            message="Diagnosis result deleted successfully",
            data=None,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete result {result_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.get("/statistics", response_model=ApiResponse[dict])
async def get_statistics(
    device_id: Optional[str] = Query(None, alias="deviceId"),
    start_time: Optional[int] = Query(None, alias="startTime"),
    end_time: Optional[int] = Query(None, alias="endTime"),
) -> ApiResponse[dict]:
    try:
        stats = await history_service.get_statistics(
            device_id=device_id,
            start_time=start_time,
            end_time=end_time,
        )
        return ApiResponse[dict](
            code=status.HTTP_200_OK,
            message="success",
            data=stats,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch statistics: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
