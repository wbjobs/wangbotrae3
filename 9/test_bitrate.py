import sys
sys.path.insert(0, '.')

import numpy as np
import cv2
from bitrate_allocator import ContentComplexityAnalyzer, DynamicBitrateAllocator


def generate_test_frame(complexity: str = "medium", size: tuple = (240, 320), index: int = 0) -> np.ndarray:
    h, w = size
    if complexity == "simple":
        frame = np.full((h, w, 3), 128, dtype=np.uint8)
        frame[50:70, 50:70] = [200, 100, 50]
    elif complexity == "complex":
        np.random.seed(42)
        frame = np.random.randint(0, 256, (h, w, 3), dtype=np.uint8)
        for i in range(0, h, 4):
            for j in range(0, w, 4):
                frame[i:i+2, j:j+2] = [i % 256, j % 256, (i+j) % 256]
    elif complexity == "high_motion":
        frame = np.zeros((h, w, 3), dtype=np.uint8)
        cx = w // 2 + int(50 * np.sin(index * 0.3))
        cy = h // 2 + int(50 * np.cos(index * 0.3))
        cv2.circle(frame, (cx, cy), 40, (255, 200, 100), -1)
        noise = np.random.randint(0, 30, (h, w, 3), dtype=np.uint8)
        frame = cv2.add(frame, noise)
    else:
        np.random.seed(index)
        frame = np.random.randint(50, 200, (h, w, 3), dtype=np.uint8)
    return frame


def test_content_complexity_analyzer():
    print("=" * 60)
    print("Test 1: ContentComplexityAnalyzer - Spatial Analysis")
    print("=" * 60)
    
    analyzer = ContentComplexityAnalyzer()
    
    simple_frame = generate_test_frame("simple")
    complex_frame = generate_test_frame("complex")
    
    simple_spatial = analyzer.analyze_spatial(simple_frame)
    complex_spatial = analyzer.analyze_spatial(complex_frame)
    
    print(f"\nSimple frame spatial metrics:")
    print(f"  texture_richness: {simple_spatial['texture_richness']:.2f}")
    print(f"  edge_density: {simple_spatial['edge_density']:.4f}")
    print(f"  entropy: {simple_spatial['entropy']:.2f}")
    
    print(f"\nComplex frame spatial metrics:")
    print(f"  texture_richness: {complex_spatial['texture_richness']:.2f}")
    print(f"  edge_density: {complex_spatial['edge_density']:.4f}")
    print(f"  entropy: {complex_spatial['entropy']:.2f}")
    
    passed = complex_spatial["texture_richness"] > simple_spatial["texture_richness"]
    print(f"\n[PASS]" if passed else "[FAIL]", 
          f"- Complex frame has higher texture richness")
    
    return passed


def test_temporal_analysis():
    print("\n" + "=" * 60)
    print("Test 2: ContentComplexityAnalyzer - Temporal Analysis")
    print("=" * 60)
    
    analyzer = ContentComplexityAnalyzer()
    
    static_frames = [generate_test_frame("simple") for _ in range(5)]
    motion_frames = []
    for i in range(5):
        frame = generate_test_frame("high_motion", index=i)
        motion_frames.append(frame)
    
    static_temporal = []
    for f in static_frames:
        t = analyzer.analyze_temporal(f)
        static_temporal.append(t["motion_magnitude"])
    
    analyzer.reset()
    
    motion_temporal = []
    for f in motion_frames:
        t = analyzer.analyze_temporal(f)
        motion_temporal.append(t["motion_magnitude"])
    
    avg_static = np.mean(static_temporal)
    avg_motion = np.mean(motion_temporal[1:])
    
    print(f"\nStatic frames avg motion: {avg_static:.2f}")
    print(f"Motion frames avg motion: {avg_motion:.2f}")
    
    passed = avg_motion >= avg_static
    print(f"\n[PASS]" if passed else "[FAIL]",
          f"- Motion frames have higher temporal activity")
    
    return passed


