"""Serial downloads in isolated process groups, with native ownership of outputs."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from dataclasses import dataclass
from urllib.parse import urlsplit
from .media import tool


def worker_command():
    if getattr(sys, 'frozen', False):
        # py2app can set sys.executable to Contents/MacOS/python. Use the app
        # launcher so its bundled import paths and resources are initialized.
        return [str(Path(sys.executable).resolve().parent / 'SlopAMP'), '--download-worker']
    return [sys.executable, str(Path(__file__).resolve().parents[1] / 'run.py'), '--download-worker']


@dataclass
class Job:
    request: dict
    future: object = None
    process: object = None


class Downloads:
    def __init__(self, backend, emit):
        self.backend, self.emit = backend, emit
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.jobs = {}
        self.running = {}
        self.lock = threading.RLock()
        self.closed = False

    def start(self, job):
        url = urlsplit(job.get('url', ''))
        if url.scheme != 'https' or url.hostname not in {'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'}:
            return dict(ok=False, reason='unsupported')
        if not self.backend.media.ffmpeg:
            return dict(ok=False, reason='missing')
        job = dict(job, kind='audio' if job.get('kind') == 'audio' else 'video')
        with self.lock:
            if self.closed:
                return dict(ok=False, reason='closed')
            if job['id'] in self.jobs:
                return dict(ok=False, reason='busy')
            state = self.jobs[job['id']] = Job(job)
            self.report(state, 'queued')
            state.future = self.executor.submit(self.run, state)
        return dict(ok=True)

    def active(self, state):
        return self.jobs.get(state.request['id']) is state

    def report(self, state, status, **values):
        with self.lock:
            if not self.active(state):
                return
            job = state.request
            self.emit(dict(id=job['id'], vid=job.get('vid'), kind=job['kind'], title=job.get('title', ''), status=status, **values))
            if status in {'done', 'error', 'canceled'}:
                self.jobs.pop(job['id'])

    def kill(self, state):
        if state.process is not None:
            # The worker starts a new session; yt-dlp's FFmpeg and JavaScript
            # children inherit its process group, including during extraction.
            try:
                os.killpg(state.process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            state.process = None

    def cancel(self, job_id):
        with self.lock:
            state = self.jobs.get(job_id)
            if state is not None:
                self.kill(state)
                if state.future:
                    state.future.cancel()
                self.report(state, 'canceled')

    def stop(self):
        with self.lock:
            self.closed = True
            for job_id in list(self.jobs):
                self.cancel(job_id)
            # Terminal UI events can precede worker exit. Retain ownership of
            # those process groups until reap, including descendants holding a
            # pipe open after the worker has exited.
            for state in list(self.running.values()):
                self.kill(state)
        # Cancellation kills blocking native tools too, so this joins promptly
        # and finishes cleanup before Cocoa exits.
        self.executor.shutdown(wait=True, cancel_futures=True)

    def run(self, state):
        job = state.request
        try:
            with self.lock:
                if not self.active(state):
                    return
                directory = Path(self.backend.dirs()[job['kind']])
                directory.mkdir(parents=True, exist_ok=True)
            # Each job owns only its temporary directory. Canceling never
            # deletes a previous successful download with the same video ID.
            with tempfile.TemporaryDirectory(prefix='.slopamp-download-', dir=directory) as temporary, tempfile.TemporaryFile() as errors:
                config = dict(job=job, directory=temporary, ffmpeg=self.backend.media.ffmpeg,
                              runtimes={name: {'path': path} for name in ('deno', 'node') if (path := tool(name))})
                with self.lock:
                    if not self.active(state):
                        return
                    process = state.process = subprocess.Popen(worker_command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                                               stderr=errors, text=True, encoding='utf-8', start_new_session=True)
                    self.running[process.pid] = state
                try:
                    process.stdin.write(json.dumps(config) + '\n')
                    process.stdin.close()
                    for line in process.stdout:
                        event = json.loads(line)
                        status = event.pop('status')
                        if status == 'done':
                            with self.lock:
                                if not self.active(state):
                                    continue
                                source = Path(event['file'])
                                if source.is_symlink() or source.resolve().parent != Path(temporary).resolve() or not source.is_file():
                                    raise RuntimeError('Download output is outside its working directory.')
                                destination = directory / source.name
                                source.replace(destination)
                                self.backend.remember(event['vid'], job['kind'], str(destination), event.get('title', ''))
                                self.report(state, 'done', file=str(destination))
                        elif status == 'error':
                            self.report(state, 'error', error=event['error'], live=bool(event.get('live')))
                        elif status in {'downloading', 'processing'}:
                            self.report(state, status, **event)
                    process.wait()
                    with self.lock:
                        if self.active(state):
                            errors.seek(0, os.SEEK_END)
                            errors.seek(max(0, errors.tell() - 1500))
                            detail = errors.read().decode(errors='replace').strip()
                            self.report(state, 'error', error=detail or f'Download worker exited without a result ({process.returncode}).')
                finally:
                    with self.lock:
                        self.kill(state)
                    process.wait()
                    with suppress(BrokenPipeError):
                        process.stdin.close()
                    process.stdout.close()
                    with self.lock:
                        self.running.pop(process.pid, None)
        except Exception as exc:
            self.report(state, 'error', error=str(exc))
