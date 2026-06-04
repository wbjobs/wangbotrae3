import logging
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

app = FastAPI(
    title="分布式水文模型 - 流域汇流并行计算服务",
    description=(
        "基于地貌瞬时单位线(GIUH)的流域汇流模拟计算服务。"
        "输入DEM高程数据和降雨时间序列(NetCDF格式)，"
        "输出流域出口断面的流量过程线(CSV/PNG)。"
        "支持子流域并行计算和Numba加速。"
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1", tags=["GIUH Simulation"])


@app.on_event("startup")
async def startup_event():
    logging.info("GIUH Watershed Convergence Service starting...")
    logging.info("Numba JIT compilation will occur on first request")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
