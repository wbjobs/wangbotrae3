import os
import sys
import json
import torch
import numpy as np
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.celery_app import celery_app
from backend.config import RESULT_DIR, TASK_STATUS_DIR, UPLOAD_DIR

core_model_path = str(Path(__file__).resolve().parent.parent / "core_model")
if core_model_path not in sys.path:
    sys.path.insert(0, core_model_path)

from core_model.pipeline import MaterialEstimationPipeline


def _update_status(task_id, status, progress=None, message=None, result_url=None):
    status_data = {
        "task_id": task_id,
        "status": status,
        "progress": progress,
        "message": message,
        "result_url": result_url,
    }
    status_path = TASK_STATUS_DIR / f"{task_id}.json"
    with open(status_path, "w") as f:
        json.dump(status_data, f)


@celery_app.task(bind=True, name="tasks.estimate_material")
def estimate_material_task(self, task_id, image_paths, request_params):
    try:
        _update_status(task_id, "RUNNING", progress=0.0, message="Initializing pipeline...")

        device = "cuda" if torch.cuda.is_available() else "cpu"
        pipeline = MaterialEstimationPipeline(
            brdf_type=request_params.get("brdf_type", "disney"),
            image_size=request_params.get("image_size", 256),
            num_views=min(len(image_paths), 8),
            num_iterations=request_params.get("num_iterations", 200),
            lr=request_params.get("learning_rate", 0.01),
            device=device,
            use_multiscale=request_params.get("use_multiscale", True),
            scales=request_params.get("scales", None),
            scale_iters=request_params.get("scale_iters", None),
            grad_clip_norm=request_params.get("grad_clip_norm", 1.0),
            early_stopping=request_params.get("early_stopping", True),
            early_stopping_patience=request_params.get("early_stopping_patience", 50),
            early_stopping_tol=request_params.get("early_stopping_tol", 1e-4),
            optimizer_type=request_params.get("optimizer_type", "adam"),
        )

        _update_status(task_id, "RUNNING", progress=0.1, message="Loading images...")

        camera_params_list = None
        if request_params.get("cameras"):
            camera_params_list = []
            for cam in request_params["cameras"]:
                camera_params_list.append({
                    "position": torch.tensor([cam["position"]], dtype=torch.float32, device=device),
                    "lookat": torch.tensor([cam["lookat"]], dtype=torch.float32, device=device),
                })

        initial_params = None
        if any(request_params.get(k) is not None for k in ["initial_base_color", "initial_roughness", "initial_metallic"]):
            sz = request_params.get("image_size", 256)
            initial_params = {}
            if request_params.get("initial_base_color"):
                bc = torch.tensor(request_params["initial_base_color"], device=device)
                initial_params["base_color"] = bc.view(1, 1, 1, 3).expand(1, sz, sz, 3)
            if request_params.get("initial_roughness") is not None:
                r = torch.tensor(request_params["initial_roughness"], device=device)
                initial_params["roughness"] = r.view(1, 1, 1, 1).expand(1, sz, sz, 1)
            if request_params.get("initial_metallic") is not None:
                m = torch.tensor(request_params["initial_metallic"], device=device)
                initial_params["metallic"] = m.view(1, 1, 1, 1).expand(1, sz, sz, 1)

        _update_status(task_id, "RUNNING", progress=0.2, message="Running inverse optimization...")

        output_dir = str(RESULT_DIR / task_id)
        export_format = request_params.get("export_format", "materialx")

        result = pipeline.estimate(
            image_paths=image_paths,
            camera_params_list=camera_params_list,
            initial_params=initial_params,
            export_format=export_format,
            output_dir=output_dir,
        )

        _update_status(task_id, "RUNNING", progress=0.9, message="Exporting results...")

        loss_history = result.get("loss_history", [])
        if loss_history:
            loss_path = os.path.join(output_dir, "loss_history.json")
            with open(loss_path, "w") as f:
                json.dump(loss_history, f)

        export_path = result.get("export_path", "")
        texture_paths = result.get("texture_paths", {})

        relative_textures = {}
        for k, v in texture_paths.items():
            relative_textures[k] = os.path.relpath(v, str(RESULT_DIR))

        result_url = f"/api/v1/results/{task_id}" if export_path else None

        _update_status(
            task_id, "COMPLETED", progress=1.0,
            message="Estimation completed successfully",
            result_url=result_url,
        )

        return {
            "task_id": task_id,
            "export_path": export_path,
            "texture_paths": relative_textures,
            "loss_history": loss_history,
            "status": "COMPLETED",
        }

    except Exception as e:
        _update_status(task_id, "FAILED", progress=0.0, message=str(e))
        raise
