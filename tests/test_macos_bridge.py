"""Exercise the native dispatch boundary without opening dialogs or trashing files."""
import json
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
        self.backend.authorize_paths([str(active), str(inactive)])
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

    def test_renderer_cannot_forge_native_state_or_trash_ownership(self):
        stranger = self.root / 'private.txt'
        stranger.write_text('preserve')
        media = self.root / 'unimported.mp3'
        media.write_bytes(b'media')
        self.app.dispatch('saveState', [{
            'volume': 37, 'dlPlaylistsDir': str(self.root), 'dlAudioDir': str(self.root),
            'dlVideoDir': str(self.root), 'downloads': {'abcdefghijk': {'audio': str(stranger)}},
            'nativeOwnedMedia': [str(media), str(stranger)],
            'tab': 0, 'tabs': [{'items': [{'path': str(stranger)}, {'path': str(media)}]}],
        }])
        self.assertEqual(self.backend.state['volume'], 37)
        self.assertNotIn('downloads', self.backend.state)
        self.assertNotIn('dlAudioDir', self.backend.state)
        self.assertNotIn('dlVideoDir', self.backend.state)
        self.assertNotIn('dlPlaylistsDir', self.backend.state)
        self.assertEqual(self.backend.state['nativeOwnedMedia'], [])
        with patch.object(self.app, 'trash') as trash:
            for file in (stranger, media):
                self.assertFalse(self.app.dispatch('trashFile', [str(file)])['ok'])
                with self.assertRaises(ValueError):
                    self.app.dispatch('dlRemember', ['abcdefghijk', 'audio', str(file)])
            trash.assert_not_called()
        saved = self.app.dispatch('quickSave', [[{'type': 'youtube', 'url': 'https://youtu.be/abcdefghijk'}], 'Mix'])
        self.assertEqual(Path(saved['path']).parent, self.backend.download_dir / 'Playlists')
        reloaded = Backend(None, self.root / 'state', self.root / 'downloads')
        self.assertFalse(reloaded.can_trash(str(media)))
        with self.assertRaises(ValueError):
            reloaded.remember_existing('abcdefghijk', 'audio', str(media))

    def test_existing_copies_migrate_once_and_native_imports_persist(self):
        legacy, imported, stranger = [self.root / name for name in ('legacy.mp3', 'imported.mp3', 'stranger.mp3')]
        for path in (legacy, imported, stranger):
            path.write_bytes(b'media')
        self.backend.state_file.parent.mkdir(parents=True)
        self.backend.state_file.write_text(json.dumps({'tabs': [{'items': [{'localAudio': str(legacy)}]}], 'tab': 0}))
        migrated = Backend(None, self.root / 'state', self.root / 'downloads')
        migrated.remember_existing('abcdefghijk', 'audio', str(legacy))
        migrated.authorize_paths([str(imported)])
        migrated.save_renderer({'tabs': [{'items': [{'path': str(imported)}, {'path': str(stranger)}]}], 'tab': 0})
        reloaded = Backend(None, self.root / 'state', self.root / 'downloads')
        self.assertTrue(reloaded.can_trash(str(imported)))
        self.assertFalse(reloaded.can_trash(str(stranger)))
        reloaded.remember_existing('lmnopqrstuv', 'audio', str(imported))
        self.assertIn('abcdefghijk', reloaded.state['downloads'])
        with self.assertRaises(ValueError):
            reloaded.remember_existing('01234567890', 'audio', str(stranger))

    def test_download_roots_do_not_authorize_symlink_escape(self):
        directory = Path(self.backend.dirs()['audio'])
        directory.mkdir(parents=True)
        inside = directory / 'song.mp3'
        inside.write_bytes(b'media')
        self.app.dispatch('dlRemember', ['abcdefghijk', 'audio', str(inside)])
        self.assertTrue(self.backend.can_trash(str(inside)))
        outside = self.root / 'outside'
        outside.mkdir()
        stranger = outside / 'song.mp3'
        stranger.write_bytes(b'media')
        (directory / 'escape').symlink_to(outside, target_is_directory=True)
        (directory / 'alias.mp3').symlink_to(stranger)
        for path in (directory / 'escape/song.mp3', directory / 'alias.mp3'):
            with self.assertRaises(ValueError):
                self.app.dispatch('dlRemember', ['lmnopqrstuv', 'audio', str(path)])

    def test_native_playlist_directory_imports_are_owned_but_page_paths_are_not(self):
        folder = self.root / 'album'
        folder.mkdir()
        imported = folder / 'song.mp3'
        imported.write_bytes(b'media')
        stranger = self.root / 'stranger.mp3'
        stranger.write_bytes(b'media')
        playlist = self.root / 'import.m3u8'
        playlist.write_text('#EXTM3U\nalbum\n')
        self.backend.media = SimpleNamespace(probe=lambda path: None)
        self.backend.authorize_paths([str(playlist)])
        self.backend.read_playlist(playlist)
        self.backend.describe([str(stranger)])
        self.backend.save_renderer({'tab': 0, 'tabs': [{'items': [{'path': str(imported)}, {'path': str(stranger)}]}]})
        reloaded = Backend(None, self.root / 'state', self.root / 'downloads')
        self.assertTrue(reloaded.can_trash(str(imported)))
        self.assertFalse(reloaded.can_trash(str(stranger)))

    def test_overwriting_native_imported_playlist_does_not_grant_new_ownership(self):
        original, stranger = [self.root / name for name in ('original.mp3', 'stranger.mp3')]
        for path in (original, stranger):
            path.write_bytes(b'media')
        playlist = self.backend.playlists_dir() / 'Mix.m3u8'
        self.backend.media = SimpleNamespace(probe=lambda path: None)
        for native_selection in (playlist, playlist.parent):
            with self.subTest(selection=native_selection):
                playlist.write_text('#EXTM3U\n' + str(original) + '\n')
                with patch.object(self.backend.media, 'probe') as probe:
                    self.backend.authorize_paths([str(native_selection)])
                    probe.assert_not_called()
                self.assertTrue(self.backend.is_known_media(original))
                self.app.dispatch('quickSave', [[{'type': 'file', 'path': str(stranger), 'title': 'Forged'}], 'Mix'])
                loaded = self.app.dispatch('plOpen', [str(playlist)])
                self.app.dispatch('describeFiles', [[str(playlist)]])
                self.app.dispatch('saveState', [{'tab': 0, 'tabs': [{'items': loaded['entries']}]}])
                with patch.object(self.app, 'trash') as trash:
                    self.assertFalse(self.app.dispatch('trashFile', [str(stranger)])['ok'])
                    trash.assert_not_called()
                with self.assertRaises(ValueError):
                    self.app.dispatch('dlRemember', ['abcdefghijk', 'audio', str(stranger)])

    def test_native_subtitle_selection_does_not_authorize_playlist_references(self):
        stranger = self.root / 'stranger.mp3'
        stranger.write_bytes(b'media')
        subtitle = self.root / 'subtitle.srt'
        subtitle.write_text(str(stranger) + '\n')
        self.backend.media = SimpleNamespace(probe=lambda path: None)
        self.backend.authorize_paths([str(subtitle)])
        self.app.dispatch('plOpen', [str(subtitle)])
        self.assertFalse(self.backend.is_known_media(stranger))

    def test_native_ownership_survives_temporarily_missing_media(self):
        imported = self.root / 'external-drive.mp3'
        imported.write_bytes(b'media')
        self.backend.authorize_paths([str(imported)])
        self.backend.save_renderer({'tab': 0, 'tabs': [{'items': [{'path': str(imported)}]}]})
        imported.unlink()
        reloaded = Backend(None, self.root / 'state', self.root / 'downloads')
        self.assertFalse(reloaded.can_trash(str(imported)))
        reloaded.save_renderer({'volume': 42})
        imported.write_bytes(b'media')
        reloaded_again = Backend(None, self.root / 'state', self.root / 'downloads')
        self.assertTrue(reloaded_again.can_trash(str(imported)))

    def test_playlist_delete_rejects_documents_directories_and_symlinks(self):
        directory = self.backend.playlists_dir()
        playlist = directory / 'real.m3u8'
        playlist.write_text('#EXTM3U\n')
        document = directory / 'notes.txt'
        document.write_text('preserve')
        folder = directory / 'folder.m3u8'
        folder.mkdir()
        alias = directory / 'alias.m3u8'
        alias.symlink_to(playlist)
        with patch.object(self.app, 'trash', return_value=True) as trash:
            result = self.app.dispatch('plDelete', [[str(path) for path in (document, folder, alias, playlist)]])
            self.assertEqual([row['ok'] for row in result], [False, False, False, True])
            trash.assert_called_once_with(str(playlist))

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
