#!/usr/bin/env bash
# Builds the Linux x64 app folder, the .deb and the AppImage (3.2.0).
# Inputs (TOOLS dir; build/fetch-linux-tools.sh downloads and checks them): electron-linux/ (Electron linux-x64 zip,
# extracted), ffmpeg-linux/ (BtbN linux64-lgpl-shared), ytdlp/yt-dlp_linux, appimage/ (appimagetool + runtime).
# Needs python3, dpkg-deb (no root: --root-owner-group) and FUSE or nothing else (appimagetool runs extracted).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build"
LX="$BUILD/linux"
TOOLS="${TOOLS:-$ROOT/vendor/linux-tools}"
OUT="$ROOT/dist"
VER="$(node -p "require('$ROOT/package.json').version")"
EVER="$(cat "$TOOLS/electron-linux/version")"
FF="$TOOLS/ffmpeg-linux"
FFVER="$("$FF/bin/ffmpeg" -version | head -1 | awk '{print $3}')"
FFCOMMIT="$(echo "$FFVER" | sed -E 's/.*-g([0-9a-f]+).*/\1/')"
YTVER="$("$TOOLS/ytdlp/yt-dlp_linux" --version 2>/dev/null || echo bundled)"
STAGE="$OUT/SlopAMP-linux-x64"
DEB="SlopAMP-$VER-amd64.deb"
APPIMAGE="SlopAMP-$VER-x86_64.AppImage"
ID="com.slopamp.SlopAMP"                    # desktop file / AppStream id (package.json desktopName)
MAINTAINER="${MAINTAINER:-SlopAMP <slopamp@slopamp.com>}"
DATE="$(date -u +%Y-%m-%d)"

echo "SlopAMP $VER (Linux) | Electron $EVER | FFmpeg $FFVER | yt-dlp $YTVER"
[ "$(node -p "require('$ROOT/package.json').desktopName")" = "$ID.desktop" ] || { echo "package.json desktopName must be $ID.desktop"; exit 1; }
rm -rf "$STAGE"; mkdir -p "$STAGE"
cp -a "$TOOLS/electron-linux/." "$STAGE/"
mv "$STAGE/electron" "$STAGE/slopamp"
rm -f "$STAGE/resources/default_app.asar" "$STAGE/version" "$STAGE/LICENSE"
# Chromium X11 drag-and-drop fixes (fetch-linux-tools.sh already applies them; an unpatched copy is patched here)
python3 "$BUILD/patch-electron-linux.py" "$STAGE/slopamp" >/dev/null
python3 "$BUILD/patch-electron-linux.py" --check "$STAGE/slopamp"

