#!/usr/bin/env bash
# Builds SlopAMP's FFmpeg for macOS from source: ffmpeg and ffprobe as two self-contained programs (LGPL v3 or later,
# no GPL and no non-free parts), from the same FFmpeg commit as the Windows and Linux builds (BtbN N-129046-g3a78197c4c).
# There is no ready-made LGPL FFmpeg for macOS (the usual downloads and Homebrew's are GPL builds), so this is the
# Mac's counterpart of fetch-linux-tools.sh's BtbN download.
#
#   ARCH=arm64 bash build/mac/build-ffmpeg.sh     (or ARCH=x86_64; default: this Mac's)
#
# Needs Xcode's command line tools and: nasm (x86_64 only), meson, ninja, pkg-config, autoconf, automake, libtool
# (`brew install nasm meson ninja pkg-config autoconf automake libtool`). Homebrew's libraries are never used: every
# library below is built here, static, and the result is checked to load nothing outside macOS itself.
# Output: $TOOLS/ffmpeg-darwin-$ARCH/{ffmpeg,ffprobe,licenses/,SOURCES.txt}. Re-running skips what's already built.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
T="${TOOLS:-$ROOT/vendor/mac-tools}"
ARCH="${ARCH:-$(uname -m)}"
case "$ARCH" in arm64|x86_64) ;; x64) ARCH=x86_64 ;; *) echo "ARCH must be arm64 or x86_64"; exit 1 ;; esac
DL="$T/downloads"
# Everything is built through a fixed path in /tmp (a link to the real folder in $TOOLS): the build's own folder ends
# up in what `ffmpeg -version` prints, and that shouldn't be the home folder of whoever built it.
W="/tmp/slopamp-ffmpeg-$ARCH"
mkdir -p "$T/ffmpeg-build-$ARCH"; ln -sfn "$T/ffmpeg-build-$ARCH" "$W"
SRC="$W/src"
P="$W/prefix"
OUT="$T/ffmpeg-darwin-$ARCH"
JOBS="$(sysctl -n hw.ncpu)"
FFCOMMIT=3a78197c4c969e7a493956733b340b68dcdb7fa0
FFVER=N-129046-g3a78197c4c             # what `git describe` gives for that commit; BtbN's builds carry the same name
export MACOSX_DEPLOYMENT_TARGET=12.0   # (Electron 45 itself needs macOS 13)
mkdir -p "$DL" "$SRC" "$P/lib/pkgconfig" "$OUT"

# name | file | url | sha256 | license files (copied to licenses/<name>-…)
SOURCES=(
  "ffmpeg|ffmpeg-3a78197c4c.tar.gz|https://github.com/FFmpeg/FFmpeg/archive/$FFCOMMIT.tar.gz|d76bd3192b1f1049b99ec070c6bd9fa667872692c18c928120be6018e389bfca|COPYING.LGPLv3 COPYING.GPLv3 COPYING.LGPLv2.1 LICENSE.md"
  "lame|lame-3.100.tar.gz|https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz|ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e|COPYING"
  "opus|opus-1.5.2.tar.gz|https://github.com/xiph/opus/releases/download/v1.5.2/opus-1.5.2.tar.gz|65c1d2f78b9f2fb20082c38cbe47c951ad5839345876e46941612ee87f9a7ce1|COPYING"
  "libvpx|libvpx-1.17.0.tar.gz|https://github.com/webmproject/libvpx/archive/refs/tags/v1.17.0.tar.gz|1020f184046187baa2985dbde38e0691f49c44088bca7a1842b0236c6081dc0a|LICENSE PATENTS"
  "openh264|openh264-2.7.0.tar.gz|https://github.com/cisco/openh264/archive/refs/tags/v2.7.0.tar.gz|5178775c8b440073e70920e97d195efff721c0e56d0a78cc82c919e95d54924d|LICENSE"
  "libwebp|libwebp-1.6.0.tar.gz|https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.6.0.tar.gz|e4ab7009bf0629fd11982d4c2aa83964cf244cffba7347ecd39019a9e38c4564|COPYING PATENTS"
  "zimg|zimg-3.0.6.tar.gz|https://github.com/sekrit-twc/zimg/archive/refs/tags/release-3.0.6.tar.gz|be89390f13a5c9b2388ce0f44a5e89364a20c1c57ce46d382b1fcc3967057577|COPYING"
  "freetype|freetype-2.13.3.tar.xz|https://download.savannah.gnu.org/releases/freetype/freetype-2.13.3.tar.xz|0550350666d427c74daeb85d5ac7bb353acba5f76956395995311a9c6f063289|LICENSE.TXT docs/FTL.TXT"
  "fribidi|fribidi-1.0.18.tar.xz|https://github.com/fribidi/fribidi/releases/download/v1.0.18/fribidi-1.0.18.tar.xz|1de5e8073d035388b71d0b2d452b1da1f8caeea8a7702997b401fe1b6250727f|COPYING"
  "harfbuzz|harfbuzz-15.2.0.tar.xz|https://github.com/harfbuzz/harfbuzz/releases/download/15.2.0/harfbuzz-15.2.0.tar.xz|e2ec49090744383cdbe7df808c1cedaafba06a97be8dc4211fe546ba585f12cb|COPYING"
  "libass|libass-0.17.5.tar.xz|https://github.com/libass/libass/releases/download/0.17.5/libass-0.17.5.tar.xz|2dca25c0e0c837ddf00b52011b3f82cac1e4ddd3ad018227806b0c2288864acc|COPYING"
  "dav1d|dav1d-1.5.5.tar.bz2|https://code.videolan.org/videolan/dav1d/-/archive/1.5.5/dav1d-1.5.5.tar.bz2|afc5378daba30eafd11d7b4f0ec863270d7b175f38393a2e1e0ff76f3a45c8b9|COPYING"
)

