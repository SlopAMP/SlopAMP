# SlopAMP tests

End-to-end tests that start SlopAMP in Electron and drive it with Playwright. They were written for Linux under
`xvfb-run` and use a throwaway HOME for every run, so your own SlopAMP profile and downloads are never touched.

| File | What it checks |
|---|---|
| `library-preview.js` | 2.7.0: Library Preview view, picture cache and lazy loading (1,000 files), hover look-through, playlist mosaics, clip In → Out bars, skin tiles, compact History tabs, tab contrast in all 10 skins, MP3 cover art from downloads |
| `skins-and-tabs.js` | 2.7.1: double-clicking a skin (row or tile) puts it on; tab menu Move to front / Move to end |
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
