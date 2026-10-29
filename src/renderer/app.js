/* SlopAMP renderer — playlist, engines (local / YouTube), UI. */
'use strict';
const P = window.phosphor;
// The player's panels are spread over several windows (winmgr.js): $ / $$ search all of them.
const $ = WM.$, $$ = WM.$$;
const VW = () => WM.wins.video || window;          // the video/visualizer window
const T = (name) => WM.token(name);                // colours from the skin (skins/*.css), for canvas drawing

// ------------------------------------------------------------------ state
const S = {
  // Playlist tabs. Each tab: { id, name, items: [{id,type:'file'|'youtube', path,url,vid,title,duration,...}], current }
  tabs: [{ id: 't0', name: 'Main', items: [], current: -1 }],
  tab: 0,              // tab shown in the playlist
  playTab: 0,          // tab the player is playing from
  sel: new Set(),
  anchor: -1,
  volume: 80,
  muted: false,
  shuffle: false,
  repeat: 'off',       // off | all | one
  showVideo: true,
  showPlaylist: true,
  remaining: false,
  plHeight: 230,       // (before 1.3: playlist height inside the single window; seeds the first layout)
  plShade: false,      // playlist window rolled up to its title bar
  vidShade: false,     // video window rolled up (while a video plays; the visualizer uses vis.panel)
  history: [],
  eq: { on: true, preamp: 0, gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preset: 'Flat', panel: 'open' },   // panel: hidden | open | min
  resume: {},          // 'f:<path>' | 'y:<videoId>' -> { t: seconds, at: timestamp }
  rate: 1,             // playback speed (this session only)
  subsOn: false,       // subtitles stay on for the next items once turned on
  lib: { w: 0, h: 0, view: 'grid' },   // the Library's size once resized (0: default) and the SLOP view
  vis: { mode: 'milkdrop', preset: '', cycle: true, panel: 'open', showTitle: false, showPreset: true, showTrack: false, favs: [], favOnly: false }   // audio visualizer: milkdrop (Butterchurn) | bars; panel: open | min | hidden
};
// S.items / S.current always mean the tab that's on screen.
Object.defineProperty(S, 'items', { get() { return S.tabs[S.tab].items; }, set(v) { S.tabs[S.tab].items = v; } });
Object.defineProperty(S, 'current', { get() { return S.tabs[S.tab].current; }, set(v) { S.tabs[S.tab].current = v; } });
const PT = () => S.tabs[S.playTab] || S.tabs[0];                 // the tab that's playing
const curItem = () => { const t = PT(); return t.items[t.current] || null; };   // the item that's playing
const allItems = () => S.tabs.flatMap(t => t.items);
const tabOf = (item) => S.tabs.find(t => t.items.includes(item)) || null;
let engine = null;     // 'local' | 'youtube' | null
let status = 'stopped';// playing | paused | stopped
let uid = Date.now();
const nid = () => (uid++).toString(36);

// ------------------------------------------------------------------ helpers
function fmt(t) {
  if (!Number.isFinite(t) || t < 0) t = 0;
  t = Math.floor(t);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function fmtShort(t) { if (!t) return ''; const f = fmt(t); return f.replace(/^0(\d:)/, '$1'); }
let toastTimer;
function toast(msg, ms = 2600) {
  const t = WM.host($('#toast'), WM.noticeDoc()); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}
function loadScript(src, doc = document) {
  return new Promise((res) => { const s = doc.createElement('script'); s.src = src; s.async = true; s.onload = () => res(true); s.onerror = () => { s.remove(); res(false); }; doc.head.appendChild(s); });
}

// ------------------------------------------------------------------ URL parsing
function parseWebUrl(raw) {
  let u; try { u = new URL(String(raw).trim()); } catch (_) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const h = u.hostname.toLowerCase().replace(/^(www|m|music|mobile)\./, '');
  let id = null;
  if (h === 'youtu.be') id = u.pathname.split('/')[1];
  else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else { const m = u.pathname.match(/^\/(shorts|live|embed|v)\/([\w-]{11})/); if (m) id = m[2]; }
  }
  if (id && /^[\w-]{11}$/.test(id)) {
    const t = u.searchParams.get('t') || u.searchParams.get('start');
    const music = /^music\./i.test(u.hostname);
    return { type: 'youtube', vid: id, music, url: music ? `https://music.youtube.com/watch?v=${id}` : `https://www.youtube.com/watch?v=${id}`, start: parseYtTime(t) };
  }
  return null;
}
function parseYtTime(t) {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return +t;
  const m = String(t).match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  return m ? (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) : 0;
}
// ---- X posts (2.1). SlopAMP can't play X inside the app: an X item is downloaded with yt-dlp (DOWNLOAD /
// DOWNLOAD ALL, the same qualities and folders as YouTube) and then plays like any file. Its key, in
// `vid` where YouTube items keep the video id, is "x<post id>" ("x<post id>-<n>" for the n-th video of
// a post with several): file names "Title [x…].mp4", the download index, the Library, resume points.
const X_HOST_RE = /^(x|twitter|fxtwitter|vxtwitter|fixupx|fixvx)\.com$/;
const xHost = (h) => String(h).toLowerCase().replace(/^(www|m|mobile|d|dl)\./, '');
const isTco = (raw) => /^https?:\/\/t\.co\/\w{1,30}\/?$/i.test(String(raw).trim());
function isXUrl(raw) {
  try { return X_HOST_RE.test(xHost(new URL(String(raw).trim()).hostname)) || isTco(raw); } catch (_) { return false; }
}
// x.com / twitter.com / fxtwitter / vxtwitter / fixupx links to a post -> { type:'x', vid, url (x.com) }
function parseXUrl(raw) {
  let u; try { u = new URL(String(raw).trim()); } catch (_) { return null; }
  if (!/^https?:$/.test(u.protocol) || !X_HOST_RE.test(xHost(u.hostname))) return null;
  const m = u.pathname.match(/^\/(?:(\w{1,15})\/status(?:es)?|i\/(?:web\/)?status)\/(\d{1,25})(?:\/(video|photo)\/(\d{1,2}))?\/?$/i);
  if (!m) return null;
  const user = m[1] || 'i', n = m[3] && m[3].toLowerCase() === 'video' ? Math.max(1, +m[4]) : 0;
  return { type: 'x', vid: `x${m[2]}${n > 1 ? `-${n}` : ''}`, user, post: m[2], url: `https://x.com/${user}/status/${m[2]}${n ? `/video/${n}` : ''}` };
}
const X_PLACEHOLDER = /^(@\w{1,15} · X post|X post \d+)( \(video \d+\))?$/;
const placeholderTitle = (it) => /^YouTube (Music track|video) [\w-]{11}$/.test(it.title) || (it.type === 'x' && X_PLACEHOLDER.test(it.title));
const isWeb = (it) => !!it && (it.type === 'youtube' || it.type === 'x');
const xNeedsDownload = (it) => !!it && it.type === 'x' && !localPathOf(it);
// t.co short links (how X shares posts) -> where they point; other links pass through
async function expandShortLinks(urls) {
  const short = urls.filter(isTco);
  if (!short.length) return urls;
  const map = await P.resolveUrls(short).catch(() => ({}));
  return urls.map(u => (isTco(u) ? (map && map[u.trim()]) || u : u));
}
function extractUrls(text) {
  return String(text || '').split(/[\s<>"']+/).filter(s => /^https?:\/\//i.test(s));
}

// ------------------------------------------------------------------ adding items
function webItem(p, title) {
  const it = { id: nid(), type: 'youtube', url: p.url, vid: p.vid, start: p.start || 0, title: title || `${p.music ? 'YouTube Music track' : 'YouTube video'} ${p.vid}`, duration: 0, hasVideo: true };
  if (p.music) it.music = true;
  return it;
}
function xItem(p, title) {
  const n = /\/video\/(\d+)$/.exec(p.url);
  return { id: nid(), type: 'x', url: p.url, vid: p.vid, title: title || `${p.user !== 'i' ? `@${p.user} · X post` : `X post ${p.post}`}${n && +n[1] > 1 ? ` (video ${n[1]})` : ''}`, duration: 0, hasVideo: true };
}
async function fillWebMeta(it) {
  const m = await P.webMeta(it.type === 'youtube' && it.vid ? `https://www.youtube.com/watch?v=${it.vid}` : it.url);
  if (!m) return;
  if (m.status === 200) {
    if (it.type === 'youtube' && m.title) { it.title = m.author ? `${m.author} - ${m.title}` : m.title; if (typeof histFixTitle === 'function') histFixTitle(it); }
    else if (it.type === 'x' && X_PLACEHOLDER.test(it.title) && (m.title || m.author)) it.title = [m.author, m.title].filter(Boolean).join(' - ');
  } else if (it.type === 'youtube' && (m.status === 401 || m.status === 403)) {
    it.noEmbed = true;
  } else if (it.type === 'youtube' && m.status === 404) {
    it.title += ' (unavailable)';
  }
  renderList(); saveSoon();
}

// A link -> a new playlist item, or null (not a YouTube video or an X post)
function linkItem(u, title) {
  const p = parseWebUrl(u); if (p) return webItem(p, title);
  const x = parseXUrl(u); if (x) return xItem(x, title);
  return null;
}
const SKIP_MSG = (bad, none) => (none ? 'Only YouTube videos and X posts can be added.' : `${bad} link(s) skipped — only YouTube videos and X posts can be added.`);
function addUrls(urls, at) {
  if (urls.some(isTco)) return expandShortLinks(urls).then(u => addUrls(u.map(x => (isTco(x) ? 'about:blank' : x)), at));   // unresolved: skipped
  const added = [];
  let bad = 0;
  for (const u of urls) { const it = linkItem(u); if (it) added.push(it); else bad++; }
  if (bad) toast(SKIP_MSG(bad, !added.length));
  insertItems(added, at);
  added.forEach(fillWebMeta);
  return added;
}

async function addPaths(paths, at) {
  if (!paths.length) return [];
  showBusy(true);
  const res = await P.describeFiles(paths);
  showBusy(false);
  return addDescribed(res, at);
}
// Adds files and links in their original order (playlist files can mix both).
function addDescribed(res, at, autoplay = true) {
  if (res.some(r => r.url && isTco(r.url))) {   // playlist files from elsewhere may hold t.co links
    return expandShortLinks(res.map(r => r.url || '')).then(u => addDescribed(res.map((r, i) => (r.url ? { ...r, url: isTco(u[i]) ? 'about:blank' : u[i] } : r)), at, autoplay));
  }
  const items = [];
  const web = [];
  let bad = 0;
  for (const r of res) {
    if (r.url) {
      const it = linkItem(r.url, r.title || undefined);
      if (!it) { bad++; continue; }
      items.push(it); web.push(it);
      continue;
    }
    items.push({ id: nid(), type: 'file', path: r.path, title: r.title, duration: r.duration || 0, hasVideo: !!r.hasVideo, missing: !!r.missing });
  }
  if (bad) toast(SKIP_MSG(bad, false));
  if (!items.length) { if (!bad) toast('No playable media found.'); return []; }
  insertItems(items, at, autoplay);
  web.forEach(fillWebMeta);
  return items;
}

function insertItems(items, at, autoplay = true) {
  if (!items.length) return;
  if (histOnScreen()) { toast(histNoAdd(), 3500); return; }
  const wasEmpty = S.items.length === 0;
  const idx = at == null || at < 0 || at > S.items.length ? S.items.length : at;
  if (S.current >= idx) S.current += items.length;
  S.items.splice(idx, 0, ...items);
  S.sel.clear();
  renderList(); saveSoon();
  attachKnownCopies(items);
  if (autoplay && status === 'stopped' && (wasEmpty || S.current < 0)) playIndex(idx);
}

// ------------------------------------------------------------------ engines
const video = $('#video');
const L = { prep: null, offset: 0, token: 0, duration: 0, triedStream: false, triedTranscode: false, pendingSeek: 0 };
let yt = null, ytApi = null, ytPendingItem = null, ytDuration = 0;

function showLayer(name) {
  for (const id of ['ytWrap', 'artWrap', 'empty']) $('#' + id).classList.toggle('show', id === name);
  video.style.visibility = name === 'video' ? 'visible' : 'hidden';
  WM.body.toggle('audvis', name === 'artWrap');
  syncWindows();
  if (typeof updateVisLayer === 'function') updateVisLayer();
}
// The message box over the video. A button with `countdown` (Skip on the X / YouTube choice sheets)
// counts down "Skip (10)" … "Skip (0)" and then clicks itself. Any button click ends the countdown; it
// waits while the download menu is open, and stops for good once a download of that item starts
// (the sheet then waits for it). opts.item: the playlist item the box is about.
const SKIP_SECS = 10;
let sheet = null;   // the choice sheet on screen: { itemId, show(why) } (shown again if its download fails)
const CD = { timer: null, left: 0, btn: null, label: '', itemId: null, chain: 0 };
function cdStop(keepLabel) {
  clearInterval(CD.timer); CD.timer = null;
  if (CD.btn && !keepLabel) { CD.btn.textContent = CD.label; CD.btn.title = ''; }
  CD.btn = null; CD.itemId = null;
}
function showOverlay(title, text, buttons = [], opts = {}) {
  cdStop(); sheet = opts.reshow && opts.item ? { itemId: opts.item.id, show: opts.reshow } : null;
  $('#ovTitle').textContent = title; $('#ovText').textContent = text;
  const b = $('#ovBtns'); b.innerHTML = '';
  let cdBtn = null, cdDef = null;
  for (const bt of buttons) {
    const el = document.createElement('button'); el.textContent = bt.label;
    el.onclick = () => { const r = el.getBoundingClientRect(); if (bt.countdown || !bt.keepOpen) cdStop(); if (!bt.keepOpen) hideOverlay(); bt.action(r); };
    b.appendChild(el);
    if (bt.countdown) { cdBtn = el; cdDef = bt; }
  }
  $('#overlay').classList.add('show'); $('#overlay').classList.remove('hidden');
  if (cdBtn && countdownOk(opts.item)) {
    CD.btn = cdBtn; CD.label = cdDef.label; CD.itemId = opts.item ? opts.item.id : null; CD.left = SKIP_SECS;
    const paint = () => { cdBtn.textContent = `${CD.label} (${CD.left})`; cdBtn.title = `Skips to the next item in ${CD.left} s. Pick another button to stay.`; };
    paint();
    CD.timer = setInterval(() => {
      if (CD.btn !== cdBtn || !$('#overlay').classList.contains('show')) { cdStop(true); return; }
      if (!$('#dlMenu').classList.contains('hidden')) return;     // choosing a quality: wait
      CD.left--; paint();
      if (CD.left > 0) return;
      cdStop(true); hideOverlay();
      CD.chain++;
      toast(`Skipped "${(opts.item && opts.item.title) || 'this item'}"`, 2500);
      cdDef.action(null, true);
    }, 1000);
  }
}
// No countdown when Skip couldn't go anywhere, when the item is already downloading (the box waits for
// it), or when countdowns have already gone round the whole playlist without anything playing.
function countdownOk(item) {
  if (item) { const d = DL.get(item.id); if (d && DL_BUSY.includes(d.status)) return false; }
  if (skipIndex() < 0) return false;
  if (CD.chain >= Math.max(1, PT().items.length)) { if (!CD.warned) { CD.warned = true; toast('Nothing in this playlist could play, so SlopAMP stopped skipping.', 4000); } return false; }
  return true;
}
function hideOverlay() { cdStop(); sheet = null; $('#overlay').classList.remove('show'); }
function showBusy(on) { $('#busy').classList.toggle('hidden', !on); }

function stopEngines(keep) {
  if (keep !== 'local') {
    L.token++;
    video.pause(); video.removeAttribute('src'); video.load();
  }
  if (keep !== 'youtube' && yt && yt.stopVideo) { try { yt.stopVideo(); } catch (_) {} }
}

// ---- local
// Path SlopAMP plays for an item: the file itself, or a downloaded copy of a YouTube video.
// Track whether a YouTube item is a live stream (drives the "YT LIVE" tag).
function markLive(item, live) {
  if (!item || item.type !== 'youtube' || !!item.live === live) return;
  if (live) { item.live = true; item.duration = 0; } else delete item.live;
  renderList(); saveSoon();
}
function localPathOf(item) {
  if (!item) return null;
  if (item.type === 'file') return item.path;
  return item.localVideo || item.localAudio || null;
}
async function loadLocal(item, startAt = 0, opts = {}) {
  const token = ++L.token;
  showBusy(true);
  const lp = localPathOf(item);
  const prep = await P.prepare(lp, opts);
  if (token !== L.token) return;
  if (!prep.ok && item.type === 'x') {
    if (item.localVideo === lp) delete item.localVideo; else delete item.localAudio;
    renderList(); saveSoon();
    if (localPathOf(item)) { await loadLocal(item, startAt, opts); return; }
    showBusy(false);
    engine = null; setStatus('stopped');
    showXSheet(item, 'The downloaded copy is missing.');
    updateControlsEnabled(); updateDlButton();
    return;
  }
  if (!prep.ok && item.type === 'youtube') {
    // downloaded copy is gone: forget it and stream from YouTube instead
    if (item.localVideo === lp) delete item.localVideo; else delete item.localAudio;
    renderList(); saveSoon();
    if (localPathOf(item)) { await loadLocal(item, startAt, opts); return; }
    showBusy(false);
    toast('The downloaded copy is missing — playing from YouTube.');
    engine = 'youtube'; stopEngines('youtube');
    await loadYouTube(item, startAt);
    updateControlsEnabled();
    return;
  }
  if (!prep.ok) {
    showBusy(false);
    item.missing = true; renderList();
    setStatus('stopped');
    showOverlay('File not found', `${item.path}\nwas moved or deleted.`, [{ label: 'Skip', action: () => next(true) }, { label: 'Remove', action: () => removeIds([item.id]) }]);
    return;
  }
  item.missing = false;
  L.prep = prep;
  L.duration = (prep.info && prep.info.duration) || item.duration || 0;
  if (L.duration && !item.duration) { item.duration = L.duration; renderList(); saveSoon(); }
  updateInfo(prep.info);
  const hasVideo = prep.info ? prep.info.hasVideo : item.hasVideo;
  showLayer(hasVideo ? 'video' : 'artWrap');
  const cover = $('#cover');
  if (!hasVideo && prep.coverUrl) { cover.src = prep.coverUrl; cover.classList.add('has'); } else { cover.removeAttribute('src'); cover.classList.remove('has'); }
  ensureAudioGraph();
  if (!hasVideo) updateVisLayer().then(() => { if (S.vis.showTitle && MD.active && MD.viz) { try { MD.viz.launchSongTitleAnim(item.title); } catch (_) {} } });
  if (prep.mode === 'direct') { L.offset = 0; L.pendingSeek = startAt; video.src = prep.directUrl; }
  else { L.offset = startAt; L.pendingSeek = 0; video.src = `${prep.streamUrl}&t=${startAt}`; }
  video.volume = S.volume / 100; video.muted = S.muted;
  applyRate();
  loadSubsFor(item);
  try { await video.play(); } catch (_) { /* handled by error event */ }
}
function localTime() { return L.offset + (video.currentTime || 0); }
function localSeek(t) {
  if (!L.prep) return;
  t = Math.max(0, Math.min(t, (L.duration || 1e9) - 0.25));
  if (L.prep.mode === 'direct') { video.currentTime = t; return; }
  L.offset = t; const wasPaused = status !== 'playing';
  showBusy(true);
  video.src = `${L.prep.streamUrl}&t=${t.toFixed(2)}`;
  if (!wasPaused) video.play().catch(() => {}); else video.pause();
}
video.addEventListener('loadedmetadata', () => {
  if (L.pendingSeek) { video.currentTime = L.pendingSeek; L.pendingSeek = 0; }
  // A direct-played video file whose codec Chromium can't decode shows 0x0 — fall back to FFmpeg.
  const item = curItem();
  const expectVideo = L.prep && L.prep.info ? L.prep.info.hasVideo : (item && item.hasVideo);
  if (engine === 'local' && L.prep && L.prep.mode === 'direct' && item && expectVideo && video.videoWidth === 0) fallbackLocal('novideo');
});
video.addEventListener('playing', () => { showBusy(false); if (engine === 'local') { if (video.playbackRate !== S.rate) applyRate(); setStatus('playing'); histStarted(curItem()); } });
video.addEventListener('waiting', () => { if (engine === 'local') showBusy(true); });
video.addEventListener('canplay', () => showBusy(false));
video.addEventListener('pause', () => { if (engine === 'local' && status === 'playing' && !video.ended) setStatus('paused'); });
video.addEventListener('ended', () => { if (engine === 'local') onEnded(); });
video.addEventListener('error', () => {
  if (engine !== 'local' || !video.getAttribute('src')) return;
  fallbackLocal('error');
});
video.addEventListener('dblclick', () => toggleFullscreen());
function fallbackLocal(reason) {
  const item = curItem();
  if (!item || !L.prep) return;
  const at = localTime();
  if (L.prep.mode === 'direct' && !L.triedStream) { L.triedStream = true; loadLocal(item, at, { forceStream: true }); return; }
  if (!L.triedTranscode) { L.triedTranscode = true; loadLocal(item, at, { forceStream: true, forceTranscode: true }); return; }
  showBusy(false); setStatus('stopped');
  showOverlay("Can't play this file", `SlopAMP couldn't decode "${item.title}" (${reason}). The file may be damaged, DRM-protected or an unusual format.`,
    [{ label: 'Skip', action: () => next(true) }, { label: 'Show in folder', action: () => P.showInFolder(localPathOf(item)) }]);
}

// ---- YouTube (official IFrame Player API)
// The YouTube player API runs inside the video window (its iframe talks to the window it sits in).
function ensureYouTubeApi() {
  if (ytApi) return ytApi;
  const w = VW();
  ytApi = new Promise((resolve) => {
    w.onYouTubeIframeAPIReady = () => resolve(true);
    loadScript('https://www.youtube.com/iframe_api', w.document).then(ok => { if (!ok) { ytApi = null; resolve(false); } });
    setTimeout(() => resolve(!!(w.YT && w.YT.Player)), 15000);
  });
  return ytApi;
}
async function loadYouTube(item, startAt) {
  showLayer('ytWrap');
  updateInfo(null, 'YT');
  showBusy(true);
  const ok = await ensureYouTubeApi();
  if (curItem() !== item) return;
  const YTW = VW().YT;
  if (!ok || !YTW || !YTW.Player) {
    showBusy(false); setStatus('stopped');
    showOverlay('YouTube is unreachable', "Couldn't load YouTube's player. Check your internet connection.", [{ label: 'Retry', action: () => replayCurrent() }, { label: 'Open in browser', action: () => P.openExternal(item.url) }, { label: 'Skip', countdown: true, action: () => skipItem() }], { item });   // no Download here: YouTube itself isn't reachable
    return;
  }
  ytDuration = item.duration || 0;
  const start = Math.floor(startAt || item.start || 0);
  if (!yt) {
    ytPendingItem = item;
    yt = new YTW.Player($('#ytHost'), {
      width: '100%', height: '100%', videoId: item.vid,
      playerVars: { autoplay: 1, playsinline: 1, rel: 0, fs: 0, iv_load_policy: 3, origin: location.origin, start, enablejsapi: 1, cc_load_policy: S.subsOn ? 1 : 0 },
      events: {
        onReady: (e) => { e.target.setVolume(S.volume); if (S.muted) e.target.mute(); e.target.playVideo(); },
        onStateChange: onYtState,
        onError: onYtError
      }
    });
  } else {
    yt.setVolume(S.volume); if (S.muted) yt.mute(); else yt.unMute();
    yt.loadVideoById({ videoId: item.vid, startSeconds: start });
  }
}
function onYtState(e) {
  if (engine !== 'youtube') return;
  const st = e.data;
  if (st === 1) {
    showBusy(false); setStatus('playing');
    const it = curItem();
    let vd = null; try { vd = yt.getVideoData && yt.getVideoData(); } catch (_) {}
    markLive(it, !!(vd && vd.isLive));
    const d = yt.getDuration(); if (d) { ytDuration = d; if (it && !it.live && !it.duration) { it.duration = d; renderList(); saveSoon(); } }
    applyRate();
    if (ytCcItem !== it) { ytCcItem = it; ytApplyCaptions(); }
    histStarted(it);
  }
  else if (st === 2) setStatus('paused');
  else if (st === 3) showBusy(true);
  else if (st === 0) onEnded();
  else if (st === 5) showBusy(false);
}
function onYtError(e) {
  if (engine !== 'youtube') return;
  showBusy(false); setStatus('stopped');
  const item = curItem();
  const code = e.data;
  let title = 'This video can’t play here';
  let text = 'YouTube reported an error.';
  if (code === 101 || code === 150 || code === 152) { text = 'The video’s owner doesn’t allow it to be played in other apps. You can still watch it on YouTube.'; if (item) { item.noEmbed = true; renderList(); saveSoon(); } }
  else if (code === 100) { title = 'Video unavailable'; text = 'This video was removed or is private.'; }
  else if (code === 2) { title = 'Invalid link'; text = 'That doesn’t look like a valid YouTube video.'; }
  else if (code === 5) { text = 'YouTube’s player hit a playback error.'; }
  else if (code === 153) { text = 'YouTube rejected the embedded player configuration. Open it in your browser instead.'; }
  const btns = [
    { label: 'Open in browser', action: () => P.openExternal(item.url) },
    { label: '\u21e9 Download', keepOpen: true, action: (r) => openDlMenu(item, { doc: $('#overlay').ownerDocument, x: r.left, y: r.bottom + 6, flipY: r.top }) },
    { label: 'Skip', countdown: true, action: () => skipItem() }
  ];
  const show = (why) => showOverlay(title, why ? `${why} ${text}` : text, btns, { item, reshow: show });
  show();
}
function ytTime() { try { return yt && yt.getCurrentTime ? yt.getCurrentTime() || 0 : 0; } catch (_) { return 0; } }

// ------------------------------------------------------------------ transport
async function playIndex(i, startAt = 0, opts = {}) {
  const ti = opts.tab != null ? opts.tab : S.tab;     // default: the tab on screen
  const tab = S.tabs[ti];
  if (!tab || i < 0 || i >= tab.items.length) return;
  const item = tab.items[i];
  histPending = item;            // YouTube History: recorded when its playback really starts
  const prevItem = curItem();
  if (prevItem && prevItem !== item) recordResume();
  hideResumeBar();
  if (prevItem !== item || !L.prep) clearSubs();
  if (ti !== S.playTab) { S.history = []; S.playTab = ti; PT().current = -1; }
  if (!startAt && !opts.noResume) {
    const r = resumePoint(item);
    if (r) { startAt = r; showResumeBar(r); }
  }
  if (tab.current >= 0 && tab.current !== i) { S.history.push(tab.current); if (S.history.length > 200) S.history.shift(); }
  tab.current = i;
  hideOverlay();
  L.triedStream = false; L.triedTranscode = false;
  if (xNeedsDownload(item)) {     // X: nothing plays until it's downloaded; offer the choice
    engine = null; stopEngines();
    setMarquee(item); setStatus('stopped');
    renderList(); if (S.tab === S.playTab) scrollToCurrent(); saveSoon();
    showXSheet(item);
    updateControlsEnabled(); updateDlButton(); renderEq(); renderSpeed(); renderCc();
    return;
  }
  engine = item.type === 'file' || localPathOf(item) ? 'local' : item.type;
  stopEngines(engine);
  setMarquee(item);
  renderList(); if (S.tab === S.playTab) scrollToCurrent(); saveSoon();
  if (engine === 'local') await loadLocal(item, startAt);
  else if (engine === 'youtube') await loadYouTube(item, startAt);
  updateControlsEnabled();
  updateDlButton();
  renderEq(); renderSpeed(); renderCc();
}

function replayCurrent(opts = {}) { return playIndex(PT().current, 0, { ...opts, tab: S.playTab }); }
function play() {
  if (!curItem()) {
    if (resumeAtBoot && tabOf(resumeAtBoot) && !S.sel.size) { const t = tabOf(resumeAtBoot); const it = resumeAtBoot; resumeAtBoot = null; return playIndex(t.items.indexOf(it), 0, { tab: S.tabs.indexOf(t) }); }
    resumeAtBoot = null;
    const first = S.sel.size ? S.items.findIndex(i => S.sel.has(i.id)) : 0;
    if (S.items.length) playIndex(Math.max(0, first)); else openFiles();
    return;
  }
  if (status === 'stopped') {
    // Re-start the current item from scratch.
    if (engine === 'local' && L.prep && video.getAttribute('src')) { localSeek(0); video.play().catch(() => {}); return; }
    return replayCurrent({ noResume: true });
  }
  if (engine === 'local') video.play().catch(() => {});
  else if (engine === 'youtube' && yt) yt.playVideo();
}
function pause() {
  if (engine === 'local') { if (video.paused) { if (status !== 'stopped') video.play().catch(() => {}); } else video.pause(); }
  else if (engine === 'youtube' && yt) { if (status === 'playing') yt.pauseVideo(); else if (status === 'paused') yt.playVideo(); }
}
function togglePlay() { if (status === 'playing') pause(); else play(); }
function stop() {
  recordResume(); saveSoon(); hideResumeBar();
  histPending = curItem();       // Play after Stop is a new play (for YouTube History); pause/resume isn't
  cdStop();      // Stop means stop: no Skip countdown takes over
  if (engine === 'local') {
    if (L.prep && L.prep.mode === 'direct') { video.pause(); video.currentTime = 0; }
    else { L.token++; video.pause(); video.removeAttribute('src'); video.load(); L.offset = 0; }
  } else if (engine === 'youtube' && yt) { try { yt.pauseVideo(); yt.seekTo(0, true); } catch (_) {} }
  setStatus('stopped');
}
function nextIndex(auto, from = PT().current, avoid) {
  const t = PT(); const n = t.items.length; if (!n) return -1;
  if (auto && S.repeat === 'one' && !avoid) return from;
  if (S.shuffle && n > 1) {
    const pool = [...Array(n).keys()].filter(k => k !== t.current && !(avoid && avoid.has(k)));
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : -1;
  }
  const i = from + 1;
  if (i < n) return i;
  return S.repeat === 'all' || !auto ? 0 : -1;
}
// auto: a track ended. An X post that isn't downloaded gets its choice sheet (with the Skip countdown).
function next(auto = false) {
  const i = nextIndex(auto);
  if (i < 0) { stop(); return; }
  playIndex(i, 0, { tab: S.playTab });
}
const skipIndex = () => nextIndex(true, PT().current, new Set([PT().current]));
function skipItem() {
  const i = skipIndex();
  if (i < 0) { stop(); return; }
  playIndex(i, 0, { tab: S.playTab });
}
// The choice for an X post that isn't downloaded: open it on X, download it (it plays when it's done), or skip.
let xSheetFor = null;
function showXSheet(item, why) {
  xSheetFor = item.id;
  const d = DL.get(item.id), busy = d && DL_BUSY.includes(d.status);
  showOverlay('This X post plays after you download it', `${why ? why + ' ' : ''}${busy ? 'It’s downloading now and plays when it’s done.' : 'SlopAMP can’t stream X videos. Download it to play it here, or watch it on X.'}`, [
    { label: 'Play on X', action: () => { xSheetFor = null; P.openExternal(item.url); } },
    { label: '\u21e9 Download', keepOpen: true, action: (r) => openDlMenu(item, { doc: $('#overlay').ownerDocument, x: r.left, y: r.bottom + 6, flipY: r.top }) },
    { label: 'Skip', countdown: true, action: () => { xSheetFor = null; skipItem(); } }
  ], { item, reshow: (w) => showXSheet(item, w) });
}
function prev() {
  if (currentTime() > 4) { seekTo(0); return; }
  let i; const t = PT();
  if (!t.items.length) return;
  if (S.shuffle && S.history.length) { i = S.history.pop(); t.current = -1; }
  else i = t.current > 0 ? t.current - 1 : (S.repeat === 'all' ? t.items.length - 1 : 0);
  playIndex(i, 0, { tab: S.playTab });
}
function onEnded() { forgetResume(curItem()); next(true); }
function currentTime() { return engine === 'local' ? localTime() : engine === 'youtube' ? ytTime() : 0; }
function currentDuration() { return engine === 'local' ? L.duration : engine === 'youtube' ? (ytDuration || (yt && yt.getDuration ? yt.getDuration() : 0)) : 0; }
function seekTo(t) {
  if (engine === 'local') localSeek(t);
  else if (engine === 'youtube' && yt) { yt.seekTo(t, true); }
}
function seekBy(d) { seekTo(Math.max(0, currentTime() + d)); }
function setVolume(v, quiet) {
  S.volume = Math.max(0, Math.min(100, Math.round(v)));
  video.volume = S.volume / 100;
  if (yt && yt.setVolume) yt.setVolume(S.volume);
  if (S.volume > 0 && S.muted) setMuted(false);
  renderVolume(); if (!quiet) saveSoon();
}
function setMuted(m) {
  S.muted = m; video.muted = m;
  if (yt && yt.mute) { if (m) yt.mute(); else yt.unMute(); }
  renderVolume(); saveSoon();
}
function setStatus(st) {
  if (st === 'paused' && status === 'playing') { recordResume(); saveSoon(); }
  if (st === 'playing') { CD.chain = 0; CD.warned = false; }
  status = st;
  updateDlButton();
  $('#vPlayIcon').innerHTML = st === 'playing' ? '<path d="M4 3h3v10H4zM9 3h3v10H9z"/>' : '<path d="M4 2.5v11L13 8z"/>';
  drawStateIcon();
  updateMediaSession();
  renderTabs();
}

// ------------------------------------------------------------------ UI: deck
const clock = $('#clock').getContext('2d');
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '' };
function drawDigit(ctx, ch, x, y, w, h, on, off) {
  const t = 3.4, segs = SEG[ch] || '';
  const R = (k, rx, ry, rw, rh) => { ctx.fillStyle = segs.includes(k) ? on : off; ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.fill(); };
  const hh = h / 2;
  R('a', x + t, y, w - 2 * t, t);
  R('b', x + w - t, y + t, t, hh - t * 1.5);
  R('c', x + w - t, y + hh + t / 2, t, hh - t * 1.5);
  R('d', x + t, y + h - t, w - 2 * t, t);
  R('e', x, y + hh + t / 2, t, hh - t * 1.5);
  R('f', x, y + t, t, hh - t * 1.5);
  R('g', x + t, y + hh - t / 2, w - 2 * t, t);
}
let blink = true;
function drawClock() {
  const ctx = clock, W = 132, H = 40;
  ctx.clearRect(0, 0, W, H);
  const dur = currentDuration();
  let t = currentTime();
  let neg = false;
  if (S.remaining && dur) { t = Math.max(0, dur - t); neg = true; }
  t = Math.floor(t);
  const m = Math.min(99, Math.floor(t / 60)), s = t % 60;
  let txt = `${String(m).padStart(2, '0')}${String(s).padStart(2, '0')}`;
  if (status === 'stopped') txt = '0000';
  const on = T('--lcd-on'), off = T('--lcd-off');
  const hide = status === 'paused' && !blink;
  ctx.shadowColor = T('--lcd-glow'); ctx.shadowBlur = hide ? 0 : 6;
  drawDigit(ctx, neg ? '-' : ' ', 0, 6, 14, 30, hide ? off : on, off);
  const xs = [20, 46, 80, 106];
  for (let i = 0; i < 4; i++) drawDigit(ctx, txt[i], xs[i], 4, 22, 34, hide ? off : on, off);
  ctx.fillStyle = hide ? off : on;
  ctx.fillRect(71, 12, 4, 4); ctx.fillRect(71, 26, 4, 4);
  ctx.shadowBlur = 0;
}
const stateCtx = $('#stateIcon').getContext('2d');
function drawStateIcon() {
  const c = stateCtx; c.clearRect(0, 0, 16, 18);
  c.fillStyle = status === 'playing' ? T('--state-play') : status === 'paused' ? T('--state-pause') : T('--state-stop');
  c.shadowColor = c.fillStyle; c.shadowBlur = 4;
  c.beginPath();
  if (status === 'playing') { c.moveTo(3, 3); c.lineTo(13, 9); c.lineTo(3, 15); c.closePath(); c.fill(); }
  else if (status === 'paused') { c.fillRect(3, 3, 4, 12); c.fillRect(9, 3, 4, 12); }
  else c.fillRect(3, 4, 10, 10);
}
function setMarquee(item) {
  const el = $('#marqueeText');
  const ti = tabOf(item); const idx = ti ? ti.items.indexOf(item) + 1 : 0;
  const base = item ? `${idx}. ${item.title}${item.duration ? ` (${fmtShort(item.duration)})` : ''}` : 'SLOPAMP · DROP FILES OR PASTE A LINK';
  el.classList.remove('scroll'); el.style.animationDuration = '';
  el.textContent = base;
  requestAnimationFrame(() => {
    const box = $('#marquee');
    if (el.scrollWidth > box.clientWidth - 8) {
      el.textContent = `${base}  ***  ${base}  ***  `;
      el.classList.add('scroll');
      el.style.animationDuration = `${Math.max(6, base.length * 0.22)}s`;
    }
  });
}
function updateInfo(info, src) {
  const kb = $('#kbps'), hz = $('#khz');
  $('#indSrc').textContent = src || 'FILE'; $('#indSrc').classList.add('on');
  if (!info) { kb.textContent = '---'; hz.textContent = '--'; $('#indMono').classList.remove('on'); $('#indStereo').classList.toggle('on', !!src); return; }
  const br = info.audio && info.audio.bitrate && !info.hasVideo ? info.audio.bitrate : info.bitrate;
  kb.textContent = br ? String(Math.round(br / 1000)).slice(0, 5) : '---';
  hz.textContent = info.audio && info.audio.sampleRate ? String(Math.round(info.audio.sampleRate / 1000)) : '--';
  const ch = info.audio ? info.audio.channels : 0;
  $('#indMono').classList.toggle('on', ch === 1);
  $('#indStereo').classList.toggle('on', ch >= 2);
}
function renderVolume() {
  const v = S.muted ? 0 : S.volume;
  const vol = $('#vol'); vol.value = S.volume; vol.style.setProperty('--p', `${S.volume}%`);
  $('#wedgeFill').style.width = `${v}%`;
  $('#vPct').textContent = `${S.volume}%`;
  $('#vMute').classList.toggle('muted', S.muted);
}
function renderToggles() {
  $('#bShuffle').classList.toggle('on', S.shuffle); $('#vShuf').classList.toggle('on', S.shuffle);
  $('#bRepeat').classList.toggle('on', S.repeat !== 'off'); $('#vRep').classList.toggle('on', S.repeat !== 'off');
  $('#repLabel').textContent = S.repeat === 'one' ? 'REPEAT 1' : 'REPEAT';
  $('#bRepeat').title = `Repeat: ${S.repeat} (R)`;
  $('#togVid').classList.toggle('on', S.showVideo); $('#togPl').classList.toggle('on', S.showPlaylist); $('#vPl').classList.toggle('on', S.showPlaylist);
  syncWindows();
}
// Which windows show, and which are rolled up to their title bar (winmgr.js does the rest).
let fsWanted = false;
function syncWindows(opts = {}) {
  const mini = WM.body.contains('mini'), fs = WM.body.contains('fs') || fsWanted;
  const audvis = WM.body.contains('audvis');
  const vidShade = !fs && (audvis ? S.vis.panel === 'min' : S.vidShade);
  WM.setPanels({
    eq: { visible: !mini && S.eq.panel !== 'hidden', shade: S.eq.panel === 'min' },
    video: { visible: !mini && (fs || (S.showVideo && !(audvis && S.vis.panel === 'hidden'))), shade: vidShade, title: audvis ? 'VISUALIZER' : 'VIDEO' },
    playlist: { visible: !mini && S.showPlaylist, shade: S.plShade },
    slop: { visible: !mini && slopVisible, shade: slopShade },
    skined: { visible: !mini && !!(WM.skins && WM.skins.editorOpen), shade: !!(WM.skins && WM.skins.editorShade) }
  }, { reflow: opts.reflow !== false && !mini });
  const btn = (id, min, what) => { const b = $(id); if (!b) return; b.innerHTML = min ? '&#x25A1;' : '&#x2013;'; b.title = `${min ? 'Expand' : 'Minimize'} ${what}`; };
  btn('#visMinBtn', vidShade, audvis ? 'visualizer' : 'video');
  btn('#plMinBtn', S.plShade, 'playlist');
  btn('#slopMinBtn', slopShade, 'SLOP');
  btn('#skedMinBtn', !!(WM.skins && WM.skins.editorShade), 'the skin editor');
  $('#visCloseBtn').title = audvis ? 'Close visualizer' : 'Close video';
}
function updateControlsEnabled() {
  const canSeek = engine === 'local' || engine === 'youtube';
  $('#pos').disabled = !canSeek; $('#seek').disabled = !canSeek;
}

// ------------------------------------------------------------------ equalizer
const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_LABELS = ['31', '62', '125', '250', '500', '1K', '2K', '4K', '8K', '16K'];
const EQ_PRESETS = {
  'Flat':            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Rock':            [5, 4, 3, 1, -1, -1, 1, 3, 4, 5],
  'Pop':             [-1, 2, 4, 4, 2, 0, -1, -1, -1, -1],
  'Bass Boost':      [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
  'Treble Boost':    [0, 0, 0, 0, 0, 1, 3, 5, 6, 7],
  'Vocal':           [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1],
  'Classical':       [0, 0, 0, 0, 0, 0, -3, -3, -3, -5],
  'Dance':           [6, 5, 2, 0, 0, -2, -3, -3, 0, 0],
  'Headphones':      [3, 5, 3, -1, -1, 1, 2, 4, 5, 6],
  'Laptop speakers': [6, 5, 4, 2, 0, 0, 1, 3, 4, 4]
};
const eqNodes = { pre: null, bands: [] };
const dbToGain = (db) => Math.pow(10, db / 20);
function applyEq() {
  if (!eqNodes.pre) return;
  const on = S.eq.on;
  const t = actx ? actx.currentTime : 0;
  eqNodes.pre.gain.setTargetAtTime(on ? dbToGain(S.eq.preamp) : 1, t, 0.02);
  eqNodes.bands.forEach((b, i) => b.gain.setTargetAtTime(on ? S.eq.gains[i] : 0, t, 0.02));
}
function eqSlider(label, get, set, cls) {
  const band = document.createElement('div'); band.className = 'eq-band' + (cls ? ' ' + cls : '');
  band.innerHTML = '<div class="eq-slot"><div class="eq-fill"></div><div class="eq-knob"></div></div><div class="eq-lbl"></div>';
  band.querySelector('.eq-lbl').textContent = label;
  const slot = band.querySelector('.eq-slot');
  const toDb = (clientY) => { const r = slot.getBoundingClientRect(); const v = 12 - ((clientY - r.top) / r.height) * 24; return Math.max(-12, Math.min(12, Math.round(v * 2) / 2)); };
  slot.addEventListener('mousedown', (e) => {
    e.preventDefault(); set(toDb(e.clientY));
    const mv = (ev) => set(toDb(ev.clientY));
    const doc = slot.ownerDocument;
    doc.addEventListener('mousemove', mv);
    doc.addEventListener('mouseup', () => { doc.removeEventListener('mousemove', mv); saveSoon(); }, { once: true });
  });
  slot.addEventListener('dblclick', () => { set(0); saveSoon(); });
  slot.addEventListener('wheel', (e) => { e.preventDefault(); set(Math.max(-12, Math.min(12, get() + (e.deltaY < 0 ? 1 : -1)))); saveSoon(); });
  band.update = () => {
    const g = get(); const pct = (12 - g) / 24 * 100;
    band.querySelector('.eq-knob').style.top = `calc(${pct}% - 5px)`;
    const f = band.querySelector('.eq-fill');
    f.style.top = `${g >= 0 ? pct : 50}%`; f.style.height = `${Math.abs(g) / 24 * 100}%`;
    f.style.background = g >= 0 ? 'var(--eq-fill-up)' : 'var(--eq-fill-down)';
    slot.title = `${label}: ${g > 0 ? '+' : ''}${g} dB (double-click = 0)`;
  };
  return band;
}
let eqSliders = [];
function buildEq() {
  const host = $('#eqBands'); host.innerHTML = '';
  const db = document.createElement('div'); db.className = 'eq-db'; db.innerHTML = '<span>+12</span><span>0</span><span>-12</span>';
  host.appendChild(db);
  const custom = () => { S.eq.preset = 'Custom'; };
  eqSliders = [eqSlider('PRE', () => S.eq.preamp, (v) => { S.eq.preamp = v; custom(); applyEq(); renderEq(); }, 'pre')];
  EQ_LABELS.forEach((lbl, i) => eqSliders.push(eqSlider(lbl, () => S.eq.gains[i], (v) => { S.eq.gains[i] = v; custom(); applyEq(); renderEq(); })));
  eqSliders.forEach(sl => host.appendChild(sl));
}
function setEqPanel(mode) {
  S.eq.panel = mode; renderEq(); saveSoon();
}
function renderEq() {
  const p = $('#eqPanel');
  p.classList.toggle('min', S.eq.panel === 'min');
  p.classList.toggle('off', !S.eq.on);
  p.classList.toggle('na', engine === 'youtube');
  $('#togEq').classList.toggle('on', S.eq.panel !== 'hidden');
  $('#eqOn').classList.toggle('on', S.eq.on);
  $('#eqMinBtn').innerHTML = S.eq.panel === 'min' ? '&#x25A1;' : '&#x2013;';
  $('#eqMinBtn').title = S.eq.panel === 'min' ? 'Expand equalizer' : 'Minimize equalizer';
  $('#eqSum').textContent = `· ${S.eq.preset.toUpperCase()} · ${S.eq.on ? 'ON' : 'OFF'}${engine === 'youtube' ? ' · N/A FOR YOUTUBE' : ''}`;
  eqSliders.forEach(sl => sl.update());
  drawEqCurve();
  syncWindows();
}
function drawEqCurve() {
  const c = $('#eqCurve'); if (!c || S.eq.panel !== 'open') return;
  const W = c.clientWidth || 300, H = 22;
  if (c.width !== W) c.width = W;
  const x = c.getContext('2d'); x.clearRect(0, 0, W, H);
  x.strokeStyle = T('--eq-curve-axis'); x.beginPath(); x.moveTo(0, H / 2 + .5); x.lineTo(W, H / 2 + .5); x.stroke();
  const g = S.eq.on ? S.eq.gains : EQ_FREQS.map(() => 0);
  x.strokeStyle = S.eq.on ? T('--eq-curve-on') : T('--eq-curve-off'); x.shadowColor = T('--eq-curve-on'); x.shadowBlur = S.eq.on ? 4 : 0; x.lineWidth = 1.5; x.beginPath();
  for (let i = 0; i <= W; i++) {
    const t = i / W * 9, a = Math.floor(t), b = Math.min(9, a + 1), f = t - a;
    const s = f * f * (3 - 2 * f);   // smooth between bands
    const v = g[a] * (1 - s) + g[b] * s + (S.eq.on ? S.eq.preamp * 0.25 : 0);
    const y = H / 2 - v / 12 * (H / 2 - 2);
    if (i) x.lineTo(i, y); else x.moveTo(i, y);
  }
  x.stroke(); x.shadowBlur = 0;
}
function loadEqPreset(name) {
  const g = EQ_PRESETS[name]; if (!g) return;
  S.eq.gains = g.slice(); S.eq.preset = name;
  S.eq.preamp = -Math.round(Math.max(0, ...g) / 2);   // a little headroom so boosts don't clip
  S.eq.on = true;
  applyEq(); renderEq(); saveSoon();
}
function openEqPresets() {
  const m = $('#eqPresets'); m.innerHTML = '';
  for (const name of Object.keys(EQ_PRESETS)) {
    const d = document.createElement('div'); d.textContent = (S.eq.preset === name ? '✓ ' : ' ') + name;
    if (S.eq.preset === name) d.className = 'cur';
    d.onclick = () => { m.classList.add('hidden'); loadEqPreset(name); };
    m.appendChild(d);
  }
  const b = $('#eqPresetsBtn'), r = b.getBoundingClientRect();
  WM.popup(m, { doc: b.ownerDocument, x: r.left, y: r.bottom + 3, flipY: r.top });
}
$('#togEq').onclick = () => setEqPanel(S.eq.panel === 'hidden' ? 'open' : 'hidden');
$('#eqMinBtn').onclick = () => setEqPanel(S.eq.panel === 'min' ? 'open' : 'min');
$('#eqCloseBtn').onclick = () => setEqPanel('hidden');
$('#eqTitle').addEventListener('dblclick', (e) => { if (!e.target.closest('button')) setEqPanel(S.eq.panel === 'min' ? 'open' : 'min'); });
$('#eqOn').onclick = () => { S.eq.on = !S.eq.on; applyEq(); renderEq(); saveSoon(); };
$('#eqReset').onclick = () => { S.eq.gains = EQ_FREQS.map(() => 0); S.eq.preamp = 0; S.eq.preset = 'Flat'; applyEq(); renderEq(); saveSoon(); };
$('#eqPresetsBtn').onclick = (e) => { e.stopPropagation(); if ($('#eqPresets').classList.contains('hidden')) openEqPresets(); else $('#eqPresets').classList.add('hidden'); };
WM.onDocs('mousedown', (e) => { if (!e.target.closest('#eqPresets') && !e.target.closest('#eqPresetsBtn')) $('#eqPresets').classList.add('hidden'); });
WM.onWins('resize', () => drawEqCurve());

// ------------------------------------------------------------------ visualizer
let actx = null, analyser = null, freq = null;
function ensureAudioGraph() {
  if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
  try {
    actx = new AudioContext();
    const src = actx.createMediaElementSource(video);
    analyser = actx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.72;
    // media -> preamp -> 10-band EQ -> analyser (visualizer sees the EQ'd sound) -> speakers
    eqNodes.pre = actx.createGain();
    eqNodes.bands = EQ_FREQS.map((f, i) => {
      const b = actx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f; b.Q.value = 1.1;
      return b;
    });
    let node = src; node.connect(eqNodes.pre); node = eqNodes.pre;
    for (const b of eqNodes.bands) { node.connect(b); node = b; }
    node.connect(analyser); analyser.connect(actx.destination);
    applyEq();
    freq = new Uint8Array(analyser.frequencyBinCount);
  } catch (e) { console.warn('audio graph', e); }
}
const visCtx = $('#vis').getContext('2d');
const BARS = 19; const levels = new Float32Array(BARS); const peaks = new Float32Array(BARS);
let visMode = 0; // 0 bars, 1 scope, 2 off
$('#vis').addEventListener('click', () => { visMode = (visMode + 1) % 3; });
function bandLevels(n, out) {
  const live = analyser && engine === 'local' && status === 'playing';
  if (live) analyser.getByteFrequencyData(freq);
  const bins = freq ? freq.length : 1024;
  for (let i = 0; i < n; i++) {
    let v = 0;
    if (live) {
      const lo = Math.floor(Math.pow(bins * 0.7, i / n)), hi = Math.max(lo + 1, Math.floor(Math.pow(bins * 0.7, (i + 1) / n)));
      for (let k = lo; k < hi; k++) v = Math.max(v, freq[k]);
      v /= 255;
    }
    out[i] = v > out[i] ? v : out[i] * 0.86;
  }
}
const scopeBuf = new Uint8Array(2048);
function drawVis() {
  const c = visCtx, W = 152, H = 34;
  c.clearRect(0, 0, W, H);
  if (visMode === 2) return;
  if (visMode === 1) {
    c.strokeStyle = T('--spectrum-scope'); c.lineWidth = 1; c.beginPath();
    const live = analyser && engine === 'local' && status === 'playing';
    if (live) analyser.getByteTimeDomainData(scopeBuf);
    for (let x = 0; x < W; x++) { const v = live ? scopeBuf[Math.floor(x / W * 1024)] : 128; const y = H / 2 + (v - 128) / 128 * (H / 2); if (x) c.lineTo(x, y); else c.moveTo(x, y); }
    c.stroke(); return;
  }
  bandLevels(BARS, levels);
  const bw = 7, gap = 1;
  for (let i = 0; i < BARS; i++) {
    const h = Math.round(levels[i] * (H - 2));
    peaks[i] = Math.max(peaks[i] - 0.5, h);
    for (let y = 0; y < h; y += 2) {
      const f = y / H; c.fillStyle = f > 0.75 ? T('--spectrum-high') : f > 0.5 ? T('--spectrum-mid') : T('--spectrum-low');
      c.fillRect(i * (bw + gap), H - y - 1, bw, 1);
    }
    if (peaks[i] > 1) { c.fillStyle = T('--spectrum-peak'); c.fillRect(i * (bw + gap), H - Math.round(peaks[i]) - 2, bw, 1); }
  }
}
const big = $('#bigVis'); const bigCtx = big.getContext('2d');
const BIGN = 48; const bigLv = new Float32Array(BIGN);
function drawBigVis() {
  if (!$('#artWrap').classList.contains('show') || $('#artWrap').classList.contains('md')) return;
  const W = big.clientWidth, H = big.clientHeight;
  if (big.width !== W || big.height !== H) { big.width = W; big.height = H; }
  const c = bigCtx; c.clearRect(0, 0, W, H);
  bandLevels(BIGN, bigLv);
  const bw = W / BIGN;
  for (let i = 0; i < BIGN; i++) {
    const h = bigLv[i] * H * 0.42;
    const g = c.createLinearGradient(0, H, 0, H - h);
    g.addColorStop(0, T('--bars-bottom')); g.addColorStop(1, T('--bars-top'));
    c.fillStyle = g; c.fillRect(i * bw + 1, H - h, bw - 2, h);
  }
}

// ------------------------------------------------------------------ playlist UI
const list = $('#list');
function renderList() {
  const frag = document.createDocumentFragment();
  const inHist = histOnScreen();
  renderHistBar();
  if (!S.items.length) {
    const d = document.createElement('div'); d.className = 'pl-empty';
    d.textContent = !inHist ? 'Playlist empty — drop files here or paste a YouTube or X link'
      : hs(histScreenKind()).on ? HK[histScreenKind()].empty : `${HK[histScreenKind()].full} is off and empty.`;
    frag.appendChild(d);
  }
  S.items.forEach((it, i) => {
    const li = document.createElement('li');
    li.dataset.i = i; li.draggable = true;
    if (S.sel.has(it.id)) li.classList.add('sel');
    if (S.tab === S.playTab && i === S.current) li.classList.add('cur');
    if (it.missing) li.classList.add('missing');
    const n = document.createElement('span'); n.className = 'n'; n.textContent = `${i + 1}.`;
    const t = document.createElement('span'); t.className = 't'; t.textContent = it.title;
    t.title = it.path || it.url;
    li.append(n);
    if (it.type === 'x') {
      const tag = document.createElement('span'); tag.className = 'tag x'; tag.textContent = 'X';
      tag.title = localPathOf(it) ? 'X post (downloaded)' : 'X post: download it to play it here (right-click → Download…)';
      li.append(tag);
    } else if (it.type !== 'file') {
      const ytm = it.music || /^https?:\/\/music\./i.test(it.url || '');
      const tag = document.createElement('span'); tag.className = (ytm ? 'tag ytm' : 'tag') + (it.live ? ' live' : ''); tag.textContent = (ytm ? 'YTM' : 'YT') + (it.live ? ' LIVE' : '');
      tag.title = it.live ? 'Live stream (playing now on YouTube)' : ytm ? 'YouTube Music link' : 'YouTube link';
      li.append(tag);
    }
    const dl = DL.get(it.id);
    if (dl && dl.status !== 'done' && dl.status !== 'error' && dl.status !== 'canceled') {
      const tag = document.createElement('span'); tag.className = 'tag dl';
      tag.textContent = dl.status === 'queued' ? '\u21e9 QUEUED' : dl.status === 'downloading' ? `\u21e9 ${Math.floor(dlOverall(dl))}%` : '\u21e9 \u2026';
      li.append(tag);
    } else if (isWeb(it) && (it.localVideo || it.localAudio)) {
      const tag = document.createElement('span'); tag.className = 'tag saved';
      tag.textContent = it.localVideo ? 'SAVED' : 'MP3'; tag.title = `Plays from your downloaded copy:\n${it.localVideo || it.localAudio}`;
      li.append(tag);
    }
    if (it.noEmbed && !localPathOf(it)) { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'WEB ONLY'; tag.title = 'Embedding disabled by owner — opens in browser, or download it'; li.append(tag); }
    const d = document.createElement('span'); d.className = 'd'; d.textContent = it.live ? '' : fmtShort(it.duration);
    if (inHist) { d.textContent = histAgo(it.at); d.classList.add('ago'); t.title = `${it.url}\n${HK[histScreenKind()].when} ${histWhen(it.at)}${it.duration ? ` · ${fmtShort(it.duration)} long` : ''}`; }
    li.append(t, d);
    frag.appendChild(li);
  });
  list.replaceChildren(frag);
  updatePlTime();
  renderTabs();
}
function updatePlTime() {
  const total = S.items.reduce((a, b) => a + (b.duration || 0), 0);
  const selTotal = S.items.filter(i => S.sel.has(i.id)).reduce((a, b) => a + (b.duration || 0), 0);
  $('#plSum').textContent = `\u00b7 ${S.tabs[S.tab].name.toUpperCase()} \u00b7 ${S.items.length}`;   // shown while the playlist is rolled up
  $('#plTime').textContent = `${S.items.length} item${S.items.length === 1 ? '' : 's'} · ${S.sel.size > 1 ? fmtShort(selTotal) + '/' : ''}${fmtShort(total) || '0:00'}`;
}
function scrollToCurrent() {
  const li = list.querySelector('li.cur'); if (li) li.scrollIntoView({ block: 'nearest' });
}
function rowIndex(e) { const li = e.target.closest('li'); return li ? +li.dataset.i : -1; }
// Update selection highlight in place. Rebuilding the rows on every click
// broke double-click (the two clicks landed on different elements).
function updateSelection() {
  for (const li of list.children) {
    const it = S.items[+li.dataset.i];
    if (it) li.classList.toggle('sel', S.sel.has(it.id));
  }
  updatePlTime();
  updateDlButton();
}
list.addEventListener('mousedown', (e) => {
  const i = rowIndex(e); if (i < 0) { if (e.button === 0) { S.sel.clear(); updateSelection(); } return; }
  const id = S.items[i].id;
  if (e.button === 0 && e.detail === 2 && !e.shiftKey && !e.ctrlKey) {
    // second press of a double-click: play this row
    S.sel = new Set([id]); S.anchor = i; updateSelection();
    playIndex(i);
    return;
  }
  if (e.button === 2 && S.sel.has(id)) return;
  if (e.shiftKey && S.anchor >= 0) {
    const [a, b] = [Math.min(S.anchor, i), Math.max(S.anchor, i)];
    if (!e.ctrlKey) S.sel.clear();
    for (let k = a; k <= b; k++) S.sel.add(S.items[k].id);
  } else if (e.ctrlKey) { if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id); S.anchor = i; }
  else { if (!S.sel.has(id) || e.button === 2) { S.sel = new Set([id]); } S.anchor = i; }
  updateSelection();
});
list.addEventListener('click', (e) => {
  const i = rowIndex(e); if (i < 0 || e.shiftKey || e.ctrlKey || e.detail > 1) return;
  S.sel = new Set([S.items[i].id]); S.anchor = i; updateSelection();
});

function removeIds(ids) {
  const set = new Set(ids); if (!set.size) return;
  const cur = S.items[S.current];
  const curRemoved = cur && set.has(cur.id);
  const stopsPlayer = curRemoved && S.tab === S.playTab;
  const firstIdx = S.items.findIndex(i => set.has(i.id));
  S.items = S.items.filter(i => !set.has(i.id));
  S.sel.clear(); S.history = [];
  if (curRemoved && !stopsPlayer) { S.current = -1; }
  else if (curRemoved) {
    stopEngines(); engine = null; S.current = -1; setStatus('stopped'); hideOverlay();
    showLayer(S.items.length ? 'artWrap' : 'empty'); setMarquee(null); updateInfo(null); $('#indSrc').classList.remove('on');
    if (S.items.length) { const ni = Math.min(firstIdx, S.items.length - 1); S.sel.add(S.items[ni].id); }
  } else if (cur) S.current = S.items.indexOf(cur);
  if (!S.items.length) showLayer('empty');
  renderList(); saveSoon();
  if (histOnScreen() && hs(histScreenKind()).mirror) histMirrorSoon(false, histScreenKind());
}
function removeSelected() { removeIds([...S.sel]); }
function clearList() { if (histOnScreen()) { histClear(); return; } if (!S.items.length) return; removeIds(S.items.map(i => i.id)); }
function moveSelected(dir) {
  if (!S.sel.size) return;
  if (histOnScreen()) { toast(histOrderMsg()); return; }
  const cur = S.items[S.current];
  const idx = S.items.map((it, i) => (S.sel.has(it.id) ? i : -1)).filter(i => i >= 0);
  if (dir < 0 && idx[0] === 0) return;
  if (dir > 0 && idx[idx.length - 1] === S.items.length - 1) return;
  const order = dir < 0 ? idx : idx.reverse();
  for (const i of order) { const j = i + dir; [S.items[i], S.items[j]] = [S.items[j], S.items[i]]; }
  if (cur) S.current = S.items.indexOf(cur);
  renderList(); saveSoon();
}
function moveSelectedTo(target) {
  if (histOnScreen()) { toast(histOrderMsg()); return; }
  const cur = S.items[S.current];
  const moving = S.items.filter(i => S.sel.has(i.id));
  const before = S.items.slice(0, target).filter(i => !S.sel.has(i.id)).length;
  const rest = S.items.filter(i => !S.sel.has(i.id));
  rest.splice(before, 0, ...moving);
  S.items = rest;
  if (cur) S.current = S.items.indexOf(cur);
  renderList(); saveSoon();
}

// internal drag-reorder
let draggingInternal = false;
list.addEventListener('dragstart', (e) => {
  const i = rowIndex(e); if (i < 0) return;
  if (!S.sel.has(S.items[i].id)) { S.sel = new Set([S.items[i].id]); renderList(); }
  draggingInternal = true;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('application/x-phosphor', '1');
});
list.addEventListener('dragend', () => { draggingInternal = false; clearDropMarks(); });
function clearDropMarks() { list.querySelectorAll('.drop-before,.drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after')); }
function dropTarget(e) {
  const li = e.target.closest && e.target.closest('#list li');
  if (!li) return { index: S.items.length, li: null, after: true };
  const r = li.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2;
  return { index: +li.dataset.i + (after ? 1 : 0), li, after };
}

