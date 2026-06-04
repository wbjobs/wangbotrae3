use rand::Rng;
use rand_chacha::ChaCha8Rng;
use rand::SeedableRng;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum MutationStrategy {
    BitFlip,
    ByteFlip,
    Arithmetic,
    InterestingValue,
    BoundaryValue,
    CrcCorruption,
    InsertByte,
    DeleteByte,
    DuplicateBlock,
    OverwriteBlock,
}

pub struct Mutator {
    rng: ChaCha8Rng,
    strategies: Vec<MutationStrategy>,
    max_mutations: usize,
    interesting_values: Vec<u64>,
}

impl Mutator {
    pub fn new(seed: u64) -> Self {
        let interesting_values = vec![
            0x00, 0x01, 0x7F, 0x80, 0xFF,
            0x0000, 0x0001, 0x7FFF, 0x8000, 0xFFFF,
            0x00000000, 0x00000001, 0x7FFFFFFF, 0x80000000, 0xFFFFFFFF,
            0x0000000000000000, 0x0000000000000001,
            0x7FFFFFFFFFFFFFFF, 0x8000000000000000, 0xFFFFFFFFFFFFFFFF,
        ];

        Self {
            rng: ChaCha8Rng::seed_from_u64(seed),
            strategies: vec![
                MutationStrategy::BitFlip,
                MutationStrategy::ByteFlip,
                MutationStrategy::Arithmetic,
                MutationStrategy::InterestingValue,
                MutationStrategy::BoundaryValue,
                MutationStrategy::CrcCorruption,
                MutationStrategy::InsertByte,
                MutationStrategy::DeleteByte,
                MutationStrategy::DuplicateBlock,
                MutationStrategy::OverwriteBlock,
            ],
            max_mutations: 10,
            interesting_values,
        }
    }

    pub fn with_strategies(mut self, strategies: Vec<MutationStrategy>) -> Self {
        self.strategies = strategies;
        self
    }

    pub fn with_max_mutations(mut self, max: usize) -> Self {
        self.max_mutations = max;
        self
    }

    pub fn mutate(&mut self, data: &[u8]) -> Vec<u8> {
        if data.is_empty() {
            return vec![0];
        }

        let mut result = data.to_vec();
        let num_mutations = self.rng.gen_range(1..=self.max_mutations.max(1));

        for _ in 0..num_mutations {
            let strategy_idx = self.rng.gen_range(0..self.strategies.len());
            self.apply_strategy(self.strategies[strategy_idx], &mut result);
        }

        result
    }

    fn apply_strategy(&mut self, strategy: MutationStrategy, data: &mut Vec<u8>) {
        match strategy {
            MutationStrategy::BitFlip => self.bit_flip(data),
            MutationStrategy::ByteFlip => self.byte_flip(data),
            MutationStrategy::Arithmetic => self.arithmetic_mutate(data),
            MutationStrategy::InterestingValue => self.interesting_value(data),
            MutationStrategy::BoundaryValue => self.boundary_value(data),
            MutationStrategy::CrcCorruption => self.crc_corruption(data),
            MutationStrategy::InsertByte => self.insert_byte(data),
            MutationStrategy::DeleteByte => self.delete_byte(data),
            MutationStrategy::DuplicateBlock => self.duplicate_block(data),
            MutationStrategy::OverwriteBlock => self.overwrite_block(data),
        }
    }

    fn bit_flip(&mut self, data: &mut Vec<u8>) {
        if data.is_empty() {
            return;
        }

        let idx = self.rng.gen_range(0..data.len());
        let bit = self.rng.gen_range(0..8);
        data[idx] ^= 1 << bit;
    }

    fn byte_flip(&mut self, data: &mut Vec<u8>) {
        if data.is_empty() {
            return;
        }

        let idx = self.rng.gen_range(0..data.len());
        data[idx] = self.rng.gen();
    }

    fn arithmetic_mutate(&mut self, data: &mut Vec<u8>) {
        if data.len() < 1 {
            return;
        }

        let idx = self.rng.gen_range(0..data.len());
        let delta: i32 = self.rng.gen_range(-32..=32);
        
        let val = data[idx] as i32 + delta;
        data[idx] = val.clamp(0, 255) as u8;
    }

