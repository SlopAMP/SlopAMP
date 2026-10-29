'use strict';
// The YOUTUBE window (2.3): youtube.com in a SlopAMP window. The window itself (frame, toolbar, status
// line) is an ordinary SlopAMP panel (renderer/app.js "YOUTUBE window"); the page is a WebContentsView laid
// over the panel's page area. Only YouTube (and Google's sign-in / consent pages) load here: every other
// link opens in the normal browser. Nothing on the page is changed (no ad blocking, no downloading from it).
// The page has its own saved session ("persist:youtube"), apart from SlopAMP's player.
const { WebContentsView, session, shell } = require('electron');

const HOME = 'https://www.youtube.com/';
const YT_HOST = /^(?:[\w-]+\.)*(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;
const SIGNIN_HOST = /^(accounts|consent|myaccount)\.google\.[a-z.]{2,8}$|^(accounts|consent)\.youtube\.com$/i;
const hostOf = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.hostname : ''; } catch (_) { return ''; } };
const allowed = (u) => { const h = hostOf(u); return !!h && (YT_HOST.test(h) || SIGNIN_HOST.test(h)); };
const isSignIn = (u) => SIGNIN_HOST.test(hostOf(u));

class YtWeb {
  // o: { wm (windows.js WindowManager), send(channel, value) to the player renderer, log }
  constructor(o) {
    Object.assign(this, o);
    this.view = null;
    this.lastUrl = HOME;
    this.rect = null;
    this.navAt = 0;          // when the page last changed (autoplay detection)
    this.touched = false;    // the user clicked / typed on the page since then
  }
  ses() {
    const s = session.fromPartition('persist:youtube');
    if (!this.uaSet) {
      // a plain Chrome user agent (without "Electron" / "SlopAMP"): Google refuses some app browsers by name
      this.uaSet = true;
      s.setUserAgent(s.getUserAgent().replace(/\s(Electron|SlopAMP|slopamp)\/\S+/g, ''));
    }
    return s;
  }
  // the panel was shown / hidden (windows.js onPanel)
  show() {
    const win = this.wm.wins.get('ytweb'); if (!win || win.isDestroyed()) return;
    if (!this.view) {
      this.view = new WebContentsView({ webPreferences: { session: this.ses(), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: true, spellcheck: false } });
      this.view.setBackgroundColor('#0f0f0f');
      this.wire(this.view.webContents);
      win.contentView.addChildView(this.view);
      this.view.setVisible(false);
      this.view.webContents.loadURL(allowed(this.lastUrl) ? this.lastUrl : HOME).catch(() => {});
    }
    this.place();
  }
  hide() {
    if (!this.view) return;
    const v = this.view; this.view = null;
    try { const u = v.webContents.getURL(); if (allowed(u)) this.lastUrl = u; } catch (_) {}
    const win = this.wm.wins.get('ytweb');
    try { if (win && !win.isDestroyed()) win.contentView.removeChildView(v); } catch (_) {}
    try { v.webContents.close(); } catch (_) {}      // closing stops any sound from the page
    this.state();
  }
  // where the page goes, in the panel's page coordinates (the renderer measures its placeholder)
  setRect(r) {
    this.rect = r && [r.x, r.y, r.w, r.h].every(Number.isFinite) ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.max(0, Math.round(r.w)), height: Math.max(0, Math.round(r.h)) } : null;
    this.place();
  }
  place() {
    if (!this.view) return;
    const ok = this.rect && this.rect.width > 20 && this.rect.height > 20;
    if (ok) this.view.setBounds(this.rect);
    this.view.setVisible(!!ok);
  }
  wire(wc) {
    wc.setWindowOpenHandler(({ url }) => {
      if (allowed(url)) wc.loadURL(url).catch(() => {});
      else if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    const guard = (e, url) => { if (!allowed(url)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', (e, url, inPlace, isMain) => { if (isMain) guard(e, url); });
    const changed = () => { this.navAt = Date.now(); this.touched = false; this.state(); };
    wc.on('did-navigate', changed);
    wc.on('did-navigate-in-page', (_e, _url, isMain) => { if (isMain) changed(); });
    wc.on('page-title-updated', () => this.state());
    wc.on('did-start-loading', () => this.state());
    wc.on('did-stop-loading', () => this.state());
    wc.on('input-event', (_e, ev) => { if (ev && /^(mouseDown|keyDown|rawKeyDown|touchStart|gestureTap)$/.test(ev.type)) this.touched = true; });
    // a video started on the page: the player decides (pause SlopAMP, or pause the page if this is autoplay
    // while SlopAMP plays)
    wc.on('media-started-playing', () => this.send('ytweb:event', { type: 'playing', auto: !this.touched && Date.now() - this.navAt < 6000 }));
    wc.on('render-process-gone', () => { this.log('YouTube page crashed'); });
  }
  state() {
    const wc = this.view && this.view.webContents;
    let st = { open: !!wc, url: this.lastUrl, title: '', back: false, fwd: false, loading: false, signIn: false };
    if (wc && !wc.isDestroyed()) {
      const url = wc.getURL() || this.lastUrl;
      if (allowed(url)) this.lastUrl = url;
      const h = wc.navigationHistory;
      st = { open: true, url, title: wc.getTitle(), back: h ? h.canGoBack() : wc.canGoBack(), fwd: h ? h.canGoForward() : wc.canGoForward(), loading: wc.isLoading(), signIn: isSignIn(url) };
    }
    this.send('ytweb:event', { type: 'state', ...st });
    return st;
  }
  nav(cmd, arg) {
    const wc = this.view && this.view.webContents; if (!wc || wc.isDestroyed()) return this.state();
    const h = wc.navigationHistory;
    if (cmd === 'back') { if (h ? h.canGoBack() : wc.canGoBack()) (h ? h.goBack() : wc.goBack()); }
    else if (cmd === 'forward') { if (h ? h.canGoForward() : wc.canGoForward()) (h ? h.goForward() : wc.goForward()); }
    else if (cmd === 'reload') wc.reload();
    else if (cmd === 'stop') wc.stop();
    else if (cmd === 'home') wc.loadURL(HOME).catch(() => {});
    else if (cmd === 'go') {
      const t = String(arg || '').trim();
      if (!t) return this.state();
      let url = /^https?:\/\//i.test(t) ? t : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t) ? `https://${t}` : `${HOME}results?search_query=${encodeURIComponent(t)}`;
      if (!allowed(url)) { shell.openExternal(url); return this.state(); }
      wc.loadURL(url).catch(() => {});
    } else if (cmd === 'external') {
      const u = wc.getURL(); if (/^https?:/i.test(u)) shell.openExternal(u);
    }
    return this.state();
  }
  pause() {
    const wc = this.view && this.view.webContents; if (!wc || wc.isDestroyed()) return;
    wc.executeJavaScript("document.querySelectorAll('video,audio').forEach(m => { try { m.pause(); } catch (_) {} }); true", true).catch(() => {});
  }
  async clearData() {
    const s = this.ses();
    await s.clearStorageData().catch(() => {});
    await s.clearCache().catch(() => {});
    if (this.view) this.view.webContents.loadURL(HOME).catch(() => {});
    return true;
  }
}

module.exports = { YtWeb, allowedYtUrl: allowed };
