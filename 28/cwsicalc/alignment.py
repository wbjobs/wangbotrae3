import numpy as np
import cv2
from typing import Tuple, Optional


class ImageAligner:
    def __init__(
        self,
        method: str = "SIFT",
        min_match_count: int = 10,
        ransac_reproj_threshold: float = 3.0,
        ransac_max_iters: int = 1000,
        ransac_confidence: float = 0.995,
        min_inlier_ratio: float = 0.25,
        max_scale_change: float = 4.0,
        max_rotation_deg: float = 80.0,
    ):
        self.method = method.upper()
        self.min_match_count = min_match_count
        self.ransac_reproj_threshold = ransac_reproj_threshold
        self.ransac_max_iters = ransac_max_iters
        self.ransac_confidence = ransac_confidence
        self.min_inlier_ratio = min_inlier_ratio
        self.max_scale_change = max_scale_change
        self.max_rotation_deg = max_rotation_deg
        self._detector = self._create_detector()
        self._matcher = self._create_matcher()

    def _create_detector(self):
        if self.method == "SIFT":
            return cv2.SIFT_create(nfeatures=10000, contrastThreshold=0.02)
        elif self.method == "ORB":
            return cv2.ORB_create(nfeatures=10000, scaleFactor=1.2, nlevels=8)
        else:
            raise ValueError(f"Unsupported method: {self.method}. Use 'SIFT' or 'ORB'.")

    def _create_matcher(self):
        if self.method == "SIFT":
            index_params = dict(algorithm=1, trees=5)
            search_params = dict(checks=50)
            return cv2.FlannBasedMatcher(index_params, search_params)
        else:
            return cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)

    def _detect_and_compute(self, img: np.ndarray) -> Tuple:
        if len(img.shape) == 3:
            gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
        else:
            gray = img.copy()

        gray = cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX, dtype=cv2.CV_8U)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray = clahe.apply(gray)
        kp, des = self._detector.detectAndCompute(gray, None)
        return kp, des

    def _match_features(self, des1: np.ndarray, des2: np.ndarray):
        if self.method == "SIFT":
            matches = self._matcher.knnMatch(des1, des2, k=2)
            good = []
            for match_pair in matches:
                if len(match_pair) == 2:
                    m, n = match_pair
                    if m.distance < 0.75 * n.distance:
                        good.append(m)
            good = sorted(good, key=lambda x: x.distance)[:500]
            return good
        else:
            matches = self._matcher.knnMatch(des1, des2, k=2)
            good = []
            for match_pair in matches:
                if len(match_pair) == 2:
                    m, n = match_pair
                    if m.distance < 0.8 * n.distance:
                        good.append(m)
            good = sorted(good, key=lambda x: x.distance)[:500]
            return good

    def _validate_homography(self, H: np.ndarray, src_shape: Tuple, dst_shape: Tuple) -> bool:
        if H is None or H.shape != (3, 3):
            return False

        det = H[0, 0] * H[1, 1] - H[0, 1] * H[1, 0]
        if abs(det) < 0.1:
            return False

        scale1 = np.sqrt(H[0, 0] ** 2 + H[1, 0] ** 2)
        scale2 = np.sqrt(H[0, 1] ** 2 + H[1, 1] ** 2)
        if scale1 < 1.0 / self.max_scale_change or scale1 > self.max_scale_change:
            return False
        if scale2 < 1.0 / self.max_scale_change or scale2 > self.max_scale_change:
            return False

        rotation_rad = np.arctan2(-H[0, 1], H[0, 0])
        rotation_deg = abs(np.degrees(rotation_rad))
        if rotation_deg > self.max_rotation_deg:
            return False

        h_src, w_src = src_shape[:2]
        h_dst, w_dst = dst_shape[:2]
        corners = np.float32([
            [0, 0], [0, h_src - 1], [w_src - 1, h_src - 1], [w_src - 1, 0]
        ]).reshape(-1, 1, 2)
        transformed = cv2.perspectiveTransform(corners, H)

        min_x = np.min(transformed[:, 0, 0])
        max_x = np.max(transformed[:, 0, 0])
        min_y = np.min(transformed[:, 0, 1])
        max_y = np.max(transformed[:, 0, 1])

        if max_x < 0 or min_x > w_dst or max_y < 0 or min_y > h_dst:
            return False

        return True

    def align(
        self,
        source_img: np.ndarray,
        target_img: np.ndarray,
        source_kp: Optional[Tuple] = None,
        target_kp: Optional[Tuple] = None,
    ) -> Tuple[np.ndarray, np.ndarray, float]:
        if source_kp is None:
            kp1, des1 = self._detect_and_compute(source_img)
        else:
            kp1, des1 = source_kp

        if target_kp is None:
            kp2, des2 = self._detect_and_compute(target_img)
        else:
            kp2, des2 = target_kp

        if des1 is None or des2 is None or len(kp1) < 4 or len(kp2) < 4:
            raise ValueError("Not enough features detected for alignment.")

        good_matches = self._match_features(des1, des2)

        if len(good_matches) < self.min_match_count:
            raise ValueError(
                f"Not enough good matches ({len(good_matches)} < {self.min_match_count})."
            )

        src_pts = np.float32([kp1[m.queryIdx].pt for m in good_matches]).reshape(-1, 1, 2)
        dst_pts = np.float32([kp2[m.trainIdx].pt for m in good_matches]).reshape(-1, 1, 2)

        H, mask = cv2.findHomography(
            src_pts,
            dst_pts,
            cv2.RANSAC,
            ransacReprojThreshold=self.ransac_reproj_threshold,
            maxIters=self.ransac_max_iters,
            confidence=self.ransac_confidence,
        )

        if H is None:
            raise ValueError("Failed to compute homography matrix.")

        if not self._validate_homography(H, source_img.shape, target_img.shape):
            raise ValueError("Homography matrix failed validation.")

        inlier_count = int(np.sum(mask)) if mask is not None else 0
        inlier_ratio = inlier_count / len(mask) if mask is not None else 0.0

        if inlier_ratio < self.min_inlier_ratio:
            raise ValueError(
                f"RANSAC inlier ratio too low: {inlier_ratio:.3f} < {self.min_inlier_ratio}"
            )

        h, w = target_img.shape[:2]
        aligned = cv2.warpPerspective(
            source_img,
            H,
            (w, h),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REPLICATE,
        )

        return aligned, H, inlier_ratio

    def align_thermal_to_visible(
        self,
        thermal_img: np.ndarray,
        visible_img: np.ndarray,
    ) -> Tuple[np.ndarray, np.ndarray, float]:
        return self.align(thermal_img, visible_img)


def load_thermal_image(path: str) -> np.ndarray:
    import tifffile as tiff
    img = tiff.imread(path)
    if img.dtype != np.float32:
        img = img.astype(np.float32)
    return img


def load_visible_image(path: str) -> np.ndarray:
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"Could not load visible image from {path}")
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
