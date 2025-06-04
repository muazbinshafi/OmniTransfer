# Changelog

All notable changes to OmniTransfer are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Initial public release

---

## [0.1.0] — 2024-06-01

### Added

**Core library (`omnitransfer/core`)**
- CRUDP: Custom Reliable UDP with 32-bit sequence numbers, SACK bitmaps, AIMD congestion control, per-packet AES-256-GCM
- Noise KK handshake: 3-message mutual authentication (Curve25519 + AES-GCM-256)
- BLAKE3 file hashing: per-chunk hashes + Merkle tree root
- Reed-Solomon FEC: 5% parity shards over the final chunk batch
- Adaptive chunker: configurable chunk size (default 16 MB), FEC shard count calculation
- BLE abstraction: advertisement codec, ephemeral key rotation, StubDiscovery for unsupported platforms
- Transfer state machine: Idle → Advertising → Connecting → Handshaking → Sending → Done → Error
- Platform traits: `Transport`, `Discovery`, `WiFiController`, `FileHandler`

**Tauri Desktop (Windows / macOS / Linux)**
- Tauri IPC commands: `scan_ble`, `start_hotspot`, `stop_hotspot`, `start_transfer`, `cancel_transfer`
- Platform implementations: `PlatformBle`, `PlatformWifi`, `OsFileHandler`
- Build targets: `.msi` (Windows), `.dmg` (macOS Intel + Apple Silicon), `.deb`/`.rpm`/`.AppImage` (Linux)

**Capacitor Mobile (Android / iOS)**
- Android: `OmniTransferPlugin.java` — BLE scan/advertise (BluetoothLeScanner + BluetoothLeAdvertiser) + `LocalOnlyHotspot`
- iOS: `OmniTransferPlugin.swift` — CoreBluetooth Central/Peripheral + `NEHotspotConfigurationManager` + NWBrowser
- Permissions: fully declared in AndroidManifest.xml + Info.plist

**Web App (React/Vite)**
- Real WebRTC P2P engine: `RTCPeerConnection` + `RTCDataChannel` (DTLS/SCTP, ordered=false)
- BroadcastChannel signalling: works across tabs and same-network peers
- STUN server integration: Google + Cloudflare STUN for ICE negotiation
- Back-pressure control: `bufferedAmount` checking to prevent OOM on large files
- Simulation fallback: full synthetic BLE + transfer simulation when WebRTC unavailable
- Tauri bridge: transparent IPC proxy with simulation fallback
- `useTransfer` hook: unified state (real WebRTC + simulation + Tauri), peer discovery, file selection, transfer lifecycle
- Dark-mode cockpit UI: `DeviceList`, `FilePicker`, `TransferProgress`, `ProtocolLog` components
- Protocol log: real-time timestamped log of Noise handshake, chunk ACKs, FEC shards, BLAKE3 verification

**Standalone Web Demo**
- `web-sim/index.html` — zero-dependency single-file demo (no build required)
- `web-sim/sim-engine.js` — ES module simulation engine
- `web-sim/sim.js` — UI controller

**CI/CD**
- `ci.yml`: lint, typecheck, Rust clippy + tests on every push/PR
- `build.yml`: cross-platform Tauri builds + Android APK on tag push
- Automated GitHub Releases with platform binaries

**Installers**
- `installers/windows/install.ps1` — one-line PowerShell installer
- `installers/macos/install.sh` — one-line bash installer (auto-detects Intel/ARM)
- `installers/linux/install.sh` — one-line bash installer (`.deb`/`.rpm`/`.AppImage`)
- `installers/android/INSTALL.md` — Android sideload + ADB guide
- `installers/ios/INSTALL.md` — Xcode + AltStore + TestFlight guide

**Documentation**
- Comprehensive README with architecture diagram, performance benchmarks, security model
- Per-platform installation guides
- Build from source instructions for all targets

[Unreleased]: https://github.com/muazbinshafi/OmniTransfer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/muazbinshafi/OmniTransfer/releases/tag/v0.1.0
