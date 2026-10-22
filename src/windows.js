'use strict';
// SlopAMP's movable windows, main-process side.
//
// The renderer (src/renderer/winmgr.js) opens one real window per panel with window.open(): the player
// ("main"), the equalizer, the video/visualizer and the playlist, plus two hidden helper windows that
// host popup menus and dialogs. All of them share one renderer process, so the player code drives every
// window directly. This file owns the geometry: where each window is, snapping, docked groups, layout
// presets, "Reset layout" and saving the layout between launches.
//
// Saved layout (state.layout):
//   { version: 1, skin: 'default', preset: 'classic', snap: true, onTop: false,
//     windows: { main: {x,y,w,h}, eq: {...}, video: {...}, playlist: {...} },
//     heights: { main: 171, ... } }      // on-screen heights (a rolled-up window is just its title bar)
// `skin` is reserved for v1.4 (skins); nothing reads it yet.

const { BrowserWindow, screen } = require('electron');

const PANELS = ['main', 'eq', 'video', 'playlist'];
const HOSTS = ['popup', 'dialog'];
const FIT = new Set(['main', 'eq']);            // height follows the content
const MIN = { main: [420, 60], eq: [420, 40], video: [320, 180], playlist: [300, 150] };
const DEF = { w: 420, main: 190, eq: 160, video: 240, playlist: 300 };
const SNAP = 10;          // px: how close an edge must be to snap
const TOUCH = 1;          // px: edges this close count as docked
const PRESETS = ['classic', 'side', 'bigvis'];

