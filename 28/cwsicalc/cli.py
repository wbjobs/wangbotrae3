import os
import click
from . import __version__


@click.group()
@click.version_option(__version__, prog_name="cwsicalc")
def cli():
    """CWSI Calculator - Plant Water Stress Index from thermal and visible images."""
    pass


@cli.command()
@click.option("--thermal", "-t", required=True, type=click.Path(exists=True),
              help="Path to thermal infrared TIFF image")
@click.option("--visible", "-v", required=True, type=click.Path(exists=True),
              help="Path to visible RGB JPG image")
@click.option("--meteo", "-m", required=True, type=click.Path(exists=True),
              help="Path to meteorological parameters JSON file")
@click.option("--output-dir", "-o", required=True, type=click.Path(),
              help="Output directory for results")
@click.option("--sample-name", "-s", default=None,
              help="Sample name for output files (default: thermal filename)")
@click.option("--method", default="SIFT", type=click.Choice(["SIFT", "ORB"]),
              help="Feature matching method for image alignment (default: SIFT)")
@click.option("--green-threshold", default=None, type=float,
              help="Manual green threshold for segmentation (default: None, use Otsu)")
@click.option("--use-otsu/--no-otsu", default=True,
              help="Use Otsu adaptive thresholding (default: True)")
@click.option("--otsu-bias", default=0.0, type=float,
              help="Bias added to Otsu threshold (default: 0.0)")
@click.option("--use-excess-green/--no-excess-green", default=True,
              help="Use excess green index (2G-R-B) for segmentation (default: True)")
@click.option("--low-stress-threshold", default=0.3, type=float,
              help="CWSI threshold for low stress (default: 0.3)")
@click.option("--medium-stress-threshold", default=0.6, type=float,
              help="CWSI threshold for medium stress (default: 0.6)")
@click.option("--ransac-threshold", default=3.0, type=float,
              help="RANSAC reprojection threshold in pixels (default: 3.0)")
@click.option("--min-inlier-ratio", default=0.25, type=float,
              help="Minimum RANSAC inlier ratio (default: 0.25)")
@click.option("--composite/--no-composite", default=True,
              help="Generate composite comparison image (default: True)")
@click.option("--save-mask/--no-save-mask", default=True,
              help="Save canopy segmentation mask (default: True)")
@click.option("--save-numpy/--no-save-numpy", default=False,
              help="Save CWSI map as numpy array (default: False)")
@click.option("--skip-alignment/--no-skip-alignment", default=False,
              help="Skip feature-based alignment and just resize (default: False)")
def single(
    thermal,
    visible,
    meteo,
    output_dir,
    sample_name,
    method,
    green_threshold,
    use_otsu,
    otsu_bias,
    use_excess_green,
    low_stress_threshold,
    medium_stress_threshold,
    ransac_threshold,
    min_inlier_ratio,
    composite,
    save_mask,
    save_numpy,
    skip_alignment,
):
    """Process a single pair of thermal and visible images."""
    from .cwsicalc import CWSICalculator

    os.makedirs(output_dir, exist_ok=True)

    calculator = CWSICalculator(
        alignment_method=method,
        green_threshold=green_threshold,
        use_otsu=use_otsu,
        otsu_bias=otsu_bias,
        use_excess_green=use_excess_green,
        low_stress_threshold=low_stress_threshold,
        medium_stress_threshold=medium_stress_threshold,
        ransac_reproj_threshold=ransac_threshold,
        min_inlier_ratio=min_inlier_ratio,
    )

    click.echo(f"Processing: {os.path.basename(thermal)}")
    click.echo(f"  Thermal: {thermal}")
    click.echo(f"  Visible: {visible}")
    click.echo(f"  Meteo: {meteo}")
    click.echo(f"  Output: {output_dir}")
    if use_otsu and green_threshold is None:
        click.echo(f"  Segmentation: Otsu adaptive thresholding")
    else:
        click.echo(f"  Segmentation: Fixed threshold = {green_threshold}")
    click.echo("")

    result = calculator.process_single(
        thermal_path=thermal,
        visible_path=visible,
        meteo_path=meteo,
        output_dir=output_dir,
        sample_name=sample_name,
        save_composite=composite,
        save_mask=save_mask,
        save_numpy=save_numpy,
        skip_alignment=skip_alignment,
    )

    click.echo("\n=== Results ===")
    click.echo(f"  Sample: {sample_name or os.path.basename(thermal)}")
    click.echo(f"  Tdry: {result.Tdry:.2f}°C")
    click.echo(f"  Twet: {result.Twet:.2f}°C")
    click.echo(f"  Mean Canopy Temp: {result.mean_temp:.2f}°C")
    click.echo(f"  Mean CWSI: {result.stats['mean_cwsi']:.4f}")
    click.echo(f"  CV CWSI: {result.stats['cv_cwsi']:.4f}")
    click.echo(f"  Canopy Area: {result.stats['canopy_area_pixels']} pixels")
    click.echo(f"  Area below 0.3: {result.stats['fraction_below_low']*100:.2f}%")
    click.echo("")
    click.echo(f"Output files saved to: {output_dir}")


