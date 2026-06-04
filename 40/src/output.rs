use crate::segment::{Segment, SegmentType};
use crate::dangerous::{DangerousFinding, Severity};
use crate::entropy::{EntropyRegion, EntropyRisk};
use crate::diff::{DiffResult, DiffRegionType};
use crate::disasm::DisasmInsn;
use colored::*;

pub fn render_segments(segments: &[Segment], format: &str) -> anyhow::Result<()> {
    match format {
        "json" => {
            println!("{}", serde_json::to_string_pretty(segments)?);
        }
        _ => {
            println!("\n{}", "╔══════════════════════════════════════════════════════════════════════════╗".cyan());
            println!("{}", "║                          固件段信息 (Segments)                          ║".cyan());
            println!("{}", "╠══════════════════╦═══════════════════╦══════════╦═════════╦═════════════╣".cyan());
            println!("{}", "║ 段名称           ║ 虚拟地址          ║ 偏移     ║ 大小    ║ 熵值        ║".cyan());
            println!("{}", "╠══════════════════╬═══════════════════╬══════════╬═════════╬═════════════╣".cyan());

            for seg in segments {
                let type_icon = match seg.section_type {
                    SegmentType::Text => "📄".to_string(),
                    SegmentType::Data => "📊".to_string(),
                    SegmentType::Rodata => "🔒".to_string(),
                    SegmentType::Bss => "空洞".to_string(),
                    SegmentType::Unknown => "❓".to_string(),
                };
                let entropy_str = format!("{:.4}", seg.entropy);
                let entropy_colored = if seg.entropy > 7.0 {
                    entropy_str.red().to_string()
                } else if seg.entropy > 5.0 {
                    entropy_str.yellow().to_string()
                } else {
                    entropy_str.green().to_string()
                };

                println!(
                    "║ {:<14} {} ║ 0x{:0>8X}       ║ 0x{:0>4X}  ║ {:>5}   ║ {}     ║",
                    seg.name,
                    type_icon,
                    seg.vaddr,
                    seg.offset,
                    seg.size,
                    entropy_colored,
                );
            }

            println!("{}", "╚══════════════════╩═══════════════════╩══════════╩═════════╩═════════════╝".cyan());
        }
    }
    Ok(())
}

pub fn render_dangerous(findings: &[DangerousFinding], format: &str) -> anyhow::Result<()> {
    match format {
        "json" => {
            println!("{}", serde_json::to_string_pretty(findings)?);
        }
        _ => {
            println!("\n{}", "╔══════════════════════════════════════════════════════════════════════════╗".red());
            println!("{}", "║                      ⚠  危险函数检测 (Dangerous Functions)              ║".red());
            println!("{}", "╠═══════════╦═════════════════╦══════════════╦═══════════════╦════════════╣".red());
            println!("{}", "║ 严重程度  ║ 函数名称        ║ 虚拟地址     ║ 类别          ║ 描述       ║".red());
            println!("{}", "╠═══════════╬═════════════════╬══════════════╬═══════════════╬════════════╣".red());

            for f in findings {
                let severity_str = match &f.severity {
                    Severity::Critical => "CRITICAL".red().bold().to_string(),
                    Severity::High => "HIGH    ".yellow().bold().to_string(),
                    Severity::Medium => "MEDIUM  ".magenta().to_string(),
                    Severity::Low => "LOW     ".blue().to_string(),
                };

                let desc_short = if f.description.len() > 28 {
                    format!("{}...", &f.description[..25])
                } else {
                    f.description.clone()
                };

                println!(
                    "║ {} ║ {:<15} ║ 0x{:0>8X}   ║ {:<13} ║ {} ║",
                    severity_str,
                    f.function,
                    f.vaddr,
                    f.category,
                    desc_short,
                );
            }

            if findings.is_empty() {
                println!("║ {} ║", "  ✓ 未发现已知危险函数引用".green());
            }

            println!("{}", "╚═══════════╩═════════════════╩══════════════╩═══════════════╩════════════╝".red());
        }
    }
    Ok(())
}

