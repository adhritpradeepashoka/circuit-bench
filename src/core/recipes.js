// "Make a MPU circuit": the instant, rule-based way into a ready-made circuit. It finds which part the request is about; the bench
// language then scans the bench for it, adds it (and a board) when missing, and wires only what is not wired yet. DOM-free.
import { findTypes } from './quick-edits.js';
import { RECIPE_TYPES, runForCircuit } from './bench-lang.js';

const MAKE = /\b(make|build|create|set ?up|wire( ?up)?|hook ?up|give me|i (want|need|would like)|show me|start|get me)\b/;
const CIRCUIT = /\b(circuit|setup|set-up|project|demo|example)\b/;
const ALIAS = { led: 'led', pushbutton: 'button', potentiometer: 'pot' };

/** → { actions, code, explanation } | null */
export function recipeEdit(instruction, circuit = { parts: [], wires: [] }) {
  const t = String(instruction || '').toLowerCase().replace(/[!?.]+$/, '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 160 || !MAKE.test(t) || !CIRCUIT.test(t)) return null;
  if (/\b(why|how|what|explain|wrong|broken|not working)\b/.test(t)) return null;
  const types = findTypes(t).filter(x => RECIPE_TYPES.includes(x) || ALIAS[x]).slice(0, 3);
  if (!types.length) return null;
  const r = runForCircuit(types.map(x => `build ${ALIAS[x] || x} auto`).join('; '), circuit);
  return r?.kind === 'edit' ? { actions: r.actions, code: r.code, explanation: r.explanation } : null;
}
