import logging
from typing import Optional
from pymongo import MongoClient
from pymongo.database import Database
from pymongo.errors import ConnectionFailure

from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

_mongo_client: Optional[MongoClient] = None
_db: Optional[Database] = None


def get_mongo_client() -> MongoClient:
    global _mongo_client
    if _mongo_client is None:
        try:
            _mongo_client = MongoClient(settings.MONGODB_URI)
            _mongo_client.admin.command("ping")
            logger.info("MongoDB connection established successfully")
        except ConnectionFailure as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
            raise
    return _mongo_client


def get_database() -> Database:
    global _db
    if _db is None:
        client = get_mongo_client()
        _db = client[settings.MONGODB_DB_NAME]
        _init_indexes(_db)
    return _db


def _init_indexes(db: Database) -> None:
    try:
        db.devices.create_index("name", unique=True)
        db.devices.create_index("status")

        db.diagnosis_results.create_index("device_id")
        db.diagnosis_results.create_index("timestamp")
        db.diagnosis_results.create_index("status")
        db.diagnosis_results.create_index([("device_id", 1), ("timestamp", -1)])

        db.batch_tasks.create_index("device_id")
        db.batch_tasks.create_index("status")
        db.batch_tasks.create_index("created_at")

        logger.info("Database indexes initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize database indexes: {e}")


def close_mongo_connection() -> None:
    global _mongo_client, _db
    if _mongo_client is not None:
        _mongo_client.close()
        _mongo_client = None
        _db = None
        logger.info("MongoDB connection closed")
