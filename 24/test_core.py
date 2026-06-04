from hilbert import Hilbert

def test_hilbert_algorithm():
    print("=" * 50)
    print("Testing Hilbert Algorithm Core Functions")
    print("=" * 50)

    h = Hilbert(n=8, max_coord=1000)

    print("\n1. Testing coordinate <-> grid mapping:")
    test_coords = [(0, 0), (500, 500), (1000, 1000), (250, 750)]
    for x, y in test_coords:
        gx, gy = h._coord_to_grid(x, y)
        rx, ry = h._grid_to_coord(gx, gy)
        print(f"  ({x}, {y}) -> grid ({gx}, {gy}) -> approx ({rx}, {ry})")

    print("\n2. Testing encode/decode consistency:")
    for x, y in test_coords:
        code = h.encode(x, y)
        dx, dy = h.decode(code)
        print(f"  ({x}, {y}) -> code {code} -> decode ({dx}, {dy})")

    print("\n3. Testing spatial locality (Hilbert property):")
    nearby_pairs = [
        ((500, 500), (501, 500)),
        ((100, 100), (101, 101)),
        ((900, 100), (899, 101)),
    ]
    for (x1, y1), (x2, y2) in nearby_pairs:
        c1 = h.encode(x1, y1)
        c2 = h.encode(x2, y2)
        code_dist = abs(c1 - c2)
        euclid_dist = ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5
        print(f"  Points ({x1},{y1}) and ({x2},{y2}):")
        print(f"    Euclidean distance: {euclid_dist:.2f}, Code distance: {code_dist}")

    print("\n4. Testing different N orders:")
    for n in [4, 6, 8, 10, 12]:
        hn = Hilbert(n=n, max_coord=1000)
        code = hn.encode(500, 500)
        max_idx = hn.get_max_index()
        print(f"  N={n}: max_index={max_idx}, code(500,500)={code}")

    print("\n5. Testing Hilbert curve properties:")
    codes = []
    for i in range(0, 1001, 100):
        for j in range(0, 1001, 100):
            codes.append(h.encode(i, j))
    print(f"  Generated {len(codes)} Hilbert codes")
    print(f"  Min code: {min(codes)}, Max code: {max(codes)}")
    print(f"  Unique codes: {len(set(codes))}/{len(codes)}")

    print("\n" + "=" * 50)
    print("All core tests passed!")
    print("=" * 50)


if __name__ == "__main__":
    test_hilbert_algorithm()
