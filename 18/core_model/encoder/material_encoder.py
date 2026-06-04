import torch
import torch.nn as nn
import torch.nn.functional as F


class ConvBlock(nn.Module):
    def __init__(self, in_ch, out_ch):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(in_ch, out_ch, 3, padding=1),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_ch, out_ch, 3, padding=1),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
        )

    def forward(self, x):
        return self.conv(x)


class ViewEncoder(nn.Module):
    def __init__(self, in_channels=3, base_dim=64):
        super().__init__()
        self.enc = nn.Sequential(
            ConvBlock(in_channels, base_dim),
            nn.MaxPool2d(2),
            ConvBlock(base_dim, base_dim * 2),
            nn.MaxPool2d(2),
            ConvBlock(base_dim * 2, base_dim * 4),
            nn.MaxPool2d(2),
            ConvBlock(base_dim * 4, base_dim * 8),
            nn.AdaptiveAvgPool2d(1),
        )

    def forward(self, x):
        feat = self.enc(x)
        return feat.flatten(1)


class MultiViewAggregator(nn.Module):
    def __init__(self, feat_dim, num_views=8):
        super().__init__()
        self.feat_dim = feat_dim
        self.num_views = num_views
        self.attn = nn.Sequential(
            nn.Linear(feat_dim, feat_dim // 4),
            nn.ReLU(inplace=True),
            nn.Linear(feat_dim // 4, 1),
        )

    def forward(self, view_features):
        B, N, D = view_features.shape
        weights = self.attn(view_features)
        weights = F.softmax(weights, dim=1)
        aggregated = (view_features * weights).sum(dim=1)
        return aggregated


class MaterialDecoder(nn.Module):
    def __init__(self, feat_dim, spatial_size=256):
        super().__init__()
        self.spatial_size = spatial_size
        nf = feat_dim // 4

        self.shared = nn.Sequential(
            nn.Linear(feat_dim, nf * 8 * 8),
            nn.ReLU(inplace=True),
        )

        self.base_color_head = nn.Sequential(
            nn.ConvTranspose2d(nf, nf, 4, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(nf, nf // 2, 4, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(nf // 2, nf // 4, 4, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(nf // 4, nf // 8, 4, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(nf // 8, 3, 4, stride=2, padding=1),
            nn.Sigmoid(),
        )

        self.roughness_head = nn.Sequential(
            nn.ConvTranspose2d(nf, nf, 4, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(nf, nf // 2, 4, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(nf // 2, nf // 4, 4, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(nf // 4, nf // 8, 4, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(nf // 8, 1, 4, stride=2, padding=1),
            nn.Sigmoid(),
        )

        self.metallic_head = nn.Sequential(
            nn.ConvTranspose2d(nf, nf, 4, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(nf, nf // 2, 4, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(nf // 2, nf // 4, 4, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(nf // 4, nf // 8, 4, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(nf // 8, 1, 4, stride=2, padding=1),
            nn.Sigmoid(),
        )

        self.normal_head = nn.Sequential(
            nn.ConvTranspose2d(nf, nf, 4, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(nf, nf // 2, 4, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(nf // 2, nf // 4, 4, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(nf // 4, nf // 8, 4, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(nf // 8, 3, 4, stride=2, padding=1),
            nn.Sigmoid(),
        )

    def forward(self, aggregated_feat):
        x = self.shared(aggregated_feat)
        x = x.view(x.size(0), -1, 8, 8)

        base_color = self.base_color_head(x)
        roughness = self.roughness_head(x)
        metallic = self.metallic_head(x)
        normal = self.normal_head(x)

        target_h, target_w = self.spatial_size, self.spatial_size
        if base_color.shape[-2:] != (target_h, target_w):
            base_color = F.interpolate(base_color, size=(target_h, target_w), mode="bilinear", align_corners=False)
            roughness = F.interpolate(roughness, size=(target_h, target_w), mode="bilinear", align_corners=False)
            metallic = F.interpolate(metallic, size=(target_h, target_w), mode="bilinear", align_corners=False)
            normal = F.interpolate(normal, size=(target_h, target_w), mode="bilinear", align_corners=False)

        return {
            "base_color": base_color.permute(0, 2, 3, 1),
            "roughness": roughness.permute(0, 2, 3, 1),
            "metallic": metallic.permute(0, 2, 3, 1),
            "normal": normal.permute(0, 2, 3, 1),
        }


class MaterialEncoder(nn.Module):
    def __init__(self, num_views=8, image_size=256, base_dim=64):
        super().__init__()
        self.num_views = num_views
        self.image_size = image_size
        feat_dim = base_dim * 8

        self.view_encoder = ViewEncoder(in_channels=3, base_dim=base_dim)
        self.aggregator = MultiViewAggregator(feat_dim, num_views)
        self.decoder = MaterialDecoder(feat_dim, spatial_size=image_size)

    def forward(self, images):
        B, N, C, H, W = images.shape
        assert N >= self.num_views, f"Need at least {self.num_views} views, got {N}"

        images_flat = images.view(B * N, C, H, W)
        view_feats = self.view_encoder(images_flat)
        view_feats = view_feats.view(B, N, -1)

        aggregated = self.aggregator(view_feats)

        material_params = self.decoder(aggregated)

        material_params["roughness"] = material_params["roughness"] * 0.9 + 0.05
        material_params["metallic"] = material_params["metallic"]

        return material_params
