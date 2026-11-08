// 2.9.3: SAVE and QUICK SAVE remember the file they wrote (LOAD / the Library bring that tab up instead of a copy;
// renaming the playlist in the Library renames the tab; SAVE under another name renames the tab, QUICK SAVE keeps
// it); the linked file in the tab's tooltip and right-click → Open file location; failed saves explained in plain
// words, the tab untouched; the Clear tab box's Save as… (pick where, then clear; Cancel or a failed save leaves the
// tab alone); History's Save a copy… still needs items.
// Run (Linux, xvfb): SLOPAMP_ELECTRON=… SLOPAMP_APP=… xvfb-run -a node tests/save-link-293.js
'use strict';
const { launch, sleep } = require('./lib');
const fs = require('fs'), path = require('path'), os = require('os');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const H = path.join(os.tmpdir(), 'slopamp-test-293s');

(async () => {
  let { app, win, errs } = await launch(H);
  let ev = (f, a) => win.evaluate(f, a);
  const allErrs = [];
  const PL = (await app.evaluate(({ app }) => app.getPath('downloads'))) + '/SlopAMP/Playlists';
  fs.mkdirSync(PL, { recursive: true });
  const toastTxt = () => ev(() => WM.$('#toast').classList.contains('hidden') ? '' : WM.$('#toast').firstChild.textContent);
  const tabs = () => ev(() => S.tabs.filter(t => !isHist(t)).map(t => `${t.name}:${t.items.length}`));
  const stub = () => app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => (global.__save ? { canceled: false, filePath: global.__save } : { canceled: true });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [global.__open] });
  });
  const saveTo = (f) => app.evaluate((_, f) => { global.__save = f; }, f);
  const openFile = (f) => app.evaluate((_, f) => { global.__open = f; }, f);
  await stub();
  const yt = (k) => ({ url: `https://www.youtube.com/watch?v=rrrrrrrrrr${k}`, title: `R${k}` });

  // ================= 1. SAVE remembers the file
  await ev((items) => { const n = newTab('Road Trip'); switchTab(n); addDescribed(items, undefined, false); }, [yt(1), yt(2)]);
  await sleep(300);
  await saveTo(`${PL}/Road Trip.m3u8`);
  await ev(() => WM.$('#pSave').click()); await sleep(600);
  let st = await ev(() => ({ src: S.tabs[S.tab].src, name: S.tabs[S.tab].name }));
  ok(st.src && st.src.endsWith('/Road Trip.m3u8') && st.name === 'Road Trip' && await toastTxt() === 'Playlist saved: Road Trip.m3u8', `SAVE links the tab to its file ${JSON.stringify(st)}`);
  // LOAD it again (from another tab): that tab comes up, no copy
  await ev(() => switchTab(S.tabs.findIndex(t => t.name === 'Main')));
  await openFile(`${PL}/Road Trip.m3u8`);
  await ev(() => WM.$('#pLoad').click()); await sleep(600);
  ok(await ev(() => S.tabs[S.tab].name === 'Road Trip') && (await tabs()).filter(t => t.startsWith('Road Trip')).length === 1 && /already open/.test(await toastTxt()), `LOAD of the saved file brings its tab up, no copy (${await toastTxt()})`);
  ok(!(await ev(() => WM.$('#loadDlg').open)), '…without the Load box');
  // Library → PLAYLISTS → Open in new tab / double-click: the same
  await ev(() => switchTab(S.tabs.findIndex(t => t.name === 'Main')));
  await ev(() => { openDownloadsManager('playlist'); }); await sleep(1200);
  await ev(() => { const r = dlmVisible().find(r => r.title === 'Road Trip'); DLM.sel = new Set([dlmKey(r)]); dlmRender(); WM.$('#dlmOpenTab').click(); });
  await sleep(700);
  ok(await ev(() => S.tabs[S.tab].name === 'Road Trip' && !WM.$('#dlmDlg').open) && (await tabs()).filter(t => t.startsWith('Road Trip')).length === 1, `Library → Open in new tab: the linked tab comes up, no copy (${await toastTxt()})`);
  // renaming the playlist in the Library renames the tab
  await ev(() => { openDownloadsManager('playlist'); }); await sleep(1200);
  await ev(() => { libRename(dlmVisible().find(r => r.title === 'Road Trip')); }); await sleep(500);
  await ev(() => { const i = WM.$('#clRenIn'); i.value = 'Road Trip 2026'; i.dispatchEvent(new Event('input')); }); await sleep(400);
  await ev(() => WM.$('#renOk').click()); await sleep(1200);
  st = await ev(() => { const t = S.tabs.find(t => t.name === 'Road Trip 2026'); return { tab: !!t, src: t && t.src }; });
  ok(fs.existsSync(`${PL}/Road Trip 2026.m3u8`) && st.tab && st.src.endsWith('/Road Trip 2026.m3u8'), `Library rename: the file and the linked tab are renamed ${JSON.stringify(st)}`);
  await ev(() => { if (WM.$('#dlmDlg').open) WM.$('#dlmDlg').close(); switchTab(S.tabs.findIndex(t => t.name === 'Main')); });
  await openFile(`${PL}/Road Trip 2026.m3u8`);
  await ev(() => WM.$('#pLoad').click()); await sleep(600);
  ok(await ev(() => S.tabs[S.tab].name === 'Road Trip 2026') && (await tabs()).length === 2, 'LOAD of the renamed file still finds the tab');
  // SAVE under another name: the tab takes the file's name; another tab linked to that file lets go
  await ev(() => { const n = newTab('Other'); S.tabs[n].src = `${'x'}`; });
  const other = `${PL}/Trip.m3u8`;
  await ev((f) => { S.tabs.find(t => t.name === 'Other').src = f; }, other);
  await ev(() => switchTab(S.tabs.findIndex(t => t.name === 'Road Trip 2026')));
  await saveTo(other);
  await ev(() => WM.$('#pSave').click()); await sleep(600);
  st = await ev(() => ({ name: S.tabs[S.tab].name, src: S.tabs[S.tab].src, other: S.tabs.find(t => t.name === 'Other').src || null }));
  ok(st.name === 'Trip' && st.src.endsWith('/Trip.m3u8') && st.other === null, `SAVE as Trip.m3u8: the tab is now "Trip", the other tab let go of that file ${JSON.stringify(st)}`);
  ok(/the tab is now "Trip"/.test(await toastTxt()), `…and the note says so (${await toastTxt()})`);
  // the old file isn't linked any more: LOAD opens it normally (Load box, since the tab on screen has items)
  await openFile(`${PL}/Road Trip 2026.m3u8`);
  await ev(() => WM.$('#pLoad').click()); await sleep(600);
  ok(await ev(() => WM.$('#loadDlg').open), 'the file it used to be linked to loads normally again (the Load box)');
  await ev(() => WM.$('#loadDlg').close('cancel')); await sleep(300);
  // QUICK SAVE of the same tab: Playlists\Trip.m3u8, the same file, so the link stays
  await ev(() => quickSavePlaylist()); await sleep(500);
  ok(await ev(() => S.tabs[S.tab].src.endsWith('/Playlists/Trip.m3u8') && S.tabs[S.tab].name === 'Trip'), 'QUICK SAVE of a tab linked to its own Playlists file: unchanged');
  // the link survives a restart
  await ev(() => saveNow()); await sleep(600);
  allErrs.push(...errs); await app.close();
  ({ app, win, errs } = await launch(H, { keep: true })); ev = (f, a) => win.evaluate(f, a);
  await stub();
  await openFile(other);
  await ev(() => switchTab(S.tabs.findIndex(t => t.name === 'Main')));
  await ev(() => WM.$('#pLoad').click()); await sleep(800);
  ok(await ev(() => S.tabs[S.tab].name === 'Trip') && /already open/.test(await toastTxt()), 'after a restart the tab still knows its file');

  // ================= 2. Clear tab: Save as…
  await ev(() => { closeTab(S.tabs.findIndex(t => t.name === 'Other')); }); await sleep(300);
  await ev(() => { closeTab(S.tabs.findIndex(t => t.name === 'Main')); }); await sleep(300);
  ok(JSON.stringify(await tabs()) === '["Trip:2"]', `one playlist tab left: ${JSON.stringify(await tabs())}`);
  const openClear = async () => { await ev(() => { closeTab(S.tabs.findIndex(t => t.name === 'Trip')); }); await sleep(500); };
  const box = () => ev(() => ({ open: WM.$('#closeTabDlg').open, title: WM.$('#ctTitle').textContent, btns: [...WM.$$('#closeTabDlg .dlg-btns button')].filter(b => !b.classList.contains('hidden')).map(b => b.textContent), small: WM.$('#ctSmall').textContent, focus: (WM.$('#closeTabDlg').ownerDocument.activeElement || {}).id }));
  const click = (v) => ev((v) => WM.$(`#closeTabDlg .dlg-btns button[value="${v}"]`).click(), v);
  await openClear();
  let b = await box();
  ok(b.open && b.title === 'Clear tab' && JSON.stringify(b.btns) === '["Cancel","Just clear it","Save as…","Save to Playlists & clear"]' && b.focus === 'ctMove', `Clear tab has Save as… next to Save to Playlists & clear ${JSON.stringify(b.btns)}`);
  ok(/Save as… lets you pick where/.test(b.small) && /nothing is cleared/.test(b.small), `…and says so: ${b.small}`);
  // Save as… cancelled → the tab is untouched
  await saveTo(null);
  await click('saveas'); await sleep(700);
  ok(JSON.stringify(await tabs()) === '["Trip:2"]' && await ev(() => !!S.tabs.find(t => t.name === 'Trip').src) && await toastTxt() === 'Not saved, so nothing was cleared.', `Save as… cancelled: the tab is untouched (${await toastTxt()})`);
  // Save as… fails (a folder that doesn't exist) → untouched
  await openClear();
  await saveTo(`${PL}/no such folder/Trip.m3u8`);
  await click('saveas'); await sleep(700);
  ok(JSON.stringify(await tabs()) === '["Trip:2"]' && await ev(() => S.tabs.find(t => t.name === 'Trip').src.endsWith('/Trip.m3u8')) && await toastTxt() === 'Couldn’t save, so nothing was cleared. That folder doesn’t exist any more. Pick another one.', `Save as… fails: plain words, the tab, its items and its link untouched (${await toastTxt()})`);
  ok(!fs.existsSync(`${PL}/no such folder`), '…and nothing was created');
  // Save as… somewhere else → saved there, then cleared (and no longer linked)
  const dest = path.join(H, 'Elsewhere', 'Trip backup.m3u8'); fs.mkdirSync(path.dirname(dest), { recursive: true });
  await openClear();
  await saveTo(dest);
  await click('saveas'); await sleep(800);
  const txt = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
  ok(/R1/.test(txt) && /R2/.test(txt), 'Save as…: the items are in the file picked');
  st = await ev(() => S.tabs.filter(t => !isHist(t)).map(t => ({ name: t.name, n: t.items.length, src: t.src || null })));
  ok(JSON.stringify(st) === '[{"name":"Main","n":0,"src":null}]' && /Saved "Trip backup\.m3u8" \(2 items\) and cleared the tab/.test(await toastTxt()), `…then the tab is cleared, named Main and not linked ${JSON.stringify(st)}`);
  // the Close tab box (not the last tab) has no Save as…
  await ev(() => { const n = newTab('Two'); S.tabs[n].items = [{ id: nid(), type: 'youtube', url: 'https://www.youtube.com/watch?v=tttttttttt1', title: 'T1' }]; renderTabs(); });
  await ev(() => { closeTab(S.tabs.findIndex(t => t.name === 'Two')); }); await sleep(500);
  b = await box();
  ok(b.title === 'Close tab' && !b.btns.includes('Save as…'), `the Close tab box has no Save as… ${JSON.stringify(b.btns)}`);
  await click('cancel'); await sleep(200);

  // ================= 2b. QUICK SAVE links too (same rules as SAVE, but the tab keeps its name)
  await ev(() => { const n = newTab('Quick One'); switchTab(n); S.tabs[n].items = [1, 2].map(k => ({ id: nid(), type: 'youtube', url: `https://www.youtube.com/watch?v=qqqqqqqqqq${k}`, title: `Q${k}` })); renderList(); });
  await ev(() => quickSavePlaylist()); await sleep(600);
  st = await ev(() => ({ name: S.tabs[S.tab].name, src: S.tabs[S.tab].src || null, n: S.items.length }));
  ok(st.name === 'Quick One' && st.src && st.src.endsWith('/Playlists/Quick One.m3u8') && st.n === 2 && /Saved "Quick One\.m3u8" \(2 items\)/.test(await toastTxt()), `QUICK SAVE links the tab to Playlists\\Quick One.m3u8, no dialog, same note ${JSON.stringify(st)}`);
  await ev(() => switchTab(S.tabs.findIndex(t => t.name === 'Main')));
  await openFile(`${PL}/Quick One.m3u8`); await ev(() => WM.$('#pLoad').click()); await sleep(600);
  ok(await ev(() => S.tabs[S.tab].name === 'Quick One' && S.tabs.filter(t => t.name === 'Quick One').length === 1) && /already open/.test(await toastTxt()), 'LOAD of the QUICK SAVEd file brings its tab up');
  // a name a file can't have: the file is "AC DC.m3u8", the tab stays "AC/DC" (and is linked)
  await ev(() => { const n = newTab('AC/DC'); switchTab(n); });
  await ev(() => quickSavePlaylist()); await sleep(600);
  st = await ev(() => ({ name: S.tabs[S.tab].name, src: S.tabs[S.tab].src || null }));
  ok(st.name === 'AC/DC' && st.src && st.src.endsWith('/Playlists/AC DC.m3u8') && fs.existsSync(`${PL}/AC DC.m3u8`), `QUICK SAVE keeps the tab's name even when the file name differs; an empty tab links too ${JSON.stringify(st)}`);
  // another tab already linked to that file lets go of it, keeping its name and items
  await ev(() => { const n = newTab('Quick One'); S.tabs[n].items = [{ id: nid(), type: 'youtube', url: 'https://www.youtube.com/watch?v=qqqqqqqqqq9', title: 'Q9' }]; switchTab(n); });
  await ev(() => quickSavePlaylist()); await sleep(600);
  st = await ev(() => S.tabs.filter(t => t.name === 'Quick One').map(t => ({ n: t.items.length, linked: !!t.src })));
  ok(JSON.stringify(st) === '[{"n":2,"linked":false},{"n":1,"linked":true}]', `one file, one tab: the older tab let go of the link and kept its 2 items ${JSON.stringify(st)}`);
  // QUICK SAVE that fails (Playlists\Broken.m3u8 is a folder): plain words, the tab and its link unchanged
  fs.mkdirSync(`${PL}/Broken.m3u8`, { recursive: true });
  await ev(() => { const n = newTab('Broken'); switchTab(n); S.tabs[n].items = [{ id: nid(), type: 'youtube', url: 'https://www.youtube.com/watch?v=bbbbbbbbbb1', title: 'B1' }]; S.tabs[n].src = '/somewhere/else.m3u8'; renderList(); });
  await ev(() => quickSavePlaylist()); await sleep(600);
  st = await ev(() => ({ n: S.items.length, src: S.tabs[S.tab].src }));
  ok(await toastTxt() === 'Couldn’t save the playlist. There’s a folder with that name. Pick another name.' && st.n === 1 && st.src === '/somewhere/else.m3u8', `QUICK SAVE fails: plain words, items and link unchanged (${await toastTxt()})`);
  ok(!fs.existsSync(`${PL}/Broken.m3u8.tmp`), '…and no .tmp is left behind');
  // SAVE that fails: plain words, the tab, its items and its link unchanged
  await saveTo(`${PL}/gone/Broken.m3u8`);
  await ev(() => WM.$('#pSave').click()); await sleep(600);
  st = await ev(() => ({ n: S.items.length, src: S.tabs[S.tab].src, name: S.tabs[S.tab].name }));
  ok(await toastTxt() === 'Couldn’t save the playlist. That folder doesn’t exist any more. Pick another one.' && st.n === 1 && st.src === '/somewhere/else.m3u8' && st.name === 'Broken', `SAVE fails: plain words, the tab untouched ${JSON.stringify(st)}`);
  // SAVE cancelled: nothing changes
  await saveTo(null);
  await ev(() => { WM.$('#toast').classList.add('hidden'); WM.$('#pSave').click(); }); await sleep(500);
  ok(await ev(() => S.tabs[S.tab].src === '/somewhere/else.m3u8' && S.items.length === 1) && await toastTxt() === '', 'SAVE cancelled: nothing changes, no note');

  // ================= 2c. The tooltip and right-click → Open file location
  const tip = (n) => win.evaluate(() => 0).then(() => app.windows()).then(async (ws) => { for (const w of ws) { const t = await w.evaluate((n) => { const el = [...document.querySelectorAll('#tabStrip .ptab')].find(e => e.querySelector('.nm') && e.querySelector('.nm').textContent === n); return el ? el.title : null; }, n).catch(() => null); if (t) return t; } return ''; });
  let tt = await tip('AC/DC');
  ok(/\nFile: .*\/Playlists\/AC DC\.m3u8\n/.test(tt), `a linked tab's tooltip shows its file: ${JSON.stringify(tt)}`);
  tt = await tip('Main');
  ok(tt && !/File:/.test(tt), 'an unlinked tab\'s tooltip has no file line');
  const menu = (n) => ev((n) => { const i = S.tabs.findIndex(t => t.name === n); const el = [...WM.$$('#tabStrip .ptab')].find(e => +e.dataset.t === i); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 })); const it = [...WM.$('#ctx').children].find(c => c.textContent === 'Open file location'); return it ? (it.className === 'off' ? 'off' : 'on') : 'missing'; }, n);
  ok(await menu('Main') === 'off', 'Open file location is greyed on an unlinked tab');
  ok(await menu('AC/DC') === 'on', 'Open file location is there on a linked tab');
  await app.evaluate(({ shell }) => { global.__shown = []; shell.showItemInFolder = (p) => global.__shown.push(p); });
  await ev(() => [...WM.$('#ctx').children].find(c => c.textContent === 'Open file location').click()); await sleep(400);
  const shown = await app.evaluate(() => global.__shown);
  ok(shown.length === 1 && shown[0].endsWith('/Playlists/AC DC.m3u8'), `…which shows the file in its folder ${JSON.stringify(shown)}`);
  await menu('Broken');
  await ev(() => [...WM.$('#ctx').children].find(c => c.textContent === 'Open file location').click()); await sleep(400);
  ok(/"else\.m3u8" isn’t there any more/.test(await toastTxt()) && (await app.evaluate(() => global.__shown)).length === 1, `a linked file that's gone: it says so (${await toastTxt()})`);
  await ev(() => hideCtx());

  // ================= 3. History's Save a copy… still needs items
  await ev(() => { histSaveCopy('yt'); }); await sleep(300);
  ok(await toastTxt() === 'YouTube History is empty — nothing to save.', `History → Save a copy… on an empty History: unchanged (${await toastTxt()})`);

  allErrs.push(...errs);
  const bad = allErrs.filter(e => !/WebGL|GPU|net::ERR|Failed to load resource/i.test(e));
  ok(!bad.length, 'no page errors ' + JSON.stringify(bad.slice(0, 3)));
  await app.close();
  console.log(fails.length ? `${fails.length} FAILED` : 'ALL OK');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
