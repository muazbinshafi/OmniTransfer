//! OmniTransfer Core Library
//!
//! This crate defines the platform-agnostic traits and the `TransferManager`
//! orchestrator. Platform-specific implementations (BLE, Wi-Fi hotspot,
//! native sockets) live in the Tauri desktop crate and Capacitor mobile plugins.
//!
//! # Architecture
//!
//! ```text
//! ┌────────────────────────────────────────────────────────────┐
//! │                     TransferManager                        │
//! │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
//! │  │Discovery │  │Transport │  │FileHandler│  │WiFiCtrl  │  │
//! │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  │
//! └───────┼─────────────┼─────────────┼──────────────┼────────┘
//!         │             │             │              │
//!      BLE/mDNS    CRUDP streams   OS file I/O   WinRT/CoreWLAN
//! ```

pub mod ble_abstraction;
pub mod chunker;
pub mod crudp;
pub mod fec;
pub mod hasher;
pub mod noise_handshake;
pub mod transfer;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use thiserror::Error;

// ─── Error Type ─────────────────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum OmniError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Protocol error: {0}")]
    Protocol(String),

    #[error("Handshake failed: {0}")]
    Handshake(String),

    #[error("Verification failed: expected {expected}, got {actual}")]
    Verification { expected: String, actual: String },

    #[error("Transfer cancelled")]
    Cancelled,

    #[error("FEC decode failed")]
    FecDecode,

    #[error("Serialisation error: {0}")]
    Serialisation(#[from] bincode::Error),
}

pub type Result<T> = std::result::Result<T, OmniError>;

// ─── Peer / Capabilities ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCapabilities {
    pub max_streams: u8,
    /// Maximum chunk size in bytes (default: 16 MB)
    pub max_chunk_size: u32,
    pub supports_fec: bool,
    pub supports_resume: bool,
    pub version: u8,
}

impl Default for DeviceCapabilities {
    fn default() -> Self {
        Self {
            max_streams: 8,
            max_chunk_size: 16 * 1024 * 1024,
            supports_fec: true,
            supports_resume: true,
            version: 1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Peer {
    pub id: String,
    pub name: String,
    pub addr: Option<SocketAddr>,
    pub capabilities: DeviceCapabilities,
    /// Ephemeral Curve25519 public key (32 bytes) received via BLE advertisement
    pub ephemeral_pubkey: [u8; 32],
}

// ─── Core Traits ─────────────────────────────────────────────────────────────

/// Pluggable network transport. The default implementation uses CRUDP over UDP;
/// the web simulation uses WebRTC data channels.
#[async_trait]
pub trait Transport: Send + Sync {
    async fn send_chunk(&self, stream_id: u8, chunk_id: u32, data: &[u8]) -> Result<()>;
    async fn receive_chunk(&self) -> Result<ChunkData>;
    async fn set_credits(&self, stream_id: u8, count: u32) -> Result<()>;
}

#[derive(Debug, Clone)]
pub struct ChunkData {
    pub stream_id: u8,
    pub chunk_id: u32,
    pub offset: u64,
    pub payload: Vec<u8>,
    /// AES-GCM-256 authentication tag
    pub aes_tag: [u8; 16],
}

/// Pluggable discovery layer. Implemented via BLE on mobile/desktop, and via
/// mDNS / Broadcast Channel on the web simulation.
#[async_trait]
pub trait Discovery: Send + Sync {
    async fn start_advertising(&self, service_id: &str, payload: &[u8]) -> Result<()>;
    async fn stop_advertising(&self) -> Result<()>;
    async fn start_scanning(&self, service_id: &str) -> Result<Vec<Peer>>;
    async fn stop_scanning(&self) -> Result<()>;
}

/// Wi-Fi hotspot lifecycle — platform-specific (WinRT / NEHotspot / hostapd).
#[async_trait]
pub trait WiFiController: Send + Sync {
    async fn create_hotspot(&self, ssid: &str, passphrase: &str) -> Result<()>;
    async fn connect_to_hotspot(&self, ssid: &str, passphrase: &str) -> Result<()>;
    async fn release_hotspot(&self) -> Result<()>;
}

/// Async file I/O with offset support — enables parallel chunk reads/writes
/// without seeking on a shared file handle.
#[async_trait]
pub trait FileHandler: Send + Sync {
    async fn read_at(&self, offset: u64, length: u64) -> Result<Vec<u8>>;
    async fn write_at(&self, offset: u64, data: &[u8]) -> Result<()>;
    async fn file_size(&self) -> Result<u64>;
    async fn flush(&self) -> Result<()>;
}

// ─── Transfer Config & Stats ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferConfig {
    pub file_name: String,
    /// Default: 16 MB
    pub chunk_size: u32,
    /// Maximum parallel CRUDP streams
    pub max_streams: u8,
    /// Initial credit window per stream
    pub credit_window: u32,
    /// Enable Reed-Solomon FEC over last 5% of chunks
    pub enable_fec: bool,
}

impl Default for TransferConfig {
    fn default() -> Self {
        Self {
            file_name: String::new(),
            chunk_size: 16 * 1024 * 1024,
            max_streams: 8,
            credit_window: 32,
            enable_fec: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferStats {
    pub bytes_transferred: u64,
    pub chunks_completed: u32,
    pub total_chunks: u32,
    pub throughput_bps: f64,
    pub elapsed_ms: u64,
    pub eta_ms: Option<u64>,
}

// ─── TransferManager ─────────────────────────────────────────────────────────

/// Top-level orchestrator. Drives the full transfer lifecycle:
/// discovery → handshake → chunking → parallel streaming → FEC → verification.
pub struct TransferManager {
    pub transport: Arc<dyn Transport>,
    pub file: Arc<dyn FileHandler>,
    pub discovery: Arc<dyn Discovery>,
    pub wifi: Arc<dyn WiFiController>,
}

impl TransferManager {
    pub fn new(
        transport: Arc<dyn Transport>,
        file: Arc<dyn FileHandler>,
        discovery: Arc<dyn Discovery>,
        wifi: Arc<dyn WiFiController>,
    ) -> Self {
        Self { transport, file, discovery, wifi }
    }
}

/// Entry point for a full send or receive session.
pub async fn run_transfer(
    config: TransferConfig,
    transport: Arc<dyn Transport>,
    file: Arc<dyn FileHandler>,
    discovery: Arc<dyn Discovery>,
) -> Result<TransferStats> {
    use transfer::TransferEngine;
    let engine = TransferEngine::new(config, transport, file, discovery);
    engine.run().await
}
