'use strict';
// Local media server: serves the UI, local files (with HTTP Range) and
// on-the-fly FFmpeg remux/transcode streams for formats Chromium can't play.
// Bound to 127.0.0.1 only; every media URL needs an unguessable per-file key.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const AUDIO_EXT = ['mp3', 'flac', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'wma', 'ape', 'alac', 'aiff', 'aif', 'mka', 'ac3', 'dts', 'amr', 'mpc', 'wv', 'tta', 'mid', 'mod', 'xm', 'it', 's3m'];
const VIDEO_EXT = ['mp4', 'm4v', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'flv', 'mpg', 'mpeg', 'ts', 'm2ts', 'mts', 'vob', '3gp', '3g2', 'ogv', 'divx', 'xvid', 'asf', 'rm', 'rmvb', 'f4v', 'mxf', 'dv'];
const MEDIA_EXT = new Set([...AUDIO_EXT, ...VIDEO_EXT]);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.m4a': 'audio/mp4', '.mov': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
  '.opus': 'audio/ogg', '.ogv': 'video/ogg', '.aac': 'audio/aac'
};

class MediaServer {
  constructor({ uiDir, ffmpegDir, log }) {
    this.uiDir = uiDir;
    this.ffmpeg = path.join(ffmpegDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    this.ffprobe = path.join(ffmpegDir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    this.log = log || (() => {});
    this.keys = new Map();      // key -> absolute path
    this.byPath = new Map();    // path -> key
    this.probes = new Map();    // path -> probe result
    this.procs = new Set();
    this.encoder = null;        // chosen video encoder
    this.port = 0;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handle(req, res).catch(err => {
        this.log('server error', err);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }));
      this.server.on('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.port = this.server.address().port;
        resolve(this.port);
      });
    });
  }

  get base() { return `http://127.0.0.1:${this.port}`; }

  stop() {
    for (const p of this.procs) { try { p.kill('SIGKILL'); } catch (_) {} }
    this.procs.clear();
    if (this.server) this.server.close();
  }

  hasFfmpeg() { return fs.existsSync(this.ffmpeg); }

  keyFor(file) {
    let k = this.byPath.get(file);
    if (!k) {
      k = crypto.randomBytes(16).toString('hex');
      this.keys.set(k, file);
      this.byPath.set(file, k);
    }
    return k;
  }

  // ---------- probing ----------
  probe(file) {
    if (this.probes.has(file)) return Promise.resolve(this.probes.get(file));
    return new Promise((resolve) => {
      execFile(this.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
        { maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: 20000 }, (err, stdout) => {
          let info = null;
          if (!err) { try { info = summarize(JSON.parse(stdout)); } catch (_) {} }
          if (info) this.probes.set(file, info);
          resolve(info);
        });
    });
  }

  // Decide how to play a file. Returns URLs the renderer can use.
  async prepare(file, opts = {}) {
    if (!fs.existsSync(file)) return { ok: false, error: 'missing' };
    const info = await this.probe(file);
    const key = this.keyFor(file);
    const ext = path.extname(file).toLowerCase();
    const direct = !opts.forceStream && info && canPlayNatively(info, ext);
    const transcode = opts.forceTranscode || !info || !canCopyVideo(info);
    return {
      ok: true,
      key,
      info,
      mode: direct ? 'direct' : 'stream',
      directUrl: `${this.base}/f/${key}${ext}`,
      streamUrl: `${this.base}/s/${key}?tc=${transcode ? 1 : 0}`,
      coverUrl: info && info.hasCover ? `${this.base}/c/${key}` : null
    };
  }

  // ---------- encoder detection ----------
  async detectEncoder() {
    if (!this.hasFfmpeg()) return null;
    const candidates = process.platform === 'win32'
      ? ['h264_nvenc', 'h264_amf', 'h264_qsv', 'h264_mf', 'libopenh264']
      : ['h264_nvenc', 'libopenh264'];
    for (const enc of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await new Promise((resolve) => {
        const args = ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:d=0.3', ...encoderArgs(enc), '-f', 'null', '-'];
        execFile(this.ffmpeg, args, { windowsHide: true, timeout: 15000 }, (err) => resolve(!err));
      });
      if (ok) { this.encoder = enc; this.log('video encoder:', enc); return enc; }
    }
    this.encoder = 'libvpx';
    this.log('video encoder: libvpx (fallback)');
    return this.encoder;
  }

  // ---------- HTTP ----------
  async handle(req, res) {
    // Only answer requests addressed to this server itself (blocks DNS-rebinding tricks from web pages).
    const host = String(req.headers.host || '').toLowerCase();
    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) { res.writeHead(403); return res.end(); }
    const url = new URL(req.url, this.base);
    const parts = url.pathname.split('/').filter(Boolean);
    const route = parts[0];
    if (route === 'app') return this.serveStatic(res, parts.slice(1));
    const key = (parts[1] || '').split('.')[0];
    const file = this.keys.get(key);
    if (!file) { res.writeHead(404); return res.end(); }
    if (route === 'f') return serveFile(req, res, file);
    if (route === 's') return this.serveStream(req, res, file, url.searchParams);
    if (route === 'c') return this.serveCover(res, file);
    if (route === 'v') return this.serveSubs(res, file, url.searchParams);
    res.writeHead(404); res.end();
  }

  serveStatic(res, parts) {
    const rel = parts.join('/') || 'index.html';
    const full = path.resolve(this.uiDir, rel);
    const inside = path.relative(this.uiDir, full);
    if (!inside || inside.startsWith('..') || path.isAbsolute(inside) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404); return res.end();
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(full).pipe(res);
  }

  async serveStream(req, res, file, params) {
    const info = await this.probe(file);
    const t = Math.max(0, parseFloat(params.get('t') || '0') || 0);
    const transcode = params.get('tc') === '1';
    const audioOnly = info && !info.hasVideo;
    const args = ['-hide_banner', '-v', 'error', '-nostdin'];
    if (t > 0) args.push('-ss', t.toFixed(3));
    args.push('-i', file);
    let mime = 'video/mp4';
    if (audioOnly) {
      args.push('-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '256k', '-ac', '2');
      args.push('-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '500000');
      mime = 'audio/mp4';
    } else {
      args.push('-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn');
      const enc = transcode ? (this.encoder || 'libvpx') : 'copy';
      if (enc === 'libvpx') {
        args.push('-vf', scaleFilter(1280), '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '3M', '-threads', '8');
        args.push('-c:a', 'libopus', '-b:a', '160k', '-ac', '2', '-f', 'webm');
        mime = 'video/webm';
      } else {
        if (enc === 'copy') {
          args.push('-c:v', 'copy');
        } else {
          const soft = enc === 'libopenh264' || enc === 'h264_mf';
          args.push('-vf', scaleFilter(soft ? 1920 : 3840), ...encoderArgs(enc), '-g', '60');
        }
        const aCopy = info && info.audio && info.audio.codec === 'aac' && (info.audio.channels || 2) <= 2;
        if (aCopy) args.push('-c:a', 'copy');
        else args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2');
        args.push('-avoid_negative_ts', 'make_zero', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '1000000');
      }
    }
    args.push('pipe:1');
    this.log('ffmpeg', args.join(' '));
    const proc = spawn(this.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.procs.add(proc);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d; if (stderr.length > 8000) stderr = stderr.slice(-8000); });
    proc.on('close', (code) => {
      this.procs.delete(proc);
      if (code && code !== 255) this.log('ffmpeg exit', code, stderr.trim());
    });
    proc.on('error', (e) => { this.log('ffmpeg spawn error', e); if (!res.headersSent) { res.writeHead(500); res.end(); } });
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
    proc.stdout.pipe(res);
    const kill = () => { try { proc.kill('SIGKILL'); } catch (_) {} };
    req.on('close', kill);
    res.on('close', kill);
  }

  // Subtitles as WebVTT: an embedded text track (?s=<stream index>) or a subtitle file (.srt/.ass/.vtt...).
  serveSubs(res, file, params) {
    const s = params.get('s');
    const args = ['-hide_banner', '-v', 'error', '-nostdin'];
    if (s == null) {
      // Most .srt files are UTF-8; older ones are often Windows-1252.
      try { new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file).subarray(0, 4 * 1024 * 1024)); } catch (_) { args.push('-sub_charenc', 'CP1252'); }
      args.push('-i', file, '-map', '0:s:0');
    } else {
      if (!/^\d+$/.test(s)) { res.writeHead(400); return res.end(); }
      args.push('-i', file, '-map', `0:${s}`);
    }
    args.push('-c:s', 'webvtt', '-f', 'webvtt', 'pipe:1');
    const proc = spawn(this.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.procs.add(proc);
    let err = '';
    proc.stderr.on('data', d => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    proc.on('close', (code) => { this.procs.delete(proc); if (code) this.log('subtitle ffmpeg exit', code, err.trim()); });
    proc.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); });
    res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-store' });
    proc.stdout.pipe(res);
    res.on('close', () => { try { proc.kill('SIGKILL'); } catch (_) {} });
  }

  // Subtitle choices for a media file: embedded text tracks + subtitle files next to it.
  async listSubs(file) {
    const out = { embedded: [], external: [] };
    if (!file || !fs.existsSync(file)) return out;
    const info = await this.probe(file);
    const key = this.keyFor(file);
    for (const t of (info && info.subs) || []) {
      out.embedded.push({ id: `e${t.index}`, label: t.label, text: t.text, url: t.text ? `${this.base}/v/${key}?s=${t.index}` : null, def: t.def, forced: t.forced, lang: t.lang });
    }
    const dir = path.dirname(file);
    const base = path.basename(file, path.extname(file)).toLowerCase();
    const dirs = [dir];
    for (const sub of ['Subs', 'Subtitles', 'subs', 'subtitles']) { const d = path.join(dir, sub); if (fs.existsSync(d) && !dirs.includes(d)) dirs.push(d); }
    const seen = new Set();
    for (const d of dirs) {
      let names = []; try { names = fs.readdirSync(d); } catch (_) { continue; }
      for (const n of names.sort()) {
        if (!SUB_EXT.test(n)) continue;
        const low = n.toLowerCase();
        if (d === dir && !low.startsWith(base)) continue;
        if (d !== dir && !low.startsWith(base) && names.filter(x => SUB_EXT.test(x)).length > 8) continue;
        const full = path.join(d, n);
        if (seen.has(full.toLowerCase())) continue;
        seen.add(full.toLowerCase());
        out.external.push(this.subFile(full, d === dir ? n : `${path.basename(d)}/${n}`));
      }
    }
    return out;
  }

  subFile(full, label) {
    return { id: `x${full}`, label: label || path.basename(full), path: full, text: true, url: `${this.base}/v/${this.keyFor(full)}` };
  }

  async serveCover(res, file) {
    const info = await this.probe(file);
    if (!info || !info.hasCover) { res.writeHead(404); return res.end(); }
    const proc = spawn(this.ffmpeg, ['-hide_banner', '-v', 'error', '-i', file, '-map', `0:${info.coverIndex}`, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' });
    proc.stdout.pipe(res);
    proc.on('error', () => res.end());
  }
}

function scaleFilter(maxW) {
  return `scale='min(${maxW},iw)':-2:flags=bicubic,format=yuv420p`;
}

function encoderArgs(enc) {
  switch (enc) {
    case 'h264_nvenc': return ['-c:v', 'h264_nvenc', '-preset', 'p3', '-rc', 'vbr', '-cq', '23', '-b:v', '0', '-pix_fmt', 'yuv420p'];
    case 'h264_amf': return ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '22', '-qp_p', '24', '-pix_fmt', 'yuv420p'];
    case 'h264_qsv': return ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '24', '-pix_fmt', 'nv12'];
    case 'h264_mf': return ['-c:v', 'h264_mf', '-rate_control', 'quality', '-quality', '60', '-pix_fmt', 'nv12'];
    case 'libopenh264': return ['-c:v', 'libopenh264', '-b:v', '5M', '-pix_fmt', 'yuv420p'];
    default: return ['-c:v', enc];
  }
}