@cli.command()
@click.option("--input-dir", "-i", required=True, type=click.Path(exists=True, file_okay=False),
              help="Input directory containing image files")
@click.option("--output-dir", "-o", required=True, type=click.Path(),
              help="Output directory for results")
@click.option("--thermal-pattern", default="*_thermal.tif*",
              help="Glob pattern for thermal images (default: *_thermal.tif*)")
@click.option("--visible-pattern", default="*_visible.jpg",
              help="Glob pattern for visible images (default: *_visible.jpg)")
@click.option("--meteo-pattern", default="*_meteo.json",
              help="Glob pattern for meteo JSON files (default: *_meteo.json)")
@click.option("--method", default="SIFT", type=click.Choice(["SIFT", "ORB"]),
              help="Feature matching method for image alignment (default: SIFT)")
@click.option("--green-threshold", default=None, type=float,
              help="Manual green threshold for segmentation (default: None, use Otsu)")
@click.option("--use-otsu/--no-otsu", default=True,
              help="Use Otsu adaptive thresholding (default: True)")
@click.option("--otsu-bias", default=0.0, type=float,
              help="Bias added to Otsu threshold (default: 0.0)")
@click.option("--use-excess-green/--no-excess-green", default=True,
              help="Use excess green index for segmentation (default: True)")
@click.option("--ransac-threshold", default=3.0, type=float,
              help="RANSAC reprojection threshold in pixels (default: 3.0)")
@click.option("--min-inlier-ratio", default=0.25, type=float,
              help="Minimum RANSAC inlier ratio (default: 0.25)")
@click.option("--composite/--no-composite", default=True,
              help="Generate composite comparison images (default: True)")
@click.option("--save-mask/--no-save-mask", default=True,
              help="Save canopy segmentation masks (default: True)")
@click.option("--save-numpy/--no-save-numpy", default=False,
              help="Save CWSI maps as numpy arrays (default: False)")
@click.option("--skip-alignment/--no-skip-alignment", default=False,
              help="Skip feature-based alignment and just resize (default: False)")
