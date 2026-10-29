/* SlopAMP skins: the list of built-in skins, user skins, switching between them, the picker and the
 * Skin Editor.
 *
 * A skin is one CSS file. skins/classic.css is the default "SlopAMP Classic" look and defines every
 * colour, glow, border, background, font and size; every other skin is loaded after it (and after
 * style.css) and overrides what it changes. Switching only swaps that one stylesheet in every window,
 * so it's instant. The chosen skin is saved in the window layout (windows.js, layout.skin); "Reset
 * layout" and the lightning bolt never touch it.
 *
 * Built-in skins ship with the app: add skins/<id>.css and a line to SKINS below (`sw` are the colours
 * of its little preview in the picker: frame, title bar, LCD, LCD digits, playlist, text).
 * User skins (1.7) are files in Downloads\SlopAMP\skins\ made with the Skin Editor or imported
 * (main.js "user skins"); their id is "user:<slug>" and they're put in as a <style> instead of a <link>.
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
  let USER = [];                                   // user skins, from main.js (skin:list)
  const userOf = (id) => USER.find(u => u.id === id);
  const builtin = (id) => SKINS.find(s => s.id === id);
  const known = (id) => !!(builtin(id) || userOf(id));
  const nameOf = (id) => (builtin(id) || userOf(id) || { name: id }).name;
  let current = 'classic', applyTok = 0;

  // Put skin `id` on every window. Classic is the base stylesheet, so it needs no extra file.
  async function apply(id, save = true) {
    if (!known(id)) id = 'classic';
    const tok = ++applyTok;
    const userCss = /^user:/.test(id) ? await P.skinCss(id) : null;
    if (tok !== applyTok) return;                   // another skin was picked meanwhile
    if (/^user:/.test(id) && !userCss) id = 'classic';   // its file is gone
    current = id;
    let pending = 0;
    // once the new colours are in: redraw the canvas pieces that don't repaint every frame
    const done = () => { if (--pending > 0) return; redraw(); };
    for (const d of WM.docs) {
      let l = d.getElementById('skinCss'), st = d.getElementById('skinUser');
      if (userCss) {
        if (l) l.remove();
        if (!st) { st = d.createElement('style'); st.id = 'skinUser'; d.head.appendChild(st); }
        st.textContent = userCss;
      } else {
        if (st) st.remove();
        if (id !== 'classic') {
          if (!l) { l = d.createElement('link'); l.rel = 'stylesheet'; l.id = 'skinCss'; d.head.appendChild(l); }
          pending++;
          l.onload = done; l.onerror = done;
          l.href = `skins/${id}.css`;
        } else if (l) l.remove();
      }
      const live = d.getElementById('skinLive'); if (live) d.head.appendChild(live);   // the editor's live changes stay on top
      for (const s of SKINS) d.body.classList.toggle(`skin-${s.id}`, s.id === id);
      d.body.classList.toggle('skin-user', !!userCss);
    }
    if (!pending) { pending = 1; done(); }
    if (save) P.wmOption('skin', id).then((info) => { if (info) WM.info = info; });
    renderPicker();
  }
  function redraw() {
    WM.clearTokens();
    for (const fn of ['drawEqCurve', 'drawStateIcon', 'clipDraw']) if (typeof window[fn] === 'function') { try { window[fn](); } catch (_) {} }
  }
  async function refresh() {
    try { USER = await P.skinList(); } catch (_) { USER = []; }
    if (/^user:/.test(current) && !userOf(current)) await apply('classic');   // the active user skin was deleted
    renderPicker();
    if (ED.open) edFillBase();
    return USER;
  }

  // ---- the picker (lives in the popup-menu window like the other menus)
  const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function card(s) {
    const [frame, tb, lcd, on, list, text] = s.sw && s.sw.length === 6 ? s.sw : SKINS[0].sw;
    return `<div class="sk-card${s.id === current ? ' cur' : ''}" data-skin="${esc(s.id)}" title="${esc(s.name)}">`
      + `<div class="sk-pv" style="background:${esc(frame)}"><div class="sk-tb" style="background:${esc(tb)}"></div><div class="sk-body">`
      + `<div class="sk-lcd" style="background:${esc(lcd)};color:${esc(on)};text-shadow:0 0 4px ${esc(on)}">0:42</div>`
      + `<div class="sk-list" style="background:${esc(list)}">${[80, 60, 70, 50].map((w, i) => `<i style="background:${esc(text)};width:${w}%;opacity:${1 - i * 0.15}"></i>`).join('')}</div>`
      + `</div></div><div class="sk-name"><b>${s.id === current ? '&#10003;' : ''}</b>${esc(s.name)}</div></div>`;
  }
  function renderPicker() {
    const m = WM.$('#skinMenu'); if (!m) return;
    const group = (g) => SKINS.filter(s => s.group === g).map(card).join('');
    m.innerHTML = `<div class="sk-head" title="Drag to move"><span>SKINS</span><small>click to switch · drag here to move</small><button type="button" class="sk-x" title="Close (Esc)">&#x2715;</button></div>`
      + `<div class="sk-sec">Colors</div><div class="sk-grid">${group('Colors')}</div>`
      + `<div class="sk-sec">Styles</div><div class="sk-grid">${group('Styles')}</div>`
      + `<div class="sk-sec">Mine</div><div class="sk-grid">${USER.map(card).join('')}<button type="button" class="sk-new" title="Make your own skin, starting from the one you have on">+ New skin<small>Skin editor</small></button></div>`
      + `<div class="sk-foot">Your skin is remembered. The lightning bolt resets the layout, never the skin. <button type="button" class="sk-ed">Skin editor…</button> <button type="button" class="sk-lib">Manage in Library</button></div>`;
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

  // ---------------------------------------------------------------- Skin Editor
  // A separate window (winmgr.js FRAMES.skined). It starts from a skin, groups its colours into families
  // and moves each family together with Hue / Saturation / Brightness (or by picking the family's lead
  // colour), the way build/skins/make_skins.py makes the built-in skins. Every change shows at once in all
  // windows (a <style id="skinLive"> on top); Save / Save as write Downloads\SlopAMP\skins\<name>.css via main.js.
  //
  // The families come from Classic's own values, so they're the same whatever the starting skin is:
  // everything green in Classic is the LCD & accent family, ambers are warnings, and so on. Neutral greys
  // are grouped by what they paint. Only plain colour values are moved; values that point at another
  // variable (var(--green)) follow it by themselves.
  const ED_GROUPS = [
    { key: 'accent', name: 'LCD & accent', hint: 'the glowing colour: LCD, playlist text, glows, green buttons and outlines', lead: '--green', family: 'green' },
    { key: 'body', name: 'Player body & frames', hint: 'the player, title bars, bevels, video controls', lead: '--frame',
      vars: ['--frame', '--frame-2', '--frame-outer', '--frame-bg', '--tb-bg', '--tb-rule', '--grip', '--bevel-hi', '--bevel-lo', '--edge', '--vctl', '--vctl-line', '--line-dim',
        '--base-12', '--base-13b', '--base-13c', '--base-14', '--base-14b', '--base-17b', '--base-18', '--base-20', '--base-20c', '--base-21', '--base-22', '--base-22b', '--base-24', '--base-34b', '--base-39', '--base-42', '--base-47'] },
    { key: 'buttons', name: 'Buttons', hint: 'the grey 3D buttons and their text', lead: '--btn-top', vars: ['--btn-top', '--btn-bottom', '--btn-ink'] },
    { key: 'panels', name: 'Menus, dialogs & screens', hint: 'menus, dialogs, the LCD and playlist backgrounds', lead: '--dialog-bg',
      vars: ['--menu-bg', '--dialog-bg', '--lcd', '--black', '--screen-bg', '--base-06', '--base-07', '--base-07b', '--base-09', '--base-09b', '--base-10-a85', '--base-13', '--base-20b'] },
    { key: 'text', name: 'Text', hint: 'normal, dim and title text', lead: '--ink',
      vars: ['--ink', '--ink-muted', '--ink-dim', '--ink-menu', '--title-ink', '--vctl-ink', '--spectrum-peak', '--white', '--base-60', '--base-70', '--base-80', '--base-81', '--base-81b', '--base-86', '--base-87b'] },
    { key: 'warn', name: 'Warnings & slider', hint: 'position slider, pause, warnings', lead: '--amber', family: 'amber' },
    { key: 'danger', name: 'Danger & stop', hint: 'stop, delete buttons, errors', lead: '--red', family: 'red' },
    { key: 'select', name: 'Selection & links', hint: 'selected playlist rows, menu hover, seek bar', lead: '--pl-sel', family: 'blue' }
  ];
  const ED = { open: false, shade: false, base: 'classic', classic: null, vals: new Map(), extraVars: new Set(), members: {}, g: {}, per: {}, dirty: false, prev: null };
  const COL = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
  function parseCol(c) {
    if (c[0] === '#') {
      let h = c.slice(1); if (h.length === 3 || h.length === 4) h = [...h].map(x => x + x).join('');
      return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255, a: h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1, hex: true };
    }
    const n = (c.match(/[\d.]+%?/g) || []).map(v => (v.endsWith('%') ? parseFloat(v) * 2.55 : parseFloat(v)));
    return { r: (n[0] || 0) / 255, g: (n[1] || 0) / 255, b: (n[2] || 0) / 255, a: n.length > 3 ? n[3] : 1, hex: false };
  }
  function toHsl({ r, g, b }) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return { h: 0, s: 0, l };
    const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
    return { h, s, l };
  }
  function fromHsl(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (!s) return { r: l, g: l, b: l };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return { r: f(h + 1 / 3), g: f(h), b: f(h - 1 / 3) };
  }
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const hex2 = (v) => Math.round(clamp(v) * 255).toString(16).padStart(2, '0');
  function fmtCol(c, asHex) {
    if (asHex && c.a >= 0.999) return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
    return `rgba(${Math.round(clamp(c.r) * 255)},${Math.round(clamp(c.g) * 255)},${Math.round(clamp(c.b) * 255)},${Math.round(c.a * 1000) / 1000})`;
  }
  const hexOf = (value) => { const m = String(value).match(COL); if (!m) return '#000000'; const c = parseCol(m[0]); return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`; };
  // Move every colour in a value: hue turns, saturation scales (plus `add` for greys), brightness goes toward white/black.
  function shift(value, p) {
    return String(value).replace(COL, (m) => {
      const c = parseCol(m), { h, s, l } = toHsl(c);
      const s2 = clamp(s * (p.s / 100) + (p.add || 0)), l2 = p.l >= 0 ? l + (1 - l) * p.l / 100 : l * (1 + p.l / 100);
      return fmtCol({ ...fromHsl(h + p.h, s2, clamp(l2)), a: c.a }, c.hex);
    });
  }
  const identity = (p) => !p || (!p.h && p.s === 100 && !p.l && !p.add);
  function family(value) {     // which colour family a Classic value belongs to (null: a neutral)
    const m = String(value).match(COL); if (!m) return null;
    const { h, s, l } = toHsl(parseCol(m[0])), chroma = s * (1 - Math.abs(2 * l - 1));
    if (chroma < 0.03) return null;
    if (h >= 70 && h < 175) return 'green';
    if (h >= 35 && h < 70 && chroma > 0.05) return 'amber';
    if ((h < 20 || h >= 330) && chroma > 0.1) return 'red';
    if (h >= 180 && h < 330 && chroma > 0.1) return 'blue';
    return null;
  }
  // Variables of a skin file: { vars: Map, extra }
  function splitCss(text) {
    const vars = new Map(), at = text.search(/:root\s*\{/);
    if (at < 0) return vars;
    const open = text.indexOf('{', at), close = text.indexOf('}', open);
    const block = text.slice(open + 1, close < 0 ? text.length : close).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars.set(m[1], m[2].trim());
    return vars;
  }
  function resolver(map) {
    const memo = new Map();
    const res = (name, depth = 0) => {
      if (memo.has(name)) return memo.get(name);
      const v = map.get(name); if (v == null) return '';
      const out = depth > 8 ? v : v.replace(/var\((--[\w-]+)(?:\s*,\s*([^)]*))?\)/g, (_, n, fb) => res(n, depth + 1) || fb || '');
      memo.set(name, out); return out;
    };
    return res;
  }
  // Load the starting skin: its values (Classic + its own), and which variables each group moves.
  async function edLoadBase(id) {
    if (!ED.classic) ED.classic = splitCss((await P.skinCss('classic')) || '');
    const own = id === 'classic' ? new Map() : splitCss((await P.skinCss(id)) || '');
    const merged = new Map([...ED.classic, ...own]);
    ED.base = id; ED.vals = merged; ED.g = {}; ED.per = {}; ED.dirty = false;
    const resClassic = resolver(ED.classic);
    const literal = (n) => { const v = merged.get(n); return v != null && !/var\(/.test(v) && COL.test(v) && !(COL.lastIndex = 0); };
    ED.members = {};
    const taken = new Set();
    for (const g of ED_GROUPS) if (g.vars) { ED.members[g.key] = g.vars.filter(n => merged.has(n) && literal(n)); g.vars.forEach(n => taken.add(n)); }
    for (const g of ED_GROUPS) if (g.family) ED.members[g.key] = [...merged.keys()].filter(n => !taken.has(n) && literal(n) && family(resClassic(n) || merged.get(n)) === g.family);
    for (const g of ED_GROUPS) ED.g[g.key] = { h: 0, s: 100, l: 0, add: 0 };
  }
  // The values the editor changes now: { '--name': value }
  function edChanges() {
    const out = {};
    for (const g of ED_GROUPS) {
      const p = ED.g[g.key];
      if (!identity(p)) for (const n of ED.members[g.key] || []) out[n] = shift(ED.vals.get(n), p);
    }
    for (const [n, v] of Object.entries(ED.per)) out[n] = v;
    return out;
  }
  let liveRaf = 0;
  function edLive() {
    if (liveRaf) return;
    liveRaf = requestAnimationFrame(() => {
      liveRaf = 0;
      const ch = edChanges(), css = Object.keys(ch).length ? `:root {\n${Object.entries(ch).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}` : '';
      for (const d of WM.docs) {
        let st = d.getElementById('skinLive');
        if (!css) { if (st) st.remove(); continue; }
        if (!st) { st = d.createElement('style'); st.id = 'skinLive'; }
        st.textContent = css; d.head.appendChild(st);          // last, so it wins over the skin
      }
      redraw();
      edStatus();
    });
  }
  function edClearLive() { for (const d of WM.docs) { const st = d.getElementById('skinLive'); if (st) st.remove(); } redraw(); }

  // ---- editor UI
  const $e = (sel) => WM.$(sel);
  function edFillBase() {
    const sel = $e('#skedBase'); if (!sel) return;
    const opt = (s) => `<option value="${esc(s.id)}"${s.id === ED.base ? ' selected' : ''}>${esc(s.name)}</option>`;
    sel.innerHTML = `<optgroup label="Built-in">${SKINS.map(opt).join('')}</optgroup>` + (USER.length ? `<optgroup label="Mine">${USER.map(opt).join('')}</optgroup>` : '');
    sel.value = ED.base;
  }
  function edRender() {
    edFillBase();
    const gs = ED_GROUPS.filter(g => (ED.members[g.key] || []).length);
    $e('#skedGroups').innerHTML = gs.map(g => {
      const p = ED.g[g.key], mem = ED.members[g.key], ch = edChanges();
      const lead = mem.includes(g.lead) ? g.lead : mem[0];
      const leadVal = ch[lead] || ED.vals.get(lead);
      const row = (k, label, min, max, unit) => `<label class="sked-sl"><span>${label}</span><input type="range" min="${min}" max="${max}" step="1" value="${p[k]}" data-g="${g.key}" data-k="${k}"><output>${p[k] > 0 && k !== 's' ? '+' : ''}${p[k]}${unit}</output></label>`;
      const each = mem.filter(n => (String(ED.vals.get(n)).match(COL) || []).length === 1).map(n => {
        const v = ch[n] || ED.vals.get(n);
        return `<label class="sked-var" title="${esc(n)}: ${esc(v)}"><input type="color" value="${hexOf(v)}" data-var="${esc(n)}"><span>${esc(n.slice(2))}</span>${ED.per[n] ? '<i>changed</i>' : ''}</label>`;
      }).join('');
      return `<div class="sked-g${identity(p) && !mem.some(n => ED.per[n]) ? '' : ' on'}" data-g="${g.key}">`
        + `<div class="sked-gh"><input type="color" class="sked-lead" value="${hexOf(leadVal)}" data-g="${g.key}" data-lead="${esc(lead)}" title="Pick this family's main colour (${esc(lead)}); the others follow"><b>${esc(g.name)}</b><span class="dim">${mem.length} colour${mem.length > 1 ? 's' : ''}</span><button type="button" class="ed-link sked-greset" data-g="${g.key}">reset</button></div>`
        + `<div class="sked-hint dim">${esc(g.hint)}</div>`
        + row('h', 'Hue', -180, 180, '°') + row('s', 'Saturation', 0, 200, '%') + row('l', 'Brightness', -100, 100, '%')
        + `<details class="sked-each"${ED.openEach === g.key ? ' open' : ''} data-g="${g.key}"><summary>Each colour</summary><div class="sked-vars">${each}</div></details></div>`;
    }).join('');
    edStatus();
  }
  function edStatus() {
    const u = userOf(ED.base);
    $e('#skedSave').disabled = !u || !ED.dirty;
    $e('#skedSave').title = u ? `Save the changes into ${u.name}` : 'Built-in skins can’t be changed: use Save as';
    $e('#skedReset').disabled = !ED.dirty;
    const s = $e('#skedSum'); if (s) s.textContent = ED.dirty ? `${nameOf(ED.base)} • changed` : nameOf(ED.base);
    // readable? the main text pairs, measured on what's showing now
    const cs = getComputedStyle(document.documentElement), col = (n) => { const m = cs.getPropertyValue(n).match(COL); return m ? parseCol(m[0]) : null; };
    const lum = (c) => { const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const ratio = (a, b) => { const x = col(a), y = col(b); if (!x || !y) return 21; const p = lum(x), q = lum(y); return (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05); };
    const low = [['--ink', '--dialog-bg', 'text in dialogs'], ['--pl-green', '--list-bg', 'playlist text'], ['--lcd-on', '--lcd', 'the clock'], ['--btn-ink', '--btn-bottom', 'button text'], ['--menu-accent', '--menu-bg', 'menu highlights']]
      .filter(([a, b]) => ratio(a, b) < 3).map(x => x[2]);
    $e('#skedStatus').innerHTML = low.length ? `<span class="warn">&#9888; Hard to read: ${low.join(', ')}.</span>`
      : ED.dirty ? 'Changes show in every window now. They’re kept when you save.' : `Start from ${esc(nameOf(ED.base))} and move a colour family. Every window shows it at once.`;
  }
  async function openEditor(base) {
    if (!ED.open) { ED.prev = current; await refresh(); }
    const want = base || (ED.open ? ED.base : current);
    if (!ED.open || want !== ED.base) {
      if (ED.open && ED.dirty && !await window.confirmBox('Start from another skin?', 'Your changes to this skin aren’t saved and will be lost.', 'Discard changes')) { edFillBase(); return; }
      if (want !== current) await apply(want, false);
      await edLoadBase(want);
      edClearLive();
      const n = $e('#skedName'); if (n) n.value = userOf(want) ? userOf(want).name : '';
    }
    ED.open = true;
    if (typeof window.syncWindows === 'function') window.syncWindows();
    edRender();
  }
  async function closeEditor() {
    if (ED.dirty && !await window.confirmBox('Close the skin editor?', 'Your changes aren’t saved. Closing puts the skin back the way it was.', 'Discard changes')) return;
    ED.open = false; ED.dirty = false; ED.g = {}; ED.per = {};
    edClearLive();
    if (ED.prev && known(ED.prev) && ED.prev !== current) await apply(ED.prev, false);
    if (typeof window.syncWindows === 'function') window.syncWindows();
  }
  function edSwatches() {
    const cs = getComputedStyle(document.documentElement), first = (n, d) => (cs.getPropertyValue(n).match(COL) || [d])[0];
    return [first('--frame', '#2b2e3a'), first('--tb-bg', '#3b3f50'), first('--lcd', '#000'), first('--lcd-on', '#3dff6e'), first('--list-bg', '#000'), first('--pl-green', '#33e85b')];
  }
  async function edSave(asNew) {
    const u = userOf(ED.base);
    let name = ($e('#skedName').value || '').trim();
    if (asNew && !name) { $e('#skedName').focus(); window.toast('Give the skin a name first.'); return; }
    if (!asNew) { if (!u) return; name = u.name; }
    let slug = !asNew && u ? u.slug : null;
    if (asNew) {
      const same = USER.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (same) {
        if (!await window.confirmBox(`Replace "${same.name}"?`, `You already have a skin called "${same.name}". Saving replaces it.`, 'Replace')) return;
        slug = same.slug;
      }
    }
    const root = u ? (u.base || 'classic') : ED.base, rootName = u ? (u.baseName || nameOf(u.base) || '') : nameOf(ED.base);
    const res = await P.skinSave({ name, from: ED.base, base: root, baseName: rootName, vars: edChanges(), sw: edSwatches(), slug });
    if (!res || res.error) { window.toast(`Couldn’t save the skin${res && res.error ? `: ${res.error}` : '.'}`); return; }
    ED.dirty = false; ED.g = {}; ED.per = {};
    await refresh();
    await apply(res.id, true);            // the new file has the changes: the live layer can go
    edClearLive();
    ED.prev = res.id;
    await edLoadBase(res.id);
    $e('#skedName').value = res.name;
    edRender();
    window.toast(`Saved "${res.name}" in SlopAMP\\skins\\${res.slug}.css`, 3500);
    if (typeof window.skinLibChanged === 'function') window.skinLibChanged();
  }

  WM.skins = {
    list: SKINS, apply, openPicker, refresh, openEditor, closeEditor, nameOf,
    get current() { return current; }, get user() { return USER; }, get editorOpen() { return ED.open; }, get editorShade() { return ED.shade; },
    // 2.4 (Library → SKINS rows): what the editor has open, whether it has unsaved changes, and save / drop them
    get editorBase() { return ED.open ? ED.base : null; }, get editorDirty() { return ED.open && ED.dirty; },
    async saveEditor() {
      if (!ED.open || !ED.dirty) return true;
      await edSave(!userOf(ED.base));     // yours: save in place; a built-in: Save as (needs the name typed in the editor)
      return !ED.dirty;
    },
    discardEditor() { if (!ED.open) return; for (const g of ED_GROUPS) ED.g[g.key] = { h: 0, s: 100, l: 0, add: 0 }; ED.per = {}; ED.dirty = false; edClearLive(); edRender(); },   // like Reset all
    // for the Library: the skin that's on while the editor previews something else
    get saved() { return ED.open && ED.prev ? ED.prev : current; }
  };

  // ---- wiring: picker
  const m = WM.$('#skinMenu');
  m.addEventListener('click', (e) => {
    if (e.target.closest('.sk-x')) { m.classList.add('hidden'); return; }
    if (e.target.closest('.sk-new, .sk-ed')) { m.classList.add('hidden'); openEditor(); return; }
    if (e.target.closest('.sk-lib')) { m.classList.add('hidden'); if (typeof window.openDownloadsManager === 'function') window.openDownloadsManager('skins'); return; }
    const c = e.target.closest('.sk-card');
    if (c && c.dataset.skin !== current) {
      if (ED.open && ED.dirty) { window.toast('The skin editor has unsaved changes: save them or close the editor first.'); return; }
      apply(c.dataset.skin).then(() => { if (ED.open) openEditor(c.dataset.skin); });
    }
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

  // ---- wiring: editor
  const G = $e('#skedGroups');
  G.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('input[type=range]')) {
      const p = ED.g[t.dataset.g]; p[t.dataset.k] = Number(t.value);
      t.nextElementSibling.textContent = `${p[t.dataset.k] > 0 && t.dataset.k !== 's' ? '+' : ''}${p[t.dataset.k]}${t.dataset.k === 'h' ? '°' : '%'}`;
      ED.dirty = true; t.closest('.sked-g').classList.add('on'); edLive();
    } else if (t.matches('.sked-lead')) {
      // pick the family's main colour: work out the shift that turns its current colour into that one
      const g = t.dataset.g, base = parseCol((String(ED.vals.get(t.dataset.lead)).match(COL) || ['#000'])[0]), want = parseCol(t.value);
      const a = toHsl(base), b = toHsl(want);
      const p = ED.g[g];
      p.h = Math.round(((b.h - a.h + 540) % 360) - 180);
      if (a.s >= 0.08) { p.s = Math.round(clamp(b.s / a.s * 100, 0, 200)); p.add = 0; } else { p.s = 100; p.add = b.s - a.s; }
      p.l = Math.round(b.l >= a.l ? (a.l < 1 ? (b.l - a.l) / (1 - a.l) * 100 : 0) : (a.l > 0 ? (b.l / a.l - 1) * 100 : 0));
      for (const r of t.closest('.sked-g').querySelectorAll('input[type=range]')) { r.value = p[r.dataset.k]; r.nextElementSibling.textContent = `${p[r.dataset.k] > 0 && r.dataset.k !== 's' ? '+' : ''}${p[r.dataset.k]}${r.dataset.k === 'h' ? '°' : '%'}`; }
      ED.dirty = true; t.closest('.sked-g').classList.add('on'); edLive();
    } else if (t.matches('.sked-var input[type=color]')) {
      const n = t.dataset.var, old = String(ED.vals.get(n)), c = parseCol(t.value), m0 = old.match(COL);
      const a = m0 ? parseCol(m0[0]).a : 1;
      ED.per[n] = old.replace(COL, () => fmtCol({ ...c, a }, a >= 0.999));
      ED.dirty = true; t.closest('.sked-g').classList.add('on'); edLive();
    }
  });
  G.addEventListener('change', (e) => { if (e.target.matches('.sked-lead, .sked-var input')) { edRender(); } });
  G.addEventListener('toggle', (e) => { const d = e.target.closest && e.target.closest('details'); if (d) ED.openEach = d.open ? d.dataset.g : (ED.openEach === d.dataset.g ? null : ED.openEach); }, true);
  G.addEventListener('click', (e) => {
    const r = e.target.closest('.sked-greset'); if (!r) return;
    ED.g[r.dataset.g] = { h: 0, s: 100, l: 0, add: 0 };
    for (const n of ED.members[r.dataset.g] || []) delete ED.per[n];
    ED.dirty = ED_GROUPS.some(g => !identity(ED.g[g.key])) || Object.keys(ED.per).length > 0;
    edLive(); edRender();
  });
  $e('#skedBase').addEventListener('change', (e) => openEditor(e.target.value));
  $e('#skedReset').onclick = () => { for (const g of ED_GROUPS) ED.g[g.key] = { h: 0, s: 100, l: 0, add: 0 }; ED.per = {}; ED.dirty = false; edClearLive(); edRender(); };
  $e('#skedSave').onclick = () => edSave(false);
  $e('#skedSaveAs').onclick = () => edSave(true);
  $e('#skedName').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') edSave(true); });
  $e('#skedExport').onclick = async () => {
    if (ED.dirty) { window.toast('Save your changes first; Export takes the saved file.'); return; }
    const r = await P.skinExport(ED.base);
    if (r && r.ok) window.toast(`Exported to ${r.file}`, 3500); else if (r && r.error) window.toast(`Couldn’t export: ${r.error}`);
  };
  $e('#skedImport').onclick = async () => {
    const res = await P.skinImport();
    if (!res || !res.length) return;
    await refresh();
    const ok = res.filter(x => x.id), bad = res.filter(x => x.error);
    window.toast(ok.length ? `Imported ${ok.map(x => `"${x.name}"`).join(', ')}${bad.length ? `; ${bad.length > 1 ? `${bad.length} files weren’t skins` : '1 file wasn’t a skin'}` : ''}.` : bad[0].error, 4000);
    if (typeof window.skinLibChanged === 'function') window.skinLibChanged();
  };
  $e('#skedCloseBtn').onclick = () => closeEditor();
  $e('#skedMinBtn').onclick = () => { ED.shade = !ED.shade; if (typeof window.syncWindows === 'function') window.syncWindows(); };

  // the saved skin, before the windows appear (user skins: once main.js has listed them)
  const saved = WM.info && WM.info.skin;
  if (/^user:/.test(saved || '')) refresh().then(() => apply(saved, false)); else { apply(saved, false); refresh(); }
})();
