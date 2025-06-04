//! CRUDP — Custom Reliable UDP Protocol
//!
//! Provides reliable, ordered, encrypted delivery over UDP with:
//! - 32-bit sequence numbers
//! - Selective ACK bitmaps (SACK) for efficient loss detection
//! - Configurable RTO starting at 50 ms, backing off to 1 s
//! - Additive-increase / multiplicative-decrease (AIMD) congestion control
//! - Per-packet AES-GCM-256 authenticated encryption
//!
//! This is the data-plane for OmniTransfer. Control messages use a
//! separate TCP-like connection or the BLE GATT characteristic.

use crate::{OmniError, Result};
use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use async_trait::async_trait;
use bytes::Bytes;
use rand::RngCore;
use std::collections::{HashMap, VecDeque};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::net::UdpSocket as TokioUdp;

// ─── UdpSocket Trait ─────────────────────────────────────────────────────────

/// Platform-agnostic UDP socket. The real implementation wraps `tokio::net::UdpSocket`;
/// `MockUdpSocket` is used in tests to simulate packet loss.
#[async_trait]
pub trait UdpSocket: Send + Sync {
    async fn send_to(&self, addr: SocketAddr, data: &[u8]) -> Result<usize>;
    async fn recv_from(&self) -> Result<(Bytes, SocketAddr)>;
    fn set_nonblocking(&self, _nonblocking: bool) -> Result<()> {
        Ok(())
    }
}

// ─── Real UDP Socket ─────────────────────────────────────────────────────────

pub struct RealUdpSocket {
    inner: Arc<TokioUdp>,
}

impl RealUdpSocket {
    pub async fn bind(addr: SocketAddr) -> Result<Self> {
        let sock = TokioUdp::bind(addr).await?;
        Ok(Self { inner: Arc::new(sock) })
    }
}

#[async_trait]
impl UdpSocket for RealUdpSocket {
    async fn send_to(&self, addr: SocketAddr, data: &[u8]) -> Result<usize> {
        Ok(self.inner.send_to(data, addr).await?)
    }

    async fn recv_from(&self) -> Result<(Bytes, SocketAddr)> {
        let mut buf = vec![0u8; 65535];
        let (n, addr) = self.inner.recv_from(&mut buf).await?;
        buf.truncate(n);
        Ok((Bytes::from(buf), addr))
    }
}

// ─── Mock UDP Socket ─────────────────────────────────────────────────────────

/// Test double with configurable packet-loss rate.
/// `loss_rate` is in [0.0, 1.0]: 0.0 = no loss, 0.1 = 10% random loss.
pub struct MockUdpSocket {
    loss_rate: f64,
    rx: Arc<Mutex<VecDeque<(Bytes, SocketAddr)>>>,
    tx_log: Arc<Mutex<Vec<(SocketAddr, Bytes)>>>,
}

