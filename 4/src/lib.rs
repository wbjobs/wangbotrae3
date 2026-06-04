pub mod wasm;
pub mod ffmpeg;
pub mod processor;
pub mod cli;
pub mod interpolation;

pub use wasm::StyleTransferEngine;
pub use ffmpeg::{Frame, FrameRate, VideoReader, VideoWriter, OutputFormat};
pub use processor::VideoProcessor;
pub use cli::AppConfig;
pub use interpolation::{StrengthInterpolator, KeyframeConfig, InterpolationType};
