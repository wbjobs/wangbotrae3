from fastapi import APIRouter

from app.api import diagnosis, history, devices, websocket

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(diagnosis.router, prefix="/diagnosis", tags=["diagnosis"])
api_router.include_router(history.router, prefix="/history", tags=["history"])
api_router.include_router(devices.router, prefix="/devices", tags=["devices"])
api_router.include_router(websocket.router, tags=["websocket"])