# English-only Chromium UI strings, as on Windows: en-US.pak (Chromium's fallback) and en-GB.pak
for f in "$STAGE"/locales/*.pak; do case "$(basename "$f")" in en-US.pak|en-GB.pak) ;; *) rm -f "$f" ;; esac; done
[ -f "$STAGE/locales/en-US.pak" ] || { echo "en-US.pak missing from the Electron locales"; exit 1; }
[ -f "$STAGE/LICENSES.chromium.html" ] || { echo "LICENSES.chromium.html missing"; exit 1; }

# app code
mkdir -p "$STAGE/resources/app" "$STAGE/resources/ffmpeg/bin" "$STAGE/resources/ffmpeg/lib" "$STAGE/resources/ytdlp"
cp "$ROOT/package.json" "$STAGE/resources/app/"
cp -r "$ROOT/src" "$STAGE/resources/app/"

# FFmpeg (LGPL, shared build): ffmpeg and ffprobe in bin/, their libraries in lib/ (RPATH $ORIGIN/../lib); no ffplay
cp -a "$FF/bin/ffmpeg" "$FF/bin/ffprobe" "$STAGE/resources/ffmpeg/bin/"
cp -a "$FF"/lib/*.so* "$STAGE/resources/ffmpeg/lib/"
"$STAGE/resources/ffmpeg/bin/ffmpeg" -hide_banner -version >/dev/null || { echo "the staged ffmpeg doesn't run"; exit 1; }

# yt-dlp (Unlicense) for the Download button; SlopAMP copies it to ~/.config/SlopAMP/tools and keeps that copy updated
install -m 755 "$TOOLS/ytdlp/yt-dlp_linux" "$STAGE/resources/ytdlp/yt-dlp"

# licenses and the user README (Linux words)
python3 "$BUILD/make_licenses.py" "$ROOT" "$TOOLS/electron-linux" "$FF" "$STAGE/resources/app/src/renderer" "$STAGE/licenses" "$EVER" "$FFVER" "$FFCOMMIT" "$YTVER" linux
cp "$STAGE/licenses/SlopAMP-LICENSE.txt" "$STAGE/LICENSE.txt"
cp "$STAGE/licenses/THIRD_PARTY_NOTICES.md" "$STAGE/THIRD_PARTY_NOTICES.txt"
python3 "$BUILD/make_readme_linux.py" "$ROOT/docs/README-users.txt" "$STAGE/README.txt"
chmod -R u=rwX,go=rX "$STAGE"          # root-owned in the .deb: nothing group/other-writable

# icons (hicolor sizes from the 512 px icon)
ICONS="$OUT/linux-icons"; rm -rf "$ICONS"; mkdir -p "$ICONS"
python3 - "$BUILD/icon-512.png" "$ICONS" <<'PY' || { echo "(no Pillow: 256 and 512 px icons only)"; mkdir -p "$ICONS/256" "$ICONS/512"; cp "$BUILD/icon.png" "$ICONS/256/slopamp.png"; cp "$BUILD/icon-512.png" "$ICONS/512/slopamp.png"; }
import os, sys
from PIL import Image
src, out = sys.argv[1:3]
im = Image.open(src).convert('RGBA')
for n in (16, 24, 32, 48, 64, 128, 256, 512):
    os.makedirs(f'{out}/{n}', exist_ok=True)
    (im if n == 512 else im.resize((n, n), Image.LANCZOS)).save(f'{out}/{n}/slopamp.png')
PY
sed -e "s/@VERSION@/$VER/" -e "s/@DATE@/$DATE/" "$LX/slopamp.metainfo.xml" > "$OUT/$ID.metainfo.xml"

# ---------- .deb: /opt/SlopAMP, /usr/bin/slopamp (adds --ozone-platform=x11), menu entry, icons, AppArmor profile
PKG="$OUT/deb-root"; rm -rf "$PKG"
mkdir -p "$PKG/opt" "$PKG/usr/bin" "$PKG/usr/share/applications" "$PKG/usr/share/metainfo" "$PKG/usr/share/doc/slopamp" "$PKG/DEBIAN"
cp -a "$STAGE" "$PKG/opt/SlopAMP"
install -m 644 "$LX/apparmor-profile" "$PKG/opt/SlopAMP/resources/apparmor-profile"
chmod 4755 "$PKG/opt/SlopAMP/chrome-sandbox"     # root-owned setuid helper: Chromium's fallback where user namespaces are off
install -m 755 "$LX/slopamp-launcher" "$PKG/usr/bin/slopamp"
install -m 644 "$LX/slopamp.desktop" "$PKG/usr/share/applications/$ID.desktop"
install -m 644 "$OUT/$ID.metainfo.xml" "$PKG/usr/share/metainfo/$ID.metainfo.xml"
for d in "$ICONS"/*/; do n="$(basename "$d")"; install -D -m 644 "$d/slopamp.png" "$PKG/usr/share/icons/hicolor/${n}x${n}/apps/slopamp.png"; done
{ printf 'Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/\nUpstream-Name: SlopAMP\nSource: https://github.com/SlopAMP/SlopAMP\n'
  printf 'Comment: SlopAMP bundles Electron/Chromium, FFmpeg (LGPL-3.0-or-later), yt-dlp (Unlicense) and Butterchurn (MIT).\n Their notices and license texts are in /opt/SlopAMP/THIRD_PARTY_NOTICES.txt and /opt/SlopAMP/licenses/.\n\n'
  printf 'Files: *\nCopyright: SlopAMP (@HeyoPatriot)\nLicense: MIT\n'
  sed -e 's/^$/./' -e 's/^/ /' "$ROOT/LICENSE"; } > "$PKG/usr/share/doc/slopamp/copyright"
