use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrashInfo {
    pub id: String,
    pub input_data: Vec<u8>,
    pub input_hash: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub signal: Option<i32>,
    pub registers: RegisterState,
    pub call_stack: Vec<StackFrame>,
    pub stack_hash: String,
    pub coverage: Option<crate::coverage::Coverage>,
    pub crash_type: CrashType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterState {
    pub rax: u64,
    pub rbx: u64,
    pub rcx: u64,
    pub rdx: u64,
    pub rsi: u64,
    pub rdi: u64,
    pub rbp: u64,
    pub rsp: u64,
    pub r8: u64,
    pub r9: u64,
    pub r10: u64,
    pub r11: u64,
    pub r12: u64,
    pub r13: u64,
    pub r14: u64,
    pub r15: u64,
    pub rip: u64,
    pub eflags: u64,
}

impl Default for RegisterState {
    fn default() -> Self {
        Self {
            rax: 0, rbx: 0, rcx: 0, rdx: 0,
            rsi: 0, rdi: 0, rbp: 0, rsp: 0,
            r8: 0, r9: 0, r10: 0, r11: 0,
            r12: 0, r13: 0, r14: 0, r15: 0,
            rip: 0, eflags: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackFrame {
    pub address: u64,
    pub function: Option<String>,
    pub file: Option<String>,
    pub line: Option<u32>,
    pub module: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CrashType {
    SegmentationFault,
    IllegalInstruction,
    BusError,
    FloatingPointException,
    Abort,
    Unknown,
}

impl CrashType {
    pub fn from_signal(signal: i32) -> Self {
        match signal {
            11 => CrashType::SegmentationFault,
            4 => CrashType::IllegalInstruction,
            7 => CrashType::BusError,
            8 => CrashType::FloatingPointException,
            6 => CrashType::Abort,
            _ => CrashType::Unknown,
        }
    }

    pub fn to_string(&self) -> &str {
        match self {
            CrashType::SegmentationFault => "Segmentation Fault (SIGSEGV)",
            CrashType::IllegalInstruction => "Illegal Instruction (SIGILL)",
            CrashType::BusError => "Bus Error (SIGBUS)",
            CrashType::FloatingPointException => "Floating Point Exception (SIGFPE)",
            CrashType::Abort => "Abort (SIGABRT)",
            CrashType::Unknown => "Unknown",
        }
    }
}

impl CrashInfo {
    pub fn new(input: &[u8], signal: i32) -> Self {
        let input_hash = Self::hash_input(input);
        let stack_hash = Self::compute_stack_hash(&[]);
        
        Self {
            id: format!("crash_{}", input_hash),
            input_data: input.to_vec(),
            input_hash,
            timestamp: chrono::Utc::now(),
            signal: Some(signal),
            registers: RegisterState::default(),
            call_stack: Vec::new(),
            stack_hash,
            coverage: None,
            crash_type: CrashType::from_signal(signal),
        }
    }

    fn hash_input(input: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(input);
        let result = hasher.finalize();
        hex::encode(&result[..16])
    }

    pub fn compute_stack_hash(stack: &[StackFrame]) -> String {
        let mut hasher = Sha256::new();
        for frame in stack {
            hasher.update(frame.address.to_le_bytes());
        }
        let result = hasher.finalize();
        hex::encode(&result[..16])
    }

    pub fn with_registers(mut self, regs: RegisterState) -> Self {
        self.registers = regs;
        self
    }

    pub fn with_call_stack(mut self, stack: Vec<StackFrame>) -> Self {
        self.stack_hash = Self::compute_stack_hash(&stack);
        self.call_stack = stack;
        self
    }

    pub fn with_coverage(mut self, coverage: crate::coverage::Coverage) -> Self {
        self.coverage = Some(coverage);
        self
    }

    pub fn save<P: AsRef<Path>>(&self, dir: P) -> Result<PathBuf> {
        let dir = dir.as_ref();
        fs::create_dir_all(dir)?;

        let crash_dir = dir.join(&self.id);
        fs::create_dir_all(&crash_dir)?;

        let mut input_file = File::create(crash_dir.join("input.bin"))?;
        input_file.write_all(&self.input_data)?;

        let report = self.generate_report()?;
        let mut report_file = File::create(crash_dir.join("report.txt"))?;
        report_file.write_all(report.as_bytes())?;

        let json = serde_json::to_string_pretty(self)?;
        let mut json_file = File::create(crash_dir.join("info.json"))?;
        json_file.write_all(json.as_bytes())?;

        Ok(crash_dir)
    }

    pub fn generate_report(&self) -> Result<String> {
        let mut report = String::new();

        report.push_str("========================================\n");
        report.push_str("          CRASH REPORT\n");
        report.push_str("========================================\n\n");

        report.push_str(&format!("Crash ID: {}\n", self.id));
        report.push_str(&format!("Timestamp: {}\n", self.timestamp));
        report.push_str(&format!("Crash Type: {}\n", self.crash_type.to_string()));
        if let Some(sig) = self.signal {
            report.push_str(&format!("Signal: {}\n", sig));
        }
        report.push_str(&format!("Input Length: {} bytes\n", self.input_data.len()));
        report.push_str(&format!("Input Hash: {}\n\n", self.input_hash));

        report.push_str("----------------------------------------\n");
        report.push_str("Register State:\n");
        report.push_str("----------------------------------------\n");
        report.push_str(&format!("  RAX: {:#018x}  RBX: {:#018x}\n", self.registers.rax, self.registers.rbx));
        report.push_str(&format!("  RCX: {:#018x}  RDX: {:#018x}\n", self.registers.rcx, self.registers.rdx));
        report.push_str(&format!("  RSI: {:#018x}  RDI: {:#018x}\n", self.registers.rsi, self.registers.rdi));
        report.push_str(&format!("  RBP: {:#018x}  RSP: {:#018x}\n", self.registers.rbp, self.registers.rsp));
        report.push_str(&format!("  R8:  {:#018x}  R9:  {:#018x}\n", self.registers.r8, self.registers.r9));
        report.push_str(&format!("  R10: {:#018x}  R11: {:#018x}\n", self.registers.r10, self.registers.r11));
        report.push_str(&format!("  R12: {:#018x}  R13: {:#018x}\n", self.registers.r12, self.registers.r13));
        report.push_str(&format!("  R14: {:#018x}  R15: {:#018x}\n", self.registers.r14, self.registers.r15));
        report.push_str(&format!("  RIP: {:#018x}  EFLAGS: {:#010x}\n\n", self.registers.rip, self.registers.eflags));

        report.push_str("----------------------------------------\n");
        report.push_str("Call Stack:\n");
        report.push_str("----------------------------------------\n");
        for (i, frame) in self.call_stack.iter().enumerate() {
            let func_name = frame.function.as_deref().unwrap_or("unknown");
            let file_info = match (&frame.file, frame.line) {
                (Some(f), Some(l)) => format!(" ({}:{})", f, l),
                (Some(f), None) => format!(" ({})", f),
                _ => String::new(),
            };
            let module_info = frame.module.as_deref().unwrap_or("");
            report.push_str(&format!("  #{:<3} {:#018x} {} {} {}\n", 
                i, frame.address, func_name, module_info, file_info));
        }
        report.push('\n');

        report.push_str("----------------------------------------\n");
        report.push_str("Stack Hash: ");
        report.push_str(&self.stack_hash);
        report.push_str("\n----------------------------------------\n\n");

        if let Some(cov) = &self.coverage {
            report.push_str("----------------------------------------\n");
            report.push_str("Coverage Information:\n");
            report.push_str("----------------------------------------\n");
            report.push_str(&format!("  Blocks Covered: {}\n", cov.block_count));
            report.push_str(&format!("  Edges Covered: {}\n\n", cov.edge_count));
        }

        report.push_str("========================================\n");
        report.push_str("          END OF REPORT\n");
        report.push_str("========================================\n");

        Ok(report)
    }
}

pub struct CrashClassifier {
    crashes: Vec<CrashInfo>,
    groups: HashMap<String, Vec<usize>>,
}

impl CrashClassifier {
    pub fn new() -> Self {
        Self {
            crashes: Vec::new(),
            groups: HashMap::new(),
        }
    }

    pub fn add_crash(&mut self, crash: CrashInfo) {
        let hash = crash.stack_hash.clone();
        let idx = self.crashes.len();
        self.crashes.push(crash);
        self.groups.entry(hash).or_default().push(idx);
    }

    pub fn classify(&mut self) {
        self.groups.clear();
        
        for (idx, crash) in self.crashes.iter().enumerate() {
            let hash = crash.stack_hash.clone();
            self.groups.entry(hash).or_default().push(idx);
        }
    }

    pub fn groups(&self) -> &HashMap<String, Vec<usize>> {
        &self.groups
    }

    pub fn unique_crashes(&self) -> Vec<&CrashInfo> {
        self.groups.values()
            .filter_map(|indices| indices.first())
            .map(|&idx| &self.crashes[idx])
            .collect()
    }

    pub fn get_group(&self, hash: &str) -> Option<Vec<&CrashInfo>> {
        self.groups.get(hash)
            .map(|indices| indices.iter().map(|&i| &self.crashes[i]).collect())
    }

    pub fn total_count(&self) -> usize {
        self.crashes.len()
    }

    pub fn unique_count(&self) -> usize {
        self.groups.len()
    }

    pub fn save_unique<P: AsRef<Path>>(&self, dir: P) -> Result<usize> {
        let dir = dir.as_ref();
        let mut count = 0;

        for crash in self.unique_crashes() {
            crash.save(dir)?;
            count += 1;
        }

        Ok(count)
    }
}

impl Default for CrashClassifier {
    fn default() -> Self {
        Self::new()
    }
}

pub struct CrashMinimizer {
    target: String,
    timeout: u64,
    max_iterations: usize,
}

impl CrashMinimizer {
    pub fn new(target: String) -> Self {
        Self {
            target,
            timeout: 30,
            max_iterations: 1000,
        }
    }

    pub fn with_timeout(mut self, timeout: u64) -> Self {
        self.timeout = timeout;
        self
    }

    pub fn with_max_iterations(mut self, iterations: usize) -> Self {
        self.max_iterations = iterations;
        self
    }

    pub fn minimize(&self, input: &[u8]) -> Result<Vec<u8>> {
        if input.is_empty() {
            return Ok(input.to_vec());
        }

        let mut current = input.to_vec();
        let mut iteration = 0;

        if !self.test_input(&current)? {
            return Err(anyhow!("Original input does not trigger crash"));
        }

        iteration += self.minimize_binary(&mut current)?;

        iteration += self.minimize_by_bytes(&mut current)?;

        iteration += self.minimize_ddmax(&mut current)?;

        Ok(current)
    }

    fn minimize_binary(&self, input: &mut Vec<u8>) -> Result<usize> {
        let mut iterations = 0;
        let mut length = input.len();

        while length > 1 {
            let mid = length / 2;
            let test = &input[..mid];
            
            if self.test_input(test)? {
                *input = test.to_vec();
                length = mid;
            } else {
                break;
            }
            
            iterations += 1;
            if iterations >= self.max_iterations {
                break;
            }
        }

        Ok(iterations)
    }

    fn minimize_by_bytes(&self, input: &mut Vec<u8>) -> Result<usize> {
        let mut iterations = 0;
        let mut i = 0;

        while i < input.len() && iterations < self.max_iterations {
            let mut test = input.clone();
            test.remove(i);

            if self.test_input(&test)? {
                *input = test;
            } else {
                i += 1;
            }

            iterations += 1;
        }

        Ok(iterations)
    }

    fn minimize_ddmax(&self, input: &mut Vec<u8>) -> Result<usize> {
        let mut iterations = 0;
        let mut n = 2;

        while n <= input.len() && iterations < self.max_iterations {
            let mut chunk_size = input.len() / n;
            if chunk_size == 0 {
                chunk_size = 1;
            }

            let mut reduced = false;
            let mut i = 0;

            while i < input.len() && iterations < self.max_iterations {
                let end = (i + chunk_size).min(input.len());
                let mut test = input.clone();
                test.splice(i..end, std::iter::empty());

                if self.test_input(&test)? {
                    *input = test;
                    reduced = true;
                } else {
                    i += chunk_size;
                }

                iterations += 1;
            }

            if !reduced {
                n += 1;
            }
        }

        Ok(iterations)
    }

    fn test_input(&self, input: &[u8]) -> Result<bool> {
        use std::io::Write;
        use std::process::{Command, Stdio};

        let mut child = Command::new(&self.target)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;

        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(input);
        }

        let status = child.wait()?;

        if let Some(code) = status.code() {
            Ok(code != 0 && code < 128)
        } else {
            Ok(true)
        }
    }

    pub fn minimize_and_save<P: AsRef<Path>>(&self, input: &[u8], output: P) -> Result<Vec<u8>> {
        let minimized = self.minimize(input)?;
        
        let mut file = File::create(output)?;
        file.write_all(&minimized)?;

        Ok(minimized)
    }
}

pub struct CrashAnalyzer {
    classifier: CrashClassifier,
    output_dir: PathBuf,
}

impl CrashAnalyzer {
    pub fn new<P: AsRef<Path>>(output_dir: P) -> Self {
        Self {
            classifier: CrashClassifier::new(),
            output_dir: output_dir.as_ref().to_path_buf(),
        }
    }

    pub fn analyze(&mut self, crash: CrashInfo) -> Result<String> {
        let group_hash = crash.stack_hash.clone();
        self.classifier.add_crash(crash);
        Ok(group_hash)
    }

    pub fn analyze_directory<P: AsRef<Path>>(&mut self, dir: P) -> Result<usize> {
        let dir = dir.as_ref();
        let mut count = 0;

        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            
            if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("bin") {
                if let Ok(data) = fs::read(&path) {
                    let crash = CrashInfo::new(&data, 11);
                    self.classifier.add_crash(crash);
                    count += 1;
                }
            }
        }

        Ok(count)
    }

    pub fn generate_summary(&self) -> Result<String> {
        let mut summary = String::new();

        summary.push_str("========================================\n");
        summary.push_str("       CRASH ANALYSIS SUMMARY\n");
        summary.push_str("========================================\n\n");

        summary.push_str(&format!("Total Crashes: {}\n", self.classifier.total_count()));
        summary.push_str(&format!("Unique Crashes: {}\n\n", self.classifier.unique_count()));

        summary.push_str("Unique Crash Groups:\n");
        for (hash, indices) in self.classifier.groups() {
            summary.push_str(&format!("\n  Stack Hash: {}\n", hash));
            summary.push_str(&format!("  Count: {}\n", indices.len()));
            
            if let Some(&first_idx) = indices.first() {
                if let Some(crash) = self.classifier.crashes.get(first_idx) {
                    summary.push_str(&format!("  Type: {}\n", crash.crash_type.to_string()));
                }
            }
        }

        Ok(summary)
    }

    pub fn save_all(&self) -> Result<usize> {
        self.classifier.save_unique(&self.output_dir)
    }

    pub fn classifier(&self) -> &CrashClassifier {
        &self.classifier
    }
}
