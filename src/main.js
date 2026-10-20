'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, net, screen, Menu, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { MediaServer, isMediaFile } = require('./media');
const { Downloader } = require('./downloader');
const { Updater } = require('./updater');

const APP_NAME = 'SlopAMP';
app.setName(APP_NAME);
// Portable build: keep playlist/settings in a folder next to the .exe.
const PORTABLE_DIR = process.env.SLOPAMP_DATA_DIR || process.env.WINAMPVLC_DATA_DIR || process.env.PHOSPHOR_DATA_DIR;
if (PORTABLE_DIR) {
  try { fs.mkdirSync(PORTABLE_DIR, { recursive: true }); app.setPath('userData', PORTABLE_DIR); } catch (_) {}
}
if (process.platform === 'win32') app.setAppUserModelId('app.slopamp.player');

// Look like a normal Chrome browser to embed hosts (removes "Electron/x" tokens).
app.userAgentFallback = app.userAgentFallback
  .replace(/\s?Electron\/[\d.]+/i, '')
  .replace(new RegExp(`\\s?(${APP_NAME}|slopamp|winampvlc|phosphor-player)\\/[\\d.]+`, 'i'), '');

const isDev = !app.isPackaged || process.env.PHOSPHOR_DEV === '1' || process.env.WINAMPVLC_DEV === '1' || process.env.SLOPAMP_DEV === '1';
// Packaged: <install>/resources/ffmpeg. Dev checkout: vendor/ffmpeg/<platform>.
const ffmpegDir = [path.join(process.resourcesPath || '', 'ffmpeg'), path.join(__dirname, '..', 'vendor', 'ffmpeg', process.platform)]
  .find(d => fs.existsSync(path.join(d, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'))) || path.join(process.resourcesPath || '', 'ffmpeg');

const logFile = () => path.join(app.getPath('userData'), 'slopamp.log');
function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.map(x => (typeof x === 'string' ? x : (x && x.stack) || JSON.stringify(x))).join(' ')}\n`;
  if (isDev) process.stdout.write(line);
  try { fs.appendFileSync(logFile(), line); } catch (_) {}
}

let win = null;
let server = null;
let downloader = null;
let updater = null;
// Keys owned by the main process; the renderer's state saves must not wipe them.
const MAIN_KEYS = ['window', 'playlistDir', 'dlVideoDir', 'dlAudioDir', 'ytdlpUpdatedAt', 'downloads', 'update'];
const ytdlpDir = [path.join(process.resourcesPath || '', 'ytdlp'), path.join(__dirname, '..', 'vendor', 'ytdlp', process.platform)]
  .find(d => fs.existsSync(path.join(d, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'))) || path.join(process.resourcesPath || '', 'ytdlp');
let normalBounds = null;
let closing = false;
const DEFAULT_W = 420, DEFAULT_H = 900;
let isMini = false;
const pendingOpen = [];

// Another SlopAMP is already running: the lock request has handed it our files (second-instance).
// Leave at once. app.quit() here used to let this copy start a server and a hidden window anyway.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.exit(0);
} else {
  app.on('second-instance', (_e, argv) => {
    const files = argvFiles(argv);
    if (win) {
      if (!win.isVisible()) win.show();
      if (win.isMinimized()) win.restore();
      win.focus();
      if (files.length) win.webContents.send('open-files', files);
    }
  });
}

function argvFiles(argv) {
  const appPath = path.resolve(app.getAppPath());
  return argv.slice(1).filter(a => !a.startsWith('-') && path.resolve(a) !== appPath && path.resolve(a) !== path.resolve(process.execPath) && fs.existsSync(a) && (isMediaFile(a) || fs.statSync(a).isDirectory()))
    .map(a => path.resolve(a));
}

// ---------- persistence ----------
const stateFile = () => path.join(app.getPath('userData'), 'slopamp-state.json');
// This app used to be called WinampVLC (and before that Phosphor): carry the old playlist/settings/download list over once.
function migrateOldState() {
  try {
    if (fs.existsSync(stateFile())) return;
    const ud = app.getPath('userData'), ad = app.getPath('appData');
    const cands = [path.join(ud, 'winampvlc-state.json'), path.join(ad, 'WinampVLC', 'winampvlc-state.json'),
      path.join(ud, 'phosphor-state.json'), path.join(ad, 'Phosphor', 'phosphor-state.json')];
    if (PORTABLE_DIR) cands.unshift(path.join(path.dirname(PORTABLE_DIR), 'WinampVLC Data', 'winampvlc-state.json'), path.join(path.dirname(PORTABLE_DIR), 'Phosphor Data', 'phosphor-state.json'));
    const old = cands.find(f => fs.existsSync(f));
    if (old) { fs.mkdirSync(path.dirname(stateFile()), { recursive: true }); fs.copyFileSync(old, stateFile()); }
  } catch (_) {}
}
function loadState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (_) { return {}; }
}
let saveTimer = null;
let currentState = null;
function saveStateSoon(state) {
  currentState = state;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushState, 400);
}
function flushState() {
  clearTimeout(saveTimer);
  if (!currentState) return;
  try {
    const tmp = stateFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(currentState, null, 1));
    fs.renameSync(tmp, stateFile());
  } catch (e) { log('save failed', e); }
}

// ---------- window ----------
function createWindow() {
  const state = loadState();
  const b = state.window || {};
  const wa = screen.getPrimaryDisplay().workArea;
  const width = clamp(b.width || DEFAULT_W, 420, wa.width);
  const height = clamp(b.height || DEFAULT_H, 480, wa.height);
  const opts = {
    width, height, minWidth: 420, minHeight: 480,
    frame: false,
    backgroundColor: '#1b1d24',
    title: APP_NAME,
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: false
    }
  };
  if (Number.isFinite(b.x) && Number.isFinite(b.y) && onSomeScreen(b.x, b.y)) { opts.x = b.x; opts.y = b.y; }
  win = new BrowserWindow(opts);
  Menu.setApplicationMenu(null);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(server.base)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  win.on('enter-full-screen', () => win.webContents.send('fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen', false));
  // Show the window when it's ready, or after 5 s at the latest: a window that never appears can't be closed,
  // and its invisible SlopAMP would keep running (and block the installer).
  const w = win;
  const reveal = () => { if (!w.isDestroyed() && !w.isVisible()) w.show(); };
  w.once('ready-to-show', reveal);
  w.webContents.once('did-finish-load', () => setTimeout(reveal, 500));
  setTimeout(reveal, 5000);
  let reloaded = false;
  w.webContents.on('render-process-gone', (_e, d) => {
    log('renderer gone:', d.reason, d.exitCode);
    if (closing || w.isDestroyed() || d.reason === 'clean-exit') return;
    // Reload once (deferred: reloading inside this event crashes Electron); crashed twice: close instead of leaving a dead window.
    setTimeout(() => { if (w.isDestroyed()) return; if (!reloaded) { reloaded = true; w.reload(); } else w.destroy(); }, 200);
  });
  win.on('close', () => {
    // If the page hangs while closing, close the window anyway.
    setTimeout(() => { if (!w.isDestroyed()) { log('window did not close in 5 s; forcing it'); w.destroy(); } }, 5000);
    closing = true;
    const s = currentState || loadState();
    s.window = isMini && normalBounds ? normalBounds : win.getNormalBounds();
    currentState = s;
    flushState();
  });
  win.on('closed', () => { win = null; });

  win.loadURL(`${server.base}/app/index.html`);
  if (process.env.PHOSPHOR_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });
}

function setMainState(patch) {
  const s = currentState || loadState();
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete s[k]; else s[k] = v; }
  saveStateSoon(s);
}
function rememberDownload(vid, kind, file, title) {
  const s = currentState || loadState();
  const idx = s.downloads || {};
  idx[vid] = { ...(idx[vid] || {}), [kind]: file };
  if (title) idx[vid].title = String(title).slice(0, 300);
  setMainState({ downloads: idx });
}
// Re-index downloaded files straight from the download folders. Every download is named
// "Title [VIDEOID].ext", so the folders themselves are the source of truth: this recovers
// copies whose index entry was lost (older versions, a different data folder, a playlist
// loaded from a file...).
const DL_FILE_RE = /\[([\w-]{11})\]\.(mp4|m4v|webm|mkv|mov|mp3|m4a|opus|ogg|flac|wav)$/i;
const AUDIO_DL_RE = /\.(mp3|m4a|opus|ogg|flac|wav)$/i;
function scanDownloadFolders() {
  const s = currentState || loadState();
  const idx = s.downloads || {};
  const d = downloadDirs();
  const dirs = [d.video, d.audio];
  for (const name of ['SlopAMP', 'WinampVLC', 'Phosphor']) {   // also find downloads made under the app's earlier names
    const base = path.join(app.getPath('downloads'), name);
    dirs.push(path.join(base, 'Video'), path.join(base, 'Audio'));
  }
  const found = {};
  for (const dir of [...new Set(dirs)]) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { continue; }
    for (const n of names) {
      const m = DL_FILE_RE.exec(n); if (!m) continue;
      const full = path.join(dir, n);
      let st; try { st = fs.statSync(full); } catch (_) { continue; }
      if (!st.isFile() || st.size < 1024) continue;
      const kind = AUDIO_DL_RE.test(n) ? 'audio' : 'video';
      const key = `${m[1]}|${kind}`;
      if (!found[key] || st.mtimeMs > found[key].mtime) found[key] = { vid: m[1], kind, file: full, mtime: st.mtimeMs, title: n.replace(DL_FILE_RE, '').trim() };
    }
  }
  let changed = 0;
  for (const f of Object.values(found)) {
    const e = idx[f.vid] || (idx[f.vid] = {});
    if (e[f.kind] && fs.existsSync(e[f.kind])) continue;
    e[f.kind] = f.file;
    if (!e.title && f.title) e.title = f.title;
    changed++;
  }
  if (changed) { log(`re-indexed ${changed} downloaded file(s) from the download folders`); setMainState({ downloads: idx }); }
  return changed;
}
function downloadDirs() {
  const s = currentState || loadState();
  const base = path.join(app.getPath('downloads'), 'SlopAMP');
  return { video: s.dlVideoDir || path.join(base, 'Video'), audio: s.dlAudioDir || path.join(base, 'Audio'), playlists: path.join(base, 'Playlists') };
}
function playlistsDir() {
  const d = downloadDirs().playlists;
  try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
  return d;
}
const PLAYLIST_RE = /\.(m3u8?|pls)$/i;
function inPlaylistsDir(p) {
  if (typeof p !== 'string' || !PLAYLIST_RE.test(p)) return false;
  const rel = path.relative(playlistsDir(), path.resolve(p));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
function safeFileName(n) { return String(n || 'SlopAMP playlist').replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'SlopAMP playlist'; }

function rememberPlaylistDir(file) {
  const s = currentState || loadState();
  s.playlistDir = path.dirname(file);
  saveStateSoon(s);
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function onSomeScreen(x, y) {
  return screen.getAllDisplays().some(d => x >= d.bounds.x - 50 && y >= d.bounds.y - 50 && x < d.bounds.x + d.bounds.width && y < d.bounds.y + d.bounds.height);
}

// ---------- folder expansion ----------
function expandPaths(paths, out = [], depth = 0) {
  for (const p of paths) {
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        if (depth > 6) continue;
        const kids = fs.readdirSync(p).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(n => path.join(p, n));
        expandPaths(kids, out, depth + 1);
      } else if (isMediaFile(p)) out.push(p);
      else if (/\.(m3u8?|pls)$/i.test(p)) out.push(...readPlaylistFile(p));
    } catch (_) {}
  }
  return out;
}

// Parse .m3u / .m3u8 / .pls into [{loc, title, duration}] (loc = absolute path or http(s) URL).
function parsePlaylistFile(p) {
  const dir = path.dirname(p);
  let text = '';
  try { text = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); } catch (_) { return []; }
  const resolveLoc = (l) => {
    if (/^https?:\/\//i.test(l)) return l;
    if (/^file:\/\//i.test(l)) { try { return require('url').fileURLToPath(l); } catch (_) { return null; } }
    if (/^[a-z]+:\/\//i.test(l)) return null;
    return path.resolve(dir, l);
  };
  const out = [];
  if (/\.pls$/i.test(p)) {
    const rows = {};
    for (const line of text.split(/\r?\n/)) {
      const m = /^(File|Title|Length)(\d+)=(.*)$/i.exec(line.trim());
      if (!m) continue;
      const r = rows[m[2]] || (rows[m[2]] = {});
      r[m[1].toLowerCase()] = m[3].trim();
    }
    for (const k of Object.keys(rows).sort((a, b) => a - b)) {
      const r = rows[k]; const loc = r.file && resolveLoc(r.file);
      if (loc) out.push({ loc, title: r.title || '', duration: Math.max(0, parseFloat(r.length) || 0) });
    }
    return out;
  }
  let pending = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const inf = /^#EXTINF:\s*(-?\d+(?:\.\d+)?)[^,]*,(.*)$/i.exec(line);
    if (inf) { pending = { duration: Math.max(0, parseFloat(inf[1]) || 0), title: inf[2].trim() }; continue; }
    if (line.startsWith('#')) continue;
    const loc = resolveLoc(line);
    if (loc) out.push({ loc, title: pending ? pending.title : '', duration: pending ? pending.duration : 0 });
    pending = null;
  }
  return out;
}

function readPlaylistFile(p) {
  return parsePlaylistFile(p).map(e => e.loc)
    .filter(l => /^https?:/i.test(l) || (fs.existsSync(l) && isMediaFile(l)));
}

const VIDEO_EXT_RE = /\.(mp4|m4v|mkv|avi|mov|wmv|webm|flv|mpe?g|ts|m2ts|mts|vob|3gp|ogv|divx|asf|rmvb?|f4v)$/i;

async function loadPlaylistEntries(p) {
  const entries = parsePlaylistFile(p);
  const out = [];
  const queue = entries.map((e, i) => ({ e, i }));
  const results = new Array(entries.length);
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const { e, i } = queue.shift();
      if (/^https?:/i.test(e.loc)) { results[i] = { url: e.loc, title: e.title }; continue; }
      if (!fs.existsSync(e.loc)) {
        results[i] = { path: e.loc, title: e.title || path.basename(e.loc).replace(/\.[^.]+$/, ''), duration: e.duration, hasVideo: VIDEO_EXT_RE.test(e.loc), missing: true };
        continue;
      }
      if (!isMediaFile(e.loc)) continue;
      // eslint-disable-next-line no-await-in-loop
      const info = await server.probe(e.loc);
      results[i] = {
        path: e.loc,
        title: e.title || (info && info.title) || path.basename(e.loc).replace(/\.[^.]+$/, ''),
        duration: (info && info.duration) || e.duration || 0,
        hasVideo: info ? info.hasVideo : VIDEO_EXT_RE.test(e.loc)
      };
    }
  }));
  for (const r of results) if (r) out.push(r);
  return out;
}

function buildM3U(items) {
  const lines = ['#EXTM3U', '#PLAYLIST:SlopAMP playlist'];
  for (const it of items) {
    const loc = it.type === 'file' ? it.path : it.url;
    if (!loc) continue;
    const title = String(it.title || '').replace(/[\r\n]+/g, ' ');
    lines.push(`#EXTINF:${Math.round(it.duration) > 0 ? Math.round(it.duration) : -1},${title}`);
    lines.push(loc);
  }
  return lines.join('\r\n') + '\r\n';
}

