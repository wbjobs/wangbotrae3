import json
import logging
import os
import uuid
from datetime import datetime
from typing import Optional

import numpy as np
import pandas as pd
from scipy import signal as scipy_signal
from fastapi import HTTPException, UploadFile, status
from pymongo.database import Database
from pymongo.errors import PyMongoError

from app.config import get_settings
from app.database import get_database
from app.models.schemas import (
    BatchTask,
    BatchTaskCreate,
    BatchTaskStatus,
    DiagnosisResult,
    DiagnosisResultCreate,
    DeviceStatusType,
)
from app.services.torchserve_client import torchserve_client

logger = logging.getLogger(__name__)

settings = get_settings()


class DiagnosisService:
    def __init__(self, db: Optional[Database] = None) -> None:
        self.db = db or get_database()

    async def diagnose_realtime(
        self,
        device_id: str,
        signal: list[float],
        timestamp: int,
        sample_rate: int,
    ) -> DiagnosisResult:
        try:
            processed_signal = self._preprocess_signal(signal, sample_rate)

            inference = await torchserve_client.infer(
                signal=processed_signal,
                sample_rate=sample_rate,
            )

            signal_duration = len(signal) / sample_rate

            result_create = DiagnosisResultCreate(
                device_id=device_id,
                status=inference.status,
                confidence=inference.confidence,
                probabilities=inference.probabilities,
                signal_duration=signal_duration,
                sample_rate=sample_rate,
                timestamp=timestamp,
            )

            return await self._save_diagnosis_result(result_create)

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Realtime diagnosis failed for device {device_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Diagnosis failed: {str(e)}",
            )

    async def create_batch_task(
        self,
        task_create: BatchTaskCreate,
        file: UploadFile,
    ) -> BatchTask:
        task_id = str(uuid.uuid4())
        now = int(datetime.now().timestamp() * 1000)

        file_path = os.path.join(settings.UPLOAD_DIR, f"{task_id}_{file.filename}")
        os.makedirs(os.path.dirname(file_path), exist_ok=True)

        try:
            with open(file_path, "wb") as f:
                content = await file.read()
                f.write(content)

            total_count = self._estimate_signal_count(file_path)

            task_dict = {
                "_id": task_id,
                "id": task_id,
                "device_id": task_create.device_id,
                "file_name": task_create.file_name,
                "file_size": task_create.file_size,
                "status": BatchTaskStatus.PENDING.value,
                "progress": 0.0,
                "total_count": total_count,
                "completed_count": 0,
                "result_path": None,
                "error_message": None,
                "created_at": now,
                "completed_at": None,
            }

            self.db.batch_tasks.insert_one(task_dict)

            return BatchTask(**task_dict)

        except Exception as e:
            logger.error(f"Failed to create batch task: {e}")
            if os.path.exists(file_path):
                os.remove(file_path)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to create batch task: {str(e)}",
            )

    async def get_batch_task(self, task_id: str) -> BatchTask:
        try:
            task_dict = self.db.batch_tasks.find_one({"_id": task_id})
            if not task_dict:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Batch task {task_id} not found",
                )
            return BatchTask(**task_dict)
        except PyMongoError as e:
            logger.error(f"Database error when fetching batch task {task_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database error",
            )

    async def update_batch_task(
        self,
        task_id: str,
        status: Optional[BatchTaskStatus] = None,
        progress: Optional[float] = None,
        completed_count: Optional[int] = None,
        result_path: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> None:
        update_dict: dict = {}
        if status is not None:
            update_dict["status"] = status.value
        if progress is not None:
            update_dict["progress"] = progress
        if completed_count is not None:
            update_dict["completed_count"] = completed_count
        if result_path is not None:
            update_dict["result_path"] = result_path
        if error_message is not None:
            update_dict["error_message"] = error_message

        if status == BatchTaskStatus.COMPLETED or status == BatchTaskStatus.FAILED:
            update_dict["completed_at"] = int(datetime.now().timestamp() * 1000)

        if update_dict:
            self.db.batch_tasks.update_one(
                {"_id": task_id},
                {"$set": update_dict},
            )

    async def process_batch_task(self, task_id: str) -> None:
        task = await self.get_batch_task(task_id)

        try:
            await self.update_batch_task(
                task_id=task_id,
                status=BatchTaskStatus.PROCESSING,
                progress=0.0,
            )

            results: list[dict] = []
            file_path = os.path.join(settings.UPLOAD_DIR, f"{task_id}_{task.file_name}")

            signals = self._load_signals_from_file(file_path)
            total = len(signals)

            for i, signal_data in enumerate(signals):
                try:
                    result = await self.diagnose_realtime(
                        device_id=task.device_id,
                        signal=signal_data["signal"],
                        timestamp=signal_data.get("timestamp", int(datetime.now().timestamp() * 1000)),
                        sample_rate=signal_data.get("sample_rate", settings.SAMPLE_RATE),
                    )
                    results.append(result.model_dump())

                    progress = ((i + 1) / total) * 100
                    if (i + 1) % 10 == 0 or i == total - 1:
                        await self.update_batch_task(
                            task_id=task_id,
                            progress=progress,
                            completed_count=i + 1,
                        )

                except Exception as e:
                    logger.warning(f"Failed to process signal {i} in task {task_id}: {e}")
                    continue

            result_path = self._save_batch_results(task_id, results)

            await self.update_batch_task(
                task_id=task_id,
                status=BatchTaskStatus.COMPLETED,
                progress=100.0,
                completed_count=len(results),
                result_path=result_path,
            )

            logger.info(f"Batch task {task_id} completed successfully")

        except Exception as e:
            logger.error(f"Batch task {task_id} failed: {e}")
            await self.update_batch_task(
                task_id=task_id,
                status=BatchTaskStatus.FAILED,
                error_message=str(e),
            )

    def _preprocess_signal(self, signal: list[float], sample_rate: int) -> list[float]:
        signal_array = np.array(signal, dtype=np.float64)

        if settings.DENOISE_LEVEL > 0:
            sos = scipy_signal.butter(
                N=settings.DENOISE_LEVEL,
                Wn=sample_rate * 0.4,
                btype="low",
                fs=sample_rate,
                output="sos",
            )
            signal_array = scipy_signal.sosfiltfilt(sos, signal_array)

        if len(signal_array) < settings.WINDOW_SIZE:
            pad_len = settings.WINDOW_SIZE - len(signal_array)
            signal_array = np.pad(signal_array, (0, pad_len), mode="constant")
        elif len(signal_array) > settings.WINDOW_SIZE:
            signal_array = signal_array[: settings.WINDOW_SIZE]

        mean = np.mean(signal_array)
        std = np.std(signal_array) + 1e-8
        signal_array = (signal_array - mean) / std

        return signal_array.tolist()

    def _estimate_signal_count(self, file_path: str) -> int:
        try:
            if file_path.endswith(".csv"):
                df = pd.read_csv(file_path, nrows=0)
                return len(df.columns) if "timestamp" in df.columns else len(df.columns)
            elif file_path.endswith(".json"):
                with open(file_path, "r") as f:
                    data = json.load(f)
                return len(data) if isinstance(data, list) else 1
            elif file_path.endswith(".parquet"):
                df = pd.read_parquet(file_path)
                return len(df)
            else:
                return 1
        except Exception:
            return 100

    def _load_signals_from_file(self, file_path: str) -> list[dict]:
        try:
            if file_path.endswith(".csv"):
                df = pd.read_csv(file_path)
                signals = []
                for _, row in df.iterrows():
                    if "signal" in row:
                        signal = json.loads(row["signal"]) if isinstance(row["signal"], str) else row["signal"]
                    else:
                        signal_cols = [c for c in df.columns if c.startswith("signal") or c.startswith("ch")]
                        signal = row[signal_cols].values.tolist()

                    signals.append({
                        "signal": signal,
                        "timestamp": int(row.get("timestamp", datetime.now().timestamp() * 1000)),
                        "sample_rate": int(row.get("sample_rate", settings.SAMPLE_RATE)),
                    })
                return signals

            elif file_path.endswith(".json"):
                with open(file_path, "r") as f:
                    data = json.load(f)
                if isinstance(data, list):
                    return data
                return [data]

            elif file_path.endswith(".parquet"):
                df = pd.read_parquet(file_path)
                signals = []
                for _, row in df.iterrows():
                    signals.append({
                        "signal": row["signal"].tolist() if hasattr(row["signal"], "tolist") else row["signal"],
                        "timestamp": int(row.get("timestamp", datetime.now().timestamp() * 1000)),
                        "sample_rate": int(row.get("sample_rate", settings.SAMPLE_RATE)),
                    })
                return signals

            else:
                raise ValueError(f"Unsupported file format: {file_path}")

        except Exception as e:
            logger.error(f"Failed to load signals from file {file_path}: {e}")
            raise

    def _save_batch_results(self, task_id: str, results: list[dict]) -> str:
        result_dir = settings.RESULT_DIR
        os.makedirs(result_dir, exist_ok=True)
        result_path = os.path.join(result_dir, f"{task_id}_results.json")

        with open(result_path, "w") as f:
            json.dump(results, f, indent=2)

        return result_path

    async def _save_diagnosis_result(
        self, result_create: DiagnosisResultCreate
    ) -> DiagnosisResult:
        result_id = str(uuid.uuid4())
        now = result_create.timestamp or int(datetime.now().timestamp() * 1000)

        result_dict = {
            "_id": result_id,
            "id": result_id,
            "device_id": result_create.device_id,
            "timestamp": now,
            "status": result_create.status,
            "confidence": result_create.confidence,
            "probabilities": result_create.probabilities,
            "signal_duration": result_create.signal_duration,
            "sample_rate": result_create.sample_rate,
        }

        try:
            self.db.diagnosis_results.insert_one(result_dict)
            return DiagnosisResult(**result_dict)
        except PyMongoError as e:
            logger.error(f"Failed to save diagnosis result: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to save diagnosis result",
            )

    def get_result_file_path(self, task_id: str) -> Optional[str]:
        task_dict = self.db.batch_tasks.find_one({"_id": task_id})
        if not task_dict or not task_dict.get("result_path"):
            return None
        return task_dict["result_path"]


diagnosis_service = DiagnosisService()
