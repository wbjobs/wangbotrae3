use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Segment {
    pub name: String,
    pub offset: u64,
    pub vaddr: u64,
    pub size: u64,
    pub entropy: f64,
    pub section_type: SegmentType,
}

#[derive(Debug, Clone, Serialize)]
pub enum SegmentType {
    Text,
    Data,
    Rodata,
    Bss,
    Unknown,
}

const ELF_MAGIC: [u8; 4] = [0x7f, b'E', b'L', b'F'];
const IHEX_START: u8 = b':';

pub fn parse_segments(data: &[u8], base_addr: u64) -> Vec<Segment> {
    if data.len() >= 4 && data[0..4] == ELF_MAGIC {
        parse_elf_segments(data, base_addr)
    } else if data.len() > 0 && data[0] == IHEX_START {
        parse_ihex_segments(data, base_addr)
    } else {
        parse_raw_segments(data, base_addr)
    }
}

fn parse_elf_segments(data: &[u8], base_addr: u64) -> Vec<Segment> {
    let mut segments = Vec::new();

    let is_64bit = data.get(4) == Some(&2);
    let e_shoff = if is_64bit {
        read_u64_le(data, 40)
    } else {
        read_u32_le(data, 32) as u64
    };
    let e_shentsize = if is_64bit {
        read_u16_le(data, 58) as usize
    } else {
        read_u16_le(data, 46) as usize
    };
    let e_shnum = if is_64bit {
        read_u16_le(data, 60) as usize
    } else {
        read_u16_le(data, 48) as usize
    };
    let e_shstrndx = if is_64bit {
        read_u16_le(data, 62) as usize
    } else {
        read_u16_le(data, 50) as usize
    };

    if e_shoff == 0 || e_shnum == 0 || e_shentsize == 0 {
        return parse_raw_segments(data, base_addr);
    }

    let strtab_off = if e_shstrndx < e_shnum {
        let sh_offset = e_shoff as usize + e_shstrndx * e_shentsize;
        if is_64bit {
            read_u64_le(data, sh_offset + 24) as usize
        } else {
            read_u32_le(data, sh_offset + 16) as usize
        }
    } else {
        0
    };

    for i in 0..e_shnum {
        let sh_off = e_shoff as usize + i * e_shentsize;
        if sh_off + e_shentsize > data.len() {
            break;
        }

        let name_idx = read_u32_le(data, sh_off) as usize;
        let (sh_type, sh_offset, sh_size, sh_addr) = if is_64bit {
            (
                read_u32_le(data, sh_off + 4),
                read_u64_le(data, sh_off + 24),
                read_u64_le(data, sh_off + 32),
                read_u64_le(data, sh_off + 16),
            )
        } else {
            (
                read_u32_le(data, sh_off + 4),
                read_u32_le(data, sh_off + 16) as u64,
                read_u32_le(data, sh_off + 20) as u64,
                read_u32_le(data, sh_off + 12) as u64,
            )
        };

        if sh_type == 0 || sh_size == 0 {
            continue;
        }

        let name = read_elf_string(data, strtab_off, name_idx);
        let seg_type = classify_section(&name, sh_type);
        let section_data_start = sh_offset as usize;
        let section_data_end = std::cmp::min(section_data_start + sh_size as usize, data.len());
        let section_data = &data[section_data_start..section_data_end];
        let ent = crate::entropy::shannon_entropy(section_data);

        segments.push(Segment {
            name: if name.is_empty() {
                format!("section_{}", i)
            } else {
                name
            },
            offset: sh_offset,
            vaddr: if sh_addr != 0 { sh_addr } else { base_addr + sh_offset },
            size: sh_size,
            entropy: ent,
            section_type: seg_type,
        });
    }

    segments
}

fn read_elf_string(data: &[u8], strtab_off: usize, idx: usize) -> String {
    let start = strtab_off + idx;
    if start >= data.len() {
        return String::new();
    }
    let end = data[start..].iter().position(|&b| b == 0).unwrap_or(data.len() - start);
    String::from_utf8_lossy(&data[start..start + end]).to_string()
}

