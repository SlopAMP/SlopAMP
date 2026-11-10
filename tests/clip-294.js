// 2.9.4 CLIP editor, part 1: the tabbed layout (Trim / Shape / Sound / Speed / Shots; Captions and Join hidden), the
// output line above Save, Save as MP3 / MP4 / GIF (More formats… hidden), length presets (click / Shift-click / keys 1–7,
// greyed when too long, the last one remembered), Shape (9:16 box: drag, resize, Left, as filmed / upscaled), Sound
// (even out = two-pass loudnorm, volume, fades for MP4 too; sound-only keeps a Fast cut's picture copied), Speed (0.5×–2×,
// pitch kept), GIF (480 / 15 fps / loops, a 1 s test estimate, 15 MB / 5 MB notes, Downloads\SlopAMP\gifs, the Library's
// GIFs chip), tools reset per file, the preset and GIF settings remembered after a restart, readable in all 10 skins,
// and the old paths unchanged (Fast cut copies, MP3 same quality copies, SHOTS).
// Run (Linux, xvfb): SLOPAMP_ELECTRON=… SLOPAMP_APP=… xvfb-run -a node tests/clip-294.js
'use strict';
const { launch, sleep, docWin } = require('./lib');
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const H = path.join(os.tmpdir(), 'slopamp-test-294');
const O = process.env.SLOPAMP_SHOTS || path.join(os.tmpdir(), 'slopamp-294-shots');
fs.mkdirSync(O, { recursive: true });
const MEDIA = path.join(__dirname, 'media');
const FF = process.env.SLOPAMP_FFMPEG || 'ffmpeg', FP = FF.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
const probe = (f) => JSON.parse(execFileSync(FP, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f]).toString());
const lufs = (f) => { const e = require('child_process').spawnSync(FF, ['-hide_banner', '-nostats', '-i', f, '-map', '0:a:0', '-af', 'ebur128', '-f', 'null', '-']).stderr.toString(); const m = /I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold/.exec(e); return m ? +m[1] : NaN; };

