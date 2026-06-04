import torch
import torch.nn as nn
import torch.nn.functional as F


class ReconstructionLoss(nn.Module):
    def __init__(self, lambda_l1=1.0, lambda_ssim=0.5, lambda_perc=0.3, lambda_reg=0.01):
        super().__init__()
        self.lambda_l1 = lambda_l1
        self.lambda_ssim = lambda_ssim
        self.lambda_perc = lambda_perc
        self.lambda_reg = lambda_reg

    def _gaussian_window(self, size, sigma, channels):
        coords = torch.arange(size, dtype=torch.float32)
        coords -= size // 2
        g = torch.exp(-(coords ** 2) / (2 * sigma ** 2))
        g /= g.sum()
        window_1d = g.unsqueeze(1)
        window_2d = window_1d.mm(window_1d.t())
        window = window_2d.expand(channels, 1, size, size).contiguous()
        return window

    def _ssim(self, pred, target, window_size=11):
        C = pred.shape[1]
        window = self._gaussian_window(window_size, 1.5, C).to(pred.device)
        mu1 = F.conv2d(pred, window, padding=window_size // 2, groups=C)
        mu2 = F.conv2d(target, window, padding=window_size // 2, groups=C)
        mu1_sq, mu2_sq, mu12 = mu1 ** 2, mu2 ** 2, mu1 * mu2
        sigma1_sq = F.conv2d(pred * pred, window, padding=window_size // 2, groups=C) - mu1_sq
        sigma2_sq = F.conv2d(target * target, window, padding=window_size // 2, groups=C) - mu2_sq
        sigma12 = F.conv2d(pred * target, window, padding=window_size // 2, groups=C) - mu12
        C1, C2 = 0.01 ** 2, 0.03 ** 2
        ssim_map = ((2 * mu12 + C1) * (2 * sigma12 + C2)) / ((mu1_sq + mu2_sq + C1) * (sigma1_sq + sigma2_sq + C2))
        return ssim_map.mean()

    def _regularization(self, material_params):
        reg = 0.0
        if "roughness" in material_params:
            reg = reg + torch.mean(material_params["roughness"].pow(2))
        if "normal" in material_params:
            normal = material_params["normal"] * 2.0 - 1.0
            reg = reg + torch.mean((normal.pow(2).sum(dim=-1) - 1.0).pow(2))
        return reg

    def forward(self, rendered, target, material_params=None):
        rendered_chw = rendered.permute(0, 3, 1, 2)
        target_chw = target.permute(0, 3, 1, 2)

        loss_l1 = F.l1_loss(rendered_chw, target_chw)
        loss_ssim = 1.0 - self._ssim(rendered_chw, target_chw)
        loss_perc = F.mse_loss(rendered_chw, target_chw)

        total = self.lambda_l1 * loss_l1 + self.lambda_ssim * loss_ssim + self.lambda_perc * loss_perc

        if material_params is not None:
            total = total + self.lambda_reg * self._regularization(material_params)

        return total


def _downsample_images(images, target_size):
    B, N, C, H, W = images.shape
    images_flat = images.view(B * N, C, H, W)
    downsampled = F.interpolate(images_flat, size=(target_size, target_size), mode="bilinear", align_corners=False)
    return downsampled.view(B, N, C, target_size, target_size)


def _upsample_params(params, target_size):
    upsampled = {}
    for key, val in params.items():
        x = val.permute(0, 3, 1, 2)
        x = F.interpolate(x, size=(target_size, target_size), mode="bilinear", align_corners=False)
        upsampled[key] = x.permute(0, 2, 3, 1).detach().requires_grad_(True)
    return upsampled


def _clamp_params_inplace(params):
    with torch.no_grad():
        if "base_color" in params:
            params["base_color"].data.clamp_(0.0, 1.0)
        if "roughness" in params:
            params["roughness"].data.clamp_(0.01, 1.0)
        if "metallic" in params:
            params["metallic"].data.clamp_(0.0, 1.0)
        if "normal" in params:
            params["normal"].data.clamp_(0.0, 1.0)


def _clip_gradients(param_list, max_norm=1.0):
    torch.nn.utils.clip_grad_norm_(param_list, max_norm=max_norm)


class InverseOptimizer:
    def __init__(self, renderer, encoder, lr=0.01, num_iterations=200,
                 loss_fn=None, device="cuda",
                 use_multiscale=True, scales=None, scale_iters=None,
                 grad_clip_norm=1.0,
                 early_stopping=True, early_stopping_patience=50, early_stopping_tol=1e-4,
                 optimizer_type="adam"):
        self.renderer = renderer
        self.encoder = encoder
        self.lr = lr
        self.num_iterations = num_iterations
        self.loss_fn = loss_fn or ReconstructionLoss()
        self.device = device

        self.use_multiscale = use_multiscale
        self.scales = scales or [64, 128, 256]
        self.scale_iters = scale_iters or [50, 50, num_iterations]

        self.grad_clip_norm = grad_clip_norm

        self.early_stopping = early_stopping
        self.early_stopping_patience = early_stopping_patience
        self.early_stopping_tol = early_stopping_tol

        self.optimizer_type = optimizer_type

    def _single_scale_optimize(self, images, camera_params_list, env_map,
                               init_params, num_iters, scale):
        optimized_params = {}
        param_list = []
        for key, val in init_params.items():
            p = val.clone().detach().requires_grad_(True)
            optimized_params[key] = p
            param_list.append(p)

        if self.optimizer_type == "adam":
            optimizer = torch.optim.Adam(param_list, lr=self.lr, betas=(0.9, 0.999))
        elif self.optimizer_type == "sgd":
            optimizer = torch.optim.SGD(param_list, lr=self.lr, momentum=0.9)
        elif self.optimizer_type == "adamw":
            optimizer = torch.optim.AdamW(param_list, lr=self.lr)
        else:
            optimizer = torch.optim.Adam(param_list, lr=self.lr)

        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
            optimizer, T_max=num_iters, eta_min=self.lr * 0.01
        )

        history = []
        best_loss = float("inf")
        patience_counter = 0
        best_params = None

        for it in range(num_iters):
            optimizer.zero_grad()

            total_loss = torch.tensor(0.0, device=self.device)
            for vi in range(images.shape[1]):
                camera_params = camera_params_list[vi]
                rendered = self.renderer(optimized_params, camera_params, env_map)
                target = images[:, vi].permute(0, 2, 3, 1)
                total_loss = total_loss + self.loss_fn(rendered, target, optimized_params)

            total_loss.backward()

            _clip_gradients(param_list, max_norm=self.grad_clip_norm)

            optimizer.step()
            scheduler.step()

            _clamp_params_inplace(optimized_params)

            loss_val = total_loss.item()
            history.append(loss_val)

            if loss_val < best_loss - self.early_stopping_tol:
                best_loss = loss_val
                patience_counter = 0
                best_params = {k: v.detach().clone() for k, v in optimized_params.items()}
            else:
                patience_counter += 1

            if self.early_stopping and patience_counter >= self.early_stopping_patience:
                with torch.no_grad():
                    for key in optimized_params:
                        optimized_params[key].data.copy_(best_params[key])
                print(f"[Scale {scale}] Early stopping at iter {it}, best loss = {best_loss:.6f}")
                break

        if best_params is not None:
            with torch.no_grad():
                for key in optimized_params:
                    optimized_params[key].data.copy_(best_params[key])

        return optimized_params, history

    def optimize(self, images, camera_params_list, env_map=None, initial_params=None):
        self.encoder.eval()
        B, N, C, H, W = images.shape
        original_size = H

        with torch.no_grad():
            if initial_params is None:
                init_params_full = self.encoder(images)
            else:
                init_params_full = initial_params

        if not self.use_multiscale:
            return self._single_scale_optimize(
                images, camera_params_list, env_map,
                init_params_full, self.num_iterations, original_size
            )

        filtered_scales = []
        filtered_iters = []
        for s, it in zip(self.scales, self.scale_iters):
            if s <= original_size:
                filtered_scales.append(s)
                filtered_iters.append(it)

        if filtered_scales[-1] != original_size:
            filtered_scales.append(original_size)
            filtered_iters.append(self.scale_iters[-1])

        current_params = None
        full_history = []

        for scale_idx, (scale, num_iters) in enumerate(zip(filtered_scales, filtered_iters)):
            print(f"=== Multiscale Stage {scale_idx + 1}/{len(filtered_scales)}: {scale}x{scale}, {num_iters} iters ===")

            images_scaled = _downsample_images(images, scale)

            if scale_idx == 0:
                if initial_params is None:
                    with torch.no_grad():
                        init_params = self.encoder(images_scaled)
                else:
                    init_params = _upsample_params(init_params_full, scale)
            else:
                init_params = _upsample_params(current_params, scale)

            current_params, stage_history = self._single_scale_optimize(
                images_scaled, camera_params_list, env_map,
                init_params, num_iters, scale
            )

            full_history.extend(stage_history)

        if current_params is None:
            return init_params_full, []

        final_params = {}
        with torch.no_grad():
            for key, val in current_params.items():
                final_params[key] = val.detach()

        return final_params, full_history
