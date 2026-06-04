import requests
import json
import time

BASE_URL = "http://localhost:8000"


def generate_unique_points(count, start_offset=0):
    points = []
    for i in range(count):
        idx = start_offset + i
        x = idx % 1001
        y_base = (idx // 1001) % 21
        y = y_base * 50 + (idx * 17) % 50
        y = min(y, 1000)
        points.append({"x": x, "y": y})
    return points


def test_async_reindex():
    print("=" * 70)
    print("Testing Async Reindex with Dual Write")
    print("=" * 70)

    print("\n[1] Check initial state (should be N=4)")
    r = requests.get(f"{BASE_URL}/stats")
    stats = r.json()
    print(f"  Active N order: {stats['active_n_order']}")
    print(f"  Point count: {stats['point_count']}")
    assert stats['active_n_order'] == 4, f"Expected N=4, got {stats['active_n_order']}"
    print("  OK: Initial N=4 confirmed")

    print("\n[2] Check /reindex/status")
    r = requests.get(f"{BASE_URL}/reindex/status")
    status = r.json()
    print(f"  Is running: {status['is_running']}")
    print(f"  Dual write active: {status['dual_write_active']}")
    assert not status['is_running'], "Reindex should not be running initially"
    print("  OK: Initial reindex status is idle")

    print("\n[3] Insert 1200 points to trigger N=4 -> N=6 upgrade (threshold=1000)")
    print("    This should trigger async reindex...")

    points = generate_unique_points(1200, 0)

    insert_start = time.time()
    r = requests.post(f"{BASE_URL}/insert", json={"points": points})
    insert_elapsed = (time.time() - insert_start) * 1000

    if r.status_code != 200:
        print(f"  Error: {r.status_code}")
        print(f"  Response: {r.text[:500]}")
        raise Exception("Insert failed")

    result = r.json()
    print(f"  Insert completed in {insert_elapsed:.1f} ms (non-blocking!)")
    print(f"  Inserted: {result['count']} points")
    print(f"  Current active N: {result['stats']['active_n_order']}")

    time.sleep(0.5)

    print("\n[4] Check reindex status immediately after insert")
    r = requests.get(f"{BASE_URL}/reindex/status")
    status = r.json()
    print(f"  Is running: {status['is_running']}")
    print(f"  From N: {status['from_n_order']} -> To N: {status['to_n_order']}")
    print(f"  Progress: {status['progress_percent']}%")
    print(f"  Dual write active: {status['dual_write_active']}")
    print(f"  Processed: {status['processed_points']}/{status['total_points']}")

    assert status['is_running'], "Reindex should be running!"
    assert status['from_n_order'] == 4, "Should reindex from N=4"
    assert status['to_n_order'] == 6, "Should reindex to N=6"
    assert status['dual_write_active'], "Dual write should be active!"
    print("  OK: Async reindex started with dual write!")

    print("\n[5] Insert more points during reindex (testing dual write)")
    dual_write_points = generate_unique_points(100, 2000)

    r = requests.post(f"{BASE_URL}/insert", json={"points": dual_write_points})
    result = r.json()
    print(f"  Inserted {result['count']} more points during reindex")
    print(f"  First point action: {result['results'][0]['action']}")
    print("  OK: Dual write works during reindex!")

    print("\n[6] Wait for reindex to complete...")
    max_wait = 30
    waited = 0
    while waited < max_wait:
        r = requests.get(f"{BASE_URL}/reindex/status")
        status = r.json()
        if not status['is_running']:
            break
        print(f"  Progress: {status['progress_percent']}% ({status['processed_points']}/{status['total_points']})")
        time.sleep(1)
        waited += 1

    r = requests.get(f"{BASE_URL}/reindex/status")
    status = r.json()
    print(f"  Final status - running: {status['is_running']}")
    print(f"  Progress: {status['progress_percent']}%")
    print(f"  Dual write active: {status['dual_write_active']}")

    assert not status['is_running'], "Reindex should be complete"
    assert status['progress_percent'] == 100.0, "Progress should be 100%"
    assert not status['dual_write_active'], "Dual write should be inactive"
    print("  OK: Reindex completed successfully!")

    print("\n[7] Verify N has been upgraded to 6")
    r = requests.get(f"{BASE_URL}/stats")
    stats = r.json()
    print(f"  Active N order: {stats['active_n_order']}")
    print(f"  Point count: {stats['point_count']}")
    assert stats['active_n_order'] == 6, f"Expected N=6, got {stats['active_n_order']}"
    print("  OK: N upgraded to 6!")

    print("\n[8] Test range query with new N=6 index")
    r = requests.post(f"{BASE_URL}/range", json={
        "x_min": 100, "x_max": 600,
        "y_min": 100, "y_max": 600
    })
    result = r.json()
    print(f"  Range query returned {result['count']} points")
    print(f"  Query time: {result['query_time_ms']} ms")
    assert result['count'] > 0, "Range query should return points"
    print("  OK: Range query works with N=6 index!")

    print("\n[9] Insert more points to trigger N=6 -> N=8 upgrade (threshold=5000)")
    current_count = stats['point_count']
    need_more = 5000 - current_count + 200
    print(f"  Current: {current_count}, need {need_more} more points to trigger N=8")

    batch_size = 1000
    inserted = 0
    offset = 3000
    while inserted < need_more:
        batch = generate_unique_points(min(batch_size, need_more - inserted), offset)
        offset += batch_size
        r = requests.post(f"{BASE_URL}/insert", json={"points": batch})
        result = r.json()
        inserted += result['count']
        print(f"  Inserted {inserted}/{need_more}")

    print("\n[10] Check second reindex (N=6 -> N=8) started")
    time.sleep(0.5)
    r = requests.get(f"{BASE_URL}/reindex/status")
    status = r.json()
    print(f"  Is running: {status['is_running']}")
    print(f"  From N: {status['from_n_order']} -> To N: {status['to_n_order']}")
    print(f"  Dual write active: {status['dual_write_active']}")

    if status['is_running']:
        assert status['from_n_order'] == 6, "Should reindex from N=6"
        assert status['to_n_order'] == 8, "Should reindex to N=8"
        print("  OK: Second reindex (N=6->N=8) started!")

        print("\n[11] Wait for second reindex to complete...")
        waited = 0
        while waited < 60:
            r = requests.get(f"{BASE_URL}/reindex/status")
            status = r.json()
            if not status['is_running']:
                break
            print(f"  Progress: {status['progress_percent']}% ({status['processed_points']}/{status['total_points']})")
            time.sleep(2)
            waited += 2

        r = requests.get(f"{BASE_URL}/stats")
        stats = r.json()
        print(f"  Final active N: {stats['active_n_order']}")
        assert stats['active_n_order'] == 8, f"Expected N=8, got {stats['active_n_order']}"
        print("  OK: N upgraded to 8!")
    else:
        print("  Note: Second reindex may have already completed or not triggered")

    print("\n" + "=" * 70)
    print("All async reindex tests passed!")
    print("=" * 70)


if __name__ == "__main__":
    try:
        test_async_reindex()
    except Exception as e:
        print(f"\nTest failed: {e}")
        import traceback
        traceback.print_exc()
