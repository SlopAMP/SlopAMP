'use strict';
// X posts play in SlopAMP's own player (2.8), without downloading first.
//
//   1. SlopAMP's yt-dlp is asked only for the post's video link (-j, no download): one MP4 from video.twimg.com,
//      the best up to 720p. A post with several videos: the one its link names (".../video/2"), else the first.
//   2. The link goes to the media server (media.js /x/<key>), which passes the video through with Range
//      requests. So the player reads it from 127.0.0.1 like a file: seeking works, and the EQ / visualizer get
//      the sound (straight from X, a media element routed through WebAudio would play silent).
//   3. Links (and X's final answers: no video, sign-in only, gone) are kept for the session; a link is asked for
//      again when X refuses it. A link being asked for already
//      isn't asked twice (playing an item while its link is fetched early).
// Nothing is saved to disk. (Once it really plays, the renderer adds the post to X History, 2.9 #6.)
const { execFile } = require('child_process');
const crypto = require('crypto');

const FORMAT = 'best[protocol^=http][ext=mp4][height<=720]/best[protocol^=http][ext=mp4]/best[protocol^=http]';
const ASK_TIMEOUT = 45000;
const FINAL = new Set(['novideo', 'signin', 'gone']);   // asking X again won't change these

// https://x.com/<user>/status/<id>[/video/<n>] -> the same, tidied (the cache key); anything else -> null
function postUrl(raw) {
  let u; try { u = new URL(String(raw || '').trim()); } catch (_) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  if (!/^(x|twitter)\.com$/.test(host)) return null;
  const m = u.pathname.match(/^\/(\w{1,15}|i(?:\/web)?)\/status(?:es)?\/(\d{1,25})(?:\/video\/(\d{1,2}))?\/?$/i);
  if (!m) return null;
  const n = m[3] ? Math.max(1, +m[3]) : 0;
  return `https://x.com/${m[1]}/status/${m[2]}${n ? `/video/${n}` : ''}`;
}

// what went wrong, from yt-dlp's messages. code: novideo | signin | gone | limit | network | other
function classify(msg) {
  const m = String(msg || '');
  if (/no video could be found|no video formats found|no video in this/i.test(m)) return 'novideo';
  if (/nsfw|age.restricted|sensitive|log ?in|logged in|authenticat|cookies/i.test(m)) return 'signin';
  if (/suspended|does not exist|not found|unavailable|deleted|protected|private|404/i.test(m)) return 'gone';
  if (/rate.?limit|429|too many requests/i.test(m)) return 'limit';
  if (/getaddrinfo|network|timed out|timeout|connection|unreachable|ssl/i.test(m)) return 'network';
  return 'other';
}

class XStream {
  // o: { downloader (downloader.js: ensureExe, baseArgs, jsRuntime), server (media.js), log }
  constructor(o) {
    Object.assign(this, o);
    this.cache = new Map();      // post url -> the answer (for this session)
    this.asking = new Map();     // post url -> promise
  }
  async resolve(raw, opts = {}) {
    const url = postUrl(raw);
    if (!url) return { ok: false, code: 'other', error: 'That isn’t a link to an X post.' };
    if (!opts.fresh && this.cache.has(url)) return { ...this.cache.get(url), cached: true };
    if (this.asking.has(url)) return this.asking.get(url);
    const p = this.ask(url).then((r) => {
      this.asking.delete(url);
      const old = this.cache.get(url);
      if (old && old.key && old.key !== r.key) this.server.unregisterRemote(old.key);
      // a link, or X's final answer (no video / sign-in only / gone), is kept for the session; other failures aren't
      if (r.ok || FINAL.has(r.code)) this.cache.set(url, r); else this.cache.delete(url);
      return r;
    });
    this.asking.set(url, p);
    return p;
  }
  ask(url) {
    const exe = this.downloader.ensureExe();
    if (!exe) return Promise.resolve({ ok: false, code: 'other', error: 'The downloader (yt-dlp) is missing from this copy of SlopAMP.' });
    const n = +((/\/video\/(\d+)$/.exec(url) || [])[1] || 1);
    const args = [...this.downloader.baseArgs(false), '-j', '--playlist-items', String(n), '-f', FORMAT, url];
    const js = this.downloader.jsRuntime;
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...(js ? js.env : {}) };
    const t0 = Date.now();
    return new Promise((resolve) => {
      const p = execFile(exe, args, { windowsHide: true, timeout: ASK_TIMEOUT, maxBuffer: 32 * 1024 * 1024, env }, (err, stdout, stderr) => {
        let info = null;
        for (const line of String(stdout || '').split('\n')) {
          if (!line.trim().startsWith('{')) continue;
          try { const j = JSON.parse(line); if (j && typeof j.url === 'string' && /^https?:\/\//.test(j.url)) { info = j; break; } } catch (_) {}
        }
        const ms = Date.now() - t0;
        if (!info) {
          const msg = String(stderr || (err && err.message) || 'no video link').trim();
          this.log(`X link failed (${ms} ms):`, msg.split('\n').slice(-2).join(' | ').slice(0, 300));
          resolve({ ok: false, code: err && err.killed ? 'network' : classify(msg), error: msg.split('\n').filter(l => /ERROR/.test(l)).pop() || msg.split('\n').pop() || '' });
          return;
        }
        const h = info.http_headers || {};
        const headers = {};
        for (const k of ['User-Agent', 'Referer', 'Accept-Language']) if (typeof h[k] === 'string') headers[k] = h[k];
        const key = this.server.registerRemote(info.url, headers);
        const gif = /\/tweet_video\//.test(info.url) || /gif/i.test(String(info.format_id || ''));
        this.log(`X link (${ms} ms): ${info.format_id || '?'} ${info.height || '?'}p${gif ? ' GIF' : ''}`);
        resolve({
          ok: true, key, url: `${this.server.base}/x/${key}`, ms,
          title: typeof info.title === 'string' ? info.title : '',
          duration: Number(info.duration) || 0, height: Number(info.height) || 0, width: Number(info.width) || 0,
          gif, tbr: Number(info.tbr) || 0, asr: Number(info.asr) || 0
        });
      });
      if (this.server.track) this.server.track(p);
    });
  }
}

module.exports = { XStream, postUrl, classify, FORMAT };
