# OmniTransfer — iOS Installation Guide

**Developed by MuazBinShafi**

---

## Method 1: TestFlight (Beta)

1. Install [TestFlight](https://apps.apple.com/app/testflight/id899247664) from the App Store
2. Tap the TestFlight invite link:  
   *(Link provided when beta is live)*
3. Tap **Accept** → **Install**
4. Open **OmniTransfer** from your Home Screen

---

## Method 2: App Store *(coming soon)*

Search "OmniTransfer" in the App Store.

---

## Method 3: Build & Sideload with Xcode

### Prerequisites
- macOS 13+ with Xcode 15+
- Apple Developer account (free works for personal sideloading)
- iOS 14+ device
- Node.js 20+, pnpm 9+

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/muazbinshafi/OmniTransfer.git
cd OmniTransfer

# 2. Build web assets
pnpm install
pnpm --filter @workspace/omnitransfer run build

# 3. Sync Capacitor
cd omnitransfer/mobile
pnpm install
npx cap sync ios

# 4. Open in Xcode
npx cap open ios
```

**In Xcode:**
1. Select your team in **Signing & Capabilities → Team**
2. Change bundle ID to something unique: `com.yourname.omnitransfer`
3. Connect your iPhone/iPad via USB
4. Select your device in the toolbar
5. Click **▶ Run**

### Required Entitlements (automatically added)

| Entitlement | Purpose |
|---|---|
| `com.apple.developer.networking.networkextension` | Local Wi-Fi hotspot |
| `NSBonjourServices` | mDNS peer discovery |
| `NSLocalNetworkUsageDescription` | LAN scanning |
| `NSBluetoothAlwaysUsageDescription` | BLE discovery |

---

## Method 4: AltStore Sideload (No Mac Required)

1. Install [AltStore](https://altstore.io) on your PC/Mac
2. Download the `.ipa` from [Releases](https://github.com/muazbinshafi/OmniTransfer/releases/latest)
3. Drag the `.ipa` to AltStore on your device

> **Note:** Free sideloading expires after 7 days and requires re-signing. Apple Developer membership ($99/year) removes this limit.

---

## Supported iOS Versions

| iOS Version | BLE | NEHotspot | Notes |
|---|---|---|---|
| iOS 14.0 | ✅ | ✅ | Minimum supported |
| iOS 15.0 | ✅ | ✅ | NWBrowser improvements |
| iOS 16.0 | ✅ | ✅ | Full support |
| iOS 17.0 | ✅ | ✅ | Enhanced local network |
| iPadOS 14+ | ✅ | ✅ | Full support |

---

## Required Permissions (iOS will ask on first use)

| Permission | Why |
|---|---|
| Bluetooth | Discover nearby OmniTransfer devices |
| Local Network | Find devices on Wi-Fi for high-speed transfer |
| Files / Photo Library | Select files to send |

---

## Troubleshooting

**"No devices found"**
- Both devices must have OmniTransfer open
- Grant Bluetooth permission: Settings → OmniTransfer → Bluetooth → On
- Grant Local Network permission: Settings → OmniTransfer → Local Network → On

**Hotspot not working**
- Requires Apple Developer entitlement in production builds
- TestFlight and App Store builds have full hotspot support

**Sideloaded app expired**
- Re-run the sideload via AltStore or Xcode

---

## Uninstall

Long-press OmniTransfer on the Home Screen → Remove App → Delete App
