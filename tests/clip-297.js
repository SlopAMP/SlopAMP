// 2.9.7 CLIP part 3 + the X account:
//   1. Fix for X and the "X ✓ / not for X" tags follow the saved X account (Premium: Premium's limits; none saved:
//      Free), numbers from xlimits.js; Premium's 10-minute Android note never shows in the tags.
//   2. Captions (7A–7E): the file's own subtitle track, a .srt next to it, YouTube's (yt-dlp on demand; "auto" ones
//      tidied), typed / pasted lines; only the lines between In and Out; edits (amber); burned in with libass (MP4 and
//      GIF; bottom / middle, S / M / L); also saved as .srt; times follow Speed; Clip again brings them back.
//   3. Join v1 (6A–6I): sections (+ Section / J), stills, title cards drawn by SlopAMP; reorder; one MP4 (size of the
//      first section or 1080p / 720p / 9:16, letterbox / crop, silence / keep the song going), or Save each (Fast cut);
//      Shape / Sound / Speed / Captions on the whole; ▶ Play all; kept on the file and with the clip (Clip again).
// Run (Linux, xvfb): SLOPAMP_ELECTRON=… SLOPAMP_APP=… xvfb-run -a node tests/clip-297.js
'use strict';
const { launch, sleep, docWin } = require('./lib');
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const H = path.join(os.tmpdir(), 'slopamp-test-297');
const O = process.env.SLOPAMP_SHOTS || path.join(os.tmpdir(), 'slopamp-297-shots');
fs.mkdirSync(O, { recursive: true });
const FF = process.env.SLOPAMP_FFMPEG || 'ffmpeg', FP = FF.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
const probe = (f) => JSON.parse(execFileSync(FP, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f]).toString());
const vOf = (f) => probe(f).streams.find(s => s.codec_type === 'video');
const durOf = (f) => +probe(f).format.duration;
// the average colour of a box of one frame: [r, g, b]
const rgb = (f, t, x, y, w, h) => { const b = execFileSync(FF, ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', `crop=${w}:${h}:${x}:${y},scale=1:1:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']); return [b[0], b[1], b[2]]; };
const diff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const vol = (f, t, d) => { const r = spawnSync(FF, ['-hide_banner', '-ss', String(t), '-t', String(d), '-i', f, '-af', 'volumedetect', '-f', 'null', '-']); const m = /mean_volume: (-?[\d.]+|-inf) dB/.exec(String(r.stderr)); return m ? (m[1] === '-inf' ? -200 : +m[1]) : -200; };
const srtOf = (f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r/g, '').trim().split(/\n\n+/).map(b => { const l = b.split('\n'); return { tm: l[1], t: l.slice(2).join('\n') }; });

const SRT = `1\n00:00:01,000 --> 00:00:03,000\nwe left the city at midnight\n\n2\n00:00:04,000 --> 00:00:06,000\nand we drove all night long\n\n3\n00:00:08,000 --> 00:00:10,000\nneon lights on the highway\n\n4\n00:00:12,000 --> 00:00:14,000\ntill the sun came up again\n`;
// YouTube's automatic captions roll: each cue repeats the line before, with 10 ms "hold" cues in between
const AUTO = `WEBVTT\nKind: captions\nLanguage: en\n\n00:00:00.500 --> 00:00:02.990 align:start position:0%\n \nhello<00:00:01.000><c> there</c><00:00:01.400><c> friends</c>\n\n00:00:02.990 --> 00:00:03.000 align:start position:0%\nhello there friends\n \n\n00:00:03.000 --> 00:00:05.500 align:start position:0%\nhello there friends\nwelcome<00:00:03.500><c> back</c>\n\n00:00:05.500 --> 00:00:05.510 align:start position:0%\nwelcome back\n \n\n00:00:05.510 --> 00:00:08.000 align:start position:0%\nwelcome back\nlet's go &amp; drive\n`;

