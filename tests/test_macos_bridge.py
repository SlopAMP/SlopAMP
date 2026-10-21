"""Exercise the native dispatch boundary without opening dialogs or trashing files."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'macos'))
from slopamp.app import AppDelegate
from slopamp.backend import Backend


class BridgePermissionsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.backend = Backend(None, self.root / 'state', self.root / 'downloads')
        self.app = SimpleNamespace(backend=self.backend, trash=None, choose_files=None)
        self.app.dispatch = lambda method, args: AppDelegate.dispatch(self.app, method, args)

    def tearDown(self):
        self.temp.cleanup()

    def test_trash_only_current_playlist_or_downloads(self):
        active, inactive, download, stranger = [self.root / name for name in ('active.mp3', 'inactive.mp3', 'download.mp3', 'stranger.mp3')]
        for path in (active, inactive, download, stranger):
            path.write_bytes(b'test')
        self.backend.save({'tab': 0, 'tabs': [{'items': [{'path': str(active)}]}, {'items': [{'path': str(inactive)}]}]})
        self.backend.remember('abcdefghijk', 'audio', str(download))
        link = self.root / 'linked.mp3'
        link.symlink_to(stranger)
        self.backend.state['tabs'][0]['items'].append({'path': str(link)})
        with patch.object(self.app, 'trash', return_value=True) as trash:
            for path in (stranger, inactive, self.root, link):
                self.assertFalse(self.app.dispatch('trashFile', [str(path)])['ok'])
            trash.assert_not_called()
            for path in (active, download):
                self.assertEqual(self.app.dispatch('trashFile', [str(path)]), {'ok': True})
                trash.assert_called_with(str(path))

    def test_quick_save_cannot_supply_a_destination(self):
        outside = self.root / 'outside.m3u8'
        outside.write_text('preserve me')
        items = [{'type': 'youtube', 'url': 'https://youtu.be/abcdefghijk'}]
        result = self.app.dispatch('quickSave', [items, 'Mix', str(outside)])
        self.assertTrue(result['saved'])
        self.assertEqual(Path(result['path']), self.backend.playlists_dir() / 'Mix.m3u8')
        self.assertEqual(outside.read_text(), 'preserve me')

    def test_directory_kinds_are_checked_before_side_effects(self):
        with patch.object(self.app, 'choose_files') as choose, patch('slopamp.app.A.NSWorkspace') as workspace:
            for method in ('dlChooseDir', 'dlOpenDir', 'dlResetDirs'):
                for args in ([None], ['Audio'], ['../../escape'], [''], [123], [{}], ['audio', 'bad']):
                    with self.subTest(method=method, args=args), self.assertRaises(ValueError):
                        self.app.dispatch(method, args)
            choose.assert_not_called()
            workspace.assert_not_called()
            self.assertEqual(self.backend.state, {})

    def test_save_dialog_is_the_only_custom_destination(self):
        from slopamp.app import A, F
        chosen = self.root / 'chosen.m3u8'
        forged = self.root / 'forged.m3u8'
        items = [{'type': 'youtube', 'url': 'https://youtu.be/abcdefghijk'}]
        with patch('slopamp.app.A.NSSavePanel') as panel_class:
            panel = panel_class.savePanel.return_value
            panel.runModal.return_value = A.NSModalResponseOK
            panel.URL.return_value = F.NSURL.fileURLWithPath_(str(chosen))
            result = self.app.dispatch('savePlaylist', [items, 'Mix', str(forged)])
            self.assertEqual(result['path'], str(chosen))
            self.assertTrue(chosen.is_file())
            self.assertFalse(forged.exists())
            panel.runModal.return_value = A.NSModalResponseCancel
            self.assertEqual(self.app.dispatch('savePlaylist', [items, 'Mix']), {'saved': False})

    def test_valid_directory_kinds_and_reset_all(self):
        with patch.object(self.app, 'choose_files') as choose, patch('slopamp.app.A.NSWorkspace') as workspace:
            for kind in ('audio', 'video', 'playlists'):
                directory = self.root / ('custom-' + kind)
                choose.return_value = [str(directory)]
                self.assertEqual(self.app.dispatch('dlChooseDir', [kind])[kind], str(directory))
                self.app.dispatch('dlOpenDir', [kind])
                self.assertTrue(directory.is_dir())
                self.assertEqual(str(workspace.sharedWorkspace.return_value.openURL_.call_args.args[0].path()), str(directory))
                self.app.dispatch('dlResetDirs', [kind])
                self.assertEqual(self.backend.dirs()[kind], str(self.root / 'downloads' / kind.title()))
            self.backend.save(dict(dlAudioDir='/custom/audio', dlVideoDir='/custom/video', dlPlaylistsDir='/custom/playlists'))
            reset = self.app.dispatch('dlResetDirs', [])
            self.assertEqual(reset, {kind: str(self.root / 'downloads' / kind.title()) for kind in ('audio', 'video', 'playlists')})