function summarize(j) {
  const streams = j.streams || [];
  const fmt = j.format || {};
  const v = streams.find(s => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const cover = streams.find(s => s.codec_type === 'video' && s.disposition && s.disposition.attached_pic);
  const a = streams.find(s => s.codec_type === 'audio');
  const tags = lowerKeys(fmt.tags || {});
  const atags = a ? lowerKeys(a.tags || {}) : {};
  const subs = streams.filter(s => s.codec_type === 'subtitle').map((s, n) => {
    const t = lowerKeys(s.tags || {});
    const lang = (t.language || '').toLowerCase();
    const name = LANGS[lang] || (lang && lang !== 'und' ? lang.toUpperCase() : '');
    const title = t.title && t.title.toLowerCase() !== name.toLowerCase() ? t.title : '';
    const d = s.disposition || {};
    const label = [name || `Track ${n + 1}`, title, d.forced ? 'forced' : '', d.hearing_impaired ? 'SDH' : ''].filter(Boolean).join(' · ');
    return { index: s.index, lang, label, text: !IMAGE_SUBS.has(s.codec_name), def: !!d.default, forced: !!d.forced };
  });
  const artist = tags.artist || tags.album_artist || atags.artist || '';
  const title = tags.title || atags.title || '';
  return {
    format: fmt.format_name || '',
    duration: parseFloat(fmt.duration) || (v && parseFloat(v.duration)) || (a && parseFloat(a.duration)) || 0,
    bitrate: parseInt(fmt.bit_rate, 10) || 0,
    title: title ? (artist ? `${artist} - ${title}` : title) : '',
    hasVideo: !!v,
    hasCover: !!cover,
    subs,
    coverIndex: cover ? cover.index : -1,
    video: v ? { codec: v.codec_name, pixFmt: v.pix_fmt || '', width: v.width, height: v.height, profile: v.profile || '' } : null,
    audio: a ? { codec: a.codec_name, sampleRate: parseInt(a.sample_rate, 10) || 0, channels: a.channels || 0, bitrate: parseInt(a.bit_rate, 10) || 0 } : null
  };
}

function lowerKeys(o) { const r = {}; for (const k of Object.keys(o)) r[k.toLowerCase()] = o[k]; return r; }

const SUB_EXT = /\.(srt|vtt|ass|ssa)$/i;
const IMAGE_SUBS = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub', 'dvb_teletext']);
const LANGS = { eng: 'English', en: 'English', spa: 'Spanish', es: 'Spanish', fre: 'French', fra: 'French', fr: 'French', ger: 'German', deu: 'German', de: 'German', ita: 'Italian', it: 'Italian', por: 'Portuguese', pt: 'Portuguese', rus: 'Russian', ru: 'Russian', jpn: 'Japanese', ja: 'Japanese', chi: 'Chinese', zho: 'Chinese', zh: 'Chinese', kor: 'Korean', ko: 'Korean', dut: 'Dutch', nld: 'Dutch', nl: 'Dutch', pol: 'Polish', pl: 'Polish', swe: 'Swedish', sv: 'Swedish', nor: 'Norwegian', dan: 'Danish', fin: 'Finnish', ara: 'Arabic', hin: 'Hindi', tur: 'Turkish', gre: 'Greek', ell: 'Greek', heb: 'Hebrew', cze: 'Czech', ces: 'Czech', hun: 'Hungarian', rum: 'Romanian', ron: 'Romanian', ukr: 'Ukrainian', vie: 'Vietnamese', tha: 'Thai', ind: 'Indonesian' };
const NATIVE_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1']);
const NATIVE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_f32le', 'pcm_u8', 'pcm_mulaw', 'pcm_alaw']);

function canPlayNatively(info, ext) {
  const f = info.format;
  const audioOk = !info.audio || NATIVE_AUDIO.has(info.audio.codec);
  if (info.hasVideo) {
    const v = info.video;
    const eightBit420 = /^(yuv420p|yuvj420p|nv12)$/.test(v.pixFmt) || v.codec === 'vp9' || v.codec === 'av1';
    if (!NATIVE_VIDEO.has(v.codec) || !eightBit420 || !audioOk) return false;
    if (/mp4|mov/.test(f)) return ['.mp4', '.m4v', '.mov'].includes(ext);
    if (/webm/.test(f) && ext === '.webm') return true;
    return false;
  }
  if (!audioOk) return false;
  return /^(mp3|flac|wav|ogg|aac)$/.test(f) || /mp4|mov/.test(f) || (/webm/.test(f) && ['.webm', '.opus'].includes(ext));
}

function canCopyVideo(info) {
  if (!info.hasVideo) return true;
  const v = info.video;
  return v.codec === 'h264' && /^(yuv420p|yuvj420p)$/.test(v.pixFmt);
}

function serveFile(req, res, file) {
  let stat;
  try { stat = fs.statSync(file); } catch (_) { res.writeHead(404); return res.end(); }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (!m || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
    end = Math.min(end, stat.size - 1);
    res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    const s = fs.createReadStream(file, { start, end });
    s.pipe(res); res.on('close', () => s.destroy());
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': stat.size });
    const s = fs.createReadStream(file);
    s.pipe(res); res.on('close', () => s.destroy());
  }
}

function isMediaFile(p) {
  return MEDIA_EXT.has(path.extname(p).slice(1).toLowerCase());
}

module.exports = { MediaServer, isMediaFile, MEDIA_EXT, SUB_EXT };