// context menu
const ctx = $('#ctx');
list.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const i = rowIndex(e);
  const it = S.items[i];
  const entries = [];
  if (it) {
    entries.push(['Play', () => playIndex(i)]);
    if (it.type === 'file') entries.push(['Show in folder', () => P.showInFolder(it.path)]);
    else {
      const dl = DL.get(it.id);
      const busy = dl && ['queued', 'updating', 'downloading', 'processing'].includes(dl.status);
      if (busy) entries.push(['Cancel download', () => P.dlCancel(it.id)]);
      else entries.push(['Download\u2026', () => openDlMenu(it, { doc: e.target.ownerDocument, x: e.clientX, y: e.clientY })]);
      const lp = it.localVideo || it.localAudio;
      if (lp) { entries.push(['Show local copy in folder', () => P.showInFolder(lp)], ['Delete local copy', () => deleteLocalCopy(it)]); }
      entries.push(['Open in browser', () => P.openExternal(it.url)]);
    }
    const inHist = histOnScreen();
    const others = S.tabs.map((t, k) => [t, k]).filter(([t, k]) => k !== S.tab && !isHist(t));
    if (others.length) { entries.push(null); for (const [t, k] of others.slice(0, 8)) entries.push([`${inHist ? 'Copy' : 'Move'} to "${t.name}"`, () => sendSelectedToTab(k, inHist)]); }
    entries.push(['Copy to new tab', () => { const picked = S.items.filter(x => S.sel.has(x.id)).map(x => ({ ...x, id: nid() })); const n = newTab(); S.tabs[n].items = picked; renderList(); renameTab(n); }]);
    entries.push(null, [`Remove from ${histOnScreen() ? HK[histScreenKind()].full : 'playlist'}${S.sel.size > 1 ? ` (${S.sel.size})` : ''}`, removeSelected]);
  }
  if (histOnScreen()) {          // a History tab fills itself and keeps its own order
    entries.push(null, ['Clear history…', histClear], ['History settings…', () => histMenu($('#histGear') || e.target)]);
    showCtxMenu(entries, e.clientX, e.clientY, e.target.ownerDocument);
    return;
  }
  entries.push(['Add files…', openFiles], ['Add folder…', () => openFiles('folder')], ['Add link…', openUrlDialog]);
  if (S.items.length) entries.push(null, ['Sort by title', () => sortList((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }))], ['Randomize order', () => sortList(() => Math.random() - 0.5)], ['Clear playlist', clearList]);
  showCtxMenu(entries, e.clientX, e.clientY, e.target.ownerDocument);
});
function showCtxMenu(entries, x, y, doc) {
  ctx.innerHTML = '';
  for (const en of entries) {
    if (!en) { ctx.appendChild(document.createElement('hr')); continue; }
    const d = document.createElement('div'); d.textContent = en[0]; d.onclick = () => { hideCtx(); en[1](); }; ctx.appendChild(d);
  }
  WM.popup(ctx, { doc, x, y });
}
function hideCtx() { ctx.classList.add('hidden'); }
WM.onDocs('mousedown', (e) => { if (!ctx.contains(e.target)) hideCtx(); if (!$('#dlMenu').contains(e.target) && e.target !== $('#bDl') && !$('#bDl').contains(e.target)) hideDlMenu(); });
function sortList(fn) { const cur = S.items[S.current]; S.items.sort(fn); if (cur) S.current = S.items.indexOf(cur); renderList(); saveSoon(); }


