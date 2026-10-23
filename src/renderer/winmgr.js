/* SlopAMP window manager (renderer side).
 *
 * Every panel lives in its own real window: the player ("main", this page), the equalizer, the
 * video/visualizer and the playlist. This file
 *   1. wraps each panel's content in a window FRAME (title bar, borders, resize grip),
 *   2. opens the other windows with window.open() and moves their frames into them,
 *   3. moves popup menus and dialogs into two hidden helper windows so they can be bigger than the
 *      window they were opened from,
 *   4. handles dragging, snapping highlights, the Layout menu and Reset layout,
 *   5. then starts the player (app.js).
 *
 * Skins only restyle the frames (frame.css) and the colours/fonts/sizes (skins/*.css, see skins.js):
 * the player and playlist code never builds or touches a frame. app.js talks to this file through
 * window.WM: WM.$ / WM.$$ find elements in any window, WM.setPanels() shows/hides/shades windows.
 */
'use strict';
(() => {
  const P = window.phosphor;
  const PANELS = ['main', 'eq', 'video', 'playlist'];

  // ---------------------------------------------------------------- frames
  // Each window's frame: title, extra title slot, buttons (ids are what app.js wires up) and content.
  const FRAMES = {
    main: { title: 'SLOPAMP', tbId: 'titlebar', logo: true, fit: true, content: ['#deck', '#updBar'],
      buttons: [['btnAbout', '?', 'About / licenses'], ['btnLayout', '&#x29C9;', 'Window layout'], ['btnMin', '&#x2013;', 'Minimize'], ['btnMini', '&#x25AD;', 'Mini player (M)'], ['btnClose', '&#x2715;', 'Close']] },
    eq: { title: 'EQUALIZER', tbId: 'eqTitle', sumId: 'eqSum', fit: true, content: ['#eqPanel'],
      buttons: [['eqMinBtn', '&#x2013;', 'Minimize equalizer'], ['eqCloseBtn', '&#x2715;', 'Close equalizer']] },
    video: { title: 'VIDEO', tbId: 'visTitle', sumId: 'visSum', grip: true, content: ['#screen'],
      buttons: [['visMinBtn', '&#x2013;', 'Minimize'], ['visCloseBtn', '&#x2715;', 'Close']] },
    playlist: { title: 'PLAYLIST', tbId: 'plTitle', sumId: 'plSum', grip: true, content: ['#plist'],
      buttons: [['plMinBtn', '&#x2013;', 'Minimize playlist'], ['plCloseBtn', '&#x2715;', 'Close playlist']] }
  };
  function buildFrame(id) {
    const f = FRAMES[id];
    const win = document.createElement('div');
    win.className = 'win'; win.dataset.win = id;
    const tb = document.createElement('header');
    tb.className = 'frame-tb'; tb.id = f.tbId;
    tb.innerHTML = `${f.logo ? '<span class="logo-dot" title="SlopAMP"></span><span class="frame-ver" id="verLabel"></span>' : ''}<span class="rule"></span><span class="frame-name"></span>${f.sumId ? `<span class="frame-sum" id="${f.sumId}"></span>` : ''}<span class="rule"></span><div class="frame-btns"></div>`;
    tb.querySelector('.frame-name').textContent = f.title;
    for (const [bid, label, title] of f.buttons) {
      const b = document.createElement('button');
      b.type = 'button'; b.id = bid; b.innerHTML = label; b.title = title;
      if (bid === 'btnClose' || bid.endsWith('CloseBtn')) b.className = 'close';
      tb.querySelector('.frame-btns').appendChild(b);
    }
    const body = document.createElement('div');
    body.className = 'frame-body';
    for (const sel of f.content) { const el = document.querySelector(sel); if (el) body.appendChild(el); }
    win.append(tb, body);
    // resize handles: right edge (width) on every window, bottom edge + corner grip on the resizable ones
    const edge = (cls) => { const e = document.createElement('div'); e.className = cls; win.appendChild(e); };
    edge('frame-edge frame-edge-r');
    if (f.grip) { edge('frame-edge frame-edge-b'); const g = document.createElement('div'); g.className = 'frame-grip'; g.title = 'Drag to resize'; win.appendChild(g); }
    return win;
  }

  // ---------------------------------------------------------------- WM object
  const WM = window.WM = {
    wins: { main: window },        // id -> window object
    docs: [document],             // every document we own (panels + helper windows)
    activeDoc: document,          // where the user last clicked or typed
    state: { main: { visible: true }, eq: {}, video: {}, playlist: {} },
    info: { preset: 'classic', snap: true, onTop: false, skin: 'default' },
    onReset: null, onClose: null  // set by app.js
  };
  const docOf = (id) => (WM.wins[id] ? WM.wins[id].document : null);
  WM.doc = docOf;
  WM.idOf = (doc) => Object.keys(WM.wins).find(k => WM.wins[k].document === doc) || 'main';
  WM.frame = (id) => { const d = docOf(id); return d ? d.querySelector(`.win[data-win="${id}"]`) : null; };

  // Find elements in whichever window they live in now. '#id' lookups are cached.
  const cache = new Map();
  WM.$ = (sel) => {
    const hit = cache.get(sel);
    if (hit && hit.isConnected) return hit;
    for (const d of WM.docs) {
      const el = d.querySelector(sel);
      if (el) { if (/^#[\w-]+$/.test(sel)) cache.set(sel, el); return el; }
    }
    return null;
  };
  WM.$$ = (sel) => WM.docs.flatMap(d => [...d.querySelectorAll(sel)]);
  WM.onDocs = (type, fn, opts) => { for (const d of WM.docs) d.addEventListener(type, fn, opts); };
  WM.onWins = (type, fn, opts) => { for (const id of PANELS) if (WM.wins[id]) WM.wins[id].addEventListener(type, fn, opts); };
  // <body> classes (fs, mini, audvis…) are kept the same in every window.
  WM.body = {
    toggle: (c, on) => { const v = on === undefined ? !document.body.classList.contains(c) : !!on; for (const d of WM.docs) d.body.classList.toggle(c, v); return v; },
    add: (c) => WM.body.toggle(c, true),
    remove: (c) => WM.body.toggle(c, false),
    contains: (c) => document.body.classList.contains(c)
  };
  // Move an element (toast, drop hint, download bar) into another window.
  WM.host = (el, doc) => { if (el && doc && el.ownerDocument !== doc) doc.body.appendChild(el); return el; };
  WM.isShown = (id) => id === 'main' || (!!WM.state[id] && !!WM.state[id].visible);
  // Where notices (toasts, the download bar) go: the playlist if it's open, else the video, else the player.
  WM.noticeDoc = () => {
    if (document.body.classList.contains('fs')) return docOf('video');
    for (const id of ['playlist', 'video']) if (WM.isShown(id) && !WM.state[id].shade) return docOf(id);
    return document;
  };
  WM.setTitle = (id, text) => { const f = WM.frame(id); if (f) f.querySelector('.frame-name').textContent = text; };
  // Read a colour/size from the skin (for canvas drawing). Cached until the skin changes.
  const tokens = new Map();
  WM.token = (name) => {
    if (!tokens.has(name)) tokens.set(name, getComputedStyle(document.documentElement).getPropertyValue(name).trim());
    return tokens.get(name);
  };
  WM.clearTokens = () => tokens.clear();

  // ---------------------------------------------------------------- showing / hiding / shading windows
  // app.js calls this whenever a window should appear, disappear or shade:
  //   WM.setPanels({ eq: { visible, shade }, video: { visible, shade, title }, playlist: { visible, shade } }, { reflow })
  let lastSent = '';
  WM.setPanels = (panels, opts = {}) => {
    for (const [id, st] of Object.entries(panels || {})) {
      if (!WM.state[id]) continue;
      WM.state[id] = { ...WM.state[id], ...st };
      const f = WM.frame(id); if (!f) continue;
      f.classList.toggle('shade', !!WM.state[id].shade);
      if (st.title) WM.setTitle(id, st.title);
    }
    ready = true;
    send(opts.reflow !== false, false);
  };
  function measure(id) {
    const f = WM.frame(id); if (!f) return 0;
    const fit = FRAMES[id].fit || (WM.state[id] && WM.state[id].shade);
    return fit ? Math.ceil(f.getBoundingClientRect().height) : 0;
  }
  let ready = false;   // nothing is sent until app.js has decided which windows show
  function send(reflow, force) {
    if (!ready) return;
    const list = PANELS.map(id => ({ id, visible: WM.isShown(id), shade: !!(WM.state[id] && WM.state[id].shade), h: measure(id) }));
    const key = JSON.stringify(list);
    if (!force && key === lastSent) return;
    lastSent = key;
    P.wmSync(list, reflow);
  }
  // Content height changes (update bar, EQ note, shading) resize fit windows.
  let roPending = false;
  const ro = new ResizeObserver(() => {
    if (roPending) return; roPending = true;
    requestAnimationFrame(() => { roPending = false; send(true, false); });
  });

  // ---------------------------------------------------------------- dragging, grip, title bar menu
  function wireFrame(id) {
    const f = WM.frame(id), tb = f.querySelector('.frame-tb'), doc = f.ownerDocument;
    const startDrag = (e, mode, el) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      // The main process follows the mouse itself until the button is released (windows.js dragStart).
      let ended = false;
      const end = () => { if (ended) return; ended = true; P.wmDrag('end'); };
      P.wmDrag('start', id, mode);
      el.addEventListener('pointerup', end, { once: true });
      el.addEventListener('lostpointercapture', end, { once: true });
      doc.defaultView.addEventListener('blur', end, { once: true });
    };
    tb.addEventListener('pointerdown', (e) => { if (!e.target.closest('button, .logo-dot.has-upd') && !document.body.classList.contains('fs')) startDrag(e, 'move', tb); });
    tb.addEventListener('contextmenu', (e) => { e.preventDefault(); openLayoutMenu({ doc, x: e.clientX, y: e.clientY }); });
    const grip = f.querySelector('.frame-grip');
    if (grip) grip.addEventListener('pointerdown', (e) => startDrag(e, 'resize', grip));
    const er = f.querySelector('.frame-edge-r'), eb = f.querySelector('.frame-edge-b');
    if (er) er.addEventListener('pointerdown', (e) => startDrag(e, 'resize-x', er));
    if (eb) eb.addEventListener('pointerdown', (e) => { if (!f.classList.contains('shade')) startDrag(e, 'resize-y', eb); });
    if (FRAMES[id].fit) ro.observe(f);
    else ro.observe(f.querySelector('.frame-tb'));
  }
  // Green glow on the edges that just snapped together.
  P.onWm((ch, v) => {
    if (ch === 'wm:snap') {
      for (const id of PANELS) { const f = WM.frame(id); if (f) f.classList.remove('snap-left', 'snap-right', 'snap-top', 'snap-bottom'); }
      for (const [id, edge] of v || []) { const f = WM.frame(id); if (f) f.classList.add(`snap-${edge}`); }
    } else if (ch === 'wm:layout') {
      WM.info = { ...WM.info, ...v };
    } else if (ch === 'wm:closed') {
      // Alt+F4: a panel acts like its ✕ button, a dialog is cancelled, a menu closes
      if (v === 'dialog') { if (dlgDoc) for (const d of [...dlgDoc.querySelectorAll('dialog[open]')]) d.close('cancel'); }
      else if (v === 'popup') hideAllPopups();
      else { const f = WM.frame(v); const b = f && f.querySelector('.frame-btns button.close'); if (b) b.click(); }
    } else if (ch === 'wm:popup-blur') {
      hideAllPopups();
    }
  });

  // ---------------------------------------------------------------- layout menu
  const PRESET_NAMES = [['classic', 'Classic (stacked)'], ['side', 'Playlist beside player'], ['bigvis', 'Big visualizer']];
  async function openLayoutMenu(pos) {
    WM.info = await P.wmInfo();
    const m = WM.$('#wmMenu'); m.innerHTML = '';
    const add = (cls, html, fn) => {
      const d = document.createElement('div'); d.className = cls; d.innerHTML = html;
      if (fn) d.onclick = () => { m.classList.add('hidden'); fn(); };
      m.appendChild(d); return d;
    };
    add('dm-sec', 'Layout');
    for (const [k, label] of PRESET_NAMES) add(`dm-item${WM.info.preset === k ? ' cur' : ''}`, label, () => WM.preset(k));
    m.appendChild(document.createElement('hr'));
    add(`dm-item${WM.info.snap ? ' cur' : ''}`, 'Snap to edges &amp; windows', async () => { WM.info = await P.wmOption('snap', !WM.info.snap); });
    add(`dm-item${WM.info.onTop ? ' cur' : ''}`, 'Keep windows on top', async () => { WM.info = await P.wmOption('onTop', !WM.info.onTop); });
    m.appendChild(document.createElement('hr'));
    add('dm-item', 'Reset layout<small>Ctrl+Alt+R</small>', () => WM.reset());
    m.appendChild(document.createElement('hr'));
    add('dm-item', 'Skins\u2026', () => { if (WM.skins) WM.skins.openPicker(pos); });
    m.classList.remove('hidden');
    WM.popup(m, pos);
  }
  WM.openLayoutMenu = openLayoutMenu;
  WM.preset = async (name) => { WM.info = await P.wmPreset(name); };
  // Reset layout: every window back, unshaded, stacked on the main screen. Rescues off-screen windows.
  WM.reset = async () => {
    if (WM.onReset) await WM.onReset();
    WM.info = await P.wmPreset('reset');
  };

  // ---------------------------------------------------------------- popup menus (own window)
  // The menus live in a small always-on-top window so they can stick out of the window they open from.
  // pos: { doc, x, y, flipY } in client coordinates of `doc` (flipY = top of the button, to open above it).
  let popDoc = null;
  WM.popup = (el, pos = {}) => {
    const doc = pos.doc || WM.activeDoc || document;
    const from = WM.idOf(doc);
    if (!popDoc) return;
    WM.host(el, popDoc);
    for (const m of popDoc.body.children) if (m !== el) m.classList.add('hidden');
    el.classList.remove('hidden');
    el.style.left = '0px'; el.style.top = '0px';
    const r = el.getBoundingClientRect();
    P.wmPopup({ from, x: pos.x || 0, y: pos.y || 0, w: r.width, h: r.height, flipY: pos.flipY, above: !!pos.above });
  };
  function hideAllPopups() { if (popDoc) for (const m of popDoc.body.children) m.classList.add('hidden'); }
  WM.hidePopups = hideAllPopups;
  function hostPopups(doc) {
    popDoc = doc;
    for (const sel of ['#ctx', '#dlMenu', '#popMenu', '#eqPresets', '#wmMenu', '#skinMenu']) { const el = document.querySelector(sel); if (el) doc.body.appendChild(el); }
    let shown = false;
    const check = () => {
      const vis = [...doc.body.children].find(m => !m.classList.contains('hidden'));
      if (!vis && shown) { shown = false; P.wmPopupHide(); }
      else if (vis) shown = true;
    };
    new MutationObserver(check).observe(doc.body, { attributes: true, attributeFilter: ['class'], subtree: true, childList: true });
    const rs = new ResizeObserver((entries) => {
      for (const en of entries) {
        if (en.target.classList.contains('hidden')) continue;
        const r = en.target.getBoundingClientRect();
        if (r.width && r.height) P.wmPopupSize({ w: r.width, h: r.height });
      }
    });
    for (const m of doc.body.children) rs.observe(m);
    doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideAllPopups(); });
  }

  // ---------------------------------------------------------------- dialogs (own window)
  let dlgDoc = null;
  function hostDialogs(doc) {
    dlgDoc = doc;
    const fit = (first) => {
      const open = [...doc.querySelectorAll('dialog[open]')];
      if (!open.length) { P.wmDialogHide(); return; }
      let w = 0, h = 0;
      for (const d of open) { const r = d.getBoundingClientRect(); w = Math.max(w, r.width); h = Math.max(h, r.height); }
      P.wmDialog({ w, h, resize: !first });
    };
    const rs = new ResizeObserver(() => fit(false));
    for (const d of [...document.querySelectorAll('dialog')]) {
      doc.body.appendChild(d);
      const native = Object.getPrototypeOf(d).showModal;
      d.showModal = function () {
        const first = !doc.querySelector('dialog[open]');
        native.call(this);
        fit(first);
      };
      d.addEventListener('close', () => setTimeout(() => fit(false), 0));
      rs.observe(d);
    }
    // drag a dialog by its title
    doc.addEventListener('pointerdown', (e) => {
      const t = e.target.closest('.dlg-title, .dlm-title, .about-hero, .upd-title');
      if (!t || e.button !== 0 || e.target.closest('button, a, input, select')) return;
      try { t.setPointerCapture(e.pointerId); } catch (_) {}
      P.wmDialogDrag('start');
      const end = () => P.wmDialogDrag('end');
      t.addEventListener('pointerup', end, { once: true });
      t.addEventListener('lostpointercapture', end, { once: true });
    });
  }

  // ---------------------------------------------------------------- boot
  const panelDocReady = (w) => { try { return w.location.pathname.endsWith('/panel.html') && w.document.readyState === 'complete'; } catch (_) { return false; } };
  function openWindow(id) {
    return new Promise((resolve) => {
      const w = window.open(`panel.html?w=${id}`, id);
      if (!w) { resolve(null); return; }
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (panelDocReady(w)) { clearInterval(iv); resolve(w); }
        else if (Date.now() - t0 > 15000) { clearInterval(iv); resolve(null); }
      }, 10);
    });
  }
  function track(doc) {
    const mark = () => { WM.activeDoc = doc; };
    doc.addEventListener('pointerdown', mark, true);
    doc.addEventListener('contextmenu', mark, true);
    doc.addEventListener('keydown', (e) => {
      mark();
      if (e.ctrlKey && e.altKey && !e.shiftKey && e.key.toLowerCase() === 'r') { e.preventDefault(); e.stopImmediatePropagation(); WM.reset(); }
    }, true);
  }

  (async function boot() {
    const frames = {};
    for (const id of PANELS) frames[id] = buildFrame(id);
    document.body.prepend(frames.main);
    document.body.classList.add('win-main', 'fit');
    const ids = ['eq', 'video', 'playlist', 'popup', 'dialog'];
    const opened = await Promise.all(ids.map(openWindow));
    ids.forEach((id, i) => {
      const w = opened[i];
      if (!w) { console.error('window failed to open', id); return; }
      WM.wins[id] = w;
      WM.docs.push(w.document);
      const b = w.document.body;
      if (FRAMES[id]) {
        b.classList.add(`win-${id}`); if (FRAMES[id].fit) b.classList.add('fit');
        b.appendChild(frames[id]);
        w.document.title = `SlopAMP ${FRAMES[id].title.charAt(0)}${FRAMES[id].title.slice(1).toLowerCase()}`;
      } else b.classList.add(`host-${id}`);
    });
    for (const d of WM.docs) track(d);
    if (WM.wins.popup) hostPopups(WM.wins.popup.document);
    if (WM.wins.dialog) hostDialogs(WM.wins.dialog.document);
    for (const id of PANELS) if (WM.wins[id]) wireFrame(id);
    WM.$('#btnLayout').addEventListener('click', (e) => {
      e.stopPropagation();
      const m = WM.$('#wmMenu');
      if (!m.classList.contains('hidden')) { m.classList.add('hidden'); return; }
      const r = e.currentTarget.getBoundingClientRect();
      openLayoutMenu({ doc: document, x: r.left, y: r.bottom + 3, flipY: r.top });
    });
    // a click anywhere else in SlopAMP closes the Layout menu
    WM.onDocs('mousedown', (e) => { const m = WM.$('#wmMenu'); if (m && !m.contains(e.target) && !e.target.closest('#btnLayout')) m.classList.add('hidden'); });
    try { WM.info = await P.wmInfo(); } catch (_) {}
    const ver = WM.$('#verLabel');
    if (ver && WM.info.version) { ver.textContent = `v${WM.info.version}`; ver.title = `SlopAMP ${WM.info.version}`; }
    // skins.js (put the saved skin on before anything shows), then the player itself
    for (const src of ['skins.js', 'app.js']) {
      await new Promise((res) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = res; document.body.appendChild(s); });
    }
  })();
})();
