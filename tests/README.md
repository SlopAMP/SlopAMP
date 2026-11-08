# SlopAMP tests

End-to-end tests that start SlopAMP in Electron and drive it with Playwright. They were written for Linux under
`xvfb-run` and use a throwaway HOME for every run, so your own SlopAMP profile and downloads are never touched.

| File | What it checks |
|---|---|
| `library-preview.js` | 2.7.0: Library Preview view, picture cache and lazy loading (1,000 files), hover look-through, playlist mosaics, clip In → Out bars, skin tiles, compact History tabs, tab contrast in all 10 skins, MP3 cover art from downloads |
| `skins-and-tabs.js` | 2.7.1: double-clicking a skin (row or tile) puts it on; tab menu Move to front / Move to end |
| `x-streaming.js` | 2.8.0: X posts streamed in SlopAMP's player ("Getting the video" box and Cancel, the media server pass-through with Range, sound through the EQ, the corner tag, session links, the next item's link fetched early, asking once more, the error box and the X PLAYER window, an expired link mid-video, GIF loop, /video/2, a downloaded copy first, Settings → X posts: Ask me). Needs ffmpeg on PATH |
| `history-29.js` | 2.9.0: History tabs always read "YT" / "X" (#5); X posts that play, streamed or downloaded, go into X History once each, failed / cancelled / skipped ones don't (#6). Needs ffmpeg on PATH |
| `size-limit-favorites.js` | 2.9.1: Settings → Downloads (limit choices, the bar, Custom, Make room…), the size check before a download, the box (exactly what goes, oldest first, never playlist files / favorites / clips; Cancel focused; the Recycle Bin note), the not-enough box, the size estimate, DOWNLOAD ALL with "Do the same for the rest", limit off; Library Favorites (☆ / ★, F, right-click, the ★ Favorites button, tiles, the delete warning, Rename and re-downloads), "▶ in <playlist>" |
| `settings-292.js` | 2.9.2: the Settings window (every way in: ⚙, Ctrl+,, the tray, "?" → Settings…, the bottom bar ⚙; Done / Esc / ✕; sections and search), the moved settings still work and the old spots update it, the new settings (skip countdown, MP3 quality → `--audio-quality`, X streaming quality → yt-dlp's height, Warn me at 90%, Ask before closing while downloading, Open where you left off across restarts), SAVE ALL / QUICK SAVE of empty tabs, LIBRARY, the About disclaimer |
| `tabs-293.js` | 2.9.3: the Close tab box (only with items; other playlist tabs only; Move is the default; items to the end in order; a playing item keeps playing; Undo; Close, drop the list; Ctrl+W and right-click; the last tab's Clear tab box with Save to Playlists & clear), dragging tabs (the drop bar, YT / X stay first, to the end, Esc and letting go away cancel, click / double-click unchanged, the playing tab follows, the strip scrolls at its edge, the order is saved). Needs ffmpeg on PATH |
| `empty-playlist-about-293.js` | 2.9.3: SAVE (file dialog) and right-click Save as playlist file… save an empty tab (.m3u8 / .m3u, over an older copy, Cancel writes nothing, it opens again with LOAD, a tab with items as before); an empty saved playlist opens as an empty tab, no error (LOAD, LOAD again brings the open tab up, zero-byte .m3u, empty .pls; nothing playable still says so; Library → PLAYLISTS Open in new tab, double-click, Preview view); "?" has Check for updates again, the same as Settings → Updates |
| `save-link-293.js` | 2.9.3: SAVE and QUICK SAVE link the tab to their file (LOAD and Library Open bring it up, no copy; Library rename renames the tab; SAVE under another name renames the tab, QUICK SAVE keeps it, even for a name a file can't have; one file, one tab; an empty tab links too; kept across a restart); the tooltip's file line and right-click → Open file location (greyed, shows the file, says when it's gone); failed SAVE / QUICK SAVE / Save as… in plain words with the tab, items and link untouched and no .tmp left; Clear tab → Save as… (cancel and a failed save leave the tab alone; saved → cleared, unlinked; not in the Close tab box); History's Save a copy… still needs items |
| `fake-ytdlp.js` | a stand-in yt-dlp for `x-streaming.js`, `history-29.js`, `size-limit-favorites.js` and `settings-292.js` (X and YouTube can't be reached from the test machine) |
| `lib.js` | the shared launcher |
| `make-media.sh` | makes the sample videos and songs the tests use (`tests/media`, not committed) |

## Running

1. `npm i playwright` (or have it on `NODE_PATH`) and an Electron binary.
2. The app folder needs FFmpeg in `vendor/ffmpeg/linux` (as for a dev checkout).
3. `tests/make-media.sh`
4. `xvfb-run -a node tests/library-preview.js`

Settings (environment variables): `SLOPAMP_ELECTRON` (Electron binary), `SLOPAMP_APP` (app folder, default this
checkout), `SLOPAMP_TEST_MEDIA` (sample media, default `tests/media`), `SLOPAMP_TEST_OUT` (screenshots),
`N_BIG` (files in the big-Library check, default 1000). Each check prints `ok` or `FAIL`; the run ends with
`ALL OK` or the number that failed.
