import os
import uuid
import json
import shutil
from pathlib import Path
from typing import Optional

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
RESULT_DIR = BASE_DIR / "results"
TASK_STATUS_DIR = BASE_DIR / "task_status"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
RESULT_DIR.mkdir(parents=True, exist_ok=True)
TASK_STATUS_DIR.mkdir(parents=True, exist_ok=True)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = REDIS_URL

DEFAULT_BRDF_TYPE = "disney"
DEFAULT_IMAGE_SIZE = 256
DEFAULT_NUM_VIEWS = 8
DEFAULT_NUM_ITERATIONS = 200
DEFAULT_LEARNING_RATE = 0.01
DEFAULT_EXPORT_FORMAT = "materialx"
