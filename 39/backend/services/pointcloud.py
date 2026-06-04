import os
import json
import base64
import io
import numpy as np
from scipy.signal import find_peaks, medfilt
from scipy.optimize import curve_fit
from typing import Optional

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")

C = 3e8


def _hyperbola_model(x: np.ndarray, h: float, a: float, k: float) -> np.ndarray:
    return np.sqrt(((x - h) ** 2) / (a ** 2) + k)


def bscan_to_pointcloud(bscan_data: dict, params: dict) -> tuple[np.ndarray, np.ndarray]:
    traces = bscan_data.get("traces", [])
    if not traces:
        return np.empty((0, 3)), np.empty((0, 3))

    dielectric_constant = params.get("dielectric_constant", 6.0)
    filter_window = int(params.get("filter_window", 5.0))
    fitting_threshold = params.get("fitting_threshold", 0.3)

    velocity = C / np.sqrt(dielectric_constant)

    trace_positions = []
    amplitude_matrix = []
    time_values = []

    for trace in traces:
        pos = trace.get("position", [0.0, 0.0])
        trace_positions.append(pos)
        samples = trace.get("samples", [])
        amps = [s.get("amplitude", 0.0) for s in samples]
        times = [s.get("two_way_time", 0.0) for s in samples]
        amplitude_matrix.append(amps)
        if not time_values:
            time_values = times

    amplitude_matrix = np.array(amplitude_matrix, dtype=np.float64)
    if amplitude_matrix.ndim != 2:
        return np.empty((0, 3)), np.empty((0, 3))

    num_traces, num_samples = amplitude_matrix.shape

    time_arr = np.array(time_values, dtype=np.float64) if time_values else np.linspace(0, 100e-9, num_samples)
    depth_arr = velocity * time_arr / 2.0

    if filter_window > 1:
        if filter_window % 2 == 0:
            filter_window += 1
        for i in range(num_traces):
            amplitude_matrix[i, :] = medfilt(amplitude_matrix[i, :], kernel_size=filter_window)

    abs_max = np.max(np.abs(amplitude_matrix))
    if abs_max > 0:
        amplitude_matrix = amplitude_matrix / abs_max

    all_points = []
    all_colors = []

    for trace_idx in range(num_traces):
        trace_amps = amplitude_matrix[trace_idx, :]
        peaks, properties = find_peaks(np.abs(trace_amps), height=fitting_threshold, distance=5)

        if len(peaks) == 0:
            continue

        peak_amps = trace_amps[peaks]
        peak_depths = depth_arr[peaks] if len(depth_arr) >= num_samples else np.arange(len(peaks)) * 0.01

        if len(peaks) >= 3:
            x_positions = np.array([trace_positions[trace_idx][0]] * len(peaks), dtype=np.float64)
            y_position = trace_positions[trace_idx][1]

            try:
                x_data = x_positions
                y_data = peak_depths
                p0 = [x_positions[0], 0.5, np.min(y_data)]
                bounds = (
                    [np.min(x_data) - 1.0, 0.01, 0.0],
                    [np.max(x_data) + 1.0, 10.0, np.max(y_data) + 1.0]
                )
                popt, _ = curve_fit(_hyperbola_model, x_data, y_data, p0=p0, bounds=bounds, maxfev=2000)
                h_fit, a_fit, k_fit = popt

                fitted_depths = _hyperbola_model(x_positions, h_fit, a_fit, k_fit)

                for j, peak_idx in enumerate(peaks):
                    pt = [
                        trace_positions[trace_idx][0],
                        y_position,
                        fitted_depths[j]
                    ]
                    all_points.append(pt)
                    intensity = abs(peak_amps[j])
                    color = [1.0 - intensity * 0.5, 0.3 + intensity * 0.4, intensity]
                    all_colors.append(color)
            except (RuntimeError, ValueError):
                for j, peak_idx in enumerate(peaks):
                    pt = [
                        trace_positions[trace_idx][0],
                        trace_positions[trace_idx][1],
                        peak_depths[j]
                    ]
                    all_points.append(pt)
                    intensity = abs(peak_amps[j])
                    color = [1.0 - intensity * 0.5, 0.3 + intensity * 0.4, intensity]
                    all_colors.append(color)
        else:
            for j, peak_idx in enumerate(peaks):
                pt = [
                    trace_positions[trace_idx][0],
                    trace_positions[trace_idx][1],
                    peak_depths[j]
                ]
                all_points.append(pt)
                intensity = abs(peak_amps[j])
                color = [1.0 - intensity * 0.5, 0.3 + intensity * 0.4, intensity]
                all_colors.append(color)

    if not all_points:
        return np.empty((0, 3)), np.empty((0, 3))

    return np.array(all_points, dtype=np.float64), np.array(all_colors, dtype=np.float64)


def filter_pointcloud(points: np.ndarray, colors: np.ndarray,
                      nb_neighbors: int = 20, std_ratio: float = 2.0) -> tuple[np.ndarray, np.ndarray]:
    if len(points) == 0:
        return points, colors

    try:
        import open3d as o3d
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(points)
        pcd.colors = o3d.utility.Vector3dVector(colors)

        pcd_filtered, _ = pcd.remove_statistical_outlier(
            nb_neighbors=nb_neighbors, std_ratio=std_ratio
        )

        filtered_points = np.asarray(pcd_filtered.points)
        filtered_colors = np.asarray(pcd_filtered.colors)

        return filtered_points, filtered_colors
    except ImportError:
        return points, colors


