'use strict';
// 2.9.6: an MP3's title and length straight from the file (ID3v2 / ID3v1 tags, the first frame's Xing / Info /
// VBRI header, or its bitrate), without starting ffprobe. Adding 1,500 MP3s used to start ffprobe 1,500 times.
// Same answers as media.js probe() gives ("Artist - Title", the length in seconds); anything unusual (unsynchronised
// or compressed tags, a damaged first frame, odd text) returns null and the caller uses ffprobe as before.
// Cached by the file's size and modified time, like media.js.
const fs = require('fs');

const cache = new Map();         // file -> { stamp, info }
const BR = {                     // kb/s by [MPEG1 | MPEG2/2.5][layer 3]
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
};
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };   // by version bits (3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5)

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  const n = fs.readSync(fd, b, 0, len, pos);
  return n < len ? b.subarray(0, n) : b;
}
const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

// one ID3 text frame → string, or undefined when it's something we don't read the same way ffmpeg does
function text(buf) {
  if (!buf.length) return '';
  const enc = buf[0]; let s;
  const body = buf.subarray(1);
  if (enc === 0) s = body.toString('latin1');
  else if (enc === 3) s = body.toString('utf8');
  else if (enc === 1 || enc === 2) {
    let b = body, le = enc === 1;
    if (enc === 1) { if (b[0] === 0xff && b[1] === 0xfe) { le = true; b = b.subarray(2); } else if (b[0] === 0xfe && b[1] === 0xff) { le = false; b = b.subarray(2); } else return undefined; }
    if (b.length % 2) b = b.subarray(0, b.length - 1);
    if (!le) { const c = Buffer.from(b); c.swap16(); b = c; }
    s = b.toString('utf16le');
  } else return undefined;
  s = s.replace(/\0+$/, '');
  if (s.includes('\0')) return undefined;          // several values in one frame: leave it to ffprobe
  return s;
}

function id3v2(fd, size) {
  const h = readAt(fd, 0, 10);
  if (h.length < 10 || h.toString('latin1', 0, 3) !== 'ID3') return { end: 0, tags: {} };
  const ver = h[3], flags = h[5];
  if (ver < 2 || ver > 4 || (flags & 0x80)) return null;          // unsynchronised: ffprobe
  const tagSize = syncsafe(h, 6), end = 10 + tagSize + ((flags & 0x10) ? 10 : 0);
  if (end > size) return null;
  let pos = 10;
  if (ver >= 3 && (flags & 0x40)) {                               // extended header
    const e = readAt(fd, pos, 4); pos += ver === 4 ? syncsafe(e, 0) : 4 + e.readUInt32BE(0);
  }
  const tags = {}, idLen = ver === 2 ? 3 : 4, hdLen = ver === 2 ? 6 : 10;
  const want = ver === 2 ? { TT2: 'title', TP1: 'artist', TP2: 'album_artist' } : { TIT2: 'title', TPE1: 'artist', TPE2: 'album_artist' };
  while (pos + hdLen <= 10 + tagSize) {
    const fh = readAt(fd, pos, hdLen);
    if (fh.length < hdLen || fh[0] === 0) break;                  // padding
    const id = fh.toString('latin1', 0, idLen);
    if (!/^[A-Z0-9]+$/.test(id)) return null;
    const len = ver === 2 ? (fh[3] << 16) | (fh[4] << 8) | fh[5] : ver === 4 ? syncsafe(fh, 4) : fh.readUInt32BE(4);
    if (len < 0 || pos + hdLen + len > 10 + tagSize) return null;
    if (want[id]) {
      if (ver >= 3 && (fh[9] & (ver === 4 ? 0x4f : 0xe0))) return null;   // compressed / encrypted / grouped / unsynced frame
      const t = text(readAt(fd, pos + hdLen, Math.min(len, 4096)));
      if (t === undefined) return null;
      if (!(want[id] in tags)) tags[want[id]] = t;
    }
    pos += hdLen + len;
  }
  return { end, tags };
}

