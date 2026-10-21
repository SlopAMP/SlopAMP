"""Collect installed dependency license texts for the Mac About pane."""
import html
from importlib.metadata import distribution
from pathlib import Path


def generate(root):
    root = Path(root)
    sections = []
    sources = [('SlopAMP', root / 'LICENSE')]
    for name in ('butterchurn', 'butterchurn-presets', 'yt-dlp'):
        sources.append((name, root / 'build' / (name + '-LICENSE.txt')))
    for package in ('pyobjc-core', 'pyobjc-framework-Cocoa', 'pyobjc-framework-WebKit', 'yt-dlp-ejs', 'py2app', 'setuptools', 'packaging'):
        installed = distribution(package)
        for file in installed.files or []:
            if file.name.lower().startswith(('license', 'copying')) and '.dist-info' in str(file):
                sources.append((f'{package} {installed.version}', installed.locate_file(file)))
    for title, path in sources:
        if path.is_file():
            sections.append(f'<details><summary>{html.escape(title)}</summary><pre>{html.escape(path.read_text(errors="replace"))}</pre></details>')
    page = '<!doctype html><meta charset="utf-8"><title>SlopAMP macOS licenses</title><style>body{font:13px system-ui;margin:16px}pre{white-space:pre-wrap}summary{cursor:pointer;margin:12px 0}</style><h1>SlopAMP for macOS</h1><p>Python/PyObjC and system WebKit host. FFmpeg and JavaScript runtimes are external installations, not bundled with this build.</p>' + ''.join(sections)
    (root / 'src/renderer/licenses.html').write_text(page)
