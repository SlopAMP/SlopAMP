// 2.9.8 CLIP part 4:
//   1. your own lengths (1A–1C): the + box, up to 3, keys 8 9 0, right-click removes, kept after a restart
//   2. Shape's Fit (2A–2E): crop to the box / whole picture with black bars / blurred fill (Soft / Strong, darken),
//      1080 / 720 on the short side, one real frame in the preview, GIFs too, and Join's Fit (Blurred fill)
//   3. WebP and Loop (3A–3D): an animated WebP in gifs (not for X), Loop ×n / up to n s (repeats copied), Boomerang
//      (≤ 15 s), sound off, the X bar on the whole loop
//   4. Change the sound (5A–5H): Replace / Mix under (tones checked with band filters), Start from / at, Loop it /
//      Silence after, the fade out, Fast cut keeps the picture, Speed doesn't speed the new sound up, Join, right-click,
//      the preview plays both, Clip again
// Run (Linux, xvfb): SLOPAMP_ELECTRON=… SLOPAMP_APP=… xvfb-run -a node tests/clip-298.js
'use strict';
const { launch, sleep, docWin } = require('./lib');
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const H = path.join(os.tmpdir(), 'slopamp-test-298');
const O = process.env.SLOPAMP_SHOTS || path.join(os.tmpdir(), 'slopamp-298-shots');
fs.mkdirSync(O, { recursive: true });
const FF = process.env.SLOPAMP_FFMPEG || 'ffmpeg', FP = FF.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
const APPFF = path.join(process.env.SLOPAMP_APP || path.join(__dirname, '..'), 'vendor/ffmpeg/linux');     // the bundled one reads animated WebP
const probe = (f, fp = FP) => JSON.parse(execFileSync(fp, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f]).toString());
const vOf = (f) => probe(f).streams.find(s => s.codec_type === 'video');
const aOf = (f) => probe(f).streams.find(s => s.codec_type === 'audio');
const durOf = (f) => +probe(f).format.duration;
const rgb = (f, t, x, y, w, h) => { const b = execFileSync(FF, ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', `crop=${w}:${h}:${x}:${y},scale=1:1:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']); return [b[0], b[1], b[2]]; };
const frame = (f, t) => execFileSync(FF, ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', 'scale=64:36', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
const fdiff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d / a.length; };
// the loudness of one band (Hz) in a stretch of a file's sound, dB (−200: nothing)
const band = (f, t, d, hz) => { const r = spawnSync(FF, ['-hide_banner', '-ss', String(t), '-t', String(d), '-i', f, '-af', `bandpass=f=${hz}:width_type=q:w=8,bandpass=f=${hz}:width_type=q:w=8,volumedetect`, '-f', 'null', '-']); const m = /mean_volume: (-?[\d.]+|-inf) dB/.exec(String(r.stderr)); return m ? (m[1] === '-inf' ? -200 : +m[1]) : -200; };
const vsize = (f) => { const r = execFileSync(FP, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=size', '-of', 'csv=p=0', f]).toString().trim().split('\n').map(Number); return r.reduce((a, b) => a + b, 0); };

(async () => {
  const SRC = path.join(os.tmpdir(), 'slopamp-298-src'); fs.mkdirSync(SRC, { recursive: true });
  const mk = (name, args) => { const f = path.join(SRC, name); if (!fs.existsSync(f)) execFileSync(FF, ['-hide_banner', '-v', 'error', '-y', ...args, f]); return f; };
  // a 16:9 video with a 440 Hz tone and a keyframe every second; a 1000 Hz "song" of 5 s; a 20 s video; a still
  const VID = mk('Tone Video 360p.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=12', '-f', 'lavfi', '-i', 'sine=f=440:d=12', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
  const SONG = mk('High Song 1k.mp3', ['-f', 'lavfi', '-i', 'sine=f=1000:d=5', '-c:a', 'libmp3lame', '-b:a', '192k']);
  const SONGV = mk('Other Video 3k.mp4', ['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=10:d=30', '-f', 'lavfi', '-i', 'sine=f=3000:d=30', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
  const LONG = mk('Long Tone 20s.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=20', '-f', 'lavfi', '-i', 'sine=f=440:d=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
  const STILL = mk('square still.png', ['-f', 'lavfi', '-i', 'color=c=red:s=400x400', '-frames:v', '1']);

  let { app, win, errs } = await launch(H);
  let ev = (f, a) => win.evaluate(f, a);
  const DL = (await app.evaluate(({ app }) => app.getPath('downloads'))) + '/SlopAMP';
  const cw = async () => docWin(app, 'win-clip');
  const outLine = () => ev(() => WM.$('#clipFmtInfo').textContent.replace(/\s+/g, ' ').trim());
  const save = async () => ev(() => { CL.nameTouched = false; return clipSave(); });
  const tab = (t) => ev((x) => WM.$(`#clipTabs [data-t=${x}]`).click(), t);
  const click = (sel) => ev((s) => { const b = WM.$(s); b.click(); return !!b; }, sel);
  const bar = () => ev(() => ({ shown: !WM.$('#clipXBar').classList.contains('hidden'), text: WM.$('#clipXBarT').textContent.replace(/\s+/g, ' ').trim(), btns: [...WM.$('#clipXBarB').children].map(b => b.textContent) }));

  // ===================================================================== 1. your own lengths
  await ev((f) => clipOpen(f, { kind: 'mp4' }), LONG); await sleep(1500);
  let st = await ev(() => [...WM.$('#clipPresets').children].map(b => b.textContent + (b.classList.contains('own') ? '*' : '')));
  ok(JSON.stringify(st) === JSON.stringify(['5', '10', '15', '20', '25', '30', '60 s', '+']), `the length row ends with + (${st.join(' ')})`);
  const c1 = await cw();
  await ev(() => { CL.in = 2; clipRenderTimes(); });
  await c1.click('#clipPresets .own-add'); await sleep(200);
  ok(await ev(() => !WM.$('#clipOwnBox').classList.contains('hidden')), '+ opens the box');
  await c1.screenshot({ path: `${O}/1-own-box.png` });
  await c1.fill('#clipOwnIn', '7'); await c1.click('#clipOwnGo'); await sleep(200);
  st = await ev(() => ({ own: S.clipOwn, inn: CL.in, out: CL.out, btn: [...WM.$$('#clipPresets .own')].map(b => b.textContent), on: !!WM.$('#clipPresets .own.on'), box: WM.$('#clipOwnBox').classList.contains('hidden') }));
  ok(JSON.stringify(st.own) === '[7]' && st.inn === 2 && Math.abs(st.out - 9) < 0.01 && st.btn[0] === '7' && st.on && st.box, `added 7 s: it's used at once (In 2, Out 9) and lit: ${JSON.stringify(st)}`);
  await c1.click('#clipPresets .own-add'); await c1.fill('#clipOwnIn', '15'); await c1.click('#clipOwnGo'); await sleep(100);
  ok(await ev(() => /already/.test(WM.$('#clipOwnMsg').textContent) && S.clipOwn.length === 1), `a length that's there already (15) isn't added twice ("${await ev(() => WM.$('#clipOwnMsg').textContent)}")`);
  await c1.fill('#clipOwnIn', 'abc'); await c1.click('#clipOwnGo');
  ok(await ev(() => /1 s to 1 hour/.test(WM.$('#clipOwnMsg').textContent)), 'nonsense is refused with a hint');
  await c1.fill('#clipOwnIn', '1:30'); await c1.press('#clipOwnIn', 'Enter'); await sleep(100);
  await c1.click('#clipPresets .own-add'); await c1.fill('#clipOwnIn', '12.5'); await c1.click('#clipOwnGo'); await sleep(100);
  st = await ev(() => ({ own: S.clipOwn, add: WM.$('#clipPresets .own-add').disabled, labels: [...WM.$$('#clipPresets .own')].map(b => b.textContent) }));
  ok(JSON.stringify(st.own) === '[7,90,12.5]' && st.add && JSON.stringify(st.labels) === '["7","1:30","12.5"]', `up to 3 (7, 1:30, 12.5); then + is greyed: ${JSON.stringify(st)}`);
  ok(await ev(() => [...WM.$$('#clipPresets .own')].find(b => b.textContent === '1:30').disabled), '1:30 is greyed on a 20 s file, like the built-in ones');
  await ev(() => { CL.in = 1; clipRenderTimes(); }); await c1.keyboard.press('8'); await sleep(100);
  ok(await ev(() => Math.abs(CL.out - CL.in - 7) < 0.01), 'key 8 = your first length');
  await c1.keyboard.press('0'); await sleep(100);
  ok(await ev(() => Math.abs(CL.out - CL.in - 12.5) < 0.01), 'key 0 = your third');
  await c1.click('#clipPresets .own:nth-of-type(9)', { button: 'right' }).catch(() => {});
  await ev(() => { const b = [...WM.$$('#clipPresets .own')].find(x => x.textContent === '1:30'); b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); }); await sleep(100);
  ok(await ev(() => JSON.stringify(S.clipOwn) === '[7,12.5]' && !WM.$('#clipPresets .own-add').disabled), `right-click removes one (${await ev(() => JSON.stringify(S.clipOwn))})`);
  await ev(() => { S.clipOwn = [7, 12.5, 45]; clipRender(); });
  await ev(() => saveSoon()); await sleep(1500);
  await app.close();
  ({ app, win, errs } = await launch(H, { keep: true })); ev = (f, a) => win.evaluate(f, a);
  await ev((f) => clipOpen(f, { kind: 'mp4' }), LONG); await sleep(1500);
  ok(await ev(() => JSON.stringify(S.clipOwn) === '[7,12.5,45]' && WM.$$('#clipPresets .own').length === 3), 'your lengths are kept after a restart');

  // ===================================================================== 2. Shape's Fit
  await ev(() => { CL.in = 2; CL.out = 6; clipRenderTimes(); }); await tab('shape');
  await ev(() => [...WM.$('#clipRatio').children].find(b => b.dataset.r === '9:16').click()); await sleep(200);
  st = await ev(() => ({ fit: [...WM.$('#clipShapeFit').children].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')), crop: !WM.$('#clipCrop').classList.contains('hidden'), eff: clipShapeEff() }));
  ok(st.fit.join('|') === 'Crop to the box*|Whole picture, black bars|Whole picture, blurred fill' && st.crop && st.eff.w === 202, `Fit: Crop to the box is the default (the 2.9.4 box): ${JSON.stringify(st)}`);
  await click('#clipShapeFit [data-v=blur]'); await sleep(1800);
  st = await ev(() => ({ eff: clipShapeEff(), crop: !WM.$('#clipCrop').classList.contains('hidden'), box: [...WM.$('#clipBoxPos').children].every(b => b.disabled), blurRow: !WM.$('#clipBlurRow').classList.contains('hidden'), img: !WM.$('#clipShapeImg').classList.contains('hidden') && WM.$('#clipShapeImg').src.startsWith('data:image/jpeg'), out: [...WM.$('#clipShapeOut').children].map(b => b.textContent).join('|') }));
  ok(st.eff.whole && st.eff.ow === 1080 && st.eff.oh === 1920 && st.eff.fit === 'blur' && !st.crop && st.box && st.blurRow && st.out === '1080×1920|720×1280', `Blurred fill: no box, Box greyed, Blur row, 1080×1920 / 720×1280: ${JSON.stringify(st)}`);
  ok(st.img, 'the preview shows one real frame of the result (while paused)');
  ok(/^MP4 · 1080×1920 \(9:16, whole picture, blurred fill\) · H\.264 \+ AAC · RE-ENCODE/.test(await outLine()), `the output line: "${await outLine()}"`);
  await (await cw()).screenshot({ path: `${O}/2-blurred-fill.png` });
  let r = await save(); let f = r && r.ok && r.files[0];
  const BLUR = f && f.path;
  if (f) {
    const v = vOf(f.path), top = rgb(f.path, 1, 100, 100, 880, 300), mid = rgb(f.path, 1, 100, 800, 880, 300);
    ok(v.width === 1080 && v.height === 1920, `saved 1080×1920 (${v.width}×${v.height})`);
    ok(top[0] + top[1] + top[2] > 60, `the bars are filled, not black (${top}); the middle is the picture (${mid})`);
  } else ok(false, 'blur save ' + JSON.stringify(r));
  await click('#clipShapeFit [data-v=bars]'); await click('#clipShapeOut [data-u="1"]');
  ok(/720×1280 \(9:16, whole picture, black bars\)/.test(await outLine()), `black bars, 720×1280: "${await outLine()}"`);
  r = await save(); f = r && r.ok && r.files[0];
  if (f) { const v = vOf(f.path), top = rgb(f.path, 1, 60, 60, 600, 200); ok(v.width === 720 && v.height === 1280 && top[0] + top[1] + top[2] < 10, `720×1280 with black bars (${v.width}×${v.height}, top ${top})`); } else ok(false, 'bars save');
  await click('#clipShapeFit [data-v=blur]'); await click('#clipShapeOut [data-u="0"]'); await click('#clipShapeBlur [data-v=strong]'); await ev(() => { WM.$('#clipShapeDark').click(); });
  ok(await ev(() => { const e = clipShapeEff(); return e.blur === 'strong' && e.dark === false; }), 'Strong blur, darken off');
  r = await save(); f = r && r.ok && r.files[0];
  if (f && BLUR) { const a = rgb(BLUR, 1, 100, 100, 880, 300), b = rgb(f.path, 1, 100, 100, 880, 300); ok(b[0] + b[1] + b[2] > a[0] + a[1] + a[2], `without darkening the fill is brighter (${a} → ${b})`); } else ok(false, 'strong save');
  // GIF and Fast cut
  await ev(() => WM.$('#clipKind [data-k=gif]').click()); await sleep(300);
  ok(/GIF · 480×854 \(9:16, whole picture, blurred fill\)/.test(await outLine()), `a GIF gets the whole picture too: "${await outLine()}"`);
  r = await save(); f = r && r.ok && r.files[0];
  ok(f && f.kind === 'gif' && vOf(f.path).width === 480, `GIF saved (${f && vOf(f.path).width}×${f && vOf(f.path).height})`);
  await ev(() => { WM.$('#clipKind [data-k=mp4]').click(); CL.cut = 'fast'; clipRender(); });
  ok(await ev(() => clipCutEff() === 'exact'), 'Fast cut is off while the picture is fitted');
  await ev(() => { WM.$('#clipShapeFit [data-v=crop]').click(); [...WM.$('#clipRatio').children].find(b => b.dataset.r === 'orig').click(); });
  ok(await ev(() => !clipShapeEff()), 'Original: no shape');
  // 2.9.8 smoke-test fix: straight from one shape to another works exactly like Original → that shape, in every
  // direction, with each Fit choice (it used to keep a box with no size or place: "undefined×undefined")
  {
    const R = ['16:9', '9:16', '1:1', '4:5'], bad = [];
    const pick = (r) => ev((r) => { [...WM.$('#clipRatio').children].find(b => b.dataset.r === r).click(); return JSON.stringify({ s: CL.shape, e: clipShapeEff(), o: WM.$('#clipFmtInfo').textContent.replace(/\s+/g, ' ').replace(/ ≈ .*$/, ''), crop: WM.$('#clipCrop').classList.contains('hidden'), box: WM.$('#clipCropBox').style.width }); }, r);
    for (const fit of ['crop', 'bars', 'blur']) {
      await click(`#clipShapeFit [data-v=${fit}]`);
      let n = 0;
      for (const a2 of R) for (const b2 of R) {
        if (a2 === b2) continue;
        await pick('orig'); await pick(a2);
        const direct = await pick(b2);
        await pick('orig'); const fresh = await pick(b2);
        n++;
        if (direct !== fresh || /NaN|undefined|"[xywh]":null/.test(direct)) bad.push({ fit, from: a2, to: b2, direct, fresh });
      }
      ok(!bad.filter(x => x.fit === fit).length, `Fit ${fit}: straight from any shape to any other (${n} pairs, both directions) = Original then that shape ${JSON.stringify(bad.filter(x => x.fit === fit)[0] || '')}`);
    }
    // a moved / upscaled box doesn't leak into the next shape either
    await click('#clipShapeFit [data-v=crop]'); await pick('orig'); await pick('9:16');
    await ev(() => { WM.$('#clipBoxPos [data-p=l]').click(); WM.$('#clipShapeOut [data-u="1"]').click(); });
    const moved = await pick('1:1'); await pick('orig'); const fresh = await pick('1:1');
    ok(moved === fresh, 'a 9:16 box moved Left and upscaled, then 1:1: the same fresh centred box as from Original');
    await pick('9:16'); await ev(() => { CL.shape.w = 120; CL.shape.h = 214; CL.shape.x = 0; clipRender(); });     // a smaller box, moved left
    const keep = await ev(() => { [...WM.$('#clipRatio').children].find(b => b.dataset.r === '9:16').click(); return [CL.shape.w, CL.shape.h, CL.shape.x]; });
    ok(JSON.stringify(keep) === '[120,214,260]', `clicking the shape that's already on keeps its box size and centres it, as in 2.9.4 (${JSON.stringify(keep)})`);
    // the captain's case, saved: 9:16 Shorts / TikTok, then straight to 1:1
    await pick('orig'); await pick('9:16'); await pick('1:1');
    ok(/^MP4 · 360×360 \(1:1\) · H\.264 \+ AAC · RE-ENCODE/.test(await outLine()), `9:16 → 1:1: "${await outLine()}"`);
    r = await save(); f = r && r.ok && r.files[0];
    ok(f && vOf(f.path).width === 360 && vOf(f.path).height === 360, `…saves a 360×360 clip (${f && `${vOf(f.path).width}×${vOf(f.path).height}`})`);
    await (await cw()).screenshot({ path: `${O}/2-direct-switch.png` });
    await pick('orig');
  }
  // Join's Fit: Blurred fill (a square still in a 16:9 join)
  await tab('join');
  await ev(async () => { CL.in = 1; CL.out = 3; await joinAddSection(); });
  await ev((p) => P.clipImageUrl(p).then(u => joinAddStill(p, u)), STILL);
  await click('#clipJoinFit [data-v=blur]');
  ok(await ev(() => CL.join.fit === 'blur' && WM.$('#clipJoinFit [data-v=blur]').classList.contains('on')), 'Join → Fit → Blurred fill');
  r = await save(); f = r && r.ok && r.files[0];
  if (f) { const side = rgb(f.path, 3.2, 10, 100, 100, 160); ok(side[0] > 60 && side[1] < 80, `the square still has a blurred red fill at its sides, not black (${side})`); } else ok(false, 'join blur ' + JSON.stringify(r));
  await ev(() => { CL.join = joinNew(); clipRender(); clipDraw(); });

  // ===================================================================== 3. WebP and Loop
  await ev(() => { CL.in = 2; CL.out = 6; clipRenderTimes(); WM.$('#clipTabs [data-t=trim]').click(); WM.$('#clipKind [data-k=webp]').click(); }); await sleep(3000);
  st = await ev(() => ({ lab: WM.$('#clipAnimLab').textContent, q: [...WM.$('#clipWebpQ').children].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')).join('|'), col: WM.$('#clipGifCol').classList.contains('hidden'), est: WM.$('#clipGifEst').textContent, sound: WM.$('#clipTabs [data-t=sound]').disabled, btn: WM.$('#clipSave').textContent, ext: WM.$('#clipExt').textContent }));
  ok(st.lab === 'WEBP' && st.q === 'Smaller|Normal*|Best' && st.col && /≈ [\d.]+ (KB|MB)/.test(st.est) && st.sound && /Save WebP/.test(st.btn) && st.ext === '.webp', `WebP: the GIF settings with Quality, an estimate, no Sound: ${JSON.stringify(st)}`);
  let b = await bar();
  ok(b.shown && /Not for X: X takes GIF, JPEG and PNG pictures/.test(b.text) && !b.btns.length, `the For X bar: not for X ("${b.text}")`);
  ok(/^WEBP · animated · 480×270 · 15 fps · 0:04\.0 · loops · RE-ENCODE \(always\) · ≈/.test(await outLine()), `the output line: "${await outLine()}"`);
  await (await cw()).screenshot({ path: `${O}/3-webp.png` });
  r = await save(); f = r && r.ok && r.files[0];
  const WEBP = f && f.path;
  if (f) {
    const p = probe(f.path, path.join(APPFF, 'ffprobe')), v = p.streams[0];
    ok(f.path === `${DL}/gifs/Long Tone 20s (0m02s-0m06s).webp` && v.codec_name === 'webp_anim' && v.width === 480 && v.height === 270, `an animated WebP in gifs: ${path.basename(f.path)} ${v.codec_name} ${v.width}×${v.height}`);
    const n = execFileSync(path.join(APPFF, 'ffmpeg'), ['-v', 'error', '-i', f.path, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }) && spawnSync(path.join(APPFF, 'ffprobe'), ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', f.path]).stdout.toString().trim();
    ok(+n >= 55 && +n <= 65, `60 frames (4 s at 15 fps): ${n}`);
  } else ok(false, 'webp save ' + JSON.stringify(r));
  await click('#clipWebpQ [data-v=small]');
  r = await save(); f = r && r.ok && r.files[0];
  ok(f && WEBP && fs.statSync(f.path).size < fs.statSync(WEBP).size, `Smaller makes a smaller file (${f && fs.statSync(f.path).size} < ${WEBP && fs.statSync(WEBP).size})`);
  ok(await ev(() => S.clipWebp && S.clipWebp.q === 'small' && (!S.clipGif || S.clipGif.q === undefined)), 'WebP settings are kept apart from the GIF ones');
  await ev(() => openDownloadsManager('clips')); await sleep(1500);
  ok(await ev(() => (DLM.rows || []).filter(x => x.kind === 'gifclip' && /\.webp$/.test(x.path)).length === 2), 'the Library lists the WebPs with the GIFs');
  await ev(() => WM.$('#dlmDlg').close());
  // Loop
  await ev(() => { WM.$('#clipKind [data-k=mp4]').click(); CL.cut = 'fast'; clipRender(); });
  ok(await ev(() => !WM.$('#clipLoopRow').classList.contains('hidden') && WM.$('#clipRepN [data-v="0"]').classList.contains('on')), 'MP4 has the Loop row (Off)');
  await click('#clipRepN [data-v="3"]');
  st = await ev(() => ({ lcd: WM.$('#clipRepLcd').textContent, btn: WM.$('#clipSave').textContent, name: WM.$('#clipName').value, cut: clipCutEff() }));
  ok(st.lcd === '0:04.0 × 3 = 0:12.0' && /Save loop 0:12\.0/.test(st.btn) && st.name === 'Long Tone 20s (0m02s-0m06s) loop x3' && st.cut === 'fast', `×3: ${JSON.stringify(st)}`);
  ok(/^MP4 · loop ×3 · .*FAST CUT.* 0:04\.0 × 3 = 0:12\.0 \(repeats copied\) · ≈/.test(await outLine()), `the output line: "${await outLine()}"`);
  await (await cw()).screenshot({ path: `${O}/3-loop.png` });
  r = await save(); f = r && r.ok && r.files[0];
  if (f) {
    const d = durOf(f.path), u = d / 3;
    ok(f.loop && f.loop.n === 3 && d > 11.5 && d < 12.6 && aOf(f.path), `saved: 3 repeats, ${d.toFixed(2)} s, with sound`);
    ok(fdiff(frame(f.path, 0.5), frame(f.path, u + 0.5)) < 0.5 && fdiff(frame(f.path, 0.5), frame(f.path, 2 * u + 0.5)) < 0.5, 'the repeats are the same frames (copied, not re-encoded)');
  } else ok(false, 'loop save ' + JSON.stringify(r));
  await click('#clipRepUp [data-v="15"]'); await click('#clipRepSound [data-v="0"]');
  ok(await ev(() => WM.$('#clipRepLcd').textContent === '0:04.0 × 3 = 0:12.0'), 'up to 15 s: as many whole repeats as fit (3 × 4 s)');
  r = await save(); f = r && r.ok && r.files[0];
  ok(f && !aOf(f.path) && Math.abs(durOf(f.path) - 12) < 0.6, `Sound Off: no sound track (${f && durOf(f.path).toFixed(2)} s)`);
  await click('#clipRepUp [data-v="15"]'); await click('#clipRepSound [data-v="1"]'); await click('#clipRepN [data-v="0"]'); await ev(() => WM.$('#clipRepBoom').click());
  st = await ev(() => ({ lcd: WM.$('#clipRepLcd').textContent, name: WM.$('#clipName').value }));
  ok(st.lcd === '0:08.0 × 1 = 0:08.0' && /boomerang$/.test(st.name), `Boomerang: forward + back = 8 s (${JSON.stringify(st)})`);
  r = await save(); f = r && r.ok && r.files[0];
  if (f) {
    const d = durOf(f.path);
    ok(Math.abs(d - 8) < 0.5, `boomerang saved: ${d.toFixed(2)} s`);
    ok(fdiff(frame(f.path, 1), frame(f.path, d - 1.04)) < 6 && fdiff(frame(f.path, 1), frame(f.path, 3)) > 1, 'it plays back the way it came (1 s in ≈ 1 s before the end)');
  } else ok(false, 'boom ' + JSON.stringify(r));
  await ev(() => { CL.in = 0; CL.out = 16; clipRenderTimes(); clipRender(); });
  ok(await ev(() => /up to 15 s/.test(WM.$('#clipRepHint').textContent)), 'a 16 s clip: Boomerang warns it is for clips up to 15 s');
  r = await save();
  ok(r && !r.ok && /up to 15 s/.test(r.error), `…and saving says so (${r && r.error})`);
  await ev(() => { WM.$('#clipRepBoom').click(); });
  await ev(() => { CL.rep.n = 5; CL.in = 0; CL.out = 20; CL.speed = 0.5; clipRender(); });
  b = await bar();
  ok(b.shown && /3:20 is 1:00 over the 2:20 X allows on Free/.test(b.text) && !b.btns.some(x => /Trim/.test(x)), `the For X bar counts the whole loop (40 s × 5 = 3:20), no Trim button: "${b.text}" ${JSON.stringify(b.btns)}`);
  await ev(() => { CL.speed = 1; CL.rep = { n: 0, upTo: 0, boom: false, sound: true }; clipRender(); });

  // ===================================================================== 4. Change the sound
  await ev((x) => clipOpen(x, { kind: 'mp4' }), VID); await sleep(1500);
  await tab('sound');
  st = await ev(() => ({ mode: [...WM.$('#clipNsMode').children].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')).join('|'), more: WM.$('#clipNsMore').classList.contains('hidden'), msg: WM.$('#clipNsMsg').textContent }));
  ok(st.mode === 'Original*|Replace|Mix under' && st.more && /Pick a song/.test(st.msg), `the Sound tab starts with Original: ${JSON.stringify(st)}`);
  await ev((s) => nsPick(s), SONG); await sleep(1000);
  st = await ev(() => ({ mode: CL.ns.mode, file: WM.$('#clipNsFile').textContent, lane: !WM.$('#clipNsLane').classList.contains('hidden'), lab: WM.$('#clipNsLaneLab').textContent, dot: !!WM.$('#clipTabs [data-t=sound] .dot') }));
  ok(st.mode === 'replace' && /High Song 1k/.test(st.file) && st.lane && /High Song 1k \(from 0:00\.0\)/.test(st.lab) && st.dot, `a song picked: Replace, its lane under the wave: ${JSON.stringify(st)}`);
  await ev(() => { CL.in = 1; CL.out = 9; clipRenderTimes(); clipRender(); });
  ok(/sound replaced: High Song 1k/.test(await outLine()) && /RE-ENCODE exact cut/.test(await outLine()), `the output line: "${await outLine()}"`);
  await (await cw()).screenshot({ path: `${O}/4-new-sound.png` });
  r = await save(); f = r && r.ok && r.files[0];
  const REPL = f && f.path;
  if (f) {
    ok(Math.abs(durOf(f.path) - 8) < 0.15 && f.newSound, `Replace: 8 s clip (${durOf(f.path).toFixed(2)})`);
    ok(band(f.path, 1, 2, 1000) > band(f.path, 1, 2, 440) + 15, `the new sound (1000 Hz ${band(f.path, 1, 2, 1000)} dB) replaced the original (440 Hz ${band(f.path, 1, 2, 440)} dB)`);
    ok(band(f.path, 6, 1, 1000) > -40, `the 5 s song loops (Loop it) to fill 8 s (${band(f.path, 6, 1, 1000)} dB at 6 s)`);
    ok(band(f.path, 7.6, 0.35, 1000) < band(f.path, 5.5, 0.5, 1000) - 4, `it fades out at the end (${band(f.path, 7.6, 0.35, 1000)} vs ${band(f.path, 5.5, 0.5, 1000)} dB)`);
  } else ok(false, 'replace ' + JSON.stringify(r));
  await click('#clipNsShort [data-v=silence]'); await ev(() => { CL.ns.at = 1.5; clipRender(); });
  ok(/shorter than the clip/.test(await ev(() => WM.$('#clipNsShortLab').textContent)), 'it says the sound is shorter than the clip');
  r = await save(); f = r && r.ok && r.files[0];
  if (f) {
    ok(band(f.path, 0.1, 1.2, 1000) < -60, `"at 0:01.5 of the clip": silence before it (${band(f.path, 0.1, 1.2, 1000)} dB)`);
    ok(band(f.path, 2, 1, 1000) > -40 && band(f.path, 7, 0.8, 1000) < -60, `Silence after: it plays 1.5–6.5 s, then nothing (${band(f.path, 2, 1, 1000)} / ${band(f.path, 7, 0.8, 1000)} dB)`);
  } else ok(false, 'silence ' + JSON.stringify(r));
  // Mix under, Fast cut keeps the picture
  await ev(() => { CL.ns.at = 0; CL.ns.short = 'loop'; WM.$('#clipNsMode [data-v=mix]').click(); CL.cut = 'fast'; clipRender(); });
  st = await ev(() => ({ orig: WM.$('#clipNsOrig').disabled, cut: clipCutEff(), line: WM.$('#clipFmtInfo').textContent }));
  ok(!st.orig && st.cut === 'fast' && /picture copied, sound re-encoded .*mixed with High Song 1k.*FAST CUT OK/.test(st.line), `Mix under with Fast cut: the picture is copied: ${JSON.stringify(st)}`);
  r = await save(); f = r && r.ok && r.files[0];
  if (f) {
    const both = [band(f.path, 2, 2, 1000), band(f.path, 2, 2, 440)];
    ok(both[0] > -40 && both[1] > -60 && both[0] - both[1] > 8 && both[0] - both[1] < 22, `both sounds, the original about 14 dB under (1000 Hz ${both[0]}, 440 Hz ${both[1]})`);
    await ev(() => { WM.$('#clipNsMode [data-v=orig]').click(); CL.vol = 3; CL.cut = 'fast'; clipRender(); });      // a sound-only Fast cut (2.9.4): the picture copied from the same keyframe
    const r2 = await save(), f2 = r2 && r2.ok && r2.files[0];
    ok(f2 && vsize(f.path) === vsize(f2.path), `the picture is the same bytes as a sound-only Fast cut (copied: ${vsize(f.path)} = ${f2 && vsize(f2.path)})`);
    await ev(() => { CL.vol = 0; clipRender(); });
  } else ok(false, 'mix ' + JSON.stringify(r));
  // a video as the new sound, Start from, Speed 2x
  await ev((s) => nsPick(s), SONGV); await sleep(800);
  await ev(() => { CL.ns.from = 10; CL.cut = 'exact'; CL.speed = 2; CL.in = 0; CL.out = 12; clipRender(); });
  r = await save(); f = r && r.ok && r.files[0];
  if (f) ok(Math.abs(durOf(f.path) - 6) < 0.2 && band(f.path, 1, 3, 3000) > -40 && band(f.path, 1, 3, 6000) < band(f.path, 1, 3, 3000) - 20, `another video's sound; at 2× the clip is 6 s and the new sound is not sped up (still 3000 Hz: ${band(f.path, 1, 3, 3000)} dB)`);
  else ok(false, 'video sound ' + JSON.stringify(r));
  await ev(() => { CL.speed = 1; CL.ns.from = 0; clipRender(); });
  ok(await ev(() => WM.$('#clipAlsoMp3').disabled), '"Also save the sound as MP3" is off with a new sound');
  // GIF / MP3: not here
  await ev(() => WM.$('#clipKind [data-k=gif]').click());
  ok(await ev(() => WM.$('#clipTabs [data-t=sound]').disabled && !nsActive()), 'GIF: no Sound tab, no new sound');
  await ev(() => WM.$('#clipKind [data-k=mp3]').click()); await tab('sound');
  ok(await ev(() => !nsActive() && /save as MP4/.test(WM.$('#clipNsMsg').textContent) && [...WM.$('#clipNsMode').children].every(b => b.disabled)), 'MP3: "Change the sound works on videos: save as MP4"');
  await ev(() => WM.$('#clipKind [data-k=mp4]').click());
  // the preview plays both
  await ev((s) => nsPick(s), SONG); await sleep(600);
  await ev(() => { CL.ns.mode = 'replace'; CL.in = 1; CL.out = 5; clipRender(); clipPlayRange(CL.in, CL.out); }); await sleep(1500);
  st = await ev(() => ({ muted: clipMedia.muted, audio: !WM.$('#clipNsAudio').paused, t: +WM.$('#clipNsAudio').currentTime.toFixed(1), v: +clipMedia.currentTime.toFixed(1) }));
  await ev(() => clipStopPreview()); await sleep(200);
  const st2 = await ev(() => ({ audio: WM.$('#clipNsAudio').paused }));
  ok(st.muted && st.audio && Math.abs(st.t - (st.v - 1)) < 0.4 && st2.audio, `Play both: the new sound plays in step, the video's own sound muted, both stop (${JSON.stringify(st)})`);
  // Join with a new sound
  await tab('join');
  await ev(async () => { CL.in = 0; CL.out = 2; await joinAddSection(); CL.in = 4; CL.out = 6; await joinAddSection(); });
  ok(/sound replaced: High Song 1k/.test(await outLine()), `Join: the new sound is in the output line: "${await outLine()}"`);
  r = await save(); f = r && r.ok && r.files[0];
  ok(f && f.joined === 2 && band(f.path, 0.5, 3, 1000) > band(f.path, 0.5, 3, 440) + 15, `the joined video has the new sound (${f && band(f.path, 0.5, 3, 1000)} dB at 1000 Hz)`);
  await ev(() => { CL.join = joinNew(); clipRender(); clipDraw(); });
  // Clip again brings the new sound back
  await ev(([p, src]) => clipAgain({ path: p, src, srcExists: true, kind: 'mp4clip', in: 1, out: 9 }), [REPL, VID]); await sleep(2500);
  st = await ev(() => ({ file: CL.ns.file && CL.ns.file.split('/').pop(), mode: CL.ns.mode, short: CL.ns.short }));
  ok(st.file === 'High Song 1k.mp3' && st.mode === 'replace' && st.short === 'loop', `Clip again: the new sound comes back (${JSON.stringify(st)})`);
  // right-click → ♫ Change the sound…
  await ev((x) => addPaths([x]), VID); await sleep(1500);
  const entries = await ev(() => { const it = S.items.find(i => i.type === 'file' && /Tone Video/.test(i.path)); return clipMenuEntries({ ...it, hasVideo: true }).filter(Boolean).map(e => e[0]); });
  ok(entries.includes('♫ Change the sound…'), `the playlist's right-click has ♫ Change the sound… (${entries.join(' | ')})`);
  await ev((x) => clipOpen(x, { kind: 'mp3' }), LONG); await sleep(800);
  await ev((x) => clipChangeSound(x, {}), VID); await sleep(1500);
  st = await ev(() => ({ tab: CL.tab, mode: CL.ns.mode, kind: CL.kind, in: CL.in, out: +CL.out.toFixed(1), file: CL.ns.file }));
  ok(st.tab === 'sound' && st.mode === 'replace' && st.kind === 'mp4' && st.in === 0 && st.out === 12 && !st.file, `…which opens CLIP on the whole video with the Sound tab ready: ${JSON.stringify(st)}`);
  await (await cw()).screenshot({ path: `${O}/4-change-sound.png` });

  // readable in all 10 skins
  {
    await ev((s) => nsPick(s), SONG); await sleep(500);
    const lum = (c) => { const p = c.match(/[\d.]+/g).map(Number); const fx = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * fx(p[0]) + 0.7152 * fx(p[1]) + 0.0722 * fx(p[2]); };
    const ratio = (a, b2) => { const x = lum(a), y = lum(b2); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const look = (w, sel) => w.evaluate((sel) => {
      const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const bb = getComputedStyle(e).backgroundColor; if (bb && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(bb)) return bb; } return 'rgb(0, 0, 0)'; };
      return sel.map(s => { const e = document.querySelector(s); if (!e) return { s, miss: true }; return { s, fg: getComputedStyle(e).color, bg: bgOf(e) }; });
    }, sel);
    const bad = [];
    for (const id of await ev(() => WM.skins.list.map(x => x.id))) {
      await ev((id) => WM.skins.apply(id), id); await sleep(500);
      const w = await cw();
      await ev(() => WM.$('#clipTabs [data-t=sound]').click());
      const c = await look(w, ['#clipNsMode button.on', '#clipNsMode button:not(.on)', '.clip-ns .ns-file', '#clipNsMsg', '#clipNsShortLab', '.clip-ns-lane .ns-lab', '#clipPresets button.own']);
      await ev(() => WM.$('#clipTabs [data-t=shape]').click());
      const c2 = await look(w, ['#clipShapeFit button.on', '#clipShapeFit button:not(.on)']);
      for (const x of [...c, ...c2]) { if (x.miss) { bad.push({ id, s: x.s, miss: true }); continue; } const r1 = ratio(x.fg, x.bg); if (r1 < (/Lab|Msg|not\(\.on\)/.test(x.s) ? 3 : 4.5)) bad.push({ id, s: x.s, r: r1.toFixed(2) }); }
      if (id === 'pocket' || id === 'chrome') await w.screenshot({ path: `${O}/skin-${id}-298.png` });
    }
    ok(!bad.length, `the new controls are readable in all 10 skins ${JSON.stringify(bad)}`);
    await ev(() => WM.skins.apply('classic')); await sleep(300);
  }
  ok(errs.length === 0, `no errors in the windows (${errs.slice(0, 3).join(' | ')})`);
  await app.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