def batch(
    input_dir,
    output_dir,
    thermal_pattern,
    visible_pattern,
    meteo_pattern,
    method,
    green_threshold,
    use_otsu,
    otsu_bias,
    use_excess_green,
    ransac_threshold,
    min_inlier_ratio,
    composite,
    save_mask,
    save_numpy,
    skip_alignment,
):
    """Process a batch of images from an input directory."""
    from .cwsicalc import CWSICalculator, setup_logger

    os.makedirs(output_dir, exist_ok=True)

    logger = setup_logger(output_dir)

    calculator = CWSICalculator(
        alignment_method=method,
        green_threshold=green_threshold,
        use_otsu=use_otsu,
        otsu_bias=otsu_bias,
        use_excess_green=use_excess_green,
        ransac_reproj_threshold=ransac_threshold,
        min_inlier_ratio=min_inlier_ratio,
    )

    click.echo(f"Batch processing mode")
    click.echo(f"  Input directory: {input_dir}")
    click.echo(f"  Output directory: {output_dir}")
    click.echo(f"  Thermal pattern: {thermal_pattern}")
    click.echo(f"  Visible pattern: {visible_pattern}")
    click.echo(f"  Meteo pattern: {meteo_pattern}")
    if use_otsu and green_threshold is None:
        click.echo(f"  Segmentation: Otsu adaptive thresholding")
    else:
        click.echo(f"  Segmentation: Fixed threshold = {green_threshold}")
    click.echo("")

    results = calculator.process_batch(
        input_dir=input_dir,
        output_dir=output_dir,
        thermal_pattern=thermal_pattern,
        visible_pattern=visible_pattern,
        meteo_pattern=meteo_pattern,
        logger=logger,
        save_composite=composite,
        save_mask=save_mask,
        save_numpy=save_numpy,
        skip_alignment=skip_alignment,
    )

    click.echo(f"\nBatch log saved to: {os.path.join(output_dir, 'batch_errors.log')}")
    click.echo(f"Batch summary saved to: {os.path.join(output_dir, 'batch_summary.csv')}")
    click.echo(f"Successfully processed {len(results)} samples.")


@cli.command()
@click.option("--num-samples", "-n", default=3, type=int,
              help="Number of sample pairs to generate (default: 3)")
def example(num_samples):
    """Generate example input files in ./samples/ directory."""
    from .sample_data import create_sample_data

    sample_dir = "./samples"
    os.makedirs(sample_dir, exist_ok=True)

    click.echo(f"Generating {num_samples} sample pairs in: {sample_dir}")
    files = create_sample_data(sample_dir, num_samples=num_samples)

    click.echo("\nGenerated files:")
    for f in files:
        click.echo(f"  - {os.path.basename(f)}")

    click.echo("\nTo run batch processing:")
    click.echo(f"  cwsicalc batch --input_dir {sample_dir} --output_dir ./results/")


@cli.command()
@click.option("--num-days", "-n", default=7, type=int,
              help="Number of days of data to generate (default: 7)")
@click.option("--start-date", default="20260601",
              help="Start date in YYYYMMDD format (default: 20260601)")
@click.option("--output-dir", default="./timeseries_samples",
              help="Output directory for time-series samples")
@click.option("--stress-trend", default=0.05, type=float,
              help="Daily CWSI increase trend (default: 0.05)")
@click.option("--include-missing/--no-missing", default=True,
              help="Include a day with missing data (default: True)")
def example_timeseries(num_days, start_date, output_dir, stress_trend, include_missing):
    """Generate time-series example data in ./timeseries_samples/ directory."""
    from .sample_data import create_timeseries_data

    os.makedirs(output_dir, exist_ok=True)

    click.echo(f"Generating {num_days} days of time-series data in: {output_dir}")
    click.echo(f"Start date: {start_date}")
    click.echo(f"Stress trend: +{stress_trend} CWSI/day")
    click.echo(f"Include missing data: {include_missing}")
    click.echo("")

    files = create_timeseries_data(
        output_dir=output_dir,
        num_days=num_days,
        start_date=start_date,
        include_missing=include_missing,
        stress_trend=stress_trend,
    )

    click.echo("\nGenerated files:")
    for f in sorted(files):
        click.echo(f"  - {os.path.basename(f)}")

    click.echo("\nTo run time-series analysis:")
    click.echo(f"  cwsicalc timeseries -i {output_dir} -o ./timeseries_results/")


@cli.command()
@click.option("--input-dir", "-i", required=True, type=click.Path(exists=True, file_okay=False),
              help="Input directory containing time-series images (YYYYMMDD_HHMM_* format)")
@click.option("--output-dir", "-o", required=True, type=click.Path(),
              help="Output directory for results")
@click.option("--db-path", default=None, type=click.Path(),
              help="Path to SQLite cache database (default: output_dir/cwsicalc_cache.db)")
@click.option("--thermal-pattern", default="*_thermal.tif*",
              help="Glob pattern for thermal images (default: *_thermal.tif*)")
