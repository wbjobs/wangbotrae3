use std::collections::HashSet;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::{Arc, Mutex};
use anyhow::{anyhow, Result};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Coverage {
    pub edges: HashSet<u64>,
    pub blocks: HashSet<u64>,
    pub edge_count: u64,
    pub block_count: u64,
}

impl Coverage {
    pub fn new() -> Self {
        Self {
            edges: HashSet::new(),
            blocks: HashSet::new(),
            edge_count: 0,
            block_count: 0,
        }
    }

    pub fn add_edge(&mut self, edge: u64) {
        if self.edges.insert(edge) {
            self.edge_count += 1;
        }
    }

    pub fn add_block(&mut self, block: u64) {
        if self.blocks.insert(block) {
            self.block_count += 1;
        }
    }

    pub fn merge(&mut self, other: &Coverage) {
        self.edges.extend(&other.edges);
        self.blocks.extend(&other.blocks);
        self.edge_count = self.edges.len() as u64;
        self.block_count = self.blocks.len() as u64;
    }

    pub fn has_new_coverage(&self, other: &Coverage) -> bool {
        !other.edges.is_subset(&self.edges) || !other.blocks.is_subset(&self.blocks)
    }

    pub fn compute_hash(&self) -> String {
        let mut hasher = Sha256::new();
        let mut edges: Vec<u64> = self.edges.iter().cloned().collect();
        edges.sort();
        for edge in edges {
            hasher.update(edge.to_le_bytes());
        }
        let result = hasher.finalize();
        hex::encode(&result[..8])
    }
}

impl Default for Coverage {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone)]
pub enum CoverageBackend {
    Qemu,
    IntelPT,
    SanitizerCoverage,
}

pub struct CoverageCollector {
    backend: CoverageBackend,
    shared_coverage: Arc<Mutex<Coverage>>,
    qemu_plugin_path: Option<String>,
    pt_buffer_size: usize,
}

impl CoverageCollector {
    pub fn new(backend: CoverageBackend) -> Self {
        Self {
            backend,
            shared_coverage: Arc::new(Mutex::new(Coverage::new())),
            qemu_plugin_path: None,
            pt_buffer_size: 4096,
        }
    }

    pub fn with_qemu_plugin(mut self, plugin_path: String) -> Self {
        self.qemu_plugin_path = Some(plugin_path);
        self
    }

    pub fn with_pt_buffer(mut self, size: usize) -> Self {
        self.pt_buffer_size = size;
        self
    }

    pub fn get_coverage(&self) -> Coverage {
        self.shared_coverage.lock().unwrap().clone()
    }

    pub fn merge_coverage(&self, new_coverage: &Coverage) -> bool {
        let mut global = self.shared_coverage.lock().unwrap();
        let has_new = global.has_new_coverage(new_coverage);
        global.merge(new_coverage);
        has_new
    }

    pub fn parse_coverage_data(&self, data: &[u8]) -> Result<Coverage> {
        match self.backend {
            CoverageBackend::Qemu => self.parse_qemu_coverage(data),
            CoverageBackend::IntelPT => self.parse_pt_coverage(data),
            CoverageBackend::SanitizerCoverage => self.parse_sancov_coverage(data),
        }
    }

    fn parse_qemu_coverage(&self, data: &[u8]) -> Result<Coverage> {
        let mut coverage = Coverage::new();
        
        if data.len() < 8 {
            return Ok(coverage);
        }

        let mut offset = 0;
        while offset + 8 <= data.len() {
            let edge = u64::from_le_bytes(data[offset..offset + 8].try_into()?);
            coverage.add_edge(edge);
            offset += 8;
        }

        Ok(coverage)
    }

    fn parse_pt_coverage(&self, data: &[u8]) -> Result<Coverage> {
        let mut coverage = Coverage::new();
        
        if data.len() < 16 {
            return Ok(coverage);
        }

        let mut offset = 0;
        while offset + 16 <= data.len() {
            let from = u64::from_le_bytes(data[offset..offset + 8].try_into()?);
            let to = u64::from_le_bytes(data[offset + 8..offset + 16].try_into()?);
            let edge = (from << 32) | (to & 0xFFFFFFFF);
            coverage.add_edge(edge);
            coverage.add_block(from);
            coverage.add_block(to);
            offset += 16;
        }

        Ok(coverage)
    }

    fn parse_sancov_coverage(&self, data: &[u8]) -> Result<Coverage> {
        let mut coverage = Coverage::new();
        
        if data.len() < 8 {
            return Ok(coverage);
        }

        let mut offset = 0;
        while offset + 8 <= data.len() {
            let pc = u64::from_le_bytes(data[offset..offset + 8].try_into()?);
            coverage.add_block(pc);
            offset += 8;
        }

        Ok(coverage)
    }

    pub fn load_coverage_from_file<P: AsRef<Path>>(&self, path: P) -> Result<Coverage> {
        let mut file = File::open(path)?;
        let mut data = Vec::new();
        file.read_to_end(&mut data)?;
        self.parse_coverage_data(&data)
    }

    pub fn build_qemu_command(&self, target: &str, args: &[String]) -> Result<Vec<String>> {
        let mut cmd = Vec::new();
        
        match self.backend {
            CoverageBackend::Qemu => {
                cmd.push("qemu-x86_64".to_string());
                if let Some(plugin) = &self.qemu_plugin_path {
                    cmd.push("-plugin".to_string());
                    cmd.push(format!("{},file=/tmp/coverage_{}.bin", 
                        plugin, std::process::id()));
                }
                cmd.push(target.to_string());
                cmd.extend(args.iter().cloned());
            }
            CoverageBackend::IntelPT => {
                cmd.push("perf".to_string());
                cmd.push("record".to_string());
                cmd.push("-e".to_string());
                cmd.push("intel_pt//u".to_string());
                cmd.push("-o".to_string());
                cmd.push(format!("/tmp/pt_trace_{}.data", std::process::id()));
                cmd.push(target.to_string());
                cmd.extend(args.iter().cloned());
            }
            CoverageBackend::SanitizerCoverage => {
                cmd.push(target.to_string());
                cmd.extend(args.iter().cloned());
            }
        }

        Ok(cmd)
    }
}

pub struct CoverageBitmap {
    bitmap: Vec<u8>,
    size: usize,
}

impl CoverageBitmap {
    pub fn new(size: usize) -> Self {
        Self {
            bitmap: vec![0; size],
            size,
        }
    }

    pub fn update(&mut self, index: usize, value: u8) -> bool {
        if index >= self.size {
            return false;
        }
        
        let prev = self.bitmap[index];
        let new = prev | value;
        if prev != new {
            self.bitmap[index] = new;
            true
        } else {
            false
        }
    }

    pub fn count_covered(&self) -> usize {
        self.bitmap.iter().filter(|&&b| b != 0).count()
    }

    pub fn get_hash(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(&self.bitmap);
        let result = hasher.finalize();
        hex::encode(&result[..16])
    }

    pub fn as_slice(&self) -> &[u8] {
        &self.bitmap
    }
}
