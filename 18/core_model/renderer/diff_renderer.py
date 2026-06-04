import torch
import torch.nn as nn
import math
from .brdf import BRDF_REGISTRY, _safe_normalize


class DifferentiableRenderer(nn.Module):
    def __init__(self, brdf_type="disney", image_size=256, num_samples=16):
        super().__init__()
        self.brdf_type = brdf_type
        self.image_size = image_size
        self.num_samples = num_samples
        self.brdf = BRDF_REGISTRY[brdf_type]()

    def _generate_hemisphere_samples(self, num_samples, device):
        golden_ratio = (1.0 + math.sqrt(5.0)) / 2.0
        i = torch.arange(num_samples, device=device, dtype=torch.float32)
        theta = torch.acos(1.0 - 2.0 * (i + 0.5) / num_samples)
        phi = 2.0 * math.pi * i / golden_ratio
        x = torch.sin(theta) * torch.cos(phi)
        y = torch.sin(theta) * torch.sin(phi)
        z = torch.cos(theta)
        return torch.stack([x, y, z], dim=-1)  # (S, 3)

    def _environment_light(self, directions, env_map=None):
        if env_map is not None:
            return env_map(directions)
        return torch.ones_like(directions[..., :1]) * 0.8

    def _compute_tangent_frame(self, normal):
        up = torch.zeros_like(normal)
        up[..., 2] = 1.0
        parallel_mask = (normal[..., 2] > 0.999).unsqueeze(-1).float()
        up = up * (1.0 - parallel_mask) + torch.tensor([1.0, 0.0, 0.0], device=normal.device) * parallel_mask
        tangent = _safe_normalize(torch.cross(normal, up, dim=-1))
        bitangent = _safe_normalize(torch.cross(normal, tangent, dim=-1))
        return tangent, bitangent

    def forward(self, material_params, camera_params, env_map=None):
        base_color = material_params["base_color"]  # (B, H, W, 3)
        roughness = material_params["roughness"].clamp(min=0.01, max=1.0)  # (B, H, W, 1)
        metallic = material_params["metallic"].clamp(min=0.0, max=1.0)  # (B, H, W, 1)
        normal_map = material_params.get("normal", None)

        B, H, W, _ = base_color.shape
        device = base_color.device

        if normal_map is not None:
            normal = normal_map * 2.0 - 1.0
            normal = _safe_normalize(normal)
        else:
            normal = torch.zeros(B, H, W, 3, device=device)
            normal[..., 2] = 1.0

        cam_pos = camera_params["position"]
        if cam_pos.dim() == 2:
            cam_pos = cam_pos.squeeze(0)
        cam_pos_expanded = cam_pos.view(1, 1, 1, 3).expand(B, H, W, 3)

        yy, xx = torch.meshgrid(
            torch.linspace(-1, 1, H, device=device),
            torch.linspace(-1, 1, W, device=device),
            indexing="ij"
        )
        pixel_dirs = torch.stack([xx, yy, torch.ones_like(xx)], dim=-1)  # (H, W, 3)
        pixel_dirs = _safe_normalize(pixel_dirs)
        pixel_dirs = pixel_dirs.unsqueeze(0).expand(B, -1, -1, -1)  # (B, H, W, 3)

        wo = _safe_normalize(cam_pos_expanded - pixel_dirs)

        tangent, bitangent = self._compute_tangent_frame(normal)

        local_dirs = self._generate_hemisphere_samples(self.num_samples, device)  # (S, 3)

        pdf = 1.0 / (2.0 * math.pi)
        weight = 1.0 / (self.num_samples * pdf)

        radiance = torch.zeros(B, H, W, 3, device=device)

        for s in range(self.num_samples):
            ld = local_dirs[s]  # (3,)
            wi = (
                ld[0] * tangent +
                ld[1] * bitangent +
                ld[2] * normal
            )  # (B, H, W, 3)
            wi = _safe_normalize(wi)

            light_val = self._environment_light(wi, env_map)  # (B, H, W, 1)

            if self.brdf_type == "disney":
                brdf_val = self.brdf(
                    wo, wi, normal, base_color, roughness, metallic,
                    specular=material_params.get("specular", torch.tensor(0.5, device=device)),
                    specular_tint=material_params.get("specular_tint", torch.tensor(0.0, device=device)),
                    anisotropic=material_params.get("anisotropic", torch.tensor(0.0, device=device)),
                    sheen=material_params.get("sheen", torch.tensor(0.0, device=device)),
                    sheen_tint=material_params.get("sheen_tint", torch.tensor(0.5, device=device)),
                    clearcoat=material_params.get("clearcoat", torch.tensor(0.0, device=device)),
                    clearcoat_roughness=material_params.get("clearcoat_roughness", torch.tensor(0.03, device=device)),
                )
            else:
                brdf_val = self.brdf(wo, wi, normal, base_color, roughness, metallic)

            ndotwi = (normal * wi).sum(dim=-1, keepdim=True).clamp(min=0.0)  # (B, H, W, 1)
            radiance = radiance + brdf_val * light_val * ndotwi * weight

        radiance = radiance / (radiance.max() + 1e-5)
        return radiance.clamp(0.0, 1.0)
