#!/usr/bin/env python3
"""Generate licenses.html (shown in SlopAMP's About box) and the licenses/ folder.

usage: make_licenses.py <project_root> <electron_dir> <ffmpeg_dir> <out_app_renderer_dir> <out_licenses_dir> <electron_version> <ffmpeg_version> <ffmpeg_commit> [ytdlp_version] [win|linux|mac]

linux (3.2.0): THIRD_PARTY_NOTICES in Linux file names and paths, the AppImage runtime added, LF line ends.
mac: THIRD_PARTY_NOTICES in the .app's paths; FFmpeg is SlopAMP's own build there (build/mac/build-ffmpeg.sh), so
<ffmpeg_dir> is its output folder: the libraries' licenses and SOURCES.txt go into licenses/ffmpeg-libs.
"""
import html, os, re, shutil, sys

root, edir, fdir, out_r, out_l, ever, fver, fcommit = sys.argv[1:9]
yver = sys.argv[9] if len(sys.argv) > 9 else 'bundled'
plat = sys.argv[10] if len(sys.argv) > 10 else 'win'
nl = '\n' if plat in ('linux', 'mac') else '\r\n'
os.makedirs(out_l, exist_ok=True)

def rd(p):
    with open(p, encoding='utf-8', errors='replace') as f:
        return f.read()

notices = rd(os.path.join(root, 'THIRD_PARTY_NOTICES.md'))
notices = notices.replace('@ELECTRON_VERSION@', ever).replace('@FFMPEG_VERSION@', fver).replace('@FFMPEG_COMMIT@', fcommit).replace('@YTDLP_VERSION@', yver)

def linux_notices(n):
    swaps = [
        ('next to `SlopAMP.exe`.', 'next to the `slopamp` program (`/opt/SlopAMP` for the .deb, inside the AppImage).'),
        ('`resources\\ytdlp\\yt-dlp.exe`, used by the Download button', '`resources/ytdlp/yt-dlp`, the yt-dlp_linux build, used by the Download button'),
        ('bundled inside `yt-dlp.exe`', 'bundled inside `yt-dlp`'),
        ('(`ffmpeg.exe`, `ffprobe.exe`, `av*.dll`, `sw*.dll`)', '(`resources/ffmpeg/bin/ffmpeg`, `ffprobe`, `resources/ffmpeg/lib/libav*.so`, `libsw*.so`)'),
        ('statically linked into the FFmpeg DLLs', 'statically linked into the FFmpeg libraries'),
        ('"win64-lgpl-shared"', '"linux64-lgpl-shared"'),
        ('own compatible build. SlopAMP will use whatever FFmpeg it finds there.',
         'own compatible build (for the AppImage: extract it with `--appimage-extract`, replace them and start\n  `squashfs-root/AppRun`). SlopAMP will use whatever FFmpeg it finds there.'),
    ]
    for a, b in swaps:
        assert a in n, a
        n = n.replace(a, b)
    n = re.sub(r'`[^`\n]*\\[^`\n]*`', lambda m: m.group(0).replace('\\', '/'), n)     # paths in code spans
    row = ('| AppImage runtime (type2-runtime 20251108: the start of the `.AppImage` file, which mounts it; not part of the .deb) '
           '| 20251108 | MIT; statically links libfuse 3 (LGPL-2.1), squashfuse (BSD-2-Clause), zstd (BSD-3-Clause) and zlib (Zlib) '
           '| source and build scripts: <https://github.com/AppImage/type2-runtime> |')
    lines = n.split('\n')
    i = max(k for k, l in enumerate(lines) if l.startswith('|'))
    lines.insert(i + 1, row)
    # 3.2.0: the Electron binary is modified (build/patch-electron-linux.py)
    lines.insert(i + 2, f'\n**Electron on Linux is modified:** the `slopamp` program is Electron {ever}\'s linux-x64 build with two small '
                 'fixes to Chromium\'s X11 drag and drop (a crash on a dropped link with an odd number of bytes, and dragged data '
                 'lost while it is fetched); `build/patch-electron-linux.py` in SlopAMP\'s source has the exact changes. '
                 'Electron\'s and Chromium\'s licenses allow this; their notices are unchanged (`LICENSES.chromium.html`, '
                 '`licenses/Electron-LICENSE.txt`).')
    return '\n'.join(lines)
