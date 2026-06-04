import os
import sqlite3
import hashlib
import json
from datetime import datetime
from typing import Optional, Dict, List, Tuple, Any
from dataclasses import dataclass, asdict


@dataclass
class CWSICacheEntry:
    file_hash: str
    sample_name: str
    timestamp: Optional[str]
    thermal_path: str
    visible_path: str
    meteo_path: str
    mean_tc: Optional[float]
    Tdry: Optional[float]
    Twet: Optional[float]
    mean_cwsi: Optional[float]
    std_cwsi: Optional[float]
    cv_cwsi: Optional[float]
    canopy_area: Optional[int]
    threshold_used: Optional[float]
    alignment_inlier_ratio: Optional[float]
    error_message: Optional[str]
    created_at: str
    updated_at: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class CWSIDatabase:
    def __init__(self, db_path: str = "./cwsicalc_cache.db"):
        self.db_path = db_path
        self._init_database()

    def _init_database(self):
        os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS cwsi_results (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_hash TEXT UNIQUE NOT NULL,
                    sample_name TEXT NOT NULL,
                    timestamp TEXT,
                    thermal_path TEXT NOT NULL,
                    visible_path TEXT NOT NULL,
                    meteo_path TEXT NOT NULL,
                    mean_tc REAL,
                    Tdry REAL,
                    Twet REAL,
                    mean_cwsi REAL,
                    std_cwsi REAL,
                    cv_cwsi REAL,
                    canopy_area INTEGER,
                    threshold_used REAL,
                    alignment_inlier_ratio REAL,
                    error_message TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_timestamp ON cwsi_results(timestamp)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_sample_name ON cwsi_results(sample_name)
            """)
            conn.commit()

    @staticmethod
    def compute_file_hash(
        thermal_path: str,
        visible_path: str,
        meteo_path: str,
        extra_params: Optional[Dict] = None,
    ) -> str:
        hasher = hashlib.sha256()

        for path in [thermal_path, visible_path, meteo_path]:
            if os.path.exists(path):
                stat = os.stat(path)
                hasher.update(f"{path}:{stat.st_size}:{stat.st_mtime}".encode())
            else:
                hasher.update(f"{path}:missing".encode())

        if extra_params:
            hasher.update(json.dumps(extra_params, sort_keys=True).encode())

        return hasher.hexdigest()

    def get_entry(
        self,
        thermal_path: str,
        visible_path: str,
        meteo_path: str,
        extra_params: Optional[Dict] = None,
    ) -> Optional[CWSICacheEntry]:
        file_hash = self.compute_file_hash(thermal_path, visible_path, meteo_path, extra_params)

        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM cwsi_results WHERE file_hash = ?",
                (file_hash,),
            )
            row = cursor.fetchone()

            if row:
                return CWSICacheEntry(
                    file_hash=row["file_hash"],
                    sample_name=row["sample_name"],
                    timestamp=row["timestamp"],
                    thermal_path=row["thermal_path"],
                    visible_path=row["visible_path"],
                    meteo_path=row["meteo_path"],
                    mean_tc=row["mean_tc"],
                    Tdry=row["Tdry"],
                    Twet=row["Twet"],
                    mean_cwsi=row["mean_cwsi"],
                    std_cwsi=row["std_cwsi"],
                    cv_cwsi=row["cv_cwsi"],
                    canopy_area=row["canopy_area"],
                    threshold_used=row["threshold_used"],
                    alignment_inlier_ratio=row["alignment_inlier_ratio"],
                    error_message=row["error_message"],
                    created_at=row["created_at"],
                    updated_at=row["updated_at"],
                )
        return None

    def save_entry(
        self,
        thermal_path: str,
        visible_path: str,
        meteo_path: str,
        sample_name: str,
        timestamp: Optional[str],
        result: Optional[Any],
        error_message: Optional[str] = None,
        extra_params: Optional[Dict] = None,
        alignment_inlier_ratio: Optional[float] = None,
        threshold_used: Optional[float] = None,
    ) -> CWSICacheEntry:
        file_hash = self.compute_file_hash(thermal_path, visible_path, meteo_path, extra_params)
        now = datetime.now().isoformat()

        if result is not None and error_message is None:
            entry = CWSICacheEntry(
                file_hash=file_hash,
                sample_name=sample_name,
                timestamp=timestamp,
                thermal_path=thermal_path,
                visible_path=visible_path,
                meteo_path=meteo_path,
                mean_tc=result.mean_temp,
                Tdry=result.Tdry,
                Twet=result.Twet,
                mean_cwsi=result.stats["mean_cwsi"],
                std_cwsi=result.stats["std_cwsi"],
                cv_cwsi=result.stats["cv_cwsi"],
                canopy_area=result.stats["canopy_area_pixels"],
                threshold_used=threshold_used,
                alignment_inlier_ratio=alignment_inlier_ratio,
                error_message=None,
                created_at=now,
                updated_at=now,
            )
        else:
            entry = CWSICacheEntry(
                file_hash=file_hash,
                sample_name=sample_name,
                timestamp=timestamp,
                thermal_path=thermal_path,
                visible_path=visible_path,
                meteo_path=meteo_path,
                mean_tc=None,
                Tdry=None,
                Twet=None,
                mean_cwsi=None,
                std_cwsi=None,
                cv_cwsi=None,
                canopy_area=None,
                threshold_used=threshold_used,
                alignment_inlier_ratio=alignment_inlier_ratio,
                error_message=error_message,
                created_at=now,
                updated_at=now,
            )

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            existing = self.get_entry(thermal_path, visible_path, meteo_path, extra_params)

            if existing:
                cursor.execute("""
                    UPDATE cwsi_results SET
                        sample_name = ?,
                        timestamp = ?,
                        mean_tc = ?,
                        Tdry = ?,
                        Twet = ?,
                        mean_cwsi = ?,
                        std_cwsi = ?,
                        cv_cwsi = ?,
                        canopy_area = ?,
                        threshold_used = ?,
                        alignment_inlier_ratio = ?,
                        error_message = ?,
                        updated_at = ?
                    WHERE file_hash = ?
                """, (
                    entry.sample_name,
                    entry.timestamp,
                    entry.mean_tc,
                    entry.Tdry,
                    entry.Twet,
                    entry.mean_cwsi,
                    entry.std_cwsi,
                    entry.cv_cwsi,
                    entry.canopy_area,
                    entry.threshold_used,
                    entry.alignment_inlier_ratio,
                    entry.error_message,
                    entry.updated_at,
                    file_hash,
                ))
            else:
                cursor.execute("""
                    INSERT INTO cwsi_results (
                        file_hash, sample_name, timestamp, thermal_path, visible_path,
                        meteo_path, mean_tc, Tdry, Twet, mean_cwsi, std_cwsi,
                        cv_cwsi, canopy_area, threshold_used, alignment_inlier_ratio,
                        error_message, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    entry.file_hash,
                    entry.sample_name,
                    entry.timestamp,
                    entry.thermal_path,
                    entry.visible_path,
                    entry.meteo_path,
                    entry.mean_tc,
                    entry.Tdry,
                    entry.Twet,
                    entry.mean_cwsi,
                    entry.std_cwsi,
                    entry.cv_cwsi,
                    entry.canopy_area,
                    entry.threshold_used,
                    entry.alignment_inlier_ratio,
                    entry.error_message,
                    entry.created_at,
                    entry.updated_at,
                ))
            conn.commit()

        return entry

    def get_timeseries(
        self,
        start_timestamp: Optional[str] = None,
        end_timestamp: Optional[str] = None,
        sample_name_pattern: Optional[str] = None,
    ) -> List[CWSICacheEntry]:
        query = "SELECT * FROM cwsi_results WHERE 1=1"
        params: List[Any] = []

        if start_timestamp:
            query += " AND timestamp >= ?"
            params.append(start_timestamp)

        if end_timestamp:
            query += " AND timestamp <= ?"
            params.append(end_timestamp)

        if sample_name_pattern:
            query += " AND sample_name LIKE ?"
            params.append(sample_name_pattern)

        query += " ORDER BY timestamp ASC"

        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(query, params)
            rows = cursor.fetchall()

            entries = []
            for row in rows:
                entries.append(CWSICacheEntry(
                    file_hash=row["file_hash"],
                    sample_name=row["sample_name"],
                    timestamp=row["timestamp"],
                    thermal_path=row["thermal_path"],
                    visible_path=row["visible_path"],
                    meteo_path=row["meteo_path"],
                    mean_tc=row["mean_tc"],
                    Tdry=row["Tdry"],
                    Twet=row["Twet"],
                    mean_cwsi=row["mean_cwsi"],
                    std_cwsi=row["std_cwsi"],
                    cv_cwsi=row["cv_cwsi"],
                    canopy_area=row["canopy_area"],
                    threshold_used=row["threshold_used"],
                    alignment_inlier_ratio=row["alignment_inlier_ratio"],
                    error_message=row["error_message"],
                    created_at=row["created_at"],
                    updated_at=row["updated_at"],
                ))
        return entries

    def clear_cache(self):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM cwsi_results")
            conn.commit()

    def get_stats(self) -> Dict[str, Any]:
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM cwsi_results")
            total = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM cwsi_results WHERE error_message IS NULL")
            successful = cursor.fetchone()[0]

            cursor.execute("SELECT MIN(timestamp), MAX(timestamp) FROM cwsi_results")
            min_max = cursor.fetchone()

            return {
                "total_entries": total,
                "successful_entries": successful,
                "failed_entries": total - successful,
                "earliest_timestamp": min_max[0],
                "latest_timestamp": min_max[1],
            }