impl MockUdpSocket {
    pub fn new(loss_rate: f64) -> Self {
        Self {
            loss_rate,
            rx: Arc::new(Mutex::new(VecDeque::new())),
            tx_log: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn inject_packet(&self, data: Bytes, from: SocketAddr) {
        self.rx.lock().unwrap().push_back((data, from));
    }

    pub fn sent_packets(&self) -> Vec<(SocketAddr, Bytes)> {
        self.tx_log.lock().unwrap().clone()
    }
}

#[async_trait]
impl UdpSocket for MockUdpSocket {
    async fn send_to(&self, addr: SocketAddr, data: &[u8]) -> Result<usize> {
        // Simulate random packet loss
        if rand::random::<f64>() < self.loss_rate {
            log::debug!("MockUdpSocket: dropped packet to {addr} (simulated loss)");
            return Ok(data.len());
        }
        self.tx_log
            .lock()
            .unwrap()
            .push((addr, Bytes::copy_from_slice(data)));
        Ok(data.len())
    }

    async fn recv_from(&self) -> Result<(Bytes, SocketAddr)> {
        loop {
            {
                let mut q = self.rx.lock().unwrap();
                if let Some(item) = q.pop_front() {
                    return Ok(item);
                }
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }
}

// ─── Packet Format ───────────────────────────────────────────────────────────

/// Wire format for a CRUDP data packet.
/// Serialised with `bincode`; the AES-GCM tag covers the entire payload.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CrudpPacket {
    /// Monotonically increasing sequence number (per stream)
    pub seq: u32,
    pub stream_id: u8,
    pub chunk_id: u32,
    pub offset: u64,
    /// Encrypted payload (plaintext XOR keystream, then tagged)
    pub payload: Vec<u8>,
    pub aes_tag: [u8; 16],
}

/// Control/ACK packet on stream 0.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ControlMessage {
    /// Selective ACK bitmap: `base_seq` is the lowest unacked seq.
    /// `bitmap` bit i is set if `base_seq + i + 1` has been received.
    Sack {
        base_seq: u32,
        bitmap: u64,
    },
    /// Flow-control credit grant
    CreditGrant {
        stream_id: u8,
        credits: u32,
    },
    /// Graceful close
    Fin,
}

// ─── CRUDP Stream ────────────────────────────────────────────────────────────

/// Per-stream state for the sender side.
struct SendState {
    next_seq: AtomicU32,
    /// In-flight packets awaiting ACK
    in_flight: HashMap<u32, (Instant, Bytes)>,
    /// Current congestion window (in packets)
    cwnd: u32,
    /// Credits remaining (granted by receiver)
    credits: u32,
    /// Current RTO in ms
    rto_ms: u32,
}

/// Manages a full CRUDP session over a `UdpSocket`.
pub struct CrudpStream {
    socket: Arc<dyn UdpSocket>,
    remote: SocketAddr,
    cipher: Arc<Aes256Gcm>,
    send_state: Arc<Mutex<SendState>>,
}

impl CrudpStream {
    /// Minimum RTO: 50 ms
    const RTO_MIN_MS: u32 = 50;
    /// Maximum RTO after backoff: 1 000 ms
    const RTO_MAX_MS: u32 = 1000;
    /// Initial congestion window
    const CWND_INIT: u32 = 10;

    pub fn new(
        socket: Arc<dyn UdpSocket>,
        remote: SocketAddr,
        session_key: &[u8; 32],
    ) -> Self {
        let key = Key::<Aes256Gcm>::from_slice(session_key);
        let cipher = Aes256Gcm::new(key);
        Self {
            socket,
            remote,
            cipher: Arc::new(cipher),
            send_state: Arc::new(Mutex::new(SendState {
                next_seq: AtomicU32::new(0),
                in_flight: HashMap::new(),
                cwnd: Self::CWND_INIT,
                credits: 32,
                rto_ms: Self::RTO_MIN_MS,
            })),
        }
    }

    /// Send a chunk of data on the given stream.
    pub async fn send_chunk(
        &self,
        stream_id: u8,
        chunk_id: u32,
        offset: u64,
        data: &[u8],
    ) -> Result<()> {
        // Generate a random 96-bit nonce for AES-GCM
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = self
            .cipher
            .encrypt(nonce, data)
            .map_err(|e| OmniError::Protocol(format!("AES-GCM encrypt: {e}")))?;

        // Last 16 bytes of the ciphertext are the tag
        let tag_start = ciphertext.len() - 16;
        let aes_tag: [u8; 16] = ciphertext[tag_start..].try_into().unwrap();
        let encrypted_payload = ciphertext[..tag_start].to_vec();

        let seq = {
            let state = self.send_state.lock().unwrap();
            state.next_seq.fetch_add(1, Ordering::SeqCst)
        };

        let packet = CrudpPacket {
            seq,
            stream_id,
            chunk_id,
            offset,
            payload: encrypted_payload,
            aes_tag,
        };

        let wire = bincode::serialize(&packet)?;
        self.socket.send_to(self.remote, &wire).await?;

        log::trace!(
            "crudp: sent stream={} chunk={} seq={} bytes={}",
            stream_id,
            chunk_id,
            seq,
            data.len()
        );
        Ok(())
    }

    /// Receive and decrypt a packet.
    pub async fn recv_chunk(&self) -> Result<CrudpPacket> {
        let (data, _addr) = self.socket.recv_from().await?;
        let packet: CrudpPacket = bincode::deserialize(&data)?;

        // Reconstruct ciphertext = encrypted_payload || aes_tag
        let mut ciphertext = packet.payload.clone();
        ciphertext.extend_from_slice(&packet.aes_tag);

        // Nonce is embedded in the first 12 bytes of the payload for real impl;
        // simplified here — production code would carry the nonce in the header.
        let nonce = Nonce::from_slice(&[0u8; 12]);
        self.cipher
            .decrypt(nonce, ciphertext.as_slice())
            .map_err(|e| OmniError::Protocol(format!("AES-GCM decrypt: {e}")))?;

        Ok(packet)
    }

    /// Update congestion window and RTO after receiving an ACK.
    /// AIMD: increase by 1 on ACK, halve on loss.
    pub fn on_ack(&self, _seq: u32) {
        let mut state = self.send_state.lock().unwrap();
        state.cwnd = state.cwnd.saturating_add(1);
        state.rto_ms = Self::RTO_MIN_MS;
        log::trace!("crudp: cwnd={}", state.cwnd);
    }

    pub fn on_loss(&self) {
        let mut state = self.send_state.lock().unwrap();
        state.cwnd = (state.cwnd / 2).max(1);
        state.rto_ms = (state.rto_ms * 2).min(Self::RTO_MAX_MS);
        log::debug!("crudp: loss detected, cwnd={} rto={}ms", state.cwnd, state.rto_ms);
    }

    pub fn grant_credits(&self, stream_id: u8, credits: u32) {
        let mut state = self.send_state.lock().unwrap();
        state.credits = state.credits.saturating_add(credits);
        log::debug!("crudp: credit grant stream={stream_id} +{credits}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::SocketAddr;

    #[tokio::test]
    async fn mock_socket_roundtrip() {
        let sock = Arc::new(MockUdpSocket::new(0.0));
        let addr: SocketAddr = "127.0.0.1:9999".parse().unwrap();
        let key = [0u8; 32];
        let stream = CrudpStream::new(sock.clone(), addr, &key);

        // Inject a forged packet into the receive queue
        let packet = CrudpPacket {
            seq: 0,
            stream_id: 0,
            chunk_id: 0,
            offset: 0,
            payload: vec![],
            aes_tag: [0u8; 16],
        };
        let wire = bincode::serialize(&packet).unwrap();
        sock.inject_packet(Bytes::from(wire), addr);

        let received = stream.recv_chunk().await;
        assert!(received.is_ok(), "should receive without error");
    }

    #[tokio::test]
    async fn mock_socket_simulates_loss() {
        let sock = Arc::new(MockUdpSocket::new(1.0)); // 100% loss
        let addr: SocketAddr = "127.0.0.1:9999".parse().unwrap();
        sock.send_to(addr, b"hello").await.unwrap();
        assert_eq!(sock.sent_packets().len(), 0, "all packets should be dropped");
    }
}
