import os
import time
import threading
import platform
from typing import Dict, List
from enum import Enum
from PyQt5.QtCore import QObject, pyqtSignal


class SectorStatus(Enum):
    GOOD = 0
    SLOW = 1
    PENDING = 2
    BAD = 3
    UNREADABLE = 4


class ScanType(Enum):
    QUICK = 0
    DEEP = 1


class DiskScannerSignals(QObject):
    progress = pyqtSignal(float, int, int, int)
    bad_sector = pyqtSignal(int, str)
    complete = pyqtSignal()
    batch_ready = pyqtSignal(int)


class DiskScanner:
    def __init__(self):
        self.system = platform.system()
        self.is_scanning = False
        self.scan_progress = 0
        self.bad_sectors = []
        self.scan_results = []
        self.signals = DiskScannerSignals()
        self._lock = threading.Lock()
        
    def get_disk_geometry(self, device: str) -> Dict:
        geometry = {
            'total_sectors': 0,
            'sector_size': 512,
            'total_size': 0
        }
        
        try:
            if self.system == "Windows":
                geometry = self._get_windows_geometry(device)
            elif self.system == "Linux":
                geometry = self._get_linux_geometry(device)
            elif self.system == "Darwin":
                geometry = self._get_macos_geometry(device)
        except Exception as e:
            print(f"Error getting disk geometry: {e}")
        
        if geometry['total_sectors'] == 0:
            geometry['total_sectors'] = 1000000
            geometry['total_size'] = geometry['total_sectors'] * geometry['sector_size']
        
        return geometry
    
    def _get_windows_geometry(self, device: str) -> Dict:
        import subprocess
        geometry = {'total_sectors': 0, 'sector_size': 512, 'total_size': 0}
        try:
            result = subprocess.run(
                ["wmic", "diskdrive", "get", "DeviceID,TotalSectors,BytesPerSector,Size"],
                capture_output=True, text=True
            )
            for line in result.stdout.strip().split('\n')[1:]:
                if line.strip():
                    parts = line.split()
                    if len(parts) >= 4 and parts[0] == device:
                        geometry['total_sectors'] = int(parts[1]) if parts[1].isdigit() else 0
                        geometry['sector_size'] = int(parts[2]) if parts[2].isdigit() else 512
                        geometry['total_size'] = int(parts[3]) if parts[3].isdigit() else 0
                        break
        except Exception as e:
            print(f"Windows geometry error: {e}")
        return geometry
    
    def _get_linux_geometry(self, device: str) -> Dict:
        geometry = {'total_sectors': 0, 'sector_size': 512, 'total_size': 0}
        try:
            if os.path.exists(device):
                with open(device, 'rb') as f:
                    f.seek(0, 2)
                    geometry['total_size'] = f.tell()
                geometry['total_sectors'] = geometry['total_size'] // 512
        except Exception as e:
            print(f"Linux geometry error: {e}")
        return geometry
    
    def _get_macos_geometry(self, device: str) -> Dict:
        return {'total_sectors': 1000000, 'sector_size': 512, 'total_size': 512000000}
    
    def scan_disk(self, device: str, scan_type: ScanType = ScanType.QUICK):
        if self.is_scanning:
            return
        
        self.is_scanning = True
        self.scan_progress = 0
        self.bad_sectors = []
        self.scan_results = []
        
        thread = threading.Thread(target=self._scan_worker, args=(device, scan_type))
        thread.daemon = True
        thread.start()
    
    def _scan_worker(self, device: str, scan_type: ScanType):
        try:
            geometry = self.get_disk_geometry(device)
            total_sectors = geometry['total_sectors']
            sector_size = geometry['sector_size']
            
            if scan_type == ScanType.QUICK:
                num_blocks = 2000
            else:
                num_blocks = 5000
            
            step = max(1, total_sectors // num_blocks)
            total_blocks = (total_sectors + step - 1) // step
            
            batch_count = 0
            batch_size = 200
            progress_interval = max(1, total_blocks // 50)
            
            for block_idx in range(total_blocks):
                if not self.is_scanning:
                    break
                
                sector = block_idx * step
                
                status = self._read_sector(device, sector, sector_size)
                
                result = {
                    'sector': sector,
                    'status': status,
                    'block_index': block_idx,
                    'total_blocks': total_blocks
                }
                
                with self._lock:
                    self.scan_results.append(result)
                
                if status in [SectorStatus.BAD, SectorStatus.UNREADABLE]:
                    with self._lock:
                        self.bad_sectors.append({
                            'sector': sector,
                            'status': status.name,
                            'block_index': block_idx
                        })
                    self.signals.bad_sector.emit(sector, status.name)
                
                batch_count += 1
                self.scan_progress = (block_idx + 1) / total_blocks * 100
                
                if batch_count >= batch_size or block_idx == total_blocks - 1:
                    self.signals.batch_ready.emit(total_blocks)
                    batch_count = 0
                
                if (block_idx + 1) % progress_interval == 0 or block_idx == total_blocks - 1:
                    self.signals.progress.emit(
                        self.scan_progress,
                        block_idx + 1,
                        total_blocks,
                        sector
                    )
                
                if scan_type == ScanType.DEEP:
                    time.sleep(0.0001)
            
            self.is_scanning = False
            self.signals.complete.emit()
                
        except Exception as e:
            print(f"Scan error: {e}")
            self.is_scanning = False
            self.signals.complete.emit()
    
    def _read_sector(self, device: str, sector: int, sector_size: int) -> SectorStatus:
        try:
            return self._simulate_sector_read(sector)
        except Exception:
            return SectorStatus.UNREADABLE
    
    def _simulate_sector_read(self, sector: int) -> SectorStatus:
        import random
        rand = random.random()
        
        if rand < 0.001:
            return SectorStatus.BAD
        elif rand < 0.005:
            return SectorStatus.PENDING
        elif rand < 0.02:
            return SectorStatus.SLOW
        else:
            return SectorStatus.GOOD
    
    def stop_scan(self):
        self.is_scanning = False
    
    def get_scan_summary(self) -> Dict:
        with self._lock:
            results = self.scan_results
        summary = {
            'total_scanned': len(results),
            'good': 0,
            'slow': 0,
            'pending': 0,
            'bad': 0,
            'unreadable': 0
        }
        
        for result in results:
            status = result['status']
            if status == SectorStatus.GOOD:
                summary['good'] += 1
            elif status == SectorStatus.SLOW:
                summary['slow'] += 1
            elif status == SectorStatus.PENDING:
                summary['pending'] += 1
            elif status == SectorStatus.BAD:
                summary['bad'] += 1
            elif status == SectorStatus.UNREADABLE:
                summary['unreadable'] += 1
        
        return summary
