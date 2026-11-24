// Layouts: instead of every tab replacing the circuit, tabs can share the screen like windows.
//   Single       one tab at a time (the default)
//   Side by side the circuit on the left, ONE other tab (Assembly, Train…, Visualizer, Person) on the right
//   Stacked      the same, one above the other
//   Tiles        any number of them at once: Circuit + Person + Visualizer + AI + Assembly, each in its own tile, with draggable dividers
// Each tab is still its own pane; this only decides how much of the canvas it takes. Tabs claim the whole canvas by default (CSS), the `split` body class
// switches them to a share of it, and in tile mode each pane gets its own rectangle. The editor ignores input that starts inside a pane
// (Editor.otherTab), so the circuit and a pane never hear each other's pointer or keys.
import { groups } from './view-groups.js';

const KEY = 'circuitbench:split';
const PANES = ['robot-asm', 'ml-view', 'viz-view', 'body-view'];
const ORDER = ['assembly', 'ml', 'viz', 'body'];       // where each tab group sits in the tiles, after the circuit
const SELECTOR = { assembly: '.asm-pane', ml: '.ml-pane', viz: '.viz-pane', body: '.body-dock' };
const MODES = [
  ['off', 'Single', 'One tab at a time', '<rect x="3" y="4" width="14" height="12" rx="2"/>'],
  ['side', 'Side by side', 'Keep the circuit on the left and open any other tab on the right', '<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M10 4v12"/>'],
  ['stack', 'Stacked', 'Keep the circuit on top and open any other tab underneath', '<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M3 10h14"/>'],
  ['tile', 'Tiles', 'Any tabs at once: the circuit, the person, the visualizer, the AI… each in its own tile', '<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M10 4v12M10 10h7"/>'],
];
const clamp = v => Math.min(0.8, Math.max(0.2, v));
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

/** The rectangle of every tile, as fractions of the canvas. The first tile is the big one on the left; `c` is its width share, `r` the row split on the right. */
export function tileRects(tiles, c = 0.5, r = 0.5) {
  const n = tiles.length, out = {}, put = (i, x, y, w, h) => { if (tiles[i] != null) out[tiles[i]] = { x, y, w, h }; };
  if (n === 1) put(0, 0, 0, 1, 1);
  else if (n === 2) { put(0, 0, 0, c, 1); put(1, c, 0, 1 - c, 1); }
  else if (n === 3) { put(0, 0, 0, c, 1); put(1, c, 0, 1 - c, r); put(2, c, r, 1 - c, 1 - r); }
  else if (n === 4) { put(0, 0, 0, c, r); put(1, c, 0, 1 - c, r); put(2, 0, r, c, 1 - r); put(3, c, r, 1 - c, 1 - r); }
  else { const cols = 3, rows = Math.ceil(n / cols); tiles.forEach((_, i) => put(i, (i % cols) / cols, Math.floor(i / cols) / rows, 1 / cols, 1 / rows)); }
  return out;
}
const inset = q => `${q.y * 100}% ${(1 - q.x - q.w) * 100}% ${(1 - q.y - q.h) * 100}% ${q.x * 100}%`;

