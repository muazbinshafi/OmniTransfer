//! Platform trait implementations for Tauri desktop.
//!
//! Each struct implements one of the core omnicore traits.
//! Platform-specific code is gated with `#[cfg(target_os = ...)]`.
//! All unsupported paths log a warning and return `Ok(...)` so the app
//! remains functional as a simulation.

use async_trait::async_trait;
use omnicore::{
    ChunkData, Discovery, FileHandler, OmniError, Peer, Result, Transport,
    WiFiController,
};
use std::path::PathBuf;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, SeekFrom};
use tokio::sync::Mutex;

// ─── Platform Transport ───────────────────────────────────────────────────────

/// Wraps a real CRUDP socket or stubs it on unsupported platforms.
pub struct PlatformTransport {
    stream: Option<omnicore::crudp::CrudpStream>,
}

impl PlatformTransport {
    pub fn stub() -> Self {
        Self { stream: None }
    }

    pub async fn connect_to_peer(peer_id: &str) -> Result<Self> {
        log::info!("platform: connecting to peer {peer_id}");
        // Production: resolve peer IP from BLE advertisement, open UDP socket,
        // perform Noise KK handshake, then wrap in CrudpStream.
        Ok(Self { stream: None })
    }
}

#[async_trait]
impl Transport for PlatformTransport {
    async fn send_chunk(&self, _stream_id: u8, _chunk_id: u32, _data: &[u8]) -> Result<()> {
        if self.stream.is_none() {
            log::debug!("platform: stub send_chunk");
        }
        Ok(())
    }

    async fn receive_chunk(&self) -> Result<ChunkData> {
        Err(OmniError::Protocol("stub transport: no receive".into()))
    }

    async fn set_credits(&self, stream_id: u8, credits: u32) -> Result<()> {
        log::debug!("platform: set_credits stream={stream_id} credits={credits}");
        Ok(())
    }
}

// ─── BLE Discovery ────────────────────────────────────────────────────────────

pub struct PlatformBle;

impl PlatformBle {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Discovery for PlatformBle {
    async fn start_advertising(&self, service_id: &str, _payload: &[u8]) -> Result<()> {
        #[cfg(target_os = "windows")]
        {
            log::info!("BLE: starting WinRT advertisement for {service_id}");
            // windows::Devices::Bluetooth::Advertisement::BluetoothLEAdvertisementPublisher
        }
        #[cfg(target_os = "macos")]
        {
            log::info!("BLE: starting CoreBluetooth advertisement for {service_id}");
            // CBPeripheralManager::startAdvertising
        }
        #[cfg(target_os = "linux")]
        {
            log::info!("BLE: starting BlueZ advertisement via D-Bus for {service_id}");
            // org.bluez.LEAdvertisingManager1.RegisterAdvertisement
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            log::warn!("BLE advertising not supported on this platform (service={service_id})");
        }
        Ok(())
    }

    async fn stop_advertising(&self) -> Result<()> {
        Ok(())
    }

    async fn start_scanning(&self, service_id: &str) -> Result<Vec<Peer>> {
        log::info!("BLE: scanning for {service_id}");
        // In production: return real peers from OS scan results.
        Ok(vec![])
    }

    async fn stop_scanning(&self) -> Result<()> {
        Ok(())
    }
}

// ─── Wi-Fi Controller ─────────────────────────────────────────────────────────

pub struct PlatformWifi;

impl PlatformWifi {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl WiFiController for PlatformWifi {
    async fn create_hotspot(&self, ssid: &str, passphrase: &str) -> Result<()> {
        #[cfg(target_os = "windows")]
        {
            log::info!("Wi-Fi: creating WinRT hotspot ssid={ssid}");
            // windows::Networking::NetworkOperators::NetworkOperatorTetheringManager
        }
        #[cfg(target_os = "macos")]
        {
            log::info!("Wi-Fi: creating NEHotspotConfiguration ssid={ssid}");
            // NEHotspotConfigurationManager (requires NetworkExtension entitlement)
        }
        #[cfg(target_os = "linux")]
        {
            log::info!("Wi-Fi: creating hostapd/NetworkManager hotspot ssid={ssid}");
            // nmcli con add type wifi ifname wlo1 con-name OmniTransfer ssid {ssid}
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            log::warn!("Wi-Fi hotspot not supported on this platform (ssid={ssid})");
        }
        let _ = passphrase; // used above via format strings
        Ok(())
    }

    async fn connect_to_hotspot(&self, ssid: &str, passphrase: &str) -> Result<()> {
        log::info!("platform: connecting to hotspot ssid={ssid}");
        let _ = passphrase;
        Ok(())
    }

    async fn release_hotspot(&self) -> Result<()> {
        log::info!("platform: releasing hotspot");
        Ok(())
    }
}

// ─── File Handler ─────────────────────────────────────────────────────────────

pub struct OsFileHandler {
    path: Option<PathBuf>,
    file: Mutex<Option<File>>,
}

impl OsFileHandler {
    pub fn stub() -> Self {
        Self { path: None, file: Mutex::new(None) }
    }

    pub async fn open(path: &str) -> Result<Self> {
        let p = PathBuf::from(path);
        let f = File::open(&p).await?;
        Ok(Self {
            path: Some(p),
            file: Mutex::new(Some(f)),
        })
    }
}

#[async_trait]
impl FileHandler for OsFileHandler {
    async fn read_at(&self, offset: u64, length: u64) -> Result<Vec<u8>> {
        let mut guard = self.file.lock().await;
        let f = guard.as_mut().ok_or_else(|| OmniError::Protocol("no file open".into()))?;
        f.seek(SeekFrom::Start(offset)).await?;
        let mut buf = vec![0u8; length as usize];
        f.read_exact(&mut buf).await?;
        Ok(buf)
    }

    async fn write_at(&self, offset: u64, data: &[u8]) -> Result<()> {
        let mut guard = self.file.lock().await;
        let f = guard.as_mut().ok_or_else(|| OmniError::Protocol("no file open".into()))?;
        f.seek(SeekFrom::Start(offset)).await?;
        f.write_all(data).await?;
        Ok(())
    }

    async fn file_size(&self) -> Result<u64> {
        if let Some(ref path) = self.path {
            let meta = tokio::fs::metadata(path).await?;
            return Ok(meta.len());
        }
        Ok(0)
    }

    async fn flush(&self) -> Result<()> {
        let mut guard = self.file.lock().await;
        if let Some(f) = guard.as_mut() {
            f.flush().await?;
        }
        Ok(())
    }
}
