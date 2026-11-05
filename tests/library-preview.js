// SlopAMP 2.7.0 test: Library Preview view (per section, the one-time tip, pictures, cache, lazy loading on a
// 1,000-file Library, hover look-through, playlists, clips, skins), compact History tabs, tab contrast in every skin,
// and MP3 downloads asking for the cover art. Make the sample media first: tests/make-media.sh
// Run: xvfb-run -a node tests/library-preview.js   (N_BIG=1000 sets the big-Library size)
const { launch, sleep, docWin, APP } = require('./lib');
const fs = require('fs'), path = require('path'), os = require('os');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const M = process.env.SLOPAMP_TEST_MEDIA || path.join(__dirname, 'media'), H = path.join(os.tmpdir(), 'slopamp-test-270'), O = process.env.SLOPAMP_TEST_OUT || path.join(os.tmpdir(), 'slopamp-test-270-shots');
fs.mkdirSync(O, { recursive: true });
const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await sleep(150); } return false; };
const N_BIG = +(process.env.N_BIG || 1000);
(async () => {
  fs.rmSync(H, { recursive: true, force: true });
  const DL = `${H}/SlopAMP`;   // no XDG Downloads folder here: Electron uses HOME
  for (const d of ['Video', 'Audio', 'mp3clips', 'mp4clips', 'Playlists']) fs.mkdirSync(`${DL}/${d}`, { recursive: true });
  const vids = fs.readdirSync(M).filter(f => /\.mp4$/.test(f)), mp3s = fs.readdirSync(M).filter(f => /\.mp3$/.test(f));
  for (const f of vids) fs.copyFileSync(`${M}/${f}`, `${DL}/Video/${f}`);
  for (const f of mp3s) fs.copyFileSync(`${M}/${f}`, `${DL}/Audio/${f}`);
  const SRC = `${DL}/Audio/Test Artist - Tone Song [abcdefghij4].mp3`, C1 = `${DL}/mp3clips/Tone Song chorus.mp3`;
  fs.copyFileSync(`${M}/Beat Maker - Drum Loop [m4N5b6V7c8X].mp3`, C1);
  fs.copyFileSync(`${M}/Neon Garden Live Session [Q1w2E3r4T5y].mp4`, `${DL}/mp4clips/Neon Garden best bit.mp4`);
  fs.writeFileSync(`${DL}/Playlists/Road Trip.m3u8`, '#EXTM3U\r\n' + [`${DL}/Video/${vids[0]}`, `${DL}/Video/${vids[1]}`, SRC, 'https://www.youtube.com/watch?v=zzzzzzzzzzz'].map(p => `#EXTINF:6,x\r\n${p}\r\n`).join(''));
  fs.mkdirSync(`${H}/.config/SlopAMP`, { recursive: true });
  fs.writeFileSync(`${H}/.config/SlopAMP/slopamp-state.json`, JSON.stringify({ update: { mode: 'off' }, ytdlpUpdatedAt: Date.now(), clips: { [C1]: { in: 5, out: 20, dur: 15, src: SRC, srcTitle: 'Test Artist - Tone Song' } } }));
  let { app, win, errs } = await launch(H, { keep: true });
  let ev = (f, a) => win.evaluate(f, a);
  const TH = `${H}/.config/SlopAMP/thumbs`;
  const thumbFiles = () => { try { return fs.readdirSync(TH).filter(f => /\.(jpg|json)$/.test(f) && f !== 'index.json'); } catch (_) { return []; } };
  const lib = async (f) => { await ev((f) => openDownloadsManager(f), f); await sleep(700); };
  const seg = async (f) => { await ev((f) => WM.$(`#dlmSeg [data-f=${f}]`).click(), f); await sleep(500); };
  const view = (v) => ev((v) => WM.$(`#dlmView [data-v=${v}]`).click(), v);
  const st = () => ev(() => ({ mode: lpMode(), rows: WM.$$('#dlmBody tr').length, tiles: WM.$$('#dlmGrid .lt').length, got: WM.$$('#dlmGrid .lt-im.got').length, tableShown: getComputedStyle(WM.$('.dlm-table')).display !== 'none', tip: !WM.$('#dlmTip').classList.contains('hidden'), on: [...WM.$('#dlmView').children].filter(b => b.classList.contains('on')).map(b => b.dataset.v) }));
  const dw = () => docWin(app, 'host-dialog');
  // ================= the toggle, Classic by default, the one-time tip
  await lib('video');
  let s = await st();
  ok(s.mode === 'classic' && s.rows === 6 && s.tableShown && JSON.stringify(s.on) === '["classic"]', 'Library opens in Classic (the list) ' + JSON.stringify(s));
  ok(s.tip, 'the one-time "New: Preview view" tip shows');
  await (await dw()).screenshot({ path: `${O}/tip.png` });
  await ev(() => WM.$('#dlmDlg').close()); await lib('video');
  s = await st(); ok(!s.tip && (await ev(() => S.lib.tip)) === 1, 'after closing that Library, the tip doesn’t come back');
  // ================= VIDEO in Preview: a frame per video, made once
  await view('preview'); await sleep(200);
  s = await st(); ok(s.mode === 'preview' && s.tiles === 6 && !s.tableShown && JSON.stringify(s.on) === '["preview"]', 'VIDEO → Preview: 6 tiles, the list hidden ' + JSON.stringify(s));
  ok(await until(async () => (await st()).got === 6), 'every video tile gets its picture');
  let tv = await ev(() => [...WM.$$('#dlmGrid .lt')].map(t => ({ n: t.querySelector('.lt-n').textContent, bg: /url\(/.test(t.querySelector('.lt-im').style.backgroundImage), du: t.querySelector('.lt-du').textContent, x: !!t.querySelector('.lt-s .dlm-tag') })));
  ok(tv.every(t => t.bg && t.du === '0:06'), 'frames + length (0:06) on every tile ' + JSON.stringify(tv.map(t => [t.du, t.bg])));
  ok(await until(async () => (await ev(() => WM.$$('#dlmGrid .lt-s .dlm-tag').length)) === 6), 'X ✓ tags on the tiles');
  let tf = thumbFiles();
  ok(tf.filter(f => /^[0-9a-f]{40}\.jpg$/.test(f)).length === 6, `6 pictures cached on disk (${tf.length} files)`);
  await (await dw()).screenshot({ path: `${O}/video.png` });
  // per section: MP3 is still Classic
  await seg('audio'); s = await st(); ok(s.mode === 'classic' && s.rows === 4 && s.tableShown, 'MP3 stays Classic (per section)');
  await view('preview'); await sleep(300);
  ok(await until(async () => (await st()).got === 4), 'MP3 tiles get pictures');
  const ta = await ev(() => [...WM.$$('#dlmGrid .lt')].map(t => [t.querySelector('.lt-n').textContent, t.querySelector('.lt-im').classList.contains('cover'), !!t.querySelector('.lt-im canvas')]));
  ok(ta.filter(t => t[1]).length === 1 && /Synthwave/.test(ta.find(t => t[1])[0]) && ta.filter(t => t[2]).length === 3, 'MP3: cover art for the one that has it, a waveform for the other 3 ' + JSON.stringify(ta));
  await (await dw()).screenshot({ path: `${O}/mp3.png` });
  await seg('video'); s = await st(); ok(s.mode === 'preview' && s.got === 6, 'back on VIDEO: still Preview, pictures shown at once (kept)');
  // the cache: nothing made again; a changed file gets a new picture
  const n0 = thumbFiles().length;
  await ev(() => { LP.pics.clear(); LP.tiles.clear(); }); await ev(() => WM.$('#dlmDlg').close()); await lib('video');
  ok(await until(async () => (await st()).got === 6) && thumbFiles().length === n0, 'reopened: the same pictures from the cache, none made again');
  const V0 = `${DL}/Video/${vids[0]}`; const t1 = new Date(Date.now() + 5000); fs.utimesSync(V0, t1, t1);
  await ev(() => WM.$('#dlmDlg').close()); await lib('video');
  ok(await until(async () => thumbFiles().length === n0 + 1), 'a file that changed gets a new picture');
  const pr = await app.evaluate(() => { global.__slopamp.thumbs.pruned = false; return global.__slopamp.thumbs.prune(); });
  ok(pr === 1 && thumbFiles().length === n0, `old pictures of changed files are cleaned up (${pr})`);
  // selection, keys and menus on tiles
  const tile = (i) => ev((i) => { const t = WM.$$('#dlmGrid .lt')[i]; const r = t.getBoundingClientRect(); return { x: r.left + 40, y: r.top + 30 }; }, i);
  const pw = await dw();
  let p = await tile(0); await pw.mouse.click(p.x, p.y); await sleep(200);
  p = await tile(2); await pw.keyboard.down('Control'); await pw.mouse.click(p.x, p.y); await pw.keyboard.up('Control'); await sleep(200);
  let sel = await ev(() => [...WM.$$('#dlmGrid .lt.sel')].length);
  ok(sel === 2 && (await ev(() => DLM.sel.size)) === 2, 'click + Ctrl-click: 2 tiles selected');
  p = await tile(3); await pw.keyboard.down('Shift'); await pw.mouse.click(p.x, p.y); await pw.keyboard.up('Shift'); await sleep(200);
  ok((await ev(() => DLM.sel.size)) === 2, 'Shift-click: a range ' + (await ev(() => DLM.sel.size)));
  await ev(() => { const b = WM.$$('#dlmGrid .lt .dlm-cb')[5]; b.click(); }); await sleep(150);
  ok((await ev(() => DLM.sel.size)) === 3, 'the tick box in a tile’s corner adds it');
  p = await tile(1); await pw.mouse.click(p.x, p.y, { button: 'right' }); await sleep(500);
  const menu = await ev(() => [...WM.$('#ctx').children].map(d => d.textContent));
  ok(menu.includes('Rename…F2') && menu.includes('Show in folder') && menu.some(m => /^Delete/.test(m)), 'right-click a tile: the row menu ' + JSON.stringify(menu.slice(-3)));
  await ev(() => hideCtx());
  await pw.keyboard.press('F2'); await sleep(500);
  ok(await ev(() => WM.$('#clRenDlg').open && WM.$('#renTitle').textContent === 'Rename video'), 'F2 on the selected tile: Rename video');
  await ev(() => WM.$('#clRenDlg').close('cancel')); await sleep(200);
  // hover look-through
  p = await tile(4);
  const box = await ev(() => { const b = WM.$$('#dlmGrid .lt-im')[4].getBoundingClientRect(); return { l: b.left, w: b.width, t: b.top + 20 }; });
  await pw.mouse.move(box.l + box.w * 0.2, box.t); await sleep(100); await pw.mouse.move(box.l + box.w * 0.25, box.t);
  await sleep(150); ok(!(await ev(() => WM.$$('#dlmGrid .lt')[4]._spr)), 'passing over a tile doesn’t make its look-through');
  await sleep(500);
  ok(await until(async () => (await ev(() => !!(WM.$$('#dlmGrid .lt')[4]._spr && WM.$$('#dlmGrid .lt')[4]._spr.url)))), 'hover: the look-through frames are made');
  await pw.mouse.move(box.l + box.w * 0.75, box.t); await sleep(150);
  const look = await ev(() => { const im = WM.$$('#dlmGrid .lt-im')[4]; return { look: im.classList.contains('look'), pos: im.querySelector('.lt-spr').style.backgroundPosition }; });
  ok(look.look && /^77\.7\d+% 0(px)?$/.test(look.pos), 'moving across the tile steps through the frames ' + JSON.stringify(look));
  await (await dw()).screenshot({ path: `${O}/hover.png` });
  await pw.mouse.move(box.l - 30, box.t - 60); await sleep(200);
  ok(!(await ev(() => WM.$$('#dlmGrid .lt-im')[4].classList.contains('look'))), 'leaving the tile shows its picture again');
  const nS = thumbFiles().filter(f => /\.s\.jpg$/.test(f)).length;
  await ev(() => { delete WM.$$('#dlmGrid .lt')[4]._spr; }); await pw.mouse.move(box.l + box.w * 0.5, box.t); await sleep(700); await pw.mouse.move(box.l + box.w * 0.55, box.t);
  ok(await until(async () => (await ev(() => !!(WM.$$('#dlmGrid .lt')[4]._spr && WM.$$('#dlmGrid .lt')[4]._spr.url)))) && thumbFiles().filter(f => /\.s\.jpg$/.test(f)).length === nS, `the look-through is cached: hovering again makes nothing new (${nS} strip(s))`);
  await pw.mouse.move(box.l - 30, box.t - 60); await sleep(200);
  // PLAYLISTS: a mosaic of the first four; double-click opens it
  await seg('playlist'); await view('preview'); await sleep(300);
  ok(await until(async () => (await ev(() => WM.$$('#dlmGrid .lt-mo b').length)) === 4), 'PLAYLISTS: a 2×2 mosaic');
  const mo = await ev(() => [...WM.$$('#dlmGrid .lt-mo b')].map(b => (b.style.backgroundImage ? 'pic' : b.querySelector('canvas') ? 'wave' : b.textContent)));
  ok(JSON.stringify(mo) === '["pic","pic","wave","YT"]', 'mosaic: two video frames, a waveform, and YT for a link with no copy ' + JSON.stringify(mo));
  ok((await ev(() => WM.$('#dlmGrid .lt-s').textContent)) === '4 items', 'what’s inside');
  await (await dw()).screenshot({ path: `${O}/playlists.png` });
  p = await tile(0); await pw.mouse.dblclick(p.x, p.y); await sleep(1500);
  ok(await ev(() => S.tabs.some(t => t.name === 'Road Trip')), 'double-click a playlist tile opens it in a new tab');
  // CLIPS: the In → Out bar
  await lib('clips'); await view('preview'); await sleep(300);
  ok(await until(async () => (await ev(() => WM.$$('#dlmGrid .lt-im.got').length)) === 2), 'CLIPS tiles get pictures');
  const io = await ev(() => [...WM.$$('#dlmGrid .lt')].map(t => ({ n: t.querySelector('.lt-n').textContent, kd: (t.querySelector('.lt-kd') || {}).textContent, io: t.querySelector('.lt-io') && !t.querySelector('.lt-io').classList.contains('hidden') ? t.querySelector('.lt-io i').style.left + ' ' + t.querySelector('.lt-io i').style.width : '' })));
  const c1 = io.find(x => /chorus/.test(x.n));
  const [l1, w1] = c1 ? c1.io.split(' ').map(parseFloat) : [0, 0];
  ok(c1 && Math.abs(l1 - 12.5) < 0.2 && Math.abs(w1 - 37.5) < 0.2 && c1.kd === 'MP3 CLIP', 'clip: In 0:05 → Out 0:20 of a 0:40 song = the amber bar from 12.5%, 37.5% wide ' + JSON.stringify(io));
  await (await dw()).screenshot({ path: `${O}/clips.png` });
  // SKINS
  await ev(() => P.skinSave({ name: 'Hot Pink', from: 'classic', base: 'classic', baseName: 'SlopAMP Classic', vars: { '--green': '#ff509f' }, sw: ['#2b2e3a', '#3b3f50', '#000000', '#ff509f', '#000000', '#ff7ab8'], slug: null }));
  await lib('skins'); await ev(() => sklRefresh()); await view('preview'); await sleep(400);
  const sk = await ev(() => ({ n: WM.$$('#sklList .skl-tile').length, on: WM.$$('#sklList .skl-tile .skt-on').length, onId: WM.$('#sklList .skt-on').closest('.skl-tile').dataset.id }));
  ok(sk.n === 11 && sk.on === 1 && sk.onId === 'classic', 'SKINS: 11 skin tiles, ✓ ON on Classic ' + JSON.stringify(sk));
  await (await dw()).screenshot({ path: `${O}/skins.png` });
  { const sw = await dw(); const rb = await ev(() => { const r = WM.$('#sklList .skl-tile[data-id="red"] .skt-pv').getBoundingClientRect(); return { x: r.left + 12, y: r.top + 12 }; }); await sw.mouse.dblclick(rb.x, rb.y); await sleep(800); }
  ok((await ev(() => WM.skins.current)) === 'red', 'double-click a skin tile puts it on');
  await ev(() => WM.skins.apply('classic')); await sleep(400);
  // ================= a big Library: only what's on screen is made
  const big = `${DL}/Video`; const src = `${M}/Ocean Ambience 10 hours [a1B2c3D4e5F].mp4`;
  for (let i = 0; i < N_BIG; i++) fs.copyFileSync(src, `${big}/Copy ${String(i).padStart(4, '0')} [c${String(i).padStart(10, '0')}].mp4`);
  await ev(() => WM.$('#dlmDlg').close());
  const before = thumbFiles().length;
  let t0 = Date.now(); await lib('video'); const tOpen = Date.now() - t0;
  const nt = await ev(() => WM.$$('#dlmGrid .lt').length);
  ok(nt === N_BIG + 6, `${N_BIG + 6} tiles (${tOpen} ms to open VIDEO in Preview)`);
  await sleep(6000);
  const made = thumbFiles().length - before;
  ok(made > 0 && made < 60, `only the tiles on screen got pictures (${made} made of ${nt})`);
  t0 = Date.now(); await ev(() => { const sc = WM.$('.dlm-scroll'); sc.scrollTop = sc.scrollHeight; });
  ok(await until(async () => (await ev(() => { const ts = WM.$$('#dlmGrid .lt'); return ts[ts.length - 1].querySelector('.lt-im').classList.contains('got'); }))), 'scrolled to the end: the last tiles get their pictures');
  const tEnd = Date.now() - t0; const made2 = thumbFiles().length - before;
  ok(made2 < 120, `the middle was skipped: ${made2} pictures made in all (${tEnd} ms for the last ones)`);
  await ev(() => { LP.pics.clear(); LP.tiles.clear(); WM.$('#dlmDlg').close(); });
  t0 = Date.now(); await lib('video'); await ev(() => { const sc = WM.$('.dlm-scroll'); sc.scrollTop = sc.scrollHeight; });
  ok(await until(async () => (await ev(() => { const ts = WM.$$('#dlmGrid .lt'); return ts[ts.length - 1].querySelector('.lt-im').classList.contains('got'); })), 5000), `opened again: cached pictures (${Date.now() - t0} ms to the end of ${nt} tiles)`);
  console.log(`PERF open=${tOpen}ms tiles=${nt} firstScreen=${made} end=${tEnd}ms total=${made2}`);
  await ev(() => WM.$('#dlmDlg').close());
  // ================= compact History tabs
  await ev(() => { histEnsureTab('yt'); histEnsureTab('x'); const yt = histTab('yt'); for (let i = 0; i < 12; i++) yt.items.push({ id: nid(), type: 'youtube', url: 'https://www.youtube.com/watch?v=UyhAC0AZM4Y', vid: 'UyhAC0AZM4Y', title: 'Night Drive', at: Date.now() });
    switchTab(S.tabs.findIndex(t => t.name === 'Main')); renderTabs(); });
  await sleep(300);
  const tabs = () => ev(() => [...WM.$$('#tabStrip .ptab')].map(el => ({ nm: el.querySelector('.nm').textContent, ct: getComputedStyle(el.querySelector('.ct')).display !== 'none', compact: el.classList.contains('compact'), clock: !!el.querySelector('.clk svg'), tip: el.title.split('\n')[0], w: Math.round(el.getBoundingClientRect().width) })));
  let tb = await tabs();
  const yt = tb.find(t => t.tip.startsWith('YouTube History')), xx = tb.find(t => t.tip.startsWith('X History'));
  ok(yt.nm === 'YT' && !yt.ct && yt.clock && yt.compact && yt.tip === 'YouTube History — 12 videos', 'not selected: 🕘 YT, no count; the tooltip has the full name and count ' + JSON.stringify(yt));
  ok(xx.nm === 'X' && !xx.ct && xx.clock, 'X History: 🕘 X ' + JSON.stringify(xx));
  ok(tb.filter(t => !t.compact).every(t => t.ct), 'ordinary tabs keep their counts');
  const wC = yt.w;
  await ev(() => switchTab(S.tabs.findIndex(t => t.id === HK.yt.id))); await sleep(300);
  tb = await tabs(); const ytS = tb.find(t => t.tip.startsWith('YouTube History'));
  ok(ytS.nm === 'YT' && ytS.ct && !ytS.compact && tb.find(t => t.tip.startsWith('X History')).nm === 'X', 'selected: "YT 12" (2.9 #5: always "YT", the count shows when selected); X stays compact ' + JSON.stringify(ytS));
  ok(ytS.w > wC, `not selected, it is narrower: no count (${wC} px vs ${ytS.w} px)`);
  const plw = async () => { for (const w of app.windows()) if (await w.evaluate(() => document.body.classList.contains('panel') && !!document.querySelector('#list')).catch(() => false)) return w; return win; };
  await app.evaluate(async ({ BrowserWindow }) => { for (const b of BrowserWindow.getAllWindows()) if (await b.webContents.executeJavaScript("document.body.classList.contains('panel') && !!document.querySelector('#list')").catch(() => false)) b.setBounds({ ...b.getBounds(), width: 300 }); });
  await ev(() => { for (const n of ['Road Trip 2', 'Chill']) newTab(n); switchTab(S.tabs.findIndex(t => t.name === 'Main')); }); await sleep(800);
  const pl = await plw();
  await pl.screenshot({ path: `${O}/tabs-narrow.png`, clip: { x: 0, y: 0, width: 300, height: 70 } });
  // ================= tab contrast in every skin (H)
  const lum = (c) => { const p = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bad = [];
  for (const id of await ev(() => WM.skins.list.map(s => s.id))) {
    await ev((id) => WM.skins.apply(id), id); await sleep(900); await pl.waitForFunction((id) => document.body.classList.contains('skin-' + id), id);
    const c = await pl.evaluate(() => [...document.querySelectorAll('#tabStrip .ptab:not(.on)')].map(el => { const bg = getComputedStyle(el).backgroundColor, nm = getComputedStyle(el.querySelector('.nm')).color, ct = el.querySelector('.ct'); return { t: el.querySelector('.nm').textContent, bg, nm, ct: getComputedStyle(ct).display === 'none' ? null : getComputedStyle(ct).color }; }));
    for (const x of c) { const r1 = ratio(x.nm, x.bg), r2 = x.ct ? ratio(x.ct, x.bg) : 99; if (r1 < 4.5 || r2 < 3) bad.push({ id, t: x.t, name: r1.toFixed(2), count: r2.toFixed(2) }); }
    if (id === 'chrome' || id === 'pocket') await pl.screenshot({ path: `${O}/tabs-${id}.png`, clip: { x: 0, y: 0, width: 300, height: 70 } });
  }
  ok(!bad.length, 'inactive tab names ≥ 4.5:1 and counts ≥ 3:1 in all 10 skins ' + JSON.stringify(bad));
  await ev(() => WM.skins.apply('classic')); await sleep(300);
  // ================= remembered after a restart
  await ev(() => saveNow()); await sleep(600); await app.close();
  ({ app, win, errs } = await launch(H, { keep: true })); ev = (f, a) => win.evaluate(f, a);
  const lb = await ev(() => S.lib);
  ok(lb.modes.video === 'preview' && lb.modes.audio === 'preview' && !lb.modes.all && lb.tip === 1, 'after a restart: Preview kept per section, the tip stays gone ' + JSON.stringify(lb));
  // ================= MP3 downloads ask yt-dlp for the cover art
  const { Downloader } = require(path.join(APP, 'src', 'downloader.js'));
  const d = new Downloader({ bundledDir: '/tmp', dataDir: path.join(os.tmpdir(), 'slopamp-test-270dl'), ffmpegDir: '/ff', log: () => {}, emit: () => {}, getDirs: () => ({ audio: path.join(os.tmpdir(), 'slopamp-test-270dl/a'), video: path.join(os.tmpdir(), 'slopamp-test-270dl/v') }), getState: () => ({}), setState: () => {} });
  const aa = d.args({ kind: 'audio', url: 'https://www.youtube.com/watch?v=UyhAC0AZM4Y', vid: 'UyhAC0AZM4Y' }), va = d.args({ kind: 'video', quality: 'xready', url: 'https://www.youtube.com/watch?v=UyhAC0AZM4Y', vid: 'UyhAC0AZM4Y' });
  ok(aa.includes('--embed-thumbnail') && aa[aa.indexOf('--convert-thumbnails') + 1] === 'jpg' && !va.includes('--embed-thumbnail'), 'MP3 downloads: --embed-thumbnail --convert-thumbnails jpg (videos unchanged)');
  ok(!errs.length, 'no page errors ' + JSON.stringify(errs));
  await app.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL OK'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
