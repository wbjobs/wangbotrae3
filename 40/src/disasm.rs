use capstone::prelude::*;
use serde::Serialize;

#[derive(Debug, Clone, Copy)]
pub enum ArchMode {
    Arm,
    Thumb,
    Avr,
}

#[derive(Debug, Clone, Serialize)]
pub struct DisasmInsn {
    pub address: u64,
    pub size: u64,
    pub bytes: String,
    pub mnemonic: String,
    pub op_str: String,
}

pub fn parse_arch(s: &str) -> anyhow::Result<ArchMode> {
    match s.to_lowercase().as_str() {
        "arm" => Ok(ArchMode::Arm),
        "thumb" => Ok(ArchMode::Thumb),
        "avr" => Ok(ArchMode::Avr),
        _ => Err(anyhow::anyhow!(
            "不支持的指令集 '{}'，支持: arm / thumb / avr",
            s
        )),
    }
}

pub fn disassemble(
    data: &[u8],
    base_addr: u64,
    arch: ArchMode,
    offset: usize,
    count: usize,
) -> anyhow::Result<Vec<DisasmInsn>> {
    match arch {
        ArchMode::Arm | ArchMode::Thumb => {
            let cs = create_capstone(arch)?;
            let start = offset.min(data.len());
            let code = &data[start..];
            let insns = cs.disasm_all(code, base_addr + start as u64)?;
            let result: Vec<DisasmInsn> = insns
                .iter()
                .take(count)
                .map(|insn| DisasmInsn {
                    address: insn.address(),
                    size: insn.len() as u64,
                    bytes: format!("{:02x?}", insn.bytes()),
                    mnemonic: insn.mnemonic().unwrap_or("???").to_string(),
                    op_str: insn.op_str().unwrap_or("").to_string(),
                })
                .collect();
            Ok(result)
        }
        ArchMode::Avr => disassemble_avr(data, base_addr, offset, count),
    }
}

fn create_capstone(arch: ArchMode) -> anyhow::Result<Capstone> {
    let cs = match arch {
        ArchMode::Arm => Capstone::new()
            .arm()
            .mode(arch::arm::ArchMode::Arm)
            .detail(true)
            .build()?,
        ArchMode::Thumb => Capstone::new()
            .arm()
            .mode(arch::arm::ArchMode::Thumb)
            .detail(true)
            .build()?,
        ArchMode::Avr => unreachable!(),
    };
    Ok(cs)
}

fn disassemble_avr(
    data: &[u8],
    base_addr: u64,
    offset: usize,
    count: usize,
) -> anyhow::Result<Vec<DisasmInsn>> {
    let mut insns = Vec::new();
    let mut pos = offset;
    let mut insn_count = 0;

    while pos + 1 < data.len() && insn_count < count {
        let word = u16::from_le_bytes([data[pos], data[pos + 1]]);
        let addr = base_addr + pos as u64;
        let (mnemonic, op_str) = decode_avr_insn(word);

        insns.push(DisasmInsn {
            address: addr,
            size: 2,
            bytes: format!("{:04x}", word),
            mnemonic,
            op_str,
        });

        pos += 2;
        insn_count += 1;

        if is_avr_32bit(word) && pos + 1 < data.len() && insn_count < count {
            let word2 = u16::from_le_bytes([data[pos], data[pos + 1]]);
            insns.push(DisasmInsn {
                address: base_addr + pos as u64,
                size: 2,
                bytes: format!("{:04x}", word2),
                mnemonic: "...".to_string(),
                op_str: format!("(continuation: 0x{:04x})", word2),
            });
            pos += 2;
            insn_count += 1;
        }
    }

    Ok(insns)
}

fn is_avr_32bit(word: u16) -> bool {
    let op = word >> 12;
    op == 0x5 || (word & 0xfe0e) == 0x940c || (word & 0xfe0e) == 0x940e
}

