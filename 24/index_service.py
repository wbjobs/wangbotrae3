import threading
import time
from typing import List, Tuple, Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_
from hilbert import Hilbert
from database import Point, IndexConfig, ReindexStatus, SessionLocal


class GlobalIndexService:
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
        self._initialized = True
        self._hilberts = {
            4: Hilbert(n=4, max_coord=1000),
            6: Hilbert(n=6, max_coord=1000),
            8: Hilbert(n=8, max_coord=1000),
        }
        self._reindex_thread = None
        self._reindex_lock = threading.Lock()
        self._trigger_lock = threading.Lock()

    def get_hilbert(self, n: int) -> Hilbert:
        return self._hilberts[n]

    def get_active_n(self, db: Session) -> int:
        config = db.query(IndexConfig).first()
        return config.active_n_order if config else 4

    def _get_code_column(self, n: int):
        if n == 4:
            return Point.hilbert_code_n4
        elif n == 6:
            return Point.hilbert_code_n6
        elif n == 8:
            return Point.hilbert_code_n8
        raise ValueError(f"Unsupported N order: {n}")

    def _get_code_attr_name(self, n: int) -> str:
        return f"hilbert_code_n{n}"

    def _get_code_value(self, point: Point, n: int) -> Optional[int]:
        return getattr(point, self._get_code_attr_name(n))

    def _set_code_value(self, point: Point, n: int, code: int):
        setattr(point, self._get_code_attr_name(n), code)

    def _get_upgrade_threshold(self, current_n: int) -> Optional[int]:
        thresholds = {4: 1000, 6: 5000}
        return thresholds.get(current_n)

    def encode_point(self, x: int, y: int, n: Optional[int] = None) -> int:
        if n is None:
            db = SessionLocal()
            n = self.get_active_n(db)
            db.close()
        return self._hilberts[n].encode(x, y)

    def insert_points(self, db: Session, points: List[Tuple[int, int]]) -> List[dict]:
        config = db.query(IndexConfig).first()
        reindex_status = db.query(ReindexStatus).first()

        active_n = config.active_n_order
        dual_write_active = reindex_status.dual_write_active == 1
        reindex_running = reindex_status.is_running == 1

        write_orders = [active_n]
        if dual_write_active and reindex_running:
            target_n = reindex_status.to_n_order
            if target_n and target_n not in write_orders:
                write_orders.append(target_n)

        results = []
        new_count = 0
        seen = set()

        for x, y in points:
            if (x, y) in seen:
                active_code = self._hilberts[active_n].encode(x, y)
                results.append({
                    "x": x, "y": y,
                    "hilbert_code": active_code,
                    "action": "duplicate_in_batch",
                    "n_order": active_n
                })
                continue

            existing = db.query(Point).filter(
                Point.x == x, Point.y == y
            ).first()

            if existing:
                action = "updated"
                for n in write_orders:
                    code = self._hilberts[n].encode(x, y)
                    if self._get_code_value(existing, n) != code:
                        self._set_code_value(existing, n, code)
            else:
                action = "inserted"
                new_count += 1
                point = Point(x=x, y=y)
                for n in write_orders:
                    code = self._hilberts[n].encode(x, y)
                    self._set_code_value(point, n, code)
                db.add(point)
                seen.add((x, y))

            active_code = self._hilberts[active_n].encode(x, y)
            results.append({
                "x": x, "y": y,
                "hilbert_code": active_code,
                "action": action,
                "n_order": active_n
            })

        config.point_count += new_count
        db.commit()

        self._check_and_trigger_reindex(db)

        return results

    def _check_and_trigger_reindex(self, db: Session):
        with self._trigger_lock:
            config = db.query(IndexConfig).first()
            reindex_status = db.query(ReindexStatus).first()

            if reindex_status.is_running == 1:
                return

            threshold = self._get_upgrade_threshold(config.active_n_order)
            if threshold is None:
                return

            if config.point_count > threshold:
                target_n = None
                if config.active_n_order == 4:
                    target_n = 6
                elif config.active_n_order == 6:
                    target_n = 8

                if target_n:
                    self._start_async_reindex(db, config.active_n_order, target_n)

    def _start_async_reindex(self, db: Session, from_n: int, to_n: int):
        reindex_status = db.query(ReindexStatus).first()
        reindex_status.is_running = 1
        reindex_status.dual_write_active = 1
        reindex_status.from_n_order = from_n
        reindex_status.to_n_order = to_n
        reindex_status.total_points = db.query(Point).count()
        reindex_status.processed_points = 0
        reindex_status.progress_percent = 0.0
        reindex_status.error_message = None
        db.commit()

        self._reindex_thread = threading.Thread(
            target=self._run_reindex,
            args=(from_n, to_n),
            daemon=True
        )
        self._reindex_thread.start()

    def _run_reindex(self, from_n: int, to_n: int):
        try:
            db = SessionLocal()
            reindex_status = db.query(ReindexStatus).first()

            batch_size = 100
            offset = 0
            total = reindex_status.total_points

            while True:
                with self._reindex_lock:
                    points = db.query(Point).order_by(Point.id).limit(batch_size).offset(offset).all()
                    if not points:
                        break

                    target_hilbert = self._hilberts[to_n]
                    for point in points:
                        code = target_hilbert.encode(int(point.x), int(point.y))
                        self._set_code_value(point, to_n, code)

                    db.commit()

                    offset += len(points)
                    reindex_status.processed_points = offset
                    reindex_status.progress_percent = round((offset / total) * 100, 2) if total > 0 else 100.0
                    db.commit()

                time.sleep(0.01)

            self._finalize_reindex(db, from_n, to_n)

        except Exception as e:
            db = SessionLocal()
            reindex_status = db.query(ReindexStatus).first()
            reindex_status.is_running = 0
            reindex_status.error_message = str(e)
            db.commit()
            db.close()

    def _finalize_reindex(self, db: Session, from_n: int, to_n: int):
        with self._reindex_lock:
            config = db.query(IndexConfig).first()
            reindex_status = db.query(ReindexStatus).first()

            config.active_n_order = to_n

            reindex_status.is_running = 0
            reindex_status.dual_write_active = 0
            reindex_status.progress_percent = 100.0
            db.commit()

            self._cleanup_old_index(db, from_n)

    def _cleanup_old_index(self, db: Session, old_n: int):
        attr_name = self._get_code_attr_name(old_n)
        points = db.query(Point).all()
        for point in points:
            setattr(point, attr_name, None)
        db.commit()

    def _compute_hilbert_intervals(self, x_min: int, x_max: int, y_min: int, y_max: int, n: int) -> List[Tuple[int, int]]:
        hilbert = self._hilberts[n]
        gx_min, gy_min = hilbert.coord_to_grid(x_min, y_min)
        gx_max, gy_max = hilbert.coord_to_grid(x_max, y_max)

        codes = set()
        for gx in range(gx_min, gx_max + 1):
            for gy in range(gy_min, gy_max + 1):
                codes.add(hilbert.encode_grid(gx, gy))

        if not codes:
            return []

        sorted_codes = sorted(codes)
        intervals = []
        interval_start = sorted_codes[0]
        interval_end = sorted_codes[0]

        for c in sorted_codes[1:]:
            if c == interval_end + 1:
                interval_end = c
            else:
                intervals.append((interval_start, interval_end))
                interval_start = c
                interval_end = c
        intervals.append((interval_start, interval_end))

        return intervals

    def range_query(self, db: Session, x_min: int, x_max: int, y_min: int, y_max: int, use_index: bool = True) -> List[dict]:
        config = db.query(IndexConfig).first()
        active_n = config.active_n_order

        if use_index:
            intervals = self._compute_hilbert_intervals(x_min, x_max, y_min, y_max, active_n)

            if not intervals:
                return []

            code_column = self._get_code_column(active_n)
            filters = []
            for lo, hi in intervals:
                filters.append((code_column >= lo) & (code_column <= hi))

            candidates = db.query(Point).filter(or_(*filters)).all()

            results = []
            for p in candidates:
                if x_min <= p.x <= x_max and y_min <= p.y <= y_max:
                    results.append({
                        "x": p.x, "y": p.y,
                        "hilbert_code": self._get_code_value(p, active_n)
                    })
            return results
        else:
            points = db.query(Point).filter(
                Point.x >= x_min, Point.x <= x_max,
                Point.y >= y_min, Point.y <= y_max
            ).all()
            return [{
                "x": p.x, "y": p.y,
                "hilbert_code": self._get_code_value(p, active_n)
            } for p in points]

    def neighbors_query(self, db: Session, x: int, y: int, k: int = 10) -> List[dict]:
        config = db.query(IndexConfig).first()
        active_n = config.active_n_order
        hilbert = self._hilberts[active_n]
        target_code = hilbert.encode(x, y)
        max_index = hilbert.get_max_index()
        code_column = self._get_code_column(active_n)

        total_range = 2 * k + 1
        lower_undershoot = max(0, k - target_code)
        upper_overshoot = max(0, (target_code + k) - max_index)

        lower = max(0, target_code - k - upper_overshoot)
        upper = min(max_index, target_code + k + lower_undershoot)

        found = []
        expansion = 0
        max_expansion = 5

        while len(found) < k and expansion < max_expansion:
            current_lower = max(0, lower - (expansion * k))
            current_upper = min(max_index, upper + (expansion * k))

            candidates = db.query(Point).filter(
                code_column >= current_lower,
                code_column <= current_upper
            ).all()

            candidates_with_dist = []
            for p in candidates:
                if p.x == x and p.y == y:
                    continue
                p_code = self._get_code_value(p, active_n)
                code_dist = abs(p_code - target_code)
                euclid_dist = ((p.x - x) ** 2 + (p.y - y) ** 2) ** 0.5
                candidates_with_dist.append({
                    "x": p.x, "y": p.y,
                    "hilbert_code": p_code,
                    "code_distance": code_dist,
                    "euclidean_distance": round(euclid_dist, 2)
                })

            candidates_with_dist.sort(key=lambda p: (p["code_distance"], p["euclidean_distance"]))
            found = candidates_with_dist
            if len(found) >= k:
                break
            expansion += 1

        return found[:k]

    def get_stats(self, db: Session) -> dict:
        config = db.query(IndexConfig).first()
        active_n = config.active_n_order
        return {
            "active_n_order": active_n,
            "point_count": config.point_count,
            "max_hilbert_index": self._hilberts[active_n].get_max_index(),
            "supported_orders": list(self._hilberts.keys())
        }

    def get_reindex_status(self, db: Session) -> dict:
        status = db.query(ReindexStatus).first()
        return {
            "is_running": status.is_running == 1,
            "from_n_order": status.from_n_order,
            "to_n_order": status.to_n_order,
            "total_points": status.total_points,
            "processed_points": status.processed_points,
            "progress_percent": status.progress_percent,
            "dual_write_active": status.dual_write_active == 1,
            "error_message": status.error_message
        }

    def linear_scan_range(self, db: Session, x_min: int, x_max: int, y_min: int, y_max: int) -> List[dict]:
        config = db.query(IndexConfig).first()
        active_n = config.active_n_order
        points = db.query(Point).all()
        results = []
        for p in points:
            if x_min <= p.x <= x_max and y_min <= p.y <= y_max:
                results.append({
                    "x": p.x, "y": p.y,
                    "hilbert_code": self._get_code_value(p, active_n)
                })
        return results
