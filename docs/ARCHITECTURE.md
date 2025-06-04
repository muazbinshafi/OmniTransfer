# OmniTransfer — Architecture Deep Dive

**Developed by MuazBinShafi**

---

## Overview

OmniTransfer is structured as a monorepo with four deployment targets sharing a common Rust core:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        User Interface                                │
│  React/Vite (Web)  │  Tauri (Desktop)  │  Capacitor (Mobile)        │
│        │                    │                    │                   │
│        ▼                    ▼                    ▼                   │
│  WebRTC engine        Tauri IPC             Capacitor bridge         │
│        │                    │                    │                   │
└────────┼────────────────────┼────────────────────┼───────────────────┘
         │                    │                    │
         └────────────────────┴────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │   omnicore (Rust)   │
                    │                    │
                    │  Transport trait   │
                    │  Discovery trait   │
                    │  FileHandler trait │
                    │  WiFiCtrl trait    │
                    │                    │
                    │  CRUDP engine      │
                    │  Noise KK          │
                    │  BLAKE3 + Merkle   │
                    │  Reed-Solomon FEC  │
                    │  Chunker           │
                    └────────────────────┘
```

---

## Phase 1: Discovery

### BLE Advertisement

Each device broadcasts a custom manufacturer-specific BLE advertisement every 100 ms:

```
┌────────────────────────────────────────────────────────────┐
│ Manufacturer ID: 0x4F54 ("OT")                             │
├─────────┬──────────┬──────────────────┬─────────────────── │
│ ver: u8 │ name_len │ name: [u8; N]    │ caps: u16          │
├─────────┴──────────┴──────────────────┴────────────────────┤
│ ephemeral_pubkey: [u8; 32]  (Curve25519, rotated/session)  │
└────────────────────────────────────────────────────────────┘
Total: 2 + 1 + N + 2 + 32 bytes (must fit in 31-byte BLE payload)
```

The `ephemeral_pubkey` is the initiator's X25519 ephemeral key, included so the Noise KK handshake can begin immediately without an extra round-trip.

`capabilities` bitmask:
- Bits 15-8: `max_streams` (up to 255 parallel streams)
- Bit 1: `supports_resume`
- Bit 0: `supports_fec`

### mDNS / Bonjour (LAN fallback)

For platforms where BLE isn't available (Linux without BlueZ, some VMs), OmniTransfer also broadcasts via mDNS:

```
_omnitransfer._tcp.local
TXT: version=1 streams=8 fec=true resume=true pubkey=<base64>
```

### Web (BroadcastChannel)

In the browser, `BroadcastChannel("omnitransfer-signal")` provides a same-origin multi-tab signal bus. Peers announce themselves every 2 seconds; stale peers are pruned after 8 seconds.

---

## Phase 2: Handshake (Noise KK)

OmniTransfer uses the **Noise KK** pattern — chosen because both sides already have each other's static public key (exchanged via BLE advertisement).

```
Initiator (A)                           Responder (B)
─────────────                           ────────────
knows: s_A, s_B.public                  knows: s_B, s_A.public

→ message_1: e_A, DH(e_A, s_B), DH(s_A, s_B)
                              ← message_2: e_B, DH(e_B, e_A), DH(e_B, s_A)
→ message_3: {}

Both derive:
  tx_key = HKDF(ck, "")
  rx_key = HKDF(ck, "")[32:]
```

After three messages:
- Each side has **two independent 256-bit AES-GCM keys** (TX → RX swap between A and B)
- Every subsequent packet is encrypted with `AES-256-GCM` using a monotonically increasing nonce
- Replay attacks are prevented by the nonce counter

---

## Phase 3: Transfer

### Chunking

Files are split into fixed-size chunks (default 16 MB):

```
File: ────────────────────────────────────────────
       chunk_0   chunk_1   chunk_2   …   chunk_N-1
       (16 MB)   (16 MB)   (16 MB)       (≤16 MB)