fn decode_avr_insn(word: u16) -> (String, String) {
    let op = word >> 12;

    match op {
        0x0 => {
            let sreg = (word >> 4) & 0xf;
            let bit = word & 0x1;
            let reg = 16 + sreg;
            if bit == 0 {
                ("sbrc".to_string(), format!("r{}, {}", reg, (word >> 0) & 0x7))
            } else {
                ("sbrs".to_string(), format!("r{}, {}", reg, (word >> 0) & 0x7))
            }
        }
        0x1 => {
            let cp = word & 0xf;
            let rd = ((word >> 4) & 0xf) + 16;
            ("cpse".to_string(), format!("r{}, r{}", rd, cp))
        }
        0x2 => {
            let and_r = word & 0xf;
            let rd = ((word >> 4) & 0xf) + 16;
            ("and".to_string(), format!("r{}, r{}", rd, and_r))
        }
        0x3 => {
            let eor_r = word & 0xf;
            let rd = ((word >> 4) & 0xf) + 16;
            ("eor".to_string(), format!("r{}, r{}", rd, eor_r))
        }
        0x4 => {
            let rr = word & 0xf;
            let rd = ((word >> 4) & 0xf) + 16;
            ("add".to_string(), format!("r{}, r{}", rd, rr))
        }
        0x5 => {
            let rr = word & 0xf;
            let rd = ((word >> 4) & 0xf) + 16;
            ("sub".to_string(), format!("r{}, r{}", rd, rr))
        }
        0x6 => {
            let rr = word & 0xf;
            let rd = ((word >> 4) & 0xf) + 16;
            ("adc".to_string(), format!("r{}, r{}", rd, rr))
        }
        0x7 => {
            let rr = word & 0xf;
            let rd = ((word >> 4) & 0xf) + 16;
            ("sbc".to_string(), format!("r{}, r{}", rd, rr))
        }
        0x8 => {
            let bit = (word >> 9) & 0x7;
            let io = ((word >> 3) & 0x1f) + 0x20;
            ("cbi".to_string(), format!("0x{:02x}, {}", io, bit))
        }
        0x9 => {
            let bit = (word >> 9) & 0x7;
            let io = ((word >> 3) & 0x1f) + 0x20;
            ("sbi".to_string(), format!("0x{:02x}, {}", io, bit))
        }
        0xa => {
            let rr = (word >> 5) & 0xf;
            let rd = (word & 0xf) + ((word >> 5) & 0x10);
            let rd_full = rd;
            ("ldd".to_string(), format!("r{}, Z+{}", rd_full, rr))
        }
        0xb => {
            let rr = (word >> 5) & 0xf;
            let rd = (word & 0xf) + ((word >> 5) & 0x10);
            ("std".to_string(), format!("Z+{}, r{}", rr, rd))
        }
        0xc => {
            let k = word & 0xfff;
            ("rjmp".to_string(), format!("{:#x}", k as i16))
        }
        0xd => {
            let k = word & 0xfff;
            ("rcall".to_string(), format!("{:#x}", k as i16))
        }
        0xe => {
            let k = ((word & 0x0f00) >> 4) | (word & 0xf);
            let rd = ((word >> 4) & 0xf) + 16;
            ("ldi".to_string(), format!("r{}, 0x{:02x}", rd, k))
        }
        0xf => decode_avr_extended(word),
        _ => ("???".to_string(), String::new()),
    }
}

fn decode_avr_extended(word: u16) -> (String, String) {
    if (word & 0xfe08) == 0x9400 {
        let rd = (word >> 4) & 0x1f;
        ("com".to_string(), format!("r{}", rd))
    } else if (word & 0xfe08) == 0x9408 {
        let rd = (word >> 4) & 0x1f;
        ("neg".to_string(), format!("r{}", rd))
    } else if (word & 0xfe08) == 0x9410 {
        let rd = (word >> 4) & 0x1f;
        ("swap".to_string(), format!("r{}", rd))
    } else if (word & 0xfe08) == 0x9418 {
        let rd = (word >> 4) & 0x1f;
        ("inc".to_string(), format!("r{}", rd))
    } else if (word & 0xfe08) == 0x9420 {
        let rd = (word >> 4) & 0x1f;
        ("asr".to_string(), format!("r{}", rd))
    } else if (word & 0xfe08) == 0x9428 {
        let rd = (word >> 4) & 0x1f;
        ("lsr".to_string(), format!("r{}", rd))
    } else if (word & 0xfe08) == 0x9430 {
        let rd = (word >> 4) & 0x1f;
        ("ror".to_string(), format!("r{}", rd))
    } else if (word & 0xfe0f) == 0x9402 {
        let rd = (word >> 4) & 0x1f;
        ("swap".to_string(), format!("r{}", rd))
    } else if (word & 0xfe0f) == 0x940c {
        ("jmp".to_string(), String::new())
    } else if (word & 0xfe0f) == 0x940e {
        ("call".to_string(), String::new())
    } else if word == 0x9518 {
        ("reti".to_string(), String::new())
    } else if word == 0x9508 {
        ("ret".to_string(), String::new())
    } else if word == 0x95c8 {
        ("lpm".to_string(), String::new())
    } else if word == 0x95d8 {
        ("elpm".to_string(), String::new())
    } else if word == 0x9509 {
        ("ijmp".to_string(), String::new())
    } else if word == 0x9519 {
        ("icall".to_string(), String::new())
    } else if word == 0x95a8 {
        ("wdr".to_string(), String::new())
    } else if word == 0x9588 {
        ("sleep".to_string(), String::new())
    } else if word == 0x9598 {
        ("break".to_string(), String::new())
    } else if word == 0x0000 {
        ("nop".to_string(), String::new())
    } else if (word & 0xfc00) == 0xf000 {
        let br = (word >> 3) & 0x7;
        let k = (word & 0x7) | ((word >> 3) & 0x78);
        ("brbs".to_string(), format!("{}, {:#x}", br, k as i8))
    } else if (word & 0xfc00) == 0xf400 {
        let br = (word >> 3) & 0x7;
        let k = (word & 0x7) | ((word >> 3) & 0x78);
        ("brbc".to_string(), format!("{}, {:#x}", br, k as i8))
    } else if (word & 0xfe00) == 0x9200 {
        let rd = (word >> 4) & 0x1f;
        ("sts".to_string(), format!("r{}", rd))
    } else if (word & 0xfe00) == 0x9000 {
        let rd = (word >> 4) & 0x1f;
        ("lds".to_string(), format!("r{}", rd))
    } else if (word & 0xff00) == 0x9600 {
        let rd = (word >> 4) & 0xf;
        ("adiw".to_string(), format!("r{}:r{}, {}", rd * 2 + 24, rd * 2 + 25, word & 0xf))
    } else if (word & 0xff00) == 0x9700 {
        let rd = (word >> 4) & 0xf;
        ("sbiw".to_string(), format!("r{}:r{}, {}", rd * 2 + 24, rd * 2 + 25, word & 0xf))
    } else {
        (format!("op_0x{:04x}", word), String::new())
    }
}