// ------------------------------------------------------------------ drag & drop / paste
let dragDepth = 0;
WM.onDocs('dragenter', (e) => { e.preventDefault(); if (!draggingInternal) { dragDepth++; WM.host($('#dropHint'), e.target.ownerDocument || document).classList.remove('hidden'); } });
WM.onDocs('dragleave', (e) => { e.preventDefault(); if (!draggingInternal && --dragDepth <= 0) { dragDepth = 0; $('#dropHint').classList.add('hidden'); } });
WM.onDocs('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = draggingInternal ? 'move' : 'copy';
  clearDropMarks();
  const t = dropTarget(e); if (t.li) t.li.classList.add(t.after ? 'drop-after' : 'drop-before');
});
WM.onDocs('drop', async (e) => {
  e.preventDefault(); dragDepth = 0; $('#dropHint').classList.add('hidden');
  const t = dropTarget(e); clearDropMarks();
  const at = t.li ? t.index : undefined;
  if (draggingInternal) { draggingInternal = false; moveSelectedTo(t.index); return; }
  const dt = e.dataTransfer;
  const paths = [...(dt.files || [])].map(f => P.pathForFile(f)).filter(Boolean);
  if (paths.length) { await addPaths(paths, at); return; }
  const text = dt.getData('text/uri-list') || dt.getData('text/plain') || '';
  const urls = extractUrls(text);
  if (urls.length) addUrls(urls, at);
});
WM.onDocs('paste', (e) => {
  if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) return;
  const text = e.clipboardData.getData('text/plain');
  const urls = extractUrls(text);
  if (urls.length) { e.preventDefault(); addUrls(urls); }
  else if (text.trim()) toast('Paste a YouTube video or X post link.');
});

// ------------------------------------------------------------------ Butterchurn visualizer
const MD = { hist: [], viz: null, ok: null, loading: null, keys: [], w: 0, h: 0, lastSwitch: 0, active: false, idleT: 0 };
const MD_CYCLE_MS = 30000;
function mdWanted() {
  return S.vis.mode === 'milkdrop' && MD.ok !== false && engine === 'local' && $('#artWrap').classList.contains('show');
}
async function mdEnsure() {
  if (MD.viz) return true;
  if (MD.ok === false) return false;
  if (!MD.loading) {
    MD.loading = (async () => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) throw new Error('WebGL2 not available');
      if (!window.butterchurn) await loadScript('vendor/butterchurn.min.js');
      if (!window.butterchurnPresets) await loadScript('vendor/butterchurn-presets.js');
      if (!window.butterchurn || !window.butterchurnPresets) throw new Error('visualizer files missing');
      ensureAudioGraph();
      if (!actx || !analyser) throw new Error('no audio graph');
      const c = $('#mdCanvas');
      mdSize(true);
      MD.viz = window.butterchurn.createVisualizer(actx, c, { width: MD.w, height: MD.h, pixelRatio: 1, textureRatio: 1 });
      MD.viz.connectAudio(analyser);
      MD.keys = Object.keys(window.butterchurnPresets).sort((a, b) => a.toLowerCase().replace(/^[^a-z0-9]+/, '').localeCompare(b.toLowerCase().replace(/^[^a-z0-9]+/, '')));
      mdLoad(MD.keys.includes(S.vis.preset) ? S.vis.preset : mdRandomName(), 0);
      MD.ok = true;
      return true;
    })().catch((e) => {
      console.warn('visualizer', e);
      MD.ok = false;
      if (S.vis.mode === 'milkdrop') toast('The Butterchurn visualizer needs 3D graphics (WebGL), which isn’t available here — using BARS.', 4500);
      renderVisBar(); updateVisLayer();
      return false;
    });
  }
  return MD.loading;
}
const isFav = (n) => S.vis.favs.includes(n);
function favPool() { return S.vis.favs.filter(n => MD.keys.includes(n)); }
function mdRandomName() {
  const favs = favPool();
  const pool = S.vis.favOnly && favs.length ? favs : MD.keys;
  const k = pool.filter(x => x !== S.vis.preset);
  return k[Math.floor(Math.random() * k.length)] || pool[0] || MD.keys[0];
}
function toggleFav(name = S.vis.preset) {
  if (!name) return;
  if (isFav(name)) S.vis.favs = S.vis.favs.filter(n => n !== name); else S.vis.favs = [...S.vis.favs, name];
  if (!S.vis.favs.length) S.vis.favOnly = false;
  saveSoon(); renderMdName();
  return isFav(name);
}
function renderMdName() {
  const n = S.vis.preset || '';
  $('#mdName').textContent = `${isFav(n) ? '\u2605' : '\u266b'} ${n}${S.vis.cycle ? '' : '  \u00b7  locked'}`; $('#mdName').title = n;
  $('#mdFav').textContent = isFav(n) ? '\u2605' : '\u2606';
  $('#mdFav').classList.toggle('on', isFav(n));
  $('#mdFav').title = isFav(n) ? 'Remove from favorites (H)' : 'Add to favorites (H)';
}
// MilkDrop-style keys while the visualizer is showing: N random, P previous, K lock, H favorite
function mdKey(k) {
  if (!MD.active || !$('#artWrap').classList.contains('md')) return false;
  if (k === 'n') { mdLoad(mdRandomName(), 1.5); return true; }
  if (k === 'p') { const prev = MD.hist.pop(); if (prev) mdLoad(prev, 1.5, true); else toast('No earlier preset', 1200); return true; }
  if (k === 'k') { S.vis.cycle = !S.vis.cycle; MD.lastSwitch = performance.now(); saveSoon(); renderMdName(); mdShowControls(); toast(S.vis.cycle ? 'Preset unlocked \u2014 changes every 30 s' : '\ud83d\udd12 Preset locked', 1500); return true; }
  if (k === 'h') { const on = toggleFav(); mdShowControls(); toast(on ? '\u2605 Added to favorites' : 'Removed from favorites', 1300); return true; }
  return false;
}
function mdLoad(name, blend = 2.7, fromHistory) {
  if (!MD.viz || !window.butterchurnPresets[name]) return;
  try { MD.viz.loadPreset(window.butterchurnPresets[name], blend); } catch (e) { console.warn('preset', name, e); }
  if (!fromHistory && S.vis.preset && S.vis.preset !== name) { MD.hist.push(S.vis.preset); if (MD.hist.length > 100) MD.hist.shift(); }
  S.vis.preset = name; MD.lastSwitch = performance.now();
  renderMdName();
  mdShowControls(); saveSoon();
}
function mdStep(d) {
  if (!MD.keys.length) return;
  const i = MD.keys.indexOf(S.vis.preset);
  mdLoad(MD.keys[(i + d + MD.keys.length) % MD.keys.length], 1.5);
}
function mdSize(force) {
  const c = $('#mdCanvas');
  const r = $('#artWrap').getBoundingClientRect();
  const scale = Math.min(VW().devicePixelRatio || 1, 1.5);
  let w = Math.max(64, Math.round(r.width * scale)), h = Math.max(48, Math.round(r.height * scale));
  const cap = 1920 / Math.max(w, h * 16 / 9);   // keep 4K fullscreen smooth
  if (cap < 1) { w = Math.round(w * cap); h = Math.round(h * cap); }
  if (!force && w === MD.w && h === MD.h) return;
  MD.w = w; MD.h = h; c.width = w; c.height = h;
  if (MD.viz) MD.viz.setRendererSize(w, h);
}
function mdFrame(now) {
  if (!MD.active) return;
  VW().requestAnimationFrame(mdFrame);     // the visualizer window's own frames (keeps going if the player is covered)
  if (VW().document.hidden || !WM.isShown('video')) return;
  if (WM.state.video.shade && !WM.body.contains('fs')) return;
  mdSize(false);
  if (S.vis.cycle && status === 'playing' && now - MD.lastSwitch > MD_CYCLE_MS) mdLoad(mdRandomName(), 2.7);
  try { MD.viz.render(); MD.errs = 0; } catch (e) {
    // a preset that keeps failing: move on to another one
    if (++MD.errs === 1) console.warn('render', S.vis.preset, e);
    if (MD.errs > 30) { MD.errs = 0; mdLoad(mdRandomName(), 0); }
  }
}
async function updateVisLayer() {
  const want = mdWanted();
  if (want && !(await mdEnsure())) return;
  const on = mdWanted() && !!MD.viz;
  $('#artWrap').classList.toggle('md', on);
  if (on && !MD.active) { MD.active = true; MD.lastSwitch = performance.now(); VW().requestAnimationFrame(mdFrame); mdShowControls(); }
  else if (!on) MD.active = false;
  renderVisBar(); renderVisPanel();
}
function setVisMode(mode) { S.vis.mode = mode; saveSoon(); updateVisLayer(); }
function setVisPanel(p) { S.vis.panel = p; renderVisPanel(); saveSoon(); }
function renderVisPanel() {
  const p = S.vis.panel;
  WM.body.toggle('vismin', p === 'min');
  WM.body.toggle('vishide', p === 'hidden');
  syncWindows();
  $('#togVis').classList.toggle('on', p !== 'hidden');
  $('#visMinBtn').innerHTML = p === 'min' ? '&#x25A1;' : '&#x2013;';
  $('#visMinBtn').title = p === 'min' ? 'Expand visualizer' : 'Minimize visualizer';
  $('#visSum').textContent = WM.body.contains('audvis') ? `\u00b7 ${S.vis.mode === 'milkdrop' && MD.ok !== false ? 'BUTTERCHURN' : 'BARS'}` : '';
  setTimeout(() => { if (MD.active) mdSize(false); }, 0);
}
// The video window's – and ✕: the visualizer (audio) and the video have their own open/rolled-up settings.
function toggleVidShade() {
  if (WM.body.contains('audvis')) setVisPanel(S.vis.panel === 'min' ? 'open' : 'min');
  else { S.vidShade = !S.vidShade; syncWindows(); saveSoon(); }
}
$('#visMinBtn').onclick = toggleVidShade;
$('#visCloseBtn').onclick = () => {
  if (WM.body.contains('audvis')) { setVisPanel('hidden'); toast('Visualizer closed \u2014 click VIS on the player to bring it back.', 2800); }
  else { S.showVideo = false; renderToggles(); saveSoon(); toast('Video window closed \u2014 click VID on the player to bring it back.', 2800); }
};
$('#togVis').onclick = () => setVisPanel(S.vis.panel === 'hidden' ? 'open' : 'hidden');
$('#visTitle').addEventListener('dblclick', (e) => { if (!e.target.closest('button')) toggleVidShade(); });
const togglePlShade = () => { S.plShade = !S.plShade; syncWindows(); saveSoon(); };
$('#plMinBtn').onclick = togglePlShade;
$('#plTitle').addEventListener('dblclick', (e) => { if (!e.target.closest('button')) togglePlShade(); });
function renderVisBar() {
  $('#mdName').classList.toggle('off', !S.vis.showPreset);
  $('#coverCard').classList.toggle('off', !S.vis.showTrack);
  const item = curItem(), img = $('#cover');
  $('#ccTitle').textContent = item ? item.title : '';
  const art = img.classList.contains('has') && img.getAttribute('src');
  $('#ccArt').classList.toggle('hidden', !art);
  if (art) $('#ccArt').src = img.src; else $('#ccArt').removeAttribute('src');
  for (const b of $$('#visSeg button')) b.classList.toggle('on', b.dataset.m === (MD.ok === false ? 'bars' : S.vis.mode));
  const md = S.vis.mode === 'milkdrop' && MD.ok !== false;
  for (const id of ['#mdFav', '#mdPrev', '#mdNext', '#mdPresets']) $(id).classList.toggle('hidden', !md);
  $('#visSeg button[data-m="milkdrop"]').disabled = MD.ok === false;
  $('#visSeg button[data-m="milkdrop"]').title = MD.ok === false ? 'Needs 3D graphics (WebGL), not available on this PC' : 'Butterchurn visualizer';
}
function mdShowControls() {
  const w = $('#artWrap'); w.classList.remove('idle');
  clearTimeout(MD.idleT); MD.idleT = setTimeout(() => w.classList.add('idle'), 3500);
}
function openMdPresets() {
  openPop((add, hr) => {
    $('#popMenu').classList.add('wide');
    const favs = favPool();
    add(`dm-item${S.vis.cycle ? ' cur' : ''}`, 'Change preset every 30 s   (K locks)', () => mdKey('k') || (S.vis.cycle = !S.vis.cycle, saveSoon(), renderMdName()));
    const fo = add(`dm-item${S.vis.favOnly && favs.length ? ' cur' : ''}${favs.length ? '' : ' off'}`, `Only use favorites (${favs.length})`, favs.length ? () => { S.vis.favOnly = !S.vis.favOnly; saveSoon(); toast(S.vis.favOnly ? 'Auto-change and N now pick from your favorites' : 'Using all presets again', 1800); } : null);
    if (!favs.length) fo.title = 'Mark presets with \u2606 (or press H) to build your favorites';
    add('dm-item', '\ud83c\udfb2 Random preset   (N)', () => mdLoad(mdRandomName(), 1.5));
    hr();
    add(`dm-item${S.vis.showTitle ? ' cur' : ''}`, 'Show song title when a track starts', () => { S.vis.showTitle = !S.vis.showTitle; saveSoon(); const it = curItem(); if (S.vis.showTitle && it && MD.viz) { try { MD.viz.launchSongTitleAnim(it.title); } catch (_) {} } });
    add(`dm-item${S.vis.showTrack ? ' cur' : ''}`, 'Show track name (top corner)', () => { S.vis.showTrack = !S.vis.showTrack; saveSoon(); renderVisBar(); });
    add(`dm-item${S.vis.showPreset ? ' cur' : ''}`, 'Show preset name (bottom corner)', () => { S.vis.showPreset = !S.vis.showPreset; saveSoon(); renderVisBar(); });
    hr();
    add('dm-sec', `Presets (${MD.keys.length}) \u00b7 \u2606 = favorite`);
    const q = document.createElement('input'); q.type = 'text'; q.className = 'pm-search'; q.placeholder = 'Search presets (e.g. Geiss, martin, spiral)';
    $('#popMenu').appendChild(q);
    const box = document.createElement('div'); box.className = 'pm-scroll';
    $('#popMenu').appendChild(box);
    const none = document.createElement('div'); none.className = 'dm-note hidden'; none.textContent = 'No presets match.';
    $('#popMenu').appendChild(none);
    add('dm-note', 'Keys: N random \u00b7 P previous \u00b7 K lock \u00b7 H favorite');
    const row = (k) => {
      const d = document.createElement('div'); d.className = `dm-item pm-row${k === S.vis.preset ? ' cur' : ''}`; d.title = k; d.dataset.k = k;
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = k;
      const st = document.createElement('span'); st.className = 'pm-star' + (isFav(k) ? ' on' : ''); st.textContent = isFav(k) ? '\u2605' : '\u2606';
      st.title = isFav(k) ? 'Remove from favorites' : 'Add to favorites';
      st.onclick = (e) => { e.stopPropagation(); const on = toggleFav(k); for (const x of box.querySelectorAll('.pm-row')) if (x.dataset.k === k) { const s2 = x.querySelector('.pm-star'); s2.textContent = on ? '\u2605' : '\u2606'; s2.classList.toggle('on', on); } };
      d.append(nm, st);
      d.onclick = () => { hidePop(); mdLoad(k, 1.5); };
      return d;
    };
    if (favs.length) {
      const h1 = document.createElement('div'); h1.className = 'dm-sec pm-grp'; h1.textContent = `\u2605 Favorites (${favs.length})`; box.appendChild(h1);
      for (const k of favs.slice().sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))) box.appendChild(row(k));
      const h2 = document.createElement('div'); h2.className = 'dm-sec pm-grp'; h2.textContent = 'All presets'; box.appendChild(h2);
    }
    for (const k of MD.keys) box.appendChild(row(k));
    q.addEventListener('input', () => {
      const t = q.value.trim().toLowerCase(); let n = 0;
      for (const d of box.children) {
        if (d.classList.contains('pm-grp')) { d.classList.toggle('hidden', !!t); continue; }
        const hit = !t || d.dataset.k.toLowerCase().includes(t); d.classList.toggle('hidden', !hit); if (hit) n++;
      }
      none.classList.toggle('hidden', n > 0);
    });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hidePop();
      else if (e.key === 'Enter') { const first = [...box.querySelectorAll('.pm-row')].find(d => !d.classList.contains('hidden')); if (first) first.click(); }
    });
    setTimeout(() => q.focus(), 0);
    setTimeout(() => { const c = [...box.querySelectorAll('.pm-row.cur')].pop(); if (c) c.scrollIntoView({ block: 'center' }); }, 0);
  }, $('#mdPresets'));
}
$('#mdFav').onclick = (e) => { e.stopPropagation(); const on = toggleFav(); toast(on ? '\u2605 Added to favorites' : 'Removed from favorites', 1300); };
for (const b of $$('#visSeg button')) b.onclick = (e) => { e.stopPropagation(); setVisMode(b.dataset.m); };
$('#mdPrev').onclick = (e) => { e.stopPropagation(); mdStep(-1); };
$('#mdNext').onclick = (e) => { e.stopPropagation(); mdStep(1); };
$('#mdPresets').onclick = (e) => { e.stopPropagation(); openMdPresets(); };
$('#mdFs').onclick = (e) => { e.stopPropagation(); toggleFullscreen(); };
$('#artWrap').addEventListener('mousemove', mdShowControls);
for (const id of ['#visBar', '#mdName', '#coverCard']) $(id).addEventListener('dblclick', (e) => e.stopPropagation());
VW().document.addEventListener('visibilitychange', () => { if (!VW().document.hidden && MD.active) MD.lastSwitch = performance.now(); });

// ------------------------------------------------------------------ playlist tabs
let renamingTab = -1;
function renderTabs() {
  const strip = $('#tabStrip'); if (!strip) return;
  strip.innerHTML = '';
  S.tabs.forEach((t, i) => {
    const el = document.createElement('div');
    el.className = 'ptab' + (i === S.tab ? ' on' : '') + (i === S.playTab && status !== 'stopped' ? ' playing' : '');
    el.dataset.t = i;
    el.title = `${t.name} — ${t.items.length} item${t.items.length === 1 ? '' : 's'}\nDouble-click to rename, right-click for more`;
    if (i === renamingTab) {
      const inp = document.createElement('input'); inp.value = t.name; inp.maxLength = 40;
      const done = (ok) => { if (renamingTab !== i) return; renamingTab = -1; if (ok && inp.value.trim()) t.name = inp.value.trim(); renderTabs(); saveSoon(); };
      inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); };
      inp.onblur = () => done(true);
      el.append(inp);
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
    } else {
      const pl = document.createElement('i'); pl.className = 'pl';
      if (isHist(t)) {
        el.classList.add('hist');
        const K = HK[histKind(t)];
        el.title = `${K.full} — ${t.items.length} ${t.items.length === 1 ? K.one : K.many}\n${hs(histKind(t)).on ? K.tipOn : `${K.full} is off: nothing new is added.`} Right-click or \u2699 for settings.`;
        pl.className = 'clk'; pl.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.5V8l2.6 1.7"/></svg>';
      }
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = t.name;
      const ct = document.createElement('span'); ct.className = 'ct'; ct.textContent = t.items.length;
      el.append(pl, nm, ct);
    }
    strip.appendChild(el);
  });
  const on = strip.querySelector('.ptab.on'); if (on && renamingTab < 0) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function switchTab(i) {
  if (i < 0 || i >= S.tabs.length || i === S.tab) return;
  S.tab = i; S.sel.clear(); S.anchor = -1; list.scrollTop = 0;
  renderList(); updateDlButton(); saveSoon();
  if (S.tab === S.playTab) scrollToCurrent();
}
function newTab(name, items = []) {
  let n = S.tabs.length + 1; while (S.tabs.some(t => t.name === `Playlist ${n}`)) n++;
  S.tabs.push({ id: 't' + nid(), name: name || `Playlist ${n}`, items, current: -1 });
  switchTab(S.tabs.length - 1);
  return S.tabs.length - 1;
}
function renameTab(i) { if (isHist(S.tabs[i])) { switchTab(i); return; } renamingTab = i; switchTab(i); renderTabs(); }
async function closeTab(i) {
  const t = S.tabs[i]; if (!t) return;
  if (t.items.length && !(await confirmBox(`Close "${t.name}"?`, `This tab has ${t.items.length} item${t.items.length === 1 ? '' : 's'}. Closing it removes the list (your files and downloads are not deleted).`, 'Close tab'))) return;
  if (S.tabs.filter(x => !isHist(x)).length === 1) { S.tab = i; clearList(); t.name = 'Main'; renderTabs(); saveSoon(); return; }   // the last ordinary tab is reset, not closed
  if (i === S.playTab && curItem()) { stopEngines(); engine = null; setStatus('stopped'); hideOverlay(); showLayer('empty'); setMarquee(null); updateInfo(null); }
  S.tabs.splice(i, 1);
  if (S.playTab === i) S.playTab = Math.min(i, S.tabs.length - 1); else if (S.playTab > i) S.playTab--;
  if (S.tab >= i && S.tab > 0) S.tab--;
  S.history = []; S.sel.clear(); S.anchor = -1;
  renderList(); saveSoon();
}
function duplicateTab(i) {
  const t = S.tabs[i];
  S.tabs.splice(i + 1, 0, { id: 't' + nid(), name: `${t.name} copy`.slice(0, 40), items: t.items.map(it => ({ ...it, id: nid() })), current: -1 });
  if (S.playTab > i) S.playTab++;
  switchTab(i + 1);
}
async function saveTabFile(i) { const keep = S.tab; S.tab = i; await savePlaylistFile(); S.tab = keep; }
// Move (or copy, with Ctrl) the selected rows of the visible tab to another tab.
function sendSelectedToTab(ti, copy) {
  const dest = S.tabs[ti]; if (!dest || ti === S.tab || !S.sel.size) return;
  if (isHist(dest)) { toast(histNoAdd(histKind(dest)), 3500); return; }
  const src = S.tabs[S.tab];
  if (isHist(src)) copy = true;          // out of History: always a copy
  const picked = src.items.filter(i => S.sel.has(i.id));
  if (copy) {
    dest.items.push(...picked.map(it => ({ ...it, id: nid() })));
  } else {
    const playing = curItem();
    const movingPlaying = S.tab === S.playTab && picked.includes(playing);
    const keepCur = src.items[src.current];
    src.items = src.items.filter(i => !S.sel.has(i.id));
    src.current = keepCur && !picked.includes(keepCur) ? src.items.indexOf(keepCur) : -1;
    dest.items.push(...picked);
    if (movingPlaying) { S.playTab = ti; dest.current = dest.items.indexOf(playing); S.history = []; }
    S.sel.clear(); S.anchor = -1;
  }
  renderList(); saveSoon();
  toast(`${copy ? 'Copied' : 'Moved'} ${picked.length} item${picked.length === 1 ? '' : 's'} to "${dest.name}"`, 1800);
}
$('#tabAdd').onclick = () => { const i = newTab(); renameTab(i); };
$('#tabStrip').addEventListener('mousedown', (e) => { const el = e.target.closest('.ptab'); if (el && e.button === 0 && !e.target.closest('input')) switchTab(+el.dataset.t); });
$('#tabStrip').addEventListener('dblclick', (e) => { const el = e.target.closest('.ptab'); if (el && !e.target.closest('input')) renameTab(+el.dataset.t); });
$('#tabStrip').addEventListener('wheel', (e) => { e.preventDefault(); $('#tabStrip').scrollLeft += e.deltaY || e.deltaX; }, { passive: false });
$('#tabs').addEventListener('dblclick', (e) => { if (e.target.id === 'tabs' || e.target.id === 'tabStrip') { const i = newTab(); renameTab(i); } });
$('#tabStrip').addEventListener('contextmenu', (e) => {
  const el = e.target.closest('.ptab'); if (!el) return;
  e.preventDefault(); e.stopPropagation();
  const i = +el.dataset.t; const t = S.tabs[i];
  if (isHist(t)) { histMenu(el, histKind(t)); return; }
  const entries = [
    ['Rename…', () => renameTab(i)],
    ['Duplicate', () => duplicateTab(i)],
    ['Save as playlist file…', () => saveTabFile(i)],
    null,
    ['New tab', () => { const n = newTab(); renameTab(n); }],
    ...(i > 0 && !isHist(S.tabs[i - 1]) ? [['Move left', () => moveTab(i, -1)]] : []),
    ...(i < S.tabs.length - 1 ? [['Move right', () => moveTab(i, 1)]] : []),
    null,
    [S.tabs.filter(x => !isHist(x)).length > 1 ? 'Close tab' : 'Clear and reset tab', () => closeTab(i)]
  ];
  showCtxMenu(entries, e.clientX, e.clientY, e.target.ownerDocument);
  void t;
});
function moveTab(i, d) {
  const j = i + d; if (j < 0 || j >= S.tabs.length) return;
  if (isHist(S.tabs[i]) || isHist(S.tabs[j])) return;   // History tabs stay first
  const mapIdx = (k) => (k === i ? j : k === j ? i : k);
  [S.tabs[i], S.tabs[j]] = [S.tabs[j], S.tabs[i]];
  S.tab = mapIdx(S.tab); S.playTab = mapIdx(S.playTab);
  renderTabs(); saveSoon();
}
// Drag playlist rows onto a tab: move (hold Ctrl to copy).
$('#tabStrip').addEventListener('dragover', (e) => {
  const el = e.target.closest('.ptab'); if (!el || !draggingInternal) return;
  e.preventDefault(); e.stopPropagation();
  e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
  for (const x of $('#tabStrip').children) x.classList.toggle('drop', x === el && +el.dataset.t !== S.tab);
});
$('#tabStrip').addEventListener('dragleave', (e) => { const el = e.target.closest('.ptab'); if (el) el.classList.remove('drop'); });
$('#tabStrip').addEventListener('drop', (e) => {
  const el = e.target.closest('.ptab'); if (!el || !draggingInternal) return;
  e.preventDefault(); e.stopPropagation();
  draggingInternal = false; clearDropMarks();
  for (const x of $('#tabStrip').children) x.classList.remove('drop');
  sendSelectedToTab(+el.dataset.t, e.ctrlKey);
});

// ------------------------------------------------------------------ History tabs (2.2): YouTube History (#7) and X History (#11)
// Built-in playlist tabs that fill themselves, pinned first in the tab strip (YT History, then X History).
//  - YouTube History (id "history"): every YouTube video whose playback really starts (also a downloaded
//    copy of one; never files or X; a blocked or unreachable video didn't play, so it isn't added).
//  - X History (id "xhistory"): every X post whose download FINISHES (video or MP3). Play on X, Skip, a
//    failed or canceled download, or an X post that isn't downloaded never add anything. Playing a
//    downloaded post later only touches its existing entry (see histXPlayed).
// Entries are copies of the item plus `at` (when it was watched / downloaded). Each kind has its own
// settings (S.hist / S.xhist), changed from the ⚙ menu on the tab's strip or a right-click on the tab;
// both are saved silently with the session, and (setting, default on) mirrored to Playlists\<name>.m3u8.
const HIST_DEF = { on: true, mirror: true, order: 'newest', replay: 'bump', cap: 100 };
const HIST_CAPS = [50, 100, 250, 500];
const HK = {
  yt: { id: 'history', label: 'YT History', full: 'YouTube History', type: 'youtube', file: 'YouTube History.m3u8', state: 'hist',
    record: 'Record YouTube plays', again: 'When a video plays again', one: 'video', many: 'videos', when: 'Watched',
    replay: { bump: 'replays move up', keep: 'replays stay put', dup: 'replays added again' },
    offRest: '· new YouTube plays aren’t added', tipOn: 'Every YouTube video you play is added here.',
    empty: 'YouTube History is empty. YouTube videos you play show up here.',
    note: 'Saved automatically, no pop-ups. Only YouTube videos are recorded (not your files or X posts).' },
  x: { id: 'xhistory', label: 'X History', full: 'X History', type: 'x', file: 'X History.m3u8', state: 'xhist',
    record: 'Record X downloads', again: 'When a post is downloaded again', one: 'post', many: 'posts', when: 'Downloaded or last played',
    replay: { bump: 're-downloads move up', keep: 're-downloads stay put', dup: 're-downloads added again' },
    offRest: '· new X downloads aren’t added', tipOn: 'Every X post you download is added here.',
    empty: 'X History is empty. X posts you download show up here.',
    note: 'Saved automatically, no pop-ups. Only finished X downloads are recorded (not Play on X, skips or failed downloads).' }
};
const HIST_KINDS = ['yt', 'x'];
S.hist = { ...HIST_DEF }; S.xhist = { ...HIST_DEF };
const HIST_ID = HK.yt.id;
const hs = (k = 'yt') => S[HK[k].state];
const histKind = (t) => (t ? HIST_KINDS.find(k => HK[k].id === t.id) || null : null);
const isHist = (t) => !!histKind(t);
const histTab = (k = 'yt') => S.tabs.find(t => t.id === HK[k].id) || null;
const histScreenKind = () => histKind(S.tabs[S.tab]);
const histOnScreen = () => !!histScreenKind();
const histIsDefault = (k = 'yt') => Object.keys(HIST_DEF).every(key => hs(k)[key] === HIST_DEF[key]);
const histNoAdd = (k = histScreenKind() || 'yt') => `${HK[k].full} fills itself${k === 'x' ? ' when X downloads finish' : ' as you watch'}. Add things to another tab.`;
const histOrderMsg = (k = histScreenKind() || 'yt') => `${HK[k].full} keeps its own order (⚙ Settings → Order).`;
let histPending = null;   // the item of the current play, until its playback really starts
let histDirs = null;
P.dlInfo().then(i => { histDirs = i && i.dirs; }).catch(() => {});

// the tabs: History tabs first, in HIST_KINDS order; there's always at least one ordinary tab too
function histEnsureTab(k = 'yt') {
  let t = histTab(k);
  if (t) return t;
  t = { id: HK[k].id, name: HK[k].label, items: [], current: -1 };
  const pos = HIST_KINDS.slice(0, HIST_KINDS.indexOf(k)).filter(x => histTab(x)).length;
  S.tabs.splice(pos, 0, t);
  if (S.tab >= pos) S.tab++; if (S.playTab >= pos) S.playTab++; if (renamingTab >= pos) renamingTab++;
  renderList(); saveSoon();
  return t;
}
function histHideTab(k = 'yt') {
  const i = S.tabs.findIndex(t => t.id === HK[k].id); if (i < 0) return;
  if (!S.tabs.some(t => !isHist(t))) S.tabs.push({ id: 't' + nid(), name: 'Main', items: [], current: -1 });
  if (i === S.playTab && curItem()) { stopEngines(); engine = null; setStatus('stopped'); hideOverlay(); showLayer('empty'); setMarquee(null); updateInfo(null); }
  S.tabs.splice(i, 1);
  if (S.playTab === i) S.playTab = S.tabs.findIndex(t => !isHist(t)); else if (S.playTab > i) S.playTab--;
  if (S.tab === i) S.tab = S.tabs.findIndex(t => !isHist(t)); else if (S.tab > i) S.tab--;
  S.history = []; S.sel.clear(); S.anchor = -1;
  renderList(); saveSoon();
}
// "when" for a row: now, 12m, 3h (earlier today), yday, Mon (this week), Oct 19 (older; with the year if not this one)
function histAgo(ms) {
  if (!ms) return '';
  const now = new Date(), s = (now - ms) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= day0) return `${Math.floor(s / 3600)}h`;
  if (ms >= day0 - 864e5) return 'yday';
  const d = new Date(ms);
  if (ms >= day0 - 6 * 864e5) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', d.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: '2-digit' });
}
const histWhen = (ms) => (ms ? new Date(ms).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'unknown');
const histCopy = (item) => {
  const c = { id: nid(), type: item.type, url: item.url, vid: item.vid, title: item.title, duration: item.duration || 0, hasVideo: item.hasVideo !== false, at: Date.now() };
  for (const key of ['music', 'live', 'noEmbed', 'localVideo', 'localAudio']) if (item[key]) c[key] = item[key];
  return c;
};
// add a copy of `item` to History k following its "again" rule (bump / keep / dup)
function histAdd(k, item) {
  const t = histTab(k), h = hs(k);
  if (!h.on || !t) return;
  const items = t.items, cur = items[t.current];
  const same = items.find(i => i.vid === item.vid);
  if (same && h.replay === 'keep') { histChanged(k, true); return; }       // "Leave it where it is" (its file links are already updated)
  const copy = histCopy(item);
  if (same) for (const key of ['localVideo', 'localAudio']) if (!copy[key] && same[key]) copy[key] = same[key];   // keep every download of it
  if (same && h.replay === 'bump') items.splice(items.indexOf(same), 1);
  if (h.order === 'newest') items.unshift(copy); else items.push(copy);
  histTrim(t, k);
  t.current = cur ? items.indexOf(cur) : -1;
  histChanged(k, true);
}

