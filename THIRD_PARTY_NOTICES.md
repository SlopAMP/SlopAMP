# Third-party notices — SlopAMP

SlopAMP itself is MIT-licensed (see `LICENSE`). It ships with the following
third-party components. All of them allow free redistribution. Their full
license texts are in the `licenses` folder next to `SlopAMP.exe`.

| Component | Version | License | Full text |
|---|---|---|---|
| Electron | @ELECTRON_VERSION@ | MIT | `licenses/Electron-LICENSE.txt` |
| Chromium and its dependencies (bundled in Electron, including Chromium's own media decoders) | bundled | BSD-3-Clause and others | `LICENSES.chromium.html` |
| yt-dlp (`resources\ytdlp\yt-dlp.exe`, used by the Download button) | @YTDLP_VERSION@ | The Unlicense (public domain) | `licenses/yt-dlp-LICENSE.txt` |
| Python runtime and libraries bundled inside `yt-dlp.exe` (CPython, certifi, requests, urllib3, websockets, brotli, mutagen, pycryptodomex and others) | as built by yt-dlp | PSF / MIT / BSD / Apache-2.0 / MPL-2.0 | <https://github.com/yt-dlp/yt-dlp/blob/master/THIRD_PARTY_LICENSES.txt> |
| Butterchurn (`resources\app\src\renderer\vendor\butterchurn.min.js`, the BUTTERCHURN visualizer — a WebGL implementation of the MilkDrop visualizer by Jordan Berg) | 2.6.7 | MIT | `licenses/butterchurn-LICENSE.txt` |
| butterchurn-presets (`vendor\butterchurn-presets.js`, 1,731 MilkDrop presets by their original authors (all except those the project marks broken), converted by the Butterchurn project; equations pre-compiled for SlopAMP) | 2.4.7 | MIT | `licenses/butterchurn-presets-LICENSE.txt` |
| FFmpeg (`ffmpeg.exe`, `ffprobe.exe`, `av*.dll`, `sw*.dll`) | @FFMPEG_VERSION@ | GNU LGPL v3 or later | `licenses/FFmpeg-LGPL-3.0.txt`, `licenses/GPL-3.0.txt` |
| Libraries statically linked into the FFmpeg DLLs (dav1d, libvpx, libopus, libvorbis, libmp3lame, openh264, libaom, SVT-AV1, libwebp, zlib, and others) | as built | BSD / ISC / MIT / LGPL (all LGPL-compatible) | see the FFmpeg-Builds project below |

## FFmpeg (LGPL v3) — corresponding source

SlopAMP runs FFmpeg as a separate program. SlopAMP does not modify FFmpeg.

* The FFmpeg binaries are an unmodified **LGPL** build ("win64-lgpl-shared") from
  the FFmpeg-Builds project: <https://github.com/BtbN/FFmpeg-Builds>.
  That project contains the exact build scripts and the versions of every
  library that is linked in.
* The FFmpeg source for this build is git revision **@FFMPEG_COMMIT@**:
  <https://github.com/FFmpeg/FFmpeg/tree/@FFMPEG_COMMIT@>
* **Written offer:** for at least three years after you received this copy,
  the distributor will provide the complete corresponding source code for the
  bundled FFmpeg build on request, at no charge beyond the cost of shipping.
* You may replace the bundled FFmpeg files in `resources\ffmpeg\` with your
  own compatible build. SlopAMP will use whatever FFmpeg it finds there.

FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project.

## Online services

YouTube videos play through YouTube's official embeddable player (the
YouTube IFrame Player API) and are subject to the YouTube Terms of Service
and Google Privacy Policy. Streaming playback never saves video to disk.

The optional DOWNLOAD button uses yt-dlp to save a copy only when you ask
for one. Only download videos you have the right to save (your own uploads,
Creative Commons or public-domain videos, or with the owner's permission).
YouTube's Terms of Service restrict downloading; you are responsible for how
you use this feature. SlopAMP keeps its copy of yt-dlp up to date by running
`yt-dlp -U`, which contacts github.com.

## Trademarks

SlopAMP is not affiliated with, endorsed by or sponsored by Winamp,
Radionomy/Llama Group, VideoLAN/VLC, or Google/YouTube. Those
names are trademarks of their respective owners.
