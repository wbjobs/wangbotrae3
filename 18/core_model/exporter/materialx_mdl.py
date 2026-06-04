import os
import json
import numpy as np
from PIL import Image
from datetime import datetime


def save_material_textures(material_params, output_dir, image_size=256):
    os.makedirs(output_dir, exist_ok=True)
    paths = {}

    if "base_color" in material_params:
        arr = material_params["base_color"]
        if hasattr(arr, "detach"):
            arr = arr.detach().cpu().numpy()
        if arr.ndim == 4:
            arr = arr[0]
        if arr.shape[-1] == 3:
            arr = (arr * 255).clip(0, 255).astype(np.uint8)
            img = Image.fromarray(arr, "RGB")
            p = os.path.join(output_dir, "base_color.png")
            img.save(p)
            paths["base_color"] = p

    if "roughness" in material_params:
        arr = material_params["roughness"]
        if hasattr(arr, "detach"):
            arr = arr.detach().cpu().numpy()
        if arr.ndim == 4:
            arr = arr[0]
        if arr.shape[-1] == 1:
            arr = arr.squeeze(-1)
        arr = (arr * 255).clip(0, 255).astype(np.uint8)
        img = Image.fromarray(arr, "L")
        p = os.path.join(output_dir, "roughness.png")
        img.save(p)
        paths["roughness"] = p

    if "metallic" in material_params:
        arr = material_params["metallic"]
        if hasattr(arr, "detach"):
            arr = arr.detach().cpu().numpy()
        if arr.ndim == 4:
            arr = arr[0]
        if arr.shape[-1] == 1:
            arr = arr.squeeze(-1)
        arr = (arr * 255).clip(0, 255).astype(np.uint8)
        img = Image.fromarray(arr, "L")
        p = os.path.join(output_dir, "metallic.png")
        img.save(p)
        paths["metallic"] = p

    if "normal" in material_params:
        arr = material_params["normal"]
        if hasattr(arr, "detach"):
            arr = arr.detach().cpu().numpy()
        if arr.ndim == 4:
            arr = arr[0]
        if arr.shape[-1] == 3:
            arr = (arr * 255).clip(0, 255).astype(np.uint8)
            img = Image.fromarray(arr, "RGB")
            p = os.path.join(output_dir, "normal.png")
            img.save(p)
            paths["normal"] = p

    return paths


def export_materialx(material_params, output_dir, material_name="estimated_material"):
    texture_paths = save_material_textures(material_params, output_dir)

    now = datetime.now().isoformat()

    roughness_val = 0.5
    metallic_val = 0.0
    if "roughness" in material_params:
        r = material_params["roughness"]
        if hasattr(r, "detach"):
            r = r.detach().cpu().numpy()
        roughness_val = float(r.mean())
    if "metallic" in material_params:
        m = material_params["metallic"]
        if hasattr(m, "detach"):
            m = m.detach().cpu().numpy()
        metallic_val = float(m.mean())

    mx_doc = f"""<?xml version="1.0"?>
<materialx version="1.38" fileprefix="./">
  <!-- Material: {material_name} -->
  <!-- Generated: {now} -->

  <node_graph name="NG_{material_name}">
    <image name="base_color_tex" type="color3" nodedef="ND_image_color3">
      <input name="file" type="filename" value="base_color.png" />
      <input name="uaddressmode" type="string" value="periodic" />
      <input name="vaddressmode" type="string" value="periodic" />
    </image>

    <image name="roughness_tex" type="float" nodedef="ND_image_float">
      <input name="file" type="filename" value="roughness.png" />
      <input name="uaddressmode" type="string" value="periodic" />
      <input name="vaddressmode" type="string" value="periodic" />
    </image>

    <image name="metallic_tex" type="float" nodedef="ND_image_float">
      <input name="file" type="filename" value="metallic.png" />
      <input name="uaddressmode" type="string" value="periodic" />
      <input name="vaddressmode" type="string" value="periodic" />
    </image>

    <image name="normal_tex" type="vector3" nodedef="ND_image_vector3">
      <input name="file" type="filename" value="normal.png" />
      <input name="uaddressmode" type="string" value="periodic" />
      <input name="vaddressmode" type="string" value="periodic" />
    </image>

    <normalmap name="normal_map" type="vector3" nodedef="ND_normalmap">
      <input name="in" type="vector3" interfacename="normal_tex" />
    </normalmap>

    <output name="base_color_out" type="color3" nodename="base_color_tex" />
    <output name="roughness_out" type="float" nodename="roughness_tex" />
    <output name="metallic_out" type="float" nodename="metallic_tex" />
    <output name="normal_out" type="vector3" nodename="normal_map" />
  </node_graph>

  <surfacematerial name="{material_name}" type="material">
    <input name="surfaceshader" type="surfaceshader" nodename="SR_{material_name}" />
  </surfacematerial>

  <standard_surface name="SR_{material_name}" type="surfaceshader" nodedef="ND_standard_surface_surfaceshader">
    <input name="base" type="float" value="1.0" />
    <input name="base_color" type="color3" nodegraph="NG_{material_name}" output="base_color_out" />
    <input name="diffuse_roughness" type="float" value="{roughness_val:.4f}" />
    <input name="metalness" type="float" nodegraph="NG_{material_name}" output="metallic_out" />
    <input name="specular" type="float" value="1.0" />
    <input name="specular_color" type="color3" value="1, 1, 1" />
    <input name="specular_roughness" type="float" nodegraph="NG_{material_name}" output="roughness_out" />
    <input name="normal" type="vector3" nodegraph="NG_{material_name}" output="normal_out" />
  </standard_surface>
</materialx>
"""
    mx_path = os.path.join(output_dir, f"{material_name}.mtlx")
    with open(mx_path, "w", encoding="utf-8") as f:
        f.write(mx_doc)

    return mx_path, texture_paths


