import sqlite3
import json
from uuid import uuid4
from datetime import datetime
from typing import Optional


DB_PATH = "pipeline_gpr.db"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            filename TEXT NOT NULL,
            status TEXT DEFAULT 'processing',
            point_count INTEGER DEFAULT 0,
            dielectric_constant REAL DEFAULT 6.0,
            filter_window REAL DEFAULT 5.0,
            fitting_threshold REAL DEFAULT 0.3,
            created_at TEXT NOT NULL
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS annotations (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            label TEXT NOT NULL,
            color TEXT DEFAULT '#FF8C42',
            box_min TEXT,
            box_max TEXT,
            points_json TEXT DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
    """)
    conn.commit()
    conn.close()


def create_project(name: str, filename: str, dielectric_constant: float = 6.0,
                   filter_window: float = 5.0, fitting_threshold: float = 0.3) -> dict:
    project_id = str(uuid4())
    now = datetime.utcnow().isoformat()
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO projects (id, name, filename, status, dielectric_constant, filter_window, fitting_threshold, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (project_id, name, filename, "processing", dielectric_constant, filter_window, fitting_threshold, now)
    )
    conn.commit()
    conn.close()
    return {
        "id": project_id,
        "name": name,
        "filename": filename,
        "status": "processing",
        "point_count": 0,
        "dielectric_constant": dielectric_constant,
        "filter_window": filter_window,
        "fitting_threshold": fitting_threshold,
        "created_at": now,
    }


def get_projects() -> list[dict]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_project(project_id: str) -> Optional[dict]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def update_project_status(project_id: str, status: str, point_count: int = 0) -> Optional[dict]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE projects SET status = ?, point_count = ? WHERE id = ?",
        (status, point_count, project_id)
    )
    conn.commit()
    conn.close()
    return get_project(project_id)


def delete_project(project_id: str) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    affected = cursor.rowcount
    conn.commit()
    conn.close()
    return affected > 0


def create_annotation(project_id: str, label: str, color: str = "#FF8C42",
                      box_min: Optional[list[float]] = None,
                      box_max: Optional[list[float]] = None,
                      points: Optional[list] = None) -> dict:
    annotation_id = str(uuid4())
    now = datetime.utcnow().isoformat()
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO annotations (id, project_id, label, color, box_min, box_max, points_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            annotation_id,
            project_id,
            label,
            color,
            json.dumps(box_min) if box_min else None,
            json.dumps(box_max) if box_max else None,
            json.dumps(points) if points else "[]",
            now,
            now,
        )
    )
    conn.commit()
    conn.close()
    return {
        "id": annotation_id,
        "project_id": project_id,
        "label": label,
        "color": color,
        "box_min": box_min,
        "box_max": box_max,
        "points": points or [],
        "created_at": now,
        "updated_at": now,
    }


def get_annotations(project_id: str) -> list[dict]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM annotations WHERE project_id = ? ORDER BY created_at", (project_id,))
    rows = cursor.fetchall()
    conn.close()
    results = []
    for row in rows:
        d = dict(row)
        d["box_min"] = json.loads(d["box_min"]) if d["box_min"] else None
        d["box_max"] = json.loads(d["box_max"]) if d["box_max"] else None
        d["points"] = json.loads(d["points_json"]) if d["points_json"] else []
        del d["points_json"]
        results.append(d)
    return results


def get_annotation(annotation_id: str) -> Optional[dict]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM annotations WHERE id = ?", (annotation_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    d["box_min"] = json.loads(d["box_min"]) if d["box_min"] else None
    d["box_max"] = json.loads(d["box_max"]) if d["box_max"] else None
    d["points"] = json.loads(d["points_json"]) if d["points_json"] else []
    del d["points_json"]
    return d


def update_annotation(annotation_id: str, label: Optional[str] = None, color: Optional[str] = None,
                      box_min: Optional[list[float]] = None, box_max: Optional[list[float]] = None,
                      points: Optional[list] = None) -> Optional[dict]:
    now = datetime.utcnow().isoformat()
    conn = get_connection()
    cursor = conn.cursor()
    existing = get_annotation(annotation_id)
    if not existing:
        conn.close()
        return None
    cursor.execute(
        "UPDATE annotations SET label = ?, color = ?, box_min = ?, box_max = ?, points_json = ?, updated_at = ? WHERE id = ?",
        (
            label if label is not None else existing["label"],
            color if color is not None else existing["color"],
            json.dumps(box_min) if box_min is not None else (json.dumps(existing["box_min"]) if existing["box_min"] else None),
            json.dumps(box_max) if box_max is not None else (json.dumps(existing["box_max"]) if existing["box_max"] else None),
            json.dumps(points) if points is not None else json.dumps(existing["points"]),
            now,
            annotation_id,
        )
    )
    conn.commit()
    conn.close()
    return get_annotation(annotation_id)


def delete_annotation(annotation_id: str) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM annotations WHERE id = ?", (annotation_id,))
    affected = cursor.rowcount
    conn.commit()
    conn.close()
    return affected > 0
