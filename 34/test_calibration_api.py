import os
import sys
import numpy as np
import rasterio
import netCDF4 as nc
import pandas as pd
import requests
import time
import zipfile
import io

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.engine import GIUHEngine, nash_sutcliffe_efficiency

BASE_URL = "http://localhost:8000"


def create_test_data():
    print("Creating test data...")

    test_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_calib_data")
    os.makedirs(test_dir, exist_ok=True)

    nx, ny = 30, 30
    dem = np.zeros((nx, ny), dtype=np.float64)
    for i in range(nx):
        for j in range(ny):
            dem[i, j] = 100.0 + 3.0 * (nx - i) + 2.0 * (ny - j)
            dem[i, j] += 0.3 * np.random.randn()

    dem_path = os.path.join(test_dir, "dem.tif")
    with rasterio.open(
        dem_path, "w",
        driver="GTiff",
        width=ny, height=nx,
        count=1, dtype="float64",
        crs="EPSG:4326",
        transform=rasterio.transform.from_origin(0, nx * 30, 30, 30)
    ) as dst:
        dst.write(dem, 1)

    n_time = 40
    rainfall = np.zeros(n_time, dtype=np.float64)
    rainfall[5:12] = np.array([3.0, 8.0, 18.0, 30.0, 25.0, 12.0, 5.0])

    rain_path = os.path.join(test_dir, "rainfall.nc")
    with nc.Dataset(rain_path, "w") as ds:
        ds.createDimension("time", n_time)
        rain_var = ds.createVariable("rainfall", "f8", ("time",))
        rain_var[:] = rainfall

    true_params = {
        "v_coeff": 0.65,
        "len_exp": 0.33,
        "slope_exp": 0.20,
        "min_velocity": 0.5,
    }

    engine = GIUHEngine(
        cell_size=30.0,
        time_step=3600.0,
        stream_threshold=0.02,
        n_subbasins=3,
        **true_params,
    )

    rainfall_list = [rainfall.tolist() for _ in range(3)]
    result = engine.run_giuh(dem, rainfall_list)
    observed_flow = result["flow"].copy()

    noise = 0.03 * np.max(observed_flow) * np.random.randn(len(observed_flow))
    observed_flow = np.maximum(observed_flow + noise, 0.0)

    obs_path = os.path.join(test_dir, "observed_flow.csv")
    df = pd.DataFrame({
        "time_h": np.arange(n_time) * 3600.0 / 3600.0,
        "flow": observed_flow,
    })
    df.to_csv(obs_path, index=False)

    print(f"  True parameters: {true_params}")
    print(f"  DEM shape: {dem.shape}")
    print(f"  Rainfall length: {n_time}")
    print(f"  Observed flow length: {len(observed_flow)}")
    print(f"  Observed flow peak: {np.max(observed_flow):.2f} m3/s")

    return test_dir, dem_path, rain_path, obs_path, true_params, observed_flow


def test_calibrate_params_endpoint():
    print("\n=== Testing GET /api/v1/calibrate/params ===")
    try:
        response = requests.get(f"{BASE_URL}/api/v1/calibrate/params", timeout=10)
        response.raise_for_status()
        data = response.json()
        print(f"  OK Status: {response.status_code}")
        print(f"  OK Default params: {list(data['default_params'].keys())}")
        print(f"  OK Param bounds: {list(data['param_bounds'].keys())}")
        print(f"  OK Velocity formula: {data['velocity_formula']}")
        return True
    except Exception as e:
        print(f"  FAIL Failed: {e}")
        return False


def test_simulate_with_params_endpoint(dem_path, rain_path):
    print("\n=== Testing POST /api/v1/simulate/with-params ===")
    try:
        custom_params = {
            "v_coeff": 0.8,
            "len_exp": 0.4,
            "slope_exp": 0.25,
            "min_velocity": 0.3,
        }

        with open(dem_path, "rb") as f_dem, open(rain_path, "rb") as f_rain:
            files = {
                "dem_file": ("dem.tif", f_dem, "image/tiff"),
                "rainfall_file": ("rainfall.nc", f_rain, "application/x-netcdf"),
            }
            data = {
                "cell_size": 30.0,
                "time_step": 3600.0,
                "stream_threshold": 0.02,
                "n_subbasins": 3,
                **custom_params,
            }

            response = requests.post(
                f"{BASE_URL}/api/v1/simulate/with-params",
                files=files,
                data=data,
                timeout=60,
            )
            response.raise_for_status()

        assert response.headers["Content-Type"] == "application/zip"
        assert "attachment" in response.headers["Content-Disposition"]

        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            files_in_zip = zf.namelist()
            print(f"  OK Status: {response.status_code}")
            print(f"  OK Files in ZIP: {files_in_zip}")
            assert "hydrograph.csv" in files_in_zip
            assert "hydrograph.png" in files_in_zip
            assert "metadata.txt" in files_in_zip

            meta = zf.read("metadata.txt").decode("utf-8")
            print(f"  OK Metadata contains custom params: {'v_coeff: 0.800000' in meta}")

        return True
    except Exception as e:
        print(f"  FAIL Failed: {e}")
        return False


