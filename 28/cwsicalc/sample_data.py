import os
import json
import numpy as np
import tifffile as tiff
import cv2
from typing import List
from datetime import datetime, timedelta


def create_sample_data(output_dir: str, num_samples: int = 3) -> List[str]:
    os.makedirs(output_dir, exist_ok=True)
    generated_files = []

    for i in range(num_samples):
        sample_id = f"sample_{i+1:03d}"

        stress_level = 0.2 + (i * 0.3)

        visible_img = _generate_visible_image(stress_level)
        thermal_img = _generate_thermal_image(stress_level, visible_img.shape[:2])

        visible_path = os.path.join(output_dir, f"{sample_id}_visible.jpg")
        cv2.imwrite(visible_path, cv2.cvtColor(visible_img, cv2.COLOR_RGB2BGR))
        generated_files.append(visible_path)

        thermal_path = os.path.join(output_dir, f"{sample_id}_thermal.tiff")
        tiff.imwrite(thermal_path, thermal_img.astype(np.float32))
        generated_files.append(thermal_path)

        meteo_data = {
            "Ta": 28.0 + np.random.uniform(-2, 2),
            "RH": 55.0 + np.random.uniform(-10, 10),
            "wind_speed": 2.5 + np.random.uniform(-1, 1),
            "solar_radiation": 700.0 + np.random.uniform(-100, 100),
            "pressure": 101.325,
            "emissivity": 0.98,
        }
        meteo_path = os.path.join(output_dir, f"{sample_id}_meteo.json")
        with open(meteo_path, "w", encoding="utf-8") as f:
            json.dump(meteo_data, f, indent=2)
        generated_files.append(meteo_path)

    return generated_files


def _generate_visible_image(stress_level: float, size: tuple = (480, 640)) -> np.ndarray:
    h, w = size
    img = np.zeros((h, w, 3), dtype=np.uint8)

    bg_r = int(120 + np.random.randint(-20, 20))
    bg_g = int(100 + np.random.randint(-20, 20))
    bg_b = int(80 + np.random.randint(-20, 20))
    img[:, :] = [bg_r, bg_g, bg_b]

    num_plants = 5 + np.random.randint(3)
    for _ in range(num_plants):
        cx = np.random.randint(100, w - 100)
        cy = np.random.randint(150, h - 100)
        radius = np.random.randint(60, 120)

        if stress_level < 0.4:
            g_base = int(180 + np.random.randint(20, 60))
            r_base = int(40 + np.random.randint(10, 30))
            b_base = int(30 + np.random.randint(10, 30))
        elif stress_level < 0.7:
            g_base = int(140 + np.random.randint(20, 50))
            r_base = int(80 + np.random.randint(20, 50))
            b_base = int(40 + np.random.randint(10, 30))
        else:
            g_base = int(90 + np.random.randint(20, 40))
            r_base = int(130 + np.random.randint(30, 60))
            b_base = int(50 + np.random.randint(10, 30))

        y, x = np.ogrid[:h, :w]
        dist = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)

        for j in range(h):
            for k in range(w):
                if dist[j, k] < radius:
                    noise = np.random.randint(-15, 15, 3)
                    r = np.clip(r_base + noise[0], 0, 255)
                    g = np.clip(g_base + noise[1], 0, 255)
                    b = np.clip(b_base + noise[2], 0, 255)
                    img[j, k] = [r, g, b]

    noise = np.random.randint(-10, 10, img.shape, dtype=np.int16)
    img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)

    return img


def _generate_thermal_image(stress_level: float, size: tuple) -> np.ndarray:
    h, w = size
    base_temp = 28.0

    num_plants = 5 + np.random.randint(3)
    centers = []
    for _ in range(num_plants):
        cx = np.random.randint(100, w - 100)
        cy = np.random.randint(150, h - 150)
        radius = np.random.randint(60, 120)
        temp_elev = 2.0 + stress_level * 8.0 + np.random.uniform(-1, 1)
        centers.append((cx, cy, radius, temp_elev))

    thermal = np.full((h, w), base_temp + np.random.uniform(3, 5), dtype=np.float32)

    y, x = np.ogrid[:h, :w]
    for cx, cy, radius, temp_elev in centers:
        dist = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
        mask = dist < radius
        gaussian = np.exp(-(dist ** 2) / (2 * (radius / 2) ** 2))
        thermal[mask] += temp_elev * gaussian[mask]

    noise = np.random.normal(0, 0.3, thermal.shape)
    thermal += noise

    thermal = np.clip(thermal, 20.0, 45.0)

    return thermal.astype(np.float32)


def create_timeseries_data(
    output_dir: str,
    num_days: int = 7,
    start_date: str = "20260601",
    time_of_day: str = "1200",
    include_missing: bool = True,
    stress_trend: float = 0.05,
) -> List[str]:
    os.makedirs(output_dir, exist_ok=True)
    generated_files = []

    start_dt = datetime.strptime(start_date, "%Y%m%d")

    for day in range(num_days):
        current_dt = start_dt + timedelta(days=day)
        date_str = current_dt.strftime("%Y%m%d")
        sample_name = f"{date_str}_{time_of_day}"

        if include_missing and day == 3:
            thermal_path = os.path.join(output_dir, f"{sample_name}_thermal.tiff")
            tiff.imwrite(thermal_path, np.zeros((10, 10), dtype=np.float32))
            generated_files.append(thermal_path)
            continue

        base_stress = 0.2 + day * stress_trend
        stress_level = np.clip(base_stress + np.random.uniform(-0.05, 0.05), 0.0, 1.0)

        visible_img = _generate_visible_image(stress_level)
        thermal_img = _generate_thermal_image(stress_level, visible_img.shape[:2])

        visible_path = os.path.join(output_dir, f"{sample_name}_rgb.jpg")
        cv2.imwrite(visible_path, cv2.cvtColor(visible_img, cv2.COLOR_RGB2BGR))
        generated_files.append(visible_path)

        thermal_path = os.path.join(output_dir, f"{sample_name}_thermal.tiff")
        tiff.imwrite(thermal_path, thermal_img.astype(np.float32))
        generated_files.append(thermal_path)

        meteo_data = {
            "Ta": 28.0 + np.random.uniform(-2, 2) + day * 0.3,
            "RH": 60.0 + np.random.uniform(-10, 10) - day * 1.0,
            "wind_speed": 2.5 + np.random.uniform(-1, 1),
            "solar_radiation": 750.0 + np.random.uniform(-100, 100) + day * 20,
            "pressure": 101.325,
            "emissivity": 0.98,
        }
        meteo_path = os.path.join(output_dir, f"{sample_name}_meteo.json")
        with open(meteo_path, "w", encoding="utf-8") as f:
            json.dump(meteo_data, f, indent=2)
        generated_files.append(meteo_path)

    return generated_files
