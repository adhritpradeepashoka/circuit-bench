// Learned recipes: a bigger AI writes a sketch once; if it can be turned into a TEMPLATE and the template survives every check, it is
// saved as a recipe so the instant tier can build the same thing later with no AI at all ("the parent teaches the child").
//
// A learned recipe is DATA, never code:
//   { v:1, id, title, keywords:['calculator'], parts:['keypad-4x4','ssd1306'], template:'…sketch with @@keypad-4x4.R1@@ pin slots…' }
// The existing part recipes do the placing and wiring (so the board and pin choices are always the planner's); the template only says
// what the sketch does with whichever pins the planner picked. A slot `@@<part>.<PIN>@@` means "the board pin joined to that part pin".
// Pure and DOM-free.
import { PART_DEFS } from './parts.js';
import { BOARD_SPECS, mainBoard } from './boards.js';
import { compile } from './netlist.js';
import { applyCircuitActions } from './ai-actions.js';
import { plan } from './hookup/plan.js';
import { recipeFor } from './hookup/recipes.js';
import { findParts, readParts } from './hookup/names.js';
import { NOT_A_REQUEST, PRECISE_PIN } from './hookup/intent.js';

export const MAX_TEMPLATE = 24000;
export const VERIFY_BOARDS = ['arduino-uno', 'arduino-mega'];          // AVR boards compile in a second or two; the ARM boards are left to the planner
const SLOT = /@@([a-z0-9][a-z0-9-]*)\.([A-Za-z0-9_+.-]+)@@/g;
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();

const STOP = new Set(('a an the me my i we you us make build create write give want need please can could would should will lets let set up some simple basic new ' +
  'with and for to of on in that this it its using use from into over via then show shows showing display displays read reads reading ' +
  'circuit project sketch code program arduino board uno nano mega pico one two three four also just really very ' +
  'wire wired wiring hook connect connected add put get do does done is are be been has have had if when while').split(/\s+/));

/** The words that say WHAT is wanted ("calculator"), once the part names, filler and verbs are taken out. */
export function keywordsFrom(request) {
  const { text, hits } = findParts(request);
  let rest = text;
  for (const h of [...hits].reverse()) rest = `${rest.slice(0, h.index)} ${rest.slice(h.end)}`;
  const seen = [];
  for (const w of rest.toLowerCase().split(/[^a-z0-9]+/)) {
    const s = w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
    if (s.length >= 3 && s.length <= 20 && /^[a-z][a-z0-9]*$/.test(s) && !STOP.has(s) && !STOP.has(w) && !seen.includes(s)) seen.push(s);
  }
  return seen.slice(0, 4);
}
const stem = w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

// ── pins ────────────────────────────────────────────────────────────────────────────────────────
/** Which board pin each part pin reaches (straight, or through one series resistor): → { map:{'<type>.<PIN>': '<board pin>'}, dupes:[types present twice] } */
export function pinMapOf(project) {
  const parts = project?.parts || [], map = {}, dupes = new Set();
  const board = mainBoard(parts);
  if (!board) return { map, dupes: [] };
  const wires = (project.wires || []).map(w => (w.a ? w : { ...w, a: w.from, b: w.to })).filter(w => w.a && w.b);
  let net; try { net = compile({ ...project, wires }); } catch { return { map, dupes: [] }; }
  const resistors = net.elements.filter(e => e.kind === 'R' && parts.find(p => p.id === e.partId)?.type === 'resistor');
  const pinsOn = n => net.uno.pins.filter(p => p.net === n);
  const reach = n => {
    if (n === undefined) return null;
    const d = pinsOn(n); if (d.length) return (d.find(p => !/^A\d/.test(p.name)) || d[0]).name;
    for (const r of resistors) for (const [a, b] of [[r.a, r.b], [r.b, r.a]]) if (a === n) { const f = pinsOn(b); if (f.length) return (f.find(p => !/^A\d/.test(p.name)) || f[0]).name; }
    return null;
  };
  const count = new Map();
  for (const p of parts) if (p.type !== board.type && !BOARD_SPECS[p.type] && p.type !== 'resistor' && p.type !== 'breadboard') count.set(p.type, (count.get(p.type) || 0) + 1);
  for (const [t, n] of count) if (n > 1) dupes.add(t);
  for (const p of parts) {
    const def = PART_DEFS[p.type]; if (!def || BOARD_SPECS[p.type] || p.type === 'resistor' || p.type === 'breadboard' || dupes.has(p.type)) continue;
    for (const pin of def.pins) { const name = reach(net.netOf(p.id, pin.id)); if (name) map[`${p.type}.${pin.id}`] = name; }
  }
  return { map, dupes: [...dupes] };
}

export const slotsIn = template => [...String(template).matchAll(SLOT)].map(m => ({ type: m[1], pin: m[2], key: `${m[1]}.${m[2]}` }));
/** Fill every slot; → { ok, code } | { ok:false, missing:[keys] } */
export function fillTemplate(template, map) {
  const missing = [];
  const code = String(template).replace(SLOT, (_, t, p) => { const v = map[`${t}.${p}`]; if (v === undefined) { missing.push(`${t}.${p}`); return ''; } return v; });
  return missing.length ? { ok: false, missing: [...new Set(missing)] } : { ok: true, code };
}

