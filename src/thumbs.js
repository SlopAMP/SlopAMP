'use strict';
// Library preview (2.7): the pictures in Manage Library's Preview view, made on this PC with the bundled FFmpeg
// and kept on disk (<userData>/thumbs), so a big Library only pays for each picture once.
//
//   video frame  one frame from about 10% in (skips black intros), at most 320×180, JPEG   <key>.jpg
//   MP3 cover    the cover art in the file (no decoding)                                    <key>.jpg
//   waveform     100 bars from a quick low-rate decode (long files: 24 short parts)         <key>.w.json
//   look-through 10 frames side by side (hover on a video tile)                             <key>.s.jpg
//
// The key is the file + its size + its date, like the X ✓ check since 2.5.1: a replaced or renamed file gets a new
// picture. A file FFmpeg can't read gets a <key>.none marker (it isn't tried again until it changes).
// index.json remembers which file each picture is of; pictures of files that are gone, or have changed, are cleaned
// up once a session. The renderer asks only for tiles on screen, two at a time; this side also runs at most two.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFile } = require('child_process');

const BARS = 100, LONG = 1200;          // waveform bars; files longer than this (s) are read in parts
const SPRITE = 10;                      // look-through frames

class Thumbs {
  // o: { dir, ffmpeg (path), server (MediaServer: probe, track), urlOf(file), log }
  constructor(o) {
    Object.assign(this, o);
    this.busy = new Map();    // name -> promise (the same picture asked twice)
    this.slots = 0; this.waiting = [];
    this.index = null; this.indexT = 0; this.pruned = false;
  }
  key(file, st, kind) { return crypto.createHash('sha1').update(`${path.resolve(file).toLowerCase()}|${st.size}|${Math.round(st.mtimeMs)}|${kind}`).digest('hex'); }
  // ---- the index (which file each picture is of), for cleaning up
  loadIndex() {
    if (this.index) return this.index;
    try { this.index = JSON.parse(fs.readFileSync(path.join(this.dir, 'index.json'), 'utf8')); } catch (_) { this.index = {}; }
    if (!this.index || typeof this.index !== 'object') this.index = {};
    return this.index;
  }
  remember(name, file, st) {
    this.loadIndex()[name] = { f: file, s: st.size, m: Math.round(st.mtimeMs) };
    clearTimeout(this.indexT);
    this.indexT = setTimeout(() => this.saveIndex(), 1500);
  }
  saveIndex() { try { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(path.join(this.dir, 'index.json'), JSON.stringify(this.index || {})); } catch (e) { this.log('thumbs index', e.message); } }
  // Pictures of files that are gone or changed (once a session, a while after start)
  prune() {
    if (this.pruned) return 0; this.pruned = true;
    const idx = this.loadIndex(); let n = 0;
    for (const [name, e] of Object.entries(idx)) {
      let st = null; try { st = fs.statSync(e.f); } catch (_) {}
      if (st && st.size === e.s && Math.round(st.mtimeMs) === e.m) continue;
      for (const ext of ['.jpg', '.w.json', '.s.jpg', '.none']) { try { fs.unlinkSync(path.join(this.dir, name + ext)); } catch (_) {} }
      delete idx[name]; n++;
    }
    if (n) { this.saveIndex(); this.log(`thumbs: cleaned up ${n} old picture(s)`); }
    return n;
  }
  run(args, timeout = 60000) {
    return new Promise((resolve) => {
      const p = execFile(typeof this.ffmpeg === 'function' ? this.ffmpeg() : this.ffmpeg, args, { windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }, (err, stdout, stderr) =>
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout || Buffer.alloc(0), stderr: String(stderr || (err && err.message) || '') }));
      if (this.server.track) this.server.track(p);
    });
  }
  async slot(fn) {           // at most two FFmpeg runs at once
    if (this.slots >= 2) await new Promise(r => this.waiting.push(r));
    this.slots++;
    try { return await fn(); } finally { this.slots--; const n = this.waiting.shift(); if (n) n(); }
  }
  // file -> { url, cover, peaks, dur, srcDur, none }. kind: 'pic' (the tile's picture) | 'sprite' (look-through)
  async get(file, kind = 'pic', opts = {}) {
    let st; try { st = fs.statSync(file); } catch (_) { return { none: true, missing: true }; }
    if (!st.isFile()) return { none: true };
    const info = await this.server.probe(file);
    const out = { dur: (info && info.duration) || 0 };
    if (opts.src) { try { const si = await this.server.probe(opts.src); if (si) out.srcDur = si.duration || 0; } catch (_) {} }
    if (!info) return { ...out, none: true };
    const name = this.key(file, st, kind), base = path.join(this.dir, name);
    if (fs.existsSync(base + '.none')) return { ...out, none: true };
    for (const ext of ['.jpg', '.s.jpg']) if ((kind === 'sprite') === (ext === '.s.jpg') && fs.existsSync(base + ext)) return { ...out, url: this.urlOf(base + ext), cover: !info.hasVideo, frames: kind === 'sprite' ? SPRITE : 0 };
    if (kind === 'pic' && fs.existsSync(base + '.w.json')) { try { return { ...out, peaks: JSON.parse(fs.readFileSync(base + '.w.json', 'utf8')).peaks }; } catch (_) {} }
    if (this.busy.has(name)) return this.busy.get(name);
    const job = this.slot(() => this.make(file, kind, info, base)).catch((e) => { this.log('thumbs: failed', path.basename(file), e.message); return { none: true }; }).then((r) => {
      this.busy.delete(name);
      if (!r || r.none) { try { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(base + '.none', ''); } catch (_) {} }
      this.remember(name, file, st);
      return { ...out, ...(r || { none: true }) };
    });
    this.busy.set(name, job);
    return job;
  }
  async make(file, kind, info, base) {
    fs.mkdirSync(this.dir, { recursive: true });
    const dur = info.duration || 0;
    if (kind === 'sprite') {
      if (!info.hasVideo) return { none: true };
      const a = ['-hide_banner', '-v', 'error', '-nostdin'];
      for (let i = 0; i < SPRITE; i++) a.push('-ss', Math.max(0, dur * (0.05 + 0.9 * i / (SPRITE - 1)) - 0.05).toFixed(2), '-i', file);
      const f = [...Array(SPRITE).keys()].map(i => `[${i}:v:0]scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`).join(';');
      a.push('-filter_complex', `${f};${[...Array(SPRITE).keys()].map(i => `[v${i}]`).join('')}hstack=inputs=${SPRITE}[o]`, '-map', '[o]', '-frames:v', '1', '-q:v', '5', '-y', base + '.s.jpg.part.jpg');
      const r = await this.run(a, 90000);
      if (r.code !== 0 || !fs.existsSync(base + '.s.jpg.part.jpg')) { this.log('thumbs: look-through failed', path.basename(file), r.stderr.slice(-200)); return { none: true }; }
      fs.renameSync(base + '.s.jpg.part.jpg', base + '.s.jpg');
      return { url: this.urlOf(base + '.s.jpg'), frames: SPRITE };
    }
    if (info.hasVideo) {          // a frame from about 10% in
      const ss = dur > 2 ? Math.min(dur * 0.1, dur - 1) : 0;
      const r = await this.run(['-hide_banner', '-v', 'error', '-nostdin', '-ss', ss.toFixed(2), '-i', file, '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=320:180:force_original_aspect_ratio=decrease', '-q:v', '5', '-y', base + '.part.jpg']);
      if (r.code !== 0 || !fs.existsSync(base + '.part.jpg')) { this.log('thumbs: frame failed', path.basename(file), r.stderr.slice(-200)); return { none: true }; }
      fs.renameSync(base + '.part.jpg', base + '.jpg');
      return { url: this.urlOf(base + '.jpg') };
    }
    if (info.hasCover && info.coverIndex >= 0) {   // the MP3's own cover art
      const r = await this.run(['-hide_banner', '-v', 'error', '-nostdin', '-i', file, '-map', `0:${info.coverIndex}`, '-frames:v', '1', '-vf', 'scale=320:320:force_original_aspect_ratio=decrease', '-q:v', '4', '-y', base + '.part.jpg']);
      if (r.code === 0 && fs.existsSync(base + '.part.jpg')) { fs.renameSync(base + '.part.jpg', base + '.jpg'); return { url: this.urlOf(base + '.jpg'), cover: true }; }
    }
    if (!info.audio && !info.hasAudio) return { none: true };
    // the waveform: 100 bars (the louder, the taller; square-root scale like CLIP's)
    let a;
    if (dur > LONG) {
      const n = 24; a = ['-hide_banner', '-v', 'error', '-nostdin'];
      for (let i = 0; i < n; i++) a.push('-ss', (dur * (i + 0.5) / n).toFixed(1), '-t', '3', '-i', file);
      a.push('-filter_complex', `${[...Array(n).keys()].map(i => `[${i}:a:0]`).join('')}concat=n=${n}:v=0:a=1,aresample=800,aformat=sample_fmts=s16:channel_layouts=mono[o]`, '-map', '[o]', '-f', 's16le', '-');
    } else a = ['-hide_banner', '-v', 'error', '-nostdin', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '800', '-f', 's16le', '-'];
    const r = await this.run(a, 120000);
    const n = Math.floor(r.stdout.length / 2);
    if (r.code !== 0 || n < BARS) { this.log('thumbs: waveform failed', path.basename(file), r.stderr.slice(-200)); return { none: true }; }
    const per = n / BARS, raw = new Array(BARS).fill(0); let top = 1;
    for (let b = 0; b < BARS; b++) {
      let m = 0; const s = Math.floor(b * per), e = Math.floor((b + 1) * per);
      for (let j = s; j < e; j++) { const v = Math.abs(r.stdout.readInt16LE(j * 2)); if (v > m) m = v; }
      raw[b] = m; if (m > top) top = m;
    }
    const peaks = raw.map(v => Math.round(Math.sqrt(v / top) * 100));
    fs.writeFileSync(base + '.w.json', JSON.stringify({ peaks }));
    return { peaks };
  }
}
module.exports = { Thumbs };
