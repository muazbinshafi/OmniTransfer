//! BLE Abstraction Layer
//!
//! Platform-agnostic types and helpers for Bluetooth Low Energy discovery.
//! Platform implementations (WinRT / CoreBluetooth / BlueZ / Web Bluetooth)
//! implement the `Discovery` trait from `lib.rs`.
//!
//! # BLE Advertisement Payload
//!
//! Each OmniTransfer device broadcasts a manufacturer-specific advertisement:
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────┐
//! │ version: u8 │ name_len: u8 │ name: [u8; name_len] │ caps: u16  │
//! │ ephemeral_pubkey: [u8; 32]                                      │
//! └─────────────────────────────────────────────────────────────────┘
//! ```
//!
//! The ephemeral public key is rotated every session.

use crate::{DeviceCapabilities, OmniError, Peer, Result};
use serde::{Deserialize, Serialize};

pub const SERVICE_UUID: &str = "omnitransfer-v1";
pub const MANUFACTURER_ID: u16 = 0x4F54; // "OT"

/// Compact advertisement payload (max 31 bytes for BLE 4.x).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BleAdvertisement {
    pub version: u8,
    pub device_name: String,
    /// Bitmask: bit 0 = FEC, bit 1 = resume, bits 8-15 = max_streams
    pub capabilities: u16,
    pub ephemeral_pubkey: [u8; 32],
}

impl BleAdvertisement {
    pub fn new(
        device_name: &str,
        caps: &DeviceCapabilities,
        ephemeral_pubkey: [u8; 32],
    ) -> Self {
        let capability_bits =
            ((caps.max_streams as u16) << 8)
                | (caps.supports_fec as u16)
                | ((caps.supports_resume as u16) << 1);
        Self {
            version: 1,
            device_name: device_name.to_string(),
            capabilities: capability_bits,
            ephemeral_pubkey,
        }
    }

    pub fn to_wire(&self) -> Result<Vec<u8>> {
        bincode::serialize(self).map_err(OmniError::Serialisation)
    }

    pub fn from_wire(data: &[u8]) -> Result<Self> {
        bincode::deserialize(data).map_err(OmniError::Serialisation)
    }

    pub fn to_capabilities(&self) -> DeviceCapabilities {
        DeviceCapabilities {
            max_streams: (self.capabilities >> 8) as u8,
            max_chunk_size: 16 * 1024 * 1024,
            supports_fec: (self.capabilities & 0x01) != 0,
            supports_resume: (self.capabilities & 0x02) != 0,
            version: self.version,
        }
    }
}

/// Convert a raw advertisement scan result into a `Peer`.
pub fn peer_from_advertisement(
    peer_id: &str,
    advert: &BleAdvertisement,
    rssi: i8,
) -> Peer {
    Peer {
        id: peer_id.to_string(),
        name: advert.device_name.clone(),
        addr: None,
        capabilities: advert.to_capabilities(),
        ephemeral_pubkey: advert.ephemeral_pubkey,
    }
}

// ─── Stub Discovery ──────────────────────────────────────────────────────────

/// No-op discovery implementation used when the platform doesn't support BLE.
/// Logs a warning and returns empty results — the UI can still connect to known
/// IP addresses via manual entry.
pub struct StubDiscovery;

#[async_trait::async_trait]
impl crate::Discovery for StubDiscovery {
    async fn start_advertising(&self, service_id: &str, _payload: &[u8]) -> Result<()> {
        log::warn!("BLE advertising not available on this platform (service={service_id})");
        Ok(())
    }

    async fn stop_advertising(&self) -> Result<()> {
        Ok(())
    }

    async fn start_scanning(&self, service_id: &str) -> Result<Vec<Peer>> {
        log::warn!("BLE scanning not available on this platform (service={service_id})");
        Ok(vec![])
    }

    async fn stop_scanning(&self) -> Result<()> {
        Ok(())
    }
}