// ---- recording
function histStarted(item) {      // playback really started (YouTube playing / a local copy playing)
  if (!item || item !== histPending) return;
  histPending = null;
  if (item.type === 'x') { histXPlayed(item); return; }
  if (item.type !== 'youtube' || !item.vid) return;
  const t = histTab('yt');
  if (t && t.items.includes(item)) { item.at = Date.now(); histChanged('yt', false); return; }   // played from History itself: only the time
  histAdd('yt', item);
}
// X History: a finished X download (called by linkDownload once the item has its file)
function histXDownloaded(item) {
  if (!item || item.type !== 'x' || !item.vid || !localPathOf(item)) return;
  const t = histTab('x');
  if (t && t.items.includes(item)) { item.at = Date.now(); histChanged('x', true); return; }   // downloaded again from X History itself
  histAdd('x', item);
}
// X History: a downloaded X post played. Plays never add entries; under "Move it up" its entry moves up
// to newest with the new time, under "Add it again" only the time changes, under "Leave it" nothing does.
// Played from inside X History: only the time (no reshuffle), like YouTube History.
function histXPlayed(item) {
  const t = histTab('x'); if (!t || !item.vid) return;
  if (t.items.includes(item)) { item.at = Date.now(); histChanged('x', false); return; }
  const h = hs('x'); if (!h.on || h.replay === 'keep') return;
  const same = t.items.filter(i => i.vid === item.vid); if (!same.length) return;
  const e = h.order === 'newest' ? same[0] : same[same.length - 1];
  e.at = Date.now();
  if (h.replay === 'bump') {
    const cur = t.items[t.current];
    t.items.splice(t.items.indexOf(e), 1);
    if (h.order === 'newest') t.items.unshift(e); else t.items.push(e);
    t.current = cur ? t.items.indexOf(cur) : -1;
  }
  histChanged('x', h.replay === 'bump');
}
// drop the oldest entries beyond Keep. The entry playing right now is never dropped (it goes on the
// next change instead), so a History can briefly hold one more than Keep. Returns how many went.
function histTrim(t, k = histKind(t), cap = hs(k).cap) {
  if (!cap || t.items.length <= cap) return 0;
  const playing = PT() === t ? curItem() : null, cur = t.items[t.current];
  const newest = hs(k).order === 'newest';
  const oldestFirst = newest ? t.items.slice().reverse() : t.items.slice();   // oldest ... newest
  let extra = t.items.length - cap;
  const drop = new Set();
  for (const it of oldestFirst) { if (!extra) break; if (it === playing) continue; drop.add(it); extra--; }
  t.items = t.items.filter(it => !drop.has(it));
  t.current = cur ? t.items.indexOf(cur) : -1;
  return drop.size;
}
const histMirrorT = {};
function histChanged(k, listChanged) {
  if (histOnScreen()) renderList(); else renderTabs();
  saveSoon();
  if (listChanged && hs(k).mirror) histMirrorSoon(false, k);
}
function histMirrorSoon(now, k = histScreenKind() || 'yt') {
  clearTimeout(histMirrorT[k]);
  const go = () => { const t = histTab(k); if (!t || !hs(k).mirror) return Promise.resolve(null); return P.histMirror(t.items.map(({ type, url, title, duration }) => ({ type, url, title, duration })), k); };
  if (now) return go();
  histMirrorT[k] = setTimeout(go, 1500);
  return null;
}
function histFixTitle(it) {        // a YouTube title that came in after the video was recorded
  const t = histTab('yt'); if (!t || it.type !== 'youtube') return;
  let n = 0;
  for (const h of t.items) if (h !== it && h.vid === it.vid && placeholderTitle(h) && !placeholderTitle(it)) { h.title = it.title; n++; }
  if (n) histChanged('yt', true);
}

// ---- settings
const histN = (k, n) => `${n} older ${n === 1 ? HK[k].one : HK[k].many}`;
async function histSet(patch, k = 'yt') {
  const t = histTab(k), cur0 = hs(k), next = { ...cur0, ...patch };
  if (t && next.cap && t.items.length > next.cap && next.cap !== cur0.cap) {
    const n = t.items.length - next.cap;
    if (!await confirmBox(`Keep fewer ${HK[k].many}?`, `This removes ${histN(k, n)} from ${HK[k].full}.`, 'Remove')) return false;
  }
  const flip = t && next.order !== cur0.order;
  const mirrorOn = next.mirror && !cur0.mirror;
  S[HK[k].state] = next;
  if (next.on) histEnsureTab(k);
  const h = histTab(k);
  if (h) {
    if (flip) { const cur = h.items[h.current]; h.items.reverse(); h.current = cur ? h.items.indexOf(cur) : -1; }
    histTrim(h, k);
    if (!next.on && !h.items.length) histHideTab(k);   // off + empty: the tab goes (Layout → brings it back)
  }
  histChanged(k, true);
  if (mirrorOn) histMirrorSoon(true, k);
  return true;
}
async function histClear(k = histScreenKind() || 'yt') {
  const t = histTab(k); if (!t) return;
  const n = t.items.length;
  if (n && !await confirmBox(`Clear ${HK[k].full}?`, `This removes all ${n} ${n === 1 ? HK[k].one : HK[k].many} from ${HK[k].full}. Your downloads and other playlists aren’t touched.`, 'Clear')) return;
  if (PT() === t && curItem()) { stopEngines(); engine = null; setStatus('stopped'); hideOverlay(); showLayer('empty'); setMarquee(null); updateInfo(null); }
  t.items = []; t.current = -1; S.sel.clear(); S.anchor = -1;
  if (!hs(k).on) { histHideTab(k); histMirrorSoon(true, k); toast(`${HK[k].full} cleared and hidden. Layout → ${HK[k].full} brings it back.`, 4000); return; }
  histChanged(k, true);
}
async function histSaveCopy(k = histScreenKind() || 'yt') {
  const t = histTab(k); if (!t || !t.items.length) { toast(`${HK[k].full} is empty — nothing to save.`); return; }
  const res = await P.savePlaylist(t.items.map(({ type, path, url, title, duration }) => ({ type, path, url, title, duration })), `${HK[k].full} (copy)`);
  if (res && res.saved) toast(`Playlist saved: ${res.name}`);
  else if (res && res.error) toast(`Couldn’t save: ${res.error}`, 4000);
  if ($('#dlmDlg').open) dlmRefresh();
}
async function histQuickSave(k = histScreenKind() || 'yt') {     // QUICK SAVE on a History: write its synced copy now
  const res = await P.histMirror(histTab(k).items.map(({ type, url, title, duration }) => ({ type, url, title, duration })), k);
  if (res && res.ok) toast(`✓ Saved "${res.name}"`, 2200); else toast(`Couldn’t save: ${(res && res.error) || 'unknown error'}`, 4000);
  if ($('#dlmDlg').open) dlmRefresh();
}
let histCapKind = 'yt';
function histCustomCap(k = 'yt') {
  histCapKind = k;
  const d = $('#histCapDlg'), inp = $('#histCapIn');
  $('#histCapNote').textContent = `${HK[k].full} keeps this many of the newest ${HK[k].many} and removes older ones.`;
  $('#histCapTitle').textContent = `Keep how many ${HK[k].many}?`;
  inp.value = hs(k).cap || 100;
  d.returnValue = '';
  d.showModal(); setTimeout(() => { inp.focus(); inp.select(); }, 0);
}
$('#histCapDlg').addEventListener('close', () => {
  if ($('#histCapDlg').returnValue !== 'ok') return;
  const n = Math.round(Number($('#histCapIn').value));
  if (!(n >= 1 && n <= 100000)) { toast('Pick a number from 1 to 100,000.'); return; }
  histSet({ cap: n }, histCapKind);
});
$('#histCapIn').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); $('#histCapDlg').close('ok'); } });
function histMenu(anchor, k = histScreenKind() || 'yt') {
  const h = hs(k), K = HK[k], set = (p) => () => histSet(p, k);
  openPop((add, hr) => {
    add('dm-sec', K.full);
    add('dm-item' + (h.on ? ' cur' : ''), K.record, set({ on: !h.on }), h.on ? K.tipOn : `${K.full} is off: nothing new is added`);
    const file = `${(histDirs && histDirs.playlists) || 'Downloads\\SlopAMP\\Playlists'}\\${K.file}`;
    add('dm-item' + (h.mirror ? ' cur' : ''), 'Keep a synced copy in Playlists', set({ mirror: !h.mirror }), `${file}\nUpdated by itself whenever ${K.full} changes (shows in Library → Playlists).`);
    hr(); add('dm-sec', 'Order');
    add('dm-item' + (h.order === 'newest' ? ' cur' : ''), 'Newest at the top', set({ order: 'newest' }));
    add('dm-item' + (h.order === 'oldest' ? ' cur' : ''), 'Oldest at the top', set({ order: 'oldest' }));
    add('dm-sec', K.again);
    add('dm-item' + (h.replay === 'bump' ? ' cur' : ''), 'Move it up to newest', set({ replay: 'bump' }));
    add('dm-item' + (h.replay === 'keep' ? ' cur' : ''), 'Leave it where it is', set({ replay: 'keep' }));
    add('dm-item' + (h.replay === 'dup' ? ' cur' : ''), 'Add it again (keep both)', set({ replay: 'dup' }));
    add('dm-sec', 'Keep');
    for (const n of HIST_CAPS) add('dm-item' + (h.cap === n ? ' cur' : ''), `Last ${n}`, set({ cap: n }));
    const custom = h.cap && !HIST_CAPS.includes(h.cap);
    add('dm-item' + (custom ? ' cur' : ''), custom ? `Custom… (${h.cap})` : 'Custom…', () => histCustomCap(k));
    add('dm-item' + (!h.cap ? ' cur' : ''), 'No limit', set({ cap: 0 }));
    hr();
    add('dm-item', 'Save a copy as playlist file…', () => histSaveCopy(k), 'A normal playlist file you can edit, merge and combine');
    add('dm-item', 'Clear history…', () => histClear(k));
    if (histIsDefault(k)) add('dm-item off', 'Restore default options', null, 'Already at the defaults');
    else add('dm-item', 'Restore default options', () => histSet({ ...HIST_DEF }, k), `Record on · newest at the top · ${K.replay.bump} · keep last 100 · synced copy on`);
    add('dm-note wrap', K.note);
  }, anchor);
}
// the strip at the top of a History tab: what it does right now
function renderHistBar() {
  const b = $('#histBar'); if (!b) return;
  const k = histScreenKind();
  b.classList.toggle('hidden', !k);
  if (!k) return;
  const h = hs(k), K = HK[k];
  b.classList.toggle('off', !h.on);
  const rest = h.on ? `· ${h.order === 'newest' ? 'newest first' : 'oldest first'} · ${h.cap ? `keeps ${h.cap}` : 'keeps all'} · ${K.replay[h.replay]}` : K.offRest;
  b.innerHTML = `<i class="rec"></i><b>${h.on ? 'Recording' : `${k === 'x' ? 'X History' : 'History'} is off`}</b><span class="hb-rest"></span><span class="sp"></span>${h.on ? '' : '<button type="button" class="on-btn" id="histOn">Turn on</button>'}<button type="button" id="histGear" title="${K.full} settings">${h.on ? '⚙ Settings' : '⚙'}</button>`;
  b.querySelector('.hb-rest').textContent = rest;
}
$('#histBar').addEventListener('click', (e) => {
  const k = histScreenKind(); if (!k) return;
  if (e.target.closest('#histGear')) histMenu(e.target.closest('#histGear'), k);
  else if (e.target.closest('#histOn')) histSet({ on: true }, k);
});
setInterval(() => {     // keep "12m" / "3h" current
  const k = histScreenKind(); if (!k) return;
  const t = histTab(k);
  for (const li of list.children) { const it = t.items[+li.dataset.i], d = it && li.querySelector('.d'); if (d) d.textContent = histAgo(it.at); }
}, 60000);
const histOpener = (k) => ({ visible: () => !!histTab(k), open: () => { if (!histTab(k)) { hs(k).on = true; histEnsureTab(k); } switchTab(S.tabs.findIndex(t => t.id === HK[k].id)); renderList(); saveSoon(); } });
WM.history = histOpener('yt');
WM.xhistory = histOpener('x');

// ------------------------------------------------------------------ dialogs
async function openFiles(kind) { const res = await P.openDialog(kind === 'folder' ? 'folder' : 'files'); if (res && res.length) addDescribed(res); }
// ---- playlist files (.m3u8)
async function quickSavePlaylist() {
  if (histOnScreen()) { histQuickSave(); return; }
  const tab = S.tabs[S.tab];
  if (!tab.items.length) { toast('This tab is empty \u2014 nothing to save.'); return; }
  const res = await P.quickSave(tab.items.map(({ type, path, url, title, duration }) => ({ type, path, url, title, duration })), tab.name);
  if (res && res.saved) toast(`\u2713 Saved "${res.name}" (${tab.items.length} item${tab.items.length === 1 ? '' : 's'})`, 2200);
  else toast(`Couldn\u2019t save: ${(res && res.error) || 'unknown error'}`, 4000);
  if ($('#dlmDlg').open) dlmRefresh();
}
async function quickSaveAll() {
  const tabs = S.tabs.filter(t => !isHist(t)).map(t => ({ name: t.name, items: t.items.map(({ type, path, url, title, duration }) => ({ type, path, url, title, duration })) }));
  const empty = tabs.filter(t => !t.items.length).length;
  if (empty === tabs.length) { toast('All tabs are empty \u2014 nothing to save.'); return; }
  const res = await P.quickSaveAll(tabs);
  const ok = res.filter(r => r.ok).length, bad = res.length - ok;
  const extra = [empty ? `${empty} empty tab${empty === 1 ? '' : 's'} skipped` : '', bad ? `${bad} failed` : ''].filter(Boolean).join(', ');
  toast(`${bad ? '' : '\u2713 '}Saved ${ok} playlist${ok === 1 ? '' : 's'}${extra ? ` (${extra})` : ''}`, 2600);
  if ($('#dlmDlg').open) dlmRefresh();
}
async function savePlaylistFile() {
  if (histOnScreen()) { histSaveCopy(); return; }
  if (!S.items.length) { toast('The playlist is empty — nothing to save.'); return; }
  const res = await P.savePlaylist(S.items.map(({ type, path, url, title, duration }) => ({ type, path, url, title, duration })), S.tabs[S.tab].name);
  if (res && res.saved) toast(`Playlist saved: ${res.name}`);
  else if (res && res.error) toast(`Couldn\u2019t save playlist: ${res.error}`, 4000);
}
function askLoadMode(name, count) {
  return new Promise((resolve) => {
    const d = $('#loadDlg');
    $('#loadDlgText').textContent = `"${name}" has ${count} item${count === 1 ? '' : 's'}. Open it in a new tab, add it to the end of this one, or replace this tab?`;
    d.returnValue = 'cancel';
    d.addEventListener('close', () => resolve(d.returnValue === 'cancel' ? null : d.returnValue), { once: true });
    d.showModal(); setTimeout(() => $('#loadReplace').focus(), 0);
  });
}
async function loadPlaylistFile() {
  const res = await P.loadPlaylist();
  if (!res || res.canceled) return;
  if (!res.entries || !res.entries.length) { toast('That playlist is empty or has nothing SlopAMP can play.'); return; }
  let mode = 'replace';
  if (histOnScreen()) mode = 'newtab';          // never into a History tab
  else if (S.items.length) { mode = await askLoadMode(res.name, res.entries.length); if (!mode) return; }
  if (mode === 'newtab') { newTab(res.name.replace(/\.(m3u8?|pls)$/i, '').slice(0, 40)); mode = 'replace'; }
  if (mode === 'replace' && S.items.length) removeIds(S.items.map(i => i.id));
  const added = addDescribed(res.entries, undefined, false);
  if (!added.length) return;
  const missing = added.filter(i => i.missing).length;
  toast(`Loaded ${added.length} item${added.length === 1 ? '' : 's'} from ${res.name}${missing ? ` (${missing} file${missing === 1 ? '' : 's'} not found)` : ''}`, 3500);
  if (mode === 'replace') { S.sel = new Set([added[0].id]); S.anchor = 0; renderList(); setMarquee(added[0]); list.scrollTop = 0; }
}

function openUrlDialog() {
  const d = $('#urlDlg'); $('#urlText').value = '';
  d.showModal(); setTimeout(() => $('#urlText').focus(), 0);
}
$('#urlDlg').addEventListener('close', () => { if ($('#urlDlg').returnValue === 'ok') { const urls = extractUrls($('#urlText').value); if (urls.length) addUrls(urls); } });
$('#urlText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); $('#urlDlg').close('ok'); } });
async function openAbout() {
  const info = await P.info();
  $('#aboutVer').textContent = `version ${info.version}`;
  $('#licFrame').classList.add('hidden'); $('#aboutLic').textContent = 'View licenses';
  $('#aboutEnc').textContent = info.hasFfmpeg ? `FFmpeg ready · video converter: ${info.encoder || 'detecting…'}` : 'FFmpeg not found — only natively supported formats will play.';
  $('#aboutDlg').showModal();
}
$('#aboutLic').onclick = () => {
  const f = $('#licFrame'); const show = f.classList.contains('hidden');
  if (show && !f.getAttribute('src')) f.src = 'licenses.html';
  f.classList.toggle('hidden', !show);
  $('#aboutLic').textContent = show ? 'Hide licenses' : 'View licenses';
};
for (const a of $$('.about-links a')) a.onclick = (e) => { e.preventDefault(); P.openExternal(a.dataset.url); };

// ------------------------------------------------------------------ auto-updates (main process: updater.js)
let UPD = { status: 'idle' };
const updLocal = { notNow: false, hideUpdated: false, countdown: 0, timer: null, updatedTimer: null };
const UPD_ICON = {
  bolt: '<svg class="ico" viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>',
  down: '<svg class="ico" viewBox="0 0 16 16"><path d="M7 1h2v7l2.5-2.5 1.4 1.4L8 11.8 3.1 6.9l1.4-1.4L7 8zM2 13h12v2H2z"/></svg>',
  shield: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5zm-1.2 14.2-4-4 1.4-1.4 2.6 2.6 5-5 1.4 1.4z"/></svg>',
  warn: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 2 1 21h22zm-1 7h2v6h-2zm0 8h2v2h-2z"/></svg>'
};
const updEsc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const updMB = (n) => `${Math.round((n || 0) / 1048576)} MB`;
const UPD_ERROR_TIPS = {
  badhash: 'The downloaded installer didn’t match the SHA256 in the release notes, so it was deleted and nothing was installed.',
  nohash: 'The release notes have no SHA256 line for the installer, so SlopAMP won’t install it.',
  noasset: 'The release has no SlopAMP-Setup installer.'
};
const UPD_ERRORS = {
  badhash: 'Update stopped: checksum didn’t match',
  nohash: 'Update stopped: no checksum in the release',
  noasset: 'Update stopped: no installer in the release',
  download: 'Update download failed',
  offline: 'Couldn’t reach GitHub to check for updates'
};
// Release notes (GitHub Markdown) -> safe HTML: headings, bullets, paragraphs, **bold**, `code`, [links](https://...).
function updNotesHtml(md) {
  const inline = (t) => updEsc(t)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, (_m, txt, url) => `<a href="#" data-url="${url}">${txt}</a>`);
  let html = '', list = false;
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trim();
    const li = /^[-*+]\s+(.*)$/.exec(line);
    if (list && !li) { html += '</ul>'; list = false; }
    if (!line) continue;
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) html += `<h4>${inline(h[1])}</h4>`;
    else if (li) { if (!list) { html += '<ul>'; list = true; } html += `<li>${inline(li[1])}</li>`; }
    else html += `<p>${inline(line)}</p>`;
  }
  if (list) html += '</ul>';
  return html || '<p>No release notes.</p>';
}
function updBarHtml(st) {
  const r = st.release || {}, v = `<b>${updEsc(r.version || '')}</b>`;
  const x = '<button class="x" data-a="dismiss" title="Hide">&#x2715;</button>';
  switch (st.status) {
    case 'available': return st.canInstall
      ? `${UPD_ICON.bolt}<span class="msg">SlopAMP ${v} is out</span><button class="link" data-a="notes">What’s new</button><button data-a="notes">Install update…</button>${x}`
      : `${UPD_ICON.bolt}<span class="msg">SlopAMP ${v} is out (portable)</span><button class="link" data-a="notes">What’s new</button><button data-a="page">Download page</button>${x}`;
    case 'downloading': {
      const p = st.total ? Math.min(100, Math.floor(st.received / st.total * 100)) : 0;
      const bg = st.mode === 'auto' && !st.installAfter;
      const msg = bg ? `Downloading ${v} in the background… ${p}%` : `Downloading… ${p}% <span class="sub">${Math.round((st.received || 0) / 1048576)} of ${updMB(st.total)}</span>`;
      const tip = bg ? 'Install automatically is on. SlopAMP asks before it restarts.' : '';
      return `${UPD_ICON.down}<span class="msg" title="${tip}">${msg}</span><span class="prog line"><i style="width:${p}%"></i></span><button class="link" data-a="cancel">Cancel</button>`;
    }
    case 'verifying': return `${UPD_ICON.shield}<span class="msg">Verifying… <span class="sub">checking the SHA256</span></span>`;
    case 'ready': return st.installAfter && !updLocal.notNow
      ? `${UPD_ICON.shield}<span class="msg" title="SlopAMP will close, install the update and reopen"><b>Verified.</b> Restarting in ${updLocal.countdown} s</span><button data-a="install">Restart and install</button><button class="link" data-a="notnow">Not now</button>`
      : `${UPD_ICON.bolt}<span class="msg">SlopAMP ${v} is ready</span><button class="link" data-a="notes">What’s new</button><button data-a="install">Restart and install</button>${x}`;
    case 'installing': return `${UPD_ICON.shield}<span class="msg">Installing ${v}… SlopAMP will reopen by itself</span>`;
    case 'updated': return updLocal.hideUpdated ? '' : `${UPD_ICON.bolt}<span class="msg">Updated to ${v}</span><button class="link" data-a="notes">What’s new</button>${x}`;
    case 'error':
      if (st.error === 'offline') return st.manual ? `${UPD_ICON.warn}<span class="msg">${UPD_ERRORS.offline}</span><button data-a="check">Try again</button>${x}` : '';
      if (st.error === 'download') return `${UPD_ICON.warn}<span class="msg">${UPD_ERRORS.download}</span><button data-a="retry">Try again</button><button data-a="page">Download page</button>${x}`;
      return `${UPD_ICON.warn}<span class="msg" title="${UPD_ERROR_TIPS[st.error] || ''}">${UPD_ERRORS[st.error] || UPD_ERRORS.download}</span><button data-a="page">Download page</button>${x}`;
    default: return '';
  }
}
function renderUpd() {
  const st = UPD, bar = $('#updBar');
  // 5-second countdown after "Update and restart", so a song isn't cut off by surprise.
  const counting = st.status === 'ready' && st.installAfter && !updLocal.notNow;
  if (counting && !updLocal.timer) {
    updLocal.countdown = 5;
    updLocal.timer = setInterval(() => {
      if (--updLocal.countdown <= 0) { clearInterval(updLocal.timer); updLocal.timer = null; P.updInstall(); } else renderUpd();
    }, 1000);
  } else if (!counting && updLocal.timer) { clearInterval(updLocal.timer); updLocal.timer = null; }
  if (st.status === 'updated' && !updLocal.updatedTimer) updLocal.updatedTimer = setTimeout(() => { updLocal.hideUpdated = true; renderUpd(); }, 15000);
  const html = st.hidden ? '' : updBarHtml(st);
  bar.innerHTML = html;
  bar.className = html ? (st.status === 'error' ? (st.error === 'offline' ? 'warn' : 'err') : '') : 'hidden';
  const waiting = ['available', 'downloading', 'verifying', 'ready'].includes(st.status) || (st.status === 'error' && st.error !== 'offline' && !!st.release);
  $('.logo-dot').classList.toggle('has-upd', waiting);
  $('.logo-dot').title = waiting ? `SlopAMP ${st.release.version} is available` : 'SlopAMP';
  renderUpdAbout();
}
function renderUpdAbout() {
  const st = UPD, r = st.release;
  const when = (t) => { const d = new Date(t); return d.toDateString() === new Date().toDateString() ? `today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleDateString([], { day: 'numeric', month: 'short' }); };
  const checked = st.lastCheck ? ` · checked ${when(st.lastCheck)}` : '';
  let html;
  if (st.status === 'checking') html = 'Checking…';
  else if (r && st.status === 'ready') html = `<span class="new">${updEsc(r.version)} ready to install</span>${checked}`;
  else if (r && ['available', 'downloading', 'verifying', 'error'].includes(st.status) && r.version !== st.current) html = `<span class="new">${updEsc(r.version)} available</span>${checked}`;
  else if (st.status === 'error' && st.error === 'offline') html = `Couldn’t reach GitHub${checked}`;
  else html = st.lastCheck ? `<span class="ok">Up to date</span>${checked}` : 'Not checked yet';
  $('#updStatus').innerHTML = st.test ? `<span class="new">TEST FEED</span> · ${html}` : html;
  // The button says what the next click does: check → install (or download page) → restart.
  const [label, tip] = updAboutButton(st);
  $('#updCheck').textContent = label; $('#updCheck').title = tip;
  $('#updCheck').disabled = ['checking', 'downloading', 'verifying', 'installing'].includes(st.status);
  const sel = $('#updModeSel');
  sel.querySelector('option[value="auto"]').hidden = !st.canInstall;
  sel.value = !st.canInstall && st.mode === 'auto' ? 'notify' : (st.mode || 'notify');
  $('#updHint').textContent = !st.canInstall
    ? (sel.value === 'off' ? 'Never checks by itself. Use “Check for updates” here.' : 'This copy can’t update itself. SlopAMP tells you about new versions and opens the download page.')
    : ({ auto: 'Downloads and verifies in the background, then waits for you to click Restart now.', notify: 'Shows a bar when a new version is out. You decide when to update.', off: 'Never checks by itself. Use “Check for updates” here.' })[sel.value];
}
function openUpdNotes() {
  const st = UPD, r = st.release; if (!r) return;
  const after = st.status === 'updated';
  $('#updTitle').textContent = after ? `What’s new in SlopAMP ${r.version}` : `SlopAMP ${r.version} is available`;
  const date = r.date ? new Date(r.date).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  $('#updSub').textContent = after ? (date ? `Released ${date}` : '') : `You have ${st.current}${date ? ` · released ${date}` : ''}`;
  $('#updNotes').innerHTML = updNotesHtml(r.notes);
  $('#updMeta').innerHTML = after ? '' : st.canInstall
    ? `<span>SlopAMP-Setup-${updEsc(r.version)}.exe${r.size ? ` · ${updMB(r.size)}` : ''}</span><span class="ok">&#x2713; SHA256 checked before installing</span><span>Your playlists and settings are kept.</span>`
    : '<span>This copy can’t update itself. Download the new version from GitHub.</span>';
  $('#updSkip').classList.toggle('hidden', after);
  $('#updLater').textContent = after ? 'Close' : 'Later';
  $('#updGo').classList.toggle('hidden', after);
  $('#updGo').textContent = !st.canInstall ? 'Open download page' : st.status === 'ready' ? 'Restart and install' : 'Update and restart';
  if (!$('#updDlg').open) $('#updDlg').showModal();
}
function updAction(a) {
  if (a === 'notes') openUpdNotes();
  else if (a === 'page') P.updPage();
  else if (a === 'cancel') P.updCancel();
  else if (a === 'install') { updLocal.notNow = false; P.updInstall(); }
  else if (a === 'notnow') { updLocal.notNow = true; renderUpd(); }
  else if (a === 'retry') P.updDownload(false);
  else if (a === 'check') updCheckNow();
  else if (a === 'dismiss') { if (UPD.status === 'updated') { updLocal.hideUpdated = true; renderUpd(); } else P.updDismiss(); }
}
// About box button: [label, tooltip] for the update state (updAboutClick does the matching action).
function updAboutButton(st) {
  const v = st.release && st.release.version;
  switch (st.status) {
    case 'checking': return ['Checking\u2026', ''];
    case 'available': return st.canInstall ? ['Install update\u2026', `See what’s new in ${v} and install it`] : ['Download page', `Open the download page for ${v}`];
    case 'downloading': return [`Downloading\u2026 ${st.total ? Math.min(100, Math.floor(st.received / st.total * 100)) : 0}%`, ''];
    case 'verifying': return ['Verifying\u2026', 'Checking the download against the release’s SHA256'];
    case 'ready': return ['Restart and install', `${v} is downloaded and verified. SlopAMP closes, installs it and reopens`];
    case 'installing': return ['Installing\u2026', ''];
    case 'error': if (st.release && st.error === 'download') return ['Try again', 'Download the update again']; break;
  }
  return ['Check for updates', 'Ask GitHub for a newer version'];
}
function updAboutClick() {
  const st = UPD;
  if (st.status === 'available') { if (st.canInstall) openUpdNotes(); else P.updPage(); }
  else if (st.status === 'ready') { updLocal.notNow = false; P.updInstall(); }
  else if (st.status === 'error' && st.release && st.error === 'download') P.updDownload(false);
  else updCheckNow();
}
async function updCheckNow() {
  const st = await P.updCheck();
  // Use the answer right away: the matching update event can arrive after it, and the "what's new"
  // box below needs the release (before 1.4.3 the first check found the update but showed nothing).
  UPD = st; renderUpd();
  if (st.status === 'uptodate') toast(`SlopAMP ${st.current} is the latest version.`);
  else if (st.release && ['available', 'ready'].includes(st.status)) openUpdNotes();
}
$('#updBar').addEventListener('click', (e) => { const b = e.target.closest('button[data-a]'); if (b) updAction(b.dataset.a); });
$('#updNotes').addEventListener('click', (e) => { const a = e.target.closest('a[data-url]'); if (a) { e.preventDefault(); P.openExternal(a.dataset.url); } });
$('#updGo').onclick = () => {
  $('#updDlg').close();
  if (!UPD.canInstall) P.updPage();
  else if (UPD.status === 'ready') { updLocal.notNow = false; P.updInstall(); }
  else { updLocal.notNow = false; P.updDownload(true); }
};
$('#updSkip').onclick = () => { $('#updDlg').close(); P.updSkip(); };
$('#updCheck').onclick = updAboutClick;
$('.logo-dot').addEventListener('click', () => { if ($('.logo-dot').classList.contains('has-upd')) { if (UPD.status === 'error') updAction('page'); else openUpdNotes(); } });
$('#updModeSel').onchange = (e) => P.updMode(e.target.value);
P.onUpd((st) => { UPD = st; renderUpd(); });
P.updGet().then((st) => { UPD = st; renderUpd(); });

// ------------------------------------------------------------------ fullscreen & mini
// Fullscreen = the video window fills its screen. Mini player = only the player window, kept on top.
async function toggleFullscreen(force) {
  if (WM.body.contains('mini') && force !== false) await toggleMini();
  const going = force === undefined ? !WM.body.contains('fs') : !!force;
  if (going) { fsWanted = true; syncWindows(); }
  const on = await P.setFullscreen(going);
  if (!on) { fsWanted = false; syncWindows(); }
}
P.onFullscreen((on) => { fsWanted = false; WM.body.toggle('fs', on); syncWindows(); if (on) bumpIdle(); });
let idleTimer;
function bumpIdle() { WM.body.remove('idle'); clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (WM.body.contains('fs')) WM.body.add('idle'); }, 2500); }
WM.onDocs('mousemove', () => { if (WM.body.contains('fs')) bumpIdle(); });
async function toggleMini() {
  const on = !WM.body.contains('mini');
  if (on && WM.body.contains('fs')) await toggleFullscreen(false);
  WM.body.toggle('mini', on);
  syncWindows({ reflow: false });
  const res = await P.setMini(on);
  $('#btnMini').title = res ? 'Restore full player (M)' : 'Mini player (M)';
}
// Back to normal: leave fullscreen / mini, bring every window back (Reset layout also re-centres them).
async function restoreWindows() {
  if (WM.body.contains('fs')) await toggleFullscreen(false);
  if (WM.body.contains('mini')) await toggleMini();
  S.showVideo = true; S.showPlaylist = true; S.plShade = false; S.vidShade = false;
  if (S.eq.panel === 'hidden') S.eq.panel = 'open';
  if (S.vis.panel === 'hidden') S.vis.panel = 'open';
  renderEq(); renderVisPanel(); renderToggles();
  syncWindows({ reflow: false });
  saveSoon(); setTimeout(drawEqCurve, 300);
}
WM.onReset = restoreWindows;

