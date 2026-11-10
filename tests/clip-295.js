// 2.9.5 CLIP part 2: the Convert tab (the whole file, no trimming → Downloads\SlopAMP\Converted; For X / Small / Phone /
// Best, size, frame rate, quality, MP3 bitrate, fit under a size, the same output line), the X account (asked once the
// first time For X is used, remembered after a restart, changed in Settings), the For X bar (the exact overage, Trim to
// fit, Lower the quality to fit, Premium's Android note, GIF 15 / 5 MB with their fixes; never blocks saving), and the
// Library's quick filters (All / Video / Audio / GIFs / Clips / Converted, counts, kept, fast on a big library).
// Run (Linux, xvfb): SLOPAMP_ELECTRON=… SLOPAMP_APP=… xvfb-run -a node tests/clip-295.js
'use strict';
const { launch, sleep, docWin } = require('./lib');
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const H = path.join(os.tmpdir(), 'slopamp-test-295');
const O = process.env.SLOPAMP_SHOTS || path.join(os.tmpdir(), 'slopamp-295-shots');
fs.mkdirSync(O, { recursive: true });
const FF = process.env.SLOPAMP_FFMPEG || 'ffmpeg', FP = FF.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
const probe = (f) => JSON.parse(execFileSync(FP, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f]).toString());
const vOf = (f) => probe(f).streams.find(s => s.codec_type === 'video');

