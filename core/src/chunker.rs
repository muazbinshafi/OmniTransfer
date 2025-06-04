//! Adaptive File Chunker
//!
//! Splits a file into fixed-size chunks for parallel transmission.
//! The final chunk may be smaller than `chunk_size`.
//!
//! Default chunk size: 16 MB — chosen to balance memory pressure and
//! retransmission cost on lossy links.

use std::ops::Range;

/// Descriptor for a single chunk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk {
    pub chunk_id: u32,
    pub byte_range: Range<u64>,
}

impl Chunk {
    pub fn offset(&self) -> u64 {
        self.byte_range.start
    }

    pub fn length(&self) -> u64 {
        self.byte_range.end - self.byte_range.start
    }
}

/// Splits `file_size` bytes into chunks of at most `chunk_size` bytes.
///
/// # Panics
/// Panics if `chunk_size` is 0.
pub fn split(file_size: u64, chunk_size: u32) -> Vec<Chunk> {
    assert!(chunk_size > 0, "chunk_size must be > 0");
    let cs = chunk_size as u64;
    let total = file_size.div_ceil(cs) as u32;

    (0..total)
        .map(|i| {
            let start = i as u64 * cs;
            let end = (start + cs).min(file_size);
            Chunk { chunk_id: i, byte_range: start..end }
        })
        .collect()
}

/// Returns the number of FEC repair chunks needed for `total_data_chunks`
/// at a 5% redundancy rate (minimum 1 repair chunk).
pub fn fec_repair_count(total_data_chunks: usize) -> usize {
    ((total_data_chunks as f64 * 0.05).ceil() as usize).max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_multiple() {
        let chunks = split(32 * 1024 * 1024, 16 * 1024 * 1024);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].length(), 16 * 1024 * 1024);
        assert_eq!(chunks[1].length(), 16 * 1024 * 1024);
    }

    #[test]
    fn remainder_chunk() {
        let chunks = split(33 * 1024 * 1024, 16 * 1024 * 1024);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[2].length(), 1024 * 1024);
    }

    #[test]
    fn single_chunk_file() {
        let chunks = split(1024, 16 * 1024 * 1024);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].length(), 1024);
    }

    #[test]
    fn empty_file() {
        let chunks = split(0, 16 * 1024 * 1024);
        assert!(chunks.is_empty());
    }

    #[test]
    fn fec_counts() {
        assert_eq!(fec_repair_count(20), 1);
        assert_eq!(fec_repair_count(100), 5);
        assert_eq!(fec_repair_count(0), 1); // minimum 1
    }
}
