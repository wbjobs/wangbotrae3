import logging
from typing import Optional

from fastapi import HTTPException, status
from pymongo.database import Database
from pymongo.errors import PyMongoError

from app.database import get_database
from app.models.schemas import (
    DiagnosisResult,
    HistoryFilter,
    PaginatedResponse,
)

logger = logging.getLogger(__name__)


class HistoryService:
    def __init__(self, db: Optional[Database] = None) -> None:
        self.db = db or get_database()

    async def get_history(
        self,
        filter: HistoryFilter,
    ) -> PaginatedResponse[DiagnosisResult]:
        try:
            query = self._build_query(filter)

            total = self.db.diagnosis_results.count_documents(query)

            skip = (filter.page - 1) * filter.page_size
            cursor = (
                self.db.diagnosis_results.find(query)
                .sort("timestamp", -1)
                .skip(skip)
                .limit(filter.page_size)
            )

            items = []
            for doc in cursor:
                items.append(DiagnosisResult(**doc))

            return PaginatedResponse[DiagnosisResult](
                items=items,
                total=total,
                page=filter.page,
                page_size=filter.page_size,
            )

        except PyMongoError as e:
            logger.error(f"Database error when fetching history: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database error when fetching history",
            )

    async def get_result_by_id(self, result_id: str) -> DiagnosisResult:
        try:
            doc = self.db.diagnosis_results.find_one({"_id": result_id})
            if not doc:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Diagnosis result {result_id} not found",
                )
            return DiagnosisResult(**doc)
        except PyMongoError as e:
            logger.error(f"Database error when fetching result {result_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database error",
            )

    async def delete_result(self, result_id: str) -> None:
        try:
            result = self.db.diagnosis_results.delete_one({"_id": result_id})
            if result.deleted_count == 0:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Diagnosis result {result_id} not found",
                )
            logger.info(f"Deleted diagnosis result {result_id}")
        except PyMongoError as e:
            logger.error(f"Database error when deleting result {result_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database error when deleting result",
            )

    async def get_statistics(
        self,
        device_id: Optional[str] = None,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
    ) -> dict:
        try:
            query: dict = {}
            if device_id:
                query["device_id"] = device_id
            if start_time:
                query["timestamp"] = {"$gte": start_time}
            if end_time:
                query.setdefault("timestamp", {})["$lte"] = end_time

            pipeline = [
                {"$match": query},
                {
                    "$group": {
                        "_id": "$status",
                        "count": {"$sum": 1},
                        "avg_confidence": {"$avg": "$confidence"},
                    }
                },
            ]

            results = list(self.db.diagnosis_results.aggregate(pipeline))

            total = sum(r["count"] for r in results)

            stats = {
                "total": total,
                "by_status": {},
                "avg_confidence": 0.0,
            }

            total_confidence = 0.0
            for r in results:
                status = r["_id"]
                stats["by_status"][status] = {
                    "count": r["count"],
                    "percentage": (r["count"] / total * 100) if total > 0 else 0,
                    "avg_confidence": r["avg_confidence"],
                }
                total_confidence += r["avg_confidence"] * r["count"]

            if total > 0:
                stats["avg_confidence"] = total_confidence / total

            return stats

        except PyMongoError as e:
            logger.error(f"Database error when fetching statistics: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database error when fetching statistics",
            )

    def _build_query(self, filter: HistoryFilter) -> dict:
        query: dict = {}

        if filter.device_id:
            query["device_id"] = filter.device_id

        if filter.status:
            query["status"] = filter.status

        if filter.start_time or filter.end_time:
            query["timestamp"] = {}
            if filter.start_time:
                query["timestamp"]["$gte"] = filter.start_time
            if filter.end_time:
                query["timestamp"]["$lte"] = filter.end_time

        return query


history_service = HistoryService()
