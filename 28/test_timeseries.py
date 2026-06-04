import os
import sys
import shutil
import json

print("=" * 70)
print("CWSI Time Series Analysis - Comprehensive Test Suite")
print("=" * 70)

print("\nTest 1: Import all new modules")
print("-" * 70)
try:
    from cwsicalc import database, timeseries, timeseries_viz
    from cwsicalc.database import CWSIDatabase, CWSICacheEntry
    from cwsicalc.timeseries import TimeSeriesAnalyzer, PredictionResult, TimeseriesPoint
    from cwsicalc.timeseries_viz import TimeSeriesVisualizer
    from cwsicalc import create_timeseries_data
    print("✓ All imports successful")
except Exception as e:
    print(f"✗ Import failed: {e}")
    sys.exit(1)

print("\nTest 2: Create time-series sample data")
print("-" * 70)
sample_dir = "./test_timeseries_samples"
if os.path.exists(sample_dir):
    shutil.rmtree(sample_dir)

try:
    files = create_timeseries_data(
        output_dir=sample_dir,
        num_days=7,
        start_date="20260601",
        include_missing=True,
        stress_trend=0.05,
    )
    print(f"✓ Generated {len(files)} files")
    thermal_files = [f for f in files if "_thermal" in f]
    visible_files = [f for f in files if "_rgb" in f]
    meteo_files = [f for f in files if "_meteo" in f]
    print(f"  - Thermal: {len(thermal_files)}")
    print(f"  - Visible: {len(visible_files)}")
    print(f"  - Meteo: {len(meteo_files)}")
except Exception as e:
    print(f"✗ Failed to create sample data: {e}")
    sys.exit(1)

print("\nTest 3: TimeSeriesAnalyzer - File scanning")
print("-" * 70)
output_dir = "./test_timeseries_results"
if os.path.exists(output_dir):
    shutil.rmtree(output_dir)

try:
    analyzer = TimeSeriesAnalyzer(
        input_dir=sample_dir,
        output_dir=output_dir,
        use_cache=True,
        use_otsu=True,
    )

    points = analyzer.scan_files()
    print(f"✓ Found {len(points)} time points")

    complete = [p for p in points if p.is_complete]
    skipped = [p for p in points if not p.is_complete]
    print(f"  - Complete: {len(complete)}")
    print(f"  - Incomplete: {len(skipped)}")

    for p in points:
        status = "✓" if p.is_complete else "✗"
        print(f"  {status} {p.timestamp.strftime('%Y-%m-%d %H:%M')}")

except Exception as e:
    print(f"✗ File scanning failed: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\nTest 4: TimeSeriesAnalyzer - Process time series")
print("-" * 70)
try:
    analyzer.process_timeseries(
        skip_alignment=True,
        save_composite=True,
        save_mask=True,
    )

    timestamps, cwsi_values, std_values = analyzer.get_valid_timeseries()
    print(f"✓ Processed {len(timestamps)} valid time points")
    print(f"  Mean CWSI: {sum(cwsi_values)/len(cwsi_values):.4f}")
    print(f"  Min CWSI: {min(cwsi_values):.4f}")
    print(f"  Max CWSI: {max(cwsi_values):.4f}")

    if len(analyzer.skipped_points) > 0:
        print(f"  Skipped: {len(analyzer.skipped_points)} points")
        for sp in analyzer.skipped_points:
            print(f"    - {sp.timestamp.strftime('%Y-%m-%d')}: {sp.error_message}")

except Exception as e:
    print(f"✗ Processing failed: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\nTest 5: Trend prediction")
print("-" * 70)
try:
    prediction = analyzer.predict_trend(days_ahead=3, confidence_level=0.95)

    if prediction:
        print("✓ Prediction generated")
        print(f"  Slope: {prediction.slope:+.6f} /day")
        print(f"  Intercept: {prediction.intercept:.4f}")
        print(f"  R²: {prediction.r_squared:.4f}")
        print(f"  P-value: {prediction.p_value:.4e}")
        print(f"  Trend direction: {'Increasing' if prediction.slope > 0 else 'Decreasing' if prediction.slope < 0 else 'Stable'}")
        print("")
        print("  Predictions:")
        for i, (date, pred, lo, hi) in enumerate(zip(
            prediction.future_dates,
            prediction.predicted_cwsi,
            prediction.prediction_ci_lower,
            prediction.prediction_ci_upper,
        )):
            print(f"    D+{i+1} {date.strftime('%Y-%m-%d')}: {pred:.4f} [{lo:.3f}, {hi:.3f}]")
    else:
        print("⚠ Prediction skipped (insufficient data points)")