// ------------------------------------------------------------------ wiring
$('#btnMin').onclick = () => P.minimize();
$('#btnClose').onclick = () => { recordResume(); saveNow(); P.close(); };
$('#btnMini').onclick = toggleMini;
$('#bRestore').title = 'Back to the normal layout: every window docked under the player';
$('#bRestore').onclick = async () => { await restoreWindows(); WM.preset('classic'); };
$('#btnAbout').onclick = openAbout;
$('#titlebar').addEventListener('dblclick', (e) => { if (!e.target.closest('button')) toggleMini(); });
$('#bPrev').onclick = prev; $('#bPlay').onclick = play; $('#bPause').onclick = pause; $('#bStop').onclick = stop; $('#bNext').onclick = () => next(false);
$('#bEject').onclick = () => openFiles();
$('#vPlay').onclick = togglePlay; $('#vPrev').onclick = prev; $('#vStop').onclick = stop; $('#vNext').onclick = () => next(false);
$('#vFs').onclick = () => toggleFullscreen();
$('#bFull').onclick = () => toggleFullscreen();
$('#bDl').onclick = () => { const it = dlTarget(); if (it) { const r = $('#bDl').getBoundingClientRect(); openDlMenu(it, { doc: $('#bDl').ownerDocument, x: r.left, y: r.bottom + 4, flipY: r.top }); } else toast('Play or select a YouTube video to download it.'); };
const toggleShuffle = () => { S.shuffle = !S.shuffle; S.history = []; renderToggles(); saveSoon(); toast(`Shuffle ${S.shuffle ? 'on' : 'off'}`, 1200); };
const cycleRepeat = () => { S.repeat = S.repeat === 'off' ? 'all' : S.repeat === 'all' ? 'one' : 'off'; renderToggles(); saveSoon(); toast(`Repeat: ${S.repeat}`, 1200); };
$('#bShuffle').onclick = toggleShuffle; $('#vShuf').onclick = toggleShuffle;
$('#bRepeat').onclick = cycleRepeat; $('#vRep').onclick = cycleRepeat;
$('#togVid').onclick = () => { S.showVideo = !S.showVideo; renderToggles(); saveSoon(); };
const togglePl = () => { S.showPlaylist = !S.showPlaylist; renderToggles(); saveSoon(); };
$('#togPl').onclick = togglePl; $('#vPl').onclick = togglePl; $('#plCloseBtn').onclick = togglePl;
$('#clock').onclick = () => { S.remaining = !S.remaining; saveSoon(); drawClock(); };
$('#vol').addEventListener('input', (e) => setVolume(+e.target.value));
$('#vMute').onclick = () => setMuted(!S.muted);
(() => {
  const w = $('#wedge');
  const set = (e) => { const r = w.getBoundingClientRect(); setVolume(((e.clientX - r.left) / r.width) * 100); };
  w.addEventListener('mousedown', (e) => { set(e); const mv = (ev) => set(ev); const doc = w.ownerDocument; doc.addEventListener('mousemove', mv); doc.addEventListener('mouseup', () => doc.removeEventListener('mousemove', mv), { once: true }); });
  w.addEventListener('wheel', (e) => { e.preventDefault(); setVolume(S.volume + (e.deltaY < 0 ? 5 : -5)); });
})();
$('#vol').addEventListener('wheel', (e) => { e.preventDefault(); setVolume(S.volume + (e.deltaY < 0 ? 5 : -5)); });
// seek bars
let seeking = false;
for (const id of ['#pos', '#seek']) {
  const el = $(id);
  el.addEventListener('input', () => { seeking = true; const d = currentDuration(); if (d) { $('#vTime').textContent = fmt(el.value / 1000 * d); el.style.setProperty('--p', `${el.value / 10}%`); } });
  el.addEventListener('change', () => { const d = currentDuration(); if (d) seekTo(el.value / 1000 * d); seeking = false; });
}
$('#eAdd').onclick = () => openFiles(); $('#eFolder').onclick = () => openFiles('folder'); $('#eUrl').onclick = openUrlDialog;
$('#pAdd').onclick = () => openFiles(); $('#pFolder').onclick = () => openFiles('folder'); $('#pUrl').onclick = openUrlDialog;
$('#pSave').onclick = savePlaylistFile; $('#pLoad').onclick = loadPlaylistFile; $('#pQuick').onclick = quickSavePlaylist; $('#pQuickAll').onclick = quickSaveAll;
$('#pDlAll').onclick = (e) => { e.stopPropagation(); const r = $('#pDlAll').getBoundingClientRect(); openDlAllMenu({ x: r.left, y: r.top, above: true }); };
$('#vSpeed').onclick = (e) => { e.stopPropagation(); openSpeedMenu(); };
$('#vCc').onclick = (e) => { e.stopPropagation(); openCcMenu(); };
$('#pRem').onclick = removeSelected; $('#pClr').onclick = clearList;
$('#pUp').onclick = () => moveSelected(-1); $('#pDown').onclick = () => moveSelected(1);
$('#stage').addEventListener('dblclick', (e) => { if (e.target === $('#stage') || e.target.closest('#artWrap')) toggleFullscreen(); });

WM.onDocs('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' && e.target.type === 'text') return;
  if ($('dialog[open]')) return;
  const k = e.key;
  if (k === ' ' ) { e.preventDefault(); togglePlay(); }
  else if (k === 'ArrowRight' && !e.altKey) { e.preventDefault(); seekBy(e.shiftKey ? 30 : 5); }
  else if (k === 'ArrowLeft' && !e.altKey) { e.preventDefault(); seekBy(e.shiftKey ? -30 : -5); }
  else if (k === 'ArrowUp' && e.altKey) { e.preventDefault(); moveSelected(-1); }
  else if (k === 'ArrowDown' && e.altKey) { e.preventDefault(); moveSelected(1); }
  else if (k === 'ArrowUp') { e.preventDefault(); if (e.ctrlKey || e.target !== list) setVolume(S.volume + 5); else selectRel(-1); }
  else if (k === 'ArrowDown') { e.preventDefault(); if (e.ctrlKey || e.target !== list) setVolume(S.volume - 5); else selectRel(1); }
  else if (k === 'Delete') removeSelected();
  else if (k === 'Enter') { const i = S.items.findIndex(it => S.sel.has(it.id)); if (i >= 0) playIndex(i); }
  else if (k === 'Escape') { const popOpen = !$('#popMenu').classList.contains('hidden'); hidePop(); hideCtx(); if (!popOpen && WM.body.contains('fs')) toggleFullscreen(false); }
  else if (k === 'F11' || (k.toLowerCase() === 'f' && !e.ctrlKey)) { e.preventDefault(); toggleFullscreen(); }
  else if (e.ctrlKey && k === 'Tab') { e.preventDefault(); switchTab((S.tab + (e.shiftKey ? S.tabs.length - 1 : 1)) % S.tabs.length); }
  else if (e.ctrlKey && k.toLowerCase() === 't') { e.preventDefault(); renameTab(newTab()); }
  else if (e.ctrlKey && k.toLowerCase() === 'w') { e.preventDefault(); closeTab(S.tab); }
  else if (e.ctrlKey && k.toLowerCase() === 'a') { e.preventDefault(); S.sel = new Set(S.items.map(i => i.id)); renderList(); }
  else if (e.ctrlKey && k.toLowerCase() === 'o') { e.preventDefault(); openFiles(); }
  else if (e.ctrlKey && k.toLowerCase() === 'u') { e.preventDefault(); openUrlDialog(); }
  else if (e.ctrlKey && e.altKey && k.toLowerCase() === 's') { e.preventDefault(); quickSaveAll(); }
  else if (e.ctrlKey && e.shiftKey && k.toLowerCase() === 's') { e.preventDefault(); quickSavePlaylist(); }
  else if (e.ctrlKey && k.toLowerCase() === 's') { e.preventDefault(); savePlaylistFile(); }
  else if (e.ctrlKey && k.toLowerCase() === 'l') { e.preventDefault(); loadPlaylistFile(); }
  else if (e.ctrlKey) return;
  else if (k === 'z') prev(); else if (k === 'x') play(); else if (k === 'c') pause(); else if (k === 'v') stop(); else if (k === 'b') next(false);
  else if (['n', 'p', 'k', 'h'].includes(k.toLowerCase()) && !e.ctrlKey && !e.altKey && mdKey(k.toLowerCase())) { e.preventDefault(); }
  else if (k === ']') stepRate(1); else if (k === '[') stepRate(-1);
  else if (k === 'e') setEqPanel(S.eq.panel === 'hidden' ? 'open' : 'hidden');
  else if (k === 'm') toggleMini(); else if (k === 's') toggleShuffle(); else if (k === 'r') cycleRepeat(); else if (k === 'l') openFiles();
  else if (k === 'g') slopKey('frame'); else if (k === 'i') slopKey('in'); else if (k === 'o') slopKey('out');   // SLOP while watching
});
function selectRel(d) {
  if (!S.items.length) return;
  let i = S.anchor >= 0 ? S.anchor + d : 0; i = Math.max(0, Math.min(S.items.length - 1, i));
  S.sel = new Set([S.items[i].id]); S.anchor = i; renderList();
  const li = list.querySelector(`li[data-i="${i}"]`); if (li) li.scrollIntoView({ block: 'nearest' });
}

P.onOpenFiles(async (paths) => { const added = await addPaths(paths); if (added.length) playIndex(S.items.indexOf(added[0])); });

// ------------------------------------------------------------------ SLOP
// The SLOP window (1.6): builds a pack of a YouTube moment for slop.cc while the video keeps playing.
// The pack itself (files, song download, clips, frames, burst, motion, captions, zip) is made by
// main.js ("SLOP (1.6)"); this draws it and sends the user's changes. G / I / O work in every window.
const SLOP_IDEAS = {
  roast: 'Roast this moment: a short, over-the-top comedy take on what happens in the frame, set to the clip.',
  remake: 'Remake this moment in a completely new style. Keep the mood and the beat of the clip.',
  music: 'Make a music video for this clip, with visuals inspired by the frame.',
  custom: ''
};
const SLOP_MIN_SIDE = 512;          // slop.cc warns about reference images smaller than this
const SL = { id: null, pack: null, peaks: null, sel: null, picks: {}, draft: null, justOpened: false };
var slopVisible = false, slopShade = false;   // var: syncWindows() reads them, and it can run before this line
let slopTick = null, slopTextT = null, slopNameT = null, slopLenT = null, slopOpening = null;
const slopAudio = new Audio();
const slopTime = (t) => fmt(t).replace(/^0(\d)/, '$1');
const slopEsc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function slopTarget() { const it = curItem(); return it && it.type === 'youtube' && it.vid && !it.live ? it : null; }
function updateSlopButton() { const b = $('#bSlop'); if (b) b.classList.toggle('on', slopVisible); const e = $('#slopEmptyStart'); if (e) e.disabled = !slopTarget(); }
const slopIsPlaying = () => { const it = slopTarget(); return !!(it && SL.pack && SL.pack.d.video.id === it.vid); };
function slopRect() {
  const el = engine === 'local' ? $('#video') : $('#ytWrap');
  const b = el && el.getBoundingClientRect();
  return b && b.width ? { x: b.left, y: b.top, width: b.width, height: b.height } : null;
}

// ---- the window
function slopShow(on) {
  slopVisible = on;
  syncWindows();
  updateSlopButton();
  clearInterval(slopTick);
  if (on) { slopTick = setInterval(slopClock, 400); slopRender(); requestAnimationFrame(slopDrawWave); }
  else slopAudio.pause();
}
async function slopToggle() {
  if (slopVisible) { slopShow(false); return; }
  slopShow(true);
  if (slopTarget() && !slopIsPlaying()) await slopEnsure();
}
// The pack of the video that's playing: the open one, its newest one, or a new one (which grabs the moment).
async function slopEnsure(opts = {}) {
  const it = slopTarget();
  if (!it) { toast('SLOP works with YouTube videos: play one first.'); return null; }
  if (!opts.fresh && slopIsPlaying()) return SL.pack;
  if (slopOpening) return slopOpening;
  slopOpening = (async () => {
    const at = currentTime();
    const r = await P.slopOpen({ url: it.url, title: it.title, at, dur: currentDuration() || it.duration || 0, fresh: !!opts.fresh });
    if (!r || !r.ok) { toast((r && r.error) || 'SLOP couldn’t start.'); return null; }
    slopSetPack(r.pack);
    if (r.created && !opts.noGrab) P.slopFrame({ id: r.pack.id, t: at, rect: slopRect() });
    return r.pack;
  })();
  try { return await slopOpening; } finally { slopOpening = null; }
}
async function slopOpenPack(id) {        // from the Library
  const r = await P.slopLoad(id);
  if (!r || !r.ok) { toast((r && r.error) || 'That pack couldn’t be opened.'); return; }
  slopSetPack(r.pack);
  if (!slopVisible) slopShow(true);
}
function slopSetPack(pack) {
  if (SL.id !== pack.id) { SL.peaks = null; SL.sel = null; SL.picks = {}; SL.justOpened = false; slopAudio.pause(); $('#slopText').value = pack.d.prompt.text || ''; $('#slopLyrics').classList.add('hidden'); }
  SL.id = pack.id; SL.pack = pack;
  if (pack.peaksReady && !SL.peaks) P.slopPeaks(pack.id).then((pk) => { if (pk && SL.id === pack.id) { SL.peaks = pk; slopDrawWave(); } });
  slopRender();
}
function slopClear() { SL.id = null; SL.pack = null; SL.peaks = null; slopAudio.pause(); slopRender(); }

// ---- hotkeys while watching: G frame, I / O clip start / end
async function slopKey(k) {
  const it = slopTarget();
  if (!it) { toast('SLOP works with YouTube videos.'); return; }
  const t = currentTime(), had = slopIsPlaying();
  const pack = await slopEnsure({ noGrab: k !== 'frame' });
  if (!pack) return;
  if (k === 'frame') {
    if (had) P.slopFrame({ id: pack.id, t, rect: slopRect() });     // a new pack already grabbed this moment
    toast(`SLOP: frame at ${slopTime(t)} added${slopVisible ? '' : ' (click SLOP to see the pack)'}`);
  } else {
    const c = { ...pack.d.audio.clip };
    if (k === 'in') { c.in = t; if (c.out <= t + 1) c.out = t + 30; } else { c.out = t; if (c.in >= t - 1) c.in = Math.max(0, t - 30); }
    const r = await P.slopSet({ id: pack.id, patch: { clip: c } });
    if (r && r.ok) slopSetPack(r.pack);
    toast(`SLOP: clip ${k === 'in' ? 'starts' : 'ends'} at ${slopTime(t)}`);
  }
}

// ---- drawing
function slopClock() {
  if (!slopVisible) return;
  const el = $('#slopClock'); if (!el) return;
  el.innerHTML = `${status === 'playing' ? '&#9654;' : '&#10074;&#10074;'} ${slopTime(currentTime())}`;
  if (slopIsPlaying()) slopDrawWave();
}
function slopView() {        // the time range the wave shows
  const p = SL.pack, pk = SL.peaks;
  if (pk) return [pk.start, pk.start + pk.dur];
  const dur = p.d.video.duration || Math.max(p.d.audio.clip.out, p.d.audio.clip2.out) * 1.25 || 60;
  return [0, dur];
}
function slopClips() { const a = SL.pack.d.audio; return { clip: SL.draft && SL.draft.which === 'clip' ? SL.draft : a.clip, clip2: SL.draft && SL.draft.which === 'clip2' ? SL.draft : a.clip2 }; }
function slopDrawWave() {
  const c = $('#slopWaveC'); if (!c || !SL.pack || !slopVisible) return;
  const w = c.clientWidth, h = c.clientHeight, dpr = c.ownerDocument.defaultView.devicePixelRatio || 1;
  if (!w || !h) return;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  const [v0, v1] = slopView(), px = (t) => (t - v0) / (v1 - v0) * w;
  const { clip, clip2 } = slopClips(), a2 = SL.pack.d.audio.clip2.on;
  const green = WM.token('--green'), line = WM.token('--line-green'), warn = WM.token('--warn-ink'), amber = WM.token('--amber');
  x.globalAlpha = 0.16; x.fillStyle = green; x.fillRect(px(clip.in), 0, px(clip.out) - px(clip.in), h);
  if (a2) { x.globalAlpha = 0.1; x.fillStyle = warn; x.fillRect(px(clip2.in), 0, px(clip2.out) - px(clip2.in), h); }
  x.globalAlpha = 1;
  const pk = SL.peaks;
  if (pk) {
    const n = pk.peaks.length, bw = Math.max(1, w / n);
    for (let i = 0; i < n; i++) {
      const t = pk.start + (i + 0.5) / n * pk.dur, v = pk.peaks[i] / 100 * (h / 2 - 3), inClip = t >= clip.in && t <= clip.out;
      x.fillStyle = inClip ? green : line; x.globalAlpha = inClip ? 1 : 0.55;
      x.fillRect(i * w / n, h / 2 - v, Math.max(1, bw - 0.4), Math.max(1, v * 2));
    }
    x.globalAlpha = 1;
  } else { x.fillStyle = line; x.globalAlpha = 0.5; x.fillRect(0, h / 2, w, 1); x.globalAlpha = 1; }
  const handle = (t, col) => { x.fillStyle = col; x.fillRect(px(t) - 1.5, 0, 3, h); x.fillRect(px(t) - 5, 0, 10, 7); x.fillRect(px(t) - 5, h - 7, 10, 7); };
  handle(clip.in, green); handle(clip.out, green);
  if (a2) { x.strokeStyle = warn; x.setLineDash([5, 4]); x.lineWidth = 1.5; x.strokeRect(px(clip2.in), 1, px(clip2.out) - px(clip2.in), h - 2); x.setLineDash([]); handle(clip2.in, warn); handle(clip2.out, warn); }
  for (const r of SL.pack.refs) { x.fillStyle = r.lead ? warn : line; x.beginPath(); x.moveTo(px(r.t), h); x.lineTo(px(r.t) - 5, h - 9); x.lineTo(px(r.t) + 5, h - 9); x.fill(); }
  x.fillStyle = warn; x.globalAlpha = 0.8; x.fillRect(px(SL.pack.d.at) - 0.5, 0, 1, h); x.globalAlpha = 1;   // the moment
  if (slopIsPlaying()) { x.fillStyle = amber; x.fillRect(px(currentTime()) - 1, 0, 2, h); }          // the player
}
function slopRuler() {
  const el = $('#slopRuler'); if (!el || !SL.pack) return;
  const [v0, v1] = slopView(), n = 8;
  el.innerHTML = Array.from({ length: n + 1 }, (_, i) => `<span>${slopTime(v0 + (v1 - v0) * i / n)}</span>`).join('');
}

function slopRender() {
  const p = SL.pack;
  $('#slopEmpty').classList.toggle('hidden', !!p);
  $('#slopMain').classList.toggle('hidden', !p);
  updateSlopButton();
  if (!p) { WM.setTitle('slop', 'SLOP'); const s = $('#slopSum'); if (s) s.textContent = ''; return; }
  const d = p.d;
  WM.setTitle('slop', 'SLOP');
  const sum = $('#slopSum'); if (sum) sum.textContent = d.title;
  $('#slopSrc').innerHTML = `<b>${slopEsc(d.title)}</b> · YouTube · ${slopEsc(d.video.id)}`; $('#slopSrc').title = p.dir;
  slopRenderAudio(); slopRenderLook(); slopRenderPrompt(); slopRenderLeave();
  slopClock(); slopRuler(); slopDrawWave();
}
function slopRenderAudio() {
  const p = SL.pack, d = p.d, s = p.song, a = d.audio, { clip } = slopClips();
  const pill = $('#slopPill'), btn = $('#slopSongBtn');
  const pct = Math.max(0, Math.min(100, Math.floor(s.pct || 0)));
  const label = { none: 'STARTING…', queued: 'STARTING…', downloading: s.pct > 0 && s.pct < 100 ? `SONG ${pct}%` : 'GETTING THE SONG…', processing: 'MAKING THE WAVE…', ready: '✓ SONG READY', stopped: 'STOPPED', error: '✕ FAILED' }[s.status] || '';
  pill.querySelector('em').textContent = label;
  pill.querySelector('i').style.width = s.status === 'downloading' && s.pct > 0 ? `${pct}%` : '';
  pill.className = 'slop-pill' + (s.status === 'ready' ? ' done' : s.status === 'error' ? ' err' : s.status === 'stopped' ? ' stop' : s.status === 'downloading' && s.pct > 0 ? ' pct' : '');
  btn.classList.toggle('hidden', s.status === 'ready' || s.status === 'processing');
  btn.innerHTML = ['none', 'queued', 'downloading'].includes(s.status) ? '&#9632; Stop' : s.status === 'error' ? '&#x21BB; Try again' : '&#9654; Start';
  btn.title = ['none', 'queued', 'downloading'].includes(s.status) ? 'Stop downloading the song' : 'Download the song from YouTube';
  const st = $('#slopSongSt');
  st.textContent = s.status === 'error' ? (s.error || '') : s.status === 'stopped' ? 'the clips are made from the song once it’s here'
    : s.status === 'downloading' ? [s.speed, s.eta ? `${s.eta} left` : ''].filter(Boolean).join(' · ') || 'song from YouTube'
    : a.src && !a.src.full ? `long video: only ${slopTime(a.src.start)}\u2013${slopTime(a.src.end)} is downloaded` : s.status === 'ready' ? '' : 'song from YouTube';
  st.title = st.textContent;
  $('#slopWaveMsg').textContent = SL.peaks ? '' : s.status === 'error' ? 'No wave: the song didn’t download.' : s.status === 'stopped' ? 'Start the song download to see the wave.' : 'The wave appears when the song is here.';
  const before = Math.round((d.at - clip.in) * 10) / 10, after = Math.round((clip.out - d.at) * 10) / 10;
  const doc = $('#slopBefore').ownerDocument;
  if (doc.activeElement !== $('#slopBefore')) $('#slopBefore').value = String(before);
  if (doc.activeElement !== $('#slopAfter')) $('#slopAfter').value = String(after);
  $('#slopRange').innerHTML = `${slopTime(clip.in)} &ndash; ${slopTime(clip.out)} <small>${slopTime(clip.out - clip.in)}</small>${p.busy.audio ? ' <small>making&#8230;</small>' : ''}`;
  $('#slopPlayClip').disabled = !p.urls.audio;
  $('#slopPlayClip').innerHTML = slopAudio.paused ? '&#9654; Play clip' : '&#9632; Stop';
  const songOk = !a.src || a.src.full;
  $('#slopCkSong').checked = !!a.song.on && songOk; $('#slopCkSong').disabled = !songOk;
  $('#slopSongLen').textContent = songOk ? (d.video.duration ? `(${slopTime(d.video.duration)})` : '') : '(not for long videos)';
  $('#slopCkClip2').checked = !!a.clip2.on;
  $('#slopClip2Range').textContent = a.clip2.on ? `${slopTime(a.clip2.in)}–${slopTime(a.clip2.out)} · drag the dashed range on the wave` : '';
}
function slopSelRef() {
  const refs = SL.pack.refs;
  let r = refs.find(x => x.n === SL.sel);
  if (!r) { r = refs.find(x => x.lead) || refs[0] || null; SL.sel = r ? r.n : null; }
  return r;
}
function slopRenderLook() {
  const p = SL.pack, refs = p.refs, r = slopSelRef();
  $('#slopRefCount').textContent = refs.length ? `${refs.length} reference${refs.length > 1 ? 's' : ''} · slop.cc: one or two clear ones per person` : '';
  const img = $('#slopBigImg'), src = r ? (r.busy && r.preview) || r.url || r.preview : null;
  if (src) { if (img.getAttribute('src') !== src) img.src = src; } else img.removeAttribute('src');
  img.style.opacity = r && r.busy ? '.5' : '';
  $('#slopBigLead').classList.toggle('hidden', !(r && r.lead));
  const res = $('#slopBigRes'), small = r && r.file && Math.min(r.w, r.h) < SLOP_MIN_SIDE;
  res.classList.toggle('hidden', !r || (!r.file && !r.preview));
  if (r) { res.textContent = r.busy ? 'GRABBING…' : r.file ? `${small ? '⚠ ' : ''}${r.w} × ${r.h}` : 'PREVIEW'; res.classList.toggle('warn', !!small); }
  $('#slopBigWait').textContent = !r ? 'Press G or + Frame' : !src ? 'GRABBING…' : '';
  $('#slopSide').classList.toggle('off', !r);
  for (const id of ['#slopRefName', '#slopLead', '#slopPrev', '#slopRegrab', '#slopNext', '#slopDelRef']) $(id).disabled = !r;
  for (const b of $$('#slopKinds button')) { b.disabled = !r; b.classList.toggle('on', !!r && r.kind === b.dataset.kind); }
  if (r) {
    $('#slopRefFile').textContent = r.file && !r.file.startsWith('.') ? r.file : 'ref.png';
    $('#slopRefAt').textContent = `at ${slopTime(r.t)}`;
    const nameEl = $('#slopRefName');
    if (nameEl.ownerDocument.activeElement !== nameEl || nameEl.dataset.n !== String(r.n)) { nameEl.value = r.name || ''; nameEl.dataset.n = String(r.n); }
    $('#slopLead').classList.toggle('on', !!r.lead);
    $('#slopLead').title = r.lead ? 'This is the lead reference (ref-01)' : 'Make this the lead reference (ref-01)';
    const size = `${(r.window && r.window.w) || r.w}×${(r.window && r.window.h) || r.h}`;
    let st;
    if (r.busy) st = `<span class="dim">${r.preview ? 'Window picture for now. Getting the full-size frame from the video&#8230;' : 'Getting the full-size frame from the video&#8230;'}</span>`;
    else if (r.error) st = `<span class="warn">&#9888; Couldn’t get the frame from the video</span><br><span class="dim">${slopEsc(r.error)}</span><br><span class="dim">Re-grab tries again${r.window ? ', or </span><button type="button" class="slop-link" id="slopUseWin">use the window picture (' + size + ')</button>' : '.</span>'}`;
    else if (r.from === 'window') st = `<span class="warn">Using the window picture (${r.w}×${r.h})</span><br><span class="dim">Not from the video itself: smaller, may show player buttons.${small ? ` Under ${SLOP_MIN_SIDE} px, so slop.cc may warn.` : ''}</span>`;
    else if (r.file) st = small ? `<span class="ok">&#x2713; Frame from the video itself</span><br><span class="warn">&#9888; This video is only ${r.w}×${r.h} (low resolution), so slop.cc may warn</span>`
      : `<span class="ok">&#x2713; Full-size frame from the video itself (${r.w}×${r.h})</span>`;
    else st = '';
    $('#slopRefSt').innerHTML = st;
  } else { $('#slopRefFile').textContent = ''; $('#slopRefAt').textContent = ''; $('#slopRefSt').innerHTML = '<span class="dim">No frames yet.</span>'; }
  // the strip
  const tiles = refs.map(x => {
    const u = (x.busy && x.preview) || x.url || x.preview, t = x.busy ? 'busy' : x.error ? 'err' : '';
    return `<div class="slop-th${x.n === SL.sel ? ' sel' : ''} ${t}" data-n="${x.n}" title="${slopEsc(x.file || '')}">${u ? `<img src="${slopEsc(u)}" alt="">` : '<span class="slop-th-wait">&#8230;</span>'}${x.lead ? '<span class="slop-th-lead">&#9733; LEAD</span>' : ''}<span class="slop-th-t">${slopTime(x.t)}</span>${x.busy ? '<span class="slop-th-busy">GRABBING</span>' : x.error ? '<span class="slop-th-busy err">&#9888;</span>' : ''}<div class="slop-th-cap">${slopEsc(x.name || `ref-${String(refs.indexOf(x) + 1).padStart(2, '0')}`)} <span>${x.kind || ''}</span></div></div>`;
  }).join('');
  const now = slopIsPlaying() ? currentTime() : p.d.at;
  const bursting = p.burst && p.burst.running;
  $('#slopStrip').innerHTML = tiles + `<button type="button" class="slop-add" id="slopAddTile">+ Frame at ${slopTime(now)}<br><span class="dim">or press G</span></button>`
    + `<button type="button" class="slop-add" id="slopBurstTile" ${p.burst ? 'disabled' : ''}>${bursting ? 'Burst running&#8230;' : 'Burst &times;5'}<br><span class="dim">pick the best</span></button>`;
  slopRenderBurst();
  // motion
  const m = p.d.motion;
  $('#slopCkMotion').checked = !!m.on;
  $('#slopMotionLen').value = `${m.len || 3} s`;
  const lead = refs.find(x => x.lead), center = lead ? lead.t : p.d.at, len = m.len || 3;
  $('#slopMotionInfo').innerHTML = !m.on ? `(2–5 s · 1080p · ${slopTime(Math.max(0, center - len / 2))}–${slopTime(center + len / 2)})`
    : p.busy.motion ? 'making motion.mp4&#8230;' : p.busy.motionErr ? `<span class="warn">&#9888; ${slopEsc(p.busy.motionErr)}</span>` : p.files.motion ? `<span class="ok">&#x2713; ${len} s from ${slopTime(m.start != null ? m.start : center - len / 2)}</span>` : 'waiting&#8230;';
}
function slopRenderBurst() {
  const p = SL.pack, b = p.burst, el = $('#slopBurst');
  el.classList.toggle('hidden', !b);
  if (!b) { SL.picks = {}; return; }
  const n = Object.values(SL.picks).filter(Boolean).length, done = b.items.filter(i => i.status !== 'waiting' && i.status !== 'grabbing').length;
  el.innerHTML = `<div class="slop-burst-h"><b>BURST</b> <span class="dim">${b.running ? `grabbing ${Math.min(done + 1, b.items.length)} of ${b.items.length}&#8230;` : 'keep the best one or two: slop.cc prefers a few clear references to many similar ones'}</span></div><div class="slop-burst-row">`
    + b.items.map(i => `<div class="slop-bi${SL.picks[i.i] ? ' ' + SL.picks[i.i] : ''}" data-i="${i.i}">${i.url ? `<img src="${slopEsc(i.url)}" alt="">` : `<span class="slop-th-wait">${i.status === 'error' ? '&#9888;' : i.status === 'grabbing' ? 'GRABBING' : '&#8230;'}</span>`}<span class="slop-th-t">${slopTime(i.t)}</span>`
      + (i.status === 'ok' ? `<div class="slop-bi-btns"><button type="button" data-role="lead" class="${SL.picks[i.i] === 'lead' ? 'on' : ''}">&#9733; Lead</button><button type="button" data-role="ref" class="${SL.picks[i.i] === 'ref' ? 'on' : ''}">Ref</button></div>` : `<div class="slop-bi-btns dim">${slopEsc(i.error || '')}</div>`) + '</div>').join('')
    + `</div><div class="slop-row"><button type="button" class="sb" id="slopBurstKeep" ${n ? '' : 'disabled'}>Keep ${n || ''}</button><button type="button" class="sb dim" id="slopBurstCancel">${b.running ? 'Stop' : 'Cancel'}</button></div>`;
}
function slopRenderPrompt() {
  const p = SL.pack, d = p.d;
  const ta = $('#slopText');
  if (ta.ownerDocument.activeElement !== ta && ta.value !== (d.prompt.text || '')) ta.value = d.prompt.text || '';
  for (const b of $$('#slopChips button')) b.classList.toggle('on', b.dataset.idea === d.prompt.idea);
  $('#slopSug').classList.toggle('hidden', !d.suggestion);
  $('#slopSugText').textContent = d.suggestion || '';
  const c = d.audio.clip;
  $('#slopLyrInfo').innerHTML = d.lyrics ? `lyrics ${slopTime(c.in)}–${slopTime(c.out)} from YouTube captions &rarr; <b>lyrics.txt</b> (${d.lyrics.lines} line${d.lyrics.lines > 1 ? 's' : ''})`
    : p.details === 'pending' ? 'looking for captions&#8230;' : 'no captions for this part of the video';
  $('#slopLyrBtn').classList.toggle('hidden', !d.lyrics);
  $('#slopLyrics').textContent = p.lyricsText || '';
  if (!d.lyrics) $('#slopLyrics').classList.add('hidden');
}
function slopRenderLeave() {
  const p = SL.pack, d = p.d, f = p.files, refs = p.refs.filter(r => r.file && !r.busy);
  const short = p.dir.replace(/^.*?([^\\/]+[\\/]SlopAMP[\\/])/i, '$1');
  const ready = (f.audio || f.song) && refs.length && !p.busy.audio && !p.busy.song;
  const go = $('#slopGo');
  go.disabled = !ready;
  go.title = ready ? 'Opens the folder and slop.cc in your browser, and copies your prompt' : !refs.length ? 'Grab a frame first' : 'Waiting for the audio';
  const rights = '<div class="slop-rights">Upload only what you have the rights or permission for: the song, every face, logo and image. AI generation doesn’t create those rights; slop.cc asks you to confirm once per project.</div>';
  if (SL.justOpened) {
    $('#slopLeave').innerHTML = '<div class="slop-done">&#x2713; The folder and slop.cc are open, and your prompt is copied.</div>'
      + `<ol class="slop-steps"><li>On slop.cc, attach the song: <b>${f.song ? 'song.mp3' : 'audio.mp3'}</b>${f.song ? ' (or the clip, <b>audio.mp3</b>)' : ''}.</li><li>Attach the references, <b>ref-01</b> (the lead) first, and give each the name in its file name.</li>`
      + `<li>Click the message box, paste (<b>Ctrl+V</b>) and send. slop.cc asks you to confirm the rights first.</li></ol><div class="slop-where" title="${slopEsc(p.dir)}">${slopEsc(short)}</div>`;
    return;
  }
  const chip = (on, icon, name, extra, wait) => `<span class="slop-file${on ? '' : ' wait'}">${icon} <b>${slopEsc(name)}</b>${extra ? ' ' + extra : ''}${wait && !on ? ' ' + wait : ''}</span>`;
  const c = d.audio.clip;
  const chips = [];
  if (d.audio.song.on && (!d.audio.src || d.audio.src.full)) chips.push(chip(f.song && !p.busy.song, '&#9835;', 'song.mp3', d.video.duration ? slopTime(d.video.duration) : '', p.busy.song ? 'making&#8230;' : 'waiting for the song'));
  chips.push(chip(f.audio && !p.busy.audio, '&#9835;', 'audio.mp3', slopTime(c.out - c.in), p.busy.audio ? 'making&#8230;' : 'waiting for the song'));
  if (d.audio.clip2.on) chips.push(chip(f.audio2 && !p.busy.audio2, '&#9835;', 'audio-2.mp3', slopTime(d.audio.clip2.out - d.audio.clip2.in), 'making&#8230;'));
  for (const r of refs) chips.push(chip(true, '&#9635;', r.file, `${r.lead ? '&#9733;' : ''}${Math.min(r.w, r.h) < SLOP_MIN_SIDE ? ' &#9888;' : ''}`));
  if (d.motion.on) chips.push(chip(f.motion && !p.busy.motion, '&#127902;', 'motion.mp4', `${d.motion.len} s`, 'making&#8230;'));
  chips.push(chip(f.prompt, '&#9998;', 'prompt.txt', '', f.prompt ? '' : '(on Save or Open)'));
  if (d.lyrics) chips.push(chip(f.lyrics, '&#9834;', 'lyrics.txt'));
  chips.push(chip(true, '&#x2139;', 'source.txt'));
  $('#slopLeave').innerHTML = `<div class="slop-lh">IN THIS PACK · <span title="${slopEsc(p.dir)}">${slopEsc(short)}</span></div><div class="slop-files">${chips.join('')}</div>${rights}`;
}

