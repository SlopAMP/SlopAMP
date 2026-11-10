// 2.9.5: X's limits (src/renderer/xlimits.js, the one place they're kept) and the For X math: what's over, by how much,
// for Free / Premium (and Premium's 10 minutes in X's Android app), GIFs (15 MB web / 5 MB phones), how long a piece fits
// under a size, and the bitrate that lands a file under a size. Plain Node, no Electron: node tests/xlimits-295.js
'use strict';
const X = require('../src/renderer/xlimits');
const XR = require('../src/xready');
const { Clipper } = require('../src/clip');
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
const MB = 1048576, GB = 1024 * MB, L = X.LIMITS;
const whats = (a) => a.map(x => x.what).join(',');

// ---- the numbers, in one place
ok(L.free.sec === 140 && L.free.bytes === 512 * MB, 'Free: 2:20 and 512 MB');
ok(L.premium.sec === 4 * 3600 && L.premium.bytes === 16 * GB && L.premium.androidSec === 600, 'Premium: 4 h and 16 GB (web, iPhone); 10 min in the Android app');
ok(L.gif.web === 15 * MB && L.gif.phone === 5 * MB, 'GIFs: 15 MB on the web, 5 MB on phones');
ok(XR.FREE_LEN === L.free.sec && XR.FREE_SIZE === L.free.bytes && XR.MAX_FPS === L.video.fps, 'xready.js (Fix for X, the X tags) reads the same numbers');
ok(JSON.stringify(XR.fitSize(3840, 2160)) === '{"w":1920,"h":1080,"scaled":true}' && JSON.stringify(XR.fitSize(1080, 1920)) === '{"w":1068,"h":1900,"scaled":true}', 'X\'s picture box comes from there too (4K → 1920×1080, 1080×1920 → 1068×1900)');

// ---- Free
ok(X.checkVideo('free', 140, 512 * MB).length === 0, 'Free: exactly 2:20 and 512 MB fits');
let r = X.checkVideo('free', 252, 612 * MB);
ok(whats(r) === 'length,size' && r[0].over === 112 && r[1].over === 100 * MB, `Free: 4:12 and 612 MB are over by 1:52 and 100 MB ${JSON.stringify(r.map(x => x.over))}`);
ok(r[0].text === '4:12 is 1:52 over the 2:20 X allows on Free' && r[1].text === 'about 612 MB is 100 MB over the 512 MB X allows on Free', `the words: "${r[0].text}" / "${r[1].text}"`);
r = X.checkVideo('free', 140.04, 0); ok(!r.length, 'a hair over 2:20 (rounding) still fits');
r = X.checkVideo('free', 141, 0); ok(whats(r) === 'length' && r[0].text === '2:21 is 0:01 over the 2:20 X allows on Free', `one second over: "${r[0] && r[0].text}"`);
ok(whats(X.checkVideo(undefined, 200, 0)) === 'length' && whats(X.checkVideo('nonsense', 200, 0)) === 'length', 'no account set (or a bad value) counts as Free');

// ---- Premium
ok(X.checkVideo('premium', 252, 612 * MB).length === 0, 'Premium: 4:12 and 612 MB fit');
r = X.checkVideo('premium', 750, 2 * GB);
ok(whats(r) === 'android' && r[0].over === 150 && r[0].text === "12:30 is 2:30 over the 10:00 X's Android app takes (fine on the web and iPhone)", `Premium 12:30: only the Android app note "${r[0] && r[0].text}"`);
r = X.checkVideo('premium', 600, 0); ok(!r.length, 'Premium: exactly 10:00 fits the Android app');
r = X.checkVideo('premium', 4 * 3600 + 90, 17 * GB);
ok(whats(r) === 'length,size' && r[0].text === '4:01:30 is 1:30 over the 4:00:00 X allows on Premium' && r[1].text === 'about 17 GB is 1 GB over the 16 GB X allows on Premium', `Premium over 4 h and 16 GB: "${r.map(x => x.text).join(' / ')}"`);

// ---- GIFs
ok(!X.checkGif(5 * MB).length, 'GIF: 5 MB fits everywhere');
r = X.checkGif(7 * MB); ok(whats(r) === 'gif-phone' && r[0].over === 2 * MB && /fine on X's website, but 2 MB over the 5 MB its phone apps take/.test(r[0].text), `GIF 7 MB: the phone note "${r[0] && r[0].text}"`);
r = X.checkGif(20 * MB); ok(whats(r) === 'gif-web' && r[0].over === 5 * MB && r[0].text === 'about 20 MB is 5 MB over the 15 MB X takes for a GIF (phones take 5 MB)', `GIF 20 MB: over the web limit "${r[0] && r[0].text}"`);

// ---- the fixes' math
ok(X.secForBytes(15 * MB, 1 * MB) === 14.5, 'trim a 1 MB/s GIF to fit 15 MB: 14.5 s (3% to spare)');
ok(X.secForBytes(5 * MB, 0) === 0, 'no rate known: nothing to trim to');
const k = X.kbpsForBytes(512 * MB, 600, 192);
ok(k === Math.floor(512 * MB * 0.97 * 8 / 1000 / 600 - 192) && (k + 192) * 1000 / 8 * 600 <= 512 * MB, `fit 10 min under 512 MB: ${k} kb/s video + 192 audio lands under it`);
ok(X.kbpsForBytes(1 * MB, 3600, 192) === 150, 'an impossible fit floors at 150 kb/s (the picture gets smaller instead)');
// too few bits for the pixels: 30 fps first, then the next size down
let f = Clipper.fitPicture(1920, 1080, 60, 8000, 0);
ok(!f.dims && !f.fps, `1080p60 at 8 Mb/s: kept ${JSON.stringify(f)}`);
f = Clipper.fitPicture(1920, 1080, 60, 3000, 0);
ok(f.fps === 30 && !f.dims, `1080p60 at 3 Mb/s: 30 fps ${JSON.stringify(f)}`);
f = Clipper.fitPicture(1920, 1080, 30, 1400, 0);
ok(f.dims && f.dims.h === 720 && f.dims.w === 1280, `1080p30 at 1.4 Mb/s: 720p ${JSON.stringify(f)}`);
f = Clipper.fitPicture(1920, 1080, 30, 1400, 1);
ok(f.dims && f.dims.h === 540, `the retry goes one size further down: 540p ${JSON.stringify(f)}`);
f = Clipper.fitPicture(1080, 1920, 30, 1400, 0);
ok(f.dims && f.dims.w === 720 && f.dims.h === 1280, `portrait: the short side steps down too ${JSON.stringify(f)}`);
// Convert's sizes
ok(JSON.stringify(Clipper.convDims(2560, 1440, { size: 'x' })) === '{"w":1920,"h":1080}' && Clipper.convDims(1280, 720, { size: 'x' }) === null, 'Convert "Fit X": 1440p → 1920×1080, 720p kept');
ok(JSON.stringify(Clipper.convDims(1920, 1080, { size: 720 })) === '{"w":1280,"h":720}' && Clipper.convDims(1280, 720, { size: 1080 }) === null, 'Convert 720p from 1080p; 1080p from 720p is kept (never upscaled)');
ok(JSON.stringify(Clipper.conv({ preset: 'forx' })) === '{"preset":"forx","size":"x","fps":60,"q":1,"mp3k":320}' && Clipper.conv({ preset: 'phone' }).fps === 30 && Clipper.conv({ preset: 'small' }).size === 720, 'the presets: For X (Fit X, ≤ 60 fps), Phone (1080p, 30 fps), Small (720p)');

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
process.exit(fails.length ? 1 : 0);