for t in meson ninja pkg-config autoconf automake; do command -v "$t" >/dev/null || { echo "missing: $t (brew install nasm meson ninja pkg-config autoconf automake libtool)"; exit 1; }; done
[ "$ARCH" = arm64 ] || command -v nasm >/dev/null || { echo "missing: nasm (brew install nasm)"; exit 1; }

sha() { shasum -a 256 "$1" | awk '{print $1}'; }
row() { for r in "${SOURCES[@]}"; do [ "${r%%|*}" = "$1" ] && { echo "$r"; return; }; done; echo "no source named $1" >&2; exit 1; }
# fetch <name>: download (checking the SHA256) and unpack into $SRC/<name>
fetch() {
  local name file url want lic; IFS='|' read -r name file url want lic <<< "$(row "$1")"
  local f="$DL/$file"
  if ! { [ -f "$f" ] && [ "$(sha "$f")" = "$want" ]; }; then
    echo "fetch $file"
    curl -fL --retry 3 --proto '=https' -sS -o "$f.part" "$url"
    local got; got="$(sha "$f.part")"
    [ "$got" = "$want" ] || { rm -f "$f.part"; echo "SHA256 mismatch for $file: got $got, expected $want"; exit 1; }
    mv "$f.part" "$f"
  fi
  rm -rf "${SRC:?}/$name"; mkdir -p "$SRC/$name"
  tar -xf "$f" -C "$SRC/$name" --strip-components=1
}
# step <name> <function>: build one library once (a stamp file in the prefix remembers it)
step() {
  local name="$1" want; want="$(row "$1" | cut -d'|' -f4)"
  if [ "$(cat "$P/.done-$name" 2>/dev/null)" = "$want" ]; then echo "ok    $name"; return; fi
  echo "build $name ($ARCH)"
  fetch "$name"
  ( cd "$SRC/$name" && "$2" ) > "$W/$name.log" 2>&1 || { echo "building $name failed: see $T/ffmpeg-build-$ARCH/$name.log"; tail -30 "$W/$name.log"; exit 1; }
  echo "$want" > "$P/.done-$name"
}

