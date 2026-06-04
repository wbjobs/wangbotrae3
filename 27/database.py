import sqlite3
import threading
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime

from config import CLASSES

DB_PATH = Path(__file__).parent / "feedback.db"


class FeedbackDatabase:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._db_lock = threading.Lock()
        self._conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._create_tables()
        self._initialized = True

    def _create_tables(self) -> None:
        cursor = self._conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                audio_path TEXT NOT NULL,
                correct_class TEXT NOT NULL,
                wrong_start_time REAL,
                wrong_end_time REAL,
                correct_start_time REAL,
                correct_end_time REAL,
                confidence REAL,
                comment TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                processed INTEGER DEFAULT 0,
                processed_at TIMESTAMP
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS model_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                version TEXT NOT NULL,
                model_path TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                active INTEGER DEFAULT 0,
                feedback_count INTEGER DEFAULT 0
            )
        """)
        self._conn.commit()

    def add_feedback(
        self,
        audio_path: str,
        correct_class: str,
        wrong_start_time: Optional[float] = None,
        wrong_end_time: Optional[float] = None,
        correct_start_time: Optional[float] = None,
        correct_end_time: Optional[float] = None,
        confidence: Optional[float] = None,
        comment: Optional[str] = None,
    ) -> int:
        if correct_class not in CLASSES:
            raise ValueError(f"Invalid class: {correct_class}. Must be one of {CLASSES}")

        with self._db_lock:
            cursor = self._conn.cursor()
            cursor.execute("""
                INSERT INTO feedback (
                    audio_path, correct_class, wrong_start_time, wrong_end_time,
                    correct_start_time, correct_end_time, confidence, comment
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                audio_path, correct_class, wrong_start_time, wrong_end_time,
                correct_start_time, correct_end_time, confidence, comment
            ))
            self._conn.commit()
            return cursor.lastrowid

    def get_unprocessed_feedback(self, limit: int = 1000) -> List[Dict[str, Any]]:
        with self._db_lock:
            cursor = self._conn.cursor()
            cursor.execute("""
                SELECT * FROM feedback WHERE processed = 0 ORDER BY created_at ASC LIMIT ?
            """, (limit,))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    def mark_feedback_processed(self, feedback_ids: List[int]) -> None:
        if not feedback_ids:
            return
        with self._db_lock:
            cursor = self._conn.cursor()
            placeholders = ",".join("?" * len(feedback_ids))
            now = datetime.now().isoformat()
            cursor.execute(f"""
                UPDATE feedback SET processed = 1, processed_at = ?
                WHERE id IN ({placeholders})
            """, [now] + feedback_ids)
            self._conn.commit()

    def get_feedback_stats(self) -> Dict[str, Any]:
        with self._db_lock:
            cursor = self._conn.cursor()
            cursor.execute("SELECT COUNT(*) as total FROM feedback")
            total = cursor.fetchone()["total"]
            cursor.execute("SELECT COUNT(*) as unprocessed FROM feedback WHERE processed = 0")
            unprocessed = cursor.fetchone()["unprocessed"]
            cursor.execute("""
                SELECT correct_class, COUNT(*) as count
                FROM feedback
                GROUP BY correct_class
            """)
            class_counts = {row["correct_class"]: row["count"] for row in cursor.fetchall()}
            return {
                "total_feedback": total,
                "unprocessed_feedback": unprocessed,
                "class_distribution": class_counts,
            }

    def add_model_version(
        self,
        version: str,
        model_path: str,
        feedback_count: int = 0,
    ) -> int:
        with self._db_lock:
            cursor = self._conn.cursor()
            cursor.execute("UPDATE model_versions SET active = 0")
            cursor.execute("""
                INSERT INTO model_versions (version, model_path, active, feedback_count)
                VALUES (?, ?, 1, ?)
            """, (version, model_path, feedback_count))
            self._conn.commit()
            return cursor.lastrowid

    def get_active_model_version(self) -> Optional[Dict[str, Any]]:
        with self._db_lock:
            cursor = self._conn.cursor()
            cursor.execute("""
                SELECT * FROM model_versions WHERE active = 1 ORDER BY id DESC LIMIT 1
            """)
            row = cursor.fetchone()
            return dict(row) if row else None

    def get_model_history(self, limit: int = 10) -> List[Dict[str, Any]]:
        with self._db_lock:
            cursor = self._conn.cursor()
            cursor.execute("""
                SELECT * FROM model_versions ORDER BY id DESC LIMIT ?
            """, (limit,))
            return [dict(row) for row in cursor.fetchall()]

    def close(self) -> None:
        with self._db_lock:
            if self._conn:
                self._conn.close()
                self._conn = None
