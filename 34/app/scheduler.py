import numpy as np
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
import os
import time
import logging
from app.engine import (
    GIUHEngine, _compute_subbasin_hydrograph_parallel,
    _route_subbasins_numba, build_subbasin_topology,
    calibrate_model, nash_sutcliffe_efficiency,
)

logger = logging.getLogger(__name__)


def _run_subbasin_giuh(args):
    engine_params, subbasin_id, dem_sub, rainfall_sub = args
    engine = GIUHEngine(
        cell_size=engine_params["cell_size"],
        time_step=engine_params["time_step"],
        stream_threshold=engine_params["stream_threshold"],
        n_subbasins=1,
    )
    try:
        result = engine.run_giuh(dem_sub, [rainfall_sub])
        return subbasin_id, result
    except Exception as e:
        logger.error("Sub-basin {} computation failed: {}".format(subbasin_id, e))
        return subbasin_id, None


class ParallelScheduler:
    def __init__(self, n_workers=None, mode="process"):
        if n_workers is None:
            n_workers = min(os.cpu_count() or 1, 8)
        self.n_workers = n_workers
        self.mode = mode

    def schedule_subbasins(self, engine, dem, rainfall_by_subbasin, labels, outlets):
        n_sub = len(outlets)
        logger.info("Starting parallel GIUH computation for {} sub-basins "
                     "with {} workers (mode={})".format(n_sub, self.n_workers, self.mode))

        start_time = time.time()

        result = engine.run_giuh(dem, rainfall_by_subbasin)
        elapsed = time.time() - start_time
        logger.info("GIUH computation completed in {:.2f}s".format(elapsed))

        return result

    def schedule_distributed(self, engine, dem, rainfall_by_subbasin, labels, outlets, calib_params=None):
        n_sub = len(outlets)
        rows, cols = dem.shape
        n_time = len(rainfall_by_subbasin[0]) if rainfall_by_subbasin else 0

        logger.info("Starting distributed computation for {} sub-basins "
                     "with {} workers".format(n_sub, self.n_workers))

        start_time = time.time()

        dem_filled, flow_dir, flow_acc, stream, strahler = engine.preprocess_dem(dem)

        params_flat, n_sub_actual, param_stride = engine.compute_subbasin_params(
            dem_filled, flow_dir, stream, strahler, labels, outlets
        )

        rainfall_array = np.zeros((n_sub_actual, n_time), dtype=np.float64)
        for s in range(n_sub_actual):
            if s < len(rainfall_by_subbasin):
                rainfall_array[s, :] = np.array(rainfall_by_subbasin[s][:n_time], dtype=np.float64)
            else:
                rainfall_array[s, :] = np.array(rainfall_by_subbasin[0][:n_time], dtype=np.float64)

        if calib_params is None:
            calib_params = engine.get_calib_params()

        local_flows = _compute_subbasin_hydrograph_parallel(
            rainfall_array, engine.time_step, params_flat, n_sub_actual, param_stride,
            calib_params.get("v_coeff", 0.65),
            calib_params.get("len_exp", 0.33),
            calib_params.get("slope_exp", 0.20),
            calib_params.get("min_velocity", 0.5),
        )

        topology = build_subbasin_topology(flow_dir, stream, dem_filled, labels, outlets)

        total_flows, outlet_flow = _route_subbasins_numba(
            local_flows,
            topology["downstream"],
            topology["channel_length"],
            topology["channel_slope"],
            engine.time_step,
            n_sub_actual,
            n_time,
            calib_params.get("ch_v_coeff", 0.65),
            calib_params.get("ch_len_exp", 0.33),
            calib_params.get("ch_slope_exp", 0.20),
            calib_params.get("ch_min_velocity", 0.5),
        )

        elapsed = time.time() - start_time
        logger.info("Distributed computation completed in {:.2f}s".format(elapsed))

        return {
            "flow": outlet_flow,
            "sub_flows": total_flows,
            "local_flows": local_flows,
            "n_subbasins": n_sub_actual,
            "time_step": engine.time_step,
            "computation_time": elapsed,
            "topology": topology,
            "calib_params": calib_params,
        }

    def run_calibration(self, engine, dem, rainfall_by_subbasin, observed_flow,
                        param_names=None, max_iterations=50, random_seed=42):
        logger.info("Starting Bayesian calibration with {} iterations, parameters: {}".format(
            max_iterations, param_names if param_names else "default"))

        start_time = time.time()

        calibration_result = calibrate_model(
            engine=engine,
            dem=dem,
            rainfall_list=rainfall_by_subbasin,
            observed_flow=observed_flow,
            param_names=param_names,
            max_iterations=max_iterations,
            random_seed=random_seed,
        )

        elapsed = time.time() - start_time
        calibration_result["computation_time_s"] = elapsed

        logger.info("Calibration completed in {:.2f}s, best NSE: {:.4f}".format(
            elapsed, calibration_result["best_nse"]))

        return calibration_result


class TaskManager:
    def __init__(self):
        self.tasks = {}
        self._counter = 0

    def create_task(self, dem, rainfall_data, params):
        self._counter += 1
        task_id = "task_{}_{}".format(self._counter, int(time.time()))
        self.tasks[task_id] = {
            "status": "pending",
            "task_type": "simulation",
            "dem_shape": dem.shape,
            "params": params,
            "created_at": time.time(),
            "result": None,
            "error": None,
        }
        return task_id

    def create_calibration_task(self, dem, rainfall_data, observed_flow, params):
        self._counter += 1
        task_id = "calib_{}_{}".format(self._counter, int(time.time()))
        self.tasks[task_id] = {
            "status": "pending",
            "task_type": "calibration",
            "dem_shape": dem.shape,
            "observed_flow_length": len(observed_flow),
            "params": params,
            "created_at": time.time(),
            "result": None,
            "error": None,
        }
        return task_id

    def update_task(self, task_id, status, result=None, error=None):
        if task_id in self.tasks:
            self.tasks[task_id]["status"] = status
            if result is not None:
                self.tasks[task_id]["result"] = result
            if error is not None:
                self.tasks[task_id]["error"] = error

    def get_task(self, task_id):
        return self.tasks.get(task_id)

    def list_tasks(self):
        return {tid: {
            "status": t["status"],
            "task_type": t.get("task_type", "simulation"),
            "created_at": t["created_at"]
        } for tid, t in self.tasks.items()}
