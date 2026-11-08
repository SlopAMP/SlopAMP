// 2.9.2: the Settings window (every way in, sections, search, the moved settings, the new ones), SAVE ALL /
// QUICK SAVE of empty tabs, the ⚙ on the playlist's bottom bar, LIBRARY, the About disclaimer.
// Run (Linux, xvfb): SLOPAMP_ELECTRON=… SLOPAMP_APP=… xvfb-run -a node tests/settings-292.js
// yt-dlp is tests/fake-ytdlp.js (it logs each call's arguments), so nothing goes online.
'use strict';
const { launch, sleep } = require('./lib');
const fs = require('fs'), path = require('path'), os = require('os');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const H = path.join(os.tmpdir(), 'slopamp-test-292');
const MB = 1024 * 1024;

(async () => {
  process.env.SLOPAMP_YTDLP = path.join(__dirname, 'fake-ytdlp.js');
  let { app, win, errs } = await launch(H);
  let ev = (f, a) => win.evaluate(f, a);
  const allErrs = [];
  const dl = (await app.evaluate(({ app }) => app.getPath('downloads'))) + '/SlopAMP';
  const V = `${dl}/Video`, A = `${dl}/Audio`, PL = `${dl}/Playlists`;
  for (const d of [V, A, PL]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(H, 'fake-x.json'), JSON.stringify({ base: 'http://127.0.0.1:1', posts: {
    aaaaaaaaaa1: { size: 5 * MB, title: 'Song One' },
    aaaaaaaaaa2: { size: 100 * MB, title: 'Warn Me' },
    aaaaaaaaaa3: { size: 5 * MB, title: 'Slow One', delay: 9000 },
    '1777': { mode: 'ok' }
  } }));
  const log = () => (fs.existsSync(path.join(H, 'fake-x.log')) ? fs.readFileSync(path.join(H, 'fake-x.log'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
  const vis = () => ev(() => ({ v: SETV.visible, sec: [...WM.$$('#setMain .set-sec.on')].map(s => s.dataset.s), nav: (WM.$('#setNav button.on') || {}).dataset ? WM.$('#setNav button.on').dataset.s : '' }));
  const winShown = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.isVisible()).length);
  const toastTxt = () => ev(() => WM.$('#toast').classList.contains('hidden') ? '' : WM.$('#toast').textContent);
  const change = (id, v) => ev(([id, v]) => { const e = WM.$(id); if (e.type === 'checkbox') e.checked = v; else e.value = String(v); e.dispatchEvent(new Event('change')); }, [id, v]);

  // ================= the bottom bar, LIBRARY, About
  const bar = await ev(() => ({ ids: [...WM.$('#pDlAll').parentElement.children].map(b => b.id).filter(Boolean), set: WM.$('#pSet').textContent.trim(), tip: WM.$('#pSet').title, lib: WM.$('#pDlm').textContent.trim() }));
  ok(bar.ids[0] === 'pSet' && bar.ids[1] === 'pDlAll' && bar.set === '⚙' && /Settings/.test(bar.tip), `⚙ (icon only) first on the bottom bar, before DOWNLOAD ALL ${JSON.stringify(bar.ids.slice(0, 3))}`);
  ok(bar.lib === 'LIBRARY', `MANAGE LIBRARY is now "${bar.lib}"`);
  ok(await ev(() => /Not affiliated with or endorsed by Winamp, VideoLAN, YouTube\/Google, or X\./.test(WM.$('#aboutDlg').textContent)), 'the About disclaimer names X');
  ok(await ev(() => !WM.$('#aboutDlg #dlLimitSel') && !WM.$('#aboutDlg #sysTray') && !!WM.$('#aboutSet')), '"?" is About + Settings… (the settings moved out)');

  // ================= every way in
  const shown0 = await winShown();
  await ev(() => WM.$('#btnSettings').click()); await sleep(400);
  let s = await vis();
  ok(s.v && s.sec.join() === 'general' && s.nav === 'general', `⚙ in the title bar opens Settings on General ${JSON.stringify(s)}`);
  ok(await winShown() === shown0 + 1, 'it is its own window');
  ok(await ev(() => !!WM.$('#btnSettings') && WM.$('#btnSettings').nextElementSibling && /About|\?/.test(WM.$('#btnSettings').nextElementSibling.title || WM.$('#btnSettings').nextElementSibling.textContent)), '⚙ sits before "?" in the title bar');
  await ev(() => WM.$('#setDone').click()); await sleep(300);
  ok(!(await vis()).v && await winShown() === shown0, 'Done closes it');
  await ev(() => WM.$('#pSet').click()); await sleep(300);
  ok((await vis()).v, 'the bottom bar ⚙ opens it');
  await ev(() => { const d = WM.doc('settings'); d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }); await sleep(300);
  ok(!(await vis()).v, 'Esc closes it');
  await ev(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true }))); await sleep(300);
  ok((await vis()).v, 'Ctrl+, opens it');
  await ev(() => WM.$('#setCloseBtn').click()); await sleep(200);
  ok(!(await vis()).v, 'its ✕ closes it');
  await ev(() => { openAbout(); }); await sleep(400);
  await ev(() => WM.$('#aboutSet').click()); await sleep(300);
  ok((await vis()).v && !(await ev(() => WM.$('#aboutDlg').open)), '"?" → Settings… closes About and opens Settings');
  await ev(() => setClose());
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => /index\.html/.test(w.webContents.getURL())).webContents.send('sys:settings')); await sleep(400);
  ok((await vis()).v, 'the tray menu’s Settings… opens it');
  const tray = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  ok(/label: 'Settings…'.*sys:settings/.test(tray), 'the tray menu has Settings…');

  // ================= sections and search
  const navs = await ev(() => [...WM.$$('#setNav button')].map(b => b.textContent.replace(/^\S+/, '').trim() || b.textContent));
  ok(navs.length === 9, `9 sections ${JSON.stringify(navs)}`);
  await ev(() => WM.$('#setNav button[data-s="downloads"]').click()); await sleep(100);
  s = await vis();
  ok(s.sec.join() === 'downloads' && s.nav === 'downloads', 'a section on the left shows just that section');
  await ev(() => { const i = WM.$('#setSearch'); i.value = 'mp3'; i.dispatchEvent(new Event('input')); }); await sleep(100);
  let found = await ev(() => [...WM.$$('#setMain .set-sec.on .set-row:not(.set-hide) .set-lbl')].map(e => e.textContent));
  ok(found.includes('MP3 quality') && found.includes('MP3s') && !found.includes('Video quality') && (await vis()).nav === '', `search "mp3": ${JSON.stringify(found)}`);
  await ev(() => { const i = WM.$('#setSearch'); i.value = 'history order'; i.dispatchEvent(new Event('input')); }); await sleep(100);
  found = await ev(() => [...WM.$$('#setMain .set-sec.on .set-row:not(.set-hide) .set-lbl')].map(e => e.textContent));
  ok(JSON.stringify(found) === '["Order","Order"]', `search "history order" finds both History orders ${JSON.stringify(found)}`);
  await ev(() => { const i = WM.$('#setSearch'); i.value = 'tray'; i.dispatchEvent(new Event('input')); }); await sleep(100);
  found = await ev(() => [...WM.$$('#setMain .set-sec.on .set-row:not(.set-hide) .set-lbl')].map(e => e.textContent));
  ok(found.includes('Minimize to the tray'), `search "tray" ${JSON.stringify(found)}`);
  await ev(() => { const i = WM.$('#setSearch'); i.value = 'zzqqxx'; i.dispatchEvent(new Event('input')); }); await sleep(100);
  ok(await ev(() => !WM.$('#setNone').classList.contains('hidden') && /zzqqxx/.test(WM.$('#setNone').textContent) && !WM.$$('#setMain .set-sec.on').length), 'no match: says so');
  await ev(() => WM.$('#setSearchX').click()); await sleep(100);
  s = await vis();
  ok(s.sec.join() === 'downloads' && await ev(() => WM.$('#setSearch').value === '' && WM.$('#setNone').classList.contains('hidden')), '✕ clears the search, back to the section');

  // ================= the settings that moved here still work (and the old spots stay shortcuts)
  await change('#setRemaining', true);
  ok(await ev(() => S.remaining === true), 'Playback → Show remaining time');
  await ev(() => WM.$('#clock').click()); await sleep(200);
  ok(await ev(() => S.remaining === false && WM.$('#setRemaining').checked === false), 'clicking the clock updates the Settings window too');
  await change('#setEq', false);
  ok(await ev(() => S.eq.on === false), 'Playback → Equalizer on (off)');
  await ev(() => WM.$('#eqOn').click()); await sleep(200);
  ok(await ev(() => S.eq.on === true && WM.$('#setEq').checked), 'the EQ’s ON button updates it');
  await change('#dlFmtSel', 'best');
  ok(await ev(() => S.dlFormat === 'best'), 'Downloads → Video quality');
  await change('#dlFmtSel', 'xready');
  ok(await ev(() => WM.$('#setDirVideoP').textContent.endsWith('Video') && WM.$('#setDirAudioP').textContent.endsWith('Audio')), 'Downloads → the folders are shown');
  await change('#setHytOrder', 'oldest'); await sleep(200);
  ok(await ev(() => hs('yt').order === 'oldest'), 'History → YT order');
  await change('#setHxCap', '250'); await sleep(200);
  ok(await ev(() => hs('x').cap === 250), 'History → X keeps 250');
  ok(await ev(() => [...WM.$('#setHytCap').options].map(o => o.textContent).join('|')) === 'The newest 50|The newest 100|The newest 250|The newest 500|All (no limit)|Custom…', 'History → Keep choices');
  await change('#setHxOn', false); await sleep(200);
  ok(await ev(() => hs('x').on === false), 'History → Record X plays (off)');
  await change('#setHxOn', true); await sleep(200);
  const lay = await ev(() => [...WM.$('#setLayout').options].map(o => o.textContent));
  ok(lay.includes('Classic (stacked)') && lay.includes('Big visualizer'), `Look → Window layout ${JSON.stringify(lay)}`);
  await change('#setSnap', false); await sleep(300);
  ok(await ev(() => WM.info.snap === false), 'Look → Snap (off)');
  await change('#setSnap', true); await sleep(300);
  const skins = await ev(() => ({ n: WM.$('#setSkin').options.length, v: WM.$('#setSkin').value, cur: WM.skins.current }));
  ok(skins.n >= 5 && skins.v === skins.cur, `Look → Skin lists the skins, the current one picked ${JSON.stringify(skins)}`);
  const other = await ev(() => [...WM.$('#setSkin').options].map(o => o.value).find(v => v !== WM.skins.current));
  await change('#setSkin', other); await sleep(800);
  ok(await ev((o) => WM.skins.current === o, other), `Look → Skin applies ${other}`);
  await change('#setVis', 'bars'); await sleep(200);
  ok(await ev(() => S.vis.mode === 'bars'), 'Look → Visualizer style');
  await change('#setVisCycle', false);
  ok(await ev(() => S.vis.cycle === false), 'Look → Change preset by itself (off)');
  ok(await ev(() => WM.$('#setVisFav').disabled), 'Only my ★ presets: off until there are some');
  ok(await ev(() => /^SlopAMP \d+\.\d+\.\d+$/.test(WM.$('#setVer').textContent)), `Updates → version ${await ev(() => WM.$('#setVer').textContent)}`);
  await change('#xPlaySel', 'ask');
  ok(await ev(() => S.xPlay === 'ask'), 'YouTube & X → X posts: Ask me');
  await change('#xPlaySel', 'stream');

  // ================= the new settings
  // Skip countdown: 5 s, Off
  await change('#setSkip', '5');
  ok(await ev(() => S.skipSecs === 5 && stateSnapshot().skipSecs === 5), 'Skip countdown: 5 s is saved');
  const cdSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  ok(/CD\.left = S\.skipSecs \|\| SKIP_SECS/.test(cdSrc) && /if \(!S\.skipSecs\) return false;/.test(cdSrc), 'the countdown uses the setting; Off means none');
  await ev(() => { addDescribed([{ url: 'https://www.youtube.com/watch?v=bbbbbbbbbb1', title: 'B1' }, { url: 'https://www.youtube.com/watch?v=bbbbbbbbbb2', title: 'B2' }], undefined, false); }); await sleep(300);
  await change('#setSkip', '0');
  ok(await ev(() => countdownOk(null) === false && (S.skipSecs = 5, countdownOk(null)) === true && (S.skipSecs = 0) === 0), 'Skip countdown Off: no countdown (5 s: there is one)');
  // MP3 quality → yt-dlp's --audio-quality (and the size check)
  await change('#setMp3', '192');
  await ev(() => { addDescribed([{ url: 'https://www.youtube.com/watch?v=aaaaaaaaaa1', title: 'Song One' }], undefined, false); }); await sleep(300);
  await ev(() => { startDownload(S.items.find(i => i.vid === 'aaaaaaaaaa1'), 'audio', 'best'); });
  let t0 = Date.now(); while (Date.now() - t0 < 15000 && !fs.readdirSync(A).some(f => /Song One/.test(f))) await sleep(200);
  const dlArgs = log().filter(c => c.id === 'aaaaaaaaaa1' && !c.args.includes('-j')).pop();
  ok(dlArgs && dlArgs.args[dlArgs.args.indexOf('--audio-quality') + 1] === '192K', `MP3 quality 192 → --audio-quality ${dlArgs && dlArgs.args[dlArgs.args.indexOf('--audio-quality') + 1]}`);
  await change('#setMp3', 'best');
  // X streaming quality → yt-dlp -f height
  await change('#setXq', '480');
  const xr = await ev(() => P.xResolve('https://x.com/someone/status/1777', { height: S.xq }));
  let xa = log().filter(c => c.id === '1777').pop();
  ok(xr.ok && xa && /height<=480/.test(xa.args[xa.args.indexOf('-f') + 1]), `X streaming 480p → -f ${xa && xa.args[xa.args.indexOf('-f') + 1]}`);
  ok(/P\.xResolve\(item\.url, \{ fresh, height: S\.xq \}\)/.test(cdSrc) && /P\.xResolve\(it\.url, \{ height: S\.xq \}\)/.test(cdSrc), 'playing and prefetching an X post pass the setting');
  await ev(() => P.xResolve('https://x.com/someone/status/1777', { height: 1080 }));
  xa = log().filter(c => c.id === '1777').pop();
  ok(/height<=1080/.test(xa.args[xa.args.indexOf('-f') + 1]), '1080p is its own answer (not the 480p one from the cache)');
  await change('#setXq', '720');
  // Warn me at 90%: limit 1 GB, 850 MB used, a 100 MB download → a note, and it still downloads
  fs.writeFileSync(`${V}/Big [cccccccccc1].mp4`, ''); fs.truncateSync(`${V}/Big [cccccccccc1].mp4`, 850 * MB);
  await ev(() => { S.dlLimit = 1; roomPaintSettings(); });
  await ev(() => { addDescribed([{ url: 'https://www.youtube.com/watch?v=aaaaaaaaaa2', title: 'Warn Me' }], undefined, false); }); await sleep(300);
  await ev(() => { startDownload(S.items.find(i => i.vid === 'aaaaaaaaaa2'), 'video', 'xready'); });
  let warn = ''; t0 = Date.now(); while (Date.now() - t0 < 8000 && !/full/.test(warn)) { warn = await toastTxt(); await sleep(100); }
  ok(/After this download your downloads folder is 9\d% full \(.+ of 1 GB\)/.test(warn), `90%: ${warn}`);
  t0 = Date.now(); while (Date.now() - t0 < 15000 && !fs.readdirSync(V).some(f => /Warn Me/.test(f))) await sleep(200);
  ok(fs.readdirSync(V).some(f => /Warn Me/.test(f)), '…and it downloads');
  fs.rmSync(fs.readdirSync(V).map(f => `${V}/${f}`).find(f => /Warn Me/.test(f)));
  await change('#setWarn', '0');
  await ev(() => { WM.$('#toast').classList.add('hidden'); ROOM.pending.clear(); startDownload(S.items.find(i => i.vid === 'aaaaaaaaaa2'), 'video', 'xready'); });
  t0 = Date.now(); while (Date.now() - t0 < 15000 && !fs.readdirSync(V).some(f => /Warn Me/.test(f))) await sleep(200);
  ok(!/full/.test(await toastTxt()), 'Warn me: Never → no note');
  for (const f of fs.readdirSync(V)) fs.rmSync(`${V}/${f}`);
  await ev(() => { S.dlLimit = 0; S.dlWarn = 90; });

  // ================= SAVE ALL / QUICK SAVE with empty tabs
  await ev(() => { const n = newTab(); S.tabs[n].name = 'Emptied'; switchTab(n); addDescribed([{ url: 'https://www.youtube.com/watch?v=dddddddddd1', title: 'D1' }], undefined, false); }); await sleep(300);
  await ev(() => quickSaveAll()); await sleep(600);
  ok(/D1/.test(fs.readFileSync(`${PL}/Emptied.m3u8`, 'utf8')), 'SAVE ALL wrote the tab');
  await ev(() => { S.items.splice(0); renderList(); }); await sleep(100);
  await ev(() => quickSaveAll()); await sleep(600);
  let txt = fs.readFileSync(`${PL}/Emptied.m3u8`, 'utf8');
  ok(!/D1/.test(txt) && /#EXTM3U/.test(txt), 'SAVE ALL on an emptied tab empties its file');
  ok(/now empty/.test(await toastTxt()), `…and says so: ${await toastTxt()}`);
  await ev(() => { addDescribed([{ url: 'https://www.youtube.com/watch?v=dddddddddd2', title: 'D2' }], undefined, false); }); await sleep(300);
  await ev(() => quickSavePlaylist()); await sleep(500);
  ok(/D2/.test(fs.readFileSync(`${PL}/Emptied.m3u8`, 'utf8')), 'QUICK SAVE wrote the tab');
  await ev(() => { S.items.splice(0); renderList(); }); await sleep(100);
  await ev(() => quickSavePlaylist()); await sleep(500);
  txt = fs.readFileSync(`${PL}/Emptied.m3u8`, 'utf8');
  ok(!/D2/.test(txt) && /now empty/.test(await toastTxt()), `QUICK SAVE on an empty tab empties its file too (${await toastTxt()})`);
  await ev(() => switchTab(S.tabs.findIndex(t => !isHist(t))));

  // ================= Ask before closing while something downloads
  await ev(() => { addDescribed([{ url: 'https://www.youtube.com/watch?v=aaaaaaaaaa3', title: 'Slow One' }], undefined, false); }); await sleep(300);
  await ev(() => { startDownload(S.items.find(i => i.vid === 'aaaaaaaaaa3'), 'audio', 'best'); }); await sleep(1500);
  await ev(() => WM.$('#btnClose').click()); await sleep(800);
  const ask = await ev(() => ({ open: WM.$('#confirmDlg').open, t: WM.$('#confirmTitle').textContent, ok: WM.$('#confirmOk').textContent }));
  ok(ask.open && ask.t === 'A download is still running' && ask.ok === 'Close anyway', `✕ while downloading asks first ${JSON.stringify(ask)}`);
  await ev(() => WM.$('#confirmDlg').close('cancel')); await sleep(600);
  ok(await ev(() => !!document.body) && await winShown() >= 1, 'Cancel: SlopAMP stays open');
  // the setting is on by default and saved; off: ✕ just closes (the download stops)
  ok(await ev(() => stateSnapshot().askCloseDl === true), 'the question is on by default');
  allErrs.push(...errs);
  await ev(() => { setOpen('general'); });
  await change('#setAskClose', false); await sleep(400);
  // Open where you left off: play position kept for the restart
  await ev(() => {
    const it = S.items.find(i => i.vid === 'bbbbbbbbbb2'); it.duration = 1200;
    S.resume[resumeKey(it)] = { t: 400, at: Date.now() }; S.playTab = S.tab; PT().current = S.items.indexOf(it);
    S.startMode = 'top'; saveNow();
  }); await sleep(500);
  const closed = app.waitForEvent('close', { timeout: 15000 }).then(() => true).catch(() => false);
  await ev(() => WM.$('#btnClose').click());
  ok(await closed, 'with the question off, ✕ closes even while downloading');

  // ================= Open where you left off (after a restart): top / none / spot
  const boot = async (mode) => {
    const st = path.join(H, '.config/SlopAMP/slopamp-state.json');
    const j = JSON.parse(fs.readFileSync(st, 'utf8')); j.startMode = mode; fs.writeFileSync(st, JSON.stringify(j));
    ({ app, win, errs } = await launch(H, { keep: true })); ev = (f, a) => win.evaluate(f, a);
    await sleep(500);
    const r = await ev(() => ({ at: resumeAtBoot && resumeAtBoot.title, top: bootFromStart && bootFromStart.title, sel: S.sel.size, t: WM.$('#toast').classList.contains('hidden') ? '' : WM.$('#toast').textContent, mode: S.startMode, ask: S.askCloseDl }));
    return r;
  };
  let r = await boot('top');
  ok(r.mode === 'top' && r.at === 'B2' && r.top === 'B2' && !/Press Play to continue/.test(r.t), `the last item, from the start ${JSON.stringify(r)}`);
  ok(r.ask === false, 'Ask before closing (off) was saved');
  const noRes = await ev(() => { const it = S.items.find(i => i.vid === 'bbbbbbbbbb2'); const had = resumePoint(it); let o = {}; if (bootFromStart) { if (it === bootFromStart) o = { noResume: true }; bootFromStart = null; } return { had, o }; });
  ok(noRes.had === 400 && noRes.o.noResume, 'its first play skips the saved spot (the spot itself is kept)');
  await app.close();
  r = await boot('spot');
  ok(r.mode === 'spot' && r.at === 'B2' && !r.top && /Press Play to continue "B2" from 0?6:40/.test(r.t), `the last item, same spot ${JSON.stringify(r)}`);
  await app.close();
  r = await boot('none');
  ok(r.mode === 'none' && !r.at && !r.top && r.sel === 0, `the top of the playlist ${JSON.stringify(r)}`);
  await app.close();
  r = await boot('spot');
  ok(r.at === 'B2', `restarting without playing keeps the last item (back to "same spot" after a "top of the playlist" start) ${JSON.stringify(r)}`);
  allErrs.push(...errs);

  const bad = allErrs.filter(e => !/WebGL|GPU|net::ERR|Failed to load resource/i.test(e));
  ok(!bad.length, 'no page errors ' + JSON.stringify(bad.slice(0, 3)));
  await app.close();
  console.log(fails.length ? `${fails.length} FAILED` : 'ALL OK');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
