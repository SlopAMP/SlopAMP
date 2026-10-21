"""Noninteractive checks run by the DMG verifier using the bundled interpreter."""
import json
import subprocess
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen
from .backend import Backend
from .media import MediaServer, tool


def check(root):
    root = Path(root).resolve()
    found = {name: tool(name) for name in ('ffmpeg', 'ffprobe', 'node')}
    for name, path in found.items():
        if not path or not Path(path).resolve().is_relative_to(root / 'tools'):
            raise RuntimeError(f'{name} was not resolved inside the app: {path}')
        subprocess.run([path, '--version' if name == 'node' else '-version'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
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
    print(json.dumps(dict(ok=True, bundled_tools=list(found), conversion=True, range_serving=True, state=True, renderer=(root / 'src/renderer/index.html').is_file())))
