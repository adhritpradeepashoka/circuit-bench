// plan(requests, circuit, options) → what to do on the bench for "make a <part> circuit":
//   { ok, actions, code, explanation, notes, checks }
// `requests` = [{ type, count?, color?, ohms? }]. Several parts share one board and one sketch.
import { PART_DEFS } from '../parts.js';
import { createPlanner, PlanError } from './engine.js';
import { recipeFor, SOURCE, ACTUATOR, OTHER, ledOnPin } from './recipes.js';
import { BY_TYPE } from './recipes.js';
import { fixArticles } from './helpers.js';
import { calculatorSketch } from './calculator.js';

const MAX_COUNT = 8;
const NO_BOARD = new Set(['battery', 'custom-slime-mold']);

export function plan(requests, circuit = { parts: [], wires: [] }, opts = {}) {
  const reqs = (requests || []).filter(r => r && PART_DEFS[r.type]);
  if (!reqs.length) return { ok: false, actions: [], code: null, explanation: 'Tell me which part the circuit is about — for example "make an MPU-6050 circuit".', notes: [], checks: [] };
  const unknown = reqs.filter(r => !recipeFor(r.type));
  const c = createPlanner(circuit, opts);
  try {
    if (reqs.some(r => !NO_BOARD.has(r.type) && recipeFor(r.type))) c.getBoard(opts.board);       // the board goes down first, so it sits at the left
    const jobs = [];
    reqs.forEach((r, order) => {
      const fn = recipeFor(r.type);
      if (!fn) return;
      const count = Math.max(1, Math.min(MAX_COUNT, r.count || 1));
      for (let n = 0; n < count; n++) jobs.push({ fn, n, count, order, req: r });
    });
    jobs.sort((a, b) => (a.fn.phase ?? OTHER) - (b.fn.phase ?? OTHER) || a.order - b.order || a.n - b.n);
    for (const j of jobs) j.fn(c, { n: j.n, count: j.count, color: j.req.color, ohms: j.req.ohms ?? 220, req: j.req, type: j.req.type });
    // a button / motion sensor with nothing to switch: give it an LED, like the classic circuit
    if (c.signals.bool && !c.signals.consumed) BY_TYPE.led(c, { n: 0, count: 1, color: null, ohms: 220, type: 'led' });
    for (const fn of c.signals.later) fn();
    for (const u of unknown) { const h = c.part(u.type, { fresh: false }); c.say(`${h.isNew ? 'Added a' : 'Found the'} ${PART_DEFS[u.type].name.replace(/\s*\(.*$/, '')}, but I don't have a ready-made circuit for it yet — wire it by hand (right-click a pin to see what it does).`); }
  } catch (e) {
    if (e instanceof PlanError) return { ok: false, actions: [], code: null, explanation: e.message, notes: [], checks: [], code2: e.code };
    throw e;
  }
  const out = c.finish(), s = out.sketch;
  const hasCode = s.setups.length || s.samples.length || s.measures.length || s.ticks.length || s.readouts.length || s.sinks.size;
  const noChange = !out.actions.length;
  const parts = [...out.said];
  for (const n of out.notes) parts.push(n);
  if (noChange && parts.length && !out.mem.informational && !unknown.length) parts.push('Everything was already wired, so the circuit is unchanged.');
  let code = hasCode ? s.render() : null;
  const screen = s.sinks.has('oled') ? 'oled' : s.sinks.has('lcd') ? 'lcd' : null;
  if (opts.calculator && c.signals.keypad && screen) {
    code = calculatorSketch(c.signals.keypad, screen, s.sinks.get(screen), [s.title, ...s.wiring].filter(Boolean).map(x => x.replace(/^Keypad.*$/, 'Calculator: 4×4 keypad in, screen out')));
    for (let i = 0; i < parts.length; i++) parts[i] = parts[i].replace('; the sketch prints each key you press.', '.').replace('; it shows the readings of the other parts (or the uptime, if there are none).', '.');
    parts.push('The sketch is a four-function calculator: A + , B − , C × , D ÷ , # equals, * clear.');
  }
  return { ok: true, actions: out.actions, code, explanation: fixArticles(parts.join(' ')), notes: out.notes, checks: out.checks, noChange, pins: out.dirs, informational: !!out.mem.informational, noBoard: !!out.mem.noBoard };
}