@click.option("--visible-pattern", default="*_rgb.jpg",
              help="Glob pattern for visible images (default: *_rgb.jpg)")
@click.option("--meteo-pattern", default="*_meteo.json",
              help="Glob pattern for meteo JSON files (default: *_meteo.json)")
@click.option("--method", default="SIFT", type=click.Choice(["SIFT", "ORB"]),
              help="Feature matching method for image alignment (default: SIFT)")
@click.option("--green-threshold", default=None, type=float,
              help="Manual green threshold for segmentation (default: None, use Otsu)")
@click.option("--use-otsu/--no-otsu", default=True,
              help="Use Otsu adaptive thresholding (default: True)")
@click.option("--otsu-bias", default=0.0, type=float,
              help="Bias added to Otsu threshold (default: 0.0)")
@click.option("--use-excess-green/--no-excess-green", default=True,
              help="Use excess green index for segmentation (default: True)")
@click.option("--ransac-threshold", default=3.0, type=float,
              help="RANSAC reprojection threshold in pixels (default: 3.0)")
@click.option("--min-inlier-ratio", default=0.25, type=float,
              help="Minimum RANSAC inlier ratio (default: 0.25)")
@click.option("--use-cache/--no-use-cache", default=True,
              help="Use SQLite cache to avoid recomputation (default: True)")
@click.option("--composite/--no-composite", default=True,
              help="Generate composite images for each time point (default: True)")
@click.option("--save-mask/--no-save-mask", default=True,
              help="Save canopy segmentation masks (default: True)")
@click.option("--save-numpy/--no-save-numpy", default=False,
              help="Save CWSI maps as numpy arrays (default: False)")
@click.option("--skip-alignment/--no-skip-alignment", default=False,
              help="Skip feature-based alignment and just resize (default: False)")
@click.option("--prediction-days", default=3, type=int,
              help="Number of days to predict ahead (default: 3)")
@click.option("--confidence-level", default=0.95, type=float,
              help="Confidence level for prediction interval (default: 0.95)")
@click.option("--dpi", default=150, type=int,
              help="DPI for output plots (default: 150)")
