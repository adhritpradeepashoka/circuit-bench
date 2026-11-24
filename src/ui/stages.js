// The stage bar: the one way to move around. Instead of a tab per module and a choice of layouts, the student sees their goals in order
// (Build → Record → Train → Try it…) and one click puts exactly the views for that goal on screen. The stages come from the project (core/stages.js);
// the layout engine underneath is split-view.js (tiles) and the views are the tab groups registered in view-groups.js.
// "Free layout" gives the old tabs and layout buttons back for people who want to arrange things themselves.
import { resolveStages, matchStage, doneStages } from '../core/stages.js';
import { mixContext } from '../core/mix-context.js';
import { activeWorkspace } from '../core/workspaces.js';
import { getMl, onMl } from '../core/ml-context.js';
import { groups } from './view-groups.js';

const HINTS_KEY = 'circuitbench:stage-hints', FREE_KEY = 'circuitbench:free-layout';
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not remembered */ } };

export function initStages({ editor, split }) {
  const toolbar = document.querySelector('.toolbar'), canvas = document.getElementById('canvas'); if (!toolbar || !canvas || !split) return null;
  const bar = el('nav', { className: 'stage-bar', ariaLabel: 'Steps', hidden: true }), sep = el('span', { className: 'sep stage-sep', hidden: true });
  const free = el('button', { type: 'button', className: 'stage-free', id: 'stageFree', textContent: 'Free layout', title: 'Arrange the views yourself: brings back the tabs and layout buttons', ariaPressed: 'false' });
  const hint = el('aside', { className: 'stage-hint', hidden: true, role: 'status' });
  toolbar.prepend(bar, sep); canvas.append(hint);
  let stages = [], sig = '', shownFor = '', seen = new Set(load(HINTS_KEY) || []), isFree = !!load(FREE_KEY);
  const narrow = globalThis.matchMedia?.('(max-width: 860px)');

  const ctxNow = () => mixContext(editor.state.parts, activeWorkspace());
  const avail = () => ({ ml: !!groups.get('ml')?.available(), robotics: !!groups.get('assembly')?.available(), viz: !!groups.get('viz')?.available() });
  const done = () => { const m = getMl(); return doneStages({ samples: m.dataset?.samples.length || 0, model: !!m.model }); };

  let announced;
  const announce = id => { if (id === announced) return; announced = id; try { dispatchEvent(new CustomEvent('cb-stage', { detail: id })); } catch { /* no window (tests) */ } };       // the views adapt to the step (the person shows only what it needs)
  /** put a stage on screen */
  function activate(stage) {
    const want = stage.panes; announce(isFree ? null : stage.id);
    if (narrow?.matches) {       // a phone-sized screen has room for one view: the stage's main one, or the circuit
      for (const [n, g] of groups) if (g.isOpen() && n !== want[0]?.[0]) g.close();
      if (want[0]) groups.get(want[0][0])?.open(want[0][1]); return paint();
    }
    split.layout({ circ: stage.circ, panes: want.map(p => p[0]), ratio: stage.ratio });
    for (const [n, g] of groups) if (g.isOpen() && !want.some(p => p[0] === n)) g.close();
    for (const [g, v] of want) groups.get(g)?.open(v);
    paint(); showHint(stage);
  }

  /** the first time a stage opens it says what to do there, once */
  function showHint(stage, force = false) {
    if (!force && (seen.has(stage.id) || !stage.hint)) { hint.hidden = true; return; }
    const i = stages.findIndex(x => x.id === stage.id), next = stages[i + 1];
    hint.replaceChildren(el('p', {}, el('b', { textContent: `${stage.label}: ` }), stage.hint));
    const close = el('button', { type: 'button', className: 'stage-hint-x', textContent: 'Got it', ariaLabel: 'Dismiss this tip' });
    close.addEventListener('click', () => { seen.add(stage.id); store(HINTS_KEY, [...seen]); hint.hidden = true; });
    hint.append(close); hint.hidden = false; shownFor = stage.id;
    if (next) { const go = el('button', { type: 'button', className: 'stage-hint-next', textContent: `Next: ${next.label} →` }); go.addEventListener('click', () => { close.click(); activate(next); }); hint.append(go); }
  }

  function paint() {
    const open = split.current(), cur = matchStage(stages, open), d = done(); announce(isFree ? null : cur?.id ?? null);
    bar.hidden = sep.hidden = stages.length < 2;
    document.body.classList.toggle('stages-on', stages.length >= 2); document.body.classList.toggle('free-layout', isFree);
    free.setAttribute('aria-pressed', String(isFree)); free.classList.toggle('on', isFree);
    const key = JSON.stringify([stages.map(s => s.id), cur?.id, [...d], isFree]); if (key === sig) return; sig = key;
    bar.replaceChildren(...stages.map((s, i) => {
      const b = el('button', { type: 'button', className: `stage-btn${s === cur ? ' on' : ''}${d.has(s.id) ? ' done' : ''}`, id: `stage-${s.id}` }, el('i', { textContent: d.has(s.id) ? '✓' : String(i + 1) }), el('span', { textContent: s.label }));
      b.setAttribute('aria-current', s === cur ? 'step' : 'false'); b.title = s.hint; b.addEventListener('click', () => activate(s)); return b;
    }), free);
    if (!cur && !hint.hidden) hint.hidden = true;
  }

  function refresh() {
    const next = resolveStages(ctxNow(), avail()), s = next.map(x => x.id).join();
    if (s !== stages.map(x => x.id).join()) { stages = next; sig = ''; } else stages = next.map((x, i) => x);
    paint();
  }
  addEventListener('cb-goto-stage', e => { const s = stages.find(x => x.id === e.detail); if (s) activate(s); });
  free.addEventListener('click', () => { isFree = !isFree; store(FREE_KEY, isFree); sig = ''; paint(); });
  editor.on('change', refresh); editor.on('workspace', refresh); editor.on('catalog', refresh); onMl(() => paint());
  new MutationObserver(() => paint()).observe(document.body, { attributes: true, attributeFilter: ['class'] });       // a view opened or closed (by a stage, by free layout, by the old tabs)
  // projects open on their first stage (Build) unless something else is already showing
  setTimeout(refresh, 0); refresh();
  return { refresh, activate, get stages() { return stages; }, get current() { return matchStage(stages, split.current()); }, get free() { return isFree; } };
}
