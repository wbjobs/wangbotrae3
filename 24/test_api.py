import requests
import json
import time

BASE_URL = "http://localhost:8000"


def test_stats():
    print("=== 测试 /stats 接口 ===")
    response = requests.get(f"{BASE_URL}/stats")
    print(f"状态码: {response.status_code}")
    print(f"结果: {json.dumps(response.json(), indent=2, ensure_ascii=False)}")
    return response.json()


def test_insert():
    print("\n=== 测试 /insert 接口 ===")
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
    data = {"points": points}
    response = requests.post(f"{BASE_URL}/insert", json=data)
    print(f"状态码: {response.status_code}")
    result = response.json()
    print(f"插入数量: {result['count']}")
    print(f"当前状态: {json.dumps(result['stats'], indent=2, ensure_ascii=False)}")
    print("插入结果:")
    for r in result['results']:
        print(f"  ({r['x']}, {r['y']}) -> Hilbert码: {r['hilbert_code']}")
    return result


def test_range():
    print("\n=== 测试 /range 接口 ===")
    data = {
        "x_min": 100,
        "x_max": 600,
        "y_min": 100,
        "y_max": 600,
        "use_index": True
    }
    response = requests.post(f"{BASE_URL}/range", json=data)
    print(f"状态码: {response.status_code}")
    result = response.json()
    print(f"查询方法: {result['method']}")
    print(f"查询耗时: {result['query_time_ms']} ms")
    print(f"返回点数: {result['count']}")
    print("结果点:")
    for p in result['points']:
        print(f"  ({p['x']}, {p['y']}) Hilbert码: {p['hilbert_code']}")
    return result


def test_range_no_index():
    print("\n=== 测试 /range 接口（不使用索引） ===")
    data = {
        "x_min": 100,
        "x_max": 600,
        "y_min": 100,
        "y_max": 600,
        "use_index": False
    }
    response = requests.post(f"{BASE_URL}/range", json=data)
    print(f"状态码: {response.status_code}")
    result = response.json()
    print(f"查询方法: {result['method']}")
    print(f"查询耗时: {result['query_time_ms']} ms")
    print(f"返回点数: {result['count']}")
    return result


def test_neighbors():
    print("\n=== 测试 /neighbors 接口 ===")
    data = {
        "x": 500,
        "y": 500,
        "k": 5
    }
    response = requests.post(f"{BASE_URL}/neighbors", json=data)
    print(f"状态码: {response.status_code}")
    result = response.json()
    print(f"目标点: {result['target']}")
    print(f"查询耗时: {result['query_time_ms']} ms")
    print(f"返回邻居数: {len(result['neighbors'])}")
    print("邻居点:")
    for p in result['neighbors']:
        print(f"  ({p['x']}, {p['y']}) Hilbert码: {p['hilbert_code']}, "
              f"码距: {p['code_distance']}, 欧氏距: {p['euclidean_distance']}")
    return result


def test_generate_test_data():
    print("\n=== 测试 /generate_test_data 接口 ===")
    response = requests.post(f"{BASE_URL}/generate_test_data?count=2000")
    print(f"状态码: {response.status_code}")
    result = response.json()
    print(f"生成数量: {result['count']}")
    print(f"当前状态: {json.dumps(result['stats'], indent=2, ensure_ascii=False)}")
    return result


def test_benchmark():
    print("\n=== 测试 /benchmark 接口 ===")
    data = {
        "x_min": 200,
        "x_max": 800,
        "y_min": 200,
        "y_max": 800,
        "iterations": 5
    }
    response = requests.post(f"{BASE_URL}/benchmark", json=data)
    print(f"状态码: {response.status_code}")
    result = response.json()
    print(f"迭代次数: {result['iterations']}")
    print(f"线性扫描平均耗时: {result['linear_scan']['avg_time_ms']} ms")
    print(f"Hilbert索引平均耗时: {result['hilbert_index']['avg_time_ms']} ms")
    print(f"加速比: {result['speedup']}x")
    print(f"当前状态: {json.dumps(result['stats'], indent=2, ensure_ascii=False)}")
    return result


def test_dynamic_scaling():
    print("\n=== 测试动态扩缩容 ===")
    print("先查看当前状态...")
    stats = test_stats()
    current_count = stats['point_count']
    threshold = stats['threshold']
    current_n = stats['n_order']

    print(f"\n当前点数: {current_count}, 阈值: {threshold}, N阶: {current_n}")

    need_more = threshold - current_count + 100
    print(f"需要插入 {need_more} 个点来触发扩缩容...")

    print("批量插入数据...")
    batch_size = 1000
    total_inserted = 0
    while total_inserted < need_more:
        count = min(batch_size, need_more - total_inserted)
        points = []
        for _ in range(count):
            import random
            points.append({"x": random.randint(0, 1000), "y": random.randint(0, 1000)})
        data = {"points": points}
        response = requests.post(f"{BASE_URL}/insert", json=data)
        result = response.json()
        total_inserted += result['count']
        print(f"已插入 {total_inserted}/{need_more}")

    print("\n检查是否触发了扩缩容...")
    new_stats = test_stats()
    print(f"旧N阶: {current_n}, 新N阶: {new_stats['n_order']}")
    print(f"旧阈值: {threshold}, 新阈值: {new_stats['threshold']}")

    if new_stats['n_order'] > current_n:
        print("✓ 动态扩缩容成功触发！")
    else:
        print("⚠ 未触发扩缩容，可能需要更多数据")

    return new_stats


if __name__ == "__main__":
    print("=" * 60)
    print("开始测试 Hilbert 空间索引服务 API")
    print("=" * 60)

    try:
        test_stats()
        test_insert()
        test_range()
        test_range_no_index()
        test_neighbors()
        test_generate_test_data()
        test_benchmark()
        test_dynamic_scaling()

        print("\n" + "=" * 60)
        print("✓ 所有测试完成！")
        print("=" * 60)

    except requests.exceptions.ConnectionError:
        print("❌ 无法连接到服务器，请确保服务已启动 (uvicorn main:app --reload)")
    except Exception as e:
        print(f"❌ 测试出错: {e}")
        import traceback
        traceback.print_exc()