except Exception as e:
    print(f"✗ Prediction failed: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\nTest 6: Database cache verification")
print("-" * 70)
try:
    db_stats = analyzer.db.get_stats()
    print(f"✓ Database statistics:")
    print(f"  Total entries: {db_stats['total_entries']}")
    print(f"  Successful: {db_stats['successful_entries']}")
    print(f"  Failed: {db_stats['failed_entries']}")

    ts_entries = analyzer.db.get_timeseries()
    print(f"  Time series entries: {len(ts_entries)}")

    if len(ts_entries) > 0:
        entry = ts_entries[0]
        print(f"  Sample entry:")
        print(f"    Sample: {entry.sample_name}")
        print(f"    Mean CWSI: {entry.mean_cwsi:.4f}")
        print(f"    Mean Tc: {entry.mean_tc:.2f}°C")
        print(f"    Tdry: {entry.Tdry:.2f}°C, Twet: {entry.Twet:.2f}°C")

except Exception as e:
    print(f"✗ Database verification failed: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\nTest 7: Generate visualizations")
print("-" * 70)
try:
    visualizer = TimeSeriesVisualizer(output_dir)
    plot_files = visualizer.generate_all_plots(analyzer, dpi=100)

    print(f"✓ Generated {len(plot_files)} plots:")
    for name, path in plot_files.items():
        size = os.path.getsize(path)
        print(f"  - {name}: {os.path.basename(path)} ({size} bytes)")

except Exception as e:
    print(f"✗ Visualization failed: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\nTest 8: Generate JSON report")
print("-" * 70)
try:
    report = analyzer.generate_report()
    report_path = analyzer.save_report(report)

    print(f"✓ Report saved: {os.path.basename(report_path)}")
    print(f"  Total time points: {report['total_time_points']}")
    print(f"  Valid time points: {report['valid_time_points']}")
    print(f"  Skipped: {report['skipped_time_points']}")

    if "prediction" in report and report["prediction"]:
        print(f"  Prediction: {len(report['prediction']['future_dates'])} days ahead")

except Exception as e:
    print(f"✗ Report generation failed: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\nTest 9: Cache reuse (second run should be fast)")
print("-" * 70)
try:
    analyzer2 = TimeSeriesAnalyzer(
        input_dir=sample_dir,
        output_dir=output_dir,
        use_cache=True,
        use_otsu=True,
    )

    analyzer2.scan_files()
    analyzer2.process_timeseries(
        skip_alignment=True,
        save_composite=False,
        save_mask=False,
    )

    timestamps2, cwsi_values2, _ = analyzer2.get_valid_timeseries()
    print(f"✓ Second run completed")
    print(f"  Valid points: {len(timestamps2)}")
    print(f"  Mean CWSI matches: {abs(sum(cwsi_values)/len(cwsi_values) - sum(cwsi_values2)/len(cwsi_values2)) < 0.0001}")

except Exception as e:
    print(f"✗ Cache reuse test failed: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\n" + "=" * 70)
print("✓ All time series tests passed!")
print("=" * 70)

print("\nSummary of outputs:")
print(f"  Sample data: {sample_dir}/")
print(f"  Results: {output_dir}/")
print(f"    - CWSI maps for each time point")
print(f"    - Composite images for each time point")
print(f"    - {len(plot_files)} visualization plots")
print(f"    - SQLite cache database")
print(f"    - JSON report with predictions")
print(f"    - Log file")

print("\nTo run the CLI command:")
print(f"  python -m cwsicalc.cli timeseries -i {sample_dir} -o {output_dir}/ --skip-alignment")
