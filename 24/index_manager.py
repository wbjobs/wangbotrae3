from typing import List, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import or_
from hilbert import Hilbert
from database import Point, IndexConfig


class IndexManager:
    def __init__(self, db: Session):
        self.db = db
        self.config = self._load_config()
        self.hilbert = Hilbert(n=self.config.n_order, max_coord=1000)
        self._max_n = 12

    def _load_config(self) -> IndexConfig:
        config = self.db.query(IndexConfig).first()
        if not config:
            config = IndexConfig(n_order=8, threshold=10000, point_count=0)
            self.db.add(config)
            self.db.commit()
        return config

    def _save_config(self):
        self.db.commit()

    def _check_and_scale(self):
        if self.config.point_count > self.config.threshold:
            if self.config.n_order < self._max_n:
                self._rebuild_index(self.config.n_order + 1)
            else:
                self.config.threshold = int(self.config.threshold * 1.5)
                self._save_config()

    def _rebuild_index(self, new_n: int):
        new_hilbert = Hilbert(n=new_n, max_coord=1000)

        points = self.db.query(Point).all()
        for point in points:
            point.hilbert_code = new_hilbert.encode(int(point.x), int(point.y))

        self.config.n_order = new_n
        self.config.threshold = int(self.config.threshold * 1.5)
        self.hilbert = new_hilbert

        self.db.commit()

    def encode_point(self, x: int, y: int) -> int:
        return self.hilbert.encode(x, y)

    def insert_points(self, points: List[Tuple[int, int]]) -> List[dict]:
        results = []
        new_count = 0
        for x, y in points:
            code = self.encode_point(x, y)
            existing = self.db.query(Point).filter(
                Point.x == x, Point.y == y
            ).first()
            if existing:
                if existing.hilbert_code != code:
                    existing.hilbert_code = code
                results.append({"x": x, "y": y, "hilbert_code": code, "action": "updated"})
            else:
                db_point = Point(x=x, y=y, hilbert_code=code)
                self.db.add(db_point)
                new_count += 1
                results.append({"x": x, "y": y, "hilbert_code": code, "action": "inserted"})

        self.config.point_count += new_count
        self.db.commit()
        self._check_and_scale()
        return results

    def _compute_hilbert_intervals(self, x_min: int, x_max: int, y_min: int, y_max: int) -> List[Tuple[int, int]]:
        gx_min, gy_min = self.hilbert.coord_to_grid(x_min, y_min)
        gx_max, gy_max = self.hilbert.coord_to_grid(x_max, y_max)

        codes = set()
        for gx in range(gx_min, gx_max + 1):
            for gy in range(gy_min, gy_max + 1):
                codes.add(self.hilbert.encode_grid(gx, gy))

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

    def range_query(self, x_min: int, x_max: int, y_min: int, y_max: int, use_index: bool = True) -> List[dict]:
        if use_index:
            intervals = self._compute_hilbert_intervals(x_min, x_max, y_min, y_max)

            if not intervals:
                return []

            filters = []
            for lo, hi in intervals:
                filters.append(
                    (Point.hilbert_code >= lo) & (Point.hilbert_code <= hi)
                )

            candidates = self.db.query(Point).filter(or_(*filters)).all()

            results = []
            for p in candidates:
                if x_min <= p.x <= x_max and y_min <= p.y <= y_max:
                    results.append({"x": p.x, "y": p.y, "hilbert_code": p.hilbert_code})
            return results
        else:
            points = self.db.query(Point).filter(
                Point.x >= x_min, Point.x <= x_max,
                Point.y >= y_min, Point.y <= y_max
            ).all()
            return [{"x": p.x, "y": p.y, "hilbert_code": p.hilbert_code} for p in points]

    def neighbors_query(self, x: int, y: int, k: int = 10) -> List[dict]:
        target_code = self.hilbert.encode(x, y)
        max_index = self.hilbert.get_max_index()

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

            candidates = self.db.query(Point).filter(
                Point.hilbert_code >= current_lower,
                Point.hilbert_code <= current_upper
            ).all()

            candidates_with_dist = []
            for p in candidates:
                if p.x == x and p.y == y:
                    continue
                code_dist = abs(p.hilbert_code - target_code)
                euclid_dist = ((p.x - x) ** 2 + (p.y - y) ** 2) ** 0.5
                candidates_with_dist.append({
                    "x": p.x,
                    "y": p.y,
                    "hilbert_code": p.hilbert_code,
                    "code_distance": code_dist,
                    "euclidean_distance": round(euclid_dist, 2)
                })

            candidates_with_dist.sort(key=lambda p: (p["code_distance"], p["euclidean_distance"]))
            found = candidates_with_dist
            if len(found) >= k:
                break
            expansion += 1

        return found[:k]

    def get_stats(self) -> dict:
        return {
            "n_order": self.config.n_order,
            "threshold": self.config.threshold,
            "point_count": self.config.point_count,
            "max_hilbert_index": self.hilbert.get_max_index()
        }

    def linear_scan_range(self, x_min: int, x_max: int, y_min: int, y_max: int) -> List[dict]:
        points = self.db.query(Point).all()
        results = []
        for p in points:
            if x_min <= p.x <= x_max and y_min <= p.y <= y_max:
                results.append({"x": p.x, "y": p.y, "hilbert_code": p.hilbert_code})
        return results
