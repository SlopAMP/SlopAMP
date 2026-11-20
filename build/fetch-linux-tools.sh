#!/usr/bin/env bash
# Downloads the pinned tools for the Linux build into vendor/linux-tools (git-ignored), checks each file's
# SHA256, and unpacks them in the layout build-linux.sh expects (TOOLS=vendor/linux-tools). It also links
# vendor/ffmpeg/linux and vendor/ytdlp/linux, so `electron .` in a checkout finds FFmpeg and yt-dlp.
# Re-running it skips files that are already there and correct.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="${TOOLS:-$ROOT/vendor/linux-tools}"
DL="$T/downloads"
mkdir -p "$DL"

# file | url | sha256 (from the publisher's release page / checksum file)
FILES=(
  "electron-v45.3.3-linux-x64.zip|https://github.com/electron/electron/releases/download/v45.3.3/electron-v45.3.3-linux-x64.zip|0a63ce0e2b6a69d6ced7194949934b8414a6dadeca82910f88dc8720a1433269"
  "ffmpeg-N-129046-g3a78197c4c-linux64-lgpl-shared.tar.xz|https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-11-18-12-39/ffmpeg-N-129046-g3a78197c4c-linux64-lgpl-shared.tar.xz|3499b584ceb91775dc24a009f2a8857d4b8bd8b7186b450d9b8eb9f6beec1298"
  "yt-dlp_linux|https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp_linux|767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795"
  "appimagetool-x86_64.AppImage|https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage|ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0"
  "runtime-x86_64|https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64|2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d"
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

# Electron (unzip keeps the executable bits)
rm -rf "$T/electron-linux"; mkdir -p "$T/electron-linux"
unzip -q "$DL/electron-v45.3.3-linux-x64.zip" -d "$T/electron-linux"
# two fixes to Chromium's X11 drag and drop (links dragged in from Chrome on Wayland): see patch-electron-linux.py
python3 "$ROOT/build/patch-electron-linux.py" "$T/electron-linux/electron"
# FFmpeg: bin/ (ffmpeg, ffprobe) + lib/ (the LGPL shared libraries, found through RPATH $ORIGIN/../lib)
rm -rf "$T/ffmpeg-linux"; mkdir -p "$T/ffmpeg-linux"
tar -xJf "$DL/ffmpeg-N-129046-g3a78197c4c-linux64-lgpl-shared.tar.xz" -C "$T/ffmpeg-linux" --strip-components=1
# yt-dlp and the AppImage tools
mkdir -p "$T/ytdlp" "$T/appimage"
install -m 755 "$DL/yt-dlp_linux" "$T/ytdlp/yt-dlp_linux"
install -m 755 "$DL/appimagetool-x86_64.AppImage" "$T/appimage/appimagetool-x86_64.AppImage"
install -m 644 "$DL/runtime-x86_64" "$T/appimage/runtime-x86_64"

# Dev checkout: vendor/ffmpeg/linux/{bin,lib} and vendor/ytdlp/linux/yt-dlp (main.js looks there when unpackaged)
mkdir -p "$ROOT/vendor/ffmpeg" "$ROOT/vendor/ytdlp/linux"
rm -rf "$ROOT/vendor/ffmpeg/linux"; ln -s "$T/ffmpeg-linux" "$ROOT/vendor/ffmpeg/linux"
install -m 755 "$T/ytdlp/yt-dlp_linux" "$ROOT/vendor/ytdlp/linux/yt-dlp"

echo "Electron $(cat "$T/electron-linux/version") | $("$T/ffmpeg-linux/bin/ffmpeg" -hide_banner -version | head -1) | yt-dlp $("$T/ytdlp/yt-dlp_linux" --version)"
echo "Tools ready in $T"
