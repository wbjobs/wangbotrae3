import unittest
import numpy as np

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.engine import (
    GIUHEngine,
    nash_sutcliffe_efficiency,
    BayesianOptimizer,
    calibrate_model,
)


class TestNashSutcliffeEfficiency(unittest.TestCase):
    def test_perfect_match(self):
        observed = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        simulated = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        nse = nash_sutcliffe_efficiency(simulated, observed)
        self.assertAlmostEqual(nse, 1.0, places=6)

    def test_constant_forecast(self):
        observed = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        mean_obs = np.mean(observed)
        simulated = np.full_like(observed, mean_obs)
        nse = nash_sutcliffe_efficiency(simulated, observed)
        self.assertAlmostEqual(nse, 0.0, places=6)

    def test_poor_forecast(self):
        observed = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        simulated = np.array([10.0, 20.0, 30.0, 40.0, 50.0])
        nse = nash_sutcliffe_efficiency(simulated, observed)
        self.assertLess(nse, 0.0)

    def test_known_value(self):
        observed = np.array([5.0, 7.0, 9.0, 6.0, 8.0])
        simulated = np.array([4.5, 6.8, 9.5, 6.2, 7.9])
        mean_obs = np.mean(observed)
        ss_res = np.sum((observed - simulated) ** 2)
        ss_tot = np.sum((observed - mean_obs) ** 2)
        expected = 1 - ss_res / ss_tot
        nse = nash_sutcliffe_efficiency(simulated, observed)
        self.assertAlmostEqual(nse, expected, places=6)

    def test_different_lengths(self):
        observed = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        simulated = np.array([1.0, 2.0, 3.0])
        nse = nash_sutcliffe_efficiency(simulated, observed)
        mean_obs = np.mean(observed[:3])
        ss_res = np.sum((observed[:3] - simulated) ** 2)
        ss_tot = np.sum((observed[:3] - mean_obs) ** 2)
        expected = 1 - ss_res / ss_tot
        self.assertAlmostEqual(nse, expected, places=6)

    def test_very_short_arrays(self):
        observed = np.array([1.0])
        simulated = np.array([1.0])
        nse = nash_sutcliffe_efficiency(simulated, observed)
        self.assertEqual(nse, -np.inf)


class TestGIUHEngineCalibrationParams(unittest.TestCase):
    def test_default_params(self):
        engine = GIUHEngine()
        params = engine.get_calib_params()
        self.assertEqual(params["v_coeff"], 0.65)
        self.assertEqual(params["len_exp"], 0.33)
        self.assertEqual(params["slope_exp"], 0.20)
        self.assertEqual(params["min_velocity"], 0.5)
        self.assertEqual(params["ch_v_coeff"], 0.65)
        self.assertEqual(params["ch_len_exp"], 0.33)
        self.assertEqual(params["ch_slope_exp"], 0.20)
        self.assertEqual(params["ch_min_velocity"], 0.5)

    def test_custom_init_params(self):
        engine = GIUHEngine(
            v_coeff=1.0, len_exp=0.5, slope_exp=0.3, min_velocity=0.1,
            ch_v_coeff=0.8, ch_len_exp=0.4, ch_slope_exp=0.25, ch_min_velocity=0.2,
        )
        params = engine.get_calib_params()
        self.assertEqual(params["v_coeff"], 1.0)
        self.assertEqual(params["len_exp"], 0.5)
        self.assertEqual(params["slope_exp"], 0.3)
        self.assertEqual(params["min_velocity"], 0.1)
        self.assertEqual(params["ch_v_coeff"], 0.8)
        self.assertEqual(params["ch_len_exp"], 0.4)
        self.assertEqual(params["ch_slope_exp"], 0.25)
        self.assertEqual(params["ch_min_velocity"], 0.2)

    def test_set_calib_params(self):
        engine = GIUHEngine()
        new_params = {
            "v_coeff": 1.5,
            "len_exp": 0.6,
            "ch_v_coeff": 0.9,
        }
        engine.set_calib_params(new_params)
        params = engine.get_calib_params()
        self.assertEqual(params["v_coeff"], 1.5)
        self.assertEqual(params["len_exp"], 0.6)
        self.assertEqual(params["slope_exp"], 0.20)
        self.assertEqual(params["ch_v_coeff"], 0.9)
        self.assertEqual(params["ch_len_exp"], 0.33)


