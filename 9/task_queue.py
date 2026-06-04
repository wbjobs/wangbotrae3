import logging
import uuid
import threading
import queue
import time
from pathlib import Path
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List
from datetime import datetime
from enum import Enum

from config import MAX_QUEUE_SIZE, MAX_WORKERS, UPLOAD_DIR, OUTPUT_DIR
from video_processor import VideoProcessor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class TaskStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class Task:
    task_id: str
    input_path: str
    model_type: str
    scale: int
    precision: Optional[str]
    bitrate_budget: Optional[float] = None
    status: TaskStatus = TaskStatus.PENDING
    progress: float = 0.0
    message: str = "Queued"
    result: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class TaskQueue:
    def __init__(self, max_workers: int = MAX_WORKERS):
        self.tasks: Dict[str, Task] = {}
        self.queue: queue.Queue = queue.Queue(maxsize=MAX_QUEUE_SIZE)
        self.max_workers = max_workers
        self.workers: List[threading.Thread] = []
        self._lock = threading.Lock()
        self._running = False
    
    def start(self):
        if self._running:
            return
        
        self._running = True
        for i in range(self.max_workers):
            worker = threading.Thread(target=self._worker_loop, daemon=True, name=f"worker-{i}")
            worker.start()
            self.workers.append(worker)
        
        logger.info(f"Task queue started with {self.max_workers} workers")
    
    def stop(self):
        self._running = False
        for worker in self.workers:
            worker.join(timeout=5)
        logger.info("Task queue stopped")
    
    def submit(
        self,
        input_path: str,
        model_type: str,
        scale: int,
        precision: Optional[str] = None,
        bitrate_budget: Optional[float] = None
    ) -> str:
        task_id = str(uuid.uuid4())
        
        task = Task(
            task_id=task_id,
            input_path=input_path,
            model_type=model_type,
            scale=scale,
            precision=precision,
            bitrate_budget=bitrate_budget
        )
        
        with self._lock:
            self.tasks[task_id] = task
        
        try:
            self.queue.put(task_id, block=False)
            logger.info(f"Task {task_id} submitted")
            return task_id
        except queue.Full:
            with self._lock:
                del self.tasks[task_id]
            raise RuntimeError("Task queue is full")
    
    def get_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            task = self.tasks.get(task_id)
        
        if not task:
            return None
        
        return {
            "task_id": task.task_id,
            "status": task.status.value,
            "progress": task.progress,
            "message": task.message,
            "created_at": task.created_at.isoformat() if task.created_at else None,
            "started_at": task.started_at.isoformat() if task.started_at else None,
            "completed_at": task.completed_at.isoformat() if task.completed_at else None,
            "result": task.result,
            "error": task.error
        }
    
    def cancel_task(self, task_id: str) -> bool:
        with self._lock:
            task = self.tasks.get(task_id)
            if not task or task.status in [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]:
                return False
            
            if task.status == TaskStatus.PENDING:
                task.status = TaskStatus.CANCELLED
                task.message = "Cancelled"
                return True
        
        return False
    
    def _worker_loop(self):
        while self._running:
            try:
                task_id = self.queue.get(timeout=1)
                self._process_task(task_id)
            except queue.Empty:
                    continue
            except Exception as e:
                logger.error(f"Worker error: {e}")
    
    def _process_task(self, task_id: str):
        with self._lock:
            task = self.tasks.get(task_id)
            if not task or task.status == TaskStatus.CANCELLED:
                return
            
            task.status = TaskStatus.PROCESSING
            task.started_at = datetime.now()
            task.message = "Starting processing"
        
        logger.info(f"Processing task {task_id}")
        
        def progress_callback(progress: float, message: str):
            with self._lock:
                if task_id in self.tasks:
                    self.tasks[task_id].progress = progress
                    self.tasks[task_id].message = message
        
        try:
            output_filename = f"{task_id}_output.mp4"
            output_path = str(OUTPUT_DIR / output_filename)
            
            processor = VideoProcessor(
                model_type=task.model_type,
                scale=task.scale,
                precision=task.precision,
                bitrate_budget=task.bitrate_budget
            )
            
            result = processor.process_video(
                input_path=task.input_path,
                output_path=output_path,
                progress_callback=progress_callback
            )
            
            processor.cleanup()
            
            with self._lock:
                if task_id in self.tasks:
                    self.tasks[task_id].status = TaskStatus.COMPLETED
                    self.tasks[task_id].progress = 1.0
                    self.tasks[task_id].message = "Completed"
                    self.tasks[task_id].result = result
                    self.tasks[task_id].completed_at = datetime.now()
            
            logger.info(f"Task {task_id} completed successfully")
            
        except Exception as e:
            logger.error(f"Task {task_id} failed: {e}", exc_info=True)
            with self._lock:
                if task_id in self.tasks:
                    self.tasks[task_id].status = TaskStatus.FAILED
                    self.tasks[task_id].message = "Failed"
                    self.tasks[task_id].error = str(e)
                    self.tasks[task_id].completed_at = datetime.now()
    
    def get_queue_size(self) -> int:
        return self.queue.qsize()
    
    def get_active_count(self) -> int:
        with self._lock:
            return sum(1 for t in self.tasks.values() if t.status == TaskStatus.PROCESSING)
    
    def cleanup_old_tasks(self, max_age_hours: int = 24):
        with self._lock:
            now = datetime.now()
            to_remove = []
            for task_id, task in self.tasks.items():
                if task.completed_at:
                    age = (now - task.completed_at).total_seconds() / 3600
                    if age > max_age_hours:
                        to_remove.append(task_id)
            
            for task_id in to_remove:
                del self.tasks[task_id]


_task_queue_instance = None


def get_task_queue() -> TaskQueue:
    global _task_queue_instance
    if _task_queue_instance is None:
        _task_queue_instance = TaskQueue()
        _task_queue_instance.start()
    return _task_queue_instance
