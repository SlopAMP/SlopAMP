// 3.0.0 CLIP Join: transitions between the pieces (1A-1I) and captions on each file (3A-3H, item 4E)
//   1  Cut (default) / Crossfade / Fade through black, 0.25-2 s, one setting for the list and a gap's own; at most half
//      the shorter piece beside it; the new length on the count line, the line above Save, the Save button and For X;
//      the picture and the sound cross together (a crossfade mixes both sounds; fade through black dips to silence);
//      Save each has none; saved with the clip; a 60-card join full of fades
//   3  each file keeps its own captions (its own .srt / .lrc / typed lines, its own Position and Size) as you hop
//      between files; the table in Captions; each line timed to its piece after In / Out and the transitions (a line
//      ends at the middle of a transition); one .srt for the whole join; Clip again; Save each
// Run (Linux, xvfb): SLOPAMP_ELECTRON=… SLOPAMP_APP=… xvfb-run -a node tests/clip-300.js
'use strict';
const { launch, sleep, docWin } = require('./lib');
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const H = path.join(os.tmpdir(), 'slopamp-test-300');
const O = process.env.SLOPAMP_SHOTS || path.join(os.tmpdir(), 'slopamp-300-shots');
fs.mkdirSync(O, { recursive: true });
const APPFF = ((d) => (require('fs').existsSync(path.join(d, 'bin', 'ffmpeg')) ? path.join(d, 'bin') : d))(path.join(process.env.SLOPAMP_APP || path.join(__dirname, '..'), 'vendor/ffmpeg/linux'))   // 3.2.0: bin/ + lib/;
const FF = path.join(APPFF, 'ffmpeg'), FP = path.join(APPFF, 'ffprobe');
const probe = (f) => JSON.parse(execFileSync(FP, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f]).toString());
const sdur = (f, type) => +(probe(f).streams.find(s => s.codec_type === type) || {}).duration;
const durOf = (f) => +probe(f).format.duration;
const rgb = (f, t, x, y, w, h) => { const b = execFileSync(FF, ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', `crop=${w}:${h}:${x}:${y},scale=1:1:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']); return [b[0], b[1], b[2]]; };
const bright = (f, t, x, y, w, h) => { const b = execFileSync(FF, ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', `crop=${w}:${h}:${x}:${y},format=gray`, '-f', 'rawvideo', '-']); let n = 0; for (const v of b) if (v > 235) n++; return n; };
const band = (f, t, d, hz) => { const r = spawnSync(FF, ['-hide_banner', '-ss', String(t), '-t', String(d), '-i', f, '-af', `bandpass=f=${hz}:width_type=q:w=8,bandpass=f=${hz}:width_type=q:w=8,volumedetect`, '-f', 'null', '-']); const m = /mean_volume: (-?[\d.]+) dB/.exec(String(r.stderr)); return m ? +m[1] : -200; };
const vol = (f, t, d) => { const r = spawnSync(FF, ['-hide_banner', '-ss', String(t), '-t', String(d), '-i', f, '-af', 'volumedetect', '-f', 'null', '-']); const m = /mean_volume: (-?[\d.]+) dB/.exec(String(r.stderr)); return m ? +m[1] : -200; };
const srtOf = (f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r/g, '').split(/\n\n+/).filter(Boolean).map(b => { const ls = b.split('\n'), m = /(\d+):(\d+):(\d+),(\d+) --> (\d+):(\d+):(\d+),(\d+)/.exec(ls[1]); const t = (h, mi, s, ms) => +h * 3600 + +mi * 60 + +s + +ms / 1000; return { a: t(m[1], m[2], m[3], m[4]), b: t(m[5], m[6], m[7], m[8]), t: ls.slice(2).join('\n').trim() }; });
const near = (x, y, e = 0.06) => Math.abs(x - y) <= e;

(async () => {
  // the files (in a folder of their own, with a .srt next to the beach video and a .lrc next to the song)
  const SRC = path.join(os.tmpdir(), 'slopamp-300-src'); fs.mkdirSync(SRC, { recursive: true });
  const mk = (name, args) => { const f = path.join(SRC, name); if (!fs.existsSync(f)) execFileSync(FF, ['-hide_banner', '-v', 'error', '-y', ...args, f]); return f; };
  const H264 = ['-c:v', 'libopenh264', '-b:v', '2M', '-pix_fmt', 'yuv420p'];
  const MAIN = mk('Night Main 360p.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=12', '-f', 'lavfi', '-i', 'sine=f=440:d=12', ...H264, '-c:a', 'aac', '-shortest']);
  const BEACH = mk('Beach Day 4K.mp4', ['-f', 'lavfi', '-i', 'color=c=0x2060ff:s=1280x720:r=30:d=6', '-f', 'lavfi', '-i', 'sine=f=3000:d=6', ...H264, '-c:a', 'aac', '-shortest']);
  const COVER = mk('cover.png', ['-f', 'lavfi', '-i', 'color=c=0x20c040:s=300x300', '-frames:v', '1']);
  const SONG = mk('Slow Build - Rising.mp3', ['-f', 'lavfi', '-i', 'sine=f=1000:d=5', '-i', COVER, '-map', '0:a', '-map', '1:v', '-c:a', 'libmp3lame', '-b:a', '192k', '-c:v', 'png', '-disposition:v', 'attached_pic', '-id3v2_version', '3']);
  const PIC = mk('Card Picture.png', ['-f', 'lavfi', '-i', 'color=c=0xe020e0:s=640x360', '-frames:v', '1']);
  fs.writeFileSync(path.join(SRC, 'Beach Day 4K.srt'), '1\n00:00:00,500 --> 00:00:01,500\nBEACH ONE\n\n2\n00:00:03,000 --> 00:00:04,000\nBEACH TWO\n\n3\n00:00:05,600 --> 00:00:06,000\nBEACH LATE\n');
  fs.writeFileSync(path.join(SRC, 'Slow Build - Rising.lrc'), '[ti:Slow Build]\n[00:00.50]Song line one\n[00:02.10]Song line two\n[00:04.00]Song last line\n');

  let { app, win, errs } = await launch(H);
  let ev = (f, a) => win.evaluate(f, a);
  const cw = async () => docWin(app, 'win-clip');
  const outLine = () => ev(() => WM.$('#clipFmtInfo').textContent.replace(/\s+/g, ' ').trim());
  const count = () => ev(() => WM.$('#clipJoinCount').textContent);
  const save = async () => ev(() => { CL.nameTouched = false; return clipSave(); });
  const tab = (t) => ev((x) => WM.$(`#clipTabs [data-t=${x}]`).click(), t);
  const chips = () => ev(() => [...WM.$$('#clipJoinCards .cj-gap')].map(c => c.textContent.replace(/\s+/g, ' ').trim() + (c.classList.contains('own') ? '*' : '')));
  const fresh = (f) => ev(async (x) => { await clipOpen(x, { kind: 'mp4' }); CL.join = joinNew(); clipRender(); }, f);
  const sect = (a, b) => ev(([x, y]) => { CL.in = x; CL.out = y; return joinAddSection().then(() => CL.join.items.length); }, [a, b]);
  const add = (ps) => ev((x) => joinAddFiles(x), ps);
  const last = (r) => r && r.files && r.files[r.files.length - 1];
  const trSet = (mode, dur) => ev(([m, d]) => { WM.$(`#clipJoinTr [data-v=${m}]`).click(); if (d) WM.$(`#clipJoinTrLen [data-v="${d}"]`).click(); }, [mode, dur]);

  // ===================================================================== 1. transitions
  await fresh(MAIN); await sleep(1200); await tab('join');
  await sect(2, 5); await add([BEACH, SONG]); await sleep(1500);
  let st = await ev(() => ({ tr: [...WM.$$('#clipJoinTr button')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')).join('|'), len: [...WM.$$('#clipJoinTrLen button')].map(b => b.textContent + (b.disabled ? '-' : '')).join('|') }));
  ok(st.tr === 'Cut*|Crossfade|Fade through black' && st.len === '0.25-|0.5-|1 s-|2 s-', `Between pieces: Cut is the default, lengths greyed (${st.tr} · ${st.len})`);
  ok(JSON.stringify(await chips()) === '["cut","cut"]', `a chip in each gap: ${JSON.stringify(await chips())}`);
  ok((await count()).endsWith(' · 0:14.0') && !/crossfade|black/.test(await outLine()), `all cuts: the count and the line above Save as in 2.9.9 ("${await count()}")`);
  await trSet('fade', 1);
  ok(JSON.stringify(await chips()) === '["fade1 s","fade1 s"]', `Crossfade 1 s: ${JSON.stringify(await chips())}`);
  let cnt = await count(), ol = await outLine();
  ok(/· 0:14\.0 → 0:12\.0$/.test(cnt) && await ev(() => WM.$('#clipJoinCount').title === 'Shorter by the transitions: 2 crossfades (−2 s)'), `the count shows the new length: "${cnt}"`);
  ok(/H\.264 \+ AAC · 2 crossfades \(−2 s\) · /.test(ol) && /length 0:12\.0/.test(ol), `the line above Save: "${ol.slice(0, 140)}"`);
  ok(await ev(() => /0:12\.0/.test(WM.$('#clipSave').textContent)), `the Save button: "${await ev(() => WM.$('#clipSave').textContent)}"`);
  // a gap's own: Beach → the song fades through black, 0.5 s
  await ev(() => WM.$$('#clipJoinCards .cj-gap')[1].click()); await sleep(200);
  st = await ev(() => ({ shown: !WM.$('#clipJoinGapPop').classList.contains('hidden'), t: WM.$('#clipJoinGapPop').textContent }));
  ok(st.shown && /^Between B \(Beach Day 4K\) and C \(Slow Build - Rising\)/.test(st.t) && /Same as the list \(Crossfade\)/.test(st.t), `clicking a gap opens its box: "${st.t.slice(0, 90)}"`);
  await ev(() => [...WM.$$('#clipJoinGapPop [data-k=m] button')].find(b => b.dataset.v === 'black').click());
  await ev(() => [...WM.$$('#clipJoinGapPop [data-k=d] button')].find(b => b.dataset.v === '0.5').click());
  ok(JSON.stringify(await chips()) === '["fade1 s","black0.5 s*"]' && /0:14\.0 → 0:12\.5$/.test(await count()) && /1 crossfade, 1 fade through black \(−1\.5 s\)/.test(await outLine()), `that gap only: ${JSON.stringify(await chips())} · "${await count()}"`);
  await ev(() => { const d = WM.$('#clipJoinGapPop').ownerDocument; d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  ok(await ev(() => WM.$('#clipJoinGapPop').classList.contains('hidden')), 'Esc closes the box');
  await (await cw()).screenshot({ path: `${O}/1-transitions.png` });
  // 1E: never more than half the shorter piece beside it
  await trSet('fade', 2);
  ok(JSON.stringify(await chips()) === '["fade1.5 s","black0.5 s*"]' && await ev(() => /2 s asked: at most half the shorter piece/.test(WM.$('#clipJoinCards .cj-gap').title)), `2 s between a 3 s and a 6 s piece: 1.5 s (${JSON.stringify(await chips())})`);
  await trSet('fade', 1);
  // the joined MP4: Night Main 2-5 (0-3) · crossfade 1 s (2-3) · Beach (2-8) · black 0.5 s (7.5-8) · song (7.5-12.5)
  let r = await save(), J = last(r) && last(r).path;
  ok(r && r.ok && J, `joined with transitions: ${J && path.basename(J)}`);
  if (J) {
    ok(near(durOf(J), 12.5, 0.12) && near(sdur(J, 'video'), sdur(J, 'audio'), 0.1), `length ${durOf(J).toFixed(2)} s (14 − 1 − 0.5), picture ${sdur(J, 'video').toFixed(2)} / sound ${sdur(J, 'audio').toFixed(2)}`);
    const mid = rgb(J, 2.5, 300, 160, 40, 40), a0 = rgb(J, 1.0, 300, 160, 40, 40), b0 = rgb(J, 5.0, 300, 160, 40, 40);
    ok(b0[2] > 200 && mid[2] > a0[2] + 40 && mid[2] < b0[2] - 40, `the crossfade's middle is between the two pictures (${a0} → ${mid} → ${b0})`);
    ok(band(J, 2.3, 0.4, 440) > -45 && band(J, 2.3, 0.4, 3000) > -45 && band(J, 0.5, 1, 3000) < -60, 'the two sounds overlap in the crossfade (440 + 3000 Hz), not before it');
    const darks = [7.68, 7.72, 7.76, 7.8].map(t => Math.max(...rgb(J, t, 300, 160, 40, 40))), dark = Math.min(...darks);
    ok(dark < 25 && vol(J, 7.70, 0.1) < -38 && vol(J, 6.0, 1) > -30, `fade through black: black and quiet at its middle (brightest channel ${darks.join(' ')}, ${vol(J, 7.70, 0.1).toFixed(0)} dB)`);
    const green = rgb(J, 10, 300, 160, 40, 40);
    ok(green[1] > 150 && band(J, 9.5, 2, 1000) > -40, `then the song over its cover (${green})`);
  }
  // Save each: no transitions
  await ev(() => { CL.join.mode = 'each'; clipRender(); });
  st = await ev(() => ({ dis: [...WM.$$('#clipJoinTr button, #clipJoinTrLen button')].every(b => b.disabled), note: WM.$('#clipJoinTrNote').textContent, chips: WM.$$('#clipJoinCards .cj-gap').length }));
  ok(st.dis && /Save each: no transitions/.test(st.note) && st.chips === 0, `Save each greys the row and drops the chips ("${st.note}")`);
  await ev(() => { CL.join.mode = 'join'; clipRender(); });
  // saved with the clip: Clip again brings the list's and the gap's choices back
  const ent = await ev((p) => P.clipEntry(p), J);
  ok(ent && ent.join && ent.join.trans && ent.join.trans.mode === 'fade' && ent.join.trans.dur === 1 && ent.join.items[2].tin && ent.join.items[2].tin.mode === 'black', 'the transitions are saved with the clip');
  await fresh(MAIN);
  await ev(([p, src]) => clipAgain({ path: p, src, srcExists: true, kind: 'mp4clip', in: 2, out: 5 }), [J, MAIN]); await sleep(3000);
  ok(JSON.stringify(await chips()) === '["fade1 s","black0.5 s*"]' && await ev(() => CL.join.trans.mode === 'fade'), `Clip again: ${JSON.stringify(await chips())}`);

  // ===================================================================== 60 cards full of fades, and For X
  await fresh(MAIN); await sleep(800); await tab('join'); await sect(0, 3);
  await add(Array.from({ length: 58 }, () => PIC)); await sleep(500);
  await ev(() => { for (const it of CL.join.items) if (it.type === 'p') it.dur = 2.5; clipRender(); });
  ok(await ev(() => CL.join.items.length) === 59, '59 cards (a section and 58 stills)');
  const xLong = () => ev(() => clipXIssues().some(x => /long/.test(x.what || '') || /longer|too long|2:20/.test(x.text || '')));
  ok(await xLong(), `148 s of cuts is over X's 2:20 (Free) (${await ev(() => clipXIssues().map(x => x.text).join(' / ').slice(0, 80))})`);
  await trSet('fade', 0.25);
  ok(!(await xLong()) && /0:13[0-9]\.|2:13\.5/.test(await outLine()), `with 58 crossfades of 0.25 s it's 2:13.5: For X is fine (${/length [^·]+/.exec(await outLine())})`);
  await add([PIC]); await sleep(300);
  r = await save(); J = last(r) && last(r).path;
  ok(r && r.ok && J && near(durOf(J), 3 + 59 * 2.5 - 59 * 0.25, 0.4), `a 60-card join full of crossfades saves: ${J && durOf(J).toFixed(2)} s (expected ${(3 + 59 * 2.5 - 59 * 0.25).toFixed(2)})`);

  // ===================================================================== 3. captions on each file
  await fresh(MAIN); await sleep(800); await tab('join');
  await sect(2, 5); await add([BEACH, SONG]); await sleep(1200); await trSet('fade', 1);
  // the open file's own lines (typed), Bottom · M
  await ev(() => { CL.cap.lines = [{ id: 9001, a: 2.2, b: 2.9, t: 'MAIN ONE', ed: true }, { id: 9002, a: 4.0, b: 4.95, t: 'MAIN TWO', ed: true }]; CL.cap.on = true; CL.cap.src = 'own'; CL.cap.srcLabel = 'Your lines'; CL.cap.tried = true; clipRender(); });
  // Beach Day: its .srt next to it, Middle · L
  await ev(() => WM.$$('#clipJoinCards .cj-card')[1].click()); await sleep(1800);
  await tab('captions'); await sleep(2500);
  st = await ev(() => ({ file: CL.file.split('/').pop(), n: CL.cap.lines.length, src: CL.cap.srcLabel, on: CL.cap.on }));
  ok(st.file === 'Beach Day 4K.mp4' && st.n === 3 && /Beach Day 4K\.srt/.test(st.src) && st.on, `Beach Day picks its own .srt (${JSON.stringify(st)})`);
  await ev(() => { WM.$('#clipCapPos [data-v=middle]').click(); WM.$('#clipCapSize [data-v=l]').click(); });
  // the song: its .lrc (the Captions tab works for a song in a join)
  await ev(() => { WM.$('#clipTabs [data-t=join]').click(); WM.$$('#clipJoinCards .cj-card')[2].click(); }); await sleep(1800);
  st = await ev(() => ({ off: WM.$('#clipTabs [data-t=captions]').disabled, file: CL.file.split('/').pop() }));
  ok(!st.off && st.file === 'Slow Build - Rising.mp3', `a song in a join: the Captions tab works (${JSON.stringify(st)})`);
  await tab('captions'); await sleep(2500);
  st = await ev(() => ({ n: CL.cap.lines.length, src: CL.cap.srcLabel, last: CL.cap.lines[CL.cap.lines.length - 1] }));
  ok(st.n === 3 && /\.lrc/.test(st.src) && near(st.last.a, 4) && near(st.last.b, 8), `the song's .lrc: 3 lines, the last one gets 4 s (${JSON.stringify(st).slice(0, 140)})`);
  // the table, from the song
  st = await ev(() => [...WM.$$('#clipCapFiles tr')].map(r => [...r.children].map(td => td.textContent.trim()).join(' ').replace(/\s+/g, ' ')));
  ok(st.length === 3 && /^A Night Main 360p\.mp4 Your lines 2 lines in its pieces Bottom · M on$/.test(st[0]) && /^B Beach Day 4K\.mp4 From Beach Day 4K\.srt 3 lines in its pieces Middle · L on$/.test(st[1]) && /^C Slow Build - Rising\.mp3 \(open: below\) From Slow Build - Rising\.lrc 3 lines/.test(st[2]), `the table in Captions: ${JSON.stringify(st)}`);
  await (await cw()).screenshot({ path: `${O}/2-captions-per-file.png` });
  // back on Night Main: its own lines are still there; the cards show CC
  await ev(() => { WM.$('#clipCapFiles tr.f').click(); }); await sleep(2000);
  st = await ev(() => ({ file: CL.file.split('/').pop(), lines: CL.cap.lines.map(l => l.t).join('|'), tab: CL.tab, cc: [...WM.$$('#clipJoinCards .cj-card')].map(c => !!c.querySelector('.cj-tag.cc')) }));
  ok(st.file === 'Night Main 360p.mp4' && st.lines === 'MAIN ONE|MAIN TWO' && st.tab === 'captions', `clicking its row opens Night Main with its own lines (${JSON.stringify(st)})`);
  ok(JSON.stringify(st.cc) === '[true,true,true]', `every card with captions says CC (${JSON.stringify(st.cc)})`);
  ol = await outLine();
  ok(/7 caption lines from 3 files burned in \(\+ \.srt\)/.test(ol), `the line above Save: "${/[^·]*caption[^·]*/.exec(ol)}"`);
  r = await save(); J = last(r) && last(r).path;
  const srt = last(r) && last(r).srt;
  ok(r && r.ok && srt && fs.existsSync(srt), `joined with captions, and one .srt (${srt && path.basename(srt)})`);
  if (srt) {
    const L = srtOf(srt), got = L.map(l => `${l.t}@${l.a.toFixed(2)}-${l.b.toFixed(2)}`);
    // Night Main 0-3 (In 2): ONE 0.2-0.9, TWO 2.0 → ends at the crossfade's middle 2.5. Beach starts at 2 (from 2.5):
    // ONE 2.5-3.5, TWO 5.0-6.0, LATE 7.6 is past its piece's end (7.5). The song starts at 7 (from 7.5): 7.5-9.1, 9.1-11, 11-12
    const want = ['MAIN ONE@0.20-0.90', 'MAIN TWO@2.00-2.50', 'BEACH ONE@2.50-3.50', 'BEACH TWO@5.00-6.00', 'Song line one@7.50-9.10', 'Song line two@9.10-11.00', 'Song last line@11.00-12.00'];
    ok(JSON.stringify(got) === JSON.stringify(want), `each line on its piece, ending / starting at the middle of a crossfade: ${JSON.stringify(got)}`);
  }
  if (J) {
    // Beach's lines are in the middle, Night Main's at the bottom
    const midOn = bright(J, 3.0, 120, 150, 400, 60), midOff = bright(J, 4.5, 120, 150, 400, 60), botOn = bright(J, 0.5, 120, 300, 400, 50), botOff = bright(J, 1.5, 120, 300, 400, 50);
    ok(midOn > midOff + 200 && botOn > botOff + 100, `each file's own Position: Beach's line in the middle (${midOn} vs ${midOff} white pixels), Night Main's at the bottom (${botOn} vs ${botOff})`);
  }
  // Clip again: every file's lines come back
  await fresh(MAIN);
  await ev(([p, src]) => clipAgain({ path: p, src, srcExists: true, kind: 'mp4clip', in: 2, out: 5 }), [J, MAIN]); await sleep(3000);
  await tab('captions'); await sleep(800);
  st = await ev(() => [...WM.$$('#clipCapFiles tr')].map(r => [...r.children].map(td => td.textContent.trim()).join(' ').replace(/\s+/g, ' ')));
  ok(st.length === 3 && /Lines saved with the clip 2 lines/.test(st[0]) && /Beach Day 4K\.mp4 Lines saved with the clip 3 lines in its pieces Middle · L on/.test(st[1]) && /Slow Build - Rising\.mp3 Lines saved with the clip 3 lines/.test(st[2]), `Clip again brings each file's captions back: ${JSON.stringify(st)}`);
  // Save each: each clip with its own file's captions
  await ev(() => { CL.join.mode = 'each'; clipRender(); });
  r = await save();
  const ef = (r && r.files) || [];
  ok(r && r.ok && ef.length === 2 && ef[1].srt && srtOf(ef[1].srt).length === 3 && srtOf(ef[1].srt)[0].t === 'BEACH ONE', `Save each: Beach Day's clip has its own captions (${ef.map(f => path.basename(f.path) + (f.srt ? ' +srt' : '')).join(', ')})`);

  // ===================================================================== unchanged: one file, a song on its own
  await fresh(SONG); await sleep(1000);
  ok(await ev(() => WM.$('#clipTabs [data-t=captions]').disabled), 'a song on its own: no Captions (no picture), as before');
  ok(!errs.length, `no errors in the windows ${JSON.stringify(errs.slice(0, 3))}`);
  await app.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
