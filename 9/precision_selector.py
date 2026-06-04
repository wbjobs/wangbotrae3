import logging
import numpy as np
import cv2
from typing import Tuple, List
import time

from config import PrecisionType, GPU_MEMORY_THRESHOLD, VIDEO_COMPLEXITY_THRESHOLD

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False
    logger.warning("psutil not available")

try:
    import GPUtil
    GPUTIL_AVAILABLE = True
except ImportError:
    GPUTIL_AVAILABLE = False
    try:
        import gpustat
        GPUSTAT_AVAILABLE = True
    except ImportError:
        GPUSTAT_AVAILABLE = False
        logger.warning("GPU monitoring libraries not available")


class GPUMonitor:
    @staticmethod
    def get_gpu_info() -> dict:
        gpu_info = {
            "available": False,
            "load": 0.0,
            "memory_used": 0,
            "memory_total": 0,
            "memory_percent": 0.0,
            "temperature": 0.0
        }
        
        if GPUTIL_AVAILABLE:
            try:
                gpus = GPUtil.getGPUs()
                if gpus:
                    gpu = gpus[0]
                    gpu_info.update({
                        "available": True,
                        "load": gpu.load,
                        "memory_used": gpu.memoryUsed,
                        "memory_total": gpu.memoryTotal,
                        "memory_percent": gpu.memoryUsed / gpu.memoryTotal,
                        "temperature": gpu.temperature
                    })
            except Exception as e:
                logger.debug(f"GPUtil error: {e}")
        
        elif GPUSTAT_AVAILABLE:
            try:
                stats = gpustat.GPUStatCollection.new_query()
                if stats.gpus:
                    gpu = stats.gpus[0]
                    gpu_info.update({
                        "available": True,
                        "load": gpu.utilization / 100.0 if gpu.utilization else 0.0,
                        "memory_used": gpu.memory_used,
                        "memory_total": gpu.memory_total,
                        "memory_percent": gpu.memory_used / gpu.memory_total if gpu.memory_total else 0.0,
                        "temperature": gpu.temperature if gpu.temperature else 0.0
                    })
            except Exception as e:
                logger.debug(f"gpustat error: {e}")
        
        return gpu_info
    
    @staticmethod
    def get_cpu_info() -> dict:
        if not PSUTIL_AVAILABLE:
            return {"load": 0.0, "memory_percent": 0.0}
        
        return {
            "load": psutil.cpu_percent() / 100.0,
            "memory_percent": psutil.virtual_memory().percent / 100.0
        }


class VideoComplexityAnalyzer:
    @staticmethod
    def analyze_frame(frame: np.ndarray) -> dict:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        
        edges = cv2.Canny(gray, 50, 150)
        edge_density = np.sum(edges > 0) / (frame.shape[0] * frame.shape[1])
        
        hist = cv2.calcHist([gray], [0], None, [256], [0, 256])
        hist_norm = hist / hist.sum()
        entropy = -np.sum(hist_norm * np.log2(hist_norm + 1e-10))
        
        mean_brightness = np.mean(gray)
        std_brightness = np.std(gray)
        
        return {
            "sharpness": laplacian_var,
            "edge_density": edge_density,
            "entropy": entropy,
            "mean_brightness": mean_brightness,
            "std_brightness": std_brightness
        }
    
    @staticmethod
    def aggregate_metrics(metrics_list: List[dict]) -> dict:
        if not metrics_list:
            return {"complexity_score": 0.5}
        
        sharpness_values = [m["sharpness"] for m in metrics_list]
        edge_values = [m["edge_density"] for m in metrics_list]
        entropy_values = [m["entropy"] for m in metrics_list]
        
        norm_sharpness = np.clip(np.mean(sharpness_values) / 500.0, 0, 1)
        norm_edges = np.clip(np.mean(edge_values) / 0.1, 0, 1)
        norm_entropy = np.clip((np.mean(entropy_values) - 4) / 4, 0, 1)
        
        complexity_score = (
            0.4 * norm_sharpness +
            0.35 * norm_edges +
            0.25 * norm_entropy
        )
        
        return {
            "complexity_score": float(complexity_score),
            "avg_sharpness": float(np.mean(sharpness_values)),
            "avg_edge_density": float(np.mean(edge_values)),
            "avg_entropy": float(np.mean(entropy_values))
        }


class DynamicPrecisionSelector:
    def __init__(self):
        self.gpu_monitor = GPUMonitor()
        self.complexity_analyzer = VideoComplexityAnalyzer()
        self._frame_metrics = []
    
    def add_frame_sample(self, frame: np.ndarray):
        if len(self._frame_metrics) < 10:
            metrics = self.complexity_analyzer.analyze_frame(frame)
            self._frame_metrics.append(metrics)
    
    def select_precision(self, force_precision: PrecisionType = None) -> Tuple[PrecisionType, bool]:
        if force_precision:
            return force_precision, self._can_use_tensorrt(force_precision)
        
        gpu_info = self.gpu_monitor.get_gpu_info()
        video_metrics = self.complexity_analyzer.aggregate_metrics(self._frame_metrics)
        complexity_score = video_metrics["complexity_score"]
        
        logger.info(f"GPU Load: {gpu_info['load']:.2f}, Memory: {gpu_info['memory_percent']:.2f}")
        logger.info(f"Video Complexity: {complexity_score:.2f}")
        
        if not gpu_info["available"]:
            logger.info("GPU not available, using FP32 on CPU")
            return "fp32", False
        
        if gpu_info["memory_percent"] > GPU_MEMORY_THRESHOLD:
            logger.info("GPU memory high, selecting INT8")
            return "int8", True
        
        if gpu_info["load"] > 0.7:
            if complexity_score > VIDEO_COMPLEXITY_THRESHOLD:
                logger.info("High GPU load but complex video, selecting FP16")
                return "fp16", True
            else:
                logger.info("High GPU load and simple video, selecting INT8")
                return "int8", True
        
        if complexity_score > 0.7:
            logger.info("Complex video, selecting FP32")
            return "fp32", True
        elif complexity_score > 0.4:
            logger.info("Medium complexity video, selecting FP16")
            return "fp16", True
        else:
            logger.info("Simple video, selecting INT8")
            return "int8", True
    
    def _can_use_tensorrt(self, precision: PrecisionType) -> bool:
        gpu_info = self.gpu_monitor.get_gpu_info()
        if not gpu_info["available"]:
            return False
        if gpu_info["memory_percent"] > GPU_MEMORY_THRESHOLD and precision != "int8":
            return False
        return True
    
    def estimate_performance(self, precision: PrecisionType, use_tensorrt: bool) -> dict:
        base_speed = {
            ("fp32", True): 1.0,
            ("fp16", True): 1.8,
            ("int8", True): 2.5,
            ("fp32", False): 0.3,
            ("fp16", False): 0.4,
            ("int8", False): 0.5,
        }
        
        quality_factor = {
            "fp32": 1.0,
            "fp16": 0.95,
            "int8": 0.85
        }
        
        return {
            "relative_speed": base_speed.get((precision, use_tensorrt), 0.5),
            "quality_factor": quality_factor.get(precision, 0.9),
            "memory_saving": {
                "fp32": 0,
                "fp16": 0.5,
                "int8": 0.75
            }[precision]
        }
    
    def reset(self):
        self._frame_metrics = []
