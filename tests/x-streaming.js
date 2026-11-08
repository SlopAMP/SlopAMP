// SlopAMP 2.8 test: X posts play in SlopAMP's own player without downloading first. X can't be reached from the
// test machine, so a stand-in yt-dlp (fake-ytdlp.js) hands out links to a small video server run by this test,
// which answers Range requests like video.twimg.com and can refuse a link (403) the way an expired one is.
// Checks: the "Getting the video from X…" box and Cancel; playing through SlopAMP's media server (X light,
// seeking with Range, sound reaching the EQ / visualizer); the corner tag fading after 3 s; links kept for the
// session; the next X item's link fetched early; asking X once more on a failure; X's final answers not asked
// twice; the error box (X's player / Download / Play on X / Skip) and the X PLAYER window; an expired link
// mid-video; GIF posts loop; /video/2 picks the 2nd video; 720p cap; a downloaded copy still plays first;
// "?" → X posts: Ask me (with ▶ Play here); next / previous. (2.9: posts that played are in X History, see history-29.js.)
// Run: xvfb-run -a node tests/x-streaming.js   (needs ffmpeg on PATH to make its two sample videos)
const { launch, sleep, docWin } = require('./lib');
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const { execFileSync } = require('child_process');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const H = path.join(os.tmpdir(), 'slopamp-test-280');
const VID = path.join(os.tmpdir(), 'slopamp-test-280-media');
(async () => {
  // ---- main-process parts on their own (src/xstream.js)
  const { postUrl, classify } = require(path.join(process.env.SLOPAMP_APP || path.join(__dirname, '..'), 'src/xstream.js'));
  ok(postUrl('https://twitter.com/Some_One/status/123?s=20') === 'https://x.com/Some_One/status/123' && postUrl('https://mobile.x.com/a/status/9/video/2') === 'https://x.com/a/status/9/video/2' && postUrl('https://x.com/i/web/status/5') === 'https://x.com/i/web/status/5', 'post links are tidied (twitter.com, mobile., ?s=, /video/2, /i/web/status)');
  ok(postUrl('https://example.com/a/status/1') === null && postUrl('file:///x') === null && postUrl('https://x.com/home') === null, 'anything else isn’t a post');
  ok(classify('ERROR: [twitter] 1: No video could be found in this tweet') === 'novideo' && classify('ERROR: [twitter] 1: NSFW tweet requires authentication') === 'signin' && classify('ERROR: [twitter] 1: Tweet is unavailable') === 'gone' && classify('HTTP Error 429: Too Many Requests') === 'limit' && classify('getaddrinfo ENOTFOUND api.x.com') === 'network' && classify('ERROR: odd') === 'other', 'yt-dlp’s messages are sorted into no video / sign-in / gone / limit / network / other');
  // ---- sample videos: 90 s with sound (a tone; big enough, ~100 MB, that the player can't hold all of it, so seeking
  // far ahead has to ask "X" for that part), and a 2 s silent one for the GIF
  fs.mkdirSync(VID, { recursive: true });
  const mk = (name, args) => { const f = path.join(VID, name); if (!fs.existsSync(f)) execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args, '-movflags', '+faststart', '-y', f]); return f; };
  mk('clip90.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=25:d=90', '-f', 'lavfi', '-i', 'sine=f=440:d=90', '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '9M', '-maxrate', '9M', '-bufsize', '2M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
  mk('gif.mp4', ['-f', 'lavfi', '-i', 'testsrc=s=480x270:r=15:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an']);
  // ---- the stand-in for video.twimg.com
  const hits = []; const expired = new Set();
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const parts = u.pathname.split('/').filter(Boolean);
    const id = parts[1], file = path.join(VID, decodeURIComponent(parts[2] || ''));
    hits.push({ id, g: u.searchParams.get('g'), range: req.headers.range || '', ua: req.headers['user-agent'] || '' });
    if (expired.has(`${id}|${u.searchParams.get('g')}`)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    const size = fs.statSync(file).size; const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      const a = m[1] ? +m[1] : 0, b = m[2] ? Math.min(+m[2], size - 1) : size - 1;
      res.writeHead(206, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': b - a + 1, 'Access-Control-Allow-Origin': '*' });
      fs.createReadStream(file, { start: a, end: b }).pipe(res);
    } else { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': size }); fs.createReadStream(file).pipe(res); }
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const posts = {
    1001: { mode: 'ok', delay: 1300, title: 'someone - 3 Jeeps destroyed in 3 seconds!', duration: 90 },
    1002: { mode: 'ok', duration: 90 },
    1003: { mode: 'failonce', duration: 90 },
    1004: { mode: 'fail', error: 'ERROR: [twitter] 1004: NSFW tweet requires authentication. Use --cookies' },
    1005: { mode: 'fail', error: 'ERROR: [twitter] 1005: Something odd happened' },
    1006: { mode: 'ok', duration: 90 },
    1007: { mode: 'gif' },
    1008: { mode: 'ok', duration: 90 },
    1009: { mode: 'ok', duration: 90 },
    1010: { mode: 'ok', duration: 90 },
    1011: { mode: 'ok', delay: 2500, duration: 90 }
  };
  // launch (lib.js wipes H), then hand the fake its settings: it reads them at each call
  process.env.SLOPAMP_YTDLP = path.join(__dirname, 'fake-ytdlp.js');
  const { app, win, errs } = await launch(H);
  fs.writeFileSync(path.join(H, 'fake-x.json'), JSON.stringify({ base, posts }));
  const ev = (f, a) => win.evaluate(f, a);
  const calls = (id) => (fs.existsSync(path.join(H, 'fake-x.log')) ? fs.readFileSync(path.join(H, 'fake-x.log'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(c => !id || c.id === String(id)) : []);
  const st = () => ev(() => ({ engine, status, src: $('#indSrc').textContent, x: !!L.x, gif: L.x && L.x.gif, vsrc: video.getAttribute('src') || '', t: currentTime(), d: currentDuration(), loop: video.loop,
    ov: $('#overlay').classList.contains('show') ? $('#ovTitle').textContent : '', btns: [...$('#ovBtns').children].map(b => b.textContent), getting: $('#overlay').classList.contains('x-getting'),
    tag: $('#xTag').classList.contains('hidden') ? '' : $('#xTag').textContent, tagFade: $('#xTag').classList.contains('fade'), cur: curItem() && curItem().url, title: curItem() && curItem().title }));
  const waitFor = async (f, ms = 8000) => { const t0 = Date.now(); let s; while (Date.now() - t0 < ms) { s = await st(); if (f(s)) return s; await sleep(150); } return s; };
  const playing = (s) => s.status === 'playing' && s.t > 0.3;
  // the order matters: while an item plays, the next one's link is fetched early
  await ev(() => addDescribed([1001, 1002, 1004, 1003, 1010, 1005, 1006, 1007, '1008/video/2', 1009, 1011].map(n => ({ url: `https://x.com/someone/status/${n}`, title: `@someone · X post` })), undefined, false));
  await sleep(800);
  ok((await ev(() => S.xPlay)) === 'stream', 'default: X posts play right away (S.xPlay = stream)');
  // ================= 1. getting the video, then playing it
  await ev(() => { playIndex(0); }); await sleep(700);
  let s = await st();
  ok(s.ov === 'Getting the video from X…' && s.getting && JSON.stringify(s.btns) === '["Cancel"]', `"Getting the video from X…" box with Cancel while the link is fetched ${JSON.stringify([s.ov, s.btns])}`);
  s = await waitFor(playing);
  ok(playing(s) && s.engine === 'local' && s.x && !s.ov, `then it plays in SlopAMP's own player (engine local, box gone) ${JSON.stringify([s.status, s.engine, s.ov])}`);
  const mediaBase = await ev(() => location.origin);
  ok(s.vsrc.startsWith(`${mediaBase}/x/`) && /^[0-9a-f]{32}$/.test(s.vsrc.split('/x/')[1]), `the video comes through SlopAMP's media server (/x/<key>), not straight from X: ${s.vsrc.replace(mediaBase, '')}`);
  ok(s.src === 'X', `the source light reads X (${s.src})`);
  ok(s.title === 'someone - 3 Jeeps destroyed in 3 seconds!', `a stand-in title ("@user · X post") is replaced with the post's (${s.title})`);
  ok(s.tag === '𝕏 streaming · 720p' && !s.tagFade, `corner tag "${s.tag}"`);
  ok(Math.abs(s.d - 90) < 1, `duration known (${s.d})`);
  ok(hits.some(h => h.id === '1001' && h.ua === 'Mozilla/5.0 (fake)'), 'the media server asks X with yt-dlp’s User-Agent');
  const a1 = calls(1001)[0].args;
  ok(a1.includes('-j') && a1[a1.indexOf('-f') + 1].startsWith('best[protocol^=http][ext=mp4][height<=720]') && a1[a1.indexOf('--playlist-items') + 1] === '1', 'yt-dlp is asked for the link only (-j), best MP4 up to 720p, the first video');
  // sound reaches WebAudio (EQ / visualizer): a cross-origin stream would give silence here
  await sleep(600);
  const level = await ev(() => { const a = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(a); return a.reduce((x, y) => x + y, 0); });
  ok(level > 1000, `the sound goes through the EQ / visualizer (analyser level ${level})`);
  ok(calls(1002).length === 1, `while it plays, the next X item's link is fetched early (calls for the next post: ${calls(1002).length})`);
  await sleep(2800);
  s = await st();
  ok(s.tagFade, 'the corner tag fades after 3 s');
  // seeking: Range requests through the media server
  const before = hits.length;
  await ev(() => { seekTo(75); }); s = await waitFor((x) => x.t > 75.2 && x.status === 'playing');
  ok(s.t > 74.5 && s.t < 80 && s.status === 'playing', `seeking works (now at ${s.t.toFixed(1)} s)`);
  ok(hits.slice(before).some(h => h.id === '1001' && /^bytes=[1-9]\d*-/.test(h.range)), `the seek asked X for a later part of the file (Range ${hits.slice(before).map(h => h.range).join(', ')})`);
  ok((await ev(() => $('#pos').disabled)) === false, 'the seek bar is on');
  // ================= 2. next: the link fetched early plays without waiting; previous; cache for the session
  await ev(() => next()); await sleep(300);
  s = await st();
  ok(!s.ov, 'next: the next X post starts without the "Getting" box (its link was fetched early)');
  s = await waitFor(playing);
  ok(playing(s) && s.cur.endsWith('/1002') && calls(1002).length === 1, `…and plays (yt-dlp asked once for it: ${calls(1002).length})`);
  await ev(() => prev()); s = await waitFor((x) => playing(x) && x.cur.endsWith('/1001'));
  ok(playing(s) && s.cur.endsWith('/1001') && calls(1001).length === 1, `previous: the first post plays again from the session's link, no new yt-dlp call (${calls(1001).length})`);
  ok(!(await st()).ov, '…without the "Getting" box');
  ok(calls(1004).length === 1, 'while the 2nd post played, the 3rd’s link was asked for early (X’s answer: sign-in only)');
  // ================= 3. asked once more after a failure
  await ev(() => playIndex(3)); s = await waitFor(playing);
  ok(playing(s) && calls(1003).length === 2, `a failed answer is asked for once more, then it plays (yt-dlp calls: ${calls(1003).length})`);
  // ================= 4. X's final answer: not asked twice; the error box
  await ev(() => playIndex(2)); s = await waitFor((x) => !!x.ov && x.ov !== 'Getting the video from X…');
  ok(s.ov === 'Couldn’t play this X post', `error box: "${s.ov}"`);
  ok(JSON.stringify(s.btns.map(b => b.replace(/ \(\d+\)$/, ''))) === JSON.stringify(['▶ X’s player', '⇩ Download', 'Play on X', 'Skip']) && /\(\d+\)$/.test(s.btns[3]), `buttons ${JSON.stringify(s.btns)} (Skip counts down)`);
  ok(/signed-in accounts/.test(await ev(() => $('#ovText').textContent)), 'a sensitive post says X only shows it to signed-in accounts');
  ok(calls(1004).length === 1, `X's final answer (sign-in only) is kept for the session: not asked for again (${calls(1004).length})`);
  ok(s.engine === null && s.status === 'stopped', 'nothing plays behind the box');
  // ▶ X's player → the X PLAYER window with X's own post card
  await ev(() => [...$('#ovBtns').children][0].click()); await sleep(800);
  const xw = await ev(() => ({ shown: WM.isShown('xweb'), src: (WM.$('#xwView iframe') || {}).src || '', url: WM.$('#xwUrl').value, title: WM.frame('xweb').querySelector('.frame-name').textContent, ov: $('#overlay').classList.contains('show') }));
  ok(xw.shown && xw.title === 'X PLAYER' && !xw.ov, `▶ X’s player opens the X PLAYER window ${JSON.stringify([xw.shown, xw.title])}`);
  ok(xw.src === 'https://platform.twitter.com/embed/Tweet.html?id=1004&theme=dark&dnt=true&hideThread=true', `…with X’s own post card: ${xw.src}`);
  ok(xw.url === 'https://x.com/someone/status/1004', 'its address shows the post');
  const xwin = await docWin(app, 'win-xweb');
  ok(!!xwin && /platform\.twitter\.com/.test(await xwin.evaluate(() => document.querySelector('meta[http-equiv]') ? document.querySelector('meta[http-equiv]').content : '')), 'the window’s page allows X’s card (frame-src platform.twitter.com)');
  await ev(() => WM.$('#xwCloseBtn').click()); await sleep(500);
  ok(await ev(() => !WM.isShown('xweb') && !WM.$('#xwView iframe')), 'closing the X PLAYER removes the card (and its sound)');
  // a failure that isn't final: asked twice, then the box
  await ev(() => playIndex(5)); s = await waitFor((x) => x.ov === 'Couldn’t play this X post');
  ok(s.ov === 'Couldn’t play this X post' && calls(1005).length === 2, `any other failure: asked twice, then the error box (yt-dlp calls: ${calls(1005).length})`);
  ok(/even on a second try/.test(await ev(() => $('#ovText').textContent)), '…saying X didn’t hand it over even on a second try');
  // Skip goes on
  await ev(() => [...$('#ovBtns').children][3].click()); s = await waitFor(playing);
  ok(playing(s) && s.cur.endsWith('/1006'), 'Skip plays the next item');
  // ================= 5. the link expires mid-video: fetched again, plays on from the same spot
  await sleep(500);
  expired.add('1006|1');
  await ev(() => { seekTo(70); });                // a part not read yet: asked of "X", which now refuses the link
  s = await waitFor((x) => playing(x) && calls(1006).length === 2 && x.t > 70, 12000);
  ok(calls(1006).length === 2 && playing(s), `a link X refuses (403) mid-way is fetched again and the video goes on (yt-dlp calls: ${calls(1006).length})`);
  ok(s.t > 69 && s.t < 76, `…from the same spot (${s.t.toFixed(1)} s)`);
  ok(hits.some(h => h.id === '1006' && h.g === '1' && expired.has('1006|1')) && hits.some(h => h.id === '1006' && h.g === '2'), 'the new link was used');
  // ================= 6. GIF posts loop; /video/2
  await ev(() => playIndex(7)); s = await waitFor(playing);
  ok(playing(s) && s.gif && s.loop, `a GIF post loops (video.loop ${s.loop})`);
  ok(s.tag === '𝕏 streaming · GIF', `its tag says GIF (${s.tag})`);
  await sleep(2600);
  s = await st();
  ok(s.status === 'playing' && s.cur.endsWith('/1006') === false && s.cur.endsWith('/1007'), 'after its 2 s it goes round again (no skip to the next item)');
  await ev(() => playIndex(8)); s = await waitFor(playing);
  const a8 = calls(1008)[0] && calls(1008)[0].args;
  ok(playing(s) && a8 && a8[a8.indexOf('--playlist-items') + 1] === '2' && a8[a8.length - 1].endsWith('/status/1008/video/2'), 'a link to /video/2 plays that post’s 2nd video');
  // ================= 7. Cancel
  await ev(() => { playIndex(10); }); await sleep(800);
  s = await st();
  ok(s.ov === 'Getting the video from X…', 'a slow answer shows the box');
  await ev(() => [...$('#ovBtns').children][0].click()); await sleep(2600);
  s = await st();
  ok(s.status === 'stopped' && !s.ov && !s.x && !s.vsrc, `Cancel stops it, and the late answer doesn't start it (${s.status})`);
  // ================= 8. a downloaded copy still plays first
  const clip = path.join(VID, 'clip90.mp4');
  await ev((clip) => { S.items[4].localVideo = clip; }, clip);
  const c10 = calls(1010).length;
  await ev(() => playIndex(4)); s = await waitFor(playing);
  ok(playing(s) && s.src === 'FILE' && !s.x && calls(1010).length === c10 && !s.tag, `a downloaded post plays its file (light ${s.src}, no new yt-dlp call)`);
  // ================= 9. Settings → YouTube & X → X posts: Ask me (2.9.2: it was in "?")
  await ev(() => setOpen('web')); await sleep(500);
  ok((await ev(() => [...WM.$('#xPlaySel').options].map(o => o.textContent).join('|'))) === 'Play right away|Ask me', 'Settings has X posts: Play right away / Ask me');
  await ev(() => { const sel = WM.$('#xPlaySel'); sel.value = 'ask'; sel.dispatchEvent(new Event('change')); setClose(); });
  ok((await ev(() => stateSnapshot().xPlay)) === 'ask', 'the choice is saved');
  await ev(() => { playIndex(1); }); await sleep(600);
  s = await st();
  ok(s.ov === 'Play this X post?' && s.btns[0] === '▶ Play here' && s.btns.some(b => b === 'Play on X') && s.engine === null, `Ask me: the sheet first ${JSON.stringify([s.ov, s.btns])}`);
  await ev(() => [...$('#ovBtns').children][0].click()); s = await waitFor(playing);
  ok(playing(s) && s.x && s.cur.endsWith('/1002'), '▶ Play here streams it');
  await ev(() => { S.xPlay = 'stream'; });
  // ================= 10. X History (2.9, #6: the posts that really played, once each) and downloads untouched
  const xh = await ev(() => (histTab('x') ? histTab('x').items.map(i => i.vid) : []));
  ok(['x1001', 'x1002', 'x1003', 'x1006', 'x1007', 'x1008-2', 'x1010'].every(v => xh.includes(v)) && !['x1004', 'x1005', 'x1009', 'x1011'].some(v => xh.includes(v)) && new Set(xh).size === xh.length,
    `X History holds the posts that played, once each, and none that failed or were cancelled ${JSON.stringify(xh)}`);
  const dl = path.join(H, 'SlopAMP');
  const files = fs.existsSync(dl) ? execFileSync('find', [dl, '-type', 'f', '-name', '*1001*']).toString().trim() : '';
  ok(!files, 'nothing was saved to the downloads folders');
  ok(await ev(() => fetch(`${location.origin}/x/0123456789abcdef0123456789abcdef`).then(r => r.status)) === 404, 'an unknown /x/ key gets 404');
  await ev(() => stop()); await sleep(300);
  const bad = errs.filter(e => !/WebGL|GPU|net::ERR|Failed to load resource/i.test(e));
  ok(!bad.length, 'no page errors ' + JSON.stringify(bad.slice(0, 3)));
  await app.close(); srv.close();
  console.log(fails.length ? `${fails.length} FAILED` : 'ALL OK');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
