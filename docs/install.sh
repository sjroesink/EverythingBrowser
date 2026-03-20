#!/usr/bin/env bash
# EverythingBrowser installer for macOS and Linux
# Usage: curl -fsSL https://everythingbrowser.roesink.dev/install.sh | bash
set -euo pipefail

REPO="sjroesink/EverythingBrowser"
NAME="EverythingBrowser"
API_URL="https://api.github.com/repos/$REPO/releases/latest"

echo ""
echo "  Installing $NAME..."
echo ""

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64)  ARCH="x64" ;;
  aarch64) ARCH="arm64" ;;
  arm64)   ARCH="arm64" ;;
  *)
    echo "  Error: Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

RELEASE_JSON="$(curl -fsSL "$API_URL")"

case "$OS" in
  Darwin)
    ASSET_URL="$(echo "$RELEASE_JSON" | grep -Eo "https://[^\"]+\.dmg" | head -n 1 || true)"
    if [ -z "$ASSET_URL" ]; then
      echo "  Error: No macOS .dmg asset found in the latest release."
      exit 1
    fi
    OUTFILE="/tmp/$NAME.dmg"
    echo "  Downloading $NAME for macOS..."
    curl -fSL "$ASSET_URL" -o "$OUTFILE"
    echo "  Opening DMG..."
    open "$OUTFILE"
    echo ""
    echo "  Done! Drag $NAME to your Applications folder."
    ;;
  Linux)
    ASSET_URL="$(echo "$RELEASE_JSON" | grep -Eo "https://[^\"]+\.AppImage" | head -n 1 || true)"
    if [ -n "$ASSET_URL" ]; then
      INSTALL_DIR="$HOME/.local/bin"
      mkdir -p "$INSTALL_DIR"
      OUTFILE="$INSTALL_DIR/$NAME.AppImage"
      echo "  Downloading $NAME AppImage..."
      curl -fSL "$ASSET_URL" -o "$OUTFILE"
      chmod +x "$OUTFILE"
      echo ""
      echo "  Installed to $OUTFILE"
      echo "  Run it with: $NAME.AppImage"
      case ":$PATH:" in
        *":$INSTALL_DIR:"*) ;;
        *)
          echo ""
          echo "  Tip: Add $INSTALL_DIR to your PATH:"
          echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
          ;;
      esac
    else
      DEB_URL="$(echo "$RELEASE_JSON" | grep -Eo "https://[^\"]+\.deb" | head -n 1 || true)"
      if [ -z "$DEB_URL" ]; then
        echo "  Error: No Linux AppImage or .deb asset found in the latest release."
        exit 1
      fi
      OUTFILE="/tmp/$NAME.deb"
      echo "  Downloading $NAME .deb..."
      curl -fSL "$DEB_URL" -o "$OUTFILE"
      if command -v apt-get >/dev/null 2>&1; then
        echo "  Installing via apt..."
        sudo apt-get install -y "$OUTFILE"
      else
        echo "  Downloaded $OUTFILE. Install manually with your package manager."
      fi
    fi
    ;;
  *)
    echo "  Error: Unsupported OS: $OS (use install.ps1 for Windows)"
    exit 1
    ;;
esac

echo ""
echo "  Done!"
echo ""