// ---- wave: click = jump the player there, drag an edge / the clip, drag elsewhere = a new clip
function slopWaveDown(e) {
  if (!SL.pack || e.button !== 0) return;
  const c = $('#slopWaveC'), r = c.getBoundingClientRect(), [v0, v1] = slopView();
  const tAt = (cx) => v0 + Math.max(0, Math.min(1, (cx - r.left) / r.width)) * (v1 - v0);
  const xOf = (t) => r.left + (t - v0) / (v1 - v0) * r.width;
  const a = SL.pack.d.audio, x0 = e.clientX, t0 = tAt(x0);
  const near = [['clip', 'in'], ['clip', 'out']].concat(a.clip2.on ? [['clip2', 'in'], ['clip2', 'out']] : []).map(([w, k]) => ({ w, k, d: Math.abs(xOf(a[w][k]) - x0) })).filter(h => h.d <= 7).sort((p, q) => p.d - q.d)[0];
  const inside = (w) => a[w].on !== false && t0 >= a[w].in && t0 <= a[w].out;
  const which = near ? near.w : inside('clip') ? 'clip' : a.clip2.on && inside('clip2') ? 'clip2' : 'clip';
  const mode = near ? near.k : inside(which) ? 'move' : 'new';
  const start = { ...a[which] };
  let moved = false;
  try { c.setPointerCapture(e.pointerId); } catch (_) {}
  const move = (ev) => {
    if (!moved && Math.abs(ev.clientX - x0) < 4) return;
    moved = true;
    const t = tAt(ev.clientX), dt = t - t0, lo = v0, hi = v1;
    let i = start.in, o = start.out;
    if (mode === 'in') i = Math.min(t, o - 1);
    else if (mode === 'out') o = Math.max(t, i + 1);
    else if (mode === 'move') { const len = o - i; i = Math.max(lo, Math.min(hi - len, start.in + dt)); o = i + len; }
    else { i = Math.min(t0, t); o = Math.max(t0, t); if (o - i < 1) o = i + 1; }
    SL.draft = { which, in: Math.max(0, i), out: o };
    slopDrawWave(); if (which === 'clip') slopRenderAudio();
  };
  const up = async () => {
    c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up);
    if (!moved) { SL.draft = null; if (slopIsPlaying()) { seekTo(t0); slopDrawWave(); } else toast('Play this video to jump to that point.'); return; }
    const dr = SL.draft; SL.draft = null;
    const res = await P.slopSet({ id: SL.pack.id, patch: { [dr.which]: { in: dr.in, out: dr.out } } });
    if (res && res.ok) slopSetPack(res.pack);
  };
  c.addEventListener('pointermove', move); c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
}
function slopSetLen(field, v) {
  if (!SL.pack) return;
  const d = SL.pack.d, c = d.audio.clip;
  v = Number(v); if (!Number.isFinite(v)) return;
  const i = field === 'before' ? d.at - v : c.in, o = field === 'after' ? d.at + v : c.out;
  if (o - i < 1) return;
  clearTimeout(slopLenT);
  SL.draft = { which: 'clip', in: Math.max(0, i), out: o };
  slopDrawWave(); slopRenderAudio();
  slopLenT = setTimeout(async () => {
    const dr = SL.draft; SL.draft = null; if (!dr || !SL.pack) return;
    const res = await P.slopSet({ id: SL.pack.id, patch: { clip: { in: dr.in, out: dr.out } } });
    if (res && res.ok) slopSetPack(res.pack);
  }, 600);
}
async function slopPatch(patch) { if (!SL.pack) return; const r = await P.slopSet({ id: SL.pack.id, patch }); if (r && r.ok) slopSetPack(r.pack); }
function slopGrab(n, t) {
  if (!SL.pack) return;
  if (slopIsPlaying() && Math.abs(currentTime() - t) > 0.3) seekTo(t);      // the player shows that moment too
  setTimeout(() => P.slopFrame({ id: SL.pack.id, n, t, rect: slopIsPlaying() ? slopRect() : null }), slopIsPlaying() ? 450 : 0);
}

// ---- events from main
P.onSlop((ev) => {
  if (ev.type === 'pack') { if (ev.pack.id === SL.id) slopSetPack(ev.pack); if (typeof slopLibChanged === 'function') slopLibChanged(ev.pack.id); }
  else if (ev.type === 'peaks') { if (ev.id === SL.id) { SL.peaks = ev.peaks; if (SL.pack) { slopRuler(); slopRenderAudio(); } slopDrawWave(); } }
  else if (ev.type === 'renamed') { if (SL.id === ev.from) SL.id = ev.to; }
  else if (ev.type === 'gone') { if (SL.id === ev.id) slopClear(); }
});
slopAudio.addEventListener('ended', () => { if (SL.pack) slopRenderAudio(); });
slopAudio.addEventListener('pause', () => { if (SL.pack) slopRenderAudio(); });

// ---- wiring
$('#bSlop').onclick = () => slopToggle();
$('#slopCloseBtn').onclick = () => slopShow(false);
$('#slopMinBtn').onclick = () => { slopShade = !slopShade; syncWindows(); };
$('#slopEmptyStart').onclick = () => slopEnsure();
$('#slopEmptyLib').onclick = () => openDownloadsManager('slop');
$('#slopAddF').onclick = () => slopKey('frame');
$('#slopSetIn').onclick = () => slopKey('in');
$('#slopSetOut').onclick = () => slopKey('out');
$('#slopNew').onclick = () => { if (slopTarget()) slopEnsure({ fresh: true }); else toast('Play the video to start another pack of it.'); };
$('#slopSongBtn').onclick = async () => {
  if (!SL.pack) return;
  const busy = ['none', 'queued', 'downloading'].includes(SL.pack.song.status);
  const r = await P.slopSong({ id: SL.pack.id, action: busy ? 'stop' : 'start' });
  if (r && r.ok) slopSetPack(r.pack);
};
$('#slopWaveC').addEventListener('pointerdown', slopWaveDown);
new ResizeObserver(() => { if (slopVisible) requestAnimationFrame(slopDrawWave); }).observe($('#slopWave'));
for (const id of ['slopBefore', 'slopAfter']) {
  const inp = $('#' + id), field = id === 'slopBefore' ? 'before' : 'after';
  inp.addEventListener('input', () => { inp.value = inp.value.replace(/[^\d.-]/g, ''); if (inp.value && inp.value !== '-') slopSetLen(field, inp.value); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); slopSetLen(field, Number(inp.value || 0) + (e.key === 'ArrowUp' ? 1 : -1)); inp.value = String(Number(inp.value || 0) + (e.key === 'ArrowUp' ? 1 : -1)); } });
  inp.addEventListener('blur', () => { if (SL.pack) slopRenderAudio(); });
}
$('#slopPanel').addEventListener('click', (e) => {
  const st = e.target.closest('.slop-step button');
  if (st && SL.pack) {
    const d = SL.pack.d, c = d.audio.clip, by = Number(st.dataset.d);
    if (st.dataset.f === 'before') slopSetLen('before', Math.round(d.at - c.in) + by);
    else if (st.dataset.f === 'after') slopSetLen('after', Math.round(c.out - d.at) + by);
    else if (st.dataset.f === 'motion') slopPatch({ motion: { len: (d.motion.len || 3) + by } });
    return;
  }
  const th = e.target.closest('.slop-th');
  if (th) { SL.sel = Number(th.dataset.n); slopRenderLook(); return; }
  if (e.target.closest('#slopAddTile')) { slopKey('frame'); return; }
  if (e.target.closest('#slopBurstTile') && SL.pack) { SL.picks = {}; P.slopBurst({ id: SL.pack.id, count: 5 }); return; }
  const bi = e.target.closest('.slop-bi button[data-role]');
  if (bi) {
    const i = Number(bi.closest('.slop-bi').dataset.i), role = bi.dataset.role;
    if (role === 'lead') for (const k of Object.keys(SL.picks)) if (SL.picks[k] === 'lead') SL.picks[k] = 'ref';
    SL.picks[i] = SL.picks[i] === role ? null : role;
    slopRenderBurst(); return;
  }
  if (e.target.closest('#slopBurstKeep') && SL.pack) { P.slopBurst({ id: SL.pack.id, keep: Object.entries(SL.picks).filter(([, r]) => r).map(([i, role]) => ({ i: Number(i), role })) }); SL.picks = {}; return; }
  if (e.target.closest('#slopBurstCancel') && SL.pack) { P.slopBurst({ id: SL.pack.id, cancel: true }); SL.picks = {}; return; }
  if (e.target.closest('#slopUseWin') && SL.pack) { P.slopUseWindow({ id: SL.pack.id, n: SL.sel }); return; }
});
$('#slopKinds').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-kind]'), r = SL.pack && slopSelRef(); if (!b || !r) return;
  P.slopRef({ id: SL.pack.id, n: r.n, patch: { kind: r.kind === b.dataset.kind ? '' : b.dataset.kind } });
});
$('#slopRefName').addEventListener('input', () => {
  const r = SL.pack && slopSelRef(); if (!r) return;
  clearTimeout(slopNameT);
  const n = r.n, v = $('#slopRefName').value;
  slopNameT = setTimeout(() => P.slopRef({ id: SL.pack.id, n, patch: { name: v } }), 700);
});
$('#slopLead').onclick = () => { const r = SL.pack && slopSelRef(); if (r && !r.lead) P.slopRef({ id: SL.pack.id, n: r.n, patch: { lead: true } }); };
$('#slopPrev').onclick = () => { const r = SL.pack && slopSelRef(); if (r) slopGrab(r.n, Math.max(0, r.t - 1)); };
$('#slopNext').onclick = () => { const r = SL.pack && slopSelRef(); if (r) slopGrab(r.n, r.t + 1); };
$('#slopRegrab').onclick = () => { const r = SL.pack && slopSelRef(); if (r) slopGrab(r.n, r.t); };
$('#slopDelRef').onclick = () => { const r = SL.pack && slopSelRef(); if (r) { P.slopRef({ id: SL.pack.id, n: r.n, remove: true }); SL.sel = null; } };
$('#slopCkSong').onchange = (e) => slopPatch({ song: { on: e.target.checked } });
$('#slopCkClip2').onchange = (e) => slopPatch({ clip2: { on: e.target.checked } });
$('#slopCkMotion').onchange = (e) => slopPatch({ motion: { on: e.target.checked } });
$('#slopPlayClip').onclick = () => {
  if (!SL.pack || !SL.pack.urls.audio) return;
  if (!slopAudio.paused) { slopAudio.pause(); return; }
  if (status === 'playing') pause();
  slopAudio.src = SL.pack.urls.audio; slopAudio.currentTime = 0; slopAudio.play().catch(() => {});
  slopRenderAudio();
};
$('#slopChips').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-idea]'); if (!b || !SL.pack) return;
  const t = $('#slopText'), cur = t.value.trim();
  if (!cur || Object.values(SLOP_IDEAS).includes(cur) || cur === SL.pack.d.suggestion) t.value = SLOP_IDEAS[b.dataset.idea];   // never overwrite what the user wrote
  slopPatch({ prompt: { text: t.value, idea: b.dataset.idea } });
  t.focus();
});
$('#slopText').addEventListener('input', () => {
  clearTimeout(slopTextT);
  slopTextT = setTimeout(() => { if (SL.pack) P.slopSet({ id: SL.pack.id, patch: { prompt: { text: $('#slopText').value } } }); }, 600);
});
$('#slopSugUse').onclick = () => {
  if (!SL.pack) return;
  const t = $('#slopText'), s = SL.pack.d.suggestion, cur = t.value.trim();
  t.value = !cur || Object.values(SLOP_IDEAS).includes(cur) ? s : `${cur}\n${s}`;
  slopPatch({ prompt: { text: t.value } });
};
$('#slopLyrBtn').onclick = () => $('#slopLyrics').classList.toggle('hidden');
$('#slopCopy').onclick = () => { P.slopCopy($('#slopText').value.trim()); toast('Prompt copied.'); };
$('#slopSave').onclick = async () => { if (!SL.pack) return; const r = await P.slopSavePrompt({ id: SL.pack.id, text: $('#slopText').value }); toast(r && r.ok ? 'prompt.txt saved in the pack, and the prompt is copied.' : 'Couldn’t save prompt.txt.'); };
$('#slopFolderBtn').onclick = () => { if (SL.pack) P.slopFolder(SL.pack.id); };
$('#slopZipBtn').onclick = async () => {
  if (!SL.pack) return;
  toast('Zipping the pack…', 8000);
  const [r] = await P.slopZip([SL.pack.id]);
  if (r && r.file) showDlBar({ text: `✓ Zipped: ${r.file.split(/[\\/]/).pop()} (${fmtSize(r.size)})`, pct: 100, buttons: [['Show in folder', () => P.showInFolder(r.file)]], hideAfter: 8000 });
  else toast(`Couldn’t zip the pack${r && r.error ? `: ${r.error}` : '.'}`);
};
$('#slopSignup').onclick = () => P.slopSignup();
$('#slopDiscard').onclick = async () => {
  if (!SL.pack) return;
  if (!await confirmBox('Discard this pack?', `This moves the pack folder to the Recycle Bin:\n\n${SL.pack.dir}`, 'Discard')) return;
  const id = SL.pack.id; slopClear(); await P.slopTrash([id]);
};
$('#slopGo').onclick = async () => {
  if (!SL.pack) return;
  $('#slopGo').disabled = true;
  const r = await P.slopGo({ id: SL.pack.id, text: $('#slopText').value });
  if (!r || !r.ok) { toast((r && r.error) || 'Couldn’t open slop.cc.'); if (SL.pack) slopRenderLeave(); return; }
  SL.justOpened = true; slopSetPack(r.pack);
  $('#slopGo').innerHTML = 'Open again &#9656;';
  setTimeout(() => { if (SL.id === r.pack.id) { SL.justOpened = false; $('#slopGo').innerHTML = 'Open in Slop.cc (new video) &#9656;'; if (SL.pack) slopRenderLeave(); } }, 60000);
};

// ------------------------------------------------------------------ downloads (yt-dlp)
const DL = new Map();   // item id -> { status, kind, pct, speed, eta, part, title }
let dlBarTimer = null;
const DL_BUSY = ['queued', 'updating', 'downloading', 'processing'];

function dlTarget() {
  const cur = curItem();
  if (isWeb(cur) && status !== 'stopped') return cur;
  const sel = S.items.find(i => S.sel.has(i.id) && isWeb(i));
  if (sel) return sel;
  return isWeb(cur) ? cur : null;
}
function updateDlButton() { const b = $('#bDl'); if (b) b.disabled = !dlTarget(); updateSlopButton(); }
function dlOverall(d) {
  if (!d || d.pct == null) return 0;
  if (d.kind === 'audio') return d.pct;
  return d.part ? 90 + d.pct * 0.1 : d.pct * 0.9;   // video stream, then audio stream
}
function hideDlMenu() { $('#dlMenu').classList.add('hidden'); }
async function openDlMenu(item, pos) {
  hideCtx();
  const m = $('#dlMenu');
  const info = await P.dlInfo();
  const dl = DL.get(item.id);
  const busy = dl && DL_BUSY.includes(dl.status);
  m.innerHTML = '';
  const add = (cls, html, fn) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; if (fn) d.onclick = () => { hideDlMenu(); fn(); }; m.appendChild(d); return d; };
  const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  add('dm-head', esc(`${(tabOf(item) || S).items.indexOf(item) + 1}. ${item.title}`)).title = item.title;
  if (item.live && !busy) {
    add('dm-note', '\u25cf This is a live stream. You can download it after it ends.');
  } else if (!info.available) {
    add('dm-note', 'The downloader isn’t included in this copy of SlopAMP.');
  } else if (busy) {
    add('dm-note', dl.status === 'queued' ? 'Waiting in the download queue…' : `Downloading… ${Math.floor(dlOverall(dl))}%`);
    add('dm-item', '✕ Cancel download', () => P.dlCancel(item.id));
  } else {
    const ytm = item.music || /^https?:\/\/music\./i.test(item.url || '');
    const audio = () => {
      add('dm-sec', 'Audio');
      add(ytm ? 'dm-item rec' : 'dm-item', `♫ Audio only (MP3)${ytm ? ' <small>recommended</small>' : ''}`, () => startDownload(item, 'audio', 'best'));
    };
    if (ytm) audio();   // YouTube Music: MP3 first and highlighted
    add('dm-sec', 'Video (MP4)');
    add('dm-item', '▶ Best quality <small>largest file</small>', () => startDownload(item, 'video', 'best'));
    add('dm-item', '▶ 1080p', () => startDownload(item, 'video', '1080'));
    add('dm-item', '▶ 720p', () => startDownload(item, 'video', '720'));
    add('dm-item', '▶ 480p <small>smallest</small>', () => startDownload(item, 'video', '480'));
    if (!ytm) audio();
  }
  if (item.localVideo || item.localAudio) {
    m.appendChild(document.createElement('hr'));
    if (item.localVideo) add('dm-item', '📁 Show saved video', () => P.showInFolder(item.localVideo));
    if (item.localAudio) add('dm-item', '📁 Show saved MP3', () => P.showInFolder(item.localAudio));
    add('dm-item', '🗑 Delete local copy', () => deleteLocalCopy(item));
  }
  m.appendChild(document.createElement('hr'));
  add('dm-note', `Videos → ${esc(info.dirs.video)}<br>Audio → ${esc(info.dirs.audio)}`);
  add('dm-item', '\ud83d\uddc2 Manage library\u2026', openDownloadsManager);
  add('dm-item', 'Change folders…', openDirDialog);
  add('dm-warn', 'Only download videos you have the right to save.');
  WM.popup(m, pos);
}
async function startDownload(item, kind, quality, quiet) {
  // If the YouTube player already knows this is a live stream, don't even start yt-dlp.
  try {
    if (curItem() === item && engine === 'youtube' && yt && yt.getVideoData && yt.getVideoData().isLive) {
      showDlBar({ text: '✕ Live streams can’t be downloaded until they end.', pct: 0, hideAfter: 6000 });
      return;
    }
  } catch (_) {}
  const res = await P.dlStart({ id: item.id, vid: item.vid, url: item.url, kind, quality, title: item.title });
  if (res && res.ok && CD.itemId === item.id) {   // the choice sheet waits for this download now
    cdStop();
    $('#ovText').textContent = item.type === 'x' ? 'It’s downloading now and plays when it’s done.' : 'It’s downloading now. You can play it when it’s done.';
  }
  if (!res || !res.ok) {
    const why = { busy: 'That download is already running.', queued: 'That download is already queued.', missing: 'The downloader isn’t included in this copy of SlopAMP.', unsupported: 'Only YouTube videos and X posts can be downloaded.' }[res && res.reason] || 'Couldn’t start the download.';
    if (!quiet) toast(why);
  }
  return res;
}
// A finished download: every playlist item for the same video or post now plays from it. An X post whose
// choice sheet is still up starts playing (that's what the user asked for when they picked Download).
const fileTitle = (f) => String(f).split(/[\\/]/).pop().replace(/\.[^.]+$/, '').replace(/\s*\[[^\]]+\]$/, '').trim();
function linkDownload(item, ev) {
  const vid = (item && item.vid) || ev.vid;
  for (const it of allItems()) {
    if (!(it === item || (vid && isWeb(it) && it.vid === vid))) continue;
    if (ev.kind === 'audio') it.localAudio = ev.file; else it.localVideo = ev.file;
    if (it.type === 'x' && placeholderTitle(it)) { const t = fileTitle(ev.file); if (t) it.title = t; }   // the post's text, as yt-dlp named the file
  }
  saveSoon();
  if (item && item.type === 'x') histXDownloaded(item);   // X History: a finished X download
  if (item && item.type === 'x' && xSheetFor === item.id && curItem() === item && !engine && $('#overlay').classList.contains('show')) { xSheetFor = null; replayCurrent(); }
}
P.onDl((ev) => {
  const prev = DL.get(ev.id) || {};
  const d = { ...prev, ...ev };
  DL.set(ev.id, d);
  if ((ev.status === 'error' || ev.status === 'canceled') && sheet && sheet.itemId === ev.id && $('#overlay').classList.contains('show') && curItem() && curItem().id === ev.id) {
    sheet.show(ev.status === 'error' ? `The download failed${ev.error ? `: ${String(ev.error).replace(/[.\s]+$/, '')}` : ''}.` : 'The download was canceled.');
  }
  const item = allItems().find(i => i.id === ev.id);
  const title = (item && item.title) || ev.title || prev.title || 'video';
  if (dlBatch && dlBatch.ids.has(ev.id) && ['done', 'error', 'canceled'].includes(ev.status)) {
    dlBatch.ids.delete(ev.id);
    dlBatch[ev.status === 'done' ? 'done' : ev.status === 'error' ? 'failed' : 'canceled']++;
    if (ev.status === 'done' && ev.file) linkDownload(item, ev);
    if (ev.status === 'error' && ev.live && item) markLive(item, true);
    if (ev.status === 'done') updateDlInfo();
    if (!dlBatch.ids.size) finishDlBatch(); else renderDlProgress();
    renderList();
    return;
  }
  if (ev.status === 'done' && ev.file) {
    linkDownload(item, ev);
    const blockedHere = item && curItem() === item && engine === 'youtube' && $('#overlay').classList.contains('show');
    if (blockedHere) showOverlay('Download finished', `"${title}" is saved on your PC.`, [{ label: '\u25b6 Play now', action: () => replayCurrent() }, { label: 'Skip', action: () => next(true) }]);
    const note = item && curItem() === item && engine === 'youtube' && !blockedHere ? ' — plays from your copy next time' : '';
    updateDlInfo();
    showDlBar({ text: `✓ Saved: ${title}${note}`, pct: 100, buttons: [['Show in folder', () => P.showInFolder(ev.file)]], hideAfter: 8000 });
  } else if (ev.status === 'error') {
    if (ev.live && item) markLive(item, true);
    showDlBar({ text: `✕ Download failed: ${ev.error || 'unknown error'}`, pct: 0, buttons: item ? [['Try again', () => openDlMenu(item, { doc: $('#dlBar').ownerDocument, x: 20, y: 20 })]] : [], hideAfter: 12000 });
  } else if (ev.status === 'canceled') {
    showDlBar({ text: `Download canceled: ${title}`, pct: 0, hideAfter: 3000 });
  } else {
    renderDlProgress();
  }
  renderList();
});
function renderDlProgress() {
  const active = [...DL.entries()].find(([, d]) => ['updating', 'downloading', 'processing'].includes(d.status));
  const queued = [...DL.values()].filter(d => d.status === 'queued').length;
  if (!active) { if (queued) showDlBar({ text: `⇩ ${queued} download${queued > 1 ? 's' : ''} queued`, busy: true }); return; }
  const [id, d] = active;
  const item = allItems().find(i => i.id === id);
  const t = (item && item.title) || d.title || 'video';
  const kind = d.kind === 'audio' ? 'MP3' : 'MP4';
  let text;
  if (d.status === 'updating') text = `⇩ ${t} (${kind}) — getting ready…`;
  else if (d.status === 'processing') text = `⇩ ${t} (${kind}) — finishing up…`;
  else text = `⇩ ${t} (${kind}) — ${Math.floor(dlOverall(d))}%${d.speed ? ` · ${d.speed}` : ''}${d.eta ? ` · ${d.eta} left` : ''}`;
  if (dlBatch && dlBatch.ids.has(id)) {
    const pos = dlBatch.total - dlBatch.ids.size + 1;
    text = `[${pos} of ${dlBatch.total}] ${text}`;
    showDlBar({ text, pct: dlOverall(d), busy: d.status !== 'downloading', cancelId: id, buttons: [['Cancel all', cancelDlBatch]] });
    return;
  }
  if (queued) text += `  (+${queued} queued)`;
  showDlBar({ text, pct: dlOverall(d), busy: d.status !== 'downloading', cancelId: id });
}
function showDlBar({ text, pct = 0, busy = false, buttons = [], hideAfter = 0, cancelId = null }) {
  const bar = $('#dlBar');
  if (bar.classList.contains('hidden')) WM.host(bar, WM.noticeDoc());
  clearTimeout(dlBarTimer);
  $('#dlbText').textContent = text; $('#dlbText').title = text;
  $('#dlbProg').classList.toggle('busy', busy);
  $('#dlbFill').style.width = `${Math.max(0, Math.min(100, pct))}%`;
  const bb = $('#dlbBtns'); bb.innerHTML = '';
  for (const [label, fn] of buttons) { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { bar.classList.add('hidden'); fn(); }; bb.appendChild(b); }
  bb.classList.toggle('hidden', !buttons.length);
  const x = $('#dlbClose');
  x.title = cancelId ? 'Cancel download' : 'Close';
  x.onclick = () => { if (cancelId) P.dlCancel(cancelId); else bar.classList.add('hidden'); };
  bar.classList.remove('hidden');
  if (hideAfter) dlBarTimer = setTimeout(() => { bar.classList.add('hidden'); renderDlProgress(); }, hideAfter);
}
function confirmBox(title, text, okLabel) {
  return new Promise((resolve) => {
    const d = $('#confirmDlg');
    $('#confirmTitle').textContent = title; $('#confirmText').textContent = text; $('#confirmOk').textContent = okLabel || 'OK';
    d.returnValue = 'cancel';
    d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
    d.showModal();
  });
}
async function deleteLocalCopy(item) {
  const files = [item.localVideo, item.localAudio].filter(Boolean);
  if (!files.length) return;
  const ok = await confirmBox('Delete local copy?', `This moves the downloaded file${files.length > 1 ? 's' : ''} to the Recycle Bin:\n\n${files.join('\n')}\n\nThe ${item.type === 'x' ? 'X post' : 'YouTube item'} stays in your playlist.`, 'Delete');
  if (!ok) return;
  const wasCurrent = curItem() === item && engine === 'local';
  if (wasCurrent) { stopEngines(); setStatus('stopped'); }
  let failed = 0;
  for (const f of files) {
    const r = await P.trashFile(f);
    if (r && r.ok || (r && r.error === 'File not found.')) {
      for (const it of allItems()) {
        if (it.localVideo === f) delete it.localVideo;
        if (it.localAudio === f) delete it.localAudio;
      }
      if (item.vid) P.dlForget(item.vid, files.length > 1 ? undefined : (f.toLowerCase().endsWith('.mp3') ? 'audio' : 'video'));
    } else failed++;
  }
  saveSoon(); renderList();
  if (failed) toast('Couldn’t delete the file — it may be open in another program.', 4000);
  else toast('Local copy moved to the Recycle Bin.');
  if (wasCurrent) { engine = item.type === 'x' && !localPathOf(item) ? null : 'youtube'; setMarquee(item); }
}
async function openDirDialog() {
  const fill = (dirs) => { $('#dirVideo').textContent = dirs.video; $('#dirVideo').title = dirs.video; $('#dirAudio').textContent = dirs.audio; $('#dirAudio').title = dirs.audio; };
  fill((await P.dlInfo()).dirs);
  $('#dirVideoBtn').onclick = async () => fill(await P.dlChooseDir('video'));
  $('#dirAudioBtn').onclick = async () => fill(await P.dlChooseDir('audio'));
  $('#dirReset').onclick = async () => fill(await P.dlResetDirs());
  $('#dlDirDlg').showModal();
}
// Re-link YouTube and X items to copies downloaded earlier (survives playlist SAVE/LOAD, re-pasting links).
async function attachKnownCopies(items) {
  const yt = (items || allItems()).filter(i => isWeb(i) && i.vid && !i.localVideo && !i.localAudio);
  if (!yt.length) return;
  const found = await P.dlLookup([...new Set(yt.map(i => i.vid))]);
  let changed = false;
  for (const it of yt) {
    const f = found[it.vid]; if (!f) continue;
    if (f.video) { it.localVideo = f.video; changed = true; }
    if (f.audio) { it.localAudio = f.audio; changed = true; }
    if (it.type === 'x' && placeholderTitle(it) && (f.video || f.audio)) { const t = fileTitle(f.video || f.audio); if (t) it.title = t; }
  }
  if (changed) { renderList(); saveSoon(); }
}
async function verifyLocalCopies() {
  const list_ = [];
  for (const it of allItems()) for (const k of ['localVideo', 'localAudio']) if (it[k]) list_.push([it, k]);
  if (!list_.length) return;
  const ok = await P.filesExist(list_.map(([it, k]) => it[k]));
  let changed = false;
  list_.forEach(([it, k], i) => {
    if (!ok[i]) { delete it[k]; changed = true; }
    else if (it.vid) P.dlRemember(it.vid, k === 'localAudio' ? 'audio' : 'video', it[k], placeholderTitle(it) ? '' : it.title);   // index copies made before this version
  });
  if (changed) { renderList(); saveSoon(); }
}

// ------------------------------------------------------------------ popup menus (speed, CC, download all)
function openPop(build, anchor, above) {
  const m = $('#popMenu'); m.innerHTML = ''; m.classList.remove('wide');
  const add = (cls, text, fn, title) => {
    const d = document.createElement('div'); d.className = cls; d.textContent = text; if (title) d.title = title;
    if (fn) d.onclick = () => { hidePop(); fn(); };
    m.appendChild(d); return d;
  };
  const hr = () => m.appendChild(document.createElement('hr'));
  build(add, hr);
  const r = anchor.getBoundingClientRect();
  m.anchor = anchor;
  WM.popup(m, { doc: anchor.ownerDocument, x: r.left, y: r.bottom + 3, flipY: r.top, above: !!above });
}
function hidePop() { $('#popMenu').classList.add('hidden'); }
WM.onDocs('mousedown', (e) => { const m = $('#popMenu'); if (!m.contains(e.target) && !(m.anchor && m.anchor.contains(e.target))) hidePop(); });

// ------------------------------------------------------------------ resume where you left off
const RESUME_MIN_LEN = 300;   // only items 5 minutes or longer
let resumeAtBoot = null, resumeBarTimer = null;
function resumeKey(item) {
  if (!item) return null;
  if (item.type === 'file' && item.path) return 'f:' + item.path.toLowerCase();
  return item.vid ? 'y:' + item.vid : null;
}
function resumePoint(item) {
  const k = resumeKey(item); if (!k || item.live) return 0;
  const r = S.resume[k];
  return r && r.t >= 10 ? r.t : 0;
}
function forgetResume(item) { const k = resumeKey(item); if (k && S.resume[k]) { delete S.resume[k]; saveSoon(); } }
function recordResume() {
  const item = curItem();
  const k = resumeKey(item);
  if (!k || item.live || status === 'stopped' || !engine) return;
  const d = currentDuration(), t = currentTime();
  if (!d || d < RESUME_MIN_LEN) return;
  if (t < 15 || t > d - 30) { delete S.resume[k]; return; }
  S.resume[k] = { t: Math.floor(t), at: Date.now() };
  const keys = Object.keys(S.resume);
  if (keys.length > 300) keys.sort((a, b) => S.resume[a].at - S.resume[b].at).slice(0, keys.length - 300).forEach(x => delete S.resume[x]);
}
setInterval(() => { if (status === 'playing') { recordResume(); saveSoon(); } }, 5000);
window.addEventListener('beforeunload', () => { recordResume(); saveNow(); });
function showResumeBar(t) {
  $('#resumeText').textContent = `↺ Resumed at ${fmt(t)}`;
  $('#resumeBar').classList.remove('hidden');
  $('#toast').classList.add('hidden');
  clearTimeout(resumeBarTimer); resumeBarTimer = setTimeout(hideResumeBar, 8000);
}
function hideResumeBar() { clearTimeout(resumeBarTimer); $('#resumeBar').classList.add('hidden'); }
$('#resumeOver').onclick = () => { forgetResume(curItem()); hideResumeBar(); seekTo(0); };
$('#resumeX').onclick = hideResumeBar;

// ------------------------------------------------------------------ playback speed
const SPEEDS = [1, 1.5, 2, 3];
const YT_MAX_RATE = 2;
function effectiveRate() { return engine === 'youtube' ? Math.min(S.rate, YT_MAX_RATE) : S.rate; }
function applyRate() {
  if (engine === 'local') {
    video.preservesPitch = true;
    video.defaultPlaybackRate = S.rate;
    video.playbackRate = S.rate;
  } else if (engine === 'youtube' && yt && yt.setPlaybackRate) {
    try { yt.setPlaybackRate(effectiveRate()); } catch (_) {}
  }
  renderSpeed();
}
function setRate(r) {
  if (!SPEEDS.includes(r)) return;
  S.rate = r;
  applyRate();
  if (engine === 'youtube' && r > YT_MAX_RATE) toast(`YouTube plays at most ${YT_MAX_RATE}× — 3× works on local files and downloads.`, 3500);
  else toast(`Speed ${r}×`, 1000);
}
function stepRate(d) { const i = SPEEDS.indexOf(S.rate); setRate(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 0 : i) + d))]); }
function renderSpeed() {
  const b = $('#vSpeed'); const r = effectiveRate();
  b.textContent = `${r}×`;
  b.classList.toggle('on', r !== 1);
}
function openSpeedMenu() {
  openPop((add) => {
    add('dm-sec', 'Speed');
    for (const r of SPEEDS) {
      const ytNo = engine === 'youtube' && r > YT_MAX_RATE;
      const label = r === 1 ? '1× (normal)' : `${r}×`;
      const el = add(`dm-item${S.rate === r ? ' cur' : ''}${ytNo ? ' off' : ''}`, label + (ytNo ? '  — not on YouTube' : ''), ytNo ? null : () => setRate(r));
      if (ytNo) el.title = 'YouTube’s player goes up to 2×. 3× works for local files and downloaded copies.';
    }
  }, $('#vSpeed'), true);
}

