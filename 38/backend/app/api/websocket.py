import json
import logging
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from fastapi.websockets import WebSocketState

from app.config import get_settings
from app.models.schemas import (
    ApiResponse,
    RealtimeDiagnosisData,
    RealtimeSignalData,
)
from app.services.device_service import device_service
from app.services.diagnosis_service import diagnosis_service

logger = logging.getLogger(__name__)

router = APIRouter()

settings = get_settings()


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, client_id: str) -> None:
        await websocket.accept()
        self.active_connections[client_id] = websocket
        logger.info(f"WebSocket connected: {client_id}")

    def disconnect(self, client_id: str) -> None:
        if client_id in self.active_connections:
            del self.active_connections[client_id]
            logger.info(f"WebSocket disconnected: {client_id}")

    async def send_personal_message(self, message: dict, client_id: str) -> None:
        if client_id in self.active_connections:
            websocket = self.active_connections[client_id]
            if websocket.client_state == WebSocketState.CONNECTED:
                await websocket.send_json(message)

    async def broadcast(self, message: dict) -> None:
        for client_id, websocket in self.active_connections.items():
            if websocket.client_state == WebSocketState.CONNECTED:
                try:
                    await websocket.send_json(message)
                except Exception as e:
                    logger.warning(f"Failed to send message to {client_id}: {e}")


manager = ConnectionManager()


@router.websocket("/api/v1/diagnosis/realtime")
async def realtime_diagnosis(websocket: WebSocket, client_id: Optional[str] = None) -> None:
    if client_id is None:
        client_id = f"client_{id(websocket)}"

    await manager.connect(websocket, client_id)

    try:
        while True:
            try:
                data = await websocket.receive_text()
                message = json.loads(data)

                if message.get("type") == "signal_data":
                    signal_data = RealtimeSignalData(**message)

                    device_exists = await device_service.device_exists(signal_data.device_id)
                    if not device_exists:
                        error_response = ApiResponse(
                            code=status.HTTP_404_NOT_FOUND,
                            message=f"Device {signal_data.device_id} not found",
                            data=None,
                        )
                        await manager.send_personal_message(
                            error_response.model_dump(), client_id
                        )
                        continue

                    result = await diagnosis_service.diagnose_realtime(
                        device_id=signal_data.device_id,
                        signal=signal_data.signal,
                        timestamp=signal_data.timestamp,
                        sample_rate=settings.SAMPLE_RATE,
                    )

                    diagnosis_message = RealtimeDiagnosisData(data=result)
                    await manager.send_personal_message(
                        diagnosis_message.model_dump(by_alias=True), client_id
                    )

                elif message.get("type") == "ping":
                    await manager.send_personal_message({"type": "pong"}, client_id)

                else:
                    logger.warning(f"Unknown message type: {message.get('type')}")
                    error_response = ApiResponse(
                        code=status.HTTP_400_BAD_REQUEST,
                        message=f"Unknown message type: {message.get('type')}",
                        data=None,
                    )
                    await manager.send_personal_message(
                        error_response.model_dump(), client_id
                    )

            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON received: {e}")
                error_response = ApiResponse(
                    code=status.HTTP_400_BAD_REQUEST,
                    message="Invalid JSON format",
                    data=None,
                )
                await manager.send_personal_message(
                    error_response.model_dump(), client_id
                )

            except Exception as e:
                logger.error(f"Error processing WebSocket message: {e}", exc_info=True)
                error_response = ApiResponse(
                    code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    message=str(e),
                    data=None,
                )
                await manager.send_personal_message(
                    error_response.model_dump(), client_id
                )

    except WebSocketDisconnect:
        manager.disconnect(client_id)
    except Exception as e:
        logger.error(f"WebSocket error for {client_id}: {e}")
        manager.disconnect(client_id)