def export_mdl(material_params, output_dir, material_name="estimated_material"):
    texture_paths = save_material_textures(material_params, output_dir)

    roughness_val = 0.5
    metallic_val = 0.0
    if "roughness" in material_params:
        r = material_params["roughness"]
        if hasattr(r, "detach"):
            r = r.detach().cpu().numpy()
        roughness_val = float(r.mean())
    if "metallic" in material_params:
        m = material_params["metallic"]
        if hasattr(m, "detach"):
            m = m.detach().cpu().numpy()
        metallic_val = float(m.mean())

    mdl_doc = f"""mdl 1.8;

import ::df::*;
import ::base::*;
import ::tex::*;
import ::state::*;
import ::math::*;
import ::anno::*;

using namespace ::base;
using namespace ::df;

export material {material_name}()
{{
    texture_2d base_color_tex = tex::texture_2d("base_color.png", ::tex::gamma_srgb);
    texture_2d roughness_tex  = tex::texture_2d("roughness.png", ::tex::gamma_linear);
    texture_2d metallic_tex   = tex::texture_2d("metallic.png", ::tex::gamma_linear);
    texture_2d normal_tex     = tex::texture_2d("normal.png", ::tex::gamma_linear);

    color base_color_val = tex::lookup_color(base_color_tex, ::tex::wrap_repeat, ::tex::wrap_repeat);
    float roughness_val  = tex::lookup_float(roughness_tex, ::tex::wrap_repeat, ::tex::wrap_repeat);
    float metallic_val   = tex::lookup_float(metallic_tex, ::tex::wrap_repeat, ::tex::wrap_repeat);
    float3 normal_val    = tex::lookup_float3(normal_tex, ::tex::wrap_repeat, ::tex::wrap_repeat);

    float3 tangent = state::texture_tangent_u(0);
    float3 bitangent = state::texture_tangent_v(0);
    float3 normal_mapped = normal_val.x * tangent + normal_val.y * bitangent + normal_val.z * state::normal();

    color spec_color = mix(color(0.04), base_color_val, metallic_val);
    color diff_color = base_color_val * (1.0 - metallic_val);

    material e = material(
        surface: material_surface(
            scattering: df::diffuse_reflection_bsdf(
                tint: diff_color
            ) +
            df::specular_glossy_bsdf(
                tint: spec_color,
                roughness_u: roughness_val,
                roughness_v: roughness_val
            ),
            normal: normal_mapped
        )
    );
    return e;
}}
"""
    mdl_path = os.path.join(output_dir, f"{material_name}.mdl")
    with open(mdl_path, "w", encoding="utf-8") as f:
        f.write(mdl_doc)

    return mdl_path, texture_paths
