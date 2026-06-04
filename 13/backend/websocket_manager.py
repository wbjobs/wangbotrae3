import asyncio
import json
from datetime import datetime
from typing import Dict, List, Set
from fastapi import WebSocket, WebSocketDisconnect

from models import DeviceData, AnomalyEvent


class ConnectionManager:
    def __init__(self):
        self._active_connections: Dict[str, List[WebSocket]] = {}
        self._all_connections: Set[WebSocket] = set()
        self._device_connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, device_id: str = None):
        await websocket.accept()
        self._all_connections.add(websocket)
        
        if device_id:
            if device_id not in self._device_connections:
                self._device_connections[device_id] = set()
            self._device_connections[device_id].add(websocket)
        else:
            if "*" not in self._device_connections:
                self._device_connections["*"] = set()
            self._device_connections["*"].add(websocket)

    def disconnect(self, websocket: WebSocket):
        self._all_connections.discard(websocket)
        for device_id, connections in self._device_connections.items():
            connections.discard(websocket)

    async def _send_json(self, websocket: WebSocket, data: dict):
        try:
            await websocket.send_json(data)
        except Exception as e:
            print(f"Error sending to websocket: {e}")

    async def broadcast_device_data(self, data: DeviceData, is_injected: bool = False):
        message = {
            "type": "device_data",
            "device_id": data.device_id,
            "timestamp": data.timestamp.isoformat(),
            "is_injected": is_injected,
            "data": {
                "temperature": data.temperature,
                "humidity": data.humidity,
                "voltage": data.voltage,
                "current": data.current,
                "pressure": data.pressure
            }
        }
        
        connections = set()
        
        if data.device_id in self._device_connections:
            connections.update(self._device_connections[data.device_id])
        if "*" in self._device_connections:
            connections.update(self._device_connections["*"])
        
        for connection in connections:
            await self._send_json(connection, message)

    async def broadcast_anomaly_event(self, event: AnomalyEvent):
        message = {
            "type": "anomaly_event",
            "id": event.id,
            "device_id": event.device_id,
            "anomaly_type": event.anomaly_type,
            "timestamp": event.timestamp.isoformat(),
            "parameters": event.parameters,
            "original_value": event.original_value,
            "injected_value": event.injected_value
        }
        
        connections = set()
        
        if event.device_id in self._device_connections:
            connections.update(self._device_connections[event.device_id])
        if "*" in self._device_connections:
            connections.update(self._device_connections["*"])
        
        for connection in connections:
            await self._send_json(connection, message)

    async def broadcast_stats(self, device_id: str, stats: dict):
        message = {
            "type": "stats",
            "device_id": device_id,
            "stats": stats
        }
        
        connections = set()
        if device_id in self._device_connections:
            connections.update(self._device_connections[device_id])
        if "*" in self._device_connections:
            connections.update(self._device_connections["*"])
        
        for connection in connections:
            await self._send_json(connection, message)

    async def broadcast_workflow_update(self, workflow_id: str, status: str):
        message = {
            "type": "workflow_update",
            "workflow_id": workflow_id,
            "status": status
        }
        
        if "*" in self._device_connections:
            for connection in self._device_connections["*"]:
                await self._send_json(connection, message)

    async def broadcast_time_travel_update(self, playback_id: str, status: dict):
        message = {
            "type": "time_travel_update",
            "playback_id": playback_id,
            "status": status
        }
        
        if "*" in self._device_connections:
            for connection in self._device_connections["*"]:
                await self._send_json(connection, message)

    async def handle_websocket(self, websocket: WebSocket, device_id: str = None):
        await self.connect(websocket, device_id)
        try:
            while True:
                data = await websocket.receive_text()
                try:
                    message = json.loads(data)
                    if message.get("type") == "ping":
                        await self._send_json(websocket, {"type": "pong"})
                except json.JSONDecodeError:
                    pass
        except WebSocketDisconnect:
            self.disconnect(websocket)
        except Exception as e:
            print(f"WebSocket error: {e}")
            self.disconnect(websocket)


ws_manager = ConnectionManager()