pub fn render_entropy(regions: &[EntropyRegion], format: &str) -> anyhow::Result<()> {
    match format {
        "json" => {
            println!("{}", serde_json::to_string_pretty(regions)?);
        }
        _ => {
            println!("\n{}", "╔══════════════════════════════════════════════════════════════════════════╗".yellow());
            println!("{}", "║                    🔑 熵分析结果 (Entropy Analysis)                     ║".yellow());
            println!("{}", "╠══════════════════╦═══════════════════╦══════════╦═══════════════════════╣".yellow());
            println!("{}", "║ 偏移             ║ 大小              ║ 熵值     ║ 描述                  ║".yellow());
            println!("{}", "╠══════════════════╬═══════════════════╬══════════╬═══════════════════════╣".yellow());

            for r in regions {
                let risk_icon = match r.risk {
                    EntropyRisk::SuspiciousHigh => "🔴".to_string(),
                    EntropyRisk::SuspiciousLow => "🟡".to_string(),
                    EntropyRisk::Normal => "🟢".to_string(),
                };

                let entropy_colored = format!("{:.4}", r.entropy);
                let desc_short = if r.description.len() > 35 {
                    format!("{}...", &r.description[..32])
                } else {
                    r.description.clone()
                };

                println!(
                    "║ 0x{:0>8X}       ║ {:>10} bytes  ║ {} {} ║ {} ║",
                    r.offset,
                    r.size,
                    entropy_colored,
                    risk_icon,
                    desc_short,
                );
            }

            if regions.is_empty() {
                println!("║ {} ║", "  ✓ 未发现异常熵区域".green());
            }

            println!("{}", "╚══════════════════╩═══════════════════╩══════════╩═══════════════════════╝".yellow());
        }
    }
    Ok(())
}

pub fn render_diff(result: &DiffResult, format: &str) -> anyhow::Result<()> {
    match format {
        "json" => {
            println!("{}", serde_json::to_string_pretty(result)?);
        }
        _ => {
            println!("\n{}", "╔══════════════════════════════════════════════════════════════════════════╗".magenta());
            println!("{}", "║                    🔄 固件差异对比 (Patch Analysis)                     ║".magenta());
            println!("{}", "╠══════════════════════════════════════════════════════════════════════════╣".magenta());

            println!("║ 旧固件大小: {} bytes", result.old_size.to_string().yellow());
            println!("║ 新固件大小: {} bytes", result.new_size.to_string().yellow());

            let total = result.unchanged_bytes + result.modified_bytes + result.added_bytes + result.removed_bytes;
            if total > 0 {
                let unchanged_pct = (result.unchanged_bytes as f64 / total as f64) * 100.0;
                let modified_pct = (result.modified_bytes as f64 / total as f64) * 100.0;
                let added_pct = (result.added_bytes as f64 / total as f64) * 100.0;
                let removed_pct = (result.removed_bytes as f64 / total as f64) * 100.0;

                println!("║ 未变更: {} bytes ({:.1}%)", result.unchanged_bytes.to_string().green(), unchanged_pct);
                println!("║ 已修改: {} bytes ({:.1}%)", result.modified_bytes.to_string().yellow(), modified_pct);
                println!("║ 新增:   {} bytes ({:.1}%)", result.added_bytes.to_string().cyan(), added_pct);
                println!("║ 删除:   {} bytes ({:.1}%)", result.removed_bytes.to_string().red(), removed_pct);
            }

            println!("{}", "╠══════════════════════════════════════════════════════════════════════════╣".magenta());
            println!("║ 差异区域详情:");
            println!("{}", "╠══════════════════╦═══════════════════╦══════════╦══════════════════════╣".magenta());

            for region in &result.regions {
                let type_str = match region.region_type {
                    DiffRegionType::Added => "ADDED   ".green().to_string(),
                    DiffRegionType::Removed => "REMOVED ".red().to_string(),
                    DiffRegionType::Modified => "MODIFIED".yellow().to_string(),
                };

                println!(
                    "║ {} ║ 0x{:0>8X}       ║ {:>6} B ║ {} ║",
                    type_str,
                    region.offset,
                    region.size,
                    region.old_preview.chars().take(20).collect::<String>(),
                );
            }

            println!("{}", "╚══════════════════╩═══════════════════╩══════════╩══════════════════════╝".magenta());
        }
    }
    Ok(())
}

pub fn render_disasm(insns: &[DisasmInsn], _format: &str) -> anyhow::Result<()> {
    println!("\n{}", "╔══════════════════════════════════════════════════════════════════════════╗".green());
    println!("{}", "║                    🔧 反汇编输出 (Disassembly)                          ║".green());
    println!("{}", "╠══════════════════════════════════════════════════════════════════════════╣".green());

    for insn in insns {
        let addr_str = format!("0x{:0>8X}", insn.address);
        let bytes_short: String = insn.bytes.chars().take(23).collect();
        println!(
            "║ {} │ {} │ {:<8} {}",
            addr_str.cyan(),
            bytes_short.dimmed(),
            insn.mnemonic.yellow(),
            insn.op_str.white(),
        );
    }

    println!("{}", "╚══════════════════════════════════════════════════════════════════════════╝".green());
    Ok(())
}
