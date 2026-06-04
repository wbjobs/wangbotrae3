use clap::Parser;
use std::path::PathBuf;

use crate::ffmpeg::OutputFormat;
use crate::interpolation::{KeyframeConfig, StrengthInterpolator};

#[derive(Parser, Debug)]
#[command(name = "video-style-transfer")]
#[command(author = "Video Style Transfer Team")]
#[command(version = "0.1.0")]
#[command(about = "Real-time video style transfer using WASM and FFmpeg", long_about = None)]
pub struct Args {
    #[arg(short, long)]
    pub input: PathBuf,
    
    #[arg(short, long)]
    pub style: PathBuf,
    
    #[arg(short, long)]
    pub output: PathBuf,
    
    #[arg(short, long, default_value = "mp4")]
    pub format: String,
    
    #[arg(short, long, default_value_t = 0.7)]
    pub strength: f32,
    
    #[arg(long)]
    pub keyframes: Option<PathBuf>,
    
    #[arg(short, long)]
    pub threads: Option<usize>,
    
    #[arg(long, default_value = "wasm/style_transfer.wasm")]
    pub wasm: String,
    
    #[arg(long, default_value_t = false)]
    pub verbose: bool,
}

#[derive(Debug, Clone)]
pub enum StrengthConfig {
    Fixed(f32),
    Keyframes(KeyframeConfig),
}

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub input_path: String,
    pub style_path: String,
    pub output_path: String,
    pub output_format: OutputFormat,
    pub strength_config: StrengthConfig,
    pub num_threads: Option<usize>,
    pub wasm_path: String,
    pub verbose: bool,
}

impl AppConfig {
    pub fn from_args() -> Result<Self, anyhow::Error> {
        let args = Args::parse();
        
        let output_format = args.format.parse()?;
        
        let strength_config = if let Some(keyframes_path) = args.keyframes {
            let config = KeyframeConfig::from_json_file(&keyframes_path)?;
            StrengthConfig::Keyframes(config)
        } else {
            if !(0.0..=1.0).contains(&args.strength) {
                anyhow::bail!("Style strength must be between 0.0 and 1.0");
            }
            StrengthConfig::Fixed(args.strength)
        };
        
        Ok(Self {
            input_path: args.input.to_string_lossy().to_string(),
            style_path: args.style.to_string_lossy().to_string(),
            output_path: args.output.to_string_lossy().to_string(),
            output_format,
            strength_config,
            num_threads: args.threads,
            wasm_path: args.wasm,
            verbose: args.verbose,
        })
    }
    
    pub fn create_interpolator(&self, total_frames: u64) -> StrengthInterpolator {
        match &self.strength_config {
            StrengthConfig::Fixed(strength) => StrengthInterpolator::from_fixed(*strength, total_frames),
            StrengthConfig::Keyframes(config) => StrengthInterpolator::new(config.clone(), total_frames),
        }
    }
    
    pub fn validate(&self) -> Result<(), anyhow::Error> {
        use std::path::Path;
        
        if !Path::new(&self.input_path).exists() {
            anyhow::bail!("Input file not found: {}", self.input_path);
        }
        
        if !Path::new(&self.style_path).exists() {
            anyhow::bail!("Style image not found: {}", self.style_path);
        }
        
        if !Path::new(&self.wasm_path).exists() {
            anyhow::bail!("WASM module not found: {}\nPlease build it first using: make", self.wasm_path);
        }
        
        Ok(())
    }
}
