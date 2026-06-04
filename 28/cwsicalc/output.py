import os
import csv
import numpy as np
import cv2
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap, Normalize
from typing import Dict, Optional, Tuple
from dataclasses import dataclass


CWSI_COLORMAP = LinearSegmentedColormap.from_list(
    "cwsi",
    [
        (0.0, (0.0, 0.5, 1.0)),
        (0.3, (0.0, 1.0, 1.0)),
        (0.5, (0.0, 1.0, 0.0)),
        (0.7, (1.0, 1.0, 0.0)),
        (0.9, (1.0, 0.5, 0.0)),
        (1.0, (1.0, 0.0, 0.0)),
    ],
    N=256,
)


@dataclass
class CWSIResult:
    cwsi_map: np.ndarray
    canopy_mask: np.ndarray
    Tdry: float
    Twet: float
    mean_temp: float
    stats: Dict
    visible_img: Optional[np.ndarray] = None
    thermal_img: Optional[np.ndarray] = None
    aligned_thermal: Optional[np.ndarray] = None


class OutputGenerator:
    def __init__(
        self,
        output_dir: str,
        cmap: LinearSegmentedColormap = CWSI_COLORMAP,
        vmin: float = 0.0,
        vmax: float = 1.0,
    ):
        self.output_dir = output_dir
        self.cmap = cmap
        self.vmin = vmin
        self.vmax = vmax
        os.makedirs(output_dir, exist_ok=True)

    def generate_pseudocolor_map(
        self,
        result: CWSIResult,
        filename: str = "cwsi_map.png",
        include_colorbar: bool = True,
        dpi: int = 150,
    ) -> str:
        output_path = os.path.join(self.output_dir, filename)

        cwsi_display = result.cwsi_map.copy()
        cwsi_display[~result.canopy_mask] = np.nan

        fig, ax = plt.subplots(figsize=(10, 8))
        im = ax.imshow(
            cwsi_display,
            cmap=self.cmap,
            vmin=self.vmin,
            vmax=self.vmax,
            interpolation="nearest",
        )

        if include_colorbar:
            cbar = plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
            cbar.set_label("CWSI", fontsize=12)
            cbar.set_ticks([0.0, 0.2, 0.4, 0.6, 0.8, 1.0])
            cbar.set_ticklabels(["0.0\n(No Stress)", "0.2", "0.4", "0.6", "0.8", "1.0\n(Severe Stress)"])

        ax.set_title(f"CWSI Distribution\n(Tdry={result.Tdry:.1f}°C, Twet={result.Twet:.1f}°C)", fontsize=14)
        ax.set_xlabel("Pixel X", fontsize=10)
        ax.set_ylabel("Pixel Y", fontsize=10)
        ax.grid(True, alpha=0.3, linestyle="--")

        stats_text = (
            f"Mean CWSI: {result.stats['mean_cwsi']:.3f}\n"
            f"CV: {result.stats['cv_cwsi']:.3f}\n"
            f"Canopy Area: {result.stats['canopy_area_pixels']} px\n"
            f"Mean Temp: {result.mean_temp:.1f}°C"
        )
        ax.text(
            0.02,
            0.98,
            stats_text,
            transform=ax.transAxes,
            verticalalignment="top",
            bbox=dict(boxstyle="round", facecolor="white", alpha=0.8),
            fontsize=9,
        )

        plt.tight_layout()
        plt.savefig(output_path, dpi=dpi, bbox_inches="tight")
        plt.close()

        return output_path

    def generate_composite_image(
        self,
        result: CWSIResult,
        filename: str = "composite.png",
        dpi: int = 150,
    ) -> str:
        if result.visible_img is None or result.aligned_thermal is None:
            raise ValueError("Visible and aligned thermal images required for composite.")

        output_path = os.path.join(self.output_dir, filename)

        fig, axes = plt.subplots(2, 2, figsize=(14, 12))

        axes[0, 0].imshow(result.visible_img)
        axes[0, 0].set_title("Visible RGB Image", fontsize=12)
        axes[0, 0].axis("off")

        thermal_norm = Normalize(
            vmin=np.nanmin(result.aligned_thermal),
            vmax=np.nanmax(result.aligned_thermal),
        )
        im_thermal = axes[0, 1].imshow(result.aligned_thermal, cmap="inferno", norm=thermal_norm)
        axes[0, 1].set_title("Aligned Thermal Image", fontsize=12)
        axes[0, 1].axis("off")
        cbar_thermal = plt.colorbar(im_thermal, ax=axes[0, 1], fraction=0.046, pad=0.04)
        cbar_thermal.set_label("Temperature (°C)", fontsize=10)

        mask_overlay = result.visible_img.copy()
        mask_overlay[result.canopy_mask] = (
            mask_overlay[result.canopy_mask] * 0.5 + np.array([0, 255, 0]) * 0.5
        ).astype(np.uint8)
        axes[1, 0].imshow(mask_overlay)
        axes[1, 0].set_title("Canopy Mask Overlay", fontsize=12)
        axes[1, 0].axis("off")

        cwsi_display = result.cwsi_map.copy()
        cwsi_display[~result.canopy_mask] = np.nan
        im_cwsi = axes[1, 1].imshow(
            cwsi_display,
            cmap=self.cmap,
            vmin=self.vmin,
            vmax=self.vmax,
            interpolation="nearest",
        )
        axes[1, 1].set_title("CWSI Distribution", fontsize=12)
        axes[1, 1].axis("off")
        cbar_cwsi = plt.colorbar(im_cwsi, ax=axes[1, 1], fraction=0.046, pad=0.04)
        cbar_cwsi.set_label("CWSI", fontsize=10)

        plt.tight_layout()
        plt.savefig(output_path, dpi=dpi, bbox_inches="tight")
        plt.close()

        return output_path

    def save_csv(
        self,
        result: CWSIResult,
        filename: str = "cwsi_statistics.csv",
        sample_name: str = "sample",
        additional_fields: Optional[Dict] = None,
    ) -> str:
        output_path = os.path.join(self.output_dir, filename)

        row = {
            "sample_name": sample_name,
            "Tdry_C": f"{result.Tdry:.2f}",
            "Twet_C": f"{result.Twet:.2f}",
            "mean_canopy_temp_C": f"{result.mean_temp:.2f}",
            "mean_cwsi": f"{result.stats['mean_cwsi']:.4f}",
            "std_cwsi": f"{result.stats['std_cwsi']:.4f}",
            "cv_cwsi": f"{result.stats['cv_cwsi']:.4f}",
            "min_cwsi": f"{result.stats['min_cwsi']:.4f}",
            "max_cwsi": f"{result.stats['max_cwsi']:.4f}",
            "median_cwsi": f"{result.stats['median_cwsi']:.4f}",
            "canopy_area_pixels": f"{result.stats['canopy_area_pixels']}",
            "area_below_03_pixels": f"{result.stats['area_below_low']}",
            "area_low_stress_pixels": f"{result.stats['area_low_stress']}",
            "area_medium_stress_pixels": f"{result.stats['area_medium_stress']}",
            "area_high_stress_pixels": f"{result.stats['area_high_stress']}",
            "fraction_below_03": f"{result.stats['fraction_below_low']:.4f}",
            "fraction_low_stress": f"{result.stats['fraction_low_stress']:.4f}",
            "fraction_medium_stress": f"{result.stats['fraction_medium_stress']:.4f}",
            "fraction_high_stress": f"{result.stats['fraction_high_stress']:.4f}",
        }

        if additional_fields:
            row.update(additional_fields)

        file_exists = os.path.exists(output_path)

        with open(output_path, "a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=row.keys())
            if not file_exists:
                writer.writeheader()
            writer.writerow(row)

        return output_path

    def save_mask(
        self,
        result: CWSIResult,
        filename: str = "canopy_mask.png",
    ) -> str:
        output_path = os.path.join(self.output_dir, filename)
        mask_img = (result.canopy_mask.astype(np.uint8) * 255)
        cv2.imwrite(output_path, mask_img)
        return output_path

    def save_cwsi_numpy(
        self,
        result: CWSIResult,
        filename: str = "cwsi_map.npy",
    ) -> str:
        output_path = os.path.join(self.output_dir, filename)
        np.save(output_path, result.cwsi_map)
        return output_path


def save_batch_summary(
    results: Dict[str, CWSIResult],
    output_dir: str,
    filename: str = "batch_summary.csv",
) -> str:
    output_path = os.path.join(output_dir, filename)

    fieldnames = [
        "sample_name",
        "Tdry_C",
        "Twet_C",
        "mean_canopy_temp_C",
        "mean_cwsi",
        "std_cwsi",
        "cv_cwsi",
        "canopy_area_pixels",
        "fraction_below_03",
    ]

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()

        for name, result in results.items():
            row = {
                "sample_name": name,
                "Tdry_C": f"{result.Tdry:.2f}",
                "Twet_C": f"{result.Twet:.2f}",
                "mean_canopy_temp_C": f"{result.mean_temp:.2f}",
                "mean_cwsi": f"{result.stats['mean_cwsi']:.4f}",
                "std_cwsi": f"{result.stats['std_cwsi']:.4f}",
                "cv_cwsi": f"{result.stats['cv_cwsi']:.4f}",
                "canopy_area_pixels": f"{result.stats['canopy_area_pixels']}",
                "fraction_below_03": f"{result.stats['fraction_below_low']:.4f}",
            }
            writer.writerow(row)

    return output_path
