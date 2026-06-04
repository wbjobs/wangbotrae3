from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from influxdb_client import InfluxDBClient, Point, WriteOptions
from influxdb_client.client.write_api import SYNCHRONOUS

from config import settings
from models import (
    Base, DeviceData, TestCaseDB, InjectionRecordDB,
    InjectionRecordBase, Workflow, AnomalyTemplateDB
)


class DatabaseManager:
    def __init__(self):
        self._postgres_engine = None
        self._postgres_session = None
        self._influxdb_client = None
        self._influxdb_write_api = None
        self._influxdb_query_api = None
        self._influxdb_delete_api = None

    def connect(self):
        self._connect_postgres()
        self._connect_influxdb()
        self._create_influxdb_resources()

    def _connect_postgres(self):
        postgres_url = (
            f"postgresql://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}"
            f"@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}"
        )
        self._postgres_engine = create_engine(postgres_url, pool_pre_ping=True)
        Base.metadata.create_all(self._postgres_engine)
        self._postgres_session = sessionmaker(
            autocommit=False, autoflush=False, bind=self._postgres_engine
        )

    def _connect_influxdb(self):
        self._influxdb_client = InfluxDBClient(
            url=settings.INFLUXDB_URL,
            token=settings.INFLUXDB_TOKEN,
            org=settings.INFLUXDB_ORG
        )
        self._influxdb_write_api = self._influxdb_client.write_api(
            write_options=WriteOptions(batch_size=500, flush_interval=1000)
        )
        self._influxdb_query_api = self._influxdb_client.query_api()
        self._influxdb_delete_api = self._influxdb_client.delete_api()

    def _create_influxdb_resources(self):
        try:
            buckets_api = self._influxdb_client.buckets_api()
            bucket = buckets_api.find_bucket_by_name(settings.INFLUXDB_BUCKET)
            if bucket is None:
                org = self._influxdb_client.organizations_api().find_organizations(
                    org=settings.INFLUXDB_ORG
                )
                if org:
                    buckets_api.create_bucket(
                        bucket_name=settings.INFLUXDB_BUCKET,
                        org_id=org[0].id
                    )
        except Exception as e:
            print(f"Warning: Could not create InfluxDB resources: {e}")

    def get_postgres_session(self) -> Session:
        return self._postgres_session()

    def get_influxdb_client(self) -> InfluxDBClient:
        return self._influxdb_client

    def write_data_point(self, data: DeviceData, is_injected: bool = False):
        if not self._influxdb_write_api:
            return
        
        try:
            point = Point("device_data")\
                .tag("device_id", data.device_id)\
                .tag("is_injected", str(is_injected).lower())\
                .time(data.timestamp)
            
            if data.temperature is not None:
                point = point.field("temperature", data.temperature)
            if data.humidity is not None:
                point = point.field("humidity", data.humidity)
            if data.voltage is not None:
                point = point.field("voltage", data.voltage)
            if data.current is not None:
                point = point.field("current", data.current)
            if data.pressure is not None:
                point = point.field("pressure", data.pressure)
            
            self._influxdb_write_api.write(
                bucket=settings.INFLUXDB_BUCKET,
                org=settings.INFLUXDB_ORG,
                record=point
            )
        except Exception as e:
            print(f"Error writing to InfluxDB: {e}")

    def write_data_points(self, data_points: List[DeviceData], is_injected: bool = False):
        if not self._influxdb_write_api or not data_points:
            return
        
        try:
            points = []
            for data in data_points:
                point = Point("device_data")\
                    .tag("device_id", data.device_id)\
                    .tag("is_injected", str(is_injected).lower())\
                    .time(data.timestamp)
                
                if data.temperature is not None:
                    point = point.field("temperature", data.temperature)
                if data.humidity is not None:
                    point = point.field("humidity", data.humidity)
                if data.voltage is not None:
                    point = point.field("voltage", data.voltage)
                if data.current is not None:
                    point = point.field("current", data.current)
                if data.pressure is not None:
                    point = point.field("pressure", data.pressure)
                
                points.append(point)
            
            self._influxdb_write_api.write(
                bucket=settings.INFLUXDB_BUCKET,
                org=settings.INFLUXDB_ORG,
                record=points
            )
        except Exception as e:
            print(f"Error writing batch to InfluxDB: {e}")

    def save_test_case(self, workflow: Workflow, name: str, description: str = "") -> int:
        db = self.get_postgres_session()
        try:
            test_case = TestCaseDB(
                name=name,
                description=description,
                workflow_id=workflow.id,
                workflow_data=workflow.model_dump(mode="json"),
                device_ids=workflow.device_ids
            )
            db.add(test_case)
            db.commit()
            db.refresh(test_case)
            return test_case.id
        finally:
            db.close()

    def get_test_cases(self) -> List[Dict[str, Any]]:
        db = self.get_postgres_session()
        try:
            test_cases = db.query(TestCaseDB).order_by(TestCaseDB.created_at.desc()).all()
            return [
                {
                    "id": tc.id,
                    "name": tc.name,
                    "description": tc.description,
                    "workflow_id": tc.workflow_id,
                    "workflow_data": tc.workflow_data,
                    "device_ids": tc.device_ids,
                    "created_at": tc.created_at,
                    "updated_at": tc.updated_at
                }
                for tc in test_cases
            ]
        finally:
            db.close()

    def get_test_case(self, test_case_id: int) -> Optional[Dict[str, Any]]:
        db = self.get_postgres_session()
        try:
            tc = db.query(TestCaseDB).filter(TestCaseDB.id == test_case_id).first()
            if tc:
                return {
                    "id": tc.id,
                    "name": tc.name,
                    "description": tc.description,
                    "workflow_id": tc.workflow_id,
                    "workflow_data": tc.workflow_data,
                    "device_ids": tc.device_ids,
                    "created_at": tc.created_at,
                    "updated_at": tc.updated_at
                }
            return None
        finally:
            db.close()

    def delete_test_case(self, test_case_id: int) -> bool:
        db = self.get_postgres_session()
        try:
            tc = db.query(TestCaseDB).filter(TestCaseDB.id == test_case_id).first()
            if tc:
                db.delete(tc)
                db.commit()
                return True
            return False
        finally:
            db.close()

    def save_injection_record(self, record: InjectionRecordBase) -> int:
        db = self.get_postgres_session()
        try:
            db_record = InjectionRecordDB(
                workflow_id=record.workflow_id,
                device_id=record.device_id,
                anomaly_type=record.anomaly_type,
                parameters=record.parameters,
                start_time=record.start_time,
                end_time=record.end_time,
                original_data_count=record.original_data_count,
                affected_data_count=record.affected_data_count
            )
            db.add(db_record)
            db.commit()
            db.refresh(db_record)
            return db_record.id
        finally:
            db.close()

    def get_injection_records(
        self, device_id: Optional[str] = None, limit: int = 100
    ) -> List[Dict[str, Any]]:
        db = self.get_postgres_session()
        try:
            query = db.query(InjectionRecordDB)
            if device_id:
                query = query.filter(InjectionRecordDB.device_id == device_id)
            records = query.order_by(InjectionRecordDB.created_at.desc()).limit(limit).all()
            return [
                {
                    "id": r.id,
                    "workflow_id": r.workflow_id,
                    "device_id": r.device_id,
                    "anomaly_type": r.anomaly_type,
                    "parameters": r.parameters,
                    "start_time": r.start_time,
                    "end_time": r.end_time,
                    "original_data_count": r.original_data_count,
                    "affected_data_count": r.affected_data_count,
                    "created_at": r.created_at
                }
                for r in records
            ]
        finally:
            db.close()

    def close(self):
        if self._influxdb_write_api:
            self._influxdb_write_api.close()
        if self._influxdb_client:
            self._influxdb_client.close()
        if self._postgres_engine:
            self._postgres_engine.dispose()

    def save_template(self, template_id: str, name: str, description: str,
                      category: str, icon: str, workflow_data: Dict[str, Any],
                      default_parameters: Dict[str, Any] = None,
                      is_builtin: bool = False) -> int:
        db = self.get_postgres_session()
        try:
            existing = db.query(AnomalyTemplateDB).filter(
                AnomalyTemplateDB.template_id == template_id
            ).first()
            if existing:
                existing.name = name
                existing.description = description
                existing.category = category
                existing.icon = icon
                existing.workflow_data = workflow_data
                existing.default_parameters = default_parameters or {}
                existing.updated_at = datetime.now(timezone.utc)
                db.commit()
                return existing.id
            
            template = AnomalyTemplateDB(
                template_id=template_id,
                name=name,
                description=description,
                category=category,
                icon=icon,
                workflow_data=workflow_data,
                default_parameters=default_parameters or {},
                is_builtin=1 if is_builtin else 0
            )
            db.add(template)
            db.commit()
            db.refresh(template)
            return template.id
        finally:
            db.close()

    def get_templates(self, category: Optional[str] = None,
                      include_builtin: bool = True) -> List[Dict[str, Any]]:
        db = self.get_postgres_session()
        try:
            query = db.query(AnomalyTemplateDB)
            if category:
                query = query.filter(AnomalyTemplateDB.category == category)
            if not include_builtin:
                query = query.filter(AnomalyTemplateDB.is_builtin == 0)
            templates = query.order_by(
                AnomalyTemplateDB.is_builtin.desc(),
                AnomalyTemplateDB.created_at.desc()
            ).all()
            return [
                {
                    "id": t.id,
                    "template_id": t.template_id,
                    "name": t.name,
                    "description": t.description,
                    "category": t.category,
                    "icon": t.icon,
                    "workflow_data": t.workflow_data,
                    "default_parameters": t.default_parameters,
                    "is_builtin": bool(t.is_builtin),
                    "created_at": t.created_at,
                    "updated_at": t.updated_at
                }
                for t in templates
            ]
        finally:
            db.close()

    def get_template(self, template_id: str) -> Optional[Dict[str, Any]]:
        db = self.get_postgres_session()
        try:
            t = db.query(AnomalyTemplateDB).filter(
                AnomalyTemplateDB.template_id == template_id
            ).first()
            if t:
                return {
                    "id": t.id,
                    "template_id": t.template_id,
                    "name": t.name,
                    "description": t.description,
                    "category": t.category,
                    "icon": t.icon,
                    "workflow_data": t.workflow_data,
                    "default_parameters": t.default_parameters,
                    "is_builtin": bool(t.is_builtin),
                    "created_at": t.created_at,
                    "updated_at": t.updated_at
                }
            return None
        finally:
            db.close()

    def delete_template(self, template_id: str) -> bool:
        db = self.get_postgres_session()
        try:
            t = db.query(AnomalyTemplateDB).filter(
                AnomalyTemplateDB.template_id == template_id
            ).first()
            if t and not bool(t.is_builtin):
                db.delete(t)
                db.commit()
                return True
            return False
        finally:
            db.close()

    def init_builtin_templates(self, templates: List[Dict[str, Any]]):
        for tpl in templates:
            existing = self.get_template(tpl["template_id"])
            if not existing:
                self.save_template(
                    template_id=tpl["template_id"],
                    name=tpl["name"],
                    description=tpl["description"],
                    category=tpl["category"],
                    icon=tpl["icon"],
                    workflow_data=tpl["workflow_data"],
                    default_parameters=tpl.get("default_parameters", {}),
                    is_builtin=True
                )


db_manager = DatabaseManager()
