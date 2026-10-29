// SlopAMP — Share playlist (idea #5, 2.4.0): a playlist plus its files as one .zip, and opening such a .zip.
//
// The .zip:  <Name>.m3u8           (relative paths, #EXTINF titles + lengths; YouTube / X links stay links)
//            <Name>/01 <file>.mp3   (numbered in playlist order, so names never clash)
// Files are stored, not compressed (music and video already are): fast at any size, zip64 past 4 GB.
// Opening one unpacks only songs, videos and playlists into a new folder under Downloads\SlopAMP\Shared
// (never over anything, never outside that folder) and hands back the playlist to open as a tab.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { isMediaFile } = require('./media');

const PLAYLIST_RE = /\.(m3u8?|pls)$/i;
const U32 = 0xFFFFFFFF;
const MAX_UNPACK = 64 * 1024 ** 3;     // 64 GB: anything claiming more isn't a shared playlist

// Windows-safe file / folder name (no reserved characters or names, no trailing dot or space)
function safeName(s, fallback = 'SlopAMP playlist', max = 80) {
  let n = String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) n = `_${n}`;
  return n || fallback;
}

// ---------------------------------------------------------------- what goes in
// items: playlist items as the renderer has them ({ type: 'file', path } or { type: 'youtube' | 'x', url,
// localVideo, localAudio }) or Library playlist entries ({ path } / { url }).
function plan(items, opts = {}) {
  const includeFiles = opts.includeFiles !== false, includeDl = !!opts.includeDl;
  const rows = [], files = new Map();   // real path -> { size, n }
  let links = 0, missing = [], dlCopies = 0, dlBytes = 0;
  const statOk = (p) => { try { const st = fs.statSync(p); return st.isFile() ? st : null; } catch (_) { return null; } };
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object') continue;
    const title = String(it.title || '').replace(/[\r\n]+/g, ' ').slice(0, 300), duration = Math.max(0, Math.round(Number(it.duration) || 0));
    const isFile = it.type === 'file' || (!it.type && typeof it.path === 'string' && !it.url);
    if (isFile) {
      const p = typeof it.path === 'string' ? path.resolve(it.path) : '';
      const st = p && isMediaFile(p) ? statOk(p) : null;
      if (!st) { missing.push(title || path.basename(p || '?')); continue; }
      if (!includeFiles) { rows.push({ skip: true }); continue; }
      if (!files.has(p)) files.set(p, { size: st.size });
      rows.push({ file: p, title, duration });
      continue;
    }
    const url = typeof it.url === 'string' && /^https?:\/\//i.test(it.url) ? it.url : null;
    if (!url) continue;
    const local = [it.localVideo, it.localAudio].find(f => typeof f === 'string' && statOk(f) && isMediaFile(f));
    if (local) { dlCopies++; dlBytes += statOk(local).size; }
    if (local && includeDl && includeFiles) {
      const p = path.resolve(local);
      if (!files.has(p)) files.set(p, { size: statOk(p).size });
      rows.push({ file: p, title, duration, from: url });
    } else { rows.push({ url, title, duration }); links++; }
  }
  let bytes = 0; for (const f of files.values()) bytes += f.size;
  return { rows, files, summary: { items: rows.filter(r => !r.skip).length, files: files.size, bytes, links, missing, dlCopies, dlBytes } };
}

// ---------------------------------------------------------------- zip writer (stored, zip64 when needed)
const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
const dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;

