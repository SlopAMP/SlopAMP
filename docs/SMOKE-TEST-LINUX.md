# Linux smoke test (3.2.0)

Run on a real desktop before shipping: RedRocket, Ubuntu 24.04 (GNOME on Wayland). Build with
`bash build/build-linux.sh` (it prints the SHA256 lines). Tick what works; write down what doesn't.

## Result: passed (Nov 19, 2026)

The captain ran this list on RedRocket (Ubuntu 24.04, GNOME on Wayland): the first round, re-tests 1 to 4 below, then
Updates (the .deb and the AppImage, with `dist/update-test-linux`) and Uninstall, with a reinstall afterwards. All
passed on the last build, built Nov 19, 2026 at 2:29 PM CT:

```
SHA256 (SlopAMP-3.2.0-x86_64.AppImage): 38988bf1fb6f32731cc1ac3548302f977db5fa09fcd67afe4d1051809faa0fe5
SHA256 (SlopAMP-3.2.0-amd64.deb): f6818fd529bffb3864ad97ed359a79dcd1dbc6eb097f09e4208befcf49f9e9c7
```

Six bugs came up along the way, all fixed before that build (CHANGELOG, 3.2.0): links dragged in from Chrome did
nothing or closed SlopAMP; the visualizer's fullscreen filled only the video window; Add link had no Paste; the first
drag from each site in Chrome did nothing; the tray's Show SlopAMP brought back only the player; and the .deb's update
bar said "(portable)".

## Re-test 4: the tray brings every window back (Nov 19)

- [x] **Show SlopAMP:** Settings → Minimize to the tray on. Open the video window, the playlist and the equalizer (and
      Settings), then –: every window goes. The tray icon's Show SlopAMP (and a click on the icon) brings back each one
      that was open, docked where it was; a window closed before stays closed. Twice. Also with the visualizer on,
      and with the Add link dialog open. With Minimize to the tray off, – and the dock icon bring them all back too.

## Re-test 3: the first drag from Chrome's address bar (Nov 19)

- [x] **First drag from a site:** quit SlopAMP and Chrome, start both. Open a YouTube video in Chrome and, without
      clicking the address bar first, drag its address onto SlopAMP's playlist: the *first* drag adds the video. Open
      an X post in another tab and do the same: its first drag adds the post. A second drag of each adds it again, a
      link inside a page still works, and a drag from the address bar of some other site adds nothing.

## Re-test 2: the first drag from each site (Nov 19)

- [x] **First drag from a site:** quit SlopAMP and Chrome. Start both, open a YouTube page in Chrome and drag a video
      link onto the playlist: the *first* drag adds it. Open X in another tab: its first drag adds the post too. Also
      try a quick flick that stops right on the playlist and let go at once, and a drag onto the player and onto a
      playlist tab. Dragging into SlopAMP and back out onto the empty desktop adds nothing.

## Re-test: fixes from the first smoke test (Nov 19)

- [x] **Links from Chrome:** drag a YouTube link and an X link from Chrome (a link in a page, and the address bar's
      site icon) onto the player and onto the playlist: each is added, SlopAMP stays open. Try a few different links
      (half of them crashed SlopAMP before). Drag one *across* SlopAMP's windows to another app: SlopAMP stays open.
      Firefox links and files from Files still work. No new `/var/crash/_opt_SlopAMP_*` report.
- [x] **Visualizer fullscreen:** BUTTERCHURN on, double-click it: the whole monitor (over the top bar and the dock);
      Esc (or F, or double-click again) brings the video window back to the same place and size. The same with its ⤢
      button, and with a video playing. The video window doesn't show up on its own in Alt+Tab, the Activities
      overview or the dock's window count (still one SlopAMP window), and it still moves with the player.
- [x] **Add link:** the **Paste** button pastes the clipboard (a second one goes on its own line; an empty clipboard
      says so); right-click in the field: Cut / Copy (greyed until you select something), Paste, Select all.

## Install and start

- [x] **.deb:** `sudo apt install ./dist/SlopAMP-3.2.0-amd64.deb` installs without errors (it recommends the Vulkan and
      VA-API drivers; over an earlier 3.2.0 build: `sudo apt install --reinstall ./dist/SlopAMP-3.2.0-amd64.deb`). `ls /etc/apparmor.d/slopamp` shows the profile and `sudo aa-status | grep slopamp` lists it.
- [x] SlopAMP is in the app grid with its icon; it starts from there and its dock icon is SlopAMP's (not a generic one).
- [x] "?" (About) says `Linux · .deb (/opt/SlopAMP) · Chromium sandbox on`.
- [x] `slopamp song.mp3` in a terminal plays the song (a second `slopamp other.mp3` while it runs adds to the same window).
- [x] **AppImage:** copy `SlopAMP-3.2.0-x86_64.AppImage` to `~/Applications`, mark it executable (Files → Properties, or
      `chmod +x`), double-click it. It starts without installing anything (no libfuse2 needed).
