from datetime import datetime
from .celery_app import celery
from .database import SessionLocal
from .calculator import CarbonCalculator
from .report import generate_pdf_report
from .models import TaskStatus


@celery.task(bind=True)
def calculate_carbon_task(self, bom_id: int):
    db = SessionLocal()
    task_status = TaskStatus(
        task_id=self.request.id,
        task_type="carbon_calculation",
        status="processing"
    )
    db.add(task_status)
    db.commit()

    try:
        calculator = CarbonCalculator(db)
        result = calculator.calculate_bom_carbon(bom_id)

        task_status.status = "completed"
        task_status.result = str(result)
        task_status.completed_at = datetime.utcnow()
        db.commit()

        return result
    except Exception as e:
        task_status.status = "failed"
        task_status.error_message = str(e)
        task_status.completed_at = datetime.utcnow()
        db.commit()
        raise
    finally:
        db.close()


@celery.task(bind=True)
def generate_report_task(self, bom_id: int):
    db = SessionLocal()
    task_status = TaskStatus(
        task_id=self.request.id,
        task_type="pdf_report",
        status="processing"
    )
    db.add(task_status)
    db.commit()

    try:
        report_path = generate_pdf_report(bom_id, db)

        task_status.status = "completed"
        task_status.result = report_path
        task_status.completed_at = datetime.utcnow()
        db.commit()

        return {"report_path": report_path}
    except Exception as e:
        task_status.status = "failed"
        task_status.error_message = str(e)
        task_status.completed_at = datetime.utcnow()
        db.commit()
        raise
    finally:
        db.close()


@celery.task(bind=True)
def validate_bom_task(self, bom_id: int):
    db = SessionLocal()
    task_status = TaskStatus(
        task_id=self.request.id,
        task_type="bom_validation",
        status="processing"
    )
    db.add(task_status)
    db.commit()

    try:
        calculator = CarbonCalculator(db)
        result = calculator.validate_bom(bom_id)

        task_status.status = "completed"
        task_status.result = str(result)
        task_status.completed_at = datetime.utcnow()
        db.commit()

        return result
    except Exception as e:
        task_status.status = "failed"
        task_status.error_message = str(e)
        task_status.completed_at = datetime.utcnow()
        db.commit()
        raise
    finally:
        db.close()
