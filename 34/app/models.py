from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any


class SimulationRequest(BaseModel):
    cell_size: float = Field(default=30.0, description="DEM cell size in meters")
    time_step: float = Field(default=3600.0, description="Time step in seconds")
    stream_threshold: float = Field(default=0.02, description="Stream threshold ratio (0-1)")
    n_subbasins: int = Field(default=4, description="Target number of sub-basins")
    n_workers: Optional[int] = Field(default=None, description="Number of parallel workers")
    parallel_mode: str = Field(default="process", description="Parallel mode: process or thread")

    class Config:
        json_schema_extra = {
            "example": {
                "cell_size": 30.0,
                "time_step": 3600.0,
                "stream_threshold": 0.02,
                "n_subbasins": 4,
                "n_workers": 4,
                "parallel_mode": "process",
            }
        }


class CalibrationRequest(BaseModel):
    cell_size: float = Field(default=30.0, description="DEM cell size in meters")
    time_step: float = Field(default=3600.0, description="Time step in seconds")
    stream_threshold: float = Field(default=0.02, description="Stream threshold ratio (0-1)")
    n_subbasins: int = Field(default=4, description="Target number of sub-basins")
    n_workers: Optional[int] = Field(default=None, description="Number of parallel workers")
    param_names: Optional[List[str]] = Field(
        default=None,
        description="List of parameters to calibrate. Default: [v_coeff, len_exp, slope_exp, min_velocity]"
    )
    max_iterations: int = Field(
        default=30, ge=5, le=200,
        description="Maximum number of Bayesian optimization iterations"
    )
    random_seed: int = Field(default=42, description="Random seed for reproducibility")

    class Config:
        json_schema_extra = {
            "example": {
                "cell_size": 30.0,
                "time_step": 3600.0,
                "stream_threshold": 0.02,
                "n_subbasins": 4,
                "param_names": ["v_coeff", "len_exp", "slope_exp", "min_velocity"],
                "max_iterations": 30,
                "random_seed": 42,
            }
        }


class CalibrationParams(BaseModel):
    v_coeff: Optional[float] = None
    len_exp: Optional[float] = None
    slope_exp: Optional[float] = None
    min_velocity: Optional[float] = None
    ch_v_coeff: Optional[float] = None
    ch_len_exp: Optional[float] = None
    ch_slope_exp: Optional[float] = None
    ch_min_velocity: Optional[float] = None


class CalibrationResult(BaseModel):
    task_id: str
    status: str
    best_nse: Optional[float] = None
    best_params: Optional[Dict[str, float]] = None
    final_params: Optional[Dict[str, float]] = None
    n_iterations: Optional[int] = None
    computation_time_s: Optional[float] = None
    initial_nse: Optional[float] = None
    message: Optional[str] = None


class CalibrationHistoryEntry(BaseModel):
    iteration: int
    params: Dict[str, float]
    nse: float
    best_nse: float
    type: str


class CalibrationStatus(BaseModel):
    task_id: str
    status: str
    current_iteration: Optional[int] = None
    best_nse: Optional[float] = None
    history: Optional[List[CalibrationHistoryEntry]] = None
    error: Optional[str] = None


class SimulationResult(BaseModel):
    task_id: str
    status: str
    n_subbasins: int
    peak_flow: Optional[float] = None
    peak_time_h: Optional[float] = None
    total_volume_m3: Optional[float] = None
    computation_time_s: Optional[float] = None
    flow_length: Optional[int] = None
    nse: Optional[float] = None
    calib_params: Optional[Dict[str, float]] = None
    message: Optional[str] = None


class TaskStatus(BaseModel):
    task_id: str
    status: str
    task_type: str = "simulation"
    error: Optional[str] = None
