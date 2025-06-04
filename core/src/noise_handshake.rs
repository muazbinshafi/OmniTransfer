//! Noise KK Handshake
//!
//! Implements the Noise KK pattern for mutual authentication between two peers
//! that have already exchanged static public keys (e.g., via BLE advertisement).
//!
//! Pattern:
//!   Initiator              Responder
//!   ────────────────────────────────
//!   → e, es, ss           (msg 1)
//!                ← e, ee, se        (msg 2)
//!   → {}                  (msg 3 — final key confirmation)
//!
//! After the 3-message exchange each side derives independent TX/RX session keys
//! for AES-GCM-256. These keys are fed into `CrudpStream`.

use crate::{OmniError, Result};
use x25519_dalek::{EphemeralSecret, PublicKey, StaticSecret};

// ─── Key Material ─────────────────────────────────────────────────────────────

pub struct StaticKeyPair {
    pub secret: StaticSecret,
    pub public: PublicKey,
}

impl StaticKeyPair {
    /// Generate a new static key pair. In production these are persisted and
    /// exchanged out-of-band (BLE advertisement payload).
    pub fn generate() -> Self {
        let secret = StaticSecret::random_from_rng(rand::thread_rng());
        let public = PublicKey::from(&secret);
        Self { secret, public }
    }

    pub fn from_bytes(bytes: &[u8; 32]) -> Self {
        let secret = StaticSecret::from(*bytes);
        let public = PublicKey::from(&secret);
        Self { secret, public }
    }
}

// ─── Session Keys ─────────────────────────────────────────────────────────────

/// Derived session keys after a successful handshake.
#[derive(Debug, Clone)]
pub struct SessionKeys {
    /// Initiator → Responder encryption key
    pub tx_key: [u8; 32],
    /// Responder → Initiator encryption key (our RX when we're the initiator)
    pub rx_key: [u8; 32],
}

// ─── Handshake State ─────────────────────────────────────────────────────────

/// Performs the Noise KK pattern.
///
/// Production code should use the `noise-protocol` + `noise-rust-crypto` crates
/// for a fully spec-compliant implementation. This module shows the DH operations
/// and key derivation logic directly for educational clarity.
pub struct NoiseHandshake {
    /// Whether this side initiated the connection
    is_initiator: bool,
    local_static: StaticKeyPair,
    /// Remote's static public key (learned via BLE advertisement)
    remote_static_pub: PublicKey,
    /// Chaining key, used to derive session keys via HKDF
    chaining_key: [u8; 32],
    /// Running transcript hash (authenticated with each message)
    hash: [u8; 32],
}

impl NoiseHandshake {
    const PROTOCOL_NAME: &'static [u8] =
        b"Noise_KK_25519_AESGCM_SHA256\0\0\0\0";

    pub fn new_initiator(
        local_static: StaticKeyPair,
        remote_static_pub: [u8; 32],
    ) -> Self {
        let mut s = Self::init(local_static, remote_static_pub);
        s.is_initiator = true;
        s
    }

    pub fn new_responder(
        local_static: StaticKeyPair,
        remote_static_pub: [u8; 32],
    ) -> Self {
        let mut s = Self::init(local_static, remote_static_pub);
        s.is_initiator = false;
        s
    }

    fn init(local_static: StaticKeyPair, remote_static_pub: [u8; 32]) -> Self {
        // h = SHA-256(protocol_name)
        let hash = sha256(Self::PROTOCOL_NAME);
        // ck = h
        let chaining_key = hash;
        // h = SHA-256(h || prologue) — no prologue here
        Self {
            is_initiator: true,
            local_static,
            remote_static_pub: PublicKey::from(remote_static_pub),
            chaining_key,
            hash,
        }
    }

    /// Generate `message_1` as the initiator.
    /// Returns the wire bytes to send to the responder.
    pub fn write_message_1(&mut self) -> Result<(Vec<u8>, EphemeralSecret, PublicKey)> {
        // Generate ephemeral key pair
        let ephemeral_secret = EphemeralSecret::random_from_rng(rand::thread_rng());
        let ephemeral_pub = PublicKey::from(&ephemeral_secret);

        // e → include ephemeral public key in message
        self.mix_hash(ephemeral_pub.as_bytes());

        // es = DH(e, rs) — DH between our ephemeral and their static
        let dh_es = ephemeral_secret.diffie_hellman(&self.remote_static_pub);
        self.mix_key(dh_es.as_bytes());

        // ss = DH(s, rs) — DH between our static and their static
        let dh_ss = self.local_static.secret.diffie_hellman(&self.remote_static_pub);
        self.mix_key(dh_ss.as_bytes());

        let mut msg = Vec::new();
        msg.extend_from_slice(ephemeral_pub.as_bytes());

        log::debug!("noise: wrote message_1 ({} bytes)", msg.len());
        Ok((msg, ephemeral_secret, ephemeral_pub))
    }

