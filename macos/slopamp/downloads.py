"""Serial yt-dlp worker with progress, cancellation and persistent indexing."""
import threading
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlsplit
import yt_dlp
from .media import tool


class Downloads:
    def __init__(self, backend, emit):
        self.backend, self.emit = backend, emit
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.jobs = {}
        self.lock = threading.Lock()

    def start(self, job):
        url = urlsplit(job.get('url', ''))
        if url.scheme != 'https' or url.hostname not in {'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'}:
            return dict(ok=False, reason='unsupported')
        if not self.backend.media.ffmpeg:
            return dict(ok=False, reason='missing')
        job = dict(job, kind='audio' if job.get('kind') == 'audio' else 'video')
        with self.lock:
            if job['id'] in self.jobs:
                return dict(ok=False, reason='busy')
            cancel = threading.Event()
            self.jobs[job['id']] = cancel
        self.emit(dict(job, status='queued'))
        self.executor.submit(self.run, job, cancel)
        return dict(ok=True)

    def cancel(self, job_id):
        with self.lock:
            if job_id in self.jobs:
                self.jobs[job_id].set()

    def stop(self):
        with self.lock:
            for cancel in self.jobs.values():
                cancel.set()
        self.executor.shutdown(wait=False, cancel_futures=True)

    def run(self, job, cancel):
        def report(status, **values):
            self.emit(dict(id=job['id'], vid=job.get('vid'), kind=job['kind'], title=job.get('title', ''), status=status, **values))

        def progress(data):
            if cancel.is_set():
                raise RuntimeError('Canceled')
            total = data.get('total_bytes') or data.get('total_bytes_estimate') or 1
            report('processing' if data['status'] == 'finished' else 'downloading', pct=min(100, data.get('downloaded_bytes', 0) * 100 / total))

        try:
            if cancel.is_set():
                return
            directory = self.backend.dirs()[job['kind']]
            quality = job.get('quality', 'best')
            ceiling = f'[height<={quality}]' if quality in {'1080', '720', '480'} else ''
            options = dict(outtmpl=directory + '/%(title).180B [%(id)s].%(ext)s', noplaylist=True, quiet=True, socket_timeout=20, retries=2, ffmpeg_location=self.backend.media.ffmpeg, progress_hooks=[progress], postprocessor_hooks=[lambda _: progress(dict(status='finished'))], format=f'bv*{ceiling}+ba/b{ceiling}', merge_output_format='mp4')
            options['js_runtimes'] = {name: {'path': path} for name in ('deno', 'node') if (path := tool(name))}
            if job['kind'] == 'audio':
                options.update(format='bestaudio/best', postprocessors=[dict(key='FFmpegExtractAudio', preferredcodec='mp3', preferredquality='192')])
            with yt_dlp.YoutubeDL(options) as downloader:
                info = downloader.extract_info(job['url'], download=True)
                file = downloader.prepare_filename(info)
                if job['kind'] == 'audio':
                    from pathlib import Path
                    file = str(Path(file).with_suffix('.mp3'))
                else:
                    file = info.get('filepath') or file
                from pathlib import Path
                if not Path(file).is_file():
                    candidate = Path(file).with_suffix('.mp4')
                    if not candidate.is_file():
                        raise RuntimeError('Download finished but its output file was not found.')
                    file = str(candidate)
                if cancel.is_set():
                    report('canceled')
                else:
                    self.backend.remember(info['id'], job['kind'], file, info.get('title', ''))
                    report('done', file=file)
        except Exception as exc:
            report('canceled' if cancel.is_set() else 'error', error=str(exc))
        finally:
            if cancel.is_set():
                report('canceled')
            with self.lock:
                self.jobs.pop(job['id'], None)
