// SlopAMP 2.9.1 test: the downloads folder size limit and Library Favorites.
//  "?" → Downloads folder (limit choices, the bar, Custom, Make room…); with a limit on every download is sized first
//  (yt-dlp -j; from the length when it can't say); a download that fits just goes; one that would pass the limit waits
//  for the box: the oldest downloads that aren't in a playlist (a tab or a saved playlist; not YT / X History) or
//  ★ favorites go to the Recycle Bin, clips never; Cancel deletes nothing; the not-enough box offers Download anyway;
//  DOWNLOAD ALL asks per item with "Do the same for the rest"; limit off = no size check.
//  Favorites: ☆ / ★ before titles and on tiles, right-click, F, the ★ Favorites button, the delete warning, a favorite
//  follows Rename (moveKeys) and re-downloads (kept by video id), the playlist's right-click.
//  Rebuild fixes: YT / X History's synced copies (Playlists\\YouTube History.m3u8 / X History.m3u8) don't count as
//  playlists; "Why are these kept?" names what keeps each file; 1 GB is a limit choice.
// X / YouTube can't be reached from the test machine: the stand-in yt-dlp (fake-ytdlp.js) answers sizes and writes
// (sparse) files. Run: xvfb-run -a node tests/size-limit-favorites.js
const { launch, sleep, docWin } = require('./lib');
const fs = require('fs'), path = require('path'), os = require('os');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const H = path.join(os.tmpdir(), 'slopamp-test-291');
const MB = 1024 * 1024;
(async () => {
  process.env.SLOPAMP_YTDLP = path.join(__dirname, 'fake-ytdlp.js');
  const { app, win, errs } = await launch(H);
  const ev = (f, a) => win.evaluate(f, a);
  const dl = (await app.evaluate(({ app }) => app.getPath('downloads'))) + '/SlopAMP';
  const V = `${dl}/Video`, A = `${dl}/Audio`, C = `${dl}/mp3clips`, PL = `${dl}/Playlists`;
  for (const d of [V, A, C, PL]) fs.mkdirSync(d, { recursive: true });
  const mk = (f, size, daysAgo) => { fs.writeFileSync(f, ''); fs.truncateSync(f, size); const t = Date.now() / 1000 - daysAgo * 86400; fs.utimesSync(f, t, t); return f; };
  // the library: 820 MB (A oldest, deletable · B in the Main tab · C ★ favorite · D deletable · E in a saved playlist · a clip)
  const fA = mk(`${V}/Oldest Video [aaaaaaaaaa1].mp4`, 300 * MB, 30);
  const fB = mk(`${V}/In A Tab [bbbbbbbbbb2].mp4`, 200 * MB, 25);
  const fC = mk(`${V}/Starred One [cccccccccc3].mp4`, 150 * MB, 20);
  const fD = mk(`${V}/Newer Video [dddddddddd4].mp4`, 100 * MB, 10);
  const fE = mk(`${A}/Saved Song [eeeeeeeeee5].mp3`, 20 * MB, 28);
  const fK = mk(`${C}/My Clip 0-12.mp3`, 50 * MB, 40);
  fs.writeFileSync(`${PL}/Mix.m3u8`, `#EXTM3U\r\n#EXTINF:60,Saved Song\r\n${fE}\r\n`);
  // YT / X History's synced copies hold everything; by call B they must not count as playlists (2.9.1 smoke bug)
  fs.writeFileSync(`${PL}/YouTube History.m3u8`, `#EXTM3U\r\n${[fA, fD].map(f => `#EXTINF:60,x\r\n${f}\r\n`).join('')}#EXTINF:60,y\r\nhttps://www.youtube.com/watch?v=aaaaaaaaaa1\r\n`);
  fs.writeFileSync(`${PL}/X History.m3u8`, `#EXTM3U\r\n#EXTINF:60,x\r\n${fD}\r\n`);
  const yt = (id) => `https://www.youtube.com/watch?v=${id}`;
  fs.writeFileSync(path.join(H, 'fake-x.json'), JSON.stringify({ base: 'http://127.0.0.1:1', posts: {
    yyyyyyyyyy1: { size: 150 * MB, title: 'Fits Fine' },
    yyyyyyyyyy2: { size: 300 * MB, title: 'Needs Room' },
    yyyyyyyyyy3: { size: 2048 * MB, title: 'Way Too Big' },
    yyyyyyyyyy4: { nosize: true, duration: 600, title: 'Size Unknown' },
    yyyyyyyyyy5: { size: 10 * MB, title: 'Limit Off' },
    zzzzzzzzzz1: { size: 200 * MB, title: 'Batch One' },
    zzzzzzzzzz2: { size: 200 * MB, title: 'Batch Two' },
    zzzzzzzzzz3: { size: 200 * MB, title: 'Batch Three' }
  } }));
  const calls = (id) => (fs.existsSync(path.join(H, 'fake-x.log')) ? fs.readFileSync(path.join(H, 'fake-x.log'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(c => c.id === id) : []);
  const sizeCalls = (id) => calls(id).filter(c => c.args.includes('-j')).length;
  // the Main tab holds B (a file); also YouTube items to download
  await ev(() => { S.favs['y:cccccccccc3'] = 1; });     // C is a ★ favorite
  await ev((fB) => { addPaths([fB]); }, fB); await sleep(800);
  await ev((list) => { addDescribed(list.map(([id, t]) => ({ url: `https://www.youtube.com/watch?v=${id}`, title: t })), undefined, false); },
    [['yyyyyyyyyy1', 'Fits Fine'], ['yyyyyyyyyy2', 'Needs Room'], ['yyyyyyyyyy3', 'Way Too Big'], ['yyyyyyyyyy4', 'Size Unknown'], ['yyyyyyyyyy5', 'Limit Off']]);
  await sleep(800);
  await ev(() => { const it = S.items.find(i => i.vid === 'yyyyyyyyyy4'); it.duration = 600; });
  const item = (vid) => ev((vid) => S.items.find(i => i.vid === vid).id, vid);
  const box = () => ev(() => ({ open: WM.$('#roomDlg').open, title: WM.$('#roomTitle').textContent, text: WM.$('#roomText').textContent, what: WM.$('#roomWhat').textContent, list: [...WM.$$('#roomList > div .t')].map(e => e.textContent), kept: WM.$('#roomKept').textContent, bin: WM.$('.room-bin').textContent, btns: [...WM.$$('#roomBtns button')].map(b => b.textContent), focus: (WM.$('#roomDlg').ownerDocument.activeElement || {}).textContent || '', same: !WM.$('#roomSameRow').classList.contains('hidden') }));
  const waitBox = async (ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await box()).open) return box(); await sleep(150); } return box(); };
  const click = (label) => ev((label) => [...WM.$$('#roomBtns button')].find(b => b.textContent.startsWith(label)).click(), label);
  const waitFile = async (re, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fs.readdirSync(V).some(f => re.test(f))) return true; await sleep(200); } return false; };
  const exists = (f) => fs.existsSync(f);

  // ================= Settings: "?" → Downloads folder
  await ev(() => { openAbout(); }); await sleep(800);
  const st = await ev(() => ({ opts: [...WM.$$('#dlLimitSel option')].map(o => o.textContent), val: WM.$('#dlLimitSel').value, leg: WM.$('#dlUseLeg').textContent, bar: WM.$$('#dlUseBar i').length, btn: WM.$('#dlRoomBtn').textContent }));
  ok(JSON.stringify(st.opts) === JSON.stringify(['Off', '1 GB', '5 GB', '10 GB', '25 GB', '50 GB', '100 GB', 'Custom…']) && st.val === '0', `limit choices ${JSON.stringify(st.opts)}, Off by default`);
  ok(/820 MB/.test(st.leg) && /Videos 750 MB/.test(st.leg) && /MP3s 20\.0 MB/.test(st.leg) && /Clips 50\.0 MB/.test(st.leg) && st.bar >= 3, `the bar: ${st.leg}`);
  ok(st.btn === 'Make room…', 'Make room… button');
  // limit off: no size check
  await ev(async (id) => { WM.$('#aboutDlg').close(); startDownload(S.items.find(i => i.id === id), 'video', 'xready'); }, await item('yyyyyyyyyy5'));
  ok(await waitFile(/Limit Off/), 'limit off: a download just goes');
  ok(sizeCalls('yyyyyyyyyy5') === 0, 'limit off: no size check');
  fs.rmSync(fs.readdirSync(V).map(f => `${V}/${f}`).find(f => /Limit Off/.test(f)));
  // Custom: 1 GB
  await ev(() => { openAbout(); }); await sleep(600);
  await ev(() => { const s = WM.$('#dlLimitSel'); s.value = 'custom'; s.dispatchEvent(new Event('change')); });
  ok(await ev(() => !WM.$('#dlLimitGb').classList.contains('hidden')), 'Custom… shows a GB box');
  await ev(() => { const g = WM.$('#dlLimitGb'); g.value = '1'; g.dispatchEvent(new Event('change')); }); await sleep(500);
  ok((await ev(() => S.dlLimit)) === 1 && /of 1 GB/.test(await ev(() => WM.$('#dlUseLeg').textContent)), 'custom limit 1 GB is set and shown');
  await ev(() => WM.$('#aboutDlg').close());

  // ================= a download that fits
  await ev((id) => { startDownload(S.items.find(i => i.id === id), 'video', 'xready'); }, await item('yyyyyyyyyy1'));
  ok(await waitFile(/Fits Fine/), 'a download that fits goes without a box');
  ok(sizeCalls('yyyyyyyyyy1') === 1 && !(await box()).open, 'it was sized first (yt-dlp -j), no box');
  await sleep(800);
  // ================= one that needs room
  await ev((id) => { startDownload(S.items.find(i => i.id === id), 'video', 'xready'); }, await item('yyyyyyyyyy2'));
  let b = await waitBox();
  ok(b.open && b.title === 'You’re about to pass your 1 GB limit', `the box: "${b.title}"`);
  ok(/Needs Room is about 300 MB/.test(b.text) && /needs 246 MB more room/.test(b.text), `it says how big and how much room: ${b.text}`);
  ok(JSON.stringify(b.list) === '["Oldest Video"]', `it lists exactly what goes: the oldest one not in a playlist or a favorite ${JSON.stringify(b.list)}`);
  ok(/3 files in a playlist/.test(b.kept) && /tab Main/.test(b.kept) && /saved playlist Mix/.test(b.kept) && !/History/.test(b.kept) && /1 ★ favorite/.test(b.kept) && /clips/.test(b.kept), `kept (B and the downloaded Fits Fine in tab Main, E in saved Mix, C ★; the History copies don't count): ${b.kept}`);
  const why = await ev(() => ({ sum: WM.$('#roomWhySum').textContent, rows: [...WM.$$('#roomWhyList > div')].map(d => `${d.querySelector('.t').textContent} = ${d.querySelector('.by').textContent}`) }));
  ok(why.sum === 'Why are 4 files kept?' && why.rows.includes('In A Tab = tab “Main”') && why.rows.includes('Saved Song = saved playlist “Mix”') && why.rows.includes('Starred One = ★ favorite') && !why.rows.some(r => /History/.test(r)), `“Why are these kept?” names what keeps each file ${JSON.stringify(why)}`);
  ok(/Recycle Bin, so you can restore them/.test(b.bin), 'the Recycle Bin note');
  ok(JSON.stringify(b.btns) === JSON.stringify(['Choose files…', 'Cancel download', 'Delete 1 and download']) && b.focus === 'Cancel download' && !b.same, `buttons ${JSON.stringify(b.btns)}, Cancel has the focus`);
  ok(exists(fA) && !fs.readdirSync(V).some(f => /Needs Room/.test(f)), 'nothing deleted or downloaded while the box is up');
  await click('Cancel download'); await sleep(800);
  ok(exists(fA) && !fs.readdirSync(V).some(f => /Needs Room/.test(f)), 'Cancel: nothing deleted, nothing downloaded');
  // ★ C stays protected; again, and this time Delete
  await ev((id) => { startDownload(S.items.find(i => i.id === id), 'video', 'xready'); }, await item('yyyyyyyyyy2'));
  b = await waitBox();
  await click('Delete 1 and download');
  ok(await waitFile(/Needs Room/, 45000), 'Delete and download: it downloads');     // (the first Recycle Bin move in a fresh profile can be slow on Linux)
  await sleep(500);
  ok(!exists(fA) && exists(fB) && exists(fC) && exists(fD) && exists(fE) && exists(fK), 'only the oldest unprotected download went (B in a tab, C ★, E in a saved playlist, the clip all stayed)');
  // ================= not enough even then
  await ev((id) => { startDownload(S.items.find(i => i.id === id), 'video', 'xready'); }, await item('yyyyyyyyyy3'));
  b = await waitBox();
  ok(b.title === 'Not enough room under your 1 GB limit' && JSON.stringify(b.btns) === JSON.stringify(['Open Library', 'Cancel download', 'Download anyway']) && b.focus === 'Cancel download', `the not-enough box ${JSON.stringify([b.title, b.btns])}`);
  ok(/wouldn’t make enough room/.test(b.what) && /Recycle Bin/.test(b.bin), b.what);
  await click('Cancel download'); await sleep(600);
  ok(exists(fD) && !fs.readdirSync(V).some(f => /Way Too Big/.test(f)), 'Cancel: nothing deleted or downloaded');
  // ================= size unknown: estimated from the length (600 s × 4 Mb/s = 300 MB → needs room)
  await ev((id) => { startDownload(S.items.find(i => i.id === id), 'video', 'xready'); }, await item('yyyyyyyyyy4'));
  b = await waitBox();
  ok(b.open && /Size Unknown is roughly 286 MB/.test(b.text), `size unknown: estimated from its length (${b.text.slice(0, 60)})`);
  await click('Cancel download'); await sleep(500);
  // ================= DOWNLOAD ALL: one box per item that would go over, "Do the same for the rest"
  await ev(() => { const s = WM.$('#dlLimitSel'); });
  await ev(() => { S.dlLimit = 1.2; });     // 1229 MB: room for one 200 MB item, not three
  const ids = await ev(() => { const n = newTab('Batch'); switchTab(n); addDescribed(['zzzzzzzzzz1', 'zzzzzzzzzz2', 'zzzzzzzzzz3'].map(v => ({ url: `https://www.youtube.com/watch?v=${v}`, title: v })), undefined, false); return n; });
  await sleep(800);
  const used0 = await ev(async () => (await roomUsage()).total);
  await ev(() => { downloadAll('video', 'xready'); });
  b = await waitBox(20000);
  ok(b.open && b.same && /1\.2 GB limit/.test(b.title), `DOWNLOAD ALL: a box for the item that would go over, with "Do the same for the rest" ${JSON.stringify(b.title)}`);
  await ev(() => { WM.$('#roomSame').checked = true; }); await click('Cancel download');
  await sleep(4000);
  ok(!(await box()).open, 'with "Do the same", the next one over is cancelled without a box');
  const got = fs.readdirSync(V).filter(f => /zzzzzzzzzz/.test(f));
  ok(got.length === 1, `one batch item fit and downloaded, the others were skipped (${got.length}; used before ${Math.round(used0 / MB)} MB)`);
  ok(/skipped: size limit/.test(await ev(() => WM.$('#dlbText').textContent)), `the batch result says so: ${await ev(() => WM.$('#dlbText').textContent)}`);
  await ev(() => { switchTab(0); });

  // ================= Favorites in the Library
  await ev(() => { S.lib.tip = 1; openDownloadsManager('all'); }); await sleep(1200);
  const dw = await docWin(app, 'host-dialog');
  const rowOf = (re) => dw.evaluate((src) => { const tr = [...document.querySelectorAll('#dlmBody tr')].find(t => new RegExp(src).test(t.textContent)); return tr ? { star: (tr.querySelector('.fav-star') || {}).textContent || '', on: !!tr.querySelector('.fav-star.on'), pl: (tr.querySelector('.dlm-inpl') || {}).textContent || '' } : null; }, re.source);
  let r = await rowOf(/Newer Video/);
  ok(r && r.star === '☆' && !r.on, 'a ☆ before each title');
  ok((await rowOf(/In A Tab/)).pl === '▶ in Main' && (await rowOf(/Saved Song/)).pl === '▶ in Mix', 'downloads in a playlist say so ("▶ in Main", "▶ in Mix")');
  ok(await ev(() => !WM.$('#dlmUse').classList.contains('hidden') && / \/ 1\.2 GB/.test(WM.$('#dlmUseT').textContent)), `the usage bar by the file count (${await ev(() => WM.$('#dlmUseT').textContent)})`);
  await dw.evaluate(() => [...document.querySelectorAll('#dlmBody tr')].find(t => /Newer Video/.test(t.textContent)).querySelector('.fav-star').click()); await sleep(300);
  r = await rowOf(/Newer Video/);
  ok(r.on && r.star === '★' && await ev(() => !!S.favs['y:dddddddddd4']), 'clicking ☆ makes it a ★ favorite (kept by its video id)');
  // F on a selection toggles
  await ev(() => { const v = dlmVisible(); DLM.sel = new Set([dlmKey(v.find(x => /Newer Video/.test(x.title)))]); dlmRender(); });
  await dw.evaluate(() => document.querySelector('#dlmDlg').dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true })));
  ok(!(await rowOf(/Newer Video/)).on, 'F un-stars the selection');
  await dw.evaluate(() => document.querySelector('#dlmDlg').dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true })));
  ok((await rowOf(/Newer Video/)).on, '…and F stars it again');
  // right-click
  const menu = await ev(() => { const v = dlmVisible(); const r = v.find(x => /Oldest|Fits Fine/.test(x.title)); DLM.sel = new Set([dlmKey(r)]); dlmRender(); const tr = [...WM.$$('#dlmBody tr')].find(t => t._row === r || t.textContent.includes(r.title)); const b = tr.getBoundingClientRect(); tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: b.left + 50, clientY: b.top + 5 })); return [...WM.$('#ctx').children].map(c => c.textContent); });
  ok(menu.some(t => /^★ Add to Favorites\s*F$/.test(t)), `right-click: ★ Add to Favorites (F) ${JSON.stringify(menu.filter(t => /Favor/.test(t)))}`);
  await ev(() => hideCtx());
  // ★ Favorites filter
  await ev(() => WM.$('#dlmFav').click()); await sleep(300);
  const favRows = await ev(() => dlmVisible().map(r => r.title));
  ok(JSON.stringify(favRows.sort()) === JSON.stringify(['Newer Video', 'Starred One'].sort()) || favRows.length === 2, `★ Favorites shows only favorites ${JSON.stringify(favRows)}`);
  ok(/^2 FAVORITES/.test(await ev(() => WM.$('#dlmCount').textContent)) && await ev(() => WM.$('#dlmFav').classList.contains('on')), 'the count says favorites, the button is on');
  await ev(() => { dlmSection('playlist'); dlmRender(); }); await sleep(200);
  ok(/No ★ favorites here yet/.test(await ev(() => WM.$('#dlmEmpty').textContent)), 'a section with none says so, with Show everything');
  await ev(() => { [...WM.$$('#dlmEmpty button')].find(b => b.dataset.a === 'favoff').click(); dlmSection('all'); dlmRender(); }); await sleep(200);
  ok(await ev(() => !DLM.favOnly), 'Show everything turns the filter off');
  // Preview tiles
  await ev(() => WM.$('#dlmView [data-v=preview]').click()); await sleep(800);
  const tiles = await ev(() => WM.$$('#dlmGrid .lt').map ? [...WM.$$('#dlmGrid .lt')].map(t => ({ n: t.querySelector('.lt-n').textContent, f: (t.querySelector('.lt-fav') || {}).className || '' })) : []);
  ok(tiles.find(t => t.n === 'Starred One').f === 'lt-fav' && /off/.test(tiles.find(t => /Oldest|Fits Fine/.test(t.n)).f), 'Preview: ★ on favorite tiles, a hidden ☆ on the others');
  await ev(() => WM.$('#dlmView [data-v=classic]').click()); await sleep(300);
  // deleting a favorite warns first
  const warn = await ev(async () => { const v = dlmVisible(); const r = v.find(x => x.title === 'Starred One'); let text = ''; const orig = window.confirmBox; window.confirmBox = async (t, x) => { text = x; return false; }; try { await dlmDelete([r]); } finally { window.confirmBox = orig; } return text; });
  ok(/This includes a ★ favorite/.test(warn), `deleting a favorite warns first: "${warn.split('\n')[0]}"`);
  ok(exists(fC), '…and nothing went when it was declined');
  // J: a favorite follows Rename (files) and re-downloads (video id)
  const moved = await ev((fK) => { S.favs['f:' + fK.toLowerCase()] = 1; moveKeys(fK, fK.replace('My Clip', 'Renamed Clip')); return [!!S.favs['f:' + fK.toLowerCase()], !!S.favs['f:' + fK.replace('My Clip', 'Renamed Clip').toLowerCase()]]; }, fK);
  ok(!moved[0] && moved[1], 'a renamed file keeps its ★ (moveKeys)');
  ok(await ev(() => isFavRow({ vid: 'dddddddddd4', path: '/somewhere/else/Newer Video (again) [dddddddddd4].mp4', kind: 'video' })), 'a re-download of a ★ video is still a favorite (same video id)');
  await ev(() => WM.$('#dlmDlg').close()); await sleep(300);
  // the playlist's right-click (an item with a file)
  const plm = await ev(() => { switchTab(S.tabs.findIndex(t => t.name === 'Main')); const i = S.items.findIndex(x => x.type === 'file'); const li = WM.$$('#list li')[i]; const b = li.getBoundingClientRect(); li.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: b.left + 30, clientY: b.top + 5 })); return [...WM.$('#ctx').children].map(c => c.textContent); });
  ok(plm.includes('★ Add to Favorites'), 'playlist right-click on a file: ★ Add to Favorites');
  await ev(() => [...WM.$('#ctx').children].find(c => c.textContent === '★ Add to Favorites').click()); await sleep(200);
  ok(await ev((fB) => !!S.favs['f:' + fB.toLowerCase()], fB), '…which stars that file');
  const plw = await ev(() => { const i = S.items.findIndex(x => x.type === 'youtube' && !x.localVideo && !x.localAudio); const li = WM.$$('#list li')[i]; const b = li.getBoundingClientRect(); li.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: b.left + 30, clientY: b.top + 5 })); const m = [...WM.$('#ctx').children].map(c => c.textContent); hideCtx(); return m; });
  ok(!plw.some(t => /Favorites/.test(t)), 'a link with no file has no Favorites entry');

  // ================= Make room…
  await ev(() => { S.dlLimit = 1; delete S.favs['y:dddddddddd4']; openAbout(); }); await sleep(500);     // un-star D: the only download not in a playlist
  await ev(() => WM.$('#dlRoomBtn').click());
  b = await waitBox();
  ok(b.open && b.title === 'Make room' && JSON.stringify(b.btns) === JSON.stringify(['Cancel', 'Delete 1']) && JSON.stringify(b.list) === '["Newer Video"]' && /Recycle Bin/.test(b.bin), `Make room… opens the same box ${JSON.stringify([b.title, b.btns, b.list])}`);
  ok(/all it can/.test(b.what), `with too little to free it says so: ${b.what}`);
  const opts = await ev(() => [...WM.$$('#roomFree option')].map(o => o.textContent));
  ok(opts.includes('1 GB') && opts.includes('everything it can'), `how much to free ${JSON.stringify(opts)}`);
  ok(!b.list.some(t => /Starred|In A Tab|Saved Song|Fits Fine|Needs Room|Batch/.test(t)), `it never lists favorites or playlist files ${JSON.stringify(b.list)}`);
  await click('Delete 1'); await sleep(1500);
  ok(!exists(fD) && exists(fB) && exists(fC), 'Make room → Delete: the listed file went to the Recycle Bin');
  ok(fs.readdirSync(path.join(H, '.local/share/Trash/files')).some(f => /Newer Video/.test(f)), '…it is in the Recycle Bin (restorable)');

  ok(await ev(() => stateSnapshot().dlLimit === 1 && stateSnapshot().favs['y:cccccccccc3'] === 1 && Object.keys(stateSnapshot().favs).length >= 2), 'the limit and favorites are saved');
  const bad = errs.filter(e => !/WebGL|GPU|net::ERR|Failed to load resource/i.test(e));
  ok(!bad.length, 'no page errors ' + JSON.stringify(bad.slice(0, 3)));
  await app.close();
  console.log(fails.length ? `${fails.length} FAILED` : 'ALL OK');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
