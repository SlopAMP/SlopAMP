#!/usr/bin/env bash
# Makes dist/update-test/: a local "release" for trying the auto-updater without publishing.
# Run after build-win.sh. On the PC, double-click a .bat in that folder (SlopAMP closed first).
# The .bat files set SLOPAMP_UPDATE_TEST (path of a release.json) and SLOPAMP_TEST_VERSION (the
# version SlopAMP pretends to be), so the installed build sees this folder's release as an update.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="$(node -p "require('$ROOT/package.json').version")"
OUT="$ROOT/dist/update-test"
SETUP="$ROOT/dist/SlopAMP-Setup-$VER.exe"
[ -f "$SETUP" ] || { echo "missing $SETUP (run build-win.sh first)"; exit 1; }
rm -rf "$OUT"; mkdir -p "$OUT"
HASH="$(sha256sum "$SETUP" | cut -d' ' -f1)"
SIZE="$(stat -c %s "$SETUP")"
PORT="$ROOT/dist/SlopAMP-Portable-$VER.exe"
PHASH="$( [ -f "$PORT" ] && sha256sum "$PORT" | cut -d' ' -f1 || echo none)"

release() {   # $1 = file, $2 = SHA256 lines for the notes
  python3 - "$OUT/$1" "$VER" "$SIZE" "$2" <<'PY'
import json, sys
out, ver, size, sums = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
body = (f"## What's new\n- **Auto-updates**: this is a local TEST release for SlopAMP {ver}.\n"
        "- Links work too: [SlopAMP on GitHub](https://github.com/SlopAMP/SlopAMP)\n\n"
        "## Fixes\n- Nothing real. If you can read this, the What's new box works.\n\n" + sums)
json.dump({"tag_name": f"v{ver}", "name": f"SlopAMP {ver} (TEST)", "draft": False, "prerelease": False,
           "published_at": "2026-10-20T12:00:00Z", "html_url": "https://github.com/SlopAMP/SlopAMP/releases",
           "body": body, "assets": [{"name": f"SlopAMP-Setup-{ver}.exe", "size": size,
           "browser_download_url": f"SlopAMP-Setup-{ver}.exe"}]}, open(out, "w"), indent=1)
PY
}
release release.json "SHA256 (SlopAMP-Setup-$VER.exe): $HASH
SHA256 (SlopAMP-Portable-$VER.exe): $PHASH"
release release-badhash.json "SHA256 (SlopAMP-Setup-$VER.exe): $(printf '0%.0s' {1..64})"
release release-nohash.json "(no checksum line in this one)"

bat() {   # $1 = .bat name, $2 = release json, $3 = exe to start
  cat > "$OUT/$1" <<EOF
@echo off
rem SlopAMP updater test: pretends to be 1.1.9 and reads $2 instead of GitHub.
tasklist /FI "IMAGENAME eq SlopAMP.exe" | find /I "SlopAMP.exe" >nul && (echo Close SlopAMP first, then run this again. & pause & exit /b 1)
if not exist "%~dp0SlopAMP-Setup-$VER.exe" copy /Y "%~dp0..\\SlopAMP-Setup-$VER.exe" "%~dp0" >nul
if not exist "%~dp0SlopAMP-Setup-$VER.exe" (echo Put SlopAMP-Setup-$VER.exe in the folder above this one. & pause & exit /b 1)
set "SLOPAMP_UPDATE_TEST=%~dp0$2"
set "SLOPAMP_TEST_VERSION=1.1.9"
start "" $3
EOF
  sed -i 's/$/\r/' "$OUT/$1"
}
INSTALLED='"%LOCALAPPDATA%\Programs\SlopAMP\SlopAMP.exe"'
bat "1 Test update.bat" release.json "$INSTALLED"
bat "2 Test bad checksum.bat" release-badhash.json "$INSTALLED"
bat "3 Test missing checksum.bat" release-nohash.json "$INSTALLED"
bat "4 Test portable.bat" release.json "\"%~dp0..\\SlopAMP-Portable-$VER.exe\""
echo "made $OUT (Setup sha256 $HASH)"
ls -la "$OUT"
