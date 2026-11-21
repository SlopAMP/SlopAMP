#!/usr/bin/env bash
# Builds the Windows x64 app folder, NSIS installer and portable exe.
# Inputs (TOOLS dir; bash build/fetch-win-tools.sh makes it): electron-win/ (Electron win32-x64 zip, extracted),
# ffmpeg-win/<build>/ (BtbN win64-lgpl-shared), ytdlp/yt-dlp.exe, nsis/, rcedit-x64.exe, wine-11.2-amd64-wow64/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build"
TOOLS="${TOOLS:?Set TOOLS to the folder that holds the build tools (see README)}"
OUT="$ROOT/dist"
VER="$(node -p "require('$ROOT/package.json').version")"
EVER="$(cat "$TOOLS/electron-win/version")"
FFDIR="$(ls -d "$TOOLS"/ffmpeg-win/*/ | head -1)"
[ "$(ls -d "$TOOLS"/ffmpeg-win/*/ | wc -l)" = 1 ] || { echo "expected exactly one FFmpeg build in $TOOLS/ffmpeg-win"; exit 1; }
# Wine: runs rcedit, and (3.2.1) the bundled Windows ffmpeg.exe and yt-dlp.exe for their versions
export WINEPREFIX="$TOOLS/wineprefix" WINEDEBUG=-all
WINE="$TOOLS/wine-11.2-amd64-wow64/bin/wine"
# 3.2.1: the versions in the licenses and FFmpeg's written offer come from the Windows files that ship (they used to
# come from a Linux FFmpeg and yt-dlp, which could be other builds): FFmpeg's from the BtbN folder's name
# (ffmpeg-<version>-win64-lgpl-shared), checked against what that ffmpeg.exe says (which adds the build date);
# yt-dlp's from yt-dlp.exe --version. A version that can't be read stops the build.
FFNAME="$(basename "$FFDIR")"
FFDIRVER="$(echo "$FFNAME" | sed -E 's/^ffmpeg-//; s/-win64-.*$//')"
FFVER="$("$WINE" "${FFDIR}bin/ffmpeg.exe" -hide_banner -version 2>/dev/null | tr -d '\r' | head -1 | awk '{print $3}' || true)"
case "$FFVER" in "$FFDIRVER"|"$FFDIRVER"-*) ;; *) echo "FFmpeg version mismatch: folder $FFNAME, ffmpeg.exe says '$FFVER'"; exit 1 ;; esac
FFCOMMIT="$(echo "$FFVER" | sed -E 's/.*-g([0-9a-f]+).*/\1/')"
STAGE="$OUT/SlopAMP-win-x64"
BUILDID="$(date +%Y%m%d%H%M%S)"

echo "SlopAMP $VER | Electron $EVER | FFmpeg $FFVER"
rm -rf "$STAGE"; mkdir -p "$STAGE"
cp -r "$TOOLS/electron-win/." "$STAGE/"
mv "$STAGE/electron.exe" "$STAGE/SlopAMP.exe"
rm -f "$STAGE/resources/default_app.asar" "$STAGE/version" "$STAGE/LICENSE"

# English-only Chromium UI strings (about 46 MB less): keep en-US.pak (Chromium's fallback) and en-GB.pak.
# The dropped names go to dropped-locales.nsh: the installer deletes exactly those on an upgrade over an
# older SlopAMP (which shipped all of them), and the uninstaller too. LICENSES.chromium.html stays as it is.
: > "$OUT/dropped-locales.nsh"
for f in "$STAGE"/locales/*.pak; do
  n="$(basename "$f")"
  case "$n" in en-US.pak|en-GB.pak) ;; *) rm -f "$f"; printf '  Delete "$INSTDIR\\locales\\%s"\n' "$n" >> "$OUT/dropped-locales.nsh" ;; esac
done
# 3.1.0: Electron 44+ builds ANGLE in (no libEGL.dll / libGLESv2.dll) and Electron 45 has no dxil.dll. The same list
# deletes those an older SlopAMP left in the install folder (only names this Electron doesn't ship), so an
# upgraded folder holds exactly what a fresh install does.
for n in libEGL.dll libGLESv2.dll dxil.dll; do
  [ -e "$STAGE/$n" ] || printf '  Delete "$INSTDIR\\%s"\n' "$n" >> "$OUT/dropped-locales.nsh"
done
[ -f "$STAGE/locales/en-US.pak" ] || { echo "en-US.pak missing from the Electron locales"; exit 1; }
[ -f "$STAGE/LICENSES.chromium.html" ] || { echo "LICENSES.chromium.html missing"; exit 1; }
echo "locales: kept $(ls "$STAGE/locales" | tr '\n' ' '); dropped $(grep -c 'locales' "$OUT/dropped-locales.nsh"); old Electron files deleted on upgrade: $(grep -v locales "$OUT/dropped-locales.nsh" | sed -E 's/.*\\([^"]+)".*/\1/' | tr '\n' ' ')"

