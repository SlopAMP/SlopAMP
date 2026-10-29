'use strict';
// YouTube downloads via yt-dlp (bundled, public domain) + the bundled FFmpeg.
// One download at a time; the rest wait in a queue. yt-dlp keeps itself
// current (`-U`, at most once a day) from a writable copy in the user data folder.
// Also used by SLOP (main.js): the song's audio as it comes from YouTube (kind 'slopsong', goes to the
// front of the queue; clips are then cut from it on the PC), and right away, outside the queue: one
// still frame (frame()), a short silent video (motion()), the video's details (info()) and captions (subs()).

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync, execFile } = require('child_process');

const EXE = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const UPDATE_EVERY_MS = 24 * 3600 * 1000;

class Downloader {
  constructor({ bundledDir, dataDir, ffmpegDir, jsRuntime, log, emit, getDirs, getState, setState }) {
    this.bundled = path.join(bundledDir, EXE);
    this.toolsDir = path.join(dataDir, 'tools');
    this.exe = path.join(this.toolsDir, EXE);
    this.ffmpegDir = ffmpegDir;
    this.jsRuntime = jsRuntime;        // { path, env } used as yt-dlp's JavaScript runtime
    this.log = log; this.emit = emit; this.getDirs = getDirs; this.getState = getState; this.setState = setState;
    this.queue = [];
    this.active = null;
  }

  available() { return fs.existsSync(this.exe) || fs.existsSync(this.bundled); }

  ensureExe() {
    if (fs.existsSync(this.exe)) return this.exe;
    if (!fs.existsSync(this.bundled)) return null;
    fs.mkdirSync(this.toolsDir, { recursive: true });
    fs.copyFileSync(this.bundled, this.exe);
    return this.exe;
  }

  async maybeUpdate(force) {
    const st = this.getState();
    if (!force && st.ytdlpUpdatedAt && Date.now() - st.ytdlpUpdatedAt < UPDATE_EVERY_MS) return;
    await new Promise((resolve) => {
      this.updating = execFile(this.exe, ['-U', '--update-to', 'stable'], { windowsHide: true, timeout: 90000 }, (err, stdout, stderr) => {
        this.updating = null;
        this.log('yt-dlp update:', (stdout || '').trim().split('\n').pop(), err ? `(${(stderr || err.message).trim().split('\n').pop()})` : '');
        resolve();
      });
    });
    this.setState({ ytdlpUpdatedAt: Date.now() });
  }

  start(job) {
    // job: { id, url, kind: 'video'|'audio', quality: 'best'|'1080'|'720'|'480', title }
    //   or { id, url, kind: 'slopsong', dir, section: [start, end] | null, title }: the audio track as YouTube
    //      sends it (no conversion), as dir/song.<ext>; `section` only fetches that part (long videos)
    if (this.active && this.active.id === job.id && this.active.kind === job.kind) return { ok: false, reason: 'busy' };
    if (this.queue.some(j => j.id === job.id && j.kind === job.kind)) return { ok: false, reason: 'queued' };
    if (job.kind === 'slopsong') this.queue.unshift(job); else this.queue.push(job);   // someone is waiting for it in SLOP
    this.emit({ id: job.id, kind: job.kind, title: job.title, status: 'queued', queued: this.queue.length });
    this.pump();
    return { ok: true };
  }

  cancel(id) {
    const before = this.queue.length;
    this.queue = this.queue.filter(j => j.id !== id);
    if (this.queue.length !== before) this.emit({ id, status: 'canceled' });
    if (this.active && this.active.id === id) {
      this.active.canceled = true;
      killTree(this.active.proc);
    }
  }

  // quitting: wait for the kill to finish, so no yt-dlp (or its JavaScript runtime, which is SlopAMP.exe) outlives the app.
  stopAll(quitting) {
    this.queue = [];
    if (this.active) { this.active.canceled = true; killTree(this.active.proc, quitting); }
    if (this.updating) killTree(this.updating, quitting);
  }

