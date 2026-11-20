// 3.2.0 (Linux): links and files dragged in from other apps, and the Add link dialog's Paste. Checks:
//   - Electron's binary carries the two Chromium X11 drag-and-drop fixes (build/patch-electron-linux.py)
//   - drops the way GNOME's XWayland bridge delivers them (tests/xdnd-source.py) from Chrome on Wayland: its
//     text/x-moz-url is UTF-8, with an even and an odd byte count (the odd one crashed SlopAMP), GNOME's flood of
//     positions while the data is fetched (every type got lost: "the drop does nothing"), the address bar's drag (no
//     HTML), only the HTML left; as Firefox sends them (UTF-16 text/x-moz-url and text/uri-list: added once); a file
//     from Files (text/uri-list); text that isn't a link (nothing added); GNOME's end of a drag (drops only if the last
//     answer said yes): a drag that stops as soon as it reaches SlopAMP, and one that comes while the page is busy
//     (both were cancelled), and Chrome's address bar as a page loads, its text without "https://www." (the full
//     address only in text/x-moz-url, which the page doesn't get: the first drag from each site "did nothing"), for
//     YouTube, X and a site SlopAMP can't add. SlopAMP must still be running after each.
//   - the Add link dialog: Paste (into the empty field; a second link on its own line; an empty clipboard), the
//     right-click menu on the field (Cut and Copy greyed without a selection; Copy, Select all, Paste), Add
// Run (Linux, xvfb): SLOPAMP_ELECTRON=… xvfb-run -a node tests/linux-dnd-320.js
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { execFile, spawnSync } = require('child_process');
const { launch, sleep, APP } = require('./lib');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const H = path.join(os.tmpdir(), 'slopamp-test-dnd-320');
const SRC = path.join(__dirname, 'xdnd-source.py');
const U = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const SONG = path.join(__dirname, 'media', 'Test Artist - Tone Song [abcdefghij4].mp3');

const drag = (xid, x, y, spec) => new Promise((resolve) => {
  const f = path.join(os.tmpdir(), 'slopamp-test-dnd-320-spec.json'); fs.writeFileSync(f, JSON.stringify(spec));
  execFile('python3', [SRC, String(xid), String(x), String(y), f], { timeout: 30000 }, (err, out) => {
    resolve(String(out || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return {}; } }));
  });
});
// Chrome on Wayland as GNOME hands it over: text/x-moz-url in UTF-8 ("URL\nTitle\n"), and a chromium/ type Chrome
// sends nothing for (the "XConvertSelection failed" in SlopAMP's log)
const chrome = (title, o = {}) => ({ positions: 3, ...o, types: [
  { name: 'text/x-moz-url', text: `${U}\n${title}\n` },
  ...(o.html === false ? [] : [{ name: 'text/html', text: `<meta charset="utf-8"><a href="${U}&amp;t=1">${title}</a>` }]),
  ...(o.plain === false ? [] : [{ name: 'text/plain;charset=utf-8', text: U }, { name: 'text/plain', text: U }]),
  { name: 'chromium/x-renderer-taint', fail: true }] });
const mozBytes = (title) => Buffer.byteLength(`${U}\n${title}\n`);
const XU = 'https://x.com/someone/status/1234567890123456789';
// a drag from Chrome's address bar: text/x-moz-url "URL\nTitle" (no newline at the end), the bar's text in text/plain
const bar = (moz, shown) => ({ positions: 3, types: [
  { name: 'text/x-moz-url', text: moz }, { name: 'text/plain;charset=utf-8', text: shown }, { name: 'text/plain', text: shown }] });

