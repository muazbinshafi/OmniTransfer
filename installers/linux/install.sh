#!/usr/bin/env bash
# OmniTransfer Linux Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/muazbinshafi/OmniTransfer/main/installers/linux/install.sh | bash

set -euo pipefail

REPO_OWNER="muazbinshafi"
REPO_NAME="OmniTransfer"
INSTALL_DIR="/usr/local/bin"
DESKTOP_DIR="/usr/share/applications"
APP_DIR="/opt/omnitransfer"

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "  ${CYAN}OmniTransfer — Linux Installer${NC}"
echo -e "  ${CYAN}Developed by MuazBinShafi${NC}"
echo ""

ARCH=$(uname -m)
echo "  Architecture: $ARCH"

# Detect distro for package format preference
if command -v dpkg &>/dev/null; then
    PKG_FORMAT="deb"
elif command -v rpm &>/dev/null; then
    PKG_FORMAT="rpm"
else
    PKG_FORMAT="appimage"
fi
echo "  Package format: $PKG_FORMAT"

# Fetch latest release
echo "  Fetching latest release..."
API_URL="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest"
RELEASE_JSON=$(curl -fsSL "$API_URL")
VERSION=$(echo "$RELEASE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['tag_name'])" 2>/dev/null || echo "")

if [[ -z "$VERSION" ]]; then
    echo -e "  ${RED}Could not determine latest version.${NC}"
    echo "  Visit: https://github.com/${REPO_OWNER}/${REPO_NAME}/releases"
    exit 1
fi
echo -e "  Latest version: ${GREEN}$VERSION${NC}"

# Find asset matching arch + format
ASSET_URL=$(echo "$RELEASE_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
assets = data.get('assets', [])
arch = '$ARCH'
fmt = '$PKG_FORMAT'
# Try exact match first
for a in assets:
    n = a['name'].lower()
    if arch in n and fmt in n:
        print(a['browser_download_url'])
        break
else:
    # Fall back to AppImage
    for a in assets:
        if a['name'].endswith('.AppImage'):
            print(a['browser_download_url'])
            break
" 2>/dev/null || echo "")

if [[ -z "$ASSET_URL" ]]; then
    echo -e "  ${YELLOW}No binary found. Build from source:${NC}"
    echo "    git clone https://github.com/${REPO_OWNER}/${REPO_NAME}.git"
    echo "    cd OmniTransfer/desktop && pnpm install && pnpm tauri build"
    exit 1
fi

TMPDIR=$(mktemp -d)
FILENAME=$(basename "$ASSET_URL")
ASSET_PATH="${TMPDIR}/${FILENAME}"

echo "  Downloading ${FILENAME}..."
curl -fL --progress-bar "$ASSET_URL" -o "$ASSET_PATH"

echo "  Installing..."
case "$FILENAME" in
    *.deb)
        sudo dpkg -i "$ASSET_PATH"
        sudo apt-get install -f -y 2>/dev/null || true
        ;;
    *.rpm)
        sudo rpm -U "$ASSET_PATH"
        ;;
    *.AppImage)
        sudo mkdir -p "$APP_DIR"
        sudo cp "$ASSET_PATH" "${APP_DIR}/OmniTransfer.AppImage"
        sudo chmod +x "${APP_DIR}/OmniTransfer.AppImage"
        sudo ln -sf "${APP_DIR}/OmniTransfer.AppImage" "${INSTALL_DIR}/omnitransfer"
        # Create .desktop entry
        sudo tee "${DESKTOP_DIR}/omnitransfer.desktop" > /dev/null <<EOF
[Desktop Entry]
Name=OmniTransfer
Comment=Zero-config wireless file transfer
Exec=${APP_DIR}/OmniTransfer.AppImage
Icon=omnitransfer
Terminal=false
Type=Application
Categories=Network;FileTransfer;
Keywords=transfer;wifi;bluetooth;file;
EOF
        sudo update-desktop-database 2>/dev/null || true
        ;;
    *.tar.gz)
        sudo mkdir -p "$APP_DIR"
        tar -xzf "$ASSET_PATH" -C "$APP_DIR" --strip-components=1
        sudo ln -sf "${APP_DIR}/omnitransfer" "${INSTALL_DIR}/omnitransfer"
        ;;
esac

rm -rf "$TMPDIR"

echo ""
echo -e "  ${GREEN}OmniTransfer ${VERSION} installed!${NC}"
echo "  Launch: omnitransfer"
echo "  Or find 'OmniTransfer' in your application menu."
echo ""
echo -e "  ${CYAN}Required system packages for BLE (if not already installed):${NC}"
echo "    Ubuntu/Debian: sudo apt install bluez libbluetooth-dev"
echo "    Fedora/RHEL:   sudo dnf install bluez bluez-libs"
echo "    Arch:          sudo pacman -S bluez bluez-utils"
echo ""
echo -e "  ${CYAN}Open OmniTransfer and press 'Scan' to discover nearby devices.${NC}"
