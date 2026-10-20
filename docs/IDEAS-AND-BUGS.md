# SlopAMP — ideas & bugs for the next build

Current release: **1.2.0** (Oct 20, 2026). Ideas below aren't built yet — this is the running list.
Mockups get made as ideas come up; the build happens when we decide to do 1.2.

## Bugs

(Report: what you clicked, what happened, what you expected — a screenshot helps.)

| # | Found | Bug | Status |
|---|---|---|---|
| 1 | Oct 20, 2026 (1.1.1 Portable, while testing 1.2.0) | **SlopAMP kept running hidden after closing it.** 4 SlopAMP.exe processes from `%TEMP%\SlopAMP-1.1.1-portable\` stayed alive with no window, so SlopAMP-Setup-1.2.0.exe kept saying "Close SlopAMP" until they were ended by hand. Would also block the auto-updater. | **Fixed for 1.2.0** (test build 2). Likely cause: an invisible SlopAMP window: a second copy that started anyway after losing the single-instance check, or a window that never got shown. No visible window means nothing to close, so the app never quit. Fixes: a second copy now exits immediately; the window always appears (5 s fallback); launching SlopAMP again shows a hidden window; closing forces the window shut after 5 s and the app exits within 8 s; yt-dlp/FFmpeg helpers are ended on quit; the installer/uninstaller now asks SlopAMP to quit and ends it after 10 s instead of looping on "Close SlopAMP". Confirmed on Windows with the 1.2.0 test builds. |
| 2 | Oct 20, 2026 (1.2.0 test build) | **Updater test kit assumed the default install folder.** With SlopAMP installed to `C:\SlopAMP`, "1 Test update.bat" failed ("Windows cannot find ...\AppData\Local\Programs\SlopAMP\SlopAMP.exe"). Same risk for the real silent update, which didn't name the folder. | **Fixed for 1.2.0.** The .bat files now find SlopAMP through the registry (uninstall entry's InstallLocation, then `HKCU\Software\SlopAMP\InstallDir`, then the default) and say so if it isn't installed. The updater passes the folder SlopAMP is running from to the installer (`/D=`), so it reinstalls in place, re-points shortcuts and "Open with" there, and relaunches from there. Checked under Wine with a folder containing spaces; the installer also falls back to the registry folder if `/D=` is missing. |
| 3 | Oct 20, 2026 (found while fixing #2; in every version so far) | **Uninstalling deleted the whole install folder.** The uninstaller ran `RMDir /r` on it, so SlopAMP installed into a shared folder (e.g. `D:\Apps` instead of `D:\Apps\SlopAMP`) would take everything else in that folder with it. The installer's upgrade step also cleared `resources\app` without checking it was SlopAMP's. | **Fixed for 1.2.0** (test build 4). The uninstaller deletes only the files SlopAMP installed (a list made at build time from the app folder), then removes each folder only if it's empty, so the install folder survives if anything else is in it. The installer only clears `resources\app` when SlopAMP.exe is already there. Checked under Wine: other files in the folder, even inside same-named `locales` / `resources\app` folders, survive; a SlopAMP-only folder is removed completely. |
| 4 | Oct 20, 2026 (1.2.0 test build 3, real Windows, C:\SlopAMP) | **The silent update skipped SlopAMP's clean quit.** The update itself worked (installed, relaunched from C:\SlopAMP, data intact), but slopamp.log went from "installing update 1.2.0" straight to the new "started" 15.6 s later with no "quitting" line, so the old SlopAMP was most likely ended by the installer instead of quitting. A manual close logged "quitting" fine. | **Fixed for 1.2.0** (test build 4). Cause: SlopAMP started the installer first and quit 0.3 s later, so the installer was already acting on a SlopAMP that was still running (waiting on it, then closing or ending it). Now "Restart now" makes SlopAMP quit normally first ("quitting", helpers stopped, playlists saved, window closed), and the installer is started only at the very end of quitting; if it can't start, SlopAMP reopens. The installer also writes its own steps to slopamp.log ("installer: …"). Checked on Linux end to end (log order: verified → quitting → installer started; clean exit) and the installer steps under Wine. Confirmed on Windows (build 4): log shows verified → quitting → installer started → installer waited (result 0) → installed → started. |

## Ideas

| # | Idea | Notes | Mockup |
|---|---|---|---|
| 1 | **Moveable panels** — dock the EQ / visualizer / video / playlist anywhere in the window (side by side, reorder, resize), with layout presets | Do this before themes, since themes must fit the layout system | — |
| 2 | **Floating windows** — pull any panel out into its own window, snap windows together, put the visualizer on a second monitor/TV | Same system as #1; includes the pop-out visualizer | — |
| 3 | **Original themes** — e.g. "alien slime", amber CRT, brushed chrome, the current green | Our own designs (no real Winamp skins / movie artwork) | — |
| 4 | **Load your own Winamp skins (.wsz)** — user brings the skin; SlopAMP applies its digits, buttons, font and colors | Skins aren't bundled (artists' copyright); layout won't be 100% identical | — |
| 5 | **Share playlist** — export a playlist plus its local music files as one .zip so a friend gets everything | YouTube-link playlists already share fine as plain .m3u8 | — |
| 6 | **"Open with SlopAMP" for playlist files** (.m3u8 / .m3u) | Right now Windows opens them in VLC | — |

## Done in 1.2 (for reference)

Auto-updates from GitHub Releases (Notify me / Install automatically / Off, What's new, SHA256 check, silent install into the same folder, relaunch; portable: notify + download page) · closing always quits every SlopAMP process · Setup closes a stuck or hidden SlopAMP · uninstaller removes only SlopAMP's own files.

## Release / distribution to-dos (not app features)

- Public GitHub page for SlopAMP (source + downloads + bug reports).
- Code signing so Windows stops showing "protected your PC": SignPath (free, needs public open-source repo) or Azure Artifact Signing (~$10/month).
- Optional size trims: English-only Chromium language files (−48 MB installed), slimmer FFmpeg.

## Done in 1.1 (for reference)

Rename to SlopAMP · playlist tabs · Butterchurn visualizer (1,731 presets, favorites, N/P/K/H keys, search) ·
visualizer panel min/close · Manage Library (downloads + saved playlists, search) · Playlists folder ·
Quick Save · resume where you left off · speed 1×–3× · subtitles · media keys · Download All ·
downloads re-found from the folders · compact 420 px default size.
