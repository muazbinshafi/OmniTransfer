//! OmniTransfer Tauri Desktop — Main Entry Point
//!
//! Initialises the global `TransferManager` with platform-specific trait
//! implementations and registers all Tauri IPC commands. Falls back to stub
//! implementations on unsupported platforms so the UI always loads.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use once_cell::sync::Lazy;
use omnicore::{
    DeviceCapabilities, Peer, TransferConfig, TransferManager,
    WiFiController,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

mod platform;
use platform::{PlatformBle, PlatformTransport, PlatformWifi, OsFileHandler};

// ─── Global State ─────────────────────────────────────────────────────────────

struct AppState {
    manager: Arc<TransferManager>,
    active_transfer: Option<tokio::task::JoinHandle<()>>,
}

type SharedState = Mutex<AppState>;

// ─── Tauri Commands ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub rssi: i8,
    pub capabilities: DeviceCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferHandle {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferStatus {
    pub id: String,
    pub state: String,
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub throughput_bps: f64,
    pub eta_ms: Option<u64>,
}

/// Start a Wi-Fi hotspot on the host device so peers can connect without
/// an existing network. Falls back gracefully on unsupported platforms.
#[tauri::command]
async fn start_hotspot(
    state: State<'_, SharedState>,
    ssid: String,
    passphrase: String,
) -> Result<(), String> {
    let s = state.lock().await;
    s.manager
        .wifi
        .create_hotspot(&ssid, &passphrase)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn stop_hotspot(state: State<'_, SharedState>) -> Result<(), String> {
    let s = state.lock().await;
    s.manager.wifi.release_hotspot().await.map_err(|e| e.to_string())
}

/// Scan for nearby OmniTransfer peers via BLE + mDNS.
#[tauri::command]
async fn scan_ble(state: State<'_, SharedState>) -> Result<Vec<Device>, String> {
    let s = state.lock().await;
    let peers = s
        .manager
        .discovery
        .start_scanning("omnitransfer-v1")
        .await
        .map_err(|e| e.to_string())?;

    Ok(peers
        .into_iter()
        .map(|p| Device {
            id: p.id,
            name: p.name,
            rssi: -55, // real RSSI comes from the platform layer
            capabilities: p.capabilities,
        })
        .collect())
}

/// Begin sending a file to the given peer.
#[tauri::command]
async fn start_transfer(
    app: AppHandle,
    state: State<'_, SharedState>,
    peer_id: String,
    file_path: String,
) -> Result<TransferHandle, String> {
    let handle_id = format!("xfr-{}", uuid_v4());

    let config = TransferConfig {
        file_name: file_path
            .split(['/', '\\'])
            .last()
            .unwrap_or("file")
            .to_string(),
        ..Default::default()
    };

    let transport: Arc<dyn omnicore::Transport> =
        Arc::new(PlatformTransport::connect_to_peer(&peer_id).await
            .map_err(|e| e.to_string())?);

    let file: Arc<dyn omnicore::FileHandler> =
        Arc::new(OsFileHandler::open(&file_path).await
            .map_err(|e| e.to_string())?);

    let disc = Arc::clone(&state.lock().await.manager.discovery);
    let hid = handle_id.clone();
    let app2 = app.clone();

    let join = tokio::spawn(async move {
        match omnicore::run_transfer(config, transport, file, disc).await {
            Ok(stats) => {
                let _ = app2.emit_all(
                    "transfer_complete",
                    serde_json::json!({
                        "id": hid,
                        "bytes": stats.bytes_transferred,
                        "throughput_bps": stats.throughput_bps,
                        "elapsed_ms": stats.elapsed_ms,
                    }),
                );
            }
            Err(e) => {
                let _ = app2.emit_all(
                    "transfer_error",
                    serde_json::json!({ "id": hid, "error": e.to_string() }),
                );
            }
        }
    });

    let mut s = state.lock().await;
    s.active_transfer = Some(join);

    Ok(TransferHandle { id: handle_id })
}

#[tauri::command]
async fn cancel_transfer(state: State<'_, SharedState>) -> Result<(), String> {
    let mut s = state.lock().await;
    if let Some(handle) = s.active_transfer.take() {
        handle.abort();
    }
    Ok(())
}

// ─── Main ─────────────────────────────────────────────────────────────────────

fn main() {
    env_logger::init();

    tauri::Builder::default()
        .manage(Mutex::new(AppState {
            manager: Arc::new(TransferManager::new(
                Arc::new(PlatformTransport::stub()),
                Arc::new(OsFileHandler::stub()),
                Arc::new(PlatformBle::new()),
                Arc::new(PlatformWifi::new()),
            )),
            active_transfer: None,
        }))
        .invoke_handler(tauri::generate_handler![
            start_hotspot,
            stop_hotspot,
            scan_ble,
            start_transfer,
            cancel_transfer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn uuid_v4() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        rng.gen::<u32>(),
        rng.gen::<u16>(),
        rng.gen::<u16>() & 0x0fff,
        (rng.gen::<u16>() & 0x3fff) | 0x8000,
        rng.gen::<u64>() & 0xffffffffffff,
    )
}
