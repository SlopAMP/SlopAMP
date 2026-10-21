"""Exercise real download worker IPC, FFmpeg cancellation and live filtering offline."""
from concurrent.futures import ThreadPoolExecutor
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import wave

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'macos'))
from slopamp.backend import Backend
from slopamp.downloads import Downloads, worker_command
from slopamp.media import MediaServer, tool


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class WorkerEntrypointTests(unittest.TestCase):
    def test_source_worker_starts_without_a_window(self):
        result = subprocess.run(worker_command(), input='{"check":true}', text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {'status': 'ready'})

    def test_frozen_worker_uses_app_launcher(self):
        with patch('slopamp.downloads.sys.frozen', 'macosx_app', create=True), patch('slopamp.downloads.sys.executable', '/Applications/SlopAMP.app/Contents/MacOS/python'):
            self.assertEqual(worker_command(), ['/Applications/SlopAMP.app/Contents/MacOS/SlopAMP', '--download-worker'])


@unittest.skipUnless(tool('ffmpeg') and tool('ffprobe'), 'FFmpeg and ffprobe are required')
class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='slopamp-download-test-')
        self.root = Path(self.temporary.name)
        self.audio = self.root / 'tone.wav'
        with wave.open(str(self.audio), 'wb') as output:
            output.setparams((1, 2, 44100, 0, 'NONE', 'not compressed'))
            output.writeframes(b'\0\0' * 44100 * 8)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(self.root)))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.pidfile = self.root / 'ffmpeg.pid'
        executable = self.root / 'bin/ffmpeg'
        executable.parent.mkdir()
        # Persist the executable wrapper, then exec the checked-in fixture.
        fixture = ROOT / 'tests/fixtures/macos_paced_ffmpeg.py'
        executable.write_text(f'#!{sys.executable}\n' + fixture.read_text())
        executable.chmod(0o755)
        executable.with_name('ffprobe').symlink_to(tool('ffprobe'))
        self.environment = patch.dict(os.environ, {
            'SLOPAMP_FIXTURE_MEDIA_URL': f'http://127.0.0.1:{self.server.server_port}/tone.wav',
            'SLOPAMP_FIXTURE_FFMPEG': tool('ffmpeg'),
            'SLOPAMP_FIXTURE_FFMPEG_PID': str(self.pidfile),
        })
        self.environment.start()
        self.command = patch('slopamp.downloads.worker_command', return_value=[sys.executable, str(ROOT / 'tests/fixtures/macos_download_worker.py')])
        self.command.start()
        self.backend = Backend(SimpleNamespace(ffmpeg=str(executable)), self.root / 'state', self.root / 'downloads')
        self.events = []
        self.downloader = Downloads(self.backend, self.events.append)

    def tearDown(self):
        self.downloader.stop()
        self.command.stop()
        self.environment.stop()
        self.server.shutdown()
        self.server.server_close()
        self.temporary.cleanup()

    def start(self, job_id):
        result = self.downloader.start(dict(id=job_id, vid='abcdefghijk', url='https://youtu.be/abcdefghijk', kind='audio'))
        self.assertTrue(result['ok'])

    def wait_for(self, predicate):
        deadline = time.monotonic() + 15
        while not predicate() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertTrue(predicate(), self.events)

    def terminal(self, job_id):
        return [e for e in self.events if e['id'] == job_id and e['status'] in {'done', 'error', 'canceled'}]

    def test_success_publishes_and_remembers_real_mp3(self):
        self.backend.media.ffmpeg = tool('ffmpeg')
        self.start('success')
        self.wait_for(lambda: self.terminal('success'))
        self.downloader.stop()
        terminal = self.terminal('success')
        self.assertEqual(len(terminal), 1)
        self.assertEqual(terminal[0]['status'], 'done', terminal)
        output = Path(terminal[0]['file'])
        self.assertEqual(output.parent, Path(self.backend.dirs()['audio']))
        self.assertEqual(self.backend.state['downloads']['abcdefghijk']['audio'], str(output))
        probe = subprocess.run([tool('ffprobe'), '-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'json', str(output)], capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(probe.stdout)['streams'][0]['codec_name'], 'mp3')
        self.assertEqual(list(output.parent.iterdir()), [output])

    def test_cancel_kills_ffmpeg_and_removes_only_job_files(self):
        directory = Path(self.backend.dirs()['audio'])
        directory.mkdir(parents=True)
        existing = directory / 'Download Fixture [abcdefghijk].mp3'
        existing.write_bytes(b'previous completed download')
        self.start('active')
        self.wait_for(self.pidfile.exists)
        pid = int(self.pidfile.read_text())
        self.start('queued')
        self.downloader.cancel('queued')
        self.assertEqual([e['status'] for e in self.terminal('queued')], ['canceled'])
        began = time.monotonic()
        self.downloader.cancel('active')
        self.downloader.stop()
        self.assertLess(time.monotonic() - began, 3)
        self.assertEqual([e['status'] for e in self.terminal('active')], ['canceled'])
        self.assertEqual([e['status'] for e in self.events if e['id'] == 'queued'], ['queued', 'canceled'])
        self.wait_for(lambda: not self.process_exists(pid))
        self.assertEqual(existing.read_bytes(), b'previous completed download')
        self.assertEqual(list(directory.iterdir()), [existing])
        self.assertFalse(self.downloader.jobs)

    def test_stop_terminates_active_children_and_queued_jobs(self):
        self.start('active')
        self.wait_for(self.pidfile.exists)
        pid = int(self.pidfile.read_text())
        self.start('queued')
        self.downloader.stop()
        self.wait_for(lambda: not self.process_exists(pid))
        for job_id in ('active', 'queued'):
            self.assertEqual([e['status'] for e in self.terminal(job_id)], ['canceled'])
        self.assertEqual(list(Path(self.backend.dirs()['audio']).iterdir()), [])

    def test_cancel_releases_worker_for_the_next_download(self):
        self.start('active')
        self.wait_for(self.pidfile.exists)
        self.backend.media.ffmpeg = tool('ffmpeg')
        self.start('next')
        self.downloader.cancel('active')
        self.wait_for(lambda: self.terminal('next'))
        self.downloader.stop()
        self.assertEqual([e['status'] for e in self.terminal('active')], ['canceled'])
        self.assertEqual([e['status'] for e in self.terminal('next')], ['done'])
        self.assertTrue(Path(self.terminal('next')[0]['file']).is_file())

    def test_stop_owns_process_group_after_terminal_result(self):
        self.backend.media.ffmpeg = tool('ffmpeg')
        child_pid = self.root / 'exit-child.pid'
        with patch.dict(os.environ, SLOPAMP_FIXTURE_EXIT_CHILD_PID=str(child_pid)):
            self.start('success')
            self.wait_for(lambda: self.terminal('success') and child_pid.exists())
            pid = int(child_pid.read_text())
            self.assertTrue(self.downloader.running)
            began = time.monotonic()
            self.downloader.stop()
            self.assertLess(time.monotonic() - began, 3)
        self.wait_for(lambda: not self.process_exists(pid))
        self.assertEqual([e['status'] for e in self.terminal('success')], ['done'])
        self.assertFalse(self.downloader.running)

    def test_live_and_upcoming_are_rejected_before_download(self):
        for state in ('is_live', 'is_upcoming'):
            with self.subTest(state=state), patch.dict(os.environ, SLOPAMP_FIXTURE_LIVE_STATUS=state):
                self.start(state)
                self.wait_for(lambda: self.terminal(state))
                terminal = self.terminal(state)
                self.assertEqual(len(terminal), 1)
                self.assertEqual(terminal[0]['status'], 'error')
                self.assertEqual(terminal[0]['live'], state == 'is_live')
                self.assertFalse(self.pidfile.exists())
        self.downloader.stop()
        self.assertEqual(list(Path(self.backend.dirs()['audio']).iterdir()), [])

    def test_media_stop_does_not_start_waiting_conversion(self):
        media = MediaServer(ROOT / 'src/renderer')
        media.ffmpeg = self.backend.media.ffmpeg
        second = self.root / 'second.wav'
        shutil.copy2(self.audio, second)
        executor = ThreadPoolExecutor(max_workers=2)
        try:
            first = executor.submit(media.prepare, str(self.audio), {'forceTranscode': True})
            self.wait_for(self.pidfile.exists)
            pid = int(self.pidfile.read_text())
            original_probe = media.probe
            second_probed = threading.Event()

            def record_probe(file):
                result = original_probe(file)
                if Path(file) == second:
                    second_probed.set()
                return result

            media.probe = record_probe
            other = executor.submit(media.prepare, str(second), {'forceTranscode': True})
            self.wait_for(second_probed.is_set)
            media.stop()
            with self.assertRaises(RuntimeError):
                first.result(timeout=5)
            with self.assertRaisesRegex(RuntimeError, 'stopped'):
                other.result(timeout=5)
            self.assertEqual(int(self.pidfile.read_text()), pid)
            self.assertFalse(Path(media.cache.name).exists())
            self.assertFalse(media.processes)
        finally:
            media.stop()
            executor.shutdown(wait=True)

    @staticmethod
    def process_exists(pid):
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False