chmod 644 "$PKG/usr/share/doc/slopamp/copyright"
install -m 755 "$LX/postinst" "$LX/postrm" "$PKG/DEBIAN/"
chmod -R u=rwX,go=rX "$PKG"; chmod 4755 "$PKG/opt/SlopAMP/chrome-sandbox"     # (mkdir follows the umask)
SIZE="$(du -sk --apparent-size "$PKG/opt" "$PKG/usr" | awk '{s += $1} END {print s}')"
cat > "$PKG/DEBIAN/control" <<EOF
Package: slopamp
Version: $VER
Architecture: amd64
Maintainer: $MAINTAINER
Installed-Size: $SIZE
Depends: libc6 (>= 2.28), libasound2t64 | libasound2, libatk1.0-0t64 | libatk1.0-0, libatk-bridge2.0-0t64 | libatk-bridge2.0-0, libatspi2.0-0t64 | libatspi2.0-0, libcairo2, libcups2t64 | libcups2, libdbus-1-3, libexpat1, libgbm1, libgcc-s1, libglib2.0-0t64 | libglib2.0-0, libgtk-3-0t64 | libgtk-3-0, libnspr4, libnss3, libpango-1.0-0, libudev1, libx11-6, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxkbcommon0, libxrandr2, xdg-utils
Recommends: libvulkan1, mesa-vulkan-drivers | vulkan-icd, libva2, libva-drm2, mesa-va-drivers | va-driver
Section: sound
Priority: optional
Homepage: https://slopamp.com
Description: retro-styled media player
 SlopAMP plays your own video and music files, YouTube links through
 YouTube's official embedded player and X video posts, with playlist tabs,
 an equalizer, a MilkDrop-style visualizer, skins, downloads (yt-dlp) and
 CLIP for cutting, converting and joining clips.
EOF
rm -f "$OUT/$DEB"
dpkg-deb --root-owner-group -Zxz --build "$PKG" "$OUT/$DEB" >/dev/null

# ---------- AppImage: the app folder at the AppDir's root, AppRun (X11 + the sandbox check), no setuid helper
APPDIR="$OUT/SlopAMP.AppDir"; rm -rf "$APPDIR"
cp -a "$STAGE" "$APPDIR"
rm -f "$APPDIR/chrome-sandbox"      # can't be setuid inside an AppImage; AppRun turns the sandbox off where it's needed
install -m 755 "$LX/AppRun" "$APPDIR/AppRun"
install -m 644 "$LX/slopamp.desktop" "$APPDIR/$ID.desktop"
install -m 644 "$ICONS/256/slopamp.png" "$APPDIR/slopamp.png"
ln -s slopamp.png "$APPDIR/.DirIcon"
install -D -m 644 "$OUT/$ID.metainfo.xml" "$APPDIR/usr/share/metainfo/$ID.appdata.xml"
chmod -R u=rwX,go=rX "$APPDIR"
rm -f "$OUT/$APPIMAGE"
ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 "$TOOLS/appimage/appimagetool-x86_64.AppImage" --no-appstream \
  --runtime-file "$TOOLS/appimage/runtime-x86_64" "$APPDIR" "$OUT/$APPIMAGE" 2>&1 | grep -vE "^(Parallel mksquashfs|Creating|Exportable|\s|$|Filesystem size|Compressed|Inode|Directory|Fragment|Number of|Xattr|First|Tarball|Using|Embedding|Marking|Please|Running|Squashfs|Uncompressed|.*(table|fragments|files|directories|ids|uid|gid).*$)" || true
[ -s "$OUT/$APPIMAGE" ] || { echo "appimagetool made no AppImage"; exit 1; }
chmod 755 "$OUT/$APPIMAGE"

ls -la "$OUT/$DEB" "$OUT/$APPIMAGE"
echo
echo "Release-note lines:"
( cd "$OUT" && for f in "$APPIMAGE" "$DEB"; do echo "SHA256 ($f): $(sha256sum "$f" | awk '{print $1}')"; done )
