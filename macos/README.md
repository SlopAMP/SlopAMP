# SlopAMP for macOS

The macOS host uses Python, PyObjC, Cocoa and WKWebView. It reuses the existing
SlopAMP interface and Butterchurn presets; Electron is not part of the Mac runtime.
The Windows entry point and build remain available.

## Install from a DMG

1. Open the SlopAMP `.dmg` for your Mac's architecture.
2. Drag **SlopAMP.app** onto **Applications** in the disk image.
3. Eject the disk image and open **SlopAMP** from Applications.

The DMG includes Python, FFmpeg, ffprobe, Node and their required libraries.
End users do not need Python, Homebrew or Terminal commands. Current images are
development builds with ad-hoc signatures, not Developer ID signed or notarized;
macOS may block a downloaded copy. Signing and notarization are still required
before presenting this as a frictionless public release.

## Development

Use macOS with Python 3.10 or later. The implementation is tested on Apple Silicon
with macOS 26.1 and Python 3.14; older macOS releases and Intel Macs have not been
validated. Install FFmpeg for format conversion, probing, artwork and subtitles.
The host searches PATH, `/opt/homebrew/bin`, and `/usr/local/bin` for it.

```sh
make mac-setup
make mac-run
```

Setup installs `macos/requirements.lock` with hash verification and wheels only.
The lock includes transitive dependencies and was resolved on Python 3.14/macOS;
other Python versions must have compatible wheels for every pinned package.
`requirements.txt` remains the list of direct dependencies. To refresh the lock,
use a separate tooling environment with `pip-tools==7.6.2` and run:

```sh
pip-compile --allow-unsafe --generate-hashes --no-emit-index-url --no-emit-trusted-host --output-file=macos/requirements.lock macos/requirements.txt
```

Review the generated versions/hashes and validate a clean installation before
committing an updated lock.

Open files with Command+O, the native File menu, the player buttons, or a Finder
drop. Command shortcuts work alongside the original Control shortcuts. Pass
media paths to `.venv/bin/python macos/run.py` to open them at startup.

## Build and verify

```sh
make mac-test
make mac-smoke
make mac-build
make mac-dmg
```

The smoke test launches an actual Cocoa/WebKit window with generated audio and
video in a temporary directory. It checks playback, seeking, Web Audio,
Butterchurn, FFmpeg conversion, subtitles, state persistence and playlist saving.
It writes a screenshot to `dist/macos-smoke.png`. It requires a logged-in graphical
session and FFmpeg. The filesystem tests run without opening a window.

The bundle is `dist/macos/SlopAMP.app`. It contains Python and the Python packages,
but currently uses an external FFmpeg installation. It is a development bundle,
not Developer ID signed or notarized, and targets the architecture of the Python
used to build it. Build output is recorded in `build/macos/build.log`.

`make mac-dmg` builds the app, bundles the build Mac's Homebrew FFmpeg/ffprobe and
Node plus their non-system libraries, adds a Finder icon, and creates
`dist/macos/SlopAMP-<version>-macOS-<architecture>-dev.dmg`. The image contains the
app and an Applications shortcut, with no extra text file. It also writes a
SHA256 checksum and a verification report next to the DMG. This command upgrades
the app in `dist/macos/SlopAMP.app` to the self-contained version.

The packaging command verifies the image checksum, mounts it read-only, copies
the app into a temporary Applications directory with spaces in its path, verifies
its signature, and runs its bundled interpreter with a clean HOME and system-only
PATH. Checks exercise bundled tool discovery, FFmpeg conversion/probing, HTTP
byte ranges and saved state. This is not a Gatekeeper/notarization test or a full
GUI playback test on another Mac. The minimum macOS version is derived from the
bundled native tools and Python; it can vary with the build Mac's dependencies.

Native library paths are relocated inside the bundle. The packager fails on
unresolved dependencies or filename collisions, preserves Homebrew license texts,
receipts, formulae and available SBOMs under `Contents/Resources/tool-notices`,
and records source/bundled binary hashes in `tools/manifest.json`. Before publicly
distributing a DMG, prepare the corresponding source/build materials required by
its bundled components, including GPL FFmpeg/x264/x265. The development DMG alone
is not that source distribution. Build on each target architecture; this script
does not manufacture a universal binary from single-architecture dependencies.

Public releases also need a Developer ID certificate and Apple's notarization
workflow: [Packaging Mac software for distribution](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution).

## Playback and storage

- Supported native formats play directly through WebKit with byte-range seeking.
- Other formats are converted to a seekable H.264/AAC MP4 in a private temporary
  directory before playback. This uses temporary disk space and adds startup
  delay proportional to the file length. Conversions are reused during the
  session and cleaned up on normal exit. Source files are never modified.
- EQ, playlist tabs, resume, playback speed and Butterchurn use the shared UI.
- M3U/M3U8 and PLS load; playlist saving uses UTF-8 M3U8.
- State is stored in `~/Library/Application Support/SlopAMP/slopamp-state.json`.
  Corrupt state is preserved and reported instead of silently overwritten.
- Downloads and saved playlists default to `~/Downloads/SlopAMP/`.
- Deletion in Manage Library uses the macOS Trash.
- The generic Trash operation only accepts paths referenced by the active
  playlist (including local downloaded copies) or the download index. Directories
  and symlinks are rejected. Quick Save ignores page-supplied destinations; only
  the native Save dialog can select a different output path.
- Directory operations accept only `audio`, `video` or `playlists`. Reset accepts
  one of those kinds or no arguments to reset all three to their defaults.
- Media keys use WebKit's Media Session support; hardware-key behavior has not
  been manually validated on all keyboards.

YouTube playback uses the existing official iframe player. Downloads use yt-dlp
and its EJS package, with bundled Node in the DMG or a locally installed Deno/Node
runtime in source builds.
See the [yt-dlp EJS documentation](https://github.com/yt-dlp/yt-dlp/wiki/EJS) for
runtime requirements. Network playback and downloads remain subject to YouTube's
availability and restrictions and are not part of the offline smoke test.

There is no macOS automatic updater yet; the UI explicitly disables that feature.

## Architecture

- `slopamp/app.py`: Cocoa lifecycle, native dialogs/menus, Finder file handling,
  window controls, and the native-message allowlist.
- `slopamp/bridge.js`: promise-based compatibility with the renderer's existing
  `window.phosphor` API. Messages use JSON to normalize Cocoa collection types.
- `slopamp/backend.py`: atomic state writes, playlists and download indexing.
- `slopamp/media.py`: loopback HTTP server, probing, conversion and subtitles.
- `slopamp/downloads.py`: serial yt-dlp queue and progress/cancel events.

Native messages are accepted only from the main frame at the app's exact local
origin. Main-frame navigation away from the app is blocked; HTTP(S) links open
in the default browser. The media server checks Host headers, contains static
paths inside the renderer directory, and uses random tokens for registered files.

Framework reference: [PyObjC documentation](https://pyobjc.readthedocs.io/).
