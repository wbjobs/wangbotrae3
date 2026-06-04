import os
import json
from datetime import datetime
from typing import List, Dict, Optional
from dataclasses import dataclass, asdict
import threading


@dataclass
class ScanHistoryRecord:
    timestamp: str
    device: str
    device_model: str
    scan_type: str
    total_scanned: int
    good_sectors: int
    slow_sectors: int
    pending_sectors: int
    bad_sectors: int
    unreadable_sectors: int
    bad_sector_positions: List[int]
    scan_duration_seconds: float


class HistoryStorage:
    def __init__(self, storage_dir: str = None):
        if storage_dir is None:
            storage_dir = os.path.join(os.path.expanduser('~'), '.disk_scanner', 'history')
        
        self.storage_dir = storage_dir
        self.history_file = os.path.join(storage_dir, 'scan_history.json')
        self._lock = threading.Lock()
        self._ensure_storage_dir()
    
    def _ensure_storage_dir(self):
        if not os.path.exists(self.storage_dir):
            os.makedirs(self.storage_dir, exist_ok=True)
    
    def save_scan_record(self, record: ScanHistoryRecord):
        with self._lock:
            history = self._load_history_unsafe()
            history.append(asdict(record))
            self._save_history_unsafe(history)
    
    def get_device_history(self, device: str) -> List[ScanHistoryRecord]:
        with self._lock:
            history = self._load_history_unsafe()
            return [
                ScanHistoryRecord(**r) 
                for r in history 
                if r.get('device') == device
            ]
    
    def get_all_history(self) -> List[ScanHistoryRecord]:
        with self._lock:
            history = self._load_history_unsafe()
            return [ScanHistoryRecord(**r) for r in history]
    
    def get_latest_scan(self, device: str) -> Optional[ScanHistoryRecord]:
        history = self.get_device_history(device)
        if history:
            return sorted(history, key=lambda x: x.timestamp, reverse=True)[0]
        return None
    
    def _load_history_unsafe(self) -> List[Dict]:
        if not os.path.exists(self.history_file):
            return []
        
        try:
            with open(self.history_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data if isinstance(data, list) else []
        except (json.JSONDecodeError, IOError):
            return []
    
    def _save_history_unsafe(self, history: List[Dict]):
        try:
            with open(self.history_file, 'w', encoding='utf-8') as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
        except IOError:
            pass
    
    def clear_history(self, device: str = None):
        with self._lock:
            if device is None:
                self._save_history_unsafe([])
            else:
                history = self._load_history_unsafe()
                filtered = [r for r in history if r.get('device') != device]
                self._save_history_unsafe(filtered)
    
    def create_record_from_scan(self,
                                device: str,
                                device_model: str,
                                scan_type: str,
                                scan_summary: Dict,
                                bad_sectors: List[Dict],
                                scan_duration: float) -> ScanHistoryRecord:
        return ScanHistoryRecord(
            timestamp=datetime.now().isoformat(),
            device=device,
            device_model=device_model,
            scan_type=scan_type,
            total_scanned=scan_summary.get('total_scanned', 0),
            good_sectors=scan_summary.get('good', 0),
            slow_sectors=scan_summary.get('slow', 0),
            pending_sectors=scan_summary.get('pending', 0),
            bad_sectors=scan_summary.get('bad', 0),
            unreadable_sectors=scan_summary.get('unreadable', 0),
            bad_sector_positions=[bs.get('sector', 0) for bs in bad_sectors],
            scan_duration_seconds=scan_duration
        )
