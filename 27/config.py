from pathlib import Path

CLASSES = [
    "glass_break",
    "dog_bark",
    "knock",
    "car_horn",
    "baby_cry",
]

MODEL_PATH = Path(__file__).parent / "model" / "audio_classifier.onnx"

TARGET_SAMPLE_RATE = 16000
WINDOW_SIZE_SECONDS = 2.0
HOP_SIZE_SECONDS = 1.0

N_MELS = 64
N_FFT = 2048
HOP_LENGTH = 256
F_MIN = 20
F_MAX = 8000

TARGET_TIME_STEPS = 128

CONFIDENCE_THRESHOLD = 0.7
MERGE_GAP_SECONDS = 0.5

MAX_WORKERS = 4
QUEUE_TIMEOUT = 0.1

INFERENCE_TIME_WINDOW = 100
