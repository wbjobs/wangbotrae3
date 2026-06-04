import os
import glob
import json
import logging
import traceback
from datetime import datetime
from typing import Dict, Optional, List, Tuple
import numpy as np

from .alignment import ImageAligner, load_thermal_image, load_visible_image
from .segmentation import CanopySegmenter, calculate_canopy_area
from .cwsi_calc import MeteorologicalParams, CWSICalculator as CWSICore, calculate_cwsi_statistics
from .output import OutputGenerator, CWSIResult, save_batch_summary


def setup_logger(output_dir: str, log_filename: str = "batch_errors.log") -> logging.Logger:
    logger = logging.getLogger("cwsicalc_batch")
    logger.setLevel(logging.DEBUG)

    if logger.handlers:
        logger.handlers.clear()

    os.makedirs(output_dir, exist_ok=True)
    log_path = os.path.join(output_dir, log_filename)

    file_handler = logging.FileHandler(log_path, mode="a", encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)

    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)

    formatter = logging.Formatter(
        "%(asctime)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    file_handler.setFormatter(formatter)
    console_handler.setFormatter(formatter)

    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

    return logger


class CWSICalculator:
    def __init__(
        self,
        alignment_method: str = "SIFT",
        green_threshold: Optional[float] = None,
        use_excess_green: bool = True,
        use_otsu: bool = True,
        otsu_bias: float = 0.0,
        low_stress_threshold: float = 0.3,
        medium_stress_threshold: float = 0.6,
        ransac_reproj_threshold: float = 3.0,
        min_inlier_ratio: float = 0.25,
    ):
        self.aligner = ImageAligner(
            method=alignment_method,
            ransac_reproj_threshold=ransac_reproj_threshold,
            min_inlier_ratio=min_inlier_ratio,
        )
        self.segmenter = CanopySegmenter(
            green_threshold=green_threshold,
            use_excess_green=use_excess_green,
            use_otsu=use_otsu,
            otsu_bias=otsu_bias,
        )
        self.thresholds = {
            "low": low_stress_threshold,
            "medium": medium_stress_threshold,
        }
        self.homography_cache: Dict[str, np.ndarray] = {}
        self.errors: List[Dict] = []

    def process_single(
        self,
        thermal_path: str,
        visible_path: str,
        meteo_path: str,
        output_dir: str,
        sample_name: Optional[str] = None,
        save_composite: bool = True,
        save_mask: bool = True,
        save_numpy: bool = False,
        skip_alignment: bool = False,
        logger: Optional[logging.Logger] = None,
        raise_on_error: bool = False,
    ) -> CWSIResult:
        if sample_name is None:
            sample_name = os.path.splitext(os.path.basename(thermal_path))[0]

        def log_error(message: str, error: Optional[Exception] = None):
            error_record = {
                "sample": sample_name,
                "timestamp": datetime.now().isoformat(),
                "message": message,
                "error": str(error) if error else None,
                "traceback": traceback.format_exc() if error else None,
            }
            self.errors.append(error_record)
            if logger:
                logger.error(f"[{sample_name}] {message}")
                if error:
                    logger.debug(f"[{sample_name}] Traceback: {traceback.format_exc()}")

        try:
            thermal_img = load_thermal_image(thermal_path)
        except Exception as e:
            msg = f"Failed to load thermal image: {thermal_path}"
            log_error(msg, e)
            if raise_on_error:
                raise ValueError(msg) from e
            raise

        try:
            visible_img = load_visible_image(visible_path)
        except Exception as e:
            msg = f"Failed to load visible image: {visible_path}"
            log_error(msg, e)
            if raise_on_error:
                raise ValueError(msg) from e
            raise

        try:
            params = MeteorologicalParams.from_json(meteo_path)
        except Exception as e:
            msg = f"Failed to load meteorological parameters: {meteo_path}"
            log_error(msg, e)
            if raise_on_error:
                raise ValueError(msg) from e
            raise

        if skip_alignment:
            aligned_thermal = self._resize_to_match(thermal_img, visible_img)
            if logger:
                logger.info(f"[{sample_name}] Skipping alignment, using resize")
        else:
            try:
                aligned_thermal, H, inlier_ratio = self.aligner.align_thermal_to_visible(
                    thermal_img, visible_img
                )
                self.homography_cache[sample_name] = H
                if logger:
                    logger.info(
                        f"[{sample_name}] Alignment successful, inlier ratio: {inlier_ratio:.3f}"
                    )
            except Exception as e:
                log_error(f"Alignment failed, using resize fallback: {e}", e)
                aligned_thermal = self._resize_to_match(thermal_img, visible_img)

        try:
            canopy_mask = self.segmenter.segment(visible_img)
            threshold_used = self.segmenter.last_threshold
            if logger:
                logger.info(
                    f"[{sample_name}] Segmentation complete, threshold: {threshold_used:.2f}, "
                    f"canopy pixels: {int(np.sum(canopy_mask))}"
                )
        except Exception as e:
            msg = "Segmentation failed"
            log_error(msg, e)
            if raise_on_error:
                raise ValueError(msg) from e
            raise

        canopy_pixel_count = int(np.sum(canopy_mask))
        if canopy_pixel_count == 0:
            msg = "No canopy pixels detected after segmentation"
            log_error(msg)
            if raise_on_error:
                raise ValueError(msg)

        try:
            masked_temp, mean_temp, std_temp = self.segmenter.extract_canopy_temperature(
                aligned_thermal, canopy_mask
            )
        except Exception as e:
            msg = "Failed to extract canopy temperature"
            log_error(msg, e)
            if raise_on_error:
                raise ValueError(msg) from e
            raise

        try:
            cwsi_calc = CWSICore(params)
            cwsi_map, Tdry, Twet = cwsi_calc.calculate_cwsi_pixelwise(
                aligned_thermal, canopy_mask
            )
            if logger:
                logger.info(
                    f"[{sample_name}] CWSI computed: Tdry={Tdry:.2f}°C, Twet={Twet:.2f}°C"
                )
        except Exception as e:
            msg = "Failed to compute CWSI"
            log_error(msg, e)
            if raise_on_error:
                raise ValueError(msg) from e
            raise

        try:
            stats = calculate_cwsi_statistics(cwsi_map, canopy_mask, self.thresholds)
        except Exception as e:
            msg = "Failed to compute statistics"
            log_error(msg, e)
            if raise_on_error:
                raise ValueError(msg) from e
            raise

        result = CWSIResult(
            cwsi_map=cwsi_map,
            canopy_mask=canopy_mask,
            Tdry=Tdry,
            Twet=Twet,
            mean_temp=mean_temp if mean_temp is not None else float("nan"),
            stats=stats,
            visible_img=visible_img,
            thermal_img=thermal_img,
            aligned_thermal=aligned_thermal,
        )

        try:
            sample_output_dir = os.path.join(output_dir, sample_name)
            os.makedirs(sample_output_dir, exist_ok=True)
            output_gen = OutputGenerator(sample_output_dir)

            output_gen.generate_pseudocolor_map(
                result, filename=f"{sample_name}_cwsi_map.png"
            )
            output_gen.save_csv(
                result,
                filename="cwsi_statistics.csv",
                sample_name=sample_name,
                additional_fields={
                    "threshold_used": f"{threshold_used:.2f}" if threshold_used else "N/A",
                },
            )

            if save_composite:
                output_gen.generate_composite_image(
                    result, filename=f"{sample_name}_composite.png"
                )

            if save_mask:
                output_gen.save_mask(result, filename=f"{sample_name}_canopy_mask.png")

            if save_numpy:
                output_gen.save_cwsi_numpy(result, filename=f"{sample_name}_cwsi_map.npy")

            if logger:
                logger.info(
                    f"[{sample_name}] Output saved: mean_cwsi={stats['mean_cwsi']:.4f}"
                )
        except Exception as e:
            msg = "Failed to save output files"
            log_error(msg, e)
            if raise_on_error:
                raise ValueError(msg) from e
            raise

        return result

    def process_batch(
        self,
        input_dir: str,
        output_dir: str,
        thermal_pattern: str = "*_thermal.tif*",
        visible_pattern: str = "*_visible.jpg",
        meteo_pattern: str = "*_meteo.json",
        logger: Optional[logging.Logger] = None,
        **kwargs,
    ) -> Dict[str, CWSIResult]:
        os.makedirs(output_dir, exist_ok=True)

        if logger is None:
            logger = setup_logger(output_dir)

        self.errors.clear()

        thermal_files = sorted(glob.glob(os.path.join(input_dir, thermal_pattern)))
        visible_files = sorted(glob.glob(os.path.join(input_dir, visible_pattern)))
        meteo_files = sorted(glob.glob(os.path.join(input_dir, meteo_pattern)))

        if len(thermal_files) == 0:
            msg = f"No thermal files found matching {thermal_pattern} in {input_dir}"
            logger.error(msg)
            raise ValueError(msg)

        results: Dict[str, CWSIResult] = {}
        skipped: List[str] = []
        failed: List[str] = []

        logger.info("=" * 60)
        logger.info("Starting batch processing")
        logger.info("=" * 60)
        logger.info(
            f"Found {len(thermal_files)} thermal images, "
            f"{len(visible_files)} visible images, "
            f"{len(meteo_files)} meteo files"
        )
        logger.info(f"Input directory: {input_dir}")
        logger.info(f"Output directory: {output_dir}")
        logger.info("")

        for i, thermal_path in enumerate(thermal_files):
            sample_base = self._extract_sample_name(thermal_path)
            visible_path = self._find_matching_file(sample_base, visible_files, "visible")
            meteo_path = self._find_matching_file(sample_base, meteo_files, "meteo")

            logger.info("-" * 60)
            logger.info(f"Processing {i+1}/{len(thermal_files)}: {sample_base}")

            if visible_path is None or meteo_path is None:
                msg = f"Skipping {sample_base}: missing matching files"
                logger.warning(msg)
                if visible_path is None:
                    logger.warning(f"  - Missing visible image for {sample_base}")
                if meteo_path is None:
                    logger.warning(f"  - Missing meteorological data for {sample_base}")
                skipped.append(sample_base)
                continue

            try:
                result = self.process_single(
                    thermal_path=thermal_path,
                    visible_path=visible_path,
                    meteo_path=meteo_path,
                    output_dir=output_dir,
                    sample_name=sample_base,
                    logger=logger,
                    raise_on_error=False,
                    **kwargs,
                )
                results[sample_base] = result
                logger.info(f"✓ {sample_base}: SUCCESS")
            except Exception as e:
                msg = f"Error processing {sample_base}: {e}"
                logger.error(msg)
                logger.debug(f"Traceback: {traceback.format_exc()}")
                failed.append(sample_base)
                continue

        if len(results) > 0:
            try:
                save_batch_summary(results, output_dir)
                logger.info(f"Batch summary saved to: {os.path.join(output_dir, 'batch_summary.csv')}")
            except Exception as e:
                logger.error(f"Failed to save batch summary: {e}")

        if len(self.errors) > 0:
            error_summary_path = os.path.join(output_dir, "error_summary.json")
            try:
                with open(error_summary_path, "w", encoding="utf-8") as f:
                    json.dump(self.errors, f, indent=2, ensure_ascii=False)
                logger.info(f"Error details saved to: {error_summary_path}")
            except Exception as e:
                logger.error(f"Failed to save error summary: {e}")

        logger.info("")
        logger.info("=" * 60)
        logger.info("Batch processing complete")
        logger.info("=" * 60)
        logger.info(f"Total samples: {len(thermal_files)}")
        logger.info(f"Successfully processed: {len(results)}")
        logger.info(f"Skipped (missing files): {len(skipped)}")
        logger.info(f"Failed (errors): {len(failed)}")
        if skipped:
            logger.info(f"Skipped samples: {', '.join(skipped)}")
        if failed:
            logger.info(f"Failed samples: {', '.join(failed)}")
        logger.info(f"Success rate: {len(results)/len(thermal_files)*100:.1f}%")
        logger.info("=" * 60)

        return results

    @staticmethod
    def _extract_sample_name(path: str) -> str:
        base = os.path.basename(path)
        for suffix in ["_thermal.tif", "_thermal.tiff", "_thermal.TIF", "_thermal.TIFF"]:
            if base.endswith(suffix):
                return base[: -len(suffix)]
        for suffix in [".tif", ".tiff", ".TIF", ".TIFF", ".jpg", ".JPG", ".json"]:
            if base.endswith(suffix):
                return base[: -len(suffix)]
        return os.path.splitext(base)[0]

    @staticmethod
    def _find_matching_file(
        sample_name: str,
        file_list: List[str],
        file_type: str,
    ) -> Optional[str]:
        for f in file_list:
            base = os.path.basename(f)
            if sample_name in base or base.startswith(sample_name):
                return f

        for f in file_list:
            base = os.path.basename(f)
            base_no_ext = os.path.splitext(base)[0]
            for suffix in [f"_{file_type}", f".{file_type}"]:
                if base_no_ext.endswith(suffix):
                    prefix = base_no_ext[: -len(suffix)]
                    if prefix == sample_name or sample_name.startswith(prefix):
                        return f

        return None

    @staticmethod
    def _resize_to_match(source: np.ndarray, target: np.ndarray) -> np.ndarray:
        import cv2
        h, w = target.shape[:2]
        resized = cv2.resize(source, (w, h), interpolation=cv2.INTER_LINEAR)
        return resized
