import asyncio
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Callable, Any
import uuid

from models import DeviceData, TimeTravelRequest, DataPoint, AnomalyEvent
from config import settings


class TimeTravelEngine:
    def __init__(self, influxdb_client=None):
        self._influxdb_client = influxdb_client
        self._active_playbacks: Dict[str, Dict[str, Any]] = {}
        self._playback_tasks: Dict[str, asyncio.Task] = {}
        self._callbacks: List[Callable[[DeviceData], None]] = []
        self._anomaly_callbacks: List[Callable[[AnomalyEvent], None]] = []

    def set_influxdb_client(self, client):
        self._influxdb_client = client

    def register_callback(self, callback: Callable[[DeviceData], None]):
        self._callbacks.append(callback)

    def register_anomaly_callback(self, callback: Callable[[AnomalyEvent], None]):
        self._anomaly_callbacks.append(callback)

    async def _query_historical_data(
        self, device_id: str, start_time: datetime, end_time: datetime
    ) -> List[DeviceData]:
        if self._influxdb_client is None:
            return []
        
        try:
            query_api = self._influxdb_client.query_api()
            
            flux_query = f'''
                from(bucket: "{settings.INFLUXDB_BUCKET}")
                    |> range(start: {start_time.isoformat()}, stop: {end_time.isoformat()})
                    |> filter(fn: (r) => r["device_id"] == "{device_id}")
                    |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
                    |> sort(columns: ["_time"])
            '''
            
            tables = query_api.query(flux_query, org=settings.INFLUXDB_ORG)
            
            data_points: List[DeviceData] = []
            for table in tables:
                for record in table.records:
                    data = DeviceData(
                        device_id=device_id,
                        timestamp=record.get_time(),
                        temperature=record.values.get("temperature"),
                        humidity=record.values.get("humidity"),
                        voltage=record.values.get("voltage"),
                        current=record.values.get("current"),
                        pressure=record.values.get("pressure")
                    )
                    data_points.append(data)
            
            return sorted(data_points, key=lambda x: x.timestamp)
            
        except Exception as e:
            print(f"Error querying historical data: {e}")
            return []

    async def start_playback(self, request: TimeTravelRequest) -> str:
        playback_id = str(uuid.uuid4())
        
        historical_data = await self._query_historical_data(
            request.device_id,
            request.start_time,
            request.end_time
        )
        
        if not historical_data:
            raise ValueError("No historical data found for the specified time range")
        
        target_start = request.target_start_time or datetime.now(timezone.utc)
        
        playback_info = {
            "id": playback_id,
            "device_id": request.device_id,
            "historical_data": historical_data,
            "original_start": request.start_time,
            "original_end": request.end_time,
            "target_start": target_start,
            "playback_speed": request.playback_speed,
            "current_index": 0,
            "total_points": len(historical_data),
            "is_running": True,
            "created_at": datetime.now(timezone.utc)
        }
        
        self._active_playbacks[playback_id] = playback_info
        
        self._playback_tasks[playback_id] = asyncio.create_task(
            self._run_playback(playback_id)
        )
        
        event = AnomalyEvent(
            id=str(uuid.uuid4()),
            device_id=request.device_id,
            anomaly_type="time_travel_start",
            timestamp=datetime.now(timezone.utc),
            parameters={
                "playback_id": playback_id,
                "original_start": request.start_time.isoformat(),
                "original_end": request.end_time.isoformat(),
                "playback_speed": request.playback_speed,
                "data_points": len(historical_data)
            }
        )
        for callback in self._anomaly_callbacks:
            try:
                callback(event)
            except Exception as e:
                print(f"Callback error: {e}")
        
        return playback_id

    async def _run_playback(self, playback_id: str):
        info = self._active_playbacks.get(playback_id)
        if not info:
            return
        
        data_points = info["historical_data"]
        speed = info["playback_speed"]
        target_start = info["target_start"]
        original_start = info["original_start"]
        
        try:
            while info["current_index"] < len(data_points) and info["is_running"]:
                current_idx = info["current_index"]
                point = data_points[current_idx]
                
                original_offset = (point.timestamp - original_start).total_seconds()
                target_timestamp = target_start + timedelta(seconds=original_offset)
                
                adjusted_data = point.model_copy()
                adjusted_data.timestamp = target_timestamp
                adjusted_data.metadata = adjusted_data.metadata or {}
                adjusted_data.metadata["time_travel_playback"] = True
                adjusted_data.metadata["playback_id"] = playback_id
                adjusted_data.metadata["original_timestamp"] = point.timestamp.isoformat()
                
                for callback in self._callbacks:
                    try:
                        if asyncio.iscoroutinefunction(callback):
                            await callback(adjusted_data)
                        else:
                            callback(adjusted_data)
                    except Exception as e:
                        print(f"Playback callback error: {e}")
                
                info["current_index"] += 1
                
                if current_idx + 1 < len(data_points):
                    next_point = data_points[current_idx + 1]
                    original_interval = (next_point.timestamp - point.timestamp).total_seconds()
                    adjusted_interval = original_interval / speed
                    await asyncio.sleep(adjusted_interval)
                else:
                    break
            
            event = AnomalyEvent(
                id=str(uuid.uuid4()),
                device_id=info["device_id"],
                anomaly_type="time_travel_complete",
                timestamp=datetime.now(timezone.utc),
                parameters={
                    "playback_id": playback_id,
                    "points_played": info["current_index"],
                    "total_points": info["total_points"]
                }
            )
            for callback in self._anomaly_callbacks:
                try:
                    callback(event)
                except Exception as e:
                    print(f"Callback error: {e}")
                    
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"Playback error: {e}")
        finally:
            info["is_running"] = False
            if playback_id in self._playback_tasks:
                del self._playback_tasks[playback_id]

    def stop_playback(self, playback_id: str) -> bool:
        if playback_id not in self._active_playbacks:
            return False
        
        self._active_playbacks[playback_id]["is_running"] = False
        
        if playback_id in self._playback_tasks and not self._playback_tasks[playback_id].done():
            self._playback_tasks[playback_id].cancel()
        
        info = self._active_playbacks[playback_id]
        event = AnomalyEvent(
            id=str(uuid.uuid4()),
            device_id=info["device_id"],
            anomaly_type="time_travel_stopped",
            timestamp=datetime.now(timezone.utc),
            parameters={
                "playback_id": playback_id,
                "points_played": info["current_index"],
                "total_points": info["total_points"]
            }
        )
        for callback in self._anomaly_callbacks:
            try:
                callback(event)
            except Exception as e:
                print(f"Callback error: {e}")
        
        return True

    def get_playback_status(self, playback_id: str) -> Optional[Dict[str, Any]]:
        info = self._active_playbacks.get(playback_id)
        if not info:
            return None
        
        return {
            "id": info["id"],
            "device_id": info["device_id"],
            "is_running": info["is_running"],
            "current_index": info["current_index"],
            "total_points": info["total_points"],
            "progress": info["current_index"] / info["total_points"] if info["total_points"] > 0 else 0,
            "playback_speed": info["playback_speed"],
            "original_start": info["original_start"],
            "original_end": info["original_end"],
            "created_at": info["created_at"]
        }

    def get_all_playbacks(self) -> List[Dict[str, Any]]:
        return [
            self.get_playback_status(pid)
            for pid in self._active_playbacks
            if self.get_playback_status(pid) is not None
        ]

    def stop_all_playbacks(self):
        for playback_id in list(self._active_playbacks.keys()):
            self.stop_playback(playback_id)

    async def query_data_range(
        self, device_id: str, start_time: datetime, end_time: datetime,
        metrics: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        if self._influxdb_client is None:
            return []
        
        try:
            query_api = self._influxdb_client.query_api()
            
            metrics_filter = ""
            if metrics:
                metrics_str = ' or '.join([f'r._field == "{m}"' for m in metrics])
                metrics_filter = f'|> filter(fn: (r) => {metrics_str})'
            
            flux_query = f'''
                from(bucket: "{settings.INFLUXDB_BUCKET}")
                    |> range(start: {start_time.isoformat()}, stop: {end_time.isoformat()})
                    |> filter(fn: (r) => r["device_id"] == "{device_id}")
                    {metrics_filter}
                    |> sort(columns: ["_time"])
            '''
            
            tables = query_api.query(flux_query, org=settings.INFLUXDB_ORG)
            
            result: List[Dict[str, Any]] = []
            for table in tables:
                for record in table.records:
                    result.append({
                        "timestamp": record.get_time().isoformat(),
                        "metric": record.get_field(),
                        "value": record.get_value(),
                        "device_id": record.values.get("device_id")
                    })
            
            return result
            
        except Exception as e:
            print(f"Error querying data range: {e}")
            return []


time_travel_engine = TimeTravelEngine()
