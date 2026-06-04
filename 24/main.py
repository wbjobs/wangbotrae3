from fastapi import FastAPI, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional
import time
import random

from database import get_db, init_db
from index_service import GlobalIndexService

app = FastAPI(title="Hilbert空间索引服务", description="基于Hilbert曲线的空间填充索引与多维范围查询服务")

index_service = GlobalIndexService()


class PointData(BaseModel):
    x: int = Field(ge=0, le=1000, description="x坐标，范围0-1000")
    y: int = Field(ge=0, le=1000, description="y坐标，范围0-1000")


class InsertRequest(BaseModel):
    points: List[PointData]


class InsertResponse(BaseModel):
    success: bool
    count: int
    results: List[dict]
    stats: dict


class RangeRequest(BaseModel):
    x_min: int = Field(ge=0, le=1000, description="x坐标最小值")
    x_max: int = Field(ge=0, le=1000, description="x坐标最大值")
    y_min: int = Field(ge=0, le=1000, description="y坐标最小值")
    y_max: int = Field(ge=0, le=1000, description="y坐标最大值")
    use_index: Optional[bool] = Field(default=True, description="是否使用Hilbert索引")


class RangeResponse(BaseModel):
    success: bool
    count: int
    points: List[dict]
    query_time_ms: float
    method: str


class NeighborsRequest(BaseModel):
    x: int = Field(ge=0, le=1000, description="查询点x坐标")
    y: int = Field(ge=0, le=1000, description="查询点y坐标")
    k: Optional[int] = Field(default=10, ge=1, le=100, description="返回最近点数量")


class NeighborsResponse(BaseModel):
    success: bool
    target: dict
    neighbors: List[dict]
    query_time_ms: float


class BenchmarkRequest(BaseModel):
    x_min: int = Field(default=200, ge=0, le=1000)
    x_max: int = Field(default=800, ge=0, le=1000)
    y_min: int = Field(default=200, ge=0, le=1000)
    y_max: int = Field(default=800, ge=0, le=1000)
    iterations: Optional[int] = Field(default=10, ge=1, le=100, description="迭代次数")


class BenchmarkResponse(BaseModel):
    success: bool
    iterations: int
    linear_scan: dict
    hilbert_index: dict
    speedup: float
    stats: dict


class ReindexStatusResponse(BaseModel):
    success: bool
    is_running: bool
    from_n_order: Optional[int]
    to_n_order: Optional[int]
    total_points: int
    processed_points: int
    progress_percent: float
    dual_write_active: bool
    error_message: Optional[str]


@app.on_event("startup")
def startup_event():
    init_db()


@app.post("/insert", response_model=InsertResponse, summary="批量插入点集")
def insert_points(request: InsertRequest, db=Depends(get_db)):
    if not request.points:
        raise HTTPException(status_code=400, detail="点集不能为空")

    points = [(p.x, p.y) for p in request.points]

    start_time = time.time()
    results = index_service.insert_points(db, points)
    elapsed = (time.time() - start_time) * 1000

    return InsertResponse(
        success=True,
        count=len(results),
        results=results,
        stats=index_service.get_stats(db)
    )


@app.post("/range", response_model=RangeResponse, summary="矩形范围查询")
def range_query(request: RangeRequest, db=Depends(get_db)):
    if request.x_min > request.x_max or request.y_min > request.y_max:
        raise HTTPException(status_code=400, detail="坐标范围无效")

    start_time = time.time()
    results = index_service.range_query(
        db,
        request.x_min, request.x_max,
        request.y_min, request.y_max,
        use_index=request.use_index
    )
    elapsed = (time.time() - start_time) * 1000

    return RangeResponse(
        success=True,
        count=len(results),
        points=results,
        query_time_ms=round(elapsed, 4),
        method="Hilbert索引" if request.use_index else "线性扫描"
    )


@app.post("/neighbors", response_model=NeighborsResponse, summary="最近邻查询")
def neighbors_query(request: NeighborsRequest, db=Depends(get_db)):
    start_time = time.time()
    neighbors = index_service.neighbors_query(db, request.x, request.y, request.k)
    elapsed = (time.time() - start_time) * 1000

    return NeighborsResponse(
        success=True,
        target={
            "x": request.x, "y": request.y,
            "hilbert_code": index_service.encode_point(request.x, request.y),
            "n_order": index_service.get_active_n(db)
        },
        neighbors=neighbors,
        query_time_ms=round(elapsed, 4)
    )


@app.post("/benchmark", response_model=BenchmarkResponse, summary="性能对比测试")
def benchmark(request: BenchmarkRequest, db=Depends(get_db)):
    if request.x_min > request.x_max or request.y_min > request.y_max:
        raise HTTPException(status_code=400, detail="坐标范围无效")

    linear_times = []
    linear_counts = []
    for _ in range(request.iterations):
        start = time.time()
        results = index_service.linear_scan_range(
            db,
            request.x_min, request.x_max,
            request.y_min, request.y_max
        )
        elapsed = (time.time() - start) * 1000
        linear_times.append(elapsed)
        linear_counts.append(len(results))

    hilbert_times = []
    hilbert_counts = []
    for _ in range(request.iterations):
        start = time.time()
        results = index_service.range_query(
            db,
            request.x_min, request.x_max,
            request.y_min, request.y_max,
            use_index=True
        )
        elapsed = (time.time() - start) * 1000
        hilbert_times.append(elapsed)
        hilbert_counts.append(len(results))

    avg_linear = sum(linear_times) / len(linear_times)
    avg_hilbert = sum(hilbert_times) / len(hilbert_times)
    speedup = avg_linear / avg_hilbert if avg_hilbert > 0 else 0

    return BenchmarkResponse(
        success=True,
        iterations=request.iterations,
        linear_scan={
            "avg_time_ms": round(avg_linear, 4),
            "min_time_ms": round(min(linear_times), 4),
            "max_time_ms": round(max(linear_times), 4),
            "avg_result_count": int(sum(linear_counts) / len(linear_counts))
        },
        hilbert_index={
            "avg_time_ms": round(avg_hilbert, 4),
            "min_time_ms": round(min(hilbert_times), 4),
            "max_time_ms": round(max(hilbert_times), 4),
            "avg_result_count": int(sum(hilbert_counts) / len(hilbert_counts))
        },
        speedup=round(speedup, 2),
        stats=index_service.get_stats(db)
    )


@app.get("/stats", summary="获取索引状态")
def get_stats(db=Depends(get_db)):
    return index_service.get_stats(db)


@app.get("/reindex/status", response_model=ReindexStatusResponse, summary="获取重分级状态")
def get_reindex_status(db=Depends(get_db)):
    status = index_service.get_reindex_status(db)
    return ReindexStatusResponse(
        success=True,
        is_running=status["is_running"],
        from_n_order=status["from_n_order"],
        to_n_order=status["to_n_order"],
        total_points=status["total_points"],
        processed_points=status["processed_points"],
        progress_percent=status["progress_percent"],
        dual_write_active=status["dual_write_active"],
        error_message=status["error_message"]
    )


@app.post("/generate_test_data", summary="生成测试数据")
def generate_test_data(count: int = 1000, db=Depends(get_db)):
    points = []
    for _ in range(count):
        x = random.randint(0, 1000)
        y = random.randint(0, 1000)
        points.append(PointData(x=x, y=y))

    return insert_points(InsertRequest(points=points), db)
