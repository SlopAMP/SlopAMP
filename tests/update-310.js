// 3.1.0 (Electron 45): the version, and the update from 3.0.0 and 2.9.9 (the updater itself is unchanged)
//   - package.json is 3.1.0; it's newer than 3.0.0 and 2.9.9 (and 3.1.1 / 3.2.0 than it)
//   - a v3.1.0 release with SlopAMP-Setup-3.1.0.exe and its "SHA256 (…): …" line is what 3.0.0 and 2.9.9 install
//     (the same names and line as every release); the silent install's command line is unchanged
//   - a 3.0.0 and a 2.9.9 that can't install (Portable, and this test run) show "3.1.0 available" from a local feed
//   - Settings → Updates and About show 3.1.0 as this version
// Run (Linux, xvfb): SLOPAMP_ELECTRON=… SLOPAMP_APP=… xvfb-run -a node tests/update-310.js
'use strict';
const { launch, sleep } = require('./lib');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const APP = process.env.SLOPAMP_APP || path.join(__dirname, '..');

(async () => {
  const { isNewer, parseRelease, installerArgs } = require(path.join(APP, 'src/updater'));
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  const V = pkg.version;
  ok(V === '3.1.0', `package.json says ${V}`);
  ok(isNewer(V, '3.0.0') && isNewer(V, '2.9.9') && isNewer(`v${V}`, '3.0.0') && !isNewer(V, V) && !isNewer('3.0.0', V) && isNewer('3.1.1', V) && isNewer('3.2.0', V), `${V} is newer than 3.0.0 and 2.9.9; 3.1.1 and 3.2.0 than ${V}`);
  const hash = 'b'.repeat(64), url = `https://github.com/SlopAMP/SlopAMP/releases/download/v${V}/SlopAMP-Setup-${V}.exe`;
  const rel = (o) => ({ tag_name: `v${V}`, html_url: `https://github.com/SlopAMP/SlopAMP/releases/tag/v${V}`, body: `What's new in ${V}\n\nSHA256 (SlopAMP-Setup-${V}.exe): ${hash}\nSHA256 (SlopAMP-Portable-${V}.exe): ${'c'.repeat(64)}`,
    assets: [{ name: `SlopAMP-Setup-${V}.exe`, browser_download_url: url, size: 1000 }, { name: `SlopAMP-Portable-${V}.exe`, browser_download_url: url.replace('Setup', 'Portable'), size: 1000 }, { name: 'SHA256SUMS.txt', browser_download_url: url.replace(/[^/]+$/, 'SHA256SUMS.txt'), size: 10 }], ...o });
  for (const from of ['3.0.0', '2.9.9']) {
    const p = parseRelease(rel(), from);
    ok(p.newer && !p.error && p.file === `SlopAMP-Setup-${V}.exe` && p.sha256 === hash && p.url === url, `${from} reads a v${V} release: newer, the Setup asset (not Portable / SHA256SUMS), its SHA256`);
  }
  ok(parseRelease(rel({ body: 'no hash' }), '3.0.0').error === 'nohash', 'without the SHA256 line it won’t install it');
  ok(parseRelease(rel({ assets: [{ name: `SlopAMP-Portable-${V}.exe`, browser_download_url: url.replace('Setup', 'Portable') }] }), '3.0.0').error === 'noasset', 'a release with only the Portable exe isn’t installed');
  ok(!parseRelease(rel(), V).newer, `${V} doesn’t offer itself`);
  ok(JSON.stringify(installerArgs(4242, 'C:\\Program Files\\SlopAMP\\')) === JSON.stringify(['/S', '/UPDATE', '/PID=4242', '/D=C:\\Program Files\\SlopAMP']), 'the silent install command line is unchanged (/S /UPDATE /PID= /D=)');

  // a local feed with a release of this version; the app pretends to be 3.0.0, then 2.9.9
  const FEED = path.join(os.tmpdir(), 'slopamp-310-feed'); fs.rmSync(FEED, { recursive: true, force: true }); fs.mkdirSync(FEED, { recursive: true });
  const inst = Buffer.from('not a real installer'); fs.writeFileSync(path.join(FEED, `SlopAMP-Setup-${V}.exe`), inst);
  const h = crypto.createHash('sha256').update(inst).digest('hex');
  fs.writeFileSync(path.join(FEED, 'release.json'), JSON.stringify({ tag_name: `v${V}`, html_url: `https://github.com/SlopAMP/SlopAMP/releases/tag/v${V}`, published_at: new Date().toISOString(),
    body: `- **Electron 45.**\n\nWhat's new in ${V}: SlopAMP runs on Electron 45.\n\nSHA256 (SlopAMP-Setup-${V}.exe): ${h}`,
    assets: [{ name: `SlopAMP-Setup-${V}.exe`, browser_download_url: `SlopAMP-Setup-${V}.exe`, size: inst.length }] }));
  process.env.SLOPAMP_UPDATE_TEST = path.join(FEED, 'release.json');
  for (const from of ['3.0.0', '2.9.9']) {
    process.env.SLOPAMP_TEST_VERSION = from;
    const { app, win, errs } = await launch(path.join(os.tmpdir(), `slopamp-test-310u-${from}`));
    const ev = (f, a) => win.evaluate(f, a);
    let st = null;
    for (let k = 0; k < 30; k++) { st = await ev(() => (typeof UPD !== 'undefined' && UPD ? { status: UPD.status, v: UPD.release && UPD.release.version, cur: UPD.current, can: UPD.canInstall, notes: UPD.release && UPD.release.notes } : null)); if (st && st.status === 'available') break; await sleep(500); }
    ok(st && st.status === 'available' && st.v === V && st.cur === from && !st.can, `a ${from} that can't install (Portable) finds ${V}: ${JSON.stringify({ ...st, notes: undefined })}`);
    ok(st && !/SHA256/.test(String(st.notes || '')), 'its What’s new shows the notes without the SHA256 line');
    const bar = await ev(() => WM.$('#updBar').textContent.replace(/\s+/g, ' ').trim());
    ok(new RegExp(V.replace(/\./g, '\\.')).test(bar), `the update note says so: "${bar.slice(0, 100)}"`);
    ok(!errs.length, `no errors in the windows ${JSON.stringify(errs.slice(0, 3))}`);
    await app.close();
  }
  // without the test feed: this version shows itself
  delete process.env.SLOPAMP_UPDATE_TEST; delete process.env.SLOPAMP_TEST_VERSION;
  const { app, win } = await launch(path.join(os.tmpdir(), 'slopamp-test-310v'));
  await win.evaluate(() => setOpen('updates')); await sleep(800);
  let ver = '';
  for (let k = 0; k < 20 && !ver; k++) { ver = await win.evaluate(() => (WM.$('#setVer') ? WM.$('#setVer').textContent : '')); if (ver === 'Version') ver = ''; if (!ver) await sleep(250); }
  ok(ver === `SlopAMP ${V}`, `Settings → Updates: "${ver}"`);
  await win.evaluate(() => openAbout()); await sleep(500);
  ok(await win.evaluate((v) => WM.$('#aboutDlg').textContent.includes(v), V), `About shows ${V}`);
  await app.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
