import unittest
import numpy as np
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.engine import (
    GIUHEngine, _compute_channel_params_numba, _topological_sort_numba,
    _route_subbasins_numba, _build_channel_iuh_numba, _convolve_numba,
    _giuh_convolution_numba, _build_iuh_numba, _compute_giuh_params_subbasin_numba,
    build_subbasin_topology,
)


def _make_dem(rows, cols, cell_size=30.0):
    x = np.linspace(0, 1, cols)
    y = np.linspace(0, 1, rows)
    X, Y = np.meshgrid(x, y)
    dem = 200 * (1 - X) * (1 - Y) + 5 * np.random.RandomState(42).rand(rows, cols)
    return dem.astype(np.float64)


class TestWaterBalance(unittest.TestCase):
    def test_single_basin_water_balance(self):
        dem = _make_dem(50, 50)
        n_hours = 48
        rainfall = np.zeros(n_hours)
        rainfall[3:8] = 10.0
        rainfall[8:12] = 5.0
        rainfall[12:15] = 2.0

        engine = GIUHEngine(cell_size=30.0, time_step=3600.0, stream_threshold=0.02, n_subbasins=1)
        result = engine.run_giuh(dem, [rainfall.tolist()])

        wb = GIUHEngine.check_water_balance(result, [rainfall.tolist()], 30.0)

        self.assertGreater(wb["total_rainfall_volume_m3"], 0, "Rainfall volume should be positive")
        self.assertGreater(wb["total_outflow_volume_m3"], 0, "Outflow volume should be positive")
        self.assertGreaterEqual(wb["conservation_ratio"], 0.85,
                                "Conservation ratio too low: {:.4f}".format(wb["conservation_ratio"]))
        self.assertLessEqual(wb["conservation_ratio"], 1.15,
                             "Conservation ratio too high: {:.4f}".format(wb["conservation_ratio"]))

    def test_multi_basin_water_balance(self):
        dem = _make_dem(60, 60)
        n_hours = 48
        rainfall = np.zeros(n_hours)
        rainfall[3:8] = 10.0
        rainfall[8:12] = 5.0
        rainfall[12:15] = 2.0

        engine = GIUHEngine(cell_size=30.0, time_step=3600.0, stream_threshold=0.02, n_subbasins=4)
        rainfall_list = [rainfall.tolist() for _ in range(4)]
        result = engine.run_giuh(dem, rainfall_list)

        wb = GIUHEngine.check_water_balance(result, rainfall_list, 30.0)

        self.assertGreater(wb["total_rainfall_volume_m3"], 0, "Rainfall volume should be positive")
        self.assertGreater(wb["total_outflow_volume_m3"], 0, "Outflow volume should be positive")
        self.assertGreaterEqual(wb["conservation_ratio"], 0.85,
                                "Conservation ratio too low: {:.4f}".format(wb["conservation_ratio"]))
        self.assertLessEqual(wb["conservation_ratio"], 1.15,
                             "Conservation ratio too high: {:.4f}".format(wb["conservation_ratio"]))
        self.assertTrue(wb["is_conserved"],
                        "Water balance not conserved: ratio={:.4f}".format(wb["conservation_ratio"]))

    def test_uniform_rainfall_conservation(self):
        dem = _make_dem(40, 40)
        n_hours = 72
        rainfall = np.ones(n_hours) * 5.0

        engine = GIUHEngine(cell_size=30.0, time_step=3600.0, stream_threshold=0.02, n_subbasins=3)
        rainfall_list = [rainfall.tolist() for _ in range(3)]
        result = engine.run_giuh(dem, rainfall_list)

        wb = GIUHEngine.check_water_balance(result, rainfall_list, 30.0)

        self.assertGreaterEqual(wb["conservation_ratio"], 0.85,
                                "Uniform rain conservation too low: {:.4f}".format(wb["conservation_ratio"]))
        self.assertLessEqual(wb["conservation_ratio"], 1.15,
                             "Uniform rain conservation too high: {:.4f}".format(wb["conservation_ratio"]))

    def test_impulse_rainfall_conservation(self):
        dem = _make_dem(40, 40)
        n_hours = 72
        rainfall = np.zeros(n_hours)
        rainfall[5] = 50.0

        engine = GIUHEngine(cell_size=30.0, time_step=3600.0, stream_threshold=0.02, n_subbasins=2)
        rainfall_list = [rainfall.tolist() for _ in range(2)]
        result = engine.run_giuh(dem, rainfall_list)

        wb = GIUHEngine.check_water_balance(result, rainfall_list, 30.0)

        self.assertGreaterEqual(wb["conservation_ratio"], 0.85,
                                "Impulse rain conservation too low: {:.4f}".format(wb["conservation_ratio"]))
        self.assertLessEqual(wb["conservation_ratio"], 1.15,
                             "Impulse rain conservation too high: {:.4f}".format(wb["conservation_ratio"]))


