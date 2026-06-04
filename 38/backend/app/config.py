from functools import lru_cache
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    MONGODB_URI: str = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "industrial_diagnosis"

    TORCHSERVE_URL: str = "http://localhost:8080"
    TORCHSERVE_MODEL_NAME: str = "fault_diagnosis_cnn"
    TORCHSERVE_TIMEOUT: int = 30
    TORCHSERVE_MAX_RETRIES: int = 3
    TORCHSERVE_RETRY_DELAY: float = 1.0

    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000
    API_CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    REDIS_URL: str = "redis://localhost:6379/0"

    UPLOAD_DIR: str = "./data/uploads"
    RESULT_DIR: str = "./data/results"

    SAMPLE_RATE: int = 10000
    WINDOW_SIZE: int = 10240
    HOP_SIZE: int = 5120
    DENOISE_LEVEL: int = 3

    LOG_LEVEL: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