// ------------------------------------------------------------------ subtitles
const SUBS = { item: null, list: { embedded: [], external: [] }, cur: null, cues: [], shown: '', token: 0, extra: new Map(), ytLang: '' };
let ytCcItem = null;
function clearSubs() {
  SUBS.token++; SUBS.item = null; SUBS.cur = null; SUBS.cues = []; SUBS.list = { embedded: [], external: [] };
  SUBS.shown = ''; $('#subs').classList.add('hidden'); $('#subs').innerHTML = '';
  ytCcItem = null;
  renderCc();
}
function subTracks() {
  const extra = SUBS.item ? SUBS.extra.get(SUBS.item.id) || [] : [];
  return [...SUBS.list.external, ...extra, ...SUBS.list.embedded];
}
async function loadSubsFor(item) {
  const lp = localPathOf(item);
  if (SUBS.item === item && SUBS.cur) return;          // same item re-loaded (FFmpeg fallback): keep the choice
  const token = ++SUBS.token;
  SUBS.item = item; SUBS.cur = null; SUBS.cues = [];
  const list = lp ? await P.listSubs(lp) : null;
  if (token !== SUBS.token || curItem() !== item) return;
  SUBS.list = list || { embedded: [], external: [] };
  renderCc();
  if (S.subsOn) {
    const usable = subTracks().filter(t => t.url);
    const eng = (t) => /^(en|eng)$/.test(t.lang || '') || /\.en(g)?\./i.test(t.label || '');
    const pick = SUBS.list.external.find(eng) || SUBS.list.external[0] || usable.find(t => t.def && !t.forced) || usable.find(eng) || usable[0];
    if (pick) pickSub(pick.id, true);
  }
}
async function pickSub(id, auto) {
  if (!id) {
    SUBS.cur = null; SUBS.cues = []; SUBS.shown = ''; $('#subs').classList.add('hidden');
    if (!auto) { S.subsOn = false; saveSoon(); }
    renderCc(); return;
  }
  const t = subTracks().find(x => x.id === id);
  if (!t || !t.url) return;
  const token = SUBS.token;
  let text = '';
  try { const r = await fetch(t.url); text = r.ok ? await r.text() : ''; } catch (_) {}
  if (token !== SUBS.token) return;
  const cues = parseVtt(text);
  if (!cues.length) { toast(`Couldn’t read subtitles from "${t.label}".`, 3500); return; }
  SUBS.cur = id; SUBS.cues = cues; SUBS.shown = '';
  if (!auto) { S.subsOn = true; saveSoon(); }
  renderCc();
}
function vttTime(s) {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(s); if (!m) return NaN;
  return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000;
}
function parseVtt(text) {
  const cues = [];
  for (const block of String(text || '').replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) continue;
    const [a, rest] = lines[i].split('-->');
    const start = vttTime(a), end = vttTime(rest || '');
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    let body = lines.slice(i + 1).join('\n').trim();
    if (!body) continue;
    const top = /\{\\an[789]\}/.test(body) || /\bline:(\d|1\d)%/.test(rest) || /\bline:0\b/.test(rest);
    body = body.replace(/\{\\[^}]*\}/g, '');
    cues.push({ start, end, html: cleanCue(body), top });
  }
  cues.sort((x, y) => x.start - y.start);
  return cues;
}
function cleanCue(t) {
  const esc = t.replace(/&(?!(amp|lt|gt|nbsp|quot);)/g, '&amp;').replace(/</g, '\u0001').replace(/>/g, '\u0002');
  return esc
    .replace(/\u0001(\/?)([ibu])(\.[^\u0002]*)?\u0002/gi, '<$1$2>')   // keep italic / bold / underline
    .replace(/\u0001[^\u0002]*\u0002/g, '')                            // drop every other tag
    .replace(/[\u0001\u0002]/g, '')
    .replace(/\\N/g, '\n');
}
function renderSubs() {
  const el = $('#subs');
  if (!SUBS.cues.length || engine !== 'local' || status === 'stopped') { if (SUBS.shown) { SUBS.shown = ''; el.classList.add('hidden'); } return; }
  const t = currentTime();
  const act = [];
  for (const c of SUBS.cues) { if (c.start > t) break; if (c.end > t) act.push(c); }
  const html = act.map(c => `<span>${c.html}</span>`).join('<br>');
  if (html === SUBS.shown) return;
  SUBS.shown = html;
  el.innerHTML = html;
  el.classList.toggle('top', act.length > 0 && act.every(c => c.top));
  el.classList.toggle('hidden', !html);
}
function renderCc() {
  const on = engine === 'youtube' ? S.subsOn : !!SUBS.cur;
  $('#vCc').classList.toggle('on', on);
  $('#vCc').title = engine === 'youtube' ? `Subtitles: YouTube captions ${S.subsOn ? 'on' : 'off'}` : SUBS.cur ? `Subtitles: ${(subTracks().find(t => t.id === SUBS.cur) || {}).label || 'on'}` : 'Subtitles: off';
}
function ytApplyCaptions() {
  if (!yt) return;
  try {
    if (S.subsOn) {
      yt.loadModule('captions');
      if (SUBS.ytLang) yt.setOption('captions', 'track', { languageCode: SUBS.ytLang });
    } else {
      yt.unloadModule('captions');
    }
  } catch (_) {}
  renderCc();
}
function ytTrackList() { try { return (yt && yt.getOption && yt.getOption('captions', 'tracklist')) || []; } catch (_) { return []; } }
function openCcMenu() {
  const item = curItem();
  openPop((add, hr) => {
    add('dm-sec', 'Subtitles');
    if (!item || status === 'stopped' && !engine) { add('dm-note', 'Play something first.'); return; }
    if (engine === 'youtube') {
      add(`dm-item${!S.subsOn ? ' cur' : ''}`, 'Off', () => { S.subsOn = false; saveSoon(); ytApplyCaptions(); });
      const tracks = S.subsOn ? ytTrackList() : [];
      if (tracks.length) {
        for (const tr of tracks) add(`dm-item${S.subsOn && SUBS.ytLang === tr.languageCode ? ' cur' : ''}`, tr.displayName || tr.languageName || tr.languageCode, () => { S.subsOn = true; SUBS.ytLang = tr.languageCode; saveSoon(); ytApplyCaptions(); });
      } else {
        add(`dm-item${S.subsOn ? ' cur' : ''}`, 'On (YouTube captions)', () => { S.subsOn = true; saveSoon(); ytApplyCaptions(); setTimeout(() => { if (!ytTrackList().length) toast('Captions on — if nothing shows, this video has no captions.', 3500); }, 2500); });
      }
      hr();
      add('dm-note', 'Captions come from YouTube. Open this menu again after turning them on to pick a language.');
      return;
    }
    add(`dm-item${!SUBS.cur ? ' cur' : ''}`, 'Off', () => pickSub(null));
    const ext = [...SUBS.list.external, ...(SUBS.extra.get(item.id) || [])];
    for (const t of SUBS.list.embedded) {
      if (t.url) add(`dm-item${SUBS.cur === t.id ? ' cur' : ''}`, `${t.label} (in file)`, () => pickSub(t.id));
      else add('dm-item off', `${t.label} (in file — picture subtitles not supported)`);
    }
    for (const t of ext) add(`dm-item${SUBS.cur === t.id ? ' cur' : ''}`, t.label + (SUBS.list.external.includes(t) ? ' (next to video)' : ''), () => pickSub(t.id), t.path);
    if (!SUBS.list.embedded.length && !ext.length) add('dm-note', 'No subtitles found in the file or next to it.');
    hr();
    add('dm-item', 'Load subtitle file…', async () => {
      const t = await P.openSubDialog(localPathOf(item));
      if (!t || curItem() !== item) return;
      const list = SUBS.extra.get(item.id) || [];
      if (!list.some(x => x.id === t.id)) list.push(t);
      SUBS.extra.set(item.id, list);
      SUBS.item = item;
      pickSub(t.id);
    });
  }, $('#vCc'), true);
}

// ------------------------------------------------------------------ keyboard media keys + Windows media controls
const lastKey = {};
function mediaKey(action) {
  const cat = ['play', 'pause', 'playpause'].includes(action) ? 'playpause' : action;
  const now = Date.now();
  if (now - (lastKey[cat] || 0) < 350) return;    // the same key press can arrive by two routes
  lastKey[cat] = now;
  if (action === 'playpause') togglePlay();
  else if (action === 'play') { if (status !== 'playing') play(); }
  else if (action === 'pause') { if (status === 'playing') pause(); }
  else if (action === 'next') next(false);
  else if (action === 'prev') prev();
  else if (action === 'stop') stop();
}
P.onMediaKey(mediaKey);
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const h = { play: 'play', pause: 'pause', stop: 'stop', previoustrack: 'prev', nexttrack: 'next' };
  for (const [ev, a] of Object.entries(h)) { try { ms.setActionHandler(ev, () => mediaKey(a)); } catch (_) {} }
  try { ms.setActionHandler('seekbackward', () => seekBy(-10)); ms.setActionHandler('seekforward', () => seekBy(10)); } catch (_) {}
}
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const item = curItem();
  try {
    navigator.mediaSession.playbackState = status === 'playing' ? 'playing' : status === 'paused' ? 'paused' : 'none';
    if (item && navigator.mediaSession._item !== item) {
      navigator.mediaSession._item = item;
      const dash = item.title.indexOf(' - ');
      const art = [{ src: new URL('icon.png', location.href).href, sizes: '256x256', type: 'image/png' }];
      if (L.prep && L.prep.coverUrl && engine === 'local') art.unshift({ src: L.prep.coverUrl, type: 'image/png' });
      navigator.mediaSession.metadata = new MediaMetadata(dash > 0
        ? { artist: item.title.slice(0, dash), title: item.title.slice(dash + 3), album: 'SlopAMP', artwork: art }
        : { title: item.title, artist: 'SlopAMP', artwork: art });
    }
  } catch (_) {}
}

// ------------------------------------------------------------------ download the whole playlist
let dlBatch = null;   // { ids:Set, total, done, failed, canceled }
function openDlAllMenu() {
  const yts = S.items.filter(isWeb);
  const xs = yts.filter(i => i.type === 'x').length, what = xs === yts.length ? 'X posts' : xs ? 'YouTube and X items' : 'YouTube items';
  openPop((add, hr) => {
    add('dm-sec', `Download all ${what} in "${S.tabs[S.tab].name}" (${yts.length})`);
    if (dlBatch) {
      add('dm-note', `Downloading ${dlBatch.total - dlBatch.ids.size + 1} of ${dlBatch.total}…`);
      add('dm-item', '✕ Cancel all', cancelDlBatch);
      return;
    }
    if (!yts.length) { add('dm-note', 'There are no YouTube videos or X posts in the playlist.'); return; }
    const need = (kind) => dlTargets(kind).length;
    const n = (kind) => { const c = need(kind); return c === yts.length ? '' : c ? `  (${c} to go)` : '  (all saved)'; };
    add('dm-item', `♫ All as MP3${n('audio')}`, () => downloadAll('audio', 'best'));
    add('dm-item', `▶ All as video — Best${n('video')}`, () => downloadAll('video', 'best'));
    add('dm-item', '▶ All as video — 1080p', () => downloadAll('video', '1080'));
    add('dm-item', '▶ All as video — 720p', () => downloadAll('video', '720'));
    add('dm-item', '▶ All as video — 480p', () => downloadAll('video', '480'));
    hr();
    add('dm-note', 'Skips live streams and items already saved. Downloads run one at a time.');
    add('dm-warn', 'Only download videos you have the right to save.');
  }, $('#pDlAll'), true);
}
function dlTargets(kind) {
  const seen = new Set();
  return S.items.filter(it => {
    if (!isWeb(it) || !it.vid || it.live || seen.has(it.vid)) return false;
    seen.add(it.vid);
    if (kind === 'audio' ? it.localAudio : it.localVideo) return false;
    const d = DL.get(it.id);
    return !(d && DL_BUSY.includes(d.status));
  });
}
async function downloadAll(kind, quality) {
  if (dlBatch) return;
  const info = await P.dlInfo();
  if (!info.available) { toast('The downloader isn’t included in this copy of SlopAMP.'); return; }
  const targets = dlTargets(kind);
  if (!targets.length) { toast(kind === 'audio' ? 'Every item already has an MP3.' : 'Every item is already saved.', 3000); return; }
  dlBatch = { ids: new Set(), total: 0, done: 0, failed: 0, canceled: 0 };
  for (const it of targets) {
    if (!dlBatch) break;
    dlBatch.ids.add(it.id); dlBatch.total++;
    const res = await startDownload(it, kind, quality, true);
    if (!dlBatch) break;
    if (!res || !res.ok) { dlBatch.ids.delete(it.id); dlBatch.total--; }
  }
  if (dlBatch && !dlBatch.total) { dlBatch = null; toast('Couldn’t start the downloads.'); return; }
  if (dlBatch) renderDlProgress();
}
function cancelDlBatch() { if (!dlBatch) return; for (const id of [...dlBatch.ids]) P.dlCancel(id); }
function finishDlBatch() {
  const b = dlBatch; dlBatch = null;
  if (!b) return;
  const extra = [b.failed ? `${b.failed} failed or live` : '', b.canceled ? `${b.canceled} canceled` : ''].filter(Boolean).join(', ');
  showDlBar({ text: `${b.done ? '✓' : '✕'} Downloaded ${b.done} of ${b.total}${extra ? ` (${extra})` : ''}`, pct: b.total ? b.done / b.total * 100 : 0, hideAfter: 10000 });
}

