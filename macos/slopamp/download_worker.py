"""Headless yt-dlp child; stdout contains newline-delimited progress/results."""
import json
from pathlib import Path
import sys
import yt_dlp


class LiveDownloadError(Exception):
    def __init__(self, live):
        self.live = live
        super().__init__('Live streams can’t be downloaded until they end.' if live else 'This premiere hasn’t started yet — try again after it airs.')


def reject_live(info, *, incomplete=False):
    if info.get('is_live') or info.get('live_status') == 'is_live':
        raise LiveDownloadError(True)
    if info.get('live_status') == 'is_upcoming':
        raise LiveDownloadError(False)
    return None


def run(config, emit, downloader_class=yt_dlp.YoutubeDL):
    job, directory = config['job'], Path(config['directory'])

    def progress(data):
        total = data.get('total_bytes') or data.get('total_bytes_estimate') or 1
        emit(dict(status='processing' if data['status'] == 'finished' else 'downloading',
                  pct=min(100, data.get('downloaded_bytes', 0) * 100 / total)))

    quality = job.get('quality', 'best')
    ceiling = f'[height<={quality}]' if quality in {'1080', '720', '480'} else ''
    options = dict(outtmpl=str(directory / '%(title).180B [%(id)s].%(ext)s'), noplaylist=True,
                   quiet=True, noprogress=True, logtostderr=True, socket_timeout=20, retries=2,
                   ffmpeg_location=config['ffmpeg'], js_runtimes=config['runtimes'],
                   progress_hooks=[progress], postprocessor_hooks=[lambda _: emit(dict(status='processing'))],
                   match_filter=reject_live, format=f'bv*{ceiling}+ba/b{ceiling}', merge_output_format='mp4')
    if job['kind'] == 'audio':
        options.update(format='bestaudio/best', postprocessors=[dict(key='FFmpegExtractAudio', preferredcodec='mp3', preferredquality='192')])
    with downloader_class(options) as downloader:
        info = downloader.extract_info(job['url'], download=True)
        if not info:
            raise RuntimeError('The video is unavailable for download.')
        file = Path(info.get('filepath') or downloader.prepare_filename(info))
        if job['kind'] == 'audio':
            file = file.with_suffix('.mp3')
        if not file.is_file():
            file = file.with_suffix('.mp4')
        if not file.is_file():
            raise RuntimeError('Download finished but its output file was not found.')
        emit(dict(status='done', file=str(file), vid=info['id'], title=info.get('title', '')))


def main(downloader_class=yt_dlp.YoutubeDL):
    def emit(event):
        print(json.dumps(event), flush=True)

    try:
        config = json.load(sys.stdin)
        if config.get('check'):
            import yt_dlp_ejs
            emit(dict(status='ready'))
            return 0
        run(config, emit, downloader_class)
        return 0
    except Exception as exc:
        emit(dict(status='error', error=str(exc), live=bool(getattr(exc, 'live', False))))
        return 1
