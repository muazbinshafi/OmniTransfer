//! Reed-Solomon FEC (Forward Error Correction)
//!
//! Applies 5% redundancy over the final batch of data chunks so that any
//! single chunk loss can be recovered without a retransmit round-trip.
//!
//! Uses the `reed-solomon-erasure` crate which implements GF(2^8) arithmetic
//! over arbitrary shard sizes.
//!
//! # Protocol integration
//!
//! The sender computes `data_count` original shards and `parity_count` repair
//! shards, then transmits them all over separate CRUDP streams. The receiver
//! buffers incoming shards and calls `decode` once it has received at least
//! `data_count` total shards (original + repair).

use crate::{OmniError, Result};
use reed_solomon_erasure::galois_8::ReedSolomon;

pub struct FecEncoder {
    rs: ReedSolomon,
    data_count: usize,
    parity_count: usize,
}

impl FecEncoder {
    /// Create an encoder with explicit shard counts.
    /// `data_count` original shards + `parity_count` repair shards.
    ///
    /// For OmniTransfer's 5% rule use `parity_count = ceil(data_count * 0.05)`.
    pub fn new(data_count: usize, parity_count: usize) -> Result<Self> {
        let rs = ReedSolomon::new(data_count, parity_count)
            .map_err(|e| OmniError::Protocol(format!("RS init: {e}")))?;
        Ok(Self { rs, data_count, parity_count })
    }

    /// Encode `data_shards` into data + parity shards.
    ///
    /// All shards must be the same length. If the final shard is shorter it
    /// should be zero-padded by the caller.
    ///
    /// Returns a `Vec` of `data_count + parity_count` shard byte-vectors.
    pub fn encode(&self, data_shards: Vec<Vec<u8>>) -> Result<Vec<Vec<u8>>> {
        if data_shards.len() != self.data_count {
            return Err(OmniError::Protocol(format!(
                "FEC encode: expected {} shards, got {}",
                self.data_count,
                data_shards.len()
            )));
        }

        let shard_len = data_shards[0].len();
        let mut shards: Vec<Vec<u8>> = data_shards;
        // Append zeroed parity shards
        for _ in 0..self.parity_count {
            shards.push(vec![0u8; shard_len]);
        }

        self.rs
            .encode(&mut shards)
            .map_err(|e| OmniError::Protocol(format!("RS encode: {e}")))?;

        log::debug!(
            "fec: encoded {} data + {} parity shards ({} bytes each)",
            self.data_count,
            self.parity_count,
            shard_len
        );
        Ok(shards)
    }

    /// Reconstruct missing shards from received ones.
    ///
    /// `received` is a `Vec` of `Option<Vec<u8>>` where `None` indicates a
    /// missing shard. At least `data_count` entries must be `Some`.
    ///
    /// Returns the reconstructed data shards (parity shards are discarded).
    pub fn decode(&self, mut received: Vec<Option<Vec<u8>>>) -> Result<Vec<Vec<u8>>> {
        let present = received.iter().filter(|s| s.is_some()).count();
        if present < self.data_count {
            return Err(OmniError::FecDecode);
        }

        self.rs
            .reconstruct(&mut received)
            .map_err(|_| OmniError::FecDecode)?;

        let data_shards: Vec<Vec<u8>> = received
            .into_iter()
            .take(self.data_count)
            .map(|s| s.unwrap())
            .collect();

        log::debug!("fec: decoded {} data shards", self.data_count);
        Ok(data_shards)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_decode_no_loss() {
        let enc = FecEncoder::new(4, 1).unwrap();
        let shards: Vec<Vec<u8>> = (0..4).map(|i| vec![i as u8; 64]).collect();
        let original = shards.clone();
        let encoded = enc.encode(shards).unwrap();
        assert_eq!(encoded.len(), 5);

        let received: Vec<Option<Vec<u8>>> = encoded.into_iter().map(Some).collect();
        let decoded = enc.decode(received).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn recover_one_lost_shard() {
        let enc = FecEncoder::new(4, 1).unwrap();
        let shards: Vec<Vec<u8>> = (0..4).map(|i| vec![i as u8 + 1; 128]).collect();
        let original = shards.clone();
        let encoded = enc.encode(shards).unwrap();

        // Drop shard 2
        let mut received: Vec<Option<Vec<u8>>> = encoded.into_iter().map(Some).collect();
        received[2] = None;

        let decoded = enc.decode(received).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn too_many_losses_fails() {
        let enc = FecEncoder::new(4, 1).unwrap();
        let shards: Vec<Vec<u8>> = (0..4).map(|i| vec![i as u8; 64]).collect();
        let encoded = enc.encode(shards).unwrap();

        // Drop 2 shards — only 1 parity, can't recover
        let mut received: Vec<Option<Vec<u8>>> = encoded.into_iter().map(Some).collect();
        received[0] = None;
        received[1] = None;

        assert!(enc.decode(received).is_err());
    }
}