// ------------------------------------------------------------------ Downloads manager
const DLM = { rows: [], sel: new Set(), filter: 'all', sort: 'mtime', dir: -1, anchor: -1 };
const dlmKey = (r) => `${r.kind}|${r.path}`;
function fmtSize(b) {
  if (!b) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b >= 100 || i === 0 ? Math.round(b) : b.toFixed(1)} ${u[i]}`;
}
function fmtDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms), now = new Date();
  return d.toLocaleDateString(undefined, d.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}
async function openDownloadsManager(filter) {
  hideDlMenu(); hidePop();
  if (typeof filter === 'string') DLM.filter = filter;     // 'slop' from the SLOP window
  DLM.sel.clear(); DLM.anchor = -1;
  await dlmRefresh();
  if (slopMode()) await slopLibRefresh();
  if (skinMode()) await sklRefresh();
  dlmApplySize();
  if (!$('#dlmDlg').open) $('#dlmDlg').showModal();
}
async function dlmRefresh() {
  const [dl, pls] = await Promise.all([P.dlmList(), P.plList()]);
  const rows = dl.concat(pls);
  for (const r of rows) {   // the playlist usually has the nicest title
    const it = allItems().find(i => isWeb(i) && i.vid === r.vid && !placeholderTitle(i));
    if (it && (!r.title || /\[([\w-]{11}|x\d+(-\d+)?)\]/.test(r.title) || r.title === r.path)) r.title = it.title;
  }
  DLM.rows = rows;
  updateDlInfo();
  for (const k of [...DLM.sel]) if (!rows.some(r => dlmKey(r) === k)) DLM.sel.delete(k);
  dlmRender();
}
function dlmVisible() {
  const f = DLM.filter;
  const q = ($('#dlmSearch').value || '').trim().toLowerCase();
  const v = DLM.rows.filter(r => (f === 'all' || r.kind === f) && (!q || String(r.title).toLowerCase().includes(q) || String(r.path).toLowerCase().split(/[\\/]/).pop().includes(q)));
  const k = DLM.sort, dir = DLM.dir;
  v.sort((a, b) => {
    let x = a[k], y = b[k];
    if (k === 'title') { x = String(x).toLowerCase(); y = String(y).toLowerCase(); }
    if (k === 'kind') { x = a.missing ? 'z' : a.kind; y = b.missing ? 'z' : b.kind; }
    return (x < y ? -1 : x > y ? 1 : 0) * dir || (b.mtime - a.mtime);
  });
  return v;
}
function dlmRender() {
  for (const b of $('#dlmSeg').children) b.classList.toggle('on', b.dataset.f === DLM.filter);
  if (slopMode()) { $('#dlmDlg').classList.remove('skinmode'); slopLibRender(); return; }       // Library → SLOP (see below)
  if (skinMode()) { sklRender(); return; }           // Library → SKINS
  $('#dlmDlg').classList.remove('slopmode', 'skinmode');
  $('#dlmSearch').placeholder = 'Search your library\u2026';
  const vis = dlmVisible();
  const present = DLM.rows.filter(r => !r.missing && r.kind !== 'playlist');
  const pls = DLM.rows.filter(r => r.kind === 'playlist').length;
  const total = present.reduce((a, r) => a + r.size, 0);
  const miss = DLM.rows.filter(r => r.missing).length;
  $('#dlmCount').textContent = `${present.length} FILE${present.length === 1 ? '' : 'S'} · ${total ? fmtSize(total).toUpperCase() : '0 MB'} · ${pls} PLAYLIST${pls === 1 ? '' : 'S'}`;
  $('#dlmMiss').textContent = miss ? `${miss} missing` : '';
  $('#dlmClean').disabled = !miss;
  $('#dlmDelAll').disabled = !vis.some(r => !r.missing);
  for (const b of $('#dlmSeg').children) b.classList.toggle('on', b.dataset.f === DLM.filter);
  for (const th of $$('#dlmDlg th[data-sort]')) { th.classList.toggle('asc', th.dataset.sort === DLM.sort && DLM.dir > 0); th.classList.toggle('desc', th.dataset.sort === DLM.sort && DLM.dir < 0); }
  const body = $('#dlmBody'); body.innerHTML = '';
  vis.forEach((r, i) => {
    const tr = document.createElement('tr');
    const on = DLM.sel.has(dlmKey(r));
    tr.className = (on ? 'sel' : '') + (r.missing ? ' miss' : '');
    tr.dataset.i = i;
    tr.innerHTML = `<td class="c"><span class="dlm-cb${on ? ' on' : ''}"></span></td><td class="t"></td><td><span class="dlm-tag ${r.missing ? 'missing' : r.kind}">${r.missing ? 'MISSING' : r.kind === 'audio' ? 'MP3' : r.kind === 'playlist' ? 'PLAYLIST' : 'VIDEO'}</span></td><td class="r">${r.missing ? '—' : fmtSize(r.size)}</td><td class="r">${fmtDate(r.mtime)}</td><td class="c">${r.missing ? '' : '<button class="dlm-show" title="Show in folder">📁</button>'}</td>`;
    tr.querySelector('.t').textContent = r.title; tr.querySelector('.t').title = `${r.title}\n${r.path}`;
    if (r.kind === 'playlist') { const c = document.createElement('span'); c.className = 'dlm-count'; c.textContent = ` \u00b7 ${r.count} item${r.count === 1 ? '' : 's'}`; tr.querySelector('.t').appendChild(c); }
    body.appendChild(tr);
  });
  $('#dlmEmpty').classList.toggle('hidden', vis.length > 0);
  const q = ($('#dlmSearch').value || '').trim();
  $('#dlmEmpty').textContent = q ? `Nothing matches "${q}".`
    : DLM.filter === 'playlist' ? 'No saved playlists yet. Use SAVE under the playlist to save one here.'
    : DLM.rows.length ? 'Nothing here for this filter.' : 'Nothing in your library yet. Use DOWNLOAD or DOWNLOAD ALL to save YouTube videos, and SAVE to keep playlists.';
  $('#dlmSearchX').classList.toggle('hidden', !q);
  const selCount = vis.filter(r => DLM.sel.has(dlmKey(r))).length;
  const all = $('#dlmAll');
  all.classList.toggle('on', vis.length > 0 && selCount === vis.length);
  all.classList.toggle('part', selCount > 0 && selCount < vis.length);
  $('#dlmDel').disabled = !selCount;
  const selPl = vis.filter(r => r.kind === 'playlist' && DLM.sel.has(dlmKey(r)));
  $('#dlmOpenTab').classList.toggle('hidden', !selPl.length);
  $('#dlmOpenTab').textContent = selPl.length > 1 ? `\u25b6 Open ${selPl.length} in new tabs` : '\u25b6 Open in new tab';
  $('#dlmDel').textContent = `🗑 Delete selected${selCount ? ` (${selCount})` : ''}`;
}
$('#dlmBody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr'); if (!tr) return;
  const vis = dlmVisible(); const i = +tr.dataset.i; const r = vis[i]; if (!r) return;
  if (e.target.closest('.dlm-show')) { P.showInFolder(r.path); return; }
  if (e.detail >= 2) return;   // the double-click is handled on mousedown below
  const k = dlmKey(r);
  if (e.shiftKey && DLM.anchor >= 0) {
    const [a, b] = [Math.min(DLM.anchor, i), Math.max(DLM.anchor, i)];
    if (!e.ctrlKey) DLM.sel.clear();
    for (let j = a; j <= b; j++) DLM.sel.add(dlmKey(vis[j]));
  } else if (e.ctrlKey || e.target.closest('.dlm-cb')) {
    if (DLM.sel.has(k)) DLM.sel.delete(k); else DLM.sel.add(k);
    DLM.anchor = i;
  } else {
    const only = DLM.sel.size === 1 && DLM.sel.has(k);
    DLM.sel.clear(); if (!only) DLM.sel.add(k);
    DLM.anchor = i;
  }
  dlmRender();
});
// Double-click a row: open a playlist / show a file. Rows are rebuilt on each click, so the browser's
// own dblclick event gets lost; the second press of a double-click is caught here instead.
$('#dlmBody').addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.detail !== 2 || e.shiftKey || e.ctrlKey || e.target.closest('.dlm-show')) return;
  const tr = e.target.closest('tr'); if (!tr) return;
  const r = dlmVisible()[+tr.dataset.i]; if (!r || r.missing) return;
  e.preventDefault();
  DLM.sel = new Set([dlmKey(r)]); DLM.anchor = +tr.dataset.i; dlmRender();
  if (r.kind === 'playlist') openPlaylistFiles([r]); else P.showInFolder(r.path);
});
$('#dlmAll').onclick = () => {
  const vis = dlmVisible();
  const allOn = vis.length && vis.every(r => DLM.sel.has(dlmKey(r)));
  for (const r of vis) { if (allOn) DLM.sel.delete(dlmKey(r)); else DLM.sel.add(dlmKey(r)); }
  dlmRender();
};
for (const th of $$('#dlmDlg th[data-sort]')) {
  th.onclick = () => { const k = th.dataset.sort; if (DLM.sort === k) DLM.dir = -DLM.dir; else { DLM.sort = k; DLM.dir = k === 'title' || k === 'kind' ? 1 : -1; } dlmRender(); };
}
for (const b of $('#dlmSeg').children) b.onclick = async () => { DLM.filter = b.dataset.f; DLM.anchor = -1; if (slopMode()) await slopLibRefresh(); if (skinMode()) await sklRefresh(); dlmApplySize(); dlmRender(); };
$('#dlmX').onclick = () => $('#dlmDlg').close();
$('#dlmOpen').onclick = () => P.dlOpenDir(DLM.filter === 'audio' ? 'audio' : DLM.filter === 'playlist' ? 'playlists' : 'video');
$('#dlmSearch').addEventListener('input', () => { DLM.anchor = -1; dlmRender(); });
$('#dlmSearch').addEventListener('keydown', (e) => { if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ''; dlmRender(); } });
$('#dlmSearchX').onclick = () => { $('#dlmSearch').value = ''; dlmRender(); $('#dlmSearch').focus(); };
$('#dlmOpenTab').onclick = () => openPlaylistFiles(dlmVisible().filter(r => r.kind === 'playlist' && DLM.sel.has(dlmKey(r))));
async function openPlaylistFiles(rows) {
  let opened = 0, last = '';
  for (const r of rows) {
    const res = await P.plOpen(r.path);
    if (!res || !res.entries) continue;
    newTab(r.title.slice(0, 40));
    if (res.entries.length) addDescribed(res.entries, undefined, false);
    opened++; last = r.title;
  }
  if (!opened) { toast('Couldn\u2019t open that playlist file.'); return; }
  $('#dlmDlg').close();
  toast(opened === 1 ? `Opened "${last}" in a new tab` : `Opened ${opened} playlists in new tabs`, 2200);
}
$('#dlmClean').onclick = async () => { const n = await P.dlmCleanMissing(); await dlmRefresh(); toast(`Removed ${n} missing entr${n === 1 ? 'y' : 'ies'}.`, 1800); };
$('#dlmDel').onclick = () => { const rows = dlmVisible().filter(r => DLM.sel.has(dlmKey(r))); if (rows.length) dlmDelete(rows); };
$('#dlmDelAll').onclick = () => { const rows = dlmVisible().filter(r => !r.missing); if (rows.length) dlmDelete(rows, true); };
$('#dlmDlg').addEventListener('keydown', (e) => {
  if (e.target && e.target.id === 'dlmSearch' && (e.key === 'Delete' || (e.ctrlKey && e.key.toLowerCase() === 'a'))) return;   // normal text editing
  if (skinMode()) {
    if (e.target && e.target.id === 'sklRenIn') return;
    if (e.key === 'Delete') { e.preventDefault(); if (!$('#sklDel').disabled) $('#sklDel').click(); }
    else if (e.key === 'Enter' && sklOne()) { e.preventDefault(); sklApply(sklOne()); }
    return;
  }
  if (slopMode()) {
    if (e.key === 'Delete') { e.preventDefault(); $('#slDel').click(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'a') { e.preventDefault(); for (const r of slopLibVisible()) SLIB.sel.add(r.id); slopLibRender(); }
    return;
  }
  if (e.key === 'Delete') { e.preventDefault(); $('#dlmDel').click(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'a') { e.preventDefault(); for (const r of dlmVisible()) DLM.sel.add(dlmKey(r)); dlmRender(); }
});
async function dlmDelete(allRows, all) {
  const plRows = allRows.filter(r => r.kind === 'playlist');
  const rows = allRows.filter(r => r.kind !== 'playlist');
  const files = rows.filter(r => !r.missing);
  const size = files.reduce((a, r) => a + r.size, 0) + plRows.reduce((a, r) => a + r.size, 0);
  const q = ($('#dlmSearch').value || '').trim();
  const what = DLM.filter === 'audio' ? 'MP3s' : DLM.filter === 'video' ? 'videos' : DLM.filter === 'playlist' ? 'saved playlists' : 'library items';
  const parts = [];
  if (files.length) parts.push(`${files.length} download${files.length === 1 ? '' : 's'}`);
  if (plRows.length) parts.push(`${plRows.length} saved playlist${plRows.length === 1 ? '' : 's'}`);
  const lines = [`${parts.join(' and ') || 'Nothing'} (${fmtSize(size)}) will go to the Recycle Bin.`];
  if (rows.length - files.length) lines.push(`${rows.length - files.length} missing entr${rows.length - files.length === 1 ? 'y' : 'ies'} will be removed from the list.`);
  if (files.length) lines.push('Playlist items stay and stream from YouTube again.');
  if (plRows.length) lines.push('Your playlist tabs in SlopAMP aren\u2019t affected.');
  const ok = await confirmBox(all ? `Delete all ${q ? `matching ${what}` : what}?` : `Delete ${allRows.length} item${allRows.length > 1 ? 's' : ''}?`, lines.join('\n\n'), 'Delete');
  if (!ok) return;
  let plFailed = 0;
  if (plRows.length) { const pr = await P.plDelete(plRows.map(r => r.path)); plFailed = pr.filter(x => !x.ok).length; }
  if (!rows.length) {
    DLM.sel.clear(); await dlmRefresh();
    toast(plFailed ? `${plFailed} playlist file${plFailed === 1 ? '' : 's'} couldn\u2019t be deleted.` : `${plRows.length} playlist${plRows.length === 1 ? '' : 's'} moved to the Recycle Bin.`, 2500);
    return;
  }
  const paths = new Set(rows.map(r => r.path));
  // Windows can't move a file that's playing: stop it first.
  const cur = curItem();
  const wasCurrent = cur && engine === 'local' && isWeb(cur) && paths.has(localPathOf(cur));
  if (wasCurrent) { stopEngines(); setStatus('stopped'); await new Promise(r => setTimeout(r, 250)); }
  const res = await P.dlmDelete(rows.map(r => ({ vid: r.vid, kind: r.kind, path: r.path })));
  let failed = 0;
  for (const r of res) {
    if (!r.ok) { failed++; continue; }
    for (const it of allItems()) { if (it.localVideo === r.path) delete it.localVideo; if (it.localAudio === r.path) delete it.localAudio; }
  }
  if (wasCurrent) { engine = cur.type === 'x' && !localPathOf(cur) ? null : 'youtube'; setMarquee(cur); }
  DLM.sel.clear();
  renderList(); saveSoon(); updateDlButton();
  await dlmRefresh();
  failed += plFailed;
  const done = res.length + plRows.length - failed;
  if (failed) toast(`Deleted ${done}. ${failed} couldn’t be deleted — they may be open in another program.`, 4500);
  else toast(`${done} item${done === 1 ? '' : 's'} moved to the Recycle Bin.`, 2500);
}
$('#pDlm').onclick = () => openDownloadsManager();
// ------------------------------------------------------------------ Library → SKINS (1.7)
// Your skins (Downloads\SlopAMP\skins, main.js "user skins") and the built-ins: apply, edit, rename,
// export, show in Explorer, delete (Recycle Bin), import. Built-ins can't be renamed or deleted.
const SKL = { sel: new Set(), anchor: -1, renaming: null };
const skinMode = () => DLM.filter === 'skins';
function sklRows() {
  const q = ($('#dlmSearch').value || '').trim().toLowerCase();
  const hit = (s) => !q || String(s.name).toLowerCase().includes(q) || String(s.baseName || '').toLowerCase().includes(q) || String(s.slug || s.id).includes(q);
  return { mine: WM.skins.user.filter(hit), built: WM.skins.list.filter(hit) };
}
async function sklRefresh() {
  await WM.skins.refresh();
  const ids = new Set([...WM.skins.user, ...WM.skins.list].map(s => s.id));
  for (const id of [...SKL.sel]) if (!ids.has(id)) SKL.sel.delete(id);
  if (SKL.renaming && !ids.has(SKL.renaming)) SKL.renaming = null;
  sklRender();
}
window.skinLibChanged = () => { if ($('#dlmDlg').open && skinMode()) sklRefresh(); };
function sklRender() {
  const dlg = $('#dlmDlg');
  dlg.classList.toggle('skinmode', skinMode());
  if (!skinMode()) return;
  dlg.classList.remove('slopmode');
  const { mine, built } = sklRows(), on = WM.skins.saved, all = WM.skins.user;
  const total = all.reduce((a, s) => a + (s.size || 0), 0);
  $('#dlmCount').textContent = `${all.length} SKIN${all.length === 1 ? '' : 'S'} OF YOURS · ${total ? fmtSize(total).toUpperCase() : '0 KB'}`;
  $('#dlmMiss').textContent = '';
  $('#dlmSearch').placeholder = 'Search skins…';
  $('#dlmSearchX').classList.toggle('hidden', !($('#dlmSearch').value || '').trim());
  const sw = (s) => `<span class="skl-sw">${(s.sw && s.sw.length === 6 ? s.sw : WM.skins.list[0].sw).map(c => `<i style="background:${slopEsc(c)}"></i>`).join('')}</span>`;
  const row = (s, user) => `<div class="skl-row${SKL.sel.has(s.id) ? ' on' : ''}" data-id="${slopEsc(s.id)}">`
    + (user ? `<span class="dlm-cb${SKL.sel.has(s.id) ? ' on' : ''}"></span>` : '<span class="dlm-cb" style="visibility:hidden"></span>')
    + sw(s)
    + (SKL.renaming === s.id ? `<span class="skl-n"><input type="text" id="sklRenIn" maxlength="60" value="${slopEsc(s.name)}" spellcheck="false"></span>`
      : `<span class="skl-n">${slopEsc(s.name)}${user ? (s.baseName ? `<small>from ${slopEsc(s.baseName)}</small>` : '') : `<small>built-in · ${slopEsc(s.group)}</small>`}</span>`)
    + (s.id === on ? '<span class="skl-act">ON</span>' : '')
    + `<span class="skl-f">${user ? `${slopEsc(s.slug)}.css` : ''}</span>`
    + `<span class="skl-sz">${user ? fmtSize(s.size) : ''}</span><span class="skl-dt">${user ? fmtDate(s.mtime) : ''}</span></div>`;
  $('#sklList').innerHTML = '<div class="skl-sec">Mine</div>'
    + (mine.length ? mine.map(s => row(s, true)).join('') : `<div class="skl-empty">${WM.skins.user.length ? 'None of your skins match.' : 'No skins of your own yet. <b>+ New skin</b> opens the Skin Editor on the skin you have on; <b>Import…</b> adds a .css someone shared.'}</div>`)
    + '<div class="skl-sec">Built-in</div>' + built.map(s => row(s, false)).join('');
  const sel = [...SKL.sel], one = sel.length === 1 ? sel[0] : null, u1 = one && /^user:/.test(one);
  $('#sklApply').disabled = !one || one === on;
  $('#sklEdit').disabled = !one; $('#sklEdit').innerHTML = one && !u1 ? '&#9998; New from this' : '&#9998; Edit';
  $('#sklRename').disabled = !u1; $('#sklReveal').disabled = !u1; $('#sklExport').disabled = !one || one === 'classic';
  $('#sklDel').disabled = !sel.length || sel.some(id => !/^user:/.test(id));
  const ri = $('#sklRenIn'); if (ri && ri.ownerDocument.activeElement !== ri) { ri.focus(); ri.select(); }
}
$('#sklList').addEventListener('click', (e) => {
  const r = e.target.closest('.skl-row'); if (!r || e.target.closest('input')) return;
  const id = r.dataset.id, user = /^user:/.test(id);
  const order = [...$('#sklList').querySelectorAll('.skl-row')].map(x => x.dataset.id), i = order.indexOf(id);
  if (user && e.shiftKey && SKL.anchor >= 0) {
    const [a, b] = [Math.min(SKL.anchor, i), Math.max(SKL.anchor, i)];
    if (!e.ctrlKey) SKL.sel.clear();
    for (const x of order.slice(a, b + 1)) if (/^user:/.test(x)) SKL.sel.add(x);
  } else if (user && (e.ctrlKey || e.target.closest('.dlm-cb'))) {
    if (SKL.sel.has(id)) SKL.sel.delete(id); else SKL.sel.add(id);
    for (const x of [...SKL.sel]) if (!/^user:/.test(x)) SKL.sel.delete(x);
    SKL.anchor = i;
  } else { SKL.sel.clear(); SKL.sel.add(id); SKL.anchor = i; }
  if (SKL.renaming && SKL.renaming !== id) SKL.renaming = null;
  sklRender();
});
$('#sklList').addEventListener('dblclick', (e) => { const r = e.target.closest('.skl-row'); if (r && !e.target.closest('input')) sklApply(r.dataset.id); });
async function sklApply(id) {
  if (WM.skins.editorOpen) { toast('Close the Skin Editor first, or pick the skin in its “Start from” list.'); return; }
  await WM.skins.apply(id); sklRender();
  toast(`Skin: ${WM.skins.nameOf(id)}`, 1600);
}
const sklOne = () => (SKL.sel.size === 1 ? [...SKL.sel][0] : null);
$('#sklApply').onclick = () => { const id = sklOne(); if (id) sklApply(id); };
$('#sklEdit').onclick = async () => {
  const id = sklOne(); if (!id) return;
  $('#dlmDlg').close();
  await WM.skins.openEditor(id);
};
$('#sklNew').onclick = async () => { $('#dlmDlg').close(); await WM.skins.openEditor(); };
$('#sklRename').onclick = () => { const id = sklOne(); if (id && /^user:/.test(id)) { SKL.renaming = id; sklRender(); } };
$('#sklList').addEventListener('keydown', async (e) => {
  if (e.target.id !== 'sklRenIn') return;
  e.stopPropagation();
  if (e.key === 'Escape') { e.preventDefault(); SKL.renaming = null; sklRender(); return; }
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const id = SKL.renaming, name = e.target.value.trim();
  if (!name) return;
  const res = await P.skinRename({ id, name });
  SKL.renaming = null;
  if (!res || res.error) { toast(`Couldn’t rename: ${res && res.error ? res.error : 'unknown error'}`); sklRender(); return; }
  const wasOn = WM.skins.current === id;
  SKL.sel.clear(); SKL.sel.add(res.id);
  await WM.skins.refresh();
  if (wasOn && res.id !== id) await WM.skins.apply(res.id);     // its file (and id) changed with the name
  sklRender();
  toast(`Renamed to "${res.name}"`, 1800);
});
$('#sklExport').onclick = async () => {
  const id = sklOne(); if (!id) return;
  const r = await P.skinExport(id);
  if (r && r.ok) toast(`Exported to ${r.file}`, 3500); else if (r && r.error) toast(`Couldn’t export: ${r.error}`);
};
$('#sklReveal').onclick = () => { const id = sklOne(); if (id) P.skinReveal(id); };
$('#sklOpenDir').onclick = () => P.skinFolder();
$('#sklImport').onclick = async () => {
  const res = await P.skinImport();
  if (!res || !res.length) return;
  const ok = res.filter(x => x.id), bad = res.filter(x => x.error);
  SKL.sel.clear(); for (const x of ok) SKL.sel.add(x.id);
  await sklRefresh();
  toast(ok.length ? `Imported ${ok.map(x => `"${x.name}"`).join(', ')}${bad.length ? `; ${bad.length > 1 ? `${bad.length} files weren’t skins` : '1 file wasn’t a skin'}` : ''}.` : bad[0].error, 4000);
};
$('#sklDel').onclick = async () => {
  const ids = [...SKL.sel].filter(id => /^user:/.test(id)); if (!ids.length) return;
  const names = ids.map(id => WM.skins.nameOf(id)), onDel = ids.includes(WM.skins.saved);
  if (WM.skins.editorOpen && ids.includes(WM.skins.saved)) { toast('That skin is open in the Skin Editor: close the editor first.'); return; }
  const ok = await confirmBox(ids.length > 1 ? `Delete ${ids.length} skins?` : `Delete "${names[0]}"?`,
    `${ids.length > 1 ? 'These skin files go' : 'The skin file goes'} to the Recycle Bin:\n\n${names.join('\n')}${onDel ? '\n\nIt’s the skin you have on: SlopAMP goes back to SlopAMP Classic.' : ''}`, 'Delete');
  if (!ok) return;
  if (onDel) await WM.skins.apply('classic');
  const res = await P.skinTrash(ids), failed = res.filter(r => !r.ok).length;
  SKL.sel.clear();
  await sklRefresh();
  toast(failed ? `${failed} skin${failed > 1 ? 's' : ''} couldn’t be deleted.` : `${ids.length} skin${ids.length > 1 ? 's' : ''} moved to the Recycle Bin.`, 2500);
};
// ------------------------------------------------------------------ Library → SLOP
// Every pack in Downloads\SlopAMP\Slop (main.js listPacks): search, filter by what's in a pack, preview,
// rename, open in SLOP / slop.cc, zip, show in Explorer, delete (Recycle Bin). The Library resizes.
const SLIB = { rows: [], sel: new Set(), cur: null, kinds: new Set(), flags: new Set(), anchor: -1, renaming: false };
const SL_KINDS = ['person', 'look', 'prop', 'place'];
const SL_FLAGS = [['song', 'has song', (r) => r.files.song], ['motion', 'motion', (r) => r.files.motion], ['lyrics', 'lyrics', (r) => r.files.lyrics], ['zip', 'zipped', (r) => !!r.zip], ['new', 'not opened yet', (r) => !r.opened]];
const slAudio = new Audio();
let slAudioKey = '', slRefreshT = null;
const slopMode = () => DLM.filter === 'slop';

async function slopLibRefresh() {
  SLIB.rows = await P.slopList();
  for (const id of [...SLIB.sel]) if (!SLIB.rows.some(r => r.id === id)) SLIB.sel.delete(id);
  if (SLIB.cur && !SLIB.rows.some(r => r.id === SLIB.cur)) SLIB.cur = null;
  slopLibRender();
}
function slopLibChanged() {        // a pack changed in SLOP: refresh the Library if it shows packs
  if (!$('#dlmDlg').open || !slopMode()) return;
  clearTimeout(slRefreshT); slRefreshT = setTimeout(slopLibRefresh, 1200);
}
function slopLibVisible() {
  const q = ($('#dlmSearch').value || '').trim().toLowerCase();
  const v = SLIB.rows.filter(r => {
    if (q) {
      const hay = [r.title, r.video.title, r.video.channel, r.video.id, r.prompt, r.suggestion, r.lyricsText, ...r.refs.map(x => `${x.name} ${x.kind}`)].join('\n').toLowerCase();
      if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
    }
    for (const k of SLIB.kinds) if (!r.refs.some(x => x.kind === k)) return false;
    for (const [k, , test] of SL_FLAGS) if (SLIB.flags.has(k) && !test(r)) return false;
    return true;
  });
  const s = $('#slSort').value;
  v.sort((a, b) => s === 'old' ? a.created - b.created : s === 'title' ? String(a.title).localeCompare(String(b.title)) : s === 'size' ? b.size - a.size : b.created - a.created);
  return v;
}
function slFlags(r) {
  const f = [`${r.refs.length} REF`];
  f.push(r.files.song ? 'SONG' : r.files.audio ? 'CLIP' : 'NO AUDIO');
  if (r.files.motion) f.push('MOTION'); if (r.files.lyrics) f.push('LYRICS'); if (r.zip) f.push('ZIP');
  if (r.legacy) f.push('1.5');
  return f;
}
function slopLibRender() {
  const dlg = $('#dlmDlg');
  dlg.classList.toggle('slopmode', slopMode());
  if (!slopMode()) return;
  const vis = slopLibVisible(), total = SLIB.rows.reduce((a, r) => a + r.size, 0);
  $('#dlmCount').textContent = `${SLIB.rows.length} SLOP PACK${SLIB.rows.length === 1 ? '' : 'S'} · ${total ? fmtSize(total).toUpperCase() : '0 MB'}`;
  $('#dlmMiss').textContent = '';
  $('#dlmSearch').placeholder = 'Search titles, reference names, prompts, lyrics…';
  $('#dlmSearchX').classList.toggle('hidden', !($('#dlmSearch').value || '').trim());
  for (const b of $('#slView').children) b.classList.toggle('on', b.dataset.v === S.lib.view);
  // tag chips with counts
  const count = (fn) => SLIB.rows.filter(fn).length;
  $('#slTags').innerHTML = '<span class="sl-lbl">SHOW</span>'
    + SL_KINDS.map(k => `<button type="button" class="sl-chip${SLIB.kinds.has(k) ? ' on' : ''}" data-kind="${k}">${k} <i>${count(r => r.refs.some(x => x.kind === k))}</i></button>`).join('')
    + SL_FLAGS.map(([k, label, test]) => `<button type="button" class="sl-chip${SLIB.flags.has(k) ? ' on' : ''}" data-flag="${k}">${label} <i>${count(test)}</i></button>`).join('')
    + (SLIB.kinds.size || SLIB.flags.size ? '<button type="button" class="slop-link" id="slClearTags">clear</button>' : '');
  // grid or list
  const grid = $('#slGrid'), list = S.lib.view === 'list';
  grid.classList.toggle('list', list);
  if (!vis.length) {
    const q = ($('#dlmSearch').value || '').trim();
    grid.innerHTML = `<div class="sl-empty">${SLIB.rows.length ? (q ? `No pack matches "${slopEsc(q)}".` : 'No pack has all of these.') : 'No SLOP packs yet. Play a YouTube video and click SLOP (or press G) to make one.'}</div>`;
  } else {
    grid.innerHTML = vis.map((r, i) => {
      const on = SLIB.sel.has(r.id), names = r.refs.map(x => x.name).filter(Boolean).join(' · ') || '—';
      const thumb = r.thumb ? `<img src="${slopEsc(r.thumb)}" alt="" loading="lazy">` : '<span class="sl-noimg">no frame</span>';
      if (list) return `<div class="sl-row${on ? ' on' : ''}${SLIB.cur === r.id ? ' cur' : ''}" data-i="${i}"><span class="sl-cb${on ? ' on' : ''}"></span>${thumb}<span class="sl-ti" title="${slopEsc(r.title)}">${slopEsc(r.title)}</span><span class="sl-names">${slopEsc(names)}</span><span class="sl-fl">${slFlags(r).map(f => `<b>${f}</b>`).join('')}</span><span class="sl-sz">${fmtSize(r.size)}</span><span class="sl-dt">${fmtDate(r.created)}</span></div>`;
      return `<div class="sl-card${on ? ' on' : ''}${SLIB.cur === r.id ? ' cur' : ''}" data-i="${i}"><div class="sl-th">${thumb}<span class="sl-cb${on ? ' on' : ''}"></span><span class="sl-t">@${slopTime(r.at || 0)}</span><span class="sl-fl">${slFlags(r).map(f => `<b>${f}</b>`).join('')}</span></div>`
        + `<div class="sl-b"><div class="sl-ti" title="${slopEsc(r.title)}">${slopEsc(r.title)}</div><div class="sl-meta"><span>${fmtDate(r.created)}</span><span class="sl-names">${slopEsc(names)}</span><span class="sl-sz">${fmtSize(r.size)}</span></div></div></div>`;
    }).join('');
  }
  slopLibPreview();
  const n = vis.filter(r => SLIB.sel.has(r.id)).length;
  $('#slDel').disabled = !n; $('#slDel').innerHTML = `&#x1F5D1; Delete selected${n ? ` (${n})` : ''}`;
  $('#slZip').disabled = !n; $('#slZip').innerHTML = `&#x1F5DC; Zip selected${n ? ` (${n})` : ''}`;
  $('#slDelAll').disabled = !vis.length;
  $('#slDelAll').textContent = ($('#dlmSearch').value || '').trim() || SLIB.kinds.size || SLIB.flags.size ? `Delete all ${vis.length} shown…` : 'Delete all packs…';
}
function slopLibPreview() {
  const pv = $('#slPv'), r = SLIB.rows.find(x => x.id === SLIB.cur) || SLIB.rows.find(x => SLIB.sel.has(x.id));
  if (!r) { pv.innerHTML = '<div class="sl-empty">Click a pack to see it here.</div>'; return; }
  const lead = r.refs.find(x => x.lead) || r.refs[0];
  const aud = (k, name) => r.urls && r.urls[k] ? `<button type="button" class="sl-aud${slAudioKey === r.id + k && !slAudio.paused ? ' on' : ''}" data-k="${k}">${slAudioKey === r.id + k && !slAudio.paused ? '&#9632;' : '&#9654;'} ${name}</button>` : '';
  pv.innerHTML = (lead ? `<img class="sl-big" src="${slopEsc(lead.url)}" alt="">` : '<div class="sl-big sl-noimg">no frame</div>')
    + (SLIB.renaming ? `<div class="sl-ren"><input type="text" id="slRenIn" maxlength="200" value="${slopEsc(r.title)}" spellcheck="false"><button type="button" class="slop-link" id="slRenOk">save</button></div>`
      : `<h3><span>${slopEsc(r.title)}</span> <button type="button" class="slop-link" id="slRename">&#x270E; rename</button></h3>`)
    + `<div class="sl-src">YouTube ${slopEsc(r.video.id || '')}${r.at ? ` @${slopTime(r.at)}` : ''} · made ${fmtDate(r.created)} · ${r.opened ? 'opened in slop.cc' : 'not opened in slop.cc yet'}${r.legacy ? ' · from SlopAMP 1.5' : ''}</div>`
    + (r.refs.length ? `<div class="sl-strip">${r.refs.map(x => `<button type="button" class="sl-ref" data-file="${slopEsc(x.file)}" title="Show ${slopEsc(x.file)} in Explorer"><img src="${slopEsc(x.url)}" alt=""><span>${x.lead ? '&#9733; ' : ''}${slopEsc(x.name || x.file.replace(/\.png$/, ''))}${x.kind ? ` <i>${x.kind}</i>` : ''}</span></button>`).join('')}</div>` : '')
    + `<div class="sl-auds">${aud('audio', 'audio.mp3')}${aud('audio2', 'audio-2.mp3')}${aud('song', 'song.mp3')}</div>`
    + (r.prompt ? `<div class="sl-prompt">${slopEsc(r.prompt)}</div>` : '<div class="sl-prompt dim">No prompt yet.</div>')
    + (r.lyricsText ? `<details class="sl-lyr"><summary>lyrics.txt</summary><pre>${slopEsc(r.lyricsText)}</pre></details>` : '')
    + `<div class="sl-acts"><button type="button" class="sb go" data-a="slop">Open in SLOP</button><button type="button" class="sb dim" data-a="web">Open in Slop.cc &#9656;</button><button type="button" class="sb dim" data-a="show">&#x1F4C1; Show in Explorer</button><button type="button" class="sb dim" data-a="zip">&#x1F5DC; Zip</button>${r.prompt ? '<button type="button" class="sb dim" data-a="copy">&#x2398; Copy prompt</button>' : ''}<button type="button" class="sb red" data-a="del">&#x1F5D1; Delete</button></div>`;
  const ri = $('#slRenIn'); if (ri) { ri.focus(); ri.select(); }
}
async function slopLibDelete(ids, all) {
  const rows = SLIB.rows.filter(r => ids.includes(r.id)); if (!rows.length) return;
  const size = rows.reduce((a, r) => a + r.size, 0);
  const ok = await confirmBox(all ? `Delete all ${rows.length} pack${rows.length > 1 ? 's' : ''}?` : `Delete ${rows.length} pack${rows.length > 1 ? 's' : ''}?`,
    `${rows.length} SLOP pack${rows.length > 1 ? 's' : ''} (${fmtSize(size)}) will go to the Recycle Bin, with ${rows.length > 1 ? 'their' : 'its'} zip if there is one.`, 'Delete');
  if (!ok) return;
  slAudio.pause();
  const res = await P.slopTrash(rows.map(r => r.id));
  const failed = res.filter(x => !x.ok).length;
  SLIB.sel.clear();
  await slopLibRefresh();
  toast(failed ? `${failed} pack${failed > 1 ? 's' : ''} couldn’t be deleted (a file may be open in another program).` : `${rows.length} pack${rows.length > 1 ? 's' : ''} moved to the Recycle Bin.`, 3000);
}
async function slopLibZip(ids) {
  if (!ids.length) return;
  toast(`Zipping ${ids.length} pack${ids.length > 1 ? 's' : ''}…`, 10000);
  const res = await P.slopZip(ids);
  const ok = res.filter(x => x.file);
  await slopLibRefresh();
  if (ok.length === 1) showDlBar({ text: `✓ Zipped: ${ok[0].file.split(/[\\/]/).pop()} (${fmtSize(ok[0].size)})`, pct: 100, buttons: [['Show in folder', () => P.showInFolder(ok[0].file)]], hideAfter: 8000 });
  else toast(`${ok.length} zip${ok.length === 1 ? '' : 's'} made next to the pack folders${res.length > ok.length ? `; ${res.length - ok.length} failed` : ''}.`, 3500);
}
async function slopLibOpen(id, web) {
  $('#dlmDlg').close();
  await slopOpenPack(id);
  if (web && SL.pack) $('#slopGo').click();
}
// size: drag the grip (the dialog stays centred, so the width changes twice as fast as the cursor)
function dlmApplySize() {
  const d = $('#dlmDlg'), scr = d.ownerDocument.defaultView.screen;
  const big = slopMode(), mid = skinMode();
  const w = S.lib.w || (big ? 1000 : mid ? 840 : 0), h = S.lib.h || (big ? 660 : 0);
  d.style.width = w ? `${Math.min(w, scr.availWidth - 20)}px` : '';
  d.style.height = h ? `${Math.min(h, scr.availHeight - 20)}px` : '';
  d.classList.toggle('sized', !!h);
}
$('#dlmGrip').addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  const d = $('#dlmDlg'), r = d.getBoundingClientRect(), x0 = e.screenX, y0 = e.screenY, g = e.currentTarget;
  try { g.setPointerCapture(e.pointerId); } catch (_) {}
  const move = (ev) => { S.lib.w = Math.max(640, Math.round(r.width + 2 * (ev.screenX - x0))); S.lib.h = Math.max(420, Math.round(r.height + ev.screenY - y0)); dlmApplySize(); };
  const up = () => { g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); saveSoon(); };
  g.addEventListener('pointermove', move); g.addEventListener('pointerup', up);
});
$('#slSort').onchange = () => slopLibRender();
$('#slView').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) { S.lib.view = b.dataset.v; saveSoon(); slopLibRender(); } });
$('#slTags').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'slClearTags') { SLIB.kinds.clear(); SLIB.flags.clear(); }
  else if (b.dataset.kind) { if (SLIB.kinds.has(b.dataset.kind)) SLIB.kinds.delete(b.dataset.kind); else SLIB.kinds.add(b.dataset.kind); }
  else if (b.dataset.flag) { if (SLIB.flags.has(b.dataset.flag)) SLIB.flags.delete(b.dataset.flag); else SLIB.flags.add(b.dataset.flag); }
  slopLibRender();
});
$('#slGrid').addEventListener('click', (e) => {
  const el = e.target.closest('.sl-card, .sl-row'); if (!el) return;
  const vis = slopLibVisible(), i = +el.dataset.i, r = vis[i]; if (!r) return;
  if (e.detail >= 2) return;
  if (e.shiftKey && SLIB.anchor >= 0) {
    const [a, b] = [Math.min(SLIB.anchor, i), Math.max(SLIB.anchor, i)];
    if (!e.ctrlKey) SLIB.sel.clear();
    for (let j = a; j <= b; j++) SLIB.sel.add(vis[j].id);
  } else if (e.ctrlKey || e.target.closest('.sl-cb')) { if (SLIB.sel.has(r.id)) SLIB.sel.delete(r.id); else SLIB.sel.add(r.id); SLIB.anchor = i; }
  else { SLIB.sel.clear(); SLIB.sel.add(r.id); SLIB.anchor = i; }
  SLIB.cur = r.id; SLIB.renaming = false;
  slopLibRender();
});
$('#slGrid').addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.detail !== 2 || e.shiftKey || e.ctrlKey || e.target.closest('.sl-cb')) return;
  const el = e.target.closest('.sl-card, .sl-row'); if (!el) return;
  const r = slopLibVisible()[+el.dataset.i]; if (!r) return;
  e.preventDefault(); slopLibOpen(r.id);
});
$('#slPv').addEventListener('click', async (e) => {
  const r = SLIB.rows.find(x => x.id === SLIB.cur) || SLIB.rows.find(x => SLIB.sel.has(x.id)); if (!r) return;
  const a = e.target.closest('[data-a]'), ref = e.target.closest('.sl-ref'), au = e.target.closest('.sl-aud');
  if (ref) { P.slopReveal(`${r.id}/${ref.dataset.file}`); return; }
  if (au) {
    const key = r.id + au.dataset.k;
    if (slAudioKey === key && !slAudio.paused) slAudio.pause();
    else { if (status === 'playing') pause(); slAudio.src = r.urls[au.dataset.k]; slAudioKey = key; slAudio.play().catch(() => {}); }
    slopLibPreview(); return;
  }
  if (e.target.closest('#slRename')) { SLIB.renaming = true; slopLibPreview(); return; }
  if (e.target.closest('#slRenOk')) { slopLibRename(r); return; }
  if (!a) return;
  if (a.dataset.a === 'slop') slopLibOpen(r.id);
  else if (a.dataset.a === 'web') slopLibOpen(r.id, true);
  else if (a.dataset.a === 'show') P.slopFolder(r.id);
  else if (a.dataset.a === 'zip') slopLibZip([r.id]);
  else if (a.dataset.a === 'copy') { P.slopCopy(r.prompt); toast('Prompt copied.'); }
  else if (a.dataset.a === 'del') slopLibDelete([r.id]);
});
async function slopLibRename(r) {
  const v = ($('#slRenIn').value || '').trim();
  SLIB.renaming = false;
  if (!v || v === r.title) { slopLibPreview(); return; }
  const res = await P.slopRename({ id: r.id, title: v });
  if (res && res.id) { SLIB.cur = res.id; if (SLIB.sel.delete(r.id)) SLIB.sel.add(res.id); }
  else toast((res && res.error) || 'Rename failed.');
  await slopLibRefresh();
}
$('#slPv').addEventListener('keydown', (e) => {
  if (e.target.id !== 'slRenIn') return;
  e.stopPropagation();
  if (e.key === 'Enter') { const r = SLIB.rows.find(x => x.id === SLIB.cur); if (r) slopLibRename(r); }
  else if (e.key === 'Escape') { e.preventDefault(); SLIB.renaming = false; slopLibPreview(); }
});
slAudio.addEventListener('ended', () => { if (slopMode() && $('#dlmDlg').open) slopLibPreview(); });
$('#dlmDlg').addEventListener('close', () => { slAudio.pause(); SLIB.renaming = false; });
$('#slDel').onclick = () => slopLibDelete(slopLibVisible().filter(r => SLIB.sel.has(r.id)).map(r => r.id));
$('#slDelAll').onclick = () => slopLibDelete(slopLibVisible().map(r => r.id), true);
$('#slZip').onclick = () => slopLibZip(slopLibVisible().filter(r => SLIB.sel.has(r.id)).map(r => r.id));
$('#slOpenDir').onclick = () => P.slopFolder();

async function updateDlInfo() {
  const rows = (await P.dlmList()).filter(r => !r.missing);
  const total = rows.reduce((a, r) => a + r.size, 0);
  $('#dlInfo').textContent = rows.length ? `${rows.length} saved \u00b7 ${fmtSize(total)}` : '';
}

// Re-check downloaded copies when you come back to SlopAMP (files deleted in File Explorer).
let focusCheckAt = 0;
WM.onWins('focus', () => {
  const now = Date.now(); if (now - focusCheckAt < 1500) return; focusCheckAt = now;
  verifyLocalCopies().then(() => attachKnownCopies());
  if ($('#dlmDlg').open) dlmRefresh(); else updateDlInfo();
});

// ------------------------------------------------------------------ persistence
let saveT;
function stateSnapshot() {
  return {
    version: 2,
    tabs: S.tabs.map(t => ({ id: t.id, name: t.name, current: t.current, items: t.items.map(({ id, type, path, url, vid, music, live, title, duration, hasVideo, noEmbed, start, localVideo, localAudio, at }) => ({ id, type, path, url, vid, music, live, title, duration, hasVideo, noEmbed, start, localVideo, localAudio, at })) })),
    tab: S.tab, playTab: S.playTab, vis: S.vis, volume: S.volume, muted: S.muted, shuffle: S.shuffle, repeat: S.repeat,
    showVideo: S.showVideo, showPlaylist: S.showPlaylist, plShade: S.plShade, vidShade: S.vidShade, remaining: S.remaining, plHeight: S.plHeight, visMode, eq: S.eq,
    resume: S.resume, subsOn: S.subsOn, lib: S.lib, hist: S.hist, xhist: S.xhist
  };
}
function saveSoon() {
  clearTimeout(saveT);
  saveT = setTimeout(() => P.saveState(stateSnapshot()), 300);
}
// Write immediately (closing the window).
function saveNow() { clearTimeout(saveT); P.saveState({ ...stateSnapshot(), flush: true }); }

// ------------------------------------------------------------------ main loop
// Two loops, each on its own window's frames: the player (clock, position, spectrum) and the video
// window (seek bar, subtitles, BARS visualizer), so one keeps running when the other is covered.
let lastUi = 0, lastVid = 0;
function seekPct() {
  const d = currentDuration(), t = currentTime();
  return status === 'stopped' || !d ? 0 : Math.min(1000, Math.round(t / d * 1000));
}
function tick(ts) {
  if (ts - lastUi > 120) {
    lastUi = ts;
    if (!seeking) $('#pos').value = seekPct();
    drawClock();
  }
  drawVis();
  requestAnimationFrame(tick);
}
function tickVideo(ts) {
  if (ts - lastVid > 120) {
    lastVid = ts;
    if (!seeking) {
      const p = seekPct();
      $('#seek').value = p; $('#seek').style.setProperty('--p', `${p / 10}%`);
      $('#vTime').textContent = fmt(status === 'stopped' ? 0 : currentTime());
    }
    $('#vDur').textContent = fmt(currentDuration());
  }
  renderSubs();
  drawBigVis();
  VW().requestAnimationFrame(tickVideo);
}
setInterval(() => { blink = !blink; }, 500);

// ------------------------------------------------------------------ boot
(async function boot() {
  const st = await P.loadState();
  const okItem = (i) => i && (i.type === 'file' || i.type === 'youtube' || (i.type === 'x' && !!parseXUrl(i.url))) && (i.path || i.url);
  let savedCur = -1;
  if (st && Array.isArray(st.tabs) && st.tabs.length) {
    S.tabs = st.tabs.map((t, k) => ({ id: t.id || 't' + nid(), name: String(t.name || `Playlist ${k + 1}`).slice(0, 40), current: -1, items: (t.items || []).filter(okItem).map(i => ({ ...i, id: i.id || nid() })), saved: Number.isInteger(t.current) ? t.current : -1 }));
    S.tab = Math.min(Math.max(0, st.tab | 0), S.tabs.length - 1);
    S.playTab = Math.min(Math.max(0, st.playTab | 0), S.tabs.length - 1);
    savedCur = PT().saved;
    S.tabs.forEach(t => delete t.saved);
  } else if (st && Array.isArray(st.items)) {   // older versions: one playlist
    S.tabs[0].items = st.items.filter(okItem).map(i => ({ ...i, id: i.id || nid() }));
    savedCur = st.current;
  }
  if (st && (Array.isArray(st.tabs) || Array.isArray(st.items))) {
    if (st.vis && typeof st.vis === 'object') S.vis = { ...S.vis, ...st.vis };
    S.volume = Number.isFinite(st.volume) ? st.volume : 80;
    S.muted = !!st.muted; S.shuffle = !!st.shuffle; S.repeat = ['off', 'all', 'one'].includes(st.repeat) ? st.repeat : 'off';
    S.showVideo = st.showVideo !== false; S.showPlaylist = st.showPlaylist !== false; S.remaining = !!st.remaining;
    S.plShade = !!st.plShade; S.vidShade = !!st.vidShade;
    S.plHeight = st.plHeight || 230; visMode = st.visMode || 0;
    if (st.eq && Array.isArray(st.eq.gains) && st.eq.gains.length === 10) S.eq = { ...S.eq, ...st.eq };
    if (S.eq.panel === 'hidden') S.eq.panel = 'open';   // the equalizer always shows at launch (minimized stays minimized)
    if (st.resume && typeof st.resume === 'object') S.resume = st.resume;
    S.subsOn = !!st.subsOn;
    if (st.lib && typeof st.lib === 'object') S.lib = { w: Number(st.lib.w) || 0, h: Number(st.lib.h) || 0, view: st.lib.view === 'list' ? 'list' : 'grid' };
    for (const k of HIST_KINDS) {
      const h = st[HK[k].state]; if (!h || typeof h !== 'object') continue;
      S[HK[k].state] = { on: h.on !== false, mirror: h.mirror !== false, order: h.order === 'oldest' ? 'oldest' : 'newest', replay: ['bump', 'keep', 'dup'].includes(h.replay) ? h.replay : 'bump',
        cap: Number.isInteger(h.cap) && h.cap >= 0 && h.cap <= 100000 ? h.cap : 100 };
    }
    const pit = PT().items[savedCur];
    if (pit && S.tab === S.playTab) { S.sel = new Set([pit.id]); S.anchor = savedCur; }
    resumeAtBoot = pit || null;
  }
  // History tabs: first in the tab strip, YT History then X History (each made on its first run while
  // recording is on), only their own kind of item in them; there's always an ordinary tab too
  {
    const playing = S.tabs[S.playTab], shown = S.tabs[S.tab];
    for (const k of HIST_KINDS) { const h = histTab(k); if (h) { h.name = HK[k].label; h.items = h.items.filter(i => i.type === HK[k].type); } }
    S.tabs = [...HIST_KINDS.map(k => histTab(k)).filter(Boolean), ...S.tabs.filter(t => !isHist(t))];
    S.playTab = Math.max(0, S.tabs.indexOf(playing)); S.tab = Math.max(0, S.tabs.indexOf(shown));
    for (const k of HIST_KINDS) if (!histTab(k) && hs(k).on) histEnsureTab(k);
    if (!S.tabs.some(t => !isHist(t))) S.tabs.push({ id: 't' + nid(), name: 'Main', items: [], current: -1 });
  }
  renderToggles(); renderVolume(); renderList(); setStatus('stopped'); updateControlsEnabled();
  buildEq(); renderEq();
  verifyLocalCopies().then(() => attachKnownCopies());
  showLayer('empty');
  if (resumeAtBoot) setMarquee(resumeAtBoot); else if (S.anchor >= 0) setMarquee(S.items[S.anchor]); else setMarquee(null);
  if (resumeAtBoot && resumePoint(resumeAtBoot)) toast(`Press Play to continue "${resumeAtBoot.title}" from ${fmt(resumePoint(resumeAtBoot))}`, 5000);
  renderSpeed(); renderCc(); updateDlInfo(); renderVisPanel();
  syncWindows({ reflow: false });      // first layout: the windows appear where they were last time
  requestAnimationFrame(tick); VW().requestAnimationFrame(tickVideo);
  const info = await P.info();
  if (info.pendingOpen && info.pendingOpen.length) { const added = await addPaths(info.pendingOpen); if (added.length) playIndex(S.items.indexOf(added[0])); }
  window.__phosphor = { __md: () => MD.viz, __mdLoad: (n) => mdLoad(n, 0), newTab, switchTab, closeTab, sendSelectedToTab, renameTab, curItem, __audio: () => ({ actx, analyser, eqNodes }), openDownloadsManager, dlmRefresh, DLM, verifyLocalCopies, setRate, pickSub, subsState: () => SUBS, downloadAll, recordResume, __mediaKey: mediaKey, get dlBatch() { return dlBatch; }, __eqNodes: eqNodes, loadEqPreset, setEqPanel, __markLive: (i, v) => markLive(S.items[i], v), __ytError: (code) => { engine = 'youtube'; onYtError({ data: code }); }, S, playIndex, addUrls, addPaths, next, prev, stop, play, pause, seekTo, setVolume, toggleMini, toggleFullscreen, syncWindows, WM, get engine() { return engine; }, get status() { return status; }, currentTime, currentDuration, L };
})();
