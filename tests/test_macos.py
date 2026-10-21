"""Real filesystem and loopback tests; no Cocoa session required."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'macos'))
from slopamp.backend import Backend, playlist_text
from slopamp.media import MediaServer


class MacTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.ui = self.root / 'ui'
        self.ui.mkdir()
        (self.ui / 'index.html').write_text('hello')
        self.server = MediaServer(self.ui)
        self.backend = Backend(self.server, self.root / 'state', self.root / 'downloads')

    def tearDown(self):
        self.server.stop()
        self.tmp.cleanup()

    def test_ranges_and_private_files(self):
        file = self.root / 'audio.mp3'
        file.write_bytes(b'0123456789')
        url = self.server.base + '/f/' + self.server.key(file)
        for header, expected in [('bytes=2-5', b'2345'), ('bytes=-3', b'789'), ('bytes=7-', b'789')]:
            with urlopen(Request(url, headers={'Range': header})) as response:
                self.assertEqual(response.status, 206)
                self.assertEqual(response.read(), expected)
        for header in ['bytes=20-', 'bytes=7-2', 'bytes=0-1,4-5', 'bytes=-0']:
            with self.assertRaises(HTTPError) as error:
                urlopen(Request(url, headers={'Range': header}))
            self.assertEqual(error.exception.code, 416)
            error.exception.close()
        for path in ['/f/unknown', '/app/../audio.mp3', '/app/%2e%2e/audio.mp3']:
            with self.assertRaises(HTTPError) as error: urlopen(self.server.base + path)
            error.exception.close()
        with self.assertRaises(HTTPError) as error:
            urlopen(Request(url, headers={'Host': 'attacker.example'}))
        self.assertEqual(error.exception.code, 403)
        error.exception.close()

    def test_state_preserves_backend_fields(self):
        file = self.root / 'music.mp3'
        file.write_bytes(b'media')
        self.backend.remember('abcdefghijk', 'audio', str(file), 'Music')
        self.backend.save(dict(tabs=[], volume=42))
        reloaded = Backend(self.server, self.root / 'state', self.root / 'downloads')
        self.assertEqual(reloaded.state['volume'], 42)
        self.assertEqual(reloaded.state['downloads']['abcdefghijk']['audio'], str(file))
        self.backend.state_file.write_text('{broken')
        with self.assertRaises(RuntimeError): Backend(self.server, self.root / 'state')
        self.assertEqual(self.backend.state_file.read_text(), '{broken')

    def test_playlists_relative_unicode_and_cycles(self):
        playlist = self.root / 'café.m3u8'
        playlist.write_text('#EXTM3U\n#EXTINF:12,Song\nmissing.mp3\ncafé.m3u8\nhttps://youtu.be/abcdefghijk\n')
        rows = self.backend.describe([str(playlist)])
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]['title'], 'Song')
        self.assertTrue(rows[0]['missing'])
        self.assertEqual(rows[0]['duration'], 12)
        self.assertEqual(rows[0]['path'], str((self.root / 'missing.mp3').resolve()))
        self.assertEqual(rows[1]['url'], 'https://youtu.be/abcdefghijk')
        items = [dict(type='youtube', url=rows[1]['url'], title='A\nB', duration=12)]
        saved = self.backend.quick_save_all([dict(name='../Mix', items=items), dict(name='../mix', items=items)])
        self.assertEqual(len({row['name'].lower() for row in saved}), 2)
        self.assertEqual(len(self.backend.playlists()), 2)
        self.assertIn('A B', playlist_text(items))
        duplicate = self.backend.describe([str(self.root / 'missing.mp3')] * 2)
        self.assertEqual(len(duplicate), 2)

    def test_download_scan_and_missing(self):
        directory = Path(self.backend.dirs()['audio'])
        directory.mkdir(parents=True)
        file = directory / 'Song [abcdefghijk].mp3'
        file.write_bytes(b'media')
        rows = self.backend.downloads()
        self.assertEqual(rows[0]['vid'], 'abcdefghijk')
        self.assertFalse(rows[0]['missing'])
        missing = self.root / 'missing.mp4'
        missing.write_bytes(b'media')
        self.backend.remember('01234567890', 'video', str(missing))
        missing.unlink()
        self.assertTrue(next(r for r in self.backend.downloads() if r['vid'] == '01234567890')['missing'])


if __name__ == '__main__':
    unittest.main()