async function describeFiles(paths) {
  const files = expandPaths(paths);
  const out = [];
  const queue = files.slice();
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const f = queue.shift();
      if (/^https?:/i.test(f)) { out.push({ url: f }); continue; }
      // eslint-disable-next-line no-await-in-loop
      const info = await server.probe(f);
      out.push({
        path: f,
        title: (info && info.title) || path.basename(f).replace(/\.[^.]+$/, ''),
        duration: info ? info.duration : 0,
        hasVideo: info ? info.hasVideo : /\.(mp4|mkv|avi|mov|wmv|webm|flv|mpe?g|ts|m2ts|vob|3gp|ogv|m4v)$/i.test(f)
      });
    }
  });
  await Promise.all(workers);
  // keep original order
  const order = new Map(files.map((f, i) => [f, i]));
  out.sort((a, b) => order.get(a.path || a.url) - order.get(b.path || b.url));
  return out;
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('files:describe', (_e, paths) => describeFiles((paths || []).filter(p => typeof p === 'string')));
  ipcMain.handle('files:open-dialog', async (_e, kind) => {
    const res = await dialog.showOpenDialog(win, kind === 'folder'
      ? { properties: ['openDirectory', 'multiSelections'] }
      : {
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Media files', extensions: [...require('./media').MEDIA_EXT, 'm3u', 'm3u8', 'pls'] },
          { name: 'All files', extensions: ['*'] }
        ]
      });
    if (res.canceled) return [];
    return describeFiles(res.filePaths);
  });
  ipcMain.handle('playlist:save', async (_e, items, name) => {
    if (!Array.isArray(items) || !items.length) return { saved: false };
    const res = await dialog.showSaveDialog(win, {
      title: 'Save playlist',
      defaultPath: path.join(playlistsDir(), `${safeFileName(name)}.m3u8`),
      filters: [{ name: 'Playlist (M3U8)', extensions: ['m3u8'] }, { name: 'Playlist (M3U)', extensions: ['m3u'] }]
    });
    if (res.canceled || !res.filePath) return { saved: false };
    try {
      fs.writeFileSync(res.filePath, buildM3U(items), 'utf8');
      rememberPlaylistDir(res.filePath);
      return { saved: true, name: path.basename(res.filePath) };
    } catch (e) { log('playlist save failed', e); return { saved: false, error: String(e.message || e) }; }
  });
  // Quick Save: write the tab straight to Playlists\\<tab name>.m3u8, replacing any older copy (no dialog).
  ipcMain.handle('playlist:quicksave', (_e, items, name) => {
    if (!Array.isArray(items) || !items.length) return { saved: false, error: 'empty' };
    const file = path.join(playlistsDir(), `${safeFileName(name)}.m3u8`);
    try {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, buildM3U(items), 'utf8');
      fs.renameSync(tmp, file);
      return { saved: true, name: path.basename(file), path: file };
    } catch (e) { log('quick save failed', e); return { saved: false, error: String(e.message || e) }; }
  });
  // Quick Save All: every non-empty tab to Playlists\\<tab name>.m3u8 (same-named tabs get " (2)", " (3)"...).
  ipcMain.handle('playlist:quicksave-all', (_e, tabs) => {
    const out = []; const used = new Set();
    for (const t of Array.isArray(tabs) ? tabs : []) {
      if (!t || !Array.isArray(t.items) || !t.items.length) continue;
      const base = safeFileName(t.name); let name = base, n = 2;
      while (used.has(name.toLowerCase())) name = `${base} (${n++})`;
      used.add(name.toLowerCase());
      const file = path.join(playlistsDir(), `${name}.m3u8`);
      try { fs.writeFileSync(file + '.tmp', buildM3U(t.items), 'utf8'); fs.renameSync(file + '.tmp', file); out.push({ name: path.basename(file), ok: true }); }
      catch (e) { log('quick save all failed', e); out.push({ name: path.basename(file), ok: false, error: String(e.message || e) }); }
    }
    return out;
  });
  ipcMain.handle('playlist:load', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Load playlist',
      defaultPath: playlistsDir(),
      properties: ['openFile'],
      filters: [{ name: 'Playlists', extensions: ['m3u8', 'm3u', 'pls'] }, { name: 'All files', extensions: ['*'] }]
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    const file = res.filePaths[0];
    rememberPlaylistDir(file);
    return { name: path.basename(file), entries: await loadPlaylistEntries(file) };
  });
  // ---- downloads
  ipcMain.handle('dl:info', () => ({ available: downloader.available(), dirs: downloadDirs() }));
  ipcMain.handle('dl:start', (_e, job) => {
    if (!job || typeof job.url !== 'string' || (!/^https:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(job.url))) return { ok: false, reason: 'unsupported' };
    if (!downloader.available()) return { ok: false, reason: 'missing' };
    const vid = /^[\w-]{11}$/.test(job.vid || '') ? job.vid : null;
    return downloader.start({ id: String(job.id), vid, url: job.url, kind: job.kind === 'audio' ? 'audio' : 'video', quality: ['best', '1080', '720', '480'].includes(job.quality) ? job.quality : 'best', title: String(job.title || '') });
  });
  ipcMain.on('dl:cancel', (_e, id) => downloader.cancel(String(id)));
  // Download index: YouTube video id -> { video, audio } file paths. Lets a link re-added
  // later (playlist LOAD, paste, drag) find the copy that was already downloaded.
  ipcMain.handle('dl:lookup', (_e, vids) => {
    try { scanDownloadFolders(); } catch (e) { log('scan failed', e); }
    const idx = (currentState || loadState()).downloads || {};
    const out = {}; let pruned = false;
    for (const v of Array.isArray(vids) ? vids : []) {
      const e = idx[v]; if (!e) continue;
      const r = {};
      for (const k of ['video', 'audio']) {
        if (!e[k]) continue;
        if (fs.existsSync(e[k])) r[k] = e[k]; else { delete e[k]; pruned = true; }
      }
      if (!e.video && !e.audio) delete idx[v];
      if (r.video || r.audio) out[v] = r;
    }
    if (pruned) setMainState({ downloads: idx });
    return out;
  });
  ipcMain.on('dl:remember', (_e, vid, kind, file, title) => {
    if (!/^[\w-]{11}$/.test(vid || '') || typeof file !== 'string') return;
    const cur = ((currentState || loadState()).downloads || {})[vid];
    if (cur && cur[kind === 'audio' ? 'audio' : 'video'] === file && (cur.title || !title)) return;   // nothing new
    rememberDownload(vid, kind === 'audio' ? 'audio' : 'video', file, typeof title === 'string' ? title : '');
  });
  // ---- Downloads manager: everything SlopAMP has downloaded (from the download index)
  ipcMain.handle('dlm:list', () => {
    try { scanDownloadFolders(); } catch (e) { log('scan failed', e); }
    const idx = (currentState || loadState()).downloads || {};
    const rows = [];
    for (const [vid, e] of Object.entries(idx)) {
      for (const kind of ['video', 'audio']) {
        const file = e[kind]; if (!file) continue;
        let st = null; try { st = fs.statSync(file); } catch (_) {}
        const fromName = path.basename(file).replace(/\.[^.]+$/, '').replace(/\s*\[[\w-]{11}\]$/, '');
        rows.push({ vid, kind, path: file, title: e.title || fromName, size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0, missing: !st });
      }
    }
    return rows;
  });
  ipcMain.handle('dlm:delete', async (_e, list) => {
    const s = currentState || loadState();
    const idx = s.downloads || {};
    const out = [];
    for (const r of Array.isArray(list) ? list : []) {
      const kind = r && r.kind === 'audio' ? 'audio' : 'video';
      const e = r && idx[r.vid];
      if (!e || e[kind] !== r.path) { out.push({ path: r && r.path, ok: false, error: 'Not a SlopAMP download.' }); continue; }
      let ok = true, error = '';
      if (fs.existsSync(r.path)) { try { await shell.trashItem(r.path); } catch (err) { ok = false; error = String(err.message || err); } }
      if (ok) { delete e[kind]; if (!e.video && !e.audio) delete idx[r.vid]; }
      out.push({ path: r.path, ok, error });
    }
    setMainState({ downloads: idx });
    return out;
  });
  ipcMain.handle('dlm:clean-missing', () => {
    const idx = (currentState || loadState()).downloads || {};
    let n = 0;
    for (const [vid, e] of Object.entries(idx)) {
      for (const k of ['video', 'audio']) if (e[k] && !fs.existsSync(e[k])) { delete e[k]; n++; }
      if (!e.video && !e.audio) delete idx[vid];
    }
    setMainState({ downloads: idx });
    return n;
  });
  ipcMain.on('dl:forget', (_e, vid, kind) => {
    const idx = (currentState || loadState()).downloads || {};
    if (!idx[vid]) return;
    if (kind) delete idx[vid][kind]; else delete idx[vid];
    if (idx[vid] && !idx[vid].video && !idx[vid].audio) delete idx[vid];
    setMainState({ downloads: idx });
  });
  ipcMain.handle('dl:choose-dir', async (_e, kind) => {
    const dirs = downloadDirs();
    const res = await dialog.showOpenDialog(win, { title: kind === 'audio' ? 'Folder for downloaded audio' : 'Folder for downloaded videos', defaultPath: kind === 'audio' ? dirs.audio : dirs.video, properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths.length) return dirs;
    setMainState({ [kind === 'audio' ? 'dlAudioDir' : 'dlVideoDir']: res.filePaths[0] });
    return downloadDirs();
  });
  ipcMain.handle('dl:reset-dirs', () => { setMainState({ dlAudioDir: undefined, dlVideoDir: undefined }); return downloadDirs(); });
  // ---- saved playlist files (Downloads\\SlopAMP\\Playlists), shown in Manage Library
  ipcMain.handle('pl:list', () => {
    const dir = playlistsDir(); const out = [];
    let names = []; try { names = fs.readdirSync(dir); } catch (_) {}
    for (const n of names) {
      if (!PLAYLIST_RE.test(n)) continue;
      const full = path.join(dir, n);
      let st; try { st = fs.statSync(full); } catch (_) { continue; }
      if (!st.isFile()) continue;
      out.push({ kind: 'playlist', path: full, title: n.replace(PLAYLIST_RE, ''), ext: path.extname(n).slice(1).toUpperCase(), count: parsePlaylistFile(full).length, size: st.size, mtime: st.mtimeMs });
    }
    return out;
  });
  ipcMain.handle('pl:open', async (_e, p) => {
    if (!inPlaylistsDir(p) || !fs.existsSync(p)) return { error: 'missing' };
    return { name: path.basename(p), entries: await loadPlaylistEntries(p) };
  });
  ipcMain.handle('pl:delete', async (_e, paths) => {
    const out = [];
    for (const p of Array.isArray(paths) ? paths : []) {
      if (!inPlaylistsDir(p)) { out.push({ path: p, ok: false, error: 'Not a SlopAMP playlist.' }); continue; }
      try { if (fs.existsSync(p)) await shell.trashItem(p); out.push({ path: p, ok: true }); } catch (e) { out.push({ path: p, ok: false, error: String(e.message || e) }); }
    }
    return out;
  });
  ipcMain.on('dl:open-dir', (_e, kind) => {
    const d = kind === 'playlists' ? playlistsDir() : downloadDirs()[kind === 'audio' ? 'audio' : 'video'];
    try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
    shell.openPath(d);
  });
  ipcMain.handle('files:exists', (_e, paths) => (Array.isArray(paths) ? paths.map(p => typeof p === 'string' && fs.existsSync(p)) : []));
  ipcMain.handle('file:trash', async (_e, p) => {
    if (typeof p !== 'string' || !isMediaFile(p) || !fs.existsSync(p)) return { ok: false, error: 'File not found.' };
    try { await shell.trashItem(p); return { ok: true }; } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  // ---- subtitles
  ipcMain.handle('subs:list', (_e, file) => (typeof file === 'string' ? server.listSubs(file) : { embedded: [], external: [] }));
  ipcMain.handle('subs:open-dialog', async (_e, near) => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Load subtitle file',
      defaultPath: typeof near === 'string' && fs.existsSync(near) ? path.dirname(near) : undefined,
      properties: ['openFile'],
      filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa'] }, { name: 'All files', extensions: ['*'] }]
    });
    if (res.canceled || !res.filePaths.length) return null;
    return server.subFile(res.filePaths[0]);
  });
  ipcMain.handle('media:prepare', (_e, file, opts) => server.prepare(file, opts || {}));
  ipcMain.handle('state:load', () => loadState());
  ipcMain.on('state:save', (_e, s) => {
    if (!s || typeof s !== 'object') return;
    const cur = currentState || loadState();
    for (const k of MAIN_KEYS) { if (cur[k] !== undefined) s[k] = cur[k]; else delete s[k]; }
    saveStateSoon(s);
    if (closing || s.flush) { delete s.flush; flushState(); }
  });
  ipcMain.handle('web:meta', (_e, url) => fetchMeta(url));
  ipcMain.on('shell:open', (_e, url) => { if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url); });
  ipcMain.on('shell:show', (_e, p) => { if (typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p); });

  ipcMain.on('win:minimize', () => win && win.minimize());
  ipcMain.on('win:close', () => win && win.close());
  ipcMain.on('win:maximize', () => { if (!win) return; if (win.isMaximized()) win.unmaximize(); else win.maximize(); });
  ipcMain.handle('win:fullscreen', (_e, on) => { if (win) win.setFullScreen(on === undefined ? !win.isFullScreen() : !!on); return win && win.isFullScreen(); });
  // The lightning badge: back to the normal window size (leaves fullscreen / mini / maximized).
  ipcMain.handle('win:restore-default', () => {
    if (!win) return false;
    if (win.isFullScreen()) win.setFullScreen(false);
    if (isMini) { isMini = false; win.setAlwaysOnTop(false); win.setResizable(true); win.setMinimumSize(420, 480); }
    if (win.isMaximized()) win.unmaximize();
    const b = win.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    const w = Math.min(DEFAULT_W, wa.width), h = Math.min(DEFAULT_H, wa.height);
    const x = clamp(b.x, wa.x, wa.x + wa.width - w), y = clamp(b.y, wa.y, wa.y + wa.height - h);
    win.setBounds({ x, y, width: w, height: h }, true);
    normalBounds = null;
    return true;
  });
  ipcMain.handle('win:mini', (_e, on, miniHeight) => {
    if (!win) return false;
    if (win.isFullScreen()) win.setFullScreen(false);
    if (on && !isMini) {
      normalBounds = win.getBounds();
      if (win.isMaximized()) win.unmaximize();
      isMini = true;
      win.setMinimumSize(300, 60);
      win.setResizable(false);
      win.setAlwaysOnTop(true, 'floating');
      win.setBounds({ x: normalBounds.x, y: normalBounds.y, width: normalBounds.width, height: Math.round(miniHeight || 150) });
    } else if (!on && isMini) {
      isMini = false;
      win.setAlwaysOnTop(false);
      win.setResizable(true);
      win.setMinimumSize(420, 480);
      if (normalBounds) win.setBounds(normalBounds);
    }
    return isMini;
  });
  // ---- auto-updates (see updater.js)
  ipcMain.handle('upd:get', () => updater.snapshot());
  ipcMain.handle('upd:check', () => updater.check(true));
  ipcMain.handle('upd:mode', (_e, mode) => updater.setMode(String(mode)));
  ipcMain.on('upd:download', (_e, installAfter) => updater.download(!!installAfter));
  ipcMain.on('upd:cancel', () => updater.cancel());
  ipcMain.on('upd:install', () => updater.install());
  ipcMain.on('upd:skip', () => updater.skip());
  ipcMain.on('upd:dismiss', () => updater.dismiss());
  ipcMain.on('upd:page', () => updater.openPage());
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    encoder: server.encoder,
    hasFfmpeg: server.hasFfmpeg(),
    platform: process.platform,
    pendingOpen: pendingOpen.splice(0)
  }));
}

