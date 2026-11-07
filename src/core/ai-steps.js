// Big requests for a small model: instead of asking it for the whole project in one go (it cannot hold that much), plan the work as a few small steps and do them one
// after another, each step seeing the circuit the earlier steps left. The pieces are small enough for a 1.5B model; together they can build anything the bench can hold.
import { extractJsonText, tryParseJson } from './ai-prompt.js';
import { applyCircuitActions } from './ai-actions.js';

export const MAX_STEPS = 12;

/** Does this request look too big to do in one answer? (long, several asks joined together, or lots of parts.) */
export function looksBig(text) {
  const t = String(text || '').toLowerCase();
  if (t.length > 160) return true;
  const joins = (t.match(/\b(and then|then|after that|also|plus|next|finally)\b|[;,]\s|\band\b/g) || []).length;
  const nums = [...t.matchAll(/\b(\d+)\s*(x\s*)?(leds?|resistors?|buttons?|servos?|motors?|sensors?|switch(?:es)?|displays?|chips?|parts?)\b/g)].reduce((n, m) => n + +m[1], 0);
  return joins >= 3 || nums >= 6 || /\b(whole|entire|full|complete|everything|from scratch|project)\b/.test(t) && joins >= 1;
}

export function buildPlanPrompt({ instruction, circuit }) {
  const have = (circuit?.parts || []).filter(p => p.type !== 'breadboard').map(p => p.type).join(', ') || 'nothing yet';
  return `You plan work for CircuitBench, an electronics bench. A student asked:
"${String(instruction).slice(0, 1500)}"
On the bench now: ${have}.
Split this into the SMALLEST sensible ordered steps (at most ${MAX_STEPS}). One step = one small job: place at most 4 parts, OR wire one group of parts together, OR change the sketch. Put parts before their wires, and the sketch last. Each step must be a complete instruction by itself, naming the parts.
Reply with ONLY this JSON: {"steps": ["step 1 text", "step 2 text"]}`;
}

/** Turn the model's plan into a clean list of step strings (JSON, or numbered lines if it ignored the format). */
export function parsePlan(text) {
  let steps = null;
  try { const o = tryParseJson(extractJsonText(String(text || ''))); if (Array.isArray(o?.steps)) steps = o.steps; else if (Array.isArray(o)) steps = o; } catch { /* fall back to lines */ }
  if (!steps) { const lines = String(text || '').split('\n'), marked = lines.filter(l => /^\s*(?:\d+[.)]|[-*])\s/.test(l)); steps = (marked.length ? marked : lines).map(l => l.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').trim()).filter(l => l.length > 12 || marked.length).slice(0, MAX_STEPS); }
  return [...new Set(steps.map(s => String(s?.text ?? s ?? '').replace(/\s+/g, ' ').trim()).filter(s => s.length > 3))].slice(0, MAX_STEPS);
}

/** What one step is asked, with the big picture and what is already done. */
export const stepInstruction = (instruction, steps, i, doneNotes = []) =>
  `This is part ${i + 1} of ${steps.length} of a bigger request: "${String(instruction).slice(0, 400)}".\n${doneNotes.length ? `Already done on the bench: ${doneNotes.join(' ')}\n` : ''}Do ONLY this part now and nothing else: ${steps[i]}`;

/**
 * Run the steps in order. `step(instruction, circuit, code, i)` asks the AI for one step and returns {ok, actions, code, explanation, error}.
 * Each step's actions are applied to a working copy so the next step sees them. Stops at the first step that fails and keeps what was done.
 * Returns {ok, actions (all, in order), code, explanation, done, failed:{i,error}|null}.
 */
export async function runSteps({ instruction, steps, circuit, code = '', step, onStep }) {
  let cur = { parts: circuit?.parts || [], wires: circuit?.wires || [] }, curCode = code, all = [], notes = [], failed = null, newCode = null, customParts = [];
  for (let i = 0; i < steps.length; i++) {
    onStep?.(i, steps.length, steps[i]);
    let r; try { r = await step(stepInstruction(instruction, steps, i, notes.slice(-6)), cur, curCode, i); } catch (err) { r = { ok: false, error: err?.message || String(err) }; }
    if (!r?.ok) { failed = { i, error: r?.error || 'no answer' }; break; }
    const acts = Array.isArray(r.actions) ? r.actions : [];
    if (acts.length) { const a = applyCircuitActions(cur, acts); cur = { ...cur, parts: a.parts, wires: a.wires }; all.push(...acts); customParts.push(...(a.newSpecs || [])); }
    if (r.code) { curCode = r.code; newCode = r.code; }
    notes.push(`${steps[i].replace(/[.!]+$/, '')} (${acts.length ? `${acts.length} change${acts.length === 1 ? '' : 's'}` : r.code ? 'sketch written' : 'nothing to change'}).`);
  }
  const done = notes.length;
  return { ok: done > 0, actions: all, code: newCode, done, total: steps.length, failed, explanation: `Built in ${done} step${done === 1 ? '' : 's'}${failed ? ` (stopped at step ${failed.i + 1} of ${steps.length}: ${failed.error})` : ''}: ${notes.join(' ')}` };
}
