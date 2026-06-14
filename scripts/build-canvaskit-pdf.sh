#!/usr/bin/env bash
#
# Build a custom CanvasKit (Skia WASM) with the **PDF backend** enabled.
#
# The npm `canvaskit-wasm` package is compiled WITHOUT SkPDF, so the Skia PDF
# backend is unavailable at runtime. This script compiles a custom build with
# `skia_canvaskit_enable_pdf=true`. After it finishes, copy the produced
# `canvaskit.js` and `canvaskit.wasm` over the ones in `node_modules/canvaskit-wasm/bin/`
# (or adjust the import in src/skia/canvaskit.ts). The app feature-detects the
# PDF document factory and will automatically prefer the Skia backend.
#
# Requirements: git, python3, ~15 GB free disk, and time (first build is long).
# Reference: https://github.com/google/skia/tree/main/modules/canvaskit
set -euo pipefail

SKIA_DIR="${SKIA_DIR:-$HOME/skia}"
EMSDK_VERSION="${EMSDK_VERSION:-3.1.44}"

echo "==> Fetching depot_tools"
if [ ! -d "$HOME/depot_tools" ]; then
  git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git "$HOME/depot_tools"
fi
export PATH="$HOME/depot_tools:$PATH"

echo "==> Fetching Skia into $SKIA_DIR"
if [ ! -d "$SKIA_DIR" ]; then
  git clone https://skia.googlesource.com/skia.git "$SKIA_DIR"
fi
cd "$SKIA_DIR"
python3 tools/git-sync-deps

echo "==> Installing Emscripten ($EMSDK_VERSION)"
if [ ! -d "$SKIA_DIR/../emsdk" ]; then
  git clone https://github.com/emscripten-core/emsdk.git "$SKIA_DIR/../emsdk"
fi
( cd "$SKIA_DIR/../emsdk" && ./emsdk install "$EMSDK_VERSION" && ./emsdk activate "$EMSDK_VERSION" )
# shellcheck disable=SC1091
source "$SKIA_DIR/../emsdk/emsdk_env.sh"

echo "==> Building CanvasKit with PDF backend enabled"
# The CanvasKit build script accepts feature flags; --enable-pdf flips
# skia_canvaskit_enable_pdf=true in the generated GN args.
cd "$SKIA_DIR/modules/canvaskit"
./compile.sh --enable-pdf

echo "==> Done."
echo "Artifacts are in: $SKIA_DIR/out/canvaskit_wasm/"
echo "Copy canvaskit.js + canvaskit.wasm into node_modules/canvaskit-wasm/bin/ to enable the Skia PDF backend."
