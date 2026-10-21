"""Persistent library and playlist operations, independent of Cocoa."""
import json
import os
import re
import threading
from pathlib import Path
from urllib.parse import unquote, urlsplit
from .media import MEDIA, VIDEO


def atomic_write(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    with temporary.open('w', encoding='utf-8') as stream:
        stream.write(text)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def safe_name(name):
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', ' ', name or 'Playlist').strip()[:80] or 'Playlist'


def playlist_text(items):
    lines = ['#EXTM3U']
    for item in items:
        location = item.get('path') if item.get('type') == 'file' else item.get('url')
        if not location or '\n' in location or '\r' in location:
            continue
        title = re.sub(r'[\r\n]+', ' ', item.get('title', ''))
        lines += [f"#EXTINF:{round(item.get('duration') or 0) or -1},{title}", location]
    return '\n'.join(lines) + '\n'


class Backend:
    def __init__(self, media, data_dir=None, download_dir=None):
        self.media = media
        self.data_dir = Path(data_dir or Path.home() / 'Library/Application Support/SlopAMP')
        self.download_dir = Path(download_dir or Path.home() / 'Downloads/SlopAMP')
        self.state_file = self.data_dir / 'slopamp-state.json'
        self.lock = threading.RLock()
        self.state = {}
        if self.state_file.exists():
            try:
                self.state = json.loads(self.state_file.read_text())
                if not isinstance(self.state, dict):
                    raise ValueError('State must be an object')
            except (ValueError, OSError) as exc:
                raise RuntimeError(f'Cannot read {self.state_file}; it has been preserved: {exc}') from exc

    def save(self, patch):
        with self.lock:
            self.state.update({k: v for k, v in patch.items() if k != 'flush'})
            atomic_write(self.state_file, json.dumps(self.state, ensure_ascii=False))

    def dirs(self):
        return {kind: str(Path(self.state.get('dl' + kind.title() + 'Dir') or self.download_dir / kind.title())) for kind in ('audio', 'video')}

    def playlists_dir(self):
        path = self.download_dir / 'Playlists'
        path.mkdir(parents=True, exist_ok=True)
        return path

    def describe(self, paths, seen=None):
        seen = seen if seen is not None else set()
        result = []
        for value in paths:
            if value.startswith(('https://', 'http://')):
                result.append(dict(url=value))
                continue
            path = Path(value).expanduser().resolve()
            if path in seen:
                continue
            if path.is_dir():
                seen.add(path)
                result += self.describe([str(p) for p in sorted(path.iterdir()) if not p.name.startswith('.')], seen)
                seen.remove(path)
            elif path.suffix.lower() in {'.m3u', '.m3u8', '.pls'} and path.exists():
                seen.add(path)
                result += self.read_playlist(path, seen)['entries']
                seen.remove(path)
            elif path.suffix.lower().lstrip('.') in MEDIA:
                info = self.media.probe(path) if path.is_file() else None
                result.append(dict(path=str(path), title=(info or {}).get('title') or path.stem, duration=(info or {}).get('duration', 0), hasVideo=(info or {}).get('hasVideo', path.suffix[1:].lower() in VIDEO), missing=not path.is_file()))
        return result

    def read_playlist(self, path, seen=None):
        path = Path(path)
        text = path.read_text(encoding='utf-8-sig')
        rows = []
        if path.suffix.lower() == '.pls':
            entries = {}
            for line in text.splitlines():
                match = re.match(r'(File|Title|Length)(\d+)=(.*)', line, re.I)
                if match:
                    entries.setdefault(int(match[2]), {})[match[1].lower()] = match[3]
            rows = [(e.get('file', ''), e.get('title', ''), e.get('length', '0')) for _, e in sorted(entries.items())]
        else:
            title, duration = '', '0'
            for line in text.splitlines():
                line = line.strip()
                if line.startswith('#EXTINF:'):
                    title = line.partition(',')[2]
                    duration = line.partition(':')[2].partition(',')[0]
                elif line and not line.startswith('#'):
                    rows.append((line, title, duration))
                    title, duration = '', '0'
        result = []
        for location, title, duration in rows:
            if not location:
                continue
            parsed = urlsplit(location)
            if parsed.scheme == 'file':
                location = unquote(parsed.path)
            elif parsed.scheme and parsed.scheme not in {'http', 'https'}:
                continue
            if not location.startswith(('http://', 'https://')):
                location = str((path.parent / location).resolve())
            entries = self.describe([location], seen)
            if title and len(entries) == 1:
                entries[0]['title'] = title
            if len(entries) == 1 and not entries[0].get('duration'):
                try:
                    entries[0]['duration'] = max(0, float(duration))
                except ValueError:
                    pass
            result += entries
        return dict(name=path.name, entries=result)

    def quick_save(self, items, name, destination=None):
        if not items:
            return dict(saved=False, error='empty')
        path = Path(destination) if destination else self.playlists_dir() / (safe_name(name) + '.m3u8')
        atomic_write(path, playlist_text(items))
        return dict(saved=True, name=path.name, path=str(path))

    def quick_save_all(self, tabs):
        used, result = set(), []
        for tab in tabs:
            if not tab.get('items'):
                continue
            base = safe_name(tab.get('name'))
            name, number = base, 2
            while name.casefold() in used:
                name, number = f'{base} ({number})', number + 1
            used.add(name.casefold())
            saved = self.quick_save(tab['items'], name)
            result.append(dict(name=saved['name'], ok=True))
        return result

    def playlists(self):
        return [dict(kind='playlist', path=str(p), title=p.stem, ext=p.suffix[1:].upper(), count=len(self.read_playlist(p)['entries']), size=p.stat().st_size, mtime=p.stat().st_mtime * 1000) for p in sorted(self.playlists_dir().iterdir()) if p.suffix.lower() in {'.m3u', '.m3u8', '.pls'} and p.is_file()]

    def remember(self, vid, kind, file, title=''):
        if not re.fullmatch(r'[\w-]{11}', vid or '') or kind not in {'audio', 'video'}:
            return
        with self.lock:
            index = self.state.setdefault('downloads', {})
            index.setdefault(vid, {}).update({kind: file, 'title': title})
            self.save(dict(downloads=index))

    def forget(self, vid, kind=None):
        with self.lock:
            index = self.state.setdefault('downloads', {})
            if kind:
                index.get(vid, {}).pop(kind, None)
            else:
                index.pop(vid, None)
            self.save(dict(downloads=index))

    def downloads(self):
        with self.lock:
            index = self.state.setdefault('downloads', {})
            for kind, directory in self.dirs().items():
                path = Path(directory)
                if not path.is_dir():
                    continue
                for p in path.iterdir():
                    match = re.search(r'\[([\w-]{11})\]$', p.stem)
                    if match and p.suffix[1:].lower() in MEDIA and p.is_file():
                        index.setdefault(match[1], {}).update({kind: str(p)})
            rows = []
            for vid, entry in index.items():
                for kind in ('audio', 'video'):
                    if not entry.get(kind):
                        continue
                    p = Path(entry[kind])
                    stat = p.stat() if p.is_file() else None
                    rows.append(dict(vid=vid, kind=kind, path=str(p), title=entry.get('title') or p.stem, size=stat.st_size if stat else 0, mtime=stat.st_mtime * 1000 if stat else 0, missing=not stat))
            return rows
