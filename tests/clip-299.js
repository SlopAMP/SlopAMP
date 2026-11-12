// 2.9.9 CLIP: Join other files (4A–4D, 4F)
//   4A  "+ From another file…" (and files dropped on the cards): a video or a song is one dashed card for the whole file
//   4B  the list belongs to the CLIP window: a dashed card opens its file and keeps the list (+ Section adds from it);
//       each file keeps its own Shape (and captions); Sound / Speed / fades stay
//   4C  a song plays over its cover art, black, or the still / title card right in front of it
//   4D  the first video section's size (upright) and a steady frame rate, everything fitted, 48 kHz stereo AAC;
//       Save each saves each video section from its own file (Fast cut where that file allows it)
//   4F  saved with the clip; Clip again brings it back; a file that's gone is a red card and is skipped
//   and the risks: a phone's rotation flag, HDR (tone-mapped), variable frame rate (a long piece stays in sync),
//   no sound (silence), loudness between files (Even out the volume evens each file first), the 60-card cap
// Run (Linux, xvfb): SLOPAMP_ELECTRON=… SLOPAMP_APP=… xvfb-run -a node tests/clip-299.js
'use strict';
const { launch, sleep, docWin } = require('./lib');
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const H = path.join(os.tmpdir(), 'slopamp-test-299');
const O = process.env.SLOPAMP_SHOTS || path.join(os.tmpdir(), 'slopamp-299-shots');
fs.mkdirSync(O, { recursive: true });
// the bundled FFmpeg (it has VP9 10-bit, zscale and everything these test files need)
const APPFF = path.join(process.env.SLOPAMP_APP || path.join(__dirname, '..'), 'vendor/ffmpeg/linux');
const FF = path.join(APPFF, 'ffmpeg'), FP = path.join(APPFF, 'ffprobe');
const probe = (f) => JSON.parse(execFileSync(FP, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f]).toString());
const vOf = (f) => probe(f).streams.find(s => s.codec_type === 'video');
const aOf = (f) => probe(f).streams.find(s => s.codec_type === 'audio');
const durOf = (f) => +probe(f).format.duration;
const rgb = (f, t, x, y, w, h) => { const b = execFileSync(FF, ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', `crop=${w}:${h}:${x}:${y},scale=1:1:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']); return [b[0], b[1], b[2]]; };
const cdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// the loudness of one band (Hz) in a stretch of a file's sound, dB (−200: nothing)
const band = (f, t, d, hz) => { const r = spawnSync(FF, ['-hide_banner', '-ss', String(t), '-t', String(d), '-i', f, '-af', `bandpass=f=${hz}:width_type=q:w=8,bandpass=f=${hz}:width_type=q:w=8,volumedetect`, '-f', 'null', '-']); const m = /mean_volume: (-?[\d.]+) dB/.exec(String(r.stderr)); return m ? +m[1] : -200; };
const vol = (f, t, d) => { const r = spawnSync(FF, ['-hide_banner', '-ss', String(t), '-t', String(d), '-i', f, '-af', 'volumedetect', '-f', 'null', '-']); const m = /mean_volume: (-?[\d.]+) dB/.exec(String(r.stderr)); return m ? +m[1] : -200; };
// when the picture flashes white / the sound beeps (start times), to check the sound stays with the picture
const flashes = (f) => { const r = spawnSync(FF, ['-hide_banner', '-i', f, '-an', '-vf', 'blackdetect=d=0.02:pix_th=0.5', '-f', 'null', '-']); return [...String(r.stderr).matchAll(/black_end:([\d.]+)/g)].map(m => +m[1]); };
const beeps = (f) => { const r = spawnSync(FF, ['-hide_banner', '-i', f, '-vn', '-af', 'silencedetect=n=-40dB:d=0.05', '-f', 'null', '-']); return [...String(r.stderr).matchAll(/silence_end: ([\d.]+)/g)].map(m => +m[1]); };

