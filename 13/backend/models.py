from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from sqlalchemy import Column, Integer, String, DateTime, JSON, ForeignKey, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

Base = declarative_base()


class DeviceData(BaseModel):
    device_id: str
    timestamp: datetime
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    voltage: Optional[float] = None
    current: Optional[float] = None
    pressure: Optional[float] = None
    metadata: Optional[Dict[str, Any]] = None


class DeviceSimulatorConfig(BaseModel):
    device_id: str
    metrics: List[str] = Field(default_factory=lambda: ["temperature", "humidity", "voltage"])
    interval: float = 1.0
    temperature_base: float = 25.0
    temperature_variance: float = 2.0
    humidity_base: float = 50.0
    humidity_variance: float = 5.0
    voltage_base: float = 3.7
    voltage_variance: float = 0.1
    current_base: float = 0.5
    current_variance: float = 0.05
    pressure_base: float = 1013.25
    pressure_variance: float = 5.0


class AnomalyType(BaseModel):
    name: str
    description: str
    parameters: Dict[str, Any]


class AnomalyConfig(BaseModel):
    anomaly_type: str
    parameters: Dict[str, Any] = Field(default_factory=dict)
    duration: Optional[float] = None
    probability: float = 1.0
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None


class WorkflowNode(BaseModel):
    id: str
    type: str
    position: Dict[str, float]
    config: Dict[str, Any] = Field(default_factory=dict)
    anomaly_config: Optional[AnomalyConfig] = None
    execution_order: Optional[int] = None
    delay_seconds: Optional[float] = None
    condition_expression: Optional[str] = None
    parallel_group: Optional[str] = None
    branch_nodes: Optional[List[str]] = None


class WorkflowEdge(BaseModel):
    id: str
    source: str
    target: str
    condition: Optional[str] = None
    delay_seconds: Optional[float] = None


class Workflow(BaseModel):
    id: Optional[str] = None
    name: str
    description: Optional[str] = None
    nodes: List[WorkflowNode]
    edges: List[WorkflowEdge]
    device_ids: List[str] = Field(default_factory=list)
    template_id: Optional[str] = None
    execution_mode: str = Field(default="sequential", pattern="^(sequential|parallel|mixed)$")
    created_at: Optional[datetime] = None


class AnomalyTemplate(BaseModel):
    id: Optional[str] = None
    name: str
    description: str
    category: str
    icon: Optional[str] = None
    workflow_data: Workflow
    default_parameters: Dict[str, Any] = Field(default_factory=dict)
    is_builtin: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class AnomalyTemplateDB(Base):
    __tablename__ = "anomaly_templates"
    
    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(String(100), unique=True, index=True, nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    category = Column(String(100), nullable=False, index=True)
    icon = Column(String(100))
    workflow_data = Column(JSON, nullable=False)
    default_parameters = Column(JSON, default=dict)
    is_builtin = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TimeTravelRequest(BaseModel):
    device_id: str
    start_time: datetime
    end_time: datetime
    playback_speed: float = 1.0
    target_start_time: Optional[datetime] = None


class InjectionRecordBase(BaseModel):
    workflow_id: Optional[str] = None
    device_id: str
    anomaly_type: str
    parameters: Dict[str, Any]
    start_time: datetime
    end_time: Optional[datetime] = None
    original_data_count: int = 0
    affected_data_count: int = 0


class TestCaseDB(Base):
    __tablename__ = "test_cases"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    workflow_id = Column(String(100), unique=True, index=True)
    workflow_data = Column(JSON, nullable=False)
    device_ids = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    injection_records = relationship("InjectionRecordDB", back_populates="test_case")


class InjectionRecordDB(Base):
    __tablename__ = "injection_records"
    
    id = Column(Integer, primary_key=True, index=True)
    test_case_id = Column(Integer, ForeignKey("test_cases.id"))
    workflow_id = Column(String(100), index=True)
    device_id = Column(String(100), nullable=False, index=True)
    anomaly_type = Column(String(50), nullable=False)
    parameters = Column(JSON, default=dict)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime)
    original_data_count = Column(Integer, default=0)
    affected_data_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    test_case = relationship("TestCaseDB", back_populates="injection_records")


class AnomalyEvent(BaseModel):
    id: str
    device_id: str
    anomaly_type: str
    timestamp: datetime
    parameters: Dict[str, Any]
    original_value: Optional[Any] = None
    injected_value: Optional[Any] = None


class DataPoint(BaseModel):
    timestamp: datetime
    value: float
    metric: str
    device_id: str
    is_injected: bool = False
    anomaly_type: Optional[str] = None
