'use strict';
// YouTube downloads via yt-dlp (bundled, public domain) + the bundled FFmpeg.
// One download at a time; the rest wait in a queue. yt-dlp keeps itself
// current (`-U`, at most once a day) from a writable copy in the user data folder.

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

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
      execFile(this.exe, ['-U', '--update-to', 'stable'], { windowsHide: true, timeout: 90000 }, (err, stdout, stderr) => {
        this.log('yt-dlp update:', (stdout || '').trim().split('\n').pop(), err ? `(${(stderr || err.message).trim().split('\n').pop()})` : '');
        resolve();
      });
    });
    this.setState({ ytdlpUpdatedAt: Date.now() });
  }

  start(job) {
    // job: { id, url, kind: 'video'|'audio', quality: 'best'|'1080'|'720'|'480', title }
    if (this.active && this.active.id === job.id && this.active.kind === job.kind) return { ok: false, reason: 'busy' };
    if (this.queue.some(j => j.id === job.id && j.kind === job.kind)) return { ok: false, reason: 'queued' };
    this.queue.push(job);
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

  stopAll() {
    this.queue = [];
    if (this.active) { this.active.canceled = true; killTree(this.active.proc); }
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
      if (!res.ok && !job.canceled && /403|forbidden|sign in to confirm|po token|unable to download video data/i.test(res.error || '')) {
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
    const vid = m ? m[1] : null;
    const dirs = this.getDirs();
    const dir = job.kind === 'audio' ? dirs.audio : dirs.video;
    setTimeout(() => {
      try {
        for (const name of fs.readdirSync(dir)) {
          const mine = vid ? name.includes(`[${vid}]`) : false;
          if (mine && /(\.part|\.ytdl|\.temp|\.part-Frag\d+|\.f\d+\.\w+)$/i.test(name)) fs.rmSync(path.join(dir, name), { force: true });
        }
      } catch (_) {}
    }, 1500);
  }

  args(job, android) {
    const dirs = this.getDirs();
    const outDir = job.kind === 'audio' ? dirs.audio : dirs.video;
    fs.mkdirSync(outDir, { recursive: true });
    const a = [
      '--no-playlist', '--newline', '--progress', '--no-colors', '--encoding', 'utf-8', '--windows-filenames',
      '--no-mtime', '--ffmpeg-location', this.ffmpegDir,
      '-P', outDir, '-o', '%(title).150B [%(id)s].%(ext)s',
      '--progress-template', 'download:PHOSPCT %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
      '--print', 'after_move:PHOSFILE %(filepath)s',
      // never record a stream that is still live; report its status so we can explain why
      '--print', 'pre_process:PHOSSTATUS %(live_status)s',
      '--match-filter', '!is_live & live_status!=?is_upcoming'
    ];
    if (this.jsRuntime && this.jsRuntime.path) a.push('--js-runtimes', `node:${this.jsRuntime.path}`);
    if (android) a.push('--extractor-args', 'youtube:player_client=android');
    if (job.kind === 'audio') {
      a.push('-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0', '--embed-metadata');
    } else {
      const sort = job.quality && job.quality !== 'best' ? `res:${job.quality},fps,vcodec:h264,acodec:m4a` : 'res,fps,vcodec:h264,acodec:m4a';
      a.push('-f', 'bv*+ba/b', '-S', sort, '--merge-output-format', 'mp4', '--remux-video', 'webm>mp4', '--embed-metadata');
    }
    a.push(job.url);
    return a;
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

function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
  else { try { proc.kill('SIGKILL'); } catch (_) {} }
}

function friendlyError(msg) {
  const m = String(msg || '');
  if (/private video|video unavailable|has been removed|no longer available/i.test(m)) return 'This video is private, removed or unavailable.';
  if (/sign in to confirm your age|age.restricted|inappropriate/i.test(m)) return 'This video is age-restricted and needs a signed-in account.';
  if (/members.only|join this channel/i.test(m)) return 'This is a members-only video.';
  if (/live event|premiere|is live|is_live/i.test(m)) return 'Live streams can’t be downloaded until they end.';
  if (/getaddrinfo|network|timed out|connection/i.test(m)) return 'Network problem — check your internet connection.';
  if (/403|forbidden/i.test(m)) return 'YouTube blocked the download (403). Try again later.';
  if (/space|errno 28/i.test(m)) return 'Not enough disk space.';
  const last = m.trim().split('\n').filter(l => /ERROR/.test(l)).pop() || m.trim().split('\n').pop() || 'Unknown error';
  return last.replace(/^ERROR:\s*/, '').replace(/\[youtube\]\s*[\w-]+:\s*/, '').slice(0, 240);
}

module.exports = { Downloader };
