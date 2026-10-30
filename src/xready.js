'use strict';
// X-ready MP4s (2.5, idea #22): does a video file post to X as it is, and how "Fix for X" makes one that does.
//
// X takes MP4 / MOV with H.264 video (8-bit 4:2:0) + AAC audio, up to 1920×1200 (landscape) / 1200×1900
// (portrait), up to 60 fps on the web, about 25 Mb/s. Free accounts: 2:20 and 512 MB; X Premium: up to 4 h
// (web / iOS) and 16 GB. SlopAMP can't know the account, so length and size are warnings, never blocks.
// (X Help Center + spec pages, Oct 2026.)
const path = require('path');

const BOX = { land: [1920, 1200], port: [1200, 1900] };
const FREE_LEN = 140;                     // s (2:20)
const FREE_SIZE = 512 * 1024 * 1024;      // bytes
const MAX_FPS = 60;
const MAX_MBPS = 24;                      // under X's ~25 Mb/s

const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
const upper = (c) => String(c || '?').replace(/^h264$/, 'H.264').replace(/^hevc$/, 'HEVC').replace(/^av1$/, 'AV1').replace(/^vp9$/, 'VP9').replace(/^vp8$/, 'VP8').replace(/^aac$/, 'AAC').replace(/^opus$/, 'Opus').replace(/^mp3$/, 'MP3');

// The size a video gets for X: as it is when it fits, else scaled down to fit the box (even numbers).
function fitSize(w, h) {
  const [bw, bh] = w >= h ? BOX.land : BOX.port;
  if (w <= bw && h <= bh) return { w: even(w), h: even(h), scaled: w % 2 !== 0 || h % 2 !== 0 };
  const k = Math.min(bw / w, bh / h);
  return { w: even(w * k), h: even(h * k), scaled: true };
}

// info: media.js probe() result; size: bytes. null for a file without a picture (songs are never tagged).
function assess(info, size) {
  if (!info || !info.hasVideo || !info.video) return null;
  const v = info.video, a = info.audio;
  const fps = v.fps || 0;
  const fit = fitSize(v.width || 0, v.height || 0);
  const pix = /^(yuv420p|yuvj420p)$/.test(v.pixFmt || '');
  const container = /mp4|mov/.test(info.format || '');
  const videoOk = v.codec === 'h264' && pix && !fit.scaled && fps <= MAX_FPS + 0.5;
  const audioOk = !a || a.codec === 'aac';
  const why = [];
  if (v.codec !== 'h264') why.push(upper(v.codec));
  else if (!pix) why.push(`H.264 ${v.pixFmt || '?'}`);
  if (fit.scaled && v.codec === 'h264') why.push(`${v.width}×${v.height}`);
  if (fps > MAX_FPS + 0.5) why.push(`${Math.round(fps)} fps`);
  if (!audioOk) why.push(upper(a.codec));
  if (!container) why.push('not MP4');
  const dur = info.duration || 0;
  return {
    ready: container && videoOk && audioOk, videoOk, audioOk, container,
    codec: v.codec, audio: a ? a.codec : '', w: v.width || 0, h: v.height || 0, fps, duration: dur, size: size || 0,
    line: `${upper(v.codec)} · ${v.height || '?'}p${fps ? ` · ${Math.round(fps)} fps` : ''}${a ? ` · ${upper(a.codec)}` : ' · no sound'}`,
    why: why.join(' + '),
    long: dur > FREE_LEN, big: (size || 0) > FREE_SIZE
  };
}

// What Fix for X will make: { copyVideo, w, h, fps, line, estMB }
function plan(info, size) {
  const x = assess(info, size); if (!x) return null;
  const fit = fitSize(x.w, x.h);
  const fps = x.fps > MAX_FPS + 0.5 ? MAX_FPS : x.fps;
  const copyVideo = x.videoOk;
  const mbps = copyVideo ? 0 : Math.max(1.5, Math.min(MAX_MBPS, fit.w * fit.h / 1e6 * 4));
  const audioKbps = info.audio ? 160 : 0;
  const estMB = copyVideo ? (size || 0) / 1048576 : (x.duration * (mbps * 1000 + audioKbps)) / 8 / 1024;
  return { copyVideo, w: fit.w, h: fit.h, fps, mbps, estMB: Math.max(0.1, estMB),
    line: `H.264 · ${fit.w}×${fit.h}${fps ? ` · ${Math.round(fps)} fps` : ''}${info.audio ? ' · AAC 160 kbps' : ' · no sound'}${copyVideo ? ' (picture copied)' : ''}` };
}

// "<name> (X).mp4" next to the original (never over a file: " (X) (2).mp4" …)
function outName(file, exists) {
  const dir = path.dirname(file), base = path.basename(file).replace(/\.[^.]+$/, '');
  let p = path.join(dir, `${base} (X).mp4`), n = 2;
  while (exists(p)) p = path.join(dir, `${base} (X) (${n++}).mp4`);
  return p;
}

// ffmpeg arguments for Fix for X. va: the encoder's arguments (media.js encoderArgs), hw: a hardware encoder.
function ffArgs(info, size, input, output, va, hw) {
  const p = plan(info, size);
  const a = ['-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '0'];
  if (p.copyVideo) a.push('-c:v', 'copy');
  else {
    // 8-bit 4:2:0 out: yuv420p for OpenH264 / NVENC / AMF; Intel QSV takes nv12 (also 4:2:0), its own -pix_fmt
    const vf = [`scale=${p.w}:${p.h}:flags=bicubic`, ...(hw ? [] : ['format=yuv420p'])];
    a.push(...va.map(x => (x === '5M' ? `${p.mbps.toFixed(1)}M` : x)), '-vf', vf.join(','));
    if (info.video.fps > MAX_FPS + 0.5) a.push('-r', String(MAX_FPS));
    if (hw) a.push('-maxrate', `${MAX_MBPS}M`, '-bufsize', `${MAX_MBPS * 2}M`);
  }
  if (info.audio) a.push(...(info.audio.codec === 'aac' && p.copyVideo ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000']));
  a.push('-movflags', '+faststart', '-f', 'mp4', output);
  return a;
}

// The audio-only fix after a download (H.264 picture, Opus sound): copy the picture, AAC sound, same file name
function audioFixArgs(input, output) {
  return ['-i', input, '-map', '0:v:0', '-map', '0:a:0', '-map_metadata', '0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000', '-movflags', '+faststart', '-f', 'mp4', output];
}

module.exports = { assess, plan, outName, ffArgs, audioFixArgs, fitSize, FREE_LEN, FREE_SIZE, MAX_FPS };