```

16 MB was chosen to balance:
- **Memory pressure**: fits in L3 cache on modern hardware
- **Retransmit cost**: losing one chunk only retransmits 16 MB, not the whole file
- **Parallelism**: small enough to fill all 8 streams independently

### CRUDP — Custom Reliable UDP

CRUDP operates 8 independent streams per transfer, each carrying non-overlapping chunks:

```
Stream 0: chunks 0,  8, 16, 24, …
Stream 1: chunks 1,  9, 17, 25, …
Stream 2: chunks 2, 10, 18, 26, …
…
Stream 7: chunks 7, 15, 23, 31, …
```

**Wire format per packet** (after AES-GCM encryption):

```
┌──────────┬────────────┬──────────┬──────────────┬──────────┬─────────┐
│ stream:u8│ chunk_id:u32│ offset:u64│ payload: …   │ aes_tag:16│ seq:u32 │
└──────────┴────────────┴──────────┴──────────────┴──────────┴─────────┘
```

**Reliability mechanism:**

1. Sender maintains a SACK bitmap per stream (64 bits → 64 in-flight packets)
2. Receiver sends `ChunkAck` after every K received packets
3. Missing chunks are retransmitted after RTO (starts at 50 ms, backs off to 1 s)
4. AIMD: `cwnd += 1` on each ACK, `cwnd /= 2` on loss — matches TCP New Reno behaviour

**Flow control:**

Credit-based. Receiver grants N credits (default 32) per stream; sender can send up to N outstanding chunks per stream without an ACK.

### Reed-Solomon FEC

After the main transfer, 5% repair shards are computed over the final batch of data chunks using GF(2⁸) arithmetic:

```
data_chunks:   D₀  D₁  D₂  …  D_(n-1)
repair_shards: R₀  R₁  …  R_(⌈n×0.05⌉)
```

The receiver can reconstruct any single lost data chunk from the repair shards without a retransmit — this eliminates the final-batch RTT for typical 1% loss rates.

### BLAKE3 Verification

```
leaf hashes:  H(chunk_0)  H(chunk_1)  …  H(chunk_N)
                    │           │
              ┌─────┘     ┌────┘
              H(H0||H1)   H(H2||H3)  …
                    │           │
                    └─────┬─────┘
                      H(root)   ← transmitted in TransferRequest
```

After all chunks arrive, the receiver recomputes the Merkle root and compares with the transmitted value. Mismatch → transfer rejected, request retransmit.

---

## WebRTC Engine (Browser)

In the browser, OmniTransfer uses real `RTCPeerConnection` with a `RTCDataChannel`:

```
RTCDataChannel config:
  ordered: false          (no head-of-line blocking)
  maxRetransmits: 3       (retry before dropping)
  binaryType: arraybuffer

Chunk size: 16 KB         (browser DataChannel limit)
Back-pressure: bufferedAmount ≤ 256 KB before sending next chunk
```

Signalling flow (BroadcastChannel):

```
Tab A                         Signal Bus              Tab B
─────                         ──────────              ─────
announce("Tab A") ─────────▶                ◀─ announce("Tab B")
                                             (discover each other)

createOffer() ────────────▶ {type:"offer"} ─────────▶ createAnswer()
               ◀────────── {type:"answer"} ◀──────────
addIce() ──────────────────▶ {type:"ice"} ─────────▶ addIce()

[DataChannel open]
sendFile() ────────────────▶ [binary chunks] ─────▶ receiveFile()
                              [EOF marker]
                              [auto-download]
```

---

## Platform-Specific Notes

### Windows (Tauri)
- BLE: WinRT `Windows.Devices.Bluetooth.Advertisement` namespace
- Wi-Fi hotspot: `Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager`
- File I/O: `tokio::fs` with `SeekFrom::Start` for parallel chunk reads

### macOS (Tauri)
- BLE: CoreBluetooth via Objective-C FFI (`objc` crate) or `core-foundation`
- Wi-Fi: `NEHotspotConfiguration` requires `NetworkExtension` entitlement
- File I/O: Same as Linux

### Linux (Tauri)
- BLE: BlueZ D-Bus interface via `zbus` crate (`org.bluez.LEAdvertisingManager1`)
- Wi-Fi: `hostapd` + `NetworkManager` via D-Bus
- AppArmor: may need `bluetooth` snap plug on Ubuntu

### Android (Capacitor)
- BLE: `BluetoothLeScanner` + `BluetoothLeAdvertiser` (Android 5+)
- Wi-Fi: `WifiManager.startLocalOnlyHotspot` (Android 8+, API 26)
- Permissions: `BLUETOOTH_SCAN` + `BLUETOOTH_ADVERTISE` (Android 12+)
- File access: `READ_MEDIA_*` (Android 13+), `READ_EXTERNAL_STORAGE` (Android ≤12)

### iOS (Capacitor)
- BLE: `CBCentralManager` (scan) + `CBPeripheralManager` (advertise)
- Wi-Fi: `NEHotspotConfigurationManager` (requires developer entitlement)
- Discovery: `NWBrowser` for Bonjour/mDNS (iOS 14+)
- Limitation: iOS doesn't allow USB/IP bridging without VPN entitlement

---

## Data Flow Diagram

```
User selects file → FilePicker → useTransfer.send()
                                        │
                                        ▼
                              [isTauri?]──Yes──▶ tauri.invoke("start_transfer")
                                        │                    │
                                        No                   ▼
                                        │           platform.rs::start_transfer()
                                        ▼                    │
                              [isWebRTC?]─Yes──▶ WebRTCTransferSession.sendFile()
                                        │                    │
                                        No                   ▼
                                        │           RTCDataChannel (DTLS/SCTP)
                                        ▼                    │
                              OmniSimulator.sendFile()        │
                                        │                    │
                                        ▼                    ▼
                              Synthetic events       Real progress events
                                        │                    │
                                        └──────────┬─────────┘
                                                   ▼
                                         useTransfer hook
                                                   │
                                                   ▼
                                    TransferProgress component
                                    ProtocolLog component
```
