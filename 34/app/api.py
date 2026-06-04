import io
import os
import tempfile
import logging
import numpy as np
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from fastapi.responses import StreamingResponse, JSONResponse
from typing import Optional

from app.engine import GIUHEngine, nash_sutcliffe_efficiency
from app.scheduler import ParallelScheduler, TaskManager
from app.visualization import plot_hydrograph, plot_subbasins_map, generate_csv
from app.models import (
    SimulationRequest, SimulationResult, TaskStatus,
    CalibrationRequest, CalibrationResult, CalibrationParams,
)

logger = logging.getLogger(__name__)

router = APIRouter()

task_manager = TaskManager()


def _read_dem(filepath):
    try:
        import rasterio
        with rasterio.open(filepath) as src:
            dem = src.read(1).astype(np.float64)
            nodata = src.nodata
            if nodata is not None:
                dem[dem == nodata] = -9999.0
            dem[dem < -9000] = -9999.0
            return dem
    except ImportError:
        try:
            from osgeo import gdal
            ds = gdal.Open(filepath)
            band = ds.GetRasterBand(1)
            dem = band.ReadAsArray().astype(np.float64)
            nodata = band.GetNoDataValue()
            if nodata is not None:
                dem[dem == nodata] = -9999.0
            dem[dem < -9000] = -9999.0
            ds = None
            return dem
        except ImportError:
            raise HTTPException(
                status_code=500,
                detail="Neither rasterio nor GDAL available for DEM reading"
            )


def _read_rainfall_netcdf(filepath):
    try:
        import netCDF4 as nc
        ds = nc.Dataset(filepath, "r")

        rain_var = None
        for name in ds.variables:
            lname = name.lower()
            if "rain" in lname or "precip" in lname or "pr" == lname:
                rain_var = name
                break

        if rain_var is None:
            vars_list = list(ds.variables.keys())
            if len(vars_list) > 0:
                for v in vars_list:
                    if ds[v].dimensions and len(ds[v].shape) >= 1:
                        rain_var = v
                        break
            if rain_var is None:
                ds.close()
                raise HTTPException(
                    status_code=400,
                    detail=f"No rainfall variable found in NetCDF. Available: {vars_list}"
                )

        rain_data = ds[rain_var][:]
        if hasattr(rain_data, "mask"):
            rain_data = np.ma.filled(rain_data, 0.0)

        if rain_data.ndim == 1:
            result = rain_data.astype(np.float64)
        elif rain_data.ndim == 2:
            result = np.nanmean(rain_data, axis=tuple(range(rain_data.ndim - 1)))
            result = result.astype(np.float64)
        elif rain_data.ndim == 3:
            spatial_axes = tuple(range(rain_data.ndim - 1))
            result = np.nanmean(rain_data.reshape(-1, rain_data.shape[-1]), axis=0)
            result = result.astype(np.float64)
        else:
            result = np.nanmean(rain_data.reshape(-1, rain_data.shape[-1]), axis=0)
            result = result.astype(np.float64)

        ds.close()
        return result
    except ImportError:
        raise HTTPException(status_code=500, detail="netCDF4 not installed")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error reading NetCDF: {str(e)}")


