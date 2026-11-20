// 3.2.0, the first Linux version. Checks:
//   - the updater's platforms: Windows (.exe) and Linux (.AppImage / .deb) files in a release, a release with nothing
//     for this platform skipped quietly (the newest one that has something offered instead), a broken release for
//     it still an error; the SHA256 lines of the Linux files; the AppImage swap (a versioned name takes the new
//     name and the old file goes; a name of your own is replaced in place; a bad copy keeps the old one) and the
//     reopen once SlopAMP has exited
//   - the GPU encoders (VA-API, Vulkan): the argument rewrite (-vf, -filter_complex, none; the X cap), every other
//     encoder untouched; VA-API only with a libva this FFmpeg can use (2.21+), so it never aborts on Ubuntu 24.04's 2.20
//   - yt-dlp's process group: Cancel ends the program and what it started
//   - AppRun: X11, the sandbox check (as the desktop starts it, when this system restricts user namespaces), the
//     "SlopAMP Data" folder
//   - in the app (xvfb): FFmpeg found in bin/, the encoder this machine supports (and its log line), a 10-bit HEVC MKV
//     converted live to H.264 by it, no media keys grabbed, Linux words (Trash,
//     Downloads/SlopAMP/…, Show in folder, the tray hint), the tray check, About's Linux line
// Run (Linux, xvfb): SLOPAMP_ELECTRON=… xvfb-run -a node tests/linux-320.js
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { spawn, spawnSync, execFileSync } = require('child_process');
const { launch, sleep, APP } = require('./lib');
const { parseRelease, Updater, PLATFORMS } = require(path.join(APP, 'src/updater.js'));
const { hwUploadArgs, vaapiUsable, encoderArgs } = require(path.join(APP, 'src/media.js'));
const vaapiArgs = (a, d) => hwUploadArgs(a, { h264_vaapi: d });
const { killTree } = require(path.join(APP, 'src/downloader.js'));
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const T = path.join(os.tmpdir(), 'slopamp-test-320'); fs.rmSync(T, { recursive: true, force: true }); fs.mkdirSync(T, { recursive: true });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const waitFor = async (f, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await sleep(100); } return !!f(); };

