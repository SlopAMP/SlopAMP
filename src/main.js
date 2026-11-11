'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, net, screen, Menu, globalShortcut, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { MediaServer, isMediaFile, encoderArgs } = require('./media');
const mp3info = require('./mp3info');      // 2.9.6: MP3 tags and length without ffprobe
const { Thumbs } = require('./thumbs');
const { Clipper } = require('./clip');
const share = require('./share');
const { YtWeb } = require('./ytweb');
const { Downloader } = require('./downloader');
const { XStream } = require('./xstream');
const { Updater } = require('./updater');
const { WindowManager, PANELS, HOSTS } = require('./windows');

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
let xstream = null;    // 2.8: X posts streamed in the player (xstream.js)
let updater = null;
let wm = null;        // movable windows (see windows.js)
let clipper = null;   // CLIP (2.3, clip.js)
let thumbs = null;   // Library preview pictures (2.7, thumbs.js)
let ytweb = null;     // the YOUTUBE window's page (2.3, ytweb.js)
// Keys owned by the main process; the renderer's state saves must not wipe them.
const MAIN_KEYS = ['window', 'layout', 'playlistDir', 'dlVideoDir', 'dlAudioDir', 'ytdlpUpdatedAt', 'downloads', 'update', 'clips', 'sys'];
const ytdlpDir = [path.join(process.resourcesPath || '', 'ytdlp'), path.join(__dirname, '..', 'vendor', 'ytdlp', process.platform)]
  .find(d => fs.existsSync(path.join(d, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'))) || path.join(process.resourcesPath || '', 'ytdlp');
let closing = false;
let closeOk = false;    // 2.9.2: closing was confirmed (or nothing was downloading)
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
  // 2.4 (#6 / #5): playlist files (.m3u8 / .m3u / .pls) and shared .zip playlists come through too
  return argv.slice(1).filter(a => !a.startsWith('-') && path.resolve(a) !== appPath && path.resolve(a) !== path.resolve(process.execPath) && fs.existsSync(a) && (isMediaFile(a) || /\.(m3u8?|pls|zip)$/i.test(a) || fs.statSync(a).isDirectory()))
    .map(a => path.resolve(a));
}

// 2.4 #6: SlopAMP as a playlist app for the current user (the installer does the same at install time).
// The Portable copy registers its own .exe (its launcher passes the file on), so "Open with" survives restarts.
const PLAYLIST_TYPES = ['.m3u8', '.m3u', '.pls'];
function playlistAppExe() { return process.env.SLOPAMP_PORTABLE_EXE && fs.existsSync(process.env.SLOPAMP_PORTABLE_EXE) ? process.env.SLOPAMP_PORTABLE_EXE : process.execPath; }
function registerPlaylistApp() {
  const exe = playlistAppExe(), app1 = path.basename(exe), C = 'HKCU\\Software\\Classes';
  const cmd = `"${exe}" "%1"`;
  const keys = [
    [`${C}\\SlopAMP.Playlist`, '', 'SlopAMP playlist'], [`${C}\\SlopAMP.Playlist\\DefaultIcon`, '', `${exe},0`], [`${C}\\SlopAMP.Playlist\\shell\\open\\command`, '', cmd],
    [`${C}\\Applications\\${app1}`, 'FriendlyAppName', 'SlopAMP'], [`${C}\\Applications\\${app1}\\shell\\open\\command`, '', cmd],
    ['HKCU\\Software\\SlopAMP\\Capabilities', 'ApplicationName', 'SlopAMP'], ['HKCU\\Software\\SlopAMP\\Capabilities', 'ApplicationDescription', 'SlopAMP media player'],
    ['HKCU\\Software\\RegisteredApplications', 'SlopAMP', 'Software\\SlopAMP\\Capabilities'],
    ...PLAYLIST_TYPES.flatMap(t => [[`${C}\\${t}\\OpenWithProgids`, 'SlopAMP.Playlist', '', 'REG_NONE'], [`${C}\\Applications\\${app1}\\SupportedTypes`, t, ''], ['HKCU\\Software\\SlopAMP\\Capabilities\\FileAssociations', t, 'SlopAMP.Playlist']])
  ];
  const run = (k, v, d, type) => new Promise((res, rej) => execFileReg(['add', k, ...(v ? ['/v', v] : ['/ve']), '/t', type || 'REG_SZ', ...(type === 'REG_NONE' ? [] : ['/d', d]), '/f'], (e) => (e ? rej(e) : res())));
  return keys.reduce((p, [k, v, d, t]) => p.then(() => run(k, v, d, t)), Promise.resolve()).then(() => log(`playlist association registered for ${exe}`));
}
function execFileReg(args, cb) { require('child_process').execFile('reg.exe', args, { windowsHide: true }, cb); }

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

// ---------- windows ----------
// The player is the main window; the equalizer, video/visualizer and playlist are child windows the
// renderer opens with window.open() (windows.js keeps track of where they all are).
function webPrefs() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    autoplayPolicy: 'no-user-gesture-required',
    spellcheck: false,
    backgroundThrottling: false
  };
}
function guardNavigation(wc) {
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith(server.base)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
}
function createWindow() {
  const state = loadState();
  wm = new WindowManager({
    getLayout: () => state.layout,
    saveLayout: (layout) => setMainState({ layout }),
    legacyWindow: state.window,
    legacyPlHeight: state.plHeight,
    version: app.getVersion(),
    log
  });
  // backgroundColor = --frame-outer in skins/classic.css (only seen for a moment before the page paints)
  const base = { backgroundColor: '#1b1d24', title: APP_NAME, icon: path.join(__dirname, 'renderer', 'icon.png'), webPreferences: webPrefs() };
  win = new BrowserWindow(wm.mainOptions({ ...base, frame: false, show: false }));
  wm.attach('main', win);
  // The YOUTUBE window's page appears / goes with its panel (2.3)
  ytweb = new YtWeb({ wm, log, send: (ch, v) => { if (win && !win.isDestroyed()) win.webContents.send(ch, v); } });
  wm.onPanel = (id, shown) => { if (id === 'ytweb') { if (shown) ytweb.show(); else ytweb.hide(); } };
  if (isDev) global.__slopamp = { wm, ytweb, get clipper() { return clipper; }, get thumbs() { return thumbs; }, get xstream() { return xstream; }, get server() { return server; }, sys: { toTray: () => toTray(), fromTray: () => fromTray(), get inTray() { return inTray; }, get tray() { return tray; }, get title() { return trayTitle; }, menu: () => trayMenu().items.map(i => i.label), mediaKeys: () => Object.keys(MEDIA_KEYS).filter(a => globalShortcut.isRegistered(a)) } };   // for the test scripts
  Menu.setApplicationMenu(null);

  const panelUrl = `${server.base}/app/panel.html`;
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (url.split('?')[0] === panelUrl && (PANELS.includes(frameName) || HOSTS.includes(frameName)) && !wm.wins.has(frameName)) {
      return { action: 'allow', overrideBrowserWindowOptions: wm.childOptions(frameName, base) };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', (child, details) => {
    child.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    guardNavigation(child.webContents);
    wm.attach(details.frameName, child);
  });
  guardNavigation(win.webContents);
  // The windows appear together once the renderer has placed them (windows.js start()), or after
  // 5 s at the latest: a window that never appears can't be closed, and its invisible SlopAMP would
  // keep running (and block the installer).
  const w = win;
  const reveal = () => { if (!w.isDestroyed() && !w.isVisible()) w.show(); };
  setTimeout(reveal, 5000);
  let reloaded = false;
  w.webContents.on('render-process-gone', (_e, d) => {
    log('renderer gone:', d.reason, d.exitCode);
    if (closing || w.isDestroyed() || d.reason === 'clean-exit') return;
    // Reload once (deferred: reloading inside this event crashes Electron); crashed twice: close instead of leaving a dead window.
    setTimeout(() => {
      if (w.isDestroyed()) return;
      if (!reloaded) { reloaded = true; wm.closeAll(); wm.quitting = false; wm.wins = new Map([['main', w]]); wm.started = false; w.reload(); } else w.destroy();
    }, 200);
  });
  win.on('close', (e) => {
    // 2.9.2: Settings → General → Ask before closing while something downloads (on by default): the player asks
    if (!closeOk && (currentState || loadState()).askCloseDl !== false && downloader && (downloader.active || downloader.queue.length) && !win.webContents.isDestroyed()) {
      e.preventDefault(); win.webContents.send('app:close-ask'); return;
    }
    // If the page hangs while closing, close the window anyway.
    setTimeout(() => { if (!w.isDestroyed()) { log('window did not close in 5 s; forcing it'); w.destroy(); } }, 5000);
    closing = true;
    wm.closeAll();
    flushState();
  });
  win.on('closed', () => { win = null; });
  win.on('minimize', () => { if (sysCfg().tray) setImmediate(toTray); });     // Minimize to tray (2.4)

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
// Download keys: a YouTube video id (11 characters) or an X post, "x<post id>" ("x<post id>-<n>" for the
// n-th video of a post with several). X items (2.1) are only ever downloaded, never streamed.
const KEY_SRC = '[\\w-]{11}|x\\d{1,25}(?:-\\d{1,2})?';
const KEY_RE = new RegExp(`^(?:${KEY_SRC})$`);
const X_POST_URL_RE = /^https:\/\/x\.com\/\w{1,15}\/status\/\d{1,25}(?:\/video\/\d{1,2})?$/;
const DL_FILE_RE_TAIL = new RegExp(`\\s*\\[(?:${KEY_SRC})\\]$`);   // " [key]" at the end of a name without its extension
const DL_FILE_RE = new RegExp(`\\[(${KEY_SRC})\\]\\.(mp4|m4v|webm|mkv|mov|mp3|m4a|opus|ogg|flac|wav)$`, 'i');
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
// ---- shared helpers (2.3.1: SLOP's code is gone; these stayed)
// SLOP (1.6–2.3) made packs in Downloads\SlopAMP\Slop. It was hidden in 2.3.0 and removed in 2.3.1: SlopAMP
// never deletes that folder (users' packs stay on disk); only the 1.7 skins move below still looks in it.
const legacySlopDir = () => path.join(app.getPath('downloads'), 'SlopAMP', 'Slop');
function fileSafe(s) { return String(s).replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '') || 'YouTube video'; }
const ffmpegExe = () => path.join(ffmpegDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const rmQuiet = (f) => { try { fs.rmSync(f, { force: true, recursive: true }); } catch (_) {} };
const fileUrl = (f) => { try { const st = fs.statSync(f); return `${server.base}/f/${server.keyFor(f)}${path.extname(f).toLowerCase()}?v=${Math.round(st.mtimeMs)}`; } catch (_) { return null; } };

// ---- user skins (1.7): Downloads\SlopAMP\skins\<slug>.css, made with the Skin Editor or imported.
// Same shape as the built-ins (src/renderer/skins/*.css): a header comment, a :root block with what
// differs from Classic, then the extra rules of the skin it started from (so it works on its own). The
// header's `slopamp: {...}` line holds the display name, the skin it came from and the picker swatches.
// In the saved layout a user skin's id is "user:<slug>"; built-ins keep their plain ids.
const BUILTIN_SKINS = path.join(__dirname, 'renderer', 'skins');
const SKIN_MAX = 256 * 1024;
const skinsDir = () => path.join(app.getPath('downloads'), 'SlopAMP', 'skins');   // next to Video, Audio, Playlists and Slop (packs only)
// 1.7.0 test builds kept skins in Downloads\SlopAMP\Slop\skins: move them over once. Same name and same
// content: the old copy goes; same name, other content: it gets a free name (and the saved skin follows it).
function migrateSkinsFolder() {
  const old = path.join(legacySlopDir(), 'skins');
  let files = [];
  try { files = fs.readdirSync(old).filter(f => /\.css$/i.test(f)); } catch (_) { return; }
  const moved = {};
  try { fs.mkdirSync(skinsDir(), { recursive: true }); } catch (e) { log('skins folder failed', e.message); return; }
  for (const f of files) {
    const src = path.join(old, f), slug = path.basename(f, path.extname(f)).toLowerCase();
    try {
      let dst = path.join(skinsDir(), f);
      if (fs.existsSync(dst)) {
        if (fs.readFileSync(dst).equals(fs.readFileSync(src))) { rmQuiet(src); continue; }
        const ns = freeSlug(slug); dst = path.join(skinsDir(), `${ns}.css`); moved[slug] = ns;
      }
      try { fs.renameSync(src, dst); } catch (_) { fs.copyFileSync(src, dst); rmQuiet(src); }   // another drive: copy
    } catch (e) { log(`skin move failed: ${f}`, e.message); }
  }
  try { if (!fs.readdirSync(old).length) fs.rmdirSync(old); } catch (_) {}
  const st = currentState || loadState(), on = st.layout && /^user:([a-z0-9-]+)$/.exec(st.layout.skin || '');
  if (on && moved[on[1]]) { setMainState({ layout: { ...st.layout, skin: `user:${moved[on[1]]}` } }); flushState(); }   // now: the windows read the file next
  log(`skins moved from Slop\\skins: ${files.length} file(s)`);
}
const skinSlug = (name) => String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'my-skin';
function skinFile(id) {              // 'user:<slug>' or a built-in id -> its file (null if there's none)
  const s = String(id || ''), u = /^user:([a-z0-9-]{1,60})$/.exec(s);
  if (u) { const f = path.join(skinsDir(), `${u[1]}.css`); return fs.existsSync(f) ? f : null; }
  if (/^[a-z0-9-]{1,40}$/.test(s)) { const f = path.join(BUILTIN_SKINS, `${s}.css`); return fs.existsSync(f) ? f : null; }
  return null;
}
function skinMeta(text) { const m = /slopamp:\s*(\{.*\})/.exec(String(text)); try { return m ? JSON.parse(m[1]) : {}; } catch (_) { return {}; } }
// Imported CSS can't fetch anything or run anything: no @import, no url() except data:, no old IE tricks.
function cleanSkinCss(text) {
  return String(text).replace(/@import[^;]*;?/gi, '').replace(/url\(\s*(?!['"]?data:)[^)]*\)/gi, 'none')
    .replace(/expression\s*\(/gi, '(').replace(/behavior\s*:/gi, 'x-behavior:').replace(/-moz-binding/gi, 'x-binding').replace(/<\/?\s*style[^>]*>/gi, '');
}
// A skin file -> { vars: Map('--name' -> value), extra: the rules after :root }
function splitSkin(text) {
  text = String(text);
  const at = text.search(/:root\s*\{/), vars = new Map();
  if (at < 0) return { vars, extra: '' };
  const open = text.indexOf('{', at), close = text.indexOf('}', open);
  const block = text.slice(open + 1, close < 0 ? text.length : close).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars.set(m[1], m[2].trim());
  return { vars, extra: close < 0 ? '' : text.slice(close + 1).trim() };
}
function skinEntry(full) {
  let st, text = '';
  try { st = fs.statSync(full); text = fs.readFileSync(full, 'utf8').slice(0, 4000); } catch (_) { return null; }
  const m = skinMeta(text), slug = path.basename(full, '.css');
  return { id: `user:${slug}`, slug, file: full, name: String(m.name || slug).slice(0, 60), base: typeof m.base === 'string' ? m.base : '', baseName: typeof m.baseName === 'string' ? m.baseName : '',
    sw: Array.isArray(m.sw) ? m.sw.slice(0, 6).map(String) : swatchFallback(full), size: st.size, mtime: st.mtimeMs };
}
// a skin imported before 2.5.2 (or dropped in the folder by hand) has no preview colours: take them from its values
function swatchFallback(full) { try { return swatchesOf(splitSkin(cleanSkinCss(fs.readFileSync(full, 'utf8').slice(0, SKIN_MAX))).vars); } catch (_) { return null; } }
function listSkins() {
  let files = [];
  try { files = fs.readdirSync(skinsDir()).filter(f => /^[a-z0-9-]{1,60}\.css$/.test(f)); } catch (_) {}
  return files.map(f => skinEntry(path.join(skinsDir(), f))).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}
function freeSlug(name, keep) {
  const base = skinSlug(name);
  if (keep === base) return base;
  let slug = base;
  for (let i = 2; fs.existsSync(path.join(skinsDir(), `${slug}.css`)); i++) slug = `${base}-${i}`;
  return slug;
}
function skinHeader(name, meta) {
  const n = String(name).replace(/\*\//g, '').replace(/[\r\n]/g, ' ');
  return `/* SlopAMP skin: "${n}"${meta.baseName ? ` — made with the Skin Editor from "${String(meta.baseName).replace(/\*\//g, '')}"` : ''}.\n`
    + `   slopamp: ${JSON.stringify(meta).replace(/\*\//g, '* /')}\n`
    + '   Loaded on top of classic.css; only what differs from Classic is here.\n'
    + '   To share it, share this file: Library → SKINS → Import adds it to another SlopAMP. */\n';
}
// Save: the base skin's values + the editor's changes, minus whatever equals Classic, + the base's extra rules.
// o: { name, from (the skin whose values and extra rules it starts from), base / baseName (what the header
//      says it was made from), vars: { '--x': value }, sw: [6 colours], slug (overwrite that skin) }
function writeSkin(o) {
  const name = String(o.name || '').trim().slice(0, 60) || 'My skin';
  const classic = splitSkin(fs.readFileSync(path.join(BUILTIN_SKINS, 'classic.css'), 'utf8')).vars;
  const from = o.from || o.base, bf = from && from !== 'classic' ? skinFile(from) : null;
  const b = bf ? splitSkin(fs.readFileSync(bf, 'utf8')) : { vars: new Map(), extra: '' };
  const merged = new Map(b.vars);
  for (const [k, v] of Object.entries(o.vars || {})) if (/^--[\w-]{1,60}$/.test(k) && typeof v === 'string' && v.length < 400 && !/[;{}<>]/.test(v)) merged.set(k, v.trim());
  for (const [k, v] of [...merged]) if (classic.get(k) === v) merged.delete(k);
  const slug = o.slug && /^[a-z0-9-]{1,60}$/.test(o.slug) ? o.slug : freeSlug(name);
  const meta = { v: 1, name, base: String(o.base || 'classic'), baseName: String(o.baseName || ''), sw: Array.isArray(o.sw) ? o.sw.slice(0, 6).map(c => String(c).slice(0, 40)) : undefined };
  const text = skinHeader(name, meta) + ':root {\n' + [...merged].map(([k, v]) => `  ${k}: ${v};`).join('\n') + '\n}\n' + (b.extra ? `\n${cleanSkinCss(b.extra)}\n` : '');
  fs.mkdirSync(skinsDir(), { recursive: true });
  const out = path.join(skinsDir(), `${slug}.css`);
  fs.writeFileSync(out + '.part', text); fs.renameSync(out + '.part', out);
  log(`skin saved: ${slug}.css (${merged.size} values, from ${meta.base})`);
  return skinEntry(out);
}
function renameSkin(id, name) {
  const f = skinFile(id); if (!f || !/^user:/.test(id)) return { error: 'Only your own skins can be renamed.' };
  name = String(name || '').trim().slice(0, 60); if (!name) return { error: 'Give the skin a name.' };
  const text = fs.readFileSync(f, 'utf8'), meta = { ...skinMeta(text), name };
  const body = text.replace(/^\/\*[\s\S]*?\*\/\s*/, '');      // the old header comment goes, the rest stays
  const slug = freeSlug(name, path.basename(f, '.css')), out = path.join(skinsDir(), `${slug}.css`);
  fs.writeFileSync(out + '.part', skinHeader(name, meta) + body); fs.renameSync(out + '.part', out);
  if (out !== f) rmQuiet(f);
  return skinEntry(out);
}
// The picker / Library preview colours [frame, title bar, LCD, LCD digits, list, list text] of a skin whose
// header has none (2.5.2): its own values on top of Classic's, var(--x) followed, first colour of a gradient.
const SW_VARS = [['--frame', '#2b2e3a'], ['--tb-bg', '#3b3f50'], ['--lcd', '#000'], ['--lcd-on', '#3dff6e'], ['--list-bg', '#000'], ['--pl-green', '#33e85b']];
const COLOR_RE = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/i;
let classicVars = null;
function swatchesOf(vars) {
  if (!classicVars) { try { classicVars = splitSkin(fs.readFileSync(path.join(BUILTIN_SKINS, 'classic.css'), 'utf8')).vars; } catch (_) { classicVars = new Map(); } }
  const all = new Map([...classicVars, ...vars]);
  const look = (n, depth = 0) => {
    const v = String(all.get(n) || '');
    const c = v.match(COLOR_RE); if (c) return c[0];
    const r = /var\(\s*(--[\w-]+)/.exec(v); return r && depth < 8 ? look(r[1], depth + 1) : null;
  };
  return SW_VARS.map(([n, d]) => (look(n) || d).slice(0, 40));
}
// A skin without its header comment, the same however its lines end: what "the same skin" compares
const skinBody = (t) => String(t).replace(/\r\n?/g, '\n').replace(/^\uFEFF?\s*\/\*[\s\S]*?\*\/\s*/, '').trim();
// A name nobody in MINE has: "Sunset Gold", then "Sunset Gold 2", "Sunset Gold 3" …
function freeSkinName(name) {
  const taken = new Set(listSkins().map(s => s.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) { const n = `${name.slice(0, 60 - String(i).length - 1).trim()} ${i}`; if (!taken.has(n.toLowerCase())) return n; }
}
function importSkin(src) {
  const st = fs.statSync(src);
  if (st.size > SKIN_MAX) return { file: src, error: 'That file is too big to be a skin.' };
  const raw = fs.readFileSync(src), text = cleanSkinCss(raw.toString('utf8'));
  const { vars } = splitSkin(text);
  if (vars.size < 3) return { file: src, error: 'That isn’t a SlopAMP skin (no :root block with -- colours).' };
  // 2.5.2: the same skin again (the same file, or the same skin under the header SlopAMP gave it) isn't copied twice
  const body = skinBody(text);
  for (const s of listSkins()) {
    let t; try { t = fs.readFileSync(s.file); } catch (_) { continue; }
    if (t.equals(raw) || skinBody(t.toString('utf8')) === body) return { file: src, have: s.id, name: s.name, error: 'You already have this skin.' };
  }
  const head = /SlopAMP skin:\s*"([^"]{1,60})"/.exec(text), meta = skinMeta(text);
  const asked = String(meta.name || (head && head[1]) || path.basename(src, path.extname(src))).trim().slice(0, 60) || 'My skin';
  const name = freeSkinName(asked);                          // 2.5.2: a name you already have becomes "Name 2"
  const slug = freeSlug(name), out = path.join(skinsDir(), `${slug}.css`);
  fs.mkdirSync(skinsDir(), { recursive: true });
  // keep it as it came (cleaned) when it has our header, its own name and preview colours; else give it our
  // header (the name it gets, and preview colours from its own values so it doesn't show as Classic green)
  const ours = /slopamp:\s*\{/.test(text);
  const sw = Array.isArray(meta.sw) && meta.sw.length === 6 ? meta.sw : swatchesOf(vars);
  const withHead = ours && name === meta.name && sw === meta.sw ? text
    : skinHeader(name, ours ? { ...meta, name, sw } : { v: 1, name, base: 'classic', baseName: '', sw }) + text.replace(/^\uFEFF?\s*\/\*[\s\S]*?\*\/\s*/, '');
  fs.writeFileSync(out, withHead);
  log(`skin imported: ${path.basename(src)} -> ${slug}.css${name !== asked ? ` (as "${name}")` : ''}`);
  return skinEntry(out);
}
function downloadDirs() {
  const s = currentState || loadState();
  const base = path.join(app.getPath('downloads'), 'SlopAMP');
  return { video: s.dlVideoDir || path.join(base, 'Video'), audio: s.dlAudioDir || path.join(base, 'Audio'), playlists: path.join(base, 'Playlists'),
    mp3clips: path.join(base, 'mp3clips'), mp4clips: path.join(base, 'mp4clips'), shots: path.join(base, 'Shots'),   // CLIP (2.3)
    gifs: path.join(base, 'gifs'),         // CLIP GIFs (2.9.4)
    converted: path.join(base, 'Converted'),   // CLIP → Convert (2.9.5)
    shared: path.join(base, 'Shared') };   // Share playlist (2.4): .zips made here, and shared .zips unpacked here
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

// 2.9.3: why a playlist couldn't be written, in plain words (SAVE, QUICK SAVE, SAVE ALL; the technical message goes to the log)
function saveError(e, file) {
  const code = e && e.code;
  const m = {
    ENOENT: 'That folder doesn’t exist any more. Pick another one.',
    ENOTDIR: 'That folder doesn’t exist any more. Pick another one.',
    EACCES: 'SlopAMP isn’t allowed to save there. Pick another folder (Documents or Downloads work).',
    EPERM: 'SlopAMP isn’t allowed to save there, or the file is read-only. Pick another folder or name.',
    EROFS: 'That drive is read-only. Pick another folder.',
    ENOSPC: 'The disk is full. Free some space or pick another drive.',
    EDQUOT: 'The disk is full. Free some space or pick another drive.',
    EBUSY: 'The file is open in another program. Close it there and try again.',
    EISDIR: 'There’s a folder with that name. Pick another name.',
    ENAMETOOLONG: 'That name or folder path is too long. Pick a shorter one.',
    EINVAL: 'That name can’t be used for a file. Pick another one.'
  }[code];
  try { if (file && fs.existsSync(file + '.tmp')) fs.unlinkSync(file + '.tmp'); } catch (_) {}
  // Windows reports a folder in the way as "not allowed" (EPERM): say what it really is
  try { if (file && fs.statSync(file).isDirectory()) return 'There’s a folder with that name. Pick another name.'; } catch (_) {}
  return m || 'Something went wrong while writing the file. Try another folder or name.';
}

function rememberPlaylistDir(file) {
  const s = currentState || loadState();
  s.playlistDir = path.dirname(file);
  saveStateSoon(s);
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

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

// ---------- Rename (2.6): a file on disk gets a new name; SlopAMP's own records follow it
const lowPath = (p) => path.resolve(String(p || '')).toLowerCase();
const BAD_NAME_CH = /[\\/:*?"<>|\x00-\x1f]/;
// base: the new name without the extension (and without a download's " [id]" tag, which is kept).
// check: only say whether it would work. Returns { path, name, tail } or { error }.
function renameFileCore(p, base, check) {
  p = String(p || '');
  let st; try { st = fs.statSync(p); } catch (_) { return { error: 'The file isn’t there any more.' }; }
  if (!st.isFile()) return { error: 'That isn’t a file.' };
  const dir = path.dirname(p), ext = path.extname(p), oldBase = path.basename(p, ext);
  const tm = DL_FILE_RE_TAIL.exec(oldBase), tail = tm ? tm[0] : '';
  let name = String(base || '').replace(/^\s+/, '').replace(/[\s.]+$/, '');
  if (tail && name.endsWith(tail.trim())) name = name.slice(0, -tail.trim().length).replace(/[\s.]+$/, '');   // typed the tag too
  if (ext && name.toLowerCase().endsWith(ext.toLowerCase())) name = name.slice(0, -ext.length).replace(/[\s.]+$/, '');
  if (!name) return { error: 'Type a name.' };
  if (BAD_NAME_CH.test(name)) return { error: 'A file name can’t have \\ / : * ? " < > |' };
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name)) return { error: 'Windows doesn’t allow that name.' };
  if (name.length > 150) return { error: 'That name is too long (150 characters at most).' };
  const to = path.join(dir, name + tail + ext);
  if (to === p) return { path: p, name, tail, same: true };
  const caseOnly = lowPath(to) === lowPath(p);
  if (!caseOnly && fs.existsSync(to)) return { error: `There’s already a ${path.basename(to)} in that folder. Pick another name.` };
  if (check) return { path: to, name, tail };
  try {
    if (caseOnly) { const tmp = `${p}.slopamp-rename`; fs.renameSync(p, tmp); fs.renameSync(tmp, to); } else fs.renameSync(p, to);
  } catch (e) {
    const busy = /EBUSY|EPERM|EACCES/.test(String(e.code || e.message));
    return { busy, error: busy ? 'Windows says the file is in use by another program. Close it there and try again.' : `Couldn’t rename it: ${e.message}` };
  }
  log(`renamed: ${path.basename(p)} -> ${path.basename(to)}`);
  return { path: to, name, tail };
}
// After a file was renamed: the downloads list, CLIP's list (and its "Clip again" originals) and the saved playlists
// in Downloads\SlopAMP\Playlists point at the new name. Playlist files elsewhere aren't touched.
function fileRenamed(from, to) {
  const s = currentState || loadState(), lf = lowPath(from);
  const idx = s.downloads || {}; let dlCh = false;
  for (const e of Object.values(idx)) for (const k of ['video', 'audio']) if (e[k] && lowPath(e[k]) === lf) { e[k] = to; dlCh = true; }
  if (dlCh) setMainState({ downloads: idx });
  const c = s.clips && typeof s.clips === 'object' ? s.clips : null; let cCh = false;
  if (c) {
    for (const k of Object.keys(c)) if (lowPath(k) === lf) { c[to] = c[k]; delete c[k]; cCh = true; }
    for (const e of Object.values(c)) if (e && e.src && lowPath(e.src) === lf) { e.src = to; cCh = true; }
    if (cCh) setMainState({ clips: c });
  }
  let pls = 0;
  const dir = playlistsDir(); let names = []; try { names = fs.readdirSync(dir); } catch (_) {}
  for (const n of names) {
    if (!PLAYLIST_RE.test(n)) continue;
    const full = path.join(dir, n);
    let text; try { text = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }
    let changed = false;
    const out = text.split(/(\r?\n)/).map((line) => {
      const pls1 = /^(File\d+=)(.*)$/i.exec(line), loc = pls1 ? pls1[2].trim() : line.trim();
      if (!loc || loc.startsWith('#') || /^[a-z]+:\/\//i.test(loc) && !/^file:/i.test(loc)) return line;
      let abs; try { abs = /^file:/i.test(loc) ? require('url').fileURLToPath(loc) : path.resolve(dir, loc); } catch (_) { return line; }
      if (lowPath(abs) !== lf) return line;
      changed = true;
      return pls1 ? pls1[1] + to : to;
    }).join('');
    if (changed) { try { fs.writeFileSync(full, out); pls++; } catch (e) { log('playlist update failed', n, e.message); } }
  }
  return { playlists: pls };
}

function readPlaylistFile(p) {
  return parsePlaylistFile(p).map(e => e.loc)
    .filter(l => /^https?:/i.test(l) || (fs.existsSync(l) && isMediaFile(l)));
}

const VIDEO_EXT_RE = /\.(mp4|m4v|mkv|avi|mov|wmv|webm|flv|mpe?g|ts|m2ts|mts|vob|3gp|ogv|divx|asf|rmvb?|f4v)$/i;

// 2.9.6: a big playlist (1,500 songs) used to wait for every file to be read (ffprobe, 4 at a time) before
// anything showed. Now the list comes back at once from the file itself (its #EXTINF title and length, the kind
// from the extension); files are marked `probe` and the window reads them in the background (files:describe).
// full: read every file first, as before (Share .zip needs the real lengths).
async function loadPlaylistEntries(p, o = {}) {
  if (!o.full) return quickEntries(parsePlaylistFile(p));
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
      const info = (/\.mp3$/i.test(e.loc) && mp3info.read(e.loc)) || await server.probe(e.loc);   // 2.9.6
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

// entries from a playlist (or plain paths) without reading the files: { path, title, duration, hasVideo, probe, named }
function quickEntries(entries) {
  const out = [];
  for (const e0 of entries) {
    const e = typeof e0 === 'string' ? { loc: e0, title: '', duration: 0 } : e0;
    if (/^https?:/i.test(e.loc)) { out.push({ url: e.loc, title: e.title }); continue; }
    const name = path.basename(e.loc).replace(/\.[^.]+$/, '');
    if (!fs.existsSync(e.loc)) { out.push({ path: e.loc, title: e.title || name, duration: e.duration, hasVideo: VIDEO_EXT_RE.test(e.loc), missing: true }); continue; }
    if (!isMediaFile(e.loc)) continue;
    out.push({ path: e.loc, title: e.title || name, duration: e.duration > 0 ? e.duration : 0, hasVideo: VIDEO_EXT_RE.test(e.loc), probe: true, ...(e.title ? { named: true } : {}) });
  }
  return out;
}
const QUICK_MIN = 50;       // 2.9.6: adding more files than this shows them at once and reads them in the background

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
      // 2.9.6: an MP3's tags and length are read from the file itself (mp3info.js); ffprobe only when that can't
      // eslint-disable-next-line no-await-in-loop
      const info = (/\.mp3$/i.test(f) && mp3info.read(f)) || await server.probe(f);
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
  // 2.9.6: the files (and links) a drop / Add folder… would add, without reading them (fast, for big adds)
  ipcMain.handle('files:expand', (_e, paths) => quickEntries(expandPaths((paths || []).filter(p => typeof p === 'string'))));
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
    const files = expandPaths(res.filePaths);
    return files.length > QUICK_MIN ? quickEntries(files) : describeFiles(res.filePaths);     // 2.9.6: many files: at once
  });
  ipcMain.handle('playlist:save', async (_e, items, name) => {
    if (!Array.isArray(items)) return { saved: false };      // 2.9.3: an empty tab saves too (an empty playlist SlopAMP can reopen)
    const res = await dialog.showSaveDialog(win, {
      title: 'Save playlist',
      defaultPath: path.join(playlistsDir(), `${safeFileName(name)}.m3u8`),
      filters: [{ name: 'Playlist (M3U8)', extensions: ['m3u8'] }, { name: 'Playlist (M3U)', extensions: ['m3u'] }]
    });
    if (res.canceled || !res.filePath) return { saved: false };
    try {
      fs.writeFileSync(res.filePath + '.tmp', buildM3U(items), 'utf8'); fs.renameSync(res.filePath + '.tmp', res.filePath);   // 2.9.3: like QUICK SAVE, never half a file
      rememberPlaylistDir(res.filePath);
      return { saved: true, name: path.basename(res.filePath), path: res.filePath, empty: !items.length };   // 2.9.3: path: the tab remembers it
    } catch (e) { log('playlist save failed', e); return { saved: false, error: saveError(e, res.filePath), code: e && e.code }; }
  });
  // Quick Save: write the tab straight to Playlists\\<tab name>.m3u8, replacing any older copy (no dialog).
  // History tabs (2.2): the synced copies, Playlists\YouTube History.m3u8 and Playlists\X History.m3u8,
  // written silently whenever that History changes. kind: 'yt' (default) or 'x'.
  ipcMain.handle('hist:mirror', (_e, items, kind) => {
    try {
      const x = kind === 'x';
      const ok = (i) => i && typeof i.url === 'string' && (x ? i.type === 'x' && X_POST_URL_RE.test(i.url) : i.type === 'youtube' && /^https:\/\/(www|music)\.youtube\.com\/watch\?v=[\w-]{11}$/.test(i.url));
      const list = (Array.isArray(items) ? items : []).filter(ok)
        .slice(0, 100000).map(i => ({ type: i.type, url: i.url, title: String(i.title || '').slice(0, 300), duration: Number(i.duration) || 0 }));
      const file = path.join(playlistsDir(), x ? 'X History.m3u8' : 'YouTube History.m3u8');
      fs.writeFileSync(file + '.tmp', buildM3U(list), 'utf8'); fs.renameSync(file + '.tmp', file);
      return { ok: true, file, name: path.basename(file) };
    } catch (e) { log('history mirror failed', e.message); return { ok: false, error: e.message }; }
  });
  ipcMain.handle('playlist:quicksave', (_e, items, name) => {
    if (!Array.isArray(items)) return { saved: false, error: 'empty' };     // 2.9.2: an empty tab saves too (its file is emptied)
    const file = path.join(playlistsDir(), `${safeFileName(name)}.m3u8`);
    try {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, buildM3U(items), 'utf8');
      fs.renameSync(tmp, file);
      return { saved: true, name: path.basename(file), path: file };
    } catch (e) { log('quick save failed', e); return { saved: false, error: saveError(e, file), code: e && e.code }; }
  });
  // Quick Save All: every tab to Playlists\\<tab name>.m3u8 (same-named tabs get " (2)", " (3)"...). 2.9.2: empty tabs too,
  // so emptying a tab and saving empties its file.
  ipcMain.handle('playlist:quicksave-all', (_e, tabs) => {
    const out = []; const used = new Set();
    for (const t of Array.isArray(tabs) ? tabs : []) {
      if (!t || !Array.isArray(t.items)) continue;
      const base = safeFileName(t.name); let name = base, n = 2;
      while (used.has(name.toLowerCase())) name = `${base} (${n++})`;
      used.add(name.toLowerCase());
      const file = path.join(playlistsDir(), `${name}.m3u8`);
      try { fs.writeFileSync(file + '.tmp', buildM3U(t.items), 'utf8'); fs.renameSync(file + '.tmp', file); out.push({ name: path.basename(file), ok: true, empty: !t.items.length }); }
      catch (e) { log('quick save all failed', e); out.push({ name: path.basename(file), ok: false, error: saveError(e, file) }); }
    }
    return out;
  });
  ipcMain.handle('playlist:load', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Load playlist',
      defaultPath: playlistsDir(),
      properties: ['openFile'],
      filters: [{ name: 'Playlists', extensions: ['m3u8', 'm3u', 'pls', 'zip'] }, { name: 'All files', extensions: ['*'] }]
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    const file = res.filePaths[0];
    if (/\.zip$/i.test(file)) return { zip: file };      // 2.4: a shared playlist .zip (renderer → share:open)
    rememberPlaylistDir(file);
    return { name: path.basename(file), path: file, lines: parsePlaylistFile(file).length, entries: await loadPlaylistEntries(file) };    // 2.9.3: lines = entries in the file (0: an empty playlist)
  });
  // ---- 2.4 #6: a playlist file handed to SlopAMP (double-click, Open with, the command line): read it for a new tab
  ipcMain.handle('pl:openFile', async (_e, p) => {
    if (typeof p !== 'string' || !PLAYLIST_RE.test(p) || !fs.existsSync(p)) return { error: 'missing' };
    return { name: path.basename(p), path: path.resolve(p), entries: await loadPlaylistEntries(p) };
  });
  // ---- 2.4 #5: Share playlist (.zip) — share.js
  let shareJob = null;
  ipcMain.handle('share:plan', (_e, items, name, o) => {
    const { summary } = share.plan(items, o || {});
    return { ...summary, dest: path.join(downloadDirs().shared, `${share.safeName(name)}.zip`) };
  });
  ipcMain.handle('share:dest', async (_e, cur) => {
    const r = await dialog.showSaveDialog(win, { title: 'Save the shared playlist as', defaultPath: typeof cur === 'string' ? cur : downloadDirs().shared, filters: [{ name: 'Zip file', extensions: ['zip'] }] });
    return r.canceled || !r.filePath ? null : (/\.zip$/i.test(r.filePath) ? r.filePath : `${r.filePath}.zip`);
  });
  ipcMain.handle('share:make', async (e, o) => {
    if (shareJob) return { ok: false, error: 'A .zip is already being made.' };
    if (!o || typeof o.dest !== 'string' || !/\.zip$/i.test(o.dest)) return { ok: false, error: 'bad file name' };
    const ac = new AbortController(); shareJob = ac;
    let last = 0;
    try {
      return await share.make({ items: o.items, name: o.name, includeFiles: o.includeFiles !== false, includeDl: !!o.includeDl, dest: path.resolve(o.dest) },
        (pr) => { const now = Date.now(); if (now - last > 150 || pr.done === pr.total) { last = now; if (!e.sender.isDestroyed()) e.sender.send('share:progress', pr); } }, ac.signal);
    } finally { shareJob = null; }
  });
  ipcMain.on('share:cancel', () => { if (shareJob) shareJob.abort(); });
  // A shared .zip: unpack into Downloads\SlopAMP\Shared\<name> and hand back its playlist (or its files) for a new tab
  ipcMain.handle('share:open', async (_e, zip) => {
    if (typeof zip !== 'string' || !/\.zip$/i.test(zip) || !fs.existsSync(zip)) return { error: 'missing' };
    try {
      const u = await share.unpack(zip, downloadDirs().shared);
      if (u.error) return u;
      log(`shared zip unpacked: ${path.basename(zip)} -> ${u.dir} (${u.media.length} files, ${u.playlists.length} playlist(s), ${u.skipped.length} skipped)`);
      const pl = u.playlists[0];
      const entries = pl ? await loadPlaylistEntries(pl, { full: true }) : await describeFiles(u.media);
      return { name: path.basename(zip, path.extname(zip)), dir: u.dir, entries, skipped: u.skipped.length, playlist: pl || null };
    } catch (err) { return { error: String(err.message || err) }; }
  });
  // ---- 2.4 #6: "?" → Make SlopAMP open playlists… (current user, no admin): register this copy, open Default apps
  ipcMain.handle('app:assoc', async () => {
    if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
    try { await registerPlaylistApp(); } catch (err) { log('playlist association failed', err.message); return { ok: false, error: String(err.message || err) }; }
    try { await shell.openExternal('ms-settings:defaultapps'); } catch (_) {}
    return { ok: true, exe: playlistAppExe() };
  });
  // ---- downloads
  ipcMain.handle('dl:info', () => ({ available: downloader.available(), dirs: downloadDirs() }));
  // 2.9.1 (size limit): about how big a download will be, before it starts (bytes, or null when yt-dlp can't say)
  ipcMain.handle('dl:size', async (_e, job) => {
    if (!job || typeof job.url !== 'string' || !downloader || !downloader.available()) return null;
    const x = X_POST_URL_RE.test(job.url);
    if (!x && !/^https:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(job.url)) return null;
    try { return await downloader.sizeOf({ url: job.url, kind: job.kind === 'audio' ? 'audio' : 'video', quality: ['xready', 'best', '1080', '720', '480'].includes(job.quality) ? job.quality : 'xready', mp3q: ['320', '192', '128'].includes(String(job.mp3q)) ? String(job.mp3q) : 'best', x }); } catch (e) { log('size check failed', e.message); return null; }
  });
  ipcMain.handle('dl:start', (_e, job) => {
    const isX = !!job && typeof job.url === 'string' && X_POST_URL_RE.test(job.url);
    if (!job || typeof job.url !== 'string' || (!isX && !/^https:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(job.url))) return { ok: false, reason: 'unsupported' };
    if (!downloader.available()) return { ok: false, reason: 'missing' };
    const vid = KEY_RE.test(job.vid || '') && (!isX || /^x\d/.test(job.vid)) ? job.vid : null;
    if (isX && !vid) return { ok: false, reason: 'unsupported' };
    return downloader.start({ id: String(job.id), vid, x: isX, url: job.url, kind: job.kind === 'audio' ? 'audio' : 'video', quality: ['xready', 'best', '1080', '720', '480'].includes(job.quality) ? job.quality : 'xready', mp3q: ['320', '192', '128'].includes(String(job.mp3q)) ? String(job.mp3q) : 'best', title: String(job.title || '') });
  });
  ipcMain.on('dl:cancel', (_e, id) => downloader.cancel(String(id)));
  // ---- user skins (see "user skins (1.7)" above)
  // ---- CLIP (2.3): clip.js
  ipcMain.handle('clip:open', (_e, f) => clipper.open(f));
  ipcMain.handle('clip:peaks', (_e, f) => (typeof f === 'string' && fs.existsSync(f) ? clipper.peaks(f) : null));
  ipcMain.handle('clip:frames', (_e, f, times, h) => (typeof f === 'string' && fs.existsSync(f) ? clipper.frames(f, times, h) : []));
  ipcMain.handle('clip:save', (_e, o) => clipper.save(o).catch((e) => { log('clip save failed', e); return { ok: false, error: 'Couldn’t save the clip.' }; }));
  ipcMain.on('clip:cancel', (_e, job) => clipper.cancel(job));
  ipcMain.handle('clip:list', () => clipper.list());
  // 2.9.4: Sound's "this clip: -23 LUFS" (loudnorm pass 1) and the GIF size estimate (a 1 s test GIF)
  ipcMain.handle('clip:loudness', (_e, o) => clipper.loudness(o).catch((e) => { log('clip loudness failed', e); return { ok: false }; }));
  ipcMain.handle('clip:gif-estimate', (_e, o) => clipper.gifEstimate(o).catch((e) => { log('gif estimate failed', e); return { ok: false }; }));
  // a saved GIF opens in the computer's picture viewer (SlopAMP plays sound and video, not GIFs)
  ipcMain.on('clip:open-file', (_e, p) => { if (clipper.inClipDir(p) && fs.existsSync(p)) shell.openPath(p); });
  // ---- 2.5 #22: X-ready MP4s (clip.js "X-ready", xready.js)
  ipcMain.handle('x:status', (_e, files) => clipper.xStatus(files));
  ipcMain.handle('x:plan', (_e, f, acct) => (typeof f === 'string' ? clipper.xPlan(f, acct === 'premium' ? 'premium' : 'free') : { ok: false }));
  ipcMain.handle('x:fix', (_e, o) => clipper.xFix(o).catch((e) => { log('Fix for X failed', e); return { ok: false, error: String(e.message || e) }; }));
  ipcMain.on('x:cancel', (_e, job) => clipper.cancel(job));
  ipcMain.handle('clip:delete', (_e, paths) => clipper.remove(paths));
  ipcMain.handle('clip:rename', (_e, p, name) => { try { return clipper.rename(p, name); } catch (e) { return { error: String(e.message || e) }; } });
  ipcMain.handle('clip:pick', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Pick a song or video to clip', properties: ['openFile'],
      filters: [{ name: 'Songs and videos', extensions: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'ts', 'mpg', 'mpeg'] }, { name: 'All files', extensions: ['*'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  // 2.9.7 (CLIP part 3): Join, Captions from YouTube (yt-dlp, on demand), a picture for a still, a clip's saved extras
  ipcMain.handle('clip:join', (_e, o) => clipper.joinSave(o).catch((e) => { log('join failed', e); return { ok: false, error: 'Couldn’t join the video.' }; }));
  ipcMain.handle('clip:subs-youtube', async (_e, url) => {
    if (!downloader || !downloader.available()) return { ok: false, error: 'The downloader isn’t included in this copy of SlopAMP.' };
    try { return await downloader.fetchSubs(url, path.join(require('os').tmpdir(), `slopamp-subs-${process.pid}`)); } catch (e) { log('subs fetch failed', e); return { ok: false, error: 'Couldn’t get the subtitles.' }; }
  });
  ipcMain.handle('clip:pick-image', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Pick a picture for a still', properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return { path: r.filePaths[0], url: fileUrl(r.filePaths[0]) };
  });
  ipcMain.handle('clip:image-url', (_e, p) => (typeof p === 'string' && /\.(png|jpe?g|webp|bmp)$/i.test(p) && fs.existsSync(p) ? fileUrl(p) : null));
  ipcMain.handle('clip:entry', (_e, p) => (typeof p === 'string' ? clipper.entry(p) : null));
  // shots (SLOP's LOOK, in CLIP since 2.3): o = { file, title, … }
  for (const [ch, fn] of [['clip:shots', 'shots'], ['clip:shot-add', 'shotAdd'], ['clip:shot-set', 'shotSet'], ['clip:shot-del', 'shotDel'], ['clip:shot-burst', 'shotBurst'], ['clip:shot-keep', 'shotKeep']]) {
    ipcMain.handle(ch, (_e, o) => (o && typeof o === 'object' && typeof o.file === 'string' ? clipper[fn](o).catch((e) => { log(`${ch} failed`, e); return { error: 'That didn’t work.' }; }) : { error: 'No file.' }));
  }
  ipcMain.on('clip:shot-folder', (_e, o) => { const d = clipper.shotDir(o || {}); try { fs.mkdirSync(d, { recursive: true }); } catch (_) {} shell.openPath(d); });
  ipcMain.on('clip:folder', (_e, kind) => { const d = downloadDirs()[kind === 'mp4' ? 'mp4clips' : kind === 'gif' ? 'gifs' : kind === 'conv' ? 'converted' : 'mp3clips']; try { fs.mkdirSync(d, { recursive: true }); } catch (_) {} shell.openPath(d); });
  // ---- the YOUTUBE window (2.3): ytweb.js
  ipcMain.on('ytweb:rect', (_e, r) => ytweb && ytweb.setRect(r));
  ipcMain.handle('ytweb:nav', (_e, cmd, arg) => (ytweb ? ytweb.nav(String(cmd), arg) : null));
  ipcMain.on('ytweb:pause', () => ytweb && ytweb.pause());
  ipcMain.handle('ytweb:clear', () => (ytweb ? ytweb.clearData() : false));
  ipcMain.handle('skin:list', () => listSkins());
  ipcMain.handle('skin:css', (_e, id) => {          // the CSS of a built-in or user skin (user skins cleaned)
    const f = skinFile(id); if (!f) return null;
    try { const t = fs.readFileSync(f, 'utf8').slice(0, SKIN_MAX); return /^user:/.test(String(id)) ? cleanSkinCss(t) : t; } catch (_) { return null; }
  });
  ipcMain.handle('skin:save', (_e, o) => { try { return o && typeof o === 'object' ? writeSkin(o) : null; } catch (e) { log('skin save failed', e.message); return { error: e.message }; } });
  ipcMain.handle('skin:rename', (_e, o) => { try { return renameSkin(String(o.id), o.name); } catch (e) { return { error: e.message }; } });
  ipcMain.handle('skin:trash', async (_e, ids) => {
    const res = [];
    for (const id of (Array.isArray(ids) ? ids : [ids]).map(String)) {
      const f = /^user:/.test(id) ? skinFile(id) : null;
      if (!f) { res.push({ id, ok: false }); continue; }
      try { await shell.trashItem(f); res.push({ id, ok: true }); } catch (e) { res.push({ id, ok: false, error: e.message }); }
    }
    return res;
  });
  ipcMain.handle('skin:export', async (_e, id) => {
    const f = skinFile(id); if (!f) return { ok: false };
    const slug = /^user:/.test(id) ? path.basename(f) : `slopamp-${path.basename(f)}`;
    const r = await dialog.showSaveDialog(win, { title: 'Export skin', defaultPath: path.join(app.getPath('downloads'), slug), filters: [{ name: 'SlopAMP skin', extensions: ['css'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    try { fs.copyFileSync(f, r.filePath); return { ok: true, file: r.filePath }; } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('skin:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Import skins', properties: ['openFile', 'multiSelections'], filters: [{ name: 'SlopAMP skin', extensions: ['css'] }] });
    if (r.canceled) return [];
    return r.filePaths.map(f => { try { return importSkin(f); } catch (e) { return { file: f, error: e.message }; } });
  });
  ipcMain.on('skin:folder', () => { try { fs.mkdirSync(skinsDir(), { recursive: true }); } catch (_) {} shell.openPath(skinsDir()); });
  ipcMain.on('skin:reveal', (_e, id) => { const f = /^user:/.test(String(id)) ? skinFile(id) : null; if (f) shell.showItemInFolder(f); });
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
    if (!KEY_RE.test(vid || '') || typeof file !== 'string') return;
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
        const fromName = path.basename(file).replace(/\.[^.]+$/, '').replace(DL_FILE_RE_TAIL, '');
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
  ipcMain.handle('pl:open', async (_e, p, o) => {
    if (!inPlaylistsDir(p) || !fs.existsSync(p)) return { error: 'missing' };
    return { name: path.basename(p), entries: await loadPlaylistEntries(p, { full: !!(o && o.full) }) };
  });
  // 2.9.6: what a saved playlist holds (paths and links only, no file is read): the Library's "▶ in <playlist>"
  // and the downloads-folder limit used pl:open, which read every file of every saved playlist (a 1,500-song
  // playlist kept the Library from opening for a minute or more)
  ipcMain.handle('pl:locs', (_e, p) => {
    if (!inPlaylistsDir(p) || !fs.existsSync(p)) return [];
    return parsePlaylistFile(p).map(e => (/^https?:/i.test(e.loc) ? { url: e.loc } : { path: e.loc }));
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
  // 2.6 Rename: a song / video / downloaded copy (check: only test the name); a saved playlist; a download's title
  ipcMain.handle('file:rename', async (_e, p, base, check) => {
    if (typeof p !== 'string' || !(isMediaFile(p) || (/\.gif$/i.test(p) && clipper.inClipDir(p)))) return { error: 'That isn’t a song or video file.' };   // 2.9.4: or a CLIP GIF
    let r = renameFileCore(p, base, !!check);
    for (let i = 0; i < 4 && r.busy; i++) { await new Promise(res => setTimeout(res, 300)); r = renameFileCore(p, base, false); }   // SlopAMP's own player lets go of a file a moment after it stops
    if (r.error || check || r.same) return r;
    return { ...r, ...fileRenamed(p, r.path) };
  });
  ipcMain.handle('pl:rename', (_e, p, base, check) => {
    if (typeof p !== 'string' || !PLAYLIST_RE.test(p) || lowPath(path.dirname(p)) !== lowPath(playlistsDir())) return { error: 'Only saved playlists in Downloads\\SlopAMP\\Playlists can be renamed here.' };
    return renameFileCore(p, base, !!check);
  });
  ipcMain.on('dl:title', (_e, vid, title) => {
    const idx = (currentState || loadState()).downloads || {};
    if (!idx[vid] || typeof title !== 'string') return;
    idx[vid].title = title.slice(0, 300);
    setMainState({ downloads: idx });
  });
  // 2.7 Library preview: a tile's picture (kind 'pic' | 'sprite'); a saved playlist's first items (for its mosaic)
  ipcMain.handle('thumb:get', (_e, file, kind, opts) => (thumbs && typeof file === 'string' ? thumbs.get(file, kind === 'sprite' ? 'sprite' : 'pic', opts && typeof opts === 'object' ? { src: typeof opts.src === 'string' ? opts.src : '' } : {}).catch((e) => { log('thumb failed', e); return { none: true }; }) : { none: true }));
  ipcMain.handle('pl:peek', (_e, p) => {
    if (typeof p !== 'string' || !PLAYLIST_RE.test(p)) return null;
    const entries = parsePlaylistFile(p), idx = (currentState || loadState()).downloads || {};
    const vidOf = (u) => { const m = /(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/.exec(u) || /status\/(\d+)/.exec(u); return m ? (/^\d+$/.test(m[1]) ? 'x' + m[1] : m[1]) : null; };
    const items = entries.slice(0, 4).map(e => {
      if (!/^https?:/i.test(e.loc)) return { path: e.loc, video: VIDEO_EXT_RE.test(e.loc) };
      const v = vidOf(e.loc), d = v && idx[v];
      const local = d && (d.video || d.audio);
      return { url: e.loc, x: /x\.com|twitter\.com/i.test(e.loc), path: local && fs.existsSync(local) ? local : null, video: !!(d && d.video) };
    });
    const vids = entries.filter(e => /^https?:/i.test(e.loc) || VIDEO_EXT_RE.test(e.loc)).length;
    return { count: entries.length, items, videos: entries.filter(e => !/^https?:/i.test(e.loc) && VIDEO_EXT_RE.test(e.loc)).length, links: entries.filter(e => /^https?:/i.test(e.loc)).length, songs: entries.length - vids };
  });
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
  // 2.8: an X post's video link for the player (opts: fresh = ask X again, prefetch = the next item, early)
  ipcMain.handle('x:resolve', (_e, url, opts) => (xstream ? xstream.resolve(url, opts && typeof opts === 'object' ? { fresh: !!opts.fresh, height: +opts.height || 720 } : {}) : { ok: false, code: 'other', error: 'not ready' }));
  ipcMain.handle('web:resolve', async (_e, urls) => {
    const list = (Array.isArray(urls) ? urls : []).filter(u => typeof u === 'string' && /^https?:\/\/t\.co\/\w{1,30}\/?$/i.test(u)).slice(0, 100);
    const out = {};
    await Promise.all(list.map(async (u) => { out[u] = await resolveShortLink(u); }));
    return out;
  });
  ipcMain.on('shell:open', (_e, url) => { if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url); });
  ipcMain.on('shell:show', (_e, p) => { if (typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p); });

  ipcMain.on('win:minimize', () => win && win.minimize());
  // ---- 2.4 #19: Minimize to tray / Use media keys (saved in state.sys), the tray tooltip (the song)
  ipcMain.handle('sys:get', () => sysCfg());
  ipcMain.handle('sys:set', (_e, key, value) => {
    const c = sysCfg();
    if (key === 'tray') c.tray = !!value;
    else if (key === 'mediaKeys') { c.mediaKeys = !!value; if (c.mediaKeys) registerMediaKeys(); else unregisterMediaKeys(); }
    setMainState({ sys: c });
    return c;
  });
  ipcMain.on('sys:title', (_e, t) => { trayTitle = String(t || '').replace(/[\r\n]+/g, ' ').slice(0, 120); if (tray) { tray.setToolTip(trayTip()); tray.setContextMenu(trayMenu()); } });
  ipcMain.on('win:close', () => win && win.close());
  ipcMain.on('win:close-force', () => { closeOk = true; if (win) win.close(); });   // 2.9.2: after "Close anyway"
  ipcMain.handle('win:fullscreen', (_e, on) => wm.setFullscreen(on));
  ipcMain.handle('win:mini', (_e, on) => wm.setMini(on));
  // ---- movable windows (windows.js). A bug here must never freeze SlopAMP behind an error box: log it.
  const safe = (fn) => (...a) => { try { return fn(...a); } catch (e) { log('window manager error', e); return null; } };
  ipcMain.on('wm:sync', safe((_e, list, reflow) => wm.sync(Array.isArray(list) ? list : [], !!reflow)));
  ipcMain.on('wm:drag', safe((_e, phase, id, mode) => {
    if (phase === 'start') wm.dragStart(String(id), ['resize', 'resize-x', 'resize-y'].includes(mode) ? mode : 'move');
    else if (phase === 'move') wm.dragMove(); else wm.dragEnd();
  }));
  ipcMain.handle('wm:preset', safe((_e, name) => wm.preset(String(name))));
  ipcMain.handle('wm:option', safe((_e, key, value) => wm.setOption(String(key), value)));
  ipcMain.handle('wm:info', safe(() => wm.info()));
  ipcMain.on('wm:popup', safe((_e, o) => { if (o && typeof o === 'object') wm.showPopup(o); }));
  ipcMain.on('wm:popup-size', safe((_e, o) => { if (o && typeof o === 'object') wm.resizePopup(o); }));
  ipcMain.on('wm:popup-hide', safe(() => wm.hidePopup()));
  ipcMain.on('wm:popup-drag', safe((_e, phase) => wm.popupDrag(String(phase))));
  ipcMain.on('wm:dialog', safe((_e, o) => { if (o && typeof o === 'object') wm.showDialog(o); }));
  ipcMain.on('wm:dialog-front', safe(() => wm.dialogFront()));     // 2.9.6
  ipcMain.on('wm:dialog-hide', safe(() => wm.hideDialog()));
  ipcMain.on('wm:dialog-drag', safe((_e, phase) => wm.dialogDrag(String(phase))));
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
    const x = typeof url === 'string' && X_POST_URL_RE.test(url);
    if (/youtu\.?be/i.test(url)) api = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
    else if (x) api = `https://publish.twitter.com/oembed?omit_script=1&dnt=true&url=${encodeURIComponent(url.replace(/\/video\/\d+$/, ''))}`;
    if (!api) return null;
    const r = await net.fetch(api, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { status: r.status };
    const j = await r.json();
    // X: the post's text is the <p> of the embed HTML (its t.co / pic.twitter.com links dropped)
    const text = x ? htmlText((/<p[^>]*>([\s\S]*?)<\/p>/i.exec(String(j.html || '')) || [])[1] || '').replace(/(https?:\/\/t\.co\/\w+|pic\.twitter\.com\/\w+)/g, '').replace(/\s+/g, ' ').trim() : '';
    return { title: x ? text.slice(0, 140) : (j.title || ''), author: j.author_name || '', status: 200 };
  } catch (e) { return null; }
}
function htmlText(h) {
  return String(h).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp|mdash);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ', mdash: '—' }[e]))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
}
// A t.co short link -> the URL it points to ('' if it can't be followed).
async function resolveShortLink(u) {
  try {
    const r = await net.fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
    if (r.url && !/^https?:\/\/t\.co\//i.test(r.url)) return r.url;
    const body = await r.text();   // t.co sometimes answers browsers with a page that redirects itself
    const m = /<meta[^>]+http-equiv=["']?refresh["']?[^>]+url=([^"'>\s]+)/i.exec(body) || /location\.replace\(["']([^"']+)["']/.exec(body);
    return m ? m[1].replace(/\\\//g, '/') : '';
  } catch (_) { return ''; }
}

// "Use media keys" off (2.4): Chromium's own media-key handling stays off too, so other players get the keys
try { if (gotLock && !sysCfg().mediaKeys) app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling'); } catch (_) {}

// ---------- lifecycle ----------
app.whenReady().then(async () => {
  if (!gotLock) return;
  migrateOldState();
  migrateSkinsFolder();
  server = new MediaServer({ uiDir: path.join(__dirname, 'renderer'), ffmpegDir, log });
  clipper = new Clipper({
    ffmpeg: ffmpegExe, server, encoderArgs, log, fileSafe,
    dirs: () => { const d = downloadDirs(); return { mp3: d.mp3clips, mp4: d.mp4clips, gif: d.gifs, conv: d.converted, shots: d.shots }; },
    urlOf: (f) => fileUrl(f),
    getIndex: () => { const c = (currentState || loadState()).clips; return c && typeof c === 'object' ? c : {}; },
    setIndex: (idx) => setMainState({ clips: idx }),
    trash: (p) => shell.trashItem(p),
    send: (ev) => { if (win && !win.isDestroyed()) win.webContents.send('clip:event', ev); }
  });
  await server.start();
  log(`${APP_NAME} ${app.getVersion()} started on ${server.base}; ffmpeg=${server.hasFfmpeg()}`);
  // 2.7 Library preview: the pictures, cached in <userData>\thumbs; old ones cleaned up a minute after start
  thumbs = new Thumbs({ dir: path.join(app.getPath('userData'), 'thumbs'), ffmpeg: ffmpegExe, server, urlOf: (f) => fileUrl(f), log });
  setTimeout(() => { try { thumbs.prune(); } catch (e) { log('thumbs prune failed', e); } }, 60000);
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
      if (ev.status === 'done' && ev.file && ev.vid) {
        // X posts are added with a stand-in title ("@user · X post"); the file yt-dlp wrote is named after the post
        const xTitle = /^x\d/.test(ev.vid) && /^(@\w{1,15} · X post|X post \d+)( \(video \d+\))?$/.test(ev.title || '');
        rememberDownload(ev.vid, ev.kind === 'audio' ? 'audio' : 'video', ev.file, xTitle ? path.basename(ev.file).replace(/\.[^.]+$/, '').replace(DL_FILE_RE_TAIL, '').trim() : ev.title);
      }
      // 2.5 (#22): a finished video is checked for X first (Opus sound on an H.264 picture becomes AAC right here)
      if (ev.status === 'done' && ev.file && ev.kind !== 'audio' && clipper) {
        clipper.xAfterDownload(ev.file).catch((e) => { log('X check failed', e.message); return null; })
          .then((r) => { if (win && !win.isDestroyed()) win.webContents.send('dl:event', { ...ev, x: r && r.x, xAudioFixed: !!(r && r.audioFixed) }); });
        return;
      }
      if (win && !win.isDestroyed()) win.webContents.send('dl:event', ev);
    },
    getDirs: downloadDirs,
    getState: () => currentState || loadState(),
    setState: setMainState
  });
  // 2.8: X posts play without downloading: yt-dlp gives the video link, the media server passes the video through
  server.fetch = (u, o) => net.fetch(u, o);
  xstream = new XStream({ downloader, server, log });
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
    emit: (st) => { if (win && !win.isDestroyed()) win.webContents.send('upd:event', st); trayUpdateNote(st); },
    quit: () => { if (win && !win.isDestroyed()) win.close(); else app.quit(); },
    openExternal: (url) => shell.openExternal(url),
    log
  });
  registerIpc();
  createWindow();
  updater.start();
  if (sysCfg().mediaKeys) registerMediaKeys();
});

// Keyboard media keys (Play/Pause, Next, Previous, Stop) work even when SlopAMP isn't focused.
// 2.4 (#19): "Use media keys" (on by default) — off, SlopAMP lets go of them for Spotify, the browser…
const MEDIA_KEYS = { MediaPlayPause: 'playpause', MediaNextTrack: 'next', MediaPreviousTrack: 'prev', MediaStop: 'stop' };
function registerMediaKeys() {
  for (const [acc, action] of Object.entries(MEDIA_KEYS)) {
    try {
      if (globalShortcut.isRegistered(acc)) continue;
      const ok = globalShortcut.register(acc, () => { if (win && !win.isDestroyed()) win.webContents.send('media-key', action); });
      if (!ok) log(`media key ${acc} is taken by another app`);
    } catch (e) { log('media key register failed', acc, e); }
  }
}
function unregisterMediaKeys() { for (const acc of Object.keys(MEDIA_KEYS)) { try { globalShortcut.unregister(acc); } catch (_) {} } }

// ---------- system tray (2.4, idea #19) ----------
// "Minimize to tray" (off by default): minimizing SlopAMP (the – button, the taskbar, Win+Down; the mini bar too)
// hides every SlopAMP window and shows a tray icon instead; click it (or Show SlopAMP) to bring them all back
// where they were. ✕ still quits. The icon is only there while SlopAMP is in the tray; its tooltip is the song,
// right-click for Previous / Play-Pause / Next / Stop / Show / Quit. Music and YouTube keep playing.
function sysCfg() { const s = (currentState || loadState()).sys || {}; return { tray: s.tray === true, mediaKeys: s.mediaKeys !== false }; }
let tray = null, inTray = false, trayTitle = '', trayNote = '';
function trayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'icon.png'));
  return img.isEmpty() ? img : img.resize({ width: 16, height: 16 });
}
function trayMenu() {
  const key = (a) => () => { if (win && !win.isDestroyed()) win.webContents.send('media-key', a); };
  return Menu.buildFromTemplate([
    { label: (trayTitle || 'SlopAMP').slice(0, 60), enabled: false },
    { type: 'separator' },
    { label: 'Previous', click: key('prev') }, { label: 'Play / Pause', click: key('playpause') }, { label: 'Next', click: key('next') }, { label: 'Stop', click: key('stop') },
    { type: 'separator' },
    { label: 'Show SlopAMP', click: () => fromTray() },
    { label: 'Settings…', click: () => { fromTray(); if (win && !win.isDestroyed()) win.webContents.send('sys:settings'); } },   // 2.9.2
    { label: 'Quit', click: () => { if (win && !win.isDestroyed()) win.webContents.send('sys:quit'); else app.quit(); } }
  ]);
}
function toTray() {
  if (inTray || !win || win.isDestroyed() || closing) return;
  inTray = true;
  for (const [id, w] of wm.wins) if (id !== 'main' && !w.isDestroyed() && w.isVisible()) w.hide();
  win.hide();
  try {
    tray = new Tray(trayIcon());
    tray.setToolTip(trayTip());
    tray.setContextMenu(trayMenu());
    tray.on('click', () => fromTray());
    tray.on('double-click', () => fromTray());
  } catch (e) { log('tray failed', e.message); fromTray(); return; }
  log('minimized to the tray');
}
function fromTray() {
  if (!inTray) return;
  inTray = false;
  if (tray) { try { tray.destroy(); } catch (_) {} tray = null; }
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  for (const id of PANELS) { const w = wm.wins.get(id); if (id !== 'main' && w && !w.isDestroyed() && wm.visible[id]) w.showInactive(); }
  wm.applyAll();
  win.focus();
  win.webContents.send('sys:restored');     // a dialog that was open comes back too (winmgr.js)
}
const trayTip = () => `SlopAMP${trayTitle ? ` · ${trayTitle}` : ''}`.slice(0, 127);
function trayUpdateNote(st) {   // "update ready" (or a new version) as a tray balloon while SlopAMP is hidden there
  const note = st && st.release && ['ready', 'available'].includes(st.status) && !st.hidden ? `${st.status}:${st.release.version}` : '';
  if (!note || note === trayNote) { trayNote = note; return; }
  trayNote = note;
  if (tray && process.platform === 'win32') {
    try { tray.displayBalloon({ title: 'SlopAMP', content: st.status === 'ready' ? `SlopAMP ${st.release.version} is ready to install. Click the icon to open SlopAMP.` : `SlopAMP ${st.release.version} is out. Click the icon to open SlopAMP.` }); } catch (_) {}
  }
}
app.on('will-quit', (e) => {
  try { globalShortcut.unregisterAll(); } catch (_) {}
  // "Restart now": SlopAMP has now quit cleanly; start the installer last, then exit.
  if (updater && updater.installOnQuit) {
    e.preventDefault();
    updater.startInstaller().then((ok) => { if (!ok) app.relaunch(); app.exit(0); });
  }
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  log('quitting');
  // Quitting must end every SlopAMP process, even if something below hangs.
  setTimeout(() => { log('quit took over 8 s; exiting'); app.exit(0); }, 8000);
  for (const step of [() => updater && updater.cancel(), () => downloader && downloader.stopAll(true), flushState, () => server && server.stop()]) {
    try { step(); } catch (e) { log('quit step failed', e); }
  }
});
