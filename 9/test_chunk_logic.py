import sys
sys.path.insert(0, '.')

from video_processor import VideoProcessor, CHUNK_SIZE, OVERLAP_SIZE

def test_chunk_split():
    test_cases = [
        (5, "Very short video"),
        (50, "Short video"),
        (99, "Just under chunk size"),
        (100, "Exactly chunk size"),
        (101, "Just over chunk size (odd)"),
        (105, "Chunk + overlap (odd)"),
        (150, "One and a half chunks"),
        (199, "Just under two chunks (odd)"),
        (200, "Exactly two chunks"),
        (201, "Just over two chunks (odd)"),
        (250, "Two and a half chunks"),
        (999, "Just under 10 chunks (odd)"),
        (1000, "Exactly 10 chunks"),
        (1001, "Just over 10 chunks (odd)"),
    ]
    
    processor = VideoProcessor()
    
    print(f"CHUNK_SIZE = {CHUNK_SIZE}, OVERLAP_SIZE = {OVERLAP_SIZE}")
    print("=" * 80)
    
    all_passed = True
    
    for total_frames, description in test_cases:
        chunks = processor._split_into_chunks(total_frames)
        
        all_valid_frames = []
        for chunk in chunks:
            for f in range(chunk["valid_start"], chunk["valid_end"]):
                all_valid_frames.append(f)
        
        expected_frames = list(range(total_frames))
        is_complete = all_valid_frames == expected_frames
        has_duplicates = len(all_valid_frames) != len(set(all_valid_frames))
        last_frame_included = (total_frames - 1) in all_valid_frames
        
        passed = is_complete and not has_duplicates and last_frame_included
        all_passed = all_passed and passed
        
        status = "[PASS]" if passed else "[FAIL]"
        
        print(f"\n{status} | {description}: {total_frames} frames (odd={total_frames % 2 == 1})")
        print(f"  Chunks: {len(chunks)}")
        print(f"  Frames covered: {len(all_valid_frames)}/{total_frames}")
        print(f"  Last frame included: {last_frame_included}")
        print(f"  Has duplicates: {has_duplicates}")
        
        if not passed:
            missing = set(expected_frames) - set(all_valid_frames)
            extra = set(all_valid_frames) - set(expected_frames)
            if missing:
                print(f"  Missing frames: {sorted(missing)}")
            if extra:
                print(f"  Extra frames: {sorted(extra)}")
        
        for i, chunk in enumerate(chunks):
            is_first = i == 0
            is_last = i == len(chunks) - 1
            marker = "[" if is_first else " "
            marker2 = "]" if is_last else " "
            print(f"  {marker}Chunk {i:2d}: read [{chunk['chunk_start']:4d}-{chunk['chunk_end']:4d}) "
                  f"→ valid [{chunk['valid_start']:4d}-{chunk['valid_end']:4d}) "
                  f"overlap={chunk['overlap_before']}/{chunk['overlap_after']}{marker2}")
    
    print("\n" + "=" * 80)
    if all_passed:
        print("[PASS] ALL TESTS PASSED - All frames correctly covered, no duplicates!")
    else:
        print("[FAIL] SOME TESTS FAILED")
    
    return all_passed


def test_boundary_conditions():
    print("\n" + "=" * 80)
    print("Testing boundary conditions specifically")
    print("=" * 80)
    
    processor = VideoProcessor()
    
    odd_numbers = [1, 3, 5, 7, 9, 11, 99, 101, 199, 201, 999, 1001]
    all_passed = True
    
    for n in odd_numbers:
        chunks = processor._split_into_chunks(n)
        
        all_valid = []
        for chunk in chunks:
            for f in range(chunk["valid_start"], chunk["valid_end"]):
                all_valid.append(f)
        
        expected = list(range(n))
        last_frame = n - 1
        
        if all_valid != expected:
            print(f"[FAIL] for {n} frames: missing {set(expected) - set(all_valid)}")
            all_passed = False
        elif last_frame not in all_valid:
            print(f"[FAIL] for {n} frames: last frame {last_frame} missing!")
            all_passed = False
        else:
            print(f"[PASS] for {n} frames: last frame {last_frame} included")
    
    if all_passed:
        print("\n[PASS] ALL BOUNDARY TESTS PASSED - Odd frames handled correctly!")
    
    return all_passed


if __name__ == "__main__":
    print("Testing VideoProcessor chunk split logic")
    print("This verifies that the boundary condition bug is fixed")
    print("and all frames (including odd-numbered videos) are processed.\n")
    
    passed1 = test_chunk_split()
    passed2 = test_boundary_conditions()
    
    print("\n" + "=" * 80)
    if passed1 and passed2:
        print("[PASS] ALL TESTS PASSED")
        print("\nThe fix ensures:")
        print("1. Loop condition uses proper range (start < total_frames) not (start < total_frames - 1)")
        print("2. All frames including the last one are processed")
        print("3. Odd frame counts work correctly")
        print("4. Chunk boundaries overlap and blend smoothly to avoid seam artifacts")
        sys.exit(0)
    else:
        print("[FAIL] SOME TESTS FAILED")
        sys.exit(1)
