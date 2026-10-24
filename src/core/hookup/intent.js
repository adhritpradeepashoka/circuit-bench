// "Make an MPU circuit", "hook up a servo and a pot", "I want a basic LED circuit": decide whether a sentence is a request for a
// ready-made circuit, then hand the parts it names to the planner. Returns null for anything else (questions, edits, precise pin
// instructions) so the other assistants get it. Pure and DOM-free.
import { PART_DEFS } from '../parts.js';
import { readParts } from './names.js';
import { plan } from './plan.js';
import { BOARD_SPECS } from '../boards.js';

const CIRCUIT = /\b(circuit|set-?up|project|demo|example|starter|hookup|hook-up|wiring)\b/;
const WIRING = /\b(hook ?up|wire ?up|set ?up|get\b.{0,30}\bworking|try out|play with|test out|experiment with)\b/;
const NOT_A_REQUEST = /\b(why|how|what|which|when|where|who|explain|wrong|broken|not working|doesn'?t|isn'?t|won'?t|error|help me understand|tell me|can you explain|difference|compare|versus|vs|remove|delete|erase|clear|undo|change|replace|rename|move|swap|fix|debug|optimi[sz]e|improve|rewrite|modify|edit|update|increase|decrease|reduce|bigger|smaller|faster|slower)\b|\?\s*$/;
const PRECISE_PIN = /\b(pins?\s*[ad]?\d+|[ad]\d{1,2}\b)(?!\s*(?:ohm|k\b))|\bon (?:the )?(?:left|right|top|bottom)\b/;
const SKETCH_ONLY = /\b(code|sketch|program|script)\b/;

const nameOf = t => (PART_DEFS[t]?.name || t).replace(/\s*\(.*$/, '');
const list = a => (a.length < 3 ? a.join(' or ') : `${a.slice(0, -1).join(', ')} or ${a.at(-1)}`);

/** → null | { actions, code, explanation, notes, checks, ok } — `opts.sketchIsCustom` adds a heads-up that the editor's sketch is replaced */
export function makeCircuit(instruction, circuit = { parts: [], wires: [] }, opts = {}) {
  const t = String(instruction || '').toLowerCase().replace(/[!.]+$/, '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 240) return null;
  if (NOT_A_REQUEST.test(t)) return null;
  const circuitWord = CIRCUIT.test(t), wiringVerb = WIRING.test(t);
  if (!circuitWord && !wiringVerb) return null;
  if (SKETCH_ONLY.test(t) && !circuitWord) return null;
  if (PRECISE_PIN.test(t)) return null;

  const read = readParts(t);
  if (!read.requests.length) {
    if (read.family) {
      const names = read.family.types.map(nameOf);
      return { ok: true, actions: [], code: null, explanation: `Which ${read.family.word}? I can build a circuit for: ${list(names)}. Say its name — for example "make a ${names[0]} circuit".`, notes: [], checks: [] };
    }
    return null;
  }
  const board = circuit.parts?.find(p => BOARD_SPECS[p.type]);
  const res = plan(read.requests, circuit, { board: read.board || undefined });
  if (!res.ok) return { ...res, actions: [], code: null };
  const extra = [];
  if (read.board && board && board.type !== read.board) extra.push(`Your bench already has ${nameOf(board.type)}, so I used it rather than adding ${nameOf(read.board)}.`);
  if (res.code && opts.sketchIsCustom) extra.push('The sketch in the editor will be replaced by this one — undo brings it back.');
  return { ...res, explanation: [res.explanation, ...extra].filter(Boolean).join(' ') };
}
