"""Concurrent native playlist writes must publish a complete request."""
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'macos'))
from slopamp import backend as module
from slopamp.backend import Backend, atomic_write, playlist_text


class AtomicPlaylistTests(unittest.TestCase):
    def test_overlapping_quick_save_and_save_all_publish_complete_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            backend = Backend(None, root / 'state', root / 'downloads')
            long_items = [dict(type='file', path=f'/music/song-{n}.mp3', title=f'Song {n}') for n in range(100)]
            short_items = [dict(type='file', path='/music/new.mp3', title='New')]
            barrier = threading.Barrier(2)
            real_fsync = module.os.fsync

            def synchronized_fsync(fd):
                real_fsync(fd)
                barrier.wait(timeout=5)

            with patch.object(module.os, 'fsync', synchronized_fsync), ThreadPoolExecutor(max_workers=2) as pool:
                all_result = pool.submit(backend.quick_save_all, [dict(name='Mix', items=long_items)])
                one_result = pool.submit(backend.quick_save, short_items, 'Mix')
                self.assertTrue(all_result.result(timeout=10)[0]['ok'])
                self.assertTrue(one_result.result(timeout=10)['saved'])
            target = backend.playlists_dir() / 'Mix.m3u8'
            self.assertIn(target.read_text(), [playlist_text(long_items), playlist_text(short_items)])
            self.assertEqual(list(target.parent.glob('*.tmp')), [])

    def test_failed_publish_preserves_destination_and_removes_temporary(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'Mix.m3u8'
            target.write_text('original')
            with patch.object(Path, 'replace', side_effect=OSError('publish failed')):
                with self.assertRaisesRegex(OSError, 'publish failed'):
                    atomic_write(target, 'new')
            self.assertEqual(target.read_text(), 'original')
            self.assertEqual(list(target.parent.glob('*.tmp')), [])
