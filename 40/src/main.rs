pub mod segment;
pub mod dangerous;
pub mod entropy;
pub mod diff;
pub mod disasm;
pub mod output;

use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "fwaudit")]
#[command(about = "二进制固件安全审计工具 - Binary Firmware Security Audit CLI")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    #[command(about = "解析固件段信息 (.text / .data / .rodata)")]
    Segments {
        #[arg(help = "固件文件路径")]
        firmware: PathBuf,
        #[arg(long, default_value = "0x0", help = "基地址 (hex)")]
        base_addr: String,
        #[arg(long, default_value = "terminal", help = "输出格式: terminal / json")]
        output: String,
    },
    #[command(about = "检测已知危险函数调用")]
    Dangerous {
        #[arg(help = "固件文件路径")]
        firmware: PathBuf,
        #[arg(long, default_value = "0x0", help = "基地址 (hex)")]
        base_addr: String,
        #[arg(long, default_value = "arm", help = "指令集: arm / thumb / avr")]
        arch: String,
        #[arg(long, default_value = "terminal", help = "输出格式: terminal / json")]
        output: String,
    },
    #[command(about = "熵分析 - 检测硬编码密钥/加密数据")]
    Entropy {
        #[arg(help = "固件文件路径")]
        firmware: PathBuf,
        #[arg(long, default_value_t = 256, help = "滑动窗口大小 (字节)")]
        window: usize,
        #[arg(long, default_value_t = 7.0, help = "高熵阈值 (0-8)")]
        threshold: f64,
        #[arg(long, default_value = "terminal", help = "输出格式: terminal / json")]
        output: String,
    },
    #[command(about = "固件版本差异对比 (补丁分析)")]
    Diff {
        #[arg(help = "旧版本固件路径")]
        old_firmware: PathBuf,
        #[arg(help = "新版本固件路径")]
        new_firmware: PathBuf,
        #[arg(long, default_value = "0x0", help = "旧固件基地址 (hex)")]
        old_base: String,
        #[arg(long, default_value = "0x0", help = "新固件基地址 (hex)")]
        new_base: String,
        #[arg(long, default_value = "terminal", help = "输出格式: terminal / json")]
        output: String,
    },
    #[command(about = "反汇编固件代码")]
    Disasm {
        #[arg(help = "固件文件路径")]
        firmware: PathBuf,
        #[arg(long, default_value = "0x0", help = "基地址 (hex)")]
        base_addr: String,
        #[arg(long, default_value = "arm", help = "指令集: arm / thumb / avr")]
        arch: String,
        #[arg(long, default_value_t = 64, help = "反汇编指令数量")]
        count: usize,
        #[arg(long, default_value = "0x0", help = "起始偏移 (hex)")]
        offset: String,
    },
    #[command(about = "执行完整安全审计")]
    Audit {
        #[arg(help = "固件文件路径")]
        firmware: PathBuf,
        #[arg(long, default_value = "0x0", help = "基地址 (hex)")]
        base_addr: String,
        #[arg(long, default_value = "arm", help = "指令集: arm / thumb / avr")]
        arch: String,
        #[arg(long, default_value_t = 256, help = "熵分析窗口大小")]
        window: usize,
        #[arg(long, default_value_t = 7.0, help = "高熵阈值")]
        threshold: f64,
        #[arg(long, default_value = "terminal", help = "输出格式: terminal / json")]
        output: String,
    },
}

fn parse_hex(s: &str) -> anyhow::Result<u64> {
    let s = s.trim_start_matches("0x").trim_start_matches("0X");
    u64::from_str_radix(s, 16).map_err(|e| anyhow::anyhow!("无效的十六进制地址 '{}': {}", s, e))
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Segments { firmware, base_addr, output } => {
            let base = parse_hex(&base_addr)?;
            let data = std::fs::read(&firmware)?;
            let segments = segment::parse_segments(&data, base);
            output::render_segments(&segments, &output)?;
        }
        Commands::Dangerous { firmware, base_addr, arch, output } => {
            let base = parse_hex(&base_addr)?;
            let data = std::fs::read(&firmware)?;
            let arch_mode = disasm::parse_arch(&arch)?;
            let findings = dangerous::detect_dangerous_functions(&data, base, arch_mode)?;
            output::render_dangerous(&findings, &output)?;
        }
        Commands::Entropy { firmware, window, threshold, output } => {
            let data = std::fs::read(&firmware)?;
            let results = entropy::analyze_entropy(&data, window, threshold);
            output::render_entropy(&results, &output)?;
        }
        Commands::Diff { old_firmware, new_firmware, old_base, new_base, output } => {
            let ob = parse_hex(&old_base)?;
            let nb = parse_hex(&new_base)?;
            let old_data = std::fs::read(&old_firmware)?;
            let new_data = std::fs::read(&new_firmware)?;
            let result = diff::diff_firmware(&old_data, &new_data, ob, nb);
            output::render_diff(&result, &output)?;
        }
        Commands::Disasm { firmware, base_addr, arch, count, offset } => {
            let base = parse_hex(&base_addr)?;
            let off = parse_hex(&offset)?;
            let data = std::fs::read(&firmware)?;
            let arch_mode = disasm::parse_arch(&arch)?;
            let insns = disasm::disassemble(&data, base, arch_mode, off as usize, count)?;
            output::render_disasm(&insns, "terminal")?;
        }
        Commands::Audit { firmware, base_addr, arch, window, threshold, output } => {
            let base = parse_hex(&base_addr)?;
            let data = std::fs::read(&firmware)?;
            let arch_mode = disasm::parse_arch(&arch)?;

            println!("═══════════════════════════════════════════════════");
            println!("  固件安全审计报告");
            println!("═══════════════════════════════════════════════════\n");

            let segments = segment::parse_segments(&data, base);
            output::render_segments(&segments, &output)?;

            let findings = dangerous::detect_dangerous_functions(&data, base, arch_mode)?;
            output::render_dangerous(&findings, &output)?;

            let ent_results = entropy::analyze_entropy(&data, window, threshold);
            output::render_entropy(&ent_results, &output)?;
        }
    }

    Ok(())
}
