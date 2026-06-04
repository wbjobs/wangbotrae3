import asyncio
import time
from collections import deque
from typing import List, Dict, Any, Optional

import numpy as np

from config import MAX_WORKERS, INFERENCE_TIME_WINDOW, CLASSES, QUEUE_TIMEOUT
from model import AudioClassifier
from audio import process_audio
from postprocess import process_predictions
from model_manager import DualBufferModelManager


class InferenceRequest:
    __slots__ = ("audio_bytes", "result", "error", "done", "timestamp")

    def __init__(self, audio_bytes: bytes):
        self.audio_bytes = audio_bytes
        self.result: Optional[List[Dict[str, Any]]] = None
        self.error: Optional[str] = None
        self.done = asyncio.Event()
        self.timestamp = time.time()


class WorkerPool:
    def __init__(self, max_workers: int = MAX_WORKERS):
        self.max_workers = max_workers
        self.queue: asyncio.Queue[InferenceRequest | None] = asyncio.Queue(
            maxsize=max_workers
        )
        self.workers: List[asyncio.Task] = []
        self.inference_times: deque = deque(maxlen=INFERENCE_TIME_WINDOW)
        self._lock = asyncio.Lock()
        self._running = False
        self._model_manager = DualBufferModelManager()
        self._model_manager.set_num_workers(max_workers)
        self._model_manager.register_update_callback(self._on_model_updated)
        self._model_version: Optional[str] = None

    async def start(self) -> None:
        await self._model_manager.load_initial_model()
        self._running = True
        for i in range(self.max_workers):
            task = asyncio.create_task(self._worker(i))
            self.workers.append(task)
        self._model_version = self._model_manager.get_active_version()

    async def stop(self) -> None:
        self._running = False
        for _ in range(self.max_workers):
            await self.queue.put(None)
        for task in self.workers:
            if not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        self.workers = []
        await self._model_manager.close()

    async def submit(self, audio_bytes: bytes) -> List[Dict[str, Any]]:
        if not self._running:
            raise RuntimeError("Worker pool not started")

        request = InferenceRequest(audio_bytes)
        try:
            self.queue.put_nowait(request)
        except asyncio.QueueFull:
            raise TooManyRequestsError("Server busy, please try again later")

        await request.done.wait()

        if request.error:
            raise RuntimeError(request.error)

        return request.result or []

    def get_queue_size(self) -> int:
        return self.queue.qsize()

    def get_model_status(self) -> Dict[str, Any]:
        classifiers = self._model_manager.get_active_classifiers()
        if not classifiers:
            return {
                "loaded": False,
                "error": "No classifiers initialized",
            }
        loaded_count = sum(1 for c in classifiers if c.is_loaded)
        errors = [c.load_error for c in classifiers if c.load_error]
        rebuild_stats = [c.get_rebuild_stats() for c in classifiers]
        total_rebuilds = sum(s["total_rebuilds"] for s in rebuild_stats)
        model_manager_status = self._model_manager.get_status()
        return {
            "loaded": loaded_count == len(classifiers),
            "loaded_workers": loaded_count,
            "total_workers": len(classifiers),
            "errors": errors if errors else None,
            "total_session_rebuilds": total_rebuilds,
            "worker_rebuild_stats": rebuild_stats,
            "model_manager": model_manager_status,
            "active_version": self._model_version,
        }

    def get_average_inference_time(self) -> float:
        if not self.inference_times:
            return 0.0
        return sum(self.inference_times) / len(self.inference_times)

    def get_active_model_version(self) -> Optional[str]:
        return self._model_version

    def _on_model_updated(self) -> None:
        self._model_version = self._model_manager.get_active_version()

    def _get_classifier_for_worker(self, worker_id: int) -> AudioClassifier:
        classifiers = self._model_manager.get_active_classifiers()
        if not classifiers:
            raise RuntimeError("No active classifiers available")
        idx = worker_id % len(classifiers)
        return classifiers[idx]

    async def _worker(self, worker_id: int) -> None:
        while self._running:
            try:
                request = await self.queue.get()
                if request is None:
                    break

                try:
                    classifier = self._get_classifier_for_worker(worker_id)
                    result = await self._process_request(classifier, request)
                    request.result = result
                except Exception as e:
                    request.error = str(e)
                finally:
                    request.done.set()
                    self.queue.task_done()
            except asyncio.CancelledError:
                break
            except Exception:
                await asyncio.sleep(QUEUE_TIMEOUT)

    async def _process_request(
        self,
        classifier: AudioClassifier,
        request: InferenceRequest,
    ) -> List[Dict[str, Any]]:
        start_time = time.time()

        windows = await asyncio.to_thread(process_audio, request.audio_bytes)

        mel_specs = [w[0] for w in windows]
        time_info = [(w[1], w[2]) for w in windows]

        probabilities = await asyncio.to_thread(
            classifier.predict_batch,
            mel_specs,
        )

        window_predictions = []
        for i, (start_t, end_t) in enumerate(time_info):
            probs = probabilities[i]
            pred_class_idx = int(np.argmax(probs))
            pred_class = CLASSES[pred_class_idx]
            window_predictions.append((pred_class, start_t, end_t, probs))

        result = process_predictions(window_predictions)

        inference_time = time.time() - start_time
        async with self._lock:
            self.inference_times.append(inference_time)

        return result


class TooManyRequestsError(Exception):
    pass