- [x] Its About says `Linux · AppImage · Chromium sandbox OFF: this system … blocks it for AppImages` (Ubuntu 24.04), and
      `~/.config/SlopAMP/slopamp.log` has the same in its `linux:` line.
- [x] With a `SlopAMP Data` folder next to the AppImage, playlists and settings go there (a new empty playlist, the
      folder fills up); without it, they're in `~/.config/SlopAMP` (the same ones the .deb uses).

## Windows (the most Linux-specific part)

- [x] The four windows start stacked under the player with no gaps and **no shadows or dark bands** between them.
- [x] Dragging the player moves every docked window; a window snaps to the screen edges, the top bar and the dock
      (left and bottom dock positions), and to the other windows.
- [x] Resize grips and edges work; the playlist/video grow and shrink and the windows under them follow.
- [x] Layout presets, Reset layout (Ctrl+Alt+R), roll-up (–), mini mode, Keep windows on top, fullscreen video (F).
- [x] Popup menus and dialogs can stick out of small windows (right-click a title bar, Settings, About).
- [x] With GNOME's Tiling Assistant on, dragging a SlopAMP window to a screen edge doesn't tile it into half the screen.
- [x] Fractional scaling (Settings → Displays → 125%) if you use it: everything is there, if slightly soft (XWayland).

## Playback and converting

- [x] MP3, FLAC, MP4 (H.264), WebM play; the EQ and the visualizer (BUTTERCHURN and BARS) react.
- [x] An MKV with HEVC or AC3 sound plays (converted live); seeking works.
- [x] About says `video converter: h264_vulkan` (Ubuntu 24.04 with Mesa 25: Vulkan Video on the 890M), and
      `~/.config/SlopAMP/slopamp.log` has `video encoder: VA-API skipped: … older than libva 2.21` followed by
      `video encoder: h264_vulkan 0`. No `/var/crash/_opt_SlopAMP_*` report appears (`ls /var/crash`).
- [x] CLIP: a 10 s MP4 clip, a 9:16 Shape with Blurred fill, captions burned in (they look like Arial: Liberation Sans), a
      GIF, a Join of two files with a crossfade, Convert of 3 files (Batch convert), Fix for X.
- [x] YouTube links play in the player and in the YOUTUBE window; X posts stream.
- [x] DOWNLOAD a YouTube video and an MP3; Cancel a download halfway: no `yt-dlp` or `ffmpeg` keeps running
      (`pgrep -a yt-dlp; pgrep -a ffmpeg`).

## Desktop integration

- [x] Media keys (Play/Pause, Next, Previous, Stop) work while another window has the focus.
- [x] SlopAMP shows in GNOME's media controls (the clock's drop-down) with the title, and its buttons work.
- [x] Settings → Use media keys off: after a restart the keys go to another player (e.g. a browser playing YouTube).
- [x] Settings → Minimize to the tray on, then –: SlopAMP goes to the top bar's tray (Ubuntu's AppIndicator); the icon's
      menu has Show SlopAMP / Previous / Play-Pause / Next / Stop / Settings / Quit and brings every window back.
- [x] With the AppIndicator extension turned off (Extensions app): Settings greys Minimize to the tray out and says why;
      – just minimizes.
- [x] Files: right-click an MP4 / MP3 / .m3u8 → Open With → SlopAMP opens it (the .deb).
- [x] Drag files from Files onto any SlopAMP window.
- [x] Linux words: delete a download → "moved to the Trash" (and it's in the Trash); Library and Settings say
      `Downloads/SlopAMP/…`; a skin's ⋯ menu says "Show in folder" and opens Files on it.

## Updates

- [x] `bash build/make-update-test-linux.sh`, then `dist/update-test-linux/run-good.sh`: the AppImage (a copy named
      `SlopAMP-3.1.9-x86_64.AppImage`, pretending to be 3.1.9) shows the update bar; Install update… → Restart and
      install leaves only `SlopAMP-3.2.0-x86_64.AppImage` in `apps/` and reopens it with "Updated to 3.2.0".
- [x] `run-badhash.sh` and `run-nohash.sh`: refused (the bar says why), the AppImage stays as it was;
      `run-windows-only.sh`: "Up to date" (a release with only Windows files is skipped quietly).
- [x] The .deb: `SLOPAMP_UPDATE_TEST=$PWD/dist/update-test-linux/release.json SLOPAMP_TEST_VERSION=3.1.9 slopamp` finds
      it: the bar says "SlopAMP 3.2.0 is out" (no "(portable)"), What's new and Download page; it only offers the
      download page and nothing is installed.
- [x] Against GitHub (no test feed): "Check for updates" says up to date (3.1.0 has no Linux files and is skipped).

## Uninstall

- [x] `sudo apt remove slopamp`: /opt/SlopAMP, the menu entry and `/etc/apparmor.d/slopamp` are gone;
      `~/.config/SlopAMP` and `~/Downloads/SlopAMP` stay.
