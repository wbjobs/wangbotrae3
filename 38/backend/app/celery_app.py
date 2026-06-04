import logging
import os
import asyncio

from celery import Celery

from app.config import get_settings

settings = get_settings()

logger = logging.getLogger(__name__)

celery_app = Celery(
    "industrial_diagnosis",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Shanghai",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=3600,
    task_soft_time_limit=3300,
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=1000,
    result_expires=86400,
)

celery_app.autodiscover_tasks(["app.tasks"])


def run_async(coro):
    loop = asyncio.get_event_loop()
    if loop.is_running():
        return asyncio.ensure_future(coro)
    else:
        return loop.run_until_complete(coro)


@celery_app.task(bind=True, name="process_batch_task", max_retries=3)
def process_batch_task(self, task_id: str):
    from app.services.diagnosis_service import diagnosis_service

    logger.info(f"Starting batch task: {task_id}")

    try:
        run_async(diagnosis_service.process_batch_task(task_id))
        logger.info(f"Batch task completed: {task_id}")
        return {"status": "success", "task_id": task_id}

    except Exception as e:
        logger.error(f"Batch task failed: {task_id}, error: {e}", exc_info=True)
        self.retry(exc=e, countdown=60)
        return {"status": "failed", "task_id": task_id, "error": str(e)}
