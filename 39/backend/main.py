import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .services.database import init_db
from .routers import projects, annotations

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")

app = FastAPI(title="Pipeline GPR Point Cloud Reconstruction", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(annotations.router)


@app.on_event("startup")
async def startup() -> None:
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    init_db()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
