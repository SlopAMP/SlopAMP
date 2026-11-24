#!/usr/bin/env bash
# Builds SlopAMP.app and its .dmg for macOS. Runs on a Mac.
#   ARCH=arm64 (Apple silicon) or ARCH=x64 (Intel); default: this Mac's. One .dmg per ARCH.
# Inputs (TOOLS dir; build/fetch-mac-tools.sh downloads, checks and builds them): electron-darwin-<arch>/ (Electron's
# darwin zip, extracted), ffmpeg-darwin-<arm64|x86_64>/ (build/mac/build-ffmpeg.sh), ytdlp/yt-dlp_macos.
# Needs python3 and Node (to read package.json) and Xcode's command line tools (codesign, hdiutil, iconutil, sips).
#
# Signing: without CODESIGN_IDENTITY the app gets an ad-hoc signature (an Apple silicon Mac runs nothing unsigned), and
# macOS asks the user to allow it the first time (README.txt in the .dmg says how). For a build that opens without that:
#   CODESIGN_IDENTITY="Developer ID Application: Name (TEAMID)"   sign with the hardened runtime
#   NOTARY_PROFILE=<name>                                         then notarize and staple the .dmg (a profile saved
#                                                                 with `xcrun notarytool store-credentials <name>`)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build"
MC="$BUILD/mac"
TOOLS="${TOOLS:-$ROOT/vendor/mac-tools}"
OUT="$ROOT/dist"
[ "$(uname -s)" = Darwin ] || { echo "the macOS build runs on a Mac"; exit 1; }
A="${ARCH:-$([ "$(uname -m)" = arm64 ] && echo arm64 || echo x64)}"; [ "$A" = x86_64 ] && A=x64
case "$A" in arm64|x64) ;; *) echo "ARCH must be arm64 or x64"; exit 1 ;; esac
FA="$([ "$A" = arm64 ] && echo arm64 || echo x86_64)"
EL="$TOOLS/electron-darwin-$A"
FF="$TOOLS/ffmpeg-darwin-$FA"
YT="$TOOLS/ytdlp/yt-dlp_macos"
for f in "$EL/Electron.app" "$FF/ffmpeg" "$FF/ffprobe" "$FF/SOURCES.txt" "$YT"; do [ -e "$f" ] || { echo "missing $f: run ARCH=$A bash build/fetch-mac-tools.sh"; exit 1; }; done
VER="$(node -p "require('$ROOT/package.json').version")"
EVER="$(cat "$EL/version")"
FFVER="$(cat "$FF/VERSION")"
FFCOMMIT="$(echo "$FFVER" | sed -E 's/.*-g([0-9a-f]+).*/\1/')"
YTVER="$("$YT" --version 2>/dev/null || echo bundled)"
ID="com.slopamp.SlopAMP"                    # the bundle id (package.json desktopName without ".desktop")
STAGE="$OUT/SlopAMP-mac-$A"
APP="$STAGE/SlopAMP.app"
C="$APP/Contents"
DMG="SlopAMP-$VER-mac-$A.dmg"               # the name updater.js looks for in a release

echo "SlopAMP $VER (macOS $A) | Electron $EVER | FFmpeg $FFVER | yt-dlp $YTVER"
[ "$(node -p "require('$ROOT/package.json').desktopName")" = "$ID.desktop" ] || { echo "package.json desktopName must be $ID.desktop"; exit 1; }
lipo -archs "$FF/ffmpeg" | grep -qx "$FA" || { echo "$FF/ffmpeg is not $FA"; exit 1; }
rm -rf "$STAGE"; mkdir -p "$STAGE"
ditto "$EL/Electron.app" "$APP"

# ---------- Electron -> SlopAMP: the program, its four helper apps (Electron finds them by the app's name) and Info.plist
mv "$C/MacOS/Electron" "$C/MacOS/SlopAMP"
for h in "" " (GPU)" " (Plugin)" " (Renderer)"; do
  mv "$C/Frameworks/Electron Helper$h.app" "$C/Frameworks/SlopAMP Helper$h.app"
  mv "$C/Frameworks/SlopAMP Helper$h.app/Contents/MacOS/Electron Helper$h" "$C/Frameworks/SlopAMP Helper$h.app/Contents/MacOS/SlopAMP Helper$h"
