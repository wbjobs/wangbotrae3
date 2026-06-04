from datetime import datetime
from enum import Enum
from typing import Any, Generic, Literal, Optional, TypeVar, Union
from pydantic import BaseModel, Field, field_validator


T = TypeVar("T")


class DeviceStatus(str, Enum):
    NORMAL = "normal"
    BEARING_FAULT = "bearing_fault"
    GEAR_FAULT = "gear_fault"
    IMBALANCE = "imbalance"


DeviceStatusType = Literal["normal", "bearing_fault", "gear_fault", "imbalance"]


class BatchTaskStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class DeviceBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    type: str = Field(..., min_length=1, max_length=50)
    location: str = Field(..., min_length=1, max_length=200)
    sample_rate: int = Field(..., gt=0)
    sensor_count: int = Field(..., gt=0)
    status: Literal["online", "offline", "maintenance"] = "online"


class DeviceCreate(DeviceBase):
    pass


class DeviceUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    type: Optional[str] = Field(None, min_length=1, max_length=50)
    location: Optional[str] = Field(None, min_length=1, max_length=200)
    sample_rate: Optional[int] = Field(None, gt=0)
    sensor_count: Optional[int] = Field(None, gt=0)
    status: Optional[Literal["online", "offline", "maintenance"]] = None


class Device(DeviceBase):
    id: str
    created_at: int
    updated_at: int

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def ensure_timestamp(cls, v: Any) -> int:
        if isinstance(v, datetime):
            return int(v.timestamp() * 1000)
        return int(v)

    model_config = {"from_attributes": True}


class DiagnosisResultBase(BaseModel):
    device_id: str
    status: DeviceStatusType
    confidence: float = Field(..., ge=0, le=1)
    probabilities: dict[DeviceStatusType, float]
    signal_duration: float = Field(..., gt=0)
    sample_rate: int = Field(..., gt=0)


class DiagnosisResultCreate(DiagnosisResultBase):
    timestamp: Optional[int] = None


class DiagnosisResult(DiagnosisResultBase):
    id: str
    timestamp: int

    @field_validator("timestamp", mode="before")
    @classmethod
    def ensure_timestamp(cls, v: Any) -> int:
        if isinstance(v, datetime):
            return int(v.timestamp() * 1000)
        return int(v) if v is not None else int(datetime.now().timestamp() * 1000)

    model_config = {"from_attributes": True}


class BatchTaskBase(BaseModel):
    device_id: str
    file_name: str
    file_size: int = Field(..., ge=0)


class BatchTaskCreate(BatchTaskBase):
    pass


class BatchTask(BaseModel):
    id: str
    device_id: str
    file_name: str
    file_size: int
    status: BatchTaskStatus
    progress: float = Field(..., ge=0, le=100)
    total_count: int = Field(..., ge=0)
    completed_count: int = Field(..., ge=0)
    result_path: Optional[str] = None
    error_message: Optional[str] = None
    created_at: int
    completed_at: Optional[int] = None

    @field_validator("created_at", "completed_at", mode="before")
    @classmethod
    def ensure_timestamp(cls, v: Any) -> Optional[int]:
        if v is None:
            return None
        if isinstance(v, datetime):
            return int(v.timestamp() * 1000)
        return int(v)

    model_config = {"from_attributes": True}


class RealtimeSignalData(BaseModel):
    type: Literal["signal_data"] = "signal_data"
    device_id: str = Field(..., alias="deviceId")
    timestamp: int
    signal: list[float]

    model_config = {"populate_by_name": True}


class RealtimeDiagnosisData(BaseModel):
    type: Literal["diagnosis_result"] = "diagnosis_result"
    data: DiagnosisResult


WebSocketMessage = Union[RealtimeSignalData, RealtimeDiagnosisData]


class ApiResponse(BaseModel, Generic[T]):
    code: int = 200
    message: str = "success"
    data: Optional[T] = None


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


class HistoryFilter(BaseModel):
    device_id: Optional[str] = Field(None, alias="deviceId")
    status: Optional[DeviceStatusType] = None
    start_time: Optional[int] = Field(None, alias="startTime")
    end_time: Optional[int] = Field(None, alias="endTime")
    page: int = 1
    page_size: int = 20

    model_config = {"populate_by_name": True}

    @field_validator("page")
    @classmethod
    def page_must_be_positive(cls, v: int) -> int:
        return max(1, v)

    @field_validator("page_size")
    @classmethod
    def page_size_must_be_valid(cls, v: int) -> int:
        return max(1, min(100, v))


class TorchServeInferenceRequest(BaseModel):
    signal: list[float]
    sample_rate: int
    window_size: int


class TorchServeInferenceResponse(BaseModel):
    status: DeviceStatusType
    confidence: float
    probabilities: dict[DeviceStatusType, float]
