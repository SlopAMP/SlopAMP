"""Noninteractive checks run by the DMG verifier using the bundled interpreter."""
import json
import subprocess
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen
from .backend import Backend
from .media import MediaServer, tool


RENDERER_FILES = (
    'index.html', 'app.js', 'style.css', 'icon.png', 'licenses.html',
    'vendor/butterchurn.min.js', 'vendor/butterchurn-presets.js',
)
REPORT_CHECKS = ('ok', 'conversion', 'range_serving', 'state', 'renderer', 'download_worker')


def check_renderer(root):
    renderer = Path(root) / 'src/renderer'
    missing = [name for name in RENDERER_FILES if not (renderer / name).is_file()]
    if missing:
        raise RuntimeError('Missing bundled renderer resources: ' + ', '.join(missing))


def validate_report(report):
    if not isinstance(report, dict):
        raise RuntimeError('Bundle verification did not return a report object')
    failed = [name for name in REPORT_CHECKS if report.get(name) is not True]
    tools = report.get('bundled_tools')
    if (not isinstance(tools, list) or not all(isinstance(name, str) for name in tools)
            or set(tools) != {'ffmpeg', 'ffprobe', 'node'}):
        failed.append('bundled_tools')
    if failed:
        raise RuntimeError('Bundle verification failed: ' + ', '.join(failed))
    return report


def check(root):
    root = Path(root).resolve()
    check_renderer(root)
    found = {name: tool(name) for name in ('ffmpeg', 'ffprobe', 'node')}
    for name, path in found.items():
        if not path or not Path(path).resolve().is_relative_to(root / 'tools'):
            raise RuntimeError(f'{name} was not resolved inside the app: {path}')
        subprocess.run([path, '--version' if name == 'node' else '-version'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    from .downloads import worker_command
    worker = subprocess.run(worker_command(), input='{"check":true}\n', text=True,
                            capture_output=True, check=True, timeout=15)
    if json.loads(worker.stdout).get('status') != 'ready':
        raise RuntimeError('Bundled download worker failed its startup check')
    with tempfile.TemporaryDirectory(prefix='slopamp-bundle-check-') as temporary:
        directory = Path(temporary)
        video = directory / 'sample.mkv'
        subprocess.run([found['ffmpeg'], '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=12', '-t', '1', '-c:v', 'mpeg4', str(video)], check=True)
        media = MediaServer(root / 'src/renderer')
        try:
            prepared = media.prepare(str(video))
            if not prepared['converted'] or not prepared['info']['hasVideo']:
                raise RuntimeError('Bundled conversion/probing failed')
            with urlopen(Request(prepared['directUrl'], headers={'Range': 'bytes=0-31'})) as response:
                if response.status != 206 or len(response.read()) != 32:
                    raise RuntimeError('Media range serving failed')
            backend = Backend(media, directory / 'state', directory / 'downloads')
            backend.save({'volume': 42})
            if Backend(media, directory / 'state').state['volume'] != 42:
                raise RuntimeError('State persistence failed')
        finally:
            media.stop()
    report = dict(ok=True, bundled_tools=list(found), conversion=True,
                  range_serving=True, state=True, renderer=True, download_worker=True)
    print(json.dumps(validate_report(report)))
