// 2.9.6 hotfix: big playlists don't freeze SlopAMP. 2,000 MP3s (+ a few M4As) added from a folder show at once and
// are read in the background ("Adding 340 / 2,020…", Cancel); MP3 titles and lengths come from the files' own tags
// (same answers as ffprobe), the M4As from ffprobe; LIBRARY opens in under a second while that runs (and the CLIP
// window's Library → CLIPS); a saved 2,000-song playlist no longer makes the Library read every file before it opens;
// QUICK SAVE, restart, LOAD it again (Loading…); an open Library comes to the front.
// Run (Linux, xvfb): SLOPAMP_ELECTRON=… SLOPAMP_APP=… xvfb-run -a node tests/big-playlist-296.js
'use strict';
const { launch, sleep, docWin } = require('./lib');
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const H = path.join(os.tmpdir(), 'slopamp-test-296');
const FF = process.env.SLOPAMP_FFMPEG || 'ffmpeg';
const N = +(process.env.N_BIG || 2000);
const until = async (f, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return Date.now() - t; await sleep(50); } return -1; };

(async () => {
  // 2,000 MP3s (20 different songs with tags, copied under 2,000 names) and 20 M4As (no MP3: ffprobe reads them)
  const SRC = path.join(os.tmpdir(), 'slopamp-296-src'), BIG = path.join(SRC, 'Big Folder');
  if (!fs.existsSync(path.join(BIG, `song ${String(N - 1).padStart(4, '0')}.mp3`))) {
    fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(BIG, { recursive: true });
    const base = [];
    for (let k = 0; k < 20; k++) {
      const f = path.join(SRC, `base${k}.mp3`);
      execFileSync(FF, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=f=${200 + k * 20}:d=${3 + k % 7}`, '-c:a', 'libmp3lame', ...(k % 2 ? ['-q:a', '6'] : ['-b:a', '128k']), '-metadata', `title=Song ${k}`, ...(k % 3 ? ['-metadata', `artist=Band ${k % 3}`] : []), f]);
      base.push(f);
    }
    for (let i = 0; i < N; i++) fs.copyFileSync(base[i % 20], path.join(BIG, `song ${String(i).padStart(4, '0')}.mp3`));
    for (let k = 0; k < 20; k++) execFileSync(FF, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=f=500:d=${2 + k % 3}`, '-c:a', 'aac', '-metadata', `title=Tune ${k}`, path.join(BIG, `zz tune ${k}.m4a`)]);
  }
  const TOTAL = N + 20;

  // ================= 0. MP3s read from their tags give ffprobe's answers; 2.9.6 in the update check
  {
    const mp3info = require('../src/mp3info'), { MediaServer } = require('../src/media');
    const fp = execFileSync('sh', ['-c', 'command -v ffprobe']).toString().trim();
    const server = new MediaServer({ uiDir: os.tmpdir(), ffmpegDir: path.dirname(fp) });
    const bad = [];
    for (let k = 0; k < 20; k++) {
      const f = path.join(SRC, `base${k}.mp3`), a = mp3info.read(f), b = await server.probe(f);
      if (!a || a.title !== b.title || Math.abs(a.duration - b.duration) > 0.06 || a.hasVideo !== b.hasVideo) bad.push({ k, a, b: b && [b.title, b.duration] });
    }
    ok(!bad.length, `20 MP3s (CBR, VBR, with and without an artist): title and length from the file match ffprobe ${JSON.stringify(bad.slice(0, 2))}`);
    const { isNewer } = require('../src/updater');
    ok(isNewer('2.9.6', '2.9.5') && isNewer('v2.9.6', '2.9.5') && !isNewer('2.9.5', '2.9.6') && !isNewer('2.9.6', '2.9.6') && isNewer('2.10.0', '2.9.6'), 'versions: 2.9.6 is newer than 2.9.5 (so 2.9.5 offers it), not newer than itself');
  }

  let { app, win, errs } = await launch(H);
  let ev = (f, a) => win.evaluate(f, a);
  const allErrs = [];
  const PL = (await app.evaluate(({ app }) => app.getPath('downloads'))) + '/SlopAMP/Playlists';
  fs.mkdirSync(PL, { recursive: true });
  const plWin = async () => { for (const w of app.windows()) if (await w.evaluate(() => !!document.getElementById('pDlm')).catch(() => false)) return w; return null; };
  const libOpen = () => ev(() => WM.$('#dlmDlg').open);
  const closeLib = () => ev(() => { if (WM.$('#dlmDlg').open) WM.$('#dlmDlg').close(); });
  // LIBRARY, clicked for real; how long until the Library is open
  const clickLibrary = async () => { const w = await plWin(); const t0 = Date.now(); await w.click('#pDlm'); const t = await until(libOpen, 10000); return t < 0 ? -1 : Date.now() - t0; };
  // reading is quick on this machine (and quicker with the cache): slow each 100-file batch down so "during" is real
  const slow = (ms) => app.evaluate(({ ipcMain }, ms) => {
    const H = ipcMain._invokeHandlers; const orig = global.__descOrig || (H && H.get && H.get('files:describe'));
    if (!orig) return false;
    global.__descOrig = orig; ipcMain.removeHandler('files:describe');
    ipcMain.handle('files:describe', ms ? async (e, ...a) => { await new Promise(r => setTimeout(r, ms)); return orig(e, ...a); } : orig);
    return true;
  }, ms);
  const bar = () => ev(() => ({ shown: !WM.$('#plAdd').classList.contains('hidden'), text: WM.$('#plAddT').textContent }));

  // ================= 1. add a 2,020-file folder (a drop / + DIR)
  await ev(() => { const n = newTab('Big'); switchTab(n); });
  ok(await slow(250), 'test: each batch slowed down by 250 ms');
  const t0 = Date.now();
  ev((d) => { addPaths([d]); }, BIG);
  const tRows = await until(() => ev((n) => S.items.length === n, TOTAL), 30000);
  const early = await ev(() => FILL.done);
  ok(tRows >= 0 && tRows < 3000, `the ${TOTAL} rows show at once: ${tRows} ms (before: only after every file was read)`);
  // how long the window ever stops answering while the files are read (the list isn't drawn again per batch)
  await ev(() => { window.__lag = { max: 0, last: performance.now() }; window.__lagT = setInterval(() => { const n = performance.now(), d = n - window.__lag.last - 50; if (d > window.__lag.max) window.__lag.max = d; window.__lag.last = n; }, 50); });
  let b = await bar();
  ok(b.shown && new RegExp(`^Adding [\\d,]+ / ${TOTAL.toLocaleString('en-US')}…$`).test(b.text), `the progress line: "${b.text}"`);
  ok(early < TOTAL && await ev(() => { const it = S.items[S.items.length - 1]; return it._probe === true && it.title === 'zz tune 19'; }), `rows show before they're read (${early} read), with the file names until then`);
  // LIBRARY while it's reading
  let tl = await clickLibrary();
  ok(tl >= 0 && tl < 1000 && (await bar()).shown, `LIBRARY opens in ${tl} ms while the files are read (under a second)`);
  await until(() => ev(() => !DLM.loading), 10000);
  ok(await ev(() => !WM.$('#dlmDlg').classList.contains('skinmode') && WM.$('#dlqf').children.length === 6), 'the Library is the real one (its quick filters are there)');
  await closeLib();
  // CLIP → Library → CLIPS while it's reading
  await ev(() => clipShow(true)); await sleep(400);
  const cw = await docWin(app, 'win-clip');
  const tc0 = Date.now(); await cw.click('#clipEmptyLib'); const tc = await until(libOpen, 10000);
  ok(tc >= 0 && Date.now() - tc0 < 1000 && await ev(() => DLM.filter === 'clips'), `Library → CLIPS from CLIP opens in ${Date.now() - tc0} ms too`);
  await closeLib(); await ev(() => clipShow(false));
  // the window keeps working: switch tabs and back
  const sw = await ev(() => { const t = performance.now(); switchTab(S.tabs.findIndex(x => x.name === 'Main')); switchTab(S.tabs.findIndex(x => x.name === 'Big')); return Math.round(performance.now() - t); });
  ok(sw < 1500, `switching to the big tab and back: ${sw} ms`);
  // done: every row read
  await slow(0);
  const tDone = await until(() => ev(() => !FILL.busy && !FILL.q.length), 180000);
  const res = await ev(() => { const it = S.items; return { n: it.length, noDur: it.filter(i => !(i.duration > 0)).length, probe: it.filter(i => i._probe).length, t0: it[0].title, t1: it[1].title, t2: it[2].title, m4a: it.filter(i => /\.m4a$/.test(i.path)).map(i => [i.title, Math.round(i.duration)]).slice(0, 2), d3: it[3].duration }; });
  const lag = await ev(() => { clearInterval(window.__lagT); return Math.round(window.__lag.max); });
  ok(lag < 400, `the window never stops answering for more than ${lag} ms while the files are read`);
  ok(tDone >= 0 && res.n === TOTAL && res.noDur === 0 && res.probe === 0, `all ${TOTAL} read in ${((Date.now() - t0) / 1000).toFixed(1)} s, every length filled in ${JSON.stringify({ noDur: res.noDur, probe: res.probe })}`);
  ok(res.t0 === 'Song 0' && res.t1 === 'Band 1 - Song 1' && res.t2 === 'Band 2 - Song 2', `MP3 titles from their tags, like ffprobe ("Artist - Title") ${JSON.stringify([res.t0, res.t1, res.t2])}`);
  ok(JSON.stringify(res.m4a) === '[["Tune 0",2],["Tune 1",3]]', `M4As are read by ffprobe as before ${JSON.stringify(res.m4a)}`);
  ok(!(await bar()).shown, 'the progress line goes away when it’s done');

  // ================= 2. Cancel
  await ev(() => { const n = newTab('Big 2'); switchTab(n); });
  // the files are known now (read fast from the cache), so make each batch slow for this part: Cancel has time to act
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('files:describe'); ipcMain.handle('files:describe', () => new Promise(r => setTimeout(() => r([]), 400))); });
  ev((d) => { addPaths([d]); }, BIG);
  await until(() => ev(() => FILL.done > 0 && FILL.busy && !WM.$('#plAdd').classList.contains('hidden')), 30000);
  await (await plWin()).click('#plAddX');
  await until(() => ev(() => !FILL.busy), 30000);
  const cn = await ev(() => ({ n: S.items.length, left: S.items.filter(i => i._probe).length, named: S.items.filter(i => /^song \d+$/.test(i.title)).length }));
  ok(cn.n === TOTAL && cn.left === 0 && cn.named > 0 && !(await bar()).shown, `Cancel: reading stops, the rows stay (${cn.named} keep their file names) ${JSON.stringify(cn)}`);
  await ev(() => removeTabAt(S.tabs.findIndex(t => t.name === 'Big 2'))); await sleep(200);

  // ================= 3. QUICK SAVE, restart, the Library with a 2,000-song saved playlist, LOAD it again
  await ev(() => switchTab(S.tabs.findIndex(t => t.name === 'Big')));
  await ev(() => quickSavePlaylist()); await sleep(1500);
  const saved = `${PL}/Big.m3u8`;
  const lines = fs.existsSync(saved) ? fs.readFileSync(saved, 'utf8').split(/\r?\n/).filter(l => l.startsWith('#EXTINF:')) : [];
  ok(lines.length === TOTAL && lines.every(l => !/^#EXTINF:-1,/.test(l)), `QUICK SAVE wrote ${lines.length} entries, each with its length`);
  await ev(() => saveNow()); await sleep(600); allErrs.push(...errs); await app.close();
  ({ app, win, errs } = await launch(H, { keep: true })); ev = (f, a) => win.evaluate(f, a);
  // the first Library after a restart (nothing read yet): it used to read all 2,020 files of the saved playlist first
  tl = await clickLibrary();
  const ready = await until(() => ev(() => !DLM.loading && DLM.rows.some(r => r.kind === 'playlist')), 10000);
  ok(tl >= 0 && tl < 1000 && ready >= 0 && ready < 1000, `after a restart, LIBRARY opens in ${tl} ms and is filled in ${ready} ms more (a 2,020-song saved playlist in Playlists)`);
  const prot = await ev(() => DLM.prot.size);
  ok(prot >= TOTAL - 1, `"▶ in <playlist>" still knows the saved playlist's files (${prot}) without reading them`);
  // LOAD it again into a new tab
  // a copy (the saved one is linked to the Big tab: LOAD would just bring that tab up, as since 2.9.3)
  const copy = path.join(SRC, 'Big copy.m3u8'); fs.copyFileSync(saved, copy);
  await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, copy);
  await ev(() => { const n = newTab('Fresh'); switchTab(n); });
  await slow(250);
  const tLoad0 = Date.now();
  ev(() => { WM.$('#pLoad').click(); });
  const tLoad = await until(() => ev((n) => S.items.length === n && S.tabs[S.tab].name === 'Fresh', TOTAL), 30000);
  ok(tLoad >= 0 && tLoad < 3000, `LOAD shows the ${TOTAL} rows in ${tLoad} ms`);
  const lb = await bar();
  ok(lb.shown && /^Loading [\d,]+ \/ 2,020…$/.test(lb.text), `"Loading …" while the files are read: "${lb.text}"`);
  ok(await ev(() => S.items.every(i => i.duration > 0) && S.items[1].title === 'Band 1 - Song 1'), 'rows come with their lengths and titles from the saved playlist right away');
  tl = await clickLibrary();
  ok(tl >= 0 && tl < 1000, `LIBRARY opens in ${tl} ms during the load`);
  // already open, behind the player: LIBRARY brings it to the front
  await app.evaluate(({ BrowserWindow }) => { const m = BrowserWindow.getAllWindows().find(w => /index\.html/.test(w.webContents.getURL())); if (m) m.focus(); });
  await sleep(300);
  await (await plWin()).click('#pDlm'); await sleep(600);
  const front = await app.evaluate(({ BrowserWindow }) => { const f = BrowserWindow.getFocusedWindow(); return f ? f.webContents.getURL() : ''; });
  ok(/dialog/.test(front) || /w=dialog/.test(front) || await ev(() => WM.$('#dlmDlg').open), `an open Library comes to the front (${front.split('/').pop()})`);
  await closeLib();
  await slow(0);
  await until(() => ev(() => !FILL.busy && !FILL.q.length), 180000);
  ok(await ev(() => S.items.every(i => !i._probe && i.duration > 0)), `LOAD finished reading in ${((Date.now() - tLoad0) / 1000).toFixed(1)} s`);
  // a small add still works the old way (read first, then added)
  await ev(() => { const n = newTab('Small'); switchTab(n); });
  await ev((f) => addPaths([f]), path.join(BIG, 'song 0001.mp3')); await sleep(300);
  ok(await ev(() => S.items.length === 1 && S.items[0].title === 'Band 1 - Song 1' && S.items[0].duration > 0 && !S.items[0]._probe), 'a small add is read before it’s added, as before');

  allErrs.push(...errs);
  ok(!allErrs.length, 'no errors in the windows ' + JSON.stringify(allErrs.slice(0, 5)));
  await app.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
