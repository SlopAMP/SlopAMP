// Linux (3.2.0): an EWMH request Electron 45 can't make, sent over SlopAMP's own short-lived connection to the X server
// (X11 or XWayland). Electron's skipTaskbar does nothing on Linux, and GNOME keeps only dialogs out of the dock,
// Alt+Tab and the Overview by itself; the video window is a normal window on Linux (windows.js), so it asks the window
// manager for _NET_WM_STATE_SKIP_TASKBAR / _SKIP_PAGER itself. Local displays only (":0"); anything else is skipped.
'use strict';
const net = require('net'), fs = require('fs'), os = require('os'), path = require('path');

const pad4 = (n) => (n + 3) & ~3;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function displaySocket(display = process.env.DISPLAY) {
  const m = /^(?:unix)?:(\d+)(?:\.\d+)?$/.exec(display || '');
  return m ? { path: `/tmp/.X11-unix/X${m[1]}`, num: m[1] } : null;
}

// The MIT-MAGIC-COOKIE-1 for display `num` from the Xauthority file (null: none, then the server decides)
function cookie(num, file = process.env.XAUTHORITY || path.join(os.homedir(), '.Xauthority')) {
  let b; try { b = fs.readFileSync(file); } catch (_) { return null; }
  let o = 0, any = null;
  const field = () => { const n = b.readUInt16BE(o); const v = b.subarray(o + 2, o + 2 + n); o += 2 + n; return v; };
  try {
    while (o + 2 <= b.length) {
      const family = b.readUInt16BE(o); o += 2;
      field(); const n = field().toString(), name = field().toString(), data = field();
      if (name !== 'MIT-MAGIC-COOKIE-1') continue;
      if (n === num) return data;
      if (!n || family === 0xffff) any = any || data;
    }
  } catch (_) { /* a truncated file: what was read so far */ }
  return any;
}

class XConn {
  constructor(sock) {
    this.sock = sock; this.buf = Buffer.alloc(0); this.seq = 0; this.wait = new Map(); this.setup = null;
    sock.on('data', (d) => this.data(d));
    sock.on('error', (e) => this.fail(e));
    sock.on('close', () => this.fail(new Error('X connection closed')));
  }
  fail(e) {
    for (const w of this.wait.values()) w.reject(e);
    this.wait.clear();
    if (this.setup) { this.setup.reject(e); this.setup = null; }
  }
  data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    if (this.setup) {                 // the connection setup reply comes first
      if (this.buf.length < 8) return;
      const len = 8 + this.buf.readUInt16LE(6) * 4;
      if (this.buf.length < len) return;
      const s = this.buf.subarray(0, len), { resolve, reject } = this.setup;
      this.buf = this.buf.subarray(len); this.setup = null;
      if (s[0] !== 1) { reject(new Error(`X server refused the connection: ${s.subarray(8, 8 + s[1]).toString() || s[0]}`)); return; }
      this.root = s.readUInt32LE(40 + pad4(s.readUInt16LE(24)) + 8 * s[29]);    // the first screen's root window
      resolve(this);
    }
    while (this.buf.length >= 32) {   // errors (0) and replies (1) answer a request; events are ignored
      const kind = this.buf[0], long = kind === 1 || (kind & 0x7f) === 35;    // replies and GenericEvents carry a length
      const len = long ? 32 + this.buf.readUInt32LE(4) * 4 : 32;
      if (this.buf.length < len) return;
      const m = this.buf.subarray(0, len);
      this.buf = this.buf.subarray(len);
      const w = kind <= 1 && this.wait.get(m.readUInt16LE(2));
      if (w) { this.wait.delete(m.readUInt16LE(2)); if (kind === 1) w.resolve(m); else w.reject(new Error(`X error ${m[1]}`)); }
    }
  }
  request(b, reply) {
    this.seq = (this.seq + 1) & 0xffff;
    const seq = this.seq;
    this.sock.write(b);
    return reply ? new Promise((resolve, reject) => this.wait.set(seq, { resolve, reject })) : Promise.resolve(null);
  }
  internAtom(name) {
    const n = Buffer.from(name), b = Buffer.alloc(8 + pad4(n.length));
    b[0] = 16; b.writeUInt16LE(b.length / 4, 2); b.writeUInt16LE(n.length, 4); n.copy(b, 8);
    return this.request(b, true).then(r => r.readUInt32LE(8));
  }
  propertyType(win, atom) {           // GetProperty: 0 when the window has no such property
    const b = Buffer.alloc(24);
    b[0] = 20; b.writeUInt16LE(6, 2); b.writeUInt32LE(win, 4); b.writeUInt32LE(atom, 8); b.writeUInt32LE(1, 20);
    return this.request(b, true).then(r => r.readUInt32LE(8));
  }
  selectionOwner(atom) {              // GetSelectionOwner: 0 when nobody owns it
    const b = Buffer.alloc(8);
    b[0] = 23; b.writeUInt16LE(2, 2); b.writeUInt32LE(atom, 4);
    return this.request(b, true).then(r => r.readUInt32LE(8));
  }
  // SendEvent of a ClientMessage whose window field is `win`: by default to the root window, as EWMH asks (SubstructureNotify |
  // SubstructureRedirect); `to` / `mask` send it straight to another window instead (XDND: mask 0)
  clientMessage(win, type, data, to = this.root, mask = 0x180000) {
    const b = Buffer.alloc(44);
    b[0] = 25; b.writeUInt16LE(11, 2); b.writeUInt32LE(to, 4); b.writeUInt32LE(mask, 8);
    b[12] = 33; b[13] = 32; b.writeUInt32LE(win, 16); b.writeUInt32LE(type, 20);
    data.forEach((v, i) => b.writeUInt32LE(v >>> 0, 24 + 4 * i));
    return this.request(b, false);
  }
  sync() { const b = Buffer.alloc(4); b[0] = 43; b.writeUInt16LE(1, 2); return this.request(b, true); }   // GetInputFocus
  close() { this.sock.destroy(); }
}

