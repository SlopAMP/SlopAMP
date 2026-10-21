"""Build the macOS app using the project virtual environment."""
import os
import subprocess
import sys
from pathlib import Path
from macos_bundle import finalize_bundle, project_version

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'macos'))
from slopamp.licenses import generate
generate(root)
environment = dict(os.environ, PYTHONPATH=str(root / 'macos'))
log = root / 'build/macos/build.log'
log.parent.mkdir(parents=True, exist_ok=True)
with log.open('w') as output:
    result = subprocess.run([sys.executable, 'macos/setup.py', 'py2app'], cwd=root, env=environment, stdout=output, stderr=subprocess.STDOUT)
if result.returncode:
    print('\n'.join(log.read_text().splitlines()[-30:]), file=sys.stderr)
    raise SystemExit(result.returncode)
app = root / 'dist/macos/SlopAMP.app'
info = finalize_bundle(app, project_version(root))
print(f'Built {app} (macOS {info["LSMinimumSystemVersion"]} or later)\nBuild log: {log}')
