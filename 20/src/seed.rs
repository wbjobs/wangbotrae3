use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use anyhow::{anyhow, Result};
use pcap_parser::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Seed {
    pub data: Vec<u8>,
    pub filename: String,
    pub length: usize,
    pub coverage_hash: Option<String>,
    pub metadata: SeedMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedMetadata {
    pub protocol: Option<String>,
    pub source: SeedSource,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub fuzzed_count: u64,
    pub crash_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SeedSource {
    Pcap,
    Manual,
    Generated,
    Mutation,
    Crashed,
}

impl Seed {
    pub fn new(data: Vec<u8>, filename: String) -> Self {
        let length = data.len();
        Self {
            data,
            filename,
            length,
            coverage_hash: None,
            metadata: SeedMetadata {
                protocol: None,
                source: SeedSource::Manual,
                timestamp: chrono::Utc::now(),
                fuzzed_count: 0,
                crash_count: 0,
            },
        }
    }

    pub fn from_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let path = path.as_ref();
        let mut file = File::open(path)?;
        let mut data = Vec::new();
        file.read_to_end(&mut data)?;
        
        let filename = path.file_name()
            .ok_or_else(|| anyhow!("Invalid filename"))?
            .to_string_lossy()
            .to_string();

        Ok(Self::new(data, filename))
    }

    pub fn save<P: AsRef<Path>>(&self, dir: P) -> Result<PathBuf> {
        let dir = dir.as_ref();
        fs::create_dir_all(dir)?;
        
        let filepath = dir.join(&self.filename);
        let mut file = File::create(&filepath)?;
        file.write_all(&self.data)?;

        Ok(filepath)
    }
}

pub struct SeedManager {
    seeds: Vec<Seed>,
    input_dir: PathBuf,
    output_dir: PathBuf,
}

impl SeedManager {
    pub fn new<P: AsRef<Path>>(input_dir: P, output_dir: P) -> Result<Self> {
        let input_dir = input_dir.as_ref().to_path_buf();
        let output_dir = output_dir.as_ref().to_path_buf();
        
        fs::create_dir_all(&input_dir)?;
        fs::create_dir_all(&output_dir)?;

        Ok(Self {
            seeds: Vec::new(),
            input_dir,
            output_dir,
        })
    }

    pub fn load_seeds(&mut self) -> Result<usize> {
        self.seeds.clear();
        
        if !self.input_dir.exists() {
            return Ok(0);
        }

        for entry in fs::read_dir(&self.input_dir)? {
            let entry = entry?;
            let path = entry.path();
            
            if path.is_file() {
                match Seed::from_file(&path) {
                    Ok(seed) => self.seeds.push(seed),
                    Err(e) => log::warn!("Failed to load seed {:?}: {}", path, e),
                }
            }
        }

        Ok(self.seeds.len())
    }

    pub fn add_seed(&mut self, seed: Seed) {
        self.seeds.push(seed);
    }

    pub fn get_seed(&self, index: usize) -> Option<&Seed> {
        self.seeds.get(index)
    }

    pub fn get_random_seed(&self) -> Option<&Seed> {
        if self.seeds.is_empty() {
            return None;
        }
        
        use rand::Rng;
        let mut rng = rand::thread_rng();
        let idx = rng.gen_range(0..self.seeds.len());
        self.seeds.get(idx)
    }

    pub fn seeds(&self) -> &[Seed] {
        &self.seeds
    }

    pub fn count(&self) -> usize {
        self.seeds.len()
    }

    pub fn save_interesting(&mut self, seed: Seed) -> Result<PathBuf> {
        let path = seed.save(&self.output_dir)?;
        self.seeds.push(seed);
        Ok(path)
    }
}

pub struct PcapExtractor {
    filter_protocol: Option<String>,
    min_length: usize,
    max_length: usize,
    extract_payload: bool,
}

impl PcapExtractor {
    pub fn new() -> Self {
        Self {
            filter_protocol: None,
            min_length: 1,
            max_length: 65535,
            extract_payload: true,
        }
    }

    pub fn with_protocol(mut self, protocol: String) -> Self {
        self.filter_protocol = Some(protocol);
        self
    }

    pub fn with_min_length(mut self, min: usize) -> Self {
        self.min_length = min;
        self
    }

    pub fn with_max_length(mut self, max: usize) -> Self {
        self.max_length = max;
        self
    }

    pub fn extract_from_pcap<P: AsRef<Path>>(&self, pcap_path: P) -> Result<Vec<Seed>> {
        let pcap_path = pcap_path.as_ref();
        let mut file = File::open(pcap_path)?;
        let mut data = Vec::new();
        file.read_to_end(&mut data)?;

        let mut seeds = Vec::new();
        
        let mut parser = pcap_parser::pcap::PcapParser::new();
        let (rem, header) = parser.parse_header(&data)?;
        let mut current = rem;
        let mut packet_idx = 0;

        while current.len() > 16 {
            match parser.parse_packet(current) {
                Ok((rem, packet)) => {
                    if let Some(seed) = self.process_packet(&packet, packet_idx) {
                        seeds.push(seed);
                    }
                    current = rem;
                    packet_idx += 1;
                }
                Err(_) => break,
            }
        }

        if seeds.is_empty() {
            seeds = self.try_legacy_pcap(&data)?;
        }

        Ok(seeds)
    }

    fn process_packet(&self, packet: &pcap_parser::pcap::Packet, idx: u32) -> Option<Seed> {
        let data = packet.data;
        
        if data.len() < self.min_length || data.len() > self.max_length {
            return None;
        }

        let payload = if self.extract_payload {
            self.extract_application_payload(data)
        } else {
            data.to_vec()
        };

        if payload.len() < self.min_length {
            return None;
        }

        let mut seed = Seed::new(payload, format!("pcap_packet_{}.bin", idx));
        seed.metadata.source = SeedSource::Pcap;
        
        Some(seed)
    }

    fn extract_application_payload(&self, data: &[u8]) -> Vec<u8> {
        if data.len() < 14 {
            return data.to_vec();
        }

        match etherparse::PacketHeaders::from_ethernet_slice(data) {
            Ok(headers) => {
                if let Some(transport) = headers.transport {
                    match transport {
                        etherparse::TransportHeader::Tcp(tcp) => {
                            let payload_offset = headers.ip.as_ref()
                                .map(|ip| ip.header_len() + tcp.header_len())
                                .unwrap_or(54);
                            if data.len() > payload_offset {
                                return data[payload_offset..].to_vec();
                            }
                        }
                        etherparse::TransportHeader::Udp(udp) => {
                            let payload_offset = headers.ip.as_ref()
                                .map(|ip| ip.header_len() + 8)
                                .unwrap_or(42);
                            if data.len() > payload_offset {
                                return data[payload_offset..].to_vec();
                            }
                        }
                    }
                }
            }
            Err(_) => {}
        }

        data.to_vec()
    }

    fn try_legacy_pcap(&self, data: &[u8]) -> Result<Vec<Seed>> {
        let mut seeds = Vec::new();
        
        if data.len() < 24 {
            return Ok(seeds);
        }

        let magic = u32::from_le_bytes(data[0..4].try_into()?);
        if magic != 0xa1b2c3d4 && magic != 0xd4c3b2a1 {
            return Ok(seeds);
        }

        let mut offset = 24;
        let mut packet_idx = 0;

        while offset + 16 <= data.len() {
            let _ts_sec = u32::from_le_bytes(data[offset..offset + 4].try_into()?);
            let _ts_usec = u32::from_le_bytes(data[offset + 4..offset + 8].try_into()?);
            let incl_len = u32::from_le_bytes(data[offset + 8..offset + 12].try_into()?) as usize;
            let _orig_len = u32::from_le_bytes(data[offset + 12..offset + 16].try_into()?);

            offset += 16;

            if offset + incl_len > data.len() {
                break;
            }

            let packet_data = &data[offset..offset + incl_len];
            
            if packet_data.len() >= self.min_length && packet_data.len() <= self.max_length {
                let payload = if self.extract_payload {
                    self.extract_application_payload(packet_data)
                } else {
                    packet_data.to_vec()
                };

                if payload.len() >= self.min_length {
                    let mut seed = Seed::new(payload, format!("pcap_packet_{}.bin", packet_idx));
                    seed.metadata.source = SeedSource::Pcap;
                    seeds.push(seed);
                }
            }

            offset += incl_len;
            packet_idx += 1;
        }

        Ok(seeds)
    }

    pub fn extract_to_dir<P: AsRef<Path>>(&self, pcap_path: P, output_dir: P) -> Result<usize> {
        let output_dir = output_dir.as_ref();
        fs::create_dir_all(output_dir)?;

        let seeds = self.extract_from_pcap(pcap_path)?;
        let mut count = 0;

        for seed in seeds {
            match seed.save(output_dir) {
                Ok(_) => count += 1,
                Err(e) => log::warn!("Failed to save seed: {}", e),
            }
        }

        Ok(count)
    }
}

impl Default for PcapExtractor {
    fn default() -> Self {
        Self::new()
    }
}