def timeseries(
    input_dir,
    output_dir,
    db_path,
    thermal_pattern,
    visible_pattern,
    meteo_pattern,
    method,
    green_threshold,
    use_otsu,
    otsu_bias,
    use_excess_green,
    ransac_threshold,
    min_inlier_ratio,
    use_cache,
    composite,
    save_mask,
    save_numpy,
    skip_alignment,
    prediction_days,
    confidence_level,
    dpi,
):
    """Time series analysis with trend prediction.

    Input files should be named as YYYYMMDD_HHMM_thermal.tif, YYYYMMDD_HHMM_rgb.jpg, etc.
    """
    from .timeseries import TimeSeriesAnalyzer
    from .timeseries_viz import TimeSeriesVisualizer
    from .cwsicalc import setup_logger

    os.makedirs(output_dir, exist_ok=True)

    logger = setup_logger(output_dir, "timeseries.log")

    click.echo("=" * 60)
    click.echo("CWSI Time Series Analysis & Trend Prediction")
    click.echo("=" * 60)
    click.echo(f"Input directory: {input_dir}")
    click.echo(f"Output directory: {output_dir}")
    cache_db = db_path or os.path.join(output_dir, "cwsicalc_cache.db")
    click.echo(f"Database cache: Enabled -> {cache_db}")
    click.echo(f"Prediction days: {prediction_days}")
    click.echo(f"Confidence level: {confidence_level*100:.0f}%")
    if use_otsu and green_threshold is None:
        click.echo(f"Segmentation: Otsu adaptive thresholding")
    else:
        click.echo(f"Segmentation: Fixed threshold = {green_threshold}")
    click.echo("=" * 60)
    click.echo("")

    analyzer = TimeSeriesAnalyzer(
        input_dir=input_dir,
        output_dir=output_dir,
        db_path=db_path,
        thermal_pattern=thermal_pattern,
        visible_pattern=visible_pattern,
        meteo_pattern=meteo_pattern,
        use_cache=use_cache,
        alignment_method=method,
        green_threshold=green_threshold,
        use_otsu=use_otsu,
        otsu_bias=otsu_bias,
        use_excess_green=use_excess_green,
        ransac_reproj_threshold=ransac_threshold,
        min_inlier_ratio=min_inlier_ratio,
    )

    click.echo("Scanning for time-stamped files...")
    points = analyzer.scan_files()
    click.echo(f"Found {len(points)} time points:")
    for pt in points:
        status = "✓" if pt.is_complete else "✗"
        click.echo(f"  {status} {pt.timestamp.strftime('%Y-%m-%d %H:%M')}")
        if not pt.is_complete:
            missing = []
            if not pt.has_thermal: missing.append("thermal")
            if not pt.has_visible: missing.append("visible")
            if not pt.has_meteo: missing.append("meteo")
            click.echo(f"    Missing: {', '.join(missing)}")
    click.echo("")

    click.echo("Processing time series...")
    analyzer.process_timeseries(
        logger=logger,
        skip_alignment=skip_alignment,
        save_composite=composite,
        save_mask=save_mask,
        save_numpy=save_numpy,
    )

    timestamps, cwsi_values, _ = analyzer.get_valid_timeseries()
    click.echo(f"\nValid data points: {len(timestamps)}/{len(points)}")

    if len(timestamps) == 0:
        click.echo("\n⚠ No valid data points. Cannot generate plots.")
        return

    prediction = analyzer.predict_trend(
        days_ahead=prediction_days,
        confidence_level=confidence_level,
    )

    click.echo("\nGenerating visualizations...")
    visualizer = TimeSeriesVisualizer(output_dir)
    plot_files = visualizer.generate_all_plots(
        analyzer,
        skip_prediction=(prediction is None),
        dpi=dpi,
    )

    click.echo("\nGenerated plots:")
    for plot_name, plot_path in plot_files.items():
        click.echo(f"  ✓ {plot_name}: {os.path.basename(plot_path)}")

    click.echo("\nSaving report...")
    report_path = analyzer.save_report()
    click.echo(f"  ✓ Report: {os.path.basename(report_path)}")

    if prediction:
        click.echo("\n" + "=" * 60)
        click.echo("Prediction Results")
        click.echo("=" * 60)
        click.echo(f"Linear Regression: y = {prediction.slope:+.4f}x + {prediction.intercept:.4f}")
        click.echo(f"R² = {prediction.r_squared:.4f}, P-value = {prediction.p_value:.4e}")
        trend_dir = "↑ Increasing" if prediction.slope > 0 else "↓ Decreasing" if prediction.slope < 0 else "→ Stable"
        click.echo(f"Trend direction: {trend_dir}")
        click.echo("")
        click.echo(f"Predictions for the next {prediction_days} days ({confidence_level*100:.0f}% CI):")
        for i, (date, pred, lo, hi) in enumerate(zip(
            prediction.future_dates,
            prediction.predicted_cwsi,
            prediction.prediction_ci_lower,
            prediction.prediction_ci_upper,
        )):
            stress = "No Stress" if pred < 0.3 else "Mod. Stress" if pred < 0.6 else "Severe"
            click.echo(f"  D+{i+1} {date.strftime('%Y-%m-%d')}: CWSI = {pred:.4f} [{lo:.3f}, {hi:.3f}] → {stress}")

    db_stats = analyzer.db.get_stats()
    click.echo("\n" + "=" * 60)
    click.echo("Database Cache Statistics")
    click.echo("=" * 60)
    click.echo(f"Total entries: {db_stats['total_entries']}")
    click.echo(f"Successful: {db_stats['successful_entries']}")
    click.echo(f"Failed: {db_stats['failed_entries']}")
    if db_stats['earliest_timestamp']:
        click.echo(f"Time range: {db_stats['earliest_timestamp']} to {db_stats['latest_timestamp']}")

    click.echo("\n" + "=" * 60)
    click.echo("✓ Time series analysis complete!")
    click.echo("=" * 60)
    click.echo(f"All outputs saved to: {output_dir}")


if __name__ == "__main__":
    cli()