def test_dynamic_bitrate_allocator():
    print("\n" + "=" * 60)
    print("Test 3: DynamicBitrateAllocator - Budget-Aware Allocation")
    print("=" * 60)
    
    budget = 5.0
    allocator = DynamicBitrateAllocator(bitrate_budget_mbps=budget)
    
    simple_frames = [generate_test_frame("simple") for _ in range(30)]
    complex_frames = [generate_test_frame("complex") for _ in range(30)]
    mixed_frames = [generate_test_frame("medium") for _ in range(30)]
    
    allocator.analyze_chunk(simple_frames)
    allocator.analyze_chunk(complex_frames)
    allocator.analyze_chunk(mixed_frames)
    
    chunk_frame_counts = [30, 30, 30]
    allocations = allocator.allocate_bitrates(chunk_frame_counts)
    
    print(f"\nBitrate budget: {budget} Mbps")
    print(f"\nAllocations:")
    for i, alloc in enumerate(allocations):
        print(f"  Chunk {i}: {alloc['bitrate_mbps']} Mbps, CRF {alloc['crf']}, "
              f"complexity={alloc['complexity_score']:.3f}")
    
    all_passed = True
    
    if allocations[1]["bitrate_mbps"] < allocations[0]["bitrate_mbps"]:
        print(f"\n[FAIL] - Complex chunk should get higher bitrate than simple chunk")
        all_passed = False
    else:
        print(f"\n[PASS] - Complex chunk gets higher bitrate than simple chunk")
    
    total_weighted = sum(a["bitrate_mbps"] * a["frame_count"] for a in allocations)
    total_frames = sum(a["frame_count"] for a in allocations)
    avg_bitrate = total_weighted / total_frames
    
    budget_tolerance = 0.15
    if abs(avg_bitrate - budget) / budget > budget_tolerance:
        print(f"[FAIL] - Average bitrate {avg_bitrate:.2f} Mbps deviates too much from budget {budget} Mbps")
        all_passed = False
    else:
        print(f"[PASS] - Average bitrate {avg_bitrate:.2f} Mbps is within budget range")
    
    for alloc in allocations:
        if alloc["bitrate_mbps"] < budget * 0.3:
            print(f"[FAIL] - Bitrate {alloc['bitrate_mbps']} is below minimum threshold")
            all_passed = False
            break
    else:
        print(f"[PASS] - All bitrates above minimum threshold ({budget * 0.3} Mbps)")
    
    for alloc in allocations:
        if alloc["bitrate_mbps"] > budget * 2.5:
            print(f"[FAIL] - Bitrate {alloc['bitrate_mbps']} exceeds maximum cap")
            all_passed = False
            break
    else:
        print(f"[PASS] - All bitrates below maximum cap ({budget * 2.5} Mbps)")
    
    return all_passed


def test_budget_variations():
    print("\n" + "=" * 60)
    print("Test 4: Different Budget Levels")
    print("=" * 60)
    
    all_passed = True
    
    for budget in [1.0, 5.0, 10.0, 25.0]:
        allocator = DynamicBitrateAllocator(bitrate_budget_mbps=budget)
        
        simple_frames = [generate_test_frame("simple") for _ in range(20)]
        complex_frames = [generate_test_frame("complex") for _ in range(20)]
        
        allocator.analyze_chunk(simple_frames)
        allocator.analyze_chunk(complex_frames)
        
        allocations = allocator.allocate_bitrates([20, 20])
        
        avg = sum(a["bitrate_mbps"] for a in allocations) / len(allocations)
        
        print(f"\n  Budget {budget} Mbps -> avg allocation: {avg:.2f} Mbps")
        for i, a in enumerate(allocations):
            print(f"    Chunk {i}: {a['bitrate_mbps']} Mbps (complexity={a['complexity_score']:.3f})")
        
        if allocations[1]["bitrate_mbps"] < allocations[0]["bitrate_mbps"]:
            print(f"  [FAIL] - Budget {budget}: complex < simple")
            all_passed = False
        else:
            print(f"  [PASS] - Budget {budget}: complex >= simple")
    
    return all_passed


def test_crf_mapping():
    print("\n" + "=" * 60)
    print("Test 5: CRF Mapping Consistency")
    print("=" * 60)
    
    allocator = DynamicBitrateAllocator(bitrate_budget_mbps=5.0)
    
    test_bitrates = [1.0, 3.0, 5.0, 8.0, 15.0]
    
    print("\nBitrate -> CRF mapping:")
    for br in test_bitrates:
        crf = allocator._bitrate_to_crf(br, 0.5)
        print(f"  {br} Mbps -> CRF {crf}")
    
    all_passed = True
    prev_crf = None
    for br in sorted(test_bitrates, reverse=True):
        crf = allocator._bitrate_to_crf(br, 0.5)
        if prev_crf is not None and crf <= prev_crf:
            print(f"  [FAIL] - Lower bitrate ({br} Mbps) should have higher CRF, got CRF {crf} <= prev {prev_crf}")
            all_passed = False
            break
        prev_crf = crf
    
    if all_passed:
        print("\n[PASS] - Higher bitrates map to lower CRFs (better quality)")
    
    return all_passed


if __name__ == "__main__":
    print("Testing Dynamic Bitrate Allocation System\n")
    
    results = []
    results.append(test_content_complexity_analyzer())
    results.append(test_temporal_analysis())
    results.append(test_dynamic_bitrate_allocator())
    results.append(test_budget_variations())
    results.append(test_crf_mapping())
    
    print("\n" + "=" * 60)
    if all(results):
        print("[PASS] ALL TESTS PASSED")
        print("\nDynamic bitrate allocation system verified:")
        print("1. Spatial analysis: texture richness, edge density, entropy")
        print("2. Temporal analysis: frame differencing, optical flow")
        print("3. Budget-aware allocation with complexity weighting")
        print("4. Min/max bitrate constraints enforced")
        print("5. CRF mapping consistent with bitrate levels")
        sys.exit(0)
    else:
        print("[FAIL] SOME TESTS FAILED")
        sys.exit(1)