def _read_observed_flow(filepath):
    try:
        import pandas as pd
        df = pd.read_csv(filepath)
        for col in df.columns:
            lname = col.lower()
            if "flow" in lname or "discharge" in lname or "q" == lname:
                data = pd.to_numeric(df[col], errors="coerce").dropna().values
                if len(data) > 0:
                    return data.astype(np.float64)
        if len(df.columns) >= 1:
            data = pd.to_numeric(df.iloc[:, -1], errors="coerce").dropna().values
            if len(data) > 0:
                return data.astype(np.float64)
        raise HTTPException(
            status_code=400,
            detail="No flow data found in CSV. Expected column with 'flow', 'discharge', or 'q'."
        )
    except ImportError:
        import csv
        with open(filepath, "r") as f:
            reader = csv.reader(f)
            header = next(reader, None)
            flow_idx = 0
            if header:
                for i, col in enumerate(header):
                    lname = col.lower()
                    if "flow" in lname or "discharge" in lname or "q" == lname:
                        flow_idx = i
                        break
            data = []
            for row in reader:
                if len(row) > flow_idx:
                    try:
                        val = float(row[flow_idx])
                        data.append(val)
                    except ValueError:
                        pass
        if len(data) == 0:
            raise HTTPException(
                status_code=400,
                detail="No numeric flow data found in CSV"
            )
        return np.array(data, dtype=np.float64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error reading observed flow CSV: {str(e)}")


def _run_simulation(dem, rainfall, params, calib_params=None):
    engine = GIUHEngine(
        cell_size=params.get("cell_size", 30.0),
        time_step=params.get("time_step", 3600.0),
        stream_threshold=params.get("stream_threshold", 0.02),
        n_subbasins=params.get("n_subbasins", 4),
    )

    if calib_params is not None:
        engine.set_calib_params(calib_params)

    n_sub = params.get("n_subbasins", 4)
    rainfall_list = [rainfall.tolist() for _ in range(n_sub)]

    scheduler = ParallelScheduler(
        n_workers=params.get("n_workers"),
        mode=params.get("parallel_mode", "process"),
    )

    result = engine.run_giuh(dem, rainfall_list)
    return result


def _run_calibration(dem, rainfall, observed_flow, params):
    engine = GIUHEngine(
        cell_size=params.get("cell_size", 30.0),
        time_step=params.get("time_step", 3600.0),
        stream_threshold=params.get("stream_threshold", 0.02),
        n_subbasins=params.get("n_subbasins", 4),
    )

    n_sub = params.get("n_subbasins", 4)
    rainfall_list = [rainfall.tolist() for _ in range(n_sub)]

    if len(observed_flow) > len(rainfall):
        observed_flow = observed_flow[:len(rainfall)]
    elif len(observed_flow) < len(rainfall):
        pad_len = len(rainfall) - len(observed_flow)
        observed_flow = np.pad(observed_flow, (0, pad_len), mode="edge")

    initial_sim = engine.run_giuh(dem, rainfall_list)
    initial_nse = nash_sutcliffe_efficiency(initial_sim["flow"], observed_flow)

    scheduler = ParallelScheduler(
        n_workers=params.get("n_workers"),
        mode="process",
    )

    calib_result = scheduler.run_calibration(
        engine=engine,
        dem=dem,
        rainfall_by_subbasin=rainfall_list,
        observed_flow=observed_flow,
        param_names=params.get("param_names"),
        max_iterations=params.get("max_iterations", 30),
        random_seed=params.get("random_seed", 42),
    )

    calib_result["initial_nse"] = float(initial_nse)

    engine.set_calib_params(calib_result["best_params"])
    final_sim = engine.run_giuh(dem, rainfall_list)
    calib_result["final_simulation"] = final_sim
    calib_result["observed_flow"] = observed_flow.tolist()

    return calib_result


@router.post("/simulate", summary="Run GIUH simulation with uploaded files")
async def run_simulation(
    dem_file: UploadFile = File(..., description="DEM file (GeoTIFF)"),
    rainfall_file: UploadFile = File(..., description="Rainfall file (NetCDF)"),
    cell_size: float = Form(default=30.0),
    time_step: float = Form(default=3600.0),
    stream_threshold: float = Form(default=0.02),
    n_subbasins: int = Form(default=4),
    n_workers: Optional[int] = Form(default=None),
    parallel_mode: str = Form(default="process"),
):
    with tempfile.TemporaryDirectory() as tmpdir:
        dem_path = os.path.join(tmpdir, "dem.tif")
        rain_path = os.path.join(tmpdir, "rainfall.nc")

        with open(dem_path, "wb") as f:
            content = await dem_file.read()
            f.write(content)

        with open(rain_path, "wb") as f:
            content = await rainfall_file.read()
            f.write(content)

        dem = _read_dem(dem_path)
        rainfall = _read_rainfall_netcdf(rain_path)

    params = {
        "cell_size": cell_size,
        "time_step": time_step,
        "stream_threshold": stream_threshold,
        "n_subbasins": n_subbasins,
        "n_workers": n_workers,
        "parallel_mode": parallel_mode,
    }

    try:
        result = _run_simulation(dem, rainfall, params)
    except Exception as e:
        logger.error(f"Simulation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Simulation failed: {str(e)}")

    flow = result["flow"]
    sub_flows = result.get("sub_flows")
    n_sub = result.get("n_subbasins", 1)
    labels = result.get("labels")
    outlets = result.get("outlets", [])

    peak_idx = np.argmax(flow)
    peak_flow = float(flow[peak_idx])
    peak_time_h = float(peak_idx * time_step / 3600.0)
    total_volume = float(np.sum(flow) * time_step)

    wb = GIUHEngine.check_water_balance(result, [rainfall.tolist()], cell_size)

    csv_content = generate_csv(flow, time_step, sub_flows, n_sub)
    hydrograph_buf = plot_hydrograph(
        flow, time_step, sub_flows, n_sub,
        rainfall=rainfall,
        title="Watershed Outlet Hydrograph (GIUH)",
    )

    combined_buf = io.BytesIO()
    import zipfile
    with zipfile.ZipFile(combined_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("hydrograph.csv", csv_content)
        zf.writestr("hydrograph.png", hydrograph_buf.getvalue())

        if labels is not None and len(outlets) > 0:
            map_buf = plot_subbasins_map(labels, dem, outlets, cell_size)
            zf.writestr("subbasins_map.png", map_buf.getvalue())

        meta = (
            "Peak Flow: {:.4f} m3/s\n"
            "Peak Time: {:.2f} h\n"
            "Total Outflow Volume: {:.2f} m3\n"
            "Total Rainfall Volume: {:.2f} m3\n"
            "Conservation Ratio: {:.4f}\n"
            "Water Balance Conserved: {}\n"
            "Sub-basins: {}\n"
            "Cell Size: {} m\n"
            "Time Step: {} s\n"
        ).format(
            peak_flow, peak_time_h, total_volume,
            wb["total_rainfall_volume_m3"],
            wb["conservation_ratio"],
            wb["is_conserved"],
            n_sub, cell_size, time_step,
        )
        zf.writestr("metadata.txt", meta)

    combined_buf.seek(0)

    return StreamingResponse(
        combined_buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=giuh_result.zip"},
    )


@router.post("/simulate/hydrograph",
             summary="Run simulation and return hydrograph PNG")
async def run_simulation_hydrograph(
    dem_file: UploadFile = File(...),
    rainfall_file: UploadFile = File(...),
    cell_size: float = Form(default=30.0),
    time_step: float = Form(default=3600.0),
    stream_threshold: float = Form(default=0.02),
    n_subbasins: int = Form(default=4),
):
    with tempfile.TemporaryDirectory() as tmpdir:
        dem_path = os.path.join(tmpdir, "dem.tif")
        rain_path = os.path.join(tmpdir, "rainfall.nc")
        with open(dem_path, "wb") as f:
            f.write(await dem_file.read())
        with open(rain_path, "wb") as f:
            f.write(await rainfall_file.read())

        dem = _read_dem(dem_path)
        rainfall = _read_rainfall_netcdf(rain_path)

    params = {
        "cell_size": cell_size,
        "time_step": time_step,
        "stream_threshold": stream_threshold,
        "n_subbasins": n_subbasins,
    }

    result = _run_simulation(dem, rainfall, params)
    flow = result["flow"]
    sub_flows = result.get("sub_flows")
    n_sub = result.get("n_subbasins", 1)

    buf = plot_hydrograph(flow, time_step, sub_flows, n_sub, rainfall=rainfall)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="image/png",
        headers={"Content-Disposition": "attachment; filename=hydrograph.png"},
    )


@router.post("/simulate/csv",
             summary="Run simulation and return CSV data")
async def run_simulation_csv(
    dem_file: UploadFile = File(...),
    rainfall_file: UploadFile = File(...),
    cell_size: float = Form(default=30.0),
    time_step: float = Form(default=3600.0),
    stream_threshold: float = Form(default=0.02),
    n_subbasins: int = Form(default=4),
):
    with tempfile.TemporaryDirectory() as tmpdir:
        dem_path = os.path.join(tmpdir, "dem.tif")
        rain_path = os.path.join(tmpdir, "rainfall.nc")
        with open(dem_path, "wb") as f:
            f.write(await dem_file.read())
        with open(rain_path, "wb") as f:
            f.write(await rainfall_file.read())

        dem = _read_dem(dem_path)
        rainfall = _read_rainfall_netcdf(rain_path)

    params = {
        "cell_size": cell_size,
        "time_step": time_step,
        "stream_threshold": stream_threshold,
        "n_subbasins": n_subbasins,
    }

    result = _run_simulation(dem, rainfall, params)
    flow = result["flow"]
    sub_flows = result.get("sub_flows")
    n_sub = result.get("n_subbasins", 1)

    csv_content = generate_csv(flow, time_step, sub_flows, n_sub)

    return StreamingResponse(
        io.BytesIO(csv_content.encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=hydrograph.csv"},
    )


@router.post("/simulate/subbasins",
             summary="Run simulation and return sub-basin map PNG")
async def run_simulation_subbasins(
    dem_file: UploadFile = File(...),
    rainfall_file: UploadFile = File(...),
    cell_size: float = Form(default=30.0),
    time_step: float = Form(default=3600.0),
    stream_threshold: float = Form(default=0.02),
    n_subbasins: int = Form(default=4),
):
    with tempfile.TemporaryDirectory() as tmpdir:
        dem_path = os.path.join(tmpdir, "dem.tif")
        rain_path = os.path.join(tmpdir, "rainfall.nc")
        with open(dem_path, "wb") as f:
            f.write(await dem_file.read())
        with open(rain_path, "wb") as f:
            f.write(await rainfall_file.read())

        dem = _read_dem(dem_path)
        rainfall = _read_rainfall_netcdf(rain_path)

    params = {
        "cell_size": cell_size,
        "time_step": time_step,
        "stream_threshold": stream_threshold,
        "n_subbasins": n_subbasins,
    }

    result = _run_simulation(dem, rainfall, params)
    labels = result.get("labels")
    outlets = result.get("outlets", [])

    if labels is None or len(outlets) == 0:
        raise HTTPException(status_code=500, detail="Sub-basin partitioning failed")

    buf = plot_subbasins_map(labels, dem, outlets, cell_size)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="image/png",
        headers={"Content-Disposition": "attachment; filename=subbasins_map.png"},
    )


@router.post("/calibrate", summary="Bayesian parameter calibration with observed flow data")
async def calibrate_parameters(
    dem_file: UploadFile = File(..., description="DEM file (GeoTIFF)"),
    rainfall_file: UploadFile = File(..., description="Rainfall file (NetCDF)"),
    observed_flow_file: UploadFile = File(..., description="Observed flow data (CSV with flow/discharge column)"),
    cell_size: float = Form(default=30.0),
    time_step: float = Form(default=3600.0),
    stream_threshold: float = Form(default=0.02),
    n_subbasins: int = Form(default=4),
    n_workers: Optional[int] = Form(default=None),
    param_names: Optional[str] = Form(default=None, description="Comma-separated list of parameters to calibrate"),
    max_iterations: int = Form(default=30, ge=5, le=200),
    random_seed: int = Form(default=42),
):
    with tempfile.TemporaryDirectory() as tmpdir:
        dem_path = os.path.join(tmpdir, "dem.tif")
        rain_path = os.path.join(tmpdir, "rainfall.nc")
        obs_path = os.path.join(tmpdir, "observed.csv")

        with open(dem_path, "wb") as f:
            f.write(await dem_file.read())
        with open(rain_path, "wb") as f:
            f.write(await rainfall_file.read())
        with open(obs_path, "wb") as f:
            f.write(await observed_flow_file.read())

        dem = _read_dem(dem_path)
        rainfall = _read_rainfall_netcdf(rain_path)
        observed_flow = _read_observed_flow(obs_path)

    param_list = None
    if param_names:
        param_list = [p.strip() for p in param_names.split(",") if p.strip()]

    params = {
        "cell_size": cell_size,
        "time_step": time_step,
        "stream_threshold": stream_threshold,
        "n_subbasins": n_subbasins,
        "n_workers": n_workers,
        "param_names": param_list,
        "max_iterations": max_iterations,
        "random_seed": random_seed,
    }

    try:
        calib_result = _run_calibration(dem, rainfall, observed_flow, params)
    except Exception as e:
        logger.error(f"Calibration failed: {e}")
        raise HTTPException(status_code=500, detail=f"Calibration failed: {str(e)}")

    final_sim = calib_result["final_simulation"]
    flow = final_sim["flow"]
    observed_flow_aligned = np.array(calib_result["observed_flow"])
    n_sub = final_sim.get("n_subbasins", 1)
    sub_flows = final_sim.get("sub_flows")
    labels = final_sim.get("labels")
    outlets = final_sim.get("outlets", [])

    peak_idx = np.argmax(flow)
    peak_flow = float(flow[peak_idx])
    peak_time_h = float(peak_idx * time_step / 3600.0)
    total_volume = float(np.sum(flow) * time_step)

    wb = GIUHEngine.check_water_balance(final_sim, [rainfall.tolist()], cell_size)

    csv_content = generate_csv(flow, time_step, sub_flows, n_sub)
    hydrograph_buf = plot_hydrograph(
        flow, time_step, sub_flows, n_sub,
        rainfall=rainfall,
        observed=observed_flow_aligned,
        title="Calibrated Hydrograph - Observed vs Simulated",
    )

    combined_buf = io.BytesIO()
    import zipfile
    with zipfile.ZipFile(combined_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("hydrograph.csv", csv_content)
        zf.writestr("hydrograph.png", hydrograph_buf.getvalue())

        if labels is not None and len(outlets) > 0:
            map_buf = plot_subbasins_map(labels, dem, outlets, cell_size)
            zf.writestr("subbasins_map.png", map_buf.getvalue())

        history_csv = "iteration,nse,best_nse,type," + ",".join(calib_result["best_params"].keys()) + "\n"
        for entry in calib_result["history"]:
            history_csv += "{},{},{},{},".format(
                entry["iteration"], entry["nse"], entry["best_nse"], entry["type"]
            )
            history_csv += ",".join(str(entry["params"].get(k, "")) for k in calib_result["best_params"].keys())
            history_csv += "\n"
        zf.writestr("calibration_history.csv", history_csv)

        meta = (
            "=== CALIBRATION RESULT ===\n"
            "Initial NSE: {:.4f}\n"
            "Best NSE: {:.4f}\n"
            "Iterations: {}\n"
            "Computation Time: {:.2f} s\n\n"
            "=== BEST PARAMETERS ===\n"
        ).format(
            calib_result["initial_nse"],
            calib_result["best_nse"],
            calib_result["n_iterations"],
            calib_result["computation_time_s"],
        )
        for k, v in calib_result["best_params"].items():
            meta += "  {}: {:.6f}\n".format(k, v)
        meta += (
            "\n=== SIMULATION RESULT ===\n"
            "Peak Flow: {:.4f} m3/s\n"
            "Peak Time: {:.2f} h\n"
            "Total Outflow Volume: {:.2f} m3\n"
            "Total Rainfall Volume: {:.2f} m3\n"
            "Conservation Ratio: {:.4f}\n"
            "Water Balance Conserved: {}\n"
            "Sub-basins: {}\n"
        ).format(
            peak_flow, peak_time_h, total_volume,
            wb["total_rainfall_volume_m3"],
            wb["conservation_ratio"],
            wb["is_conserved"],
            n_sub,
        )
        zf.writestr("calibration_result.txt", meta)

    combined_buf.seek(0)

    return StreamingResponse(
        combined_buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=giuh_calibration_result.zip"},
    )


@router.post("/simulate/with-params",
             summary="Run simulation with specific calibration parameters")
async def run_simulation_with_params(
    dem_file: UploadFile = File(..., description="DEM file (GeoTIFF)"),
    rainfall_file: UploadFile = File(..., description="Rainfall file (NetCDF)"),
    v_coeff: Optional[float] = Form(default=None),
    len_exp: Optional[float] = Form(default=None),
    slope_exp: Optional[float] = Form(default=None),
    min_velocity: Optional[float] = Form(default=None),
    ch_v_coeff: Optional[float] = Form(default=None),
    ch_len_exp: Optional[float] = Form(default=None),
    ch_slope_exp: Optional[float] = Form(default=None),
    ch_min_velocity: Optional[float] = Form(default=None),
    cell_size: float = Form(default=30.0),
    time_step: float = Form(default=3600.0),
    stream_threshold: float = Form(default=0.02),
    n_subbasins: int = Form(default=4),
    n_workers: Optional[int] = Form(default=None),
    parallel_mode: str = Form(default="process"),
):
    with tempfile.TemporaryDirectory() as tmpdir:
        dem_path = os.path.join(tmpdir, "dem.tif")
        rain_path = os.path.join(tmpdir, "rainfall.nc")

        with open(dem_path, "wb") as f:
            f.write(await dem_file.read())
        with open(rain_path, "wb") as f:
            f.write(await rainfall_file.read())

        dem = _read_dem(dem_path)
        rainfall = _read_rainfall_netcdf(rain_path)

    calib_params = {}
    if v_coeff is not None:
        calib_params["v_coeff"] = v_coeff
    if len_exp is not None:
        calib_params["len_exp"] = len_exp
    if slope_exp is not None:
        calib_params["slope_exp"] = slope_exp
    if min_velocity is not None:
        calib_params["min_velocity"] = min_velocity
    if ch_v_coeff is not None:
        calib_params["ch_v_coeff"] = ch_v_coeff
    if ch_len_exp is not None:
        calib_params["ch_len_exp"] = ch_len_exp
    if ch_slope_exp is not None:
        calib_params["ch_slope_exp"] = ch_slope_exp
    if ch_min_velocity is not None:
        calib_params["ch_min_velocity"] = ch_min_velocity

    if not calib_params:
        calib_params = None

    params = {
        "cell_size": cell_size,
        "time_step": time_step,
        "stream_threshold": stream_threshold,
        "n_subbasins": n_subbasins,
        "n_workers": n_workers,
        "parallel_mode": parallel_mode,
    }

    try:
        result = _run_simulation(dem, rainfall, params, calib_params)
    except Exception as e:
        logger.error(f"Simulation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Simulation failed: {str(e)}")

    flow = result["flow"]
    sub_flows = result.get("sub_flows")
    n_sub = result.get("n_subbasins", 1)
    labels = result.get("labels")
    outlets = result.get("outlets", [])

    peak_idx = np.argmax(flow)
    peak_flow = float(flow[peak_idx])
    peak_time_h = float(peak_idx * time_step / 3600.0)
    total_volume = float(np.sum(flow) * time_step)

    wb = GIUHEngine.check_water_balance(result, [rainfall.tolist()], cell_size)

    csv_content = generate_csv(flow, time_step, sub_flows, n_sub)
    hydrograph_buf = plot_hydrograph(
        flow, time_step, sub_flows, n_sub,
        rainfall=rainfall,
        title="Hydrograph with Custom Parameters",
    )

    combined_buf = io.BytesIO()
    import zipfile
    with zipfile.ZipFile(combined_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("hydrograph.csv", csv_content)
        zf.writestr("hydrograph.png", hydrograph_buf.getvalue())

        if labels is not None and len(outlets) > 0:
            map_buf = plot_subbasins_map(labels, dem, outlets, cell_size)
            zf.writestr("subbasins_map.png", map_buf.getvalue())

        used_params = calib_params if calib_params else GIUHEngine.DEFAULT_PARAMS
        meta = (
            "=== SIMULATION WITH CUSTOM PARAMETERS ===\n"
            "Peak Flow: {:.4f} m3/s\n"
            "Peak Time: {:.2f} h\n"
            "Total Outflow Volume: {:.2f} m3\n"
            "Total Rainfall Volume: {:.2f} m3\n"
            "Conservation Ratio: {:.4f}\n"
            "Water Balance Conserved: {}\n\n"
            "=== PARAMETERS ===\n"
        ).format(
            peak_flow, peak_time_h, total_volume,
            wb["total_rainfall_volume_m3"],
            wb["conservation_ratio"],
            wb["is_conserved"],
        )
        for k, v in used_params.items():
            meta += "  {}: {:.6f}\n".format(k, v)
        zf.writestr("metadata.txt", meta)

    combined_buf.seek(0)

    return StreamingResponse(
        combined_buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=giuh_result.zip"},
    )


@router.get("/calibrate/params", summary="List calibratable parameters and their bounds")
async def get_calibratable_params():
    from app.engine import BayesianOptimizer
    return {
        "default_params": GIUHEngine.DEFAULT_PARAMS,
        "param_bounds": BayesianOptimizer.PARAM_BOUNDS,
        "description": {
            "v_coeff": "Velocity coefficient (hillslope)",
            "len_exp": "Length exponent (hillslope)",
            "slope_exp": "Slope exponent (hillslope)",
            "min_velocity": "Minimum velocity [m/s] (hillslope)",
            "ch_v_coeff": "Velocity coefficient (channel)",
            "ch_len_exp": "Length exponent (channel)",
            "ch_slope_exp": "Slope exponent (channel)",
            "ch_min_velocity": "Minimum velocity [m/s] (channel)",
        },
        "velocity_formula": "v = v_coeff * (length ^ len_exp) * (slope ^ slope_exp)",
    }


@router.get("/health", summary="Health check")
async def health_check():
    return {"status": "healthy", "service": "GIUH Watershed Convergence Service"}


@router.get("/info", summary="Service information")
async def service_info():
    return {
        "service": "Distributed Hydrological Model - GIUH Watershed Convergence",
        "version": "1.1.0",
        "algorithm": "Geomorphological Instantaneous Unit Hydrograph (GIUH)",
        "features": [
            "DEM-based watershed delineation",
            "Strahler stream ordering",
            "Sub-basin parallel computation",
            "Numba-accelerated GIUH convolution",
            "D8 flow direction algorithm",
            "Automatic pit filling",
            "Water balance conservation check",
            "Bayesian parameter calibration (NSE optimization)",
            "Observed flow data comparison",
        ],
        "calibratable_parameters": list(GIUHEngine.DEFAULT_PARAMS.keys()),
        "input_formats": {
            "dem": "GeoTIFF",
            "rainfall": "NetCDF",
            "observed_flow": "CSV",
        },
        "output_formats": ["CSV", "PNG", "ZIP"],
        "endpoints": [
            "POST /simulate - Full simulation (ZIP with CSV+PNG)",
            "POST /simulate/hydrograph - Hydrograph PNG only",
            "POST /simulate/csv - CSV data only",
            "POST /simulate/subbasins - Sub-basin map PNG only",
            "POST /simulate/with-params - Simulation with custom calibration parameters",
            "POST /calibrate - Bayesian parameter calibration with observed flow",
            "GET /calibrate/params - List calibratable parameters and bounds",
            "GET /health - Health check",
            "GET /info - Service information",
        ],
    }
