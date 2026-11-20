// 3.0.0 Batch convert (2A-2J): several files with Convert's settings, one at a time in the background
//   the playlist's right-click (⇄ Convert N files…) and the Library's button; the box (MP3 / MP4 / GIF, presets, a song
//   in an MP4 batch becomes an MP3, in a GIF batch it's skipped; not a video or a song: left out; 200 at a time); the
//   downloads limit (Convert anyway / Make room…); the run ("Converting 1 / 3", nothing frozen); the summary; names
//   never overwrite; originals untouched; a file that can't be read fails, the rest go on; Cancel stops the file being
//   made (nothing half-made kept) and skips the rest; a second batch joins the one running; Even out (each file);
//   closing SlopAMP while a batch runs asks first
// Run (Linux, xvfb): SLOPAMP_ELECTRON=… SLOPAMP_APP=… xvfb-run -a node tests/convert-batch-300.js
'use strict';
const { launch, sleep, docWin } = require('./lib');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const H = path.join(os.tmpdir(), 'slopamp-test-300b');
const O = process.env.SLOPAMP_SHOTS || path.join(os.tmpdir(), 'slopamp-300-shots');
fs.mkdirSync(O, { recursive: true });
const APPFF = ((d) => (require('fs').existsSync(path.join(d, 'bin', 'ffmpeg')) ? path.join(d, 'bin') : d))(path.join(process.env.SLOPAMP_APP || path.join(__dirname, '..'), 'vendor/ffmpeg/linux'))   // 3.2.0: bin/ + lib/;
const FF = path.join(APPFF, 'ffmpeg'), FP = path.join(APPFF, 'ffprobe');
const probe = (f) => JSON.parse(execFileSync(FP, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f]).toString());
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const vol = (f) => { const r = spawnSync(FF, ['-hide_banner', '-i', f, '-af', 'volumedetect', '-f', 'null', '-']); const m = /mean_volume: (-?[\d.]+) dB/.exec(String(r.stderr)); return m ? +m[1] : -200; };