done
rm -f "$C/Resources/default_app.asar" "$C/Resources/electron.icns"
# the file types SlopAMP opens: the same list as the app's own (src/media.js) plus playlist files
EXTS="$(cd "$ROOT" && node -p "const m = require('./src/media'); JSON.stringify({ audio: m.MEDIA_EXT ? [...m.MEDIA_EXT] : [] })")"
python3 - "$C" "$VER" "$ID" "$EXTS" <<'PY'
import glob, json, os, plistlib, sys
c, ver, bid, exts = sys.argv[1:5]
media = json.loads(exts)['audio']
assert len(media) > 20, 'the media file types could not be read from src/media.js'
def edit(path, fn):
    with open(path, 'rb') as f: p = plistlib.load(f)
    fn(p)
    with open(path, 'wb') as f: plistlib.dump(p, f)
def main(p):
    p.update(CFBundleName='SlopAMP', CFBundleDisplayName='SlopAMP', CFBundleExecutable='SlopAMP', CFBundleIdentifier=bid,
             CFBundleShortVersionString=ver, CFBundleVersion=ver, CFBundleIconFile='slopamp.icns',
             LSApplicationCategoryType='public.app-category.music', NSHumanReadableCopyright='SlopAMP (@HeyoPatriot). MIT License.')
    p.pop('ElectronAsarIntegrity', None)          # (it described default_app.asar, which is gone)
    # SlopAMP uses no camera, microphone or Bluetooth: Electron's ready-made permission texts go
    for k in ('NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSBluetoothAlwaysUsageDescription', 'NSBluetoothPeripheralUsageDescription', 'NSAudioCaptureUsageDescription'):
        p.pop(k, None)
    # "Open With" for songs, videos and playlists; never the default by itself (Alternate), like the .deb's menu entry
    p['CFBundleDocumentTypes'] = [
        dict(CFBundleTypeName='Media file', CFBundleTypeRole='Viewer', LSHandlerRank='Alternate', CFBundleTypeExtensions=media),
        dict(CFBundleTypeName='Playlist', CFBundleTypeRole='Viewer', LSHandlerRank='Alternate', CFBundleTypeExtensions=['m3u8', 'm3u', 'pls']),
        dict(CFBundleTypeName='Folder', CFBundleTypeRole='Viewer', LSHandlerRank='Alternate', LSItemContentTypes=['public.folder']),
    ]
edit(os.path.join(c, 'Info.plist'), main)
helpers = sorted(glob.glob(os.path.join(c, 'Frameworks', 'SlopAMP Helper*.app')))
assert len(helpers) == 4, helpers
for h in helpers:
    name = os.path.basename(h)[:-4]                # "SlopAMP Helper (GPU)"
    def helper(p, name=name):
        p.update(CFBundleName=name, CFBundleDisplayName=name, CFBundleExecutable=name,
                 CFBundleIdentifier=p['CFBundleIdentifier'].replace('com.github.Electron', bid), CFBundleShortVersionString=ver, CFBundleVersion=ver)
    edit(os.path.join(h, 'Contents', 'Info.plist'), helper)
PY

