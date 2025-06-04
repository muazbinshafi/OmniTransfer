#!/usr/bin/env bash
# OmniTransfer macOS Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/muazbinshafi/OmniTransfer/main/installers/macos/install.sh | bash

set -euo pipefail

REPO_OWNER="muazbinshafi"
REPO_NAME="OmniTransfer"
APP_NAME="OmniTransfer"
INSTALL_DIR="/Applications"

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "  ${CYAN}OmniTransfer — macOS Installer${NC}"
echo -e "  ${CYAN}Developed by MuazBinShafi${NC}"
echo ""

# Detect Apple Silicon vs Intel
ARCH=$(uname -m)
if [[ "$ARCH" == "arm64" ]]; then
    TARGET="aarch64-apple-darwin"
    echo "  Architecture: Apple Silicon (M1/M2/M3)"
else
    TARGET="x86_64-apple-darwin"
    echo "  Architecture: Intel x86_64"
fi

# Fetch latest release
echo "  Fetching latest release..."
API_URL="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest"
RELEASE_JSON=$(curl -fsSL "$API_URL")
VERSION=$(echo "$RELEASE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['tag_name'])" 2>/dev/null || echo "")

if [[ -z "$VERSION" ]]; then
    echo -e "  ${RED}Could not determine latest version. Download manually:${NC}"
    echo -e "  https://github.com/${REPO_OWNER}/${REPO_NAME}/releases"
    exit 1
fi

echo -e "  Latest version: ${GREEN}$VERSION${NC}"

# Find the .dmg asset
DMG_URL=$(echo "$RELEASE_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
assets = data.get('assets', [])
target = '$TARGET'
for a in assets:
    if target in a['name'] and a['name'].endswith('.dmg'):
        print(a['browser_download_url'])
        break
else:
    for a in assets:
        if a['name'].endswith('.dmg'):
            print(a['browser_download_url'])
            break
" 2>/dev/null || echo "")

if [[ -z "$DMG_URL" ]]; then
    echo -e "  ${YELLOW}No .dmg found. Trying Homebrew cask...${NC}"
    if command -v brew &>/dev/null; then
        brew install --cask omnitransfer 2>/dev/null || true
    fi
    echo -e "  ${YELLOW}Or download from: https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/${VERSION}${NC}"
    exit 1
fi

TMPDIR=$(mktemp -d)
DMG_PATH="${TMPDIR}/OmniTransfer.dmg"

echo "  Downloading OmniTransfer ${VERSION}..."
curl -fL --progress-bar "$DMG_URL" -o "$DMG_PATH"

echo "  Mounting disk image..."
MOUNTPOINT=$(hdiutil attach "$DMG_PATH" -nobrowse -readonly | tail -n1 | awk '{print $NF}')

echo "  Installing to ${INSTALL_DIR}..."
if [[ -d "${INSTALL_DIR}/${APP_NAME}.app" ]]; then
    rm -rf "${INSTALL_DIR}/${APP_NAME}.app"
fi
cp -R "${MOUNTPOINT}/${APP_NAME}.app" "${INSTALL_DIR}/"

echo "  Unmounting..."
hdiutil detach "$MOUNTPOINT" -quiet

rm -rf "$TMPDIR"

# Remove quarantine attribute so macOS doesn't block launch
xattr -rd com.apple.quarantine "${INSTALL_DIR}/${APP_NAME}.app" 2>/dev/null || true

echo ""
echo -e "  ${GREEN}OmniTransfer ${VERSION} installed to /Applications!${NC}"
echo "  Launch from Spotlight (Cmd+Space → OmniTransfer) or:"
echo "    open /Applications/OmniTransfer.app"
echo ""
echo -e "  ${CYAN}Open OmniTransfer and press 'Scan' to discover nearby devices.${NC}"
