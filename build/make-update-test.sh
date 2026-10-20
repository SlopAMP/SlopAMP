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

# .bat pieces. @JSON@ = release file, @VER@ = version.
read -r -d '' HEAD <<'BAT' || true
@echo off
rem SlopAMP updater test: pretends to be 1.1.9 and reads @JSON@ instead of GitHub.
tasklist /FI "IMAGENAME eq SlopAMP.exe" | find "SlopAMP.exe" >nul && (echo Close SlopAMP first, then run this again. & pause & exit /b 1)
if not exist "%~dp0SlopAMP-Setup-@VER@.exe" copy /Y "%~dp0..\SlopAMP-Setup-@VER@.exe" "%~dp0" >nul
if not exist "%~dp0SlopAMP-Setup-@VER@.exe" (echo Put SlopAMP-Setup-@VER@.exe in the folder above this one. & pause & exit /b 1)
BAT
# The installed SlopAMP is wherever Setup put it: the uninstall entry's InstallLocation,
# then SlopAMP's own InstallDir key, then the default folder.
read -r -d '' FIND_INSTALLED <<'BAT' || true
set "SLOPAMP_EXE="
for /f "tokens=1,2,*" %%A in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\SlopAMP" /v InstallLocation 2^>nul') do if /I "%%A"=="InstallLocation" set "SLOPAMP_EXE=%%C\SlopAMP.exe"
if not defined SLOPAMP_EXE for /f "tokens=1,2,*" %%A in ('reg query "HKCU\Software\SlopAMP" /v InstallDir 2^>nul') do if /I "%%A"=="InstallDir" set "SLOPAMP_EXE=%%C\SlopAMP.exe"
if not defined SLOPAMP_EXE set "SLOPAMP_EXE=%LOCALAPPDATA%\Programs\SlopAMP\SlopAMP.exe"
if not exist "%SLOPAMP_EXE%" goto notinstalled
BAT
read -r -d '' FIND_PORTABLE <<'BAT' || true
set "SLOPAMP_EXE=%~dp0..\SlopAMP-Portable-@VER@.exe"
if not exist "%SLOPAMP_EXE%" (echo Put SlopAMP-Portable-@VER@.exe in the folder above this one. & pause & exit /b 1)
BAT
read -r -d '' TAIL <<'BAT' || true
echo Starting %SLOPAMP_EXE%
set "SLOPAMP_UPDATE_TEST=%~dp0@JSON@"
set "SLOPAMP_TEST_VERSION=1.1.9"
start "" "%SLOPAMP_EXE%"
exit /b 0
:notinstalled
echo SlopAMP is not installed: there is no "%SLOPAMP_EXE%". Install it with Setup first.
pause
exit /b 1
BAT

bat() {   # $1 = .bat name, $2 = release json, $3 = installed | portable
  local find="$FIND_INSTALLED"; [ "$3" = portable ] && find="$FIND_PORTABLE"
  printf '%s\n%s\n%s\n' "$HEAD" "$find" "$TAIL" | sed -e "s/@JSON@/$2/g" -e "s/@VER@/$VER/g" -e 's/$/\r/' > "$OUT/$1"
}
bat "1 Test update.bat" release.json installed
bat "2 Test bad checksum.bat" release-badhash.json installed
bat "3 Test missing checksum.bat" release-nohash.json installed
bat "4 Test portable.bat" release.json portable
echo "made $OUT (Setup sha256 $HASH)"
ls -la "$OUT"