# One compiler setup for everything. Only this prefix is searched for libraries (never Homebrew's).
export CC="clang -arch $ARCH" CXX="clang++ -arch $ARCH"
export CFLAGS="-O2 -mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET" CXXFLAGS="-O2 -mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET"
export LDFLAGS="-mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET"
export PKG_CONFIG_LIBDIR="$P/lib/pkgconfig" PKG_CONFIG_PATH=""
HOST="$([ "$ARCH" = arm64 ] && echo aarch64 || echo x86_64)-apple-darwin"
CONF=(--prefix="$P" --host="$HOST" --disable-shared --enable-static --disable-dependency-tracking)
# meson: always a cross file, so an x86_64 build on Apple silicon isn't taken for a native one
CROSS="$W/meson-$ARCH.ini"
cat > "$CROSS" <<EOF
[binaries]
c = ['clang', '-arch', '$ARCH']
cpp = ['clang++', '-arch', '$ARCH']
objc = ['clang', '-arch', '$ARCH']
objcpp = ['clang++', '-arch', '$ARCH']
ar = 'ar'
strip = 'strip'
pkg-config = 'pkg-config'
[built-in options]
c_args = ['-mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET']
cpp_args = ['-mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET']
objc_args = ['-mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET']
objcpp_args = ['-mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET']
c_link_args = ['-mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET']
cpp_link_args = ['-mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET']
[properties]
pkg_config_libdir = '$P/lib/pkgconfig'
needs_exe_wrapper = false
[host_machine]
system = 'darwin'
cpu_family = '$([ "$ARCH" = arm64 ] && echo aarch64 || echo x86_64)'
cpu = '$([ "$ARCH" = arm64 ] && echo aarch64 || echo x86_64)'
endian = 'little'
EOF
MESON=(--cross-file "$CROSS" --prefix="$P" --libdir=lib --buildtype=release --default-library=static)

b_lame() {
  sed -i '' '/lame_init_old/d' include/libmp3lame.sym       # a symbol the library no longer has (the link fails on macOS)
  ./configure "${CONF[@]}" --disable-frontend --disable-decoder && make -j"$JOBS" && make install
}
b_opus() { ./configure "${CONF[@]}" --disable-doc --disable-extra-programs && make -j"$JOBS" && make install; }
b_libvpx() {
  local target="$([ "$ARCH" = arm64 ] && echo arm64-darwin20-gcc || echo x86_64-darwin20-gcc)"
  CC=clang CXX=clang++ CFLAGS= CXXFLAGS= LDFLAGS= ./configure --prefix="$P" --target="$target" --disable-shared --enable-static --enable-pic \
    --disable-examples --disable-tools --disable-docs --disable-unit-tests --enable-vp9-highbitdepth \
    --extra-cflags="-mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET" --extra-cxxflags="-mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET"
  make -j"$JOBS" && make install
}
b_openh264() {
  local a="$([ "$ARCH" = arm64 ] && echo arm64 || echo x86_64)"
  make -j"$JOBS" OS=darwin ARCH="$a" CC=clang CXX=clang++ CFLAGS_OPT="-O3 -mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET" PREFIX="$P" install-static
}
b_libwebp() {
  ./configure "${CONF[@]}" --enable-libwebpmux --disable-libwebpdemux --disable-png --disable-jpeg --disable-tiff --disable-gif --disable-sdl --disable-gl \
    && make -j"$JOBS" && make install
}
b_zimg() { ./autogen.sh && ./configure "${CONF[@]}" && make -j"$JOBS" && make install; }
b_freetype() {
  ./configure "${CONF[@]}" --with-zlib=yes --with-bzip2=no --with-png=no --with-harfbuzz=no --with-brotli=no && make -j"$JOBS" && make install
}
b_fribidi() {
  meson setup build "${MESON[@]}" -Ddocs=false -Dbin=false -Dtests=false
  ninja -C build -j"$JOBS" && ninja -C build install
}
b_harfbuzz() {
  meson setup build "${MESON[@]}" -Dfreetype=enabled -Dcoretext=enabled -Dglib=disabled -Dgobject=disabled -Dicu=disabled -Dcairo=disabled \
    -Dchafa=disabled -Dgraphite2=disabled -Dtests=disabled -Ddocs=disabled -Dutilities=disabled -Dintrospection=disabled -Dbenchmark=disabled
  ninja -C build -j"$JOBS" && ninja -C build install
}
# libass: fonts come from macOS itself (Core Text); no fontconfig
b_libass() { ./configure "${CONF[@]}" --disable-fontconfig --disable-libunibreak && make -j"$JOBS" && make install; }
b_dav1d() {
  meson setup build "${MESON[@]}" -Denable_tools=false -Denable_tests=false -Denable_examples=false
  ninja -C build -j"$JOBS" && ninja -C build install
}
b_ffmpeg() {
  local cross=(); [ "$ARCH" = "$(uname -m)" ] || cross=(--enable-cross-compile --target-os=darwin)
  # GPL and non-free stay off (configure's default); --disable-autodetect: only what is listed here goes in
  ./configure --prefix="$P" --arch="$ARCH" --cc="clang -arch $ARCH" --cxx="clang++ -arch $ARCH" --objcc="clang -arch $ARCH" "${cross[@]}" \
    --enable-version3 --disable-autodetect --pkg-config-flags=--static \
    --extra-cflags="-I$P/include -mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET" --extra-ldflags="-L$P/lib -mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET" \
    --enable-static --disable-shared --disable-doc --disable-debug --disable-ffplay \
    --enable-videotoolbox --enable-audiotoolbox --enable-securetransport --enable-zlib --enable-iconv \
    --enable-libmp3lame --enable-libopus --enable-libvpx --enable-libopenh264 --enable-libwebp --enable-libzimg \
    --enable-libfreetype --enable-libfribidi --enable-libharfbuzz --enable-libass --enable-libdav1d
  # REVISION: a source archive has no git history for FFmpeg's version script (and inside SlopAMP's checkout git
  # would answer with SlopAMP's own commit)
  make -j"$JOBS" REVISION="$FFVER"
  install -m 755 ffmpeg ffprobe "$OUT/"
}

