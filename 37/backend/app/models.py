from sqlalchemy import Column, Integer, String, Float, ForeignKey, Text, DateTime, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base


class BOM(Base):
    __tablename__ = "boms"

    id = Column(Integer, primary_key=True, index=True)
    product_name = Column(String(200), nullable=False)
    description = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    is_validated = Column(Boolean, default=False)
    total_carbon = Column(Float, default=0.0)

    parts = relationship("Part", back_populates="bom", cascade="all, delete-orphan")
    calculations = relationship("CarbonCalculation", back_populates="bom", cascade="all, delete-orphan")


class Part(Base):
    __tablename__ = "parts"

    id = Column(Integer, primary_key=True, index=True)
    bom_id = Column(Integer, ForeignKey("boms.id"), nullable=False)
    parent_id = Column(Integer, ForeignKey("parts.id"), nullable=True)
    part_number = Column(String(100), nullable=False)
    part_name = Column(String(200), nullable=False)
    quantity = Column(Float, default=1.0)
    unit = Column(String(50), default="pcs")
    level = Column(Integer, default=0)
    material_type = Column(String(100))
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)

    bom = relationship("BOM", back_populates="parts")
    parent = relationship("Part", remote_side=[id], backref="children")
    supplier = relationship("Supplier", back_populates="parts")
    carbon_data = relationship("CarbonCalculation", back_populates="part", uselist=False)


class Supplier(Base):
    __tablename__ = "suppliers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    code = Column(String(50), unique=True, nullable=False)
    location = Column(String(200))
    material_raw_carbon = Column(Float, default=0.0)
    production_carbon = Column(Float, default=0.0)
    transport_carbon_per_km = Column(Float, default=0.0)
    transport_distance = Column(Float, default=0.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    parts = relationship("Part", back_populates="supplier")


class CarbonCalculation(Base):
    __tablename__ = "carbon_calculations"

    id = Column(Integer, primary_key=True, index=True)
    bom_id = Column(Integer, ForeignKey("boms.id"), nullable=False)
    part_id = Column(Integer, ForeignKey("parts.id"), nullable=False)
    raw_material_carbon = Column(Float, default=0.0)
    production_carbon = Column(Float, default=0.0)
    transport_carbon = Column(Float, default=0.0)
    total_carbon = Column(Float, default=0.0)
    children_carbon = Column(Float, default=0.0)
    calculated_at = Column(DateTime(timezone=True), server_default=func.now())

    bom = relationship("BOM", back_populates="calculations")
    part = relationship("Part", back_populates="carbon_data")


class ComparisonAnalysis(Base):
    __tablename__ = "comparison_analyses"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    original_bom_id = Column(Integer, ForeignKey("boms.id"), nullable=False)
    modified_bom_id = Column(Integer, ForeignKey("boms.id"), nullable=False)
    original_total = Column(Float, default=0.0)
    modified_total = Column(Float, default=0.0)
    difference = Column(Float, default=0.0)
    percentage_change = Column(Float, default=0.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    original_bom = relationship("BOM", foreign_keys=[original_bom_id])
    modified_bom = relationship("BOM", foreign_keys=[modified_bom_id])


class TaskStatus(Base):
    __tablename__ = "task_statuses"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String(100), unique=True, nullable=False)
    task_type = Column(String(50), nullable=False)
    status = Column(String(50), default="pending")
    result = Column(Text)
    error_message = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True))
