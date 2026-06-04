from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routes import router
from .config import RESULT_DIR

app = FastAPI(
    title="Material Inverse Estimation Service",
    description="基于可微分渲染的未知光源下多视角材质逆向估计服务",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/", tags=["health"])
async def health_check():
    return {"status": "ok", "service": "material-estimation"}


@app.get("/api/v1/formats", tags=["info"])
async def supported_formats():
    return {
        "brdf_types": ["ggx", "lambertian", "disney"],
        "export_formats": ["materialx", "mdl"],
        "min_views": 8,
        "supported_image_formats": ["png", "jpg", "jpeg", "bmp", "tiff"],
    }
