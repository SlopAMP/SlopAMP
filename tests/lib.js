// Shared setup for SlopAMP's end-to-end tests (Playwright + Electron, run on Linux under xvfb).
// SLOPAMP_ELECTRON  the Electron binary (default: electron from node_modules or PATH)
// SLOPAMP_APP       the app folder: package.json + src/ + vendor/ffmpeg/<platform> (default: this checkout)
// SLOPAMP_YTDLP     optional: a yt-dlp to put in the test profile's tools folder
const { _electron } = require('playwright');
const fs = require('fs'), path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const APP = process.env.SLOPAMP_APP || path.join(__dirname, '..');
// macOS: the profile is in ~/Library/Application Support, and the system takes "~" from CFFIXED_USER_HOME, not HOME
const MAC = process.platform === 'darwin';
const PROFILE = MAC ? 'Library/Application Support/SlopAMP' : '.config/SlopAMP';
function electronPath() {
  if (process.env.SLOPAMP_ELECTRON) return process.env.SLOPAMP_ELECTRON;
  try { return require('electron'); } catch (_) { return 'electron'; }
}
// H: a fresh HOME for this run (the profile and Downloads live there). keep: reuse it (and its saved state).
async function launch(H, opts = {}) {
  if (!opts.keep) fs.rmSync(H, { recursive: true, force: true });
  fs.mkdirSync(path.join(H, PROFILE, 'tools'), { recursive: true });
  if (process.env.SLOPAMP_YTDLP) { const t = path.join(H, PROFILE, 'tools/yt-dlp'); fs.copyFileSync(process.env.SLOPAMP_YTDLP, t); fs.chmodSync(t, 0o755); }
  const stateFile = path.join(H, PROFILE, 'slopamp-state.json');
  if (!opts.keep || !fs.existsSync(stateFile)) fs.writeFileSync(stateFile, JSON.stringify({ update: { mode: 'off' }, ytdlpUpdatedAt: Date.now() }));
  const env = { ...process.env, HOME: H, PHOSPHOR_DEV: '1', ...(MAC ? { CFFIXED_USER_HOME: H } : {}) };
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) delete env[k];
  // 3.2.0: SlopAMP runs on X11 (main.js); on a Wayland desktop the tests stay on xvfb's display, not the real one
  delete env.WAYLAND_DISPLAY;
  const app = await _electron.launch({ executablePath: electronPath(), args: [APP, ...(MAC ? [] : ['--no-sandbox', '--ozone-platform=x11']), ...(opts.args || [])], env });
  const win = await app.firstWindow();
  await win.waitForFunction(() => window.__phosphor, null, { timeout: 20000 }); await sleep(1200);
  const errs = []; win.on('pageerror', (e) => errs.push(e.message)); win.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  return { app, win, errs };
}
// the window whose <body> has class `cls` (SlopAMP's panels and its popup / dialog hosts are separate windows)
async function docWin(app, cls) { for (const w of app.windows()) if (await w.evaluate((c) => document.body.classList.contains(c), cls).catch(() => false)) return w; return null; }
module.exports = { launch, docWin, sleep, APP, PROFILE };
