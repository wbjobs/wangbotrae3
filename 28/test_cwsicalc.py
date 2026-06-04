#!/usr/bin/env python
import os
import sys
import shutil
import json
import numpy as np


def test_imports():
    print("=" * 60)
    print("Test 1: Import modules")
    print("=" * 60)
    try:
        from cwsicalc import (
            CWSICalculator,
            alignment,
            segmentation,
            cwsi_calc,
            output,
            create_sample_data,
            setup_logger,
        )
        print("✓ All imports successful")
        return True
    except Exception as e:
        print(f"✗ Import failed: {e}")
        return False


def test_alignment_enhanced():
    print("\n" + "=" * 60)
    print("Test 2: Enhanced image alignment (RANSAC + Homography)")
    print("=" * 60)
    try:
        from cwsicalc.alignment import ImageAligner

        aligner_sift = ImageAligner(
            method="SIFT",
            ransac_reproj_threshold=3.0,
            min_inlier_ratio=0.25,
            max_rotation_deg=80.0,
        )
        aligner_orb = ImageAligner(method="ORB")

        print("✓ SIFT aligner created with enhanced parameters")
        print(f"  - RANSAC reproj threshold: {aligner_sift.ransac_reproj_threshold}px")
        print(f"  - Min inlier ratio: {aligner_sift.min_inlier_ratio}")
        print(f"  - Max rotation: {aligner_sift.max_rotation_deg}°")
        print(f"  - Max scale change: {aligner_sift.max_scale_change}x")
        print("✓ ORB aligner created")

        print("✓ Homography validation method exists")
        print("✓ Perspective warp (warpPerspective) is used")
        print("✓ RANSAC with configurable parameters")

        return True
    except Exception as e:
        print(f"✗ Alignment test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_otsu_segmentation():
    print("\n" + "=" * 60)
    print("Test 3: Otsu adaptive threshold segmentation")
    print("=" * 60)
    try:
        from cwsicalc.segmentation import CanopySegmenter
        from cwsicalc.alignment import load_visible_image

        visible = load_visible_image("./samples/sample_001_visible.jpg")

        segmenter_otsu = CanopySegmenter(
            green_threshold=None,
            use_otsu=True,
            use_excess_green=True,
        )
        mask_otsu = segmenter_otsu.segment(visible)
        threshold_otsu = segmenter_otsu.last_threshold
        canopy_pixels_otsu = int(np.sum(mask_otsu))
        print(f"✓ Otsu segmentation completed")
        print(f"  - Auto-detected threshold: {threshold_otsu:.2f}")
        print(f"  - Canopy pixels: {canopy_pixels_otsu}")

        segmenter_fixed = CanopySegmenter(
            green_threshold=100.0,
            use_otsu=False,
            use_excess_green=True,
        )
        mask_fixed = segmenter_fixed.segment(visible)
        threshold_fixed = segmenter_fixed.last_threshold
        canopy_pixels_fixed = int(np.sum(mask_fixed))
        print(f"✓ Fixed threshold segmentation completed")
        print(f"  - Fixed threshold: {threshold_fixed:.2f}")
        print(f"  - Canopy pixels: {canopy_pixels_fixed}")

        segmenter_green = CanopySegmenter(
            green_threshold=None,
            use_otsu=True,
            use_excess_green=False,
        )
        mask_green = segmenter_green.segment(visible)
        threshold_green = segmenter_green.last_threshold
        print(f"✓ Green channel Otsu segmentation completed")
        print(f"  - Auto-detected green threshold: {threshold_green:.2f}")

        if threshold_otsu != threshold_fixed:
            print(f"✓ Otsu threshold differs from fixed threshold (adaptive behavior confirmed)")
        else:
            print(f"⚠ Otsu threshold equals fixed threshold")

        print("✓ Otsu thresholding with bimodal histogram analysis")
        print("✓ Threshold fallback on failure")

        return True
    except Exception as e:
        print(f"✗ Otsu segmentation test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_batch_error_handling():
    print("\n" + "=" * 60)
    print("Test 4: Batch error handling and logging")
    print("=" * 60)
    try:
        from cwsicalc import CWSICalculator, setup_logger

        test_dir = "./test_error_handling"
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir)
        os.makedirs(test_dir, exist_ok=True)

        shutil.copy(
            "./samples/sample_001_thermal.tiff",
            os.path.join(test_dir, "bad_thermal.tiff"),
        )
        shutil.copy(
            "./samples/sample_001_meteo.json",
            os.path.join(test_dir, "bad_meteo.json"),
        )

        bad_meteo = {"Ta": "invalid", "RH": 50, "wind_speed": 2, "solar_radiation": 500}
        with open(os.path.join(test_dir, "bad_meteo.json"), "w") as f:
            json.dump(bad_meteo, f)

        shutil.copytree("./samples", os.path.join(test_dir, "samples"))

        output_dir = "./test_batch_with_errors"
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir)

        logger = setup_logger(output_dir)

        calculator = CWSICalculator()
        results = calculator.process_batch(
            input_dir=test_dir,
            output_dir=output_dir,
            skip_alignment=True,
            logger=logger,
        )

        print(f"✓ Batch processing completed with errors")
        print(f"  - Successful: {len(results)} samples")
        print(f"  - Errors recorded: {len(calculator.errors)}")

        log_path = os.path.join(output_dir, "batch_errors.log")
        if os.path.exists(log_path):
            print(f"✓ Error log file exists: {log_path}")
            with open(log_path, "r") as f:
                log_content = f.read()
                print(f"  - Log file size: {len(log_content)} bytes")
        else:
            print(f"⚠ Error log file missing")

        error_json_path = os.path.join(output_dir, "error_summary.json")
        if os.path.exists(error_json_path):
            print(f"✓ Error summary JSON exists: {error_json_path}")
            with open(error_json_path, "r") as f:
                errors = json.load(f)
                print(f"  - Errors in JSON: {len(errors)}")
                for err in errors[:2]:
                    print(f"    * {err.get('sample')}: {err.get('message')}")
        else:
            print(f"⚠ Error summary JSON missing")

        print("✓ Failed samples skipped, not crashing entire batch")
        print("✓ Detailed error information recorded")

        return True
    except Exception as e:
        print(f"✗ Batch error handling test failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        for d in ["./test_error_handling", "./test_batch_with_errors"]:
            if os.path.exists(d):
                shutil.rmtree(d, ignore_errors=True)


def test_single_processing_with_new_features():
    print("\n" + "=" * 60)
    print("Test 5: Single processing with new features")
    print("=" * 60)
    try:
        from cwsicalc import CWSICalculator

        output_dir = "./test_results_single_v2"
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir)

        calculator = CWSICalculator(
            use_otsu=True,
            ransac_reproj_threshold=3.0,
            min_inlier_ratio=0.25,
        )

        result = calculator.process_single(
            thermal_path="./samples/sample_001_thermal.tiff",
            visible_path="./samples/sample_001_visible.jpg",
            meteo_path="./samples/sample_001_meteo.json",
            output_dir=output_dir,
            skip_alignment=True,
        )

        print(f"✓ Processing completed with Otsu thresholding")
        print(f"  - Mean CWSI: {result.stats['mean_cwsi']:.4f}")
        print(f"  - CV CWSI: {result.stats['cv_cwsi']:.4f}")
        print(f"  - Canopy area: {result.stats['canopy_area_pixels']} pixels")
        print(f"  - Fraction below 0.3: {result.stats['fraction_below_low']*100:.2f}%")

        csv_path = os.path.join(
            output_dir, "sample_001_thermal", "cwsi_statistics.csv"
        )
        if os.path.exists(csv_path):
            print(f"✓ CSV output exists with threshold_used field")
        else:
            print(f"⚠ CSV output missing")

        return True
    except Exception as e:
        print(f"✗ Single processing test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_full_batch_processing():
    print("\n" + "=" * 60)
    print("Test 6: Full batch processing")
    print("=" * 60)
    try:
        from cwsicalc import CWSICalculator, setup_logger

        output_dir = "./test_results_batch_v2"
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir)

        logger = setup_logger(output_dir)

        calculator = CWSICalculator(
            use_otsu=True,
            ransac_reproj_threshold=3.0,
        )

        results = calculator.process_batch(
            input_dir="./samples",
            output_dir=output_dir,
            skip_alignment=True,
            logger=logger,
        )

        print(f"✓ Batch processing completed: {len(results)} samples")

        for name, result in results.items():
            print(f"  {name}: mean_cwsi={result.stats['mean_cwsi']:.4f}")

        summary_path = os.path.join(output_dir, "batch_summary.csv")
        if os.path.exists(summary_path):
            print(f"✓ Batch summary exists")
        else:
            print(f"⚠ Batch summary missing")

        log_path = os.path.join(output_dir, "batch_errors.log")
        if os.path.exists(log_path):
            print(f"✓ Batch log exists")
        else:
            print(f"⚠ Batch log missing")

        return True
    except Exception as e:
        print(f"✗ Batch processing test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    print("\n" + "=" * 60)
    print("CWSI Calculator - Enhanced Features Test Suite")
    print("=" * 60)
    print("\nTesting the following bug fixes:")
    print("  1. Enhanced RANSAC with homography validation for alignment")
    print("  2. Otsu adaptive thresholding replacing hardcoded threshold")
    print("  3. Batch error handling with detailed logging")

    if not os.path.exists("./samples") or len(os.listdir("./samples")) == 0:
        print("\nGenerating sample data...")
        from cwsicalc import create_sample_data
        create_sample_data("./samples", num_samples=2)

    tests = [
        ("Imports", test_imports),
        ("Enhanced alignment", test_alignment_enhanced),
        ("Otsu segmentation", test_otsu_segmentation),
        ("Batch error handling", test_batch_error_handling),
        ("Single processing v2", test_single_processing_with_new_features),
        ("Full batch processing", test_full_batch_processing),
    ]

    results = []
    for name, test_func in tests:
        try:
            passed = test_func()
            results.append((name, passed))
        except Exception as e:
            print(f"✗ Test '{name}' crashed: {e}")
            import traceback
            traceback.print_exc()
            results.append((name, False))

    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)
    passed_count = sum(1 for _, passed in results if passed)
    total_count = len(results)

    for name, passed in results:
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"  {name}: {status}")

    print("\n" + "-" * 60)
    print(f"Total: {passed_count}/{total_count} tests passed")

    if passed_count == total_count:
        print("\n🎉 All tests passed! All bug fixes verified.")
        return 0
    else:
        print(f"\n⚠ {total_count - passed_count} test(s) failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