# app code
mkdir -p "$STAGE/resources/app" "$STAGE/resources/ffmpeg"
cp "$ROOT/package.json" "$STAGE/resources/app/"
cp -r "$ROOT/src" "$STAGE/resources/app/"

# FFmpeg (LGPL, shared build) — ffplay not needed
cp "$FFDIR/bin/ffmpeg.exe" "$FFDIR/bin/ffprobe.exe" "$FFDIR"/bin/*.dll "$STAGE/resources/ffmpeg/"

# yt-dlp (Unlicense) for the Download button
mkdir -p "$STAGE/resources/ytdlp"
cp "$TOOLS/ytdlp/yt-dlp.exe" "$STAGE/resources/ytdlp/"
YTVER="$("$WINE" "$TOOLS/ytdlp/yt-dlp.exe" --version 2>/dev/null | tr -d '\r' | head -1 || true)"
[[ "$YTVER" =~ ^[0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.[0-9]+)?$ ]] || { echo "could not read yt-dlp.exe's version (got '$YTVER')"; exit 1; }
echo "yt-dlp $YTVER"

# licenses
python3 "$BUILD/make_licenses.py" "$ROOT" "$TOOLS/electron-win" "$FFDIR" "$STAGE/resources/app/src/renderer" "$STAGE/licenses" "$EVER" "$FFVER" "$FFCOMMIT" "$YTVER"
cp "$STAGE/licenses/SlopAMP-LICENSE.txt" "$STAGE/LICENSE.txt"
cp "$STAGE/licenses/THIRD_PARTY_NOTICES.md" "$STAGE/THIRD_PARTY_NOTICES.txt"
cp "$ROOT/docs/README-users.txt" "$STAGE/README.txt"

# exe branding (icon + version info) via rcedit under Wine
"$WINE" "$TOOLS/rcedit-x64.exe" "Z:${STAGE//\//\\}\\SlopAMP.exe" \
  --set-icon "Z:${BUILD//\//\\}\\icon.ico" \
  --set-file-version "$VER" --set-product-version "$VER" \
  --set-version-string ProductName "SlopAMP" \
  --set-version-string FileDescription "SlopAMP Media Player" \
  --set-version-string CompanyName "SlopAMP" \
  --set-version-string LegalCopyright "(c) 2026 SlopAMP (@HeyoPatriot) - MIT License" \
  --set-version-string OriginalFilename "SlopAMP.exe" \
  --set-version-string InternalName "SlopAMP" 2>&1 | grep -v -i "fixme" || true

# installers
export NSISDIR="$TOOLS/nsis"
MAKENSIS="$TOOLS/nsis/linux/makensis"
# The uninstaller removes exactly these files (never the whole folder: it may hold other things).
python3 "$BUILD/make_uninstall_list.py" "$STAGE" "$OUT/uninstall-files.nsh"
COMMON=(-V2 "-DVERSION=$VER" "-DSTAGE=$STAGE" "-DOUTDIR=$OUT" "-DBUILDDIR=$BUILD" "-DBUILDID=$BUILDID" "-DUNINSTALL_LIST=$OUT/uninstall-files.nsh" "-DDROPPED_LOCALES=$OUT/dropped-locales.nsh")
"$MAKENSIS" "${COMMON[@]}" "$BUILD/installer.nsi"
"$MAKENSIS" "${COMMON[@]}" "$BUILD/portable.nsi"

# zip of the unpacked folder (handy for testing / as a 3rd option)
( cd "$OUT" && rm -f "SlopAMP-$VER-win-x64.zip" && python3 -c "import shutil;shutil.make_archive('SlopAMP-$VER-win-x64','zip','.','SlopAMP-win-x64')" )
ls -la "$OUT"
