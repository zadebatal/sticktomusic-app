#!/bin/bash
# Build StickToMusic Desktop App
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$ROOT/.electron-stage"

echo "=== Building StickToMusic Desktop ==="

# Step 1: Build React
echo "[1/4] Building React production bundle..."
cd "$ROOT"
GENERATE_SOURCEMAP=false CI=false npx react-scripts build 2>&1 | tail -3

# Step 2: Create clean staging directory
echo "[2/4] Creating staging directory..."
rm -rf "$STAGE"
mkdir -p "$STAGE"

# Copy only what the app needs
# Rename build to app-build (electron-builder blacklists "build/" by default)
cp -R "$ROOT/build" "$STAGE/app-build"
mkdir -p "$STAGE/electron/bin"
cp "$ROOT/electron/main.js" "$STAGE/electron/"
cp "$ROOT/electron/preload.js" "$STAGE/electron/"
cp "$ROOT/electron/afterPack.js" "$STAGE/electron/" 2>/dev/null || true
cp "$ROOT/electron/bin/yt-dlp" "$STAGE/electron/bin/" 2>/dev/null || true
chmod +x "$STAGE/electron/bin/yt-dlp" 2>/dev/null || true
cp "$ROOT/public/icon.icns" "$STAGE/icon.icns" 2>/dev/null || true

# Create package.json with only main process deps
cat > "$STAGE/package.json" << 'EOF'
{
  "name": "sticktomusic-app",
  "version": "1.0.0",
  "description": "The Content Engine for Music Artists",
  "author": "StickToMusic <zadebatal@gmail.com>",
  "private": true,
  "main": "electron/main.js",
  "dependencies": {
    "express": "^4.22.1",
    "electron-store": "^10.1.0",
    "electron-updater": "^6.8.3"
  }
}
EOF

# Create electron-builder config
cat > "$STAGE/electron-builder.yml" << EOF
appId: com.sticktomusic.app
productName: StickToMusic
mac:
  target: dir
  category: public.app-category.music
  icon: icon.icns
directories:
  output: "$ROOT/dist"
asar: false
electronVersion: "33.4.11"
files:
  - "**/*"
publish:
  provider: github
  owner: zadebatal
  repo: sticktomusic-app
EOF

echo "[3/4] Installing production dependencies..."
cd "$STAGE"
npm install --production --no-optional 2>&1 | tail -3

# Step 4: Build with electron-builder
echo "[4/4] Packaging with electron-builder..."
npx electron-builder --mac --config electron-builder.yml 2>&1 | tail -5

# Cleanup staging
rm -rf "$STAGE"

echo ""
echo "=== Build Complete ==="
APP=$(ls "$ROOT/dist/mac-arm64/" 2>/dev/null | head -1)
if [ -n "$APP" ]; then
  echo "App: dist/mac-arm64/$APP"
  du -sh "$ROOT/dist/mac-arm64/$APP"
else
  echo "Build failed — check output above"
fi