    fn interesting_value(&mut self, data: &mut Vec<u8>) {
        if data.is_empty() {
            return;
        }

        let value_idx = self.rng.gen_range(0..self.interesting_values.len());
        let value = self.interesting_values[value_idx];
        
        let sizes = [1, 2, 4, 8];
        let size_idx = self.rng.gen_range(0..sizes.len());
        let size = sizes[size_idx];
        
        let max_idx = if data.len() > size { data.len() - size } else { 0 };
        let idx = self.rng.gen_range(0..=max_idx);

        let bytes = value.to_le_bytes();
        for i in 0..size.min(data.len() - idx) {
            data[idx + i] = bytes[i];
        }
    }

    fn boundary_value(&mut self, data: &mut Vec<u8>) {
        if data.is_empty() {
            return;
        }

        let boundaries = [
            0x00, 0x01, 0x7F, 0x80, 0xFF,
            b'\n', b'\r', b'\t', b' ',
            b'0', b'9', b'A', b'Z', b'a', b'z',
        ];

        let idx = self.rng.gen_range(0..data.len());
        let boundary_idx = self.rng.gen_range(0..boundaries.len());
        data[idx] = boundaries[boundary_idx];
    }

    fn crc_corruption(&mut self, data: &mut Vec<u8>) {
        if data.len() < 4 {
            return;
        }

        let positions = [0, data.len() / 2, data.len() - 4];
        let pos_idx = self.rng.gen_range(0..positions.len());
        let idx = positions[pos_idx].min(data.len() - 4);

        for i in 0..4 {
            data[idx + i] = self.rng.gen();
        }
    }

    fn insert_byte(&mut self, data: &mut Vec<u8>) {
        if data.len() >= 65535 {
            return;
        }

        let idx = self.rng.gen_range(0..=data.len());
        let byte: u8 = self.rng.gen();
        data.insert(idx, byte);
    }

    fn delete_byte(&mut self, data: &mut Vec<u8>) {
        if data.len() <= 1 {
            return;
        }

        let idx = self.rng.gen_range(0..data.len());
        data.remove(idx);
    }

    fn duplicate_block(&mut self, data: &mut Vec<u8>) {
        if data.len() >= 65535 {
            return;
        }

        let block_size = self.rng.gen_range(1..=32.min(data.len()));
        let src_idx = self.rng.gen_range(0..=data.len() - block_size);
        let dst_idx = self.rng.gen_range(0..=data.len());

        let block: Vec<u8> = data[src_idx..src_idx + block_size].to_vec();
        data.splice(dst_idx..dst_idx, block);
    }

    fn overwrite_block(&mut self, data: &mut Vec<u8>) {
        if data.is_empty() {
            return;
        }

        let block_size = self.rng.gen_range(1..=16.min(data.len()));
        let idx = self.rng.gen_range(0..=data.len() - block_size);

        for i in 0..block_size {
            data[idx + i] = self.rng.gen();
        }
    }

    pub fn mutate_havoc(&mut self, data: &[u8]) -> Vec<u8> {
        if data.is_empty() {
            return vec![0];
        }

        let mut result = data.to_vec();
        let iterations = self.rng.gen_range(16..=128);

        for _ in 0..iterations {
            let strategy_idx = self.rng.gen_range(0..self.strategies.len());
            self.apply_strategy(self.strategies[strategy_idx], &mut result);
        }

        result
    }

    pub fn mutate_splice(&mut self, data1: &[u8], data2: &[u8]) -> Vec<u8> {
        if data1.is_empty() || data2.is_empty() {
            return data1.to_vec();
        }

        let split1 = self.rng.gen_range(0..data1.len());
        let split2 = self.rng.gen_range(0..data2.len());

        let mut result = Vec::with_capacity(split1 + data2.len() - split2);
        result.extend_from_slice(&data1[..split1]);
        result.extend_from_slice(&data2[split2..]);

        result
    }
}

pub fn calculate_crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFFFFFFu32;
    
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xEDB88320;
            } else {
                crc >>= 1;
            }
        }
    }
    
    !crc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bit_flip() {
        let mut mutator = Mutator::new(42);
        let data = vec![0x00, 0xFF, 0xAA];
        let mutated = mutator.mutate(&data);
        assert!(!mutated.is_empty());
        assert_ne!(mutated, data);
    }

    #[test]
    fn test_crc32() {
        let data = b"123456789";
        let crc = calculate_crc32(data);
        assert_eq!(crc, 0xCBF43926);
    }

    #[test]
    fn test_splice() {
        let mut mutator = Mutator::new(42);
        let data1 = vec![1, 2, 3, 4, 5];
        let data2 = vec![10, 11, 12, 13, 14];
        let spliced = mutator.mutate_splice(&data1, &data2);
        assert!(!spliced.is_empty());
    }
}
