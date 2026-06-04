use serde::Serialize;
use crate::disasm::ArchMode;

#[derive(Debug, Clone, Serialize)]
pub struct DangerousFinding {
    pub function: String,
    pub offset: u64,
    pub vaddr: u64,
    pub severity: Severity,
    pub category: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
pub enum Severity {
    Critical,
    High,
    Medium,
    Low,
}

struct DangerousFuncInfo {
    name: &'static str,
    severity: Severity,
    category: &'static str,
    description: &'static str,
}

const DANGEROUS_FUNCTIONS: &[DangerousFuncInfo] = &[
    DangerousFuncInfo {
        name: "gets",
        severity: Severity::Critical,
        category: "缓冲区溢出",
        description: "gets() 无法限制读取长度，极易导致栈缓冲区溢出",
    },
    DangerousFuncInfo {
        name: "strcpy",
        severity: Severity::Critical,
        category: "缓冲区溢出",
        description: "strcpy() 不检查目标缓冲区大小，可能导致溢出",
    },
    DangerousFuncInfo {
        name: "strcat",
        severity: Severity::Critical,
        category: "缓冲区溢出",
        description: "strcat() 不检查目标缓冲区大小，可能导致溢出",
    },
    DangerousFuncInfo {
        name: "sprintf",
        severity: Severity::High,
        category: "缓冲区溢出",
        description: "sprintf() 不检查输出缓冲区大小，应使用 snprintf()",
    },
    DangerousFuncInfo {
        name: "vsprintf",
        severity: Severity::High,
        category: "缓冲区溢出",
        description: "vsprintf() 不检查输出缓冲区大小，应使用 vsnprintf()",
    },
    DangerousFuncInfo {
        name: "scanf",
        severity: Severity::High,
        category: "缓冲区溢出",
        description: "scanf() 不检查输入长度，应使用带长度限制的版本",
    },
    DangerousFuncInfo {
        name: "sscanf",
        severity: Severity::Medium,
        category: "缓冲区溢出",
        description: "sscanf() 可能导致缓冲区溢出，应指定字段宽度",
    },
    DangerousFuncInfo {
        name: "fscanf",
        severity: Severity::Medium,
        category: "缓冲区溢出",
        description: "fscanf() 可能导致缓冲区溢出",
    },
    DangerousFuncInfo {
        name: "memcpy",
        severity: Severity::Medium,
        category: "内存操作",
        description: "memcpy() 若长度参数不受控可导致越界写入",
    },
    DangerousFuncInfo {
        name: "memmove",
        severity: Severity::Low,
        category: "内存操作",
        description: "memmove() 需确保长度参数安全",
    },
    DangerousFuncInfo {
        name: "strncpy",
        severity: Severity::Low,
        category: "字符串处理",
        description: "strncpy() 不保证空终止，可能导致字符串截断",
    },
    DangerousFuncInfo {
        name: "strncat",
        severity: Severity::Low,
        category: "字符串处理",
        description: "strncat() 需确保追加长度正确",
    },
    DangerousFuncInfo {
        name: "system",
        severity: Severity::Critical,
        category: "命令注入",
        description: "system() 执行shell命令，可能导致命令注入",
    },
    DangerousFuncInfo {
        name: "popen",
        severity: Severity::High,
        category: "命令注入",
        description: "popen() 执行shell命令，可能导致命令注入",
    },
    DangerousFuncInfo {
        name: "exec",
        severity: Severity::High,
        category: "命令注入",
        description: "exec* 系列函数可能执行不受控的命令",
    },
    DangerousFuncInfo {
        name: "rand",
        severity: Severity::High,
        category: "弱随机数",
        description: "rand() 使用线性同余生成器，不安全，应使用加密安全PRNG",
    },
    DangerousFuncInfo {
        name: "srand",
        severity: Severity::High,
        category: "弱随机数",
        description: "srand() 设置的种子可能可预测",
    },
    DangerousFuncInfo {
        name: "atoi",
        severity: Severity::Low,
        category: "整数溢出",
        description: "atoi() 无法检测溢出，应使用 strtol()",
    },
    DangerousFuncInfo {
        name: "atol",
        severity: Severity::Low,
        category: "整数溢出",
        description: "atol() 无法检测溢出，应使用 strtoll()",
    },
];

pub fn detect_dangerous_functions(
    data: &[u8],
    base_addr: u64,
    arch: ArchMode,
) -> anyhow::Result<Vec<DangerousFinding>> {
    let mut findings = Vec::new();

    findings.extend(scan_string_references(data, base_addr));
    findings.extend(scan_call_targets(data, base_addr, arch)?);

    findings.sort_by(|a, b| a.vaddr.cmp(&b.vaddr));
    findings.dedup_by(|a, b| a.vaddr == b.vaddr && a.function == b.function);

    Ok(findings)
}

fn scan_string_references(data: &[u8], base_addr: u64) -> Vec<DangerousFinding> {
    let mut findings = Vec::new();

    for func_info in DANGEROUS_FUNCTIONS {
        let pattern = func_info.name.as_bytes();
        let null_terminated: Vec<u8> = {
            let mut v = pattern.to_vec();
            v.push(0);
            v
        };

        for i in 0..data.len().saturating_sub(null_terminated.len()) {
            if data[i..i + null_terminated.len()] == null_terminated[..] {
                findings.push(DangerousFinding {
                    function: func_info.name.to_string(),
                    offset: i as u64,
                    vaddr: base_addr + i as u64,
                    severity: clone_severity(&func_info.severity),
                    category: func_info.category.to_string(),
                    description: func_info.description.to_string(),
                });
            }
        }
    }

    findings
}

fn scan_call_targets(data: &[u8], base_addr: u64, arch: ArchMode) -> anyhow::Result<Vec<DangerousFinding>> {
    let mut findings = Vec::new();
    let max_insns = (data.len() / 2).min(500_000);
    let insns = crate::disasm::disassemble(data, base_addr, arch, 0, max_insns)?;

    let func_names: Vec<&str> = DANGEROUS_FUNCTIONS.iter().map(|f| f.name).collect();

    for insn in &insns {
        let mnemonic = insn.mnemonic.to_lowercase();
        if mnemonic.starts_with("bl") || mnemonic == "call" || mnemonic == "rcall" || mnemonic == "icall" {
            let op_str = insn.op_str.to_lowercase();
            for &func_name in &func_names {
                if op_str.contains(func_name) {
                    if let Some(info) = DANGEROUS_FUNCTIONS.iter().find(|f| f.name == func_name) {
                        findings.push(DangerousFinding {
                            function: info.name.to_string(),
                            offset: insn.address - base_addr,
                            vaddr: insn.address,
                            severity: clone_severity(&info.severity),
                            category: info.category.to_string(),
                            description: info.description.to_string(),
                        });
                    }
                }
            }
        }
    }

    Ok(findings)
}

fn clone_severity(s: &Severity) -> Severity {
    match s {
        Severity::Critical => Severity::Critical,
        Severity::High => Severity::High,
        Severity::Medium => Severity::Medium,
        Severity::Low => Severity::Low,
    }
}
