// macOS: what the Mac version does differently from Windows and Linux. The first part is plain Node and runs anywhere;
// the second starts SlopAMP and needs a Mac (it shows SlopAMP's windows on the desktop for half a minute: there is no
// xvfb there; nothing is clicked or typed outside them).
//   - the updater: a Mac looks for SlopAMP-X.Y.Z-mac-<arm64|x64>.dmg (+ its SHA256 line), skips a release without a
//     .dmg quietly and never installs by itself; Windows and Linux look for what they did before
//   - media.js: VideoToolbox's arguments; downloader.js: yt-dlp's whole process group ends (no /proc on macOS)
//   - the app: the menu bar (SlopAMP / Edit / Window), the encoder (VideoToolbox, else OpenH264), About's macOS line,
//     the panels are plain windows (no parent, no shadow) that stay where they are when the player is moved by the
//     system, Mac words (⌘V, Trash, Show in Finder, the menu bar; Ctrl+Tab stays) with nothing of Windows' left,
//     ⌘ working as Ctrl (⌘M mini mode, ⌘, Settings, ⌘-click adds to the selection, ⌘A), a file opened from the Finder
//     (open-file) added and played, a song (direct) and an MPEG-2 .mkv (converted on the fly) both playing,
//     minimize and restore taking the panels along, the menu bar ("tray") and back, the Dock icon bringing it back,
//     fullscreen and back
// Run (macOS): SLOPAMP_ELECTRON=vendor/mac-tools/electron-darwin-arm64/Electron.app/Contents/MacOS/Electron node tests/mac.js
'use strict';
const path = require('path'), os = require('os'), fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 6000) => { const t0 = Date.now(); let v; while (!(v = await fn()) && Date.now() - t0 < ms) await sleep(100); return v; };
const APP = path.join(__dirname, '..');
const done = () => { console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL OK'); process.exit(fails.length ? 1 : 0); };

(async () => {
  // ---------- plain Node
  const { parseRelease } = require(path.join(APP, 'src/updater.js'));
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64', dmg = `SlopAMP-9.9.9-mac-${arch}.dmg`, hash = 'a'.repeat(64);
  const asset = (name) => ({ name, size: 1, browser_download_url: `https://github.com/SlopAMP/SlopAMP/releases/download/v9.9.9/${name}` });
  const rel = (names, body = '') => ({ tag_name: 'v9.9.9', body, html_url: 'https://github.com/SlopAMP/SlopAMP/releases/tag/v9.9.9', assets: names.map(asset) });
  const all = ['SlopAMP-Setup-9.9.9.exe', 'SlopAMP-9.9.9-x86_64.AppImage', 'SlopAMP-9.9.9-mac-arm64.dmg', 'SlopAMP-9.9.9-mac-x64.dmg'];
  const body = `notes\nSHA256 (SlopAMP-Setup-9.9.9.exe): ${hash}\nSHA256 (SlopAMP-9.9.9-x86_64.AppImage): ${hash}\nSHA256 (SlopAMP-9.9.9-mac-arm64.dmg): ${hash}\nSHA256 (SlopAMP-9.9.9-mac-x64.dmg): ${hash}`;
  const m = parseRelease(rel(all, body), '3.2.2', null, 'darwin');
  ok(!m.error && m.file === dmg && m.newer && m.sha256 === hash, `updater: a Mac takes ${dmg} from a release (${m.error || m.file})`);
  ok(parseRelease(rel(all.slice(0, 2), body), '3.2.2', null, 'darwin').error === 'noplatform', 'updater: a release without a .dmg is not for the Mac (skipped quietly)');
  ok(parseRelease(rel(all, 'notes'), '3.2.2', null, 'darwin').error === 'nohash', 'updater: a .dmg without its SHA256 line is refused');
  ok(parseRelease(rel(all, body), '3.2.2', null, 'win32').file === 'SlopAMP-Setup-9.9.9.exe' && parseRelease(rel(all, body), '3.2.2', null, 'linux').file === 'SlopAMP-9.9.9-x86_64.AppImage', 'updater: Windows and Linux take their own files, as before');
  ok(parseRelease(rel(all.slice(2), body), '3.2.2', null, 'win32').error === 'noplatform' && parseRelease(rel(all.slice(2), body), '3.2.2', null, 'linux').error === 'noplatform', 'updater: a Mac-only release is skipped quietly on Windows and Linux');
  const { encoderArgs } = require(path.join(APP, 'src/media.js'));
  const va = encoderArgs('h264_videotoolbox');
  ok(va[0] === '-c:v' && va[1] === 'h264_videotoolbox' && va.includes('yuv420p'), `media.js: VideoToolbox's arguments (${va.join(' ')})`);
  if (process.platform !== 'win32') {
    const { killTree } = require(path.join(APP, 'src/downloader.js'));
    const p = spawn('/bin/sh', ['-c', 'sleep 60 & sleep 60 & wait'], { detached: true, stdio: 'ignore' });
    await sleep(300);
    const alive = () => { try { process.kill(-p.pid, 0); return true; } catch (_) { return false; } };
    const was = alive(); killTree(p, true);
    ok(was && !(await until(async () => !alive(), 3000) ? alive() : true), 'downloader.js: ending a download ends its whole process group (the program and what it started)');
  }
  if (process.platform !== 'darwin') { console.log('(not a Mac: the app checks are skipped)'); return done(); }

  // ---------- the app
  const { launch, docWin } = require('./lib');
  const H = path.join(os.tmpdir(), 'slopamp-test-mac');
  const ff = [path.join(APP, 'vendor/ffmpeg/darwin/ffmpeg'), 'ffmpeg'].find(f => { try { execFileSync(f, ['-version'], { stdio: 'ignore' }); return true; } catch (_) { return false; } });
  if (!ff) { console.log('FFmpeg is needed (bash build/fetch-mac-tools.sh)'); process.exit(2); }
  const M = path.join(os.tmpdir(), 'slopamp-test-mac-media'); fs.rmSync(M, { recursive: true, force: true }); fs.mkdirSync(M, { recursive: true });
  const song = (n, hz) => { const f = path.join(M, `Song ${n}.mp3`); execFileSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=20`, '-c:a', 'libmp3lame', '-b:a', '128k', f]); return f; };
  const songs = [song(1, 220), song(2, 330), song(3, 440)];
  const mkv = path.join(M, 'Old Format.mkv');      // MPEG-2 + MP2: Chromium can't play it, so SlopAMP converts it as it plays
  execFileSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=20', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=20', '-c:v', 'mpeg2video', '-b:v', '2M', '-c:a', 'mp2', '-shortest', mkv]);

  const { app, win, errs } = await launch(H);
  const ev = (fn, arg) => win.evaluate(fn, arg);
  const main = (fn, arg) => app.evaluate(fn, arg);
  const bounds = () => main(() => Object.fromEntries([...global.__slopamp.wm.wins].map(([id, w]) => [id, { ...w.getBounds(), vis: w.isVisible(), min: w.isMinimized(), fs: w.isFullScreen(), parent: !!w.getParentWindow(), shadow: w.hasShadow() }])));
  await ev(() => { S.showVideo = true; S.showPlaylist = true; renderToggles(); });
  await sleep(1500);

  const menu = await main(({ Menu }) => { const mm = Menu.getApplicationMenu(); return mm ? mm.items.map(i => `${i.label}: ${i.submenu.items.map(x => x.label || x.role || '-').join(' | ')}`) : null; });
  ok(!!menu && menu.length === 3 && /^SlopAMP: About SlopAMP.*Settings….*Quit SlopAMP$/.test(menu[0]) && /Cut \| Copy \| Paste \| Select All/.test(menu[1]), `the menu bar: ${JSON.stringify(menu)}`);
  const enc = await until(() => main(() => global.__slopamp.server.encoder), 20000);
  ok(['h264_videotoolbox', 'libopenh264'].includes(enc), `the video converter is VideoToolbox, or OpenH264 where VideoToolbox can't (${enc})`);
  const info = await ev(() => window.phosphor.info());
  ok(info.platform === 'darwin' && info.mac && info.mac.kind === 'dev' && info.mac.arch === process.arch && info.hasFfmpeg, `About's info: ${JSON.stringify(info.mac)}, FFmpeg ${info.hasFfmpeg ? 'found' : 'MISSING'}`);
  const upd = await ev(() => window.phosphor.updGet ? window.phosphor.updGet() : null).catch(() => null);
  if (upd) ok(upd.canInstall === false && upd.platform === 'darwin', `the updater never installs by itself on a Mac (canInstall ${upd.canInstall}, ${upd.platform})`);

  let b = await bounds();
  const panels = ['eq', 'video', 'playlist'];
  ok(panels.every(id => !b[id].parent && !b[id].shadow) && !b.main.shadow && b.popup.parent && b.dialog.parent, 'the panels are plain windows without a shadow; the menu and dialog windows belong to the player');
  ok(b.video.vis && b.playlist.vis && b.main.vis, 'the player, the video window and the playlist are open');
  // the system moving the player (not SlopAMP's own drag) must not carry the panels along
  await main(() => { const w = global.__slopamp.wm.wins.get('main'), r = w.getBounds(); w.setPosition(r.x + 60, r.y + 30); });
  await sleep(600);
  let b2 = await bounds();
  ok(b2.main.x === b.main.x + 60 && panels.every(id => b2[id].x === b[id].x && b2[id].y === b[id].y), `the player moved by the system: the panels stay where they are (playlist ${b.playlist.x},${b.playlist.y} -> ${b2.playlist.x},${b2.playlist.y})`);
  await main(() => global.__slopamp.wm.preset('reset')); await sleep(800);

  const text = await ev(() => WM.docs.map(d => d.body.innerText + ' ' + [...d.querySelectorAll('[title]')].map(e => e.title).join(' ')).join('\n'));
  ok(/⌘V/.test(text) && !/Ctrl\+(?!Tab)/.test(text), `shortcuts are shown with ⌘ (${(text.match(/Ctrl\+(?!Tab)\S*/g) || []).slice(0, 5).join(' ') || 'no Ctrl+ left'})`);
  const every = await ev(() => WM.docs.map(d => d.body.textContent).join('\n')), trayRow = await ev(() => $('#sysTray').closest('.set-row').textContent);
  ok(!/Recycle Bin|Show in Explorer|Downloads\\/.test(every) && /Minimize to the menu bar/.test(trayRow) && /in the Dock/.test(trayRow) && !/tray/.test(trayRow), `Mac words: no Recycle Bin, Explorer or backslash paths; Settings: "${trayRow.trim().slice(0, 60)}…"`);

  // ⌘ is Ctrl
  await win.bringToFront(); await win.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await win.keyboard.press('Meta+m');
  ok(!!(await until(() => ev(() => WM.body.contains('mini')), 3000)), '⌘M: mini mode');
  await win.keyboard.press('Meta+m');
  ok(!!(await until(() => ev(() => !WM.body.contains('mini')), 3000)), '⌘M again: the full player');
  await sleep(500);

  // a file opened from the Finder; then the rest of the folder
  await main(({ app }, f) => app.emit('open-file', { preventDefault() {} }, f), songs[0]);
  ok(!!(await until(() => ev(() => S.items.length === 1 && __phosphor.status === 'playing'), 8000)), 'a song opened from the Finder (open-file) is added and plays');
  const t0 = await ev(() => __phosphor.currentTime()); await sleep(1500);
  const t1 = await ev(() => __phosphor.currentTime());
  ok(t1 > t0 + 0.8, `the song is really playing (${t0.toFixed(2)} s -> ${t1.toFixed(2)} s)`);
  await ev((list) => __phosphor.addPaths(list), [songs[1], songs[2], mkv]);
  ok(!!(await until(() => ev(() => S.items.length === 4), 8000)), 'three more files added (4 items)');
  const pl = await docWin(app, 'win-playlist') || win;
  const rows = pl.locator('#list li');
  await rows.nth(0).click(); await rows.nth(2).click({ modifiers: ['Meta'] });
  ok((await ev(() => S.sel.size)) === 2, `⌘-click adds to the selection (${await ev(() => S.sel.size)} selected)`);
  await rows.nth(1).click(); await pl.keyboard.press('Meta+a');
  ok((await ev(() => S.sel.size)) === 4, `⌘A selects everything (${await ev(() => S.sel.size)} of 4)`);

  // the .mkv: converted on the fly by the encoder found at startup
  await ev(() => __phosphor.playIndex(3));
  const playing = await until(() => ev(() => __phosphor.status === 'playing' && __phosphor.currentTime() > 1.5), 20000);
  const log = fs.readFileSync(path.join(H, require('./lib').PROFILE, 'slopamp.log'), 'utf8');
  ok(!!playing && new RegExp(`ffmpeg .*Old Format\\.mkv.*-c:v ${enc}`).test(log), `an MPEG-2 .mkv plays, converted with ${enc} as it goes (${(await ev(() => __phosphor.currentTime())).toFixed(2)} s in)`);
  await ev(() => __phosphor.stop());

  // minimize and restore: the panels go and come back with the player
  for (const round of [1, 2]) {
    await main(() => global.__slopamp.wm.wins.get('main').minimize());
    const hid = await until(async () => { const x = await bounds(); return x.main.min && !x.video.vis && !x.playlist.vis; });
    await main(() => global.__slopamp.wm.wins.get('main').restore());
    const back = await until(async () => { const x = await bounds(); return !x.main.min && x.main.vis && x.video.vis && x.playlist.vis; });
    ok(!!hid && !!back, `round ${round}: minimizing the player takes the video window and the playlist along; restoring brings them back`);
    await sleep(700);
  }
  // the menu bar ("tray"), back from its menu and from the Dock
  for (const how of ['fromTray', 'activate']) {
    await main(() => global.__slopamp.sys.toTray());
    const inTray = await until(async () => { const x = await bounds(); return (await main(() => global.__slopamp.sys.inTray && !!global.__slopamp.sys.tray)) && !x.main.vis && !x.video.vis && !x.playlist.vis; });
    if (how === 'fromTray') await main(() => global.__slopamp.sys.fromTray()); else await main(({ app }) => app.emit('activate'));
    const back = await until(async () => { const x = await bounds(); return (await main(() => !global.__slopamp.sys.inTray && !global.__slopamp.sys.tray)) && x.main.vis && x.video.vis && x.playlist.vis; });
    ok(!!inTray && !!back, `in the menu bar every window is hidden; ${how === 'fromTray' ? 'Show SlopAMP' : 'a click on the Dock icon'} brings them back`);
  }
  // fullscreen (a Space of its own) and back to where the video window was
  b = await bounds();
  await main(() => global.__slopamp.wm.setFullscreen(true));
  const full = await until(async () => (await bounds()).video.fs, 8000);
  await sleep(1200);
  await main(() => global.__slopamp.wm.setFullscreen(false));
  const unfull = await until(async () => { const x = await bounds(); return !x.video.fs && x.video.width === b.video.width && x.video.x === b.video.x && x.video.y === b.video.y; }, 8000);
  ok(!!full && !!unfull, `the video window goes fullscreen and comes back to its place (${JSON.stringify((await bounds()).video)})`);

  ok(!errs.length, `no errors in the windows ${JSON.stringify(errs.slice(0, 3))}`);
  await app.close();
  done();
})().catch((e) => { console.error(e); process.exit(2); });
