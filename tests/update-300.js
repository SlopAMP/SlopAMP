// 3.0.0: the version and the update from 2.9.9, and the tip line in Settings → About (item 4)
//   - the updater reads three numbers: 3.0.0 is newer than 2.9.9 (and 3.0.1 than 3.0.0); a v3.0.0 release with
//     SlopAMP-Setup-3.0.0.exe and its "SHA256 (…): …" line is usable, without them it isn't
//   - a 2.9.9 that can't install (Portable, and this test run) shows "3.0.0 available" with the note, from a local feed
//   - About has no money ask; Settings → About has one plain sentence (@HeyoPatriot linked) and @slopAMPapp / slopamp.com
// Run (Linux, xvfb): SLOPAMP_ELECTRON=… SLOPAMP_APP=… xvfb-run -a node tests/update-300.js
'use strict';
const { launch, sleep } = require('./lib');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const APP = process.env.SLOPAMP_APP || path.join(__dirname, '..');

(async () => {
  const { isNewer, parseRelease } = require(path.join(APP, 'src/updater'));
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  ok(pkg.version === '3.0.0' || isNewer(pkg.version, '3.0.0'), `package.json says ${pkg.version} (3.0.0 or later; 3.1.0: see update-310.js)`);
  ok(isNewer('3.0.0', '2.9.9') && isNewer('v3.0.0', '2.9.9') && !isNewer('2.9.9', '3.0.0') && !isNewer('3.0.0', '3.0.0') && isNewer('3.0.1', '3.0.0') && isNewer('3.1.0', '3.0.9'), 'versions: 3.0.0 is newer than 2.9.9; 3.0.1 than 3.0.0');
  const hash = 'a'.repeat(64), url = 'https://github.com/SlopAMP/SlopAMP/releases/download/v3.0.0/SlopAMP-Setup-3.0.0.exe';
  const rel = (o) => ({ tag_name: 'v3.0.0', html_url: 'https://github.com/SlopAMP/SlopAMP/releases/tag/v3.0.0', body: `What's new in 3.0.0\n\nSHA256 (SlopAMP-Setup-3.0.0.exe): ${hash}`, assets: [{ name: 'SlopAMP-Setup-3.0.0.exe', browser_download_url: url, size: 1000 }], ...o });
  let p = parseRelease(rel(), '2.9.9');
  ok(p.newer && !p.error && p.file === 'SlopAMP-Setup-3.0.0.exe' && p.sha256 === hash && p.url === url, '2.9.9 reads a v3.0.0 release: newer, the Setup asset, its SHA256');
  ok(parseRelease(rel({ body: 'no hash' }), '2.9.9').error === 'nohash', 'without the SHA256 line it won’t install it');
  ok(parseRelease(rel({ assets: [{ name: 'SlopAMP-Setup-3.0.exe', browser_download_url: url }] }), '2.9.9').error === 'noasset', 'the asset must be named SlopAMP-Setup-3.0.0.exe');
  ok(parseRelease(rel({ tag_name: 'v3.0' }), '2.9.9').error === 'norelease', 'the tag must have three numbers (v3.0.0)');
  ok(!parseRelease(rel(), '3.0.0').newer, '3.0.0 doesn’t offer itself');

  // a local feed: a "3.0.0" release; the app pretends to be 2.9.9
  const FEED = path.join(os.tmpdir(), 'slopamp-300-feed'); fs.rmSync(FEED, { recursive: true, force: true }); fs.mkdirSync(FEED, { recursive: true });
  const inst = Buffer.from('not a real installer'); fs.writeFileSync(path.join(FEED, 'SlopAMP-Setup-3.0.0.exe'), inst);
  const h = crypto.createHash('sha256').update(inst).digest('hex');
  fs.writeFileSync(path.join(FEED, 'release.json'), JSON.stringify({ tag_name: 'v3.0.0', html_url: 'https://github.com/SlopAMP/SlopAMP/releases/tag/v3.0.0', published_at: new Date().toISOString(),
    body: `- **Transitions** in CLIP Join.\n- **Batch convert.**\n\nWhat's new in 3.0.0: transitions, captions on each file and batch convert.\n\nSHA256 (SlopAMP-Setup-3.0.0.exe): ${h}`,
    assets: [{ name: 'SlopAMP-Setup-3.0.0.exe', browser_download_url: 'SlopAMP-Setup-3.0.0.exe', size: inst.length }] }));
  process.env.SLOPAMP_UPDATE_TEST = path.join(FEED, 'release.json'); process.env.SLOPAMP_TEST_VERSION = '2.9.9';
  const { app, win, errs } = await launch(path.join(os.tmpdir(), 'slopamp-test-300u'));
  const ev = (f, a) => win.evaluate(f, a);
  let st = null;
  for (let k = 0; k < 30; k++) { st = await ev(() => (typeof UPD !== 'undefined' && UPD ? { status: UPD.status, v: UPD.release && UPD.release.version, cur: UPD.current, can: UPD.canInstall } : null)); if (st && st.status === 'available') break; await sleep(500); }
  ok(st && st.status === 'available' && st.v === '3.0.0' && st.cur === '2.9.9' && !st.can, `a 2.9.9 that can't install (Portable) finds 3.0.0: ${JSON.stringify(st)}`);
  const bar = await ev(() => WM.$('#updBar').textContent.replace(/\s+/g, ' ').trim());
  ok(/3\.0\.0/.test(bar), `the update note says so: "${bar.slice(0, 120)}"`);
  ok(await ev(() => /3\.0\.0 available/.test(WM.$('#aboutUpdStatus').textContent)), `About's Updates: "${await ev(() => WM.$('#aboutUpdStatus').textContent)}"`);

  // About: no money ask (it's in Settings → About only)
  await ev(() => openAbout()); await sleep(600);
  const about = await ev(() => WM.$('#aboutDlg').textContent);
  ok(!/X Money|tip|HeyoPatriot|Support SlopAMP|donat/i.test(about), 'About has no tip / donation line, button or QR');
  await ev(() => WM.$('#aboutDlg').close());
  // Settings → About: one plain sentence, @HeyoPatriot linked, then @slopAMPapp on X and slopamp.com
  const tip = await ev(() => { const r = WM.$('.set-tip'); return r && { text: r.querySelector('.set-txt').textContent.trim(), links: [...r.querySelectorAll('a')].map(a => [a.textContent, a.dataset.url]), inAbout: !!r.closest('[data-s=about]'), btns: r.querySelectorAll('button, img').length }; });
  ok(tip && tip.inAbout && tip.text === 'SlopAMP is free. If you like it, you can tip via X Money to @HeyoPatriot on X.' && tip.btns === 0, `Settings → About: "${tip && tip.text}"`);
  ok(tip && JSON.stringify(tip.links) === JSON.stringify([['@HeyoPatriot', 'https://x.com/HeyoPatriot'], ['@slopAMPapp on X', 'https://x.com/slopAMPapp'], ['slopamp.com', 'https://slopamp.com']]), `its links: ${JSON.stringify(tip && tip.links)}`);
  await app.evaluate(({ shell }) => { global.__opened = []; shell.openExternal = (u) => { global.__opened.push(u); return Promise.resolve(); }; });
  await ev(() => { for (const a of WM.$$('.set-tip a')) a.click(); }); await sleep(500);
  const opened = await app.evaluate(() => global.__opened);
  ok(JSON.stringify(opened) === JSON.stringify(['https://x.com/HeyoPatriot', 'https://x.com/slopAMPapp', 'https://slopamp.com']), `each opens in the default browser: ${JSON.stringify(opened)}`);
  ok(!errs.length, `no errors in the windows ${JSON.stringify(errs.slice(0, 3))}`);
  await app.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
