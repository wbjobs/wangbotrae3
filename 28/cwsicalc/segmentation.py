import numpy as np
import cv2
from typing import Tuple, Optional


class CanopySegmenter:
    def __init__(
        self,
        green_threshold: Optional[float] = None,
        use_excess_green: bool = True,
        use_otsu: bool = True,
        min_area: int = 100,
        morph_iterations: int = 2,
        otsu_bias: float = 0.0,
    ):
        self.green_threshold = green_threshold
        self.use_excess_green = use_excess_green
        self.use_otsu = use_otsu
        self.min_area = min_area
        self.morph_iterations = morph_iterations
        self.otsu_bias = otsu_bias
        self.last_threshold: Optional[float] = None

    def _compute_excess_green(self, visible_img: np.ndarray) -> np.ndarray:
        r = visible_img[:, :, 0].astype(np.float32)
        g = visible_img[:, :, 1].astype(np.float32)
        b = visible_img[:, :, 2].astype(np.float32)

        exg = 2 * g - r - b
        return exg

    def _compute_otsu_threshold(self, image: np.ndarray) -> float:
        if image.dtype != np.uint8:
            img_norm = cv2.normalize(image, None, 0, 255, cv2.NORM_MINMAX, dtype=cv2.CV_8U)
        else:
            img_norm = image.copy()

        blur = cv2.GaussianBlur(img_norm, (5, 5), 0)
        threshold, _ = cv2.threshold(
            blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )

        if image.dtype != np.uint8:
            orig_min = np.min(image)
            orig_max = np.max(image)
            if orig_max - orig_min > 1e-6:
                threshold = orig_min + (threshold / 255.0) * (orig_max - orig_min)

        threshold += self.otsu_bias
        return float(threshold)

    def _compute_otsu_threshold_multimodal(self, image: np.ndarray) -> float:
        if image.dtype != np.uint8:
            img_norm = cv2.normalize(image, None, 0, 255, cv2.NORM_MINMAX, dtype=cv2.CV_8U)
        else:
            img_norm = image.copy()

        blur = cv2.GaussianBlur(img_norm, (5, 5), 0)

        hist = cv2.calcHist([blur], [0], None, [256], [0, 256])
        hist = hist.ravel() / hist.sum()

        cumsum = np.cumsum(hist)
        cumsum_mean = np.cumsum(hist * np.arange(256))
        total_mean = cumsum_mean[-1]

        max_variance = 0
        best_threshold = 128
        for t in range(1, 255):
            w0 = cumsum[t]
            w1 = 1 - w0
            if w0 < 0.05 or w1 < 0.05:
                continue
            mean0 = cumsum_mean[t] / w0 if w0 > 0 else 0
            mean1 = (total_mean - cumsum_mean[t]) / w1 if w1 > 0 else 0
            variance = w0 * w1 * (mean0 - mean1) ** 2
            if variance > max_variance:
                max_variance = variance
                best_threshold = t

        if image.dtype != np.uint8:
            orig_min = np.min(image)
            orig_max = np.max(image)
            if orig_max - orig_min > 1e-6:
                best_threshold = orig_min + (best_threshold / 255.0) * (orig_max - orig_min)

        best_threshold += self.otsu_bias
        return float(best_threshold)

    def segment(self, visible_img: np.ndarray) -> np.ndarray:
        if len(visible_img.shape) != 3 or visible_img.shape[2] != 3:
            raise ValueError("Visible image must be an RGB image with 3 channels.")

        if self.use_excess_green:
            feature_map = self._compute_excess_green(visible_img)
        else:
            feature_map = visible_img[:, :, 1].astype(np.float32)

        if self.use_otsu and self.green_threshold is None:
            try:
                threshold = self._compute_otsu_threshold_multimodal(feature_map)
                self.last_threshold = threshold
            except Exception as e:
                print(f"Warning: Otsu thresholding failed ({e}), using fallback threshold=100.0")
                threshold = 100.0
                self.last_threshold = threshold
        else:
            threshold = self.green_threshold if self.green_threshold is not None else 100.0
            self.last_threshold = threshold

        mask = feature_map > threshold
        mask = mask.astype(np.uint8)

        if self.morph_iterations > 0:
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=self.morph_iterations)
            mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=self.morph_iterations)

        if self.min_area > 0:
            num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
            cleaned_mask = np.zeros_like(mask)
            for i in range(1, num_labels):
                area = stats[i, cv2.CC_STAT_AREA]
                if area >= self.min_area:
                    cleaned_mask[labels == i] = 1
            mask = cleaned_mask

        return mask.astype(bool)

    def extract_canopy_temperature(
        self,
        thermal_img: np.ndarray,
        canopy_mask: np.ndarray,
    ) -> Tuple[np.ndarray, Optional[float], Optional[float]]:
        if thermal_img.shape[:2] != canopy_mask.shape[:2]:
            raise ValueError(
                f"Shape mismatch: thermal {thermal_img.shape} vs mask {canopy_mask.shape}"
            )

        masked_temp = np.where(canopy_mask, thermal_img, np.nan)
        valid_temps = thermal_img[canopy_mask]

        if len(valid_temps) == 0:
            return masked_temp, None, None

        mean_temp = float(np.nanmean(valid_temps))
        std_temp = float(np.nanstd(valid_temps))

        return masked_temp, mean_temp, std_temp

    def refine_mask(
        self,
        mask: np.ndarray,
        thermal_img: np.ndarray,
        temp_range: Tuple[float, float] = (0.0, 50.0),
    ) -> np.ndarray:
        temp_min, temp_max = temp_range
        temp_mask = (thermal_img >= temp_min) & (thermal_img <= temp_max)
        refined = mask & temp_mask
        return refined


def apply_mask_to_thermal(
    thermal_img: np.ndarray,
    mask: np.ndarray,
    fill_value: float = np.nan,
) -> np.ndarray:
    if thermal_img.shape[:2] != mask.shape[:2]:
        raise ValueError(
            f"Shape mismatch: thermal {thermal_img.shape} vs mask {mask.shape}"
        )
    return np.where(mask, thermal_img, fill_value)


def calculate_canopy_area(
    mask: np.ndarray,
    pixel_size_m2: Optional[float] = None,
) -> Tuple[int, float]:
    pixel_count = int(np.sum(mask))
    if pixel_size_m2 is not None:
        area_m2 = pixel_count * pixel_size_m2
    else:
        area_m2 = float(pixel_count)
    return pixel_count, area_m2