const r4 = (b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

class WindowManager {
  constructor({ getLayout, saveLayout, log, legacyWindow, legacyPlHeight }) {
    this.log = log || (() => {});
    this.saveLayout = saveLayout;
    this.wins = new Map();          // id -> BrowserWindow (panels and hosts)
    this.visible = { main: true, eq: false, video: false, playlist: false };
    this.shade = {};
    this.fitH = {};
    this.applied = {};              // id -> last bounds we set (to tell our moves from the user's)
    this.drag = null;
    this.mini = false;
    this.savedH = {};
    this.minH = {};                 // id -> smallest height the system allowed (see apply)
    this.layout = this.normalize(getLayout(), legacyWindow, legacyPlHeight);
    this.started = false;
  }

  // ---------- layout model ----------
  normalize(l, legacy, legacyPl) {
    const ok = (b) => b && [b.x, b.y, b.w, b.h].every(Number.isFinite);
    const out = { version: 1, skin: 'default', preset: 'classic', snap: true, onTop: false, windows: {}, heights: {} };
    if (l && typeof l === 'object') {
      if (typeof l.skin === 'string' && l.skin) out.skin = l.skin.slice(0, 100);
      if (PRESETS.includes(l.preset) || l.preset === 'custom') out.preset = l.preset;
      out.snap = l.snap !== false; out.onTop = !!l.onTop;
      for (const id of PANELS) if (l.windows && ok(l.windows[id])) out.windows[id] = r4(l.windows[id]);
      // heights the windows really had (rolled-up windows are shorter than windows[id].h)
      if (l.heights && typeof l.heights === 'object') for (const id of PANELS) if (Number.isFinite(l.heights[id])) out.heights[id] = Math.round(l.heights[id]);
    }
    if (PANELS.every(id => out.windows[id])) {
      for (const id of PANELS) { const b = out.windows[id]; b.w = Math.max(MIN[id][0], b.w); b.h = Math.max(MIN[id][1], b.h); }
      return out;
    }
    // First launch of 1.3 (or a broken layout): the classic stack, where the old single window was.
    const wa = screen.getPrimaryDisplay().workArea;
    const w = legacy && Number.isFinite(legacy.width) ? Math.max(420, Math.min(legacy.width, wa.width)) : DEF.w;
    let x = legacy && Number.isFinite(legacy.x) ? legacy.x : Math.round(wa.x + (wa.width - w) / 2);
    let y = legacy && Number.isFinite(legacy.y) ? legacy.y : wa.y + 40;
    const plH = Math.max(150, Math.min(600, legacyPl || DEF.playlist));
    const vidH = legacy && Number.isFinite(legacy.height) ? Math.max(180, legacy.height - DEF.main - DEF.eq - plH) : DEF.video;
    let cy = y;
    for (const id of PANELS) {
      const h = id === 'video' ? vidH : id === 'playlist' ? plH : DEF[id];
      out.windows[id] = { x, y: cy, w, h }; cy += h;
    }
    return out;
  }
  b(id) { return this.layout.windows[id]; }
  // Height the window really has: content height for fit windows and shaded windows.
  hOf(id) {
    if (!((FIT.has(id) || this.shade[id]) && this.fitH[id])) return this.b(id).h;
    return Math.max(this.fitH[id], this.minH[id] || 0);
  }
  rect(id) { const b = this.b(id); return { x: b.x, y: b.y, w: b.w, h: this.hOf(id) }; }
  shown(id) { return !!this.visible[id] && this.wins.has(id); }
  others(ids) { return PANELS.filter(id => !ids.includes(id) && this.shown(id)); }
  persist() {
    clearTimeout(this.saveT);
    this.saveT = setTimeout(() => this.flush(), 300);
  }
  flush() {
    clearTimeout(this.saveT);
    if (this.started) this.layout.heights = Object.fromEntries(PANELS.map(id => [id, this.hOf(id)]));
    try { this.saveLayout(JSON.parse(JSON.stringify(this.layout))); } catch (e) { this.log('layout save failed', e); }
  }

  // ---------- window creation ----------
  mainOptions(base) {
    const b = this.rect('main');
    // Not natively resizable: Windows won't make a resizable window shorter than about 39 px (too tall for
    // a rolled-up title bar), and SlopAMP resizes its windows itself (grip and edges) anyway.
    return { ...base, x: b.x, y: b.y, width: b.w, height: b.h, resizable: false, maximizable: false, fullscreenable: false, thickFrame: false };
  }
  // Options for a window the renderer opens with window.open(url, id).
  childOptions(id, base) {
    const main = this.wins.get('main');
    // thickFrame off (Windows): square corners and no drop shadows, so docked windows meet cleanly.
    // Resizing is done by SlopAMP itself (grip and edges), with snapping.
    const common = { ...base, show: false, frame: false, thickFrame: false, skipTaskbar: true, parent: main || undefined, minimizable: false, maximizable: false };
    if (PANELS.includes(id)) {
      const b = this.rect(id);
      return { ...common, x: b.x, y: b.y, width: b.w, height: b.h, resizable: false, fullscreenable: id === 'video' };
    }
    // popup menus / dialogs: positioned and sized when they're used
    return { ...common, width: 300, height: 200, resizable: false, fullscreenable: false, alwaysOnTop: id === 'popup', focusable: true };
  }
  attach(id, win) {
    this.wins.set(id, win);
    if (id === 'main') { this.watch(id, win); if (this.layout.onTop) win.setAlwaysOnTop(true); return; }
    if (!PANELS.includes(id) && !HOSTS.includes(id)) return;
    win.setMenu(null);
    // Alt+F4 on a panel hides it like its ✕ button; the windows only really close when SlopAMP quits.
    win.on('close', (e) => {
      if (this.quitting) return;
      e.preventDefault();
      this.toRenderer('wm:closed', id);      // panels: like their ✕ · popup: close the menu · dialog: cancel it
      if (id === 'popup') this.hidePopup();
    });
    if (id === 'popup') win.on('blur', () => setTimeout(() => {
      const f = BrowserWindow.getFocusedWindow();
      if (!f || ![...this.wins.values()].includes(f)) this.toRenderer('wm:popup-blur');
    }, 0));
    if (PANELS.includes(id)) {
      this.watch(id, win);
      if (this.layout.onTop) win.setAlwaysOnTop(true);
      if (id === 'video') {
        win.on('enter-full-screen', () => this.toRenderer('fullscreen', true));
        win.on('leave-full-screen', () => { this.toRenderer('fullscreen', false); setTimeout(() => this.apply('video'), 50); });
      }
    }
  }
  toRenderer(ch, ...a) { const m = this.wins.get('main'); if (m && !m.isDestroyed()) m.webContents.send(ch, ...a); }
  // Follow moves/resizes the user makes outside our own drag code (window edges, Win+arrow keys).
  watch(id, win) {
    let userResize = false, busy = false;
    win.on('will-resize', () => { userResize = true; });       // only for real user resizes (Windows/macOS)
    const onChange = () => {
      if (busy || this.drag || win.isDestroyed() || win.isFullScreen() || win.isMinimized() || !win.isVisible()) return;
      const nb = win.getBounds(), a = this.applied[id];
      if (a && Math.abs(nb.x - a.x) <= 1 && Math.abs(nb.y - a.y) <= 1 && Math.abs(nb.width - a.w) <= 1 && Math.abs(nb.height - a.h) <= 1) return;
      busy = true;
      try {
        const b = this.b(id), old = this.rect(id);
        const fixedH = FIT.has(id) || this.shade[id];
        const grew = userResize && !fixedH && nb.y === old.y && nb.height !== old.h;
        const chain = grew ? this.below(id) : [];
        b.x = nb.x; b.y = nb.y; b.w = nb.width;
        if (!fixedH) b.h = nb.height;
        this.applied[id] = { x: nb.x, y: nb.y, w: nb.width, h: fixedH ? old.h : nb.height };
        if (chain.length) this.shift(chain, 0, nb.height - old.h);
        this.layout.preset = 'custom';
        this.persist();
      } finally { busy = false; }
    };
    win.on('resize', onChange);
    win.on('move', onChange);
    win.on('resized', () => { userResize = false; });
  }

  // ---------- applying the model to real windows ----------
  apply(id) {
    const win = this.wins.get(id);
    if (!win || win.isDestroyed() || win.isFullScreen()) return;
    if (win.isResizable()) win.setResizable(false);     // (left on by fullscreen)
    const r = this.rect(id);
    this.applied[id] = { ...r };
    win.setBounds({ x: r.x, y: r.y, width: r.w, height: r.h });
    // Safety net: if the system still made the window taller than asked (a minimum window height), use its
    // real height so the windows docked underneath sit below it instead of hiding under it.
    if (!win.isVisible()) return;
    const got = win.getBounds().height;
    if (got > r.h + 1 && (FIT.has(id) || this.shade[id])) {
      this.log(`window ${id}: asked for height ${r.h}, got ${got}`);
      const chain = this.belowRect(r, id);
      this.minH[id] = got;
      this.applied[id].h = got;
      this.shift(chain, 0, got - r.h);
    }
  }
  applyAll() { for (const id of PANELS) this.apply(id); }

  // Visible windows docked under `id` (top edge touching its bottom edge), and everything docked under those.
  below(id, seen = new Set([id])) {
    const a = this.rect(id), out = [];
    for (const o of PANELS) {
      if (seen.has(o) || !this.shown(o)) continue;
      const r = this.rect(o);
      if (Math.abs(r.y - (a.y + a.h)) <= TOUCH && overlap(a.x, a.x + a.w, r.x, r.x + r.w) > 0) { seen.add(o); out.push(o, ...this.below(o, seen)); }
    }
    return out;
  }
  // Same, for a window that had the rectangle `a` (before a height change).
  belowRect(a, id) {
    const seen = new Set([id]), out = [];
    for (const o of PANELS) {
      if (seen.has(o) || !this.shown(o)) continue;
      const r = this.rect(o);
      if (Math.abs(r.y - (a.y + a.h)) <= TOUCH && overlap(a.x, a.x + a.w, r.x, r.x + r.w) > 0) { seen.add(o); out.push(o, ...this.below(o, seen)); }
    }
    return out;
  }
  // Visible windows docked to `id` on any side, recursively: the group that moves with the player.
  group(id) {
    const seen = new Set([id]), queue = [id];
    while (queue.length) {
      const a = this.rect(queue.shift());
      for (const o of PANELS) {
        if (seen.has(o) || !this.shown(o)) continue;
        const r = this.rect(o);
        const vTouch = (Math.abs(r.y - (a.y + a.h)) <= TOUCH || Math.abs(a.y - (r.y + r.h)) <= TOUCH) && overlap(a.x, a.x + a.w, r.x, r.x + r.w) > 0;
        const hTouch = (Math.abs(r.x - (a.x + a.w)) <= TOUCH || Math.abs(a.x - (r.x + r.w)) <= TOUCH) && overlap(a.y, a.y + a.h, r.y, r.y + r.h) > 0;
        if (vTouch || hTouch) { seen.add(o); queue.push(o); }
      }
    }
    return [...seen];
  }
  shift(ids, dx, dy) {
    for (const id of ids) { const b = this.b(id); b.x += dx; b.y += dy; this.apply(id); }
  }

  // ---------- renderer requests ----------
  // Visibility / shade / content heights of every panel. `reflow`: windows docked below a window that
  // grows, shrinks, appears or disappears move with it (off for mini mode and while restoring).
  sync(list, reflow) {
    for (const p of list || []) {
      const id = p && p.id;
      if (!PANELS.includes(id)) continue;
      const win = this.wins.get(id);
      const wasShown = this.shown(id), old = this.rect(id);
      const oldChain = wasShown && this.started ? this.below(id) : [];    // docked under the old bottom edge
      if (Number.isFinite(p.h) && p.h > 0) this.fitH[id] = Math.round(p.h);
      this.shade[id] = !!p.shade && !FIT.has(id);
      // the player/EQ heights saved last time may differ from now (update bar, fonts): fixed in start()
      if (!this.started && !(id in this.savedH)) this.savedH[id] = Number.isFinite(this.layout.heights[id]) ? this.layout.heights[id] : old.h;
      if (FIT.has(id) && this.fitH[id]) this.b(id).h = this.fitH[id];
      const vis = id === 'main' ? true : !!p.visible;
      if (!win) { this.visible[id] = vis; continue; }
      if (vis && !wasShown) {
        if (reflow && this.started) {
          // windows that moved up into this window's slot move back down
          const top = this.b(id).y, a = this.rect(id), seen = new Set([id]), chain = [];
          for (const o of PANELS) {
            if (seen.has(o) || !this.shown(o)) continue;
            const r = this.rect(o);
            if (Math.abs(r.y - top) <= TOUCH && overlap(a.x, a.x + a.w, r.x, r.x + r.w) > 0) { seen.add(o); chain.push(o, ...this.below(o, seen)); }
          }
          this.shift(chain, 0, a.h);
        }
        this.visible[id] = true;
        this.apply(id);
        if (this.started) { win.showInactive(); this.apply(id); }   // again once visible (height check)
      } else if (!vis && wasShown) {
        this.visible[id] = false;
        if (win.isFullScreen()) win.setFullScreen(false);
        win.hide();
        if (reflow) this.shift(oldChain, 0, -old.h);
      } else if (vis) {
        const nh = this.hOf(id);
        if (nh !== old.h && this.started) this.shift(oldChain, 0, nh - old.h);
        if (nh !== old.h || !this.started) this.apply(id);
      } else this.visible[id] = false;
    }
    if (!this.started) this.start();
    this.persist();
  }
  // First sync from the renderer: check the layout is on screen, then show everything at once.
  start() {
    this.started = true;
    // Windows that were docked under another one last time stay docked to its (possibly new) bottom edge:
    // the player and equalizer heights can differ from last time (update bar, fonts, first launch).
    const saved = {};
    for (const id of PANELS) saved[id] = { ...this.rect(id), h: Number.isFinite(this.savedH[id]) ? this.savedH[id] : this.hOf(id) };
    const order = PANELS.filter(id => this.shown(id)).sort((p, q) => saved[p].y - saved[q].y);
    for (const c of order) {
      const rc = saved[c];
      const parent = order.find(a => a !== c && Math.abs(rc.y - (saved[a].y + saved[a].h)) <= TOUCH && overlap(rc.x, rc.x + rc.w, saved[a].x, saved[a].x + saved[a].w) > 0);
      if (parent) this.b(c).y = this.b(parent).y + this.hOf(parent);
    }
    // A window that opens where another one sits (the equalizer always opens at launch, even if it was
    // closed last time and the windows below it had moved up): push the later one down.
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (let i = 0; i < PANELS.length; i++) for (let j = i + 1; j < PANELS.length; j++) {
        const a = PANELS[i], c = PANELS[j];
        if (!this.shown(a) || !this.shown(c)) continue;
        const ra = this.rect(a), rc = this.rect(c);
        if (Math.abs(ra.y - rc.y) <= TOUCH && overlap(ra.x, ra.x + ra.w, rc.x, rc.x + rc.w) > 0) {
          const chain = [c, ...this.below(c)].filter(o => o !== a);
          for (const o of chain) this.b(o).y += ra.h;
          moved = true;
        }
      }
      if (!moved) break;
    }
    if (!this.allOnScreen()) { this.log('layout was off screen; resetting it'); this.preset('reset'); }
    this.applyAll();
    for (const id of PANELS) {
      const w = this.wins.get(id);
      if (w && this.visible[id] && !w.isVisible()) { if (id === 'main') w.show(); else w.showInactive(); }
    }
    this.applyAll();      // once more now they're visible: checks the system gave each window its height
    if (!this.screenHooked) {
      this.screenHooked = true;
      // a monitor unplugged or its resolution changed: bring back any window that ended up off screen
      screen.on('display-removed', () => this.rescue());
      screen.on('display-metrics-changed', () => this.rescue());
    }
  }
  rescue() { setTimeout(() => { if (!this.allOnScreen()) { this.log('a window ended up off screen; resetting the layout'); this.preset('reset'); } }, 500); }
  // A window counts as on screen when a decent piece of its title bar is on some display.
  onScreen(r) {
    return screen.getAllDisplays().some(d => {
      const a = d.workArea;
      return overlap(r.x, r.x + r.w, a.x, a.x + a.width) >= 60 && overlap(r.y, r.y + 14, a.y, a.y + a.height) >= 10;
    });
  }
  allOnScreen() { return PANELS.every(id => !this.visible[id] && id !== 'main' ? true : this.onScreen(this.rect(id))); }

  // ---------- dragging (title bars) and resizing (corner grip, right/bottom edges) ----------
  // mode: 'move' | 'resize' (corner) | 'resize-x' (right edge) | 'resize-y' (bottom edge)
  dragStart(id, mode) {
    if (!PANELS.includes(id) || !this.shown(id)) return;
    const win = this.wins.get(id);
    if (win.isFullScreen()) return;
    const cur = screen.getCursorScreenPoint();
    const resize = mode !== 'move';
    const ids = resize ? [id] : id === 'main' ? this.group('main') : [id];
    const start = {};
    for (const o of ids) start[o] = { ...this.rect(o) };
    this.drag = { id, mode, resize, ids, cur, start, chain: resize ? this.below(id) : [], lastH: this.hOf(id) };
    // Follow the cursor ourselves: while a window moves with the mouse the page may see no mouse moves.
    clearInterval(this.dragTimer);
    this.dragTimer = setInterval(() => { try { this.dragMove(); } catch (e) { this.log('drag failed', e); this.dragEnd(); } }, 15);
    this.dragKill = setTimeout(() => this.dragEnd(), 120000);
  }
  dragMove() {
    const d = this.drag; if (!d) return;
    const c = screen.getCursorScreenPoint();
    let dx = c.x - d.cur.x, dy = c.y - d.cur.y;
    const marks = [];
    if (d.resize) {
      const s = d.start[d.id], b = this.b(d.id);
      const fixedH = FIT.has(d.id) || this.shade[d.id] || d.mode === 'resize-x';
      const fixedW = d.mode === 'resize-y';
      let w = fixedW ? s.w : Math.max(MIN[d.id][0], s.w + dx), h = fixedH ? s.h : Math.max(MIN[d.id][1], s.h + dy);
      if (this.layout.snap) {
        if (!fixedW) { const right = this.snapEdge(s.x + w, 'x', s, d.ids, marks, 'right'); if (right != null) w = Math.max(MIN[d.id][0], right - s.x); }
        if (!fixedH) { const bot = this.snapEdge(s.y + h, 'y', { ...s, w }, d.ids.concat(d.chain), marks, 'bottom'); if (bot != null) h = Math.max(MIN[d.id][1], bot - s.y); }
      }
      b.w = Math.round(w); if (!fixedH && !FIT.has(d.id) && !this.shade[d.id]) b.h = Math.round(h);
      const nh = this.hOf(d.id);
      if (nh !== d.lastH) { this.shift(d.chain, 0, nh - d.lastH); d.lastH = nh; }
      this.apply(d.id);
    } else {
      if (this.layout.snap) {
        const moved = d.ids.map(o => ({ id: o, ...d.start[o], x: d.start[o].x + dx, y: d.start[o].y + dy }));
        const sx = this.snapDelta(moved, 'x', d.ids, marks); dx += sx;
        for (const m of moved) m.x += sx;
        const sy = this.snapDelta(moved, 'y', d.ids, marks); dy += sy;
      }
      for (const o of d.ids) { const b = this.b(o); b.x = d.start[o].x + dx; b.y = d.start[o].y + dy; this.apply(o); }
    }
    this.mark(marks);
  }
  dragEnd() {
    clearInterval(this.dragTimer); clearTimeout(this.dragKill);
    if (!this.drag) return;
    const moved = this.drag.ids.some(o => { const s = this.drag.start[o], r = this.rect(o); return s.x !== r.x || s.y !== r.y || s.w !== r.w || s.h !== r.h; });
    this.drag = null;
    this.mark([]);
    if (moved) { this.layout.preset = 'custom'; this.persist(); this.toRenderer('wm:layout', this.info()); }
  }
  // Snap targets: the other visible windows' edges and the screens' work-area edges.
  targets(exclude) {
    const t = this.others(exclude).map(o => ({ id: o, ...this.rect(o) }));
    return t;
  }
  // How far to nudge a moving group along one axis so an edge lands exactly on a nearby edge.
  snapDelta(moved, axis, exclude, marks) {
    const X = axis === 'x';
    let best = null;
    const consider = (delta, mark) => { if (Math.abs(delta) <= SNAP && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, mark }; };
    const lo = (r) => (X ? r.x : r.y), hi = (r) => (X ? r.x + r.w : r.y + r.h);
    const plo = (r) => (X ? r.y : r.x), phi = (r) => (X ? r.y + r.h : r.x + r.w);
    const [eLo, eHi] = X ? ['left', 'right'] : ['top', 'bottom'];
    for (const m of moved) {
      for (const o of this.targets(exclude)) {
        const near = overlap(plo(m), phi(m), plo(o), phi(o)) > -SNAP;
        if (!near) continue;
        // edge to edge (side by side / stacked): never overlapping
        consider(hi(o) - lo(m), [[o.id, eHi], [m.id, eLo]]);
        consider(lo(o) - hi(m), [[o.id, eLo], [m.id, eHi]]);
        // line up with a neighbour that sits directly above/below (or beside) us
        const touching = Math.abs(plo(m) - phi(o)) <= SNAP || Math.abs(phi(m) - plo(o)) <= SNAP;
        if (touching) { consider(lo(o) - lo(m), [[o.id, eLo], [m.id, eLo]]); consider(hi(o) - hi(m), [[o.id, eHi], [m.id, eHi]]); }
      }
      for (const disp of screen.getAllDisplays()) {
        const a = disp.workArea, A = { x: a.x, y: a.y, w: a.width, h: a.height };
        if (overlap(plo(m), phi(m), plo(A), phi(A)) <= 0) continue;
        consider(lo(A) - lo(m), [[m.id, eLo]]);
        consider(hi(A) - hi(m), [[m.id, eHi]]);
      }
    }
    if (!best) return 0;
    marks.push(...best.mark);
    return best.delta;
  }
  // Snap one moving edge (resize): returns the snapped coordinate or null.
  snapEdge(v, axis, r, exclude, marks, edge) {
    const X = axis === 'x';
    let best = null;
    const consider = (t, mark) => { if (Math.abs(t - v) <= SNAP && (!best || Math.abs(t - v) < Math.abs(best.t - v))) best = { t, mark }; };
    for (const o of this.targets(exclude)) {
      const near = X ? overlap(r.y, r.y + r.h, o.y, o.y + o.h) > -SNAP : overlap(r.x, r.x + r.w, o.x, o.x + o.w) > -SNAP;
      if (!near) continue;
      if (X) { consider(o.x, [[o.id, 'left'], [this.drag.id, edge]]); consider(o.x + o.w, [[o.id, 'right'], [this.drag.id, edge]]); }
      else { consider(o.y, [[o.id, 'top'], [this.drag.id, edge]]); consider(o.y + o.h, [[o.id, 'bottom'], [this.drag.id, edge]]); }
    }
    for (const disp of screen.getAllDisplays()) {
      const a = disp.workArea;
      consider(X ? a.x + a.width : a.y + a.height, [[this.drag.id, edge]]);
    }
    if (!best) return null;
    marks.push(...best.mark);
    return best.t;
  }
  mark(marks) {
    const key = JSON.stringify(marks);
    if (key === this.lastMarks) return;
    this.lastMarks = key;
    this.toRenderer('wm:snap', marks);
  }

  // ---------- presets, reset, options ----------
  // classic: everything stacked under the player · side: playlist to the right of the player column ·
  // bigvis: a large video/visualizer to the right · reset: classic, default sizes, on the main screen.
  preset(name) {
    if (!['reset', ...PRESETS].includes(name)) return this.info();
    const W = this.layout.windows;
    const mainR = this.rect('main');
    const disp = name === 'reset' ? screen.getPrimaryDisplay() : screen.getDisplayMatching({ x: mainR.x, y: mainR.y, width: mainR.w, height: Math.max(20, mainR.h) });
    const wa = disp.workArea;
    let w = Math.max(MIN.main[0], mainR.w);
    if (name === 'reset') { w = DEF.w; W.video.h = DEF.video; W.playlist.h = DEF.playlist; W.video.w = w; W.playlist.w = w; }
    const on = (id) => this.visible[id] || name === 'reset';
    const free = (id) => on(id) && !FIT.has(id) && !this.shade[id];            // windows whose height we may change
    const H = (id) => (!on(id) ? 0 : FIT.has(id) || this.shade[id] ? this.fitH[id] || DEF[id] : W[id].h);
    // make a column fit the screen height by shrinking its resizable windows
    const fitColumn = (ids) => {
      const total = ids.reduce((t, id) => t + H(id), 0), room = wa.height;
      if (total <= room) return;
      const flex = ids.filter(free), flexH = flex.reduce((t, id) => t + W[id].h, 0);
      if (!flexH) return;
      const k = Math.max(0, (room - (total - flexH)) / flexH);
      for (const id of flex) W[id].h = Math.max(MIN[id][1], Math.floor(W[id].h * k));
    };
    const stack = (ids, x, y, width) => { let cy = y; for (const id of ids) { W[id].x = x; W[id].y = cy; W[id].w = width; cy += H(id); } return cy - y; };
    let x0 = mainR.x, y0 = mainR.y;
    if (name === 'classic' || name === 'reset') {
      const col = ['main', 'eq', 'video', 'playlist'];
      fitColumn(col);
      if (name === 'reset') {
        const total = col.reduce((t, id) => t + H(id), 0);
        x0 = Math.round(wa.x + (wa.width - w) / 2); y0 = Math.round(wa.y + Math.max(0, (wa.height - total) / 2));
      }
      stack(col, x0, y0, w);
    } else if (name === 'side') {
      const col = ['main', 'eq', 'video'];
      fitColumn(col);
      const colH = stack(col, x0, y0, w);
      W.playlist.x = x0 + w; W.playlist.y = y0;
      W.playlist.w = Math.max(MIN.playlist[0], Math.min(W.playlist.w, 640));
      W.playlist.h = Math.max(MIN.playlist[1], colH);
    } else if (name === 'bigvis') {
      const col = ['main', 'eq', 'playlist'];
      fitColumn(col);
      const colH = stack(col, x0, y0, w);
      const vh = Math.max(360, colH);
      W.video.x = x0 + w; W.video.y = y0;
      W.video.w = Math.max(640, Math.min(1280, Math.round(vh * 16 / 9), wa.width - w));
      W.video.h = Math.min(vh, wa.height);
    }
    // move the whole arrangement onto the screen (the top edge wins if it can't all fit)
    const rs = PANELS.filter(on).map(id => this.rect(id));
    const bx = { x0: Math.min(...rs.map(r => r.x)), y0: Math.min(...rs.map(r => r.y)), x1: Math.max(...rs.map(r => r.x + r.w)), y1: Math.max(...rs.map(r => r.y + r.h)) };
    let dx = 0, dy = 0;
    if (bx.x1 > wa.x + wa.width) dx = wa.x + wa.width - bx.x1;
    if (bx.x0 + dx < wa.x) dx = wa.x - bx.x0;
    if (bx.y1 > wa.y + wa.height) dy = wa.y + wa.height - bx.y1;
    if (bx.y0 + dy < wa.y) dy = wa.y - bx.y0;
    for (const id of PANELS) { W[id].x += dx; W[id].y += dy; }
    this.layout.preset = name === 'reset' ? 'classic' : name;
    if (this.started) this.applyAll();
    this.persist();
    const info = this.info();
    this.toRenderer('wm:layout', info);
    return info;
  }
  setOption(key, value) {
    if (key === 'snap') this.layout.snap = !!value;
    else if (key === 'onTop') {
      this.layout.onTop = !!value;
      for (const id of PANELS) { const w = this.wins.get(id); if (w && !w.isDestroyed()) w.setAlwaysOnTop(this.layout.onTop || (id === 'main' && this.mini)); }
    }
    this.persist();
    return this.info();
  }
  setMini(on) {
    this.mini = !!on;
    const m = this.wins.get('main');
    if (m && !m.isDestroyed()) m.setAlwaysOnTop(this.mini || this.layout.onTop, this.mini ? 'floating' : 'normal');
    return this.mini;
  }
  info() { return { preset: this.layout.preset, snap: this.layout.snap, onTop: this.layout.onTop, skin: this.layout.skin }; }

  // ---------- popup menus and dialogs ----------
  // x, y (and flipY: the anchor's top edge) are in the coordinates of window `from`.
  showPopup({ from, x, y, w, h, flipY, above }) {
    const pop = this.wins.get('popup'), src = this.wins.get(PANELS.includes(from) || HOSTS.includes(from) ? from : 'main');
    if (!pop || !src) return;
    const cb = src.getContentBounds();
    let sx = Math.round(cb.x + x), sy = Math.round(cb.y + y);
    w = Math.max(40, Math.ceil(w)); h = Math.max(20, Math.ceil(h));
    const disp = screen.getDisplayNearestPoint({ x: sx, y: sy });
    const a = src.isFullScreen() ? disp.bounds : disp.workArea;
    if (Number.isFinite(flipY) && (above || sy + h > a.y + a.height - 4)) sy = Math.round(cb.y + flipY - h - 3);
    sx = Math.max(a.x + 4, Math.min(sx, a.x + a.width - w - 4));
    sy = Math.max(a.y + 4, Math.min(sy, a.y + a.height - h - 4));
    pop.setBounds({ x: sx, y: sy, width: w, height: h });
    if (!pop.isVisible()) { pop.setAlwaysOnTop(true, 'pop-up-menu'); pop.show(); }
    pop.focus();
  }
  resizePopup({ w, h }) {
    const pop = this.wins.get('popup'); if (!pop || !pop.isVisible()) return;
    const b = pop.getBounds();
    const a = screen.getDisplayMatching(b).workArea;
    w = Math.ceil(w); h = Math.ceil(h);
    const y = Math.max(a.y + 4, Math.min(b.y, a.y + a.height - h - 4));
    pop.setBounds({ x: b.x, y, width: w, height: h });
  }
  hidePopup() { const pop = this.wins.get('popup'); if (pop && pop.isVisible()) pop.hide(); }
  // Dialogs open centred over the player's screen area.
  showDialog({ w, h, resize }) {
    const dlg = this.wins.get('dialog'); if (!dlg) return;
    w = Math.ceil(w); h = Math.ceil(h);
    if (resize && dlg.isVisible()) {
      const b = dlg.getBounds();
      const a = screen.getDisplayMatching(b).workArea;
      const x = Math.round(b.x + (b.width - w) / 2), y = Math.max(a.y, Math.min(b.y, a.y + a.height - h));
      dlg.setBounds({ x, y, width: w, height: h });
      return;
    }
    const m = this.rect('main');
    const ids = this.group('main');
    const rs = ids.map(id => this.rect(id));
    const box = { x0: Math.min(...rs.map(r => r.x)), x1: Math.max(...rs.map(r => r.x + r.w)), y0: m.y };
    const a = screen.getDisplayMatching({ x: m.x, y: m.y, width: m.w, height: Math.max(20, m.h) }).workArea;
    let x = Math.round((box.x0 + box.x1) / 2 - w / 2), y = Math.round(box.y0 + 60);
    x = Math.max(a.x + 4, Math.min(x, a.x + a.width - w - 4));
    y = Math.max(a.y + 4, Math.min(y, a.y + a.height - h - 4));
    dlg.setBounds({ x, y, width: w, height: h });
    dlg.setAlwaysOnTop(true, 'modal-panel');      // above the player even with "Keep windows on top"
    if (!dlg.isVisible()) dlg.show();
    dlg.focus();
  }
  hideDialog() {
    const dlg = this.wins.get('dialog'); if (!dlg || !dlg.isVisible()) return;
    dlg.hide();
    const m = this.wins.get('main'); if (m && !m.isDestroyed() && m.isVisible()) m.focus();
  }
  // Move the dialog window by the cursor (dragging its title).
  dialogDrag(phase) {
    const dlg = this.wins.get('dialog'); if (!dlg) return;
    if (phase === 'start') {
      this.dlgDrag = { cur: screen.getCursorScreenPoint(), b: dlg.getBounds() };
      clearInterval(this.dlgTimer); clearTimeout(this.dlgKill);
      this.dlgTimer = setInterval(() => { try { this.dialogDrag('move'); } catch (e) { this.log('dialog drag failed', e); this.dialogDrag('end'); } }, 15);
      this.dlgKill = setTimeout(() => this.dialogDrag('end'), 120000);
      return;
    }
    if (phase === 'end') { clearInterval(this.dlgTimer); clearTimeout(this.dlgKill); this.dlgDrag = null; return; }
    const d = this.dlgDrag; if (!d || dlg.isDestroyed()) return;
    const c = screen.getCursorScreenPoint();
    dlg.setBounds({ ...d.b, x: d.b.x + c.x - d.cur.x, y: d.b.y + c.y - d.cur.y });
  }

  // ---------- fullscreen & quitting ----------
  setFullscreen(on) {
    const v = this.wins.get('video'); if (!v || v.isDestroyed()) return false;
    const next = on === undefined || on === null ? !v.isFullScreen() : !!on;
    if (next && !v.isVisible()) { this.visible.video = true; this.apply('video'); v.show(); }
    if (next) v.setResizable(true);       // fullscreen needs a resizable window; apply() turns it off again
    v.setFullScreen(next);
    if (next) v.focus();
    return next;
  }
  isFullscreen() { const v = this.wins.get('video'); return !!(v && !v.isDestroyed() && v.isFullScreen()); }
  closeAll() {
    this.quitting = true;
    this.flush();
    for (const [id, w] of this.wins) if (id !== 'main' && !w.isDestroyed()) w.destroy();
  }
}

module.exports = { WindowManager, PANELS, HOSTS };
