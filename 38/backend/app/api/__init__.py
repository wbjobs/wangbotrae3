from app.api.routers import api_router
from app.api.websocket import router as websocket_router
from app.api.diagnosis import router as diagnosis_router
from app.api.history import router as history_router
from app.api.devices import router as devices_router

__all__ = [
    "api_router",
    "websocket_router",
    "diagnosis_router",
    "history_router",
    "devices_router",
]
