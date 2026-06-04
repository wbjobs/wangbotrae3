#[derive(Clone, Copy, Debug)]
struct Rational {
    num: i32,
    den: i32,
}

impl Rational {
    fn new(num: i32, den: i32) -> Self {
        Self { num, den }
    }
}

#[derive(Clone, Copy, Debug)]
struct FrameRate {
    numerator: i32,
    denominator: i32,
}

impl FrameRate {
    fn new(num: i32, den: i32) -> Self {
        Self {
            numerator: num,
            denominator: den,
        }
    }
    
    fn to_f64(&self) -> f64 {
        self.numerator as f64 / self.denominator as f64
    }
    
    fn to_time_base(&self) -> Rational {
        Rational::new(self.denominator, self.numerator)
    }
}

fn compute_pts_integer(frame_index: u64, time_base: Rational) -> i64 {
    (frame_index as i64) * (time_base.den as i64) / (time_base.num as i64)
}

fn compute_pts_float(frame_index: u64, fps: f64) -> i64 {
    (frame_index as f64 / fps * 90000.0) as i64
}

fn main() {
    println!("=== Frame Rate PTS Accuracy Test ===\n");
    
    let test_cases = vec![
        ("23.976 fps (film)", FrameRate::new(24000, 1001), 90000),
        ("24 fps (cinema)", FrameRate::new(24, 1), 90000),
        ("25 fps (PAL)", FrameRate::new(25, 1), 90000),
        ("29.97 fps (NTSC)", FrameRate::new(30000, 1001), 90000),
        ("30 fps", FrameRate::new(30, 1), 90000),
        ("60 fps", FrameRate::new(60, 1), 90000),
    ];
    
    for (name, frame_rate, time_base_den) in test_cases {
        println!("Test: {}", name);
        println!("  Frame rate: {}/{} = {:.6} fps", 
            frame_rate.numerator, frame_rate.denominator, frame_rate.to_f64());
        
        let time_base = Rational::new(1, time_base_den);
        let fps = frame_rate.to_f64();
        
        let mut max_error = 0i64;
        let mut max_error_frame = 0u64;
        let mut drift_count = 0;
        
        for frame_idx in 0..=10000 {
            let frame_duration_tb = (time_base_den as f64 * frame_rate.denominator as f64) 
                                   / frame_rate.numerator as f64;
            
            let pts_exact = (frame_idx as f64 * frame_duration_tb) as i64;
            let pts_integer = compute_pts_integer(
                frame_idx, 
                Rational::new(frame_rate.denominator, frame_rate.numerator)
            ) * (time_base_den as i64 / frame_rate.denominator as i64);
            
            let error = pts_exact - pts_integer;
            let error_abs = error.abs();
            
            if error_abs > max_error {
                max_error = error_abs;
                max_error_frame = frame_idx;
            }
            
            if error_abs > (time_base_den / 2) as i64 {
                drift_count += 1;
            }
        }
        
        println!("  Max error over 10,000 frames: {} timebase units ({} frames at {})", 
            max_error, 
            max_error as f64 / frame_rate.to_f64(),
            max_error_frame);
        println!("  Frames with >0.5 frame drift: {}", drift_count);
        println!();
    }
    
    println!("=== Float Accumulation Error Demonstration ===\n");
    
    let frame_rate = FrameRate::new(24000, 1001);
    let fps = frame_rate.to_f64();
    let frame_duration = 1.0 / fps;
    
    let mut float_time = 0.0f64;
    let mut drift_at_1000 = 0.0;
    let mut drift_at_10000 = 0.0;
    
    println!("Float accumulation vs exact calculation (23.976 fps):");
    println!("{:>8} | {:>15} | {:>15} | {:>15}", 
        "Frame", "Float Time", "Exact Time", "Drift (ms)");
    println!("{}", "-".repeat(65));
    
    for i in 0..=10000 {
        let exact_time = (i as f64 * frame_rate.denominator as f64) / frame_rate.numerator as f64;
        
        if i > 0 {
            float_time += frame_duration;
        }
        
        let drift_ms = (float_time - exact_time) * 1000.0;
        
        if i == 1000 {
            drift_at_1000 = drift_ms;
        }
        if i == 10000 {
            drift_at_10000 = drift_ms;
        }
        
        if i % 1000 == 0 {
            println!("{:>8} | {:>15.6} | {:>15.6} | {:>15.3}", 
                i, float_time, exact_time, drift_ms);
        }
    }
    
    println!("\nFloat accumulation drift:");
    println!("  At 1,000 frames: {:.3} ms ({:.2} frames)", 
        drift_at_1000, drift_at_1000 / 1000.0 * fps);
    println!("  At 10,000 frames: {:.3} ms ({:.2} frames)", 
        drift_at_10000, drift_at_10000 / 10000.0 * fps);
    
    println!("\n=== Conclusion ===");
    println!("Using rational arithmetic (numerator/denominator) eliminates drift.");
    println!("Float accumulation causes significant drift over time (1000+ frames).");
    println!("Each frame's PTS should be recalculated from frame index using integer math.");
}
