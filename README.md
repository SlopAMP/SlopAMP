# SlopAMP

A free, retro-styled media player for Windows 10/11. It has the classic late-'90s player look (green LCD deck, equalizer, green-on-black playlist) with modern play-almost-anything playback.

**[Download the latest release](https://github.com/SlopAMP/SlopAMP/releases/latest)** · [slopamp.com](https://slopamp.com)

> SlopAMP is an independent project, inspired by classic desktop players. It is not affiliated with or endorsed by Winamp, VideoLAN/VLC, MilkDrop's authors, or YouTube/Google.

## Features

- **Plays almost anything:** MP4, MKV, AVI, MOV, WMV, WebM, MP3, FLAC, WAV, OGG, M4A and more. Formats Chromium can't play natively are converted live by the bundled FFmpeg, using the GPU encoder when available.
- **YouTube links** in the same playlist, through YouTube's official embedded player.
- **Downloads (optional):** save a YouTube video (Best/1080p/720p/480p MP4) or MP3 with the bundled [yt-dlp](https://github.com/yt-dlp/yt-dlp), or download a whole playlist tab at once. Saved copies play offline. *Only download videos you have the right to save.*
- **Playlist tabs**, plus SAVE / LOAD / QUICK SAVE of `.m3u8` playlists.
- **Manage Library:** search, sort, open and delete downloads and saved playlists.
- **10-band equalizer** with presets, for local files and downloaded copies.
- **Butterchurn visualizer** (a WebGL MilkDrop engine) with 1,731 presets, search, favorites and MilkDrop-style keys (N, P, K, H). The classic green bars are also available.
- **Resume where you left off**, playback speed 1×–3×, subtitles (embedded, `.srt`/`.vtt`/`.ass`, YouTube captions), keyboard media keys, fullscreen and mini-player modes.

## Install

Download `SlopAMP-Setup-<version>.exe` from [Releases](https://github.com/SlopAMP/SlopAMP/releases) and run it. It installs per-user with no admin rights needed. A portable single-file exe is also available.

SlopAMP isn't code-signed yet, so Windows SmartScreen shows "Windows protected your PC" the first time. Click **More info → Run anyway**.

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

## License

SlopAMP is released under the [MIT License](LICENSE). It bundles third-party software under its own licenses:

- Electron/Chromium (MIT/BSD and others)
- FFmpeg (LGPL v3, unmodified, run as a separate program)
- yt-dlp (Unlicense)
- Butterchurn and butterchurn-presets (MIT)

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The installed app also includes a `licenses\` folder.