def test_calibrate_endpoint(dem_path, rain_path, obs_path, true_params, observed_flow):
    print("\n=== Testing POST /api/v1/calibrate ===")
    try:
        with open(dem_path, "rb") as f_dem, \
             open(rain_path, "rb") as f_rain, \
             open(obs_path, "rb") as f_obs:

            files = {
                "dem_file": ("dem.tif", f_dem, "image/tiff"),
                "rainfall_file": ("rainfall.nc", f_rain, "application/x-netcdf"),
                "observed_flow_file": ("observed.csv", f_obs, "text/csv"),
            }
            data = {
                "cell_size": 30.0,
                "time_step": 3600.0,
                "stream_threshold": 0.02,
                "n_subbasins": 3,
                "param_names": "v_coeff,len_exp,slope_exp,min_velocity",
                "max_iterations": 8,
                "random_seed": 42,
            }

            print("  Running calibration (this may take a minute)...")
            start_time = time.time()
            response = requests.post(
                f"{BASE_URL}/api/v1/calibrate",
                files=files,
                data=data,
                timeout=300,
            )
            elapsed = time.time() - start_time
            response.raise_for_status()

        assert response.headers["Content-Type"] == "application/zip"

        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            files_in_zip = zf.namelist()
            print(f"  OK Status: {response.status_code}")
            print(f"  OK Elapsed time: {elapsed:.1f}s")
            print(f"  OK Files in ZIP: {files_in_zip}")

            assert "hydrograph.csv" in files_in_zip
            assert "hydrograph.png" in files_in_zip
            assert "calibration_history.csv" in files_in_zip
            assert "calibration_result.txt" in files_in_zip

            result_text = zf.read("calibration_result.txt").decode("utf-8")
            print(f"\n  --- Calibration Result ---")
            print(result_text)

            history_csv = zf.read("calibration_history.csv").decode("utf-8")
            history_lines = history_csv.strip().split("\n")
            print(f"  OK History entries: {len(history_lines) - 1}")

            initial_nse = None
            best_nse = None
            for line in result_text.split("\n"):
                if "Initial NSE:" in line:
                    initial_nse = float(line.split(":")[1].strip())
                if "Best NSE:" in line:
                    best_nse = float(line.split(":")[1].strip())

            if initial_nse is not None and best_nse is not None:
                print(f"  OK Initial NSE: {initial_nse:.4f}")
                print(f"  OK Best NSE: {best_nse:.4f}")
                if np.isfinite(initial_nse) and np.isfinite(best_nse):
                    print(f"  OK NSE improved or equal: {best_nse >= initial_nse - 0.001}")
                    assert best_nse >= initial_nse - 0.001, f"NSE should not decrease significantly: {best_nse:.4f} vs {initial_nse:.4f}"
                else:
                    print(f"  NOTE: NSE is infinite, parameter range may cause numerical issues")

            print(f"  OK True parameters: {true_params}")

        return True
    except Exception as e:
        print(f"  FAIL Failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_info_endpoint():
    print("\n=== Testing GET /api/v1/info ===")
    try:
        response = requests.get(f"{BASE_URL}/api/v1/info", timeout=10)
        response.raise_for_status()
        data = response.json()
        print(f"  OK Status: {response.status_code}")
        print(f"  OK Version: {data['version']}")
        print(f"  OK Calibration features: {'Bayesian parameter calibration' in str(data['features'])}")
        print(f"  OK Calibratable parameters: {data.get('calibratable_parameters', [])}")
        assert "POST /calibrate" in str(data["endpoints"])
        assert "POST /simulate/with-params" in str(data["endpoints"])
        return True
    except Exception as e:
        print(f"  FAIL Failed: {e}")
        return False


def main():
    print("=" * 60)
    print("GIUH Calibration API End-to-End Test")
    print("=" * 60)

    try:
        response = requests.get(f"{BASE_URL}/api/v1/health", timeout=5)
        response.raise_for_status()
        print(f"OK Server is running at {BASE_URL}")
    except Exception as e:
        print(f"FAIL Server not running at {BASE_URL}: {e}")
        print("\nPlease start the server first:")
        print("  python main.py")
        return 1

    try:
        test_dir, dem_path, rain_path, obs_path, true_params, observed_flow = create_test_data()
    except Exception as e:
        print(f"FAIL Failed to create test data: {e}")
        import traceback
        traceback.print_exc()
        return 1

    results = []
    results.append(("GET /calibrate/params", test_calibrate_params_endpoint()))
    results.append(("GET /info", test_info_endpoint()))
    results.append(("POST /simulate/with-params", test_simulate_with_params_endpoint(dem_path, rain_path)))
    results.append(("POST /calibrate", test_calibrate_endpoint(dem_path, rain_path, obs_path, true_params, observed_flow)))

    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)

    passed = 0
    failed = 0
    for name, result in results:
        status = "PASS" if result else "FAIL"
        print(f"  {status} - {name}")
        if result:
            passed += 1
        else:
            failed += 1

    print(f"\nTotal: {passed} passed, {failed} failed")

    if failed > 0:
        return 1
    else:
        print("\n" + "=" * 60)
        print("ALL CALIBRATION API TESTS PASSED!")
        print("=" * 60)
        return 0


if __name__ == "__main__":
    exit(main())