(async () => {
  const SRC = path.join(os.tmpdir(), 'slopamp-299-src'); fs.mkdirSync(SRC, { recursive: true });
  const mk = (name, args, pre) => { const f = path.join(SRC, name); if (!fs.existsSync(f)) { if (pre) pre(); execFileSync(FF, ['-hide_banner', '-v', 'error', '-y', ...args, f]); } return f; };
  const H264 = ['-c:v', 'libopenh264', '-b:v', '2M', '-pix_fmt', 'yuv420p'];
  // the open file: 16:9, 25 fps, a 440 Hz tone
  const MAIN = mk('Night Main 360p.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=12', '-f', 'lavfi', '-i', 'sine=f=440:d=12', ...H264, '-c:a', 'aac', '-shortest']);
  // other files: a bigger blue video (30 fps, 3000 Hz), a portrait phone clip with a rotation flag (orange, 2000 Hz),
  // an HDR (PQ, 10-bit) phone clip (red), a variable-frame-rate phone clip (flash + beep every 5 s), a video with no
  // sound, a song with cover art (green), a song without, a quiet and a loud phone clip, a picture
  const BEACH = mk('Beach Day 4K.mp4', ['-f', 'lavfi', '-i', 'color=c=0x2060ff:s=1280x720:r=30:d=6', '-f', 'lavfi', '-i', 'sine=f=3000:d=6', ...H264, '-c:a', 'aac', '-shortest']);
  const ROT0 = mk('rot-src.mp4', ['-f', 'lavfi', '-i', 'color=c=0xff8000:s=640x360:r=30:d=4', '-f', 'lavfi', '-i', 'sine=f=2000:d=4', ...H264, '-c:a', 'aac', '-shortest']);
  const ROT = mk('Phone Portrait.mp4', ['-display_rotation:v', '90', '-i', ROT0, '-c', 'copy']);
  const RED = mk('red-sdr.mp4', ['-f', 'lavfi', '-i', 'color=c=0xd02020:s=640x360:r=30:d=4', '-f', 'lavfi', '-i', 'sine=f=500:d=4', ...H264, '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-c:a', 'aac', '-shortest']);
  const HDR = mk('HDR Phone.mp4', ['-i', RED, '-vf', 'zscale=tin=bt709:min=bt709:pin=bt709:t=linear:p=bt709:npl=203,format=gbrpf32le,zscale=p=bt2020:t=smpte2084:m=bt2020nc:r=tv:npl=203,format=yuv420p10le',
    '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '3M', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', '-c:a', 'copy']);
  const VFR = mk('Phone VFR 60s.mp4', ['-f', 'lavfi', '-i', "color=c=black:s=640x360:r=30:d=60,drawbox=c=white:t=fill:enable='gte(t\\,1)*lt(mod(t\\,5)\\,0.2)',select='not(eq(mod(n\\,15)\\,7))'",
    '-f', 'lavfi', '-i', "aevalsrc='if(gte(t\\,1)*lt(mod(t\\,5)\\,0.2)\\,0.5*sin(2*PI*1000*t)\\,0)':s=48000:d=60", '-fps_mode', 'vfr', ...H264, '-c:a', 'aac']);
  const MUTE = mk('Silent Clip.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=3', ...H264]);
  const COVER = mk('cover.png', ['-f', 'lavfi', '-i', 'color=c=0x20c040:s=300x300', '-frames:v', '1']);
  const SONGC = mk('Slow Build - Rising.mp3', ['-f', 'lavfi', '-i', 'sine=f=1000:d=5', '-i', COVER, '-map', '0:a', '-map', '1:v', '-c:a', 'libmp3lame', '-b:a', '192k', '-c:v', 'png', '-disposition:v', 'attached_pic', '-id3v2_version', '3']);
  const SONGN = mk('Plain Tone.mp3', ['-f', 'lavfi', '-i', 'sine=f=700:d=4', '-c:a', 'libmp3lame', '-b:a', '192k']);
  const QUIET = mk('Quiet Phone 2.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=4', '-f', 'lavfi', '-i', 'sine=f=600:d=4,volume=-14dB', ...H264, '-c:a', 'aac', '-shortest']);
  const LOUD = mk('Loud Phone 2.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=4', '-f', 'lavfi', '-i', 'sine=f=600:d=4,volume=8dB', ...H264, '-c:a', 'aac', '-shortest']);
  const PIC = mk('Card Picture.png', ['-f', 'lavfi', '-i', 'color=c=0xe020e0:s=640x360', '-frames:v', '1']);
  ok(vOf(ROT).side_data_list && vOf(ROT).width === 640, 'test file: a 640×360 clip flagged 90° (a 360×640 phone video)');
  ok(vOf(HDR).color_transfer === 'smpte2084' && vOf(HDR).pix_fmt === 'yuv420p10le', 'test file: 10-bit HDR (PQ)');
  const vv = vOf(VFR); ok(vv.r_frame_rate === '30/1' && vv.avg_frame_rate !== '30/1', `test file: variable frame rate (${vv.r_frame_rate} nominal, ${vv.avg_frame_rate} average)`);

  let { app, win, errs } = await launch(H);
  let ev = (f, a) => win.evaluate(f, a);
  await ev(() => { window.__toasts = []; const t0 = toast; toast = (m, ...a) => { window.__toasts.push(m); return t0(m, ...a); }; });   // eslint-disable-line no-global-assign
  const toasts = () => ev(() => window.__toasts.splice(0));
  const cw = async () => docWin(app, 'win-clip');
  const outLine = () => ev(() => WM.$('#clipFmtInfo').textContent.replace(/\s+/g, ' ').trim());
  const save = async () => ev(() => { CL.nameTouched = false; return clipSave(); });
  const tab = (t) => ev((x) => WM.$(`#clipTabs [data-t=${x}]`).click(), t);
  const cards = () => ev(() => [...WM.$$('#clipJoinCards .cj-card')].map(c => ({ cls: c.className.replace('cj-card', '').trim(), l: c.querySelector('.cj-l').textContent, tags: [...c.querySelectorAll('.cj-tag')].map(x => x.textContent), img: !!c.querySelector('.cj-pic img'), note: !!c.querySelector('.cj-note') })));
  const fresh = (f) => ev(async (x) => { await clipOpen(x, { kind: 'mp4' }); CL.join = joinNew(); clipRender(); }, f);
  const sect = (a, b) => ev(([x, y]) => { CL.in = x; CL.out = y; return joinAddSection().then(() => CL.join.items.length); }, [a, b]);
  const add = (ps) => ev((x) => joinAddFiles(x), ps);
  const last = (r) => r && r.files && r.files[r.files.length - 1];

  // ===================================================================== 4A: + From another file…
  await fresh(MAIN); await sleep(1200); await tab('join');
  ok(await ev(() => [...WM.$$('#clipJoinCards .cj-add button')].map(b => b.textContent.trim()).join(' | ') === '+ Section J | + From another file… | + Still | + Title card'), '"+ From another file…" sits with + Section, + Still and + Title card');
  await sect(2, 5);
  ok(await ev(() => WM.$('#clipJoinHint').classList.contains('hidden')), 'one file: no "dashed cards" hint (Join v1 as before)');
  let n = await add([BEACH, SONGC, SONGN, PIC]); await sleep(1500);
  let cs = await cards();
  ok(n === 4 && cs.length === 5, `four files added: ${cs.length} cards`);
  ok(cs[1].cls.includes('other') && /^0:06\.0 Beach Day 4K\.mp4$/.test(cs[1].l), `a video: one dashed card for the whole file ("${cs[1].l}")`);
  ok(cs[2].cls.includes('other') && cs[2].img && /Slow Build - Rising\.mp3/.test(cs[2].l), 'a song with cover art: a dashed card showing the cover');
  ok(cs[3].cls.includes('other') && cs[3].note && !cs[3].img, 'a song without cover art: ♫');
  ok(!cs[4].cls.includes('other') && /over the song|still/.test(cs[4].l), `a picture: a still ("${cs[4].l}")`);
  ok(!cs[0].cls.includes('other'), 'the open file’s section is a normal card');
  ok(await ev(() => !WM.$('#clipJoinHint').classList.contains('hidden') && /^Dashed cards come from other files/.test(WM.$('#clipJoinHint').textContent)), 'the hint about dashed cards shows');
  let cnt = await ev(() => WM.$('#clipJoinCount').textContent);
  ok(/^4 sections from 4 files, 1 still \/ card · 0:20\.5$/.test(cnt), `count: "${cnt}" (3 + 6 + 5 + 4 s and a 2.5 s still: it's last, so it's a still)`);
  let ol = await outLine();
  ok(/^JOIN 5 pieces from 4 files in order → 1 MP4 · 640×360 · 25 fps · H\.264 \+ AAC · RE-ENCODE · length 0:20\.5/.test(ol), `the line above Save: "${ol.slice(0, 110)}"`);
  ok(await ev(() => JSON.stringify(joinPayload().items.map(i => (i.file ? i.file.split('/').pop() : i.type))) === JSON.stringify(['Night Main 360p.mp4', 'Beach Day 4K.mp4', 'Slow Build - Rising.mp3', 'Plain Tone.mp3', 'p'])), 'each section is sent with its file');
  await (await cw()).screenshot({ path: `${O}/1-join-files.png` });
  // a file that's not a video, song or picture; the 60-card cap
  const TXT = path.join(SRC, 'notes.txt'); fs.writeFileSync(TXT, 'x'); await toasts();
  await add([TXT]); let tt = await toasts();
  ok(tt.some(t => /one file isn’t a video, a song or a picture/.test(t)), `a text file is refused (${tt.join(' / ')})`);
  const many = Array.from({ length: 58 }, () => PIC);
  await add(many); tt = await toasts();
  ok(await ev(() => CL.join.items.length) === 60 && tt.some(t => /holds 60 cards: 3 were left out/.test(t)), `the 60-card cap: 60 cards, "${tt.join(' / ')}"`);
  await ev(() => { const s = CL.in; CL.in = 7; CL.out = 9; joinAddSection(); CL.in = s; }); tt = await toasts();
  ok(await ev(() => CL.join.items.length) === 60 && tt.some(t => /holds 60 cards: 1 was left out/.test(t)), '+ Section past 60: left out, and it says so');
  await ev(() => { CL.join.items = CL.join.items.slice(0, 5); clipRender(); });

  // ===================================================================== 4B: a dashed card opens its file, the list stays
  await ev(() => { WM.$('#clipRatio').children && [...WM.$('#clipRatio').children].find(b => b.dataset.r === '9:16').click(); });
  await ev(() => { CL.speed = 1.5; clipMedia.playbackRate = 1.5; CL.even = true; clipRender(); });
  const ids0 = await ev(() => CL.join.items.map(i => i.id).join()), wh0 = /· (\d+×\d+) ·/.exec(await outLine())[1];
  await ev(() => WM.$$('#clipJoinCards .cj-card')[1].click()); await sleep(1800);
  let st = await ev(() => ({ file: CL.file.split('/').pop(), ids: CL.join.items.map(i => i.id).join(), tab: CL.tab, kind: CL.kind, inout: [CL.in, CL.out], speed: CL.speed, even: CL.even, shape: CL.shape, on: joinActive() }));
  ok(st.file === 'Beach Day 4K.mp4' && st.ids === ids0 && st.tab === 'join' && st.on, `clicking the dashed card opens Beach Day 4K.mp4 with the same list (${JSON.stringify(st).slice(0, 120)})`);
  ok(st.inout[0] === 0 && Math.abs(st.inout[1] - 6) < 0.05 && st.kind === 'mp4', 'In / Out are that card’s section; still an MP4');
  ok(st.speed === 1.5 && st.even && !st.shape, 'Speed and Even out stay (the whole video); Shape is that file’s own (none yet)');
  cs = await cards();
  ok(cs[0].cls.includes('other') && !cs[1].cls.includes('other') && /Night Main 360p\.mp4 0:02–0:05/.test(cs[0].l), `now the first file's section is the dashed one ("${cs[0].l}")`);
  await sect(1, 3); cs = await cards();
  ok(cs.length === 6 && !cs[5].cls.includes('other') && await ev(() => CL.join.items[5].file === CL.file), '+ Section adds from the file that’s open (Beach Day)');
  ol = await outLine();
  ok(ol.startsWith(`JOIN 6 pieces from 4 files in order → 1 MP4 · ${wh0} · 37.5 fps`) && wh0 !== '640×360', `the size is still the first section's (Night Main with its 9:16 Shape, ${wh0}), 25 fps at 1.5×: "${ol.slice(0, 80)}"`);
  await ev(() => WM.$$('#clipJoinCards .cj-card')[0].click()); await sleep(1800);
  st = await ev(() => ({ file: CL.file.split('/').pop(), shape: CL.shape && CL.shape.ratio, n: CL.join.items.length }));
  ok(st.file === 'Night Main 360p.mp4' && st.shape === '9:16' && st.n === 6, `back on Night Main: its 9:16 Shape comes back (${JSON.stringify(st)})`);
  // a song opened from its card: Join still works there, + Section adds a piece of the song
  await ev(() => WM.$$('#clipJoinCards .cj-card')[2].click()); await sleep(1800);
  st = await ev(() => ({ file: CL.file.split('/').pop(), joinTab: !WM.$('#clipTabs [data-t=join]').classList.contains('off') && !WM.$('#clipTabs [data-t=join]').disabled, on: joinActive(), kind: CL.kind }));
  ok(st.file === 'Slow Build - Rising.mp3' && st.on && st.kind === 'mp4' && st.joinTab, `a song from its card: the Join tab works and it's still an MP4 (${JSON.stringify(st)})`);
  await sect(1, 2.5);
  ok(await ev(() => CL.join.items.length === 7 && CL.join.items[6].file === CL.file), '+ Section on the song adds a piece of it');
  await ev(() => { CL.speed = 1; clipMedia.playbackRate = 1; CL.even = false; }); await ev(() => WM.$$('#clipJoinCards .cj-card')[0].click()); await sleep(1500);
  await ev(() => { CL.shape = null; CL.join.items = CL.join.items.slice(0, 5); clipRender(); });

  // ===================================================================== 4C / 4D: the joined MP4
  // Night Main 2–5 (3 s, 440) · Beach (6 s, 3000, blue) · Slow Build (5 s, cover green, 1000) · Plain Tone (4 s, black, 700) · still 2.5 s
  let r = await ev(async () => { CL.join.fit = 'letterbox'; CL.join.mode = 'join'; CL.nameTouched = false; return clipSave(); });
  let J = last(r) && last(r).path;
  ok(r && r.ok && J, `joined: ${J && path.basename(J)}`);
  if (J) {
    const v = vOf(J), a = aOf(J);
    ok(v.width === 640 && v.height === 360 && v.r_frame_rate === '25/1', `the first section's size and frame rate (${v.width}×${v.height}, ${v.r_frame_rate})`);
    ok(a.sample_rate === '48000' && a.channels === 2 && a.codec_name === 'aac', 'all sound: 48 kHz stereo AAC');
    ok(Math.abs(durOf(J) - 20.5) < 0.25, `length ${durOf(J).toFixed(2)} s (3 + 6 + 5 + 4 + 2.5)`);
    const blue = rgb(J, 6, 300, 160, 40, 40), green = rgb(J, 11.5, 300, 160, 40, 40), black = rgb(J, 16, 300, 160, 40, 40);
    ok(blue[2] > 200 && blue[0] < 80, `Beach Day's picture, fitted (${blue})`);
    ok(green[1] > 150 && green[0] < 90 && green[2] < 110, `the song plays over its cover art (${green})`);
    ok(Math.max(...black) < 25, `a song without cover art: black (${black})`);
    ok(band(J, 0.5, 2, 440) > -40 && band(J, 4, 4, 3000) > -40 && band(J, 10, 3.5, 1000) > -40 && band(J, 15, 2.5, 700) > -40, 'each piece has its own sound (440 · 3000 · 1000 · 700 Hz)');
    ok(band(J, 4, 4, 440) < -60, 'Night Main’s tone stops where Beach Day starts');
  }
  // a title card in front of a song: shown over the song for the song's length (instead of the cover)
  await ev(() => { CL.join.sel = CL.join.items[1].id; joinAddCard({ text: 'SONG', bg: '#c2185b', font: 'Arial', size: 'm', dur: 3, fade: false }); });
  cs = await cards();
  ok(/over the song/.test(cs[2].l) && await ev(() => WM.$('#clipJoinCount').textContent.endsWith('0:20.5')), `a card in front of the song: "${cs[2].l}" (no extra length)`);
  r = await save(); J = last(r) && last(r).path;
  if (J) {
    const pink = rgb(J, 11.5, 20, 20, 30, 30);
    ok(Math.abs(durOf(J) - 20.5) < 0.25 && pink[0] > 150 && pink[1] < 80, `the card is shown over the song, not the cover (${pink}, ${durOf(J).toFixed(2)} s)`);
  }
  await ev(() => { CL.join.items.splice(2, 1); clipRender(); });

  // ===================================================================== rotation, HDR, no sound, fit
  await fresh(ROT); await sleep(1200);
  ok(await ev(() => CL.info.width === 360 && CL.info.height === 640 && CL.info.rot === 90), 'a phone clip flagged 90° opens as 360×640 (upright)');
  await tab('join'); await sect(0, 3); await add([MAIN, HDR, MUTE]); await sleep(1200);
  await ev(() => { CL.join.items[1].out = 3; clipRender(); });          // Night Main: its first 3 s
  cs = await cards();
  ok(cs[2].tags.includes('HDR') && cs[3].tags.includes('no sound'), `cards say HDR and no sound (${cs.map(c => c.tags.join('+')).join(' | ')})`);
  ol = await outLine();
  ok(/^JOIN 4 pieces from 4 files in order → 1 MP4 · 360×640 · 30 fps/.test(ol) && /HDR: turned to normal colours/.test(ol), `upright size first; HDR on the line above Save ("${ol.slice(0, 70)} … ${/HDR[^·]*/.exec(ol)}")`);
  await ev(() => { CL.join.fit = 'letterbox'; clipRender(); });
  r = await save(); J = last(r) && last(r).path;
  if (J) {
    const v = vOf(J);
    ok(v.width === 360 && v.height === 640, `the result is 360×640 (${v.width}×${v.height})`);
    const top = rgb(J, 1.5, 150, 20, 60, 60);
    ok(top[0] > 200 && top[1] > 90 && top[2] < 60, `the phone clip fills the picture, turned upright (orange at the top: ${top})`);
    const lb = rgb(J, 4, 150, 20, 60, 60), mid = rgb(J, 4, 150, 300, 60, 40);
    ok(Math.max(...lb) < 25 && Math.max(...mid) > 60, `the 16:9 file is letterboxed into it (bars ${lb}, picture ${mid})`);
    // HDR: closer to the original colours than a plain 8-bit conversion
    const naive = path.join(SRC, 'naive.png'); execFileSync(FF, ['-v', 'error', '-y', '-ss', '1', '-i', HDR, '-frames:v', '1', '-vf', 'format=yuv420p,scale=360:-2', naive]);
    const want = rgb(RED, 1, 300, 160, 40, 40), got = rgb(J, 7.5, 160, 300, 40, 40), plain = rgb(naive, 0, 160, 80, 40, 40);
    ok(cdist(got, want) < cdist(plain, want) - 30, `HDR tone-mapped: ${got} is near the original ${want}, a plain conversion is ${plain}`);
    ok(band(J, 6.5, 2, 500) > -40 && vol(J, 10.4, 2.2) < -70, `the HDR clip keeps its sound; the clip with no sound is silent (${vol(J, 10.4, 2.2).toFixed(0)} dB)`);
    ok(Math.abs(durOf(J) - 13) < 0.25, `length ${durOf(J).toFixed(2)} s (3 + 3 + 4 + 3, the silent one included)`);
  }
  // Blurred fill: the 16:9 piece in the portrait result has blurred bars, not black
  await ev(() => { CL.join.fit = 'blur'; clipRender(); });
  r = await save(); J = last(r) && last(r).path;
  if (J) { const bb = rgb(J, 4, 150, 20, 60, 60); ok(Math.max(...bb) > 40, `Blurred fill for another file's 16:9 piece (${bb})`); }

  // ===================================================================== variable frame rate: steady, in sync
  await fresh(MAIN); await sleep(1000); await tab('join'); await sect(0, 2); await add([VFR]); await sleep(800);
  r = await save(); J = last(r) && last(r).path;
  if (J) {
    const v = vOf(J);
    ok(v.r_frame_rate === '25/1' && v.avg_frame_rate === '25/1', `the phone's variable rate is joined at the first section's steady 25 fps (${v.r_frame_rate}, ${v.avg_frame_rate})`);
    const end = durOf(J) - 0.3, fl = flashes(J).filter(t => t > 2.5 && t < end), bp = beeps(J).filter(t => t > 2.5 && t < end);     // not the file's end
    const off = fl.map((t, k) => (bp[k] != null ? Math.abs(t - bp[k]) : 9));
    ok(fl.length === 11 && bp.length === 11 && Math.max(...off) <= 0.08, `a minute of variable-rate video stays in sync: ${fl.length} flashes, ${bp.length} beeps, worst ${Math.max(...off).toFixed(3)} s (last at ${fl[fl.length - 1]} / ${bp[bp.length - 1]})`);
  }
  await fresh(VFR); await sleep(1000); await tab('join'); await sect(0, 3); await add([MAIN]);
  ok(/· 30 fps ·/.test(await outLine()) && await ev(() => CL.info.vfr && CL.info.sfps === 30), 'a variable-rate phone clip first: joined at a steady 30 fps (its nominal rate)');

  // ===================================================================== Even out the volume: each file first
  await fresh(QUIET); await sleep(1000); await tab('join'); await sect(0, 4); await add([LOUD]);
  r = await save(); J = last(r) && last(r).path;
  const gap0 = J ? vol(J, 4.3, 3.4) - vol(J, 0.3, 3.4) : 0;
  await ev(() => { CL.even = true; clipRender(); });
  r = await save(); J = last(r) && last(r).path;
  if (J) {
    const q = vol(J, 0.3, 3.4), l = vol(J, 4.3, 3.4);
    ok(gap0 > 20 && Math.abs(l - q) < 2, `Even out the volume brings a quiet phone clip and a loud one together (${gap0.toFixed(1)} dB apart → ${Math.abs(l - q).toFixed(1)} dB)`);
  }
  await ev(() => { CL.even = false; });

  // ===================================================================== Save each: each from its own file
  await fresh(MAIN); await sleep(1000); await tab('join'); await sect(1, 4); await add([BEACH, SONGN]); await sleep(500);
  await ev(() => { CL.join.mode = 'each'; clipRender(); });
  ol = await outLine();
  ok(/^SAVE EACH 2 sections from 3 files → 2 MP4 clips/.test(ol) && /1 song left out/.test(ol), `Save each: "${ol.slice(0, 120)}"`);
  r = await save();
  const ef = (r && r.files) || [];
  ok(r && r.ok && ef.length === 2 && vOf(ef[1].path).width === 1280 && Math.abs(durOf(ef[1].path) - 6) < 0.3 && band(ef[1].path, 1, 3, 3000) > -40, `two clips, the second from Beach Day itself (${ef.map(f => path.basename(f.path)).join(', ')})`);
  await ev(() => { CL.join.mode = 'join'; clipRender(); });

  // ===================================================================== ▶ Play all: this file's pieces
  st = await ev(() => ({ t: WM.$('#clipJoinPlay').textContent.trim(), n: joinPlayable().length, title: WM.$('#clipJoinPlay').title }));
  ok(st.t === '▶ Play all 0:03.0' && st.n === 1 && /other files play in the saved clip/.test(st.title), `Play all plays this file's pieces (${st.t})`);

  // ===================================================================== 4F: saved with the clip; a file that's gone
  const GONE = path.join(SRC, 'Gone Soon.mp4'); fs.copyFileSync(BEACH, GONE);
  await fresh(MAIN); await sleep(1000); await tab('join'); await sect(2, 4); await add([GONE, SONGC]);
  await ev(() => { WM.$$('#clipJoinCards .cj-card')[1].click(); }); await sleep(1500);
  await ev(() => { [...WM.$('#clipRatio').children].find(b => b.dataset.r === '1:1').click(); }); await sleep(300);
  await ev(() => WM.$$('#clipJoinCards .cj-card')[0].click()); await sleep(1500);
  r = await save(); J = last(r) && last(r).path;
  ok(J && Math.abs(durOf(J) - 13) < 0.25, `saved: ${J && path.basename(J)} (2 + 6 + 5 s)`);
  const ent = await ev((p) => P.clipEntry(p), J);
  ok(ent && ent.join && ent.join.items.length === 3 && !ent.join.items[0].file && ent.join.items[1].file === GONE && ent.join.shapes && ent.join.shapes[GONE] && ent.join.shapes[GONE].ratio === '1:1', 'the list is saved with the clip: each other file, and its Shape');
  await fresh(MAIN);
  await ev(([p, src]) => clipAgain({ path: p, src, srcExists: true, kind: 'mp4clip', in: 2, out: 4 }), [J, MAIN]); await sleep(3000);
  cs = await cards();
  ok(cs.length === 3 && cs[1].cls.includes('other') && cs[2].cls.includes('other') && cs[2].img, `Clip again brings it back, the other files dashed (${cs.map(c => c.cls || '-').join(' ')})`);
  fs.rmSync(GONE);
  await fresh(MAIN);
  await ev(([p, src]) => clipAgain({ path: p, src, srcExists: true, kind: 'mp4clip', in: 2, out: 4 }), [J, MAIN]); await sleep(3000);
  cs = await cards(); cnt = await ev(() => WM.$('#clipJoinCount').textContent); ol = await outLine();
  ok(cs[1].cls.includes('gone') && /not there any more/.test(await ev(() => WM.$$('#clipJoinCards .cj-card')[1].textContent)), 'a file that’s gone: a red card, "not there any more"');
  ok(/, 1 not there any more · 0:07\.0$/.test(cnt) && /1 not there any more \(skipped\)/.test(ol), `the count and the line above Save say so ("${cnt}")`);
  await (await cw()).screenshot({ path: `${O}/2-gone.png` });
  await ev(() => WM.$$('#clipJoinCards .cj-card')[1].click()); tt = await toasts();
  ok(await ev(() => CL.file.endsWith('Night Main 360p.mp4')) && tt.some(t => /Gone Soon\.mp4 isn’t there any more/.test(t)), 'clicking the red card doesn’t open anything; it says why');
  r = await save(); J = last(r) && last(r).path; tt = await toasts();
  ok(r && r.ok && Math.abs(durOf(J) - 7) < 0.25 && last(r).skipped === 1 && tt.some(t => /1 card was skipped: not there any more/.test(t)), `saving skips it (${J && durOf(J).toFixed(2)} s; "${tt.join(' / ')}")`);

  // ===================================================================== Join v1 is unchanged: another file the usual way is a fresh list
  await ev((x) => clipOpen(x, { kind: 'mp4' }), BEACH); await sleep(800);
  ok(await ev(() => !CL.join.items.length), 'opening another file the usual way: a fresh list (as in 2.9.7)');
  ok(!errs.length, `no errors in the windows ${JSON.stringify(errs.slice(0, 3))}`);
  await app.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