(async () => {
  const SRC = path.join(os.tmpdir(), 'slopamp-297-src'); fs.mkdirSync(SRC, { recursive: true });
  const mk = (name, args) => { const f = path.join(SRC, name); if (!fs.existsSync(f)) execFileSync(FF, ['-hide_banner', '-v', 'error', '-y', ...args, f]); return f; };
  fs.writeFileSync(path.join(SRC, 'subs.srt'), SRT);
  const ROAD = mk('Road Trip 1080p.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=20', '-f', 'lavfi', '-i', 'sine=f=330:d=20', '-i', path.join(SRC, 'subs.srt'), '-map', '0', '-map', '1', '-map', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng']);
  const PLAIN = mk('Plain Talk 360p.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=12', '-f', 'lavfi', '-i', 'sine=f=440:d=12', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
  const SIDE = mk('Side Subs 360p.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=12', '-f', 'lavfi', '-i', 'sine=f=440:d=12', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
  fs.writeFileSync(SIDE.replace(/\.mp4$/, '.srt'), SRT);
  const YT = mk('Night Drive [dQw4w9WgXcQ].mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=10', '-f', 'lavfi', '-i', 'sine=f=440:d=10', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
  const THREE = mk('Three Minutes.mp4', ['-f', 'lavfi', '-i', 'color=c=green:s=160x90:r=5:d=180', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '180', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '32k']);
  const TWELVE = mk('Twelve Minutes.mp4', ['-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=2:d=720', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '720', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '32k']);
  const SHORT = mk('Short Ok.mp4', ['-f', 'lavfi', '-i', 'color=c=gray:s=160x90:r=5:d=20', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '20', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '32k']);
  const MKV = mk('Old Codec 3m.mkv', ['-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=5:d=180', '-c:v', 'mpeg4']);
  const STILL = mk('still red 400.png', ['-f', 'lavfi', '-i', 'color=c=red:s=400x400', '-frames:v', '1']);
  // the stand-in yt-dlp (subtitles only)
  process.env.SLOPAMP_YTDLP = path.join(__dirname, 'fake-ytdlp.js');

  // ===================================================================== 1. the X account: tags and Fix for X
  {
    const XR = require('../src/xready'), XL = require('../src/renderer/xlimits');
    const info = (d) => ({ hasVideo: true, video: { codec: 'h264', pixFmt: 'yuv420p', width: 1280, height: 720, fps: 30 }, audio: { codec: 'aac' }, format: 'mov,mp4,m4a,3gp,3g2,mj2', duration: d });
    let a = XR.assess(info(720), 50e6);
    ok(a.ready && a.long && a.account === 'free' && /12:00 is 9:40 over the 2:20 X allows on Free/.test(a.over[0]), `no account: Free's 2:20 (${JSON.stringify(a.over)})`);
    a = XR.assess(info(720), 50e6, 'premium');
    ok(a.ready && !a.long && !a.big && !a.over.length, 'Premium: 12 minutes fits (the Android app’s 10 minutes isn’t counted)');
    a = XR.assess(info(5 * 3600), 17 * 1073741824, 'premium');
    ok(a.long && a.big && /over the 4:00:00 X allows on Premium/.test(a.over[0]) && /over the 16 GB X allows on Premium/.test(a.over[1]), `Premium: over 4 h and 16 GB warns (${a.over.join(' | ')})`);
    ok(XR.assess(info(720), 50e6, 'nonsense').account === 'free', 'anything else counts as Free');
    ok(XL.checkPost('premium', 700, 0).length === 0 && XL.checkVideo('premium', 700, 0).some(x => x.what === 'android'), 'checkPost leaves out the Android note that checkVideo (the For X bar) keeps');
  }
  let { app, win, errs } = await launch(H);
  let ev = (f, a) => win.evaluate(f, a);
  const DL = (await app.evaluate(({ app }) => app.getPath('downloads'))) + '/SlopAMP';
  const cw = async () => docWin(app, 'win-clip');
  const tags = async () => { await sleep(900); return ev(() => Object.fromEntries([...$$('#list li')].map(li => [((li.querySelector('.title, .t') || li).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40), (() => { const t = li.querySelector('.xok, .xno'); return t ? { text: t.textContent, tip: t.title } : null; })()]))); };
  const tagOf = (T, name) => { const k = Object.keys(T).find(x => x.includes(name)); return k ? T[k] : null; };
  await ev((fs_) => addPaths(fs_), [THREE, TWELVE, SHORT, MKV]); await sleep(2500);
  let T = await tags();
  ok(tagOf(T, 'Three Minutes') && tagOf(T, 'Three Minutes').text === 'not for X' && /3:00 is 0:40 over the 2:20 X allows on Free \(X account: Free, not set yet\)/.test(tagOf(T, 'Three Minutes').tip), `no account saved: a 3-minute X-ready MP4 is "not for X" (Free): ${JSON.stringify(tagOf(T, 'Three Minutes'))}`);
  ok(tagOf(T, 'Short Ok') && tagOf(T, 'Short Ok').text === 'X ✓', 'a short X-ready MP4 is X ✓');
  ok(tagOf(T, 'Old Codec') && tagOf(T, 'Old Codec').text === 'not for X' && /Fix for X/.test(tagOf(T, 'Old Codec').tip), 'a file X won’t take as it is stays "not for X"');
  // Premium (Settings → YouTube & X)
  await ev(() => { const s = $('#setXAcct'); s.value = 'premium'; s.dispatchEvent(new Event('change')); });
  T = await tags();
  ok(tagOf(T, 'Three Minutes').text === 'X ✓' && tagOf(T, 'Twelve Minutes').text === 'X ✓' && /X account: Premium/.test(tagOf(T, 'Twelve Minutes').tip), `Premium: 3 and 12 minutes are X ✓ at once: ${JSON.stringify([tagOf(T, 'Three Minutes'), tagOf(T, 'Twelve Minutes')])}`);
  ok(!/Android/i.test(JSON.stringify(T)), 'no Android note in any tag');
  ok(tagOf(T, 'Old Codec').text === 'not for X', 'Premium doesn’t make a wrong codec OK');
  // Fix for X: the dialog's warnings follow the account
  const fixWarn = async (f) => { await ev((x) => xFixOpen([x]), f); await sleep(1200); const w = await ev(() => ({ open: $('#xfixDlg').open, warn: $('#xfWarn').classList.contains('hidden') ? '' : $('#xfWarn').textContent, clip: !$('#xfClip').classList.contains('hidden') })); await ev(() => { if ($('#xfixDlg').open) $('#xfixDlg').close(); }); return w; };
  let w = await fixWarn(MKV);
  ok(w.open && !w.warn && !w.clip, `Premium: Fix for X on a 3-minute file has no length warning (${JSON.stringify(w)})`);
  await ev(() => { S.xAccount = 'free'; xAcctChanged(); });
  w = await fixWarn(MKV);
  ok(w.open && /3:00 is 0:40 over the 2:20 X allows on Free \(X account: Free\)/.test(w.warn) && w.clip, `Free: the same file warns with the exact overage and offers CLIP (${w.warn})`);
  T = await tags();
  ok(tagOf(T, 'Three Minutes').text === 'not for X' && tagOf(T, 'Twelve Minutes').text === 'not for X', 'back to Free: the tags change back at once');
  // an X-ready file that's only too long: Fix for X says so (nothing to convert)
  await ev((x) => xFixOpen([x]), THREE); await sleep(1200);
  const toastT = await ev(() => WM.host($('#toast'), WM.noticeDoc()).textContent);
  ok(/already X-ready .*but 3:00 is 0:40 over the 2:20 X allows on Free .*Trim it in CLIP/.test(toastT), `X-ready but too long: "${toastT}"`);
  await ev(() => { S.xAccount = null; xAcctChanged(); });
  w = await fixWarn(MKV);
  ok(/X account: Free, not set yet/.test(w.warn), 'no account saved: counted as Free, and it says so');
  ok(await ev(() => xOver({ duration: 700, size: 1e6 }).length === 1 && (S.xAccount = 'premium', xOver({ duration: 700, size: 1e6 }).length === 0)), 'the download bar’s check (xOver) follows the account too');
  await ev(() => { S.xAccount = null; xAcctChanged(); });

  // ===================================================================== 2. Captions
  const q = (sel) => ev((s) => { const e = WM.$(s); return e ? { text: e.textContent.replace(/\s+/g, ' ').trim(), hidden: e.classList.contains('hidden') || !!e.closest('.hidden'), disabled: !!e.disabled, on: e.classList.contains('on') } : null; }, sel);
  const outLine = () => ev(() => WM.$('#clipFmtInfo').textContent.replace(/\s+/g, ' ').trim());
  const save = async () => ev(() => { CL.nameTouched = false; return clipSave(); });
  const tab = (t) => ev((x) => WM.$(`#clipTabs [data-t=${x}]`).click(), t);
  await ev((f) => clipOpen(f, { kind: 'mp4' }), ROAD); await sleep(1500);
  ok(await ev(() => !CL.cap.on && !CL.cap.lines.length && !WM.$('#clipTabs [data-t=captions] .dot')), 'a new file: no captions until the Captions tab is used');
  await tab('captions'); await sleep(2500);
  let st = await ev(() => ({ src: CL.cap.srcLabel, n: CL.cap.lines.length, on: CL.cap.on, rows: WM.$$('#clipCapList .cap-row').length, dot: !!WM.$('#clipTabs [data-t=captions] .dot'), msg: WM.$('#clipCapMsg').textContent }));
  ok(st.src === 'From the file: English' && st.n === 4 && st.on && st.rows === 4 && st.dot, `the file's own subtitle track loads when the tab opens: ${JSON.stringify(st)}`);
  ok(/^MP4 · 1920×1080 · H\.264 \+ AAC · 4 caption lines burned in \(\+ \.srt\) · RE-ENCODE/.test(await outLine()), `the output line says so: "${await outLine()}"`);
  await ev(() => { clipSet('out', 9); clipSet('in', 2); });
  st = await ev(() => ({ rows: WM.$$('#clipCapList .cap-row').length, msg: WM.$('#clipCapMsg').textContent }));
  ok(st.rows === 3 && /^3 lines between In and Out/.test(st.msg), `only the lines between In and Out (2–9 s): ${JSON.stringify(st)}`);
  // edit one line (amber), remove nothing
  await (await cw()).fill('#clipCapList .cap-row:nth-child(2) input', 'and we drove ALL night');
  st = await ev(() => ({ ed: WM.$('#clipCapList .cap-row:nth-child(2)').classList.contains('ed'), line: CL.cap.lines[1].t, msg: WM.$('#clipCapMsg').textContent }));
  ok(st.ed && st.line === 'and we drove ALL night', `an edited line is marked (amber): ${JSON.stringify(st)}`);
  ok(await ev(() => { CL.cut = 'fast'; return clipCutEff() === 'exact' && /off while Shape, Speed or Captions/.test(WM.$('#clipFastNote').textContent); }), 'Fast cut is off while captions are burned in');
  await (await cw()).screenshot({ path: `${O}/2-captions.png` });
  let r = await save(), f = r && r.ok && r.files[0];
  ok(f && f.srt && f.captions === 3 && fs.existsSync(f.srt), `saved with 3 lines burned in and a .srt next to it (${f && path.basename(f.srt || '')})`);
  let srt = f ? srtOf(f.srt) : [];
  ok(srt.length === 3 && srt[0].tm === '00:00:00,000 --> 00:00:01,000' && srt[1].tm === '00:00:02,000 --> 00:00:04,000' && srt[1].t === 'and we drove ALL night' && srt[2].tm === '00:00:06,000 --> 00:00:07,000', `the .srt has the clip's own times and the edit: ${JSON.stringify(srt)}`);
  const CAPPED = f && f.path;
  // the same clip without captions, to compare the picture
  await ev(() => { CL.cap.on = false; clipRender(); });
  ok(!/caption/.test(await outLine()), 'Burn in off: nothing burned in');
  r = await save(); const BARE = r && r.ok && r.files[0].path;
  ok(BARE && !r.files[0].srt, 'without captions: no .srt');
  if (CAPPED && BARE) {
    const at = (file) => rgb(file, 2.6, 660, 950, 600, 60);         // the bottom middle (where the text sits), while line 2 shows
    const top = (file) => rgb(file, 2.6, 660, 100, 600, 60);
    ok(diff(at(CAPPED), at(BARE)) > 20 && diff(top(CAPPED), top(BARE)) < 8, `the line is burned in at the bottom (bottom differs by ${diff(at(CAPPED), at(BARE))}, top by ${diff(top(CAPPED), top(BARE))})`);
  }
  // middle, size L, and Speed 2x: times halve
  await ev(() => { CL.cap.on = true; WM.$('#clipCapPos [data-v=middle]').click(); WM.$('#clipCapSize [data-v=l]').click(); });
  await tab('speed'); await ev(() => WM.$('#clipSpeed [data-s="2"]').click());
  r = await save(); f = r && r.ok && r.files[0];
  srt = f && f.srt ? srtOf(f.srt) : [];
  ok(srt.length === 3 && srt[1].tm === '00:00:01,000 --> 00:00:02,000', `at 2× the caption times halve: ${JSON.stringify(srt.map(x => x.tm))}`);
  if (f) {
    const mid = rgb(f.path, 1.3, 400, 470, 1120, 140), bot = rgb(f.path, 1.3, 400, 880, 1120, 140), midB = rgb(BARE, 2.6, 400, 470, 1120, 140);
    ok(diff(mid, midB) > 30, `Middle: the line is in the middle of the picture (${diff(mid, midB)}; bottom ${JSON.stringify(bot)})`);
  }
  ok(await ev(() => S.clipCap && S.clipCap.pos === 'middle' && S.clipCap.size === 'l'), 'the style is remembered (Position / Size)');
  await ev(() => WM.$('#clipSpeed [data-s="1"]').click());
  // ASS: one style, size from the short side, bottom / middle
  const { Clipper } = require('../src/clip');
  const ass = Clipper.assText([{ a: 1, b: 2.5, t: 'a {b} c\\d\nline two' }], 1080, 1920, { pos: 'bottom', size: 'm' });
  ok(/PlayResX: 1080\r\nPlayResY: 1920/.test(ass) && /Style: Cap,Arial,65,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,.*,1,5\.2,0,2,54,54,115,1/.test(ass) && /Dialogue: 0,0:00:01\.00,0:00:02\.50,Cap,,0,0,0,,a \(b\) c∖d\\Nline two/.test(ass), 'the .ass: bold white, black outline, 6% of the short side, bottom; braces / backslashes can’t become ASS codes');
  ok(/,1,\d+(\.\d+)?,0,5,/.test(Clipper.assText([], 1920, 1080, { pos: 'middle', size: 's' })), 'Middle is ASS alignment 5');
  // GIF: burned in, no .srt
  await ev(() => { WM.$('#clipKind [data-k=gif]').click(); });
  ok(/caption lines? burned in · RE-ENCODE/.test(await outLine()) && !/\.srt/.test(await outLine()), `GIF: burned in, no .srt: "${await outLine()}"`);
  r = await save(); f = r && r.ok && r.files[0];
  ok(f && f.kind === 'gif' && !f.srt && f.captions === 3, `GIF saved with the captions (${f && path.basename(f.path)})`);
  await ev(() => { WM.$('#clipKind [data-k=mp3]').click(); });
  ok((await q('#clipTabs [data-t=captions]')).disabled && !/caption/.test(await outLine()), 'MP3: Captions greyed, nothing burned');
  await ev(() => { WM.$('#clipKind [data-k=mp4]').click(); });
  // Clip again brings the edited lines back
  await ev((p) => openDownloadsManager('clips'), null); await sleep(1500);
  const rows = await ev(() => DLM.rows ? DLM.rows.length : 0);
  await ev((p) => { const row = (DLM.rows || []).find(x => x.path === p) || { path: p, src: CL.file, srcExists: true, kind: 'mp4clip', in: 2, out: 9 }; clipAgain(row); }, CAPPED); await sleep(2500);
  st = await ev(() => ({ src: CL.cap.srcLabel, lines: CL.cap.lines.map(l => l.t), on: CL.cap.on }));
  ok(st.src === 'Lines saved with the clip' && st.on && st.lines.includes('and we drove ALL night'), `Clip again: the captions saved with the clip come back, edit included (${JSON.stringify(st)}; ${rows} Library rows)`);
  await ev(() => { if ($('#dlmDlg').open) $('#dlmDlg').close(); });

  // a file with no subtitles: say so; add, paste
  await ev((x) => clipOpen(x, { kind: 'mp4' }), PLAIN); await sleep(1500);
  await tab('captions'); await sleep(1500);
  st = await ev(() => ({ msg: WM.$('#clipCapMsg').textContent, sel: WM.$('#clipCapSrc').selectedOptions[0].textContent, on: CL.cap.on }));
  ok(/This file has no subtitles\. Type them/.test(st.msg) && st.sel === 'No subtitles in this file' && !st.on, `no subtitles: it says so (${JSON.stringify(st)})`);
  await (await cw()).screenshot({ path: `${O}/2-captions-none.png` });
  await ev(() => { clipMedia.currentTime = 1; });
  await sleep(300);
  await ev(() => capAddLine());
  await (await cw()).fill('#clipCapList .cap-row input', 'my own words');
  ok(await ev(() => CL.cap.lines.length === 1 && Math.abs(CL.cap.lines[0].a - 1) < 0.05 && Math.abs(CL.cap.lines[0].b - 4) < 0.05 && CL.cap.lines[0].t === 'my own words' && CL.cap.on && CL.cap.srcLabel === 'Your lines'), '+ Add a line: at the preview spot, 3 s, typed');
  await ev(() => { WM.$('#clipCapPaste').click(); WM.$('#clipCapPasteT').value = 'second line\nthird line\n'; WM.$('#clipCapPasteGo').click(); });
  st = await ev(() => CL.cap.lines.map(l => [+l.a.toFixed(1), +l.b.toFixed(1), l.t]));
  ok(st.length === 3 && st[1][2] === 'second line' && st[2][2] === 'third line' && st[2][0] - st[1][0] === 3, `Paste lines: one caption per line, 3 s each (${JSON.stringify(st)})`);
  await ev(() => { WM.$('#clipCapPaste').click(); WM.$('#clipCapPasteT').value = '1\n00:00:09,000 --> 00:00:10,500\npasted srt\n'; WM.$('#clipCapPasteGo').click(); });
  ok(await ev(() => CL.cap.lines.some(l => l.t === 'pasted srt' && l.a === 9 && l.b === 10.5)), 'pasting a whole .srt keeps its times');
  r = await save(); f = r && r.ok && r.files[0];
  ok(f && f.captions === 4 && srtOf(f.srt).length === 4, `typed / pasted lines are burned in and saved (${f && f.captions})`);

  // a .srt next to the file
  await ev((x) => clipOpen(x, { kind: 'mp4' }), SIDE); await sleep(1500);
  await tab('captions'); await sleep(2500);
  st = await ev(() => ({ src: CL.cap.srcLabel, n: CL.cap.lines.length }));
  ok(st.src === 'From Side Subs 360p.srt' && st.n === 4, `a .srt next to the video: ${JSON.stringify(st)}`);

  // YouTube (yt-dlp on demand; "auto" ones tidied)
  fs.writeFileSync(path.join(H, 'fake-x.json'), JSON.stringify({ posts: {}, subs: { dQw4w9WgXcQ: { manual: null, auto: AUTO, lang: 'en' } } }));
  await ev((x) => clipOpen(x, { kind: 'mp4', item: { type: 'youtube', vid: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Night Drive' } }), YT); await sleep(1500);
  await tab('captions'); await sleep(4000);
  st = await ev(() => ({ src: CL.cap.srcLabel, lines: CL.cap.lines.map(l => [l.a, l.b, l.t]), msg: WM.$('#clipCapMsg').textContent }));
  ok(st.src === 'From YouTube: English (auto)', `YouTube's subtitles, fetched when the tab opens, labelled auto: ${st.src} ${st.msg}`);
  ok(JSON.stringify(st.lines.map(x => x[2])) === JSON.stringify(['hello there friends', 'welcome back', "let's go & drive"]), `auto captions: each line once, no word timings (${JSON.stringify(st.lines)})`);
  const log = fs.readFileSync(path.join(H, 'fake-x.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(x => x.id === 'dQw4w9WgXcQ');
  ok(log.length === 2 && log.every(x => x.args.includes('--skip-download')) && log[0].args.includes('--write-subs') && log[1].args.includes('--write-auto-subs'), `yt-dlp asked for subtitles only (people's first, then auto): ${log.map(x => x.args.filter(a => /^--write/.test(a)).join(' ')).join(' | ')}`);
  await (await cw()).screenshot({ path: `${O}/2-captions-youtube.png` });
  fs.writeFileSync(path.join(H, 'fake-x.json'), JSON.stringify({ posts: {}, subs: {} }));
  await ev((x) => clipOpen(x, { kind: 'mp4', item: { type: 'youtube', vid: 'aaaaaaaaaaa', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' } }), PLAIN); await sleep(1200);
  await tab('captions'); await sleep(3000);
  st = await ev(() => ({ msg: WM.$('#clipCapMsg').textContent, n: CL.cap.lines.length }));
  ok(st.n === 0 && /unavailable|Couldn|no subtitles/i.test(st.msg), `a YouTube video yt-dlp can't get subtitles for: it says so (${st.msg})`);

  // ===================================================================== 3. Join
  await ev((x) => clipOpen(x, { kind: 'mp4' }), ROAD); await sleep(1500);
  await tab('join');
  ok(await ev(() => !CL.join.items.length && !joinActive() && WM.$('#clipJoinOn').disabled), 'Join starts empty (the switch waits for a section)');
  const sect = (a, b) => ev(([x, y]) => { CL.in = x; CL.out = y; return joinAddSection().then(() => CL.join.items.length); }, [a, b]);
  await sect(1, 4); await sect(10, 13);
  st = await ev(() => ({ on: joinActive(), n: CL.join.items.length, btn: WM.$('#clipSave').textContent, name: WM.$('#clipName').value, kind: CL.kind }));
  ok(st.on && st.n === 2 && /Join & save 0:06\.0/.test(st.btn) && st.name === 'Road Trip 1080p (joined)' && st.kind === 'mp4', `+ Section ×2: the list is on, Join & save 0:06.0 (${JSON.stringify(st)})`);
  await ev(() => { CL.in = 15; CL.out = 17; }); await (await cw()).keyboard.press('j');
  ok(await ev(() => joinSecs().length === 3), 'J adds a section too');
  await ev(() => { const s = joinSecs()[2]; WM.$(`#clipJoinCards .cj-card[data-id="${s.id}"] .cj-x`).click(); });
  ok(await ev(() => joinSecs().length === 2), '× removes a card');
  await ev((p) => P.clipImageUrl(p).then(u => joinAddStill(p, u)), STILL);
  await ev(() => { CL.join.sel = null; tcOpen(); WM.$('#tcText').value = 'ROAD TRIP 2026'; WM.$('#tcText').dispatchEvent(new Event('input')); WM.$('#tcLine2').value = 'night drive'; WM.$('#tcLine2').dispatchEvent(new Event('input')); });
  await sleep(200);
  const c3 = await cw(); await c3.screenshot({ path: `${O}/3-titlecard.png` });
  await ev(() => WM.$('#tcOk').click());
  st = await ev(() => CL.join.items.map(i => i.type + (i.type === 'p' ? i.dur : i.type === 'c' ? i.dur : '')));
  ok(JSON.stringify(st) === JSON.stringify(['c3', 's', 's', 'p2.5']), `a title card (3 s, first: nothing selected) and a still (2.5 s, after the selected section): ${JSON.stringify(st)}`);
  // reorder: the still between A and B (drag)
  await ev(() => { const L = CL.join.items; joinMove(L[3].id, L[2].id); });
  st = await ev(() => CL.join.items.map(i => i.type));
  ok(JSON.stringify(st) === JSON.stringify(['c', 's', 'p', 's']), `dragging a card moves it: ${JSON.stringify(st)}`);
  ok(/^JOIN 4 pieces in order → 1 MP4 · 1920×1080 · 30 fps · H\.264 \+ AAC · RE-ENCODE · length 0:11\.5 · ≈ [\d.]+ MB/.test(await outLine()), `the output line: "${await outLine()}"`);
  await ev(() => { CL.cap.on = false; });
  await (await cw()).screenshot({ path: `${O}/3-join.png` });
  r = await ev(() => clipSave()); f = r && r.ok && r.files[0];
  ok(f && f.path === `${DL}/mp4clips/Road Trip 1080p (joined).mp4` && f.joined === 4, `Join & save → one MP4 in mp4clips (${f && f.path})`);
  const JOINED = f && f.path;
  if (f) {
    const v = vOf(f.path), d = durOf(f.path), a = probe(f.path).streams.find(s => s.codec_type === 'audio');
    ok(v.width === 1920 && v.height === 1080 && v.r_frame_rate === '30/1' && v.codec_name === 'h264' && a && Math.abs(d - 11.5) < 0.2, `1920×1080, 30 fps, H.264 + sound, 11.5 s (${v.width}×${v.height} ${v.r_frame_rate} ${d})`);
    const card = rgb(f.path, 0.3, 100, 100, 200, 200), still = rgb(f.path, 7, 860, 440, 200, 200), bar = rgb(f.path, 7, 40, 440, 200, 200);
    ok(card[2] > card[0] + 15 && card[0] < 60, `0:00–0:03: the title card's navy (${card})`);
    ok(still[0] > 200 && still[1] < 50 && bar[0] < 20 && bar[1] < 20 && bar[2] < 20, `the square still is letterboxed: red in the middle (${still}), black at the sides (${bar})`);
    ok(vol(f.path, 6.3, 1.8) < -60 && vol(f.path, 3.5, 2) > -40, `under the still: silence (${vol(f.path, 6.3, 1.8)} dB; a section: ${vol(f.path, 3.5, 2)} dB)`);
  }
  // keep the song going, crop to fill, 9:16, captions, 2x
  await tab('captions'); await sleep(2500); await tab('join');
  await ev(() => { WM.$('#clipJoinUnder [data-v=keep]').click(); WM.$('#clipJoinFit [data-v=crop]').click(); const s = WM.$('#clipJoinSize'); s.value = '916'; s.dispatchEvent(new Event('change')); CL.cap.on = true; clipRender(); });
  ok(/1080×1920/.test(await outLine()) && /caption lines burned in/.test(await outLine()), `9:16 and captions in the output line: "${await outLine()}"`);
  r = await ev(() => { CL.nameTouched = false; return clipSave(); }); f = r && r.ok && r.files[0];
  if (f) {
    const v = vOf(f.path);
    ok(v.width === 1080 && v.height === 1920 && f.path.endsWith('(joined) (2).mp4'), `9:16: 1080×1920, a new name (${v.width}×${v.height} ${path.basename(f.path)})`);
    const still = rgb(f.path, 7, 40, 800, 200, 200);
    ok(still[0] > 200 && still[1] < 50, `Crop to fill: the still fills the picture (red at the side too: ${still})`);
    ok(vol(f.path, 6.3, 1.8) > -40, `Keep the song going: sound under the still (${vol(f.path, 6.3, 1.8)} dB)`);
    srt = srtOf(f.srt);
    // card 0–3, A = 1–4 s at 3–6 (lines 1–3 → 3–5, 4–6 → 6–6: cut at 6), still 6–8.5, B = 10–13 at 8.5–11.5 (12–14 → 10.5–11.5)
    ok(JSON.stringify(srt.map(x => x.tm)) === JSON.stringify(['00:00:03,000 --> 00:00:05,000', '00:00:10,500 --> 00:00:11,500']) && srt[1].t === 'till the sun came up again', `captions follow each section to its place in the joined video: ${JSON.stringify(srt)}`);
  } else ok(false, 'join 9:16 ' + JSON.stringify(r));
  await tab('speed'); await ev(() => WM.$('#clipSpeed [data-s="2"]').click()); await tab('join');
  ok(/length 0:08\.5/.test(await outLine()), `2×: the sections halve, stills and cards don't (${await outLine()})`);
  await ev(() => { WM.$('#clipSpeed [data-s="1"]').click(); const s = WM.$('#clipJoinSize'); s.value = 'first'; s.dispatchEvent(new Event('change')); WM.$('#clipJoinFit [data-v=letterbox]').click(); WM.$('#clipJoinUnder [data-v=silence]').click(); CL.cap.on = false; CL.even = true; });
  r = await ev(() => { CL.nameTouched = false; return clipSave(); });
  ok(r && r.ok && Math.abs(durOf(r.files[0].path) - 11.5) < 0.2, `Even out the volume on a join (measured first, two passes): ${r && r.ok}`);
  await ev(() => { CL.even = false; });
  // Save each: the sections as clips (Fast cut OK), stills / cards left out
  await ev(() => { WM.$('#clipJoinMode [data-v=each]').click(); CL.cut = 'fast'; clipRender(); });
  ok(/^SAVE EACH 2 sections → 2 MP4 clips · FAST CUT OK · 2 stills \/ cards left out/.test(await outLine()) && /Save 2 clips/.test(await ev(() => WM.$('#clipSave').textContent)), `Save each: "${await outLine()}"`);
  r = await ev(() => { CL.nameTouched = false; return clipSave(); });
  ok(r && r.ok && r.files.length === 2 && r.files.map(x => path.basename(x.path)).join('|') === 'Road Trip 1080p (0m01s-0m04s).mp4|Road Trip 1080p (0m10s-0m13s).mp4', `two clips, named by In–Out: ${r && r.files.map(x => path.basename(x.path))}`);
  if (r && r.ok) ok(r.files.every(x => durOf(x.path) > 2.9 && durOf(x.path) < 4.2), `each about 3 s (fast cut from the keyframe: ${r.files.map(x => durOf(x.path).toFixed(2))})`);
  await ev(() => { WM.$('#clipJoinMode [data-v=join]').click(); });
  // MP3 switches the list off (kept)
  await ev(() => WM.$('#clipKind [data-k=mp3]').click());
  ok(await ev(() => !joinActive() && CL.join.items.length === 4 && CL.kind === 'mp3'), 'MP3: the join list is switched off but kept');
  await ev(() => { WM.$('#clipKind [data-k=mp4]').click(); WM.$('#clipJoinOn').click(); });
  ok(await ev(() => joinActive()), 'the switch turns it back on');
  // Convert switches it off
  await tab('convert'); await ev(() => [...WM.$('#clipCvPreset').children].find(b => b.dataset.p === 'phone').click());
  ok(await ev(() => CL.whole && !joinActive() && CL.join.items.length === 4), 'Convert (the whole file) switches Join off');
  await ev(() => { WM.$('#clipJoinOn').click(); });
  ok(await ev(() => joinActive() && !CL.whole), 'Join on switches Convert off');
  // ▶ Play all: sections in the preview, stills / cards on top for their length
  await tab('join');
  const pa0 = await ev(() => { joinPlayAll(); return !!CL.pa; });
  let seen = { card: false, sec: false, still: false };
  for (let k = 0; k < 70 && (await ev(() => !!CL.pa)); k++) {
    const s2 = await ev(() => ({ i: CL.pa && CL.pa.i, ov: !WM.$('#clipJoinOv').classList.contains('hidden'), playing: !clipMedia.paused }));
    if (s2.i === 0 && s2.ov) seen.card = true;
    if (s2.i === 1 && !s2.ov) seen.sec = true;
    if (s2.i === 2 && s2.ov) seen.still = true;
    await sleep(250);
  }
  ok(pa0 && seen.card && seen.sec && seen.still && await ev(() => !CL.pa && WM.$('#clipJoinOv').classList.contains('hidden')), `Play all: card, section, still, section, then it stops (${JSON.stringify(seen)})`);
  // the list is kept on the file, and comes back with the joined clip
  await ev((x) => clipOpen(x, { kind: 'mp4' }), PLAIN); await sleep(800);
  ok(await ev(() => !CL.join.items.length), 'another file: a fresh list');
  await ev(([p, src]) => clipAgain({ path: p, src, srcExists: true, kind: 'mp4clip', in: 1, out: 13 }), [JOINED, ROAD]); await sleep(3000);
  st = await ev(() => ({ file: CL.file, items: CL.join.items.map(i => i.type + (i.type === 's' ? `${i.in}-${i.out}` : i.type === 'c' ? i.spec.text : '')), on: joinActive(), tab: CL.tab, url: (CL.join.items.find(i => i.type === 'p') || {}).url }));
  ok(st.on && st.tab === 'join' && JSON.stringify(st.items) === JSON.stringify(['cROAD TRIP 2026', 's1-4', 'p', 's10-13']) && !!st.url, `Clip again on the joined clip: the list comes back (${JSON.stringify(st)})`);
  // the line shows on the preview too (white, outlined, like the burned-in one)
  await tab('captions'); await sleep(2500);
  await ev(() => { clipMedia.currentTime = 2; }); await sleep(600);
  st = await ev(() => ({ shown: !WM.$('#clipCapOv').classList.contains('hidden'), t: WM.$('#clipCapOvT').textContent }));
  await ev(() => { clipMedia.currentTime = 4.5; }); await sleep(600);
  const st2 = await ev(() => !WM.$('#clipCapOv').classList.contains('hidden'));
  ok(st.shown && st.t === 'we left the city at midnight' && !st2, `the caption shows on the preview inside a join section (0:02), not outside them (0:04.5) (${JSON.stringify(st)}, ${st2})`);
  // readable in all 10 skins: the caption lines, the join cards, the title card editor
  {
    const lum = (c) => { const p = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2]); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const look = (w, sel) => w.evaluate((sel) => {
      const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor; if (b && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(b)) return b; } return 'rgb(0, 0, 0)'; };
      return sel.map(s => { const e = document.querySelector(s); if (!e) return { s, miss: true }; return { s, fg: getComputedStyle(e).color, bg: bgOf(e) }; });
    }, sel);
    const bad = [];
    await ev(() => tcOpen());
    for (const id of await ev(() => WM.skins.list.map(x => x.id))) {
      await ev((id) => WM.skins.apply(id), id); await sleep(600);
      const cwin = await cw();
      await ev(() => { WM.$('#clipTabs [data-t=captions]').click(); });
      const c1 = await look(cwin, ['.cap-row input', '.cap-row .cap-t', '#clipCapMsg', '#clipCapSrc', '.clip-tcard .ed-h', '.clip-tcard input[type=text]']);
      await ev(() => { WM.$('#clipTabs [data-t=join]').click(); });
      const c2 = await look(cwin, ['.cj-card .cj-l', '.cj-card .cj-l b', '#clipJoinCount', '#clipJoinSize']);
      for (const x of [...c1, ...c2]) { if (x.miss) { bad.push({ id, s: x.s, miss: true }); continue; } const r1 = ratio(x.fg, x.bg); if (r1 < (/cap-t|cj-l$|Count/.test(x.s) ? 3 : 4.5)) bad.push({ id, s: x.s, r: r1.toFixed(2) }); }
      if (id === 'pocket' || id === 'chrome') await cwin.screenshot({ path: `${O}/skin-${id}-join.png` });
    }
    ok(!bad.length, `Captions, Join and the title card editor are readable in all 10 skins ${JSON.stringify(bad)}`);
    await ev(() => { tcClose(); WM.skins.apply('classic'); }); await sleep(300);
  }
  ok(errs.length === 0, `no errors in the windows (${errs.slice(0, 3).join(' | ')})`);
  await app.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
