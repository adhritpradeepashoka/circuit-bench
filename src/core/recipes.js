// "Make a <any part> circuit": the instant, rule-based way into a ready-made circuit. The planner (core/hookup) scans the bench,
// adds the board and the part when they are missing, wires only what is not wired yet, and writes a matching sketch. DOM-free.
import { makeCircuit, codeFor } from './hookup/intent.js';
import { matchLearned, instantiate } from './learned.js';

/** → { actions, code, explanation } | null */
export function recipeEdit(instruction, circuit = { parts: [], wires: [] }, opts = {}) {
  let r = makeCircuit(instruction, circuit, opts) || codeFor(instruction, circuit, opts);
  if (!r && opts.learned?.length) {                // recipes the bigger AI taught us (see core/learned.js)
    const hit = matchLearned(instruction, opts.learned);
    if (hit) {
      r = instantiate(hit, circuit, {});
      if (!r.ok || !r.code) r = null;            // could not build it on this bench: let the AI have the request
      else if (opts.sketchIsCustom) r.explanation += ' The sketch in the editor will be replaced by this one — undo brings it back.';
    }
  }
  return r ? { actions: r.actions, code: r.code, explanation: r.explanation } : null;
}
