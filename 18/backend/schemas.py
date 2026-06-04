from pydantic import BaseModel, Field
from typing import Optional, List
from enum import Enum


class BRDFType(str, Enum):
    ggx = "ggx"
    lambertian = "lambertian"
    disney = "disney"


class ExportFormat(str, Enum):
    materialx = "materialx"
    mdl = "mdl"


class CameraParams(BaseModel):
    position: List[float] = Field(..., description="Camera position [x, y, z]")
    lookat: List[float] = Field(default=[0.0, 0.0, 0.0], description="Camera look-at target [x, y, z]")


class EstimationRequest(BaseModel):
    brdf_type: BRDFType = Field(default=BRDFType.disney, description="BRDF model to use")
    image_size: int = Field(default=256, description="Processing image resolution")
    num_iterations: int = Field(default=200, description="Number of optimization iterations")
    learning_rate: float = Field(default=0.01, description="Optimization learning rate")
    export_format: ExportFormat = Field(default=ExportFormat.materialx, description="Output format")
    cameras: Optional[List[CameraParams]] = Field(default=None, description="Camera parameters per view")
    initial_base_color: Optional[List[float]] = Field(default=None, description="Initial base color hint [r,g,b]")
    initial_roughness: Optional[float] = Field(default=None, description="Initial roughness hint [0-1]")
    initial_metallic: Optional[float] = Field(default=None, description="Initial metallic hint [0-1]")


class TaskStatusResponse(BaseModel):
    task_id: str
    status: str
    progress: Optional[float] = None
    message: Optional[str] = None
    result_url: Optional[str] = None


class EstimationResult(BaseModel):
    task_id: str
    export_path: Optional[str] = None
    texture_paths: Optional[dict] = None
    loss_history: Optional[List[float]] = None
