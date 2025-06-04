# Building OmniTransfer — All Platforms

**Developed by MuazBinShafi**

---

## How Platform Builds Work

OmniTransfer uses **Tauri** for desktop and **Capacitor** for mobile.
Each platform can only be built on its own OS (this is a Tauri/OS constraint, not ours):

| Platform | Build OS | Output files |
|---|---|---|
| **Windows** | Windows | `OmniTransfer_x.y.z_x64_en-US.msi` ← MSI installer |
| | | `OmniTransfer_x.y.z_x64-setup.exe` ← NSIS installer |
| **macOS Intel** | macOS | `OmniTransfer_x.y.z_x64.dmg` |
| **macOS Apple Silicon** | macOS | `OmniTransfer_x.y.z_aarch64.dmg` |
| **Linux** | Linux | `omnitransfer_x.y.z_amd64.deb` ← Debian/Ubuntu |
| | | `omnitransfer_x.y.z_x86_64.rpm` ← Fedora/RHEL |
| | | `OmniTransfer_x.y.z_amd64.AppImage` ← Universal |
| **Android** | Linux/macOS/Win | `OmniTransfer-arm64-v8a-release.apk` |
| **iOS** | macOS only | `.ipa` (via Xcode Archive) |

---

## Option 1: GitHub Actions (Recommended — builds ALL platforms at once)

Every time you push a version tag, GitHub Actions runs on real Windows, macOS, and Linux machines simultaneously and uploads all installers to the GitHub Release page.

```bash
# Tag a release
git tag v0.1.0
git push origin v0.1.0

# GitHub Actions then builds automatically:
#   ✅ Windows runner   → .msi + .exe
#   ✅ macOS runner     → .dmg (Intel + ARM)
#   ✅ Linux runner     → .deb + .rpm + .AppImage
#   ✅ Linux runner     → Android .apk
#
# Download everything from:
# https://github.com/muazbinshafi/OmniTransfer/releases
```

This is how the project is designed to be released.

---

## Option 2: Build Locally (current platform only)

Use the included script to build for whichever OS you're running on:

```bash
# From repo root
bash omnitransfer/scripts/build-local.sh
```

**What you get:**
- On **Windows** → `.msi` + `.exe`
- On **macOS** → `.dmg`
- On **Linux** → `.deb` + `.rpm` + `.AppImage`

### Manual steps

```bash
# 1. Build the web frontend
pnpm install
pnpm --filter @workspace/omnitransfer run build

# 2. Build the Tauri desktop app
cd omnitransfer/desktop
pnpm install
pnpm tauri build

# Outputs land in:
# omnitransfer/desktop/src-tauri/target/release/bundle/
#   msi/          ← Windows MSI
#   nsis/         ← Windows EXE
#   dmg/          ← macOS DMG
#   deb/          ← Linux DEB
#   rpm/          ← Linux RPM
#   appimage/     ← Linux AppImage
```

### Android

```bash
pnpm --filter @workspace/omnitransfer run build
cd omnitransfer/mobile
npm install
npx cap sync android
cd android
./gradlew assembleRelease
# APK → android/app/build/outputs/apk/release/
```

---

## Tauri Bundle Configuration

All bundle targets are defined in `desktop/src-tauri/tauri.conf.json`:

```json
"bundle": {
  "targets": "all",        ← builds ALL available targets for current OS
  "windows": {
    "wix": { ... },        ← produces .msi
    "nsis": { ... }        ← produces .exe
  },
  "macOS": { ... },        ← produces .dmg + .app
  "deb": { ... },          ← produces .deb
  "rpm": { ... },          ← produces .rpm
  "appimage": { ... }      ← produces .AppImage
}
```

---

## CI/CD Pipeline Summary

```
git push v0.1.0
       │
       ├─▶ [Windows runner]   cargo build --target x86_64-pc-windows-msvc
       │                      → OmniTransfer_0.1.0_x64_en-US.msi
       │                      → OmniTransfer_0.1.0_x64-setup.exe
       │
       ├─▶ [macOS runner]     cargo build --target x86_64-apple-darwin
       │                      → OmniTransfer_0.1.0_x64.dmg
       │
       ├─▶ [macOS runner]     cargo build --target aarch64-apple-darwin
       │                      → OmniTransfer_0.1.0_aarch64.dmg
       │
       ├─▶ [Linux runner]     cargo build --target x86_64-unknown-linux-gnu
       │                      → omnitransfer_0.1.0_amd64.deb
       │                      → omnitransfer_0.1.0_x86_64.rpm
       │                      → OmniTransfer_0.1.0_amd64.AppImage
       │
       └─▶ [Linux runner]     ./gradlew assembleRelease
                              → OmniTransfer-arm64-v8a-release.apk

All files → GitHub Releases page (draft until you publish)
```