  async pump() {
    if (this.active || !this.queue.length) return;
    const job = this.queue.shift();
    this.active = job;
    try {
      if (!this.ensureExe()) throw new Error('The downloader (yt-dlp) is missing from this copy of SlopAMP.');
      this.emit({ id: job.id, kind: job.kind, title: job.title, status: 'updating' });
      await this.maybeUpdate(false);
      if (job.canceled) throw Object.assign(new Error('canceled'), { canceled: true });
      let res = await this.run(job, false);
      // yt-dlp finished without a file and without an error: our live filter skipped it
      if (!res.ok && !job.canceled && /exited with code 0$/.test((res.error || '').trim()) && !/^is_upcoming$/.test(job.liveStatus || '')) job.liveStatus = 'is_live';
      if (!res.ok && !job.canceled && /^is_(live|upcoming)$/.test(job.liveStatus || '')) {
        this.emit({ id: job.id, kind: job.kind, title: job.title, status: 'error', live: job.liveStatus === 'is_live', error: job.liveStatus === 'is_live' ? 'Live streams can’t be downloaded until they end.' : 'This premiere hasn’t started yet — try again after it airs.' });
        return;
      }
      if (!res.ok && !job.canceled && !job.x && /403|forbidden|sign in to confirm|po token|unable to download video data/i.test(res.error || '')) {   // YouTube only
        this.log('retrying with android client');
        this.emit({ id: job.id, kind: job.kind, title: job.title, status: 'downloading', pct: 0, note: 'retrying' });
        res = await this.run(job, true);
      }
      if (!res.ok && !job.canceled && /update|outdated|unsupported|nsig|signature/i.test(res.error || '')) {
        this.emit({ id: job.id, kind: job.kind, title: job.title, status: 'updating' });
        await this.maybeUpdate(true);
        res = await this.run(job, false);
      }
      if (job.canceled) { this.cleanupPartials(job); this.emit({ id: job.id, kind: job.kind, status: 'canceled' }); }
      else if (res.ok) this.emit({ id: job.id, vid: job.vid, kind: job.kind, title: job.title, status: 'done', file: res.file });
      else this.emit({ id: job.id, kind: job.kind, title: job.title, status: 'error', error: friendlyError(res.error) });
    } catch (e) {
      if (e.canceled) this.cleanupPartials(job);
      this.emit({ id: job.id, kind: job.kind, title: job.title, status: e.canceled ? 'canceled' : 'error', error: e.canceled ? '' : friendlyError(e.message) });
    } finally {
      this.active = null;
      this.pump();
    }
  }