class ZipOut {
  constructor(file, { forceZip64 = false } = {}) { this.fd = fs.openSync(file, 'w'); this.pos = 0; this.cd = []; this.z64all = forceZip64; }
  _w(buf, at) { fs.writeSync(this.fd, buf, 0, buf.length, at == null ? this.pos : at); if (at == null) this.pos += buf.length; }
  // name: path inside the zip ("/" separators); src: a file path or a Buffer
  async add(name, src, { onBytes, signal } = {}) {
    const nameBuf = Buffer.from(name, 'utf8');
    const size = Buffer.isBuffer(src) ? src.length : fs.statSync(src).size;
    const z64 = this.z64all || size >= U32;
    const mt = Buffer.isBuffer(src) ? new Date() : fs.statSync(src).mtime;
    const off = this.pos;
    const extra = z64 ? Buffer.alloc(20) : Buffer.alloc(0);
    if (z64) { extra.writeUInt16LE(1, 0); extra.writeUInt16LE(16, 2); extra.writeBigUInt64LE(BigInt(size), 4); extra.writeBigUInt64LE(BigInt(size), 12); }
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(z64 ? 45 : 20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(dosTime(mt), 10); lh.writeUInt16LE(dosDate(mt), 12); lh.writeUInt32LE(0, 14);
    lh.writeUInt32LE(z64 ? U32 : size, 18); lh.writeUInt32LE(z64 ? U32 : size, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(extra.length, 28);
    this._w(lh); this._w(nameBuf); this._w(extra);
    let crc = 0;
    if (Buffer.isBuffer(src)) { crc = zlib.crc32(src); this._w(src); if (onBytes) onBytes(src.length); }
    else {
      const fdIn = fs.openSync(src, 'r'); const buf = Buffer.allocUnsafe(1 << 20);
      try {
        let done = 0;
        while (done < size) {
          if (signal && signal.aborted) throw new Error('canceled');
          const n = fs.readSync(fdIn, buf, 0, Math.min(buf.length, size - done), done);
          if (!n) throw new Error(`${path.basename(src)} got shorter while it was being added`);
          const part = buf.subarray(0, n); crc = zlib.crc32(part, crc); this._w(part); done += n;
          if (onBytes) onBytes(n);
          if (done % (16 << 20) < n) await new Promise(r => setImmediate(r));   // let progress and Cancel through
        }
      } finally { fs.closeSync(fdIn); }
    }
    const c = Buffer.alloc(4); c.writeUInt32LE(crc >>> 0, 0); this._w(c, off + 14);   // patch the CRC into the local header
    this.cd.push({ nameBuf, size, crc: crc >>> 0, off, time: dosTime(mt), date: dosDate(mt) });
  }
  close() {
    const cdStart = this.pos;
    for (const e of this.cd) {
      const bigSize = this.z64all || e.size >= U32, bigOff = this.z64all || e.off >= U32;
      const parts = []; if (bigSize) parts.push(BigInt(e.size), BigInt(e.size)); if (bigOff) parts.push(BigInt(e.off));
      const extra = Buffer.alloc(parts.length ? 4 + 8 * parts.length : 0);
      if (parts.length) { extra.writeUInt16LE(1, 0); extra.writeUInt16LE(8 * parts.length, 2); parts.forEach((v, i) => extra.writeBigUInt64LE(v, 4 + 8 * i)); }
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(0x0300 | (parts.length ? 45 : 20), 4); h.writeUInt16LE(parts.length ? 45 : 20, 6);
      h.writeUInt16LE(0x0800, 8); h.writeUInt16LE(0, 10); h.writeUInt16LE(e.time, 12); h.writeUInt16LE(e.date, 14); h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(bigSize ? U32 : e.size, 20); h.writeUInt32LE(bigSize ? U32 : e.size, 24);
      h.writeUInt16LE(e.nameBuf.length, 28); h.writeUInt16LE(extra.length, 30); h.writeUInt16LE(0, 32); h.writeUInt16LE(0, 34); h.writeUInt16LE(0, 36);
      h.writeUInt32LE((0o100644 << 16) >>> 0, 38); h.writeUInt32LE(bigOff ? U32 : e.off, 42);
      this._w(h); this._w(e.nameBuf); this._w(extra);
    }
    const cdSize = this.pos - cdStart, n = this.cd.length;
    const z64 = this.z64all || n >= 0xFFFF || cdStart >= U32 || cdSize >= U32;
    if (z64) {
      const recAt = this.pos, r = Buffer.alloc(56);
      r.writeUInt32LE(0x06064b50, 0); r.writeBigUInt64LE(44n, 4); r.writeUInt16LE(45, 12); r.writeUInt16LE(45, 14);
      r.writeBigUInt64LE(BigInt(n), 24); r.writeBigUInt64LE(BigInt(n), 32); r.writeBigUInt64LE(BigInt(cdSize), 40); r.writeBigUInt64LE(BigInt(cdStart), 48);
      this._w(r);
      const l = Buffer.alloc(20); l.writeUInt32LE(0x07064b50, 0); l.writeBigUInt64LE(BigInt(recAt), 8); l.writeUInt32LE(1, 16); this._w(l);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(z64 ? 0xFFFF : n, 8); end.writeUInt16LE(z64 ? 0xFFFF : n, 10);
    end.writeUInt32LE(z64 ? U32 : cdSize, 12); end.writeUInt32LE(z64 ? U32 : cdStart, 16);
    this._w(end);
    fs.closeSync(this.fd); this.fd = null;
  }
  abort() { if (this.fd != null) { try { fs.closeSync(this.fd); } catch (_) {} this.fd = null; } }
}

// Make the .zip. onProgress({ done, total, file, n, of }); signal: AbortSignal (Cancel deletes the half-made file).
async function make({ items, name, includeFiles, includeDl, dest, forceZip64 }, onProgress, signal) {
  const { rows, files, summary } = plan(items, { includeFiles, includeDl });
  if (!rows.some(r => !r.skip)) return { ok: false, error: 'Nothing to share: the playlist has no files or links that are still there.' };
  const base = safeName(name);
  const width = String(Math.max(files.size, 1)).length < 2 ? 2 : String(files.size).length;
  const inZip = new Map(); let k = 0; const used = new Set();
  for (const p of files.keys()) {
    k++;
    let n = `${String(k).padStart(width, '0')} ${safeName(path.basename(p, path.extname(p)), 'file', 120)}${path.extname(p).toLowerCase()}`;
    while (used.has(n.toLowerCase())) n = `${String(k).padStart(width, '0')}b ${n.slice(width + 1)}`;
    used.add(n.toLowerCase()); inZip.set(p, `${base}/${n}`);
  }
  const lines = ['#EXTM3U', `#PLAYLIST:${base}`];
  for (const r of rows) {
    if (r.skip) continue;
    lines.push(`#EXTINF:${r.duration > 0 ? r.duration : -1},${r.title || (r.file ? path.basename(r.file, path.extname(r.file)) : r.url)}`);
    lines.push(r.file ? inZip.get(r.file) : r.url);
  }
  const m3u = Buffer.from(lines.join('\r\n') + '\r\n', 'utf8');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  const z = new ZipOut(tmp, { forceZip64 });
  const total = summary.bytes; let done = 0, i = 0;
  try {
    await new Promise(r => setImmediate(r));
    if (signal && signal.aborted) throw new Error('canceled');
    await z.add(`${base}.m3u8`, m3u);
    for (const [p, zn] of inZip) {
      i++;
      await new Promise(r => setImmediate(r));                    // Cancel and progress get through between files
      if (signal && signal.aborted) throw new Error('canceled');
      if (onProgress) onProgress({ done, total, file: path.basename(p), n: i, of: inZip.size });
      await z.add(zn, p, { signal, onBytes: (b) => { done += b; if (onProgress && done % (8 << 20) < b) onProgress({ done, total, file: path.basename(p), n: i, of: inZip.size }); } });
    }
    z.close();
    try { fs.rmSync(dest, { force: true }); } catch (_) {}
    fs.renameSync(tmp, dest);
    if (onProgress) onProgress({ done: total, total, n: inZip.size, of: inZip.size });
    return { ok: true, file: dest, size: fs.statSync(dest).size, summary };
  } catch (e) {
    z.abort(); try { fs.rmSync(tmp, { force: true }); } catch (_) {}
    return { ok: false, canceled: e.message === 'canceled', error: e.message === 'canceled' ? 'Canceled.' : `Couldn’t make the .zip: ${e.message}` };
  }
}

// ---------------------------------------------------------------- zip reader (stored + deflate, zip64)
function readCentral(fd, fileSize) {
  const tailLen = Math.min(fileSize, 22 + 0xFFFF + 20);
  const tail = Buffer.alloc(tailLen); fs.readSync(fd, tail, 0, tailLen, fileSize - tailLen);
  let e = -1; for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('That isn’t a .zip file (or it’s damaged).');
  let n = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
  if (n === 0xFFFF || cdSize === U32 || cdOff === U32) {
    const loc = e - 20;
    if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) throw new Error('That .zip is damaged (zip64 record missing).');
    const recAt = Number(tail.readBigUInt64LE(loc + 8)); const r = Buffer.alloc(56); fs.readSync(fd, r, 0, 56, recAt);
    if (r.readUInt32LE(0) !== 0x06064b50) throw new Error('That .zip is damaged (zip64 record).');
    n = Number(r.readBigUInt64LE(32)); cdSize = Number(r.readBigUInt64LE(40)); cdOff = Number(r.readBigUInt64LE(48));
  }
  if (cdSize > 64 << 20 || cdOff + cdSize > fileSize) throw new Error('That .zip is damaged or too unusual to open.');
  const cd = Buffer.alloc(cdSize); fs.readSync(fd, cd, 0, cdSize, cdOff);
  const out = []; let p = 0;
  for (let i = 0; i < n; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('That .zip is damaged (directory).');
    const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10), crc = cd.readUInt32LE(p + 16);
    let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
    const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
    let off = cd.readUInt32LE(p + 42);
    const nameRaw = cd.subarray(p + 46, p + 46 + nl);
    const name = (flags & 0x800) ? nameRaw.toString('utf8') : nameRaw.toString('latin1');
    let x = p + 46 + nl; const xe = x + xl;
    while (x + 4 <= xe) {
      const id = cd.readUInt16LE(x), sz = cd.readUInt16LE(x + 2); let q = x + 4;
      if (id === 1) {
        if (usize === U32) { usize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (csize === U32) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (off === U32) { off = Number(cd.readBigUInt64LE(q)); q += 8; }
      }
      x += 4 + sz;
    }
    out.push({ name, method, crc, csize, usize, off, encrypted: !!(flags & 1) });
    p += 46 + nl + xl + cl;
  }
  return out;
}

// "Some Folder/01 Song.mp3" -> safe relative parts, or null for anything that would leave the folder
function safeRel(name) {
  const parts = String(name).replace(/\\/g, '/').split('/').filter(s => s && s !== '.');
  if (!parts.length || parts.some(s => s === '..') || /^[a-z]:$/i.test(parts[0]) || name.startsWith('/')) return null;
  return parts.map(s => safeName(s, '_', 120));
}

async function unpackEntry(fd, e, out) {
  const lh = Buffer.alloc(30); fs.readSync(fd, lh, 0, 30, e.off);
  if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error('That .zip is damaged (file header).');
  let at = e.off + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  const outFd = fs.openSync(out, 'wx');
  try {
    let crc = 0, written = 0;
    const put = (b) => { crc = zlib.crc32(b, crc); written += b.length; if (written > e.usize) throw new Error('size mismatch'); fs.writeSync(outFd, b); };
    const buf = Buffer.allocUnsafe(1 << 20); let left = e.csize;
    if (e.method === 0) {
      while (left > 0) { const n = fs.readSync(fd, buf, 0, Math.min(buf.length, left), at); if (!n) break; put(buf.subarray(0, n)); at += n; left -= n; if (left % (16 << 20) < n) await new Promise(r => setImmediate(r)); }
    } else if (e.method === 8) {
      await new Promise((resolve, reject) => {
        const inf = zlib.createInflateRaw();
        inf.on('data', (b) => { try { put(b); } catch (err) { inf.destroy(err); } });
        inf.on('error', reject); inf.on('end', resolve);
        (function pump() {
          if (left <= 0) { inf.end(); return; }
          const n = fs.readSync(fd, buf, 0, Math.min(buf.length, left), at); if (!n) { inf.end(); return; }
          at += n; left -= n;
          if (inf.write(Buffer.from(buf.subarray(0, n)))) setImmediate(pump); else inf.once('drain', pump);
        })();
      });
    } else throw new Error('unsupported compression');
    if (written !== e.usize || (crc >>> 0) !== e.crc) throw new Error('damaged file inside the .zip');
  } finally { fs.closeSync(outFd); }
}

// Unpack a shared .zip into <root>/<zip name>[ (2)…]/. Only media and playlist files; returns { dir, playlists, media }.
async function unpack(zipFile, root) {
  const fd = fs.openSync(zipFile, 'r');
  try {
    const entries = readCentral(fd, fs.fstatSync(fd).size)
      .filter(e => !e.name.endsWith('/') && (isMediaFile(e.name) || PLAYLIST_RE.test(e.name)));
    if (!entries.length) return { error: 'There are no songs, videos or playlists in that .zip.' };
    if (entries.some(e => e.encrypted)) return { error: 'That .zip is password-protected; SlopAMP can’t open it.' };
    if (entries.reduce((a, e) => a + e.usize, 0) > MAX_UNPACK) return { error: 'That .zip is too big to unpack here.' };
    const base = safeName(path.basename(zipFile, path.extname(zipFile)), 'Shared playlist');
    fs.mkdirSync(root, { recursive: true });
    let dir = path.join(root, base), k = 2;
    while (fs.existsSync(dir)) dir = path.join(root, `${base} (${k++})`);
    fs.mkdirSync(dir);
    const playlists = [], media = [], skipped = [];
    for (const e of entries) {
      const rel = safeRel(e.name); if (!rel) { skipped.push(e.name); continue; }
      const out = path.join(dir, ...rel);
      if (path.relative(dir, out).startsWith('..') || fs.existsSync(out)) { skipped.push(e.name); continue; }
      fs.mkdirSync(path.dirname(out), { recursive: true });
      try { await unpackEntry(fd, e, out); } catch (err) { try { fs.rmSync(out, { force: true }); } catch (_) {} skipped.push(e.name); continue; }
      (PLAYLIST_RE.test(out) ? playlists : media).push(out);
    }
    playlists.sort((a, b) => a.split(path.sep).length - b.split(path.sep).length || a.localeCompare(b));
    return { dir, playlists, media, skipped };
  } finally { fs.closeSync(fd); }
}

module.exports = { plan, make, unpack, safeName, ZipOut, readCentral, PLAYLIST_RE };
