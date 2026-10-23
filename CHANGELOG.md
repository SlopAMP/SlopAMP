# Changelog

## 1.4.2 — 2026-10-23

- About → View licenses: the third-party notices are readable in the Chrome and Pocket LCD skins (dark text on a light box, like the other skins). Their box used to come out black or dark green.
- 1.4.0 and 1.4.1 were test builds only; everything below is part of this release.

## 1.4.1 — 2026-10-23

- The skin picker is now a small movable panel: drag it by its title, and it reopens where you left it (also after a restart), always fully on screen. It has a ✕ button (Esc works too) and stays open while you try skins. This works the same from the SKINS button and from Layout → Skins….
- The version label next to the green dot is a little bigger and easier to read.
- The update setting in the About box ("When a new version is out") is readable in every skin, both closed and open. Its list used to show dark text on black in some skins.

## 1.4.0 — 2026-10-22

- **Skins.** Ten built-in skins that restyle all four windows (player, equalizer, video/visualizer and playlist), menus and dialogs:
  - five colours of the standard look: **SlopAMP Classic** (green, the default), **Red Alert**, **Ice Blue**, **Purple Haze** and **Amber**;
  - five styles with the same window shapes: **Chrome** (light brushed metal), **Walnut Hi-Fi** (wood cabinet, warm orange displays), **Synthwave** (purple, pink and cyan), **Terminal** (flat black, phosphor green, monospace, faint scan lines) and **Pocket LCD** (four shades of olive green).
- New **SKINS** button on the player (between REPEAT and the lightning bolt), also in the Layout menu as **Skins…**. The picker shows a preview of every skin; clicking one switches instantly, no restart.
- Your skin is remembered between launches. The lightning bolt and Reset layout only move the windows and never change the skin.
- Every colour, glow, border and background now comes from the skin file (`src/renderer/skins/`); the clock digits, spectrum, EQ curve and BARS visualizer follow the skin too. All ten skins were checked for readable text in every window, menu and dialog.
- The player shows its version number ("v1.4.0") next to the green dot, read from the app itself so it's always current.

## 1.3.0 — 2026-10-22

- **Movable windows.** The player, equalizer, video/visualizer and playlist are now four separate windows. Drag any of them by its title bar; they snap to screen edges and to each other (edge to edge, never overlapping), with a green glow on the edges that snap.
  - Moving the player moves every window snapped to it; pull a window away to use it on its own, for example the visualizer on a second monitor or TV.
  - Resize the video and the playlist with the grip in their corner (or their right/bottom edge); the player and equalizer can be made wider. Windows docked underneath follow when a window grows, shrinks, rolls up or closes.
  - Every window has **–** (roll up to the title bar; double-clicking the title bar does the same) and **✕**. The playlist now has its own title bar too. EQ / VIS / VID / PL on the player bring windows back.
  - **Layout menu** (right-click any title bar, or the new ⧉ button on the player): *Classic (stacked)*, *Playlist beside player*, *Big visualizer*, *Snap to edges & windows*, *Keep windows on top* and **Reset layout** (Ctrl+Alt+R), which brings every window back to the middle of the main screen. SlopAMP also resets the layout by itself if a window ends up off screen, for example after unplugging a monitor.
  - Window positions and sizes are remembered between launches. The first launch of 1.3 builds the layout from your 1.2 window size and playlist height.
  - Menus and dialogs (About, Library, download menu, presets…) open in their own small windows, so they're never cut off by a small window.
  - The visualizer keeps its own controls (presets, favorites, BUTTERCHURN/BARS, fullscreen) when it's on its own, and fullscreen now fills the screen with just the video window.
- **Ready for skins (coming in 1.4):** every colour, font and size now lives in one theme file (`theme.css`), the window frames are separate from the player and playlist code, and the saved layout has a `skin` setting.
- The lightning badge now means "back to normal": it leaves fullscreen or the mini player, brings back the video and playlist, and docks the windows under the player.
- New GitHub community files: Code of Conduct, Contributing guide, Security policy (report vulnerabilities privately through GitHub), and bug report, feature request and pull request templates.
- The exe's copyright line now reads "SlopAMP (@HeyoPatriot)".

## 1.2.0 — 2026-10-20

- **Auto-updates**: SlopAMP checks GitHub once a day for a new version. Pick **Notify me** (default), **Install automatically** or **Off** in the About box (?), which also has **Check for updates**. A bar under the deck shows what's going on, and **What's new** shows the release notes before anything is installed. The installer comes from the official GitHub release, its SHA256 is checked against the release notes, and it installs silently, keeps your playlists and settings, and reopens SlopAMP. Automatic mode downloads in the background and then waits for you to click **Restart now**. The portable exe tells you about new versions and opens the download page.
- Fixed: uninstalling deleted the whole install folder, including files that weren't SlopAMP's if you installed into a shared folder. It now removes only SlopAMP's own files and leaves the folder if anything else is in it.
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
