"""Shared native-bundle metadata and signing steps for app and DMG builds."""
import json
import plistlib
import re
import subprocess
from pathlib import Path


MINIMUM_MACOS = (12, 0)
MACHO_MAGICS = {bytes.fromhex(value) for value in (
    'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe',
    'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca',
)}


def run(*args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, capture_output=True, **kwargs).stdout


def project_version(root):
    return json.loads((Path(root) / 'package.json').read_text())['version']


def load_commands(path):
    return run('otool', '-l', path).decode()


def minimum_os(commands):
    versions = re.findall(r'\bminos ([\d.]+)', commands)
    versions += re.findall(r'cmd LC_VERSION_MIN_MACOSX\s+cmdsize \d+\s+version ([\d.]+)', commands)
    return max((tuple(map(int, value.split('.'))) for value in versions), default=MINIMUM_MACOS)


def bundle_minimum_os(app):
    """Inspect every Mach-O, including extensions and libraries outside Frameworks."""
    minimum = MINIMUM_MACOS
    seen = set()
    for path in Path(app).rglob('*'):
        if not path.is_file():
            continue
        resolved = path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        with path.open('rb') as stream:
            if stream.read(4) not in MACHO_MAGICS:
                continue
        minimum = max(minimum, minimum_os(load_commands(path)))
    return minimum


def finalize_bundle(app, version, icon=None):
    """Update compatibility/version metadata, then restore and verify the signature."""
    app = Path(app)
    minimum = bundle_minimum_os(app)
    info_path = app / 'Contents/Info.plist'
    info = plistlib.loads(info_path.read_bytes())
    info.update(CFBundleVersion=version, CFBundleShortVersionString=version,
                LSMinimumSystemVersion='.'.join(map(str, minimum)))
    if icon is not None:
        info['CFBundleIconFile'] = icon
    info_path.write_bytes(plistlib.dumps(info))
    run('codesign', '--force', '--deep', '--sign', '-', app)
    run('codesign', '--verify', '--deep', '--strict', app)
    return info
