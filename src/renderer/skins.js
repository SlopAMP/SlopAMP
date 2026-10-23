/* SlopAMP skins: the list of built-in skins, switching between them, and the picker.
 *
 * A skin is one CSS file in skins/. skins/classic.css is the default "SlopAMP Classic" look and
 * defines every colour, glow, border, background, font and size; every other skin is loaded after
 * it (and after style.css) and overrides what it changes. Switching only swaps that one stylesheet
 * in every window, so it's instant. The chosen skin is saved in the window layout (windows.js,
 * layout.skin); "Reset layout" and the lightning bolt never touch it.
 *
 * To add a skin: put skins/<id>.css next to the others and add a line to SKINS below (`sw` are the
 * colours of its little preview in the picker: frame, title bar, LCD, LCD digits, playlist, text).
 */
'use strict';
(() => {
  const P = window.phosphor;
  const SKINS = [
    { id: 'classic', name: 'SlopAMP Classic', group: 'Colors', sw: ['#2b2e3a', '#3b3f50', '#000', '#3dff6e', '#000', '#33e85b'] },
    { id: 'red', name: 'Red Alert', group: 'Colors', sw: ['#2b2e3a', '#3b3f50', '#000', '#ff4a5f', '#000', '#ff5a6c'] },
    { id: 'ice', name: 'Ice Blue', group: 'Colors', sw: ['#2b2e3a', '#3b3f50', '#000', '#3de1ff', '#000', '#33cfe8'] },
    { id: 'purple', name: 'Purple Haze', group: 'Colors', sw: ['#2b2e3a', '#3b3f50', '#000', '#c77dff', '#000', '#bf7bff'] },
    { id: 'amber', name: 'Amber', group: 'Colors', sw: ['#2b2e3a', '#3b3f50', '#000', '#ffb43d', '#000', '#ffb233'] },
    { id: 'chrome', name: 'Chrome', group: 'Styles', sw: ['#d7dbe1', '#eef1f5', '#000', '#5fd0ff', '#0b0f16', '#7fd6ff'] },
    { id: 'walnut', name: 'Walnut Hi-Fi', group: 'Styles', sw: ['#5a3720', '#7a4c2c', '#120b06', '#ffab3d', '#140d07', '#ffcf8a'] },
    { id: 'synthwave', name: 'Synthwave', group: 'Styles', sw: ['#2a1046', '#3a1c5c', '#000', '#3df2ff', '#000', '#ff6ad5'] },
    { id: 'terminal', name: 'Terminal', group: 'Styles', sw: ['#030503', '#071007', '#000', '#33ff66', '#000', '#33ff66'] },
    { id: 'pocket', name: 'Pocket LCD', group: 'Styles', sw: ['#306230', '#3f7a3f', '#8bac0f', '#0f380f', '#9bbc0f', '#0f380f'] }
  ];
  const known = (id) => SKINS.some(s => s.id === id);
  let current = 'classic';

  // Put skin `id` on every window. Classic is the base stylesheet, so it needs no extra file.
  function apply(id, save = true) {
    if (!known(id)) id = 'classic';
    current = id;
    let pending = 0;
    // once the new colours are in: redraw the canvas pieces that don't repaint every frame
    const done = () => {
      if (--pending > 0) return;
      WM.clearTokens();
      for (const fn of ['drawEqCurve', 'drawStateIcon']) if (typeof window[fn] === 'function') window[fn]();
    };
    for (const d of WM.docs) {
      let l = d.getElementById('skinCss');
      if (id === 'classic') { if (l) l.remove(); continue; }
      if (!l) { l = d.createElement('link'); l.rel = 'stylesheet'; l.id = 'skinCss'; d.head.appendChild(l); }
      pending++;
      l.onload = done; l.onerror = done;
      l.href = `skins/${id}.css`;
    }
    for (const d of WM.docs) for (const s of SKINS) d.body.classList.toggle(`skin-${s.id}`, s.id === id);
    if (!pending) { pending = 1; done(); }
    if (save) P.wmOption('skin', id).then((info) => { if (info) WM.info = info; });
    renderPicker();
  }

  // ---- the picker (lives in the popup-menu window like the other menus)
  const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function card(s) {
    const [frame, tb, lcd, on, list, text] = s.sw;
    return `<div class="sk-card${s.id === current ? ' cur' : ''}" data-skin="${s.id}" title="${esc(s.name)}">`
      + `<div class="sk-pv" style="background:${frame}"><div class="sk-tb" style="background:${tb}"></div><div class="sk-body">`
      + `<div class="sk-lcd" style="background:${lcd};color:${on};text-shadow:0 0 4px ${on}">0:42</div>`
      + `<div class="sk-list" style="background:${list}">${[80, 60, 70, 50].map((w, i) => `<i style="background:${text};width:${w}%;opacity:${1 - i * 0.15}"></i>`).join('')}</div>`
      + `</div></div><div class="sk-name"><b>${s.id === current ? '&#10003;' : ''}</b>${esc(s.name)}</div></div>`;
  }
  function renderPicker() {
    const m = WM.$('#skinMenu'); if (!m) return;
    const group = (g) => SKINS.filter(s => s.group === g).map(card).join('');
    m.innerHTML = `<div class="sk-head" title="Drag to move"><span>SKINS</span><small>click to switch \u00b7 drag here to move</small><button type="button" class="sk-x" title="Close (Esc)">&#x2715;</button></div>`
      + `<div class="sk-sec">Colors</div><div class="sk-grid">${group('Colors')}</div>`
      + `<div class="sk-sec">Styles</div><div class="sk-grid">${group('Styles')}</div>`
      + `<div class="sk-foot">Your skin is remembered. The lightning bolt resets the layout, never the skin.</div>`;
  }
  // pos: { doc, x, y, flipY } like WM.popup. The picker is a small movable panel: it reopens where it
  // was last dragged to (remembered in the layout) and stays open until ✕, Esc or SKINS again.
  function openPicker(pos) {
    const m = WM.$('#skinMenu');
    renderPicker();
    WM.popup(m, { ...pos, remember: 'skins' });
  }
  function togglePicker() {
    const m = WM.$('#skinMenu');
    if (!m.classList.contains('hidden')) { m.classList.add('hidden'); return; }
    const b = WM.$('#bSkins'), r = b.getBoundingClientRect();
    openPicker({ doc: b.ownerDocument, x: r.left - 160, y: r.bottom + 4, flipY: r.top });
  }

  WM.skins = { list: SKINS, apply, openPicker, get current() { return current; } };

  const m = WM.$('#skinMenu');
  m.addEventListener('click', (e) => {
    if (e.target.closest('.sk-x')) { m.classList.add('hidden'); return; }
    const c = e.target.closest('.sk-card'); if (c && c.dataset.skin !== current) apply(c.dataset.skin);
  });
  // drag the picker by its title (the main process moves the window, keeps it on screen and remembers it)
  m.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.sk-head');
    if (!h || e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    try { h.setPointerCapture(e.pointerId); } catch (_) {}
    P.wmPopupDrag('start');
    let ended = false;
    const end = () => { if (!ended) { ended = true; P.wmPopupDrag('end'); } };
    h.addEventListener('pointerup', end, { once: true });
    h.addEventListener('lostpointercapture', end, { once: true });
  });
  WM.$('#bSkins').addEventListener('click', (e) => { e.stopPropagation(); togglePicker(); });

  apply(WM.info && WM.info.skin, false);     // the saved skin, before the windows appear
})();
