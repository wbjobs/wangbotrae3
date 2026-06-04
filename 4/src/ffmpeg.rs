use anyhow::{Context, Result};
use ffmpeg_next as ffmpeg;
use ffmpeg_next::codec::encoder::Video as VideoEncoder;
use ffmpeg_next::codec::decoder::Video as VideoDecoder;
use ffmpeg_next::format::{input, output, Pixel};
use ffmpeg_next::frame::Video;
use ffmpeg_next::software::scaling::{context::Context, flag::Flags};
use ffmpeg_next::Rational;
use std::path::Path;

#[derive(Clone)]
pub struct Frame {
    pub data: Vec<u8>,
    pub width: usize,
    pub height: usize,
    pub index: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct FrameRate {
    pub numerator: i32,
    pub denominator: i32,
}

impl FrameRate {
    pub fn new(num: i32, den: i32) -> Self {
        Self {
            numerator: num,
            denominator: den,
        }
    }
    
    pub fn to_f64(&self) -> f64 {
        self.numerator as f64 / self.denominator as f64
    }
    
    pub fn to_rational(&self) -> Rational {
        Rational::new(self.numerator, self.denominator)
    }
}

impl From<Rational> for FrameRate {
    fn from(r: Rational) -> Self {
        Self::new(r.0, r.1)
    }
}

pub struct VideoReader {
    ictx: ffmpeg::format::context::Input,
    decoder: VideoDecoder,
    scaler: Context,
    stream_index: usize,
    pub width: usize,
    pub height: usize,
    pub frame_count: u64,
    pub frame_rate: FrameRate,
    pub time_base: Rational,
}

impl VideoReader {
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self> {
        ffmpeg::init().context("Failed to initialize FFmpeg")?;
        
        let ictx = input(&path)
            .with_context(|| format!("Failed to open input file: {:?}", path.as_ref()))?;
            
        let input_stream = ictx
            .streams()
            .best(ffmpeg::media::Type::Video)
            .context("No video stream found")?;
            
        let stream_index = input_stream.index();
        let time_base = input_stream.time_base();
        let decoder = input_stream
            .decoder()
            .context("Failed to get decoder")?
            .video()
            .context("Failed to get video decoder")?;
            
        let width = decoder.width() as usize;
        let height = decoder.height() as usize;
        
        let scaler = Context::get(
            decoder.format(),
            decoder.width(),
            decoder.height(),
            Pixel::RGB24,
            decoder.width(),
            decoder.height(),
            Flags::BILINEAR | Flags::FAST_BILINEAR,
        ).context("Failed to create scaler")?;
        
        let frame_count = input_stream.frames();
        let frame_rate = FrameRate::from(input_stream.rate());
        
        Ok(Self {
            ictx,
            decoder,
            scaler,
            stream_index,
            width,
            height,
            frame_count,
            frame_rate,
            time_base,
        })
    }
    
    pub fn frames(&mut self) -> impl Iterator<Item = Result<Frame>> + '_ {
        let mut frame_idx = 0u64;
        let mut decoded_frame = Video::empty();
        
        self.ictx.packets()
            .filter(move |(stream, _)| stream.index() == self.stream_index)
            .flat_map(move |(_, packet)| {
                match self.decoder.send_packet(&packet) {
                    Ok(_) => {},
                    Err(e) => return vec![Err(anyhow::anyhow!("Failed to send packet: {}", e))],
                }
                
                let mut frames = Vec::new();
                while let Ok(_) = self.decoder.receive_frame(&mut decoded_frame) {
                    let mut rgb_frame = Video::empty();
                    match self.scaler.run(&decoded_frame, &mut rgb_frame) {
                        Ok(_) => {
                            let data = rgb_frame.data(0).to_vec();
                            frames.push(Ok(Frame {
                                data,
                                width: self.width,
                                height: self.height,
                                index: frame_idx,
                            }));
                            frame_idx += 1;
                        },
                        Err(e) => frames.push(Err(anyhow::anyhow!("Failed to scale frame: {}", e))),
                    }
                }
                frames
            })
    }
}

pub struct VideoWriter {
    octx: ffmpeg::format::context::Output,
    encoder: VideoEncoder,
    stream_index: usize,
    scaler: Context,
    pub width: usize,
    pub height: usize,
    frame_rate: FrameRate,
    time_base: Rational,
    frame_count: u64,
}

