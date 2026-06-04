use anyhow::{Context, Result};
use indicatif::{ProgressBar, ProgressStyle};
use rayon::prelude::*;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::ffmpeg::{Frame, FrameRate, VideoReader, VideoWriter};
use crate::interpolation::StrengthInterpolator;
use crate::wasm::{StyleTransferEngine, StyleTransferInstance};

struct FrameWork {
    frame: Frame,
    strength: f32,
    result: Sender<Frame>,
}

pub struct VideoProcessor {
    engine: StyleTransferEngine,
    num_threads: usize,
}

impl VideoProcessor {
    pub fn new(wasm_path: &str, num_threads: Option<usize>) -> Result<Self> {
        let engine = StyleTransferEngine::new(wasm_path)?;
        let num_threads = num_threads.unwrap_or_else(|| num_cpus::get());
        
        Ok(Self {
            engine,
            num_threads,
        })
    }
    
    pub fn process_video(
        &mut self,
        input_path: &str,
        style_image: &[u8],
        style_width: usize,
        style_height: usize,
        output_path: &str,
        output_format: crate::ffmpeg::OutputFormat,
        interpolator: StrengthInterpolator,
    ) -> Result<()> {
        let mut reader = VideoReader::new(input_path)?;
        let frame_rate = reader.frame_rate;
        let width = reader.width;
        let height = reader.height;
        let total_frames = reader.frame_count;
        
        println!("Video info: {}x{}, {}/{} ({:.3}) fps, {} frames", 
            width, height, frame_rate.numerator, frame_rate.denominator, frame_rate.to_f64(), total_frames);
        
        let mut writer = VideoWriter::new(output_path, width, height, frame_rate, output_format)?;
        
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(self.num_threads)
            .build()?;
            
        let (work_tx, work_rx) = channel::<FrameWork>();
        let work_rx = Arc::new(Mutex::new(work_rx));
        
        let instances: Vec<_> = (0..self.num_threads)
            .map(|_| {
                let mut instance = self.engine.create_instance()?;
                instance.init_style(style_image, style_width, style_height)?;
                Ok::<_, anyhow::Error>(instance)
            })
            .collect::<Result<_>>()?;
            
        let instances = Arc::new(Mutex::new(instances));
        
        pool.scope(|s| {
            for _ in 0..self.num_threads {
                let work_rx = Arc::clone(&work_rx);
                let instances = Arc::clone(&instances);
                
                s.spawn(move |_| {
                    while let Ok(work) = {
                        let rx = work_rx.lock().unwrap();
                        rx.recv()
                    } {
                        let mut instances = instances.lock().unwrap();
                        let instance = instances.get_mut(0).unwrap();
                        
                        let mut output_data = vec![0u8; work.frame.data.len()];
                        let _ = instance.transfer_frame(
                            &work.frame.data,
                            &mut output_data,
                            work.frame.width,
                            work.frame.height,
                            work.strength,
                        );
                        
                        let result_frame = Frame {
                            data: output_data,
                            ..work.frame
                        };
                        
                        let _ = work.result.send(result_frame);
                    }
                });
            }
            
            let pb = Self::create_progress_bar(total_frames);
            let start_time = Instant::now();
            
            let mut result_receivers = Vec::new();
            
            for (idx, frame_result) in reader.frames().enumerate() {
                match frame_result {
                    Ok(frame) => {
                        let strength = interpolator.get_strength(frame.index);
                        let (res_tx, res_rx) = channel();
                        result_receivers.push((frame.index, strength, res_rx));
                        
                        if work_tx.send(FrameWork { frame, strength, result: res_tx }).is_err() {
                            break;
                        }
                    }
                    Err(e) => eprintln!("Error reading frame {}: {}", idx, e),
                }
            }
            
            drop(work_tx);
            
            result_receivers.sort_by_key(|(idx, _, _)| *idx);
            
            for (frame_idx, strength, res_rx) in result_receivers {
                match res_rx.recv() {
                    Ok(mut frame) => {
                        frame.index = frame_idx;
                        if let Err(e) = writer.write_frame(&frame) {
                            eprintln!("Error writing frame {}: {}", frame_idx, e);
                        }
                        pb.inc(1);
                        
                        let elapsed = start_time.elapsed();
                        let fps_processed = pb.position() as f64 / elapsed.as_secs_f64();
                        pb.set_message(format!("{:.1} fps | strength: {:.0}%", fps_processed, strength * 100.0));
                    }
                    Err(e) => eprintln!("Error receiving result for frame {}: {}", frame_idx, e),
                }
            }
            
            pb.finish_with_message("Done!");
        });
        
        writer.finish()?;
        
        Ok(())
    }
    
    fn create_progress_bar(total: u64) -> ProgressBar {
        let pb = ProgressBar::new(total);
        pb.set_style(
            ProgressStyle::default_bar()
                .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({percent}%) | ETA: {eta} | {msg}")
                .unwrap()
                .progress_chars("#>-"),
        );
        pb
    }
    
    pub fn process_frames_parallel(
        &mut self,
        frames: Vec<Frame>,
        style_image: &[u8],
        style_width: usize,
        style_height: usize,
        interpolator: &StrengthInterpolator,
    ) -> Result<Vec<Frame>> {
        let mut instance = self.engine.create_instance()?;
        instance.init_style(style_image, style_width, style_height)?;
        
        let instance = Arc::new(Mutex::new(instance));
        
        let results: Vec<Frame> = frames
            .into_par_iter()
            .map(|frame| {
                let strength = interpolator.get_strength(frame.index);
                let mut output_data = vec![0u8; frame.data.len()];
                {
                    let mut inst = instance.lock().unwrap();
                    let _ = inst.transfer_frame(
                        &frame.data,
                        &mut output_data,
                        frame.width,
                        frame.height,
                        strength,
                    );
                }
                
                Frame {
                    data: output_data,
                    ..frame
                }
            })
            .collect();
            
        Ok(results)
    }
}
