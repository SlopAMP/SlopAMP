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
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');
const X = require('./xready');   // 2.5 (#22): X-ready MP4s

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|mkv|webm|avi)$/i;
const GIF_EXT = /\.gif$/i;
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
  // ---------- 2.9.4 tools ----------
  // What the window asked for, checked: { speed, vol, even, fadeIn, fadeOut, shape: null | { ratio, x, y, w, h, up, ow, oh } }.
  // A shape box that's the whole picture (and not upscaled) is no shape at all, so it doesn't force a re-encode.
  static tools(o, info) {
    o = o || {}; info = info || {};
    const v = info.video || {}, a = !!info.audio;
    const t = { speed: SPEEDS.includes(+o.speed) ? +o.speed : 1, vol: a ? Math.max(-12, Math.min(12, Math.round(num(o.vol) || 0))) : 0, even: a && !!o.even,
      fadeIn: a ? Math.max(0, num(o.fadeIn) || 0) : 0, fadeOut: a ? Math.max(0, num(o.fadeOut) || 0) : 0, shape: null };
    const s = o.shape;
    if (s && typeof s === 'object' && RATIOS[s.ratio] && v.width > 0 && v.height > 0) {
      const W = even(v.width), H = even(v.height);
      const w = even(Math.min(num(s.w) || 0, W)), h = even(Math.min(num(s.h) || 0, H));
      if (w >= 16 && h >= 16) {
        const xx = Math.max(0, Math.min(Math.round(num(s.x) || 0) & ~1, W - w)), yy = Math.max(0, Math.min(Math.round(num(s.y) || 0) & ~1, H - h));
        const up = !!s.up, r = RATIOS[s.ratio];
        const ow = up ? (r >= 1 ? even(1080 * r) : 1080) : w, oh = up ? (r >= 1 ? 1080 : even(1080 / r)) : h;
        if (up || w < W || h < H) t.shape = { ratio: s.ratio, x: xx, y: yy, w, h, up, ow, oh };
      }
    }
    return t;
  }
  static usesSound(t) { return t.speed !== 1 || t.vol !== 0 || t.even || t.fadeIn > 0 || t.fadeOut > 0; }
  static gifOpts(g) {
    g = g || {};
    return { w: GIF.w.includes(+g.w) ? +g.w : 480, fps: GIF.fps.includes(+g.fps) ? +g.fps : 15, loop: g.loop !== false, colors: GIF.colors.includes(+g.colors) ? +g.colors : 256 };
  }
  // the picture: crop (+ upscale), speed; `keep` = the old exact cut's "round down to even numbers" when there's no shape
  static vFilters(t, info) {
    const f = [], s = t.shape;
    if (s) { f.push(`crop=${s.w}:${s.h}:${s.x}:${s.y}`); if (s.up) f.push(`scale=${s.ow}:${s.oh}:flags=lanczos`, 'setsar=1'); }
    else f.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
    if (t.speed !== 1) {
      const fps = (info.video && info.video.fps) || 30;
      f.push(`setpts=PTS/${t.speed}`);
      if (t.speed < 1) f.push(`fps=${Math.min(60, Math.round(fps * 1000) / 1000)}`);      // 0.5x shows each frame twice (no smoothing)
      else if (fps * t.speed > 60.5) f.push('fps=60');                                    // 2x of 60 fps would be 120: X takes 60
    }
    return f;
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

  mp3Args(o, info, tin, len, tmp, title, t, loud) {
    t = t || Clipper.tools(o, info);
    // the artist tag is kept (-map_metadata 0), so the title tag mustn't start with it too ("Artist - Artist - Song")
    if (info.artist && title.toLowerCase().startsWith(`${info.artist.toLowerCase()} - `)) title = title.slice(info.artist.length + 3);
    const lenOut = len / t.speed;
    const af = Clipper.aFilters(t, lenOut, loud, Clipper.rateOf(info));
    const copy = o.quality === 'copy' && !af.length && info.audio && info.audio.codec === 'mp3' && !info.hasVideo;
    const cover = !info.hasVideo && info.hasCover;     // keep an MP3's cover picture
    return ['-ss', tin.toFixed(3), '-i', o.file, '-t', lenOut.toFixed(3), '-map', '0:a:0', ...(cover ? ['-map', '0:v:0?', '-c:v', 'copy', '-disposition:v:0', 'attached_pic'] : []),
      ...(copy ? ['-c:a', 'copy'] : ['-c:a', 'libmp3lame', '-b:a', '320k', ...(af.length ? ['-af', af.join(',')] : [])]),
      '-map_metadata', '0', '-metadata', `title=${title}`, '-id3v2_version', '3', '-f', 'mp3', tmp];
  }
  // kf: for a Fast cut with sound changes, the keyframe the picture starts on (the sound starts there too, in sync)
  async mp4Args(o, info, tin, len, tmp, title, t, loud, kf) {
    t = t || Clipper.tools(o, info);
    const head = ['-ss', tin.toFixed(3), '-i', o.file, '-t', (len / t.speed).toFixed(3), '-map', '0:v:0', '-map', '0:a:0?'];
    const tail = ['-map_metadata', '-1', '-metadata', `title=${title}`, '-movflags', '+faststart', '-f', 'mp4', tmp];
    const pic = !!t.shape || t.speed !== 1, snd = !!info.audio && Clipper.usesSound(t);
    if (o.cut === 'fast' && !pic) {
      if (!snd) return [...head, '-c', 'copy', '-avoid_negative_ts', 'make_zero', ...tail];
      // sound only: the picture is copied (from the keyframe, like any Fast cut), the sound re-encoded from the same moment
      const st = Number.isFinite(kf) && kf <= tin ? kf : tin, L = len + (tin - st);
      const af = Clipper.aFilters(t, L, loud, Clipper.rateOf(info));
      return ['-ss', (st > 0 ? st + 0.001 : 0).toFixed(3), '-i', o.file, '-t', L.toFixed(3), '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-af', af.join(','), '-avoid_negative_ts', 'make_zero', ...tail];
    }
    let enc = this.server.encoder || await this.server.detectEncoder();
    // hardware encoders (NVENC / AMF / QSV) keep their quality settings; Media Foundation's fixed quality is
    // fine for live playback but unpredictable for a saved clip, so OpenH264 (in the bundled FFmpeg) is used
    if (!enc || enc === 'h264_mf' || enc === 'libvpx') enc = 'libopenh264';
    let va = this.encoderArgs(enc || 'libopenh264');
    const v = info.video || {}, ow = t.shape ? t.shape.ow : v.width || 1280, oh = t.shape ? t.shape.oh : v.height || 720;
    const mbps = Math.max(1.5, Math.min(12, ow * oh / 1e6 * 4));
    if (/libopenh264/.test(enc)) va = va.map(x => (x === '5M' ? `${mbps.toFixed(1)}M` : x));
    // keep the size; odd sizes can't be encoded, so round down to even numbers (a shape box is even already)
    const af = snd ? Clipper.aFilters(t, len / t.speed, loud, Clipper.rateOf(info)) : [];
    return [...head, ...va, '-vf', Clipper.vFilters(t, info).join(','), '-c:a', 'aac', '-b:a', '192k', ...(af.length ? ['-af', af.join(',')] : []), ...tail];
  }
  // GIF: one palette made for the clip (palettegen / paletteuse), no sound, loops unless told not to
  gifArgs(o, info, tin, len, tmp, t) {
    t = t || Clipper.tools(o, info);
    const g = Clipper.gifOpts(o.gif), f = [];
    if (t.shape) f.push(`crop=${t.shape.w}:${t.shape.h}:${t.shape.x}:${t.shape.y}`);
    if (t.speed !== 1) f.push(`setpts=PTS/${t.speed}`);
    f.push(`fps=${g.fps}`);
    const srcW = t.shape ? t.shape.w : (info.video && info.video.width) || 0;
    if (g.w && (!srcW || g.w < srcW)) f.push(`scale=${g.w}:-2:flags=lanczos`);
    const use = g.colors <= 64 ? 'paletteuse=dither=bayer:bayer_scale=4' : 'paletteuse=dither=sierra2_4a';
    return ['-ss', tin.toFixed(3), '-i', o.file, '-t', (len / t.speed).toFixed(3), '-an', '-sn',
      '-filter_complex', `[0:v:0]${f.join(',')},split[a][b];[a]palettegen=max_colors=${g.colors}[p];[b][p]${use}`, '-loop', g.loop ? '0' : '-1', '-f', 'gif', tmp];
  }
  // About how big the GIF will be: a 1-second test (of the saved clip's time) from the middle of the clip
  async gifEstimate(o) {
    o = o || {};
    const info = typeof o.file === 'string' && fs.existsSync(o.file) ? await this.server.probe(o.file) : null;
    if (!info || !info.hasVideo) return { ok: false, error: 'There’s no video in this file.' };
    const t = Clipper.tools(o, info), g = Clipper.gifOpts(o.gif);
    const tin = Math.max(0, num(o.in) || 0), tout = Math.min(info.duration || Infinity, num(o.out)), len = tout - tin;
    if (!(len >= 0.1)) return { ok: false, error: 'The clip is too short.' };
    const sl = Math.min(len, t.speed), start = tin + Math.max(0, (len - sl) / 2);
    const key = JSON.stringify([o.file, start.toFixed(2), sl.toFixed(2), t.shape, t.speed, g]);
    if (!this.gifCache) this.gifCache = new Map();
    let per = this.gifCache.get(key);
    if (per == null) {
      const tmp = path.join(os.tmpdir(), `slopamp-gif-test-${process.pid}-${(this.gifN = (this.gifN || 0) + 1)}.gif`);
      const r = await this.run(['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...this.gifArgs(o, info, start, sl, tmp, t)], 60000);
      let size = 0; try { size = fs.statSync(tmp).size; } catch (_) {}
      this.rm(tmp);
      if (r.code !== 0 || !size) { this.log('gif estimate failed', r.stderr.slice(-300)); return { ok: false, error: 'Couldn’t make the test GIF.' }; }
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
    const tin = Math.max(0, num(o.in)), tout = Math.min(dur || Infinity, num(o.out));
    if (!(tout - tin >= 0.1)) return { ok: false, error: 'The clip is too short.' };
    const kind = o.kind === 'mp4' || o.kind === 'gif' ? o.kind : 'mp3';
    if (kind !== 'mp3' && !info.hasVideo) return { ok: false, error: `There’s no video in this file. Save it as MP3.` };
    if (kind === 'mp3' && !info.audio) return { ok: false, error: 'There’s no sound in this file.' };
    if (kind === 'mp4' && o.cut === 'fast' && !(info.video && info.video.codec === 'h264' && /mp4|mov/.test(info.format))) o.cut = 'exact';
    const t = Clipper.tools(o, info);
    if (kind === 'mp4' && o.cut === 'fast' && (t.shape || t.speed !== 1)) o.cut = 'exact';     // Shape and Speed change the picture
    const len = tout - tin, lenOut = len / t.speed;
    const dirs = this.dirs();
    const base = ((String(o.name || '').trim() && this.fileSafe(String(o.name)).slice(0, 150)) || Clipper.cutName(path.basename(o.file).replace(/\.[^.]+$/, ''), tin, tout)).replace(/\.(mp3|mp4|gif)$/i, '');
    const steps = [{ kind, dir: kind === 'mp4' ? dirs.mp4 : kind === 'gif' ? dirs.gif : dirs.mp3, ext: `.${kind}` }];
    if (kind === 'mp4' && o.alsoMp3 && info.audio) steps.push({ kind: 'mp3', dir: dirs.mp3, ext: '.mp3' });
    const files = [];
    if (this.preCanceled && this.preCanceled.delete(job)) return { ok: false, canceled: true, files };
    this.jobs.set(job, { canceled: false });
    try {
      // Even out the volume, pass 1: measure the clip (the first part of the progress bar), unless it's been measured
      let loud = null, kf = null, w0 = 0;
      if (kind !== 'gif' && t.even && info.audio) {
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
      if (kind === 'mp4' && o.cut === 'fast' && info.audio && Clipper.usesSound(t)) kf = await this.keyframeBefore(o.file, tin);
      for (let i = 0; i < steps.length; i++) {
        const st = steps[i];
        fs.mkdirSync(st.dir, { recursive: true });
        const final = this.uniquePath(st.dir, base, st.ext), tmp = `${final}.part`;
        const title = path.basename(final, st.ext);
        const fo = { ...o, file: o.file };
        const args = st.kind === 'mp3' ? this.mp3Args(fo, info, tin, len, tmp, title, t, loud)
          : st.kind === 'gif' ? this.gifArgs(fo, info, tin, len, tmp, t) : await this.mp4Args(fo, info, tin, len, tmp, title, t, loud, kf);
        const span = [w0 + (1 - w0) * i / steps.length, w0 + (1 - w0) * (i + 1) / steps.length];
        const r = await this.runJob(job, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-progress', 'pipe:1', '-nostats', ...args], lenOut, (p) => this.send({ type: 'progress', job, pct: Math.round((span[0] + (span[1] - span[0]) * p) * 100) }));
        if (this.jobs.get(job).canceled) { this.rm(tmp); return { ok: false, canceled: true, files }; }
        if (r.code !== 0 || !fs.existsSync(tmp)) {
          this.rm(tmp);
          this.log(`clip ${st.kind} failed`, r.stderr.slice(-400));
          return { ok: false, error: `Couldn’t save the ${{ mp4: 'video', gif: 'GIF', mp3: 'MP3' }[st.kind]} clip.`, files };
        }
        fs.renameSync(tmp, final);
        const size = fs.statSync(final).size;
        files.push({ path: final, kind: st.kind, duration: lenOut, size });
        const idx = this.getIndex();
        idx[final] = { src: o.file, srcTitle: String(o.srcTitle || '').slice(0, 300), in: +tin.toFixed(3), out: +tout.toFixed(3), kind: st.kind, dur: +lenOut.toFixed(3), at: Date.now(),
          ...(t.speed !== 1 ? { speed: t.speed } : {}),
          ...(o.item && typeof o.item === 'object' && /^(youtube|x)$/.test(o.item.type) ? { item: { type: o.item.type, vid: String(o.item.vid || '').slice(0, 40), url: String(o.item.url || '').slice(0, 300) } } : {}) };
        this.setIndex(idx);
      }
      this.send({ type: 'progress', job, pct: 100 });
      return { ok: true, files };
    } finally { this.jobs.delete(job); }
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
  runJob(job, args, len, onPct) {
    return new Promise((resolve) => {
      const p = spawn(this.ffmpeg(), args, { windowsHide: true });
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
  // What Fix for X would do to one file (the dialog's "now → for X" table)
  async xPlan(file) {
    let st; try { st = fs.statSync(file); } catch (_) { return { ok: false, error: 'The file isn’t there any more.' }; }
    const info = await this.server.probe(file);
    const x = X.assess(info, st.size);
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
  // Every audio file in mp3clips, every video in mp4clips and every GIF in gifs (also ones put there by hand).
  list() {
    const dirs = this.dirs(), idx = this.getIndex(), rows = [];
    let pruned = false;
    for (const [k, dir, re] of [['mp3clip', dirs.mp3, AUDIO_EXT], ['mp4clip', dirs.mp4, VIDEO_EXT], ['gifclip', dirs.gif, GIF_EXT]]) {
      if (!dir) continue;
      let names = []; try { names = fs.readdirSync(dir); } catch (_) {}
      for (const n of names) {
        if (!re.test(n) || /\.part$/i.test(n)) continue;
        const full = path.join(dir, n);
        let st; try { st = fs.statSync(full); } catch (_) { continue; }
        if (!st.isFile()) continue;
        const e = idx[full] || {};
        rows.push({ kind: k, path: full, title: n.replace(/\.[^.]+$/, ''), size: st.size, mtime: st.mtimeMs, dur: e.dur || 0, from: e.srcTitle || (e.src ? path.basename(e.src).replace(/\.[^.]+$/, '') : ''),
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
    return dir === path.resolve(d.mp3) || dir === path.resolve(d.mp4) || (!!d.gif && dir === path.resolve(d.gif) && GIF_EXT.test(p));
  }
  async remove(paths) {
    const out = [], idx = this.getIndex();
    for (const p of Array.isArray(paths) ? paths : []) {
      if (!this.inClipDir(p)) { out.push({ path: p, ok: false, error: 'Not a clip.' }); continue; }
      try { if (fs.existsSync(p)) await this.trash(p); delete idx[p]; out.push({ path: p, ok: true }); } catch (e) { out.push({ path: p, ok: false, error: String(e.message || e) }); }
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
    const idx = this.getIndex(); if (idx[p]) { idx[to] = idx[p]; delete idx[p]; this.setIndex(idx); }
    return { path: to };
  }
}

module.exports = { Clipper, AUDIO_EXT, VIDEO_EXT, GIF_EXT };
