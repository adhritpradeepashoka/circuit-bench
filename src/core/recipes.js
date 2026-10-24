// "Make a <any part> circuit": the instant, rule-based way into a ready-made circuit. The planner (core/hookup) scans the bench,
// adds the board and the part when they are missing, wires only what is not wired yet, and writes a matching sketch. DOM-free.
import { makeCircuit, codeFor } from './hookup/intent.js';

/** → { actions, code, explanation } | null */
export function recipeEdit(instruction, circuit = { parts: [], wires: [] }, opts = {}) {
  const r = makeCircuit(instruction, circuit, opts) || codeFor(instruction, circuit, opts);
  return r ? { actions: r.actions, code: r.code, explanation: r.explanation } : null;
}
