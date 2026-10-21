"""Build a self-contained development DMG and verify a relocated copy from it."""
import hashlib
import json
import os
import platform
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'macos'))
from slopamp.media import tool


def run(*args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, capture_output=True, **kwargs).stdout


def system_library(name):
    return name.startswith(('/usr/lib/', '/System/Library/'))


def load_commands(path):
    return run('otool', '-l', path).decode()


def dependencies(path):
    result = []
    for line in run('otool', '-L', path).decode().splitlines()[1:]:
        name = line.strip().partition(' (compatibility')[0]
        if name and not name.endswith(':') and not (path.suffix == '.dylib' and Path(name).name == path.name):
            result.append(name)
    return result


def resolve_dependency(name, source, commands):
    if name.startswith('@loader_path/'):
        candidates = [source.parent / name.removeprefix('@loader_path/')]
    elif name.startswith('@rpath/'):
        paths = re.findall(r'cmd LC_RPATH\s+cmdsize \d+\s+path (.*?) \(offset', commands)
        candidates = [Path(p.replace('@loader_path', str(source.parent))) / name.removeprefix('@rpath/') for p in paths]
    elif name.startswith('@'):
        raise RuntimeError(f'Unsupported dependency {name} in {source}')
    else:
        candidates = [Path(name)]
    for path in candidates:
        if path.is_file():
            return path.resolve()
    raise RuntimeError(f'Cannot resolve {name} in {source}')


def minimum_os(commands):
    versions = re.findall(r'\bminos ([\d.]+)', commands)
    versions += re.findall(r'cmd LC_VERSION_MIN_MACOSX\s+cmdsize \d+\s+version ([\d.]+)', commands)
    return max((tuple(map(int, value.split('.'))) for value in versions), default=(12, 0))


def collect_notices(source, destination, collected):
    keg = next((parent for parent in source.parents if (parent / 'INSTALL_RECEIPT.json').is_file()), None)
    if keg is None:
        raise RuntimeError(f'No Homebrew provenance found for {source}; this packager requires Homebrew tools.')
    if keg in collected:
        return
    collected.add(keg)
    output = destination / keg.parent.name / keg.name
    output.mkdir(parents=True)
    for file in keg.rglob('*'):
        if not file.is_file():
            continue
        if file.name.lower().startswith(('license', 'copying', 'copyright', 'notice')) or file.name in {'INSTALL_RECEIPT.json', 'sbom.spdx.json'} or file.parent.name == '.brew':
            target = output / file.relative_to(keg)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, target)


def bundle_tools(app):
    resources = app / 'Contents/Resources'
    tools = resources / 'tools'
    binaries, libraries = tools / 'bin', tools / 'lib'
    binaries.mkdir(parents=True)
    libraries.mkdir()
    notices = resources / 'tool-notices'
    mapped, names, collected, records = {}, {}, set(), []
    minimum = (12, 0)

    def copy(source, target):
        nonlocal minimum
        source = source.resolve()
        if source in mapped:
            return mapped[source]
        if target.name in names and names[target.name] != source:
            raise RuntimeError(f'Conflicting library filename: {target.name}')
        names[target.name], mapped[source] = source, target
        shutil.copy2(source, target)
        target.chmod(target.stat().st_mode | 0o200)
        commands = load_commands(source)
        minimum = max(minimum, minimum_os(commands))
        collect_notices(source, notices, collected)
        changes = []
        for dependency in dependencies(source):
            if system_library(dependency):
                continue
            resolved = resolve_dependency(dependency, source, commands)
            bundled = copy(resolved, libraries / resolved.name)
            changes += ['-change', dependency, '@loader_path/' + os.path.relpath(bundled, target.parent)]
        if target.suffix == '.dylib':
            changes += ['-id', '@loader_path/' + target.name]
        if changes:
            run('install_name_tool', *changes, target)
        for dependency in dependencies(target):
            if not system_library(dependency) and not dependency.startswith('@loader_path/'):
                raise RuntimeError(f'Nonportable dependency remains in {target}: {dependency}')
        run('codesign', '--force', '--sign', '-', target)
        records.append(dict(source=str(source), path=str(target.relative_to(resources)), source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(), bundled_sha256=hashlib.sha256(target.read_bytes()).hexdigest()))
        return target

    for name in ('ffmpeg', 'ffprobe', 'node'):
        source = tool(name)
        if not source:
            raise RuntimeError(f'Install {name} on the build Mac before packaging')
        copy(Path(source), binaries / name)
    (tools / 'manifest.json').write_text(json.dumps(records, indent=2) + '\n')
    (notices / 'README.txt').write_text('Bundled native tools and libraries\n\nThis directory preserves Homebrew license texts, package receipts, formulae and available SBOMs. tools/manifest.json records original and relocated binary hashes. This development image is not a source distribution: before publishing binaries, prepare the corresponding sources/build materials required by the bundled components, including GPL FFmpeg/x264/x265.\n')
    return minimum


