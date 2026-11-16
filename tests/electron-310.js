// 3.1.0: Electron 41 → 45 (Chromium 147 → 156, Node 24). What the upgrade could change, checked on the real app:
//   - the versions, and a plain Chrome user agent (no "Electron" / "SlopAMP") for pages and the YOUTUBE window
//   - the panels (EQ, playlist, video, the popup / dialog hosts) are still windows the player opens with window.open()
//     and drives directly: one renderer process, each panel's document reachable (Electron 45 isolates children of
//     unsandboxed windows; SlopAMP's player is sandboxed, so its panels must stay together)
//   - the sandboxed preload still gives the page its API (Electron 45 removed Node shims from sandboxed preloads)
//   - file dialogs open where you last picked from (Electron 43+ opens Downloads unless told; SlopAMP remembers the
//     folder per kind of pick, between launches); dialogs that always named their folder still do
//   - Electron run as Node is still yt-dlp's JavaScript runtime
//   - playback through the EQ / visualizer audio graph, media keys, the YOUTUBE window's page (WebContentsView)
// Run (Linux, xvfb): SLOPAMP_ELECTRON=… SLOPAMP_APP=… xvfb-run -a node tests/electron-310.js
'use strict';
const { launch, sleep, APP } = require('./lib');
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const MEDIA = path.join(__dirname, 'media');