step lame b_lame
step opus b_opus
step libvpx b_libvpx
step openh264 b_openh264
step libwebp b_libwebp
step zimg b_zimg
step freetype b_freetype
step fribidi b_fribidi
step harfbuzz b_harfbuzz
step libass b_libass
step dav1d b_dav1d
step ffmpeg b_ffmpeg

# ---------- checks: the right architecture, an LGPL build, nothing loaded from outside macOS
for exe in ffmpeg ffprobe; do
  f="$OUT/$exe"
  lipo -archs "$f" | grep -qx "$ARCH" || { echo "$exe is not $ARCH"; exit 1; }
  bad="$(otool -L "$f" | tail -n +2 | awk '{print $1}' | grep -vE '^(/usr/lib/|/System/Library/)' || true)"
  [ -z "$bad" ] || { echo "$exe loads libraries that aren't part of macOS:"; echo "$bad"; exit 1; }
  strip -x "$f"
done
if [ "$ARCH" = "$(uname -m)" ] || arch -x86_64 /usr/bin/true 2>/dev/null; then
  V="$("$OUT/ffmpeg" -hide_banner -version)"
  echo "$V" | head -1 | grep -q "$FFVER" || { echo "unexpected FFmpeg version: $(echo "$V" | head -1)"; exit 1; }
  if echo "$V" | grep -qE -- '--enable-(gpl|nonfree)'; then echo "this FFmpeg was configured with GPL or non-free parts"; exit 1; fi
  grep -q "GNU Lesser General Public License" <<< "$("$OUT/ffmpeg" -hide_banner -L)" || { echo "this FFmpeg doesn't report the LGPL"; exit 1; }
  ENCODERS="$("$OUT/ffmpeg" -hide_banner -encoders)"; FILTERS="$("$OUT/ffmpeg" -hide_banner -filters)"
  for e in h264_videotoolbox libopenh264 libmp3lame libvpx libopus libwebp_anim aac; do
    grep -qE "^ [A-Z.]+ $e " <<< "$ENCODERS" || { echo "encoder $e is missing"; exit 1; }
  done
  for fl in subtitles zscale tonemap xfade loudnorm; do
    grep -qE "^ [A-Z.|]+ +$fl " <<< "$FILTERS" || { echo "filter $fl is missing"; exit 1; }
  done
fi

# ---------- licenses and where every source came from (for the app's licenses folder and FFmpeg's written offer)
rm -rf "$OUT/licenses"; mkdir -p "$OUT/licenses"
{ echo "FFmpeg $FFVER for macOS ($ARCH), built by build/mac/build-ffmpeg.sh, statically linked with the libraries below."
  echo "License of the result: LGPL version 3 or later (configured with --enable-version3, without --enable-gpl and --enable-nonfree)."
  echo; echo "name | source | SHA256"; } > "$OUT/SOURCES.txt"
for r in "${SOURCES[@]}"; do
  IFS='|' read -r name file url want lic <<< "$r"
  echo "$name | $url | $want" >> "$OUT/SOURCES.txt"
  for l in $lic; do cp "$SRC/$name/$l" "$OUT/licenses/$name-$(basename "$l" | sed 's/\.[Tt][Xx][Tt]$//;s/\.md$//').txt"; done
done
{ echo; echo "configuration:"; sed -n 's/^configuration: //p' <<< "${V:-}"; } >> "$OUT/SOURCES.txt"
echo "$FFVER" > "$OUT/VERSION"
echo "FFmpeg $FFVER ($ARCH) ready in $OUT"