(async () => {
  const SRC = path.join(os.tmpdir(), 'slopamp-300b-src'); fs.mkdirSync(path.join(SRC, 'other'), { recursive: true });
  const mk = (name, args) => { const f = path.join(SRC, name); if (!fs.existsSync(f)) execFileSync(FF, ['-hide_banner', '-v', 'error', '-y', ...args, f]); return f; };
  const H264 = ['-c:v', 'libopenh264', '-b:v', '2M', '-pix_fmt', 'yuv420p'];
  const MAIN = mk('Night Main 360p.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=4', '-f', 'lavfi', '-i', 'sine=f=440:d=4', ...H264, '-c:a', 'aac', '-shortest']);
  const BEACH = mk('Beach Day 4K.mp4', ['-f', 'lavfi', '-i', 'color=c=0x2060ff:s=1280x720:r=30:d=3', '-f', 'lavfi', '-i', 'sine=f=3000:d=3', ...H264, '-c:a', 'aac', '-shortest']);
  const TWIN = mk('other/Beach Day 4K.mp4', ['-f', 'lavfi', '-i', 'color=c=0x20a060:s=640x360:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=900:d=2', ...H264, '-c:a', 'aac', '-shortest']);   // the same name
  const SONG = mk('Slow Build - Rising.mp3', ['-f', 'lavfi', '-i', 'sine=f=1000:d=3', '-c:a', 'libmp3lame', '-b:a', '192k']);
  const LONG = mk('Long Ride 720p.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=40', '-f', 'lavfi', '-i', 'sine=f=500:d=40', ...H264, '-c:a', 'aac', '-shortest']);
  const QUIET = mk('Quiet Phone.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=3', '-f', 'lavfi', '-i', 'sine=f=600:d=3,volume=-14dB', ...H264, '-c:a', 'aac', '-shortest']);
  const LOUD = mk('Loud Phone.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=3', '-f', 'lavfi', '-i', 'sine=f=600:d=3,volume=8dB', ...H264, '-c:a', 'aac', '-shortest']);
  const PIC = mk('Card Picture.png', ['-f', 'lavfi', '-i', 'color=c=0xe020e0:s=640x360', '-frames:v', '1']);
  const JUNK = path.join(SRC, 'Broken Phone.mp4'); fs.writeFileSync(JUNK, Buffer.alloc(5000, 7));
  const MANY = path.join(SRC, 'many'); fs.mkdirSync(MANY, { recursive: true });
  const many = Array.from({ length: 210 }, (_, i) => { const f = path.join(MANY, `tune ${String(i + 1).padStart(3, '0')}.mp3`); if (!fs.existsSync(f)) fs.copyFileSync(SONG, f); return f; });
  const before = Object.fromEntries([MAIN, BEACH, TWIN, SONG].map(f => [f, sha(f)]));

  const { app, win, errs } = await launch(H);
  const ev = (f, a) => win.evaluate(f, a);
  const DL = (await app.evaluate(({ app }) => app.getPath('downloads'))) + '/SlopAMP';
  const CONV = path.join(DL, 'Converted');
  await ev(() => { window.__toasts = []; const t0 = toast; toast = (m, ...a) => { window.__toasts.push(m); return t0(m, ...a); }; });   // eslint-disable-line no-global-assign
  const toasts = () => ev(() => window.__toasts.splice(0));
  const bars = [];
  await ev(() => { window.__bars = []; const b0 = showDlBar; showDlBar = (o) => { window.__bars.push(o.text); return b0(o); }; });   // eslint-disable-line no-global-assign
  const box = () => ev(() => ({ open: WM.$('#cbDlg').open, title: WM.$('#cbTitle').textContent, rows: [...WM.$$('#cbList tr')].map(r => [...r.children].map(td => td.textContent.trim()).join(' | ')), note: WM.$('#cbNote').textContent, kindNote: WM.$('#cbKindNote').textContent, go: WM.$('#cbGo').textContent, warn: WM.$('#cbWarn').classList.contains('hidden') ? '' : WM.$('#cbWarn').textContent, room: !WM.$('#cbRoom').classList.contains('hidden') }));
  const sum = () => ev(() => ({ open: WM.$('#cbDlg').open, title: WM.$('#cbTitle').textContent, rows: [...WM.$$('#cbSumList tr')].map(r => [...r.children].map(td => td.textContent.trim()).join(' | ')), note: WM.$('#cbSumNote').textContent }));
  const until = async (fn, ms = 120000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(250); } return false; };
  const running = () => ev(() => !!CB.run);
  const convFiles = () => (fs.existsSync(CONV) ? fs.readdirSync(CONV).sort() : []);

  // ===================================================================== the playlist's right-click
  await ev(async (ps) => { await addFilesToTab(ps, S.tab); }, [MAIN, BEACH, SONG, PIC]); await sleep(2000);
  await ev(() => { window.__menu = null; showCtxMenu = (en) => { window.__menu = en.filter(Boolean).map(e => e[0]); }; });   // eslint-disable-line no-global-assign
  const ctx = (i) => ev((k) => { const row = WM.$('#list').children[k]; row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 })); return window.__menu; }, i);
  await ev(() => { S.sel = new Set(S.items.slice(0, 3).map(i => i.id)); renderList(); });
  let m = await ctx(1);
  ok(m && m.includes('⇄ Convert 3 files…'), `3 selected, right-click: "⇄ Convert 3 files…" (${m && m.filter(x => /Convert|Fix/.test(x)).join(' · ')})`);
  await ev(() => { S.sel = new Set([S.items[0].id]); renderList(); });
  m = await ctx(0);
  ok(m && m.includes('⇄ Convert…') && !m.some(x => /Convert \d+ files/.test(x)), 'one selected: "⇄ Convert…" (opens CLIP\'s Convert, as before)');

  // ===================================================================== the box
  await ev((ps) => cbOpen(ps), [MAIN, BEACH, SONG, PIC]); await sleep(800);
  let b = await box();
  ok(b.open && b.title === '⇄ Convert 3 files' && b.rows.length === 3 && /One file isn’t a video or a song\./.test(b.note), `the box: "${b.title}", the picture left out ("${b.note.slice(-45)}")`);
  ok(/^Night Main 360p\.mp4 \| [\d.]+ [KM]B \| For X$/.test(b.rows[0]) && /^Slow Build - Rising\.mp3 \| [\d.]+ KB \| MP3 \(no picture\)$/.test(b.rows[2]) && b.kindNote === 'a song in the list becomes an MP3 (no picture)', `each file and what it becomes: ${JSON.stringify(b.rows)}`);
  ok(/To Downloads[\\/]SlopAMP[\\/]Converted, one at a time, each as “name \(For X\)\.mp4” \(a new name if it’s taken\)\. The originals are never changed\. About [\d.]+ [KM]B in all\./.test(b.note), `where and how big: "${b.note.slice(0, 160)}"`);
  await ev(() => WM.$('#cbKind [data-v=gif]').click()); b = await box();
  ok(/skipped: a GIF needs a picture/.test(b.rows[2]) && /a song is skipped/.test(b.kindNote), `GIF: the song is skipped ("${b.rows[2]}")`);
  await ev(() => WM.$('#cbKind [data-v=mp3]').click()); b = await box();
  ok(b.rows.every(r => /MP3 320$/.test(r)), `MP3: all three (${b.rows.map(r => r.split(' | ')[2]).join(', ')})`);
  await ev(() => WM.$('#cbKind [data-v=mp4]').click());
  // the downloads limit (2.9.1): a batch that would pass it says by how much
  await ev(() => { S.dlLimit = 0.000001; cbRender(); }); await sleep(800); b = await box();
  ok(b.warn && /would pass the limit by about/.test(b.warn) && b.room && b.go === 'Convert anyway', `past the downloads limit: "${b.warn.slice(0, 110)}…" · ${b.go} · Make room…`);
  await ev(() => { S.dlLimit = 0; cbRender(); }); await sleep(400);
  await (await docWin(app, 'host-dialog') || win).screenshot({ path: `${O}/3-batch-box.png` }).catch(() => {});
  // ===================================================================== the run
  const t0 = Date.now();
  await ev(() => WM.$('#cbGo').click());
  await sleep(300);
  const lag = []; for (let k = 0; k < 8; k++) { const s = Date.now(); await ev(() => 1); lag.push(Date.now() - s); await sleep(100); }
  ok(await until(async () => !(await running()), 120000), `the batch ran in the background (${((Date.now() - t0) / 1000).toFixed(1)} s); the window kept answering (slowest ${Math.max(...lag)} ms)`);
  ok(Math.max(...lag) < 300, 'nothing froze while it ran');
  const bt = await ev(() => window.__bars.slice());
  ok(bt.some(t => /^Converting 1 \/ 3 · “Night Main 360p\.mp4” \(For X\)/.test(t)) && bt.some(t => /^Converting 3 \/ 3 · “Slow Build - Rising\.mp3” \(MP3 320\) \d+% · 2 done$/.test(t)), `the bar: "${bt.find(t => /^Converting 3/.test(t))}"`);
  let s = await sum();
  ok(s.open && s.title === '⇄ Convert: 3 done' && s.rows.length === 3 && s.rows.every(r => /✓ saved/.test(r)), `the summary: "${s.title}" ${JSON.stringify(s.rows)}`);
  let cf = convFiles();
  ok(JSON.stringify(cf) === JSON.stringify(['Beach Day 4K (For X).mp4', 'Night Main 360p (For X).mp4', 'Slow Build - Rising (converted).mp3']), `in Converted: ${JSON.stringify(cf)}`);
  const pv = probe(path.join(CONV, 'Beach Day 4K (For X).mp4'));
  ok(pv.streams.some(x => x.codec_name === 'h264') && pv.streams.some(x => x.codec_name === 'aac') && probe(path.join(CONV, 'Slow Build - Rising (converted).mp3')).streams[0].codec_name === 'mp3', 'MP4s are H.264 + AAC, the song an MP3');
  await ev(() => WM.$('#cbDlg').close());
  // never overwrite: the same batch again, and two files with the same name in one batch
  await ev((ps) => cbOpen(ps), [MAIN, BEACH, TWIN]); await sleep(600); await ev(() => WM.$('#cbGo').click());
  await until(async () => !(await running()));
  cf = convFiles();
  ok(['Night Main 360p (For X) (2).mp4', 'Beach Day 4K (For X) (2).mp4', 'Beach Day 4K (For X) (3).mp4'].every(n => cf.includes(n)) && cf.length === 6, `never over a file that's there: ${JSON.stringify(cf)}`);
  ok(Object.entries(before).every(([f, h]) => sha(f) === h), 'the originals are unchanged');
  await ev(() => WM.$('#cbDlg').close());
  // a file that can't be read fails; the others go on
  await ev((ps) => cbOpen(ps), [JUNK, MAIN]); await sleep(500); await ev(() => WM.$('#cbGo').click());
  await until(async () => !(await running()));
  s = await sum();
  ok(s.title === '⇄ Convert: 1 done, 1 failed' && /^Broken Phone\.mp4 \| failed: SlopAMP can’t read this file/.test(s.rows.find(r => /Broken/.test(r)) || ''), `a broken file: ${JSON.stringify(s.rows)}`);
  await ev(() => WM.$('#cbDlg').close());

  // ===================================================================== Cancel, and a second batch joining the one running
  const n0 = convFiles().length;
  await ev((ps) => cbOpen(ps), [LONG, MAIN]); await sleep(500); await ev(() => WM.$('#cbGo').click());
  await ev((ps) => cbOpen(ps), [BEACH]); await sleep(500); await ev(() => WM.$('#cbGo').click()); await sleep(300);
  let tt = await toasts();
  ok(tt.some(t => /^Added 1 to the batch that’s running \(2 waiting\)\.$/.test(t)), `a second batch joins the one running: "${tt.find(t => /Added/.test(t))}"`);
  // closing SlopAMP while it runs asks first
  await ev(() => { window.__asked = null; confirmBox = async (t) => { window.__asked = t; return false; }; });   // eslint-disable-line no-global-assign
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(x => /index\.html/.test(x.webContents.getURL())); if (w) w.close(); });
  ok(await until(() => ev(() => !!window.__asked), 5000) && /^A batch convert is running \(1 \/ 3\)$/.test(await ev(() => window.__asked)), `closing asks first: "${await ev(() => window.__asked)}"`);
  await until(() => ev(() => CB.run && CB.run.pct > 3), 60000);
  await ev(() => cbCancel());
  await until(async () => !(await running()), 60000);
  s = await sum();
  ok(s.title === '⇄ Convert: 0 done, 3 skipped' && /Long Ride 720p\.mp4 \| skipped: canceled: it was stopped while converting/.test(s.rows[0]) && s.rows.slice(1).every(r => /skipped: canceled \| $/.test(r)), `Cancel stops the file being made and skips the rest: ${JSON.stringify(s.rows)}`);
  ok(convFiles().length === n0 && !convFiles().some(n => /\.part$|Long Ride/.test(n)), 'nothing half-made is kept');
  await ev(() => WM.$('#cbDlg').close());

  // ===================================================================== Even out the volume (each file on its own)
  await ev((ps) => cbOpen(ps), [QUIET, LOUD]); await sleep(500);
  await ev(() => { WM.$('#cbKind [data-v=mp3]').click(); WM.$('#cbEven').click(); }); await sleep(200);
  await ev(() => WM.$('#cbGo').click()); await until(async () => !(await running()));
  const q = vol(path.join(CONV, 'Quiet Phone (converted).mp3')), l = vol(path.join(CONV, 'Loud Phone (converted).mp3'));
  ok(Math.abs(q - l) < 2.5, `Even out the volume on each file: ${q.toFixed(1)} and ${l.toFixed(1)} dB (they were 22 dB apart)`);
  await ev(() => { WM.$('#cbDlg').close(); S.cbSet = null; });

  // ===================================================================== 200 at a time, at once
  let t = Date.now(); await ev((ps) => cbOpen(ps), many); const openMs = Date.now() - t; await sleep(800);
  b = await box();
  ok(b.title === '⇄ Convert 200 files' && b.rows.length === 200 && /200 at a time: 10 left out\./.test(b.note) && openMs < 2500, `210 files: the box opens in ${openMs} ms with 200 ("${/200 at a time[^.]*\./.exec(b.note)}")`);
  await ev(() => WM.$('#cbDlg').close());

  // ===================================================================== the Library's ⇄ Convert…
  await ev(() => openDownloadsManager('clips')); await sleep(2000);
  await ev(() => { DLM.sel = new Set(dlmVisible().filter(r => /\(For X\)\.mp4$/.test(r.path)).slice(0, 2).map(dlmKey)); dlmRender(); }); await sleep(500);
  const lb = await ev(() => ({ cl: WM.$('#clConv') && !WM.$('#clConv').disabled, dl: !WM.$('#dlmConv').disabled }));
  ok(lb.cl || lb.dl, `the Library's ⇄ Convert… button is on with 2 selected (${JSON.stringify(lb)})`);
  await ev(() => { const b = !WM.$('#clConv').disabled ? WM.$('#clConv') : WM.$('#dlmConv'); b.click(); }); await sleep(800);
  b = await box();
  ok(b.open && b.title === '⇄ Convert 2 files', `…and opens the box with them ("${b.title}")`);
  await ev(() => WM.$('#cbDlg').close());

  ok(!errs.length, `no errors in the windows ${JSON.stringify(errs.slice(0, 3))}`);
  await app.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
