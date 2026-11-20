// 3.2.0 (Linux): fullscreen video and visualizer fill the screen. On X11 Electron makes every window it creates with
// a parent a dialog, and GNOME (Mutter) never lets a dialog go fullscreen: the visualizer's fullscreen only filled
// its own small window. The video window is now a normal window with the player as its parent. Checks, under xvfb
// with tests/fake-wm.py (a tiny window manager with Mutter's rule: fullscreen only for normal, resizable windows):
//   - the video window is _NET_WM_WINDOW_TYPE_NORMAL, transient for the player; the other panels are still dialogs
//   - it asks to be kept out of the dock / Alt+Tab / Overview (_NET_WM_STATE_SKIP_TASKBAR, _SKIP_PAGER: x11.js)
//   - fullscreen fills the screen from the visualizer's double-click, its ⤢ button and the F key, and comes back to
//     the same place and size each time; a dialog panel is still refused (the rule is in force)
// Run (Linux, xvfb): SLOPAMP_ELECTRON=… xvfb-run -a node tests/linux-fullscreen-320.js
'use strict';
const path = require('path'), os = require('os');
const { spawn, execFileSync } = require('child_process');
const { launch, sleep } = require('./lib');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const H = path.join(os.tmpdir(), 'slopamp-test-fullscreen-320');
const xprop = (xid, p) => { try { return execFileSync('xprop', ['-id', String(xid), p], { encoding: 'utf8' }).replace(/^[^=]*=\s*/, '').trim(); } catch (_) { return ''; } };
const until = async (fn, ms = 4000) => { const t0 = Date.now(); let v; while (!(v = await fn()) && Date.now() - t0 < ms) await sleep(100); return v; };

(async () => {
  try { execFileSync('xprop', ['-version'], { stdio: 'ignore' }); } catch (_) { console.log('xprop (x11-utils) is needed'); process.exit(2); }
  const wmLog = [];
  const wm = spawn('python3', [path.join(__dirname, 'fake-wm.py')], { stdio: ['ignore', 'pipe', 'inherit'] });
  wm.stdout.on('data', (d) => wmLog.push(...String(d).split('\n').filter(Boolean)));
  if (!(await until(() => wmLog.includes('ready')))) { console.log('fake-wm.py did not start'); process.exit(2); }

  const { app, win, errs } = await launch(H);
  const ev = (fn, arg) => win.evaluate(fn, arg);
  const wins = await app.evaluate(({ BrowserWindow, screen }) => ({
    screen: screen.getPrimaryDisplay().bounds,
    list: BrowserWindow.getAllWindows().map(w => ({ id: (w.webContents.getURL().match(/[?&]w=(\w+)/) || [, 'main'])[1], xid: w.getNativeWindowHandle().readUInt32LE(0) })),
  }));
  const X = Object.fromEntries(wins.list.map(w => [w.id, w.xid]));
  const hex = (n) => `0x${n.toString(16)}`;
  ok(/_NET_WM_WINDOW_TYPE_NORMAL/.test(xprop(X.video, '_NET_WM_WINDOW_TYPE')), `the video window is a normal window (${xprop(X.video, '_NET_WM_WINDOW_TYPE')})`);
  ok(xprop(X.video, 'WM_TRANSIENT_FOR').endsWith(hex(X.main)), `… transient for the player (${xprop(X.video, 'WM_TRANSIENT_FOR')})`);
  ok(/_DIALOG/.test(xprop(X.playlist, '_NET_WM_WINDOW_TYPE')), 'the playlist window is still a dialog');

  await ev(() => { if (!WM.isShown('video')) WM.setPanels({ video: { visible: true } }); });   // the video window (visualizer)
  const skip = await until(() => { const s = xprop(X.video, '_NET_WM_STATE'); return /SKIP_TASKBAR/.test(s) && /SKIP_PAGER/.test(s) && s; });
  ok(!!skip, `kept out of the dock and Alt+Tab: _NET_WM_STATE = ${skip || xprop(X.video, '_NET_WM_STATE') || '(none)'}`);

  const bounds = () => app.evaluate(({ BrowserWindow }) => { const v = BrowserWindow.getAllWindows().find(x => /w=video/.test(x.webContents.getURL())); return { ...v.getBounds(), fs: v.isFullScreen() }; });
  const full = (b) => b.x === wins.screen.x && b.y === wins.screen.y && b.width === wins.screen.width && b.height === wins.screen.height;
  const before = await bounds();
  const ways = [
    ['double-click on the visualizer', () => ev(() => { const c = WM.$('#mdCanvas'); c.dispatchEvent(new c.ownerDocument.defaultView.MouseEvent('dblclick', { bubbles: true })); })],
    ['its ⤢ button', () => ev(() => WM.$('#mdFs').click())],
    ['the F key', () => ev(() => { const d = WM.doc('video'); d.dispatchEvent(new d.defaultView.KeyboardEvent('keydown', { key: 'f', bubbles: true })); })],
  ];
  await ev(() => setVisMode('milkdrop'));      // BUTTERCHURN
  for (const [how, go] of ways) {
    await go();
    const b = await until(async () => { const x = await bounds(); return full(x) && x; });
    const st = xprop(X.video, '_NET_WM_STATE');
    ok(!!b && /FULLSCREEN/.test(st) && await ev(() => WM.body.contains('fs')), `fullscreen from ${how}: ${JSON.stringify(b || await bounds())} (${st})`);
    await ev(() => toggleFullscreen(false));
    const back = await until(async () => { const x = await bounds(); return !x.fs && x.width === before.width && x.height === before.height && x.x === before.x && x.y === before.y && x; });
    ok(!!back, `… and back to ${before.width}x${before.height} at ${before.x},${before.y} (${JSON.stringify(back || await bounds())})`);
  }
  const asked = wmLog.filter(l => l.startsWith('{')).map(l => JSON.parse(l)).filter(e => e.window === X.video && e.on);
  ok(asked.length === 3 && asked.every(e => e.allowed), `the window manager allowed each fullscreen (${asked.length}× asked)`);

  // the rule is in force: a dialog panel asking for fullscreen is refused (as GNOME does)
  const pl = (on) => app.evaluate(({ BrowserWindow }, v) => {
    const p = BrowserWindow.getAllWindows().find(x => /w=playlist/.test(x.webContents.getURL()));
    if (v) { p.setFullScreenable(true); p.setResizable(true); p.setFullScreen(true); } else { p.setFullScreen(false); p.setResizable(false); p.setFullScreenable(false); }
    return p.getBounds();
  }, on);
  await pl(true); await sleep(800);
  const refused = wmLog.filter(l => l.startsWith('{')).map(l => JSON.parse(l)).find(e => e.window === X.playlist && e.on);
  const plB = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(x => /w=playlist/.test(x.webContents.getURL())).getBounds());
  ok(refused && !refused.allowed && refused.why === 'dialog' && !full(plB), `a dialog panel is refused fullscreen (${JSON.stringify(refused)}, ${plB.width}x${plB.height})`);
  await pl(false); await sleep(300);

  ok(!errs.length, `no errors in the windows ${JSON.stringify(errs.slice(0, 3))}`);
  await app.close();
  wm.kill();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL OK');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
