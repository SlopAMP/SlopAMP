"""Packaging metadata and verification checks without building or mounting images."""
import json
import plistlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'bin'))
sys.path.insert(0, str(ROOT / 'macos'))
import macos_bundle
import package_macos
from slopamp.bundle_check import RENDERER_FILES, check, check_renderer, validate_report


class PackagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_final_metadata_covers_all_native_files_before_signing(self):
        app = self.root / 'SlopAMP.app'
        contents = app / 'Contents'
        contents.mkdir(parents=True)
        (contents / 'Info.plist').write_bytes(plistlib.dumps({
            'CFBundleShortVersionString': '1.0.0', 'LSMinimumSystemVersion': '12.0',
        }))
        commands = {}
        for relative, load in (
            ('MacOS/SlopAMP', 'cmd LC_BUILD_VERSION\n minos 11.0'),
            ('Frameworks/Python', 'cmd LC_BUILD_VERSION\n minos 14.0'),
            ('Resources/tools/bin/node', 'cmd LC_VERSION_MIN_MACOSX\n cmdsize 16\n version 15.0'),
            ('Resources/lib/python3.14/native.so', 'cmd LC_BUILD_VERSION\n minos 16.2'),
        ):
            binary = contents / relative
            binary.parent.mkdir(parents=True, exist_ok=True)
            binary.write_bytes(bytes.fromhex('cffaedfe') + b'fixture')
            commands[binary] = load
        (contents / 'Resources/README.txt').write_text('not a binary')
        (self.root / 'package.json').write_text('{"version":"2.3.4"}')
        calls = []

        def signing(*args):
            # Signing must see the final metadata, not the stale py2app plist.
            info = plistlib.loads((contents / 'Info.plist').read_bytes())
            self.assertEqual(info['CFBundleVersion'], '2.3.4')
            self.assertEqual(info['CFBundleShortVersionString'], '2.3.4')
            self.assertEqual(info['LSMinimumSystemVersion'], '16.2')
            self.assertEqual(info['CFBundleIconFile'], 'SlopAMP.icns')
            calls.append(args)
            return b''

        with patch.object(macos_bundle, 'load_commands', side_effect=commands.__getitem__) as inspect, \
                patch.object(macos_bundle, 'run', side_effect=signing):
            macos_bundle.finalize_bundle(app, macos_bundle.project_version(self.root), icon='SlopAMP.icns')
        self.assertEqual({call.args[0] for call in inspect.call_args_list}, set(commands))
        self.assertEqual(calls, [
            ('codesign', '--force', '--deep', '--sign', '-', app),
            ('codesign', '--verify', '--deep', '--strict', app),
        ])

    def test_missing_renderer_resources_fail_before_tools_run(self):
        for absent in ('index.html', 'app.js', 'vendor/butterchurn.min.js'):
            with self.subTest(absent=absent), tempfile.TemporaryDirectory(dir=self.root) as directory:
                resources = Path(directory)
                for name in RENDERER_FILES:
                    if name == absent:
                        continue
                    asset = resources / 'src/renderer' / name
                    asset.parent.mkdir(parents=True, exist_ok=True)
                    asset.write_text('fixture')
                with patch('slopamp.bundle_check.tool') as discover, self.assertRaisesRegex(RuntimeError, 'Missing bundled renderer'):
                    check(resources)
                discover.assert_not_called()
                missing = resources / 'src/renderer' / absent
                missing.parent.mkdir(parents=True, exist_ok=True)
                missing.write_text('fixture')
                check_renderer(resources)

    def test_verification_reports_require_every_success(self):
        report = dict(ok=True, conversion=True, range_serving=True, state=True,
                      renderer=True, download_worker=True,
                      bundled_tools=['ffmpeg', 'ffprobe', 'node'])
        self.assertEqual(validate_report(report), report)
        for field in ('ok', 'conversion', 'range_serving', 'state', 'renderer', 'download_worker', 'bundled_tools'):
            for bad in (None, False):
                with self.subTest(field=field, bad=bad), self.assertRaises(RuntimeError):
                    validate_report(dict(report, **{field: bad}))
        with self.assertRaises(RuntimeError):
            validate_report(dict(report, bundled_tools=['ffmpeg', 'node']))

    def test_image_verification_rejects_failed_report_and_detaches(self):
        calls = []

        def command(*args, **kwargs):
            calls.append(args)
            if args[:2] == ('hdiutil', 'attach'):
                (self.root / 'mounted/Applications').symlink_to('/Applications')
            if args[-1] == '--check-bundle':
                return json.dumps(dict(ok=False)).encode()
            return b''

        with patch.object(package_macos, 'run', side_effect=command), \
                self.assertRaisesRegex(RuntimeError, 'Bundle verification failed'):
            package_macos.verify_image(self.root / 'image.dmg', self.root)
        self.assertEqual(calls[-1], ('hdiutil', 'detach', self.root / 'mounted'))


if __name__ == '__main__':
    unittest.main()