class TestBayesianOptimizer(unittest.TestCase):
    def test_param_bounds(self):
        bounds = BayesianOptimizer.PARAM_BOUNDS
        self.assertIn("v_coeff", bounds)
        self.assertIn("len_exp", bounds)
        self.assertIn("slope_exp", bounds)
        self.assertIn("min_velocity", bounds)
        self.assertIn("ch_v_coeff", bounds)
        self.assertIn("ch_len_exp", bounds)
        self.assertIn("ch_slope_exp", bounds)
        self.assertIn("ch_min_velocity", bounds)

        self.assertEqual(bounds["v_coeff"][0], 0.1)
        self.assertEqual(bounds["v_coeff"][1], 2.0)
        self.assertEqual(bounds["len_exp"][0], 0.1)
        self.assertEqual(bounds["len_exp"][1], 0.8)

    def test_simple_objective_optimization(self):
        def simple_objective(params):
            return -(params["v_coeff"] - 0.8) ** 2 - (params["len_exp"] - 0.4) ** 2

        param_names = ["v_coeff", "len_exp"]
        bounds = {
            "v_coeff": BayesianOptimizer.PARAM_BOUNDS["v_coeff"],
            "len_exp": BayesianOptimizer.PARAM_BOUNDS["len_exp"],
        }

        class MockEngine:
            def __init__(self):
                self.params = {}
            def get_calib_params(self):
                return self.params.copy()
            def set_calib_params(self, params):
                self.params.update(params)

        class SimpleOptimizer(BayesianOptimizer):
            def __init__(self, param_names, max_iterations=20, random_seed=42):
                self.engine = MockEngine()
                self.param_names = param_names
                self.PARAM_BOUNDS = bounds
                self.bounds = np.array([bounds[p] for p in param_names])
                self.max_iterations = max_iterations
                self.random_seed = random_seed
                self.history = []
                self.best_nse = -np.inf
                self.best_params = {}

            def _params_array_to_dict(self, params_array):
                return {name: float(val) for name, val in zip(self.param_names, params_array)}

            def _sample_from_prior(self, n_samples):
                rng = np.random.RandomState(self.random_seed)
                samples = rng.uniform(
                    low=self.bounds[:, 0],
                    high=self.bounds[:, 1],
                    size=(n_samples, len(self.param_names))
                )
                return samples

            def _evaluate(self, params_array):
                return self._objective(self._params_array_to_dict(params_array))

            def _objective(self, params):
                return simple_objective(params)

        optimizer = SimpleOptimizer(param_names, max_iterations=15, random_seed=42)
        result = optimizer.optimize()

        self.assertIn("best_params", result)
        self.assertIn("best_nse", result)
        self.assertIn("history", result)
        self.assertIn("n_iterations", result)

        self.assertAlmostEqual(result["best_params"]["v_coeff"], 0.8, delta=0.2)
        self.assertAlmostEqual(result["best_params"]["len_exp"], 0.4, delta=0.2)
        self.assertGreater(result["best_nse"], -0.1)
        self.assertGreaterEqual(len(result["history"]), 5)


