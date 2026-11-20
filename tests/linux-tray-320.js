// 3.2.0 (Linux): Minimize to the tray, then Show SlopAMP, brings back every window that was open. GNOME hides the
// player's other windows (transient for it) along with it when it's minimized, and Electron then calls them minimized,
// not visible: SlopAMP left them like that on its way to the tray, and Show brought back only the player (GNOME
// re-checks them when the player is un-minimized, not when it's hidden and shown again). Checks, under xvfb with
// tests/fake-wm.py (GNOME's minimize: the transients go Iconic / _NET_WM_STATE_HIDDEN with the player):
//   - minimizing the player hides the video window and the playlist with it (the rule is in force)
//   - in the tray every SlopAMP window is withdrawn; Show SlopAMP maps the player, the video window and the playlist
//     again (WM_STATE Normal, not _NET_WM_STATE_HIDDEN; Electron: visible, not minimized), and the equalizer, closed
//     before, stays closed; twice
//   - a plain minimize (no tray) still comes back with all its windows when the player is restored
// The app runs on a private D-Bus, so no tray icon shows on the desktop running the tests (and none has a tray host:
// SlopAMP minimizes normally there, so the test sends it to the tray itself, as the minimize would).
// Run (Linux, xvfb): SLOPAMP_ELECTRON=… xvfb-run -a node tests/linux-tray-320.js
'use strict';
const path = require('path'), os = require('os');
const { spawn, execFileSync } = require('child_process');
const { launch, sleep } = require('./lib');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const H = path.join(os.tmpdir(), 'slopamp-test-tray-320');
const xprop = (xid, p) => { try { return execFileSync('xprop', ['-id', String(xid), p], { encoding: 'utf8' }).replace(/^[^=:]*[=:]\s*/, '').replace(/\s+/g, ' ').trim(); } catch (_) { return ''; } };
const mapped = (xid) => { try { return /Map State: IsViewable/.test(execFileSync('xwininfo', ['-id', String(xid)], { encoding: 'utf8' })); } catch (_) { return false; } };
const until = async (fn, ms = 4000) => { const t0 = Date.now(); let v; while (!(v = await fn()) && Date.now() - t0 < ms) await sleep(100); return v; };

(async () => {
  try { execFileSync('xprop', ['-version'], { stdio: 'ignore' }); } catch (_) { console.log('xprop (x11-utils) is needed'); process.exit(2); }
  // a private session bus: the tray icon must not reach the desktop the tests run on
  const bus = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const addr = await new Promise((resolve) => { bus.stdout.once('data', (d) => resolve(String(d).trim())); setTimeout(() => resolve(''), 5000); });
  if (!addr) { console.log('dbus-daemon did not start'); process.exit(2); }
  process.env.DBUS_SESSION_BUS_ADDRESS = addr;
  const wmLog = [];
  const wm = spawn('python3', [path.join(__dirname, 'fake-wm.py')], { stdio: ['ignore', 'pipe', 'inherit'] });
  wm.stdout.on('data', (d) => wmLog.push(...String(d).split('\n').filter(Boolean)));
  if (!(await until(() => wmLog.includes('ready')))) { console.log('fake-wm.py did not start'); process.exit(2); }
  const quit = (code) => { wm.kill(); bus.kill(); process.exit(code); };

  const { app, win, errs } = await launch(H);
  const ev = (fn, arg) => win.evaluate(fn, arg);
  const ids = ['main', 'eq', 'video', 'playlist'];
  const X = await app.evaluate(({ BrowserWindow }, list) => Object.fromEntries(list.map(id => [id, global.__slopamp.wm.wins.get(id).getNativeWindowHandle().readUInt32LE(0)])), ids);
  const el = () => app.evaluate(({ BrowserWindow }, list) => Object.fromEntries(list.map(id => { const w = global.__slopamp.wm.wins.get(id); return [id, { vis: w.isVisible(), min: w.isMinimized() }]; })), ids);
  const back = (id) => mapped(X[id]) && /Normal/.test(xprop(X[id], 'WM_STATE')) && !/HIDDEN/.test(xprop(X[id], '_NET_WM_STATE'));
  const gone = (id) => !mapped(X[id]);
  await ev(() => { S.showVideo = true; S.showPlaylist = true; renderToggles(); setEqPanel('hidden'); });    // EQ closed
  await sleep(5500);     // past main.js's 5 s "reveal" of a player that hasn't appeared
  const open = ['main', 'video', 'playlist'];
  ok(open.every(back) && gone('eq'), `open: player, video, playlist; the equalizer closed (${ids.map(id => `${id} ${mapped(X[id]) ? 'mapped' : 'unmapped'}`).join(', ')})`);

  for (const round of [1, 2]) {
    await app.evaluate(() => global.__slopamp.wm.wins.get('main').minimize());
    const hid = await until(async () => { const e = await el(); return e.video.min && e.playlist.min && e; });
    if (round === 1) ok(!!hid && /HIDDEN/.test(xprop(X.playlist, '_NET_WM_STATE')), `GNOME's rule: minimizing the player hides the video window and the playlist with it (${JSON.stringify(hid || await el())})`);
    await app.evaluate(() => global.__slopamp.sys.toTray());
    const inTray = await until(async () => (await app.evaluate(() => global.__slopamp.sys.inTray)) && ids.every(gone));
    ok(!!inTray, `round ${round}: in the tray, every window withdrawn (${ids.map(id => `${id} ${mapped(X[id]) ? 'MAPPED ' + xprop(X[id], 'WM_STATE') : 'unmapped'}`).join(', ')})`);
    await app.evaluate(() => global.__slopamp.sys.fromTray());
    const all = await until(async () => open.every(back) && Object.entries(await el()).every(([id, s]) => id === 'eq' || (s.vis && !s.min)));
    ok(!!all, `round ${round}: Show SlopAMP brings back the player, the video window and the playlist (${open.map(id => `${id}: ${mapped(X[id]) ? 'mapped' : 'unmapped'} ${xprop(X[id], 'WM_STATE').replace(/icon window.*/, '').trim()} ${xprop(X[id], '_NET_WM_STATE')}`).join(' | ')})`);
    ok(gone('eq') && !(await ev(() => WM.isShown('eq'))), `round ${round}: the equalizer, closed before, stays closed`);
  }

  // a plain minimize (Minimize to the tray off): the windows come back with the player
  await app.evaluate(() => global.__slopamp.wm.wins.get('main').minimize());
  await until(async () => (await el()).playlist.min);
  await app.evaluate(() => global.__slopamp.wm.wins.get('main').restore());
  ok(!!(await until(() => open.every(back))), `a plain minimize and restore: all three back (${open.map(id => `${id} ${mapped(X[id]) ? 'mapped' : 'unmapped'}`).join(', ')})`);

  ok(!errs.length, `no errors in the windows ${JSON.stringify(errs.slice(0, 3))}`);
  await app.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL OK');
  quit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
