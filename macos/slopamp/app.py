"""Cocoa lifecycle and privileged bridge for the shared SlopAMP renderer."""
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import urlopen

import objc
import AppKit as A
import Foundation as F
import WebKit as W
from PyObjCTools import AppHelper

from .backend import Backend, safe_name, directory_key, DIRECTORY_KEYS
from .downloads import Downloads
from .media import MediaServer, MEDIA


class PlayerView(W.WKWebView):
    def draggingEntered_(self, sender):
        if sender.draggingPasteboard().availableTypeFromArray_([A.NSPasteboardTypeFileURL]):
            return A.NSDragOperationCopy
        return objc.super(PlayerView, self).draggingEntered_(sender)

    def performDragOperation_(self, sender):
        urls = sender.draggingPasteboard().readObjectsForClasses_options_([F.NSURL], {A.NSPasteboardURLReadingFileURLsOnlyKey: True})
        if urls:
            paths = [str(url.path()) for url in urls]
            self.owner.backend.authorize_paths(paths)
            self.owner.emit('open-files', paths)
            return True
        return objc.super(PlayerView, self).performDragOperation_(sender)


class AppDelegate(F.NSObject):
    @objc.python_method
    def configure(self, root, files=None, data_dir=None, download_dir=None):
        self.root = Path(root)
        self.media = MediaServer(self.root / 'src/renderer')
        self.backend = Backend(self.media, data_dir, download_dir)
        self.worker = ThreadPoolExecutor(max_workers=4)
        self.downloader = Downloads(self.backend, lambda value: AppHelper.callAfter(self.emit, 'dl', value))
        self.pending = list(files or [])
        if self.pending:
            self.backend.authorize_paths(self.pending)
        self.ready = False
        self.closing = False
        self.version = json.loads((self.root / 'package.json').read_text())['version'] + '-mac'

    def applicationDidFinishLaunching_(self, notification):
        app = A.NSApplication.sharedApplication()
        app.setActivationPolicy_(A.NSApplicationActivationPolicyRegular)
        style = A.NSWindowStyleMaskTitled | A.NSWindowStyleMaskClosable | A.NSWindowStyleMaskMiniaturizable | A.NSWindowStyleMaskResizable
        self.window = A.NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(((0, 0), (960, 820)), style, A.NSBackingStoreBuffered, False)
        self.window.setTitle_('SlopAMP')
        self.window.setMinSize_((380, 300))
        self.window.setReleasedWhenClosed_(False)
        self.window.setDelegate_(self)
        self.window.setCollectionBehavior_(A.NSWindowCollectionBehaviorFullScreenPrimary)
        config = W.WKWebViewConfiguration.alloc().init()
        config.setMediaTypesRequiringUserActionForPlayback_(0)
        controller = config.userContentController()
        controller.addScriptMessageHandler_name_(self, 'slopamp')
        script = (Path(__file__).parent / 'bridge.js').read_text()
        controller.addUserScript_(W.WKUserScript.alloc().initWithSource_injectionTime_forMainFrameOnly_(script, W.WKUserScriptInjectionTimeAtDocumentStart, True))
        self.web = PlayerView.alloc().initWithFrame_configuration_(((0, 0), (960, 820)), config)
        self.web.owner = self
        self.web.setNavigationDelegate_(self)
        self.web.setUIDelegate_(self)
        self.web.setAutoresizingMask_(A.NSViewWidthSizable | A.NSViewHeightSizable)
        self.web.registerForDraggedTypes_([A.NSPasteboardTypeFileURL])
        self.window.setContentView_(self.web)
        self.make_menu()
        icon = A.NSImage.alloc().initWithContentsOfFile_(str(self.root / 'build/icon-512.png'))
        if not icon:
            icon = A.NSImage.alloc().initWithContentsOfFile_(str(self.root / 'icon-512.png'))
        if icon:
            app.setApplicationIconImage_(icon)
        self.window.center()
        self.window.makeKeyAndOrderFront_(None)
        app.activateIgnoringOtherApps_(True)
        self.web.loadRequest_(F.NSURLRequest.requestWithURL_(F.NSURL.URLWithString_(self.media.base + '/app/index.html')))

    @objc.python_method
    def make_menu(self):
        bar = A.NSMenu.alloc().init()
        for title, entries in [('SlopAMP', [('About SlopAMP', 'about:', ''), ('Quit SlopAMP', 'terminate:', 'q')]), ('File', [('Open…', 'openFiles:', 'o'), ('Open Folder…', 'openFolder:', '')]), ('Edit', [('Undo', 'undo:', 'z'), ('Cut', 'cut:', 'x'), ('Copy', 'copy:', 'c'), ('Paste', 'paste:', 'v'), ('Select All', 'selectAll:', 'a')]), ('Window', [('Minimize', 'performMiniaturize:', 'm'), ('Zoom', 'performZoom:', '')])]:
            parent = A.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(title, None, '')
            menu = A.NSMenu.alloc().initWithTitle_(title)
            for label, action, key in entries:
                item = A.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(label, action, key)
                if action in {'openFiles:', 'openFolder:', 'about:'}:
                    item.setTarget_(self)
                menu.addItem_(item)
            parent.setSubmenu_(menu)
            bar.addItem_(parent)
        A.NSApplication.sharedApplication().setMainMenu_(bar)

    def about_(self, sender):
        self.web.evaluateJavaScript_completionHandler_("document.querySelector('#btnAbout').click()", None)

    def openFiles_(self, sender):
        self.emit('open-files', self.choose_files())

    def openFolder_(self, sender):
        self.emit('open-files', self.choose_files(folder=True))

    def application_openFiles_(self, app, files):
        self.backend.authorize_paths(files)
        if self.ready:
            self.emit('open-files', list(files))
        else:
            self.pending.extend(files)
        app.replyToOpenOrPrint_(A.NSApplicationDelegateReplySuccess)

    def applicationShouldTerminateAfterLastWindowClosed_(self, app):
        return True

    def applicationShouldTerminate_(self, app):
        if self.closing:
            return A.NSTerminateNow
        self.closing = True
        self.web.evaluateJavaScript_completionHandler_("recordResume(); saveNow();", lambda value, error: app.replyToApplicationShouldTerminate_(True))
        return A.NSTerminateLater

    def windowShouldClose_(self, sender):
        A.NSApplication.sharedApplication().terminate_(None)
        return False

    def applicationWillTerminate_(self, notification):
        self.downloader.stop()
        self.worker.shutdown(wait=False, cancel_futures=True)
        self.media.stop()

    def windowDidEnterFullScreen_(self, notification):
        self.emit('fullscreen', True)

    def windowDidExitFullScreen_(self, notification):
        self.emit('fullscreen', False)

    def webView_decidePolicyForNavigationAction_decisionHandler_(self, web, action, handler):
        url = str(action.request().URL().absoluteString())
        frame = action.targetFrame()
        if frame is not None and not frame.isMainFrame():
            handler(W.WKNavigationActionPolicyAllow)
        elif url == self.media.base + '/app/index.html':
            handler(W.WKNavigationActionPolicyAllow)
        else:
            handler(W.WKNavigationActionPolicyCancel)
            if urlsplit(url).scheme in {'https', 'http'}:
                A.NSWorkspace.sharedWorkspace().openURL_(F.NSURL.URLWithString_(url))

    def userContentController_didReceiveScriptMessage_(self, controller, message):
        frame = message.frameInfo()
        origin = frame.securityOrigin()
        if not frame.isMainFrame() or str(origin.host()) != '127.0.0.1' or origin.port() != self.media.server.server_port or str(origin.protocol()) != 'http':
            return
        body = json.loads(str(message.body()))
        request_id, method, args = body['id'], str(body['method']), list(body['args'])
        if method == 'openDialog':
            args = [self.choose_files(folder=args[0] == 'folder')]
            method = 'describeFiles'
        elif method == 'loadPlaylist':
            paths = self.choose_files(extensions=['m3u8', 'm3u', 'pls'], multiple=False)
            if not paths:
                self.reply(request_id, dict(canceled=True))
                return
            method, args = 'plOpen', paths
        native = {'openDialog', 'savePlaylist', 'loadPlaylist', 'openSubDialog', 'dlChooseDir', 'dlOpenDir', 'openExternal', 'showInFolder', 'minimize', 'maximize', 'close', 'setFullscreen', 'restoreSize', 'setMini', 'trashFile', 'plDelete', 'dlmDelete', 'info', 'saveState'}
        if method in native:
            try:
                self.reply(request_id, self.dispatch(method, args))
            except Exception as exc:
                self.reply(request_id, None, str(exc))
        else:
            def work():
                try:
                    value = self.dispatch(method, args)
                    AppHelper.callAfter(self.reply, request_id, value)
                except Exception as exc:
                    AppHelper.callAfter(self.reply, request_id, None, str(exc))
            self.worker.submit(work)

    @objc.python_method
    def reply(self, request_id, value=None, error=None):
        self.web.evaluateJavaScript_completionHandler_(f'window.__nativeReply({json.dumps(request_id)}, {json.dumps(value)}, {json.dumps(error)})', None)

    @objc.python_method
    def emit(self, event, value):
        self.web.evaluateJavaScript_completionHandler_(f'window.__nativeEvent({json.dumps(event)}, {json.dumps(value)})', None)

    @objc.python_method
    def choose_files(self, folder=False, extensions=None, multiple=True, authorize=True):
        panel = A.NSOpenPanel.openPanel()
        panel.setCanChooseDirectories_(folder)
        panel.setCanChooseFiles_(not folder)
        panel.setAllowsMultipleSelection_(multiple)
        if extensions:
            panel.setAllowedFileTypes_(extensions)
        paths = [str(url.path()) for url in panel.URLs()] if panel.runModal() == A.NSModalResponseOK else []
        if paths and authorize:
            self.backend.authorize_paths(paths)
        return paths

    @objc.python_method
    def trash(self, path):
        success, _, error = F.NSFileManager.defaultManager().trashItemAtURL_resultingItemURL_error_(F.NSURL.fileURLWithPath_(str(path)), None, None)
        if not success:
            raise RuntimeError(str(error))
        return True

    @objc.python_method
    def dispatch(self, method, args):
        b = self.backend
        if method in {'dlChooseDir', 'dlOpenDir', 'dlResetDirs'}:
            if len(args) != 1 and not (method == 'dlResetDirs' and not args):
                raise ValueError('Expected one directory kind')
            if args:
                directory_key(args[0])
        if method == 'loadState':
            with b.lock:
                return json.loads(json.dumps(b.state))
        if method == 'saveState':
            b.save_renderer(args[0]); return None
        if method == 'describeFiles': return b.describe(args[0])
        if method == 'filesExist': return [Path(p).is_file() for p in args[0]]
        if method == 'prepare': return self.media.prepare(*args)
        if method == 'listSubs': return self.media.subtitles(args[0])
        if method == 'openDialog': return b.describe(self.choose_files(folder=args[0] == 'folder'))
        if method == 'openSubDialog':
            paths = self.choose_files(extensions=['srt', 'vtt', 'ass', 'ssa'], multiple=False, authorize=False)
            return self.media.sub_file(paths[0]) if paths else None
        if method == 'quickSave': return b.quick_save(args[0], args[1])
        if method == 'quickSaveAll': return b.quick_save_all(args[0])
        if method == 'savePlaylist':
            panel = A.NSSavePanel.savePanel()
            panel.setNameFieldStringValue_(safe_name(args[1]) + '.m3u8')
            panel.setAllowedFileTypes_(['m3u8', 'm3u'])
            if panel.runModal() == A.NSModalResponseOK:
                return b.quick_save(args[0], args[1], destination=str(panel.URL().path()))
            return dict(saved=False)
        if method == 'loadPlaylist':
            paths = self.choose_files(extensions=['m3u8', 'm3u', 'pls'], multiple=False)
            return b.read_playlist(paths[0]) if paths else dict(canceled=True)
        if method == 'plList': return b.playlists()
        if method == 'plOpen': return b.read_playlist(args[0])
        if method == 'plDelete':
            result = []
            for p in args[0]:
                if not b.is_playlist_file(p):
                    result.append(dict(path=p, ok=False, error='Not a SlopAMP playlist')); continue
                try:
                    self.trash(p)
                    result.append(dict(path=p, ok=True))
                except Exception as exc:
                    result.append(dict(path=p, ok=False, error=str(exc)))
            return result
        if method == 'trashFile':
            if not b.can_trash(args[0]):
                return dict(ok=False, error='Not a current playlist file or SlopAMP download.')
            if not Path(args[0]).is_file():
                return dict(ok=False, error='File not found.')
            try:
                return dict(ok=bool(self.trash(args[0])))
            except Exception as exc:
                return dict(ok=False, error=str(exc))
        if method == 'dlInfo': return dict(available=bool(self.media.ffmpeg), dirs=b.dirs())
        if method == 'dlStart': return self.downloader.start(args[0])
        if method == 'dlCancel': self.downloader.cancel(args[0]); return None
        if method == 'dlRemember': b.remember_existing(*args); return None
        if method == 'dlForget': b.forget(*args); return None
        if method == 'dlmList': return b.downloads()
        if method == 'dlLookup':
            found = {}
            for row in b.downloads():
                if row['vid'] in args[0] and not row['missing']:
                    found.setdefault(row['vid'], {})[row['kind']] = row['path']
            return found
        if method == 'dlmCleanMissing':
            missing = [r for r in b.downloads() if r['missing']]
            for row in missing: b.forget(row['vid'], row['kind'])
            return len(missing)
        if method == 'dlmDelete':
            known = {(r['vid'], r['kind'], r['path']) for r in b.downloads()}
            result = []
            for row in args[0]:
                try:
                    if (row['vid'], row['kind'], row['path']) not in known:
                        raise ValueError('Not a SlopAMP download')
                    if Path(row['path']).exists():
                        if b.media_path(row['path']) is None:
                            raise ValueError('Not a regular media download')
                        self.trash(row['path'])
                    b.forget(row['vid'], row['kind'])
                    result.append(dict(path=row['path'], ok=True))
                except Exception as exc:
                    result.append(dict(path=row['path'], ok=False, error=str(exc)))
            return result
        if method == 'dlChooseDir':
            key = directory_key(args[0])
            paths = self.choose_files(folder=True, multiple=False, authorize=False)
            if paths: b.save({key: paths[0]})
            return b.dirs()
        if method == 'dlResetDirs':
            keys = [directory_key(args[0])] if args else DIRECTORY_KEYS.values()
            b.save({key: None for key in keys})
            return b.dirs()
        if method == 'dlOpenDir':
            directory_key(args[0])
            path = b.playlists_dir() if args[0] == 'playlists' else Path(b.dirs()[args[0]])
            path.mkdir(parents=True, exist_ok=True)
            A.NSWorkspace.sharedWorkspace().openURL_(F.NSURL.fileURLWithPath_(str(path))); return None
        if method == 'webMeta':
            url = 'https://www.youtube.com/oembed?' + urlencode(dict(format='json', url=args[0]))
            try:
                with urlopen(url, timeout=15) as response: data = json.load(response)
                return dict(title=data.get('title', ''), author=data.get('author_name', ''), status=200)
            except OSError: return None
        if method == 'openExternal':
            if urlsplit(args[0]).scheme in {'https', 'http'}: A.NSWorkspace.sharedWorkspace().openURL_(F.NSURL.URLWithString_(args[0]))
            return None
        if method == 'showInFolder': A.NSWorkspace.sharedWorkspace().activateFileViewerSelectingURLs_([F.NSURL.fileURLWithPath_(args[0])]); return None
        if method == 'minimize': self.window.miniaturize_(None); return None
        if method == 'maximize': self.window.zoom_(None); return None
        if method == 'close': A.NSApplication.sharedApplication().terminate_(None); return None
        if method == 'setFullscreen':
            active = bool(self.window.styleMask() & A.NSWindowStyleMaskFullScreen)
            desired = not active if not args or args[0] is None else bool(args[0])
            if desired != active: self.window.toggleFullScreen_(None)
            return desired
        if method == 'restoreSize':
            if self.window.styleMask() & A.NSWindowStyleMaskFullScreen:
                self.window.toggleFullScreen_(None)
            self.window.setContentSize_((960, 820))
            return True
        if method == 'setMini':
            if args[0]:
                self.normal_frame = self.window.frame()
                self.window.setContentSize_((400, max(300, min(800, args[1]))))
            elif hasattr(self, 'normal_frame'): self.window.setFrame_display_(self.normal_frame, True)
            return args[0]
        if method == 'info':
            pending, self.pending = self.pending, []
            self.ready = True
            return dict(version=self.version, platform='darwin', encoder='libx264' if self.media.ffmpeg else None, hasFfmpeg=bool(self.media.ffmpeg), pendingOpen=pending)
        if method == 'updGet': return dict(status='idle', current=self.version, mode='off', canInstall=False, supported=False)
        if method.startswith('upd'):
            raise RuntimeError('Automatic updates are not available for the macOS development build.')
        raise ValueError(f'Unknown native operation: {method}')


def run(root, files=None, data_dir=None, download_dir=None):
    app = A.NSApplication.sharedApplication()
    delegate = AppDelegate.alloc().init()
    delegate.configure(root, files, data_dir, download_dir)
    app.setDelegate_(delegate)
    AppHelper.runEventLoop()