(async () => {
  const SRC = path.join(os.tmpdir(), 'slopamp-295-src'); fs.mkdirSync(SRC, { recursive: true });
  const mk = (name, args) => { const f = path.join(SRC, name); if (!fs.existsSync(f)) execFileSync(FF, ['-hide_banner', '-v', 'error', '-y', ...args, f]); return f; };
  const BIG = mk('Big Sky 1440p60.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=2560x1440:r=60:d=8', '-f', 'lavfi', '-i', 'sine=f=330:d=8', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
  const LONG = mk('Long Talk 2m30.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=150', '-f', 'lavfi', '-i', 'sine=f=330:d=150', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '50', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
  const VLONG = mk('Very Long 12m.mp4', ['-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=10:d=720', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '720', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '32k']);
  const HQ = mk('Detail 720p 30s.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=30', '-f', 'lavfi', '-i', 'sine=f=330:d=30', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
  const A = path.join(__dirname, 'media', 'Test Artist - Tone Song [abcdefghij4].mp3');

  let { app, win, errs } = await launch(H);
  let ev = (f, a) => win.evaluate(f, a);
  const allErrs = [];
  const DL = (await app.evaluate(({ app }) => app.getPath('downloads'))) + '/SlopAMP';
  const cw = async () => docWin(app, 'win-clip');
  const dw = async () => docWin(app, 'host-dialog');
  const q = (sel) => ev((s) => { const e = WM.$(s); return e ? { text: e.textContent.replace(/\s+/g, ' ').trim(), hidden: e.classList.contains('hidden') || !!e.closest('.hidden'), disabled: !!e.disabled, on: e.classList.contains('on') } : null; }, sel);
  const outLine = () => ev(() => WM.$('#clipFmtInfo').textContent.replace(/\s+/g, ' ').trim());
  const bar = () => ev(() => ({ shown: !WM.$('#clipXBar').classList.contains('hidden'), text: WM.$('#clipXBarT').textContent.replace(/\s+/g, ' ').trim(), btns: [...WM.$('#clipXBarB').children].map(b => b.textContent) }));
  const clickBar = (label) => ev((l) => { const b = [...WM.$('#clipXBarB').children].find(x => x.textContent.startsWith(l)); if (b) b.click(); return !!b; }, label);
  const btn = (host, attr, v) => ev(({ host, attr, v }) => { const b = [...WM.$(host).children].find(x => x.dataset[attr] === String(v)); b.click(); }, { host, attr, v });
  const save = async () => ev(() => { CL.nameTouched = false; return clipSave(); });
  // the "Which X account?" box (choiceBox in the dialog window): click its button
  const answer = async (which) => {
    for (let k = 0; k < 20 && !(await ev(() => WM.$('#confirmDlg').open)); k++) await sleep(150);
    const title = await ev(() => WM.$('#confirmDlg').open ? WM.$('#confirmTitle').textContent : '');
    const d = await dw(); await d.evaluate((w) => document.getElementById(w === 'premium' ? 'confirmAlt' : w === 'cancel' ? 'confirmCancel' : 'confirmOk').click(), which).catch(async () => { await ev(() => WM.$('#confirmDlg').close('cancel')); });
    await sleep(400);
    return title;
  };

  // ================= 1. Convert: the tab, the whole file, presets
  await ev((f) => clipOpen(f, { kind: 'mp4' }), BIG); await sleep(1500);
  ok(await ev(() => !CL.whole && S.xAccount === null), 'a new file starts as a clip (not converting); no X account yet');
  await ev(() => { clipSet('out', 5); clipSet('in', 2); WM.$('#clipTabs [data-t=convert]').click(); }); await sleep(100);
  ok(await ev(() => !CL.whole), 'opening the Convert tab doesn’t switch anything on by itself');
  await btn('#clipCvPreset', 'p', 'phone'); await sleep(200);
  let st = await ev(() => ({ whole: CL.whole, btn: WM.$('#clipSave').textContent, name: WM.$('#clipName').value, len: WM.$('#clipLen').textContent, dot: !!WM.$('#clipTabs [data-t=convert] .dot'), asked: WM.$('#confirmDlg').open }));
  ok(st.whole && /Convert 0:08\.0/.test(st.btn) && st.name === 'Big Sky 1440p60 (phone)' && /LENGTH 0:08\.0/.test(st.len) && st.dot && !st.asked, `a preset converts the whole file: ${JSON.stringify(st)}`);
  ok(/^CONVERT whole file · MP4 · 1920×1080 · phone · H\.264 \+ AAC · RE-ENCODE · length 0:08\.0 · ≈ [\d.]+ MB/.test(await outLine()), `the same output line: "${await outLine()}"`);
  const c1 = await cw(); await c1.screenshot({ path: `${O}/1-convert-phone.png` });
  let r = await save();
  let f = r && r.ok && r.files[0];
  ok(f && f.path === `${DL}/Converted/Big Sky 1440p60 (phone).mp4` && f.converted, `saved in Downloads\\SlopAMP\\Converted: ${f && f.path}`);
  if (f) { const v = vOf(f.path), d = +probe(f.path).format.duration; ok(v.width === 1920 && v.height === 1080 && v.r_frame_rate === '30/1' && Math.abs(d - 8) < 0.2, `Phone-friendly: 1080p, 30 fps, the whole 8 s (${v.width}×${v.height} ${v.r_frame_rate} ${d})`); }
  ok(fs.existsSync(BIG) && fs.statSync(BIG).size > 0, 'the original is still there, unchanged');
  await btn('#clipCvPreset', 'p', 'small'); await sleep(100);
  r = await save(); f = r && r.ok && r.files[0];
  if (f) { const v = vOf(f.path); ok(v.width === 1280 && v.height === 720 && f.path.endsWith('(small).mp4'), `Small: 720p (${v.width}×${v.height})`); } else ok(false, 'small');
  await btn('#clipCvSize', 'v', '480'); await sleep(100);
  ok(await ev(() => CL.cv.preset === 'custom' && WM.$('#clipName').value === 'Big Sky 1440p60 (converted)'), 'changing a setting makes it Custom ("(converted)")');
  // MP3 from a video, 128 kb/s
  await ev(() => WM.$('#clipKind [data-k=mp3]').click()); await btn('#clipCvMp3k', 'v', 128); await sleep(100);
  ok(/^CONVERT whole file · MP3 · 0:08\.0 · 128 kbps · RE-ENCODE/.test(await outLine()), `MP3: "${await outLine()}"`);
  r = await save(); f = r && r.ok && r.files[0];
  ok(f && f.path.endsWith('/Converted/Big Sky 1440p60 (converted).mp3') && Math.abs(+probe(f.path).format.bit_rate - 128000) < 4000, `MP3 at 128 kb/s in Converted (${f && f.path.split('/').pop()})`);
  // dragging In / Out means clipping again
  await ev(() => { WM.$('#clipKind [data-k=mp4]').click(); clipSet('in', 3); });
  ok(await ev(() => !CL.whole && /Save clip/.test(WM.$('#clipSave').textContent)), 'setting In switches back to a clip');

  // ================= 2. For X: asked once, remembered
  await ev(() => WM.$('#clipTabs [data-t=convert]').click());
  const pTitle = ev(() => 0); void pTitle;
  await ev(() => { [...WM.$('#clipCvPreset').children].find(b => b.dataset.p === 'forx').click(); });
  const t1 = await answer('free');
  ok(t1 === 'Which X account do you post with?' && await ev(() => S.xAccount === 'free'), `For X the first time asks which X account (Free picked): "${t1}"`);
  const c2 = await cw(); await c2.screenshot({ path: `${O}/2-convert-forx.png` });
  await btn('#clipCvPreset', 'p', 'phone'); await btn('#clipCvPreset', 'p', 'forx'); await sleep(400);
  ok(!(await ev(() => WM.$('#confirmDlg').open)), 'the second time it doesn’t ask');
  ok(/Free · up to 2:20 and 512 MB/.test((await q('#clipXAcct')).text), `the account shows in Convert: "${(await q('#clipXAcct')).text}"`);
  r = await save(); f = r && r.ok && r.files[0];
  if (f) { const v = vOf(f.path); ok(v.width === 1920 && v.height === 1080 && v.r_frame_rate === '60/1' && v.codec_name === 'h264' && f.path.endsWith('(For X).mp4'), `For X: H.264 1920×1080 60 fps from 1440p60 (${v.width}×${v.height} ${v.r_frame_rate})`); } else ok(false, 'forx save ' + JSON.stringify(r));
  ok(await ev(() => WM.$('#setXAcct').value === 'free'), 'Settings → YouTube & X shows Free');

  // ================= 3. the For X bar (Free): a 2:30 video
  await ev((f) => clipOpen(f, { kind: 'mp4' }), LONG); await sleep(1500);
  ok(await ev(() => CL.cv.preset === 'forx'), 'Convert remembers the preset used last (For X)');
  await ev(() => WM.$('#clipTabs [data-t=convert]').click()); await btn('#clipCvPreset', 'p', 'forx'); await sleep(300);
  let b = await bar();
  ok(b.shown && /^2:30 is 0:10 over the 2:20 X allows on Free\. \(X account: Free\)$/.test(b.text) && b.btns.includes('Trim to 2:20'), `the bar: exact overage + a fix ${JSON.stringify(b)}`);
  ok(!(await q('#clipSave')).disabled, 'saving is never blocked');
  const c3 = await cw(); await c3.screenshot({ path: `${O}/3-xbar-free.png` });
  await clickBar('Trim to 2:20'); await sleep(200);
  st = await ev(() => ({ whole: CL.whole, a: CL.in, b: CL.out, tab: CL.tab }));
  ok(!st.whole && st.a === 0 && Math.abs(st.b - 139.95) < 0.01 && st.tab === 'trim' && !(await bar()).shown, `Trim to 2:20: a clip 0:00 → 2:19.95, the bar is gone ${JSON.stringify(st)}`);
  // a clip that's too long, sped up, still fits
  await ev(() => { clipSet('out', 150); clipSet('in', 0); WM.$('#clipTabs [data-t=speed]').click(); }); await btn('#clipSpeed', 's', 1.5); await sleep(100);
  ok(!(await bar()).shown, '2:30 at 1.5× is 1:40: it fits, no bar');
  await btn('#clipSpeed', 's', 1);
  ok((await bar()).shown, 'the bar shows for an MP4 clip that’s too long too (as 2.9.4’s 2:20 note did)');
  // too big: Lower the quality to fit
  await ev(() => { CL.info.size = 4e9; WM.$('#clipCutFast').click(); clipRender(); }); await sleep(100);
  b = await bar();
  ok(/About [\d.]+ GB is [\d.]+ GB over the 512 MB X allows on Free/.test(b.text) && b.btns.includes('Lower the quality to fit'), `too big: "${b.text}" ${JSON.stringify(b.btns)}`);
  await clickBar('Lower the quality to fit'); await sleep(100);
  st = await ev(() => ({ fit: CL.fitSel, cut: clipCutEff(), fast: WM.$('#clipCutFast').disabled }));
  ok(st.fit === 'x' && st.cut === 'exact' && st.fast && /RE-ENCODE \(Fast cut is off: fitting under a size re-encodes\) · fit under 512 MB \(X\) · ≈/.test(await outLine()) && !/over the 512 MB/.test((await bar()).text), `it now re-encodes aiming under 512 MB (Fast cut off), the size note is gone: "${await outLine()}" ${JSON.stringify(st)}`);
  await ev(() => { CL.info.size = 1e6; CL.fitSel = 'off'; clipRender(); });

  // ================= 4. Premium: changed in Settings, the Android note
  await ev(() => { const s = WM.$('#setXAcct'); s.value = 'premium'; s.dispatchEvent(new Event('change')); }); await sleep(100);
  ok(await ev(() => S.xAccount === 'premium') && !(await bar()).shown, 'Settings → Premium: 2:30 fits, no bar');
  await ev((f) => clipOpen(f, { kind: 'mp4' }), VLONG); await sleep(1500);
  b = await bar();
  ok(b.shown && /^12:00 is 2:00 over the 10:00 X's Android app takes \(fine on the web and iPhone\)\. \(X account: Premium\)$/.test(b.text) && b.btns.includes('Trim to 10:00'), `Premium, 12 min: the Android app note "${b.text}"`);
  const c4 = await cw(); await c4.screenshot({ path: `${O}/4-xbar-premium.png` });
  await clickBar('Change account'); const t2 = await answer('free');
  ok(t2 === 'Which X account do you post with?' && await ev(() => S.xAccount === 'free') && /^12:00 is 9:40 over the 2:20 X allows on Free/.test((await bar()).text), `Change account on the bar → Free: "${(await bar()).text}"`);

  // ================= 5. fit under a size really lands under it (OpenH264 at a bitrate; smaller picture if it must)
  await ev((f) => clipOpen(f, { kind: 'mp4' }), HQ); await sleep(1500);
  await ev(() => WM.$('#clipTabs [data-t=convert]').click()); await btn('#clipCvPreset', 'p', 'best'); await btn('#clipFitSel', 'v', 10); await sleep(200);
  ok(/fit under 10 MB · ≈ 9\.7 MB/.test(await outLine()), `Best quality + Fit under 10 MB: "${await outLine()}"`);
  r = await save(); f = r && r.ok && r.files[0];
  ok(f && f.fit === 10485760 && f.size <= 10485760 && f.fits, `the converted file is ${f && (f.size / 1048576).toFixed(2)} MB (under 10 MB) in ${f && f.tries} tr${f && f.tries > 1 ? 'ies' : 'y'}`);

  // ================= 6. GIF warnings on the bar (15 MB / 5 MB) and their fixes
  await ev(() => { WM.$('#clipKind [data-k=gif]').click(); CL.whole = false; clipSet('out', 20); clipSet('in', 0); });
  await ev(() => { CL.gifEst = { key: clipGifKey(), bytes: 20 * 1048576 }; clipRender(); }); await sleep(50);
  b = await bar();
  ok(b.shown && /^About 20 MB is 5 MB over the 15 MB X takes for a GIF \(phones take 5 MB\)\.$/.test(b.text) && b.btns.some(x => /^Trim to fit 15 MB \(0:14\)$/.test(x)) && b.btns.some(x => /^Make it smaller/.test(x)) && !b.btns.includes('Change account'), `GIF over 15 MB ${JSON.stringify(b)}`);
  await clickBar('Trim to fit 15 MB'); await sleep(100);
  ok(Math.abs(await ev(() => CL.out) - 14.5) < 0.1, `Trim to fit: 0:14.5 (${await ev(() => CL.out)})`);
  await ev(() => { CL.gifEst = { key: clipGifKey(), bytes: 7 * 1048576 }; clipRender(); });
  b = await bar();
  ok(/fine on X's website, but 2 MB over the 5 MB its phone apps take/.test(b.text), `GIF over 5 MB: the phone note "${b.text}"`);
  await clickBar('Make it smaller'); await sleep(100);
  ok(JSON.stringify(await ev(() => clipGifSet())) === '{"w":320,"fps":10,"loop":true,"colors":64}', 'Make it smaller: 320 px, 10 fps, 64 colours');
  await ev(() => { CL.gifEst = null; WM.$('#clipKind [data-k=mp4]').click(); });

  // ================= 7. the Library: Converted rows, quick filters, kept, fast
  await ev(() => openDownloadsManager('all')); await sleep(1500);
  const lib = await ev(() => ({ chips: [...WM.$('#dlqf').children].map(b => b.textContent), shown: getComputedStyle(WM.$('#dlqf')).display !== 'none' }));
  ok(lib.shown && JSON.stringify(lib.chips) === '["All","Video (4)","Audio (1)","GIFs (0)","Clips (0)","Converted (5)"]', `ALL has quick filters with counts ${JSON.stringify(lib.chips)}`);
  await btn('#dlqf', 'q', 'conv'); await sleep(300);
  let vis = await ev(() => dlmVisible().map(r => `${r.kind}/${r.media}`));
  ok(vis.length === 5 && vis.every(x => x.startsWith('conv/')), `Converted: only converted files ${JSON.stringify(vis)}`);
  await btn('#dlqf', 'q', 'audio'); await sleep(300);
  vis = await ev(() => dlmVisible().map(r => `${r.kind}/${r.media || ''}`));
  ok(JSON.stringify(vis) === '["conv/audio"]', `Audio: any audio, converted ones too ${JSON.stringify(vis)}`);
  const d7 = await dw(); if (d7) await d7.screenshot({ path: `${O}/7-library-quick.png` });
  await ev(() => { [...WM.$('#dlmSeg').children].find(b => b.dataset.f === 'clips').click(); }); await sleep(400);
  const cl = await ev(() => ({ qf: getComputedStyle(WM.$('#dlqf')).display, sub: [...WM.$('#clsub').children].map(b => b.textContent) }));
  ok(cl.qf === 'none' && cl.sub.includes('Converted (5)'), `CLIPS has its own row (with Converted); the quick filters hide ${JSON.stringify(cl)}`);
  await ev(() => { [...WM.$('#dlmSeg').children].find(b => b.dataset.f === 'all').click(); }); await sleep(300);
  ok(await ev(() => DLM.qf === 'audio' && [...WM.$('#dlqf').children].find(b => b.dataset.q === 'audio').classList.contains('on')), 'back on ALL: the quick filter is kept');
  // Convert again from the Library: CLIP on the original, converting the whole file
  const ag = await ev(() => { const r = DLM.rows.find(x => x.kind === 'conv' && x.media === 'video' && /\(For X\)/.test(x.title)); if (!r) return null; WM.$('#dlmDlg').close(); clipAgain(r); return r.title; }); await sleep(1500);
  ok(ag && await ev(() => CL.whole && CL.tab === 'convert' && /Big Sky/.test(CL.file)), `Convert again (${ag}): CLIP on the original, whole file, Convert tab`);
  // a big library: 6,000 rows, the counts made once, switching stays quick
  await ev(() => openDownloadsManager('all')); await sleep(1200);
  const perf = await ev(() => {
    const base = DLM.rows.slice(), nb = base.filter(r => r.kind !== 'playlist').length, kinds = ['video', 'audio', 'mp4clip', 'mp3clip', 'gifclip', 'conv'];
    const many = Array.from({ length: 6000 }, (_, i) => ({ kind: kinds[i % 6], media: ['video', 'audio', 'gif'][i % 3], path: `/fake/f${i}.mp4`, title: `Fake ${i}`, size: 1000 + i, mtime: 1e12 + i, dur: 10 }));
    DLM.rows = base.concat(many); DLM.qf = 'all';
    const t0 = performance.now(); dlmRender(); const t1 = performance.now();
    const counted = DLM.qfN.all;
    const t2 = performance.now(); DLM.qf = 'gif'; dlmRender(); const t3 = performance.now();
    const same = DLM.qfRows === DLM.rows;
    const n = dlmVisible().length;
    DLM.rows = base; DLM.qf = 'all'; dlmRender();
    return { all: Math.round(t1 - t0), gif: Math.round(t3 - t2), counted, same, n, base: nb };
  });
  ok(perf.counted === 6000 + perf.base && perf.same && perf.n === 2000 && perf.gif < 1500, `6,000 more rows: counted once, GIFs filter in ${perf.gif} ms (all: ${perf.all} ms) ${JSON.stringify(perf)}`);
  await ev(() => WM.$('#dlmDlg').close());

  // ================= 7b. readable in all 10 skins: Convert's cards and chips, the For X bar (fixed amber on dark), the quick filters
  await ev((f) => clipOpen(f, { kind: 'mp4' }), LONG); await sleep(1200);
  await ev(() => WM.$('#clipTabs [data-t=convert]').click()); await btn('#clipCvPreset', 'p', 'forx'); await sleep(300);
  await ev(() => openDownloadsManager('all')); await sleep(800);
  const lum = (c) => { const p = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bad = [];
  const look = (w, sel) => w.evaluate((sel) => {
    const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor; if (b && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(b)) return b; } return 'rgb(0, 0, 0)'; };
    return sel.map(s => { const e = document.querySelector(s); if (!e) return { s, miss: true }; return { s, fg: getComputedStyle(e).color, bg: bgOf(e) }; });
  }, sel);
  for (const id of await ev(() => WM.skins.list.map(s => s.id))) {
    await ev((id) => WM.skins.apply(id), id); await sleep(700);
    const cwin = await cw(), dwin = await dw();
    const c = [...await look(cwin, ['.clip-cards button.on b', '.clip-cards button:not(.on) b', '.clip-cards button:not(.on) span', '.clip-xbar .xb-t', '.clip-xbar button', '#clipXAcct']), ...await look(dwin, ['.dlqf button.on', '.dlqf button:not(.on):not(:disabled)'])];
    for (const x of c) { if (x.miss) { bad.push({ id, s: x.s, miss: true }); continue; } const r1 = ratio(x.fg, x.bg); if (r1 < (/span|:not\(\.on\)/.test(x.s) ? 3 : 4.5)) bad.push({ id, s: x.s, r: r1.toFixed(2) }); }
    if (id === 'pocket' || id === 'chrome') await cwin.screenshot({ path: `${O}/skin-${id}-convert.png` });
  }
  ok(!bad.length, `Convert, the For X bar and the quick filters are readable in all 10 skins ${JSON.stringify(bad)}`);
  await ev(() => { WM.skins.apply('classic'); WM.$('#dlmDlg').close(); }); await sleep(300);

  // ================= 8. remembered after a restart: the account, the preset, the quick filter
  await ev(() => saveNow()); await sleep(600); allErrs.push(...errs); await app.close();
  ({ app, win, errs } = await launch(H, { keep: true })); ev = (f, a) => win.evaluate(f, a);
  await ev((f) => clipOpen(f, { kind: 'mp4' }), LONG); await sleep(1200);
  const rem = await ev(() => ({ acct: S.xAccount, preset: CL.cv.preset, qf: DLM.qf, whole: CL.whole }));
  ok(rem.acct === 'free' && rem.preset === 'forx' && rem.qf === 'audio' && !rem.whole, `after a restart: X account Free, Convert preset For X (used last), the Library's quick filter (Audio), not converting ${JSON.stringify(rem)}`);
  await ev(() => { WM.$('#clipTabs [data-t=convert]').click(); }); await btn('#clipCvPreset', 'p', 'forx'); await sleep(500);
  ok(!(await ev(() => WM.$('#confirmDlg').open)), 'For X after a restart: not asked again');

  allErrs.push(...errs);
  ok(!allErrs.length, 'no errors in the windows ' + JSON.stringify(allErrs.slice(0, 5)));
  await app.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