async function fetchMeta(url) {
  try {
    let api = null;
    if (/youtu\.?be/i.test(url)) api = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
    if (!api) return null;
    const r = await net.fetch(api);
    if (!r.ok) return { status: r.status };
    const j = await r.json();
    return { title: j.title || '', author: j.author_name || '', status: 200 };
  } catch (e) { return null; }
}

// ---------- lifecycle ----------
app.whenReady().then(async () => {
  if (!gotLock) return;
  migrateOldState();
  server = new MediaServer({ uiDir: path.join(__dirname, 'renderer'), ffmpegDir, log });
  await server.start();
  log(`${APP_NAME} ${app.getVersion()} started on ${server.base}; ffmpeg=${server.hasFfmpeg()}`);
  server.detectEncoder().catch(e => log('encoder detect failed', e));
  // Safety net: YouTube's embed refuses to play without a Referer (error 153).
  const { session } = require('electron');
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube.com/embed/*', 'https://www.youtube-nocookie.com/embed/*'] }, (details, cb) => {
    const h = details.requestHeaders;
    if (!h.Referer && !h.referer) h.Referer = `${server.base}/`;
    cb({ requestHeaders: h });
  });
  pendingOpen.push(...argvFiles(process.argv));
  downloader = new Downloader({
    bundledDir: ytdlpDir,
    dataDir: app.getPath('userData'),
    ffmpegDir,
    // yt-dlp needs a JavaScript runtime for YouTube; Electron's built-in Node serves as one.
    jsRuntime: { path: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } },
    log,
    emit: (ev) => {
      if (ev.status === 'done' && ev.file && ev.vid) rememberDownload(ev.vid, ev.kind === 'audio' ? 'audio' : 'video', ev.file, ev.title);
      if (win && !win.isDestroyed()) win.webContents.send('dl:event', ev);
    },
    getDirs: downloadDirs,
    getState: () => currentState || loadState(),
    setState: setMainState
  });
  // Only the installed Windows build updates itself; the portable exe and dev runs just open the download page.
  const portable = !!(PORTABLE_DIR || process.env.SLOPAMP_PORTABLE) || /-portable$/i.test(path.basename(path.dirname(process.execPath)));
  const testFeed = process.env.SLOPAMP_UPDATE_TEST ? path.resolve(process.env.SLOPAMP_UPDATE_TEST) : null;
  updater = new Updater({
    fetch: (url, opts) => net.fetch(url, opts),
    version: (testFeed && process.env.SLOPAMP_TEST_VERSION) || app.getVersion(),
    testFeed,
    tempDir: app.getPath('temp'),
    canInstall: app.isPackaged && process.platform === 'win32' && !portable,
    installDir: path.dirname(process.execPath),
    getState: () => (currentState || loadState()).update,
    setState: (v) => setMainState({ update: v }),
    emit: (st) => { if (win && !win.isDestroyed()) win.webContents.send('upd:event', st); },
    quit: () => { if (win && !win.isDestroyed()) win.close(); else app.quit(); },
    openExternal: (url) => shell.openExternal(url),
    log
  });
  registerIpc();
  createWindow();
  updater.start();
  registerMediaKeys();
});

// Keyboard media keys (Play/Pause, Next, Previous, Stop) work even when SlopAMP isn't focused.
function registerMediaKeys() {
  const keys = { MediaPlayPause: 'playpause', MediaNextTrack: 'next', MediaPreviousTrack: 'prev', MediaStop: 'stop' };
  for (const [acc, action] of Object.entries(keys)) {
    try {
      const ok = globalShortcut.register(acc, () => { if (win && !win.isDestroyed()) win.webContents.send('media-key', action); });
      if (!ok) log(`media key ${acc} is taken by another app`);
    } catch (e) { log('media key register failed', acc, e); }
  }
}
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch (_) {} });

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  log('quitting');
  // Quitting must end every SlopAMP process, even if something below hangs.
  setTimeout(() => { log('quit took over 8 s; exiting'); app.exit(0); }, 8000);
  for (const step of [() => updater && updater.cancel(), () => downloader && downloader.stopAll(true), flushState, () => server && server.stop()]) {
    try { step(); } catch (e) { log('quit step failed', e); }
  }
});