if plat == 'linux':
    notices = linux_notices(notices)

def mac_notices(n):
    lines = n.split('\n')
    k = next(i for i, l in enumerate(lines) if l.startswith('| Libraries statically linked into the FFmpeg DLLs'))
    lines[k] = ('| Libraries statically linked into `ffmpeg` and `ffprobe`: LAME (LGPL-2.0-or-later), Opus (BSD-3-Clause), libvpx (BSD-3-Clause), '
                'OpenH264 (BSD-2-Clause), libwebp (BSD-3-Clause), zimg (WTFPL), FreeType (FreeType License), FriBidi (LGPL-2.1-or-later), '
                'HarfBuzz (MIT), libass (ISC), dav1d (BSD-2-Clause) | see `licenses/ffmpeg-libs/SOURCES.txt` | all LGPL-compatible | `licenses/ffmpeg-libs/` |')
    n = '\n'.join(lines)
    swaps = [
        ('next to `SlopAMP.exe`.', 'inside the app: `SlopAMP.app/Contents/Resources/licenses`\n(in the Finder: right-click SlopAMP, Show Package Contents).'),
        ('`resources\\ytdlp\\yt-dlp.exe`, used by the Download button', '`Contents/Resources/ytdlp/yt-dlp`, the yt-dlp_macos build, used by the Download button'),
        ('bundled inside `yt-dlp.exe`', 'bundled inside `yt-dlp`'),
        ('(`ffmpeg.exe`, `ffprobe.exe`, `av*.dll`, `sw*.dll`)', '(`Contents/Resources/ffmpeg/ffmpeg` and `ffprobe`)'),
        ('`resources\\app\\src\\renderer\\vendor\\butterchurn.min.js`', '`Contents/Resources/app/src/renderer/vendor/butterchurn.min.js`'),
        ('''* The FFmpeg binaries are an unmodified **LGPL** build ("win64-lgpl-shared") from
  the FFmpeg-Builds project: <https://github.com/BtbN/FFmpeg-Builds>.
  That project contains the exact build scripts and the versions of every
  library that is linked in.''',
         '''* The FFmpeg programs are an **LGPL** build (`--enable-version3`, without GPL
  or non-free parts) made from unmodified sources by `build/mac/build-ffmpeg.sh`
  in SlopAMP's source: <https://github.com/SlopAMP/SlopAMP>. That script is the
  exact build recipe; `licenses/ffmpeg-libs/SOURCES.txt` lists where FFmpeg's
  source and each linked library's source came from, with their SHA256.'''),
        ('* You may replace the bundled FFmpeg files in `resources\\ffmpeg\\` with your\n  own compatible build. SlopAMP will use whatever FFmpeg it finds there.',
         '* You may replace the bundled FFmpeg files in `Contents/Resources/ffmpeg/` with\n  your own compatible build. SlopAMP will use whatever FFmpeg it finds there.\n'
         '  (A changed app has to be signed again before macOS runs it:\n  `codesign --force --deep --sign - SlopAMP.app`.)'),
    ]
    for a, b in swaps:
        assert a in n, a
        n = n.replace(a, b)
    return re.sub(r'`[^`\n]*\\[^`\n]*`', lambda m: m.group(0).replace('\\', '/'), n)     # paths in code spans
if plat == 'mac':
    notices = mac_notices(notices)
    lgpl, gpl = os.path.join(fdir, 'licenses', 'ffmpeg-COPYING.LGPLv3.txt'), os.path.join(fdir, 'licenses', 'ffmpeg-COPYING.GPLv3.txt')
    libs = os.path.join(out_l, 'ffmpeg-libs')
    shutil.rmtree(libs, ignore_errors=True)
    shutil.copytree(os.path.join(fdir, 'licenses'), libs)
    shutil.copy(os.path.join(fdir, 'SOURCES.txt'), libs)
