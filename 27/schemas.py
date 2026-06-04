from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, field_validator

from config import CLASSES


class FeedbackCreate(BaseModel):
    audio_path: str = Field(..., description="Path to the audio file on disk")
    correct_class: str = Field(..., description="Correct event class label")
    wrong_start_time: Optional[float] = Field(None, description="Start time of wrong detection")
    wrong_end_time: Optional[float] = Field(None, description="End time of wrong detection")
    correct_start_time: Optional[float] = Field(None, description="Correct start time")
    correct_end_time: Optional[float] = Field(None, description="Correct end time")
    confidence: Optional[float] = Field(None, ge=0.0, le=1.0, description="Confidence of the correction")
    comment: Optional[str] = Field(None, max_length=500, description="Optional comment")

    @field_validator("correct_class")
    @classmethod
    def validate_correct_class(cls, v: str) -> str:
        if v not in CLASSES:
            raise ValueError(f"correct_class must be one of {CLASSES}")
        return v


class FeedbackResponse(BaseModel):
    id: int
    audio_path: str
    correct_class: str
    wrong_start_time: Optional[float]
    wrong_end_time: Optional[float]
    correct_start_time: Optional[float]
    correct_end_time: Optional[float]
    confidence: Optional[float]
    comment: Optional[str]
    created_at: str
    processed: bool
    processed_at: Optional[str]


class FeedbackStatsResponse(BaseModel):
    total_feedback: int
    unprocessed_feedback: int
    class_distribution: Dict[str, int]


class TrainingTriggerResponse(BaseModel):
    success: bool
    message: str
    feedback_count: int
    training_id: Optional[str] = None
    new_version: Optional[str] = None


class DetectResponse(BaseModel):
    success: bool
    detections: List[Dict[str, Any]]
    processing_time_ms: float


class ModelVersionResponse(BaseModel):
    model_config = {"protected_namespaces": ()}
    id: int
    version: str
    model_path: str
    created_at: str
    active: bool
    feedback_count: int


class HealthResponse(BaseModel):
    model_config = {"protected_namespaces": ()}
    status: str
    model_loaded: bool
    model_details: Dict[str, Any]
    queue_size: int
    max_workers: int
    average_inference_time_ms: float
    supported_classes: List[str]
    active_model_version: Optional[ModelVersionResponse] = None
    feedback_stats: Optional[FeedbackStatsResponse] = None
