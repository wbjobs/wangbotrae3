import os
import re
import glob
import json
import logging
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Tuple, Any
from dataclasses import dataclass
import numpy as np
from scipy import stats

from .database import CWSIDatabase, CWSICacheEntry
from .cwsicalc import CWSICalculator, setup_logger
from .output import CWSIResult


@dataclass
class TimeseriesPoint:
    timestamp: datetime
    sample_name: str
    thermal_path: str
    visible_path: str
    meteo_path: Optional[str]
    has_thermal: bool
    has_visible: bool
    has_meteo: bool
    is_complete: bool
    result: Optional[CWSICacheEntry] = None
    error_message: Optional[str] = None


@dataclass
class PredictionResult:
    future_dates: List[datetime]
    predicted_cwsi: List[float]
    prediction_ci_lower: List[float]
    prediction_ci_upper: List[float]
    slope: float
    intercept: float
    r_squared: float
    p_value: float
    std_error: float


class TimeSeriesAnalyzer:
    TIMESTAMP_PATTERN = re.compile(r"(\d{8})_(\d{4})")

    def __init__(
        self,
        input_dir: str,
        output_dir: str,
        db_path: Optional[str] = None,
        thermal_pattern: str = "*_thermal.tif*",
        visible_pattern: str = "*_rgb.jpg",
        meteo_pattern: str = "*_meteo.json",
        use_cache: bool = True,
        **kwargs,
    ):
        self.input_dir = input_dir
        self.output_dir = output_dir
        self.use_cache = use_cache

        if db_path is None:
            db_path = os.path.join(output_dir, "cwsicalc_cache.db")
        self.db = CWSIDatabase(db_path)

        self.thermal_pattern = thermal_pattern
        self.visible_pattern = visible_pattern
        self.meteo_pattern = meteo_pattern

        self.calculator = CWSICalculator(**kwargs)
        self.timeseries_points: List[TimeseriesPoint] = []
        self.skipped_points: List[TimeseriesPoint] = []

        os.makedirs(output_dir, exist_ok=True)

    def parse_timestamp(self, filename: str) -> Optional[datetime]:
        match = self.TIMESTAMP_PATTERN.search(filename)
        if match:
            date_str, time_str = match.groups()
            try:
                return datetime.strptime(f"{date_str}_{time_str}", "%Y%m%d_%H%M")
            except ValueError:
                return None
        return None

    def scan_files(self) -> List[TimeseriesPoint]:
        thermal_files = sorted(glob.glob(os.path.join(self.input_dir, self.thermal_pattern)))
        visible_files = sorted(glob.glob(os.path.join(self.input_dir, self.visible_pattern)))
        meteo_files = sorted(glob.glob(os.path.join(self.input_dir, self.meteo_pattern)))

        timestamp_groups: Dict[str, Dict[str, str]] = {}

        for f in thermal_files:
            ts = self.parse_timestamp(os.path.basename(f))
            if ts:
                key = ts.strftime("%Y%m%d_%H%M")
                if key not in timestamp_groups:
                    timestamp_groups[key] = {}
                timestamp_groups[key]["thermal"] = f

        for f in visible_files:
            ts = self.parse_timestamp(os.path.basename(f))
            if ts:
                key = ts.strftime("%Y%m%d_%H%M")
                if key not in timestamp_groups:
                    timestamp_groups[key] = {}
                timestamp_groups[key]["visible"] = f

        for f in meteo_files:
            ts = self.parse_timestamp(os.path.basename(f))
            if ts:
                key = ts.strftime("%Y%m%d_%H%M")
                if key not in timestamp_groups:
                    timestamp_groups[key] = {}
                timestamp_groups[key]["meteo"] = f

        points: List[TimeseriesPoint] = []
        for key in sorted(timestamp_groups.keys()):
            ts = datetime.strptime(key, "%Y%m%d_%H%M")
            files = timestamp_groups[key]

            has_thermal = "thermal" in files
            has_visible = "visible" in files
            has_meteo = "meteo" in files
            is_complete = has_thermal and has_visible and has_meteo

            point = TimeseriesPoint(
                timestamp=ts,
                sample_name=key,
                thermal_path=files.get("thermal", ""),
                visible_path=files.get("visible", ""),
                meteo_path=files.get("meteo"),
                has_thermal=has_thermal,
                has_visible=has_visible,
                has_meteo=has_meteo,
                is_complete=is_complete,
            )
            points.append(point)

        self.timeseries_points = points
        return points

    def _get_extra_params(self) -> Dict:
        return {
            "use_otsu": self.calculator.segmenter.use_otsu,
            "green_threshold": self.calculator.segmenter.green_threshold,
            "use_excess_green": self.calculator.segmenter.use_excess_green,
            "otsu_bias": self.calculator.segmenter.otsu_bias,
            "alignment_method": self.calculator.aligner.method,
            "ransac_threshold": self.calculator.aligner.ransac_reproj_threshold,
        }

    def process_timeseries(
        self,
        logger: Optional[logging.Logger] = None,
        skip_alignment: bool = False,
        **kwargs,
    ) -> List[TimeseriesPoint]:
        if logger is None:
            logger = setup_logger(self.output_dir, "timeseries.log")

        if not self.timeseries_points:
            self.scan_files()

        extra_params = self._get_extra_params()
        completed_count = 0
        skipped_count = 0
        cache_hits = 0
        cache_misses = 0

        logger.info("=" * 60)
        logger.info("Starting time series processing")
        logger.info("=" * 60)
        logger.info(f"Found {len(self.timeseries_points)} time points")

        for i, point in enumerate(self.timeseries_points):
            ts_str = point.timestamp.strftime("%Y-%m-%d %H:%M")
            logger.info("-" * 60)
            logger.info(f"Processing {i+1}/{len(self.timeseries_points)}: {ts_str}")

            if not point.is_complete:
                missing = []
                if not point.has_thermal:
                    missing.append("thermal")
                if not point.has_visible:
                    missing.append("visible")
                if not point.has_meteo:
                    missing.append("meteo")
                point.error_message = f"Missing files: {', '.join(missing)}"
                logger.warning(f"  Skipping - {point.error_message}")
                self.skipped_points.append(point)
                skipped_count += 1
                continue

            if self.use_cache:
                cached = self.db.get_entry(
                    point.thermal_path,
                    point.visible_path,
                    point.meteo_path,
                    extra_params,
                )
                if cached and cached.error_message is None:
                    point.result = cached
                    logger.info(f"  ✓ Loaded from cache (mean_cwsi={cached.mean_cwsi:.4f})")
                    cache_hits += 1
                    completed_count += 1
                    continue
                else:
                    cache_misses += 1

            try:
                result = self.calculator.process_single(
                    thermal_path=point.thermal_path,
                    visible_path=point.visible_path,
                    meteo_path=point.meteo_path,
                    output_dir=self.output_dir,
                    sample_name=point.sample_name,
                    skip_alignment=skip_alignment,
                    logger=logger,
                    raise_on_error=True,
                    **kwargs,
                )

                inlier_ratio = self.calculator.homography_cache.get(point.sample_name, None)
                if inlier_ratio is not None and isinstance(inlier_ratio, np.ndarray):
                    inlier_ratio = None

                threshold_used = self.calculator.segmenter.last_threshold

                cached_entry = self.db.save_entry(
                    thermal_path=point.thermal_path,
                    visible_path=point.visible_path,
                    meteo_path=point.meteo_path,
                    sample_name=point.sample_name,
                    timestamp=point.timestamp.isoformat(),
                    result=result,
                    extra_params=extra_params,
                    alignment_inlier_ratio=float(inlier_ratio) if inlier_ratio is not None else None,
                    threshold_used=float(threshold_used) if threshold_used is not None else None,
                )

                point.result = cached_entry
                logger.info(f"  ✓ Processed successfully (mean_cwsi={result.stats['mean_cwsi']:.4f})")
                completed_count += 1

            except Exception as e:
                point.error_message = str(e)
                logger.error(f"  ✗ Processing failed: {e}")

                self.db.save_entry(
                    thermal_path=point.thermal_path,
                    visible_path=point.visible_path,
                    meteo_path=point.meteo_path,
                    sample_name=point.sample_name,
                    timestamp=point.timestamp.isoformat(),
                    result=None,
                    error_message=str(e),
                    extra_params=extra_params,
                )

                self.skipped_points.append(point)
                skipped_count += 1
                continue

        logger.info("")
        logger.info("=" * 60)
        logger.info("Time series processing complete")
        logger.info("=" * 60)
        logger.info(f"Total time points: {len(self.timeseries_points)}")
        logger.info(f"Successfully processed: {completed_count}")
        logger.info(f"Skipped/Failed: {skipped_count}")
        if self.use_cache:
            logger.info(f"Cache hits: {cache_hits}")
            logger.info(f"Cache misses: {cache_misses}")
        logger.info(f"Success rate: {completed_count/len(self.timeseries_points)*100:.1f}%")
        logger.info("=" * 60)

        return self.timeseries_points

    def get_valid_timeseries(self) -> Tuple[List[datetime], List[float], List[float]]:
        timestamps: List[datetime] = []
        cwsi_values: List[float] = []
        std_values: List[float] = []

        for point in self.timeseries_points:
            if point.result and point.result.mean_cwsi is not None:
                timestamps.append(point.timestamp)
                cwsi_values.append(point.result.mean_cwsi)
                std_values.append(point.result.std_cwsi if point.result.std_cwsi is not None else 0.0)

        return timestamps, cwsi_values, std_values

    def predict_trend(
        self,
        days_ahead: int = 3,
        confidence_level: float = 0.95,
    ) -> Optional[PredictionResult]:
        timestamps, cwsi_values, _ = self.get_valid_timeseries()

        if len(timestamps) < 3:
            return None

        start_date = timestamps[0]
        x = np.array([(t - start_date).total_seconds() / 86400.0 for t in timestamps])
        y = np.array(cwsi_values)

        slope, intercept, r_value, p_value, std_err = stats.linregress(x, y)
        r_squared = r_value ** 2

        last_day = x[-1]
        future_x = np.array([last_day + i + 1 for i in range(days_ahead)])
        future_dates = [timestamps[-1] + timedelta(days=i + 1) for i in range(days_ahead)]

        predicted_y = slope * future_x + intercept

        y_pred = slope * x + intercept
        residuals = y - y_pred
        mse = np.sum(residuals ** 2) / (len(x) - 2)
        se = np.sqrt(mse)

        alpha = 1 - confidence_level
        t_crit = stats.t.ppf(1 - alpha / 2, len(x) - 2)

        ci_lower = []
        ci_upper = []
        for fx in future_x:
            x_mean = np.mean(x)
            s_pred = se * np.sqrt(
                1 + 1 / len(x) + (fx - x_mean) ** 2 / np.sum((x - x_mean) ** 2)
            )
            ci_lower.append(float(predicted_y[list(future_x).index(fx)] - t_crit * s_pred))
            ci_upper.append(float(predicted_y[list(future_x).index(fx)] + t_crit * s_pred))

        return PredictionResult(
            future_dates=future_dates,
            predicted_cwsi=list(predicted_y),
            prediction_ci_lower=ci_lower,
            prediction_ci_upper=ci_upper,
            slope=float(slope),
            intercept=float(intercept),
            r_squared=float(r_squared),
            p_value=float(p_value),
            std_error=float(std_err),
        )

    def generate_report(self) -> Dict[str, Any]:
        timestamps, cwsi_values, std_values = self.get_valid_timeseries()
        prediction = self.predict_trend(days_ahead=3)

        report = {
            "input_directory": self.input_dir,
            "output_directory": self.output_dir,
            "total_time_points": len(self.timeseries_points),
            "valid_time_points": len(timestamps),
            "skipped_time_points": len(self.skipped_points),
            "time_range": {
                "start": timestamps[0].isoformat() if timestamps else None,
                "end": timestamps[-1].isoformat() if timestamps else None,
            },
            "cwsi_statistics": {},
            "skipped_points": [],
            "prediction": None,
        }

        if timestamps:
            report["cwsi_statistics"] = {
                "mean": float(np.mean(cwsi_values)),
                "std": float(np.std(cwsi_values)),
                "min": float(np.min(cwsi_values)),
                "max": float(np.max(cwsi_values)),
                "median": float(np.median(cwsi_values)),
                "latest": float(cwsi_values[-1]),
                "trend": None,
            }

        if prediction:
            report["prediction"] = {
                "days_ahead": 3,
                "future_dates": [d.isoformat() for d in prediction.future_dates],
                "predicted_cwsi": prediction.predicted_cwsi,
                "prediction_ci_lower": prediction.prediction_ci_lower,
                "prediction_ci_upper": prediction.prediction_ci_upper,
                "linear_regression": {
                    "slope": prediction.slope,
                    "intercept": prediction.intercept,
                    "r_squared": prediction.r_squared,
                    "p_value": prediction.p_value,
                    "std_error": prediction.std_error,
                },
            }
            report["cwsi_statistics"]["trend"] = {
                "slope_per_day": prediction.slope,
                "r_squared": prediction.r_squared,
                "p_value": prediction.p_value,
                "direction": "increasing" if prediction.slope > 0 else "decreasing" if prediction.slope < 0 else "stable",
            }

        for point in self.skipped_points:
            report["skipped_points"].append({
                "timestamp": point.timestamp.isoformat(),
                "sample_name": point.sample_name,
                "error": point.error_message,
                "has_thermal": point.has_thermal,
                "has_visible": point.has_visible,
                "has_meteo": point.has_meteo,
            })

        return report

    def save_report(self, report: Optional[Dict] = None) -> str:
        if report is None:
            report = self.generate_report()

        report_path = os.path.join(self.output_dir, "timeseries_report.json")
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        return report_path
