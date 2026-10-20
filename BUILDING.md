# Building SlopAMP

Developer notes. The user-facing introduction is in [README.md](README.md).

## How it works

```
Electron (Chromium UI)  ── src/renderer/  index.html · style.css · app.js
   │  IPC (preload.js, contextIsolation + sandbox)
Main process            ── src/main.js     window, state, playlists, downloads index, media keys
   ├─ Downloader        ── src/downloader.js  yt-dlp queue (one at a time, self-updating copy)
   └─ MediaServer       ── src/media.js    127.0.0.1-only HTTP server:
         /app/*   UI files (an http origin so the YouTube embed gets a valid referrer)
         /f/KEY   local file with Range support (MP4/H.264, WebM, MP3, FLAC, WAV, OGG, AAC)
         /s/KEY   FFmpeg live remux/transcode → fragmented MP4 (MKV, AVI, ProRes, WMV, HEVC, AC3…)
                  encoder auto-picked: NVENC → AMF → QuickSync → Media Foundation → OpenH264
         /v/KEY   subtitles converted to WebVTT
```

- **State** (playlists, tabs, settings, download index) lives in `%APPDATA%\SlopAMP\slopamp-state.json`. The portable exe uses `SlopAMP Data\` next to the exe instead.
- **Downloads** go to `Downloads\SlopAMP\Video`, `\Audio`, and playlists to `\Playlists`. Every downloaded file is named `Title [VIDEOID].ext`, so SlopAMP can re-find copies from the folders alone.
- **Updates** (`src/updater.js`): at most once a day (10 s after launch) the main process asks `api.github.com/repos/SlopAMP/SlopAMP/releases/latest` for the newest release. The installed build downloads the `SlopAMP-Setup-X.Y.Z.exe` asset into `%TEMP%\SlopAMP-update`, checks its SHA256 against the `SHA256 (SlopAMP-Setup-X.Y.Z.exe): <hash>` line in the release notes, checks it again just before running it, and runs `SlopAMP-Setup-X.Y.Z.exe /S /UPDATE /PID=<pid>`. In `/UPDATE` mode the installer waits for that process to exit, keeps the desktop-shortcut choice, and reopens SlopAMP. A release without that line, or without the Setup asset under `https://github.com/SlopAMP/SlopAMP/releases/download/vX.Y.Z/`, is refused. The portable exe (`SLOPAMP_PORTABLE=1`) and dev runs only open the release page. Settings live under `update` in the state file: `mode` (`auto`/`notify`/`off`), `lastCheck`, `skipped`, `dismissed`, and `pending` (the version being installed, so the next launch can show "Updated to X").
- **Visualizer:** `src/renderer/vendor/` holds the Butterchurn bundle and presets. `build/butterchurn/build.sh` rebuilds them from the upstream sources. Preset equations are precompiled so the app's Content-Security-Policy can forbid `eval`.

## Developing

On Windows with Node.js installed:

1. Put FFmpeg in `vendor\ffmpeg\win32\` (`ffmpeg.exe`, `ffprobe.exe` and DLLs from a [BtbN LGPL shared build](https://github.com/BtbN/FFmpeg-Builds/releases)).
2. Optionally put `yt-dlp.exe` in `vendor\ytdlp\win32\` for the Download button.
3. Run `npx electron@41.2.0 .`

## Building the installers

The release build runs on Linux (or WSL) and uses Wine only for `rcedit`:

```
TOOLS=/path/to/tools bash build/build-win.sh
```

`TOOLS` must contain:

- `electron-win/`: unzipped `electron-v41.2.0-win32-x64.zip` (from Electron's GitHub releases)
- `ffmpeg-win/<dir>/`: BtbN `ffmpeg-master-latest-win64-lgpl-shared`
- `ffmpeg-linux/`: the matching linux64 LGPL build (used to read the version)
- `ytdlp/`: `yt-dlp.exe`, plus `yt-dlp_linux` (used to read the version)
- `nsis/`: electron-builder-binaries `nsis-3.0.4.1`
- `rcedit-x64.exe`, plus a Wine install

Outputs go to `dist/`: the app folder, `SlopAMP-Setup-<version>.exe`, `SlopAMP-Portable-<version>.exe` and a zip.

## Visualizer files

`src/renderer/vendor/butterchurn.min.js` and `src/renderer/vendor/butterchurn-presets.js` are committed, so a fresh clone runs without extra steps. To regenerate them from the upstream Butterchurn sources, run `bash build/butterchurn/build.sh`. You need git, python3 and npx. The script pins the exact upstream commits.

## Releasing

1. Bump `version` in `package.json` and add a section to `CHANGELOG.md`.
2. Build with `TOOLS=... bash build/build-win.sh`.
3. Get the checksums: `cd dist && sha256sum SlopAMP-Setup-X.Y.Z.exe SlopAMP-Portable-X.Y.Z.exe`.
4. Create a GitHub release tagged `vX.Y.Z` (not a pre-release) and attach both exes. Write the notes in Markdown (the in-app "What's new" box shows headings, bullets, **bold**, `code` and links) and end them with one line per exe, exactly in this form:

   ```
   SHA256 (SlopAMP-Setup-X.Y.Z.exe): <64 hex characters>
   SHA256 (SlopAMP-Portable-X.Y.Z.exe): <64 hex characters>
   ```

   The auto-updater refuses a release whose notes have no `SHA256 (SlopAMP-Setup-X.Y.Z.exe)` line, or whose hash doesn't match the downloaded file. These lines are hidden from the "What's new" box.