else:
    lgpl, gpl = os.path.join(fdir, 'LICENSE.txt'), '/usr/share/common-licenses/GPL-3'

texts = [
    ('SlopAMP (MIT)', rd(os.path.join(root, 'LICENSE')), 'SlopAMP-LICENSE.txt'),
    ('Electron (MIT)', rd(os.path.join(edir, 'LICENSE')), 'Electron-LICENSE.txt'),
    ('FFmpeg - GNU LGPL v3', rd(lgpl), 'FFmpeg-LGPL-3.0.txt'),
    ('GNU GPL v3 (referenced by the LGPL v3)', rd(gpl), 'GPL-3.0.txt'),
    ('yt-dlp (The Unlicense)', rd(os.path.join(root, 'build', 'yt-dlp-LICENSE.txt')), 'yt-dlp-LICENSE.txt'),
    ('Butterchurn 2.6.7 (MIT)', rd(os.path.join(root, 'build', 'butterchurn-LICENSE.txt')), 'butterchurn-LICENSE.txt'),
    ('butterchurn-presets 2.4.7 (MIT)', rd(os.path.join(root, 'build', 'butterchurn-presets-LICENSE.txt')), 'butterchurn-presets-LICENSE.txt'),
]
for _, body, fn in texts:
    with open(os.path.join(out_l, fn), 'w', encoding='utf-8', newline=nl) as f:
        f.write(body)
with open(os.path.join(out_l, 'THIRD_PARTY_NOTICES.md'), 'w', encoding='utf-8', newline=nl) as f:
    f.write(notices)

def md_to_html(md):
    out, in_table = [], False
    for line in md.splitlines():
        esc = html.escape(line)
        esc = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', esc)
        esc = re.sub(r'`(.+?)`', r'<code>\1</code>', esc)
        esc = re.sub(r'&lt;(https?://[^&]+)&gt;', r'<a href="\1" target="_blank">\1</a>', esc)
        if line.startswith('|'):
            cells = [c.strip() for c in esc.strip('|').split('|')]
            if all(re.fullmatch(r'-+', c) for c in cells):
                continue
            if not in_table:
                out.append('<table>'); in_table = True
                out.append('<tr>' + ''.join(f'<th>{c}</th>' for c in cells) + '</tr>'); continue
            out.append('<tr>' + ''.join(f'<td>{c}</td>' for c in cells) + '</tr>'); continue
        if in_table:
            out.append('</table>'); in_table = False
        if line.startswith('# '): out.append(f'<h1>{esc[2:]}</h1>')
        elif line.startswith('## '): out.append(f'<h2>{esc[3:]}</h2>')
        elif line.startswith('* '): out.append(f'<p class="li">&bull; {esc[2:]}</p>')
        elif line.strip(): out.append(f'<p>{esc}</p>')
    if in_table: out.append('</table>')
    return '\n'.join(out)

parts = [md_to_html(notices), '<p>Chromium\'s full credits are in <code>LICENSES.chromium.html</code> in the SlopAMP install folder.</p>']
for title, body, fn in texts:
    parts.append(f'<details><summary>{html.escape(title)}</summary><pre>{html.escape(body)}</pre></details>')

page = f"""<!doctype html><html><head><meta charset="utf-8"><title>Licenses</title>
<style>body{{font:12px/1.45 Segoe UI,Arial,sans-serif;margin:10px;color:#222}}h1{{font-size:15px}}h2{{font-size:13px;margin-top:14px}}
table{{border-collapse:collapse;font-size:11px}}td,th{{border:1px solid #ccc;padding:3px 5px;vertical-align:top}}pre{{white-space:pre-wrap;font-size:10px;background:#f5f5f5;padding:6px}}
summary{{cursor:pointer;font-weight:bold;margin-top:6px}}code{{background:#eee;padding:0 2px}}p.li{{margin:2px 0 2px 8px}}</style></head>
<body>{''.join(parts)}</body></html>"""
with open(os.path.join(out_r, 'licenses.html'), 'w', encoding='utf-8') as f:
    f.write(page)
print('licenses ok')
