use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct EntropyRegion {
    pub offset: u64,
    pub size: u64,
    pub entropy: f64,
    pub risk: EntropyRisk,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
pub enum EntropyRisk {
    SuspiciousHigh,
    SuspiciousLow,
    Normal,
}

pub fn analyze_entropy(data: &[u8], window_size: usize, threshold: f64) -> Vec<EntropyRegion> {
    if data.is_empty() || window_size == 0 {
        return Vec::new();
    }

    let mut regions = Vec::new();
    let len = data.len();
    let effective_window = window_size.min(len);
    let mut i = 0;

    while i + effective_window <= len {
        let window_data = &data[i..i + effective_window];
        let ent = shannon_entropy(window_data);

        if ent >= threshold {
            let end = find_high_entropy_end(data, i + effective_window, effective_window, threshold);
            let region_data = &data[i..end];
            let region_ent = shannon_entropy(region_data);

            regions.push(EntropyRegion {
                offset: i as u64,
                size: (end - i) as u64,
                entropy: region_ent,
                risk: EntropyRisk::SuspiciousHigh,
                description: describe_high_entropy(region_ent, end - i),
            });
            i = end;
        } else if ent < 1.0 && ent > 0.0 {
            let end = find_low_entropy_end(data, i + effective_window, effective_window);
            let region_data = &data[i..end];
            let region_ent = shannon_entropy(region_data);

            regions.push(EntropyRegion {
                offset: i as u64,
                size: (end - i) as u64,
                entropy: region_ent,
                risk: EntropyRisk::SuspiciousLow,
                description: describe_low_entropy(region_ent, end - i),
            });
            i = end;
        } else {
            i += effective_window;
        }
    }

    regions
}

pub fn shannon_entropy(data: &[u8]) -> f64 {
    if data.is_empty() {
        return 0.0;
    }

    let mut freq = [0u64; 256];
    for &byte in data {
        freq[byte as usize] += 1;
    }

    let len = data.len() as f64;
    let mut entropy = 0.0;

    for &count in &freq {
        if count == 0 {
            continue;
        }
        let p = count as f64 / len;
        entropy -= p * p.log2();
    }

    entropy
}

fn find_high_entropy_end(data: &[u8], start: usize, window: usize, threshold: f64) -> usize {
    let mut end = start;
    let mut i = start;
    while i + window <= data.len() {
        let ent = shannon_entropy(&data[i..i + window]);
        if ent >= threshold {
            end = i + window;
            i += window;
        } else {
            break;
        }
    }
    end.max(start)
}

fn find_low_entropy_end(data: &[u8], start: usize, window: usize) -> usize {
    let mut end = start;
    let mut i = start;
    while i + window <= data.len() {
        let ent = shannon_entropy(&data[i..i + window]);
        if ent < 1.0 {
            end = i + window;
            i += window;
        } else {
            break;
        }
    }
    end.max(start)
}

fn describe_high_entropy(entropy: f64, size: usize) -> String {
    if entropy > 7.9 {
        format!("极高熵 ({:.2}) - 可能是加密数据或压缩数据 ({}字节)", entropy, size)
    } else if entropy > 7.0 {
        format!("高熵 ({:.2}) - 可能包含硬编码密钥或加密内容 ({}字节)", entropy, size)
    } else {
        format!("偏高熵 ({:.2}) - 可能是代码段或混合数据 ({}字节)", entropy, size)
    }
}

fn describe_low_entropy(entropy: f64, size: usize) -> String {
    if entropy < 0.5 {
        format!("极低熵 ({:.2}) - 可能是零填充或重复字节 ({}字节)", entropy, size)
    } else {
        format!("低熵 ({:.2}) - 可能是结构化数据或填充 ({}字节)", entropy, size)
    }
}
