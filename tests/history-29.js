// SlopAMP 2.9.0 test: the two 2.9 bug fixes.
//  #5  the YouTube History and X History tabs always read "YT" and "X" (selected or not); the selected one keeps
//      its count; tooltips, the ⚙ heading, the Layout menu, messages and the synced file names don't change.
//  #6  an X post that really plays in SlopAMP goes into X History, streamed or from a downloaded copy (like
//      YouTube History); a post that couldn't play, Cancel, Skip and the Ask-me sheet add nothing; one entry
//      per post whichever way it played, keeping the post's link and its downloaded files; played from X History
//      itself only its time changes; "Record" off adds nothing; finished downloads still add it.
// X can't be reached from the test machine: the stand-in yt-dlp (fake-ytdlp.js) and a small video server here.
// Run: xvfb-run -a node tests/history-29.js   (needs ffmpeg on PATH to make its sample video)
const { launch, sleep } = require('./lib');
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const { execFileSync } = require('child_process');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const H = path.join(os.tmpdir(), 'slopamp-test-290');
const VID = path.join(os.tmpdir(), 'slopamp-test-290-media');
(async () => {
  fs.mkdirSync(VID, { recursive: true });
  const clip = path.join(VID, 'clip90.mp4');      // the name fake-ytdlp.js hands out
  if (!fs.existsSync(clip)) execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=20', '-f', 'lavfi', '-i', 'sine=f=440:d=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', '-y', clip]);
  const srv = http.createServer((req, res) => {
    const f = path.join(VID, decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/').filter(Boolean)[2] || ''));
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    const size = fs.statSync(f).size, m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    const a = m && m[1] ? +m[1] : 0, b = m && m[2] ? Math.min(+m[2], size - 1) : size - 1;
    res.writeHead(m ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1, ...(m ? { 'Content-Range': `bytes ${a}-${b}/${size}` } : {}) });
    fs.createReadStream(f, { start: a, end: b }).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  process.env.SLOPAMP_YTDLP = path.join(__dirname, 'fake-ytdlp.js');
  const { app, win, errs } = await launch(H);
  fs.writeFileSync(path.join(H, 'fake-x.json'), JSON.stringify({ base: `http://127.0.0.1:${srv.address().port}`, posts: {
    3001: { mode: 'ok', title: 'someone - streamed post', duration: 20 },
    3002: { mode: 'ok', title: 'someone - downloaded post', duration: 20 },
    3003: { mode: 'ok', title: 'someone - both ways', duration: 20 },
    3004: { mode: 'fail', error: 'ERROR: [twitter] 3004: NSFW tweet requires authentication' },
    3005: { mode: 'ok', delay: 2500, duration: 20 },
    3006: { mode: 'ok', duration: 20 },
    3007: { mode: 'ok', duration: 20 }
  } }));
  const ev = (f, a) => win.evaluate(f, a);
  const waitPlay = async (ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(() => status === 'playing' && currentTime() > 0.2)) return true; await sleep(150); } console.log('  (waitPlay gave up: ' + JSON.stringify(await ev(() => ({ status, t: currentTime(), engine, cur: curItem() && curItem().vid, ov: $('#ovTitle').textContent, x: !!L.x })) ) + ')'); return false; };
  const xh = () => ev(() => (histTab('x') ? histTab('x').items.map(i => ({ vid: i.vid, url: i.url, title: i.title, at: i.at, lv: i.localVideo || '' })) : null));
  const yh = () => ev(() => (histTab('yt') ? histTab('yt').items.map(i => i.vid) : null));
  const tabs = () => ev(() => [...WM.$$('#tabStrip .ptab')].map(el => ({ nm: el.querySelector('.nm') ? el.querySelector('.nm').textContent : '', ct: el.querySelector('.ct') ? getComputedStyle(el.querySelector('.ct')).display !== 'none' && el.querySelector('.ct').textContent : false, compact: el.classList.contains('compact'), on: el.classList.contains('on'), title: el.title })));

  // ================= #5: History tab labels
  await ev(() => { histEnsureTab('yt'); histEnsureTab('x'); const t = histTab('yt'); t.items.push({ id: nid(), type: 'youtube', url: 'https://www.youtube.com/watch?v=UyhAC0AZM4Y', vid: 'UyhAC0AZM4Y', title: 'Night Drive', at: Date.now() }); switchTab(S.tabs.findIndex(x => !isHist(x))); renderTabs(); });
  await sleep(300);
  let tb = await tabs();
  ok(tb[0].nm === 'YT' && tb[1].nm === 'X' && tb[0].compact && tb[1].compact && tb[0].ct === false && tb[1].ct === false, `Main selected: the History tabs read "YT" / "X" without counts ${JSON.stringify(tb.slice(0, 2).map(t => [t.nm, t.ct]))}`);
  await ev(() => switchTab(S.tabs.findIndex(x => x.id === HK.yt.id))); await sleep(300);
  tb = await tabs();
  ok(tb[0].on && tb[0].nm === 'YT' && !tb[0].compact && tb[0].ct === '1', `YT History selected: still "YT", with its count ${JSON.stringify([tb[0].nm, tb[0].ct])}`);
  ok(tb[1].nm === 'X' && tb[1].compact, 'X History not selected: "X"');
  await ev(() => switchTab(S.tabs.findIndex(x => x.id === HK.x.id))); await sleep(300);
  tb = await tabs();
  ok(tb[1].on && tb[1].nm === 'X' && !tb[1].compact && tb[1].ct === '0' && tb[0].nm === 'YT', `X History selected: still "X", with its count ${JSON.stringify([tb[1].nm, tb[1].ct])}`);
  ok(tb.every(t => !/History/.test(t.nm)), `no tab label says "History" ${JSON.stringify(tb.map(t => t.nm))}`);
  ok(/^YouTube History — 1 video\n/.test(tb[0].title) && /^X History — 0 posts\n/.test(tb[1].title), 'tooltips unchanged ("YouTube History — 1 video", "X History — 0 posts")');
  const fixed = await ev(() => ({ tYT: histTab('yt').name, tX: histTab('x').name, fYT: HK.yt.file, fX: HK.x.file, fullYT: HK.yt.full, fullX: HK.x.full }));
  ok(fixed.tYT === 'YT History' && fixed.tX === 'X History' && fixed.fYT === 'YouTube History.m3u8' && fixed.fX === 'X History.m3u8' && fixed.fullYT === 'YouTube History', 'tab names kept (saved state), synced file names and full names unchanged ' + JSON.stringify(fixed));
  // the ⚙ settings heading and the Layout menu still use the full names
  await ev(() => { const r = WM.$('#btnLayout').getBoundingClientRect(); WM.$('#btnLayout').click(); }); await sleep(600);
  const lay = await ev(() => [...WM.$$('#wmMenu .dm-item')].map(d => d.textContent));
  ok(lay.includes('YouTube History') && lay.includes('X History'), 'Layout menu still lists "YouTube History" / "X History"');
  await ev(() => WM.$('#wmMenu').classList.add('hidden'));
  ok(await ev(() => histNoAdd('yt').startsWith('YouTube History fills itself') && /^Clear/.test('Clear ' + HK.yt.full)), 'messages still say "YouTube History"');
  // a long tab strip: the labels don't grow when selected (YT / X stay narrow)
  const w = await ev(() => { const el = WM.$(`#tabStrip .ptab[data-t="${S.tabs.findIndex(x => x.id === HK.x.id)}"]`); return el.getBoundingClientRect().width; });
  ok(w < 80, `the selected X tab stays narrow (${Math.round(w)} px)`);
  await ev(() => switchTab(S.tabs.findIndex(x => !isHist(x)))); await sleep(200);

  // ================= #6: X posts that play go into X History
  ok((await xh()).length === 0, 'X History starts empty');
  const u = (n) => `https://x.com/someone/status/${n}`;
  await ev((u) => { addDescribed([3001, 3002, 3003, 3004, 3005, 3006].map(n => ({ url: u + n, title: '@someone · X post' })), undefined, false); }, u(''));
  await sleep(800);
  const idx = (n) => ev((url) => S.items.findIndex(i => i.url === url), u(n));
  // streamed
  await ev((i) => { playIndex(i); }, await idx(3001)); ok(await waitPlay(), 'post 3001 streams'); await sleep(300);
  let x = await xh();
  ok(x.length === 1 && x[0].vid === 'x3001' && x[0].url === u(3001) && x[0].title === 'someone - streamed post', `a streamed post goes into X History with its link and title ${JSON.stringify(x)}`);
  ok((await yh()).length === 1, 'YT History isn’t touched by X posts');
  const at1 = x[0].at;
  // played again (from Main): still one entry, moved up with a new time ("replays move up", the default)
  await ev(() => stop()); await sleep(1100);
  await ev((i) => { playIndex(i); }, await idx(3001)); await waitPlay(); await sleep(300);
  x = await xh();
  ok(x.length === 1 && x[0].at > at1, 'playing it again: still one entry, newer time');
  // a downloaded copy
  await ev(({ i, f }) => { S.items[i].localVideo = f; }, { i: await idx(3002), f: clip });
  const calls0 = fs.readFileSync(path.join(H, 'fake-x.log'), 'utf8').split('\n').filter(l => l.includes('"3002"')).length;
  await ev((i) => { playIndex(i); }, await idx(3002)); ok(await waitPlay(), 'post 3002 plays its downloaded copy'); await sleep(300);
  x = await xh();
  ok(await ev(() => $('#indSrc').textContent) === 'FILE', 'from the file (light FILE)');
  ok(x[0].vid === 'x3002' && x[0].lv === clip && x[0].url === u(3002) && x.length === 2, `a post played from its downloaded copy goes in too, with its file ${JSON.stringify(x[0])}`);
  // the same post both ways: streamed, then a downloaded copy (another playlist item of the same post) → one entry
  await ev((i) => { playIndex(i); }, await idx(3003)); await waitPlay(); await sleep(300);
  await ev(({ url, f }) => { const t = S.tabs[S.tab]; t.items.push({ id: nid(), type: 'x', url, vid: 'x3003', title: 'someone - both ways', localVideo: f }); renderList(); }, { url: u(3003), f: clip });
  await ev(() => { playIndex(S.items.length - 1); }); await waitPlay(); await sleep(300);
  x = await xh();
  const e3 = x.filter(e => e.vid === 'x3003');
  ok(e3.length === 1 && e3[0].url === u(3003) && e3[0].lv === clip && x[0].vid === 'x3003', `streamed and downloaded copies of one post are one entry (the post's link, its file kept, moved up) ${JSON.stringify(e3)}`);
  // …and the other way round: downloaded first (3002, above), then streamed after the copy is gone
  await ev(({ i }) => { delete S.items[i].localVideo; }, { i: await idx(3002) });
  await ev((i) => { playIndex(i); }, await idx(3002)); await waitPlay(); await sleep(300);
  x = await xh();
  const e2 = x.filter(e => e.vid === 'x3002');
  ok(e2.length === 1 && e2[0].lv === clip && x[0].vid === 'x3002', `downloaded, then streamed: still one entry, keeping the file it had ${JSON.stringify(e2)}`);
  const n0 = x.length;
  // a post that couldn't play
  await ev((i) => { playIndex(i); }, await idx(3004));
  for (let k = 0; k < 40 && !(await ev(() => /Couldn/.test($('#ovTitle').textContent) && $('#overlay').classList.contains('show'))); k++) await sleep(200);
  ok(await ev(() => /Couldn/.test($('#ovTitle').textContent)), 'post 3004 can’t play (sign-in only): the error box');
  ok((await xh()).length === n0 && !(await xh()).some(e => e.vid === 'x3004'), 'a post that couldn’t play adds nothing');
  // Skip from that box: the next post plays and is added; 3004 still isn't
  await ev(() => [...$('#ovBtns').children].find(b => /^Skip/.test(b.textContent)).click()); await waitPlay(); await sleep(300);
  x = await xh();
  ok(x[0].vid === 'x3005' && !x.some(e => e.vid === 'x3004'), 'Skip: the next post plays and goes in; the skipped one doesn’t');
  // Cancel while getting the video
  await ev(() => { const it = S.items.find(i => i.vid === 'x3005'); playIndex(S.items.indexOf(it), 0, { noResume: true }); });   // its link is kept now: no box
  await waitPlay(); await ev(() => stop());
  await ev(({ url }) => { const t = S.tabs[S.tab]; t.items.push({ id: nid(), type: 'x', url, vid: 'x3007', title: '@someone · X post' }); renderList(); }, { url: u(3007) });
  fs.writeFileSync(path.join(H, 'fake-x.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(H, 'fake-x.json'), 'utf8')), posts: { ...JSON.parse(fs.readFileSync(path.join(H, 'fake-x.json'), 'utf8')).posts, 3007: { mode: 'ok', delay: 2500, duration: 20 } } }));
  await ev(() => { playIndex(S.items.length - 1); }); await sleep(900);
  await ev(() => [...$('#ovBtns').children].find(b => b.textContent === 'Cancel').click()); await sleep(2600);
  ok(!(await xh()).some(e => e.vid === 'x3007') && await ev(() => status === 'stopped'), 'Cancel while getting the video adds nothing');
  // Ask me: the sheet alone adds nothing; ▶ Play here does
  await ev(() => { S.xPlay = 'ask'; playIndex(S.items.findIndex(i => i.vid === 'x3006')); }); await sleep(600);
  ok(!(await xh()).some(e => e.vid === 'x3006'), 'Ask me: the sheet on its own adds nothing');
  await ev(() => [...$('#ovBtns').children][0].click()); await waitPlay(); await sleep(300);
  ok((await xh())[0].vid === 'x3006', '…▶ Play here adds it once it plays');
  await ev(() => { S.xPlay = 'stream'; });
  // played from inside X History: only its time changes
  await ev(() => switchTab(S.tabs.findIndex(t => t.id === HK.x.id))); await sleep(300);
  const before = await xh();
  const last = before[before.length - 1];
  await ev((vid) => { const t = histTab('x'); playIndex(t.items.findIndex(i => i.vid === vid), 0, { tab: S.tabs.indexOf(t) }); }, last.vid);
  await waitPlay(); await sleep(300);
  const after = await xh();
  ok(after.length === before.length && JSON.stringify(after.map(e => e.vid)) === JSON.stringify(before.map(e => e.vid)) && after[after.length - 1].at > last.at, 'played from X History itself: no new entry, same order, newer time');
  await ev(() => switchTab(S.tabs.findIndex(x => !isHist(x)))); await sleep(200);
  // "Record X plays and downloads" off: nothing added
  await ev(() => { hs('x').on = false; });
  const nOff = (await xh()).length;
  await ev(() => { S.tabs[S.tab].items.push({ id: nid(), type: 'x', url: 'https://x.com/someone/status/3001/video/2', vid: 'x3001-2', title: '@someone · X post (video 2)' }); renderList(); playIndex(S.items.length - 1); });
  await waitPlay(); await sleep(300);
  ok((await xh()).length === nOff, 'Record off: a post that plays isn’t added');
  await ev(() => { hs('x').on = true; });
  // a finished download still adds it (2.2 rule kept)
  await ev(({ url, f }) => { const it = { id: nid(), type: 'x', url, vid: 'x3008', title: 'someone - just downloaded', localVideo: f }; S.tabs[S.tab].items.push(it); histXDownloaded(it); }, { url: u(3008), f: clip });
  ok((await xh())[0].vid === 'x3008', 'a finished X download still goes in, without playing');
  ok(await ev(() => HK.x.record === 'Record X plays and downloads' && HK.x.tipOn === 'Every X post you play or download is added here.'), 'X History’s settings and tips say plays and downloads');
  // the synced copy in Playlists
  await ev(() => stop()); await sleep(2200);
  const m3u = path.join(H, 'SlopAMP', 'Playlists', 'X History.m3u8');
  const txt = fs.existsSync(m3u) ? fs.readFileSync(m3u, 'utf8') : '';
  ok(txt.includes(u(3001)) && txt.includes(u(3002)) && !txt.includes(u(3004)), 'the synced Playlists\\X History.m3u8 lists the played posts (not the one that failed)');
  ok(/^YouTube History — 1 video\n/.test((await tabs())[0].title), 'YT History untouched (1 video)');
  const bad = errs.filter(e => !/WebGL|GPU|net::ERR|Failed to load resource/i.test(e));
  ok(!bad.length, 'no page errors ' + JSON.stringify(bad.slice(0, 3)));
  await app.close(); srv.close();
  console.log(fails.length ? `${fails.length} FAILED` : 'ALL OK');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