class TestCalibrationWithSyntheticData(unittest.TestCase):
    def setUp(self):
        np.random.seed(42)
        self.nx, self.ny = 20, 20
        self.dem = np.zeros((self.nx, self.ny), dtype=np.float64)
        for i in range(self.nx):
            for j in range(self.ny):
                self.dem[i, j] = 100.0 + 2.0 * (self.nx - i) + 1.5 * (self.ny - j)
                self.dem[i, j] += 0.5 * np.random.randn()

        self.n_time = 30
        self.rainfall = np.zeros(self.n_time, dtype=np.float64)
        self.rainfall[3:8] = np.array([5.0, 15.0, 25.0, 15.0, 5.0])

        self.true_params = {
            "v_coeff": 0.9,
            "len_exp": 0.4,
            "slope_exp": 0.25,
            "min_velocity": 0.3,
            "ch_v_coeff": 0.9,
            "ch_len_exp": 0.4,
            "ch_slope_exp": 0.25,
            "ch_min_velocity": 0.3,
        }

    def test_calibration_improves_nse(self):
        engine = GIUHEngine(
            cell_size=30.0,
            time_step=3600.0,
            stream_threshold=0.05,
            n_subbasins=2,
        )

        engine.set_calib_params(self.true_params)
        rainfall_list = [self.rainfall.tolist() for _ in range(2)]
        result_true = engine.run_giuh(self.dem, rainfall_list)
        observed_flow = result_true["flow"].copy()
        observed_flow += 0.05 * np.max(observed_flow) * np.random.randn(len(observed_flow))
        observed_flow = np.maximum(observed_flow, 0.0)

        initial_engine = GIUHEngine(
            cell_size=30.0,
            time_step=3600.0,
            stream_threshold=0.05,
            n_subbasins=2,
        )
        initial_result = initial_engine.run_giuh(self.dem, rainfall_list)
        initial_nse = nash_sutcliffe_efficiency(initial_result["flow"], observed_flow)

        calib_result = calibrate_model(
            engine=initial_engine,
            dem=self.dem,
            rainfall_list=rainfall_list,
            observed_flow=observed_flow,
            param_names=["v_coeff", "len_exp", "slope_exp", "min_velocity"],
            max_iterations=10,
            random_seed=42,
        )

        self.assertIn("best_nse", calib_result)
        self.assertIn("best_params", calib_result)
        self.assertIn("initial_nse", calib_result)
        self.assertIn("final_params", calib_result)

        self.assertGreater(calib_result["best_nse"], initial_nse)
        self.assertGreater(calib_result["best_nse"], 0.7)

        self.assertIn("history", calib_result)
        self.assertGreaterEqual(len(calib_result["history"]), 5)

        for entry in calib_result["history"]:
            self.assertIn("iteration", entry)
            self.assertIn("params", entry)
            self.assertIn("nse", entry)
            self.assertIn("best_nse", entry)
            self.assertIn("type", entry)

        self.assertIn("n_iterations", calib_result)
        self.assertLessEqual(calib_result["n_iterations"], 10)

    def test_calibration_param_names(self):
        engine = GIUHEngine(
            cell_size=30.0,
            time_step=3600.0,
            stream_threshold=0.05,
            n_subbasins=2,
        )
        engine.set_calib_params(self.true_params)
        rainfall_list = [self.rainfall.tolist() for _ in range(2)]
        result_true = engine.run_giuh(self.dem, rainfall_list)
        observed_flow = result_true["flow"].copy()

        calib_result = calibrate_model(
            engine=GIUHEngine(
                cell_size=30.0,
                time_step=3600.0,
                stream_threshold=0.05,
                n_subbasins=2,
            ),
            dem=self.dem,
            rainfall_list=rainfall_list,
            observed_flow=observed_flow,
            param_names=["v_coeff"],
            max_iterations=8,
            random_seed=42,
        )

        self.assertEqual(len(calib_result["best_params"]), 1)
        self.assertIn("v_coeff", calib_result["best_params"])
        self.assertGreaterEqual(calib_result["best_params"]["v_coeff"], 0.1)
        self.assertLessEqual(calib_result["best_params"]["v_coeff"], 2.0)

    def test_water_balance_after_calibration(self):
        engine = GIUHEngine(
            cell_size=30.0,
            time_step=3600.0,
            stream_threshold=0.05,
            n_subbasins=2,
        )
        engine.set_calib_params(self.true_params)
        rainfall_list = [self.rainfall.tolist() for _ in range(2)]
        result_true = engine.run_giuh(self.dem, rainfall_list)
        observed_flow = result_true["flow"].copy()

        calib_result = calibrate_model(
            engine=GIUHEngine(
                cell_size=30.0,
                time_step=3600.0,
                stream_threshold=0.05,
                n_subbasins=2,
            ),
            dem=self.dem,
            rainfall_list=rainfall_list,
            observed_flow=observed_flow,
            param_names=["v_coeff", "len_exp"],
            max_iterations=5,
            random_seed=42,
        )

        engine_final = GIUHEngine(
            cell_size=30.0,
            time_step=3600.0,
            stream_threshold=0.05,
            n_subbasins=2,
        )
        engine_final.set_calib_params(calib_result["best_params"])
        final_result = engine_final.run_giuh(self.dem, rainfall_list)

        wb = GIUHEngine.check_water_balance(final_result, rainfall_list, cell_size=30.0)
        self.assertGreaterEqual(wb["conservation_ratio"], 0.85)
        self.assertLessEqual(wb["conservation_ratio"], 1.15)


