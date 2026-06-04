import logging

from app.celery_app import celery_app, run_async

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="app.tasks.batch_tasks.process_batch_task", max_retries=3)
def process_batch_task(self, task_id: str):
    from app.services.diagnosis_service import diagnosis_service

    logger.info(f"Celery task started for batch task: {task_id}")

    try:
        run_async(diagnosis_service.process_batch_task(task_id))
        logger.info(f"Celery task completed for batch task: {task_id}")
        return {"status": "success", "task_id": task_id}

    except Exception as e:
        logger.error(f"Celery task failed for batch task: {task_id}, error: {e}", exc_info=True)
        retry_count = self.request.retries
        max_retries = self.max_retries or 3

        if retry_count < max_retries:
            logger.warning(f"Retrying batch task {task_id} (attempt {retry_count + 1}/{max_retries}")
            self.retry(exc=e, countdown=60 * (retry_count + 1))

        return {"status": "failed", "task_id": task_id, "error": str(e)}