class TestConvolutionConservation(unittest.TestCase):
    def test_convolution_preserves_mass(self):
        n_time = 100
        inflow = np.zeros(n_time, dtype=np.float64)
        inflow[5:10] = 10.0

        uh = np.array([0.1, 0.3, 0.35, 0.2, 0.05], dtype=np.float64)

        outflow = _convolve_numba(inflow, uh, n_time)

        total_in = np.sum(inflow)
        total_out = np.sum(outflow)

        self.assertAlmostEqual(total_in, total_out, places=6,
                               msg="Convolution should preserve mass: in={:.6f}, out={:.6f}".format(total_in, total_out))

    def test_channel_iuh_preserves_mass(self):
        for length in [100.0, 500.0, 2000.0]:
            for slope in [0.001, 0.01, 0.1]:
                uh, uh_len = _build_channel_iuh_numba(length, slope, 3600.0)
                total = np.sum(uh)
                self.assertAlmostEqual(total, 1.0, places=4,
                                       msg="Channel IUH should sum to 1.0: len={}, sl={}, total={:.6f}".format(
                                           length, slope, total))

    def test_giuh_unit_hydrograph_sums_to_one(self):
        dem = _make_dem(30, 30)
        engine = GIUHEngine(cell_size=30.0, time_step=3600.0, stream_threshold=0.02)
        dem_filled, flow_dir, flow_acc, stream, strahler = engine.preprocess_dem(dem)

        max_order, lengths, slopes, areas, counts, sub_area = _compute_giuh_params_subbasin_numba(
            strahler.astype(np.int32), flow_dir.astype(np.int32), stream.astype(np.int32),
            dem.astype(np.float64), np.ones_like(strahler, dtype=np.int32), 1,
            *strahler.shape, 30.0
        )

        uh, uh_len = _build_iuh_numba(max_order, lengths, slopes, areas, sub_area, 3600.0)
        total = np.sum(uh)
        self.assertAlmostEqual(total, 1.0, places=4,
                               msg="GIUH should sum to 1.0: total={:.6f}".format(total))


class TestSubbasinTopology(unittest.TestCase):
    def test_topology_is_dag(self):
        dem = _make_dem(50, 50)
        engine = GIUHEngine(cell_size=30.0, time_step=3600.0, stream_threshold=0.02, n_subbasins=4)
        dem_filled, flow_dir, flow_acc, stream, strahler = engine.preprocess_dem(dem)
        labels, outlets = engine.partition(flow_dir, stream)

        topology = build_subbasin_topology(flow_dir, stream, dem_filled, labels, outlets)
        n_sub = len(outlets)

        downstream = topology["downstream"]
        visited = set()
        for s in range(n_sub):
            current = s
            path = set()
            while current >= 0 and current not in path:
                path.add(current)
                current = int(downstream[current])
            self.assertEqual(current, -1, "Cycle detected in topology at sub-basin {}".format(s))

    def test_topological_sort_covers_all(self):
        dem = _make_dem(50, 50)
        engine = GIUHEngine(cell_size=30.0, time_step=3600.0, stream_threshold=0.02, n_subbasins=4)
        dem_filled, flow_dir, flow_acc, stream, strahler = engine.preprocess_dem(dem)
        labels, outlets = engine.partition(flow_dir, stream)

        topology = build_subbasin_topology(flow_dir, stream, dem_filled, labels, outlets)
        n_sub = len(outlets)

        sorted_order = _topological_sort_numba(topology["downstream"], n_sub)
        self.assertEqual(len(sorted_order), n_sub, "Topological sort should cover all sub-basins")

    def test_at_least_one_outlet(self):
        dem = _make_dem(50, 50)
        engine = GIUHEngine(cell_size=30.0, time_step=3600.0, stream_threshold=0.02, n_subbasins=4)
        dem_filled, flow_dir, flow_acc, stream, strahler = engine.preprocess_dem(dem)
        labels, outlets = engine.partition(flow_dir, stream)

        topology = build_subbasin_topology(flow_dir, stream, dem_filled, labels, outlets)

        n_outlets = sum(1 for s in range(len(outlets)) if topology["downstream"][s] < 0)
        self.assertGreaterEqual(n_outlets, 1, "At least one sub-basin should be an outlet")


class TestRoutingConservation(unittest.TestCase):
    def test_routing_preserves_total_volume(self):
        n_sub = 3
        n_time = 50

        local_flows = np.zeros((n_sub, n_time), dtype=np.float64)
        local_flows[0, 5:10] = 5.0
        local_flows[1, 8:12] = 3.0
        local_flows[2, 3:7] = 4.0

        downstream = np.array([2, 2, -1], dtype=np.int32)
        channel_length = np.array([500.0, 600.0, 0.0], dtype=np.float64)
        channel_slope = np.array([0.01, 0.02, 0.01], dtype=np.float64)

        total_flows, outlet_flow = _route_subbasins_numba(
            local_flows, downstream, channel_length, channel_slope, 3600.0, n_sub, n_time
        )

        total_local_volume = np.sum(local_flows) * 3600.0
        total_outlet_volume = np.sum(outlet_flow) * 3600.0

        self.assertAlmostEqual(total_local_volume, total_outlet_volume, places=0,
                               msg="Routing should preserve total volume: local={:.2f}, outlet={:.2f}".format(
                                   total_local_volume, total_outlet_volume))

    def test_simple_chain_routing(self):
        n_sub = 3
        n_time = 60

        local_flows = np.zeros((n_sub, n_time), dtype=np.float64)
        local_flows[0, 5] = 10.0

        downstream = np.array([1, 2, -1], dtype=np.int32)
        channel_length = np.array([0.1, 0.1, 0.0], dtype=np.float64)
        channel_slope = np.array([0.01, 0.01, 0.01], dtype=np.float64)

        total_flows, outlet_flow = _route_subbasins_numba(
            local_flows, downstream, channel_length, channel_slope, 3600.0, n_sub, n_time
        )

        total_in = np.sum(local_flows) * 3600.0
        total_out = np.sum(outlet_flow) * 3600.0

        self.assertAlmostEqual(total_in, total_out, places=1,
                               msg="Chain routing should preserve volume: in={:.2f}, out={:.2f}".format(
                                   total_in, total_out))


if __name__ == "__main__":
    unittest.main()
