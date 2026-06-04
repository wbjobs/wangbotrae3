use anyhow::Result;
use std::time::Instant;

mod cli;
mod ffmpeg;
mod interpolation;
mod processor;
mod wasm;

use cli::{AppConfig, StrengthConfig};
use ffmpeg::load_image;
use processor::VideoProcessor;

fn main() -> Result<()> {
    let config = AppConfig::from_args()?;
    config.validate()?;
    
    if config.verbose {
        println!("Configuration:");
        println!("  Input: {}", config.input_path);
        println!("  Style: {}", config.style_path);
        println!("  Output: {}", config.output_path);
        println!("  Format: {:?}", config.output_format);
        
        match &config.strength_config {
            StrengthConfig::Fixed(s) => println!("  Strength: {:.0}%", s * 100.0),
            StrengthConfig::Keyframes(kf) => {
                println!("  Keyframes: {} points", kf.keyframes.len());
                println!("  Interpolation: {:?}", kf.interpolation);
                for k in &kf.keyframes {
                    println!("    - Frame {}: {:.0}%", k.frame, k.strength * 100.0);
                }
            }
        }
        
        println!("  Threads: {:?}", config.num_threads);
        println!("  WASM: {}", config.wasm_path);
        println!();
    }
    
    println!("Loading style image...");
    let (style_data, style_width, style_height) = load_image(&config.style_path)?;
    println!("Style image loaded: {}x{}", style_width, style_height);
    
    println!("\nInitializing style transfer engine...");
    let mut processor = VideoProcessor::new(
        &config.wasm_path,
        config.num_threads,
    )?;
    println!("Engine initialized with {} threads", processor.num_threads);
    
    println!("\nReading video info...");
    let reader = ffmpeg::VideoReader::new(&config.input_path)?;
    let total_frames = reader.frame_count;
    println!("Total frames: {}", total_frames);
    
    let interpolator = config.create_interpolator(total_frames);
    
    println!("\nStarting video processing...");
    let start_time = Instant::now();
    
    processor.process_video(
        &config.input_path,
        &style_data,
        style_width,
        style_height,
        &config.output_path,
        config.output_format,
        interpolator,
    )?;
    
    let elapsed = start_time.elapsed();
    println!("\nProcessing complete!");
    println!("Total time: {:.2?}", elapsed);
    println!("Output saved to: {}", config.output_path);
    
    Ok(())
}
