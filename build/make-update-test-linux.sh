#!/usr/bin/env bash
# Makes dist/update-test-linux/: a local "release" for trying the AppImage's self-update without publishing (3.2.0).
# Run after build-linux.sh. Each run-*.sh puts a fresh copy of the built AppImage in apps/ as
# SlopAMP-3.1.9-x86_64.AppImage and starts it with SLOPAMP_UPDATE_TEST (that run's release.json) and
# SLOPAMP_TEST_VERSION=3.1.9, so it finds this folder's AppImage as an update:
#   run-good.sh          finds 3.x, installs it: apps/ then has SlopAMP-<version>-x86_64.AppImage only, reopened
#   run-badhash.sh       the download doesn't match the SHA256 line: refused, nothing changes
#   run-nohash.sh        no SHA256 line for the AppImage: refused
#   run-windows-only.sh  a release with only the Windows files: skipped quietly ("Up to date")
# SlopAMP uses your normal ~/.config/SlopAMP (set HOME=… in front to use another).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="$(node -p "require('$ROOT/package.json').version")"
OUT="$ROOT/dist/update-test-linux"
IMG="$ROOT/dist/SlopAMP-$VER-x86_64.AppImage"
[ -f "$IMG" ] || { echo "missing $IMG (run build-linux.sh first)"; exit 1; }
rm -rf "$OUT"; mkdir -p "$OUT/apps"
cp "$IMG" "$OUT/"
HASH="$(sha256sum "$IMG" | cut -d' ' -f1)"
SIZE="$(stat -c %s "$IMG")"

release() {   # $1 = file, $2 = SHA256 lines for the notes, $3 = asset names (space-separated)
  python3 - "$OUT/$1" "$VER" "$SIZE" "$2" "$3" <<'PY'
import json, sys
out, ver, size, sums, names = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4], sys.argv[5].split()
body = (f"## What's new\n- This is a local TEST release for SlopAMP {ver} on Linux.\n\n" + sums)
json.dump({"tag_name": f"v{ver}", "name": f"SlopAMP {ver} (TEST)", "draft": False, "prerelease": False,
           "published_at": "2026-11-19T12:00:00Z", "html_url": "https://github.com/SlopAMP/SlopAMP/releases",
           "body": body, "assets": [{"name": n, "size": size, "browser_download_url": n} for n in names]}, open(out, "w"), indent=1)
PY
}
A="SlopAMP-$VER-x86_64.AppImage"
release release.json "SHA256 ($A): $HASH" "$A SlopAMP-$VER-amd64.deb"
release release-badhash.json "SHA256 ($A): $(printf '0%.0s' {1..64})" "$A"
release release-nohash.json "(no checksum line in this one)" "$A"
release release-windows-only.json "SHA256 (SlopAMP-Setup-$VER.exe): $HASH" "SlopAMP-Setup-$VER.exe SlopAMP-Portable-$VER.exe"

for k in good badhash nohash windows-only; do
  json=release.json; [ "$k" = good ] || json="release-$k.json"
  cat > "$OUT/run-$k.sh" <<EOF
#!/bin/sh
# SlopAMP AppImage updater test ($k): pretends to be 3.1.9 and reads $json instead of GitHub.
cd "\$(dirname "\$0")"
pgrep -x slopamp >/dev/null && { echo "Close SlopAMP first, then run this again."; exit 1; }
rm -f apps/SlopAMP-*.AppImage
cp "$A" apps/SlopAMP-3.1.9-x86_64.AppImage && chmod +x apps/SlopAMP-3.1.9-x86_64.AppImage
SLOPAMP_UPDATE_TEST="\$PWD/$json" SLOPAMP_TEST_VERSION=3.1.9 exec ./apps/SlopAMP-3.1.9-x86_64.AppImage
EOF
  chmod +x "$OUT/run-$k.sh"
done
ls -la "$OUT"
