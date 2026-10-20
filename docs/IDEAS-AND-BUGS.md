# SlopAMP — ideas & bugs for the next build

Current release: **1.1.0** (Oct 18, 2026). Nothing below is built yet — this is the running list.
Mockups get made as ideas come up; the build happens when we decide to do 1.2.

## Bugs

_None open._ (Report: what you clicked, what happened, what you expected — a screenshot helps.)

| # | Found | Bug | Status |
|---|---|---|---|
| | | | |

## Ideas

| # | Idea | Notes | Mockup |
|---|---|---|---|
| 1 | **Moveable panels** — dock the EQ / visualizer / video / playlist anywhere in the window (side by side, reorder, resize), with layout presets | Do this before themes, since themes must fit the layout system | — |
| 2 | **Floating windows** — pull any panel out into its own window, snap windows together, put the visualizer on a second monitor/TV | Same system as #1; includes the pop-out visualizer | — |
| 3 | **Original themes** — e.g. "alien slime", amber CRT, brushed chrome, the current green | Our own designs (no real Winamp skins / movie artwork) | — |
| 4 | **Load your own Winamp skins (.wsz)** — user brings the skin; SlopAMP applies its digits, buttons, font and colors | Skins aren't bundled (artists' copyright); layout won't be 100% identical | — |
| 5 | **Share playlist** — export a playlist plus its local music files as one .zip so a friend gets everything | YouTube-link playlists already share fine as plain .m3u8 | — |
| 6 | **"Open with SlopAMP" for playlist files** (.m3u8 / .m3u) | Right now Windows opens them in VLC | — |

## Release / distribution to-dos (not app features)

- Public GitHub page for SlopAMP (source + downloads + bug reports).
- Code signing so Windows stops showing "protected your PC": SignPath (free, needs public open-source repo) or Azure Artifact Signing (~$10/month).
- Optional size trims: English-only Chromium language files (−48 MB installed), slimmer FFmpeg.

## Done in 1.1 (for reference)

Rename to SlopAMP · playlist tabs · Butterchurn visualizer (1,731 presets, favorites, N/P/K/H keys, search) ·
visualizer panel min/close · Manage Library (downloads + saved playlists, search) · Playlists folder ·
Quick Save · resume where you left off · speed 1×–3× · subtitles · media keys · Download All ·
downloads re-found from the folders · compact 420 px default size.