(async () => {
  // ================= the updater's platforms
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  ok(pkg.version === '3.2.0' && pkg.desktopName === 'com.slopamp.SlopAMP.desktop', `package.json: ${pkg.version}, desktopName ${pkg.desktopName}`);
  const D = 'https://github.com/SlopAMP/SlopAMP/releases/download/';
  const h = (c) => c.repeat(64);
  const rel = (v, names, body) => ({ tag_name: `v${v}`, html_url: `https://github.com/SlopAMP/SlopAMP/releases/tag/v${v}`,
    body: body !== undefined ? body : `Notes ${v}\n\n${names.map((n, i) => `SHA256 (${n}): ${h('abcdef0123'[i])}`).join('\n')}`,
    assets: names.map((n) => ({ name: n, browser_download_url: `${D}v${v}/${n}`, size: 100 })) });
  const all = (v) => [`SlopAMP-Setup-${v}.exe`, `SlopAMP-Portable-${v}.exe`, `SlopAMP-${v}-x86_64.AppImage`, `SlopAMP-${v}-amd64.deb`];
  let p = parseRelease(rel('3.2.0', all('3.2.0')), '3.1.0', null, 'linux');
  ok(p.newer && !p.error && p.file === 'SlopAMP-3.2.0-x86_64.AppImage' && p.sha256 === h('c'), `Linux reads a 3.2.0 release with all four files: the AppImage and its SHA256 (${p.file})`);
  p = parseRelease(rel('3.2.0', all('3.2.0')), '3.1.0');
  ok(!p.error && p.file === 'SlopAMP-Setup-3.2.0.exe' && p.sha256 === h('a'), 'Windows (the default) still takes the Setup exe from it');
  ok(parseRelease(rel('3.2.1', all('3.2.1').slice(2)), '3.2.0', null, 'win32').error === 'noplatform', 'a Linux-only release is "noplatform" on Windows');
  ok(parseRelease(rel('3.2.1', all('3.2.1').slice(0, 2)), '3.2.0', null, 'linux').error === 'noplatform', 'a Windows-only release is "noplatform" on Linux');
  ok(parseRelease(rel('3.2.1', [`SlopAMP-3.2.1-amd64.deb`]), '3.2.0', null, 'linux').error === 'noasset', 'a Linux release without its AppImage is still an error (noasset)');
  ok(parseRelease(rel('3.2.1', [`SlopAMP-Setup-3.2.exe`]), '3.2.0', null, 'win32').error === 'noasset', 'a Windows release with a misnamed Setup is still an error (noasset)');
  ok(parseRelease(rel('3.2.1', all('3.2.1'), 'no hash'), '3.2.0', null, 'linux').error === 'nohash', 'no SHA256 line for the AppImage: nohash');
  ok(PLATFORMS.linux.file('3.2.0') === 'SlopAMP-3.2.0-x86_64.AppImage' && PLATFORMS.win32.file('3.2.0') === 'SlopAMP-Setup-3.2.0.exe', 'file names: SlopAMP-X.Y.Z-x86_64.AppImage / SlopAMP-Setup-X.Y.Z.exe');

  // the check: a test feed with a list of releases, newest first (a Linux-only 3.2.1 on top of a 3.2.0 with everything)
  const feedDir = path.join(T, 'feed'); fs.mkdirSync(feedDir, { recursive: true });
  const plain = (r) => ({ ...r, assets: r.assets.map(a => ({ ...a, browser_download_url: a.name })) });
  fs.writeFileSync(path.join(feedDir, 'releases.json'), JSON.stringify([plain(rel('3.2.1', all('3.2.1').slice(2))), plain(rel('3.2.0', all('3.2.0'))), plain(rel('3.1.0', all('3.1.0').slice(0, 2)))]));
  const check = async (platform, version) => {
    let st = {}, snap = null;
    const u = new Updater({ fetch: () => { throw new Error('no network in this test'); }, version, testFeed: path.join(feedDir, 'releases.json'), tempDir: T, canInstall: false, installDir: T,
      getState: () => st, setState: (v) => { st = v; }, emit: (s) => { snap = s; }, quit: () => {}, openExternal: () => {}, log: () => {}, platform });
    await u.check(true);
    return snap;
  };
  let s = await check('win32', '3.1.0');
  ok(s.status === 'available' && s.release.version === '3.2.0', `Windows 3.1.0 skips the Linux-only 3.2.1 and finds 3.2.0 (${s.status} ${s.release && s.release.version})`);
  s = await check('win32', '3.2.0');
  ok(s.status === 'uptodate', `Windows 3.2.0: up to date, no error (${s.status} ${s.error || ''})`);
  s = await check('linux', '3.2.0');
  ok(s.status === 'available' && s.release.version === '3.2.1' && s.release.file === 'SlopAMP-3.2.1-x86_64.AppImage', `Linux 3.2.0 finds the Linux-only 3.2.1 (${s.status} ${s.release && s.release.file})`);
  // a Linux-only release published without "latest" (below the 3.2.0 GitHub calls latest): still found from the list
  fs.writeFileSync(path.join(feedDir, 'releases.json'), JSON.stringify([plain(rel('3.2.0', all('3.2.0'))), plain(rel('3.2.1', all('3.2.1').slice(2)))]));
  s = await check('linux', '3.2.0');
  ok(s.status === 'available' && s.release.version === '3.2.1', `a Linux-only 3.2.1 that isn't the "latest" release is still found (${s.status} ${s.release && s.release.version})`);
  s = await check('win32', '3.2.0');
  ok(s.status === 'uptodate', `…and Windows 3.2.0 stays up to date (${s.status})`);

  // ================= the AppImage swap and the reopen (in a child process, so the reopen waits for it to exit)
  const swap = (name, newBody, hashOf) => {
    const dir = path.join(T, `swap-${name.replace(/\W/g, '')}`); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const cur = path.join(dir, name); fs.writeFileSync(cur, '#!/bin/sh\necho old > "$(dirname "$0")/opened"\n', { mode: 0o755 });
    const dl = path.join(T, 'SlopAMP-3.2.1-x86_64.AppImage');
    fs.writeFileSync(dl, `#!/bin/sh\necho "new $SLOPAMP_UPDATE_TEST" > "$(dirname "$0")/opened"\n${newBody}`, { mode: 0o644 });
    const code = `const { Updater } = require(${JSON.stringify(path.join(APP, 'src/updater.js'))});
      const u = new Updater({ fetch: () => null, version: '3.2.0', tempDir: ${JSON.stringify(T)}, canInstall: true, installDir: ${JSON.stringify(dir)}, getState: () => ({}), setState: () => {}, emit: () => {}, quit: () => {}, openExternal: () => {}, log: (...a) => console.log(...a), platform: 'linux', appImage: ${JSON.stringify(cur)} });
      u.release = { version: '3.2.1', sha256: ${JSON.stringify(hashOf || '')} || require('crypto').createHash('sha256').update(require('fs').readFileSync(${JSON.stringify(dl)})).digest('hex') };
      u.installOnQuit = ${JSON.stringify(dl)};
      u.startInstaller().then((r) => { console.log('result', r); });`;
    const out = spawnSync(process.execPath, ['-e', code], { env: { ...process.env, SLOPAMP_UPDATE_TEST: 'leftover' }, encoding: 'utf8' });
    return { dir, cur, out: out.stdout + out.stderr };
  };
  let r = swap('SlopAMP-3.2.0-x86_64.AppImage', '# v');
  let opened = await waitFor(() => fs.existsSync(path.join(r.dir, 'opened')));
  const now = fs.readdirSync(r.dir).filter(n => n !== 'opened').sort();
  ok(JSON.stringify(now) === '["SlopAMP-3.2.1-x86_64.AppImage"]' && (fs.statSync(path.join(r.dir, now[0])).mode & 0o777) === 0o755, `a versioned name: the new AppImage takes its name, the old one is gone, executable (${now.join(', ')})`);
  ok(opened && /^new\s*$/.test(fs.readFileSync(path.join(r.dir, 'opened'), 'utf8')), 'the new AppImage is opened once SlopAMP has exited, without the test-mode variables');
  r = swap('SlopAMP.AppImage', '# mine');
  opened = await waitFor(() => fs.existsSync(path.join(r.dir, 'opened')));
  ok(JSON.stringify(fs.readdirSync(r.dir).filter(n => n !== 'opened')) === '["SlopAMP.AppImage"]' && /# mine/.test(fs.readFileSync(r.cur, 'utf8')) && opened, 'a name of your own: replaced in place (and reopened)');
  r = swap('SlopAMP-3.2.0-x86_64.AppImage', '# bad', 'f'.repeat(64));
  opened = await waitFor(() => fs.existsSync(path.join(r.dir, 'opened')));
  ok(JSON.stringify(fs.readdirSync(r.dir).filter(n => n !== 'opened')) === '["SlopAMP-3.2.0-x86_64.AppImage"]' && opened && /^old/.test(fs.readFileSync(path.join(r.dir, 'opened'), 'utf8')), 'a copy that doesn’t match the SHA256: nothing replaced, no leftovers, the old AppImage reopened');

  // ================= VAAPI argument rewrite
  const va = encoderArgs('h264_vaapi');
  const j = (a) => a.join(' ');
  ok(j(vaapiArgs(['-i', 'a', '-vf', 'scale=1280:-2', ...va, 'o.mp4'], '/dev/dri/renderD129')) === '-vaapi_device /dev/dri/renderD129 -i a -vf scale=1280:-2,format=nv12,hwupload -c:v h264_vaapi -rc_mode CQP -qp 23 o.mp4', 'VAAPI: the GPU first, the upload at the end of -vf');
  ok(j(vaapiArgs(['-i', 'a', '-filter_complex', '[0:v]reverse[bv];[0:a]areverse[ba]', '-map', '[bv]', '-map', '[ba]', ...va, 'o.mp4'])) === '-vaapi_device /dev/dri/renderD128 -i a -filter_complex [0:v]reverse[bv];[0:a]areverse[ba];[bv]format=nv12,hwupload[bvhw] -map [bvhw] -map [ba] -c:v h264_vaapi -rc_mode CQP -qp 23 o.mp4', 'VAAPI: in a -filter_complex, after the mapped picture');
  ok(j(vaapiArgs(['-i', 'a', ...va, '-maxrate', '24M', 'o.mp4'])) === '-vaapi_device /dev/dri/renderD128 -i a -vf format=nv12,hwupload -c:v h264_vaapi -rc_mode VBR -b:v 12M -maxrate 24M o.mp4', 'VAAPI: no filters gets one; X’s cap turns the quality into a capped bitrate');
  const vk = encoderArgs('h264_vulkan');
  ok(j(hwUploadArgs(['-i', 'a', '-vf', 'scale=1280:-2', ...vk, '-maxrate', '24M', 'o.mp4'], { h264_vulkan: '1' })) === '-init_hw_device vulkan=vk:1 -filter_hw_device vk -i a -vf scale=1280:-2,format=nv12,hwupload -c:v h264_vulkan -rc_mode vbr -b:v 12M -maxrate 24M o.mp4', 'Vulkan: its GPU, the upload, and X’s cap the same way');
  const same = ['h264_nvenc', 'h264_amf', 'h264_qsv', 'h264_mf', 'libopenh264', 'libvpx'].every((e) => { const a = ['-i', 'a', '-vf', 'x', ...encoderArgs(e), 'o']; return hwUploadArgs(a, { h264_vaapi: 'x', h264_vulkan: 'y' }) === a; });
  ok(same, 'every other encoder’s arguments are left exactly as they were');

  // ================= yt-dlp's process group
  const g = spawn('/bin/sh', ['-c', 'sleep 60 & sleep 60 & wait'], { detached: true, stdio: 'ignore' });
  await sleep(300);
  const members = () => spawnSync('ps', ['-eo', 'pgid=,stat='], { encoding: 'utf8' }).stdout.split('\n')     // running ones (not zombies waiting to be reaped)
    .map(l => l.trim().split(/\s+/)).filter(([pg, st]) => +pg === g.pid && st && !st.startsWith('Z'));
  const before = members().length;
  killTree(g, true);
  ok(before === 3 && members().length === 0, `Cancel / quitting ends yt-dlp and everything it started (${before} processes, then ${members().length})`);

  // ================= AppRun
  const ad = path.join(T, 'appdir'); fs.mkdirSync(ad, { recursive: true });
  fs.copyFileSync(path.join(APP, 'build/linux/AppRun'), path.join(ad, 'AppRun')); fs.chmodSync(path.join(ad, 'AppRun'), 0o755);
  fs.writeFileSync(path.join(ad, 'slopamp'), '#!/bin/sh\necho "args=$*"\necho "nosb=$SLOPAMP_NO_SANDBOX"\necho "data=$SLOPAMP_DATA_DIR"\n', { mode: 0o755 });
  const fakeImg = path.join(T, 'apps', 'SlopAMP-3.2.0-x86_64.AppImage'); fs.mkdirSync(path.dirname(fakeImg), { recursive: true }); fs.writeFileSync(fakeImg, '');
  const env = { ...process.env, APPIMAGE: fakeImg }; delete env.SLOPAMP_WAYLAND; delete env.SLOPAMP_DATA_DIR;
  const run = (pre = [], e = env) => execFileSync(pre.length ? pre[0] : path.join(ad, 'AppRun'), pre.length ? [...pre.slice(1), path.join(ad, 'AppRun'), 'song.mp3'] : ['song.mp3'], { env: e, encoding: 'utf8' });
  let o = run();
  const usernsHere = spawnSync('unshare', ['--user', '--map-root-user', 'true']).status === 0;
  ok(/args=--ozone-platform=x11 .*song\.mp3/.test(o) && (usernsHere ? !/no-sandbox/.test(o) : /--no-sandbox/.test(o)), `AppRun: X11, and the sandbox ${usernsHere ? 'kept on' : 'off'} as this process can${usernsHere ? '' : '’t'} use user namespaces (${o.split('\n')[0]})`);
  const restricted = fs.existsSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns') && fs.readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8').trim() === '1';
  const nested = !/^\s*0\s+0\s+4294967295\s*$/.test(fs.readFileSync('/proc/self/uid_map', 'utf8'));     // inside unshare -r (offline runs)
  if (restricted && !nested && spawnSync('aa-exec', ['-p', 'unconfined', 'true']).status === 0) {
    o = run(['aa-exec', '-p', 'unconfined', '--']);
    ok(/args=--ozone-platform=x11 --no-sandbox song\.mp3/.test(o) && /nosb=1/.test(o), 'AppRun started as the desktop does (unconfined, AppArmor restricting user namespaces): --no-sandbox and SLOPAMP_NO_SANDBOX=1');
  } else console.log('skip AppRun as the desktop starts it (this system doesn’t restrict user namespaces, or no aa-exec)');
  ok(!/args=--ozone/.test(run([], { ...env, SLOPAMP_WAYLAND: '1' })), 'AppRun: SLOPAMP_WAYLAND=1 leaves X11 out');
  ok(/data=\s*$/m.test(run()), 'AppRun: no "SlopAMP Data" folder: the usual ~/.config/SlopAMP');
  fs.mkdirSync(path.join(path.dirname(fakeImg), 'SlopAMP Data'));
  ok(run().includes(`data=${path.join(path.dirname(fakeImg), 'SlopAMP Data')}`), 'AppRun: a "SlopAMP Data" folder next to the AppImage is used');

  // ================= in the app
  const { app, win, errs } = await launch(path.join(T, 'home'));
  const ev = (f, a) => win.evaluate(f, a);
  await sleep(1500);
  for (let i = 0; i < 60 && !(await app.evaluate(() => global.__slopamp.server.encoder)); i++) await sleep(250);     // the encoder probe
  const m = await app.evaluate(({ globalShortcut }) => ({ ff: global.__slopamp.server.ffmpeg, enc: global.__slopamp.server.encoder, keys: ['MediaPlayPause', 'MediaNextTrack'].filter(k => globalShortcut.isRegistered(k)) }));
  ok(/vendor\/ffmpeg\/linux\/bin\/ffmpeg$/.test(m.ff), `FFmpeg from bin/ (${m.ff})`);
  // what this machine should get: VA-API where libva is new enough and a driver works, else Vulkan Video where it works,
  // else OpenH264 (NVENC on an NVIDIA machine comes first)
  const lva = vaapiUsable(m.ff);
  const vaapiHere = lva.ok && spawnSync('sh', ['-c', 'ls /dev/dri/renderD* >/dev/null 2>&1 && vainfo >/dev/null 2>&1']).status === 0;
  const vulkanHere = spawnSync(m.ff, ['-hide_banner', '-v', 'error', '-init_hw_device', 'vulkan=vk:0', '-filter_hw_device', 'vk', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:d=0.3', '-vf', 'format=nv12,hwupload', ...encoderArgs('h264_vulkan'), '-f', 'null', '-']).status === 0;
  const want = vaapiHere ? 'h264_vaapi' : vulkanHere ? 'h264_vulkan' : 'libopenh264';
  ok(m.enc === want || m.enc === 'h264_nvenc', `encoder: ${m.enc} (expected ${want}; libva ${lva.ok ? 'usable' : `not usable: ${lva.why}`}; Vulkan Video ${vulkanHere ? 'works' : 'doesn’t work'} here)`);
  const log = fs.readFileSync(path.join(T, 'home/.config/SlopAMP/slopamp.log'), 'utf8');
  ok(lva.ok || /video encoder: VA-API skipped: .*(older than libva 2\.21|no libva)/.test(log), `a libva FFmpeg can't use is never tried (the log: "${((/VA-API skipped: (.*)/.exec(log) || [])[1] || 'tried').slice(0, 90)}")`);
  // a 10-bit HEVC MKV, converted live by the chosen encoder (the player's /s/ stream)
  const hevc = path.join(T, 'hevc10.mkv');
  if (spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=4', '-f', 'lavfi', '-i', 'sine=f=440:d=4', '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-c:a', 'ac3', hevc]).status === 0) {
    const got = path.join(T, 'live.mp4');
    const r = await app.evaluate(async (_e, f) => {
      const p = await global.__slopamp.server.prepare(f, { forceTranscode: true });
      const url = p.streamUrl.replace('tc=0', 'tc=1');
      const t = Date.now(), res = await fetch(url), buf = Buffer.from(await res.arrayBuffer());
      return { mode: p.mode, url, data: buf.toString('base64'), ms: Date.now() - t, type: res.headers.get('content-type') };
    }, hevc);
    fs.writeFileSync(got, Buffer.from(r.data, 'base64'));
    const pr = JSON.parse(execFileSync(m.ff.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', got], { encoding: 'utf8' }));
    const v = pr.streams.find(x => x.codec_type === 'video'), au = pr.streams.find(x => x.codec_type === 'audio');
    ok(r.type === 'video/mp4' && v && v.codec_name === 'h264' && v.width === 1920 && au && au.codec_name === 'aac' && +pr.format.duration > 3.5,
      `a 10-bit HEVC + AC3 MKV plays as H.264 + AAC through ${m.enc}: ${v && v.codec_name} ${v && `${v.width}x${v.height}`}, ${au && au.codec_name}, ${(+pr.format.duration).toFixed(1)} s in ${r.ms} ms`);
    const line = (log + fs.readFileSync(path.join(T, 'home/.config/SlopAMP/slopamp.log'), 'utf8')).split('\n').reverse().find(l => /ffmpeg .*hevc10\.mkv/.test(l)) || '';
    ok(m.enc === 'h264_vulkan' ? /-init_hw_device vulkan=vk:\d -filter_hw_device vk .*format=nv12,hwupload -c:v h264_vulkan/.test(line)
      : m.enc === 'h264_vaapi' ? /-vaapi_device \/dev\/dri\/renderD\d+ .*format=nv12,hwupload -c:v h264_vaapi/.test(line) : /-c:v libopenh264/.test(line), 'the stream’s ffmpeg command has the encoder’s GPU and upload step');
  } else console.log('skip the live HEVC check (no ffmpeg with libx265 on PATH)');
  ok(m.keys.length === 0, 'no media keys grabbed (MPRIS through navigator.mediaSession)');
  const words = await ev(() => ({
    reset: WM.$('#setDirReset').textContent, quick: WM.$('#pQuick').title, bin: WM.$('.room-bin').textContent,
    tray: WM.$('#sysTray').closest('.set-row').querySelector('small').textContent, plat: window.phosphor.platform
  }));
  ok(words.plat === 'linux' && words.reset === 'Reset to Downloads/SlopAMP' && /Downloads\/SlopAMP\/Playlists/.test(words.quick) && /Trash/.test(words.bin) && !/Recycle/.test(words.bin), `Linux words in the page: "${words.reset}", "${words.bin.trim()}"`);
  ok(/system tray/.test(words.tray) && !/taskbar|clock/.test(words.tray), `the tray hint: "${words.tray}"`);
  await ev(() => { toast('Moved 2 files to the Recycle Bin. Saved in Downloads\\SlopAMP\\Converted.'); });
  const t = await app.evaluate(async ({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) { const x = await w.webContents.executeJavaScript('(document.getElementById("toast") || {}).textContent || ""').catch(() => ''); if (x) return x; } return ''; });
  ok(/Trash\. Saved in Downloads\/SlopAMP\/Converted\./.test(t), `a toast in Linux words: "${t}"`);
  const sys = await ev(() => window.phosphor.sysGet());
  const host = spawnSync('gdbus', ['call', '--session', '--dest', 'org.kde.StatusNotifierWatcher', '--object-path', '/StatusNotifierWatcher', '--method', 'org.freedesktop.DBus.Properties.Get', 'org.kde.StatusNotifierWatcher', 'IsStatusNotifierHostRegistered'], { encoding: 'utf8' }).stdout || '';
  ok(typeof sys.trayHost === 'boolean' && sys.trayHost === /true/.test(host), `the tray check: ${sys.trayHost} (D-Bus says ${host.trim() || 'no tray host'})`);
  await ev(() => openAbout()); await sleep(600);
  const about = await ev(() => ({ sys: WM.$('#aboutSys').textContent, hidden: WM.$('#aboutSys').classList.contains('hidden') }));
  ok(!about.hidden && /^Linux · from a checkout · Chromium sandbox OFF \(--no-sandbox\)$/.test(about.sys), `About: "${about.sys}"`);
  ok(!errs.length, `no errors in the windows ${JSON.stringify(errs.slice(0, 3))}`);
  await app.close();

  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL OK');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
