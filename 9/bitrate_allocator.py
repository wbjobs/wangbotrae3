import logging
import numpy as np
import cv2
from typing import List, Dict, Any, Tuple

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ContentComplexityAnalyzer:
    def __init__(self):
        self._spatial_metrics: List[Dict[str, float]] = []
        self._temporal_metrics: List[Dict[str, float]] = []
        self._prev_gray: np.ndarray = None

    def analyze_spatial(self, frame: np.ndarray) -> Dict[str, float]:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape
        
        laplacian = cv2.Laplacian(gray, cv2.CV_64F)
        texture_richness = laplacian.var()
        
        sobel_x = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
        sobel_y = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
        gradient_mag = np.sqrt(sobel_x ** 2 + sobel_y ** 2)
        edge_density = np.sum(gradient_mag > 30) / (h * w)
        
        block_size = 8
        texture_map = np.zeros((h // block_size, w // block_size))
        for i in range(0, h - block_size, block_size):
            for j in range(0, w - block_size, block_size):
                block = gray[i:i + block_size, j:j + block_size]
                texture_map[i // block_size, j // block_size] = block.var()
        
        spatial_variance = np.var(texture_map)
        
        hist = cv2.calcHist([gray], [0], None, [256], [0, 256])
        hist_norm = hist / (hist.sum() + 1e-10)
        entropy = -np.sum(hist_norm * np.log2(hist_norm + 1e-10))
        
        metrics = {
            "texture_richness": float(texture_richness),
            "edge_density": float(edge_density),
            "spatial_variance": float(spatial_variance),
            "entropy": float(entropy)
        }
        self._spatial_metrics.append(metrics)
        
        return metrics

    def analyze_temporal(self, frame: np.ndarray) -> Dict[str, float]:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        if self._prev_gray is None:
            self._prev_gray = gray
            return {
                "motion_magnitude": 0.0,
                "motion_area_ratio": 0.0,
                "motion_vector_variance": 0.0
            }
        
        diff = cv2.absdiff(self._prev_gray, gray)
        motion_magnitude = np.mean(diff)
        
        motion_threshold = 15
        motion_mask = diff > motion_threshold
        motion_area_ratio = np.sum(motion_mask) / (gray.shape[0] * gray.shape[1])
        
        flow = cv2.calcOpticalFlowFarneback(
            self._prev_gray, gray, None,
            pyr_scale=0.5, levels=3, winsize=15,
            iterations=3, poly_n=5, poly_sigma=1.2, flags=0
        )
        flow_mag = np.sqrt(flow[:, :, 0] ** 2 + flow[:, :, 1] ** 2)
        motion_vector_variance = float(np.var(flow_mag))
        
        self._prev_gray = gray
        
        metrics = {
            "motion_magnitude": float(motion_magnitude),
            "motion_area_ratio": float(motion_area_ratio),
            "motion_vector_variance": motion_vector_variance
        }
        self._temporal_metrics.append(metrics)
        
        return metrics

    def analyze_frame(self, frame: np.ndarray) -> Dict[str, Any]:
        spatial = self.analyze_spatial(frame)
        temporal = self.analyze_temporal(frame)
        
        return {**spatial, **temporal}

    def get_chunk_complexity(
        self,
        frames: List[np.ndarray],
        sample_count: int = 5
    ) -> Dict[str, float]:
        if not frames:
            return {"spatial_score": 0.5, "temporal_score": 0.0, "combined_score": 0.5}
        
        step = max(1, len(frames) // sample_count)
        sampled = frames[::step][:sample_count]
        
        spatial_scores = []
        temporal_scores = []
        
        for frame in sampled:
            spatial = self.analyze_spatial(frame)
            temporal = self.analyze_temporal(frame)
            
            norm_texture = np.clip(spatial["texture_richness"] / 500.0, 0, 1)
            norm_edge = np.clip(spatial["edge_density"] / 0.15, 0, 1)
            norm_entropy = np.clip((spatial["entropy"] - 4) / 4, 0, 1)
            spatial_score = 0.4 * norm_texture + 0.35 * norm_edge + 0.25 * norm_entropy
            
            norm_motion_mag = np.clip(temporal["motion_magnitude"] / 20.0, 0, 1)
            norm_motion_area = np.clip(temporal["motion_area_ratio"] / 0.5, 0, 1)
            norm_flow_var = np.clip(temporal["motion_vector_variance"] / 50.0, 0, 1)
            temporal_score = 0.4 * norm_motion_mag + 0.35 * norm_motion_area + 0.25 * norm_flow_var
            
            spatial_scores.append(spatial_score)
            temporal_scores.append(temporal_score)
        
        avg_spatial = float(np.mean(spatial_scores))
        avg_temporal = float(np.mean(temporal_scores))
        combined = 0.6 * avg_spatial + 0.4 * avg_temporal
        
        return {
            "spatial_score": avg_spatial,
            "temporal_score": avg_temporal,
            "combined_score": float(np.clip(combined, 0, 1))
        }

    def reset(self):
        self._spatial_metrics = []
        self._temporal_metrics = []
        self._prev_gray = None


class DynamicBitrateAllocator:
    def __init__(self, bitrate_budget_mbps: float = 5.0):
        self.bitrate_budget_mbps = bitrate_budget_mbps
        self._chunk_complexities: List[Dict[str, float]] = []
        self._analyzer = ContentComplexityAnalyzer()

    @property
    def analyzer(self) -> ContentComplexityAnalyzer:
        return self._analyzer

    def analyze_chunk(self, frames: List[np.ndarray]) -> Dict[str, float]:
        complexity = self._analyzer.get_chunk_complexity(frames)
        self._chunk_complexities.append(complexity)
        return complexity

    def allocate_bitrates(self, chunk_frame_counts: List[int]) -> List[Dict[str, Any]]:
        if not self._chunk_complexities:
            n = len(chunk_frame_counts)
            uniform_alloc = self._allocate_uniform(n, chunk_frame_counts)
            return uniform_alloc
        
        n_chunks = len(chunk_frame_counts)
        complexities = self._chunk_complexities[:n_chunks]
        
        while len(complexities) < n_chunks:
            complexities.append({"combined_score": 0.5, "spatial_score": 0.5, "temporal_score": 0.0})
        
        scores = [c["combined_score"] for c in complexities]
        total_frames = sum(chunk_frame_counts)
        budget_bits = self.bitrate_budget_mbps * 1e6
        total_budget_bits = budget_bits * (total_frames / 30.0)
        
        min_bitrate = self.bitrate_budget_mbps * 0.3
        max_bitrate = self.bitrate_budget_mbps * 2.5
        
        weighted_scores = []
        for score, frame_count in zip(scores, chunk_frame_counts):
            weight = 0.3 + 0.7 * score
            weighted_scores.append(weight * frame_count)
        
        total_weight = sum(weighted_scores)
        
        allocations = []
        for i, (score, frame_count) in enumerate(zip(scores, chunk_frame_counts)):
            if total_weight > 0:
                chunk_budget = total_budget_bits * (weighted_scores[i] / total_weight)
            else:
                chunk_budget = total_budget_bits * (frame_count / total_frames)
            
            chunk_duration = frame_count / 30.0
            chunk_bitrate_bps = chunk_budget / chunk_duration if chunk_duration > 0 else budget_bits
            chunk_bitrate_mbps = chunk_bitrate_bps / 1e6
            
            chunk_bitrate_mbps = float(np.clip(chunk_bitrate_mbps, min_bitrate, max_bitrate))
            
            crf = self._bitrate_to_crf(chunk_bitrate_mbps, score)
            
            allocations.append({
                "bitrate_mbps": round(chunk_bitrate_mbps, 2),
                "crf": crf,
                "complexity_score": round(score, 3),
                "spatial_score": round(complexities[i]["spatial_score"], 3),
                "temporal_score": round(complexities[i]["temporal_score"], 3),
                "frame_count": frame_count
            })
        
        actual_total = sum(a["bitrate_mbps"] * a["frame_count"] for a in allocations)
        target_total = self.bitrate_budget_mbps * total_frames
        if actual_total > 0:
            scale = target_total / actual_total
            for alloc in allocations:
                adjusted = alloc["bitrate_mbps"] * scale
                alloc["bitrate_mbps"] = round(float(np.clip(adjusted, min_bitrate, max_bitrate)), 2)
                alloc["crf"] = self._bitrate_to_crf(alloc["bitrate_mbps"], alloc["complexity_score"])
        
        logger.info(f"Bitrate allocation for {n_chunks} chunks (budget: {self.bitrate_budget_mbps} Mbps):")
        for i, alloc in enumerate(allocations):
            logger.info(f"  Chunk {i}: {alloc['bitrate_mbps']} Mbps, CRF {alloc['crf']}, "
                       f"complexity={alloc['complexity_score']:.3f}")
        
        return allocations

    def _allocate_uniform(self, n_chunks: int, chunk_frame_counts: List[int]) -> List[Dict[str, Any]]:
        allocations = []
        for i in range(n_chunks):
            crf = self._bitrate_to_crf(self.bitrate_budget_mbps, 0.5)
            allocations.append({
                "bitrate_mbps": round(self.bitrate_budget_mbps, 2),
                "crf": crf,
                "complexity_score": 0.5,
                "spatial_score": 0.5,
                "temporal_score": 0.0,
                "frame_count": chunk_frame_counts[i]
            })
        return allocations

    def _bitrate_to_crf(self, bitrate_mbps: float, complexity: float) -> int:
        crf_base = 23.0
        
        if bitrate_mbps >= 15.0:
            crf_offset = -8
        elif bitrate_mbps >= 10.0:
            crf_offset = -5
        elif bitrate_mbps >= 7.0:
            crf_offset = -2
        elif bitrate_mbps >= 5.0:
            crf_offset = 0
        elif bitrate_mbps >= 3.0:
            crf_offset = 3
        elif bitrate_mbps >= 1.5:
            crf_offset = 6
        else:
            crf_offset = 10
        
        crf = crf_base + crf_offset
        crf = int(np.clip(crf, 10, 35))
        
        return crf

    def get_summary(self) -> Dict[str, Any]:
        if not self._chunk_complexities:
            return {
                "budget_mbps": self.bitrate_budget_mbps,
                "chunks_analyzed": 0
            }
        
        scores = [c["combined_score"] for c in self._chunk_complexities]
        return {
            "budget_mbps": self.bitrate_budget_mbps,
            "chunks_analyzed": len(self._chunk_complexities),
            "avg_complexity": round(float(np.mean(scores)), 3),
            "min_complexity": round(float(np.min(scores)), 3),
            "max_complexity": round(float(np.max(scores)), 3)
        }

    def reset(self):
        self._chunk_complexities = []
        self._analyzer.reset()
