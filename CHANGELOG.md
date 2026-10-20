# Changelog

## 1.2.0 — unreleased

- **Auto-updates**: SlopAMP checks GitHub once a day for a new version. Pick **Notify me** (default), **Install automatically** or **Off** in the About box (?), which also has **Check for updates**. A bar under the deck shows what's going on, and **What's new** shows the release notes before anything is installed. The installer comes from the official GitHub release, its SHA256 is checked against the release notes, and it installs silently, keeps your playlists and settings, and reopens SlopAMP. Automatic mode downloads in the background and then waits for you to click **Restart now**. The portable exe tells you about new versions and opens the download page.
- Fixed: closing SlopAMP could leave it running invisibly in the background (seen with 1.1.1 Portable), which then blocked installing. Closing now always quits every SlopAMP process, starting SlopAMP twice no longer leaves a hidden copy, and Setup closes a stuck or hidden SlopAMP by itself (asks it to quit, then ends it after 10 seconds) instead of repeating "Please close SlopAMP".

## 1.1.1 — 2026-10-20

- **SAVE ALL** button (Ctrl+Alt+S): quick-saves every playlist tab to `Downloads\SlopAMP\Playlists` in one click.
- New **About** box: big SlopAMP logo, links to slopamp.com and GitHub, and a working **View licenses** button (the license viewer used to show a blank white box).
- Security hardening: the built-in media server now ignores requests that don't come from SlopAMP itself, its UI-file check is stricter, and a leftover testing switch in the downloader was removed.
- License/credits now read "SlopAMP (@HeyoPatriot)".

## 1.1.0 — 2026-10-18

First public release.

- New name: **SlopAMP** (settings and downloads from earlier test builds carry over automatically).
- **Playlist tabs**: rename, duplicate, reorder, drag songs between tabs; playback stays in its own tab.
- **Butterchurn visualizer** for music: 1,731 presets, search, favorites, auto-change, N/P/K/H keys, its own minimize/close bar; classic BARS still available.
- **Manage Library**: downloads and saved playlists in one window, with filters, search, sorting, open-in-tab and delete (Recycle Bin).
- **Playlists folder** (`Downloads\SlopAMP\Playlists`) and **Quick Save** (Ctrl+Shift+S).
- **Download All** for a whole tab; downloaded files are re-found from the folders if the app loses track.
- **Resume where you left off** (items 5 min+), **speed** 1×–3×, **subtitles**, **keyboard media keys**.
- Compact 420 px default size; the lightning badge restores it.

## 1.0.0

Private test builds: retro deck + video pane + playlist, local files via FFmpeg, YouTube links, equalizer, downloads with yt-dlp, fullscreen and mini player.
