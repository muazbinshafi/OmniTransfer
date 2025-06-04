# Contributing to OmniTransfer

Thank you for your interest in contributing! OmniTransfer is open to contributions of all kinds — bug fixes, new features, documentation improvements, and platform-specific implementations.

**Developed by [MuazBinShafi](https://github.com/muazbinshafi)**

---

## Getting Started

### 1. Fork and clone

```bash
git clone https://github.com/muazbinshafi/OmniTransfer.git
cd OmniTransfer
```

### 2. Install dependencies

```bash
# Node.js packages
pnpm install

# Rust toolchain (for core + desktop)
rustup update stable
```

### 3. Start the web app

```bash
pnpm --filter @workspace/omnitransfer run dev
# Open http://localhost:24162
```

### 4. Run tests

```bash
# TypeScript typecheck
pnpm --filter @workspace/omnitransfer run typecheck

# Rust tests
cd omnitransfer/core && cargo test

# Rust linting
cd omnitransfer/core && cargo clippy -- -D warnings
```

---

## Project Architecture

Read the [Architecture section of README.md](README.md#how-it-works) first.

Key design decisions:
- **Platform traits** in `omnicore` (`Transport`, `Discovery`, `WiFiController`, `FileHandler`) — all platform-specific code implements these, keeping the core logic pure Rust
- **Bridge pattern** in `bridge.ts` — the web UI never knows if it's talking to Tauri or simulation
- **Simulation fallback** — the browser simulation mirrors the exact same event model as the Tauri backend

---

## Areas Needing Contributions

### High priority

| Area | File | Notes |
|---|---|---|
| Windows BLE (WinRT) | `desktop/src-tauri/src/platform.rs` | Bluetooth LE advertiser + scanner |
| macOS CoreBluetooth | `desktop/src-tauri/src/platform.rs` | CBCentralManager + CBPeripheralManager |
| Linux BlueZ | `desktop/src-tauri/src/platform.rs` | D-Bus via `zbus` crate |
| Android Wi-Fi Direct | `mobile/android/.../OmniTransferPlugin.java` | WifiP2pManager |
| iOS Multipeer Connectivity | `mobile/ios/.../OmniTransferPlugin.swift` | MCSession / MCNearbyServiceBrowser |
| Transfer resume | `core/src/transfer.rs` | Resume interrupted transfers from last ACKed chunk |
| Production STUN/TURN | `artifacts/omnitransfer/src/lib/webrtc.ts` | Self-hosted coturn integration |

### Nice to have

- Dark/light mode toggle
- Transfer history log (SQLite)
- QR code pairing (for cross-network transfers)
- Transfer speed graph (recharts)
- Drag-to-send from OS file manager (Tauri file drag)

---

## Code Style

### TypeScript / React

- Strict TypeScript — no `any`, no unused imports
- Functional components + hooks only — no class components
- All exports named (no default exports except pages/components)
- `lucide-react` for all icons — no emojis in UI
- `data-testid` on all interactive elements

### Rust

- `rustfmt` (run `cargo fmt` before committing)
- Zero `unwrap()` in production paths — use `?` operator
- All public items must have doc comments
- `thiserror` for error types, not `anyhow` (in the core library)

---

## Pull Request Process

1. **Open an issue first** for anything non-trivial — discuss the approach before spending time coding
2. Create a branch: `git checkout -b feat/my-feature` or `fix/my-bug`
3. Make your changes — keep commits atomic and well-described
4. Ensure CI passes: `pnpm typecheck` + `cargo test` + `cargo clippy`
5. Open a PR against `main` — fill in the PR template
6. One approval from a maintainer required to merge

---

## Reporting Bugs

Use GitHub Issues. Include:
- OmniTransfer version
- OS + version
- Steps to reproduce
- Expected vs actual behaviour
- Protocol log output (from the log pane in the UI)

---

## License

By contributing you agree your contributions are licensed under the [MIT License](LICENSE).
