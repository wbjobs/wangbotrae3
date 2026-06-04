import threading
from pathlib import Path
from typing import List

import numpy as np
import onnxruntime as ort

from config import MODEL_PATH, CLASSES

MAX_CONSECUTIVE_FAILURES = 3


class AudioClassifier:
    def __init__(self, model_path: Path = MODEL_PATH):
        self.model_path = model_path
        self.session: ort.InferenceSession | None = None
        self.input_name: str | None = None
        self.output_name: str | None = None
        self.input_shape: tuple | None = None
        self.is_loaded = False
        self.load_error: str | None = None

        self._lock = threading.Lock()
        self._consecutive_failures = 0
        self._total_rebuilds = 0

    def load(self) -> None:
        with self._lock:
            self._load_unsafe()

    def _load_unsafe(self) -> None:
        try:
            self.session = ort.InferenceSession(
                str(self.model_path),
                providers=["CPUExecutionProvider"],
            )
            self.input_name = self.session.get_inputs()[0].name
            self.output_name = self.session.get_outputs()[0].name
            self.input_shape = self.session.get_inputs()[0].shape
            self.is_loaded = True
            self.load_error = None
            self._consecutive_failures = 0
        except Exception as e:
            self.load_error = str(e)
            self.is_loaded = False
            raise

    def _rebuild_session(self) -> None:
        self.session = None
        self.is_loaded = False
        self._load_unsafe()
        self._total_rebuilds += 1
        self._consecutive_failures = 0

    def _handle_failure(self) -> None:
        self._consecutive_failures += 1
        if self._consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
            try:
                self._rebuild_session()
            except Exception:
                self._consecutive_failures = 0
                raise

    def _run_inference(self, input_data: np.ndarray) -> np.ndarray:
        if not self.is_loaded or self.session is None:
            raise RuntimeError("Model not loaded")

        try:
            outputs = self.session.run(
                [self.output_name],
                {self.input_name: input_data},
            )
            self._consecutive_failures = 0
            return outputs[0]
        except Exception:
            self._handle_failure()
            raise

    def predict(self, mel_spec: np.ndarray) -> np.ndarray:
        with self._lock:
            if not self.is_loaded or self.session is None:
                raise RuntimeError("Model not loaded")

            input_data = self._prepare_input(mel_spec)
            predictions = self._run_inference(input_data)
            if predictions.ndim == 2 and predictions.shape[0] == 1:
                predictions = predictions[0]
            probabilities = self._apply_activation(predictions)
            return probabilities

    def predict_batch(self, mel_specs: List[np.ndarray]) -> np.ndarray:
        with self._lock:
            if not self.is_loaded or self.session is None:
                raise RuntimeError("Model not loaded")

            batch = np.stack([self._prepare_input(ms)[0] for ms in mel_specs])
            predictions = self._run_inference(batch)
            probabilities = self._apply_activation(predictions)
            return probabilities

    def _prepare_input(self, mel_spec: np.ndarray) -> np.ndarray:
        if mel_spec.ndim == 2:
            input_data = mel_spec[np.newaxis, ...]
        elif mel_spec.ndim == 3:
            input_data = mel_spec
        else:
            input_data = mel_spec

        expected_dims = len(self.input_shape) if self.input_shape else 3
        while input_data.ndim < expected_dims:
            input_data = input_data[np.newaxis, ...]

        return input_data.astype(np.float32)

    def _apply_activation(self, predictions: np.ndarray) -> np.ndarray:
        if predictions.ndim == 1:
            max_val = np.max(predictions)
            exp_vals = np.exp(predictions - max_val)
            return exp_vals / np.sum(exp_vals)
        else:
            max_vals = np.max(predictions, axis=1, keepdims=True)
            exp_vals = np.exp(predictions - max_vals)
            return exp_vals / np.sum(exp_vals, axis=1, keepdims=True)

    def get_rebuild_stats(self) -> dict:
        with self._lock:
            return {
                "consecutive_failures": self._consecutive_failures,
                "total_rebuilds": self._total_rebuilds,
            }
