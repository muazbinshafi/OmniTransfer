#!/usr/bin/env bash
# OmniTransfer — Local build script
# Builds the installer for the current platform only.
# Run this on each platform to get the native installer.
#
# Outputs:
#   Windows  → src-tauri/target/release/bundle/msi/*.msi
#                                               nsis/*.exe
#   macOS    → src-tauri/target/release/bundle/dmg/*.dmg
#   Linux    → src-tauri/target/release/bundle/deb/*.deb
#                                               rpm/*.rpm
#                                               appimage/*.AppImage
#
# For ALL platforms at once, push a git tag → GitHub Actions builds everything.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo -e "${CYAN}OmniTransfer — Local Build${NC}"
echo -e "${CYAN}Developed by MuazBinShafi${NC}"
echo ""

OS=$(uname -s)
ARCH=$(uname -m)
echo "  Platform: $OS / $ARCH"

# ── Prerequisites check ─────────────────────────────────────────────────────
check_cmd() {
    if ! command -v "$1" &>/dev/null; then
        echo -e "  ${YELLOW}Missing: $1${NC} — $2"
        exit 1
    fi
}

check_cmd pnpm    "Install from https://pnpm.io"
check_cmd cargo   "Install Rust from https://rustup.rs"
check_cmd node    "Install from https://nodejs.org"

# Linux extra deps
if [[ "$OS" == "Linux" ]]; then
    MISSING_PKGS=""
    for pkg in libwebkit2gtk-4.0-dev libssl-dev libgtk-3-dev patchelf; do
        dpkg -s "$pkg" &>/dev/null 2>&1 || MISSING_PKGS="$MISSING_PKGS $pkg"
    done
    if [[ -n "$MISSING_PKGS" ]]; then
        echo -e "  ${YELLOW}Installing missing system packages:${NC}$MISSING_PKGS"
        sudo apt-get install -y $MISSING_PKGS
    fi
fi

# ── Step 1: Build web assets ────────────────────────────────────────────────
echo ""
echo "  [1/3] Building web assets..."
cd "$REPO_ROOT"
pnpm install
pnpm --filter @workspace/omnitransfer run build
echo -e "  ${GREEN}✓ Web assets built → artifacts/omnitransfer/dist/${NC}"

# ── Step 2: Build Tauri desktop app ─────────────────────────────────────────
echo ""
echo "  [2/3] Building Tauri desktop app..."
cd "$REPO_ROOT/omnitransfer/desktop"
pnpm install
pnpm tauri build

echo -e "  ${GREEN}✓ Desktop app built${NC}"

# ── Step 3: List outputs ────────────────────────────────────────────────────
echo ""
echo "  [3/3] Build outputs:"
echo ""

BUNDLE_DIR="$REPO_ROOT/omnitransfer/desktop/src-tauri/target/release/bundle"

if [[ "$OS" == "Darwin" ]]; then
    echo -e "  ${GREEN}macOS bundles:${NC}"
    find "$BUNDLE_DIR/dmg" -name "*.dmg" 2>/dev/null | while read f; do
        echo "    📦 $f"
    done
    find "$BUNDLE_DIR/macos" -name "*.app" 2>/dev/null | while read f; do
        echo "    🖥️  $f"
    done

elif [[ "$OS" == "Linux" ]]; then
    echo -e "  ${GREEN}Linux bundles:${NC}"
    find "$BUNDLE_DIR/deb" -name "*.deb" 2>/dev/null | while read f; do
        echo "    📦 $f  (Debian/Ubuntu)"
    done
    find "$BUNDLE_DIR/rpm" -name "*.rpm" 2>/dev/null | while read f; do
        echo "    📦 $f  (Fedora/RHEL)"
    done
    find "$BUNDLE_DIR/appimage" -name "*.AppImage" 2>/dev/null | while read f; do
        echo "    📦 $f  (Universal)"
    done

else
    echo "  Run this script on the target platform."
fi

echo ""
echo -e "${CYAN}To build ALL platforms simultaneously:${NC}"
echo "  git tag v0.1.0 && git push origin v0.1.0"
echo "  → GitHub Actions will build Windows .msi/.exe, macOS .dmg,"
echo "    Linux .deb/.rpm/.AppImage, and Android .apk automatically."
echo ""
