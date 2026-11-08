// 2.9.3: closing a tab can move its items to another tab (the Close tab box, Undo, the Clear tab box for the last
// tab); dragging tabs to reorder them (the drop bar, YT / X stay first, click / double-click unchanged, Esc and
// letting go away from the strip cancel, the strip scrolls at its edge).
// Run (Linux, xvfb): SLOPAMP_ELECTRON=… SLOPAMP_APP=… xvfb-run -a node tests/tabs-293.js   (needs ffmpeg on PATH)
'use strict';
const { launch, sleep, docWin } = require('./lib');
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const H = path.join(os.tmpdir(), 'slopamp-test-293');
const CLIP = path.join(os.tmpdir(), 'slopamp-test-293-song.m4a');

(async () => {
  if (!fs.existsSync(CLIP)) execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=120', '-c:a', 'aac', '-y', CLIP]);
  const { app, win, errs } = await launch(H);
  const ev = (f, a) => win.evaluate(f, a);
  const plw = await docWin(app, 'win-playlist');
  const dl = (await app.evaluate(({ app }) => app.getPath('downloads'))) + '/SlopAMP';
  const yt = (id, t) => ({ url: `https://www.youtube.com/watch?v=${id}`, title: t });
  const names = () => ev(() => S.tabs.map(t => `${t.name}:${t.items.length}`).join(' '));
  const box = () => ev(() => ({ open: WM.$('#closeTabDlg').open, title: WM.$('#ctTitle').textContent, text: WM.$('#ctText').textContent, row: !WM.$('#ctRow').classList.contains('hidden'),
    opts: [...WM.$$('#ctTo option')].map(o => o.textContent), val: WM.$('#ctTo').selectedOptions[0] ? WM.$('#ctTo').selectedOptions[0].textContent : '', small: WM.$('#ctSmall').textContent,
    btns: [...WM.$$('#closeTabDlg .dlg-btns button')].map(b => b.textContent), focus: (WM.$('#closeTabDlg').ownerDocument.activeElement || {}).id || '' }));
  const answer = (v) => ev((v) => WM.$(`#closeTabDlg .dlg-btns button[value="${v}"]`).click(), v);     // the buttons, as a person would
  const toastTxt = () => ev(() => WM.$('#toast').classList.contains('hidden') ? '' : WM.$('#toast').firstChild.textContent);
  const idx = (n) => ev((n) => S.tabs.findIndex(t => t.name === n), n);

  // tabs: YT · X · Main (3) · Road Trip (4: a file + 3 links) · Chill (2) · Empty (0)
  await ev(({ yt }) => {
    S.tabs[S.tabs.findIndex(t => !isHist(t))].name = 'Main';
    addDescribed([1, 2, 3].map(k => ({ url: `https://www.youtube.com/watch?v=mmmmmmmmmm${k}`, title: `M${k}` })), undefined, false);
    let n = newTab('Road Trip'); switchTab(n);
    addDescribed([1, 2, 3].map(k => ({ url: `https://www.youtube.com/watch?v=rrrrrrrrrr${k}`, title: `R${k}` })), undefined, false);
    n = newTab('Chill'); switchTab(n);
    addDescribed([1, 2].map(k => ({ url: `https://www.youtube.com/watch?v=cccccccccc${k}`, title: `C${k}` })), undefined, false);
    newTab('Empty');
  }, { yt: null });
  await sleep(300);
  await ev((f) => { switchTab(S.tabs.findIndex(t => t.name === 'Road Trip')); addPaths([f]); }, CLIP); await sleep(1200);
  await ev(() => { stop(); }); await sleep(300);     // adding a file to an idle player starts it
  const start = await names();
  ok(/YT History:0 X History:0 Main:3 Road Trip:4 Chill:2 Empty:0/.test(start) || /Main:3 Road Trip:4 Chill:2 Empty:0$/.test(start), `start: ${start}`);

  // ================= 1. Close tab
  await ev(() => { closeTab(S.tabs.findIndex(t => t.name === 'Empty')); }); await sleep(300);
  ok(!(await box()).open && !/Empty/.test(await names()), 'an empty tab closes without asking');
  // the box
  await ev(() => { closeTab(S.tabs.findIndex(t => t.name === 'Road Trip')); }); await sleep(400);
  let b = await box();
  ok(b.open && b.title === 'Close tab' && b.text === '"Road Trip" has 4 items. Move them to another tab, or close it and drop the list?' && b.row, `the Close tab box: ${b.text}`);
  const bw = await ev(() => WM.$('#closeTabDlg').getBoundingClientRect().width);
  ok(bw >= 440, `the box isn't squashed in the dialog window (${Math.round(bw)} px wide)`);
  ok(JSON.stringify(b.opts) === '["Main (3)","Chill (2)"]' && b.val === 'Main (3)', `other playlist tabs only, never YT / X; starts on the tab next to it ${JSON.stringify(b.opts)} → ${b.val}`);
  ok(JSON.stringify(b.btns) === '["Cancel","Close, drop the list","Move to \\"Main\\" & close"]' && b.focus === 'ctMove', `buttons ${JSON.stringify(b.btns)}, Move selected (${b.focus})`);
  await ev(() => { const s = WM.$('#ctTo'); s.value = String(S.tabs.findIndex(t => t.name === 'Chill')); s.dispatchEvent(new Event('change')); });
  ok((await box()).btns[2] === 'Move to "Chill" & close', 'picking another tab renames the button');
  await ev(() => { const s = WM.$('#ctTo'); s.value = String(S.tabs.findIndex(t => t.name === 'Main')); s.dispatchEvent(new Event('change')); });
  await answer('cancel'); await sleep(300);
  ok((await names()).includes('Road Trip:4') && (await names()).includes('Main:3'), 'Cancel: nothing changes');
  // Enter = Move
  await ev(() => { closeTab(S.tabs.findIndex(t => t.name === 'Road Trip')); }); await sleep(400);
  await (await docWin(app, 'host-dialog')).keyboard.press('Enter'); await sleep(500);
  let st = await ev(() => ({ names: S.tabs.map(t => t.name), main: S.tabs.find(t => t.name === 'Main').items.map(i => i.title), shown: S.tabs[S.tab].name }));
  ok(!st.names.includes('Road Trip') && JSON.stringify(st.main.slice(0, 6)) === '["M1","M2","M3","R1","R2","R3"]' && st.main.length === 7 && st.shown === 'Main', `Enter moves them to the end of Main, in order, and shows Main ${JSON.stringify(st)}`);
  let tt = await toastTxt();
  ok(tt === 'Moved 4 items from "Road Trip" to the end of "Main".' && await ev(() => WM.$('#toast .toast-act') && WM.$('#toast .toast-act').textContent === 'Undo'), `the note, with Undo: ${tt}`);
  await ev(() => WM.$('#toast .toast-act').click()); await sleep(400);
  st = await ev(() => ({ names: S.tabs.map(t => `${t.name}:${t.items.length}`), rt: (S.tabs.find(t => t.name === 'Road Trip') || { items: [] }).items.map(i => i.title) }));
  ok(st.names.join(' ').endsWith('Main:3 Road Trip:4 Chill:2') && st.rt.slice(0, 3).join() === 'R1,R2,R3', `Undo puts the tab back where it was, with its items ${JSON.stringify(st)}`);
  ok(/is back/.test(await toastTxt()), 'Undo says so');
  // a playing item moves and keeps playing
  await ev(() => { switchTab(S.tabs.findIndex(t => t.name === 'Road Trip')); playIndex(S.items.findIndex(i => i.type === 'file')); });
  let t0 = Date.now(); while (Date.now() - t0 < 10000 && (await ev(() => status)) !== 'playing') await sleep(200);
  await ev(() => { closeTab(S.tabs.findIndex(t => t.name === 'Road Trip')); }); await sleep(400);
  b = await box();
  ok(/and one of them is playing/.test(b.text) && b.small === 'Moved: it keeps playing. Dropped: playback stops.', `the box says one is playing: ${b.text}`);
  await answer('move'); await sleep(1200);
  st = await ev(() => ({ status, cur: curItem() && curItem().type, pt: PT().name, curIdx: PT().current, title: curItem() && curItem().title, t: currentTime() }));
  ok(st.status === 'playing' && st.cur === 'file' && st.pt === 'Main' && st.curIdx === 6 && st.t > 0.5, `it keeps playing, now from Main ${JSON.stringify(st)}`);
  await ev(() => WM.$('#toast .toast-act').click()); await sleep(600);
  st = await ev(() => ({ status, pt: PT().name, cur: curItem() && curItem().type, main: S.tabs.find(t => t.name === 'Main').items.length }));
  ok(st.status === 'playing' && st.pt === 'Road Trip' && st.cur === 'file' && st.main === 3, `Undo while it plays: back in Road Trip, still playing ${JSON.stringify(st)}`);
  // the box starts on the tab you last moved to
  await ev(() => { closeTab(S.tabs.findIndex(t => t.name === 'Chill')); }); await sleep(400);
  b = await box();
  ok(b.val.startsWith('Main'), 'the box starts on the tab items were last moved to (Main)');
  // Drop
  await answer('drop'); await sleep(400);
  ok(!(await names()).includes('Chill') && (await ev(() => S.tabs.find(t => t.name === 'Main').items.length)) === 3 && (await ev(() => status)) === 'playing', 'Close, drop the list: the tab and its list go (the song in another tab keeps playing)');
  // dropping the tab that plays stops it
  await ev(() => { closeTab(S.tabs.findIndex(t => t.name === 'Road Trip')); }); await sleep(400);
  await answer('drop'); await sleep(500);
  ok((await ev(() => status)) === 'stopped' && !(await names()).includes('Road Trip'), 'dropping the playing tab stops playback');
  // Ctrl+W and the right-click menu use the same box
  await ev(() => { const n = newTab('Work'); switchTab(n); addDescribed([{ url: 'https://www.youtube.com/watch?v=wwwwwwwwww1', title: 'W1' }], undefined, false); }); await sleep(300);
  await ev(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true }))); await sleep(400);
  ok((await box()).open && (await box()).title === 'Close tab', 'Ctrl+W: the same box');
  await answer('cancel'); await sleep(200);
  const menu = await plw.evaluate(() => { const el = [...document.querySelectorAll('#tabStrip .ptab')].find(e => e.textContent.startsWith('Work')); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 })); return true; });
  await sleep(300);
  const hasClose = await ev(() => [...WM.$('#ctx').children].some(c => c.textContent === 'Close tab'));
  await ev(() => { [...WM.$('#ctx').children].find(c => c.textContent === 'Close tab').click(); }); await sleep(400);
  ok(menu && hasClose && (await box()).open, 'right-click → Close tab: the same box');
  await answer('move'); await sleep(400);
  ok(!(await names()).includes('Work') && (await ev(() => S.tabs.find(t => t.name === 'Main').items.some(i => i.title === 'W1'))), '…and Move works from there');
  await ev(() => { WM.$('#toast').classList.add('hidden'); });
  // the last ordinary tab: Clear tab, Save to Playlists & clear
  await ev(() => { const m = S.tabs.find(t => t.name === 'Main'); m.name = 'Keepers'; renderTabs(); });
  await ev(() => { closeTab(S.tabs.findIndex(t => t.name === 'Keepers')); }); await sleep(400);
  b = await box();
  ok(b.open && b.title === 'Clear tab' && !b.row && /only playlist tab/.test(b.text) && JSON.stringify(b.btns) === '["Cancel","Just clear it","Save to Playlists & clear"]' && b.focus === 'ctMove', `the last tab: Clear tab ${JSON.stringify([b.text, b.btns])}`);
  await answer('move'); await sleep(800);
  const saved = fs.existsSync(`${dl}/Playlists/Keepers.m3u8`) ? fs.readFileSync(`${dl}/Playlists/Keepers.m3u8`, 'utf8') : '';
  ok(/M1/.test(saved) && /W1/.test(saved), 'Save to Playlists & clear: Playlists\\Keepers.m3u8 has its items');
  st = await ev(() => S.tabs.filter(t => !isHist(t)).map(t => `${t.name}:${t.items.length}`));
  ok(JSON.stringify(st) === '["Main:0"]' && /cleared the tab/.test(await toastTxt()), `…then it's cleared and named Main ${JSON.stringify(st)}`);
  await ev(() => { addDescribed([{ url: 'https://www.youtube.com/watch?v=zzzzzzzzzz1', title: 'Z1' }], undefined, false); }); await sleep(200);
  await ev(() => { closeTab(S.tabs.findIndex(t => t.name === 'Main')); }); await sleep(400);
  await answer('drop'); await sleep(400);
  ok((await ev(() => S.tabs.find(t => t.name === 'Main').items.length)) === 0, 'Just clear it');

  // ================= 2. Drag tabs
  await ev(() => { for (const n of ['A', 'B', 'C']) { const k = newTab(n); S.tabs[k].items = [{ id: nid(), type: 'youtube', url: `https://www.youtube.com/watch?v=${n.repeat(11)}`, vid: n.repeat(11), title: n }]; } switchTab(S.tabs.findIndex(t => t.name === 'B')); renderTabs(); });
  await plw.evaluate(() => window.resizeTo(560, 320)); await sleep(600);
  const order = () => ev(() => S.tabs.map(t => isHist(t) ? HK[histKind(t)].short : t.name).join(' '));
  ok(await order() === 'YT X Main A B C', `start ${await order()}`);
  const tab = (n) => plw.evaluate((n) => { const el = [...document.querySelectorAll('#tabStrip .ptab')].find(e => e.querySelector('.nm').textContent === n); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, r: r.right }; }, n);
  const m = plw.mouse;
  // C before Main
  let c = await tab('C'), mn = await tab('Main');
  await m.move(c.x, c.y); await m.down(); await m.move(c.x - 10, c.y, { steps: 3 }); await m.move(mn.l + 4, c.y, { steps: 8 });
  const mid = await plw.evaluate(() => ({ bar: !!document.querySelector('.tab-bar:not(.hidden)'), ghost: (document.querySelector('.tab-ghost') || {}).textContent || '', lift: !!document.querySelector('.ptab.tlift') }));
  ok(mid.bar && mid.ghost.startsWith('C') && mid.lift, `while dragging: the green bar, the tab under the pointer, the tab lifted ${JSON.stringify(mid)}`);
  await m.up(); await sleep(300);
  ok(await order() === 'YT X C Main A B', `dropped before Main: ${await order()}`);
  ok(await ev(() => S.tabs[S.tab].name === 'C'), 'the dragged tab is the one on screen (pressing it selected it)');
  ok(await ev(() => stateSnapshot().tabs.filter(t => !['history', 'xhistory'].includes(t.id)).map(t => t.name).join() === 'C,Main,A,B'), 'the new order is saved');
  // too far left: lands after YT / X
  c = await tab('B'); const ytt = await tab('YT');
  await m.move(c.x, c.y); await m.down(); await m.move(ytt.l + 2, c.y, { steps: 10 }); await m.up(); await sleep(300);
  ok(await order() === 'YT X B C Main A', `dropped on YT: lands right after X (${await order()})`);
  // to the end
  c = await tab('B'); const a = await tab('A');
  await m.move(c.x, c.y); await m.down(); await m.move(a.r + 30, c.y, { steps: 10 }); await m.up(); await sleep(300);
  ok(await order() === 'YT X C Main A B', `to the end: ${await order()}`);
  // YT / X don't drag
  const y = await tab('X');
  await m.move(y.x, y.y); await m.down(); await m.move(y.x + 200, y.y, { steps: 10 });
  ok(!(await plw.evaluate(() => !!document.querySelector('.tab-ghost'))), 'YT / X History don\'t drag');
  await m.up(); await sleep(200);
  ok(await order() === 'YT X C Main A B', 'YT / X stay first');
  // Esc cancels
  c = await tab('A'); mn = await tab('Main');
  await m.move(c.x, c.y); await m.down(); await m.move(mn.l + 3, c.y, { steps: 8 });
  await plw.keyboard.press('Escape'); await sleep(100); await m.up(); await sleep(300);
  ok(await order() === 'YT X C Main A B' && !(await plw.evaluate(() => !!document.querySelector('.tab-ghost, .tab-bar'))), 'Esc cancels');
  // letting go away from the strip cancels
  c = await tab('A');
  await m.move(c.x, c.y); await m.down(); await m.move(mn.l + 3, c.y + 160, { steps: 8 });
  ok(await plw.evaluate(() => !!document.querySelector('.tab-bar.hidden')), 'away from the strip: no bar');
  await m.up(); await sleep(300);
  ok(await order() === 'YT X C Main A B', 'letting go away from the strip cancels');
  // a click selects, a double-click renames, a small wobble isn't a drag
  c = await tab('Main');
  await m.move(c.x, c.y); await m.down(); await m.move(c.x + 3, c.y); await m.up(); await sleep(200);
  ok(await ev(() => S.tabs[S.tab].name === 'Main') && await order() === 'YT X C Main A B', 'a click (even with a 3 px wobble) just selects');
  await m.dblclick(c.x, c.y); await sleep(300);
  ok(await ev(() => renamingTab >= 0 && S.tabs[renamingTab].name === 'Main'), 'a double-click still renames');
  await plw.keyboard.press('Escape'); await sleep(200);
  // the playing tab stays the playing tab
  await ev(() => { switchTab(S.tabs.findIndex(t => t.name === 'A')); S.playTab = S.tab; });
  c = await tab('A'); const cc = await tab('C');
  await m.move(c.x, c.y); await m.down(); await m.move(cc.l + 3, c.y, { steps: 8 }); await m.up(); await sleep(300);
  ok(await order() === 'YT X A C Main B' && await ev(() => S.tabs[S.playTab].name === 'A'), 'the playing tab follows its tab');
  // many tabs: the strip scrolls at its edge
  await ev(() => { for (let k = 1; k <= 12; k++) newTab(`Long tab name ${k}`); renderTabs(); $('#tabStrip').scrollLeft = 0; });
  await sleep(300);
  const sw = await plw.evaluate(() => { const s = document.querySelector('#tabStrip'); return { sw: s.scrollWidth, cw: s.clientWidth, r: s.getBoundingClientRect().right }; });
  c = await tab('C');
  await m.move(c.x, c.y); await m.down(); await m.move(sw.r - 8, c.y, { steps: 10 }); await sleep(900);
  const sl = await plw.evaluate(() => document.querySelector('#tabStrip').scrollLeft);
  await m.up(); await sleep(300);
  ok(sw.sw > sw.cw && sl > 50, `near the edge the strip scrolls (scrollLeft ${sl})`);
  ok(await ev(() => S.tabs.findIndex(t => t.name === 'C') > S.tabs.findIndex(t => t.name === 'Long tab name 3')), 'and the tab lands further along');

  const bad = errs.filter(e => !/WebGL|GPU|net::ERR|Failed to load resource/i.test(e));
  ok(!bad.length, 'no page errors ' + JSON.stringify(bad.slice(0, 3)));
  await app.close();
  console.log(fails.length ? `${fails.length} FAILED` : 'ALL OK');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
