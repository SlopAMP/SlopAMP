#!/usr/bin/env bash
# Downloads the pinned tools for the macOS build into vendor/mac-tools (git-ignored), checks each file's SHA256,
# unpacks them in the layout build-mac.sh expects (TOOLS=vendor/mac-tools) and builds FFmpeg from source
# (build/mac/build-ffmpeg.sh; a few minutes the first time). It also links vendor/ffmpeg/darwin and
# vendor/ytdlp/darwin, so Electron started in a checkout finds FFmpeg and yt-dlp. Runs on a Mac.
#   ARCH=arm64 (Apple silicon) or ARCH=x64 (Intel); default: this Mac's. Run it once per ARCH you want to build.
# Re-running it skips what is already there and correct.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="${TOOLS:-$ROOT/vendor/mac-tools}"
DL="$T/downloads"
HOSTA="$([ "$(uname -m)" = arm64 ] && echo arm64 || echo x64)"
A="${ARCH:-$HOSTA}"; [ "$A" = x86_64 ] && A=x64
case "$A" in arm64|x64) ;; *) echo "ARCH must be arm64 or x64"; exit 1 ;; esac
FA="$([ "$A" = arm64 ] && echo arm64 || echo x86_64)"      # the same, as clang and FFmpeg call it
[ "$(uname -s)" = Darwin ] || { echo "the macOS build runs on a Mac"; exit 1; }
mkdir -p "$DL"

# file | url | sha256 (from the publisher's release page / checksum file). Electron and yt-dlp are the same releases
# as the Windows and Linux builds'; yt-dlp_macos is one file for both kinds of Mac.
FILES=(
  "electron-v45.3.3-darwin-arm64.zip|https://github.com/electron/electron/releases/download/v45.3.3/electron-v45.3.3-darwin-arm64.zip|25ae0ce40ee462433c1029b8fcc485949fc8a89394b62b70887d7793898edc89"
  "electron-v45.3.3-darwin-x64.zip|https://github.com/electron/electron/releases/download/v45.3.3/electron-v45.3.3-darwin-x64.zip|151d249b646eb8b99f1bea40aff217b10d8e21246ad8c07bb3a5982e2722660f"
  "yt-dlp_macos|https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp_macos|0f922c15ccc0b83eefa1c8bc9104e434318c4bf16e408e1ee93b7745a6efe0aa"
)

sha() { shasum -a 256 "$1" | awk '{print $1}'; }
for row in "${FILES[@]}"; do
  IFS='|' read -r name url want <<< "$row"
  case "$name" in electron-*) [ "$name" = "electron-v45.3.3-darwin-$A.zip" ] || continue ;; esac
  f="$DL/$name"
  if [ -f "$f" ] && [ "$(sha "$f")" = "$want" ]; then echo "ok    $name"; continue; fi
  echo "fetch $name"
  curl -fL --retry 3 --proto '=https' -o "$f.part" "$url"
  got="$(sha "$f.part")"
  [ "$got" = "$want" ] || { rm -f "$f.part"; echo "SHA256 mismatch for $name: got $got, expected $want"; exit 1; }
  mv "$f.part" "$f"
done

# Electron (ditto keeps the bundle's symlinks and its signature)
rm -rf "$T/electron-darwin-$A"; mkdir -p "$T/electron-darwin-$A"
ditto -x -k "$DL/electron-v45.3.3-darwin-$A.zip" "$T/electron-darwin-$A"
# yt-dlp
mkdir -p "$T/ytdlp"
install -m 755 "$DL/yt-dlp_macos" "$T/ytdlp/yt-dlp_macos"
# FFmpeg (LGPL), built from source: $T/ffmpeg-darwin-<arm64|x86_64>/{ffmpeg,ffprobe}
TOOLS="$T" ARCH="$FA" bash "$ROOT/build/mac/build-ffmpeg.sh"

# Dev checkout: vendor/ffmpeg/darwin and vendor/ytdlp/darwin/yt-dlp (main.js looks there when unpackaged), for this Mac
if [ "$A" = "$HOSTA" ]; then
  mkdir -p "$ROOT/vendor/ffmpeg" "$ROOT/vendor/ytdlp/darwin"
  rm -rf "$ROOT/vendor/ffmpeg/darwin"; ln -s "$T/ffmpeg-darwin-$FA" "$ROOT/vendor/ffmpeg/darwin"
  install -m 755 "$T/ytdlp/yt-dlp_macos" "$ROOT/vendor/ytdlp/darwin/yt-dlp"
  echo "Electron $(cat "$T/electron-darwin-$A/version") | $("$T/ffmpeg-darwin-$FA/ffmpeg" -hide_banner -version | head -1) | yt-dlp $("$T/ytdlp/yt-dlp_macos" --version)"
  echo "Run SlopAMP from this checkout:  $T/electron-darwin-$A/Electron.app/Contents/MacOS/Electron ."
fi
echo "Tools ready in $T ($A)"