// ── what a recipe may be ───────────────────────────────────────────────────────────────────────────
const idFor = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return `lr-${h.toString(36)}`; };
const INCLUDE = /^\s*#\s*include\s*([<"])\s*([^>"\n]*)[>"]/;

/** Is this sketch template safe to keep and share? Includes must be plain library headers; every slot must name a real pin of a part in the recipe. */
export function validateRecipe(r) {
  const errors = [];
  if (!r || typeof r !== 'object' || r.v !== 1) return { ok: false, errors: ['not a recipe (v1)'] };
  const title = String(r.title || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);
  if (!title) errors.push('no title');
  const keywords = (Array.isArray(r.keywords) ? r.keywords : []).map(k => String(k).toLowerCase()).filter((k, i, a) => /^[a-z][a-z0-9]{2,19}$/.test(k) && a.indexOf(k) === i);
  if (!keywords.length || keywords.length > 4) errors.push('1 to 4 keywords of plain letters are needed');
  const parts = Array.isArray(r.parts) ? [...new Set(r.parts.map(String))] : [];
  if (!parts.length || parts.length > 6) errors.push('1 to 6 parts are needed');
  for (const t of parts) if (!PART_DEFS[t] || BOARD_SPECS[t] || t === 'resistor' || !recipeFor(t)) errors.push(`"${t}" is not a part the planner can wire`);
  const template = String(r.template || '');
  if (!template || template.length > MAX_TEMPLATE) errors.push('the sketch is empty or too long');
  if (/@@/.test(template.replace(SLOT, ''))) errors.push('a stray @@ in the sketch');
  for (const line of template.split('\n')) {
    if (/^\s*#\s*include/.test(line)) {
      const m = INCLUDE.exec(line);
      if (!m || m[1] !== '<' || !/^[\w\/.+-]+$/.test(m[2]) || m[2].includes('..')) errors.push(`only library includes like #include <Wire.h> are allowed (${line.trim().slice(0, 40)})`);
    }
    if (/^\s*#\s*(pragma|define\s+\w+\s*\(.*\bsystem\b)/.test(line) || /\b(__asm__|asm\s+volatile)\b/.test(line)) errors.push(`not allowed in a shared sketch: ${line.trim().slice(0, 40)}`);
  }
  // a slot only ever stands for a PIN: a number that merely equals a pin (delay(8) beside pin 8) must not have been turned into one
  for (const line of template.split('\n')) {
    for (const m of line.matchAll(/@@[^@]+@@/g)) {
      if (/\b(?:delay|delayMicroseconds|setTextSize|setCursor|constrain|map|random|\w+\.begin)\s*\([^()]*$/.test(line.slice(0, m.index))) errors.push(`${m[0]} is used as a plain number, not a pin: ${line.trim().slice(0, 50)}`);
    }
  }
  for (const s of slotsIn(template)) if (!parts.includes(s.type) || !PART_DEFS[s.type]?.pinById?.has(s.pin)) errors.push(`pin slot @@${s.key}@@ does not match the recipe's parts`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], recipe: { v: 1, id: r.id && /^lr-[a-z0-9]{3,16}$/.test(r.id) ? r.id : idFor(`${keywords.join(' ')}|${parts.join(',')}|${template}`), title, keywords, parts, template } };
}

// ── using one ──────────────────────────────────────────────────────────────────────────────────────
const REQUEST_LIMIT = 240;
/** The learned recipe a request asks for, if any: every keyword present, and no part named that the recipe does not use. */
export function matchLearned(instruction, recipes) {
  const t = String(instruction || '').toLowerCase().replace(/[!.]+$/, '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > REQUEST_LIMIT || NOT_A_REQUEST.test(t) || PRECISE_PIN.test(t) || !recipes?.length) return null;
  const words = new Set(t.split(/[^a-z0-9]+/).map(stem));
  const named = readParts(t).requests.map(r => r.type);
  let best = null;
  for (const r of recipes) {
    if (!r.keywords.every(k => words.has(stem(k)))) continue;
    if (named.some(n => !r.parts.includes(n))) continue;            // "…with an LCD" when the recipe uses an OLED: leave it to the AI
    if (!best || r.keywords.length > best.keywords.length) best = r;
  }
  return best;
}

/** Build a recipe on this bench: the planner places and wires the parts, then the slots get the pins it chose.
 *  → { ok, actions, code, explanation, notes, checks } | { ok:false, explanation } */
export function instantiate(recipe, circuit = { parts: [], wires: [] }, opts = {}) {
  const res = plan(recipe.parts.map(type => ({ type })), circuit, { board: opts.board });
  if (!res.ok) return { ...res, actions: [], code: null };
  const after = applyCircuitActions(circuit, res.actions);
  const { map, dupes } = pinMapOf({ parts: after.parts, wires: after.wires });
  const bad = dupes.filter(t => recipe.parts.includes(t));
  if (bad.length) return { ok: false, actions: [], code: null, explanation: `There is more than one ${PART_DEFS[bad[0]].name} on the bench, so I can't tell which one the sketch should use. Remove the extra one and ask again.`, notes: [], checks: [] };
  const filled = fillTemplate(recipe.template, map);
  if (!filled.ok) return { ok: false, actions: [], code: null, explanation: `I could not wire everything that "${recipe.title}" needs (${filled.missing.join(', ')}), so I did not change anything.`, notes: [], checks: [] };
  return { ...res, code: filled.code, explanation: `${res.explanation} I wrote the sketch from a recipe the AI taught me earlier: ${recipe.title}.`.replace(/\s+/g, ' ').trim() };
}

// ── learning one ───────────────────────────────────────────────────────────────────────────────────
/** What to ask the AI: turn the sketch it wrote into a template, changing nothing but the pin numbers. */
export function templatizeInstruction(map, code) {
  const rows = Object.entries(map).map(([k, v]) => `  @@${k}@@ = ${v}`).join('\n');
  return [
    'Rewrite the sketch below as a TEMPLATE. Do not change what it does: copy it exactly, character for character, except that every place',
    'where it uses one of these board pins (as a number or as A0-style text) must instead say the slot that stands for that pin:',
    rows, '',
    'Use the slot text exactly as written (including the two @@ on each side). Only replace a number when it really is that pin — a delay of 8 ms, an',
    'I2C address or a baud rate stay as they are. If a pin is used in an array or a #define, put the slot there. Return the complete template as the sketch.',
  ].join('\n');
}

const mkProject = (parts, wires) => ({ format: 'virtual-lab', version: 1, parts, wires });
/** Can this finished AI answer be kept as a recipe? Checks everything that does not need the compiler.
 *  → { ok, reason } | { ok, recipe, instances:[{ board, code }] } — compile each instance before keeping the recipe. */
export function eligibleForLearning({ request, project }) {
  const fail = reason => ({ ok: false, reason });
  const parts = (project?.parts || []);
  const board = mainBoard(parts);
  if (!board) return fail('no board');
  const types = [...new Set(parts.filter(p => !BOARD_SPECS[p.type] && p.type !== 'resistor' && p.type !== 'breadboard').map(p => p.type))];
  if (!types.length) return fail('no parts');
  const unsupported = types.filter(t => !recipeFor(t));
  if (unsupported.length) return fail(`the planner cannot wire ${unsupported.join(', ')}`);
  const { map, dupes } = pinMapOf(project);
  if (dupes.length) return fail(`${dupes.join(', ')} appears twice`);
  if (!Object.keys(map).length) return fail('nothing is wired to the board');
  const keywords = keywordsFrom(request);
  if (!keywords.length) return fail('the request names nothing but parts');
  return { ok: true, types, map, keywords };
}

/** The whole offline check of a template the AI returned (everything except compiling). */
export function prepareLearning({ request, project, code, template, title }) {
  const fail = reason => ({ ok: false, reason });
  const el = eligibleForLearning({ request, project });
  if (!el.ok) return el;
  const { types, map, keywords } = el;
  const v = validateRecipe({ v: 1, title: title || request.slice(0, 60), keywords, parts: types, template });
  if (!v.ok) return fail(v.errors[0]);
  const slots = slotsIn(template);
  if (!slots.length) return fail('the template uses no pin slots');
  // round trip: filling the slots with the AI's OWN wiring must give back the AI's own sketch, so nothing else was changed
  const back = fillTemplate(template, map);
  if (!back.ok) return fail(`the template uses ${back.missing[0]}, which is not wired in this circuit`);
  if (norm(back.code) !== norm(code)) return fail('the template is not the same sketch with only the pins replaced');
  // every pin the sketch used must now be a slot, or the recipe would only work on this wiring
  const used = new Set(Object.values(map));
  const bare = template.replace(SLOT, '§');
  for (const m of bare.matchAll(/\b(?:pinMode|digitalWrite|digitalRead|analogRead|analogWrite|tone|noTone|pulseIn|attachInterrupt)\s*\(\s*(A?\d+)\b/g)) if (used.has(m[1])) return fail(`pin ${m[1]} is still hard-coded`);
  for (const m of bare.matchAll(/(?:^|\n)\s*(?:#define\s+\w+\s+|(?:const\s+)?(?:u?int\d*_t|int|byte|short|long)\s+\w+\s*(?:\[[^\]]*\])?\s*=\s*)([^;\n]*)/g)) {
    for (const n of m[1].match(/\bA?\d+\b/g) || []) if (used.has(n)) return fail(`pin ${n} is still hard-coded (${m[0].trim().slice(0, 40)})`);
  }
  // the planner must build the same set of parts on each verification board
  const instances = [];
  for (const b of VERIFY_BOARDS) {
    const r = instantiate(v.recipe, mkProject([], []), { board: b });
    if (!r.ok || !r.code) return fail(`the planner could not build it on ${BOARD_SPECS[b].name}: ${r.explanation || ''}`.trim());
    instances.push({ board: b, fqbn: BOARD_SPECS[b].fqbn, code: r.code });
  }
  return { ok: true, recipe: v.recipe, instances };
}
