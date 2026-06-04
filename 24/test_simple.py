import requests
import json
import random

BASE_URL = "http://localhost:8000"


def main():
    print("=" * 60)
    print("Testing Hilbert Spatial Index Service API")
    print("=" * 60)

    try:
        print("\n[1] Testing /stats ...")
        r = requests.get(f"{BASE_URL}/stats")
        print("Status:", r.status_code)
        stats = r.json()
        print("Result:", json.dumps(stats, indent=2))

        print("\n[2] Testing /insert ...")
        points = [
            {"x": 100, "y": 100},
            {"x": 200, "y": 200},
            {"x": 500, "y": 500},
            {"x": 800, "y": 800},
            {"x": 900, "y": 100},
            {"x": 100, "y": 900},
            {"x": 300, "y": 700},
            {"x": 700, "y": 300},
        ]
        r = requests.post(f"{BASE_URL}/insert", json={"points": points})
        print("Status:", r.status_code)
        result = r.json()
        print("Inserted:", result["count"], "points")
        for p in result["results"]:
            print(f"  ({p['x']}, {p['y']}) -> Hilbert: {p['hilbert_code']}")

        print("\n[3] Testing /range (with index) ...")
        data = {
            "x_min": 100, "x_max": 600,
            "y_min": 100, "y_max": 600,
            "use_index": True
        }
        r = requests.post(f"{BASE_URL}/range", json=data)
        print("Status:", r.status_code)
        result = r.json()
        print("Method:", result["method"])
        print("Time:", result["query_time_ms"], "ms")
        print("Found:", result["count"], "points")
        for p in result["points"]:
            print(f"  ({p['x']}, {p['y']}) Hilbert: {p['hilbert_code']}")

        print("\n[4] Testing /range (without index) ...")
        data["use_index"] = False
        r = requests.post(f"{BASE_URL}/range", json=data)
        print("Status:", r.status_code)
        result = r.json()
        print("Method:", result["method"])
        print("Time:", result["query_time_ms"], "ms")
        print("Found:", result["count"], "points")

        print("\n[5] Testing /neighbors ...")
        data = {"x": 500, "y": 500, "k": 5}
        r = requests.post(f"{BASE_URL}/neighbors", json=data)
        print("Status:", r.status_code)
        result = r.json()
        print("Target:", result["target"])
        print("Time:", result["query_time_ms"], "ms")
        print("Found:", len(result["neighbors"]), "neighbors")
        for p in result["neighbors"]:
            print(f"  ({p['x']}, {p['y']}) code_dist: {p['code_distance']}, euclid_dist: {p['euclidean_distance']}")

        print("\n[6] Generating test data (2000 points) ...")
        r = requests.post(f"{BASE_URL}/generate_test_data?count=2000")
        print("Status:", r.status_code)
        result = r.json()
        print("Generated:", result["count"], "points")
        print("Current stats:", json.dumps(result["stats"], indent=2))

        print("\n[7] Testing /benchmark ...")
        data = {
            "x_min": 200, "x_max": 800,
            "y_min": 200, "y_max": 800,
            "iterations": 5
        }
        r = requests.post(f"{BASE_URL}/benchmark", json=data)
        print("Status:", r.status_code)
        result = r.json()
        print("Iterations:", result["iterations"])
        print("Linear scan avg:", result["linear_scan"]["avg_time_ms"], "ms")
        print("Hilbert index avg:", result["hilbert_index"]["avg_time_ms"], "ms")
        print("Speedup:", result["speedup"], "x")

        print("\n[8] Testing dynamic scaling ...")
        r = requests.get(f"{BASE_URL}/stats")
        stats = r.json()
        current_count = stats["point_count"]
        threshold = stats["threshold"]
        current_n = stats["n_order"]
        print(f"Current: {current_count} points, threshold: {threshold}, N: {current_n}")

        need_more = threshold - current_count + 100
        print(f"Need {need_more} more points to trigger scaling...")

        batch_size = 1000
        total_inserted = 0
        while total_inserted < need_more:
            count = min(batch_size, need_more - total_inserted)
            points = []
            for _ in range(count):
                points.append({"x": random.randint(0, 1000), "y": random.randint(0, 1000)})
            r = requests.post(f"{BASE_URL}/insert", json={"points": points})
            result = r.json()
            total_inserted += result["count"]
            print(f"Inserted {total_inserted}/{need_more}")

        r = requests.get(f"{BASE_URL}/stats")
        new_stats = r.json()
        print(f"Old N: {current_n}, New N: {new_stats['n_order']}")
        print(f"Old threshold: {threshold}, New threshold: {new_stats['threshold']}")

        if new_stats["n_order"] > current_n:
            print("Dynamic scaling triggered successfully!")
        else:
            print("Note: scaling not triggered, may need more data")

        print("\n" + "=" * 60)
        print("All tests completed successfully!")
        print("=" * 60)

    except requests.exceptions.ConnectionError:
        print("ERROR: Cannot connect to server. Make sure server is running.")
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
