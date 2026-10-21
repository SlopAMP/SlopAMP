"""Loopback media server. Only explicitly registered files receive media URLs."""
import json
import mimetypes
import re
import secrets
import shutil
import subprocess
import threading
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

VIDEO = set('mp4 m4v mkv avi mov wmv webm flv mpg mpeg ts m2ts mts vob 3gp 3g2 ogv divx xvid asf rm rmvb f4v mxf dv'.split())
MEDIA = VIDEO | set('mp3 flac wav ogg oga opus m4a aac wma ape alac aiff aif mka ac3 dts amr mpc wv tta mid mod xm it s3m'.split())
SUBS = {'.srt', '.vtt', '.ass', '.ssa'}


def tool(name):
    return shutil.which(name) or next((str(p) for p in [Path('/opt/homebrew/bin') / name, Path('/usr/local/bin') / name] if p.is_file()), None)


class MediaServer:
    def __init__(self, renderer):
        self.renderer = Path(renderer).resolve()
        self.ffmpeg, self.ffprobe = tool('ffmpeg'), tool('ffprobe')
        self.files, self.probes = {}, {}
        self.processes = set()
        self.lock = threading.RLock()
        self.conversion_lock = threading.Lock()
        self.cache = tempfile.TemporaryDirectory(prefix='slopamp-media-')
        self.converted = {}
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.media = self
        self.base = f'http://127.0.0.1:{self.server.server_port}'
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        with self.lock:
            for proc in list(self.processes):
                proc.kill()
                proc.wait()
        self.cache.cleanup()

    def key(self, file):
        file = Path(file).resolve()
        with self.lock:
            key = secrets.token_hex(24)
            self.files[key] = file
        return key

    def probe(self, file):
        file = Path(file)
        stat = file.stat()
        cache_key = (str(file), stat.st_mtime_ns, stat.st_size)
        if cache_key in self.probes:
            return self.probes[cache_key]
        if not self.ffprobe:
            return None
        raw = subprocess.run([self.ffprobe, '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(file)], capture_output=True, timeout=25)
        if raw.returncode:
            return None
        data = json.loads(raw.stdout)
        streams, fmt = data.get('streams', []), data.get('format', {})
        video = next((s for s in streams if s['codec_type'] == 'video' and not s.get('disposition', {}).get('attached_pic')), None)
        audio = next((s for s in streams if s['codec_type'] == 'audio'), None)
        cover = next((s for s in streams if s.get('disposition', {}).get('attached_pic')), None)
        tags = {k.lower(): v for k, v in fmt.get('tags', {}).items()}
        info = dict(format=fmt.get('format_name', ''), duration=float(fmt.get('duration', 0)), bitrate=int(fmt.get('bit_rate', 0)), title=tags.get('title', ''), hasVideo=bool(video), hasCover=bool(cover), coverIndex=cover['index'] if cover else -1, video=None, audio=None, subs=[])
        if video:
            info['video'] = dict(codec=video['codec_name'], width=video.get('width'), height=video.get('height'), pixFmt=video.get('pix_fmt', ''))
        if audio:
            info['audio'] = dict(codec=audio['codec_name'], sampleRate=int(audio.get('sample_rate', 0)), channels=audio.get('channels', 0), bitrate=int(audio.get('bit_rate', 0)))
        for s in streams:
            if s['codec_type'] == 'subtitle':
                tags = s.get('tags', {})
                info['subs'].append(dict(index=s['index'], lang=tags.get('language', ''), label=tags.get('title') or tags.get('language') or f"Track {s['index']}", text=s['codec_name'] not in {'hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub'}, **{'def': bool(s.get('disposition', {}).get('default'))}))
        self.probes[cache_key] = info
        return info

    def prepare(self, file, opts=None):
        if not Path(file).is_file():
            return dict(ok=False, error='missing')
        opts = opts or {}
        info, key = self.probe(file), self.key(file)
        ext = Path(file).suffix.lower()
        direct = ext in {'.mp3', '.wav', '.aac', '.m4a', '.mp4', '.m4v', '.mov', '.aiff', '.aif', '.flac'}
        if info:
            direct &= not info['video'] or info['video']['codec'] in {'h264', 'hevc'}
            direct &= not info['audio'] or info['audio']['codec'] in {'aac', 'mp3', 'alac', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_f32le', 'pcm_s16be'}
        direct &= not (opts.get('forceStream') or opts.get('forceTranscode'))
        if not direct and not self.ffmpeg:
            raise RuntimeError('FFmpeg is required for this format. Install FFmpeg and restart SlopAMP.')
        playback_key = key
        if not direct:
            playback_key = self.key(self.convert_for_webkit(file, info))
            ext = '.mp4'
        return dict(ok=True, key=key, info=info, mode='direct', converted=not direct, directUrl=f'{self.base}/f/{playback_key}{ext}', streamUrl=f'{self.base}/s/{key}?tc=1', coverUrl=f'{self.base}/c/{key}' if info and info['hasCover'] else None)

    def convert_for_webkit(self, file, info):
        """WebKit requires seekable responses; cache an MP4 with a front-loaded index."""
        path = Path(file).resolve()
        stat = path.stat()
        fingerprint = (str(path), stat.st_size, stat.st_mtime_ns)
        with self.conversion_lock:
            if fingerprint in self.converted:
                return self.converted[fingerprint]
            target = Path(self.cache.name) / (secrets.token_hex(16) + '.mp4')
            args = [self.ffmpeg, '-nostdin', '-v', 'error', '-i', str(path)]
            if info and info['hasVideo']:
                args += ['-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p']
            else:
                args += ['-map', '0:a:0', '-vn']
            args += ['-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-sn', '-movflags', '+faststart', str(target)]
            proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            with self.lock:
                self.processes.add(proc)
            try:
                _, error = proc.communicate()
                if proc.returncode:
                    raise RuntimeError('Media conversion failed: ' + error.decode(errors='replace')[-1500:])
                self.converted[fingerprint] = target
                return target
            finally:
                with self.lock:
                    self.processes.discard(proc)

    def sub_file(self, file):
        return dict(id=f'x{file}', label=Path(file).name, path=str(file), text=True, url=f'{self.base}/v/{self.key(file)}')

    def subtitles(self, file):
        info = self.probe(file) or {}
        key = self.key(file)
        embedded = [dict(s, id=f"e{s['index']}", url=f"{self.base}/v/{key}?i={s['index']}") for s in info.get('subs', [])]
        path = Path(file)
        external = [self.sub_file(p) for p in sorted(path.parent.iterdir()) if p.is_file() and p.suffix.lower() in SUBS and p.stem.startswith(path.stem)]
        return dict(embedded=embedded, external=external)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        media = self.server.media
        if self.headers.get('Host') != urlsplit(media.base).netloc:
            self.send_error(403)
            return
        url = urlsplit(self.path)
        parts = unquote(url.path).strip('/').split('/')
        try:
            if parts[0] == 'app':
                file = (media.renderer / '/'.join(parts[1:])).resolve()
                if not file.is_relative_to(media.renderer) or not file.is_file():
                    self.send_error(404)
                    return
                self.serve_file(file)
                return
            file = media.files.get(parts[1].split('.')[0]) if len(parts) == 2 else None
            if not file or not file.is_file():
                self.send_error(404)
                return
            if parts[0] == 'f':
                self.serve_file(file)
            elif parts[0] in {'s', 'v', 'c'}:
                self.convert(file, parts[0], parse_qs(url.query))
            else:
                self.send_error(404)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.send_error(500)

    def serve_file(self, file):
        size = file.stat().st_size
        start, end, status = 0, size - 1, 200
        value = self.headers.get('Range')
        if value:
            match = re.fullmatch(r'bytes=(\d*)-(\d*)', value)
            if match and any(match.groups()):
                lo, hi = match.groups()
                start = int(lo) if lo else max(0, size - int(hi))
                end = min(int(hi), size - 1) if lo and hi else size - 1
            else:
                start = size
            if start > end or start >= size:
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{size}')
                self.end_headers()
                return
            status = 206
        self.send_response(status)
        self.send_header('Content-Type', mimetypes.guess_type(file)[0] or 'application/octet-stream')
        self.send_header('Content-Length', str(max(0, end - start + 1)))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Cache-Control', 'no-cache')
        if status == 206:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.end_headers()
        if self.command == 'HEAD':
            return
        with file.open('rb') as stream:
            stream.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                data = stream.read(min(65536, remaining))
                if not data:
                    break
                self.wfile.write(data)
                remaining -= len(data)

    def convert(self, file, route, query):
        media = self.server.media
        if not media.ffmpeg:
            self.send_error(503, 'FFmpeg is not installed')
            return
        args = [media.ffmpeg, '-nostdin', '-v', 'error']
        if route == 's':
            position = max(0, min(float(query.get('t', ['0'])[0]), 1e9))
            args += ['-ss', str(position)]
        args += ['-i', str(file)]
        if route == 'v':
            if 'i' in query:
                args += ['-map', f"0:{int(query['i'][0])}"]
            args += ['-f', 'webvtt', '-']
            mime = 'text/vtt'
        elif route == 'c':
            args += ['-map', f"0:{media.probe(file)['coverIndex']}", '-frames:v', '1', '-c:v', 'png', '-f', 'image2pipe', '-']
            mime = 'image/png'
        else:
            info = media.probe(file)
            if info and info['hasVideo']:
                args += ['-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p']
            else:
                args += ['-map', '0:a:0', '-vn']
            args += ['-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-sn', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '500000', '-']
            mime = 'video/mp4' if info and info['hasVideo'] else 'audio/mp4'
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.end_headers()
        if self.command == 'HEAD':
            return
        proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        with media.lock:
            media.processes.add(proc)
        try:
            while data := proc.stdout.read(65536):
                self.wfile.write(data)
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.wait()
            proc.stdout.close()
            with media.lock:
                media.processes.discard(proc)