class TestCalibrateModelFunction(unittest.TestCase):
    def test_callback(self):
        callback_called = [0]
        last_progress = [None]

        def progress_callback(progress):
            callback_called[0] += 1
            last_progress[0] = progress

        engine = GIUHEngine(
            cell_size=30.0,
            time_step=3600.0,
            stream_threshold=0.05,
            n_subbasins=2,
        )

        nx, ny = 15, 15
        dem = np.zeros((nx, ny), dtype=np.float64)
        for i in range(nx):
            for j in range(ny):
                dem[i, j] = 100.0 + 2.0 * (nx - i) + 1.5 * (ny - j)

        n_time = 20
        rainfall = np.zeros(n_time, dtype=np.float64)
        rainfall[3:6] = [10.0, 20.0, 10.0]
        rainfall_list = [rainfall.tolist() for _ in range(2)]

        result_true = engine.run_giuh(dem, rainfall_list)
        observed_flow = result_true["flow"].copy()

        calib_result = calibrate_model(
            engine=engine,
            dem=dem,
            rainfall_list=rainfall_list,
            observed_flow=observed_flow,
            param_names=["v_coeff"],
            max_iterations=5,
            random_seed=42,
            callback=progress_callback,
        )

        self.assertGreater(callback_called[0], 0)
        self.assertIsNotNone(last_progress[0])
        self.assertIn("iteration", last_progress[0])
        self.assertIn("nse", last_progress[0])
        self.assertIn("best_nse", last_progress[0])

    def test_early_stopping(self):
        engine = GIUHEngine(
            cell_size=30.0,
            time_step=3600.0,
            stream_threshold=0.05,
            n_subbasins=2,
        )

        nx, ny = 15, 15
        dem = np.zeros((nx, ny), dtype=np.float64)
        for i in range(nx):
            for j in range(ny):
                dem[i, j] = 100.0 + 2.0 * (nx - i) + 1.5 * (ny - j)

        n_time = 20
        rainfall = np.zeros(n_time, dtype=np.float64)
        rainfall[3:6] = [10.0, 20.0, 10.0]
        rainfall_list = [rainfall.tolist() for _ in range(2)]

        result_true = engine.run_giuh(dem, rainfall_list)
        observed_flow = result_true["flow"].copy()

        engine.set_calib_params(engine.get_calib_params())
        calib_result = calibrate_model(
            engine=engine,
            dem=dem,
            rainfall_list=rainfall_list,
            observed_flow=observed_flow,
            param_names=["v_coeff", "len_exp"],
            max_iterations=30,
            random_seed=42,
        )

        self.assertLessEqual(calib_result["n_iterations"], 30)

        if calib_result["best_nse"] >= 0.999:
            self.assertLess(calib_result["n_iterations"], 30)


if __name__ == "__main__":
    unittest.main()
