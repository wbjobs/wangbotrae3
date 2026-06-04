import requests
import json
import random

BASE_URL = "http://localhost:8000"


def test_bug1_range_query_completeness():
    print("=" * 60)
    print("BUG 1: Range query should not miss boundary points")
    print("=" * 60)

    print("\nStep 1: Insert a dense grid of points...")
    points = []
    for x in range(0, 1001, 50):
        for y in range(0, 1001, 50):
            points.append({"x": x, "y": y})
    r = requests.post(f"{BASE_URL}/insert", json={"points": points})
    print(f"Inserted {r.json()['count']} points")

    print("\nStep 2: Query a diagonal rectangle with Hilbert index...")
    r = requests.post(f"{BASE_URL}/range", json={
        "x_min": 200, "x_max": 400,
        "y_min": 200, "y_max": 400,
        "use_index": True
    })
    indexed_result = r.json()
    indexed_points = {(p["x"], p["y"]) for p in indexed_result["points"]}

    print("\nStep 3: Query the same rectangle without index (ground truth)...")
    r = requests.post(f"{BASE_URL}/range", json={
        "x_min": 200, "x_max": 400,
        "y_min": 200, "y_max": 400,
        "use_index": False
    })
    ground_truth = r.json()
    truth_points = {(p["x"], p["y"]) for p in ground_truth["points"]}

    print(f"\nHilbert index result: {len(indexed_points)} points")
    print(f"Ground truth: {len(truth_points)} points")

    missing = truth_points - indexed_points
    extra = indexed_points - truth_points

    if missing:
        print(f"MISSING {len(missing)} points (BUG NOT FIXED):")
        for p in sorted(missing)[:5]:
            print(f"  {p}")
    else:
        print("No missing points - BUG 1 FIXED!")

    if extra:
        print(f"Extra points (false positives, expected): {len(extra)}")
    else:
        print("No extra points - exact match!")


def test_bug2_duplicate_insert():
    print("\n" + "=" * 60)
    print("BUG 2: Duplicate insert should update/ignore, not crash")
    print("=" * 60)

    print("\nStep 1: Insert a point...")
    r = requests.post(f"{BASE_URL}/insert", json={
        "points": [{"x": 777, "y": 777}]
    })
    result = r.json()
    print(f"First insert: {result['results'][0]}")

    print("\nStep 2: Insert the same point again...")
    r = requests.post(f"{BASE_URL}/insert", json={
        "points": [{"x": 777, "y": 777}]
    })
    if r.status_code == 200:
        result = r.json()
        action = result['results'][0].get('action', 'unknown')
        print(f"Second insert succeeded! Action: {action}")
        print("BUG 2 FIXED - duplicate handled gracefully!")
    else:
        print(f"BUG 2 NOT FIXED - got error: {r.status_code} {r.text}")

    print("\nStep 3: Insert multiple with duplicates...")
    r = requests.post(f"{BASE_URL}/insert", json={
        "points": [{"x": 777, "y": 777}, {"x": 888, "y": 888}, {"x": 777, "y": 777}]
    })
    if r.status_code == 200:
        result = r.json()
        for r_item in result['results']:
            print(f"  ({r_item['x']}, {r_item['y']}) -> {r_item.get('action', 'unknown')}")
        print("Bulk insert with duplicates works!")
    else:
        print(f"Error: {r.status_code}")


def test_bug3_neighbors_boundary():
    print("\n" + "=" * 60)
    print("BUG 3: Neighbors near boundary should still return results")
    print("=" * 60)

    print("\nStep 1: Insert points near origin (Hilbert code 0 area)...")
    origin_points = []
    for x in range(0, 100, 10):
        for y in range(0, 100, 10):
            origin_points.append({"x": x, "y": y})
    r = requests.post(f"{BASE_URL}/insert", json={"points": origin_points})
    print(f"Inserted {r.json()['count']} points near origin")

    from hilbert import Hilbert
    h = Hilbert(n=8, max_coord=1000)
    code_at_origin = h.encode(0, 0)
    print(f"\nHilbert code at (0,0): {code_at_origin}")

    print("\nStep 2: Query neighbors of point (0,0) with k=10...")
    r = requests.post(f"{BASE_URL}/neighbors", json={
        "x": 0, "y": 0, "k": 10
    })
    if r.status_code == 200:
        result = r.json()
        print(f"Target: {result['target']}")
        print(f"Found {len(result['neighbors'])} neighbors")
        if len(result['neighbors']) > 0:
            print("BUG 3 FIXED - boundary neighbors returned!")
            for p in result['neighbors'][:3]:
                print(f"  ({p['x']}, {p['y']}) code_dist={p['code_distance']}, euclid_dist={p['euclidean_distance']}")
        else:
            print("BUG 3 NOT FIXED - no neighbors returned at boundary!")
    else:
        print(f"Error: {r.status_code} {r.text}")

    print("\nStep 3: Also test near max Hilbert code boundary...")
    max_code_point = h.decode(h.get_max_index())
    print(f"Max Hilbert code point: {max_code_point}")
    r = requests.post(f"{BASE_URL}/insert", json={
        "points": [{"x": 1000, "y": 1000}]
    })

    r = requests.post(f"{BASE_URL}/neighbors", json={
        "x": 1000, "y": 1000, "k": 10
    })
    if r.status_code == 200:
        result = r.json()
        print(f"Target: {result['target']}")
        print(f"Found {len(result['neighbors'])} neighbors near max boundary")
        if len(result['neighbors']) > 0:
            print("Max boundary also works!")
        else:
            print("Max boundary returned empty - may need data in that area")


if __name__ == "__main__":
    test_bug1_range_query_completeness()
    test_bug2_duplicate_insert()
    test_bug3_neighbors_boundary()

    print("\n" + "=" * 60)
    print("All bug fix verification completed!")
    print("=" * 60)