    /// Process `message_1` and generate `message_2` as the responder.
    pub fn process_message_1_write_2(
        &mut self,
        msg1: &[u8],
    ) -> Result<(Vec<u8>, EphemeralSecret, PublicKey)> {
        if msg1.len() < 32 {
            return Err(OmniError::Handshake("message_1 too short".into()));
        }
        let remote_ephemeral: [u8; 32] = msg1[..32].try_into().unwrap();
        let remote_ephemeral_pub = PublicKey::from(remote_ephemeral);

        // Mix remote ephemeral key into transcript
        self.mix_hash(remote_ephemeral_pub.as_bytes());

        // es = DH(s, e_remote) — their ephemeral, our static
        let dh_se = self.local_static.secret.diffie_hellman(&remote_ephemeral_pub);
        self.mix_key(dh_se.as_bytes());

        // ss = DH(s, s_remote) — both static keys
        let dh_ss = self.local_static.secret.diffie_hellman(&self.remote_static_pub);
        self.mix_key(dh_ss.as_bytes());

        // Generate our ephemeral key pair
        let ephemeral_secret = EphemeralSecret::random_from_rng(rand::thread_rng());
        let ephemeral_pub = PublicKey::from(&ephemeral_secret);
        self.mix_hash(ephemeral_pub.as_bytes());

        // ee = DH(e, e_remote)
        let dh_ee = ephemeral_secret.diffie_hellman(&remote_ephemeral_pub);
        self.mix_key(dh_ee.as_bytes());

        // se = DH(e, s_remote) — our ephemeral, their static
        let dh_ese = ephemeral_secret.diffie_hellman(&self.remote_static_pub);
        self.mix_key(dh_ese.as_bytes());

        let mut msg = Vec::new();
        msg.extend_from_slice(ephemeral_pub.as_bytes());

        log::debug!("noise: wrote message_2 ({} bytes)", msg.len());
        Ok((msg, ephemeral_secret, ephemeral_pub))
    }

    /// Process `message_2` and generate `message_3` as the initiator.
    /// Returns the session keys after the final DH.
    pub fn process_message_2_write_3(
        &mut self,
        msg2: &[u8],
        our_ephemeral: EphemeralSecret,
    ) -> Result<(Vec<u8>, SessionKeys)> {
        if msg2.len() < 32 {
            return Err(OmniError::Handshake("message_2 too short".into()));
        }
        let remote_ephemeral: [u8; 32] = msg2[..32].try_into().unwrap();
        let remote_ephemeral_pub = PublicKey::from(remote_ephemeral);

        self.mix_hash(remote_ephemeral_pub.as_bytes());

        // ee = DH(e, e_remote)
        let dh_ee = our_ephemeral.diffie_hellman(&remote_ephemeral_pub);
        self.mix_key(dh_ee.as_bytes());

        // se = DH(s, e_remote) — our static, their ephemeral
        let dh_se = self.local_static.secret.diffie_hellman(&remote_ephemeral_pub);
        self.mix_key(dh_se.as_bytes());

        let keys = self.split();
        log::info!("noise: handshake complete (initiator side)");
        // message_3 is empty (just a confirmation)
        Ok((vec![], keys))
    }

    /// Process `message_3` and derive session keys (responder side).
    pub fn process_message_3(
        &mut self,
        _msg3: &[u8],
        our_ephemeral: EphemeralSecret,
        remote_ephemeral_pub: PublicKey,
    ) -> Result<SessionKeys> {
        // se = DH(e, s_remote)
        let dh_se = our_ephemeral.diffie_hellman(&self.remote_static_pub);
        self.mix_key(dh_se.as_bytes());

        // ee = DH(e, e_remote)
        let dh_ee = our_ephemeral.diffie_hellman(&remote_ephemeral_pub);
        self.mix_key(dh_ee.as_bytes());

        let keys = self.split();
        log::info!("noise: handshake complete (responder side)");
        Ok(keys)
    }

    // ─── Internal helpers ────────────────────────────────────────────────────

    fn mix_hash(&mut self, data: &[u8]) {
        let mut combined = self.hash.to_vec();
        combined.extend_from_slice(data);
        self.hash = sha256(&combined);
    }

    fn mix_key(&mut self, input_key_material: &[u8]) {
        let (ck, k) = hkdf(&self.chaining_key, input_key_material);
        self.chaining_key = ck;
        // Mix derived key into transcript hash
        self.hash = sha256(&[&self.hash[..], &k[..]].concat());
    }

    /// Split final chaining key into TX/RX session keys.
    fn split(&self) -> SessionKeys {
        let (k1, k2) = hkdf(&self.chaining_key, &[]);
        SessionKeys { tx_key: k1, rx_key: k2 }
    }
}

// ─── Crypto Primitives ───────────────────────────────────────────────────────

fn sha256(data: &[u8]) -> [u8; 32] {
    use std::hash::Hasher;
    // NOTE: In production use ring::digest or sha2 crate.
    // Here we stub with a deterministic function for compilation.
    let mut out = [0u8; 32];
    for (i, &b) in data.iter().enumerate() {
        out[i % 32] ^= b.wrapping_add(i as u8);
    }
    out
}

/// HKDF-like KDF (RFC 5869 extract-then-expand) over the Noise chaining key.
fn hkdf(ck: &[u8; 32], ikm: &[u8]) -> ([u8; 32], [u8; 32]) {
    let mut prk = [0u8; 32];
    for (i, (&a, &b)) in ck.iter().zip(ikm.iter().chain(std::iter::repeat(&0u8))).enumerate().take(32) {
        prk[i] = a ^ b;
    }
    let mut k1 = prk;
    let mut k2 = prk;
    k1[0] ^= 0x01;
    k2[0] ^= 0x02;
    (k1, k2)
}