fn parse_ihex_segments(data: &[u8], base_addr: u64) -> Vec<Segment> {
    let content = String::from_utf8_lossy(data);
    let mut regions: Vec<(u64, Vec<u8>)> = Vec::new();
    let mut ext_addr: u64 = 0;
    let mut current_addr: u64 = 0;
    let mut current_data: Vec<u8> = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if !line.starts_with(':') {
            continue;
        }
        let hex_str = &line[1..];
        let bytes: Vec<u8> = (0..hex_str.len())
            .step_by(2)
            .filter_map(|i| {
                if i + 2 <= hex_str.len() {
                    u8::from_str_radix(&hex_str[i..i + 2], 16).ok()
                } else {
                    None
                }
            })
            .collect();

        if bytes.len() < 5 {
            continue;
        }

        let byte_count = bytes[0] as usize;
        let address = ((bytes[1] as u64) << 8) | bytes[2] as u64;
        let record_type = bytes[3];

        match record_type {
            0x00 => {
                let full_addr = ext_addr + address;
                if !current_data.is_empty() && full_addr != current_addr + current_data.len() as u64 {
                    regions.push((current_addr, std::mem::take(&mut current_data)));
                }
                if current_data.is_empty() {
                    current_addr = full_addr;
                }
                current_data.extend_from_slice(&bytes[4..4 + byte_count]);
            }
            0x01 => {
                if !current_data.is_empty() {
                    regions.push((current_addr, std::mem::take(&mut current_data)));
                }
            }
            0x02 => {
                ext_addr = ((bytes[4] as u64) << 8 | bytes[5] as u64) << 4;
            }
            0x04 => {
                ext_addr = ((bytes[4] as u64) << 8 | bytes[5] as u64) << 16;
            }
            _ => {}
        }
    }
    if !current_data.is_empty() {
        regions.push((current_addr, current_data));
    }

    let mut segments = Vec::new();
    let mut offset_acc: u64 = 0;
    for (addr, region_data) in &regions {
        let ent = crate::entropy::shannon_entropy(region_data);
        let seg_type = guess_segment_type(region_data);
        segments.push(Segment {
            name: format!("ihex_region_{:08X}", addr),
            offset: offset_acc,
            vaddr: base_addr + *addr,
            size: region_data.len() as u64,
            entropy: ent,
            section_type: seg_type,
        });
        offset_acc += region_data.len() as u64;
    }
    segments
}

fn parse_raw_segments(data: &[u8], base_addr: u64) -> Vec<Segment> {
    if data.is_empty() {
        return Vec::new();
    }

    let total_len = data.len();
    let text_end = total_len / 3;
    let data_end = text_end + total_len / 3;

    let text_data = &data[..text_end];
    let rodata_range = &data[text_end..data_end];
    let data_range = &data[data_end..];

    let mut segments = Vec::new();

    segments.push(Segment {
        name: ".text (推测)".to_string(),
        offset: 0,
        vaddr: base_addr,
        size: text_end as u64,
        entropy: crate::entropy::shannon_entropy(text_data),
        section_type: SegmentType::Text,
    });

    segments.push(Segment {
        name: ".rodata (推测)".to_string(),
        offset: text_end as u64,
        vaddr: base_addr + text_end as u64,
        size: (data_end - text_end) as u64,
        entropy: crate::entropy::shannon_entropy(rodata_range),
        section_type: SegmentType::Rodata,
    });

    segments.push(Segment {
        name: ".data (推测)".to_string(),
        offset: data_end as u64,
        vaddr: base_addr + data_end as u64,
        size: (total_len - data_end) as u64,
        entropy: crate::entropy::shannon_entropy(data_range),
        section_type: SegmentType::Data,
    });

    segments
}

fn classify_section(name: &str, sh_type: u32) -> SegmentType {
    match name {
        n if n.starts_with(".text") => SegmentType::Text,
        n if n.starts_with(".rodata") => SegmentType::Rodata,
        n if n.starts_with(".data") => SegmentType::Data,
        n if n.starts_with(".bss") => SegmentType::Bss,
        _ => {
            if sh_type == 1 {
                SegmentType::Text
            } else {
                SegmentType::Unknown
            }
        }
    }
}

fn guess_segment_type(data: &[u8]) -> SegmentType {
    if data.is_empty() {
        return SegmentType::Unknown;
    }
    let ent = crate::entropy::shannon_entropy(data);
    if ent > 6.0 {
        SegmentType::Text
    } else if ent > 4.0 {
        SegmentType::Data
    } else {
        SegmentType::Rodata
    }
}

fn read_u32_le(data: &[u8], offset: usize) -> u32 {
    if offset + 4 > data.len() {
        return 0;
    }
    u32::from_le_bytes([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]])
}

fn read_u64_le(data: &[u8], offset: usize) -> u64 {
    if offset + 8 > data.len() {
        return 0;
    }
    u64::from_le_bytes([
        data[offset], data[offset + 1], data[offset + 2], data[offset + 3],
        data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7],
    ])
}

fn read_u16_le(data: &[u8], offset: usize) -> u16 {
    if offset + 2 > data.len() {
        return 0;
    }
    u16::from_le_bytes([data[offset], data[offset + 1]])
}
