'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, net, screen, Menu, globalShortcut, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { execFile } = require('child_process');
const { MediaServer, isMediaFile, encoderArgs } = require('./media');
const { Clipper } = require('./clip');
const { YtWeb } = require('./ytweb');
const { Downloader } = require('./downloader');
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
let updater = null;
let wm = null;        // movable windows (see windows.js)
let clipper = null;   // CLIP (2.3, clip.js)
let ytweb = null;     // the YOUTUBE window's page (2.3, ytweb.js)
// Keys owned by the main process; the renderer's state saves must not wipe them.
const MAIN_KEYS = ['window', 'layout', 'playlistDir', 'dlVideoDir', 'dlAudioDir', 'ytdlpUpdatedAt', 'downloads', 'update', 'clips'];
const ytdlpDir = [path.join(process.resourcesPath || '', 'ytdlp'), path.join(__dirname, '..', 'vendor', 'ytdlp', process.platform)]
  .find(d => fs.existsSync(path.join(d, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'))) || path.join(process.resourcesPath || '', 'ytdlp');
let closing = false;
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
  if (isDev) global.__slopamp = { wm, ytweb };   // for the test scripts
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
  win.on('close', () => {
    // If the page hangs while closing, close the window anyway.
    setTimeout(() => { if (!w.isDestroyed()) { log('window did not close in 5 s; forcing it'); w.destroy(); } }, 5000);
    closing = true;
    wm.closeAll();
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
// ---- SLOP (1.6): packs of YouTube moments for slop.cc --------------------------------------------
// A pack is a folder in Downloads\SlopAMP\Slop\<date time> <title> @<time>\ with what slop.cc asks for:
// the song (song.mp3), a clip (audio.mp3, optionally audio-2.mp3), named reference stills
// (ref-01 Singer (person).png, … the lead is always ref-01), an optional motion.mp4, prompt.txt,
// lyrics.txt and source.txt. pack.json describes it all (the Library reads it). Working files live
// in a hidden .slopamp subfolder: the song as YouTube sent it, the waveform, captions, burst candidates.
// The song is downloaded ONCE; clips, the whole song and the waveform are then made on the PC.
// SlopAMP uploads nothing: "Open in Slop.cc" opens the folder and slop.cc and copies the prompt.
const SLOP_CHAT = 'https://slop.cc/chat?new=1';   // slop.cc's documented "Make a video" link
const SLOP_HOME = 'https://slop.cc/';             // sign up / sign in happen there
const SLOP_KINDS = ['person', 'look', 'prop', 'place'];   // slop.cc's reference bank: people, outfits, props, places
const SLOP_LONG = 20 * 60;                        // longer videos: only 3 minutes either side of the moment
const SLOP_RIGHTS = 'Before you upload: you need the rights or permission for the song, every face, logo and image in this pack. AI generation doesn’t create those rights. slop.cc asks you to confirm once per project.';
const YT_URL_RE = /^https:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i;
const packs = new Map();   // pack id (its folder name) -> { id, dir, d: pack.json, rt: what's running now }
function slopEvent(ev) { if (win && !win.isDestroyed()) win.webContents.send('slop:event', ev); }
function fileSafe(s) { return String(s).replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '') || 'YouTube video'; }
function fmtTime(t) { t = Math.floor(t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`; }
const ytId = (url) => (/(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([\w-]{11})/.exec(String(url)) || [])[1] || '';
const slopRoot = () => downloadDirs().slop;
// a pack folder directly in the Slop folder (the skins folder next to the packs is never one)
const inSlopRoot = (dir) => { const rel = path.relative(slopRoot(), path.resolve(String(dir))); return !!rel && rel !== 'skins' && !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.includes(path.sep); };
const ffmpegExe = () => path.join(ffmpegDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const rmQuiet = (f) => { try { fs.rmSync(f, { force: true, recursive: true }); } catch (_) {} };
const fileUrl = (f) => { try { const st = fs.statSync(f); return `${server.base}/f/${server.keyFor(f)}${path.extname(f).toLowerCase()}?v=${Math.round(st.mtimeMs)}`; } catch (_) { return null; } };
function runTool(file, args, timeout = 120000) {
  return new Promise((resolve) => {
    const p = execFile(file, args, { windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr: String(stderr || (err && err.message) || '') }));
    server.track(p);
  });
}

function cacheDir(p) {
  const c = path.join(p.dir, '.slopamp');
  if (!fs.existsSync(c)) {
    fs.mkdirSync(c, { recursive: true });
    if (process.platform === 'win32') execFile('attrib', ['+h', c], { windowsHide: true }, () => {});   // keep it out of the way in Explorer
  }
  return c;
}
function newPackData(o) {
  const at = Math.max(0, Number(o.at) || 0), dur = Math.max(0, Number(o.dur) || 0);
  const clamp = (t) => (dur ? Math.max(0, Math.min(dur, t)) : Math.max(0, t));
  return {
    app: 'SlopAMP', v: 1, title: String(o.title || 'YouTube video').slice(0, 200), created: Date.now(), updated: Date.now(), opened: null, zip: null,
    video: { id: ytId(o.url), url: o.url, title: String(o.title || ''), duration: dur, channel: '', description: '', language: '' },
    at,
    audio: { clip: { in: clamp(at - 15), out: clamp(at + 45) || at + 45 }, clip2: { on: false, in: clamp(at + 45), out: clamp(at + 75) || at + 75 }, song: { on: true }, src: null },
    refs: [], nextRef: 1,
    motion: { on: false, len: 3 },
    prompt: { text: '', idea: '' },
    suggestion: '', lyrics: null
  };
}
function savePack(p) {
  p.d.updated = Date.now();
  try { fs.writeFileSync(path.join(p.dir, 'pack.json'), JSON.stringify(p.d, null, 2)); } catch (e) { log('slop pack save failed', e.message); }
}
function packView(p) {
  const rt = p.rt, d = p.d;
  const ex = (f) => fs.existsSync(path.join(p.dir, f));
  return {
    id: p.id, dir: p.dir, d,
    song: { ...rt.song, job: undefined },
    files: { song: ex('song.mp3'), audio: ex('audio.mp3'), audio2: ex('audio-2.mp3'), motion: ex('motion.mp4'), lyrics: ex('lyrics.txt'), prompt: ex('prompt.txt') },
    urls: { audio: ex('audio.mp3') ? fileUrl(path.join(p.dir, 'audio.mp3')) : null, audio2: ex('audio-2.mp3') ? fileUrl(path.join(p.dir, 'audio-2.mp3')) : null, song: ex('song.mp3') ? fileUrl(path.join(p.dir, 'song.mp3')) : null },
    busy: { ...rt.busy },
    refs: d.refs.map(r => { const st = rt.refs[r.n] || {}; return { ...r, url: r.file && !r.file.startsWith('.new') ? fileUrl(path.join(p.dir, r.file)) : null, busy: !!st.busy, error: st.error || '', preview: st.preview || null, window: st.window ? { w: st.window.w, h: st.window.h } : null }; }),
    burst: rt.burst && { running: rt.burst.running, items: rt.burst.items.map(i => ({ i: i.i, t: i.t, status: i.status, url: i.url, w: i.w, h: i.h, error: i.error })) },
    lyricsText: rt.lyricsText || '', peaksReady: !!rt.peaks, details: rt.details || ''
  };
}
function emitPack(p) {
  clearTimeout(p.emitT);
  p.emitT = setTimeout(() => { if (packs.get(p.id) === p) slopEvent({ type: 'pack', pack: packView(p) }); }, 30);
}
function livePack(o) { const p = packs.get(String(o && (o.id || o))); return p || null; }

// ---- making / loading packs
function createPack(o) {
  const at = Math.max(0, Number(o.at) || 0), d0 = new Date(), pad = (n) => String(n).padStart(2, '0');
  const name = `${d0.getFullYear()}-${pad(d0.getMonth() + 1)}-${pad(d0.getDate())} ${pad(d0.getHours())}.${pad(d0.getMinutes())}.${pad(d0.getSeconds())} ${fileSafe(o.title).slice(0, 60)} @${Math.floor(at / 60)}m${pad(Math.floor(at % 60))}s`;
  let dir = path.join(slopRoot(), name);
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(slopRoot(), `${name} (${i})`);
  fs.mkdirSync(dir, { recursive: true });
  const p = { id: path.basename(dir), dir, d: newPackData(o), rt: freshRt() };
  savePack(p); writeSource(p);
  packs.set(p.id, p);
  log(`slop pack created: ${p.id}`);
  return p;
}
function freshRt() { return { song: { status: 'none', pct: 0 }, busy: {}, refs: {}, burst: null, peaks: null, tok: 0, chain: Promise.resolve(), lyricsText: '' }; }
function loadPack(id) {
  if (packs.has(id)) return packs.get(id);
  const dir = path.join(slopRoot(), id);
  if (!inSlopRoot(dir) || !fs.existsSync(dir)) return null;
  let d = null;
  try { d = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8')); } catch (_) {}
  if (!d) d = upgradeLegacyPack(dir);
  if (!d) return null;
  d = { ...newPackData({ url: d.video && d.video.url, title: d.title, at: d.at, dur: d.video && d.video.duration }), ...d };
  const p = { id, dir, d, rt: freshRt() };
  const src = findSongSource(p);
  if (src) { p.rt.song = { status: 'ready', pct: 100, file: src }; loadPeaks(p); }
  loadCues(p);
  packs.set(id, p);
  return p;
}
// A 1.5.x pack (no pack.json): source.txt has the title and link, frame.png becomes the lead reference.
function upgradeLegacyPack(dir) {
  let src = '';
  try { src = fs.readFileSync(path.join(dir, 'source.txt'), 'utf8'); } catch (_) { return null; }
  const lines = src.split(/\r?\n/), url = (lines.find(l => /^https:\/\//.test(l)) || '').trim();
  if (!YT_URL_RE.test(url)) return null;
  const m = /Moment: (?:(\d+):)?(\d+):(\d+)/.exec(src), at = m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) : 0;
  const d = newPackData({ url: url.replace(/[?&]t=\d+s?$/, ''), title: lines[0] || 'YouTube video', at });
  if (fs.existsSync(path.join(dir, 'frame.png'))) {
    try { fs.renameSync(path.join(dir, 'frame.png'), path.join(dir, 'ref-01.png')); } catch (_) {}
    const sz = nativeImage.createFromPath(path.join(dir, 'ref-01.png')).getSize();
    d.refs.push({ n: 1, t: at, name: '', kind: '', lead: true, file: 'ref-01.png', w: sz.width, h: sz.height, from: 'video' });
    d.nextRef = 2;
  }
  try { const pr = fs.readFileSync(path.join(dir, 'prompt.txt'), 'utf8'); d.prompt.text = pr.split(/\r?\n---\r?\n/)[0].trim(); } catch (_) {}
  try { d.created = fs.statSync(dir).birthtimeMs || fs.statSync(dir).mtimeMs; } catch (_) {}
  try { fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(d, null, 2)); } catch (_) {}
  log(`slop: upgraded a 1.5 pack: ${path.basename(dir)}`);
  return d;
}
function writeSource(p) {
  const d = p.d, link = d.video.url + (d.video.url.includes('?') ? '&' : '?') + `t=${Math.floor(d.at)}s`;
  const lines = [d.video.title || d.title, link, `YouTube ID: ${d.video.id}`];
  if (d.video.channel) lines.push(`Channel: ${d.video.channel}`);
  lines.push(`Moment: ${fmtTime(d.at)}`, `Clip: ${fmtTime(d.audio.clip.in)}–${fmtTime(d.audio.clip.out)}`);
  if (d.suggestion) lines.push('', `Suggested scene: ${d.suggestion}`);
  lines.push('', `Saved by SlopAMP ${app.getVersion()} on ${new Date(d.created).toLocaleString()}`, '');
  try { fs.writeFileSync(path.join(p.dir, 'source.txt'), lines.join('\r\n')); } catch (_) {}
}

// ---- the song: downloaded once (as YouTube sends it), then everything else is local
function findSongSource(p) {
  try { const f = fs.readdirSync(path.join(p.dir, '.slopamp')).find(n => /^song\.\w+$/.test(n) && !/\.(part|ytdl|temp)$/.test(n)); return f ? path.join(p.dir, '.slopamp', f) : null; } catch (_) { return null; }
}
function songStart(p) {
  const s = p.rt.song;
  if (['queued', 'downloading', 'ready', 'processing'].includes(s.status)) return;
  if (!downloader.available()) { p.rt.song = { status: 'error', error: 'The downloader (yt-dlp) is missing from this copy of SlopAMP.' }; emitPack(p); return; }
  const dur = p.d.video.duration || 0, long = dur > SLOP_LONG;
  const section = long ? [Math.max(0, Math.floor(p.d.at - 180)), Math.ceil(Math.min(dur, p.d.at + 180))] : null;
  p.d.audio.src = { start: section ? section[0] : 0, end: section ? section[1] : dur, full: !section };
  if (section) p.d.audio.song.on = false;      // no whole song from a section
  const job = `slop-${p.id}-${Date.now().toString(36)}`;
  p.rt.song = { status: 'queued', pct: 0, job, section: !!section };
  savePack(p);
  downloader.start({ id: job, kind: 'slopsong', url: p.d.video.url, dir: cacheDir(p), section, title: 'SLOP song' });
  emitPack(p);
}
function songStop(p) {
  if (p.rt.song.job) downloader.cancel(p.rt.song.job);
  p.rt.song = { status: 'stopped', pct: 0 };
  emitPack(p);
}
function onSlopDownload(ev) {
  const p = [...packs.values()].find(x => x.rt.song.job === ev.id); if (!p) return;
  const s = p.rt.song;
  if (ev.status === 'canceled') { if (s.status !== 'stopped') p.rt.song = { status: 'stopped', pct: 0 }; emitPack(p); return; }
  if (ev.status === 'error') { p.rt.song = { status: 'error', error: ev.error || 'The song couldn’t be downloaded.' }; emitPack(p); return; }
  if (ev.status === 'done' && ev.file) {
    p.rt.song = { status: 'processing', pct: 100, file: ev.file };
    emitPack(p);
    makePeaks(p).then(() => { p.rt.song = { status: 'ready', pct: 100, file: ev.file }; exportAudio(p); emitPack(p); });
    return;
  }
  p.rt.song = { ...s, status: ev.status === 'downloading' ? 'downloading' : ev.status === 'processing' ? 'processing' : s.status, pct: ev.pct != null ? ev.pct : s.pct, speed: ev.speed, eta: ev.eta };
  emitPack(p);
}
// The waveform: 1500 peaks (0-100) over the downloaded audio, sent to the window once.
async function makePeaks(p) {
  const src = p.rt.song.file || findSongSource(p); if (!src) return;
  const r = await runTool(ffmpegExe(), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', src, '-ac', '1', '-ar', '2000', '-f', 's16le', '-'], 120000);
  if (r.code !== 0 || !r.stdout || !r.stdout.length) { log('slop waveform failed', r.stderr.slice(-200)); return; }
  const buf = r.stdout, n = Math.floor(buf.length / 2), N = 1500, per = Math.max(1, Math.floor(n / N)), peaks = [];
  for (let i = 0; i < N; i++) {
    let m = 0; const a = i * per, b = Math.min(n, a + per);
    for (let j = a; j < b; j++) { const v = Math.abs(buf.readInt16LE(j * 2)); if (v > m) m = v; }
    peaks.push(m);
  }
  const top = Math.max(1, ...peaks);
  const src0 = p.d.audio.src || { start: 0 };
  p.rt.peaks = { start: src0.start || 0, dur: n / 2000, peaks: peaks.map(v => Math.round(Math.sqrt(v / top) * 100)) };
  if (!p.d.video.duration && src0.full) { p.d.video.duration = n / 2000; savePack(p); }
  try { fs.writeFileSync(path.join(cacheDir(p), 'peaks.json'), JSON.stringify(p.rt.peaks)); } catch (_) {}
  slopEvent({ type: 'peaks', id: p.id, peaks: p.rt.peaks });
}
function loadPeaks(p) { try { p.rt.peaks = JSON.parse(fs.readFileSync(path.join(p.dir, '.slopamp', 'peaks.json'), 'utf8')); } catch (_) {} }

// Clips and the whole song, cut from the downloaded audio (one job at a time per pack, newest settings win).
function exportAudio(p) {
  clearTimeout(p.audioT);
  p.audioT = setTimeout(() => queuePack(p, () => doExportAudio(p)), 350);
}
function queuePack(p, fn) { p.rt.chain = p.rt.chain.then(fn).catch(e => log('slop job failed', e && e.message)); return p.rt.chain; }
async function doExportAudio(p) {
  const src = p.rt.song.file || findSongSource(p);
  if (!src || p.rt.song.status !== 'ready') return;
  const a = p.d.audio, off = (a.src && a.src.start) || 0;
  const want = [['audio.mp3', a.clip, true], ['audio-2.mp3', a.clip2, !!a.clip2.on], ['song.mp3', null, !!a.song.on && !!(a.src && a.src.full)]];
  for (const [name, c, on] of want) {
    const out = path.join(p.dir, name), key = { 'audio.mp3': 'audio', 'audio-2.mp3': 'audio2', 'song.mp3': 'song' }[name];
    const sig = c ? `${c.in.toFixed(2)}-${c.out.toFixed(2)}@${off}` : 'whole';
    if (!on) { if (fs.existsSync(out)) rmQuiet(out); p.rt.made = { ...p.rt.made, [name]: null }; continue; }
    if (fs.existsSync(out) && p.rt.made && p.rt.made[name] === sig) continue;
    p.rt.busy[key] = true; emitPack(p);
    const tmp = out + '.part.mp3';
    const range = c ? ['-ss', String(Math.max(0, c.in - off)), '-t', String(Math.max(0.5, c.out - c.in))] : [];
    const r = await runTool(ffmpegExe(), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...range, '-i', src, '-vn', '-map_metadata', '-1',
      '-c:a', 'libmp3lame', '-q:a', c ? '0' : '2', tmp], 300000);
    if (r.code === 0 && fs.existsSync(tmp)) { try { fs.renameSync(tmp, out); p.rt.made = { ...p.rt.made, [name]: sig }; } catch (e) { log('slop audio rename failed', e.message); } }
    else { rmQuiet(tmp); log(`slop ${name} failed`, r.stderr.slice(-300)); p.rt.busy[key + 'Err'] = true; }
    p.rt.busy[key] = false;
  }
  writeLyrics(p);
  emitPack(p);
}

// ---- reference stills: ref-01 is the lead; the name and kind go into the file name
function refFileName(r, i) {
  const name = r.name ? ' ' + fileSafe(r.name).slice(0, 40) : '', kind = SLOP_KINDS.includes(r.kind) ? ` (${r.kind})` : '';
  return `ref-${String(i + 1).padStart(2, '0')}${name}${kind}.png`;
}
function renameRefs(p) {
  const refs = p.d.refs;
  refs.sort((a, b) => (b.lead ? 1 : 0) - (a.lead ? 1 : 0) || a.n - b.n);
  const moves = refs.map((r, i) => ({ r, to: refFileName(r, i) })).filter(m => m.r.file && m.r.file !== m.to);
  // two steps (to temporary names first) so swapping two names can't overwrite a file
  for (const m of moves) { const tmp = `.ren-${m.r.n}.png`; try { fs.renameSync(path.join(p.dir, m.r.file), path.join(p.dir, tmp)); m.tmp = tmp; } catch (e) { log('slop ref rename failed', e.message); } }
  for (const m of moves) if (m.tmp) { try { fs.renameSync(path.join(p.dir, m.tmp), path.join(p.dir, m.to)); m.r.file = m.to; } catch (e) { log('slop ref rename failed', e.message); } }
  makeThumb(p);
}
function makeThumb(p) {
  const lead = p.d.refs.find(r => r.lead && r.file) || p.d.refs.find(r => r.file);
  const out = path.join(cacheDir(p), 'thumb.jpg');
  if (!lead) { rmQuiet(out); return; }
  try { fs.writeFileSync(out, nativeImage.createFromPath(path.join(p.dir, lead.file)).resize({ width: 480, quality: 'good' }).toJPEG(82)); } catch (_) {}
}
// Grab the frame at t into reference n (a new one when n is missing). The video window's picture shows
// first as a preview; only the frame from the video itself is saved (see downloader.frame).
async function grabRef(p, { n, t, rect }) {
  let r = n ? p.d.refs.find(x => x.n === n) : null;
  if (!r) {
    r = { n: p.d.nextRef++, t, name: '', kind: '', lead: !p.d.refs.some(x => x.lead), file: null, w: 0, h: 0, from: '' };
    p.d.refs.push(r);
    savePack(p);
  }
  r.t = Math.max(0, Number(t) || 0);
  const tok = ++p.rt.tok, st = p.rt.refs[r.n] = { busy: true, error: '', preview: null, tok };
  emitPack(p);
  const vw = wm.wins.get('video');
  if (rect && rect.width > 8 && rect.height > 8 && vw && !vw.isDestroyed() && vw.isVisible() && !vw.isMinimized()) {
    try {
      const img = await vw.webContents.capturePage({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
      if (!img.isEmpty() && st.tok === tok) { const sz = img.getSize(); st.preview = img.resize({ width: 480, quality: 'good' }).toDataURL(); st.window = { png: img.toPNG(), w: sz.width, h: sz.height }; emitPack(p); }
    } catch (e) { log('slop window capture failed', e.message); }
  }
  const res = await downloader.frame({ url: p.d.video.url, t: r.t, file: path.join(cacheDir(p), `grab-${tok}.png`) });
  if (packs.get(p.id) !== p || p.rt.refs[r.n] !== st || !p.d.refs.includes(r)) { if (res.ok) rmQuiet(res.file); return; }
  if (res.ok) {
    const name = r.file || `.new-${r.n}.png`;
    try { rmQuiet(path.join(p.dir, name)); fs.renameSync(res.file, path.join(p.dir, name)); r.file = name; } catch (e) { res.ok = false; res.error = e.message; }
  }
  if (res.ok) {
    const sz = nativeImage.createFromPath(path.join(p.dir, r.file)).getSize();
    Object.assign(r, { w: sz.width, h: sz.height, from: 'video' });
    p.rt.refs[r.n] = {};
    log(`slop frame ${sz.width}x${sz.height} at ${r.t}s (${res.how})`);
    renameRefs(p); savePack(p);
    if (r.lead && p.d.motion.on) makeMotion(p);
  } else Object.assign(st, { busy: false, error: res.error || 'YouTube didn’t send the frame.' });
  emitPack(p);
}
function useWindowPicture(p, n) {
  const r = p.d.refs.find(x => x.n === n), st = p.rt.refs[n];
  if (!r || !st || !st.window) return false;
  const name = r.file || `.new-${r.n}.png`;
  fs.writeFileSync(path.join(p.dir, name), st.window.png);
  Object.assign(r, { file: name, w: st.window.w, h: st.window.h, from: 'window' });
  p.rt.refs[n] = {};
  renameRefs(p); savePack(p); emitPack(p);
  return true;
}
function setRef(p, n, patch) {
  const r = p.d.refs.find(x => x.n === n); if (!r) return;
  if (typeof patch.name === 'string') r.name = patch.name.replace(/[\x00-\x1f]/g, '').slice(0, 40);
  if (typeof patch.kind === 'string') r.kind = SLOP_KINDS.includes(patch.kind) ? patch.kind : '';
  if (patch.lead === true) { const was = p.d.refs.find(x => x.lead); for (const x of p.d.refs) x.lead = x === r; if (was !== r && p.d.motion.on) makeMotion(p); }
  renameRefs(p); savePack(p); emitPack(p);
}
function delRef(p, n) {
  const i = p.d.refs.findIndex(x => x.n === n); if (i < 0) return;
  const [r] = p.d.refs.splice(i, 1);
  if (r.file) rmQuiet(path.join(p.dir, r.file));
  delete p.rt.refs[n];
  if (r.lead && p.d.refs.length) { p.d.refs.sort((a, b) => a.n - b.n)[0].lead = true; if (p.d.motion.on) makeMotion(p); }
  renameRefs(p); savePack(p); emitPack(p);
}

// ---- burst: N candidates spread over the clip; the user keeps the good ones
async function burst(p, count) {
  const c = p.d.audio.clip, n = Math.max(3, Math.min(8, count || 5)), dir = path.join(cacheDir(p), 'burst');
  rmQuiet(dir); fs.mkdirSync(dir, { recursive: true });
  const run = p.rt.burst = { running: true, items: Array.from({ length: n }, (_, i) => ({ i, t: Math.round((c.in + (i + 0.5) * (c.out - c.in) / n) * 10) / 10, status: 'waiting' })) };
  emitPack(p);
  for (const it of run.items) {
    if (p.rt.burst !== run) return;
    it.status = 'grabbing'; emitPack(p);
    const res = await downloader.frame({ url: p.d.video.url, t: it.t, file: path.join(dir, `b-${it.i}.png`) });
    if (p.rt.burst !== run) { if (res.ok) rmQuiet(res.file); return; }
    if (res.ok) { const sz = nativeImage.createFromPath(res.file).getSize(); Object.assign(it, { status: 'ok', w: sz.width, h: sz.height, url: fileUrl(res.file), file: res.file }); }
    else Object.assign(it, { status: 'error', error: res.error });
    emitPack(p);
  }
  run.running = false; emitPack(p);
}
function burstKeep(p, picks) {
  const run = p.rt.burst; if (!run) return;
  for (const pk of Array.isArray(picks) ? picks : []) {
    const it = run.items.find(x => x.i === pk.i && x.status === 'ok'); if (!it) continue;
    const r = { n: p.d.nextRef++, t: it.t, name: '', kind: '', lead: false, file: `.new-b${it.i}-${Date.now()}.png`, w: it.w, h: it.h, from: 'video' };
    try { fs.renameSync(it.file, path.join(p.dir, r.file)); } catch (e) { log('slop burst keep failed', e.message); continue; }
    if (pk.role === 'lead') for (const x of p.d.refs) x.lead = false;
    r.lead = pk.role === 'lead' || !p.d.refs.some(x => x.lead);
    p.d.refs.push(r);
  }
  p.rt.burst = null; rmQuiet(path.join(p.dir, '.slopamp', 'burst'));
  renameRefs(p); savePack(p); emitPack(p);
  if (p.d.motion.on) makeMotion(p);
}

// ---- motion reference: a few silent seconds around the lead frame
function makeMotion(p) {
  clearTimeout(p.motionT);
  p.motionT = setTimeout(() => queuePack(p, async () => {
    const out = path.join(p.dir, 'motion.mp4');
    if (!p.d.motion.on) { rmQuiet(out); p.rt.busy.motion = false; emitPack(p); return; }
    const lead = p.d.refs.find(r => r.lead), center = lead ? lead.t : p.d.at, len = Math.max(2, Math.min(5, p.d.motion.len || 3));
    const start = Math.max(0, center - len / 2);
    const sig = `${start.toFixed(2)}+${len}`;
    if (fs.existsSync(out) && p.d.motion.made === sig) return;
    p.rt.busy.motion = true; p.rt.busy.motionErr = ''; emitPack(p);
    const res = await downloader.motion({ url: p.d.video.url, start, len, file: out });
    p.rt.busy.motion = false;
    if (res.ok) { p.d.motion.made = sig; p.d.motion.start = start; savePack(p); } else p.rt.busy.motionErr = res.error || 'The motion clip failed.';
    emitPack(p);
  }), 600);
}

// ---- captions -> lyrics.txt for the clip; details -> suggested scene line
async function fetchDetails(p) {
  p.rt.details = 'pending'; emitPack(p);
  try { await fetchDetails2(p); } finally { p.rt.details = 'done'; emitPack(p); }
}
async function fetchDetails2(p) {
  const info = await downloader.info(p.d.video.url);
  if (info) {
    Object.assign(p.d.video, { title: info.title || p.d.video.title, channel: info.channel || info.uploader || '', description: String(info.description || '').slice(0, 5000), language: info.language || '', duration: Number(info.duration) || p.d.video.duration });
    p.d.suggestion = suggestScene(p.d.video.title, p.d.video.description, p.d.at);
    savePack(p); writeSource(p); emitPack(p);
  }
  const vtt = await downloader.subs(p.d.video.url, cacheDir(p), p.d.video.language);
  if (vtt) {
    try { fs.writeFileSync(path.join(cacheDir(p), 'cues.json'), JSON.stringify(parseVtt(fs.readFileSync(vtt, 'utf8')))); } catch (e) { log('slop captions parse failed', e.message); }
    loadCues(p); writeLyrics(p); emitPack(p);
  }
}
function parseVtt(txt) {
  const ts = (s) => { const m = /(?:(\d+):)?(\d+):(\d+)[.,](\d+)/.exec(s); return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000 : 0; };
  const out = [];
  for (const block of txt.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n'), i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) continue;
    const t = ts(lines[i].split('-->')[0]);
    for (const raw of lines.slice(i + 1)) {
      const line = raw.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      if (line && (!out.length || out[out.length - 1].x !== line)) out.push({ t: Math.round(t * 10) / 10, x: line });
    }
  }
  // (automatic captions repeat the previous line while it scrolls; the check above keeps it once,
  // while a chorus that really comes back later stays)
  return out;
}
function loadCues(p) { try { p.rt.cues = JSON.parse(fs.readFileSync(path.join(p.dir, '.slopamp', 'cues.json'), 'utf8')); } catch (_) { p.rt.cues = null; } }
function writeLyrics(p) {
  const out = path.join(p.dir, 'lyrics.txt'), cues = p.rt.cues, c = p.d.audio.clip;
  if (!cues) { p.rt.lyricsText = ''; return; }
  const sel = cues.filter(q => q.t >= c.in - 0.5 && q.t <= c.out);
  if (!sel.length || sel.every(q => /^\[.*\]$/.test(q.x))) { rmQuiet(out); p.d.lyrics = null; p.rt.lyricsText = ''; return; }
  const text = sel.map(q => `[${fmtTime(q.t)}] ${q.x}`).join('\r\n');
  p.rt.lyricsText = text;
  p.d.lyrics = { lines: sel.length, from: c.in, to: c.out };
  try { fs.writeFileSync(out, `Captions ${fmtTime(c.in)}–${fmtTime(c.out)} from YouTube for "${p.d.video.title}"\r\n\r\n${text}\r\n`); } catch (_) {}
}
// A one-line scene idea from the title and the first real sentence of the description (a template, not AI).
function suggestScene(title, desc, at) {
  const t = String(title || '').replace(/\s*[([][^)\]]*\b(official|video|audio|lyrics?|visuali[sz]er|hd|4k|remaster(ed)?|mv|m\/v|hq)\b[^)\]]*[)\]]/gi, '').replace(/\s*[|│].*$/, '').replace(/\s+/g, ' ').trim();
  const skip = /^(subscribe|follow|stream|listen|download|lyrics|watch|buy|pre-?save|merch|tour|tickets|official|directed|produced|director|producer|credits|music by|written by|mixed|mastered|©|℗|#|@|instagram|tiktok|twitter|facebook|spotify|apple music)/i;
  const line = String(desc || '').split(/\n+/).map(l => l.trim()).find(l => l.split(/\s+/).length >= 4 && !/https?:\/\//i.test(l) && !skip.test(l)) || '';
  const sentence = (line.match(/^.*?[.!?](\s|$)/) || [line])[0].trim().slice(0, 140);
  return `Music video scene for "${t || 'this song'}" at ${fmtTime(at)}${sentence ? `: ${sentence.replace(/[.!?]$/, '')}` : ''}`.slice(0, 220);
}

// ---- prompt, zip, open in slop.cc
function writePrompt(p, text) {
  text = String(text || '').trim();
  p.d.prompt.text = text; savePack(p);
  fs.writeFileSync(path.join(p.dir, 'prompt.txt'), `${text}\r\n\r\n---\r\n${SLOP_RIGHTS}\r\n`);
  return text;
}
// A plain zip of the pack (no extra library): deflated files, UTF-8 names, the .slopamp folder left out.
function zipPack(dir) {
  const files = fs.readdirSync(dir).filter(f => !f.startsWith('.') && fs.statSync(path.join(dir, f)).isFile());
  const out = dir + '.zip', base = path.basename(dir), local = [], central = [];
  let off = 0;
  const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  for (const f of files) {
    const data = fs.readFileSync(path.join(dir, f)), mt = fs.statSync(path.join(dir, f)).mtime;
    const name = Buffer.from(`${base}/${f}`, 'utf8'), crc = zlib.crc32(data);
    const packed = /\.(png|jpe?g|mp3|mp4|m4a|webm)$/i.test(f) ? null : zlib.deflateRawSync(data, { level: 9 });
    const body = packed && packed.length < data.length ? packed : data, method = body === data ? 0 : 8;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(method, 8);
    h.writeUInt16LE(dosTime(mt), 10); h.writeUInt16LE(dosDate(mt), 12); h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    local.push(h, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(method, 10);
    c.writeUInt16LE(dosTime(mt), 12); c.writeUInt16LE(dosDate(mt), 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, name);
    off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  fs.writeFileSync(out + '.part', Buffer.concat([...local, cd, end]));
  fs.renameSync(out + '.part', out);
  return out;
}
// Wait until the clips / motion being made right now are on disk.
async function settled(p) { clearTimeout(p.audioT); clearTimeout(p.motionT); if (p.rt.song.status === 'ready') await queuePack(p, () => doExportAudio(p)); await p.rt.chain; }

// ---- the Library: every pack in the Slop folder
function packSummary(dir) {
  let d = null;
  try { d = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8')); } catch (_) {}
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return null; }
  if (!d && !names.includes('source.txt')) return null;
  let size = 0;
  for (const n of names) { try { const st = fs.statSync(path.join(dir, n)); if (st.isFile()) size += st.size; } catch (_) {} }
  const id = path.basename(dir), ex = (f) => names.includes(f);
  let thumb = path.join(dir, '.slopamp', 'thumb.jpg');
  if (!fs.existsSync(thumb)) thumb = ex('frame.png') ? path.join(dir, 'frame.png') : null;
  const zip = fs.existsSync(dir + '.zip') ? dir + '.zip' : null;
  let lyricsText = '';
  if (ex('lyrics.txt')) { try { lyricsText = fs.readFileSync(path.join(dir, 'lyrics.txt'), 'utf8').slice(0, 4000); } catch (_) {} }
  if (!d) {   // a 1.5.x pack (opening it in SLOP upgrades it)
    let src = ''; try { src = fs.readFileSync(path.join(dir, 'source.txt'), 'utf8'); } catch (_) {}
    const lines = src.split(/\r?\n/), url = (lines.find(l => /^https:\/\//.test(l)) || '').trim();
    let prompt = ''; try { prompt = fs.readFileSync(path.join(dir, 'prompt.txt'), 'utf8').split(/\r?\n---\r?\n/)[0].trim(); } catch (_) {}
    let created = 0; try { created = fs.statSync(dir).mtimeMs; } catch (_) {}
    const mm = /Moment: (?:(\d+):)?(\d+):(\d+)/.exec(src), at = mm ? (+(mm[1] || 0)) * 3600 + (+mm[2]) * 60 + (+mm[3]) : 0;
    return { id, dir, legacy: true, title: lines[0] || id, video: { id: ytId(url), url, title: lines[0] || '' }, at, created, updated: created, opened: ex('prompt.txt') ? created : null,
      zip, size, thumb: thumb && fileUrl(thumb), refs: ex('frame.png') ? [{ n: 1, name: '', kind: '', lead: true, file: 'frame.png', url: fileUrl(path.join(dir, 'frame.png')) }] : [],
      files: { song: false, audio: ex('audio.mp3'), audio2: false, motion: false, lyrics: false }, urls: { audio: ex('audio.mp3') ? fileUrl(path.join(dir, 'audio.mp3')) : null }, prompt, lyricsText: '' };
  }
  return {
    id, dir, legacy: false, title: d.title, video: { id: d.video && d.video.id, url: d.video && d.video.url, title: d.video && d.video.title, channel: d.video && d.video.channel },
    at: d.at, created: d.created, updated: d.updated, opened: d.opened, zip, size, thumb: thumb && fileUrl(thumb),
    refs: (d.refs || []).filter(r => r.file && ex(r.file)).map(r => ({ n: r.n, name: r.name, kind: r.kind, lead: r.lead, file: r.file, t: r.t, w: r.w, h: r.h, url: fileUrl(path.join(dir, r.file)) })),
    files: { song: ex('song.mp3'), audio: ex('audio.mp3'), audio2: ex('audio-2.mp3'), motion: ex('motion.mp4'), lyrics: ex('lyrics.txt') },
    urls: { audio: ex('audio.mp3') ? fileUrl(path.join(dir, 'audio.mp3')) : null, audio2: ex('audio-2.mp3') ? fileUrl(path.join(dir, 'audio-2.mp3')) : null, song: ex('song.mp3') ? fileUrl(path.join(dir, 'song.mp3')) : null },
    clip: d.audio && d.audio.clip, prompt: (d.prompt && d.prompt.text) || '', suggestion: d.suggestion || '', lyricsText
  };
}
function listPacks() {
  const root = slopRoot();
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'skins').map(e => e.name); } catch (_) { return []; }   // skins\ holds user skins, not a pack
  return names.map(n => packSummary(path.join(root, n))).filter(Boolean).sort((a, b) => (b.created || 0) - (a.created || 0));
}
// Rename: the title in pack.json and the folder ("<date time> <title> @<time>"). Returns the new id.
function renamePack(id, title) {
  title = String(title || '').trim().slice(0, 200); if (!title) return null;
  const dir = path.join(slopRoot(), id); if (!inSlopRoot(dir) || !fs.existsSync(dir)) return null;
  const live = packs.get(id);
  if (live && ['queued', 'downloading'].includes(live.rt.song.status)) return { error: 'Wait until the song has downloaded, then rename it.' };
  const m = /^(\d{4}-\d\d-\d\d \d\d\.\d\d\.\d\d) .*?( @\d+m\d\ds(?: \(\d+\))?)$/.exec(id);
  const base = m ? `${m[1]} ${fileSafe(title).slice(0, 60)}${m[2]}` : fileSafe(title).slice(0, 80);
  let nd = path.join(slopRoot(), base);
  if (nd !== dir) for (let i = 2; fs.existsSync(nd); i++) nd = path.join(slopRoot(), `${base} (${i})`);
  if (nd !== dir) { fs.renameSync(dir, nd); if (fs.existsSync(dir + '.zip')) { try { fs.renameSync(dir + '.zip', nd + '.zip'); } catch (_) {} } }
  const nid = path.basename(nd);
  let d = null; try { d = JSON.parse(fs.readFileSync(path.join(nd, 'pack.json'), 'utf8')); } catch (_) {}
  if (live) { packs.delete(id); live.id = nid; live.dir = nd; live.d.title = title; packs.set(nid, live); savePack(live); writeSource(live); slopEvent({ type: 'renamed', from: id, to: nid }); emitPack(live); }
  else if (d) { d.title = title; d.updated = Date.now(); fs.writeFileSync(path.join(nd, 'pack.json'), JSON.stringify(d, null, 2)); }
  if (live && live.d.zip) live.d.zip = fs.existsSync(nd + '.zip') ? nd + '.zip' : null;
  return { id: nid };
}
async function trashPack(id) {
  const dir = path.join(slopRoot(), id); if (!inSlopRoot(dir) || !fs.existsSync(dir)) return false;
  const p = packs.get(id);
  if (p) { if (p.rt.song.job) downloader.cancel(p.rt.song.job); p.rt.burst = null; packs.delete(id); slopEvent({ type: 'gone', id }); }
  await new Promise(r => setTimeout(r, p ? 800 : 0));   // a stopped yt-dlp/FFmpeg may hold a file for a moment
  await shell.trashItem(dir);
  if (fs.existsSync(dir + '.zip')) { try { await shell.trashItem(dir + '.zip'); } catch (_) {} }
  return true;
}
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
  const old = path.join(slopRoot(), 'skins');
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
    sw: Array.isArray(m.sw) ? m.sw.slice(0, 6).map(String) : null, size: st.size, mtime: st.mtimeMs };
}
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
function importSkin(src) {
  const st = fs.statSync(src);
  if (st.size > SKIN_MAX) return { file: src, error: 'That file is too big to be a skin.' };
  const text = cleanSkinCss(fs.readFileSync(src, 'utf8'));
  const { vars } = splitSkin(text);
  if (vars.size < 3) return { file: src, error: 'That isn’t a SlopAMP skin (no :root block with -- colours).' };
  const head = /SlopAMP skin:\s*"([^"]{1,60})"/.exec(text), meta = skinMeta(text);
  const name = String(meta.name || (head && head[1]) || path.basename(src, path.extname(src))).slice(0, 60);
  const slug = freeSlug(name), out = path.join(skinsDir(), `${slug}.css`);
  fs.mkdirSync(skinsDir(), { recursive: true });
  // keep it as it came (cleaned); give it our header if it had none, so it has a name in the picker
  const withHead = /slopamp:\s*\{/.test(text) ? text : skinHeader(name, { v: 1, name, base: 'classic', baseName: '' }) + text.replace(/^\/\*[\s\S]*?\*\/\s*/, '');
  fs.writeFileSync(out, withHead);
  log(`skin imported: ${path.basename(src)} -> ${slug}.css`);
  return skinEntry(out);
}
function downloadDirs() {
  const s = currentState || loadState();
  const base = path.join(app.getPath('downloads'), 'SlopAMP');
  return { video: s.dlVideoDir || path.join(base, 'Video'), audio: s.dlAudioDir || path.join(base, 'Audio'), playlists: path.join(base, 'Playlists'), slop: path.join(base, 'Slop'),
    mp3clips: path.join(base, 'mp3clips'), mp4clips: path.join(base, 'mp4clips'), shots: path.join(base, 'Shots') };   // CLIP (2.3)
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
    const isX = !!job && typeof job.url === 'string' && X_POST_URL_RE.test(job.url);
    if (!job || typeof job.url !== 'string' || (!isX && !/^https:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(job.url))) return { ok: false, reason: 'unsupported' };
    if (!downloader.available()) return { ok: false, reason: 'missing' };
    const vid = KEY_RE.test(job.vid || '') && (!isX || /^x\d/.test(job.vid)) ? job.vid : null;
    if (isX && !vid) return { ok: false, reason: 'unsupported' };
    return downloader.start({ id: String(job.id), vid, x: isX, url: job.url, kind: job.kind === 'audio' ? 'audio' : 'video', quality: ['best', '1080', '720', '480'].includes(job.quality) ? job.quality : 'best', title: String(job.title || '') });
  });
  ipcMain.on('dl:cancel', (_e, id) => downloader.cancel(String(id)));
  // ---- SLOP (see "SLOP (1.6)" above). Every handler answers with the pack as the window shows it.
  const slopOk = (p) => ({ ok: true, pack: packView(p) });
  // Open the pack for this video: the one already open, else its newest pack from the last 12 hours,
  // else a new one (o.fresh: always new). A new pack starts the song download and grabs the moment.
  ipcMain.handle('slop:open', (_e, o) => {
    if (!o || typeof o.url !== 'string' || !YT_URL_RE.test(o.url)) return { ok: false, error: 'SLOP works with YouTube videos for now.' };
    if (!downloader.available()) return { ok: false, error: 'The downloader (yt-dlp) is missing from this copy of SlopAMP.' };
    const vid = ytId(o.url);
    let p = null;
    if (!o.fresh) {
      p = [...packs.values()].filter(x => x.d.video.id === vid).sort((a, b) => b.d.updated - a.d.updated)[0] || null;
      if (!p) { const s = listPacks().find(x => !x.legacy && x.video.id === vid && Date.now() - (x.created || 0) < 12 * 3600e3); if (s) p = loadPack(s.id); }
    }
    let created = false;
    if (!p) { try { p = createPack(o); created = true; } catch (e) { return { ok: false, error: `Couldn’t create the SLOP folder: ${e.message}` }; } }
    if (created) { songStart(p); fetchDetails(p).catch(e => log('slop details failed', e && e.message)); }
    else if (!p.rt.song.file && p.rt.song.status !== 'stopped') songStart(p);
    return { ...slopOk(p), created };
  });
  // A pack from the Library (upgrades a 1.5 pack). Starts the song download if the song isn't here yet.
  ipcMain.handle('slop:load', (_e, id) => {
    const p = loadPack(String(id)); if (!p) return { ok: false, error: 'That pack isn’t in the Slop folder any more.' };
    if (!p.rt.song.file) songStart(p);
    if (!p.d.suggestion || !p.rt.cues) fetchDetails(p).catch(() => {});
    return slopOk(p);
  });
  ipcMain.handle('slop:peaks', (_e, id) => { const p = livePack(id); return p && p.rt.peaks; });
  ipcMain.handle('slop:song', (_e, o) => {
    const p = livePack(o); if (!p) return { ok: false };
    if (o.action === 'stop') songStop(p); else { if (p.rt.song.status === 'error' || p.rt.song.status === 'stopped') p.rt.song = { status: 'none' }; songStart(p); }
    return slopOk(p);
  });
  // Settings: clip / second clip / whole song / motion / prompt / title.
  ipcMain.handle('slop:set', (_e, o) => {
    const p = livePack(o); if (!p || !o.patch) return { ok: false };
    const x = o.patch, a = p.d.audio, dur = p.d.video.duration || 1e9, num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    const range = (c, v) => { if (!v) return; let i = Math.max(0, Math.min(dur, num(v.in, c.in))), j = Math.max(0, Math.min(dur, num(v.out, c.out))); if (j - i < 1) j = Math.min(dur, i + 1); if (j - i > 600) j = i + 600; c.in = Math.round(i * 10) / 10; c.out = Math.round(j * 10) / 10; };
    let audio = false;
    if (x.clip) { range(a.clip, x.clip); audio = true; }
    if (x.clip2) { if ('on' in x.clip2) a.clip2.on = !!x.clip2.on; range(a.clip2, x.clip2); audio = true; }
    if (x.song && 'on' in x.song) { a.song.on = !!x.song.on && !!(!a.src || a.src.full); audio = true; }
    if (x.motion) { if ('on' in x.motion) p.d.motion.on = !!x.motion.on; if ('len' in x.motion) p.d.motion.len = Math.max(2, Math.min(5, Math.round(num(x.motion.len, 3)))); makeMotion(p); }
    if (x.prompt) { if (typeof x.prompt.text === 'string') p.d.prompt.text = x.prompt.text.slice(0, 4000); if (typeof x.prompt.idea === 'string') p.d.prompt.idea = x.prompt.idea.slice(0, 20); }
    savePack(p);
    if (audio) { exportAudio(p); if (x.clip) { writeLyrics(p); writeSource(p); } }
    emitPack(p);
    return slopOk(p);
  });
  ipcMain.handle('slop:frame', (_e, o) => { const p = livePack(o); if (!p) return { ok: false }; grabRef(p, { n: o.n, t: o.t, rect: o.rect }).catch(e => log('slop frame failed', e && e.message)); return { ok: true }; });
  ipcMain.handle('slop:use-window', (_e, o) => { const p = livePack(o); return { ok: !!(p && useWindowPicture(p, o.n)) }; });
  ipcMain.handle('slop:ref', (_e, o) => { const p = livePack(o); if (!p) return { ok: false }; if (o.remove) delRef(p, o.n); else setRef(p, o.n, o.patch || {}); return slopOk(p); });
  ipcMain.handle('slop:burst', (_e, o) => {
    const p = livePack(o); if (!p) return { ok: false };
    if (o.keep) burstKeep(p, o.keep);
    else if (o.cancel) { p.rt.burst = null; rmQuiet(path.join(p.dir, '.slopamp', 'burst')); emitPack(p); }
    else burst(p, o.count).catch(e => log('slop burst failed', e && e.message));
    return { ok: true };
  });
  // prompt.txt (the prompt + the rights note) and the clipboard (the prompt only)
  ipcMain.handle('slop:save-prompt', (_e, o) => { const p = livePack(o); if (!p) return { ok: false }; const t = writePrompt(p, o.text); clipboard.writeText(t); emitPack(p); return { ok: true }; });
  ipcMain.on('slop:copy', (_e, text) => { if (typeof text === 'string') clipboard.writeText(text); });
  ipcMain.handle('slop:go', async (_e, o) => {
    const p = livePack(o); if (!p) return { ok: false };
    await settled(p);
    const missing = [];
    if (!['audio.mp3', 'song.mp3'].some(f => fs.existsSync(path.join(p.dir, f)))) missing.push('the audio');
    if (!p.d.refs.some(r => r.file && fs.existsSync(path.join(p.dir, r.file)))) missing.push('a reference still');
    if (missing.length) return { ok: false, error: `The pack needs ${missing.join(' and ')} first.` };
    const t = writePrompt(p, o.text != null ? o.text : p.d.prompt.text);
    clipboard.writeText(t);
    p.d.opened = Date.now(); savePack(p);
    shell.openPath(p.dir);
    shell.openExternal(SLOP_CHAT);
    emitPack(p);
    return slopOk(p);
  });
  ipcMain.on('slop:signup', () => shell.openExternal(SLOP_HOME));
  ipcMain.handle('slop:zip', async (_e, ids) => {
    const out = [];
    for (const id of (Array.isArray(ids) ? ids : [ids]).map(String)) {
      const dir = path.join(slopRoot(), id); if (!inSlopRoot(dir) || !fs.existsSync(dir)) continue;
      const p = packs.get(id); if (p) await settled(p);
      try { const f = zipPack(dir); out.push({ id, file: f, size: fs.statSync(f).size }); if (p) { p.d.zip = f; savePack(p); emitPack(p); } }
      catch (e) { out.push({ id, error: e.message }); log('slop zip failed', e.message); }
    }
    return out;
  });
  ipcMain.on('slop:folder', (_e, id) => { const dir = id ? path.join(slopRoot(), String(id)) : slopRoot(); if (!id || inSlopRoot(dir)) { try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {} shell.openPath(dir); } });
  ipcMain.on('slop:reveal', (_e, f) => { const s = String(f || ''); const dir = path.join(slopRoot(), s.split(/[\\/]/)[0]); if (inSlopRoot(dir) && fs.existsSync(path.join(slopRoot(), s))) shell.showItemInFolder(path.join(slopRoot(), s)); });
  ipcMain.handle('slop:list', () => listPacks());
  ipcMain.handle('slop:rename', (_e, o) => { try { return renamePack(String(o.id), o.title) || { error: 'Rename failed.' }; } catch (e) { return { error: e.message }; } });
  ipcMain.handle('slop:trash', async (_e, ids) => {
    const res = [];
    for (const id of (Array.isArray(ids) ? ids : [ids]).map(String)) { try { res.push({ id, ok: await trashPack(id) }); } catch (e) { res.push({ id, ok: false, error: e.message }); } }
    return res;
  });
  ipcMain.on('slop:forget', (_e, id) => { const p = packs.get(String(id)); if (p && !['queued', 'downloading'].includes(p.rt.song.status)) packs.delete(p.id); });
  // ---- user skins (see "user skins (1.7)" above)
  // ---- CLIP (2.3): clip.js
  ipcMain.handle('clip:open', (_e, f) => clipper.open(f));
  ipcMain.handle('clip:peaks', (_e, f) => (typeof f === 'string' && fs.existsSync(f) ? clipper.peaks(f) : null));
  ipcMain.handle('clip:frames', (_e, f, times, h) => (typeof f === 'string' && fs.existsSync(f) ? clipper.frames(f, times, h) : []));
  ipcMain.handle('clip:save', (_e, o) => clipper.save(o).catch((e) => { log('clip save failed', e); return { ok: false, error: 'Couldn’t save the clip.' }; }));
  ipcMain.on('clip:cancel', (_e, job) => clipper.cancel(job));
  ipcMain.handle('clip:list', () => clipper.list());
  ipcMain.handle('clip:delete', (_e, paths) => clipper.remove(paths));
  ipcMain.handle('clip:rename', (_e, p, name) => { try { return clipper.rename(p, name); } catch (e) { return { error: String(e.message || e) }; } });
  ipcMain.handle('clip:pick', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Pick a song or video to clip', properties: ['openFile'],
      filters: [{ name: 'Songs and videos', extensions: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'ts', 'mpg', 'mpeg'] }, { name: 'All files', extensions: ['*'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  // shots (SLOP's LOOK, in CLIP since 2.3): o = { file, title, … }
  for (const [ch, fn] of [['clip:shots', 'shots'], ['clip:shot-add', 'shotAdd'], ['clip:shot-set', 'shotSet'], ['clip:shot-del', 'shotDel'], ['clip:shot-burst', 'shotBurst'], ['clip:shot-keep', 'shotKeep']]) {
    ipcMain.handle(ch, (_e, o) => (o && typeof o === 'object' && typeof o.file === 'string' ? clipper[fn](o).catch((e) => { log(`${ch} failed`, e); return { error: 'That didn’t work.' }; }) : { error: 'No file.' }));
  }
  ipcMain.on('clip:shot-folder', (_e, o) => { const d = clipper.shotDir(o || {}); try { fs.mkdirSync(d, { recursive: true }); } catch (_) {} shell.openPath(d); });
  ipcMain.on('clip:folder', (_e, kind) => { const d = downloadDirs()[kind === 'mp4' ? 'mp4clips' : 'mp3clips']; try { fs.mkdirSync(d, { recursive: true }); } catch (_) {} shell.openPath(d); });
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
  ipcMain.handle('web:resolve', async (_e, urls) => {
    const list = (Array.isArray(urls) ? urls : []).filter(u => typeof u === 'string' && /^https?:\/\/t\.co\/\w{1,30}\/?$/i.test(u)).slice(0, 100);
    const out = {};
    await Promise.all(list.map(async (u) => { out[u] = await resolveShortLink(u); }));
    return out;
  });
  ipcMain.on('shell:open', (_e, url) => { if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url); });
  ipcMain.on('shell:show', (_e, p) => { if (typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p); });

  ipcMain.on('win:minimize', () => win && win.minimize());
  ipcMain.on('win:close', () => win && win.close());
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

// ---------- lifecycle ----------
app.whenReady().then(async () => {
  if (!gotLock) return;
  migrateOldState();
  migrateSkinsFolder();
  server = new MediaServer({ uiDir: path.join(__dirname, 'renderer'), ffmpegDir, log });
  clipper = new Clipper({
    ffmpeg: ffmpegExe, server, encoderArgs, log, fileSafe,
    dirs: () => { const d = downloadDirs(); return { mp3: d.mp3clips, mp4: d.mp4clips, shots: d.shots }; },
    urlOf: (f) => fileUrl(f),
    getIndex: () => { const c = (currentState || loadState()).clips; return c && typeof c === 'object' ? c : {}; },
    setIndex: (idx) => setMainState({ clips: idx }),
    trash: (p) => shell.trashItem(p),
    send: (ev) => { if (win && !win.isDestroyed()) win.webContents.send('clip:event', ev); }
  });
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
      if (/^slop-/.test(String(ev.id))) { onSlopDownload(ev); return; }   // SLOP's song: not a download for the bar or index
      if (ev.status === 'done' && ev.file && ev.vid) {
        // X posts are added with a stand-in title ("@user · X post"); the file yt-dlp wrote is named after the post
        const xTitle = /^x\d/.test(ev.vid) && /^(@\w{1,15} · X post|X post \d+)( \(video \d+\))?$/.test(ev.title || '');
        rememberDownload(ev.vid, ev.kind === 'audio' ? 'audio' : 'video', ev.file, xTitle ? path.basename(ev.file).replace(/\.[^.]+$/, '').replace(DL_FILE_RE_TAIL, '').trim() : ev.title);
      }
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
