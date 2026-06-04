import asyncio
import random
import time
from datetime import datetime, timezone
from typing import Dict, List, Callable, Optional
import numpy as np

from models import DeviceData, DeviceSimulatorConfig


class DeviceSimulator:
    def __init__(self):
        self._devices: Dict[str, DeviceSimulatorConfig] = {}
        self._running: Dict[str, bool] = {}
        self._tasks: Dict[str, asyncio.Task] = {}
        self._callbacks: List[Callable[[DeviceData], None]] = []
        self._last_values: Dict[str, Dict[str, float]] = {}

    def add_device(self, config: DeviceSimulatorConfig) -> bool:
        if config.device_id in self._devices:
            return False
        self._devices[config.device_id] = config
        self._last_values[config.device_id] = {}
        for metric in config.metrics:
            base_value = getattr(config, f"{metric}_base", 0)
            self._last_values[config.device_id][metric] = base_value
        return True

    def remove_device(self, device_id: str) -> bool:
        if device_id not in self._devices:
            return False
        self.stop_device(device_id)
        del self._devices[device_id]
        del self._last_values[device_id]
        return True

    def get_devices(self) -> List[DeviceSimulatorConfig]:
        return list(self._devices.values())

    def get_device(self, device_id: str) -> Optional[DeviceSimulatorConfig]:
        return self._devices.get(device_id)

    def register_callback(self, callback: Callable[[DeviceData], None]):
        self._callbacks.append(callback)

    def unregister_callback(self, callback: Callable[[DeviceData], None]):
        if callback in self._callbacks:
            self._callbacks.remove(callback)

    def _generate_value(self, device_id: str, metric: str, config: DeviceSimulatorConfig) -> float:
        base = getattr(config, f"{metric}_base", 0)
        variance = getattr(config, f"{metric}_variance", 0)
        last_value = self._last_values[device_id].get(metric, base)
        
        drift = random.uniform(-variance * 0.3, variance * 0.3)
        noise = np.random.normal(0, variance * 0.5)
        
        new_value = last_value + drift + noise
        
        min_val = base - variance * 2
        max_val = base + variance * 2
        new_value = max(min_val, min(max_val, new_value))
        
        self._last_values[device_id][metric] = new_value
        return round(new_value, 4)

    def _generate_data(self, device_id: str, config: DeviceSimulatorConfig) -> DeviceData:
        data = DeviceData(
            device_id=device_id,
            timestamp=datetime.now(timezone.utc)
        )
        
        for metric in config.metrics:
            value = self._generate_value(device_id, metric, config)
            setattr(data, metric, value)
        
        return data

    async def _run_device(self, device_id: str):
        config = self._devices[device_id]
        while self._running.get(device_id, False):
            try:
                data = self._generate_data(device_id, config)
                for callback in self._callbacks:
                    try:
                        if asyncio.iscoroutinefunction(callback):
                            await callback(data)
                        else:
                            callback(data)
                    except Exception as e:
                        print(f"Callback error for device {device_id}: {e}")
                await asyncio.sleep(config.interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Error generating data for device {device_id}: {e}")
                await asyncio.sleep(config.interval)

    def start_device(self, device_id: str) -> bool:
        if device_id not in self._devices:
            return False
        if self._running.get(device_id, False):
            return False
        
        self._running[device_id] = True
        self._tasks[device_id] = asyncio.create_task(self._run_device(device_id))
        return True

    def stop_device(self, device_id: str) -> bool:
        if device_id not in self._running:
            return False
        
        self._running[device_id] = False
        if device_id in self._tasks and not self._tasks[device_id].done():
            self._tasks[device_id].cancel()
        return True

    def start_all(self):
        for device_id in self._devices:
            self.start_device(device_id)

    def stop_all(self):
        for device_id in list(self._running.keys()):
            self.stop_device(device_id)

    def is_running(self, device_id: str) -> bool:
        return self._running.get(device_id, False)

    def generate_single_data(self, device_id: str) -> Optional[DeviceData]:
        config = self._devices.get(device_id)
        if not config:
            return None
        return self._generate_data(device_id, config)


device_simulator = DeviceSimulator()
