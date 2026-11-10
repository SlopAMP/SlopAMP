'use strict';
// X's limits (2.9.5): the ONE place SlopAMP keeps them. X changes these now and then: edit the numbers here and
// everything follows (CLIP's For X bar, Convert's For X preset, the Library's X tags, Fix for X's warnings).
// Loaded as a plain script in the windows (window.XLIMITS) and with require() in the main process (xready.js).
// Sources: X Help Center "How to share videos / GIFs" + X Premium pages (as commonly cited, Nov 2026).
(function (root) {
  const MB = 1024 * 1024, GB = 1024 * MB;
  const LIMITS = {
    checked: 'Nov 2026',
    // a post's video: length and file size, by account
    free: { name: 'Free', sec: 140, bytes: 512 * MB },                                   // 2:20 · 512 MB
    premium: { name: 'Premium', sec: 4 * 3600, bytes: 16 * GB, androidSec: 10 * 60 },    // 4 h · 16 GB (web, iPhone); Android app: 10 min
    // what the picture may be (all accounts)
    video: { landscape: [1920, 1200], portrait: [1200, 1900], fps: 60, mbps: 24 },        // under X's ~25 Mb/s
    // animated GIFs (all accounts)
    gif: { web: 15 * MB, phone: 5 * MB }
  };

  const mmss = (t) => {
    t = Math.max(0, Math.round(t));
    const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  };
  const trim0 = (x) => x.replace(/\.0$/, '');
  const size = (b) => (b >= GB ? `${trim0((b / GB).toFixed(b >= 10 * GB ? 0 : 1))} GB` : b >= 10 * MB ? `${Math.round(b / MB)} MB` : `${trim0((b / MB).toFixed(1))} MB`);
  const acct = (a) => (a === 'premium' ? 'premium' : 'free');

  // What's over X's limits for a video post. account: 'free' | 'premium' (anything else counts as Free).
  // Returns a list of { what: 'length'|'size'|'android', limit, value, over, text } (empty: it fits).
  function checkVideo(account, sec, bytes) {
    const L = LIMITS[acct(account)], out = [];
    if (sec > L.sec + 0.05) out.push({ what: 'length', limit: L.sec, value: sec, over: sec - L.sec, text: `${mmss(sec)} is ${mmss(sec - L.sec)} over the ${mmss(L.sec)} X allows on ${L.name}` });
    if (bytes > L.bytes) out.push({ what: 'size', limit: L.bytes, value: bytes, over: bytes - L.bytes, text: `about ${size(bytes)} is ${size(bytes - L.bytes)} over the ${size(L.bytes)} X allows on ${L.name}` });
    if (L.androidSec && sec > L.androidSec + 0.05 && sec <= L.sec + 0.05) out.push({ what: 'android', limit: L.androidSec, value: sec, over: sec - L.androidSec, text: `${mmss(sec)} is ${mmss(sec - L.androidSec)} over the ${mmss(L.androidSec)} X's Android app takes (fine on the web and iPhone)` });
    return out;
  }
  // GIFs: over 15 MB X won't take it at all; over 5 MB the phone apps won't.
  function checkGif(bytes) {
    const G = LIMITS.gif;
    if (bytes > G.web) return [{ what: 'gif-web', limit: G.web, value: bytes, over: bytes - G.web, text: `about ${size(bytes)} is ${size(bytes - G.web)} over the ${size(G.web)} X takes for a GIF (phones take ${size(G.phone)})` }];
    if (bytes > G.phone) return [{ what: 'gif-phone', limit: G.phone, value: bytes, over: bytes - G.phone, text: `about ${size(bytes)}: fine on X's website, but ${size(bytes - G.phone)} over the ${size(G.phone)} its phone apps take` }];
    return [];
  }
  // The longest piece (s) that stays under a size, at a given rate (bytes per second of the saved clip), with 3% to spare
  const secForBytes = (bytes, perSec) => (perSec > 0 ? Math.floor(bytes * 0.97 / perSec * 10) / 10 : 0);
  // The video bitrate (kb/s) that lands a file of `sec` seconds under `bytes` (3% spare, audio included)
  const kbpsForBytes = (bytes, sec, audioKbps) => Math.max(150, Math.floor((bytes * 0.97 * 8 / 1000) / Math.max(0.1, sec) - (audioKbps || 0)));

  const api = { LIMITS, checkVideo, checkGif, secForBytes, kbpsForBytes, mmss, size, account: acct };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.XLIMITS = api;
})(typeof window !== 'undefined' ? window : globalThis);