// the first MPEG audio frame at or after `from`: { pos, ver, layer, br, sr, mono, spf, len }
function frameAt(b, i) {
  if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3, bri = (b[i + 2] >> 4) & 15, sri = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1;
  if (ver === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) return null;         // layer III only
  const br = BR[ver === 3 ? 1 : 2][bri] * 1000, sr = SR[ver][sri], spf = ver === 3 ? 1152 : 576;
  const len = Math.floor(spf / 8 * br / sr) + pad;
  return { ver, br, sr, spf, len, mono: ((b[i + 3] >> 6) & 3) === 3 };
}
function firstFrame(fd, from, size) {
  const b = readAt(fd, from, Math.min(65536, Math.max(0, size - from)));
  for (let i = 0; i + 4 <= b.length; i++) {
    const f = frameAt(b, i); if (!f) continue;
    if (i + f.len + 4 <= b.length && !frameAt(b, i + f.len)) continue;              // the next one must be a frame too
    return { ...f, pos: from + i, buf: b.subarray(i, Math.min(b.length, i + 200)) };
  }
  return null;
}

function read(file) {
  let st; try { st = fs.statSync(file); } catch (_) { return null; }
  const stamp = `${st.size}|${st.mtimeMs}`, hit = cache.get(file);
  if (hit && hit.stamp === stamp) return hit.info;
  let info = null, fd;
  try {
    fd = fs.openSync(file, 'r');
    info = parse(fd, st.size);
  } catch (_) { info = null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {} }
  if (cache.size > 20000) cache.clear();
  cache.set(file, { stamp, info });
  return info;
}
function parse(fd, size) {
  const t = id3v2(fd, size); if (!t) return null;
  const f = firstFrame(fd, t.end, size); if (!f) return null;
  let tags = t.tags, v1 = 0;
  const tail = size >= 128 ? readAt(fd, size - 128, 128) : Buffer.alloc(0);
  if (tail.length === 128 && tail.toString('latin1', 0, 3) === 'TAG') {
    v1 = 128;
    if (!('title' in tags) && !('artist' in tags)) {
      const s = (o, n) => tail.toString('latin1', o, o + n).replace(/[\0 ]+$/, '');
      tags = { title: s(3, 30), artist: s(33, 30) };
    }
  }
  // the length: Xing / Info (VBR and LAME CBR) or VBRI frame count, else the bitrate
  const side = f.ver === 3 ? (f.mono ? 17 : 32) : (f.mono ? 9 : 17);
  const b = f.buf;
  let frames = 0;
  const xo = 4 + side, tag = b.length >= xo + 12 ? b.toString('latin1', xo, xo + 4) : '';
  let skip = 0;
  if (tag === 'Xing' || tag === 'Info') {
    const fl = b.readUInt32BE(xo + 4); if (fl & 1) frames = b.readUInt32BE(xo + 8);
    // LAME's encoder delay and padding (like ffmpeg, the length leaves them out)
    const lo = xo + 8 + (fl & 1 ? 4 : 0) + (fl & 2 ? 4 : 0) + (fl & 4 ? 100 : 0) + (fl & 8 ? 4 : 0);
    if (b.length >= lo + 24 && /^(LAME|Lavc|Lavf)/.test(b.toString('latin1', lo, lo + 4))) {
      const d = (b[lo + 21] << 4) | (b[lo + 22] >> 4), pd = ((b[lo + 22] & 15) << 8) | b[lo + 23];
      skip = d + pd;
    }
  }
  else if (b.length >= 36 + 18 && b.toString('latin1', 36, 40) === 'VBRI') frames = b.readUInt32BE(36 + 14);
  let duration;
  if (frames > 0) duration = (frames * f.spf - (skip < frames * f.spf ? skip : 0)) / f.sr;
  else {
    const audio = size - f.pos - v1;
    if (audio <= 0) return null;
    duration = audio * 8 / f.br;
  }
  if (!(duration > 0) || duration > 48 * 3600) return null;
  const artist = tags.artist || tags.album_artist || '', title = tags.title || '';
  return { title: title ? (artist ? `${artist} - ${title}` : title) : '', artist, duration: Math.round(duration * 1e6) / 1e6, hasVideo: false };
}

module.exports = { read, forget: (f) => cache.delete(f) };