  // Remove leftover partial files of a canceled download (named "... [VIDEOID].ext.part" etc).
  cleanupPartials(job) {
    const m = /(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([\w-]{11})/.exec(job.url);
    const vid = job.x ? job.vid : m ? m[1] : null;
    const dirs = this.getDirs();
    const dir = job.kind === 'slopsong' ? job.dir : job.kind === 'audio' ? dirs.audio : dirs.video;
    setTimeout(() => {
      try {
        for (const name of fs.readdirSync(dir)) {
          const mine = job.kind === 'slopsong' ? /^song\./.test(name) : vid ? name.includes(`[${vid}]`) : false;
          if (mine && /(\.part|\.ytdl|\.temp|\.part-Frag\d+|\.f\d+\.\w+)$/i.test(name)) fs.rmSync(path.join(dir, name), { force: true });
        }
      } catch (_) {}
    }, 1500);
  }

  // Options every yt-dlp call needs: quiet machine-readable output, our FFmpeg and JavaScript runtime.
  baseArgs(android) {
    const a = ['--no-playlist', '--no-colors', '--encoding', 'utf-8', '--ffmpeg-location', this.ffmpegDir];
    if (this.jsRuntime && this.jsRuntime.path) a.push('--js-runtimes', `node:${this.jsRuntime.path}`);
    if (android) a.push('--extractor-args', 'youtube:player_client=android');
    return a;
  }

  args(job, android) {
    const dirs = this.getDirs();
    const slop = job.kind === 'slopsong';
    const outDir = slop ? job.dir : job.kind === 'audio' ? dirs.audio : dirs.video;
    fs.mkdirSync(outDir, { recursive: true });
    const a = [
      ...this.baseArgs(android), '--newline', '--progress', '--windows-filenames', '--no-mtime',
      // X: SlopAMP's own key in the name ("[x<post id>]"), whatever id yt-dlp gives the post's video
      '-P', outDir, '-o', slop ? 'song.%(ext)s' : job.x ? `%(title).150B [${job.vid}].%(ext)s` : '%(title).150B [%(id)s].%(ext)s',
      '--progress-template', 'download:PHOSPCT %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
      '--print', 'after_move:PHOSFILE %(filepath)s',
      // never record a stream that is still live; report its status so we can explain why
      '--print', 'pre_process:PHOSSTATUS %(live_status)s',
      '--match-filter', '!is_live & live_status!=?is_upcoming'
    ];
    if (slop) {
      // the best audio track, unconverted (SLOP cuts and converts it locally); a long video: just a section
      a.push('-f', 'ba/b', '--force-overwrites');
      if (job.section) a.push('--download-sections', `*${job.section[0]}-${job.section[1]}`);
    } else if (job.kind === 'audio') {
      a.push('-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0', '--embed-metadata');
    } else {
      const sort = job.quality && job.quality !== 'best' ? `res:${job.quality},fps,vcodec:h264,acodec:m4a` : 'res,fps,vcodec:h264,acodec:m4a';
      a.push('-f', 'bv*+ba/b', '-S', sort, '--merge-output-format', 'mp4', '--remux-video', 'webm>mp4', '--embed-metadata');
    }
    // an X post can hold several videos: take the one the link names (".../video/2"), else the first
    if (job.x) a.push('--playlist-items', String(Math.max(1, +((/\/video\/(\d+)$/.exec(job.url) || [])[1] || 1))));
    a.push(job.url);
    return a;
  }

  // Slop: one still frame at `t` seconds, straight from the video (up to 1080p, no player buttons or
  // overlays), saved as `file` (PNG). First the same route as the Slop audio clip, which is known to work
  // with YouTube: yt-dlp fetches one second of the video from t (`--download-sections`, stream copy, no
  // re-encoding) and FFmpeg takes its first frame, which is exactly t. If that fails, FFmpeg reads the
  // frame straight from the stream URL (the 1.5.0 way). Then both again with the android client.
  // Resolves { ok: true, file } or { ok: false, error, detail } (error is for people, detail for the log).
  async frame({ url, t, file }) {
    if (!this.ensureExe()) return { ok: false, error: 'The downloader (yt-dlp) is missing from this copy of SlopAMP.' };
    t = Math.max(0, Math.round(t * 1000) / 1000);
    const dir = path.dirname(file), stem = path.basename(file, '.png') + '-src', tmp = file + '.part.png';
    const ff = path.join(this.ffmpegDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    const fmt = ['-f', 'bv*[height<=1080]/b[height<=1080]/bv*/b', '-S', 'res:1080,vcodec:h264'];
    const why = (r) => { const l = (r.stderr || '').trim().split('\n').filter(Boolean); return (l.filter(x => /ERROR/.test(x)).pop() || l.pop() || `exit ${r.code}${r.timedOut ? ' (timed out)' : ''}`).slice(0, 300); };
    const clean = () => { try { for (const f of fs.readdirSync(dir)) if (f.startsWith(stem + '.') || f === path.basename(tmp)) fs.rmSync(path.join(dir, f), { force: true }); } catch (_) {} };
    const keep = (how) => { try { fs.renameSync(tmp, file); } catch (e) { return { ok: false, error: e.message, detail: e.message }; } clean(); return { ok: true, file, how }; };
    const tries = [];
    for (const android of [false, true]) {
      const who = android ? ' (android)' : '';
      // 1) one second of the video, fetched by yt-dlp
      const r = await this.exec(this.exe, [...this.baseArgs(android), ...fmt, '--download-sections', `*${t}-${t + 1}`, '--force-overwrites',
        '-P', dir, '-o', `${stem}.%(ext)s`, '--print', 'after_move:PHOSFILE %(filepath)s', url], 120000);
      const src = ((/PHOSFILE (.+)/.exec(r.stdout) || [])[1] || '').trim();
      if (r.code === 0 && src && fs.existsSync(src)) {
        const x = await this.exec(ff, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-frames:v', '1', '-an', tmp], 30000);
        if (x.code === 0 && fs.existsSync(tmp)) return keep('clip' + who);
        tries.push(`frame from clip${who}: ${why(x)}`);
      } else tries.push(`clip${who}: ${why(r)}`);
      clean();
      // 2) FFmpeg straight from the stream URL
      const info = await this.exec(this.exe, [...this.baseArgs(android), ...fmt, '--print', '%(url)s', '--print', '%(http_headers)j', url], 60000);
      const [streamUrl, headersJson] = (info.stdout || '').trim().split(/\r?\n/);
      if (info.code !== 0 || !/^https?:/.test(streamUrl || '')) { tries.push(`stream url${who}: ${why(info)}`); continue; }
      let headers = '';
      try { for (const [k, v] of Object.entries(JSON.parse(headersJson || '{}'))) headers += `${k}: ${v}\r\n`; } catch (_) {}
      const d = await this.exec(ff, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...(headers ? ['-headers', headers] : []),
        '-ss', String(t), '-i', streamUrl, '-frames:v', '1', '-an', tmp], 60000);
      if (d.code === 0 && fs.existsSync(tmp)) return keep('stream' + who);
      tries.push(`stream${who}: ${why(d)}`);
      clean();
    }
    this.log('slop frame failed:', tries.join(' | '));
    return { ok: false, error: friendlyError(tries.join('\n')), detail: tries.join(' | ') };
  }

  // SLOP: a short silent video (motion reference) of `len` seconds from `start`, up to 1080p, as `file`
  // (H.264 MP4). yt-dlp fetches that section without re-encoding (it starts exactly at `start`, see
  // frame()), then FFmpeg re-encodes just those seconds so every player and uploader takes it.
  async motion({ url, start, len, file }) {
    if (!this.ensureExe()) return { ok: false, error: 'The downloader (yt-dlp) is missing from this copy of SlopAMP.' };
    start = Math.max(0, Math.round(start * 1000) / 1000); len = Math.max(1, Math.min(10, len));
    const dir = path.dirname(file), stem = 'motion-src', tmp = file + '.part.mp4';
    const ff = path.join(this.ffmpegDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    const clean = () => { try { for (const f of fs.readdirSync(dir)) if (f.startsWith(stem + '.')) fs.rmSync(path.join(dir, f), { force: true }); fs.rmSync(tmp, { force: true }); } catch (_) {} };
    const why = (r) => { const l = (r.stderr || '').trim().split('\n').filter(Boolean); return (l.filter(x => /ERROR|Error/.test(x)).pop() || l.pop() || `exit ${r.code}`).slice(0, 300); };
    let last = '';
    for (const android of [false, true]) {
      const r = await this.exec(this.exe, [...this.baseArgs(android), '-f', 'bv*[height<=1080]/b[height<=1080]/bv*/b', '-S', 'res:1080,vcodec:h264',
        '--download-sections', `*${start}-${start + len}`, '--force-overwrites', '-P', dir, '-o', `${stem}.%(ext)s`, '--print', 'after_move:PHOSFILE %(filepath)s', url], 180000);
      const src = ((/PHOSFILE (.+)/.exec(r.stdout) || [])[1] || '').trim();
      if (r.code !== 0 || !src || !fs.existsSync(src)) { last = `clip: ${why(r)}`; clean(); continue; }
      // the bundled FFmpeg is the LGPL build: OpenH264 is its H.264 encoder (libx264 / MPEG-4 as fallbacks)
      for (const enc of [['-c:v', 'libopenh264', '-b:v', '8M'], ['-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast'], ['-c:v', 'mpeg4', '-q:v', '2']]) {
        const x = await this.exec(ff, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-t', String(len), '-an', ...enc,
          '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmp], 120000);
        if (x.code === 0 && fs.existsSync(tmp)) {
          try { fs.renameSync(tmp, file); } catch (e) { clean(); return { ok: false, error: e.message }; }
          clean();
          return { ok: true, file, codec: enc[1] };
        }
        last = `encode ${enc[1]}: ${why(x)}`;
      }
      clean();
    }
    this.log('slop motion failed:', last);
    return { ok: false, error: friendlyError(last), detail: last };
  }

  // SLOP: the video's title, description, channel, duration and language (small: only those fields).
  async info(url) {
    if (!this.ensureExe()) return null;
    const r = await this.exec(this.exe, [...this.baseArgs(false), '--skip-download', '--print', '%(.{id,title,description,channel,uploader,duration,language})j', url], 90000);
    try { return r.code === 0 ? JSON.parse(r.stdout.trim().split('\n').pop()) : null; } catch (_) { return null; }
  }

  // SLOP: the captions as WebVTT into dir/subs.<lang>.vtt: real subtitles if the video has them, else
  // YouTube's automatic ones. English first, then the video's own language. Resolves the file or null.
  async subs(url, dir, lang) {
    if (!this.ensureExe()) return null;
    const langs = ['en.*,en', lang && !/^en/.test(lang) ? `${lang}.*,${lang}` : null, '.*-orig'].filter(Boolean);
    for (const l of langs) {
      const r = await this.exec(this.exe, [...this.baseArgs(false), '--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', `${l},-live_chat`,
        '--sub-format', 'vtt/best', '--convert-subs', 'vtt', '-P', dir, '-o', 'subs.%(ext)s', url], 90000);
      let files = [];
      try { files = fs.readdirSync(dir).filter(f => /^subs\..+\.vtt$/.test(f)); } catch (_) {}
      if (files.length) return path.join(dir, files.sort((a, b) => a.length - b.length)[0]);
      if (r.code !== 0 && /ERROR/.test(r.stderr || '')) this.log('slop captions:', (r.stderr || '').trim().split('\n').pop());
    }
    return null;
  }

  // Run a tool and collect its output; on timeout the whole process tree is stopped (yt-dlp starts FFmpeg).
  exec(file, args, timeout) {
    return new Promise((resolve) => {
      const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...(this.jsRuntime ? this.jsRuntime.env : {}) };
      let stdout = '', stderr = '', timedOut = false, proc;
      try { proc = spawn(file, args, { windowsHide: true, env }); } catch (e) { resolve({ code: 1, stdout: '', stderr: e.message }); return; }
      const timer = setTimeout(() => { timedOut = true; killTree(proc); }, timeout);
      proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8');
      proc.stdout.on('data', (d) => { if (stdout.length < 1e6) stdout += d; });
      proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-8000); });
      proc.on('error', (e) => { clearTimeout(timer); resolve({ code: 1, stdout, stderr: stderr + e.message }); });
      proc.on('close', (code) => { clearTimeout(timer); resolve({ code: timedOut ? 1 : code, stdout, stderr, timedOut }); });
    });
  }

