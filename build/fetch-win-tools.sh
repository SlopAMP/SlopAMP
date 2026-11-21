#!/usr/bin/env bash
# Downloads the pinned tools for the Windows build into vendor/win-tools (git-ignored), checks each file's SHA256,
# and unpacks them in the layout build-win.sh expects (TOOLS=vendor/win-tools). Run on Linux (x86-64), without root.
# Re-running it skips files that are already there and correct. FFmpeg and yt-dlp are the same releases as the
# Linux build (fetch-linux-tools.sh), so both platforms bundle the same versions (3.2.1).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="${TOOLS:-$ROOT/vendor/win-tools}"
DL="$T/downloads"
mkdir -p "$DL"

# file | url | sha256
# The SHA256s come from the publisher's checksum file where there is one: Electron's SHASUMS256.txt, BtbN's
# checksums.sha256 (same autobuild as the Linux FFmpeg), yt-dlp's SHA2-256SUMS, Kron4ek's sha256sums.txt. NSIS
# (electron-builder-binaries), rcedit and 7-Zip publish none: theirs are the files' SHA256 when first pinned (3.2.1).
FILES=(
  "electron-v45.3.3-win32-x64.zip|https://github.com/electron/electron/releases/download/v45.3.3/electron-v45.3.3-win32-x64.zip|49dd2d3875944f08de03d34595cd30093c588b9edcabb41a0ac481028a3a5a8a"
  "ffmpeg-N-129046-g3a78197c4c-win64-lgpl-shared.zip|https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-11-18-12-39/ffmpeg-N-129046-g3a78197c4c-win64-lgpl-shared.zip|2fd92fe6fb754de102c06fbe4918705adb6e914b209c481a318498031affec27"
  "yt-dlp.exe|https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe|f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d"
  "nsis-3.0.4.1.7z|https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-3.0.4.1/nsis-3.0.4.1.7z|9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa"
  "rcedit-x64.exe|https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe|3e7801db1a5edbec91b49a24a094aad776cb4515488ea5a4ca2289c400eade2a"
  "wine-11.2-amd64-wow64.tar.xz|https://github.com/Kron4ek/Wine-Builds/releases/download/11.2/wine-11.2-amd64-wow64.tar.xz|c287bfd6ebdacd28bafed7e8bc4361522f52f1ecf03541665a61819720721d15"
  "7z2601-linux-x64.tar.xz|https://github.com/ip7z/7zip/releases/download/26.01/7z2601-linux-x64.tar.xz|8ea0fc8a135e7b848e80a4116fe22dff56c8c4518dde1f43cce67f4e340b437a"
)

sha() { sha256sum "$1" | awk '{print $1}'; }
for row in "${FILES[@]}"; do
  IFS='|' read -r name url want <<< "$row"
  f="$DL/$name"
  if [ -f "$f" ] && [ "$(sha "$f")" = "$want" ]; then echo "ok    $name"; continue; fi
  echo "fetch $name"
  curl -fL --retry 3 --proto '=https' -o "$f.part" "$url"
  got="$(sha "$f.part")"
  [ "$got" = "$want" ] || { rm -f "$f.part"; echo "SHA256 mismatch for $name: got $got, expected $want"; exit 1; }
  mv "$f.part" "$f"
done

# 7-Zip (only to unpack NSIS)
rm -rf "$T/7z"; mkdir -p "$T/7z"
tar -xJf "$DL/7z2601-linux-x64.tar.xz" -C "$T/7z"
# Electron
rm -rf "$T/electron-win"; mkdir -p "$T/electron-win"
unzip -q "$DL/electron-v45.3.3-win32-x64.zip" -d "$T/electron-win"
# FFmpeg: ffmpeg-win/<the build's own folder>/ (bin/, LICENSE.txt); build-win.sh reads the version from its name
rm -rf "$T/ffmpeg-win"; mkdir -p "$T/ffmpeg-win"
unzip -q "$DL/ffmpeg-N-129046-g3a78197c4c-win64-lgpl-shared.zip" -d "$T/ffmpeg-win"
# yt-dlp
mkdir -p "$T/ytdlp"; install -m 644 "$DL/yt-dlp.exe" "$T/ytdlp/yt-dlp.exe"
# NSIS (with its Linux makensis), rcedit, Wine
rm -rf "$T/nsis"; mkdir -p "$T/nsis"
"$T/7z/7zz" x -y -o"$T/nsis" "$DL/nsis-3.0.4.1.7z" >/dev/null
chmod +x "$T/nsis/linux/makensis"
install -m 644 "$DL/rcedit-x64.exe" "$T/rcedit-x64.exe"
rm -rf "$T/wine-11.2-amd64-wow64"; tar -xJf "$DL/wine-11.2-amd64-wow64.tar.xz" -C "$T"

[ "$(ls -d "$T"/ffmpeg-win/*/ | wc -l)" = 1 ] || { echo "expected exactly one folder in $T/ffmpeg-win"; exit 1; }
echo "Electron $(cat "$T/electron-win/version") | $(basename "$(ls -d "$T"/ffmpeg-win/*/)") | yt-dlp 2026.10.26 | NSIS 3.0.4.1 | rcedit 2.0.0 | Wine 11.2"
echo "Tools ready in $T (TOOLS=$T bash build/build-win.sh)"
