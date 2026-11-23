// Split view: instead of every tab replacing the circuit, the circuit can stay on one side while any other tab (Assembly, Test, Train, Run model,
// Visualize, Visualizer) opens beside it — side by side or stacked, with a draggable divider. Each tab is still its own pane; this only decides how
// much of the canvas it takes. Tabs claim the whole canvas by default (CSS), and the `split` body class switches them to a share of it.
// The editor ignores input that starts inside a pane (Editor.otherTab), so the circuit and the pane never hear each other's pointer or keys.
const KEY = 'circuitbench:split';
const PANES = ['robot-asm', 'ml-view', 'viz-view'];
const MODES = [
  ['off', 'Single', 'One tab at a time', '<rect x="3" y="4" width="14" height="12" rx="2"/>'],
  ['side', 'Side by side', 'Keep the circuit on the left and open any other tab on the right', '<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M10 4v12"/>'],
  ['stack', 'Stacked', 'Keep the circuit on top and open any other tab underneath', '<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M3 10h14"/>'],
];
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

export function initSplitView({ editor }) {
  const canvas = document.getElementById('canvas'), toolbar = document.querySelector('.toolbar'), anchor = document.getElementById('selectTool');
  if (!canvas || !toolbar) return null;
  let state = { mode: 'off', ratio: 0.5 };
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && MODES.some(m => m[0] === s.mode)) state = { mode: s.mode, ratio: Math.min(0.8, Math.max(0.2, +s.ratio || 0.5)) }; } catch { /* first time */ }
  const narrow = globalThis.matchMedia?.('(max-width: 860px)');
  const group = el('div', { className: 'split-ctl', role: 'group', ariaLabel: 'Layout' }), buttons = {};
  for (const [id, label, tip, icon] of MODES) {
    const b = el('button', { type: 'button', className: 'tool', id: `splitMode-${id}`, title: `${label}: ${tip}`, ariaLabel: label });
    b.innerHTML = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`;
    b.addEventListener('click', () => set(id)); buttons[id] = b; group.append(b);
  }
  const sep = el('span', { className: 'sep' });
  toolbar.insertBefore(group, anchor); toolbar.insertBefore(sep, anchor);
  const divider = el('div', { className: 'split-divider', role: 'separator', tabIndex: 0, ariaLabel: 'Drag to resize the two sides', title: 'Drag to resize · double-click to centre' });
  divider.hidden = true; canvas.append(divider);

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* not remembered */ } };
  const mode = () => (narrow?.matches ? 'off' : state.mode);
  const paneOpen = () => PANES.some(c => document.body.classList.contains(c));
  let queued = false;
  const relayout = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; window.dispatchEvent(new Event('resize')); }); };    // the panes (3D views, plots) re-measure themselves on resize

  let shown = false;
  function apply() {
    const m = mode(), on = m !== 'off', vertical = m === 'stack';
    document.body.classList.toggle('split', on); document.body.classList.toggle('split-v', vertical);
    canvas.style.setProperty('--circ', String(state.ratio));
    for (const [id, b] of Object.entries(buttons)) { b.classList.toggle('active', id === m); b.setAttribute('aria-pressed', String(id === m)); }
    const has = !!toolbar.querySelector('.view-toggle:not([hidden])'); if (group.hidden === has) group.hidden = sep.hidden = !has;       // only projects with other tabs get the controls
    const showDivider = on && paneOpen(); if (divider.hidden === showDivider) divider.hidden = !showDivider; divider.classList.toggle('v', vertical);
    divider.style[vertical ? 'top' : 'left'] = `${state.ratio * 100}%`; divider.style[vertical ? 'left' : 'top'] = '0';
    relayout();
    const nowShown = on && paneOpen(); if (nowShown !== shown) { shown = nowShown; requestAnimationFrame(() => editor.fit?.()); }       // the circuit moves into its own side (or back to the whole canvas)
  }
  function set(m) {
    state.mode = m; save(); apply(); requestAnimationFrame(() => editor.fit?.());
    if (m !== 'off' && !paneOpen()) editor.status?.('Split view is on: open a tab (Assembly, Test, Train, Visualizer…) and it appears beside the circuit.');
  }

  let drag = null;
  divider.addEventListener('pointerdown', e => { drag = { pid: e.pointerId }; divider.setPointerCapture?.(e.pointerId); divider.classList.add('dragging'); e.preventDefault(); e.stopPropagation(); });
  divider.addEventListener('pointermove', e => {
    if (!drag) return; const r = canvas.getBoundingClientRect(), v = state.mode === 'stack';
    state.ratio = Math.min(0.8, Math.max(0.2, v ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width)); apply();
  });
  const end = () => { if (!drag) return; drag = null; divider.classList.remove('dragging'); save(); editor.fit?.(); };
  divider.addEventListener('pointerup', end); divider.addEventListener('pointercancel', end);
  divider.addEventListener('dblclick', () => { state.ratio = 0.5; save(); apply(); });
  divider.addEventListener('keydown', e => {
    const k = { ArrowLeft: -0.03, ArrowUp: -0.03, ArrowRight: 0.03, ArrowDown: 0.03 }[e.key]; if (k == null) return;
    state.ratio = Math.min(0.8, Math.max(0.2, state.ratio + k)); save(); apply(); e.preventDefault();
  });
  for (const t of ['pointerdown', 'wheel']) divider.addEventListener(t, e => e.stopPropagation(), { passive: true });

  new MutationObserver(() => queueMicrotask(apply)).observe(toolbar, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => apply()).observe(document.body, { attributes: true, attributeFilter: ['class'] });     // a tab opened or closed
  narrow?.addEventListener?.('change', apply);
  apply();
  return { set, get state() { return { ...state, effective: mode() }; } };
}
