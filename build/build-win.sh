#!/usr/bin/env bash
# Builds the Windows x64 app folder, NSIS installer and portable exe.
# Inputs (TOOLS dir): electron-win/ (Electron win32-x64 zip, extracted),
# ffmpeg-win/<build>/ (BtbN win64-lgpl-shared), nsis/, rcedit-x64.exe, wine.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build"
TOOLS="${TOOLS:?Set TOOLS to the folder that holds the build tools (see README)}"
OUT="$ROOT/dist"
VER="$(node -p "require('$ROOT/package.json').version")"
EVER="$(cat "$TOOLS/electron-win/version")"
FFDIR="$(ls -d "$TOOLS"/ffmpeg-win/*/ | head -1)"
FFVER="$("$TOOLS/ffmpeg-linux/bin/ffmpeg" -version | head -1 | awk '{print $3}')"
FFCOMMIT="$(echo "$FFVER" | sed -E 's/.*-g([0-9a-f]+).*/\1/')"
STAGE="$OUT/SlopAMP-win-x64"
BUILDID="$(date +%Y%m%d%H%M%S)"

echo "SlopAMP $VER | Electron $EVER | FFmpeg $FFVER"
rm -rf "$STAGE"; mkdir -p "$STAGE"
cp -r "$TOOLS/electron-win/." "$STAGE/"
mv "$STAGE/electron.exe" "$STAGE/SlopAMP.exe"
rm -f "$STAGE/resources/default_app.asar" "$STAGE/version" "$STAGE/LICENSE"

# app code
mkdir -p "$STAGE/resources/app" "$STAGE/resources/ffmpeg"
cp "$ROOT/package.json" "$STAGE/resources/app/"
cp -r "$ROOT/src" "$STAGE/resources/app/"

# FFmpeg (LGPL, shared build) — ffplay not needed
cp "$FFDIR/bin/ffmpeg.exe" "$FFDIR/bin/ffprobe.exe" "$FFDIR"/bin/*.dll "$STAGE/resources/ffmpeg/"

# yt-dlp (Unlicense) for the Download button
mkdir -p "$STAGE/resources/ytdlp"
cp "$TOOLS/ytdlp/yt-dlp.exe" "$STAGE/resources/ytdlp/"
YTVER="$("$TOOLS/ytdlp/yt-dlp_linux" --version 2>/dev/null || echo bundled)"

# licenses
python3 "$BUILD/make_licenses.py" "$ROOT" "$TOOLS/electron-win" "$FFDIR" "$STAGE/resources/app/src/renderer" "$STAGE/licenses" "$EVER" "$FFVER" "$FFCOMMIT" "$YTVER"
cp "$STAGE/licenses/SlopAMP-LICENSE.txt" "$STAGE/LICENSE.txt"
cp "$STAGE/licenses/THIRD_PARTY_NOTICES.md" "$STAGE/THIRD_PARTY_NOTICES.txt"
cp "$ROOT/docs/README-users.txt" "$STAGE/README.txt"

# exe branding (icon + version info) via rcedit under Wine
export WINEPREFIX="$TOOLS/wineprefix" WINEDEBUG=-all
WINE="$TOOLS/wine-11.2-amd64-wow64/bin/wine"
"$WINE" "$TOOLS/rcedit-x64.exe" "Z:${STAGE//\//\\}\\SlopAMP.exe" \
  --set-icon "Z:${BUILD//\//\\}\\icon.ico" \
  --set-file-version "$VER" --set-product-version "$VER" \
  --set-version-string ProductName "SlopAMP" \
  --set-version-string FileDescription "SlopAMP Media Player" \
  --set-version-string CompanyName "SlopAMP" \
  --set-version-string LegalCopyright "(c) 2026 bob - MIT License" \
  --set-version-string OriginalFilename "SlopAMP.exe" \
  --set-version-string InternalName "SlopAMP" 2>&1 | grep -v -i "fixme" || true

# installers
export NSISDIR="$TOOLS/nsis"
MAKENSIS="$TOOLS/nsis/linux/makensis"
# The uninstaller removes exactly these files (never the whole folder: it may hold other things).
python3 "$BUILD/make_uninstall_list.py" "$STAGE" "$OUT/uninstall-files.nsh"
COMMON=(-V2 "-DVERSION=$VER" "-DSTAGE=$STAGE" "-DOUTDIR=$OUT" "-DBUILDDIR=$BUILD" "-DBUILDID=$BUILDID" "-DUNINSTALL_LIST=$OUT/uninstall-files.nsh")
"$MAKENSIS" "${COMMON[@]}" "$BUILD/installer.nsi"
"$MAKENSIS" "${COMMON[@]}" "$BUILD/portable.nsi"

# zip of the unpacked folder (handy for testing / as a 3rd option)
( cd "$OUT" && rm -f "SlopAMP-$VER-win-x64.zip" && python3 -c "import shutil;shutil.make_archive('SlopAMP-$VER-win-x64','zip','.','SlopAMP-win-x64')" )
ls -la "$OUT"
