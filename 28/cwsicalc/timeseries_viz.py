import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.dates import DateFormatter, DayLocator, HourLocator
from matplotlib.patches import Patch
from typing import Optional, Dict, Any, List, Tuple
from datetime import datetime

from .timeseries import TimeSeriesAnalyzer, PredictionResult, TimeseriesPoint
from .database import CWSICacheEntry
from .output import CWSI_COLORMAP


class TimeSeriesVisualizer:
    def __init__(self, output_dir: str):
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)

    def _get_cwsi_color(self, cwsi_value: float) -> Tuple[float, float, float]:
        norm_val = max(0.0, min(1.0, cwsi_value))
        return CWSI_COLORMAP(norm_val)

    def plot_timeseries(
        self,
        analyzer: TimeSeriesAnalyzer,
        prediction: Optional[PredictionResult] = None,
        show_error_bars: bool = True,
        show_tdry_twet: bool = True,
        filename: str = "cwsi_timeseries.png",
        dpi: int = 150,
    ) -> str:
        timestamps, cwsi_values, std_values = analyzer.get_valid_timeseries()

        if not timestamps:
            raise ValueError("No valid timeseries data available")

        if prediction is None:
            prediction = analyzer.predict_trend(days_ahead=3)

        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 10), gridspec_kw={"height_ratios": [3, 1]})
        fig.suptitle(
            "CWSI Time Series Analysis and Prediction",
            fontsize=16,
            fontweight="bold",
            y=0.98,
        )

        point_colors = [self._get_cwsi_color(v) for v in cwsi_values]

        ax1.plot(
            timestamps, cwsi_values,
            color="#1f77b4", linewidth=2, linestyle="-",
            label="Measured CWSI", zorder=3,
        )

        if show_error_bars and any(std_values):
            ax1.errorbar(
                timestamps, cwsi_values, yerr=std_values,
                fmt="none", ecolor="#1f77b4", elinewidth=1, capsize=3, alpha=0.5,
            )

        for ts, cwsi, color in zip(timestamps, cwsi_values, point_colors):
            ax1.scatter(
                ts, cwsi, s=80, color=color, edgecolor="white",
                linewidth=1.5, zorder=5,
            )

        if show_tdry_twet:
            tdry_values = []
            twet_values = []
            temp_timestamps = []
            for point in analyzer.timeseries_points:
                if point.result and point.result.Tdry is not None:
                    temp_timestamps.append(point.timestamp)
                    tdry_values.append(point.result.Tdry)
                    twet_values.append(point.result.Twet)

            if temp_timestamps:
                ax2_twin = ax2.twinx()
                ax2_twin.plot(
                    temp_timestamps, tdry_values,
                    color="#d62728", linewidth=1.5, linestyle="--",
                    marker="^", markersize=6, label="Tdry (°C)",
                )
                ax2_twin.plot(
                    temp_timestamps, twet_values,
                    color="#17becf", linewidth=1.5, linestyle="--",
                    marker="v", markersize=6, label="Twet (°C)",
                )
                ax2_twin.set_ylabel("Temperature (°C)", fontsize=10)
                ax2_twin.tick_params(axis="y", labelsize=9)
                ax2_twin.legend(loc="upper right", fontsize=9)

        if prediction and len(timestamps) >= 3:
            all_dates = timestamps + prediction.future_dates
            x_num = np.array([(d - timestamps[0]).total_seconds() / 86400.0 for d in all_dates])
            x_measured = x_num[:len(timestamps)]
            x_predicted = x_num[len(timestamps):]

            trend_line = prediction.slope * x_num + prediction.intercept
            predicted_vals = prediction.slope * x_predicted + prediction.intercept

            ax1.plot(
                all_dates, trend_line,
                color="#ff7f0e", linewidth=2, linestyle="--",
                label=f"Trend (slope={prediction.slope:+.4f}/day)",
                zorder=2,
            )

            ax1.plot(
                prediction.future_dates, prediction.predicted_cwsi,
                color="#ff7f0e", linewidth=2.5, linestyle="-",
                marker="s", markersize=8,
                label="Predicted CWSI",
                zorder=4,
            )

            ax1.fill_between(
                prediction.future_dates,
                prediction.prediction_ci_lower,
                prediction.prediction_ci_upper,
                color="#ff7f0e", alpha=0.2,
                label=f"95% Prediction Interval",
            )

            for i, (date, cwsi) in enumerate(zip(prediction.future_dates, prediction.predicted_cwsi)):
                color = self._get_cwsi_color(cwsi)
                ax1.scatter(
                    date, cwsi, s=100, color=color, edgecolor="#ff7f0e",
                    linewidth=2, zorder=6, marker="s",
                )
                ax1.annotate(
                    f"{cwsi:.3f}", (date, cwsi),
                    xytext=(0, 12), textcoords="offset points",
                    ha="center", fontsize=9, fontweight="bold",
                    color="#ff7f0e",
                )

        for ts, cwsi in zip(timestamps, cwsi_values):
            ax1.annotate(
                f"{cwsi:.3f}", (ts, cwsi),
                xytext=(0, 10), textcoords="offset points",
                ha="center", fontsize=8,
            )

        ax1.axhspan(0.0, 0.3, alpha=0.1, color="green", label="No Stress (<0.3)")
        ax1.axhspan(0.3, 0.6, alpha=0.1, color="yellow", label="Moderate Stress (0.3-0.6)")
        ax1.axhspan(0.6, 1.0, alpha=0.1, color="red", label="Severe Stress (>0.6)")

        for point in analyzer.skipped_points:
            ax1.axvline(
                point.timestamp, color="red", linestyle=":", linewidth=1,
                alpha=0.5,
            )
            ax1.annotate(
                "Skipped", (point.timestamp, ax1.get_ylim()[1]),
                xytext=(0, -5), textcoords="offset points",
                ha="center", fontsize=8, color="red", rotation=90,
            )

        ax1.set_ylabel("CWSI", fontsize=12)
        ax1.set_xlabel("Date", fontsize=12)
        ax1.set_ylim(-0.1, 1.1)
        ax1.grid(True, alpha=0.3, linestyle="--")
        ax1.tick_params(axis="both", labelsize=10)

        ax1.legend(
            loc="upper left", fontsize=9,
            bbox_to_anchor=(1.02, 1), borderaxespad=0,
        )

        date_formatter = DateFormatter("%m-%d")
        ax1.xaxis.set_major_formatter(date_formatter)
        if len(timestamps) > 7:
            ax1.xaxis.set_major_locator(DayLocator(interval=2))
        else:
            ax1.xaxis.set_major_locator(DayLocator())

        canopy_areas = []
        temp_stamps = []
        for point in analyzer.timeseries_points:
            if point.result and point.result.canopy_area is not None:
                temp_stamps.append(point.timestamp)
                canopy_areas.append(point.result.canopy_area)

        if temp_stamps:
            ax2.bar(
                temp_stamps, canopy_areas,
                width=0.6, color="#2ca02c", alpha=0.7,
                label="Canopy Area (pixels)",
            )
            ax2.set_ylabel("Canopy Area (px)", fontsize=10, color="#2ca02c")
            ax2.tick_params(axis="y", labelcolor="#2ca02c", labelsize=9)
            ax2.set_xlabel("Date", fontsize=10)
            ax2.grid(True, alpha=0.3, linestyle="--", axis="y")
            ax2.xaxis.set_major_formatter(date_formatter)
            if len(timestamps) > 7:
                ax2.xaxis.set_major_locator(DayLocator(interval=2))
            else:
                ax2.xaxis.set_major_locator(DayLocator())
        else:
            ax2.text(
                0.5, 0.5, "No canopy area data available",
                ha="center", va="center", transform=ax2.transAxes,
                fontsize=12, color="gray",
            )
            ax2.axis("off")

        plt.tight_layout(rect=[0, 0, 0.85, 0.96])

        output_path = os.path.join(self.output_dir, filename)
        plt.savefig(output_path, dpi=dpi, bbox_inches="tight")
        plt.close()

        return output_path

    def plot_prediction_detail(
        self,
        analyzer: TimeSeriesAnalyzer,
        prediction: Optional[PredictionResult] = None,
        filename: str = "prediction_detail.png",
        dpi: int = 150,
    ) -> str:
        timestamps, cwsi_values, _ = analyzer.get_valid_timeseries()

        if prediction is None:
            prediction = analyzer.predict_trend(days_ahead=3)

        if prediction is None or len(timestamps) < 3:
            raise ValueError("Insufficient data for prediction")

        fig, axes = plt.subplots(2, 2, figsize=(14, 10))
        fig.suptitle("CWSI Prediction and Trend Analysis", fontsize=14, fontweight="bold")

        ax_main = axes[0, 0]
        ax_main.plot(
            timestamps, cwsi_values, "o-", color="#1f77b4",
            linewidth=2, markersize=8, label="Measured",
        )

        all_dates = timestamps + prediction.future_dates
        x_num = np.array([(d - timestamps[0]).total_seconds() / 86400.0 for d in all_dates])
        trend_line = prediction.slope * x_num + prediction.intercept

        ax_main.plot(
            all_dates, trend_line, "--", color="#ff7f0e",
            linewidth=2, label="Linear Regression",
        )

        ax_main.errorbar(
            prediction.future_dates, prediction.predicted_cwsi,
            yerr=[
                np.array(prediction.predicted_cwsi) - np.array(prediction.prediction_ci_lower),
                np.array(prediction.prediction_ci_upper) - np.array(prediction.predicted_cwsi),
            ],
            fmt="s-", color="#ff7f0e", linewidth=2, markersize=8,
            capsize=5, label="Predicted (95% CI)",
        )

        ax_main.set_xlabel("Date", fontsize=11)
        ax_main.set_ylabel("CWSI", fontsize=11)
        ax_main.set_title("CWSI Trend and Prediction", fontsize=12)
        ax_main.grid(True, alpha=0.3)
        ax_main.legend(fontsize=9)
        date_formatter = DateFormatter("%m-%d")
        ax_main.xaxis.set_major_formatter(date_formatter)

        ax_resid = axes[0, 1]
        x_measured = x_num[:len(timestamps)]
        y_pred = prediction.slope * x_measured + prediction.intercept
        residuals = np.array(cwsi_values) - y_pred

        ax_resid.scatter(timestamps, residuals, color="#d62728", s=60, alpha=0.7)
        ax_resid.axhline(y=0, color="black", linestyle="--", linewidth=1)
        ax_resid.set_xlabel("Date", fontsize=11)
        ax_resid.set_ylabel("Residual", fontsize=11)
        ax_resid.set_title("Residual Analysis", fontsize=12)
        ax_resid.grid(True, alpha=0.3)
        ax_resid.xaxis.set_major_formatter(date_formatter)

        ax_dist = axes[1, 0]
        ax_dist.hist(
            cwsi_values, bins=min(8, len(timestamps)),
            density=True, color="#2ca02c", alpha=0.7, edgecolor="black",
        )
        ax_dist.set_xlabel("CWSI Value", fontsize=11)
        ax_dist.set_ylabel("Frequency", fontsize=11)
        ax_dist.set_title("CWSI Distribution", fontsize=12)
        ax_dist.grid(True, alpha=0.3, axis="y")

        for ax in [ax_main, ax_resid]:
            for label in ax.get_xticklabels():
                label.set_rotation(45)
                label.set_ha("right")

        ax_text = axes[1, 1]
        ax_text.axis("off")

        stats_text = (
            "┌─ Linear Regression Statistics ─┐\n"
            f"│ Slope:       {prediction.slope:+.6f} /day  │\n"
            f"│ Intercept:   {prediction.intercept:.4f}       │\n"
            f"│ R²:          {prediction.r_squared:.4f}       │\n"
            f"│ P-value:     {prediction.p_value:.4e}   │\n"
            f"│ Std Error:   {prediction.std_error:.4f}       │\n"
            "└─────────────────────────────────┘\n\n"
            "┌─ Predictions (95% CI) ─┐\n"
        )

        for i, (date, pred, lo, hi) in enumerate(zip(
            prediction.future_dates,
            prediction.predicted_cwsi,
            prediction.prediction_ci_lower,
            prediction.prediction_ci_upper,
        )):
            date_str = date.strftime("%Y-%m-%d")
            stress = "No Stress" if pred < 0.3 else "Mod. Stress" if pred < 0.6 else "Severe"
            stats_text += (
                f"│ D+{i+1} {date_str}                │\n"
                f"│   CWSI: {pred:.4f} [{lo:.3f}, {hi:.3f}] │\n"
                f"│   Status: {stress:<13}   │\n"
            )

        stats_text += "└─────────────────────────┘\n\n"

        mean_cwsi = np.mean(cwsi_values)
        trend_dir = "↑ Increasing" if prediction.slope > 0 else "↓ Decreasing" if prediction.slope < 0 else "→ Stable"
        stats_text += (
            "┌─ Time Series Summary ─┐\n"
            f"│ Data points:     {len(timestamps):>4d}   │\n"
            f"│ Mean CWSI:      {mean_cwsi:.4f}   │\n"
            f"│ Min/Max:     {min(cwsi_values):.3f}/{max(cwsi_values):.3f} │\n"
            f"│ Latest CWSI:    {cwsi_values[-1]:.4f}   │\n"
            f"│ Trend:       {trend_dir:<12} │\n"
            "└───────────────────────┘"
        )

        ax_text.text(
            0.05, 0.95, stats_text,
            transform=ax_text.transAxes,
            fontfamily="monospace",
            fontsize=10,
            verticalalignment="top",
            bbox=dict(boxstyle="round", facecolor="#f0f0f0", edgecolor="#999999", alpha=0.8),
        )

        plt.tight_layout()
        output_path = os.path.join(self.output_dir, filename)
        plt.savefig(output_path, dpi=dpi, bbox_inches="tight")
        plt.close()

        return output_path

    def plot_temperature_series(
        self,
        analyzer: TimeSeriesAnalyzer,
        filename: str = "temperature_series.png",
        dpi: int = 150,
    ) -> str:
        timestamps = []
        tc_values = []
        tdry_values = []
        twet_values = []

        for point in analyzer.timeseries_points:
            if point.result and point.result.mean_tc is not None:
                timestamps.append(point.timestamp)
                tc_values.append(point.result.mean_tc)
                tdry_values.append(point.result.Tdry)
                twet_values.append(point.result.Twet)

        if not timestamps:
            raise ValueError("No valid temperature data available")

        fig, ax = plt.subplots(figsize=(14, 6))

        ax.plot(
            timestamps, tdry_values,
            color="#d62728", linewidth=2, linestyle="--",
            marker="^", markersize=8, label="Tdry (Dry Reference)",
        )
        ax.plot(
            timestamps, twet_values,
            color="#17becf", linewidth=2, linestyle="--",
            marker="v", markersize=8, label="Twet (Wet Reference)",
        )
        ax.plot(
            timestamps, tc_values,
            color="#2ca02c", linewidth=2.5,
            marker="o", markersize=8, label="Tc (Canopy Temperature)",
        )

        ax.fill_between(
            timestamps, twet_values, tdry_values,
            alpha=0.2, color="gray",
            label="CWSI Reference Range",
        )

        for ts, tc, tdry, twet in zip(timestamps, tc_values, tdry_values, twet_values):
            cwsi = (tc - twet) / (tdry - twet) if (tdry - twet) > 0 else 0
            color = self._get_cwsi_color(cwsi)
            ax.scatter(ts, tc, s=100, color=color, edgecolor="white", linewidth=1.5)

        for ts, tc in zip(timestamps, tc_values):
            ax.annotate(
                f"{tc:.1f}°C", (ts, tc),
                xytext=(0, 10), textcoords="offset points",
                ha="center", fontsize=9,
            )

        ax.set_xlabel("Date", fontsize=12)
        ax.set_ylabel("Temperature (°C)", fontsize=12)
        ax.set_title("Temperature Time Series (Tc, Tdry, Twet)", fontsize=14)
        ax.grid(True, alpha=0.3, linestyle="--")
        ax.legend(fontsize=10, loc="best")
        ax.tick_params(axis="both", labelsize=10)

        date_formatter = DateFormatter("%m-%d")
        ax.xaxis.set_major_formatter(date_formatter)
        if len(timestamps) > 7:
            ax.xaxis.set_major_locator(DayLocator(interval=2))

        for label in ax.get_xticklabels():
            label.set_rotation(45)
            label.set_ha("right")

        plt.tight_layout()
        output_path = os.path.join(self.output_dir, filename)
        plt.savefig(output_path, dpi=dpi, bbox_inches="tight")
        plt.close()

        return output_path

    def generate_all_plots(
        self,
        analyzer: TimeSeriesAnalyzer,
        skip_prediction: bool = False,
        dpi: int = 150,
    ) -> Dict[str, str]:
        timestamps, cwsi_values, _ = analyzer.get_valid_timeseries()
        prediction = analyzer.predict_trend(days_ahead=3) if len(timestamps) >= 3 else None

        outputs = {}

        outputs["timeseries"] = self.plot_timeseries(
            analyzer, prediction=prediction, dpi=dpi,
        )

        if len(timestamps) >= 3 and prediction and not skip_prediction:
            outputs["prediction_detail"] = self.plot_prediction_detail(
                analyzer, prediction=prediction, dpi=dpi,
            )

        try:
            outputs["temperature_series"] = self.plot_temperature_series(
                analyzer, dpi=dpi,
            )
        except Exception:
            pass

        return outputs