(async () => {
  const H = path.join(os.tmpdir(), 'slopamp-test-310');
  let { app, win, errs } = await launch(H);
  let ev = (f, a) => win.evaluate(f, a);

  // versions
  const v = await app.evaluate(() => ({ e: process.versions.electron, c: process.versions.chrome, n: process.versions.node }));
  ok(/^45\./.test(v.e) && Number(v.c.split('.')[0]) >= 152 && /^24\./.test(v.n), `Electron ${v.e}, Chromium ${v.c}, Node ${v.n}`);
  const ua = await ev(() => navigator.userAgent);
  const cm = v.c.split('.')[0];
  ok(new RegExp(`Chrome/${cm}\\.`).test(ua) && !/Electron|SlopAMP/i.test(ua), `the page's user agent is plain Chrome ${cm}: "${ua}"`);
  const yua = await app.evaluate(() => global.__slopamp.ytweb.ses().getUserAgent());
  ok(new RegExp(`Chrome/${cm}\\.`).test(yua) && !/Electron|SlopAMP/i.test(yua), 'the YOUTUBE window’s user agent too');

  // the panels: opened by the player, one renderer process, driven directly
  await sleep(1500);
  const panels = await ev(() => Object.keys(WM.wins).map(id => { let d = null; try { d = WM.wins[id].document; } catch (_) {} return { id, doc: !!d, body: d ? d.body.className : '' }; }));
  ok(panels.length >= 4 && panels.every(p => p.doc), `the player reaches every panel's page: ${panels.map(p => p.id).join(', ')}`);
  const pids = await app.evaluate(({ BrowserWindow }) => [...new Set(BrowserWindow.getAllWindows().map(b => b.webContents.getOSProcessId()))]);
  ok(pids.length === 1, `all SlopAMP windows share one renderer process (${pids.length})`);
  const opener = await app.evaluate(({ BrowserWindow }) => Promise.all(BrowserWindow.getAllWindows().filter(b => /panel\.html/.test(b.webContents.getURL())).map(b => b.webContents.executeJavaScript('!!window.opener && !!window.opener.WM'))));
  ok(opener.length >= 3 && opener.every(Boolean), `each panel sees the player as its opener (${opener.length})`);
  ok(await ev(() => typeof window.phosphor === 'object' && typeof window.phosphor.openDialog === 'function' && typeof window.phosphor.pathForFile === 'function'), 'the sandboxed preload gives the page its API');

  // file dialogs: where you last picked from
  const D = path.join(H, 'dlg'), MUS = path.join(D, 'Music'), PIC = path.join(D, 'Pictures');
  fs.mkdirSync(path.join(MUS, 'Album'), { recursive: true }); fs.mkdirSync(PIC, { recursive: true });
  const song = path.join(MUS, 'tone.mp3'); fs.copyFileSync(path.join(MEDIA, 'Test Artist - Tone Song [abcdefghij4].mp3'), song);
  const stub = (ret) => app.evaluate(({ dialog }, r) => { global.__dlg = global.__dlg || []; dialog.showOpenDialog = async (_w, o) => { global.__dlg.push({ ...(o || (_w && !_w.webContents ? _w : {})) }); return r; }; }, ret);
  const last = () => app.evaluate(() => global.__dlg[global.__dlg.length - 1]);
  await stub({ canceled: false, filePaths: [song] });
  await ev(() => window.phosphor.openDialog('files'));
  ok((await last()).defaultPath === undefined, 'the first Add files… opens where Electron does (nothing remembered yet)');
  await ev(() => window.phosphor.openDialog('files'));
  ok((await last()).defaultPath === MUS, `the next Add files… opens in the folder picked from: ${(await last()).defaultPath}`);
  await stub({ canceled: false, filePaths: [path.join(MUS, 'Album')] });
  await ev(() => window.phosphor.openDialog('folder'));
  ok((await last()).defaultPath === MUS, 'Add folder… opens there too');
  await ev(() => window.phosphor.clipPickJoin());
  ok((await last()).defaultPath === MUS && /join/i.test((await last()).title), 'CLIP’s pickers share it (Join other files)');
  await stub({ canceled: false, filePaths: [path.join(PIC, 'x.png')] });
  await ev(() => window.phosphor.clipPickImage());
  ok((await last()).defaultPath === undefined, 'a picture for a still keeps its own folder (none yet)');
  await ev(() => window.phosphor.clipPickImage());
  ok((await last()).defaultPath === PIC, 'and then remembers Pictures');
  await stub({ canceled: true, filePaths: [] });
  await ev(() => window.phosphor.openDialog('files'));
  ok((await last()).defaultPath === MUS, 'Cancel keeps the folder');
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async (_w, o) => { global.__dlg.push({ ...o }); return { canceled: true, filePaths: [] }; }; });
  await ev(() => window.phosphor.loadPlaylist());
  const pl = await last();
  ok(pl.title === 'Load playlist' && /Playlists$/.test(pl.defaultPath || ''), `a dialog that names its folder still does (${pl.title}: ${pl.defaultPath})`);

  // Electron as yt-dlp's JavaScript runtime
  const exe = await app.evaluate(() => process.execPath);
  let node = '';
  try { node = execFileSync(exe, ['-e', 'process.stdout.write(process.versions.node + " " + typeof fetch)'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 20000 }).toString(); } catch (e) { node = String(e.message); }
  ok(/^24\.\d+\.\d+ function$/.test(node), `Electron run as Node (yt-dlp's JavaScript runtime): ${node}`);

  // playback through the audio graph (EQ → analyser)
  await ev((f) => addPaths([f]), path.join(MEDIA, 'Test Artist - Tone Song [abcdefghij4].mp3')); await sleep(1500);
  await ev(() => playIndex(S.items.length - 1));
  let played = false;
  for (let k = 0; k < 60 && !played; k++) { played = await ev(() => status === 'playing' && currentTime() > 1); await sleep(200); }
  ok(played, 'a song plays');
  const heard = await ev(async () => { if (!analyser) return -1; const a = new Uint8Array(analyser.frequencyBinCount); let m = 0; for (let k = 0; k < 20; k++) { analyser.getByteFrequencyData(a); m = Math.max(m, ...a); await new Promise(r => setTimeout(r, 50)); } return m; });
  ok(heard > 0, `the visualizer's analyser hears it through the EQ (peak ${heard})`);
  await ev(() => { try { video.pause(); } catch (_) {} });

  // media keys
  await ev(() => window.phosphor.sysSet('mediaKeys', true)); await sleep(300);
  const keys = await app.evaluate(({ globalShortcut }) => ['MediaPlayPause', 'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop'].filter(k => globalShortcut.isRegistered(k)));
  ok(keys.length === 4, `media keys registered: ${keys.join(', ')}`);

  // the YOUTUBE window's page (a WebContentsView in its own session; offline here, so only its set-up)
  await ev(() => ytwShow(true)); await sleep(2500);
  const view = await app.evaluate(() => { const y = global.__slopamp.ytweb; return y.view ? { prefs: y.view.webContents.getLastWebPreferences ? y.view.webContents.getLastWebPreferences() : null, part: y.view.webContents.session === y.ses() } : null; });
  ok(view && view.part && (!view.prefs || (view.prefs.sandbox === true && view.prefs.contextIsolation === true && !view.prefs.nodeIntegration)), `the YOUTUBE page is a sandboxed WebContentsView in its own session ${JSON.stringify(view && { part: view.part, sandbox: view.prefs && view.prefs.sandbox })}`);

  ok(!errs.filter(e => !/net::ERR|Failed to load resource|youtube/i.test(e)).length, `no errors in the windows ${JSON.stringify(errs.slice(0, 3))}`);
  await app.close();

  // after a restart: the folders are still remembered
  ({ app, win, errs } = await launch(H, { keep: true }));
  ev = (f, a) => win.evaluate(f, a);
  await app.evaluate(({ dialog }) => { global.__dlg = []; dialog.showOpenDialog = async (_w, o) => { global.__dlg.push({ ...o }); return { canceled: true, filePaths: [] }; }; });
  await ev(() => window.phosphor.openDialog('files'));
  ok((await app.evaluate(() => global.__dlg[0].defaultPath)) === MUS, 'after a restart Add files… still opens in Music');
  fs.rmSync(PIC, { recursive: true, force: true });
  await ev(() => window.phosphor.clipPickImage());
  ok((await app.evaluate(() => global.__dlg[1].defaultPath)) === undefined, 'a remembered folder that’s gone is skipped');
  await app.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