(async () => {
  // a 70 s 1280×720 video, quiet sound (-30 dB tone), a keyframe every 2 s
  const SRC = path.join(os.tmpdir(), 'slopamp-294-src'); fs.mkdirSync(SRC, { recursive: true });
  const V = path.join(SRC, 'Night Drive Long.mp4');
  if (!fs.existsSync(V)) execFileSync(FF, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=25:d=70', '-f', 'lavfi', '-i', 'sine=f=330:d=70,volume=-24dB',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '50', '-keyint_min', '50', '-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', V]);
  const A = path.join(MEDIA, 'Test Artist - Tone Song [abcdefghij4].mp3'), SHORT = path.join(MEDIA, 'Night Drive (Official Video) [UyhAC0AZM4Y].mp4');

  let { app, win, errs } = await launch(H);
  let ev = (f, a) => win.evaluate(f, a);
  const allErrs = [];
  const DL = (await app.evaluate(({ app }) => app.getPath('downloads'))) + '/SlopAMP';
  const cw = async () => docWin(app, 'win-clip');
  const q = (sel) => ev((s) => { const e = WM.$(s); return e ? { text: e.textContent.replace(/\s+/g, ' ').trim(), hidden: e.classList.contains('hidden') || e.closest('.hidden') !== null, disabled: !!e.disabled, on: e.classList.contains('on') } : null; }, sel);
  const outLine = () => ev(() => WM.$('#clipFmtInfo').textContent.replace(/\s+/g, ' ').trim());
  const save = async () => { const r = await ev(() => clipSave()); await sleep(200); return r; };
  const btn = (host, attr, v) => ev(({ host, attr, v }) => { const b = [...WM.$(host).children].find(x => x.dataset[attr] === String(v)); b.click(); }, { host, attr, v });

  // ================= 1. the layout (GA, GC)
  await ev((f) => clipOpen(f, { kind: 'mp4' }), V); await sleep(1500);
  const tabsShown = await ev(() => [...WM.$('#clipTabs').children].filter(b => !b.classList.contains('hidden')).map(b => b.dataset.t));
  ok(JSON.stringify(tabsShown) === '["trim","shape","sound","speed","convert","shots"]', `tabs Trim, Shape, Sound, Speed, (2.9.5: Convert,) Shots; Captions and Join hidden ${JSON.stringify(tabsShown)}`);
  const kinds = await ev(() => [...WM.$('#clipKind').children].filter(b => !b.classList.contains('hidden')).map(b => b.textContent));
  ok(JSON.stringify(kinds) === '["MP3","MP4","GIF"]', `Save as: MP3 · MP4 · GIF (More formats… hidden) ${JSON.stringify(kinds)}`);
  ok(/^MP4 · 1280×720 · H\.264 \+ AAC · RE-ENCODE exact cut · ≈ \d/.test(await outLine()), `the output line: what, re-encode, about how big: "${await outLine()}"`);
  const c0 = await cw(); await c0.screenshot({ path: `${O}/1-trim-mp4.png` });

  // ================= 2. length presets (1A–1C)
  await ev(() => { clipSet('in', 10); clipSet('out', 70); });
  await btn('#clipPresets', 'l', 15); await sleep(100);
  let io = await ev(() => [CL.in, CL.out]);
  ok(io[0] === 10 && io[1] === 25, `15: Out = In + 15 (${io})`);
  await ev(() => { const b = [...WM.$('#clipPresets').children].find(x => x.dataset.l === '5'); b.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); }); await sleep(100);
  io = await ev(() => [CL.in, CL.out]);
  ok(io[0] === 20 && io[1] === 25, `Shift-click 5: In = Out − 5 (${io})`);
  const c1 = await cw(); await c1.bringToFront(); await c1.evaluate(() => document.body.focus());
  await c1.keyboard.press('Digit6'); await sleep(150);         // 30 s
  io = await ev(() => [CL.in, CL.out, S.clipPreset]);
  ok(io[0] === 20 && io[1] === 50 && io[2] === 30, `key 6 while CLIP is active: Out = In + 30; remembered as the last one (${io})`);
  await c1.keyboard.press('Shift+Digit1'); await sleep(150);   // In = Out − 5
  io = await ev(() => [CL.in, CL.out]);
  ok(io[0] === 45 && io[1] === 50, `Shift+1: In = Out − 5 (${io})`);
  let pr = await ev(() => [...WM.$('#clipPresets').children].map(b => `${b.dataset.l}${b.classList.contains('on') ? '*' : ''}${b.classList.contains('last') ? '_' : ''}${b.disabled ? 'x' : ''}`).join(' '));
  ok(pr === '5*_ 10 15 20 25 30 60', `the length that fits is lit, the last used underlined (amber) ${pr}`);
  await ev(() => { clipSet('in', 10); clipSet('out', 25); });
  await btn('#clipPresets', 'l', 60); await sleep(100);
  io = await ev(() => [CL.in, CL.out]);
  ok(io[0] === 10 && io[1] === 70, `60 from 0:10 stops at the end of the 70 s file (${io})`);
  await ev((f) => clipOpen(f, { kind: 'mp4' }), SHORT); await sleep(1200);
  pr = await ev(() => [...WM.$('#clipPresets').children].map(b => `${b.dataset.l}${b.disabled ? 'x' : ''}`).join(' '));
  ok(pr === '5 10x 15x 20x 25x 30x 60x', `a 6 s file: presets longer than it are greyed ${pr}`);

  // ================= 3. Fast cut and the output line (GB)
  await ev((f) => clipOpen(f, { kind: 'mp4' }), V); await sleep(1500);
  await ev(() => { clipSet('in', 11); clipSet('out', 21); WM.$('#clipCutFast').click(); });
  ok(/FAST CUT no re-encode/.test(await outLine()), `Fast cut: "${await outLine()}"`);
  await ev(() => { WM.$('#clipTabs [data-t=sound]').click(); }); await sleep(100);
  await ev(() => { WM.$('#clipVolUp').click(); WM.$('#clipVolUp').click(); WM.$('#clipVolUp').click(); });
  ok(/picture copied, sound re-encoded \(AAC 192k: \+3 dB\) · FAST CUT OK/.test(await outLine()) && !(await q('#clipCutFast')).disabled, `Sound only: the picture is still copied, Fast cut OK: "${await outLine()}"`);
  await ev(() => WM.$('#clipEven').click()); await sleep(2500);
  const li = (await q('#clipLoudInfo')).text;
  ok(/this clip: −\d+ LUFS \(quiet\) → −14 LUFS/.test(li), `Even out measures the clip first: "${li}"`);
  await ev(() => { WM.$('#clipFadeIn').click(); WM.$('#clipFadeOut').click(); });
  const tabDots = await ev(() => [...WM.$('#clipTabs').children].filter(b => b.querySelector('.dot')).map(b => b.dataset.t));
  ok(JSON.stringify(tabDots) === '["sound"]', `a dot marks the tab in use ${JSON.stringify(tabDots)}`);
  const c3 = await cw(); await c3.screenshot({ path: `${O}/3-sound.png` });
  let r = await save();
  ok(r && r.ok && r.files[0].path === `${DL}/mp4clips/Night Drive Long (0m11s-0m21s).mp4`, `saved: ${JSON.stringify(r && r.files)}`);
  if (r && r.ok) {
    const f = r.files[0].path, p = probe(f), raw = fs.readFileSync(f);
    const vs = p.streams.find(s => s.codec_type === 'video');
    // the picture is the source's own H.264 packets from the keyframe at 0:10 (the same bytes a plain copy gives)
    const md5 = (args) => require('crypto').createHash('md5').update(execFileSync(FF, ['-hide_banner', '-v', 'error', ...args, '-map', '0:v:0', '-c', 'copy', '-f', 'h264', '-'], { maxBuffer: 1 << 30 })).digest('hex');
    const same = md5(['-i', f]) === md5(['-ss', '10.001', '-i', V, '-t', '11']);
    ok(same && Math.abs(+vs.duration - 11) < 0.15, `Fast cut + sound: the picture is copied as it is, from the keyframe at 0:10 (${(+vs.duration).toFixed(2)} s, same packets: ${same})`);
    const L = lufs(f);
    ok(Math.abs(L - (-11)) < 1.5, `evened out to −14 LUFS, then +3 dB: ${L} LUFS (the source is about −33)`);
  }

  // ================= 4. Shape (2A–2C)
  await ev(() => { WM.$('#clipTabs [data-t=shape]').click(); }); await sleep(100);
  await btn('#clipRatio', 'r', '9:16'); await sleep(300);
  let sh = await ev(() => ({ ...CL.shape }));
  ok(sh.w === 406 && sh.h === 720 && sh.x === 438 && sh.y === 0 && !sh.up, `9:16 from 720p: a 406×720 box in the middle ${JSON.stringify(sh)}`);
  const b1080 = await ev(() => { const i = CL.info; CL.info = { ...i, width: 1920, height: 1080 }; const b = clipShapeBox('9:16', 'c'); CL.info = i; return b; });
  ok(b1080.w === 608 && b1080.h === 1080, `9:16 from 1080p keeps the filmed pixels: 608×1080 ${JSON.stringify(b1080)}`);
  ok((await q('#clipCutFast')).disabled && /RE-ENCODE \(Fast cut is off: Shape and Speed change the picture\)/.test(await outLine()) && !(await q('#clipShapeWarn')).hidden, `Shape switches Fast cut off, with a note: "${await outLine()}"`);
  const ccs = await ev(() => { const b = WM.$('#clipCropBox'), cs = getComputedStyle(b); return { border: cs.borderTopColor, outline: cs.outlineColor, lab: getComputedStyle(WM.$('#clipCropLab')).backgroundColor, vis: !WM.$('#clipCrop').classList.contains('hidden') }; });
  ok(ccs.vis && ccs.border === 'rgb(255, 255, 255)' && ccs.outline === 'rgb(0, 0, 0)' && ccs.lab === 'rgb(255, 255, 255)', `the box is drawn in fixed white / black ${JSON.stringify(ccs)}`);
  // drag it left by 60 px, then a corner in by 40 px (it keeps 9:16)
  const c4 = await cw();
  const bb = await c4.evaluate(() => { const r = document.querySelector('#clipCropBox').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await c4.mouse.move(bb.x + bb.w / 2, bb.y + bb.h / 2); await c4.mouse.down(); await c4.mouse.move(bb.x + bb.w / 2 - 30, bb.y + bb.h / 2, { steps: 4 }); await c4.mouse.move(bb.x + bb.w / 2 - 60, bb.y + bb.h / 2, { steps: 4 }); await c4.mouse.up(); await sleep(200);
  const sh2 = await ev(() => ({ ...CL.shape }));
  ok(sh2.x < sh.x - 100 && sh2.w === 406 && sh2.y === 0, `drag moves the box (${sh.x} → ${sh2.x})`);
  const bb2 = await c4.evaluate(() => { const r = document.querySelector('#clipCropBox [data-h=se]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await c4.mouse.move(bb2.x, bb2.y); await c4.mouse.down(); await c4.mouse.move(bb2.x - 20, bb2.y - 40, { steps: 5 }); await c4.mouse.up(); await sleep(200);
  const sh3 = await ev(() => ({ ...CL.shape }));
  ok(sh3.w < 406 && Math.abs(sh3.w / sh3.h - 9 / 16) < 0.02 && sh3.x === sh2.x && sh3.y === 0 && sh3.w % 2 === 0 && sh3.h % 2 === 0, `a corner makes it smaller and keeps 9:16, even sizes ${JSON.stringify(sh3)}`);
  await btn('#clipBoxPos', 'p', 'l'); await sleep(100);
  ok(await ev(() => CL.shape.x === 0), 'Left puts the box at the left edge');
  await c4.screenshot({ path: `${O}/4-shape.png` });
  await btn('#clipRatio', 'r', '9:16'); await btn('#clipRatio', 'r', 'orig'); await sleep(100);
  ok(!(await q('#clipCutFast')).disabled && await ev(() => WM.$('#clipCutFast').checked), 'back to Original: Fast cut is on again (your choice comes back)');
  await btn('#clipRatio', 'r', '9:16'); await sleep(100);
  await ev(() => { CL.vol = 0; CL.even = false; WM.$('#clipFadeIn').checked = false; WM.$('#clipFadeOut').checked = false; clipSet('out', 33); clipSet('in', 30); clipRender(); });
  ok(/^406×720 \(sharp, as filmed\)$/.test(await ev(() => WM.$('#clipShapeOut').children[0].textContent)) && /^1080×1920 \(upscaled\)$/.test(await ev(() => WM.$('#clipShapeOut').children[1].textContent)), 'Output: 406×720 as filmed (the default) or 1080×1920 upscaled');
  r = await save();
  let vs = r && r.ok && probe(r.files[0].path).streams.find(s => s.codec_type === 'video');
  ok(vs && vs.width === 406 && vs.height === 720 && Math.abs(+vs.duration - 3) < 0.1, `saved 9:16 as filmed: ${vs && `${vs.width}×${vs.height}, ${vs.duration} s`}`);
  await btn('#clipShapeOut', 'u', 1); await sleep(100);
  ok(/1080×1920 \(9:16, upscaled\)/.test(await outLine()), `output line: "${await outLine()}"`);
  r = await save();
  vs = r && r.ok && probe(r.files[0].path).streams.find(s => s.codec_type === 'video');
  ok(vs && vs.width === 1080 && vs.height === 1920, `saved upscaled: ${vs && `${vs.width}×${vs.height}`}`);

  // ================= 5. Speed (4A–4B)
  await ev(() => { WM.$('#clipTabs [data-t=speed]').click(); clipSet('in', 30); clipSet('out', 40); }); await sleep(100);
  await btn('#clipRatio', 'r', 'orig');
  await btn('#clipSpeed', 's', 2); await sleep(200);
  const sp = await ev(() => ({ lcd: WM.$('#clipSpeedLcd').textContent, len: WM.$('#clipLen').textContent, btn: WM.$('#clipSave').textContent, rate: clipMedia.playbackRate, badge: WM.$('#clipSpeedBadge').textContent, name: WM.$('#clipName').value }));
  ok(sp.lcd === '0:10.0 → 0:05.0' && /0:05\.0/.test(sp.btn) && /LENGTH 0:10\.0 ▸ 0:05\.0/.test(sp.len) && sp.rate === 2 && sp.badge === '2×' && / 2x$/.test(sp.name), `2×: LCD, Save button and name show the new length; the preview plays at 2× ${JSON.stringify(sp)}`);
  const c5 = await cw(); await c5.screenshot({ path: `${O}/5-speed.png` });
  r = await save();
  if (r && r.ok) { const p = probe(r.files[0].path); ok(Math.abs(+p.format.duration - 5) < 0.15 && p.streams.some(s => s.codec_type === 'audio'), `saved at 2×: ${p.format.duration} s with sound`); } else ok(false, 'speed save ' + JSON.stringify(r));
  await btn('#clipSpeed', 's', 0.5); await sleep(100);
  r = await save();
  if (r && r.ok) { const p = probe(r.files[0].path), v2 = p.streams.find(s => s.codec_type === 'video'); ok(Math.abs(+p.format.duration - 20) < 0.2 && v2.r_frame_rate === '25/1', `saved at 0.5×: ${p.format.duration} s, still 25 fps (frames shown twice)`); } else ok(false, 'speed 0.5 save');
  await btn('#clipSpeed', 's', 1);

  // ================= 6. MP3 (unchanged copy path; Sound / Speed turn "same quality" off)
  await ev((f) => clipOpen(f), A); await sleep(1200);
  ok(await ev(() => CL.kind === 'mp3' && CL.tab === 'trim' && CL.vol === 0 && !CL.even && CL.speed === 1 && !CL.shape), 'a new file: the tools start fresh (GE)');
  ok((await q('#clipTabs [data-t=shape]')).disabled && /^MP3 · .* · same quality as the file · NO RE-ENCODE · ≈/.test(await outLine()), `MP3: Shape greyed; "${await outLine()}"`);
  await ev(() => { clipSet('in', 5); clipSet('out', 20); });
  r = await save();
  if (r && r.ok) { const p = probe(r.files[0].path); ok(p.streams[0].codec_name === 'mp3' && Math.abs(+p.format.duration - 15) < 0.2, `MP3 same quality still copies (${p.format.duration} s)`); }
  await ev(() => { WM.$('#clipTabs [data-t=speed]').click(); }); await btn('#clipSpeed', 's', 1.5); await sleep(100);
  ok(await ev(() => WM.$('#clipQCopy').disabled && WM.$('#clipQ320').checked) && /320 kbps · 1\.5× · RE-ENCODE/.test(await outLine()), `Speed turns "Same quality" off: "${await outLine()}"`);
  r = await save();
  if (r && r.ok) { const p = probe(r.files[0].path); ok(Math.abs(+p.format.duration - 10) < 0.2, `MP3 at 1.5×: ${p.format.duration} s`); }
  await btn('#clipSpeed', 's', 1); await sleep(100);
  ok(await ev(() => !WM.$('#clipQCopy').disabled && WM.$('#clipQCopy').checked), '1×: "Same quality" comes back');

  // ================= 7. GIF (5A–5D)
  await ev((f) => clipOpen(f, { kind: 'mp4' }), V); await sleep(1500);
  await ev(() => { WM.$('#clipKind [data-k=gif]').click(); clipSet('in', 20); clipSet('out', 24); });
  for (let k = 0; k < 60 && !(await ev(() => CL.gifEst && CL.gifEst.key === clipGifKey())); k++) await sleep(250);
  const g = await ev(() => ({ sound: WM.$('#clipTabs [data-t=sound]').disabled, shape: WM.$('#clipTabs [data-t=shape]').disabled, speed: WM.$('#clipTabs [data-t=speed]').disabled, est: WM.$('#clipGifEst').textContent, ext: WM.$('#clipExt').textContent, btn: WM.$('#clipSave').textContent, add: WM.$('#clipAddRow').classList.contains('hidden'), set: clipGifSet() }));
  ok(g.sound && !g.shape && !g.speed && /^≈ [\d.]+ (MB|KB)$/.test(g.est) && g.ext === '.gif' && /Save GIF 0:04\.0/.test(g.btn) && g.add && JSON.stringify(g.set) === '{"w":480,"fps":15,"loop":true,"colors":256}', `GIF: Sound greyed, Shape / Speed work, 480 · 15 fps · loops · 256, an estimate ${JSON.stringify(g)}`);
  ok(/^GIF · 480×270 · 15 fps · 0:04\.0 · loops · RE-ENCODE \(always\) · ≈ [\d.]+ (MB|KB)$/.test(await outLine()), `"${await outLine()}"`);
  const est1 = await ev(() => CL.gifEst && CL.gifEst.bytes);
  const c7 = await cw(); await c7.screenshot({ path: `${O}/7-gif.png` });
  r = await save();
  if (r && r.ok) {
    const f = r.files[0].path, p = probe(f), raw = fs.readFileSync(f);
    ok(f === `${DL}/gifs/Night Drive Long (0m20s-0m24s).gif` && p.streams[0].width === 480 && p.streams[0].height === 270 && raw.includes('NETSCAPE2.0') && p.streams[0].r_frame_rate === '15/1', `saved in Downloads\\SlopAMP\\gifs: 480×270, 15 fps, loops (${f.split('/').pop()})`);
    const real = fs.statSync(f).size;
    ok(est1 > real / 2 && est1 < real * 2, `the 1 s test estimate is close: ≈ ${(est1 / 1048576).toFixed(2)} MB, saved ${(real / 1048576).toFixed(2)} MB`);
  } else ok(false, 'gif save ' + JSON.stringify(r));
  await btn('#clipGifW', 'v', 320); await btn('#clipGifFps', 'v', 10); await sleep(100);
  ok(await ev(() => JSON.stringify(S.clipGif)) === '{"w":320,"fps":10,"loop":true,"colors":256}', 'GIF settings remembered (S.clipGif)');
  await ev(() => { CL.gifEst = { key: clipGifKey(), bytes: 20 * 1048576 }; clipRenderGif(); clipXBar(); });
  // 2.9.5: the GIF warnings moved to the For X bar (tests/clip-295.js has the details)
  ok(/over the 15 MB X takes for a GIF \(phones take 5 MB\)/.test((await q('#clipXBarT')).text), `past 15 MB: a warning (${(await q('#clipXBarT')).text})`);
  await ev(() => { CL.gifEst = { key: clipGifKey(), bytes: 7 * 1048576 }; clipRenderGif(); clipXBar(); });
  ok(/over the 5 MB its phone apps take/.test((await q('#clipXBarT')).text), 'past 5 MB: the phone note');
  await ev(() => { CL.gifEst = null; clipRender(); });

  // ================= 8. SHOTS still work (in their tab)
  await ev(() => { WM.$('#clipKind [data-k=mp4]').click(); WM.$('#clipTabs [data-t=shots]').click(); clipMedia.currentTime = 12; }); await sleep(500);
  await ev(() => clipShotAdd()); await sleep(800);
  ok(await ev(() => CL.shots && CL.shots.shots.length === 1 && !WM.$('#clipShotBody').classList.contains('hidden')), 'SHOTS: + Shot works in the Shots tab');

  // ================= 9. Library: the GIFs chip
  await ev(() => openDownloadsManager('clips')); await sleep(1500);
  const lib = await ev(() => ({ chips: [...WM.$('#clsub').children].map(b => b.textContent), kinds: DLM.rows.filter(isClipRow).map(r => r.kind) }));
  ok(lib.chips.includes('GIFs (1)') && lib.kinds.filter(k => k === 'gifclip').length === 1, `Library → CLIPS has a GIFs chip ${JSON.stringify(lib.chips)}`);
  await ev(() => { [...WM.$('#clsub').children].find(b => b.dataset.c === 'gifclip').click(); }); await sleep(500);
  const gl = await ev(() => ({ vis: dlmVisible().map(r => r.kind), add: (() => { DLM.sel = new Set(dlmVisible().map(dlmKey)); clipLibButtons(); return WM.$('#clAdd').disabled; })(), again: WM.$('#clAgain').disabled }));
  ok(JSON.stringify(gl.vis) === '["gifclip"]' && gl.add && !gl.again, `GIFs shows only GIFs; Add to playlist is off for a GIF, Clip again works ${JSON.stringify(gl)}`);
  const dw = await docWin(app, 'host-dialog'); if (dw) await dw.screenshot({ path: `${O}/9-library-gifs.png` });
  await ev(() => WM.$('#dlmDlg').close()); await sleep(300);

  // ================= 10. readable in all 10 skins (GD: the picture overlays are white / black in every skin)
  await ev((f) => clipOpen(f, { kind: 'mp4' }), V); await sleep(1200);
  await ev(() => { WM.$('#clipTabs [data-t=shape]').click(); }); await btn('#clipRatio', 'r', '9:16'); await sleep(200);
  const lum = (c) => { const p = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bad = [];
  for (const id of await ev(() => WM.skins.list.map(s => s.id))) {
    await ev((id) => WM.skins.apply(id), id); await sleep(800);
    const cwin = await cw();
    const c = await cwin.evaluate(() => {
      const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor; if (b && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(b)) return b; } return 'rgb(0, 0, 0)'; };
      const sel = ['.clip-tabs button.on', '.clip-tabs button:not(.on):not(:disabled):not(.hidden)', '.clip-seg button.on', '.clip-seg button:not(.on):not(:disabled)', '.clip-out .k', '.clip-out', '.clip-out .re', '.clip-lab', '#clipShapeNote', '#clipShapeWarn', '.cc-lab', '#clipLen'];
      return sel.map(s => { const e = document.querySelector(s); if (!e) return { s, miss: true }; const cs = getComputedStyle(e); return { s, fg: cs.color, bg: bgOf(e), op: cs.opacity }; });
    });
    for (const x of c) { if (x.miss) { bad.push({ id, s: x.s, miss: true }); continue; } const r1 = ratio(x.fg, x.bg); if (r1 < (x.s === '.clip-out' || x.s === '#clipShapeNote' ? 3 : 4.5)) bad.push({ id, s: x.s, r: r1.toFixed(2) }); }
    await cwin.screenshot({ path: `${O}/skin-${id}.png` });
  }
  ok(!bad.length, `CLIP's tabs, chips, labels and output line are readable in all 10 skins ${JSON.stringify(bad)}`);
  await ev(() => WM.skins.apply('classic')); await sleep(300);

  // ================= 11. remembered after a restart: the preset and the GIF settings (not the tools)
  await ev(() => saveNow()); await sleep(600);
  allErrs.push(...errs); await app.close();
  ({ app, win, errs } = await launch(H, { keep: true })); ev = (f, a) => win.evaluate(f, a);
  await ev((f) => clipOpen(f, { kind: 'mp4' }), V); await sleep(1200);
  const rem = await ev(() => ({ p: S.clipPreset, g: clipGifSet(), last: [...WM.$('#clipPresets').children].filter(b => b.classList.contains('last')).map(b => b.dataset.l), shape: CL.shape, speed: CL.speed }));
  ok(rem.p === 60 && JSON.stringify(rem.g) === '{"w":320,"fps":10,"loop":true,"colors":256}' && JSON.stringify(rem.last) === '["60"]' && !rem.shape && rem.speed === 1, `after a restart: the last preset (60) and the GIF settings are back; the tools are not ${JSON.stringify(rem)}`);
  // Clip again of the 2× clip brings the speed back
  await ev(() => openDownloadsManager('clips')); await sleep(1500);
  const sp2 = await ev(() => { const r = DLM.rows.find(x => x.kind === 'mp4clip' && x.speed === 2); if (!r) return null; clipAgain(r); return true; }); await sleep(1500);
  ok(sp2 && await ev(() => CL.speed === 2 && CL.in === 30 && CL.out === 40), 'Clip again on the 2× clip: same In / Out, and 2× again');

  // ================= 12. a CLIP window saved small before 2.9.4 grows once to the new size (860 × 770); later sizes stay
  const SF = path.join(H, '.config/SlopAMP/slopamp-state.json');
  const clipBounds = () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(x => /w=clip/.test(x.webContents.getURL())); return w ? w.getBounds() : null; });
  const relaunch = async (patch) => {
    await ev(() => saveNow()); await sleep(600); allErrs.push(...errs); await app.close();
    const st = JSON.parse(fs.readFileSync(SF, 'utf8')); patch(st.layout); fs.writeFileSync(SF, JSON.stringify(st));
    ({ app, win, errs } = await launch(H, { keep: true })); ev = (f, a) => win.evaluate(f, a);
    await ev(() => clipShow(true)); await sleep(800);
    return clipBounds();
  };
  let cb = await relaunch((l) => { Object.assign(l.windows.clip, { x: 100, y: 100, w: 780, h: 640 }); delete l.clip294; });
  ok(cb && cb.width === 860 && cb.height === 770, `an old 780 × 640 CLIP window opens at 860 × 770 once ${JSON.stringify(cb)}`);
  cb = await relaunch((l) => { Object.assign(l.windows.clip, { x: 100, y: 100, w: 700, h: 600 }); });
  ok(cb && cb.width === 700 && cb.height === 600, `a size set after that stays ${JSON.stringify(cb)}`);

  allErrs.push(...errs);
  ok(!allErrs.length, 'no errors in the windows ' + JSON.stringify(allErrs.slice(0, 5)));
  await app.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
