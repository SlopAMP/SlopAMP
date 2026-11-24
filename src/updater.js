'use strict';
// Auto-updates from GitHub Releases (public API, no account or tracking).
// Checks at most once a day, downloads the official SlopAMP-Setup-X.Y.Z.exe, verifies its
// SHA256 against the "SHA256 (SlopAMP-Setup-X.Y.Z.exe): <hash>" line in the release notes,
// and only then runs it silently (/S /UPDATE). Never installs without a click.
// Linux (3.2.0): the AppImage does the same with SlopAMP-X.Y.Z-x86_64.AppImage (it replaces itself and reopens);
// the .deb only tells you. A release with no file for this platform (a Linux-only fix, say) is skipped quietly.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { pathToFileURL, fileURLToPath } = require('url');

const REPO = 'SlopAMP/SlopAMP';
// 3.2.0: the list of releases (newest first), not /releases/latest: the newest release with this platform's files is the
// one, so a release for one platform can be published without "Set as the latest release" and copies older than 3.2.0
// (which only read /releases/latest) never see it.
const API_LIST = `https://api.github.com/repos/${REPO}/releases?per_page=20`;
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const DAY = 24 * 3600 * 1000;
const MODES = ['auto', 'notify', 'off'];
// Each platform's files in a release: `file` is the one it updates itself with (Windows: the installer; Linux: the
// AppImage); `any` tells whether the release has anything for it at all. One with nothing (a Linux-only fix on
// Windows, say) is skipped quietly; one with a file for it but not the right one is still an error ('noasset').
const PLATFORMS = {
  win32: { file: (v) => `SlopAMP-Setup-${v}.exe`, any: /\.exe$/i },
  linux: { file: (v) => `SlopAMP-${v}-x86_64.AppImage`, any: /\.(AppImage|deb)$/i },
  // macOS: one .dmg per kind of Mac (Apple silicon / Intel). A Mac never installs it by itself (canInstall is false):
  // it shows that the version is out and opens the download page, like the Portable exe.
  darwin: { file: (v) => `SlopAMP-${v}-mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}.dmg`, any: /\.dmg$/i }
};
const platformOf = (platform) => PLATFORMS[platform] || PLATFORMS.win32;

