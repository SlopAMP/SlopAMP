// 2.9.3 (late fixes): an empty saved playlist opens as an empty tab, no error (LOAD, the Library's PLAYLISTS
// Open in new tab / double-click, Classic and Preview views); "?" has Check for updates again (also still in Settings).
// Run (Linux, xvfb): SLOPAMP_ELECTRON=… SLOPAMP_APP=… xvfb-run -a node tests/empty-playlist-about-293.js
'use strict';
const { launch, sleep } = require('./lib');
const fs = require('fs'), path = require('path'), os = require('os');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const H = path.join(os.tmpdir(), 'slopamp-test-293e');

(async () => {
  const { app, win, errs } = await launch(H);
  const ev = (f, a) => win.evaluate(f, a);
  const PL = (await app.evaluate(({ app }) => app.getPath('downloads'))) + '/SlopAMP/Playlists';
  fs.mkdirSync(PL, { recursive: true });
  const tabs = () => ev(() => S.tabs.filter(t => !isHist(t)).map(t => `${t.name}:${t.items.length}`).join(' '));
  const toastTxt = () => ev(() => WM.$('#toast').classList.contains('hidden') ? '' : WM.$('#toast').textContent);
  // LOAD's file picker answers with `f` (main process stand-in for the Windows dialog)
  const pick = (f) => app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, f);

  // ================= the captain's case: empty Watch Later, QUICK SAVE, close the tab, open it again
  await ev(() => { const n = newTab('Watch Later'); switchTab(n); addDescribed([{ url: 'https://www.youtube.com/watch?v=wwwwwwwwww1', title: 'W1' }], undefined, false); });
  await sleep(300);
  await ev(() => { S.items.splice(0); renderList(); });
  await ev(() => quickSavePlaylist()); await sleep(600);
  const wl = `${PL}/Watch Later.m3u8`;
  ok(fs.existsSync(wl) && !/W1/.test(fs.readFileSync(wl, 'utf8')), 'QUICK SAVE wrote an empty Watch Later.m3u8');
  await ev(() => { closeTab(S.tab); }); await sleep(400);
  ok(!(await tabs()).includes('Watch Later'), 'the tab is closed');
  // LOAD
  await pick(wl);
  await ev(() => WM.$('#pLoad').click()); await sleep(800);
  let st = await ev(() => ({ shown: S.tabs[S.tab].name, n: S.items.length, box: WM.$('#loadDlg').open }));
  ok(st.shown === 'Watch Later' && st.n === 0 && !st.box, `LOAD → an empty "Watch Later" tab, on screen, no box ${JSON.stringify(st)}`);
  let tt = await toastTxt();
  ok(tt === 'Opened Watch Later.m3u8: it’s empty' && !/empty or has nothing/.test(tt), `…and it says so, no error: ${tt}`);
  await ev(() => switchTab(S.tabs.findIndex(t => t.name === 'Main')));
  await ev(() => WM.$('#pLoad').click()); await sleep(600);
  ok(await ev(() => S.tabs.filter(t => t.name === 'Watch Later').length) === 1 && await ev(() => S.tabs[S.tab].name === 'Watch Later') && /already open/.test(await toastTxt()), 'LOAD again: the open tab comes up, no copy');
  ok(await ev(() => stateSnapshot().tabs.some(t => t.name === 'Watch Later' && t.items.length === 0)), 'the empty tab is kept with the session');
  await ev(() => closeTab(S.tabs.findIndex(t => t.name === 'Watch Later'))); await sleep(300);
  // other empty files: a zero-byte .m3u, an empty .pls
  fs.writeFileSync(`${PL}/Zero.m3u`, '');
  fs.writeFileSync(`${PL}/Nothing.pls`, '[playlist]\r\nNumberOfEntries=0\r\nVersion=2\r\n');
  for (const [f, n] of [[`${PL}/Zero.m3u`, 'Zero'], [`${PL}/Nothing.pls`, 'Nothing']]) {
    await pick(f); await ev(() => WM.$('#pLoad').click()); await sleep(600);
    ok(await ev((n) => S.tabs[S.tab].name === n && S.items.length === 0, n), `LOAD ${path.basename(f)} → an empty "${n}" tab`);
  }
  // a playlist whose lines SlopAMP can't play still says so (it isn't empty)
  fs.writeFileSync(`${PL}/notes.txt`, 'hello');
  fs.writeFileSync(`${PL}/Odd.m3u8`, `#EXTM3U\r\n${PL}/notes.txt\r\n`);
  const before = await tabs();
  await pick(`${PL}/Odd.m3u8`); await ev(() => WM.$('#pLoad').click()); await sleep(600);
  ok(await tabs() === before && /nothing SlopAMP can play/.test(await toastTxt()), `a playlist with nothing playable: no tab, it says so (${await toastTxt()})`);
  // a normal playlist still loads as before (into the empty tab on screen)
  fs.writeFileSync(`${PL}/Two.m3u8`, '#EXTM3U\r\n#EXTINF:60,One\r\nhttps://www.youtube.com/watch?v=tttttttttt1\r\n#EXTINF:60,Two\r\nhttps://www.youtube.com/watch?v=tttttttttt2\r\n');
  await pick(`${PL}/Two.m3u8`); await ev(() => WM.$('#pLoad').click()); await sleep(800);
  ok(await ev(() => S.items.map(i => i.title).join() === 'One,Two') && /Loaded 2 items/.test(await toastTxt()), 'a playlist with items loads as before');

  // ================= Library → PLAYLISTS
  await ev(() => { for (const n of ['Zero', 'Nothing']) { const i = S.tabs.findIndex(t => t.name === n); if (i >= 0) removeTabAt(i); } });
  await ev(() => { openDownloadsManager('playlist'); }); await sleep(1500);
  const rows = await ev(() => dlmVisible().filter(r => r.kind === 'playlist').map(r => `${r.title}:${r.count}`));
  ok(rows.includes('Watch Later:0') && rows.includes('Zero:0'), `the Library lists the empty playlists ${JSON.stringify(rows)}`);
  const sub = await ev(() => { const i = dlmVisible().findIndex(r => r.title === 'Watch Later'); return WM.$$('#dlmBody tr')[i].textContent; });
  ok(/0 items/.test(sub), `…with "0 items" (${sub.replace(/\s+/g, ' ').slice(0, 60)})`);
  // select + ▶ Open in new tab
  await ev(() => { const r = dlmVisible().find(r => r.title === 'Watch Later'); DLM.sel = new Set([dlmKey(r)]); dlmRender(); });
  ok(await ev(() => !WM.$('#dlmOpenTab').classList.contains('hidden')), '▶ Open in new tab shows for it');
  await ev(() => WM.$('#dlmOpenTab').click()); await sleep(800);
  st = await ev(() => ({ shown: S.tabs[S.tab].name, n: S.items.length, lib: WM.$('#dlmDlg').open }));
  ok(st.shown === 'Watch Later' && st.n === 0 && !st.lib && /it’s empty/.test(await toastTxt()), `Library → Open in new tab: an empty tab, no error ${JSON.stringify(st)} ${await toastTxt()}`);
  await ev(() => closeTab(S.tab)); await sleep(300);
  // double-click, Preview view
  await ev(() => { openDownloadsManager('playlist'); }); await sleep(800);
  await ev(() => WM.$('#dlmView button[data-v="preview"]').click()); await sleep(1500);
  const tile = await ev(() => { const i = dlmVisible().findIndex(r => r.title === 'Watch Later'); const t = [...WM.$$('#dlmGrid .lt')].find(e => +e.dataset.i === i); return t ? t.textContent.replace(/\s+/g, ' ').trim() : ''; });
  ok(/Watch Later/.test(tile), `Preview view shows its tile (${tile.slice(0, 50)})`);
  await ev(() => { const i = dlmVisible().findIndex(r => r.title === 'Watch Later'); const t = [...WM.$$('#dlmGrid .lt')].find(e => +e.dataset.i === i); t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, detail: 2 })); });
  await sleep(800);
  ok(await ev(() => S.tabs[S.tab].name === 'Watch Later' && S.items.length === 0 && !WM.$('#dlmDlg').open), 'double-clicking the tile opens it as an empty tab');
  await ev(() => { S.lib.modes = {}; });

  // ================= "?" → Check for updates (still in Settings too)
  await ev(() => { openAbout(); }); await sleep(600);
  let ab = await ev(() => ({ shown: WM.$('#aboutUpd').offsetWidth > 0, btn: WM.$('#aboutUpdCheck').textContent, st: WM.$('#aboutUpdStatus').textContent, sbtn: WM.$('#updCheck').textContent, sst: WM.$('#updStatus').textContent, btns: [...WM.$$('#aboutDlg .dlg-btns button')].map(b => b.textContent) }));
  ok(ab.shown && ab.btn === 'Check for updates' && ab.btn === ab.sbtn && ab.st === ab.sst, `"?" has Updates · status · Check for updates, same as Settings ${JSON.stringify(ab)}`);
  ok(JSON.stringify(ab.btns) === '["⚙ Settings…","View licenses","Close"]', `the buttons stay ${JSON.stringify(ab.btns)}`);
  await ev(() => WM.$('#aboutUpdCheck').click());
  let t0 = Date.now(), s2 = ''; while (Date.now() - t0 < 20000) { s2 = await ev(() => WM.$('#aboutUpdStatus').textContent); if (s2 && s2 !== ab.st && s2 !== 'Checking…') break; await sleep(250); }
  ab = await ev(() => ({ st: WM.$('#aboutUpdStatus').textContent, sst: WM.$('#updStatus').textContent, btn: WM.$('#aboutUpdCheck').textContent, sbtn: WM.$('#updCheck').textContent }));
  ok(ab.st !== 'Not checked yet' && ab.st === ab.sst && ab.btn === ab.sbtn, `clicking it checks (the test machine is offline: "${ab.st}"), and Settings shows the same`);
  await ev(() => WM.$('#aboutDlg').close());
  await ev(() => setOpen('updates')); await sleep(400);
  ok(await ev(() => WM.$('#updCheck').offsetWidth > 0 && !!WM.$('#updModeSel')), 'Settings → Updates still has Check for updates and the update mode');
  await ev(() => setClose());

  const bad = errs.filter(e => !/WebGL|GPU|net::ERR|Failed to load resource/i.test(e));
  ok(!bad.length, 'no page errors ' + JSON.stringify(bad.slice(0, 3)));
  await app.close();
  console.log(fails.length ? `${fails.length} FAILED` : 'ALL OK');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
