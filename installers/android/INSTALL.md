# OmniTransfer — Android Installation Guide

**Developed by MuazBinShafi**

---

## Method 1: Direct APK Download (Recommended)

1. On your Android device, open this URL in Chrome:  
   **https://github.com/muazbinshafi/OmniTransfer/releases/latest**

2. Tap the file `OmniTransfer-arm64-v8a-release.apk` (or `armeabi-v7a` for older devices)

3. If prompted, allow **"Install from unknown sources"** for your browser:  
   - Android 8+: Settings → Apps → Chrome → Install unknown apps → Allow  
   - Android 7 and below: Settings → Security → Unknown sources → Enable

4. Tap **Install** when the installer appears

5. Open **OmniTransfer** from your app drawer

---

## Method 2: ADB Sideload (Developer)

```bash
# Enable Developer Options on your Android device:
# Settings → About Phone → tap "Build Number" 7 times
# Then: Settings → Developer Options → USB Debugging → Enable

# Download the APK
curl -L -o OmniTransfer.apk \
  https://github.com/muazbinshafi/OmniTransfer/releases/latest/download/OmniTransfer-arm64-v8a-release.apk

# Install via ADB
adb install OmniTransfer.apk
```

---

## Method 3: Build from Source

### Prerequisites
- Android Studio Hedgehog (2023.1.1) or newer
- Android SDK API 34
- Java 17
- Node.js 20+ and pnpm 9+

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/muazbinshafi/OmniTransfer.git
cd OmniTransfer

# 2. Build the web assets
pnpm install
pnpm --filter @workspace/omnitransfer run build

# 3. Sync to Android project
cd omnitransfer/mobile
pnpm install
npx cap sync android

# 4. Build APK
cd android
./gradlew assembleRelease

# APK location:
# android/app/build/outputs/apk/release/app-release.apk
```

---

## Required Permissions

OmniTransfer requests the following permissions and why:

| Permission | Purpose |
|---|---|
| `BLUETOOTH_SCAN` | Discover nearby OmniTransfer devices |
| `BLUETOOTH_ADVERTISE` | Announce this device to peers |
| `BLUETOOTH_CONNECT` | Connect to discovered peers |
| `NEARBY_WIFI_DEVICES` | Wi-Fi Direct for high-speed transfer |
| `ACCESS_WIFI_STATE` / `CHANGE_WIFI_STATE` | Create local Wi-Fi hotspot |
| `READ_EXTERNAL_STORAGE` (Android ≤12) | Read files to send |
| `READ_MEDIA_*` (Android 13+) | Read photos, videos, audio to send |

OmniTransfer **never** sends data to the internet. All transfers are device-to-device.

---

## Supported Android Versions

| Android Version | BLE | Wi-Fi Direct | Notes |
|---|---|---|---|
| Android 8.0 (API 26) | ✅ | ✅ | Minimum supported |
| Android 10 (API 29) | ✅ | ✅ | Local-only hotspot |
| Android 12 (API 31) | ✅ | ✅ | New BLE permissions required |
| Android 13 (API 33) | ✅ | ✅ | Media permissions split |
| Android 14 (API 34) | ✅ | ✅ | Full support |

---

## Troubleshooting

**"No devices found" after scanning**
- Ensure both devices have OmniTransfer open and scanning
- Make sure Bluetooth is enabled on both devices
- On Android 12+, grant the "Nearby Devices" permission

**Transfer speed is slow**
- Use Wi-Fi Direct mode (both devices on same network or hotspot)
- Close other apps using Wi-Fi

**App crashes on launch**
- Check that Android 8.0+ is running
- Try reinstalling the APK

---

## Uninstall

Settings → Apps → OmniTransfer → Uninstall