  run(job, android) {
    return new Promise((resolve) => {
      const args = this.args(job, android);
      this.log('yt-dlp', args.join(' '));
      const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...(this.jsRuntime ? this.jsRuntime.env : {}) };
      const proc = spawn(this.exe, args, { windowsHide: true, env });
      job.proc = proc;
      let file = null, errTail = '', outBuf = '', errBuf = '', phase = 'downloading', part = 0, lastPct = 0;
      const onLine = (line) => {
        line = line.trim(); if (!line) return;
        if (line.startsWith('PHOSPCT ')) {
          const [p, speed, eta] = line.slice(8).split('|').map(s => s.trim());
          const pct = parseFloat(p) || 0;
          if (pct < lastPct - 50) part++;   // a second stream (audio) started
          lastPct = pct;
          this.emit({ id: job.id, kind: job.kind, title: job.title, status: 'downloading', pct, speed: /unknown|^n\/?a$/i.test(speed || '') ? '' : speed.replace(/iB\/s$/, 'B/s'), eta: /unknown|^n\/?a$/i.test(eta || '') ? '' : eta.replace(/^00:/, '0:'), part });
        } else if (line.startsWith('PHOSSTATUS ')) {
          job.liveStatus = line.slice(11).trim();
        } else if (line.startsWith('PHOSFILE ')) {
          file = line.slice(9).trim();
        } else if (/^\[(Merger|ExtractAudio|VideoRemuxer|Metadata|FixupM3u8|VideoConvertor)\]/.test(line)) {
          if (phase !== 'processing') { phase = 'processing'; this.emit({ id: job.id, kind: job.kind, title: job.title, status: 'processing' }); }
        } else if (/ERROR|WARNING/.test(line)) {
          errTail = (errTail + '\n' + line).slice(-2000);
        }
      };
      const feed = (d) => { outBuf += d; let i; while ((i = outBuf.indexOf('\n')) >= 0) { onLine(outBuf.slice(0, i)); outBuf = outBuf.slice(i + 1); } };
      proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8');
      proc.stdout.on('data', feed);
      proc.stderr.on('data', (d) => {
        errTail = (errTail + d).slice(-2000);
        errBuf += d; let i; while ((i = errBuf.indexOf('\n')) >= 0) { const l = errBuf.slice(0, i); errBuf = errBuf.slice(i + 1); if (/^(PHOSPCT|PHOSFILE|\[(Merger|ExtractAudio|VideoRemuxer))/.test(l.trim())) onLine(l); }
      });
      proc.on('error', (e) => resolve({ ok: false, error: e.message }));
      proc.on('close', (code) => {
        if (outBuf) onLine(outBuf);
        this.log('yt-dlp exit', code, errTail.trim().split('\n').slice(-3).join(' | '));
        if (code === 0 && file && fs.existsSync(file)) resolve({ ok: true, file });
        else resolve({ ok: false, error: errTail || `yt-dlp exited with code ${code}` });
      });
    });
  }
}

