'use strict';
// CLIP (2.3, ideas #12 / #13): cut one piece out of a song or video and save it as a NEW file.
//   MP3 clips -> Downloads\SlopAMP\mp3clips, MP4 clips -> Downloads\SlopAMP\mp4clips.
// The original file is never changed. Trim only: no splicing, volume, crop, text... (see IDEAS #12/#13).
//
// MP3:  "Same quality as the file" copies the MP3 frames (an .mp3 source, no fades: fast, no quality loss);
//       otherwise it's re-encoded at 320 kbps (any audio or video source; needed for fades).
// MP4:  "Exact cut" re-encodes (H.264 + AAC), so it starts on the frame picked; "Fast cut" copies the
//       streams (H.264 .mp4/.mov sources only) and so starts at the keyframe before In.
// Where each clip came from (file, In/Out, title) is kept in the state's `clips` index for "Clip again".
//
// 2.9.4 (CLIP editor, part 1): GIF clips (Downloads\SlopAMP\gifs) and the tools, all with the bundled FFmpeg:
//   Shape  crop to 16:9 / 9:16 / 1:1 / 4:5 (one box for the whole clip), as filmed or upscaled (1080 on the short side)
//   Sound  even out the volume (loudnorm to -14 LUFS, measured first: two passes), volume -12..+12 dB, fades
//   Speed  0.5x / 1.5x / 2x (setpts + atempo: voices keep their pitch)
// Shape and Speed re-encode the picture. A sound-only change to a Fast-cut MP4 copies the picture as it is.
// 2.9.5 (CLIP part 2): Convert = the whole file, no trimming (Downloads\SlopAMP\Converted), with presets
//   (For X / Small / Phone-friendly / Best quality: size, frame rate, quality) and "fit under" a file size
//   (OpenH264 at the bitrate that lands under it; one more try lower if it still comes out too big).
// 2.9.7 (CLIP part 3): Captions = lines burned into the picture with libass (bold white, black outline; bottom or
//   middle; S / M / L), from the file's own subtitles, a .srt / .vtt, YouTube (yt-dlp, on demand) or typed / pasted;
//   also saved as a .srt next to the clip. Join v1 = sections of the file open in CLIP, stills and title cards (drawn
//   by SlopAMP, saved as pictures) in one MP4 (re-encoded: one size, one frame rate), or each section on its own.
// 2.9.8 (CLIP part 4): Shape's Fit (crop to the box, or the whole picture with black bars or a blurred fill: gblur on
//   a quarter-size copy, darkened with colorchannelmixer; the bundled FFmpeg has no boxblur / eq), also Join's Fit;
//   animated WebP (libwebp_anim; Downloads\SlopAMP\gifs); Loop for MP4 (repeats joined without re-encoding by the
//   concat demuxer; Boomerang = forward + reverse, re-encoded, up to 15 s); Change the sound (Replace / Mix under: a
//   song or another video's sound, lined up, looped or faded; the picture is copied when nothing else changes it).
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');
const X = require('./xready');   // 2.5 (#22): X-ready MP4s
const XL = require('./renderer/xlimits');   // 2.9.5: X's limits, in one place

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|mkv|webm|avi)$/i;
const GIF_EXT = /\.(gif|webp)$/i;      // 2.9.8: animated WebPs live with the GIFs
const ANY_EXT = /\.(mp3|m4a|aac|wav|flac|ogg|opus|mp4|m4v|mov|mkv|webm|avi|gif|webp)$/i;   // Converted (2.9.5)
const SHOT_KINDS = ['person', 'look', 'prop', 'place'];   // slop.cc's reference kinds (SLOP's LOOK)
const fmtCut = (t) => { t = Math.max(0, Math.round(t)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return `${h ? `${h}h` : ''}${h ? String(m).padStart(2, '0') : m}m${String(s).padStart(2, '0')}s`; };
const num = (v) => (Number.isFinite(+v) ? +v : NaN);
const SPEEDS = [0.5, 1, 1.5, 2];
const RATIOS = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 };
const even = (v) => Math.max(2, Math.floor(v / 2) * 2);
const GIF = { w: [320, 480, 640, 0], fps: [10, 15, 24], colors: [256, 64] };
const LOUD = 'loudnorm=I=-14:TP=-1.5:LRA=11';

class Clipper {
  // o: { ffmpeg: () => exe path, server (media.js MediaServer), encoderArgs, dirs: () => ({ mp3, mp4, shots }), urlOf,
  //      getIndex, setIndex, fileSafe, log, send, trash }
  constructor(o) {
    Object.assign(this, o);
    this.peakCache = new Map();
    this.frameCache = new Map();
    this.jobs = new Map();          // job id -> { proc, tmp, canceled }
    this.xCache = new Map();        // file -> { key: mtime|size, x } (X-ready check, 2.5)
  }
  static cutName(title, a, b) { return `${title} (${fmtCut(a)}-${fmtCut(b)})`; }

  // ---------- a file to cut ----------
  async open(file) {
    if (typeof file !== 'string' || !fs.existsSync(file)) return { ok: false, error: 'The file isn’t there any more.' };
    const info = await this.server.probe(file);
    if (!info || (!info.audio && !info.hasVideo) || !(info.duration > 0)) return { ok: false, error: 'SlopAMP can’t read this file.' };
    const prep = await this.server.prepare(file).catch(() => null);
    const ext = path.extname(file).toLowerCase();
    const v = info.video, a = info.audio;
    const name = path.basename(file).replace(/\.[^.]+$/, '').replace(/\s*\[[\w-]{1,30}\]$/, '').trim();
    return {
      ok: true, file, ext,
      title: name || info.title || 'Clip',
      duration: info.duration,
      hasVideo: !!info.hasVideo, hasAudio: !!a,
      width: v ? v.width : 0, height: v ? v.height : 0,
      canCopyMp3: !!a && a.codec === 'mp3' && !info.hasVideo,
      canFast: !!v && v.codec === 'h264' && /mp4|mov/.test(info.format) && (!a || ['aac', 'mp3'].includes(a.codec)),
      size: (() => { try { return fs.statSync(file).size; } catch (_) { return 0; } })(),   // 2.9.4: the size estimate
      bitrate: info.bitrate || 0, abr: (a && a.bitrate) || (!info.hasVideo && info.bitrate) || 0, fps: (v && v.fps) || 0,
      previewUrl: prep && prep.ok && prep.mode === 'direct' ? prep.directUrl : null,
      coverUrl: prep && prep.coverUrl
    };
  }

  // ---------- waveform: loudest sample per bin, `rate` bins per second, 0..100 ----------
  async peaks(file) {
    let st; try { st = fs.statSync(file); } catch (_) { return null; }
    const key = `${file}|${st.mtimeMs}`;
    if (this.peakCache.has(key)) return this.peakCache.get(key);
    const info = await this.server.probe(file);
    if (!info || !info.audio) return null;
    const dur = info.duration || 0;
    const sr = dur > 3 * 3600 ? 400 : 2000;
    const out = await this.run(['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', String(sr), '-f', 's16le', '-'], 300000);
    if (out.code !== 0 || !out.stdout.length) { this.log('clip waveform failed', out.stderr.slice(-200)); return null; }
    const buf = out.stdout, n = Math.floor(buf.length / 2);
    const rate = dur <= 600 ? 100 : dur <= 3600 ? 25 : 8;
    const per = Math.max(1, Math.round(sr / rate)), N = Math.ceil(n / per), raw = new Array(N);
    let top = 1;
    for (let i = 0; i < N; i++) {
      let m = 0; const a = i * per, b = Math.min(n, a + per);
      for (let j = a; j < b; j++) { const v = Math.abs(buf.readInt16LE(j * 2)); if (v > m) m = v; }
      raw[i] = m; if (m > top) top = m;
    }
    const res = { rate: sr / per, dur: n / sr, peaks: raw.map(v => Math.round(Math.sqrt(v / top) * 100)) };
    if (this.peakCache.size > 6) this.peakCache.delete(this.peakCache.keys().next().value);
    this.peakCache.set(key, res);
    return res;
  }

  // ---------- small frames for the strip under the preview ----------
  async frames(file, times, h) {
    h = Math.max(24, Math.min(160, Math.round(num(h) || 54)));
    const list = (Array.isArray(times) ? times : []).slice(0, 24).map(num);
    const one = async (t) => {
      if (!Number.isFinite(t)) return null;
      const key = `${file}|${t.toFixed(1)}|${h}`;
      if (this.frameCache.has(key)) return this.frameCache.get(key);
      const r = await this.run(['-nostdin', '-hide_banner', '-loglevel', 'error', '-ss', Math.max(0, t).toFixed(2), '-i', file, '-frames:v', '1', '-vf', `scale=-2:${h}`, '-q:v', '6', '-f', 'image2pipe', '-c:v', 'mjpeg', '-'], 20000);
      const url = r.code === 0 && r.stdout.length ? `data:image/jpeg;base64,${r.stdout.toString('base64')}` : null;
      if (this.frameCache.size > 400) this.frameCache.clear();
      this.frameCache.set(key, url);
      return url;
    };
    const res = new Array(list.length);
    let next = 0;
    const worker = async () => { while (next < list.length) { const i = next++; res[i] = await one(list[i]); } };
    await Promise.all([worker(), worker(), worker()]);
    return res;
  }

