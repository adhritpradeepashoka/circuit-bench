// The right-hand sidebar is a stack of closable panes — the AI chat on top, Parts below. Whatever is
// open shares the column; close one and the other takes the full height; close both and the column
// shrinks to a thin rail whose buttons bring them back. Closed panes are also listed in a small strip
// at the bottom of the column while the other one is open, so nothing is ever lost.
//
// One instance per document (both the parts sidebar and the AI chat ask for it), remembered across
// reloads in localStorage — a per-viewer convenience only, so every read/write is guarded.

const STORE = 'virtual-lab:side-panes';
const PANES = ['ai', 'parts'];
const DEFAULT = { ai: false, parts: true };

let current = null;

export function sidePanes(editor = null) {
  if (current && current.doc === document) { if (editor && !current.editor) current.editor = editor; return current; }
  const $ = id => document.getElementById(id);
  const els = { ai: $('aiPane'), parts: $('partsPanel') };
  const rail = { ai: $('railAi'), parts: $('railParts') };
  const listeners = [];
  let state = { ...DEFAULT };
  try { const saved = JSON.parse(localStorage.getItem(STORE) || 'null'); if (saved && typeof saved === 'object') for (const p of PANES) if (typeof saved[p] === 'boolean') state[p] = saved[p]; } catch { /* storage unavailable */ }

  function paint() {
    const main = $('main');
    for (const p of PANES) { if (els[p]) els[p].hidden = !state[p]; if (rail[p]) rail[p].hidden = state[p]; }
    const none = PANES.every(p => !state[p]);
    main?.classList.toggle('parts-collapsed', none);
    main?.classList.toggle('ai-open', state.ai);
    main?.classList.toggle('panes-both', state.ai && state.parts);
    $('sideRail')?.classList.toggle('strip', !none && PANES.some(p => !state[p]));
    $('aiBtn')?.setAttribute('aria-pressed', String(state.ai));
    $('aiBtn')?.classList.toggle('on', state.ai);
    api.editor?.positionWireEditor?.();
  }
  function set(name, open) {
    if (!PANES.includes(name) || state[name] === open) return;
    state = { ...state, [name]: open };
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* ignore */ }
    paint();
    listeners.forEach(fn => fn(name, open));
  }

  const api = {
    doc: document, editor,
    isOpen: name => !!state[name],
    open: name => set(name, true),
    close: name => set(name, false),
    toggle: name => set(name, !state[name]),
    onChange: fn => listeners.push(fn),
  };
  current = api;
  rail.ai?.addEventListener('click', () => api.open('ai'));
  rail.parts?.addEventListener('click', () => api.open('parts'));
  paint();
  return api;
}