// "1.2.0" / "v1.2.0" -> [1,2,0]; null for anything else (pre-release tags are ignored).
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? m.slice(1).map(Number) : null;
}
function isNewer(remote, local) {
  const a = parseVersion(remote), b = parseVersion(local);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function findHash(body, file) {
  const m = new RegExp(`SHA256\\s*\\(${reEsc(file)}\\)\\s*:?\\s*\`?([a-f0-9]{64})\\b`, 'i').exec(String(body || ''));
  return m ? m[1].toLowerCase() : null;
}
// Release notes for the "What's new" box: the body without its SHA256 lines.
function cleanNotes(body) {
  return String(body || '').replace(/\r/g, '').split('\n').filter(l => !/^\W*SHA256\s*\(/i.test(l)).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);
}
// GitHub release JSON -> what SlopAMP needs, or { error } when the release can't be used.
// testDir: test mode only; the installer must then be a plain file name inside that folder.
// platform (3.2.0, default 'win32'): 'noplatform' when the release has none of that platform's files.
function parseRelease(rel, currentVersion, testDir, platform = 'win32') {
  if (!rel || rel.draft || rel.prerelease) return { error: 'norelease' };
  const version = String(rel.tag_name || '').replace(/^v/, '');
  if (!parseVersion(version)) return { error: 'norelease' };
  const info = { version, newer: isNewer(version, currentVersion), notes: cleanNotes(rel.body), date: rel.published_at || '', page: typeof rel.html_url === 'string' && rel.html_url.startsWith(`https://github.com/${REPO}/`) ? rel.html_url : RELEASES_PAGE };
  const pf = platformOf(platform);
  if (!(rel.assets || []).some(a => a && pf.any.test(String(a.name || '')))) return { ...info, error: 'noplatform' };
  const file = pf.file(version);
  const asset = (rel.assets || []).find(a => a && a.name === file);
  const url = asset && String(asset.browser_download_url || '');
  const ok = asset && (testDir ? /^[\w.-]+$/.test(url) : url.startsWith(`${DOWNLOAD_PREFIX}v${version}/`));
  if (!ok) return { ...info, error: 'noasset' };
  const sha256 = findHash(rel.body, file);
  if (!sha256) return { ...info, error: 'nohash' };
  return { ...info, file, url: testDir ? pathToFileURL(path.join(testDir, url)).href : url, size: asset.size || 0, sha256 };
}
// Command line for the silent update. /D= (NSIS: must come last, unquoted, spaces allowed) keeps a custom
// install folder such as C:\SlopAMP; without it the installer falls back to the folder in the registry.
function installerArgs(pid, installDir) {
  const a = ['/S', '/UPDATE', `/PID=${pid}`];
  if (installDir && !/["\r\n]/.test(installDir)) a.push(`/D=${installDir.replace(/[\\/]+$/, '')}`);
  return a;
}
function sha256File(file) {
  return new Promise((res, rej) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('error', rej).on('data', d => h.update(d)).on('end', () => res(h.digest('hex')));
  });
}

// Test mode only: file:// URLs read from disk, shaped like a fetch Response.
function readLocal(url) {
  let p, st;
  try { p = fileURLToPath(url); st = fs.statSync(p); } catch (_) { return { ok: false, status: 404 }; }
  return { ok: true, status: 200, headers: { get: (h) => (/content-length/i.test(h) ? String(st.size) : null) },
    json: async () => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')), body: Readable.toWeb(fs.createReadStream(p)) };
}

class Updater {
  // fetch: Electron's net.fetch. getState/setState: the 'update' object in slopamp-state.json.
  // emit(state): pushes the current status to the window. canInstall: false for the portable exe / dev runs.
  // testFeed: path of a local release.json (SLOPAMP_UPDATE_TEST) used instead of GitHub, for trying updates
  // without publishing; its installer must sit next to it. Checks then run at every launch.
  // installDir: the folder SlopAMP runs from, reinstalled in place.
  // platform (3.2.0): process.platform. appImage (Linux): the AppImage file SlopAMP runs from (its APPIMAGE), which an
  // update replaces; canInstall is then true only when its folder is writable.
  constructor({ fetch, version, tempDir, canInstall, installDir, getState, setState, emit, quit, openExternal, log, testFeed, platform, appImage }) {
    Object.assign(this, { version, tempDir, canInstall, installDir, getState, setState, emitFn: emit, quit, openExternal, log, testFeed });
    this.platform = platform || 'win32';
    this.appImage = appImage || null;
    this.fetch = testFeed ? (url, opts) => (url.startsWith('file:') ? readLocal(url) : fetch(url, opts)) : fetch;
    this.feed = testFeed ? pathToFileURL(testFeed).href : API_LIST;
    this.dir = path.join(tempDir, 'SlopAMP-update');
    this.status = { status: 'idle' };
    this.release = null;
    this.abort = null;
  }
  cfg() { const c = this.getState() || {}; return { mode: MODES.includes(c.mode) ? c.mode : 'notify', lastCheck: c.lastCheck || 0, skipped: c.skipped || '', dismissed: c.dismissed || null, pending: c.pending || null }; }
  patch(p) { this.setState({ ...(this.getState() || {}), ...p }); }
  set(s) { this.status = s; this.emit(); }
  emit() { this.emitFn(this.snapshot()); }
  snapshot() {
    const c = this.cfg(), r = this.release;
    return { ...this.status, mode: c.mode, lastCheck: c.lastCheck, canInstall: this.canInstall, current: this.version, test: !!this.testFeed, platform: this.platform,
      release: r && { version: r.version, notes: r.notes, date: r.date, size: r.size || 0, page: r.page, file: r.file || '' } };
  }

  // At startup: "Updated to X" once after an update, clean leftovers, then the daily check.
  start(delayMs = 10000) {
    const c = this.cfg();
    if (c.pending && c.pending.version === this.version) {
      this.release = { version: this.version, notes: c.pending.notes || '', date: c.pending.date || '', page: RELEASES_PAGE };
      this.patch({ pending: undefined });
      this.set({ status: 'updated' });
    } else if (c.pending) this.patch({ pending: undefined });   // the install didn't happen
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch (_) {}
    if (this.appImage) {    // a copy of an update that was being put next to the AppImage when quitting was cut short
      const dir = path.dirname(this.appImage);
      try { for (const n of fs.readdirSync(dir)) if (/^\.SlopAMP-.+\.AppImage\.part-\d+$/.test(n)) fs.rmSync(path.join(dir, n), { force: true }); } catch (_) {}
    }
    if (this.testFeed) { this.log(`update TEST MODE: feed ${this.testFeed}, pretending to be ${this.version}`); delayMs = Math.min(delayMs, 3000); }
    else if (c.mode === 'off' || Date.now() - c.lastCheck < DAY) return;
    this.timer = setTimeout(() => this.check(false).catch(e => this.log('update check failed', e)), delayMs);
  }

  async check(manual) {
    if (['downloading', 'verifying', 'ready', 'installing'].includes(this.status.status)) { this.emit(); return this.snapshot(); }
    clearTimeout(this.timer);
    const prev = this.status;
    if (manual) this.set({ status: 'checking', manual });
    let rel;
    try {
      const r = await this.fetch(this.feed, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `SlopAMP/${this.version}` } });
      if (r.status === 404) rel = null;   // no releases yet
      else if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      else rel = await r.json();
    } catch (e) {
      this.log('update check failed', e);
      if (manual) this.set({ status: 'error', error: 'offline', manual }); else this.status = prev;
      return this.snapshot();
    }
    this.patch({ lastCheck: Date.now() });
    // GitHub's list of releases (the test feed: a list too, or one release)
    const info = this.newestForPlatform(Array.isArray(rel) ? rel : rel ? [rel] : []) || { error: 'norelease' };
    if (!info.newer) { this.release = null; this.set(manual ? { status: 'uptodate', manual } : { status: 'idle' }); return this.snapshot(); }
    this.release = info;
    this.log(`update ${info.version} found${info.error ? ` (unusable: ${info.error})` : ''}`);
    const c = this.cfg();
    const hidden = !manual && (c.skipped === info.version || (c.dismissed && c.dismissed.version === info.version && Date.now() - c.dismissed.at < DAY));
    if (this.canInstall && info.error) { this.set({ status: 'error', error: info.error, manual, hidden }); return this.snapshot(); }
    this.set({ status: 'available', manual, hidden });
    if (this.canInstall && c.mode === 'auto' && !hidden) this.download(false);
    return this.snapshot();
  }

  // 3.2.0: the newest full release that has this platform's files (or null). Releases with nothing for this platform
  // (a Linux-only fix on Windows, say) are skipped without a word; one that has a file for it but not the right one
  // still counts, so its error shows as before.
  newestForPlatform(list) {
    let best = null;
    const skipped = [];
    for (const rel of list.slice(0, 50)) {
      const i = parseRelease(rel, this.version, this.testFeed && path.dirname(this.testFeed), this.platform);
      if (i.error === 'norelease') continue;
      if (i.error === 'noplatform') { if (i.newer) skipped.push(i.version); continue; }
      if (!best || isNewer(i.version, best.version)) best = i;
    }
    if (skipped.length) this.log(`update: ${skipped.join(', ')} not for ${{ linux: 'Linux', darwin: 'macOS' }[this.platform] || 'Windows'} (no file for it); skipped`);
    return best;
  }

  // Download + verify. installAfter: the user clicked "Update and restart" (the window then counts down).
  async download(installAfter) {
    const r = this.release;
    if (!this.canInstall || !r || r.error || !r.url) return;
    if (this.status.status === 'downloading' || this.status.status === 'verifying') { if (installAfter) { this.installAfter = true; this.set({ ...this.status, installAfter }); } return; }
    if (this.status.status === 'ready') { this.set({ status: 'ready', installAfter }); return; }
    this.installAfter = installAfter;
    const ac = new AbortController(); this.abort = ac;
    const final = path.join(this.dir, r.file), part = final + '.part';
    let out = null;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      this.set({ status: 'downloading', received: 0, total: r.size, installAfter: this.installAfter });
      const res = await this.fetch(r.url, { signal: ac.signal, headers: { 'User-Agent': `SlopAMP/${this.version}` } });
      if (!res.ok || !res.body) throw new Error(`download answered ${res.status}`);
      const total = r.size || Number(res.headers.get('content-length')) || 0;
      const hash = crypto.createHash('sha256');
      out = fs.createWriteStream(part);
      const reader = res.body.getReader();
      let received = 0, lastEmit = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (ac.signal.aborted) throw new Error('cancelled');   // also stops the local test feed, which ignores the signal
        const buf = Buffer.from(value);
        hash.update(buf); received += buf.length;
        if (!out.write(buf)) await new Promise(ok => out.once('drain', ok));
        if (Date.now() - lastEmit > 250) { lastEmit = Date.now(); this.set({ status: 'downloading', received, total, installAfter: this.installAfter }); }
      }
      await new Promise((ok, bad) => out.end(err => (err ? bad(err) : ok())));
      out = null;
      this.set({ status: 'verifying', installAfter: this.installAfter });
      const got = hash.digest('hex');
      if ((r.size && received !== r.size) || got !== r.sha256) {
        this.log(`update download rejected: sha256 ${got}, expected ${r.sha256}; ${received} of ${r.size} bytes`);
        try { fs.rmSync(part, { force: true }); } catch (_) {}
        this.set({ status: 'error', error: 'badhash' });
        return;
      }
      fs.renameSync(part, final);
      this.downloaded = final;
      this.set({ status: 'ready', installAfter: this.installAfter });
    } catch (e) {
      if (out) out.destroy();
      try { fs.rmSync(part, { force: true }); } catch (_) {}
      if (ac.signal.aborted) { this.set({ status: 'available' }); return; }
      this.log('update download failed', e);
      this.set({ status: 'error', error: 'download' });
    } finally { if (this.abort === ac) this.abort = null; }
  }
  cancel() { if (this.abort) this.abort.abort(); }

  // Re-check the file on disk, then quit normally. The installer is started only at the very end of
  // quitting (startInstaller, from main's will-quit), so it never has to close a running SlopAMP; it
  // installs silently and reopens SlopAMP.
  async install() {
    const r = this.release, f = this.downloaded;
    if (!this.canInstall || this.status.status !== 'ready' || !r || !f) return false;
    let got = '';
    try { got = await sha256File(f); } catch (_) {}
    if (got !== r.sha256) { this.log('installer changed on disk; refusing to run it'); this.set({ status: 'error', error: 'badhash' }); return false; }
    this.patch({ pending: { version: r.version, notes: r.notes, date: r.date } });
    this.set({ status: 'installing' });
    this.installOnQuit = f;
    this.log(`update ${r.version} verified; quitting to install it into ${this.installDir || '(folder from the registry)'}`);
    this.quit();
    return true;
  }

  // Called once SlopAMP has quit cleanly (windows closed, state saved). Resolves false if the installer
  // couldn't be started; main then reopens SlopAMP instead of leaving the user with nothing.
  async startInstaller() {
    const f = this.installOnQuit;
    this.installOnQuit = null;
    if (!f) return false;
    if (this.platform === 'linux') return this.swapAppImage(f);
    try {
      await new Promise((ok, bad) => {
        // Test-mode variables are left out, so the reopened SlopAMP is a normal run.
        const env = { ...process.env }; delete env.SLOPAMP_UPDATE_TEST; delete env.SLOPAMP_TEST_VERSION;
        // Verbatim arguments: Node would put quotes around a /D= path with spaces, and NSIS wouldn't recognise it.
        const child = spawn(f, installerArgs(process.pid, this.installDir), { detached: true, stdio: 'ignore', env, windowsVerbatimArguments: true, argv0: `"${f}"` });
        child.once('spawn', ok); child.once('error', bad);
        child.unref();
      });
    } catch (e) {
      this.log('could not start the installer', e);
      this.patch({ pending: undefined });
      return false;
    }
    this.log('installer started; exiting');
    return true;
  }

  // Linux AppImage (3.2.0): put the verified AppImage where the running one is, then reopen SlopAMP from it once this
  // process has exited. A file name with a version in it ("SlopAMP-3.2.0-x86_64.AppImage") becomes the new
  // release's name and the old file goes; a name of your own ("SlopAMP.AppImage", what a menu entry may point at) stays
  // and the file is replaced in place. The rename is atomic: the running copy keeps its own (unlinked) file open.
  // Always resolves true: if the new file can't be put in place, the old AppImage is reopened instead.
  async swapAppImage(f) {
    const cur = this.appImage, dir = path.dirname(cur), base = path.basename(cur);
    const dest = /\d+\.\d+\.\d+/.test(base) ? path.join(dir, path.basename(f)) : cur;
    const tmp = path.join(dir, `.${path.basename(dest)}.part-${process.pid}`);
    let open = dest;
    try {
      fs.copyFileSync(f, tmp);        // the download is in the temp folder, often on another file system
      if (await sha256File(tmp) !== this.release.sha256) throw new Error('the copy doesn’t match the SHA256');
      fs.chmodSync(tmp, 0o755);
      fs.renameSync(tmp, dest);
      if (dest !== cur) { try { fs.unlinkSync(cur); } catch (e) { this.log('the old AppImage couldn’t be removed', e.message); } }
      this.log(`AppImage ${this.release.version} put in place: ${dest}`);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch (_) {}
      this.log('could not put the new AppImage in place; reopening this one', e);
      this.patch({ pending: undefined });
      open = cur;
    }
    // /bin/sh waits for this process to end (at most 30 s), so the reopened SlopAMP gets the single-instance lock.
    // Test-mode variables and the AppImage runtime's own are left out (the new AppImage sets its own).
    const env = { ...process.env };
    for (const k of ['SLOPAMP_UPDATE_TEST', 'SLOPAMP_TEST_VERSION', 'APPIMAGE', 'APPDIR', 'ARGV0', 'OWD', 'SLOPAMP_NO_SANDBOX']) delete env[k];
    try {
      const child = spawn('/bin/sh', ['-c', 'i=0; while kill -0 "$1" 2>/dev/null && [ "$i" -lt 300 ]; do sleep 0.1; i=$((i+1)); done; exec "$2"', 'slopamp-reopen', String(process.pid), open],
        { detached: true, stdio: 'ignore', env, cwd: dir });
      child.unref();
      this.log(`reopening ${open} once SlopAMP has quit; exiting`);
    } catch (e) { this.log('could not reopen SlopAMP', e); }
    return true;
  }

  setMode(mode) {
    if (!MODES.includes(mode)) return this.snapshot();
    this.patch({ mode });
    if (mode === 'auto' && this.status.status === 'available') this.download(false);
    this.emit();
    return this.snapshot();
  }
  skip() { if (this.release) this.patch({ skipped: this.release.version }); this.cancel(); this.set({ status: 'idle' }); }
  dismiss() {
    if (this.release && this.status.status === 'available') this.patch({ dismissed: { version: this.release.version, at: Date.now() } });
    this.set({ ...this.status, hidden: true });
  }
  openPage() { this.openExternal((this.release && this.release.page) || RELEASES_PAGE); }
}

module.exports = { Updater, parseRelease, isNewer, findHash, cleanNotes, installerArgs, PLATFORMS, RELEASES_PAGE };
