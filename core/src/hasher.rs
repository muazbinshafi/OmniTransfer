//! BLAKE3 Hashing
//!
//! Computes per-chunk hashes and a root hash for the entire file using
//! BLAKE3's tree mode. The root hash is exchanged in `TransferRequest`
//! and re-verified by the receiver after the final chunk is written.

use crate::Result;

/// Compute the BLAKE3 root hash of a complete file buffer.
/// Returns a 32-byte raw hash.
pub fn file_hash(data: &[u8]) -> [u8; 32] {
    *blake3::hash(data).as_bytes()
}

/// Compute the BLAKE3 hash of a single chunk.
pub fn chunk_hash(chunk_id: u32, data: &[u8]) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(&chunk_id.to_le_bytes());
    hasher.update(data);
    *hasher.finalize().as_bytes()
}

/// Build a BLAKE3 Merkle tree over all chunks.
/// Returns a vector of per-chunk hashes and the tree root.
///
/// The tree is built bottom-up: adjacent hashes are combined with a
/// parent node hash until a single root remains. If the number of
/// leaves is odd the last leaf is promoted without pairing.
pub fn merkle_tree(chunks: &[&[u8]]) -> ([u8; 32], Vec<[u8; 32]>) {
    let leaves: Vec<[u8; 32]> = chunks
        .iter()
        .enumerate()
        .map(|(i, c)| chunk_hash(i as u32, c))
        .collect();

    let root = if leaves.is_empty() {
        [0u8; 32]
    } else {
        reduce_tree(&leaves)
    };

    (root, leaves)
}

fn reduce_tree(nodes: &[[u8; 32]]) -> [u8; 32] {
    if nodes.len() == 1 {
        return nodes[0];
    }
    let mut parents = Vec::with_capacity((nodes.len() + 1) / 2);
    for pair in nodes.chunks(2) {
        if pair.len() == 2 {
            let mut hasher = blake3::Hasher::new();
            hasher.update(&pair[0]);
            hasher.update(&pair[1]);
            parents.push(*hasher.finalize().as_bytes());
        } else {
            parents.push(pair[0]);
        }
    }
    reduce_tree(&parents)
}

/// Verify a received file against its expected root hash.
pub fn verify(data: &[u8], expected_root: &[u8; 32]) -> Result<()> {
    let actual = file_hash(data);
    if actual != *expected_root {
        return Err(crate::OmniError::Verification {
            expected: hex(expected_root),
            actual: hex(&actual),
        });
    }
    Ok(())
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_verify() {
        let data = b"hello omnitransfer";
        let root = file_hash(data);
        assert!(verify(data, &root).is_ok());
    }

    #[test]
    fn merkle_two_chunks() {
        let a = b"chunk_a".as_slice();
        let b = b"chunk_b".as_slice();
        let (root, leaves) = merkle_tree(&[a, b]);
        assert_eq!(leaves.len(), 2);
        assert_ne!(root, [0u8; 32]);
    }

    #[test]
    fn wrong_hash_fails() {
        let data = b"hello";
        let bad_root = [0xffu8; 32];
        assert!(verify(data, &bad_root).is_err());
    }
}