  // ---------- saving ----------
  uniquePath(dir, name, ext) {
    let p = path.join(dir, `${name}${ext}`), n = 2;
    while (fs.existsSync(p)) p = path.join(dir, `${name} (${n++})${ext}`);
    return p;
  }
  // ---------- 2.9.7 Captions ----------
  // caps: { lines: [{ a, b, t }] (the source file's time), pos: 'bottom' | 'middle', size: 's' | 'm' | 'l', srt: bool }
  static capStyle(c) { c = c || {}; return { pos: c.pos === 'middle' ? 'middle' : 'bottom', size: ['s', 'm', 'l'].includes(c.size) ? c.size : 'm' }; }
  static capClean(c) {
    if (!c || typeof c !== 'object' || !Array.isArray(c.lines)) return null;
    const lines = c.lines.slice(0, 20000).map(l => ({ a: num(l && l.a), b: num(l && l.b), t: String((l && l.t) || '').replace(/\r/g, '').trim().slice(0, 500) }))
      .filter(l => Number.isFinite(l.a) && Number.isFinite(l.b) && l.b > l.a && l.t).sort((x, y) => x.a - y.a);
    return lines.length ? { lines, ...Clipper.capStyle(c), srt: c.srt !== false } : null;
  }
  // the lines of one piece [tin, tout] of the source, in the saved clip's time (Speed applied), from `off` on
  static capMap(caps, tin, tout, speed, off) {
    const out = [];
    for (const l of (caps && caps.lines) || []) {
      if (l.b <= tin + 0.01 || l.a >= tout - 0.01) continue;
      out.push({ a: (off || 0) + (Math.max(l.a, tin) - tin) / speed, b: (off || 0) + (Math.min(l.b, tout) - tin) / speed, t: l.t });
    }
    return out;
  }
  static assTime(t) { t = Math.max(0, t); const cs = Math.round(t * 100), h = Math.floor(cs / 360000), m = Math.floor(cs % 360000 / 6000), sec = Math.floor(cs % 6000 / 100); return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; }
  // one style for v1 (7B): bold white, black outline; the size is a share of the picture's short side
  static assText(lines, W, H, style) {
    const st = Clipper.capStyle(style), base = Math.min(W, H) || 720;
    const fs = Math.round(base * { s: 0.045, m: 0.06, l: 0.08 }[st.size]), ol = Math.max(1, Math.round(fs * 0.08 * 10) / 10);
    const mid = st.pos === 'middle', ml = Math.round(W * 0.05), mv = mid ? 0 : Math.round(H * 0.06);
    const esc = (t) => t.replace(/\\/g, '\u2216').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\n/g, '\\N');
    return ['[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      `Style: Cap,Arial,${fs},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,${ol},0,${mid ? 5 : 2},${ml},${ml},${mv},1`, '',
      '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      ...lines.map(l => `Dialogue: 0,${Clipper.assTime(l.a)},${Clipper.assTime(l.b)},Cap,,0,0,0,,${esc(l.t)}`), ''].join('\r\n');
  }
  static srtText(lines) {
    const tm = (t) => { const ms = Math.round(Math.max(0, t) * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), sec = Math.floor(ms % 60000 / 1000); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
    return lines.map((l, i) => `${i + 1}\r\n${tm(l.a)} --> ${tm(l.b)}\r\n${l.t.replace(/\n/g, '\r\n')}\r\n`).join('\r\n');
  }
  // A folder of its own for one save: the .ass file (and on Windows a copy of Arial Bold, so libass doesn't depend
  // on a font set-up; 7E). ffmpeg runs in that folder, so the filter names "c.ass" with no drive letters to escape.
  capDir() {
    const dir = path.join(os.tmpdir(), `slopamp-cap-${process.pid}-${(this.capN = (this.capN || 0) + 1)}`);
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    if (process.platform === 'win32') {
      const fonts = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
      for (const f of ['arialbd.ttf', 'arial.ttf', 'segoeuib.ttf']) { try { fs.copyFileSync(path.join(fonts, f), path.join(dir, f)); break; } catch (_) {} }
    }
    return dir;
  }
  // write the .ass for a W × H picture; returns the filter that burns it in
  capFilter(cap, W, H) {
    fs.writeFileSync(path.join(cap.dir, 'c.ass'), '\ufeff' + Clipper.assText(cap.lines, W, H, cap.style), 'utf8');
    return 'subtitles=c.ass:fontsdir=.';
  }

  // ---------- 2.9.4 tools ----------
  // What the window asked for, checked: { speed, vol, even, fadeIn, fadeOut, shape: null | { ratio, x, y, w, h, up, ow, oh } }.
  // A shape box that's the whole picture (and not upscaled) is no shape at all, so it doesn't force a re-encode.
  static tools(o, info) {
    o = o || {}; info = info || {};
    const v = info.video || {}, a = !!info.audio;
    const t = { speed: SPEEDS.includes(+o.speed) ? +o.speed : 1, vol: a ? Math.max(-12, Math.min(12, Math.round(num(o.vol) || 0))) : 0, even: a && !!o.even,
      fadeIn: a ? Math.max(0, num(o.fadeIn) || 0) : 0, fadeOut: a ? Math.max(0, num(o.fadeOut) || 0) : 0, shape: null };
    const s = o.shape;
    // 2.9.8: the whole picture in the shape, with black bars or a blurred fill (no box; output 1080 / 720 on the short side)
    if (s && typeof s === 'object' && RATIOS[s.ratio] && v.width > 0 && v.height > 0 && (s.fit === 'bars' || s.fit === 'blur')) {
      const r = RATIOS[s.ratio], S = +s.size === 720 ? 720 : 1080;
      const ow = r >= 1 ? even(S * r) : S, oh = r >= 1 ? S : even(S / r);
      t.shape = { ratio: s.ratio, fit: s.fit, whole: true, ow, oh, blur: s.blur === 'strong' ? 'strong' : 'soft', dark: s.dark !== false };
      return t;
    }
    if (s && typeof s === 'object' && RATIOS[s.ratio] && v.width > 0 && v.height > 0) {
      const W = even(v.width), H = even(v.height);
      const w = even(Math.min(num(s.w) || 0, W)), h = even(Math.min(num(s.h) || 0, H));
      if (w >= 16 && h >= 16) {
        const xx = Math.max(0, Math.min(Math.round(num(s.x) || 0) & ~1, W - w)), yy = Math.max(0, Math.min(Math.round(num(s.y) || 0) & ~1, H - h));
        const up = !!s.up, r = RATIOS[s.ratio];
        const ow = up ? (r >= 1 ? even(1080 * r) : 1080) : w, oh = up ? (r >= 1 ? 1080 : even(1080 / r)) : h;
        if (up || w < W || h < H) t.shape = { ratio: s.ratio, fit: 'crop', x: xx, y: yy, w, h, up, ow, oh };
      }
    }
    return t;
  }
  // 2.9.8: fitting a picture into W × H: black bars, or a blurred, enlarged (and darkened) copy of the same frame behind
  // it. The blur runs on a quarter-size copy (quick), then it's enlarged. k: makes the labels unique in a bigger graph.
  static fitChain(mode, W, H, o, k) {
    o = o || {}; k = k == null ? '' : String(k);
    const inside = `scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=bicubic`;
    if (mode === 'crop') return `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=bicubic,crop=${W}:${H},setsar=1`;
    if (mode !== 'blur') return `${inside},pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
    const bw = even(W / 4), bh = even(H / 4), sigma = o.blur === 'strong' ? 24 : 12;
    return `split[fb${k}][ff${k}];[fb${k}]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},gblur=sigma=${sigma},scale=${W}:${H}:flags=bilinear${o.dark !== false ? ',colorchannelmixer=rr=.75:gg=.75:bb=.75' : ''},setsar=1[fbb${k}];`
      + `[ff${k}]${inside},setsar=1[fff${k}];[fbb${k}][fff${k}]overlay=(W-w)/2:(H-h)/2`;
  }
  // the Shape box (crop, maybe upscaled) or the whole picture fitted into the shape
  static shapeChain(s, k) {
    if (!s) return '';
    if (s.whole) return Clipper.fitChain(s.fit === 'blur' ? 'blur' : 'bars', s.ow, s.oh, s, k);
    return `crop=${s.w}:${s.h}:${s.x}:${s.y}${s.up ? `,scale=${s.ow}:${s.oh}:flags=lanczos,setsar=1` : ''}`;
  }
  static usesSound(t) { return t.speed !== 1 || t.vol !== 0 || t.even || t.fadeIn > 0 || t.fadeOut > 0; }
  // 2.9.8: animated WebP: the GIF settings plus Quality (libwebp: Smaller 60 / Normal 75 / Best 90)
  static webpOpts(g) {
    g = g || {};
    return { w: GIF.w.includes(+g.w) ? +g.w : 480, fps: GIF.fps.includes(+g.fps) ? +g.fps : 15, loop: g.loop !== false, q: ['small', 'normal', 'best'].includes(g.q) ? g.q : 'normal' };
  }
  // 2.9.8: Loop for MP4: { n } repeats (2 / 3 / 5), or as many as fit in upTo s; Boomerang (forward + back); sound on / off
  static repOpts(r, lenOut) {
    if (!r || typeof r !== 'object') return null;
    const boom = !!r.boom, unit = lenOut * (boom ? 2 : 1);
    let n = [2, 3, 5].includes(+r.n) ? +r.n : 1;
    if ([15, 30, 60].includes(+r.upTo)) n = Math.max(1, Math.floor((+r.upTo + 0.05) / unit));
    if (n <= 1 && !boom) return null;
    return { n, boom, sound: r.sound !== false, upTo: [15, 30, 60].includes(+r.upTo) ? +r.upTo : 0, total: unit * n };
  }
  static gifOpts(g) {
    g = g || {};
    return { w: GIF.w.includes(+g.w) ? +g.w : 480, fps: GIF.fps.includes(+g.fps) ? +g.fps : 15, loop: g.loop !== false, colors: GIF.colors.includes(+g.colors) ? +g.colors : 256 };
  }
  // the picture: crop (+ upscale), speed; `keep` = the old exact cut's "round down to even numbers" when there's no shape
  // x (2.9.5 Convert): { dims: { w, h } a new size, fps: a frame-rate cap }
  static vFilters(t, info, x) {
    const f = [], s = t.shape;
    if (s) f.push(Clipper.shapeChain(s, 'v'));
    else if (!(x && x.dims)) f.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
    if (x && x.dims) f.push(`scale=${x.dims.w}:${x.dims.h}:flags=bicubic`, 'setsar=1');
    if (t.speed !== 1) {
      const fps = (info.video && info.video.fps) || 30;
      f.push(`setpts=PTS/${t.speed}`);
      if (t.speed < 1) f.push(`fps=${Math.min(60, Math.round(fps * 1000) / 1000)}`);      // 0.5x shows each frame twice (no smoothing)
      else if (fps * t.speed > 60.5) f.push('fps=60');                                    // 2x of 60 fps would be 120: X takes 60
    }
    if (x && x.fps) { const src = (info.video && info.video.fps) || 30, eff = t.speed > 1 ? Math.min(60, src * t.speed) : src; if (eff > x.fps + 0.5) f.push(`fps=${x.fps}`); }   // the frame rate it would have, capped
    return f;
  }
  // Convert's settings, checked: { preset, size: 'keep' | 'x' | 1080 | 720 | 480, fps: 0 | 30 | 60, q: quality factor, mp3k }
  static conv(c) {
    if (!c || typeof c !== 'object') return null;
    const P = { forx: { size: 'x', fps: 60, q: 1 }, small: { size: 720, fps: 0, q: 0.6 }, phone: { size: 1080, fps: 30, q: 1 }, best: { size: 'keep', fps: 0, q: 2 } }[c.preset] || {};
    const size = ['keep', 'x', 1080, 720, 480].includes(c.size) ? c.size : P.size || 'keep';
    const fps = [0, 30, 60].includes(+c.fps) ? +c.fps : P.fps || 0;
    const q = [0.6, 1, 2].includes(+c.q) ? +c.q : P.q || 1;
    return { preset: ['forx', 'small', 'phone', 'best'].includes(c.preset) ? c.preset : 'custom', size, fps, q, mp3k: [320, 192, 128].includes(+c.mp3k) ? +c.mp3k : 320 };
  }
  // the frame rate a clip comes out at (the source's, sped up, capped by Convert)
  static outFps(info, t, cv) {
    const src = (info.video && info.video.fps) || 30, eff = t.speed > 1 ? Math.min(60, src * t.speed) : src;
    return cv && cv.fps && eff > cv.fps ? cv.fps : eff;
  }
  // Fitting under a size: enough bits for each pixel (about 0.045 bits per pixel per frame for OpenH264), else
  // 30 fps, then the next size down (1080 / 720 / 540 / 360 on the short side). down: extra steps (the retry).
  static fitPicture(w, h, fps, kbps, down) {
    const BPP = 0.045, short = Math.min(w, h), out = {};
    const ok = (W, H, F) => kbps * 1000 / (W * H * F) >= BPP;
    let F = fps;
    if (!ok(w, h, F) && F > 30.5) { F = 30; out.fps = 30; }
    const ladder = [short, ...[1080, 720, 540, 360].filter(x => x < short)];
    let i = 0;
    while (i < ladder.length - 1 && !ok(even(w * ladder[i] / short), even(h * ladder[i] / short), F)) i++;
    i = Math.min(ladder.length - 1, i + (down || 0));
    if (i > 0) out.dims = { w: even(w * ladder[i] / short), h: even(h * ladder[i] / short) };
    return out;
  }
  // The picture size a Convert makes from w × h: as it is, fitted to X's box, or the short side capped (even numbers)
  static convDims(w, h, c) {
    if (!c || !w || !h || c.size === 'keep') return null;
    if (c.size === 'x') { const f = X.fitSize(w, h); return f.w === (w & ~1) && f.h === (h & ~1) ? null : { w: f.w, h: f.h }; }
    const H = +c.size, short = Math.min(w, h);
    if (short <= H) return null;
    const k = H / short;
    return { w: even(w * k), h: even(h * k) };
  }
  // the sound: speed, evened out (measured: pass 2 of loudnorm), volume, fades (on the saved clip's length)
  static aFilters(t, lenOut, loud, sr) {
    const f = [];
    if (t.speed !== 1) f.push(`atempo=${t.speed}`);
    if (loud) f.push(`${LOUD}:measured_I=${loud.I}:measured_TP=${loud.TP}:measured_LRA=${loud.LRA}:measured_thresh=${loud.thresh}:offset=${loud.offset}:linear=true`, `aresample=${sr}`);
    if (t.vol) f.push(`volume=${t.vol}dB`);
    if (t.fadeIn > 0) f.push(`afade=t=in:st=0:d=${Math.min(t.fadeIn, lenOut / 2).toFixed(2)}`);
    if (t.fadeOut > 0) { const d = Math.min(t.fadeOut, lenOut / 2); f.push(`afade=t=out:st=${Math.max(0, lenOut - d).toFixed(3)}:d=${d.toFixed(2)}`); }
    return f;
  }
  static rateOf(info) { const r = info.audio && info.audio.sampleRate; return r === 44100 || r === 48000 ? r : 48000; }
  // loudnorm pass 1: how loud the clip is. Cached, so the window's "this clip: -23 LUFS" and the save share it.
  loudArgs(file, tin, len) { return ['-nostdin', '-hide_banner', '-nostats', '-ss', tin.toFixed(3), '-i', file, '-t', len.toFixed(3), '-map', '0:a:0', '-af', `${LOUD}:print_format=json`, '-f', 'null', '-']; }
  static parseLoud(stderr) {
    const m = /\{[^{}]*"input_i"[^{}]*\}/.exec(String(stderr || ''));
    if (!m) return null;
    try {
      const j = JSON.parse(m[0]), r = { I: +j.input_i, TP: +j.input_tp, LRA: +j.input_lra, thresh: +j.input_thresh, offset: +j.target_offset };
      return Object.values(r).every(Number.isFinite) ? r : { silent: true };
    } catch (_) { return null; }
  }
  loudKey(file, tin, len) { let m = 0; try { m = fs.statSync(file).mtimeMs; } catch (_) {} return `${file}|${m}|${tin.toFixed(2)}|${len.toFixed(2)}`; }
  async loudness(o) {
    o = o || {};
    const info = typeof o.file === 'string' && fs.existsSync(o.file) ? await this.server.probe(o.file) : null;
    if (!info || !info.audio) return { ok: false, error: 'There’s no sound in this file.' };
    const tin = Math.max(0, num(o.in) || 0), len = Math.min(info.duration || Infinity, num(o.out)) - tin;
    if (!(len >= 0.1)) return { ok: false, error: 'The clip is too short.' };
    if (!this.loudCache) this.loudCache = new Map();
    const key = this.loudKey(o.file, tin, len);
    if (!this.loudCache.has(key)) {
      const r = await this.run(this.loudArgs(o.file, tin, len), 600000);
      const l = Clipper.parseLoud(r.stderr);
      if (!l) { this.log('clip loudness failed', r.stderr.slice(-300)); return { ok: false, error: 'Couldn’t measure the sound.' }; }
      if (this.loudCache.size > 40) this.loudCache.delete(this.loudCache.keys().next().value);
      this.loudCache.set(key, l);
    }
    return { ok: true, ...this.loudCache.get(key) };
  }
  // the keyframe at or before t (a Fast cut starts there): seconds from the file's start, or null
  keyframeBefore(file, t) {
    return new Promise((resolve) => {
      const p = execFile(this.server.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey', '-read_intervals', `${Math.max(0, t - 30).toFixed(3)}%${(t + 0.05).toFixed(3)}`,
        '-show_entries', 'frame=pts_time,best_effort_timestamp_time:format=start_time', '-of', 'json', file], { windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
        if (err) return resolve(null);
        try {
          const j = JSON.parse(out), st = +((j.format && j.format.start_time) || 0) || 0;
          const ks = (j.frames || []).map(f => +(f.pts_time != null ? f.pts_time : f.best_effort_timestamp_time) - st).filter(k => Number.isFinite(k) && k <= t + 0.001);
          resolve(ks.length ? Math.max(0, Math.max(...ks)) : null);
        } catch (_) { resolve(null); }
      });
      if (this.server.track) this.server.track(p);
    });
  }

  // ---------- 2.9.8 Change the sound ----------
  // ns: { file, mode: 'replace' | 'mix', from (s into the new sound), at (s into the saved clip), vol (dB), origVol (dB),
  //       short: 'loop' | 'silence', fade: bool }. The clip's length always wins: a shorter sound loops (from `from`) or
  //       goes quiet; a longer one is cut at the end, with a 2 s fade out. The new sound is never sped up (Speed only
  //       changes the original's). Checked here against the file itself.
  async nsPrep(n) {
    if (!n || typeof n !== 'object' || !['replace', 'mix'].includes(n.mode)) return null;
    const file = typeof n.file === 'string' && fs.existsSync(n.file) ? n.file : null;
    if (!file) return { error: 'The new sound’s file isn’t there any more.' };
    const info = await this.server.probe(file);
    if (!info || !info.audio || !(info.duration > 0)) return { error: 'There’s no sound in the file picked for the new sound.' };
    const dur = info.duration, from = Math.max(0, Math.min(num(n.from) || 0, Math.max(0, dur - 0.1)));
    return { file, mode: n.mode, dur, from, at: Math.max(0, num(n.at) || 0), vol: Math.max(-12, Math.min(12, Math.round(num(n.vol) || 0))),
      origVol: Math.max(-30, Math.min(0, Math.round(Number.isFinite(num(n.origVol)) ? num(n.origVol) : -14))), short: n.short === 'silence' ? 'silence' : 'loop', fade: n.fade !== false };
  }
  // the audio graph: [neu] the new sound (its input already starts at `from`), [orig] the clip's own sound (or null),
  // origPre: what the original needs first (Speed's atempo); af: Sound's tools for the result. Ends in [aout].
  static nsGraph(ns, L, o) {
    const fmt = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
    const at = Math.min(Math.max(0, ns.at), Math.max(0, L - 0.1)), seg = ns.dur - ns.from;
    const loop = ns.short === 'loop' && seg < L - at - 0.05;
    const reachesEnd = loop || seg >= L - at - 0.05;
    const fadeEnd = ns.fade && reachesEnd && L > 2.5;
    const chain = [fmt, ...(loop ? [`aloop=loop=-1:size=${Math.ceil(seg * 48000)}`] : []), `atrim=0:${(L - at).toFixed(3)}`, 'asetpts=PTS-STARTPTS',
      ...(at > 0.005 ? [`adelay=${Math.round(at * 1000)}:all=1`] : []), 'apad', `atrim=0:${L.toFixed(3)}`, ...(ns.vol ? [`volume=${ns.vol}dB`] : []),
      ...(fadeEnd ? [`afade=t=out:st=${(L - 2).toFixed(3)}:d=2`] : [])];
    const g = [`${o.neu}${chain.join(',')}[nsa]`];
    const af = o.af && o.af.length ? o.af.join(',') : 'anull';
    if (ns.mode === 'mix' && o.orig) {
      g.push(`${o.orig}asetpts=PTS-STARTPTS${o.origPre ? `,${o.origPre}` : ''},${fmt},apad,atrim=0:${L.toFixed(3)},volume=${ns.origVol}dB[nso]`);
      g.push(`[nsa][nso]amix=inputs=2:duration=first:normalize=0,${af}[aout]`);
    } else { g.push(`[nsa]${af}[aout]`); if (o.sink && o.orig) g.push(`${o.orig}anullsink`); }       // a graph's own sound that isn't used must still go somewhere
    return { graph: g.join(';'), loop, fadeEnd };
  }
  mp3Args(o, info, tin, len, tmp, title, t, loud) {
    t = t || Clipper.tools(o, info);
    // the artist tag is kept (-map_metadata 0), so the title tag mustn't start with it too ("Artist - Artist - Song")
    if (info.artist && title.toLowerCase().startsWith(`${info.artist.toLowerCase()} - `)) title = title.slice(info.artist.length + 3);
    const lenOut = len / t.speed;
    const af = Clipper.aFilters(t, lenOut, loud, Clipper.rateOf(info));
    const copy = o.quality === 'copy' && !af.length && info.audio && info.audio.codec === 'mp3' && !info.hasVideo;
    const cover = !info.hasVideo && info.hasCover;     // keep an MP3's cover picture
    return ['-ss', tin.toFixed(3), '-i', o.file, '-t', lenOut.toFixed(3), '-map', '0:a:0', ...(cover ? ['-map', '0:v:0?', '-c:v', 'copy', '-disposition:v:0', 'attached_pic'] : []),
      ...(copy ? ['-c:a', 'copy'] : ['-c:a', 'libmp3lame', '-b:a', `${(o.conv && Clipper.conv(o.conv).mp3k) || 320}k`, ...(af.length ? ['-af', af.join(',')] : [])]),
      '-map_metadata', '0', '-metadata', `title=${title}`, '-id3v2_version', '3', '-f', 'mp3', tmp];
  }
  // kf: for a Fast cut with sound changes, the keyframe the picture starts on (the sound starts there too, in sync)
  async mp4Args(o, info, tin, len, tmp, title, t, loud, kf) {
    t = t || Clipper.tools(o, info);
    const head = ['-ss', tin.toFixed(3), '-i', o.file, '-t', (len / t.speed).toFixed(3), '-map', '0:v:0', '-map', '0:a:0?'];
    const tail = ['-map_metadata', '-1', '-metadata', `title=${title}`, '-movflags', '+faststart', '-f', 'mp4', tmp];
    const cv = Clipper.conv(o.conv), fit = num(o.fit) > 0 ? +o.fit : 0;
    const pic = !!t.shape || t.speed !== 1 || !!cv || !!fit || !!o.cap, snd = !!info.audio && Clipper.usesSound(t);
    const ns = o.nsx, noA = o.noSound;          // 2.9.8: a new sound; Loop with the sound off
    if (noA) tail.unshift('-an');
    const nsIn = ns ? [...(ns.from > 0.001 ? ['-ss', ns.from.toFixed(3)] : []), '-i', ns.file] : [];
    const nsAf = (L) => Clipper.aFilters({ ...t, speed: 1 }, L, loud, 48000);
    if (o.cut === 'fast' && !pic && ns && !noA) {
      // the picture copied from the keyframe (like any Fast cut); the new sound lined up with In, so it starts later by In − keyframe
      const st = Number.isFinite(kf) && kf <= tin ? kf : tin, L = len + (tin - st);
      const g = Clipper.nsGraph({ ...ns, at: ns.at + (tin - st) }, L, { neu: '[1:a:0]', orig: info.audio ? '[0:a:0]' : null, af: nsAf(L) });
      return ['-ss', (st > 0 ? st + 0.001 : 0).toFixed(3), '-i', o.file, ...nsIn, '-t', L.toFixed(3), '-filter_complex', g.graph, '-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-avoid_negative_ts', 'make_zero', ...tail];
    }
    if (o.cut === 'fast' && !pic) {
      if (!snd || noA) return [...head, '-c', 'copy', '-avoid_negative_ts', 'make_zero', ...tail];
      // sound only: the picture is copied (from the keyframe, like any Fast cut), the sound re-encoded from the same moment
      const st = Number.isFinite(kf) && kf <= tin ? kf : tin, L = len + (tin - st);
      const af = Clipper.aFilters(t, L, loud, Clipper.rateOf(info));
      return ['-ss', (st > 0 ? st + 0.001 : 0).toFixed(3), '-i', o.file, '-t', L.toFixed(3), '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-af', af.join(','), '-avoid_negative_ts', 'make_zero', ...tail];
    }
    let enc = this.server.encoder || await this.server.detectEncoder();
    // hardware encoders (NVENC / AMF / QSV) keep their quality settings; Media Foundation's fixed quality is
    // fine for live playback but unpredictable for a saved clip, so OpenH264 (in the bundled FFmpeg) is used
    if (!enc || enc === 'h264_mf' || enc === 'libvpx') enc = 'libopenh264';
    const v = info.video || {};
    let ow = t.shape ? t.shape.ow : v.width || 1280, oh = t.shape ? t.shape.oh : v.height || 720;
    const dims = cv ? Clipper.convDims(ow, oh, cv) : null;
    if (dims) { ow = dims.w; oh = dims.h; }
    const mbps = Math.max(1.5, Math.min(cv && cv.q > 1 ? 20 : 12, ow * oh / 1e6 * 4 * (cv ? cv.q : 1)));
    // fit under a size (2.9.5): OpenH264 at the bitrate that lands under it (hardware encoders aim at a quality, not a size)
    let kbps = 0, fdims = null, ffps = 0;
    if (fit) {
      const k = Math.floor(XL.kbpsForBytes(fit, len / t.speed, info.audio ? 192 : 0) * (num(o.fitScale) > 0 ? +o.fitScale : 1));
      if (k < mbps * 1000 || o.fitScale) {
        kbps = Math.max(150, k); enc = 'libopenh264';
        // too few bits for this many pixels: a lower frame rate, then a smaller picture (one more step down on the retry)
        const f = Clipper.fitPicture(ow, oh, Clipper.outFps(info, t, cv), kbps, o.fitScale ? 1 : 0);
        if (f.dims) { fdims = f.dims; ow = f.dims.w; oh = f.dims.h; }
        if (f.fps) ffps = f.fps;
      }
    }
    let va = this.encoderArgs(enc || 'libopenh264');
    if (/libopenh264/.test(enc)) va = va.map(x => (x === '5M' ? (kbps ? `${kbps}k` : `${mbps.toFixed(1)}M`) : x));
    if (kbps) va.push('-rc_mode', 'bitrate');      // OpenH264's default (quality) only loosely follows -b:v
    const hw = !/libopenh264/.test(enc);
    if (hw && cv && cv.preset === 'forx') va.push('-maxrate', `${XL.LIMITS.video.mbps}M`, '-bufsize', `${XL.LIMITS.video.mbps * 2}M`);
    // keep the size; odd sizes can't be encoded, so round down to even numbers (a shape box is even already)
    const af = snd ? Clipper.aFilters(t, len / t.speed, loud, Clipper.rateOf(info)) : [];
    const vf = Clipper.vFilters(t, info, cv || fdims || ffps ? { dims: fdims || dims, fps: ffps || (cv && cv.fps) } : null);
    if (o.cap) vf.push(this.capFilter(o.cap, ow & ~1, oh & ~1));            // 2.9.7: captions, burned in last (on the final picture)
    if (ns && !noA) {             // 2.9.8: the picture as always (-vf), the sound from the new-sound graph
      const L = len / t.speed, g = Clipper.nsGraph(ns, L, { neu: '[1:a:0]', orig: info.audio ? '[0:a:0]' : null, origPre: t.speed !== 1 ? `atempo=${t.speed}` : '', af: nsAf(L) });
      return ['-ss', tin.toFixed(3), '-i', o.file, ...nsIn, '-t', L.toFixed(3), '-map', '0:v:0', ...va, '-vf', vf.join(','), '-filter_complex', g.graph, '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', ...tail];
    }
    return [...head, ...va, '-vf', vf.join(','), '-c:a', 'aac', '-b:a', '192k', ...(af.length ? ['-af', af.join(',')] : []), ...tail];
  }
  // GIF: one palette made for the clip (palettegen / paletteuse), no sound, loops unless told not to
  gifArgs(o, info, tin, len, tmp, t) {
    t = t || Clipper.tools(o, info);
    const g = Clipper.gifOpts(o.gif), f = [];
    if (t.shape) f.push(Clipper.shapeChain(t.shape.whole ? { ...t.shape, ow: even(t.shape.ow / 2), oh: even(t.shape.oh / 2) } : t.shape, 'g'));   // whole picture: half size is plenty for a GIF
    if (t.speed !== 1) f.push(`setpts=PTS/${t.speed}`);
    f.push(`fps=${g.fps}`);
    const sw = t.shape ? (t.shape.whole ? even(t.shape.ow / 2) : t.shape.w) : 0, sh = t.shape ? (t.shape.whole ? even(t.shape.oh / 2) : t.shape.h) : 0;
    const srcW = sw || (info.video && info.video.width) || 0, srcH = sh || (info.video && info.video.height) || 0;
    if (g.w && (!srcW || g.w < srcW)) f.push(`scale=${g.w}:-2:flags=lanczos`);
    if (o.cap && srcW && srcH) { const w = g.w && g.w < srcW ? g.w : srcW; f.push(this.capFilter(o.cap, w, Math.round(srcH * w / srcW / 2) * 2)); }   // 2.9.7
    const use = g.colors <= 64 ? 'paletteuse=dither=bayer:bayer_scale=4' : 'paletteuse=dither=sierra2_4a';
    return ['-ss', tin.toFixed(3), '-i', o.file, '-t', (len / t.speed).toFixed(3), '-an', '-sn',
      '-filter_complex', `[0:v:0]${f.join(',')},split[a][b];[a]palettegen=max_colors=${g.colors}[p];[b][p]${use}`, '-loop', g.loop ? '0' : '-1', '-f', 'gif', tmp];
  }
  // 2.9.8: animated WebP (libwebp_anim in the bundled FFmpeg): full colour, no palette, no sound
  webpArgs(o, info, tin, len, tmp, t) {
    t = t || Clipper.tools(o, info);
    const g = Clipper.webpOpts(o.webp), f = [];
    if (t.shape) f.push(Clipper.shapeChain(t.shape.whole ? { ...t.shape, ow: even(t.shape.ow / 2), oh: even(t.shape.oh / 2) } : t.shape, 'w'));
    if (t.speed !== 1) f.push(`setpts=PTS/${t.speed}`);
    f.push(`fps=${g.fps}`);
    const sw = t.shape ? (t.shape.whole ? even(t.shape.ow / 2) : t.shape.w) : 0, sh = t.shape ? (t.shape.whole ? even(t.shape.oh / 2) : t.shape.h) : 0;
    const srcW = sw || (info.video && info.video.width) || 0, srcH = sh || (info.video && info.video.height) || 0;
    if (g.w && (!srcW || g.w < srcW)) f.push(`scale=${g.w}:-2:flags=lanczos`);
    if (o.cap && srcW && srcH) { const w = g.w && g.w < srcW ? g.w : srcW; f.push(this.capFilter(o.cap, w, Math.round(srcH * w / srcW / 2) * 2)); }
    return ['-ss', tin.toFixed(3), '-i', o.file, '-t', (len / t.speed).toFixed(3), '-an', '-sn', '-vf', f.join(','),
      '-c:v', 'libwebp_anim', '-quality', String({ small: 60, normal: 75, best: 90 }[g.q]), '-loop', g.loop ? '0' : '1', '-f', 'webp', tmp];
  }
  // About how big the GIF (2.9.8: or WebP) will be: a 1-second test (of the saved clip's time) from the middle of the clip
  async gifEstimate(o) {
    o = o || {};
    const info = typeof o.file === 'string' && fs.existsSync(o.file) ? await this.server.probe(o.file) : null;
    if (!info || !info.hasVideo) return { ok: false, error: 'There’s no video in this file.' };
    const W = o.kind === 'webp', t = Clipper.tools(o, info), g = W ? Clipper.webpOpts(o.webp) : Clipper.gifOpts(o.gif);
    const tin = Math.max(0, num(o.in) || 0), tout = Math.min(info.duration || Infinity, num(o.out)), len = tout - tin;
    if (!(len >= 0.1)) return { ok: false, error: 'The clip is too short.' };
    const sl = Math.min(len, t.speed), start = tin + Math.max(0, (len - sl) / 2);
    const key = JSON.stringify([W ? 'webp' : 'gif', o.file, start.toFixed(2), sl.toFixed(2), t.shape, t.speed, g]);
    if (!this.gifCache) this.gifCache = new Map();
    let per = this.gifCache.get(key);
    if (per == null) {
      const tmp = path.join(os.tmpdir(), `slopamp-gif-test-${process.pid}-${(this.gifN = (this.gifN || 0) + 1)}.${W ? 'webp' : 'gif'}`);
      const r = await this.run(['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...(W ? this.webpArgs(o, info, start, sl, tmp, t) : this.gifArgs(o, info, start, sl, tmp, t))], 60000);
      let size = 0; try { size = fs.statSync(tmp).size; } catch (_) {}
      this.rm(tmp);
      if (r.code !== 0 || !size) { this.log('gif estimate failed', r.stderr.slice(-300)); return { ok: false, error: `Couldn’t make the test ${W ? 'WebP' : 'GIF'}.` }; }
      per = size / sl;           // bytes per second of the original's time
      if (this.gifCache.size > 60) this.gifCache.delete(this.gifCache.keys().next().value);
      this.gifCache.set(key, per);
    }
    return { ok: true, bytes: Math.round(per * len) };
  }

  // o: { job, file, in, out, kind: 'mp3'|'mp4'|'gif', name, fadeIn, fadeOut, quality: 'copy'|'320', cut: 'exact'|'fast',
  //      alsoMp3, srcTitle, item: { type, vid, url },
  //      2.9.4: speed, vol, even, shape: { ratio, x, y, w, h, up }, gif: { w, fps, loop, colors } }
  async save(o) {
    o = o || {};
    const job = String(o.job || Date.now());
    const info = typeof o.file === 'string' && fs.existsSync(o.file) ? await this.server.probe(o.file) : null;
    if (!info) return { ok: false, error: 'The file isn’t there any more.' };
    const dur = info.duration || 0;
    const whole = !!o.whole;                 // 2.9.5 Convert: the whole file, no trimming
    if (whole) { o.in = 0; o.out = dur; o.cut = 'exact'; o.conv = o.conv || {}; }
    else delete o.conv;
    const tin = Math.max(0, num(o.in)), tout = Math.min(dur || Infinity, num(o.out));
    if (!(tout - tin >= 0.1)) return { ok: false, error: 'The clip is too short.' };
    const kind = ['mp4', 'gif', 'webp'].includes(o.kind) ? o.kind : 'mp3';
    if (num(o.fit) > 0 && kind === 'mp4') o.cut = 'exact';         // fitting under a size re-encodes
    if (kind !== 'mp3' && !info.hasVideo) return { ok: false, error: `There’s no video in this file. Save it as MP3.` };
    if (kind === 'mp3' && !info.audio) return { ok: false, error: 'There’s no sound in this file.' };
    if (kind === 'mp4' && o.cut === 'fast' && !(info.video && info.video.codec === 'h264' && /mp4|mov/.test(info.format))) o.cut = 'exact';
    const t = Clipper.tools(o, info);
    // 2.9.7: captions (MP4 and GIF): the lines inside the clip, in its own time
    const caps = kind !== 'mp3' ? Clipper.capClean(o.caps) : null, capLines = caps ? Clipper.capMap(caps, tin, tout, t.speed, 0) : [];
    const cap = capLines.length ? { dir: this.capDir(), lines: capLines, style: caps } : null;
    if (kind === 'mp4' && o.cut === 'fast' && (t.shape || t.speed !== 1 || cap)) o.cut = 'exact';     // Shape, Speed and captions change the picture
    const len = tout - tin, lenOut = len / t.speed;
    // 2.9.8: a new sound (MP4 only), Loop (MP4 clips, not Convert)
    const nsx = kind === 'mp4' ? await this.nsPrep(o.ns) : null;
    if (nsx && nsx.error) { if (cap) this.rmDir(cap.dir); return { ok: false, error: nsx.error }; }
    const rep = kind === 'mp4' && !whole ? Clipper.repOpts(o.rep, lenOut) : null;
    if (rep && rep.boom && lenOut > 15.05) { if (cap) this.rmDir(cap.dir); return { ok: false, error: 'Boomerang works on clips up to 15 s: make the clip shorter.' }; }
    if (rep) o.fit = 0;                       // a loop isn't fitted under a size
    const tS = rep && !rep.sound ? { ...t, vol: 0, even: false, fadeIn: 0, fadeOut: 0 } : t;
    const dirs = this.dirs();
    const base = ((String(o.name || '').trim() && this.fileSafe(String(o.name)).slice(0, 150)) || Clipper.cutName(path.basename(o.file).replace(/\.[^.]+$/, ''), tin, tout)).replace(/\.(mp3|mp4|gif|webp)$/i, '');
    const steps = [{ kind, dir: whole ? dirs.conv : kind === 'mp4' ? dirs.mp4 : kind === 'gif' || kind === 'webp' ? dirs.gif : dirs.mp3, ext: `.${kind}` }];
    if (kind === 'mp4' && o.alsoMp3 && info.audio && !nsx && !rep) steps.push({ kind: 'mp3', dir: whole ? dirs.conv : dirs.mp3, ext: '.mp3' });
    const files = [];
    if (this.preCanceled && this.preCanceled.delete(job)) return { ok: false, canceled: true, files };
    this.jobs.set(job, { canceled: false });
    try {
      // Even out the volume, pass 1: measure the clip (the first part of the progress bar), unless it's been measured
      let loud = null, kf = null, w0 = 0;
      if (nsx && tS.even) {
        // 2.9.8: with a new sound, measure what the clip will sound like (the new sound, or the mix)
        w0 = 0.25;
        const g = Clipper.nsGraph(nsx, lenOut, { neu: '[1:a:0]', orig: info.audio ? '[0:a:0]' : null, origPre: t.speed !== 1 ? `atempo=${t.speed}` : '', af: [] });
        const r = await this.runJob(job, ['-nostdin', '-hide_banner', '-nostats', '-progress', 'pipe:1', '-ss', tin.toFixed(3), '-i', o.file, ...(nsx.from > 0.001 ? ['-ss', nsx.from.toFixed(3)] : []), '-i', nsx.file, '-t', lenOut.toFixed(3),
          '-filter_complex', `${g.graph};[aout]${LOUD}:print_format=json[lo]`, '-map', '[lo]', '-f', 'null', '-'], lenOut, (p) => this.send({ type: 'progress', job, pct: Math.round(p * w0 * 100) }));
        if (this.jobs.get(job).canceled) return { ok: false, canceled: true, files };
        loud = Clipper.parseLoud(r.stderr);
        if (!loud) { this.log('clip loudness (new sound) failed', r.stderr.slice(-400)); return { ok: false, error: 'Couldn’t measure the sound to even it out.', files }; }
        if (loud.silent) loud = null;
      } else if (kind !== 'gif' && kind !== 'webp' && tS.even && info.audio) {
        const key = this.loudKey(o.file, tin, len);
        loud = this.loudCache && this.loudCache.get(key);
        if (!loud) {
          w0 = 0.25;
          const r = await this.runJob(job, ['-progress', 'pipe:1', ...this.loudArgs(o.file, tin, len)], len, (p) => this.send({ type: 'progress', job, pct: Math.round(p * w0 * 100) }));
          if (this.jobs.get(job).canceled) return { ok: false, canceled: true, files };
          loud = Clipper.parseLoud(r.stderr);
          if (!loud) { this.log('clip loudness failed', r.stderr.slice(-400)); return { ok: false, error: 'Couldn’t measure the sound to even it out.', files }; }
          if (!this.loudCache) this.loudCache = new Map();
          this.loudCache.set(key, loud);
        }
        if (loud.silent) loud = null;          // nothing to even out (silence)
      }
      if (kind === 'mp4' && o.cut === 'fast' && ((info.audio && Clipper.usesSound(tS)) || nsx)) kf = await this.keyframeBefore(o.file, tin);
      for (let i = 0; i < steps.length; i++) {
        const st = steps[i];
        fs.mkdirSync(st.dir, { recursive: true });
        const final = this.uniquePath(st.dir, base, st.ext), tmp = `${final}.part`;
        const title = path.basename(final, st.ext);
        const fo = { ...o, file: o.file, ...(st.kind === 'mp4' ? {} : { fit: 0 }), cap: st.kind === 'mp3' ? null : cap, nsx: st.kind === 'mp4' ? nsx : null, noSound: st.kind === 'mp4' && !!rep && !rep.sound };
        const loopIt = st.kind === 'mp4' && rep, out = loopIt ? `${final}.base.part` : tmp;     // 2.9.8: a loop is made from the clip
        const span = [w0 + (1 - w0) * i / steps.length, w0 + (1 - w0) * (i + 1) / steps.length];
        const fit = st.kind === 'mp4' && num(o.fit) > 0 ? +o.fit : 0;
        let r, tries = 0;
        for (;;) {
          const args = st.kind === 'mp3' ? this.mp3Args(fo, info, tin, len, tmp, title, t, loud)
            : st.kind === 'gif' ? this.gifArgs(fo, info, tin, len, tmp, t) : st.kind === 'webp' ? this.webpArgs(fo, info, tin, len, tmp, t)
              : await this.mp4Args(fo, info, tin, len, out, title, tS, loud, kf);
          const sp = loopIt ? [span[0], span[0] + (span[1] - span[0]) * (rep.boom ? 0.5 : 0.85)] : span;
          r = await this.runJob(job, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-progress', 'pipe:1', '-nostats', ...args], lenOut, (p) => this.send({ type: 'progress', job, pct: Math.round((sp[0] + (sp[1] - sp[0]) * p) * 100), ...(tries ? { again: true } : {}) }), fo.cap ? fo.cap.dir : undefined);
          if (this.jobs.get(job).canceled) { this.rm(out); this.rm(tmp); return { ok: false, canceled: true, files }; }
          if (r.code === 0 && fs.existsSync(out) && loopIt) {
            r = await this.loopMake(job, out, tmp, rep, title, (p) => this.send({ type: 'progress', job, pct: Math.round((sp[1] + (span[1] - sp[1]) * p) * 100) }));
            if (this.jobs.get(job) && this.jobs.get(job).canceled) { this.rm(tmp); return { ok: false, canceled: true, files }; }
          }
          if (r.code !== 0 || !fs.existsSync(tmp)) break;
          // still over the size it should fit under: once more, at a bitrate lowered by how much it missed
          const got = fs.statSync(tmp).size;
          if (!fit || got <= fit || tries) break;
          tries++;
          fo.fitScale = (num(fo.fitScale) > 0 ? +fo.fitScale : 1) * (fit / got) * 0.95;
          this.log(`clip fit: ${got} > ${fit}, trying again at ${(fo.fitScale * 100).toFixed(0)}%`);
        }
        if (r.code !== 0 || !fs.existsSync(tmp)) {
          this.rm(tmp); if (out !== tmp) this.rm(out);
          this.log(`clip ${st.kind} failed`, r.stderr.slice(-400));
          return { ok: false, error: `Couldn’t save the ${{ mp4: 'video', gif: 'GIF', webp: 'WebP', mp3: 'MP3' }[st.kind]}${whole ? '' : ' clip'}.`, files };
        }
        fs.renameSync(tmp, final);
        const size = fs.statSync(final).size;
        // 2.9.7 (7D): the captions also as a .srt next to an MP4 (not burned in: for X's own captions)
        let srt = null;
        if (st.kind === 'mp4' && cap && caps.srt) { srt = final.replace(/\.mp4$/i, '.srt'); try { fs.writeFileSync(srt, '\ufeff' + Clipper.srtText(capLines), 'utf8'); } catch (e) { this.log('srt failed', e.message); srt = null; } }
        const durOut = loopIt ? rep.total : lenOut;
        files.push({ path: final, kind: st.kind, duration: durOut, size, ...(loopIt ? { loop: { n: rep.n, boom: rep.boom } } : {}), ...(fo.nsx ? { newSound: true } : {}), ...(whole ? { converted: true } : {}), ...(fit ? { fit, fits: size <= fit, tries: tries + 1 } : {}), ...(srt ? { srt } : {}), ...(st.kind !== 'mp3' && cap ? { captions: capLines.length } : {}) });
        const idx = this.getIndex();
        idx[final] = { src: o.file, srcTitle: String(o.srcTitle || '').slice(0, 300), in: +tin.toFixed(3), out: +tout.toFixed(3), kind: st.kind, dur: +durOut.toFixed(3), at: Date.now(),
          ...(loopIt ? { rep: { n: rep.n, boom: rep.boom, sound: rep.sound, upTo: rep.upTo } } : {}),
          ...(fo.nsx ? { ns: { file: nsx.file, mode: nsx.mode, from: nsx.from, at: nsx.at, vol: nsx.vol, origVol: nsx.origVol, short: nsx.short, fade: nsx.fade } } : {}),
          ...(t.speed !== 1 ? { speed: t.speed } : {}), ...(whole ? { conv: Clipper.conv(o.conv).preset } : {}),
          ...(st.kind !== 'mp3' && cap ? { caps: { lines: caps.lines.filter(l => l.b > tin && l.a < tout).slice(0, 3000), pos: caps.pos, size: caps.size }, ...(srt ? { srt } : {}) } : {}),
          ...(o.item && typeof o.item === 'object' && /^(youtube|x)$/.test(o.item.type) ? { item: { type: o.item.type, vid: String(o.item.vid || '').slice(0, 40), url: String(o.item.url || '').slice(0, 300) } } : {}) };
        this.setIndex(idx);
      }
      this.send({ type: 'progress', job, pct: 100 });
      return { ok: true, files };
    } finally { this.jobs.delete(job); if (cap) this.rmDir(cap.dir); }
  }
  rmDir(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }
  // 2.9.8 Loop: base (the clip, made as usual) → out. Boomerang = the clip then the clip backwards (re-encoded once);
  // the repeats are joined by the concat demuxer, streams copied (no re-encode). Returns { code, stderr }.
  async loopMake(job, base, out, rep, title, onPct) {
    const parts = [base];
    try {
      let unit = base;
      if (rep.boom) {
        const info = await this.server.probe(base), v = (info && info.video) || {}, a = info && info.audio;
        let enc = this.server.encoder || await this.server.detectEncoder();
        if (!enc || enc === 'h264_mf' || enc === 'libvpx') enc = 'libopenh264';
        const mbps = Math.max(1.5, Math.min(12, (v.width || 1280) * (v.height || 720) / 1e6 * 4));
        const boom = `${out}.boom.part`; parts.push(boom);
        const g = `[0:v:0]split[bf][bb];[bb]reverse[br];[bf][br]concat=n=2:v=1:a=0[bv]${a ? ';[0:a:0]asplit[af][ab];[ab]areverse[ar];[af][ar]concat=n=2:v=0:a=1[ba]' : ''}`;
        let r;
        for (let attempt = 0; attempt < 2; attempt++) {
          let va = this.encoderArgs(enc);
          if (/libopenh264/.test(enc)) va = va.map(x => (x === '5M' ? `${mbps.toFixed(1)}M` : x));
          r = await this.runJob(job, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-progress', 'pipe:1', '-nostats', '-i', base, '-filter_complex', g, '-map', '[bv]',
            ...(a ? ['-map', '[ba]', '-c:a', 'aac', '-b:a', '192k'] : []), ...va, '-map_metadata', '-1', '-movflags', '+faststart', '-f', 'mp4', boom], ((info && info.duration) || 1) * 2, (p) => onPct(p * (rep.n > 1 ? 0.8 : 1)));
          if ((this.jobs.get(job) || {}).canceled) return { code: 1, stderr: 'canceled' };
          if (r.code === 0 && fs.existsSync(boom)) break;
          this.rm(boom); this.log(`boomerang failed with ${enc}`, r.stderr.slice(-400));
          if (enc === 'libopenh264') return r;
          enc = 'libopenh264';
        }
        unit = boom;
      }
      if (rep.n <= 1) { fs.renameSync(unit, out); return { code: 0, stderr: '' }; }
      const list = `${out}.list.txt`; parts.push(list);
      const q = (f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
      fs.writeFileSync(list, Array.from({ length: rep.n }, () => q(unit)).join('\n') + '\n', 'utf8');
      const r = await this.runJob(job, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-progress', 'pipe:1', '-nostats', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy',
        '-map_metadata', '-1', '-metadata', `title=${title}`, '-movflags', '+faststart', '-f', 'mp4', out], rep.total, (p) => onPct((rep.boom ? 0.8 : 0) + p * (rep.boom ? 0.2 : 1)));
      return r;
    } finally { for (const f of parts) this.rm(f); }
  }

  // ---------- 2.9.7 Join v1 (6A–6I) ----------
  // Sections of the file open in CLIP, stills (a SHOTS frame or any picture) and title cards (PNGs SlopAMP drew), one
  // after the other in one MP4. Everything is re-encoded to one size and frame rate: the first section's (after
  // Shape), or 1080p / 720p / 9:16. A different shape is letterboxed (black bars) or cropped to fill. Stills and cards
  // are silent, or the song keeps going under them (the sound from where the section before them ended).
  // Shape / Sound / Speed / Captions apply to the whole result.
  // items: [{ type: 's', in, out } | { type: 'p', path, dur } | { type: 'c', png: data URL, dur, fade, spec }]
  static joinItems(list, dur) {
    const out = [];
    for (const it of (Array.isArray(list) ? list : []).slice(0, 60)) {
      if (!it || typeof it !== 'object') continue;
      if (it.type === 's') { const a = Math.max(0, num(it.in)), b = Math.min(dur || Infinity, num(it.out)); if (b - a >= 0.1) out.push({ type: 's', in: a, out: b }); }
      else if (it.type === 'p' || it.type === 'c') {
        const d = Math.max(0.5, Math.min(30, num(it.dur) || 2.5));
        if (it.type === 'p' && typeof it.path === 'string' && /\.(png|jpe?g|webp|bmp|gif)$/i.test(it.path) && fs.existsSync(it.path)) out.push({ type: 'p', path: it.path, dur: d });
        if (it.type === 'c' && typeof it.png === 'string' && /^data:image\/png;base64,/.test(it.png)) out.push({ type: 'c', png: it.png, dur: d, fade: !!it.fade, spec: it.spec && typeof it.spec === 'object' ? it.spec : null });
      }
    }
    return out;
  }
  // the size and frame rate of the result
  static joinSize(o, info, t) {
    const v = info.video || {};
    const f = { '1080': [1920, 1080], '720': [1280, 720], '916': [1080, 1920] }[String(o.size)];
    const [W, H] = f || (t.shape ? [t.shape.ow, t.shape.oh] : [even(v.width || 1280), even(v.height || 720)]);
    const F = Math.min(60, Math.round(Clipper.outFps(info, t, null) * 1000) / 1000) || 30;
    return { W, H, F };
  }
  // the ffmpeg command: one input per piece, one filter graph (fit, frame rate, sound) and concat.
  // audioOnly: for measuring the loudness first (Even out the volume)
  static joinGraph(o, info, t, items, { W, H, F }, audioOnly, cards) {
    const ins = [], vf = [], af = [], parts = [], hasA = !!info.audio, sr = 48000;
    // 2.9.8: Letterbox / Blurred fill / Crop to fill
    const fitK = (k) => Clipper.fitChain(o.fit === 'crop' ? 'crop' : o.fit === 'blur' ? 'blur' : 'bars', W, H, { blur: 'soft', dark: true }, `j${k}`);
    const tail = `fps=${F},format=yuv420p,setsar=1`;
    const aNorm = (d) => `aresample=${sr},aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=0:${d.toFixed(3)},asetpts=PTS-STARTPTS`;
    const s = t.shape;
    const crop = (k) => (s ? `${Clipper.shapeChain(s, `s${k}`)},` : '');
    let n = 0, song = null, total = 0;
    items.forEach((it, k) => {
      if (it.type === 's') {
        const len = it.out - it.in, d = len / t.speed;
        ins.push('-ss', it.in.toFixed(3), '-t', len.toFixed(3), '-i', o.file); const i = n++;
        if (!audioOnly) vf.push(`[${i}:v:0]setpts=PTS-STARTPTS,${crop(k)}${t.speed !== 1 ? `setpts=PTS/${t.speed},` : ''}${fitK(k)},${tail},trim=duration=${d.toFixed(3)},setpts=PTS-STARTPTS[v${k}]`);
        if (hasA) af.push(`[${i}:a:0]asetpts=PTS-STARTPTS${t.speed !== 1 ? `,atempo=${t.speed}` : ''},${aNorm(d)}[a${k}]`);
        song = it.out; total += d;
      } else {
        const d = it.dur;
        if (!audioOnly) {
          ins.push('-loop', '1', '-framerate', String(F), '-t', d.toFixed(3), '-i', it.type === 'c' ? cards[k] : it.path); const i = n++;
          const fade = it.type === 'c' && it.fade ? `,fade=t=in:st=0:d=0.4,fade=t=out:st=${Math.max(0, d - 0.4).toFixed(3)}:d=0.4` : '';
          vf.push(`[${i}:v:0]${fitK(k)},${tail}${fade},trim=duration=${d.toFixed(3)},setpts=PTS-STARTPTS[v${k}]`);
        }
        if (hasA) {
          // "Keep the song going" (6F): the sound goes on from where the section before ended (silence past the end)
          if (o.under === 'keep' && song != null && song < (info.duration || 0) - 0.05) {
            const len = Math.min(d * t.speed, (info.duration || 0) - song);
            ins.push('-ss', song.toFixed(3), '-t', len.toFixed(3), '-i', o.file); const i = n++;
            af.push(`[${i}:a:0]asetpts=PTS-STARTPTS${t.speed !== 1 ? `,atempo=${t.speed}` : ''},${aNorm(d)}[a${k}]`);
            song += len;
          } else af.push(`anullsrc=r=${sr}:cl=stereo,atrim=0:${d.toFixed(3)},asetpts=PTS-STARTPTS[a${k}]`);
        }
        total += d;
      }
      parts.push(k);
    });
    const N = parts.length;
    const cat = audioOnly ? `${parts.map(k => `[a${k}]`).join('')}concat=n=${N}:v=0:a=1[ac]`
      : `${parts.map(k => `[v${k}]${hasA ? `[a${k}]` : ''}`).join('')}concat=n=${N}:v=1:a=${hasA ? 1 : 0}[vc]${hasA ? '[ac]' : ''}`;
    return { ins, graph: [...vf, ...af, cat], total, hasA };
  }
  async joinSave(o) {
    o = o || {};
    const job = String(o.job || Date.now());
    const info = typeof o.file === 'string' && fs.existsSync(o.file) ? await this.server.probe(o.file) : null;
    if (!info) return { ok: false, error: 'The file isn’t there any more.' };
    if (!info.hasVideo) return { ok: false, error: 'Join makes an MP4: this file has no video.' };
    const items = Clipper.joinItems(o.items, info.duration || 0), secs = items.filter(i => i.type === 's');
    if (!secs.length) return { ok: false, error: 'Add a section of the video first (mark In / Out, then + Section).' };
    const t = Clipper.tools(o, info), size = Clipper.joinSize(o, info, t);
    const nsx = await this.nsPrep(o.ns);              // 2.9.8: Change the sound, on the whole joined video
    if (nsx && nsx.error) return { ok: false, error: nsx.error };
    const dirs = this.dirs(), work = path.join(os.tmpdir(), `slopamp-join-${process.pid}-${(this.joinN = (this.joinN || 0) + 1)}`);
    this.rmDir(work); fs.mkdirSync(work, { recursive: true });
    // title cards: the PNGs the window drew, saved as pictures
    const cards = {};
    items.forEach((it, k) => { if (it.type === 'c') { cards[k] = path.join(work, `card-${k + 1}.png`); fs.writeFileSync(cards[k], Buffer.from(it.png.split(',')[1], 'base64')); } });
    // captions: each section's lines, at the section's place in the result (stills and cards have none)
    const caps = Clipper.capClean(o.caps); let capLines = [];
    if (caps) { let off = 0; for (const it of items) { if (it.type === 's') { capLines.push(...Clipper.capMap(caps, it.in, it.out, t.speed, off)); off += (it.out - it.in) / t.speed; } else off += it.dur; } }
    const cap = capLines.length ? { dir: work, lines: capLines, style: caps } : null;
    const base = ((String(o.name || '').trim() && this.fileSafe(String(o.name)).slice(0, 150)) || `${path.basename(o.file).replace(/\.[^.]+$/, '')} (joined)`).replace(/\.mp4$/i, '');
    fs.mkdirSync(dirs.mp4, { recursive: true });
    const final = this.uniquePath(dirs.mp4, base, '.mp4'), tmp = `${final}.part`;
    if (this.preCanceled && this.preCanceled.delete(job)) { this.rmDir(work); return { ok: false, canceled: true, files: [] }; }
    this.jobs.set(job, { canceled: false });
    try {
      const g = Clipper.joinGraph(o, info, t, items, size, false, cards);
      // Even out the volume: measure the joined sound first (two passes, like a clip)
      let loud = null, w0 = 0;
      if (t.even && (g.hasA || nsx)) {
        w0 = 0.25;
        const ga = Clipper.joinGraph(o, info, t, items, size, true, cards);
        let gr = `${ga.graph.join(';')};[ac]${LOUD}:print_format=json[ao]`;
        if (nsx) {
          const ni = ga.ins.filter(x => x === '-i').length;
          ga.ins.push(...(nsx.from > 0.001 ? ['-ss', nsx.from.toFixed(3)] : []), '-i', nsx.file);
          gr = `${ga.hasA ? `${ga.graph.join(';')};` : ''}${Clipper.nsGraph(nsx, g.total, { neu: `[${ni}:a:0]`, orig: ga.hasA ? '[ac]' : null, af: [], sink: true }).graph};[aout]${LOUD}:print_format=json[ao]`;
        }
        const r = await this.runJob(job, ['-nostdin', '-hide_banner', '-nostats', '-progress', 'pipe:1', ...ga.ins, '-filter_complex', gr, '-map', '[ao]', '-f', 'null', '-'], g.total, (p) => this.send({ type: 'progress', job, pct: Math.round(p * w0 * 100) }), work);
        if (this.jobs.get(job).canceled) return { ok: false, canceled: true, files: [] };
        loud = Clipper.parseLoud(r.stderr);
        if (!loud) { this.log('join loudness failed', r.stderr.slice(-400)); return { ok: false, error: 'Couldn’t measure the sound to even it out.', files: [] }; }
        if (loud.silent) loud = null;
      }
      const post = [];
      const vOut = cap ? '[vo]' : '[vc]';
      if (cap) post.push(`[vc]${this.capFilter(cap, size.W, size.H)}[vo]`);
      const afl = g.hasA || nsx ? Clipper.aFilters({ ...t, speed: 1 }, g.total, loud, 48000) : [];
      if (nsx) {               // 2.9.8: the new sound under (or instead of) the whole joined video
        const ni = g.ins.filter(x => x === '-i').length;
        g.ins.push(...(nsx.from > 0.001 ? ['-ss', nsx.from.toFixed(3)] : []), '-i', nsx.file);
        post.push(Clipper.nsGraph(nsx, g.total, { neu: `[${ni}:a:0]`, orig: g.hasA ? '[ac]' : null, af: afl, sink: true }).graph.replace('[aout]', '[ao]'));
        g.hasA = true;
      } else if (g.hasA) post.push(`[ac]${afl.length ? afl.join(',') : 'anull'}[ao]`);
      let enc = this.server.encoder || await this.server.detectEncoder();
      if (!enc || enc === 'h264_mf' || enc === 'libvpx') enc = 'libopenh264';
      const mbps = Math.max(1.5, Math.min(12, size.W * size.H / 1e6 * 4));
      let r;
      for (let attempt = 0; attempt < 2; attempt++) {
        let va = this.encoderArgs(enc);
        if (/libopenh264/.test(enc)) va = va.map(x => (x === '5M' ? `${mbps.toFixed(1)}M` : x));
        const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-progress', 'pipe:1', '-nostats', ...g.ins, '-filter_complex', [...g.graph, ...post].join(';'),
          '-map', vOut, ...(g.hasA ? ['-map', '[ao]', '-c:a', 'aac', '-b:a', '192k'] : []), ...va, '-r', String(size.F),
          '-map_metadata', '-1', '-metadata', `title=${path.basename(final, '.mp4')}`, '-movflags', '+faststart', '-f', 'mp4', tmp];
        r = await this.runJob(job, args, g.total, (p) => this.send({ type: 'progress', job, pct: Math.round((w0 + (1 - w0) * p) * 100) }), work);
        if (this.jobs.get(job).canceled) { this.rm(tmp); return { ok: false, canceled: true, files: [] }; }
        if (r.code === 0 && fs.existsSync(tmp)) break;
        this.rm(tmp);
        this.log(`join failed with ${enc}`, r.stderr.slice(-600));
        if (enc === 'libopenh264') break;
        enc = 'libopenh264';       // the hardware encoder said no: OpenH264 (software) instead
      }
      if (r.code !== 0 || !fs.existsSync(tmp)) return { ok: false, error: 'Couldn’t join the video.', files: [] };
      fs.renameSync(tmp, final);
      const fsize = fs.statSync(final).size;
      let srt = null;
      if (cap && caps.srt) { srt = final.replace(/\.mp4$/i, '.srt'); try { fs.writeFileSync(srt, '﻿' + Clipper.srtText(capLines), 'utf8'); } catch (e) { this.log('srt failed', e.message); srt = null; } }
      const idx = this.getIndex();
      idx[final] = { src: o.file, srcTitle: String(o.srcTitle || '').slice(0, 300), in: +secs[0].in.toFixed(3), out: +secs[secs.length - 1].out.toFixed(3), kind: 'mp4', dur: +g.total.toFixed(3), at: Date.now(),
        ...(t.speed !== 1 ? { speed: t.speed } : {}),
        // 6I: the join list comes back with "Clip again" (cards as what they say, so they can be drawn again)
        join: { items: items.map(it => (it.type === 's' ? { type: 's', in: +it.in.toFixed(3), out: +it.out.toFixed(3) } : it.type === 'p' ? { type: 'p', path: it.path, dur: it.dur } : { type: 'c', dur: it.dur, fade: it.fade, spec: it.spec })),
          size: ['1080', '720', '916'].includes(String(o.size)) ? String(o.size) : 'first', fit: o.fit === 'crop' ? 'crop' : o.fit === 'blur' ? 'blur' : 'letterbox', under: o.under === 'keep' ? 'keep' : 'silence' },
        ...(cap ? { caps: { lines: caps.lines.filter(l => secs.some(x => l.b > x.in && l.a < x.out)).slice(0, 3000), pos: caps.pos, size: caps.size }, ...(srt ? { srt } : {}) } : {}),
        ...(nsx ? { ns: { file: nsx.file, mode: nsx.mode, from: nsx.from, at: nsx.at, vol: nsx.vol, origVol: nsx.origVol, short: nsx.short, fade: nsx.fade } } : {}),
        ...(o.item && typeof o.item === 'object' && /^(youtube|x)$/.test(o.item.type) ? { item: { type: o.item.type, vid: String(o.item.vid || '').slice(0, 40), url: String(o.item.url || '').slice(0, 300) } } : {}) };
      this.setIndex(idx);
      this.send({ type: 'progress', job, pct: 100 });
      this.log(`join: ${path.basename(final)} (${items.length} pieces, ${size.W}x${size.H} ${size.F} fps, ${enc})`);
      return { ok: true, files: [{ path: final, kind: 'mp4', duration: g.total, size: fsize, joined: items.length, w: size.W, h: size.H, ...(srt ? { srt } : {}), ...(cap ? { captions: capLines.length } : {}) }] };
    } finally { this.jobs.delete(job); this.rmDir(work); }
  }
  // what's known about one saved clip (2.9.7: "Clip again" brings back its captions and join list)
  entry(p) { const e = this.getIndex()[p]; return e && typeof e === 'object' ? { caps: e.caps || null, join: e.join || null, speed: e.speed || 1, rep: e.rep || null, ns: e.ns || null } : null; }
  // 2.9.8: one frame of what Shape's whole-picture Fit makes (the preview while paused): a JPEG data URL
  async shapeFrame(o) {
    const info = typeof o.file === 'string' && fs.existsSync(o.file) ? await this.server.probe(o.file) : null;
    if (!info || !info.hasVideo) return null;
    const t = Clipper.tools({ shape: o.shape }, info); if (!t.shape) return null;
    const r = await this.run(['-nostdin', '-hide_banner', '-loglevel', 'error', '-ss', Math.max(0, num(o.t) || 0).toFixed(3), '-i', o.file, '-frames:v', '1',
      '-vf', `${Clipper.shapeChain(t.shape, 'p')},scale=-2:${Math.max(120, Math.min(720, Math.round(num(o.h) || 360)))}`, '-q:v', '4', '-f', 'image2pipe', '-c:v', 'mjpeg', '-'], 30000);
    return r.code === 0 && r.stdout.length ? `data:image/jpeg;base64,${r.stdout.toString('base64')}` : null;
  }
  // 2.9.8: what a file picked as the new sound is (and its URL for the preview)
  async soundInfo(file) {
    if (typeof file !== 'string' || !fs.existsSync(file)) return { ok: false, error: 'The file isn’t there any more.' };
    const info = await this.server.probe(file);
    if (!info || !info.audio || !(info.duration > 0)) return { ok: false, error: 'There’s no sound in that file.' };
    return { ok: true, file, title: (info.title || path.basename(file).replace(/\.[^.]+$/, '')).replace(/\s*\[[\w-]{1,30}\]$/, ''), name: path.basename(file), duration: info.duration, hasVideo: !!info.hasVideo, url: this.urlOf(file) };
  }
  cancel(job) {
    const j = this.jobs.get(String(job));
    if (!j) { (this.preCanceled || (this.preCanceled = new Set())).add(String(job)); return; }   // canceled before it started (2.5)
    j.canceled = true;
    if (j.proc) try { j.proc.kill(); } catch (_) {}
  }
  rm(f) { try { fs.rmSync(f, { force: true }); } catch (_) {} }
  run(args, timeout) {
    return new Promise((resolve) => {
      const p = execFile(this.ffmpeg(), args, { windowsHide: true, timeout, maxBuffer: 96 * 1024 * 1024, encoding: 'buffer' }, (err, stdout, stderr) =>
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout || Buffer.alloc(0), stderr: String(stderr || (err && err.message) || '') }));
      if (this.server.track) this.server.track(p);
    });
  }
  // ffmpeg with -progress pipe:1: reports 0..1 as it goes
  runJob(job, args, len, onPct, cwd) {
    return new Promise((resolve) => {
      const p = spawn(this.ffmpeg(), args, { windowsHide: true, ...(cwd ? { cwd } : {}) });
      const j = this.jobs.get(job); if (j) j.proc = p;
      if (this.server.track) this.server.track(p);
      let err = '', buf = '';
      p.stdout.on('data', (d) => {
        buf += d; const lines = buf.split(/\r?\n/); buf = lines.pop();
        for (const l of lines) { const m = /^out_time_(?:us|ms)=(\d+)/.exec(l); if (m && len > 0) onPct(Math.max(0, Math.min(1, +m[1] / 1e6 / len))); }
      });
      p.stderr.on('data', (d) => { err = (err + d).slice(-16000); });
      const kill = setTimeout(() => { try { p.kill(); } catch (_) {} }, Math.max(600000, len * 20000));
      p.on('error', (e) => { clearTimeout(kill); resolve({ code: 1, stderr: String(e.message) }); });
      p.on('close', (code) => { clearTimeout(kill); resolve({ code: code === null ? 1 : code, stderr: err }); });
    });
  }

  // ---------- X-ready MP4s (2.5, idea #22): xready.js has X's limits ----------
  // Is each video file X-ready? { [file]: assess() | null } (null: not there, or no picture). Cached by mtime + size.
  async xStatus(files) {
    const out = {}, list = [...new Set((Array.isArray(files) ? files : []).filter(f => typeof f === 'string'))].slice(0, 5000);
    let next = 0;
    const one = async (f) => {
      let st; try { st = fs.statSync(f); } catch (_) { out[f] = null; return; }
      const key = `${st.mtimeMs}|${st.size}`, hit = this.xCache.get(f);
      if (hit && hit.key === key) { out[f] = hit.x; return; }
      const info = await this.server.probe(f);
      const x = X.assess(info, st.size);
      this.xCache.set(f, { key, x }); out[f] = x;
    };
    await Promise.all([0, 1, 2].map(async () => { while (next < list.length) await one(list[next++]); }));
    return out;
  }
  forgetX(f) { this.xCache.delete(f); if (this.server.forget) this.server.forget(f); }
  // After a video download: an H.264 picture with Opus (or other) sound gets AAC sound in place (seconds,
  // the picture is copied). Anything else is only checked: a VP9 / AV1 fallback is labelled "not for X".
  async xAfterDownload(file) {
    let st; try { st = fs.statSync(file); } catch (_) { return null; }
    let x = X.assess(await this.server.probe(file), st.size);
    if (!x || x.ready || !(x.videoOk && x.container && !x.audioOk)) return { x, audioFixed: false };
    const tmp = `${file}.xfix.part`;
    const r = await this.run(['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...X.audioFixArgs(file, tmp)], 600000);
    if (r.code !== 0 || !fs.existsSync(tmp)) { this.rm(tmp); this.log('X audio fix failed', file, r.stderr.slice(-300)); return { x, audioFixed: false }; }
    try { fs.renameSync(tmp, file); } catch (e) { this.rm(tmp); this.log('X audio fix: could not replace', file, e.message); return { x, audioFixed: false }; }
    this.forgetX(file);
    st = fs.statSync(file);
    x = X.assess(await this.server.probe(file), st.size);
    this.xCache.set(file, { key: `${st.mtimeMs}|${st.size}`, x });
    this.log(`X audio fix: ${path.basename(file)} now ${x && x.line}`);
    return { x, audioFixed: true };
  }
  xEncoder() {
    const e = this.server.encoder;
    return !e || e === 'h264_mf' || e === 'libvpx' ? 'libopenh264' : e;     // like CLIP exact cut
  }
  // What Fix for X would do to one file (the dialog's "now → for X" table). account (2.9.7): the saved X account
  // ('free' | 'premium'; anything else counts as Free): the length / size warnings follow it.
  async xPlan(file, account) {
    let st; try { st = fs.statSync(file); } catch (_) { return { ok: false, error: 'The file isn’t there any more.' }; }
    const info = await this.server.probe(file);
    const x = X.assess(info, st.size, account);
    if (!x) return { ok: false, error: info ? 'There’s no picture in this file.' : 'SlopAMP can’t read this file.' };
    if (!this.server.encoder && this.server.detectEncoder) await this.server.detectEncoder().catch(() => null);
    const enc = this.xEncoder();
    const names = { h264_nvenc: 'NVIDIA (h264_nvenc)', h264_amf: 'AMD (h264_amf)', h264_qsv: 'Intel (h264_qsv)', libopenh264: 'OpenH264' };
    return { ok: true, file, title: path.basename(file).replace(/\.[^.]+$/, ''), x, plan: X.plan(info, st.size), out: X.outName(file, fs.existsSync), encoder: names[enc] || enc };
  }
  // Fix for X: "<name> (X).mp4" next to the original (kept). o: { job, file }. Progress: { type: 'xprogress', job, pct }.
  async xFix(o) {
    const job = String((o && o.job) || Date.now()), file = o && o.file;
    let st; try { st = fs.statSync(file); } catch (_) { return { ok: false, error: 'The file isn’t there any more.' }; }
    const info = await this.server.probe(file);
    const x = X.assess(info, st.size);
    if (!x) return { ok: false, error: 'There’s no picture in this file.' };
    if (x.ready) return { ok: true, already: true, x };
    const out = X.outName(file, fs.existsSync), tmp = `${out}.part`;
    if (this.preCanceled && this.preCanceled.delete(job)) return { ok: false, canceled: true };
    this.jobs.set(job, { canceled: false });
    try {
      let enc = this.xEncoder();
      for (let attempt = 0; attempt < 2; attempt++) {
        const hw = enc !== 'libopenh264';
        const args = X.ffArgs(info, st.size, file, tmp, this.encoderArgs(enc), hw);
        const r = await this.runJob(job, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-progress', 'pipe:1', '-nostats', ...args], x.duration,
          (p) => this.send({ type: 'xprogress', job, pct: Math.round(p * 100) }));
        if (this.jobs.get(job).canceled) { this.rm(tmp); return { ok: false, canceled: true }; }
        if (r.code === 0 && fs.existsSync(tmp)) {
          fs.renameSync(tmp, out);
          const size = fs.statSync(out).size;
          const nx = X.assess(await this.server.probe(out), size);
          this.log(`Fix for X: ${path.basename(file)} -> ${path.basename(out)} (${enc}; ${nx && nx.line})`);
          return { ok: true, file: out, size, x: nx, encoder: enc };
        }
        this.rm(tmp);
        this.log(`Fix for X failed with ${enc}`, r.stderr.slice(-400));
        if (!hw) {
          const why = /Invalid data|moov atom|could not find codec|Invalid argument/i.test(r.stderr) ? 'the file looks damaged' : 'ffmpeg stopped';
          return { ok: false, error: `${why} (${(r.stderr.trim().split('\n').pop() || '').slice(0, 120)})` };
        }
        enc = 'libopenh264';      // the hardware encoder said no: OpenH264 (software) instead
      }
      return { ok: false, error: 'ffmpeg stopped' };
    } finally { this.jobs.delete(job); }
  }

  // ---------- SHOTS (2.3: SLOP's LOOK, moved into CLIP) ----------
  // Full-size frames from a video file, for references: Downloads\SlopAMP\Shots\<video title>\
  //   ref-01 Singer (person).png, ref-02 Stage (place).png … (the ★ lead is always ref-01, like SLOP).
  // What's known about them (time, name, kind, lead) is in .shots.json in that folder. Burst: 5 frames across the
  // clip into .burst\, the user keeps the good ones. Nothing here touches the video itself.
  shotDir(o) {
    const base = String((o && o.title) || '').trim() || path.basename(String(o && o.file || 'Video')).replace(/\.[^.]+$/, '');
    return path.join(this.dirs().shots, this.fileSafe(base.replace(/\s*\[[\w-]{1,30}\]$/, '')).slice(0, 80));
  }
  shotData(dir) {
    try { const d = JSON.parse(fs.readFileSync(path.join(dir, '.shots.json'), 'utf8')); if (d && Array.isArray(d.shots)) return d; } catch (_) {}
    return { shots: [], next: 1 };
  }
  shotSave(dir, d) {
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, '.shots.json'), tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(d, null, 1)); fs.renameSync(tmp, f);
    if (process.platform === 'win32' && !d.hidden) { d.hidden = true; execFile('attrib', ['+h', f], { windowsHide: true }, () => {}); }
  }
  static shotName(s, i) {
    const clean = (x) => String(x || '').replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 40);
    const name = clean(s.name), kind = SHOT_KINDS.includes(s.kind) ? ` (${s.kind})` : '';
    return `ref-${String(i + 1).padStart(2, '0')}${name ? ` ${name}` : ''}${kind}.png`;
  }
  // lead first, then in the order they were taken; files renamed in two steps so swaps can't overwrite
  shotRenumber(dir, d) {
    d.shots.sort((a, b) => (b.lead ? 1 : 0) - (a.lead ? 1 : 0) || a.n - b.n);
    const moves = d.shots.map((s, i) => ({ s, to: Clipper.shotName(s, i) })).filter(m => m.s.file !== m.to);
    for (const m of moves) { const tmp = `.ren-${m.s.n}.png`; try { fs.renameSync(path.join(dir, m.s.file), path.join(dir, tmp)); m.tmp = tmp; } catch (e) { this.log('shot rename failed', e.message); } }
    for (const m of moves) if (m.tmp) { try { fs.renameSync(path.join(dir, m.tmp), path.join(dir, m.to)); m.s.file = m.to; } catch (e) { this.log('shot rename failed', e.message); } }
  }
  async grabPng(file, t, out) {
    const r = await this.run(['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-ss', Math.max(0, t).toFixed(3), '-i', file, '-frames:v', '1', '-f', 'image2', '-c:v', 'png', out], 60000);
    return r.code === 0 && fs.existsSync(out) && fs.statSync(out).size > 0;
  }
  shotView(dir, d, info) {
    const v = info && info.video;
    const one = (s) => ({ n: s.n, t: s.t, name: s.name || '', kind: s.kind || '', lead: !!s.lead, file: s.file, path: path.join(dir, s.file), url: this.urlOf(path.join(dir, s.file)), w: s.w || (v && v.width) || 0, h: s.h || (v && v.height) || 0 });
    return { dir, shots: d.shots.filter(s => fs.existsSync(path.join(dir, s.file))).map(one),
      burst: (d.burst || []).filter(b => fs.existsSync(path.join(dir, '.burst', b.file))).map(b => ({ t: b.t, path: path.join(dir, '.burst', b.file), url: this.urlOf(path.join(dir, '.burst', b.file)) })) };
  }
  async shots(o) {
    const dir = this.shotDir(o), d = this.shotData(dir);
    return this.shotView(dir, d, await this.server.probe(o.file).catch(() => null));
  }
  async shotAdd(o) {
    const info = typeof o.file === 'string' && fs.existsSync(o.file) ? await this.server.probe(o.file) : null;
    if (!info || !info.hasVideo) return { error: 'There’s no video in this file.' };
    const dir = this.shotDir(o), d = this.shotData(dir);
    fs.mkdirSync(dir, { recursive: true });
    const n = d.next || 1, t = Math.max(0, Math.min(num(o.t) || 0, Math.max(0, (info.duration || 0) - 0.05)));
    const s = { n, t: +t.toFixed(3), name: '', kind: '', lead: !d.shots.length, file: `.new-${n}.png` };
    if (!await this.grabPng(o.file, t, path.join(dir, s.file))) return { error: 'Couldn’t grab that frame.' };
    d.shots.push(s); d.next = n + 1;
    this.shotRenumber(dir, d); this.shotSave(dir, d);
    return { ...this.shotView(dir, d, info), added: n };
  }
  // patch: { name, kind, lead } and/or { dt } (re-grab dt seconds later; 0 = the same moment again)
  async shotSet(o) {
    const info = await this.server.probe(o.file).catch(() => null);
    const dir = this.shotDir(o), d = this.shotData(dir), s = d.shots.find(x => x.n === +o.n);
    if (!s) return { error: 'That shot isn’t there any more.' };
    const p = o.patch || {};
    if (typeof p.name === 'string') s.name = p.name.slice(0, 40);
    if (typeof p.kind === 'string') s.kind = SHOT_KINDS.includes(p.kind) ? p.kind : '';
    if (p.lead) for (const x of d.shots) x.lead = x === s;
    if (Number.isFinite(+p.dt) && p.dt !== null && p.dt !== undefined && info) {
      const t = Math.max(0, Math.min(s.t + (+p.dt), (info.duration || 0) - 0.05));
      const tmp = path.join(dir, `.regrab-${s.n}.png`);
      if (await this.grabPng(o.file, t, tmp)) { fs.renameSync(tmp, path.join(dir, s.file)); s.t = +t.toFixed(3); }
    }
    this.shotRenumber(dir, d); this.shotSave(dir, d);
    return this.shotView(dir, d, info);
  }
  async shotDel(o) {
    const dir = this.shotDir(o), d = this.shotData(dir), s = d.shots.find(x => x.n === +o.n);
    if (s) {
      try { await this.trash(path.join(dir, s.file)); } catch (_) { try { fs.rmSync(path.join(dir, s.file), { force: true }); } catch (__) {} }
      d.shots = d.shots.filter(x => x !== s);
      if (s.lead && d.shots.length) d.shots.sort((a, b) => a.n - b.n)[0].lead = true;
      this.shotRenumber(dir, d); this.shotSave(dir, d);
    }
    return this.shotView(dir, d, await this.server.probe(o.file).catch(() => null));
  }
  // Burst: `count` frames spread across a..b (the clip), as candidates
  async shotBurst(o) {
    const info = typeof o.file === 'string' && fs.existsSync(o.file) ? await this.server.probe(o.file) : null;
    if (!info || !info.hasVideo) return { error: 'There’s no video in this file.' };
    const dir = this.shotDir(o), d = this.shotData(dir), bd = path.join(dir, '.burst');
    try { fs.rmSync(bd, { recursive: true, force: true }); } catch (_) {}
    fs.mkdirSync(bd, { recursive: true });
    if (process.platform === 'win32') execFile('attrib', ['+h', bd], { windowsHide: true }, () => {});
    const count = Math.max(2, Math.min(8, Math.round(num(o.count) || 5)));
    const a = Math.max(0, num(o.a) || 0), b = Math.min(info.duration || 0, num(o.b) || info.duration || 0);
    const times = Array.from({ length: count }, (_, i) => a + (b - a) * (i + 0.5) / count);
    d.burst = [];
    let k = 0;
    for (const t of times) {
      const f = `burst-${++k}.png`;
      if (await this.grabPng(o.file, t, path.join(bd, f))) d.burst.push({ t: +t.toFixed(3), file: f });   // eslint-disable-line no-await-in-loop
    }
    this.shotSave(dir, d);
    return this.shotView(dir, d, info);
  }
  async shotKeep(o) {
    const info = await this.server.probe(o.file).catch(() => null);
    const dir = this.shotDir(o), d = this.shotData(dir), bd = path.join(dir, '.burst');
    const picks = new Set((Array.isArray(o.picks) ? o.picks : []).map(Number));
    (d.burst || []).forEach((b, i) => {
      if (!picks.has(i)) return;
      const n = d.next || 1; d.next = n + 1;
      const s = { n, t: b.t, name: '', kind: '', lead: !d.shots.length, file: `.new-${n}.png` };
      try { fs.renameSync(path.join(bd, b.file), path.join(dir, s.file)); d.shots.push(s); } catch (e) { this.log('burst keep failed', e.message); }
    });
    d.burst = [];
    try { fs.rmSync(bd, { recursive: true, force: true }); } catch (_) {}
    this.shotRenumber(dir, d); this.shotSave(dir, d);
    return this.shotView(dir, d, info);
  }

  // ---------- Library -> CLIPS ----------
  // Every audio file in mp3clips, every video in mp4clips, every GIF in gifs and everything in Converted (2.9.5),
// also ones put there by hand.
  list() {
    const dirs = this.dirs(), idx = this.getIndex(), rows = [];
    let pruned = false;
    for (const [k, dir, re] of [['mp3clip', dirs.mp3, AUDIO_EXT], ['mp4clip', dirs.mp4, VIDEO_EXT], ['gifclip', dirs.gif, GIF_EXT], ['conv', dirs.conv, ANY_EXT]]) {
      if (!dir) continue;
      let names = []; try { names = fs.readdirSync(dir); } catch (_) {}
      for (const n of names) {
        if (!re.test(n) || /\.part$/i.test(n)) continue;
        const full = path.join(dir, n);
        let st; try { st = fs.statSync(full); } catch (_) { continue; }
        if (!st.isFile()) continue;
        const e = idx[full] || {};
        rows.push({ kind: k, ...(k === 'conv' ? { media: GIF_EXT.test(n) ? 'gif' : AUDIO_EXT.test(n) ? 'audio' : 'video' } : {}), path: full, title: n.replace(/\.[^.]+$/, ''), size: st.size, mtime: st.mtimeMs, dur: e.dur || 0, from: e.srcTitle || (e.src ? path.basename(e.src).replace(/\.[^.]+$/, '') : ''),
          src: e.src || '', srcExists: !!(e.src && fs.existsSync(e.src)), in: e.in, out: e.out, item: e.item || null, ...(e.speed ? { speed: e.speed } : {}) });
      }
    }
    for (const f of Object.keys(idx)) if (!fs.existsSync(f)) { delete idx[f]; pruned = true; }
    if (pruned) this.setIndex(idx);
    return rows;
  }
  inClipDir(p) {
    if (typeof p !== 'string') return false;
    const d = this.dirs(), dir = path.dirname(path.resolve(p));
    return dir === path.resolve(d.mp3) || dir === path.resolve(d.mp4) || (!!d.gif && dir === path.resolve(d.gif) && GIF_EXT.test(p)) || (!!d.conv && dir === path.resolve(d.conv) && ANY_EXT.test(p));
  }
  async remove(paths) {
    const out = [], idx = this.getIndex();
    for (const p of Array.isArray(paths) ? paths : []) {
      if (!this.inClipDir(p)) { out.push({ path: p, ok: false, error: 'Not a clip.' }); continue; }
      try {
        if (fs.existsSync(p)) await this.trash(p);
        const srt = idx[p] && idx[p].srt;            // 2.9.7: its captions file goes with it
        if (srt && srt === p.replace(/\.mp4$/i, '.srt') && fs.existsSync(srt)) await this.trash(srt).catch(() => {});
        delete idx[p]; out.push({ path: p, ok: true });
      } catch (e) { out.push({ path: p, ok: false, error: String(e.message || e) }); }
    }
    this.setIndex(idx);
    return out;
  }
  rename(p, name) {
    if (!this.inClipDir(p) || !fs.existsSync(p)) return { error: 'That clip isn’t there any more.' };
    const ext = path.extname(p), clean = !String(name || '').trim() ? '' : this.fileSafe(String(name)).replace(new RegExp(`\\${ext}$`, 'i'), '').slice(0, 150);
    if (!clean) return { error: 'Type a name.' };
    const to = path.join(path.dirname(p), clean + ext);
    if (to === p) return { path: p };
    if (fs.existsSync(to)) return { error: 'There’s already a clip with that name.' };
    fs.renameSync(p, to);
    const idx = this.getIndex();
    if (idx[p]) {
      const e = idx[p];
      if (e.srt && e.srt === p.replace(/\.mp4$/i, '.srt') && fs.existsSync(e.srt)) {     // 2.9.7: its captions file too
        const s2 = to.replace(/\.mp4$/i, '.srt');
        try { if (!fs.existsSync(s2)) { fs.renameSync(e.srt, s2); e.srt = s2; } } catch (_) {}
      }
      idx[to] = e; delete idx[p]; this.setIndex(idx);
    }
    return { path: to };
  }
}

module.exports = { Clipper, AUDIO_EXT, VIDEO_EXT, GIF_EXT };
