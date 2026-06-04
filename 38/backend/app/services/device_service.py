import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import HTTPException, status
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.database import get_database
from app.models.schemas import Device, DeviceCreate, DeviceUpdate

logger = logging.getLogger(__name__)


class DeviceService:
    def __init__(self, db: Optional[Database] = None) -> None:
        self.db = db or get_database()

    async def get_all_devices(
        self,
        status: Optional[str] = None,
        page: int = 1,
        page_size: int = 100,
    ) -> tuple[list[Device], int]:
        try:
            query: dict = {}
            if status:
                query["status"] = status

            total = self.db.devices.count_documents(query)

            skip = (page - 1) * page_size
            cursor = (
                self.db.devices.find(query)
                .sort("created_at", -1)
                .skip(skip)
                .limit(page_size)
            )

            devices = [Device(**doc) for doc in cursor]
            return devices, total

        except PyMongoError as e:
            logger.error(f"Database error when fetching devices: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database error when fetching devices",
            )

    async def get_device_by_id(self, device_id: str) -> Device:
        try:
            doc = self.db.devices.find_one({"_id": device_id})
            if not doc:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Device {device_id} not found",
                )
            return Device(**doc)
        except PyMongoError as e:
            logger.error(f"Database error when fetching device {device_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database error",
            )

    async def create_device(self, device_create: DeviceCreate) -> Device:
        device_id = str(uuid.uuid4())
        now = int(datetime.now().timestamp() * 1000)

        device_dict = {
            "_id": device_id,
            "id": device_id,
            "name": device_create.name,
            "type": device_create.type,
            "location": device_create.location,
            "sample_rate": device_create.sample_rate,
            "sensor_count": device_create.sensor_count,
            "status": device_create.status,
            "created_at": now,
            "updated_at": now,
        }

        try:
            self.db.devices.insert_one(device_dict)
            logger.info(f"Created device: {device_id}")
            return Device(**device_dict)
        except DuplicateKeyError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Device name '{device_create.name}' already exists",
            )
        except PyMongoError as e:
            logger.error(f"Database error when creating device: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database error when creating device",
            )

    async def update_device(
        self, device_id: str, device_update: DeviceUpdate
    ) -> Device:
        await self.get_device_by_id(device_id)

        update_dict: dict = {}
        if device_update.name is not None:
            update_dict["name"] = device_update.name
        if device_update.type is not None:
            update_dict["type"] = device_update.type
        if device_update.location is not None:
            update_dict["location"] = device_update.location
        if device_update.sample_rate is not None:
            update_dict["sample_rate"] = device_update.sample_rate
        if device_update.sensor_count is not None:
            update_dict["sensor_count"] = device_update.sensor_count
        if device_update.status is not None:
            update_dict["status"] = device_update.status

        if not update_dict:
            return await self.get_device_by_id(device_id)

        update_dict["updated_at"] = int(datetime.now().timestamp() * 1000)

        try:
            result = self.db.devices.update_one(
                {"_id": device_id},
                {"$set": update_dict},
            )
            if result.matched_count == 0:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Device {device_id} not found",
                )
            logger.info(f"Updated device: {device_id}")
            return await self.get_device_by_id(device_id)
        except DuplicateKeyError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Device name '{device_update.name}' already exists",
            )
        except PyMongoError as e:
            logger.error(f"Database error when updating device {device_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database error when updating device",
            )

    async def delete_device(self, device_id: str) -> None:
        try:
            result = self.db.devices.delete_one({"_id": device_id})
            if result.deleted_count == 0:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Device {device_id} not found",
                )
            logger.info(f"Deleted device: {device_id}")
        except PyMongoError as e:
            logger.error(f"Database error when deleting device {device_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database error when deleting device",
            )

    async def device_exists(self, device_id: str) -> bool:
        try:
            count = self.db.devices.count_documents({"_id": device_id})
            return count > 0
        except PyMongoError as e:
            logger.error(f"Database error when checking device existence: {e}")
            return False


device_service = DeviceService()
