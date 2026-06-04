import torch
import numpy as np
from PIL import Image
from .renderer import DifferentiableRenderer
from .encoder import MaterialEncoder
from .optimizer import InverseOptimizer, ReconstructionLoss
from .exporter import export_materialx, export_mdl, save_material_textures


class MaterialEstimationPipeline:
    def __init__(self, brdf_type="disney", image_size=256, num_views=8,
                 num_samples=16, num_iterations=200, lr=0.01, device="cuda",
                 use_multiscale=True, scales=None, scale_iters=None,
                 grad_clip_norm=1.0, early_stopping=True,
                 early_stopping_patience=50, early_stopping_tol=1e-4,
                 optimizer_type="adam",
                 **kwargs):
        self.device = device if torch.cuda.is_available() else "cpu"
        self.image_size = image_size
        self.num_views = num_views
        self.num_iterations = num_iterations

        self.use_multiscale = use_multiscale
        self.scales = scales or [64, 128, 256]
        self.scale_iters = scale_iters or [50, 50, num_iterations]
        self.grad_clip_norm = grad_clip_norm
        self.early_stopping = early_stopping
        self.early_stopping_patience = early_stopping_patience
        self.early_stopping_tol = early_stopping_tol
        self.optimizer_type = optimizer_type

        self.renderer = DifferentiableRenderer(
            brdf_type=brdf_type,
            image_size=image_size,
            num_samples=num_samples,
        ).to(self.device)

        self.encoder = MaterialEncoder(
            num_views=num_views,
            image_size=image_size,
        ).to(self.device)

        self.optimizer = InverseOptimizer(
            renderer=self.renderer,
            encoder=self.encoder,
            lr=lr,
            num_iterations=num_iterations,
            device=self.device,
            use_multiscale=use_multiscale,
            scales=self.scales,
            scale_iters=self.scale_iters,
            grad_clip_norm=grad_clip_norm,
            early_stopping=early_stopping,
            early_stopping_patience=early_stopping_patience,
            early_stopping_tol=early_stopping_tol,
            optimizer_type=optimizer_type,
        )

    def load_images(self, image_paths):
        images = []
        for path in image_paths:
            img = Image.open(path).convert("RGB")
            img = img.resize((self.image_size, self.image_size), Image.Resampling.BILINEAR)
            arr = np.array(img).astype(np.float32) / 255.0
            arr = arr.transpose(2, 0, 1)
            images.append(arr)
        images = np.stack(images, axis=0)
        images = torch.from_numpy(images).unsqueeze(0)
        return images.to(self.device)

    def estimate(self, image_paths, camera_params_list=None, env_map=None,
                 initial_params=None, export_format="materialx", output_dir=None,
                 **kwargs):
        override_params = {}
        for key in ["use_multiscale", "scales", "scale_iters", "grad_clip_norm",
                    "early_stopping", "early_stopping_patience", "early_stopping_tol",
                    "optimizer_type", "lr", "num_iterations"]:
            if key in kwargs and kwargs[key] is not None:
                override_params[key] = kwargs[key]

        if override_params:
            for key, val in override_params.items():
                setattr(self, key, val)

            self.optimizer = InverseOptimizer(
                    renderer=self.renderer,
                    encoder=self.encoder,
                    lr=self.lr if hasattr(self, 'lr') else self.optimizer.lr,
                    num_iterations=self.num_iterations,
                    device=self.device,
                    use_multiscale=self.use_multiscale,
                    scales=self.scales,
                    scale_iters=self.scale_iters,
                    grad_clip_norm=self.grad_clip_norm,
                    early_stopping=self.early_stopping,
                    early_stopping_patience=self.early_stopping_patience,
                    early_stopping_tol=self.early_stopping_tol,
                    optimizer_type=self.optimizer_type,
                )

        images = self.load_images(image_paths)
        B, N, C, H, W = images.shape

        if camera_params_list is None:
            camera_params_list = []
            for i in range(N):
                angle = 2.0 * 3.14159 * i / N
                cam_pos = torch.tensor(
                    [[2.0 * np.cos(angle), 2.0 * np.sin(angle), 1.0]],
                    device=self.device, dtype=torch.float32
                )
                cam_lookat = torch.tensor(
                    [[0.0, 0.0, 0.0]],
                    device=self.device, dtype=torch.float32
                )
                camera_params_list.append({
                    "position": cam_pos,
                    "lookat": cam_lookat,
                })

        material_params, loss_history = self.optimizer.optimize(
            images, camera_params_list, env_map, initial_params
        )

        result = {
            "material_params": material_params,
            "loss_history": loss_history,
            "optimization_config": {
                "use_multiscale": self.use_multiscale,
                "scales": self.scales,
                "scale_iters": self.scale_iters,
                "grad_clip_norm": self.grad_clip_norm,
                "early_stopping": self.early_stopping,
                "optimizer_type": self.optimizer_type,
                "num_iterations": self.num_iterations,
                "actual_iterations": len(loss_history),
            }
        }

        if output_dir is not None:
            if export_format == "materialx":
                export_path, texture_paths = export_materialx(
                    material_params, output_dir
                )
            elif export_format == "mdl":
                export_path, texture_paths = export_mdl(
                    material_params, output_dir
                )
            else:
                export_path, texture_paths = export_materialx(
                    material_params, output_dir
                )
            result["export_path"] = export_path
            result["texture_paths"] = texture_paths

        return result