impl VideoWriter {
    pub fn new<P: AsRef<Path>>(
        path: P, 
        width: usize, 
        height: usize, 
        frame_rate: FrameRate, 
        format: OutputFormat
    ) -> Result<Self> {
        ffmpeg::init().context("Failed to initialize FFmpeg")?;
        
        let mut octx = output(&path)
            .with_context(|| format!("Failed to create output file: {:?}", path.as_ref()))?;
            
        let format_name = match format {
            OutputFormat::Mp4 => "mp4",
            OutputFormat::Gif => "gif",
        };
        
        let global_header = octx.format().flags().contains(ffmpeg::format::flag::Flags::GLOBAL_HEADER);
        
        let mut output_stream = octx.add_stream()?;
        let codec = ffmpeg::encoder::find(format_name)
            .or_else(|| ffmpeg::encoder::find_by_name("libx264"))
            .context("Failed to find encoder")?;
            
        let mut encoder = output_stream
            .codec()
            .encoder()
            .video()
            .context("Failed to create video encoder")?;
            
        encoder.set_width(width as u32);
        encoder.set_height(height as u32);
        encoder.set_format(match format {
            OutputFormat::Mp4 => Pixel::YUV420P,
            OutputFormat::Gif => Pixel::RGB8,
        });
        
        let time_base = Rational::new(frame_rate.denominator, frame_rate.numerator);
        encoder.set_time_base(time_base);
        encoder.set_frame_rate(Some(frame_rate.to_rational()));
        
        if global_header {
            encoder.set_flags(ffmpeg::codec::flag::Flags::GLOBAL_HEADER);
        }
        
        match format {
            OutputFormat::Mp4 => {
                encoder.set_bit_rate(5_000_000);
                encoder.set_max_b_frames(2);
            },
            OutputFormat::Gif => {
                encoder.set_bit_rate(1_000_000);
            },
        }
        
        let encoder = encoder
            .open_with(codec)
            .context("Failed to open encoder")?
            .video()
            .context("Failed to get video encoder")?;
            
        output_stream.set_parameters(&encoder);
        
        let stream_index = output_stream.index();
        
        octx.write_header().context("Failed to write header")?;
        
        let scaler = Context::get(
            Pixel::RGB24,
            width as u32,
            height as u32,
            encoder.format(),
            width as u32,
            height as u32,
            Flags::BILINEAR,
        ).context("Failed to create output scaler")?;
        
        Ok(Self {
            octx,
            encoder,
            stream_index,
            scaler,
            width,
            height,
            frame_rate,
            time_base,
            frame_count: 0,
        })
    }
    
    pub fn compute_pts(&self, frame_index: u64) -> i64 {
        (frame_index as i64) * (self.time_base.1 as i64) / (self.time_base.0 as i64)
    }
    
    pub fn write_frame(&mut self, frame: &Frame) -> Result<()> {
        let pts = self.compute_pts(frame.index);
        
        let mut rgb_frame = Video::new(Pixel::RGB24, self.width as u32, self.height as u32);
        rgb_frame.data_mut(0).copy_from_slice(&frame.data);
        rgb_frame.set_pts(Some(pts));
        
        let mut encoded_frame = Video::empty();
        self.scaler.run(&rgb_frame, &mut encoded_frame)?;
        encoded_frame.set_pts(Some(pts));
        
        self.encoder.send_frame(&encoded_frame)?;
        
        let mut packet = ffmpeg::Packet::empty();
        while self.encoder.receive_packet(&mut packet).is_ok() {
            packet.set_stream(self.stream_index);
            packet.set_pts(Some(pts));
            packet.set_dts(Some(pts));
            packet.write_interleaved(&mut self.octx)?;
        }
        
        self.frame_count += 1;
        Ok(())
    }
    
    pub fn finish(&mut self) -> Result<()> {
        self.encoder.send_eof()?;
        
        let mut packet = ffmpeg::Packet::empty();
        while self.encoder.receive_packet(&mut packet).is_ok() {
            packet.set_stream(self.stream_index);
            packet.write_interleaved(&mut self.octx)?;
        }
        
        self.octx.write_trailer()?;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug)]
pub enum OutputFormat {
    Mp4,
    Gif,
}

impl std::str::FromStr for OutputFormat {
    type Err = anyhow::Error;
    
    fn from_str(s: &str) -> Result<Self> {
        match s.to_lowercase().as_str() {
            "mp4" => Ok(OutputFormat::Mp4),
            "gif" => Ok(OutputFormat::Gif),
            _ => Err(anyhow::anyhow!("Invalid output format: {}", s)),
        }
    }
}

pub fn load_image<P: AsRef<Path>>(path: P) -> Result<(Vec<u8>, usize, usize)> {
    let img = image::open(&path)
        .with_context(|| format!("Failed to load image: {:?}", path.as_ref()))?;
    
    let rgb = img.to_rgb8();
    let width = rgb.width() as usize;
    let height = rgb.height() as usize;
    let data = rgb.as_raw().clone();
    
    Ok((data, width, height))
}