function connect(timeoutMs) {
  const where = displaySocket();
  if (!where) return Promise.reject(new Error(`not a local X display: ${process.env.DISPLAY || '(none)'}`));
  const auth = cookie(where.num), name = auth ? Buffer.from('MIT-MAGIC-COOKIE-1') : Buffer.alloc(0), data = auth || Buffer.alloc(0);
  const b = Buffer.alloc(12 + pad4(name.length) + pad4(data.length));
  b[0] = 0x6c; b.writeUInt16LE(11, 2); b.writeUInt16LE(name.length, 6); b.writeUInt16LE(data.length, 8);   // 'l': LSB first
  name.copy(b, 12); data.copy(b, 12 + pad4(name.length));
  return new Promise((resolve, reject) => {
    const sock = net.connect({ path: where.path });
    const c = new XConn(sock);
    const t = setTimeout(() => { c.close(); reject(new Error('X connection timed out')); }, timeoutMs);
    c.setup = { resolve: (x) => { clearTimeout(t); resolve(x); }, reject: (e) => { clearTimeout(t); reject(e); } };
    sock.on('connect', () => sock.write(b));
  });
}

// Adds (add true) or removes up to two _NET_WM_STATE_* atoms on window `xid` once the window manager manages it
// (it sets WM_STATE then). Resolves 'ok', or 'not managed' when that doesn't happen within timeoutMs; rejects on errors.
async function netWmState(xid, add, names, timeoutMs = 4000) {
  const c = await connect(timeoutMs);
  const guard = setTimeout(() => c.fail(new Error('the X server stopped answering')), timeoutMs + 2000);
  try {
    const [state, wmState, ...atoms] = await Promise.all(['_NET_WM_STATE', 'WM_STATE', ...names.slice(0, 2)].map(n => c.internAtom(n)));
    for (const t0 = Date.now(); !(await c.propertyType(xid, wmState));) {
      if (Date.now() - t0 > timeoutMs) return 'not managed';
      await sleep(50);
    }
    c.clientMessage(xid, state, [add ? 1 : 0, atoms[0] || 0, atoms[1] || 0, 1, 0]);   // 1: from a normal application
    await c.sync();
    return 'ok';
  } finally { clearTimeout(guard); c.close(); }
}

// 3.2.0: "window `target` accepts this drag, as a copy" (XdndStatus), sent straight to the drag's source (the owner of
// XdndSelection). Electron answers each XdndPosition at once with what the page said about the previous one (nothing yet
// after the pointer enters a window) and says nothing more until the next position; GNOME sends positions only while the
// pointer moves and drops only when the last answer said yes, so a drag that stops right after reaching SlopAMP was
// cancelled. The page calls this from its dragover handler, which runs after Electron's answer to that position, so the
// last word is the page's. One connection, kept open; resolves 'ok' or 'no drag'.
let dnd = null;
async function xdndAccept(target) {
  if (!dnd) {
    dnd = (async () => {
      const c = await connect(3000);
      c.sock.on('close', () => { dnd = null; });
      const [sel, status, copy] = await Promise.all(['XdndSelection', 'XdndStatus', 'XdndActionCopy'].map(n => c.internAtom(n)));
      return { c, sel, status, copy };
    })();
    dnd.catch(() => { dnd = null; });
  }
  const { c, sel, status, copy } = await dnd;
  const owner = await c.selectionOwner(sel);
  if (!owner) return 'no drag';
  // the event names the source's window (as Chromium's own XdndStatus does; Mutter goes by it); l[0] says who answers.
  c.clientMessage(owner, status, [target, 3, 0, 0, copy], owner, 0);    // 3: will accept the drop, keep sending positions
  return 'ok';
}

module.exports = { netWmState, xdndAccept, displaySocket, cookie };
