use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InterpolationType {
    Linear,
    Bezier,
}

impl Default for InterpolationType {
    fn default() -> Self {
        InterpolationType::Linear
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Keyframe {
    pub frame: u64,
    pub strength: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyframeConfig {
    #[serde(default)]
    pub interpolation: InterpolationType,
    pub keyframes: Vec<Keyframe>,
}

impl KeyframeConfig {
    pub fn from_json_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let content = std::fs::read_to_string(&path)
            .with_context(|| format!("Failed to read keyframe config: {:?}", path.as_ref()))?;
        let config: Self = serde_json::from_str(&content)
            .context("Failed to parse keyframe config JSON")?;
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<()> {
        if self.keyframes.is_empty() {
            anyhow::bail!("No keyframes specified");
        }

        let mut sorted = self.keyframes.clone();
        sorted.sort_by_key(|k| k.frame);

        for i in 1..sorted.len() {
            if sorted[i].frame == sorted[i - 1].frame {
                anyhow::bail!(
                    "Duplicate keyframe at frame {}: each frame must be unique",
                    sorted[i].frame
                );
            }
        }

        for kf in &self.keyframes {
            if kf.strength < 0.0 || kf.strength > 1.0 {
                anyhow::bail!(
                    "Keyframe at frame {} has invalid strength {}: must be between 0.0 and 1.0",
                    kf.frame, kf.strength
                );
            }
        }

        Ok(())
    }

    pub fn get_strength_at(&self, frame: u64, total_frames: Option<u64>) -> f32 {
        if self.keyframes.is_empty() {
            return 0.5;
        }

        let total = total_frames.unwrap_or(u64::MAX);
        let frame = frame.min(total);

        let mut sorted = self.keyframes.clone();
        sorted.sort_by_key(|k| k.frame);

        if frame <= sorted[0].frame {
            return sorted[0].strength;
        }

        if frame >= sorted.last().unwrap().frame {
            return sorted.last().unwrap().strength;
        }

        for i in 1..sorted.len() {
            let prev = &sorted[i - 1];
            let curr = &sorted[i];

            if frame >= prev.frame && frame <= curr.frame {
                let t = if curr.frame == prev.frame {
                    0.0
                } else {
                    (frame - prev.frame) as f32 / (curr.frame - prev.frame) as f32
                };

                return match self.interpolation {
                    InterpolationType::Linear => linear_interpolate(prev.strength, curr.strength, t),
                    InterpolationType::Bezier => bezier_interpolate(prev.strength, curr.strength, t),
                };
            }
        }

        sorted.last().unwrap().strength
    }

    pub fn get_first(&self) -> f32 {
        self.keyframes.first().map(|k| k.strength).unwrap_or(0.5)
    }

    pub fn get_last(&self) -> f32 {
        self.keyframes.last().map(|k| k.strength).unwrap_or(0.5)
    }
}

fn linear_interpolate(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

fn bezier_interpolate(a: f32, b: f32, t: f32) -> f32 {
    let t2 = t * t;
    let mt = 1.0 - t;
    let mt2 = mt * mt;
    let control = (a + b) / 2.0;
    
    a * mt2 + 2.0 * control * mt * t + b * t2
}

pub struct StrengthInterpolator {
    config: KeyframeConfig,
    total_frames: u64,
}

impl StrengthInterpolator {
    pub fn new(config: KeyframeConfig, total_frames: u64) -> Self {
        Self {
            config,
            total_frames,
        }
    }

    pub fn from_json<P: AsRef<Path>>(path: P, total_frames: u64) -> Result<Self> {
        let config = KeyframeConfig::from_json_file(path)?;
        Ok(Self::new(config, total_frames))
    }

    pub fn from_fixed(strength: f32, total_frames: u64) -> Self {
        let config = KeyframeConfig {
            interpolation: InterpolationType::Linear,
            keyframes: vec![
                Keyframe {
                    frame: 0,
                    strength,
                },
            ],
        };
        Self::new(config, total_frames)
    }

    pub fn get_strength(&self, frame: u64) -> f32 {
        self.config.get_strength_at(frame, Some(self.total_frames))
    }

    pub fn total_frames(&self) -> u64 {
        self.total_frames
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_linear_interpolation() {
        let config = KeyframeConfig {
            interpolation: InterpolationType::Linear,
            keyframes: vec![
                Keyframe { frame: 0, strength: 0.0 },
                Keyframe { frame: 100, strength: 1.0 },
            ],
        };

        assert_eq!(config.get_strength_at(0, None), 0.0);
        assert_eq!(config.get_strength_at(50, None), 0.5);
        assert_eq!(config.get_strength_at(100, None), 1.0);
        assert!((config.get_strength_at(25, None) - 0.25).abs() < 0.001);
    }

    #[test]
    fn test_bezier_interpolation() {
        let config = KeyframeConfig {
            interpolation: InterpolationType::Bezier,
            keyframes: vec![
                Keyframe { frame: 0, strength: 0.0 },
                Keyframe { frame: 100, strength: 1.0 },
            ],
        };

        assert_eq!(config.get_strength_at(0, None), 0.0);
        assert_eq!(config.get_strength_at(100, None), 1.0);
        let mid = config.get_strength_at(50, None);
        assert!(mid > 0.45 && mid < 0.55);
    }

    #[test]
    fn test_multiple_keyframes() {
        let config = KeyframeConfig {
            interpolation: InterpolationType::Linear,
            keyframes: vec![
                Keyframe { frame: 0, strength: 0.0 },
                Keyframe { frame: 50, strength: 1.0 },
                Keyframe { frame: 100, strength: 0.5 },
            ],
        };

        assert_eq!(config.get_strength_at(0, None), 0.0);
        assert_eq!(config.get_strength_at(25, None), 0.5);
        assert_eq!(config.get_strength_at(50, None), 1.0);
        assert_eq!(config.get_strength_at(75, None), 0.75);
        assert_eq!(config.get_strength_at(100, None), 0.5);
    }

    #[test]
    fn test_out_of_bounds_clamped() {
        let config = KeyframeConfig {
            interpolation: InterpolationType::Linear,
            keyframes: vec![
                Keyframe { frame: 10, strength: 0.3 },
                Keyframe { frame: 90, strength: 0.7 },
            ],
        };

        assert_eq!(config.get_strength_at(0, None), 0.3);
        assert_eq!(config.get_strength_at(100, None), 0.7);
    }
}