# English-only Chromium UI strings, as on Windows and Linux (en and en_GB, with their gendered variants)
for d in "$C/Resources"/*.lproj "$C/Frameworks/Electron Framework.framework/Versions/A/Resources"/*.lproj; do
  case "$(basename "$d")" in en.lproj|en_GB.lproj|en_FEMININE.lproj|en_MASCULINE.lproj|en_NEUTER.lproj|en_GB_FEMININE.lproj|en_GB_MASCULINE.lproj|en_GB_NEUTER.lproj) ;; *) rm -rf "$d" ;; esac
done
[ -f "$C/Frameworks/Electron Framework.framework/Versions/A/Resources/en.lproj/locale.pak" ] || { echo "en.lproj/locale.pak missing from the Electron framework"; exit 1; }
[ -f "$EL/LICENSES.chromium.html" ] || { echo "LICENSES.chromium.html missing"; exit 1; }

# the icon: every size macOS asks for, from the 512 px picture
ICONSET="$OUT/mac-icon-$A.iconset"; rm -rf "$ICONSET"; mkdir -p "$ICONSET"
for n in 16 32 128 256; do
  sips -z "$n" "$n" "$BUILD/icon-512.png" --out "$ICONSET/icon_${n}x${n}.png" >/dev/null
  sips -z "$((n * 2))" "$((n * 2))" "$BUILD/icon-512.png" --out "$ICONSET/icon_${n}x${n}@2x.png" >/dev/null
done
cp "$BUILD/icon-512.png" "$ICONSET/icon_512x512.png"
iconutil -c icns "$ICONSET" -o "$C/Resources/slopamp.icns"
rm -rf "$ICONSET"

# app code
mkdir -p "$C/Resources/app" "$C/Resources/ffmpeg" "$C/Resources/ytdlp"
cp "$ROOT/package.json" "$C/Resources/app/"
cp -R "$ROOT/src" "$C/Resources/app/"
rm -f "$C/Resources/app/src/renderer/licenses.html"

# FFmpeg (LGPL; SlopAMP's own build, see build/mac/build-ffmpeg.sh): two self-contained programs, no ffplay
install -m 755 "$FF/ffmpeg" "$FF/ffprobe" "$C/Resources/ffmpeg/"
# yt-dlp (Unlicense) for the Download button; SlopAMP copies it to its data folder's tools/ and keeps that copy updated
install -m 755 "$YT" "$C/Resources/ytdlp/yt-dlp"

# licenses and the user README (Mac words)
python3 "$BUILD/make_licenses.py" "$ROOT" "$EL" "$FF" "$C/Resources/app/src/renderer" "$C/Resources/licenses" "$EVER" "$FFVER" "$FFCOMMIT" "$YTVER" mac
cp "$EL/LICENSES.chromium.html" "$C/Resources/LICENSES.chromium.html"
cp "$C/Resources/licenses/SlopAMP-LICENSE.txt" "$C/Resources/LICENSE.txt"
cp "$C/Resources/licenses/THIRD_PARTY_NOTICES.md" "$C/Resources/THIRD_PARTY_NOTICES.txt"
python3 "$MC/make_readme_mac.py" "$ROOT/docs/README-users.txt" "$STAGE/README.txt"
chmod -R u=rwX,go=rX "$APP"
xattr -cr "$APP"

# ---------- signing (inside out: the bundled programs, the helpers and frameworks, then the app)
SIGN="${CODESIGN_IDENTITY:--}"
if [ "$SIGN" = "-" ]; then
  echo "signing: ad-hoc (set CODESIGN_IDENTITY for a Developer ID build)"
  codesign --force --deep --sign - "$APP" 2>&1 | grep -v "replacing existing signature" || true
else
  echo "signing: $SIGN (hardened runtime)"
  OPTS=(--force --timestamp --options runtime --entitlements "$MC/entitlements.plist" --sign "$SIGN")
  codesign "${OPTS[@]}" "$C/Resources/ffmpeg/ffmpeg" "$C/Resources/ffmpeg/ffprobe" "$C/Resources/ytdlp/yt-dlp"
  find "$C/Frameworks" -type f \( -name '*.dylib' -o -perm +111 \) ! -path '*/Contents/MacOS/*' -print0 | xargs -0 codesign "${OPTS[@]}"
  for b in "$C/Frameworks"/*.framework "$C/Frameworks"/*.app; do codesign "${OPTS[@]}" "$b"; done
  codesign "${OPTS[@]}" "$APP"
fi
codesign --verify --deep --strict "$APP" || { echo "the app's signature doesn't verify"; exit 1; }
# the bundled programs must still run from inside the signed app
"$C/Resources/ffmpeg/ffmpeg" -hide_banner -version >/dev/null || { echo "the staged ffmpeg doesn't run"; exit 1; }

# ---------- .dmg: SlopAMP.app, a shortcut to Applications to drag it onto, README.txt
DROOT="$OUT/dmg-root-$A"; rm -rf "$DROOT"; mkdir -p "$DROOT"
ditto "$APP" "$DROOT/SlopAMP.app"
ln -s /Applications "$DROOT/Applications"
cp "$STAGE/README.txt" "$DROOT/README.txt"
rm -f "$OUT/$DMG"
hdiutil create -quiet -volname "SlopAMP $VER" -srcfolder "$DROOT" -fs HFS+ -format UDZO -imagekey zlib-level=9 "$OUT/$DMG"
rm -rf "$DROOT"
if [ "$SIGN" != "-" ]; then
  codesign --force --timestamp --sign "$SIGN" "$OUT/$DMG"
  if [ -n "${NOTARY_PROFILE:-}" ]; then
    xcrun notarytool submit "$OUT/$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$OUT/$DMG"
  else echo "not notarized (set NOTARY_PROFILE): macOS will still ask before opening it"; fi
fi

ls -la "$OUT/$DMG"
echo
echo "Release-note line:"
( cd "$OUT" && echo "SHA256 ($DMG): $(shasum -a 256 "$DMG" | awk '{print $1}')" )
