#!/usr/bin/env python3
"""Generate licenses.html (shown in SlopAMP's About box) and the licenses/ folder.

usage: make_licenses.py <project_root> <electron_dir> <ffmpeg_dir> <out_app_renderer_dir> <out_licenses_dir> <electron_version> <ffmpeg_version> <ffmpeg_commit>
"""
import html, os, re, shutil, sys

root, edir, fdir, out_r, out_l, ever, fver, fcommit = sys.argv[1:9]
yver = sys.argv[9] if len(sys.argv) > 9 else 'bundled'
os.makedirs(out_l, exist_ok=True)

def rd(p):
    with open(p, encoding='utf-8', errors='replace') as f:
        return f.read()

notices = rd(os.path.join(root, 'THIRD_PARTY_NOTICES.md'))
notices = notices.replace('@ELECTRON_VERSION@', ever).replace('@FFMPEG_VERSION@', fver).replace('@FFMPEG_COMMIT@', fcommit).replace('@YTDLP_VERSION@', yver)

texts = [
    ('SlopAMP (MIT)', rd(os.path.join(root, 'LICENSE')), 'SlopAMP-LICENSE.txt'),
    ('Electron (MIT)', rd(os.path.join(edir, 'LICENSE')), 'Electron-LICENSE.txt'),
    ('FFmpeg - GNU LGPL v3', rd(os.path.join(fdir, 'LICENSE.txt')), 'FFmpeg-LGPL-3.0.txt'),
    ('GNU GPL v3 (referenced by the LGPL v3)', rd('/usr/share/common-licenses/GPL-3'), 'GPL-3.0.txt'),
    ('yt-dlp (The Unlicense)', rd(os.path.join(root, 'build', 'yt-dlp-LICENSE.txt')), 'yt-dlp-LICENSE.txt'),
    ('Butterchurn 2.6.7 (MIT)', rd(os.path.join(root, 'build', 'butterchurn-LICENSE.txt')), 'butterchurn-LICENSE.txt'),
    ('butterchurn-presets 2.4.7 (MIT)', rd(os.path.join(root, 'build', 'butterchurn-presets-LICENSE.txt')), 'butterchurn-presets-LICENSE.txt'),
]
for _, body, fn in texts:
    with open(os.path.join(out_l, fn), 'w', encoding='utf-8', newline='\r\n') as f:
        f.write(body)
with open(os.path.join(out_l, 'THIRD_PARTY_NOTICES.md'), 'w', encoding='utf-8', newline='\r\n') as f:
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