def make_icon(app, work):
    iconset = work / 'SlopAMP.iconset'
    iconset.mkdir()
    for size in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            output = iconset / f'icon_{size}x{size}{"@2x" if scale == 2 else ""}.png'
            run('sips', '-z', size * scale, size * scale, ROOT / 'build/icon-512.png', '--out', output)
    icon = app / 'Contents/Resources/SlopAMP.icns'
    run('iconutil', '--convert', 'icns', '--output', icon, iconset)


def verify_image(image, work):
    mount = work / 'mounted'
    mount.mkdir()
    attached = False
    try:
        run('hdiutil', 'verify', image)
        run('hdiutil', 'attach', image, '-readonly', '-noautoopen', '-mountpoint', mount)
        attached = True
        if not (mount / 'Applications').is_symlink() or os.readlink(mount / 'Applications') != '/Applications':
            raise RuntimeError('DMG is missing its Applications shortcut')
        installed = work / 'Relocated Applications/SlopAMP.app'
        installed.parent.mkdir()
        run('ditto', mount / 'SlopAMP.app', installed)
        run('codesign', '--verify', '--deep', '--strict', installed)
        clean_home = work / 'clean-home'
        clean_home.mkdir()
        environment = {'PATH': '/usr/bin:/bin', 'HOME': str(clean_home), 'LANG': 'en_US.UTF-8'}
        report = run(installed / 'Contents/MacOS/SlopAMP', '--check-bundle', env=environment, timeout=90).decode()
        print(report.strip(), flush=True)
        return json.loads(report)
    finally:
        if attached:
            run('hdiutil', 'detach', mount)


def main():
    subprocess.run([sys.executable, str(ROOT / 'bin/build_macos.py')], check=True)
    app = ROOT / 'dist/macos/SlopAMP.app'
    version = json.loads((ROOT / 'package.json').read_text())['version']
    image = ROOT / f'dist/macos/SlopAMP-{version}-macOS-{platform.machine()}-dev.dmg'
    with tempfile.TemporaryDirectory(prefix='slopamp-package-') as temporary:
        work = Path(temporary)
        minimum = bundle_tools(app)
        # Include Python's own deployment target when setting Finder's compatibility gate.
        minimum = max(minimum, minimum_os(load_commands(app / 'Contents/MacOS/SlopAMP')))
        for binary in (app / 'Contents/Frameworks').rglob('Python'):
            if binary.is_file():
                minimum = max(minimum, minimum_os(load_commands(binary)))
        make_icon(app, work)
        info_path = app / 'Contents/Info.plist'
        info = plistlib.loads(info_path.read_bytes())
        info.update(CFBundleIconFile='SlopAMP.icns', LSMinimumSystemVersion='.'.join(map(str, minimum)))
        info_path.write_bytes(plistlib.dumps(info))
        licenses = app / 'Contents/Resources/src/renderer/licenses.html'
        licenses.write_text(licenses.read_text().replace('FFmpeg and JavaScript runtimes are external installations, not bundled with this build.', 'This DMG bundles FFmpeg, ffprobe and Node. Their licenses and Homebrew provenance are included in Contents/Resources/tool-notices; binary hashes are in tools/manifest.json.'))
        run('codesign', '--force', '--deep', '--sign', '-', app)
        run('codesign', '--verify', '--deep', '--strict', app)
        stage = work / 'image'
        stage.mkdir()
        run('ditto', app, stage / 'SlopAMP.app')
        (stage / 'Applications').symlink_to('/Applications')
        run('hdiutil', 'create', '-volname', 'SlopAMP', '-srcfolder', stage, '-fs', 'HFS+', '-format', 'UDZO', '-ov', image)
        report = verify_image(image, work)
        image.with_suffix('.verification.json').write_text(json.dumps(dict(minimum_macos=info['LSMinimumSystemVersion'], architecture=platform.machine(), checks=report), indent=2) + '\n')
    digest = hashlib.sha256(image.read_bytes()).hexdigest()
    image.with_suffix('.dmg.sha256').write_text(f'{digest}  {image.name}\n')
    print(f'Verified development DMG: {image}\nSHA256: {digest}', flush=True)


if __name__ == '__main__':
    main()
