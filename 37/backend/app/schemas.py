from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class SupplierBase(BaseModel):
    name: str
    code: str
    location: Optional[str] = None
    material_raw_carbon: float = 0.0
    production_carbon: float = 0.0
    transport_carbon_per_km: float = 0.0
    transport_distance: float = 0.0


class SupplierCreate(SupplierBase):
    pass


class Supplier(SupplierBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class PartBase(BaseModel):
    part_number: str
    part_name: str
    quantity: float = 1.0
    unit: str = "pcs"
    level: int = 0
    material_type: Optional[str] = None
    supplier_code: Optional[str] = None


class PartCreate(PartBase):
    parent_part_number: Optional[str] = None


class Part(PartBase):
    id: int
    bom_id: int
    parent_id: Optional[int] = None
    supplier_id: Optional[int] = None
    children: List["Part"] = []

    class Config:
        from_attributes = True


class BOMBase(BaseModel):
    product_name: str
    description: Optional[str] = None


class BOMCreate(BOMBase):
    parts: List[PartCreate] = []


class BOM(BOMBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    is_validated: bool = False
    total_carbon: float = 0.0
    parts: List[Part] = []

    class Config:
        from_attributes = True


class CarbonCalculationBase(BaseModel):
    raw_material_carbon: float = 0.0
    production_carbon: float = 0.0
    transport_carbon: float = 0.0
    total_carbon: float = 0.0
    children_carbon: float = 0.0


class CarbonCalculation(CarbonCalculationBase):
    id: int
    bom_id: int
    part_id: int
    calculated_at: datetime

    class Config:
        from_attributes = True


class SankeyNode(BaseModel):
    name: str
    value: Optional[float] = None


class SankeyLink(BaseModel):
    source: str
    target: str
    value: float


class SankeyData(BaseModel):
    nodes: List[SankeyNode]
    links: List[SankeyLink]


class ComparisonRequest(BaseModel):
    original_bom_id: int
    modified_bom_id: int
    name: str


class ComparisonResult(BaseModel):
    id: int
    name: str
    original_total: float
    modified_total: float
    difference: float
    percentage_change: float
    created_at: datetime

    class Config:
        from_attributes = True


class TaskStatusResponse(BaseModel):
    task_id: str
    task_type: str
    status: str
    result: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ValidationResult(BaseModel):
    is_valid: bool
    errors: List[str] = []
    warnings: List[str] = []


class PartCarbonDetail(BaseModel):
    part_id: int
    part_name: str
    part_number: str
    raw_material_carbon: float
    production_carbon: float
    transport_carbon: float
    children_carbon: float
    total_carbon: float


class BOMCarbonSummary(BaseModel):
    bom_id: int
    product_name: str
    total_carbon: float
    raw_material_total: float
    production_total: float
    transport_total: float
    part_details: List[PartCarbonDetail] = []
