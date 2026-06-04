import asyncio
import threading
import shutil
import time
from pathlib import Path
from typing import Optional, Dict, Any, List, Callable
from datetime import datetime

from model import AudioClassifier
from config import MODEL_PATH


class ModelVersion:
    def __init__(self, version: str, model_path: Path):
        self.version = version
        self.model_path = model_path
        self.classifiers: List[AudioClassifier] = []
        self.ref_count = 0
        self.loaded = False
        self.created_at = time.time()

    async def load(self, num_workers: int) -> None:
        self.classifiers = []
        for _ in range(num_workers):
            clf = AudioClassifier(model_path=self.model_path)
            await asyncio.to_thread(clf.load)
            if not clf.is_loaded:
                raise RuntimeError(f"Failed to load model {self.version}: {clf.load_error}")
            self.classifiers.append(clf)
        self.loaded = True

    def is_ready(self) -> bool:
        return self.loaded and len(self.classifiers) > 0


class DualBufferModelManager:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._models_lock = asyncio.Lock()
        self._active_model: Optional[ModelVersion] = None
        self._staging_model: Optional[ModelVersion] = None
        self._base_model_path = MODEL_PATH
        self._model_dir = MODEL_PATH.parent
        self._num_workers = 4
        self._update_callbacks: List[Callable] = []
        self._initialized = True

    def set_num_workers(self, num_workers: int) -> None:
        self._num_workers = num_workers

    def register_update_callback(self, callback: Callable) -> None:
        self._update_callbacks.append(callback)

    async def load_initial_model(self) -> None:
        async with self._models_lock:
            version = f"v1.0.0_{int(time.time())}"
            self._active_model = ModelVersion(version, self._base_model_path)
            await self._active_model.load(self._num_workers)
            await self._notify_callbacks()

    def get_active_classifiers(self) -> List[AudioClassifier]:
        if self._active_model and self._active_model.is_ready():
            return self._active_model.classifiers
        return []

    def get_active_version(self) -> Optional[str]:
        if self._active_model:
            return self._active_model.version
        return None

    async def stage_new_model(self, new_model_path: Path, version: Optional[str] = None) -> str:
        if not new_model_path.exists():
            raise FileNotFoundError(f"Model file not found: {new_model_path}")

        if version is None:
            version = f"v{self._get_next_version()}_{int(time.time())}"

        staged_path = self._model_dir / f"staged_{version}.onnx"
        shutil.copy2(new_model_path, staged_path)

        async with self._models_lock:
            self._staging_model = ModelVersion(version, staged_path)
            await self._staging_model.load(self._num_workers)

        return version

    async def promote_staged_model(self) -> str:
        async with self._models_lock:
            if self._staging_model is None or not self._staging_model.is_ready():
                raise RuntimeError("No staged model ready")

            old_model = self._active_model
            new_model = self._staging_model

            final_path = self._model_dir / f"audio_classifier_{new_model.version}.onnx"
            shutil.copy2(new_model.model_path, final_path)
            shutil.copy2(new_model.model_path, self._base_model_path)

            new_model.model_path = self._base_model_path

            self._active_model = new_model
            self._staging_model = None

            await self._notify_callbacks()

            if old_model:
                asyncio.create_task(self._retire_model(old_model))

            return new_model.version

    async def _retire_model(self, model: ModelVersion) -> None:
        await asyncio.sleep(5.0)
        model.classifiers = []
        model.loaded = False
        try:
            staged_path = self._model_dir / f"staged_{model.version}.onnx"
            if staged_path.exists() and staged_path != self._base_model_path:
                staged_path.unlink(missing_ok=True)
        except Exception:
            pass

    async def hot_swap_model(self, new_model_path: Path, version: Optional[str] = None) -> str:
        await self.stage_new_model(new_model_path, version)
        return await self.promote_staged_model()

    async def _notify_callbacks(self) -> None:
        for callback in self._update_callbacks:
            try:
                if asyncio.iscoroutinefunction(callback):
                    await callback()
                else:
                    callback()
            except Exception:
                pass

    def _get_next_version(self) -> str:
        if self._active_model:
            try:
                parts = self._active_model.version.split(".")
                major = int(parts[0].lstrip("v"))
                minor = int(parts[1]) if len(parts) > 1 else 0
                patch = int(parts[2].split("_")[0]) if len(parts) > 2 else 0
                patch += 1
                return f"{major}.{minor}.{patch}"
            except Exception:
                pass
        return "1.0.1"

    def get_status(self) -> Dict[str, Any]:
        return {
            "active_version": self.get_active_version(),
            "active_loaded": self._active_model.is_ready() if self._active_model else False,
            "staging_version": self._staging_model.version if self._staging_model else None,
            "staging_ready": self._staging_model.is_ready() if self._staging_model else False,
            "num_workers": self._num_workers,
        }

    async def close(self) -> None:
        async with self._models_lock:
            if self._active_model:
                self._active_model.classifiers = []
                self._active_model.loaded = False
            if self._staging_model:
                self._staging_model.classifiers = []
                self._staging_model.loaded = False
