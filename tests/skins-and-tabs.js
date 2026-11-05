// SlopAMP 2.7.1 test: double-clicking a skin (Classic row or Preview tile) puts it on, like Apply; playlist tab
// menu Move to front / Move to end (greyed when the tab is already first / last; History tabs stay first).
// Run: xvfb-run -a node tests/skins-and-tabs.js
const { launch, sleep, docWin } = require('./lib');
const path = require('path'), os = require('os');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const H = path.join(os.tmpdir(), 'slopamp-test-271');
(async () => {
  const { app, win, errs } = await launch(H);
  const ev = (f, a) => win.evaluate(f, a);
  const dw = () => docWin(app, 'host-dialog');
  const cur = () => ev(() => WM.skins.current);
  // ================= 1. double-click a skin
  await ev(() => openDownloadsManager('skins')); await sleep(800);
  let w = await dw();
  const at = (sel) => ev((sel) => { const r = WM.$(sel).getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; }, sel);
  let p = await at('#sklList .skl-row[data-id="red"] .skl-n');
  await w.mouse.dblclick(p.x, p.y); await sleep(900);
  ok((await cur()) === 'red', 'Classic list: double-clicking Red Alert puts it on (a real double-click: the first click re-renders the list)');
  ok(await ev(() => WM.$('#sklList .skl-row[data-id="red"] .skl-on') !== null), 'its row shows ✓ ON');
  p = await at('#sklList .skl-row[data-id="ice"] button[data-a=edit]');
  await w.mouse.dblclick(p.x, p.y); await sleep(900);
  const ed = await ev(() => ({ open: WM.skins.editorOpen, saved: WM.skins.saved }));
  ok(ed.open && ed.saved === 'red', 'double-clicking a row’s ✎ Edit opens the Skin Editor; the skin you have on stays Red Alert ' + JSON.stringify(ed));
  await ev(() => { if (WM.skins.editorOpen) WM.skins.closeEditor(); }); await sleep(500);
  if (!(await ev(() => WM.$('#dlmDlg').open))) { await ev(() => openDownloadsManager('skins')); await sleep(800); }
  w = await dw();
  await ev(() => WM.$('#dlmView [data-v=preview]').click()); await sleep(500);
  p = await at('#sklList .skl-tile[data-id="purple"] .skt-pv');
  await w.mouse.dblclick(p.x - 18, p.y - 20); await sleep(900);
  ok((await cur()) === 'purple', 'Preview tiles: double-clicking Purple Haze puts it on');
  ok(await ev(() => WM.$('#sklList .skl-tile[data-id="purple"] .skt-on') !== null), 'its tile shows ✓ ON');
  p = await at('#sklList .skl-tile[data-id="classic"] .skl-n');
  await w.mouse.dblclick(p.x, p.y); await sleep(900);
  ok((await cur()) === 'classic', 'double-clicking a tile’s name works too (SlopAMP Classic)');
  await ev(() => WM.$('#dlmDlg').close()); await sleep(300);
  // ================= 2. Move to front / Move to end
  await ev(() => { histEnsureTab('yt'); histEnsureTab('x'); for (const n of ['A', 'B', 'C']) newTab(n); S.tabs.find(t => t.name === 'B').items = [{ id: nid(), type: 'file', path: '/tmp/x.mp3', title: 'x', duration: 9 }]; switchTab(S.tabs.findIndex(t => t.name === 'B')); S.playTab = S.tabs.findIndex(t => t.name === 'B'); renderTabs(); });
  await sleep(300);
  const names = () => ev(() => S.tabs.map(t => t.name));
  ok(JSON.stringify(await names()) === JSON.stringify(['YT History', 'X History', 'Main', 'A', 'B', 'C']), 'tabs: ' + JSON.stringify(await names()));
  const menuFor = async (name) => {
    await ev((name) => { const i = S.tabs.findIndex(t => t.name === name); const el = WM.$(`#tabStrip .ptab[data-t="${i}"]`); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 })); }, name);
    await sleep(300);
    return ev(() => [...WM.$('#ctx').children].map(d => (d.tagName === 'HR' ? '—' : d.textContent + (d.classList.contains('off') ? ' (off)' : ''))));
  };
  const pick = async (label) => { await ev((label) => [...WM.$('#ctx').children].find(d => d.textContent === label).click(), label); await sleep(300); };
  let m = await menuFor('Main');
  ok(m.includes('Move to front (off)') && m.includes('Move to end') && !m.includes('Move left'), 'first tab (Main): Move to front greyed, Move to end on ' + JSON.stringify(m));
  ok(m.indexOf('Move to front (off)') === m.indexOf('Move right') + 1 && m.indexOf('Move to end') === m.indexOf('Move right') + 2, 'they sit right after Move left / Move right');
  await pick('Move to front (off)'.replace(' (off)', ''));
  ok(JSON.stringify(await names()) === JSON.stringify(['YT History', 'X History', 'Main', 'A', 'B', 'C']), 'greyed Move to front does nothing');
  await ev(() => hideCtx());
  m = await menuFor('Main'); await pick('Move to end');
  ok(JSON.stringify(await names()) === JSON.stringify(['YT History', 'X History', 'A', 'B', 'C', 'Main']), 'Main → Move to end ' + JSON.stringify(await names()));
  ok(await ev(() => S.tabs[S.tab].name === 'B' && S.tabs[S.playTab].name === 'B'), 'the tab on screen and the playing tab are still B');
  m = await menuFor('Main');
  ok(m.includes('Move to end (off)') && m.includes('Move to front') && !m.includes('Move right'), 'last tab: Move to end greyed ' + JSON.stringify(m));
  await pick('Move to front');
  ok(JSON.stringify(await names()) === JSON.stringify(['YT History', 'X History', 'Main', 'A', 'B', 'C']), 'Main → Move to front: right after the History tabs ' + JSON.stringify(await names()));
  m = await menuFor('B'); await pick('Move to front');
  ok(JSON.stringify(await names()) === JSON.stringify(['YT History', 'X History', 'B', 'Main', 'A', 'C']) && (await ev(() => S.tabs[S.tab].name)) === 'B', 'B (on screen) → Move to front, still on screen');
  m = await menuFor('A');
  ok(!m.some(x => / \(off\)$/.test(x) && /Move to/.test(x)), 'a middle tab: both on ' + JSON.stringify(m));
  await ev(() => hideCtx());
  const saved = await ev(() => stateSnapshot().tabs.map(t => t.name));
  ok(JSON.stringify(saved) === JSON.stringify(['YT History', 'X History', 'B', 'Main', 'A', 'C']), 'the new order is what gets saved');
  ok(!errs.length, 'no page errors ' + JSON.stringify(errs));
  await app.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL OK'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
