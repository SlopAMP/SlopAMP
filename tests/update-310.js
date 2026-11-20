// 3.1.0 (Electron 45): the version, and the update from 3.0.0 and 2.9.9 (the updater itself is unchanged)
//   - package.json is 3.1.0 (or later since 3.2.0); 3.1.0 is newer than 3.0.0 and 2.9.9 (and 3.1.1 / 3.2.0 than it)
//   - a v3.1.0 release with SlopAMP-Setup-3.1.0.exe and its "SHA256 (…): …" line is what 3.0.0 and 2.9.9 install
//     (the same names and line as every release); the silent install's command line is unchanged
//   - a 3.0.0 and a 2.9.9 that can't install (Portable, and this test run) show "3.1.0 available" from a local feed
//   - Settings → Updates and About show 3.1.0 as this version
//   - 3.2.0: the bar of a copy that can't install itself says "(portable)" on Windows (as before) and not on Linux
//     (the .deb): "SlopAMP X is out", What's new with the download page
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
  ok(V === '3.1.0' || isNewer(V, '3.1.0'), `package.json says ${V} (3.1.0 or later; 3.2.0: see linux-320.js)`);
  ok(isNewer('3.1.0', '3.0.0') && isNewer('3.1.0', '2.9.9') && isNewer('v3.1.0', '3.0.0') && !isNewer('3.1.0', '3.1.0') && !isNewer('3.0.0', '3.1.0') && isNewer('3.1.1', '3.1.0') && isNewer('3.2.0', '3.1.0'), '3.1.0 is newer than 3.0.0 and 2.9.9; 3.1.1 and 3.2.0 than 3.1.0');
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
  process.env.SLOPAMP_TEST_PLATFORM = 'win32';     // 3.2.0: these releases are Windows-only (the Linux side: linux-320.js)
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
    ok(/is out \(portable\)/.test(bar), `Windows, a copy that can't install itself (the Portable exe): "… is out (portable)", as before`);
    ok(!errs.length, `no errors in the windows ${JSON.stringify(errs.slice(0, 3))}`);
    await app.close();
  }
  // 3.2.0, Linux: a copy that can't install itself (the .deb; here a dev run) isn't "portable"
  {
    const L = path.join(os.tmpdir(), 'slopamp-310-feed-linux'); fs.rmSync(L, { recursive: true, force: true }); fs.mkdirSync(L, { recursive: true });
    const img = Buffer.from('not a real AppImage'); fs.writeFileSync(path.join(L, `SlopAMP-${V}-x86_64.AppImage`), img);
    fs.writeFileSync(path.join(L, 'release.json'), JSON.stringify({ tag_name: `v${V}`, html_url: `https://github.com/SlopAMP/SlopAMP/releases/tag/v${V}`, published_at: new Date().toISOString(),
      body: `What's new in ${V}\n\nSHA256 (SlopAMP-${V}-x86_64.AppImage): ${crypto.createHash('sha256').update(img).digest('hex')}`,
      assets: [{ name: `SlopAMP-${V}-x86_64.AppImage`, browser_download_url: `SlopAMP-${V}-x86_64.AppImage`, size: img.length }, { name: `SlopAMP-${V}-amd64.deb`, browser_download_url: `SlopAMP-${V}-amd64.deb`, size: 1 }] }));
    process.env.SLOPAMP_UPDATE_TEST = path.join(L, 'release.json'); process.env.SLOPAMP_TEST_VERSION = '3.1.9'; delete process.env.SLOPAMP_TEST_PLATFORM;
    const { app, win, errs } = await launch(path.join(os.tmpdir(), 'slopamp-test-310u-linux'));
    const ev = (f, a) => win.evaluate(f, a);
    let st = null;
    for (let k = 0; k < 30; k++) { st = await ev(() => (typeof UPD !== 'undefined' && UPD ? { status: UPD.status, v: UPD.release && UPD.release.version, can: UPD.canInstall, platform: UPD.platform } : null)); if (st && st.status === 'available') break; await sleep(500); }
    ok(st && st.status === 'available' && st.v === V && !st.can && st.platform === 'linux', `Linux, a 3.1.9 that can't install itself finds ${V}: ${JSON.stringify(st)}`);
    const bar = await ev(() => WM.$('#updBar').textContent.replace(/\s+/g, ' ').trim());
    ok(bar.startsWith(`SlopAMP ${V} is out`) && !/portable/i.test(bar) && /What’s new/.test(bar) && /Download page/.test(bar), `… its bar doesn't say "portable": "${bar}"`);
    await ev(() => openUpdNotes()); await sleep(300);
    const dlg = await ev(() => ({ go: WM.$('#updGo').textContent, meta: WM.$('#updMeta').textContent.trim() }));
    ok(dlg.go === 'Open download page' && /can’t update itself/.test(dlg.meta), `… What's new offers the download page: ${JSON.stringify(dlg)}`);
    await ev(() => WM.$('#updDlg').close()); await ev(() => setOpen('updates')); await sleep(500);
    const set = await ev(() => ({ hint: WM.$('#updHint').textContent, auto: !WM.$('#updModeSel option[value="auto"]').hidden, page: WM.$('#updCheck').textContent }));
    ok(!/portable/i.test(set.hint) && !set.auto && set.page === 'Download page', `… Settings → Updates: no "portable", no Install automatically, its button "${set.page}" ("${set.hint}")`);
    ok(!errs.length, `no errors in the windows ${JSON.stringify(errs.slice(0, 3))}`);
    await app.close();
  }
  // without the test feed: this version shows itself
  delete process.env.SLOPAMP_UPDATE_TEST; delete process.env.SLOPAMP_TEST_VERSION; delete process.env.SLOPAMP_TEST_PLATFORM;
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