export function initSplitView({ editor }) {
  const canvas = document.getElementById('canvas'), toolbar = document.querySelector('.toolbar'), anchor = document.getElementById('selectTool');
  if (!canvas || !toolbar) return null;
  const overlay = document.getElementById('overlay');
  let state = { mode: 'off', ratio: 0.5, rr: 0.5, circ: true }, order = null;       // `order`: which pane goes where when a stage asks for a layout
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && MODES.some(m => m[0] === s.mode)) state = { mode: s.mode, ratio: clamp(+s.ratio || 0.5), rr: clamp(+s.rr || 0.5), circ: s.circ !== false }; } catch { /* first time */ }
  const narrow = globalThis.matchMedia?.('(max-width: 860px)');
  const group = el('div', { className: 'split-ctl', role: 'group', ariaLabel: 'Layout' }), buttons = {};
  for (const [id, label, tip, icon] of MODES) {
    const b = el('button', { type: 'button', className: 'tool', id: `splitMode-${id}`, title: `${label}: ${tip}`, ariaLabel: label });
    b.innerHTML = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`;
    b.addEventListener('click', () => set(id)); buttons[id] = b; group.append(b);
  }
  const tray = el('div', { className: 'tile-tray', role: 'group', ariaLabel: 'Which tabs are on screen', hidden: true }), sep = el('span', { className: 'sep' });
  toolbar.insertBefore(group, anchor); toolbar.insertBefore(tray, anchor); toolbar.insertBefore(sep, anchor);
  const mkDivider = (label, v) => { const d = el('div', { className: `split-divider${v ? ' v' : ''}`, role: 'separator', tabIndex: 0, ariaLabel: label, title: 'Drag to resize · double-click to centre' }); d.hidden = true; canvas.append(d); return d; };
  const divider = mkDivider('Drag to resize the two sides'), rowDiv = mkDivider('Drag to resize the tiles above and below', true);

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* not remembered */ } };
  const mode = () => (narrow?.matches ? 'off' : state.mode);
  const paneOpen = () => PANES.some(c => document.body.classList.contains(c));
  const openNames = () => { const o = ORDER.filter(n => groups.get(n)?.isOpen()); return order ? [...order.filter(n => o.includes(n)), ...o.filter(n => !order.includes(n))] : o; };
  let queued = false;
  const relayout = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; window.dispatchEvent(new Event('resize')); }); };    // the panes (3D views, plots) re-measure themselves on resize

  let fitSig = '', wasTile = false, traySig = '', dragging = false;
  function paintTray(tile, names, circ) {
    const avail = ORDER.filter(n => groups.get(n)?.available()), sig = `${tile}|${circ}|${avail.map(n => n + (names.includes(n) ? '+' : '-')).join()}|${names.length}`;
    if (sig === traySig) return; traySig = sig; tray.replaceChildren();
    if (!tile) return;
    const chip = (label, on, fn, title) => { const b = el('button', { type: 'button', className: `tile-chip${on ? ' on' : ''}`, textContent: label, title }); b.setAttribute('aria-pressed', String(on)); b.addEventListener('click', fn); tray.append(b); };
    chip('Circuit', circ, () => { if (!names.length) return; state.circ = !state.circ; save(); apply(); }, circ ? 'Hide the circuit tile' : 'Show the circuit tile');
    for (const n of avail) {
      const g = groups.get(n), on = names.includes(n);
      chip(g.label, on, () => { if (on) { if (names.length === 1) { state.circ = true; save(); } g.close(); } else g.open(); }, on ? `Close the ${g.label} tile` : `Open ${g.label} in its own tile`);
    }
  }
  function apply() {
    const m = mode(), tile = m === 'tile', on = m !== 'off', vertical = m === 'stack', cls = document.body.classList;
    const names = openNames(), circ = !tile || state.circ || names.length === 0;
    cls.toggle('tile', tile); cls.toggle('split', on && circ); cls.toggle('split-v', vertical);       // with the circuit tile hidden it is a plain tab view: no `split`
    if (wasTile && !tile && names.length > 1) groups.get(names[0]).open();      // leaving tiles: only one tab can stay open (opening it sends the others back to the circuit)
    wasTile = tile;
    const tiles = [...(circ ? ['circ'] : []), ...names], rects = tile ? tileRects(tiles, state.ratio, state.rr) : {}, cr = rects.circ;
    for (const n of ORDER) for (const e of canvas.querySelectorAll(SELECTOR[n])) e.style.inset = rects[n] ? inset(rects[n]) : '';
    if (overlay) overlay.style.clipPath = cr ? `inset(${inset(cr)})` : '';       // the circuit's wires are drawn above the panes: cut them to the circuit's tile
    const cs = canvas.style; cs.setProperty('--circ', String(state.ratio));
    const fw = cr ? cr.w : m === 'side' ? state.ratio : 1, fh = cr ? cr.h : vertical ? state.ratio : 1; cs.setProperty('--cfw', String(fw)); cs.setProperty('--cfh', String(fh));       // the circuit's share of the canvas, for fitting it
    for (const [id, b] of Object.entries(buttons)) { b.classList.toggle('active', id === m); b.setAttribute('aria-pressed', String(id === m)); }
    const has = !!toolbar.querySelector('.view-toggle:not([hidden])'); if (group.hidden === has) group.hidden = sep.hidden = !has;       // only projects with other tabs get the controls
    if (tray.hidden === (tile && has)) tray.hidden = !(tile && has); paintTray(tile, names, circ);
    const count = tiles.length, showMain = on && paneOpen() && (!tile || (count >= 2 && count <= 4)), showRow = tile && count >= 3 && count <= 4;
    if (divider.hidden === showMain) divider.hidden = !showMain; divider.classList.toggle('v', vertical);
    divider.style[vertical ? 'top' : 'left'] = `${state.ratio * 100}%`; divider.style[vertical ? 'left' : 'top'] = '0';
    if (rowDiv.hidden === showRow) rowDiv.hidden = !showRow; rowDiv.style.top = `${state.rr * 100}%`; rowDiv.style.left = count === 3 ? `${state.ratio * 100}%` : '0';
    relayout();
    const sig = JSON.stringify([on, vertical, circ, tile && names, on && paneOpen()]); if (sig !== fitSig) { fitSig = sig; requestAnimationFrame(() => editor.fit?.()); }       // the circuit moves into its own tile (or back to the whole canvas)
  }
  function set(m) {
    state.mode = m; save(); apply(); requestAnimationFrame(() => editor.fit?.());
    if (m === 'tile' && !paneOpen()) editor.status?.('Tiles: use the buttons next to the layout icons to put the person, visualizer, AI… on screen together with the circuit.');
    else if (m !== 'off' && m !== 'tile' && !paneOpen()) editor.status?.('Split view is on: open a tab (Assembly, Test, Train, Visualizer…) and it appears beside the circuit.');
  }

  // dividers: the main one sets the width (or height, stacked) of the circuit's side; the row one splits the right-hand tiles
  const wire = (d, axis, key, step) => {
    let drag = null;
    d.addEventListener('pointerdown', e => { drag = { pid: e.pointerId }; dragging = true; d.setPointerCapture?.(e.pointerId); d.classList.add('dragging'); e.preventDefault(); e.stopPropagation(); });
    d.addEventListener('pointermove', e => {
      if (!drag) return; const r = canvas.getBoundingClientRect(), y = axis() === 'y';
      state[key] = clamp(y ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width); apply();
    });
    const end = () => { if (!drag) return; drag = null; dragging = false; d.classList.remove('dragging'); save(); editor.fit?.(); };
    d.addEventListener('pointerup', end); d.addEventListener('pointercancel', end);
    d.addEventListener('dblclick', () => { state[key] = 0.5; save(); apply(); editor.fit?.(); });
    d.addEventListener('keydown', e => {
      const k = step[e.key]; if (k == null) return;
      state[key] = clamp(state[key] + k); save(); apply(); editor.fit?.(); e.preventDefault();
    });
    for (const t of ['pointerdown', 'wheel']) d.addEventListener(t, e => e.stopPropagation(), { passive: true });
  };
  wire(divider, () => (mode() === 'stack' ? 'y' : 'x'), 'ratio', { ArrowLeft: -0.03, ArrowUp: -0.03, ArrowRight: 0.03, ArrowDown: 0.03 });
  wire(rowDiv, () => 'y', 'rr', { ArrowUp: -0.03, ArrowDown: 0.03 });

  new MutationObserver(() => queueMicrotask(apply)).observe(toolbar, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => apply()).observe(document.body, { attributes: true, attributeFilter: ['class'] });     // a tab opened or closed
  narrow?.addEventListener?.('change', apply);
  apply();
  /** A stage asks for a layout: tiles, with the circuit on or off, the panes in this order, and the circuit's share of the width. */
  function layout({ circ = true, panes = [], ratio } = {}) {
    state.mode = 'tile'; state.circ = circ; order = panes.slice(); if (ratio) state.ratio = clamp(ratio); save(); apply(); requestAnimationFrame(() => editor.fit?.());
  }
  /** What is on screen: whether the circuit is, and each open group's current view. */
  function current() {
    const names = openNames(), panes = {}; for (const n of names) panes[n] = groups.get(n).view();
    const m = mode(); return { circ: !names.length || (m === 'tile' ? state.circ : m !== 'off'), panes };
  }
  return { set, layout, current, get state() { return { ...state, effective: mode() }; } };
}
