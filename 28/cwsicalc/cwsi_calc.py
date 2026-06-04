import json
import numpy as np
from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple
import math


@dataclass
class MeteorologicalParams:
    Ta: float
    RH: float
    wind_speed: float
    solar_radiation: float
    pressure: float = 101.325
    emissivity: float = 0.98
    stefan_boltzmann: float = 5.67e-8

    @classmethod
    def from_json(cls, json_path: str) -> "MeteorologicalParams":
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        required = ["Ta", "RH", "wind_speed", "solar_radiation"]
        for key in required:
            if key not in data:
                raise ValueError(f"Missing required meteorological parameter: {key}")

        return cls(
            Ta=float(data["Ta"]),
            RH=float(data["RH"]),
            wind_speed=float(data["wind_speed"]),
            solar_radiation=float(data["solar_radiation"]),
            pressure=float(data.get("pressure", 101.325)),
            emissivity=float(data.get("emissivity", 0.98)),
        )


class CWSICalculator:
    def __init__(
        self,
        params: MeteorologicalParams,
        ra: Optional[float] = None,
        rc_min: float = 10.0,
        rc_max: float = 200.0,
    ):
        self.params = params
        self.ra = ra if ra is not None else self._calculate_ra()
        self.rc_min = rc_min
        self.rc_max = rc_max

    def _calculate_ra(self) -> float:
        u = self.params.wind_speed
        h = 0.5
        z = 2.0
        d = 0.66 * h
        z0 = 0.123 * h
        k = 0.41
        u_star = u * k / math.log((z - d) / z0)
        ra = (math.log((z - d) / z0) * math.log((z - d) / (z0 / 10))) / (k ** 2 * u)
        return max(ra, 10.0)

    def _calculate_es(self, T: float) -> float:
        return 0.6108 * math.exp((17.27 * T) / (T + 237.3))

    def _calculate_delta(self, T: float) -> float:
        es = self._calculate_es(T)
        return (4098 * es) / (T + 237.3) ** 2

    def _calculate_gamma(self) -> float:
        cp = 1013.0
        epsilon = 0.622
        lambda_ = 2450000.0
        return (cp * self.params.pressure) / (epsilon * lambda_)

    def _calculate_ea(self) -> float:
        es = self._calculate_es(self.params.Ta)
        return self.params.RH / 100.0 * es

    def calculate_Tdry(self) -> float:
        Ta = self.params.Ta
        Rn = self.params.solar_radiation
        rho = 1.225
        cp = 1013.0
        ra = self.ra
        rc_max = self.rc_max

        delta = self._calculate_delta(Ta)
        gamma = self._calculate_gamma()

        numerator = Rn * (ra + rc_max)
        denominator = rho * cp * (delta + gamma * (1 + rc_max / ra))

        if abs(denominator) < 1e-6:
            return Ta + 5.0

        Tdry = Ta + numerator / denominator

        if Tdry > Ta + 20.0:
            Tdry = Ta + (Rn * rc_max) / (rho * cp)

        Tdry = min(max(Tdry, Ta + 2.0), Ta + 15.0)
        return Tdry

    def calculate_Twet(self) -> float:
        Ta = self.params.Ta
        Rn = self.params.solar_radiation
        rho = 1.225
        cp = 1013.0
        ea = self._calculate_ea()
        es = self._calculate_es(Ta)
        VPD = es - ea

        delta = self._calculate_delta(Ta)
        gamma = self._calculate_gamma()
        ra = self.ra
        rc_min = self.rc_min

        if delta < 1e-6:
            return Ta - 3.0

        term1 = (gamma * (ra + rc_min) * VPD) / (delta * ra + gamma * (ra + rc_min))
        term2 = (Rn * ra) / (rho * cp * (1 + delta / gamma))

        Twet = Ta - term1 - term2

        if Twet < Ta - 15.0 or Twet > Ta:
            Twet = Ta - (gamma * VPD) / delta
            Twet = max(Twet, Ta - 8.0)

        Twet = min(max(Twet, Ta - 10.0), Ta - 0.5)
        return Twet

    def calculate_cwsi_pixelwise(
        self,
        canopy_temp: np.ndarray,
        canopy_mask: Optional[np.ndarray] = None,
    ) -> Tuple[np.ndarray, float, float]:
        Tdry = self.calculate_Tdry()
        Twet = self.calculate_Twet()

        if Tdry <= Twet:
            Tdry = Twet + 0.1

        with np.errstate(invalid="ignore", divide="ignore"):
            cwsi = (canopy_temp - Tdry) / (Twet - Tdry)

        cwsi = np.clip(cwsi, -1.0, 2.0)

        if canopy_mask is not None:
            cwsi = np.where(canopy_mask, cwsi, np.nan)

        return cwsi, Tdry, Twet

    def calculate_cwsi_mean(
        self,
        canopy_temp: np.ndarray,
        canopy_mask: np.ndarray,
    ) -> Tuple[float, float, float, float]:
        cwsi_map, Tdry, Twet = self.calculate_cwsi_pixelwise(canopy_temp, canopy_mask)
        valid_cwsi = cwsi_map[canopy_mask]

        if len(valid_cwsi) == 0:
            return float("nan"), float("nan"), Tdry, Twet

        mean_cwsi = float(np.nanmean(valid_cwsi))
        std_cwsi = float(np.nanstd(valid_cwsi))

        return mean_cwsi, std_cwsi, Tdry, Twet


