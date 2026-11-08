#!/usr/bin/env node
// A stand-in yt-dlp for tests/x-streaming.js (X can't be reached from the test machine). It answers only what
// SlopAMP's X streaming asks (-j for one post's video link), following $HOME/fake-x.json:
//   { "base": "http://127.0.0.1:<port>", "posts": { "<post id>": { "mode": "ok" | "fail" | "failonce" | "gif",
//     "file": "<name served by the test's video server>", "delay": ms, "error": "yt-dlp's message", "height": 720 } } }
// Every call is logged to $HOME/fake-x.log (one JSON line: post id, args).
// 2.9.1: a post (or YouTube video id) with "size" (bytes; "nosize": -j can't say, "realSize": what the download
// really writes) answers the size check, and a download writes a sparse file that big and prints PHOSFILE.
'use strict';
const fs = require('fs'), path = require('path');
const H = process.env.HOME || '.';
const args = process.argv.slice(2);
const url = args[args.length - 1] || '';
const id = (/\/status\/(\d+)/.exec(url) || /[?&]v=([\w-]{11})/.exec(url) || [])[1] || '';
const cfg = JSON.parse(fs.readFileSync(path.join(H, 'fake-x.json'), 'utf8'));
const logF = path.join(H, 'fake-x.log');
fs.appendFileSync(logF, JSON.stringify({ id, args }) + '\n');
const calls = fs.readFileSync(logF, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(c => c.id === id).length;
const p = (cfg.posts || {})[id] || { mode: 'fail', error: `ERROR: [twitter] ${id}: No video could be found in this tweet` };
const fail = (msg) => { process.stderr.write(`${msg}\n`); process.exit(1); };
setTimeout(() => {
  // 2.9.1: a YouTube item (posts with "size"): -j answers its size; a download writes a file that big (sparse)
  if (p.size || p.nosize) {
    const audio = args.includes('-x') || (args.includes('-f') && args[args.indexOf('-f') + 1] === 'ba/b');
    if (args.includes('-j')) {
      const j = { id, title: p.title || id, duration: p.duration || 0, ext: 'mp4' };
      if (!p.nosize && !audio) j.requested_formats = [{ format_id: '137', filesize: Math.round(p.size * 0.9) }, { format_id: '140', filesize_approx: Math.round(p.size * 0.1) }];
      process.stdout.write(JSON.stringify(j) + '\n'); process.exit(0);
    }
    const dir = args[args.indexOf('-P') + 1], tpl = args[args.indexOf('-o') + 1];
    const name = tpl.replace('%(title).150B', p.title || id).replace('%(id)s', id).replace('%(ext)s', audio ? 'mp3' : 'mp4');
    const f = path.join(dir, name);
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, ''); fs.truncateSync(f, Math.round(p.realSize || p.size || 1000000));
    process.stdout.write(`PHOSFILE ${f}\n`); process.exit(0);
  }
  if (!args.includes('-j')) fail('ERROR: the fake yt-dlp only answers -j');
  if (p.mode === 'fail' || (p.mode === 'failonce' && calls === 1)) fail(p.error || `ERROR: [twitter] ${id}: Something odd happened`);
  const gif = p.mode === 'gif';
  const file = encodeURIComponent(p.file || (gif ? 'gif.mp4' : 'clip90.mp4'));
  const u = `${cfg.base}/${gif ? 'tweet_video' : 'ext_tw_video'}/${id}/${file}?g=${calls}`;
  const n = +(args[args.indexOf('--playlist-items') + 1] || 1);
  process.stdout.write(JSON.stringify({
    id, title: p.title || `someone - post ${id}${n > 1 ? ` (video ${n})` : ''}`, url: u, ext: 'mp4', protocol: 'https',
    format_id: gif ? 'http-gif' : `http-${p.tbr || 2176}`, height: gif ? 270 : (p.height || 720), width: gif ? 480 : 1280,
    duration: gif ? undefined : (p.duration || 0), tbr: p.tbr || 2176, asr: gif ? undefined : 44100,
    http_headers: { 'User-Agent': 'Mozilla/5.0 (fake)', Accept: '*/*', 'Sec-Fetch-Mode': 'navigate' }
  }) + '\n');
  process.exit(0);
}, p.delay || 50);
