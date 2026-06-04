import os
import tempfile
from typing import List
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from io import BytesIO

from .database import get_db, engine, Base
from .models import BOM, Part, Supplier, CarbonCalculation, TaskStatus, ComparisonAnalysis
from .schemas import (
    BOM as BOMSchema,
    BOMCreate,
    Supplier as SupplierSchema,
    SupplierCreate,
    SankeyData,
    ValidationResult,
    ComparisonRequest,
    ComparisonResult,
    TaskStatusResponse,
    BOMCarbonSummary
)
from .calculator import CarbonCalculator, import_bom_from_excel, import_suppliers_from_excel
from .tasks import calculate_carbon_task, generate_report_task, validate_bom_task
from .report import generate_pdf_report

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="供应链碳排放分析系统 API",
    description="企业级供应链碳足迹全生命周期分析平台",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def read_root():
    return {"message": "供应链碳排放分析系统 API"}


@app.get("/api/boms", response_model=List[BOMSchema])
def list_boms(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    boms = db.query(BOM).offset(skip).limit(limit).all()
    return boms


@app.get("/api/boms/{bom_id}", response_model=BOMSchema)
def get_bom(bom_id: int, db: Session = Depends(get_db)):
    bom = db.query(BOM).filter(BOM.id == bom_id).first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")
    return bom


@app.post("/api/boms", response_model=BOMSchema)
def create_bom(bom_create: BOMCreate, db: Session = Depends(get_db)):
    bom = BOM(
        product_name=bom_create.product_name,
        description=bom_create.description
    )
    db.add(bom)
    db.commit()
    db.refresh(bom)

    part_map = {}
    for part_data in bom_create.parts:
        part = Part(
            bom_id=bom.id,
            part_number=part_data.part_number,
            part_name=part_data.part_name,
            quantity=part_data.quantity,
            unit=part_data.unit,
            level=part_data.level,
            material_type=part_data.material_type
        )
        db.add(part)
        db.flush()
        part_map[part_data.part_number] = part

    for part_data in bom_create.parts:
        if part_data.parent_part_number and part_data.parent_part_number in part_map:
            part_map[part_data.part_number].parent_id = part_map[part_data.parent_part_number].id

    db.commit()
    return bom


@app.post("/api/bom/upload")
async def upload_bom(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="仅支持Excel文件")

    with tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx') as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        bom = import_bom_from_excel(tmp_path, db)
        os.unlink(tmp_path)
        return {"message": "BOM上传成功", "bom_id": bom.id, "product_name": bom.product_name}
    except Exception as e:
        os.unlink(tmp_path)
        raise HTTPException(status_code=400, detail=f"解析BOM文件失败: {str(e)}")


@app.post("/api/supplier/upload")
async def upload_suppliers(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="仅支持Excel文件")

    with tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx') as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        suppliers = import_suppliers_from_excel(tmp_path, db)
        os.unlink(tmp_path)
        return {"message": "供应商数据上传成功", "count": len(suppliers)}
    except Exception as e:
        os.unlink(tmp_path)
        raise HTTPException(status_code=400, detail=f"解析供应商文件失败: {str(e)}")


@app.get("/api/suppliers", response_model=List[SupplierSchema])
def list_suppliers(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    suppliers = db.query(Supplier).offset(skip).limit(limit).all()
    return suppliers


@app.post("/api/suppliers", response_model=SupplierSchema)
def create_supplier(supplier: SupplierCreate, db: Session = Depends(get_db)):
    existing = db.query(Supplier).filter(Supplier.code == supplier.code).first()
    if existing:
        raise HTTPException(status_code=400, detail="供应商代码已存在")

    db_supplier = Supplier(**supplier.dict())
    db.add(db_supplier)
    db.commit()
    db.refresh(db_supplier)
    return db_supplier


@app.get("/api/boms/{bom_id}/validate", response_model=ValidationResult)
def validate_bom(bom_id: int, db: Session = Depends(get_db)):
    calculator = CarbonCalculator(db)
    return calculator.validate_bom(bom_id)


@app.post("/api/boms/{bom_id}/calculate")
def calculate_carbon(bom_id: int, db: Session = Depends(get_db)):
    bom = db.query(BOM).filter(BOM.id == bom_id).first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")

    task = calculate_carbon_task.delay(bom_id)
    return {"task_id": task.id, "message": "计算任务已启动"}


@app.get("/api/boms/{bom_id}/summary", response_model=BOMCarbonSummary)
def get_bom_summary(bom_id: int, db: Session = Depends(get_db)):
    bom = db.query(BOM).filter(BOM.id == bom_id).first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")

    calculations = db.query(CarbonCalculation).filter(CarbonCalculation.bom_id == bom_id).all()

    raw_total = sum(c.raw_material_carbon for c in calculations)
    prod_total = sum(c.production_carbon for c in calculations)
    trans_total = sum(c.transport_carbon for c in calculations)

    part_details = []
    for calc in calculations:
        part = db.query(Part).filter(Part.id == calc.part_id).first()
        if part:
            part_details.append({
                "part_id": part.id,
                "part_name": part.part_name,
                "part_number": part.part_number,
                "raw_material_carbon": calc.raw_material_carbon,
                "production_carbon": calc.production_carbon,
                "transport_carbon": calc.transport_carbon,
                "children_carbon": calc.children_carbon,
                "total_carbon": calc.total_carbon
            })

    return {
        "bom_id": bom.id,
        "product_name": bom.product_name,
        "total_carbon": bom.total_carbon,
        "raw_material_total": raw_total,
        "production_total": prod_total,
        "transport_total": trans_total,
        "part_details": part_details
    }


@app.get("/api/boms/{bom_id}/sankey", response_model=SankeyData)
def get_sankey_data(bom_id: int, db: Session = Depends(get_db)):
    calculator = CarbonCalculator(db)
    try:
        return calculator.build_sankey_data(bom_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/api/analysis/compare", response_model=ComparisonResult)
def compare_boms(request: ComparisonRequest, db: Session = Depends(get_db)):
    calculator = CarbonCalculator(db)
    try:
        result = calculator.compare_boms(request.original_bom_id, request.modified_bom_id)

        analysis = ComparisonAnalysis(
            name=request.name,
            original_bom_id=request.original_bom_id,
            modified_bom_id=request.modified_bom_id,
            original_total=result["original_total"],
            modified_total=result["modified_total"],
            difference=result["difference"],
            percentage_change=result["percentage_change"]
        )
        db.add(analysis)
        db.commit()
        db.refresh(analysis)

        return analysis
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/analysis/comparisons", response_model=List[ComparisonResult])
def list_comparisons(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    comparisons = db.query(ComparisonAnalysis).offset(skip).limit(limit).all()
    return comparisons


@app.post("/api/boms/{bom_id}/report")
def generate_report(bom_id: int, db: Session = Depends(get_db)):
    bom = db.query(BOM).filter(BOM.id == bom_id).first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")

    task = generate_report_task.delay(bom_id)
    return {"task_id": task.id, "message": "报告生成任务已启动"}


@app.get("/api/boms/{bom_id}/report/download")
def download_report(bom_id: int, db: Session = Depends(get_db)):
    bom = db.query(BOM).filter(BOM.id == bom_id).first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")

    try:
        pdf_bytes = generate_pdf_report(bom_id, db)
        pdf_stream = BytesIO(pdf_bytes)

        return StreamingResponse(
            pdf_stream,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=carbon_report_{bom_id}.pdf"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成报告失败: {str(e)}")


@app.get("/api/tasks/{task_id}", response_model=TaskStatusResponse)
def get_task_status(task_id: str, db: Session = Depends(get_db)):
    task = db.query(TaskStatus).filter(TaskStatus.task_id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task


@app.delete("/api/boms/{bom_id}")
def delete_bom(bom_id: int, db: Session = Depends(get_db)):
    bom = db.query(BOM).filter(BOM.id == bom_id).first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")

    db.delete(bom)
    db.commit()
    return {"message": "BOM已删除"}
