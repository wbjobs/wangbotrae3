import os
from pathlib import Path
from typing import Literal

BASE_DIR = Path(__file__).parent

MODEL_DIR = BASE_DIR / "models"
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
TEMP_DIR = BASE_DIR / "temp"

for dir_path in [MODEL_DIR, UPLOAD_DIR, OUTPUT_DIR, TEMP_DIR]:
    dir_path.mkdir(exist_ok=True, parents=True)

PrecisionType = Literal["fp32", "fp16", "int8"]
ModelType = Literal["espcn", "edsr"]
ScaleFactor = Literal[2, 4]

MAX_QUEUE_SIZE = 10
MAX_WORKERS = 2
MAX_VIDEO_DURATION = 600

GPU_MEMORY_THRESHOLD = 0.8
VIDEO_COMPLEXITY_THRESHOLD = 0.5

DEFAULT_BITRATE_BUDGET_MBPS = 5.0
MIN_BITRATE_BUDGET_MBPS = 0.5
MAX_BITRATE_BUDGET_MBPS = 50.0

ESPCN_MODELS = {
    2: MODEL_DIR / "espcn_x2.onnx",
    4: MODEL_DIR / "espcn_x4.onnx",
}

EDSR_MODELS = {
    2: MODEL_DIR / "edsr_x2.onnx",
    4: MODEL_DIR / "edsr_x4.onnx",
}

TENSORRT_ENGINE_DIR = MODEL_DIR / "tensorrt_engines"
TENSORRT_ENGINE_DIR.mkdir(exist_ok=True)