function killTree(proc, sync) {
  if (!proc || proc.exitCode !== null) return;
  const args = ['/pid', String(proc.pid), '/T', '/F'];
  if (process.platform === 'win32' && sync) spawnSync('taskkill', args, { windowsHide: true, timeout: 5000 });
  else if (process.platform === 'win32') spawn('taskkill', args, { windowsHide: true });
  else { try { proc.kill('SIGKILL'); } catch (_) {} }
}

function friendlyError(msg) {
  const m = String(msg || '');
  // X (2.1)
  if (/no video could be found in this (tweet|post)|no video formats found.*twitter|\[twitter\][^\n]*no video/i.test(m)) return 'This X post has no video.';
  if (/\[twitter\][^\n]*(nsfw|age.restricted|log ?in|logged in|authenticat|cookies)/i.test(m)) return 'X only shows this video to signed-in accounts. Use Play on X instead.';
  if (/\[twitter\][^\n]*(suspended|does not exist|not found|unavailable|deleted|protected|private)/i.test(m)) return 'This X post was deleted, is private, or isn’t available.';
  if (/\[twitter\][^\n]*(rate.?limit|429|too many requests)/i.test(m)) return 'X is limiting downloads right now. Try again in a few minutes.';
  if (/private video|video unavailable|has been removed|no longer available/i.test(m)) return 'This video is private, removed or unavailable.';
  if (/sign in to confirm your age|age.restricted|inappropriate/i.test(m)) return 'This video is age-restricted and needs a signed-in account.';
  if (/members.only|join this channel/i.test(m)) return 'This is a members-only video.';
  if (/live event|premiere|is live|is_live/i.test(m)) return 'Live streams can’t be downloaded until they end.';
  if (/getaddrinfo|network|timed out|connection/i.test(m)) return 'Network problem — check your internet connection.';
  if (/403|forbidden/i.test(m)) return /\[twitter\]/i.test(m) ? 'X blocked the download (403). Try again later.' : 'YouTube blocked the download (403). Try again later.';
  if (/space|errno 28/i.test(m)) return 'Not enough disk space.';
  const last = m.trim().split('\n').filter(l => /ERROR/.test(l)).pop() || m.trim().split('\n').pop() || 'Unknown error';
  return last.replace(/^ERROR:\s*/, '').replace(/\[(youtube|twitter)\]\s*[\w-]+:\s*/, '').slice(0, 240);
}

module.exports = { Downloader };
