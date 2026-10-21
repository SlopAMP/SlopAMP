"""Launch the real Cocoa/WebKit host and verify decoded playback and seeking."""
import argparse
import json
import math
import os
import signal
import struct
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'macos'))
import AppKit
from PyObjCTools import AppHelper
from slopamp.app import AppDelegate
from slopamp.media import tool


class Smoke:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(prefix='slopamp-smoke-')
        root = Path(self.temp.name)
        self.audio = root / 'tone.wav'
        self.video = root / 'conversion.mkv'
        with wave.open(str(self.audio), 'wb') as output:
            output.setparams((1, 2, 44100, 0, 'NONE', 'not compressed'))
            output.writeframes(b''.join(struct.pack('<h', int(1200 * math.sin(2 * math.pi * 440 * n / 44100))) for n in range(44100 * 12)))
        subprocess.run([tool('ffmpeg'), '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-i', str(self.audio), '-t', '12', '-c:v', 'mpeg4', '-c:a', 'pcm_s16le', str(self.video)], check=True)
        self.video.with_suffix('.en.srt').write_text('1\n00:00:00,000 --> 00:00:10,000\nSlopAMP subtitle test\n')
        self.delegate = AppDelegate.alloc().init()
        self.delegate.configure(ROOT, [], root / 'state', root / 'downloads')
        self.app = AppKit.NSApplication.sharedApplication()
        self.app.setDelegate_(self.delegate)
        self.phase = 0
        self.error = None
        self.last_report = 0
        self.finished = False

    def check(self):
        if self.finished:
            return
        script = "JSON.stringify({boot:!!window.__phosphor, time:window.__phosphor?.currentTime(), mediaTime:document.querySelector('video')?.currentTime, paused:document.querySelector('video')?.paused, ready:document.querySelector('video')?.readyState, status:window.__phosphor?.status, error:document.querySelector('video')?.error?.message, audio:window.__phosphor?.__audio()?.actx?.state, visualizer:!!window.__phosphor?.__md(), converted:window.__phosphor?.L?.prep?.converted, width:document.querySelector('video')?.videoWidth, cues:window.__phosphor?.subsState()?.cues?.length})"
        self.delegate.web.evaluateJavaScript_completionHandler_(script, self.result)

    def result(self, value, error):
        if self.finished:
            return
        if error:
            self.finish(str(error)); return
        status = json.loads(value)
        if time.monotonic() - self.last_report > 5:
            print(f'Playback check phase {self.phase}: {status}', flush=True)
            self.last_report = time.monotonic()
        if status.get('error'):
            self.finish(status['error']); return
        if status['boot'] and self.phase == 0:
            self.phase = 1
            script = f"window.__phosphor.S.vis.cycle=false; window.__phosphor.S.vis.preset='martin - timeless'; window.__phosphor.addPaths([{json.dumps(str(self.audio))}]).then(()=>window.__phosphor.playIndex(0)); void 0"
            self.delegate.web.evaluateJavaScript_completionHandler_(script, None)
        elif self.phase == 1 and status.get('time', 0) > 0.5:
            self.phase = 2
            self.delegate.web.evaluateJavaScript_completionHandler_("window.__phosphor.seekTo(6); void 0", None)
        elif self.phase == 2 and status.get('time', 0) >= 6:
            if status.get('audio') != 'running':
                self.finish(f'AudioContext is not running: {status}'); return
            if not status.get('visualizer'):
                self.finish('Butterchurn did not initialize'); return
            print('PASS: Cocoa launch, renderer boot, native bridge, WAV decode, Web Audio EQ, Butterchurn, playback clock and seek.', flush=True)
            self.phase = 3
            script = f"window.__phosphor.S.subsOn=true; window.__phosphor.addPaths([{json.dumps(str(self.video))}]).then(()=>window.__phosphor.playIndex(1)); void 0"
            self.delegate.web.evaluateJavaScript_completionHandler_(script, None)
        elif self.phase == 3 and status.get('width', 0) > 0 and status.get('converted') and status.get('time', 0) > 0.5:
            if not status.get('cues'):
                self.finish('External subtitles were not decoded'); return
            self.phase = 4
            self.delegate.web.evaluateJavaScript_completionHandler_("window.__phosphor.seekTo(5); void 0", None)
        elif self.phase == 4 and status.get('time', 0) > 5.5:
            print('PASS: MKV/MPEG-4 conversion to seekable MP4, decoded video frames, subtitles and transcoded seeking.', flush=True)
            self.phase = 5
            self.delegate.web.evaluateJavaScript_completionHandler_("saveNow(); window.phosphor.quickSave(window.__phosphor.S.items, 'Smoke playlist'); void 0", None)
            AppHelper.callLater(1, self.verify_state)
            return
        AppHelper.callLater(0.5, self.check)

    def verify_state(self):
        if self.finished:
            return
        try:
            state = json.loads(self.delegate.backend.state_file.read_text())
            assert len(state['tabs'][0]['items']) == 2, 'Playlist state did not persist'
            assert (self.delegate.backend.playlists_dir() / 'Smoke playlist.m3u8').is_file(), 'Native quick save failed'
        except Exception as exc:
            self.finish(str(exc)); return
        print('PASS: nested native bridge values, persistent state and M3U8 quick save.', flush=True)
        self.delegate.web.takeSnapshotWithConfiguration_completionHandler_(None, self.snapshot)

    def snapshot(self, image, error):
        if self.finished:
            return
        if error:
            self.finish(str(error)); return
        bitmap = AppKit.NSBitmapImageRep.imageRepWithData_(image.TIFFRepresentation())
        data = bitmap.representationUsingType_properties_(AppKit.NSBitmapImageFileTypePNG, {})
        path = ROOT / 'dist/macos-smoke.png'
        path.parent.mkdir(exist_ok=True)
        data.writeToFile_atomically_(str(path), True)
        print(f'WebKit screenshot: {path}', flush=True)
        self.finish(None)

    def finish(self, error):
        if self.finished:
            return
        self.finished = True
        self.error = error
        if error: print('FAIL:', error, file=sys.stderr, flush=True)
        try:
            self.delegate.downloader.stop()
            self.delegate.worker.shutdown(wait=False, cancel_futures=True)
            self.delegate.media.stop()
        except Exception as exc:
            self.error = self.error or str(exc)
            print('FAIL: Smoke cleanup:', exc, file=sys.stderr, flush=True)
        finally:
            self.app.stop_(None)
            # A timer/JavaScript callback is not an NSEvent. Wake run() so it sees stop().
            event = AppKit.NSEvent.otherEventWithType_location_modifierFlags_timestamp_windowNumber_context_subtype_data1_data2_(
                AppKit.NSEventTypeApplicationDefined, (0, 0), 0, 0, 0, None, 0, 0, 0
            )
            self.app.postEvent_atStart_(event, True)

    def run(self, timeout=60):
        # This deadline still fires if a WebKit completion handler never arrives.
        AppHelper.callLater(timeout, self.finish, 'Timed out waiting for real WebKit playback')
        AppHelper.callLater(2, self.check)
        try:
            self.app.run()
        finally:
            self.temp.cleanup()
        return 1 if self.error else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--timeout', type=float, default=60, help='Playback deadline in seconds (default: 60)')
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not math.isfinite(args.timeout) or args.timeout <= 0:
        parser.error('--timeout must be a positive finite number')
    if args.worker:
        return Smoke().run(args.timeout)
    # Bound startup, a wedged Cocoa run loop, and cleanup as well as WebKit callbacks.
    process = subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve()), '--worker', '--timeout', str(args.timeout)],
        start_new_session=True,
    )
    try:
        return process.wait(timeout=args.timeout + 30)
    except (subprocess.TimeoutExpired, KeyboardInterrupt) as exc:
        interrupted = isinstance(exc, KeyboardInterrupt)
        message = 'Smoke check interrupted' if interrupted else 'Smoke process exceeded its shutdown deadline'
        print('FAIL:', message, file=sys.stderr, flush=True)
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        finally:
            # Reap descendants even if the worker exited before its children.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
        return 130 if interrupted else 1


if __name__ == '__main__':
    sys.exit(main())
