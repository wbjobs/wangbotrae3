import torch
import torch.nn as nn
import math


def _safe_normalize(v, eps=1e-8):
    return v / (v.norm(dim=-1, keepdim=True) + eps)


def _schlick_fresnel(cos_theta, f0):
    return f0 + (1.0 - f0) * (1.0 - cos_theta).pow(5)


def _ggx_distribution(n, h, roughness):
    a = roughness.pow(2)
    a2 = a * a
    ndoth = (n * h).sum(dim=-1, keepdim=True).clamp(min=0.0)
    ndoth2 = ndoth.pow(2)
    denom = math.pi * (ndoth2 * (a2 - 1.0) + 1.0).pow(2)
    return a2 / (denom + 1e-7)


def _ggx_geometry_smith(n, v, l, roughness):
    return _ggx_geometry_schlick_ggx(n, v, roughness) * _ggx_geometry_schlick_ggx(n, l, roughness)


def _ggx_geometry_schlick_ggx(n, v_or_l, roughness):
    a = roughness.pow(2)
    k = a / 2.0
    nodot = (n * v_or_l).sum(dim=-1, keepdim=True).clamp(min=0.0)
    return nodot / (nodot * (1.0 - k) + k + 1e-7)


class GGXBRDF(nn.Module):
    def __init__(self):
        super().__init__()

    def forward(self, wo, wi, normal, base_color, roughness, metallic):
        h = _safe_normalize(wo + wi)
        ndotwi = (normal * wi).sum(dim=-1, keepdim=True).clamp(min=0.0)
        ndotwo = (normal * wo).sum(dim=-1, keepdim=True).clamp(min=0.0)

        f0 = (1.0 - metallic) * 0.04 + metallic * base_color
        f = _schlick_fresnel((h * wi).sum(dim=-1, keepdim=True).clamp(min=0.0), f0)

        d = _ggx_distribution(normal, h, roughness)
        g = _ggx_geometry_smith(normal, wo, wi, roughness)

        specular = (d * f * g) / (4.0 * ndotwi * ndotwo + 1e-5)

        kd = (1.0 - f) * (1.0 - metallic)
        diffuse = kd * base_color / math.pi

        return (diffuse + specular) * ndotwi


class LambertianBRDF(nn.Module):
    def __init__(self):
        super().__init__()

    def forward(self, wo, wi, normal, base_color, roughness=None, metallic=None):
        ndotwi = (normal * wi).sum(dim=-1, keepdim=True).clamp(min=0.0)
        return base_color / math.pi * ndotwi


class DisneyPrincipledBRDF(nn.Module):
    def __init__(self):
        super().__init__()
        self.ggx = GGXBRDF()

    def forward(self, wo, wi, normal, base_color, roughness, metallic,
                specular=0.5, specular_tint=0.0, anisotropic=0.0,
                sheen=0.0, sheen_tint=0.5, clearcoat=0.0, clearcoat_roughness=0.03):
        h = _safe_normalize(wo + wi)
        ndotwi = (normal * wi).sum(dim=-1, keepdim=True).clamp(min=0.0)
        ndotwo = (normal * wo).sum(dim=-1, keepdim=True).clamp(min=0.0)
        hdotwi = (h * wi).sum(dim=-1, keepdim=True).clamp(min=0.0)

        lum = 0.2126 * base_color[..., 0:1] + 0.7152 * base_color[..., 1:2] + 0.0722 * base_color[..., 2:3]
        ctint = base_color / (lum + 1e-5)
        csheen_tint = sheen_tint * ctint + (1.0 - sheen_tint)
        f0_s = 0.08 * specular * ((1.0 - specular_tint) + specular_tint * ctint)
        f0 = (1.0 - metallic) * f0_s + metallic * base_color

        f = _schlick_fresnel(hdotwi, f0)
        d = _ggx_distribution(normal, h, roughness)
        g = _ggx_geometry_smith(normal, wo, wi, roughness)
        specular_brdf = (d * f * g) / (4.0 * ndotwi * ndotwo + 1e-5)

        f_sheen = sheen * csheen_tint * (1.0 - metallic) * (1.0 - hdotwi).pow(5)

        kd = (1.0 - f) * (1.0 - metallic)
        diffuse_brdf = (1.0 / math.pi) * base_color * kd + f_sheen

        dr = _ggx_distribution(normal, h, clearcoat_roughness.clamp(min=0.03))
        fr_c = 0.04 + 0.96 * (1.0 - hdotwi).pow(5)
        gr = _ggx_geometry_schlick_ggx(normal, wo, clearcoat_roughness.clamp(min=0.03)) * \
             _ggx_geometry_schlick_ggx(normal, wi, clearcoat_roughness.clamp(min=0.03))
        clearcoat_brdf = 0.25 * clearcoat * dr * fr_c * gr / (4.0 * ndotwi * ndotwo + 1e-5)

        return (diffuse_brdf + specular_brdf) * ndotwi + clearcoat_brdf * ndotwi


BRDF_REGISTRY = {
    "ggx": GGXBRDF,
    "lambertian": LambertianBRDF,
    "disney": DisneyPrincipledBRDF,
}
