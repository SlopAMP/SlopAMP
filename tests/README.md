# SlopAMP tests

End-to-end tests that start SlopAMP in Electron and drive it with Playwright. They were written for Linux under
`xvfb-run` and use a throwaway HOME for every run, so your own SlopAMP profile and downloads are never touched.

| File | What it checks |
|---|---|
| `library-preview.js` | 2.7.0: Library Preview view, picture cache and lazy loading (1,000 files), hover look-through, playlist mosaics, clip In → Out bars, skin tiles, compact History tabs, tab contrast in all 10 skins, MP3 cover art from downloads |
| `skins-and-tabs.js` | 2.7.1: double-clicking a skin (row or tile) puts it on; tab menu Move to front / Move to end |
| `x-streaming.js` | 2.8.0: X posts streamed in SlopAMP's player ("Getting the video" box and Cancel, the media server pass-through with Range, sound through the EQ, the corner tag, session links, the next item's link fetched early, asking once more, the error box and the X PLAYER window, an expired link mid-video, GIF loop, /video/2, a downloaded copy first, "?" → X posts: Ask me, nothing in X History). Needs ffmpeg on PATH |
| `history-29.js` | 2.9.0: History tabs always read "YT" / "X" (#5); X posts that play, streamed or downloaded, go into X History once each, failed / cancelled / skipped ones don't (#6). Needs ffmpeg on PATH |
| `size-limit-favorites.js` | 2.9.1: "?" → Downloads folder (limit choices, the bar, Custom, Make room…), the size check before a download, the box (exactly what goes, oldest first, never playlist files / favorites / clips; Cancel focused; the Recycle Bin note), the not-enough box, the size estimate, DOWNLOAD ALL with "Do the same for the rest", limit off; Library Favorites (☆ / ★, F, right-click, the ★ Favorites button, tiles, the delete warning, Rename and re-downloads), "▶ in <playlist>" |
| `fake-ytdlp.js` | a stand-in yt-dlp for `x-streaming.js`, `history-29.js` and `size-limit-favorites.js` (X and YouTube can't be reached from the test machine) |
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
