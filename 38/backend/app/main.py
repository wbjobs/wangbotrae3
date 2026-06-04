import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routers import api_router
from app.config import get_settings
from app.database import close_mongo_connection, get_database

settings = get_settings()

logging.basicConfig(
    level=settings.LOG_LEVEL,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Industrial Diagnosis API server...")

    try:
        db = get_database()
        logger.info("Database connection initialized")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")

    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    os.makedirs(settings.RESULT_DIR, exist_ok=True)
    logger.info(f"Upload directory: {settings.UPLOAD_DIR}")
    logger.info(f"Result directory: {settings.RESULT_DIR}")

    yield

    close_mongo_connection()
    logger.info("Industrial Diagnosis API server shutdown complete")


app = FastAPI(
    title="Industrial Equipment Fault Diagnosis API",
    description="Real-time and batch fault diagnosis system for industrial equipment",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.API_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "code": status.HTTP_500_INTERNAL_SERVER_ERROR,
            "message": str(exc),
            "data": None,
        },
    )


@app.get("/health", tags=["health"])
async def health_check() -> dict:
    return {"status": "healthy", "service": "industrial-diagnosis-api"}


@app.get("/", tags=["root"])
async def root() -> dict:
    return {
        "name": "Industrial Equipment Fault Diagnosis API",
        "version": "1.0.0",
        "docs": "/docs",
    }