def save_pointcloud(project_id: str, points: np.ndarray, colors: np.ndarray) -> str:
    project_dir = os.path.join(UPLOAD_DIR, project_id)
    os.makedirs(project_dir, exist_ok=True)

    ply_path = os.path.join(project_dir, "pointcloud.ply")

    try:
        import open3d as o3d
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(points)
        pcd.colors = o3d.utility.Vector3dVector(colors)
        o3d.io.write_point_cloud(ply_path, pcd)
    except ImportError:
        _write_ply_manual(ply_path, points, colors)

    slice_count = 8
    if len(points) > 0:
        total = len(points)
        slice_size = max(1, total // slice_count)
        for i in range(slice_count):
            start = i * slice_size
            end = start + slice_size if i < slice_count - 1 else total
            slice_points = points[start:end]
            slice_colors = colors[start:end]
            slice_path = os.path.join(project_dir, f"slice_{i}.ply")
            try:
                import open3d as o3d
                pcd_slice = o3d.geometry.PointCloud()
                pcd_slice.points = o3d.utility.Vector3dVector(slice_points)
                pcd_slice.colors = o3d.utility.Vector3dVector(slice_colors)
                o3d.io.write_point_cloud(slice_path, pcd_slice)
            except ImportError:
                _write_ply_manual(slice_path, slice_points, slice_colors)

    return ply_path


def _write_ply_manual(path: str, points: np.ndarray, colors: np.ndarray) -> None:
    with open(path, "w") as f:
        f.write("ply\n")
        f.write("format ascii 1.0\n")
        f.write(f"element vertex {len(points)}\n")
        f.write("property float x\n")
        f.write("property float y\n")
        f.write("property float z\n")
        f.write("property uchar red\n")
        f.write("property uchar green\n")
        f.write("property uchar blue\n")
        f.write("end_header\n")
        for i in range(len(points)):
            r = int(np.clip(colors[i][0] * 255, 0, 255))
            g = int(np.clip(colors[i][1] * 255, 0, 255))
            b = int(np.clip(colors[i][2] * 255, 0, 255))
            f.write(f"{points[i][0]} {points[i][1]} {points[i][2]} {r} {g} {b}\n")


def load_pointcloud_slice(project_id: str, slice_index: int, slice_count: int = 8) -> Optional[dict]:
    project_dir = os.path.join(UPLOAD_DIR, project_id)
    if not os.path.exists(project_dir):
        return None

    ply_path = os.path.join(project_dir, "pointcloud.ply")
    slice_path = os.path.join(project_dir, f"slice_{slice_index}.ply")

    if os.path.exists(slice_path):
        load_path = slice_path
    elif os.path.exists(ply_path):
        load_path = ply_path
    else:
        return None

    try:
        import open3d as o3d
        pcd = o3d.io.read_point_cloud(load_path)
        points = np.asarray(pcd.points)
        colors = np.asarray(pcd.colors)

        if len(points) == 0:
            return {"points": [], "colors": [], "total": 0}

        if load_path == ply_path and len(points) > 0:
            total = len(points)
            slice_size = max(1, total // slice_count)
            start = slice_index * slice_size
            end = start + slice_size if slice_index < slice_count - 1 else total
            points = points[start:end]
            colors = colors[start:end]

        return {
            "points": points.tolist(),
            "colors": colors.tolist(),
            "total": len(points),
        }
    except ImportError:
        return _load_ply_manual(load_path, slice_index, slice_count)


def _load_ply_manual(path: str, slice_index: int = 0, slice_count: int = 8) -> Optional[dict]:
    if not os.path.exists(path):
        return None

    points_list = []
    colors_list = []

    with open(path, "r") as f:
        in_data = False
        for line in f:
            line = line.strip()
            if line == "end_header":
                in_data = True
                continue
            if in_data:
                parts = line.split()
                if len(parts) >= 6:
                    points_list.append([float(parts[0]), float(parts[1]), float(parts[2])])
                    colors_list.append([float(parts[3]) / 255.0, float(parts[4]) / 255.0, float(parts[5]) / 255.0])

    if not points_list:
        return {"points": [], "colors": [], "total": 0}

    points = np.array(points_list)
    colors = np.array(colors_list)

    total = len(points)
    slice_size = max(1, total // slice_count)
    start = slice_index * slice_size
    end = start + slice_size if slice_index < slice_count - 1 else total
    points = points[start:end]
    colors = colors[start:end]

    return {
        "points": points.tolist(),
        "colors": colors.tolist(),
        "total": len(points),
    }


def generate_bscan_preview(bscan_data: dict) -> str:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    traces = bscan_data.get("traces", [])
    if not traces:
        fig, ax = plt.subplots(figsize=(8, 4))
        ax.text(0.5, 0.5, "No B-scan data", ha="center", va="center")
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=100, bbox_inches="tight")
        plt.close(fig)
        buf.seek(0)
        return base64.b64encode(buf.read()).decode("utf-8")

    num_traces = len(traces)
    num_samples = max(len(t.get("samples", [])) for t in traces)

    bscan_image = np.zeros((num_samples, num_traces), dtype=np.float64)
    x_positions = []

    for i, trace in enumerate(traces):
        samples = trace.get("samples", [])
        pos = trace.get("position", [0.0, 0.0])
        x_positions.append(pos[0])
        for j, sample in enumerate(samples):
            if j < num_samples:
                bscan_image[j, i] = sample.get("amplitude", 0.0)

    fig, ax = plt.subplots(figsize=(10, 6))
    extent = [x_positions[0] if x_positions else 0, x_positions[-1] if x_positions else 1,
              num_samples, 0]
    ax.imshow(bscan_image, aspect="auto", cmap="seismic", extent=extent)
    ax.set_xlabel("Position (m)")
    ax.set_ylabel("Sample Index")
    ax.set_title("B-scan Preview")

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=100, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("utf-8")