def calculate_cwsi_statistics(
    cwsi_map: np.ndarray,
    canopy_mask: np.ndarray,
    thresholds: Dict[str, float] = None,
) -> Dict:
    if thresholds is None:
        thresholds = {"low": 0.3, "medium": 0.6}

    valid_cwsi = cwsi_map[canopy_mask]
    total_pixels = int(np.sum(canopy_mask))

    if len(valid_cwsi) == 0:
        return {
            "mean_cwsi": float("nan"),
            "std_cwsi": float("nan"),
            "cv_cwsi": float("nan"),
            "min_cwsi": float("nan"),
            "max_cwsi": float("nan"),
            "median_cwsi": float("nan"),
            "canopy_area_pixels": 0,
            "area_below_low": 0,
            "area_above_high": 0,
            "area_low_stress": 0,
            "area_medium_stress": 0,
            "area_high_stress": 0,
            "fraction_below_low": 0.0,
            "fraction_low_stress": 0.0,
            "fraction_medium_stress": 0.0,
            "fraction_high_stress": 0.0,
        }

    mean_cwsi = float(np.nanmean(valid_cwsi))
    std_cwsi = float(np.nanstd(valid_cwsi))
    cv_cwsi = std_cwsi / mean_cwsi if mean_cwsi != 0 else float("nan")
    min_cwsi = float(np.nanmin(valid_cwsi))
    max_cwsi = float(np.nanmax(valid_cwsi))
    median_cwsi = float(np.nanmedian(valid_cwsi))

    low = thresholds.get("low", 0.3)
    medium = thresholds.get("medium", 0.6)

    area_below_low = int(np.sum(valid_cwsi < low))
    area_low = int(np.sum((valid_cwsi >= low) & (valid_cwsi < medium)))
    area_medium = int(np.sum((valid_cwsi >= medium) & (valid_cwsi < 1.0)))
    area_high = int(np.sum(valid_cwsi >= 1.0))
    area_above_high = int(np.sum(valid_cwsi > 1.0))

    frac_below_low = area_below_low / total_pixels if total_pixels > 0 else 0.0
    frac_low = area_low / total_pixels if total_pixels > 0 else 0.0
    frac_medium = area_medium / total_pixels if total_pixels > 0 else 0.0
    frac_high = area_high / total_pixels if total_pixels > 0 else 0.0

    return {
        "mean_cwsi": mean_cwsi,
        "std_cwsi": std_cwsi,
        "cv_cwsi": cv_cwsi,
        "min_cwsi": min_cwsi,
        "max_cwsi": max_cwsi,
        "median_cwsi": median_cwsi,
        "canopy_area_pixels": total_pixels,
        "area_below_low": area_below_low,
        "area_above_high": area_above_high,
        "area_low_stress": area_low,
        "area_medium_stress": area_medium,
        "area_high_stress": area_high,
        "fraction_below_low": frac_below_low,
        "fraction_low_stress": frac_low,
        "fraction_medium_stress": frac_medium,
        "fraction_high_stress": frac_high,
    }