(async () => {
  const bin = process.env.SLOPAMP_ELECTRON || '';
  const chk = spawnSync('python3', [path.join(APP, 'build/patch-electron-linux.py'), '--check', bin], { encoding: 'utf8' });
  ok(chk.status === 0, `Electron has the Chromium X11 drag-and-drop fixes: ${String(chk.stdout || chk.stderr).trim()}`);
  if (chk.status !== 0) { console.log('\n1 FAILED (the drags below would crash an unpatched Electron)'); process.exit(1); }

  const { app, win, errs } = await launch(H);
  let gone = null; app.process().on('exit', (code, sig) => { gone = sig || code; });
  const ev = (fn, arg) => win.evaluate(fn, arg);
  const main = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(x => /index\.html/.test(x.webContents.getURL())), b = w.getBounds();
    return { xid: w.getNativeWindowHandle().readUInt32LE(0), x: b.x + Math.round(b.width / 2), y: b.y + Math.round(b.height / 2) };
  });
  const items = () => ev(() => S.items.map(i => i.url || i.path));

  async function dropCase(name, spec, expect, wait = 1200, check, before) {
    await ev(() => removeIds(S.items.map(i => i.id)));
    if (before) await before();
    const out = await drag(main.xid, main.x, main.y, spec);
    await sleep(wait);
    if (gone !== null) { ok(false, `${name}: SlopAMP exited (${gone})`); return false; }
    const got = await items(), fin = out.find(e => e.ev === 'finished'), extra = check ? await ev(check) : '';
    ok(JSON.stringify(got) === JSON.stringify(expect) && extra !== false, `${name}: ${got.length ? got.map(g => path.basename(g)).join(', ') : 'nothing'} added`
      + `${extra ? ` ${extra}` : ''} (${fin ? (fin.left ? 'GNOME cancelled the drag' : fin.accept ? 'drop accepted' : 'dropped; Electron reported no action') : JSON.stringify(out.slice(-1))})`);
    return true;
  }
  const flood = { motion_ms: 3, delay_ms: 25, positions: 30 };
  const cases = [
    [`Chrome on Wayland, text/x-moz-url ${mozBytes('Rick!')} bytes (even)`, chrome('Rick!'), [U]],
    [`Chrome on Wayland, text/x-moz-url ${mozBytes('Rick')} bytes (odd: crashed SlopAMP)`, chrome('Rick'), [U]],
    ['Chrome on Wayland with GNOME\'s flood of positions while the data comes (lost every type)', chrome('Rick', flood), [U]],
    ['Chrome\'s address bar (no HTML), flood, slower data', chrome('Never Gonna Give You Up - YouTube', { html: false, motion_ms: 2, delay_ms: 40, positions: 60 }), [U]],
    ['only the HTML holds the link (the uri-list is garbled)', chrome('Rick', { plain: false }), [U], 1200,
      () => (S.items[0] && S.items[0].start === 1 ? 'from the HTML (starts at 0:01)' : false)],
    ['Firefox (UTF-16 text/x-moz-url, text/uri-list)', { positions: 3, types: [
      { name: 'text/x-moz-url', hex: Buffer.from(`${U}\nRick`, 'utf16le').toString('hex') },
      { name: 'text/uri-list', text: `${U}\r\n` }, { name: 'text/html', text: `<a href="${U}">Rick</a>` },
      { name: 'text/plain;charset=utf-8', text: U }, { name: 'text/plain', text: U }] }, [U]],
    ['a song from Files (text/uri-list)', { positions: 3, types: [
      { name: 'text/uri-list', text: `file://${encodeURI(SONG).replace(/\[/g, '%5B').replace(/\]/g, '%5D')}\r\n` },
      { name: 'text/plain;charset=utf-8', text: SONG }] }, [SONG], 3000],
    ['text that isn\'t a link', { positions: 3, types: [{ name: 'text/plain;charset=utf-8', text: 'just some words' }, { name: 'text/plain', text: 'just some words' }] }, []],
    // GNOME drops only if the last answer said yes, and sends positions only while the mouse moves (release_ms):
    // Electron's first answer after the pointer comes in is "no" (the page hasn't seen the drag yet), so a drag that
    // stops right there, or one that comes while the page is busy, was cancelled: the first drag from a site "does
    // nothing", the next works
    ['a quick drag that stops as soon as it reaches SlopAMP (one position, let go 300 ms later)', chrome('Rick', { positions: 1, release_ms: 300 }), [U]],
    ['a slow first drag: SlopAMP\'s page busy for 400 ms as it comes in (3 positions, let go 700 ms later)', chrome('Rick', { positions: 3, release_ms: 700 }), [U],
      1200, null, () => ev(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 400); }, 0); })],
    // Chrome's address bar, until you click it, shows a page's address without "https://" (and "www."), and a drag from
    // it carries that text; the full address is only in text/x-moz-url, which Electron on X11 doesn't hand to the page.
    // So the first drag after a page loaded "did nothing" and the next one (the press had expanded the bar) worked.
    // As the captain's debug log had them:
    ['Chrome\'s address bar as a page loads: "youtube.com/watch?v=…" (no https://www.)', bar(`${U}\n(1814) Rick - YouTube`, 'youtube.com/watch?v=dQw4w9WgXcQ'), [U]],
    ['… and on X: "x.com/someone/status/…" (no https://)', bar(`${XU}\n(9) someone on X: "hi https://t.co/3YEvr7npJQ" / X`, 'x.com/someone/status/1234567890123456789'), [XU]],
    ['… on a site SlopAMP can\'t add ("example.com/watch?v=…")', bar('https://example.com/watch?v=dQw4w9WgXcQ\nExample', 'example.com/watch?v=dQw4w9WgXcQ'), []],
  ];
  for (const [name, spec, expect, wait, check, before] of cases) if (!(await dropCase(name, spec, expect, wait, check, before))) break;

  // ---- the Add link dialog: Paste button and the field's right-click menu
  if (gone === null) {
    const A = 'https://www.youtube.com/watch?v=aaaaaaaaaaa', B = 'https://x.com/someone/status/1234567890';
    const clip = (s) => app.evaluate(({ clipboard }, t) => { if (t == null) clipboard.clear(); else clipboard.writeText(t); }, s);
    const field = () => ev(() => WM.$('#urlText').value);
    await ev(() => removeIds(S.items.map(i => i.id)));
    await clip(A); await ev(() => openUrlDialog()); await sleep(500);
    await ev(() => WM.$('#urlPaste').click()); await sleep(300);
    ok(await field() === A, 'Add link: Paste puts the clipboard\'s link in the field');
    await clip(`  ${B}  `); await ev(() => WM.$('#urlPaste').click()); await sleep(300);
    ok(await field() === `${A}\n${B}`, 'Add link: a second Paste goes on a line of its own');
    await clip(null); await ev(() => WM.$('#urlPaste').click()); await sleep(200);
    const empty = await ev(() => ({ v: WM.$('#urlText').value, b: WM.$('#urlPaste').textContent }));
    ok(empty.b === 'Clipboard is empty' && empty.v === `${A}\n${B}`, `Add link: an empty clipboard ("${empty.b}"), the field kept`);
    const menu = (a, z) => ev(([a0, z0]) => {
      const t = WM.$('#urlText'); t.focus(); t.setSelectionRange(a0, z0);
      t.dispatchEvent(new t.ownerDocument.defaultView.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 30 }));
      const c = WM.$('#ctx');
      return { shown: !c.classList.contains('hidden'), items: [...c.children].filter(d => d.tagName === 'DIV').map(d => `${d.firstChild.textContent}${d.classList.contains('off') ? ' (off)' : ''}`) };
    }, [a, z]);
    const pick = (label) => ev((l) => { const d = [...WM.$('#ctx').children].find(x => x.firstChild && x.firstChild.textContent === l); if (d) d.click(); return !!d; }, label);
    let m = await menu(0, 0);
    ok(m.shown && m.items.join(', ') === 'Cut (off), Copy (off), Paste, Select all', `right-click on the field, nothing selected: ${m.items.join(', ')}`);
    await ev(() => hideCtx());
    m = await menu(0, A.length);
    ok(m.items.join(', ') === 'Cut, Copy, Paste, Select all', `right-click with a selection: ${m.items.join(', ')}`);
    await pick('Copy'); await sleep(200);
    ok(await app.evaluate(({ clipboard }) => clipboard.readText()) === A, 'right-click → Copy copies the selection');
    await menu(0, 0); await pick('Select all'); await sleep(100);
    const sel = await ev(() => { const t = WM.$('#urlText'); return [t.selectionStart, t.selectionEnd, t.value.length]; });
    ok(sel[0] === 0 && sel[1] === sel[2], 'right-click → Select all selects the field');
    await ev(() => { const t = WM.$('#urlText'); t.value = ''; });
    await clip(B); await menu(0, 0); await pick('Paste'); await sleep(300);
    ok(await field() === B, 'right-click → Paste pastes');
    await ev(() => WM.$('#urlDlg').close('ok')); await sleep(800);
    const added = await items();
    ok(added.length === 1 && added[0] === B, `Add: the link is added (${added.join(', ')})`);
  }
  ok(gone === null, 'SlopAMP is still running');
  ok(!errs.length, `no errors in the windows ${JSON.stringify(errs.slice(0, 3))}`);
  if (gone === null) await app.close();

  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL OK');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
