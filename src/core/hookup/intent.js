// "Make an MPU circuit", "hook up a servo and a pot", "I want a basic LED circuit": decide whether a sentence is a request for a
// ready-made circuit, then hand the parts it names to the planner. Returns null for anything else (questions, edits, precise pin
// instructions) so the other assistants get it. Pure and DOM-free.
import { PART_DEFS } from '../parts.js';
import { readParts, findParts } from './names.js';
import { plan } from './plan.js';
import { recipeFor } from './recipes.js';
import { BOARD_SPECS } from '../boards.js';

const CIRCUIT = /\b(circuit|set-?up|project|demo|example|starter|hookup|hook-up|wiring)\b/;
const WIRING = /\b(hook ?up|wire ?up|set ?up|get\b.{0,30}\bworking|try out|play with|test out|experiment with)\b/;
export const NOT_A_REQUEST = /\b(why|how|what|which|when|where|who|explain|wrong|broken|not working|doesn'?t|isn'?t|won'?t|error|help me understand|tell me|can you explain|difference|compare|versus|vs|remove|delete|erase|clear|undo|change|replace|rename|move|swap|fix|debug|optimi[sz]e|improve|rewrite|modify|edit|update|increase|decrease|reduce|bigger|smaller|faster|slower)\b|\?\s*$/;
export const PRECISE_PIN = /\b(pins?\s*[ad]?\d+|[ad]\d{1,2}\b)(?!\s*(?:ohm|k\b))|\bon (?:the )?(?:left|right|top|bottom)\b/;
// Plain-language asks that name a PROJECT or a BEHAVIOUR rather than saying "circuit": "a button that turns on an led and sounds a buzzer",
// "use a pot to control the brightness of an led", "a motion alarm", "a doorbell". The planner already wires sources to actuators and writes the
// sketch; all that was missing was recognising these as asks for it. A project word brings the parts it implies.
const INTENT = /\b(i (?:want|need|would like)|build|make|create|design|control(?:s|led|ling)?|driven|triggered|turns? on|switch(?:es)? on|sounds?|beeps?|buzz(?:es)?|shows?|displays?|follows?|reads?|lights? up|dims?|connect(?:s|ed)?|hook(?:s|ed)?|wire[sd]?|attach(?:es|ed)?|use (?:a|an|the) [^,]{1,30} to|while)\b/;
const PROJECTS = [
  [/\b(?:motion|intruder|burglar|security|pir) alarm\b|\balarm\b/, ['pir-sensor', 'buzzer', 'led']],
  [/\bdoorbell\b/, ['pushbutton', 'buzzer']],
  [/\bnight ?light\b|\bauto(?:matic)? (?:night )?light\b/, ['ldr-module', 'led']],
  [/\bdimmer\b|\bdimmable\b/, ['potentiometer', 'led']],
  [/\btraffic ?lights?\b/, [{ type: 'led', count: 3 }]],
];
// what a sentence says about the WORLD stands for the sensor that would notice it ("when it is dark" → a light sensor); added only if no such sensor was named
const SENSES = [
  [/\b(dark|darkness|night ?time|gets dark|light level|ambient light|daylight)\b/, 'ldr-module', ['ldr-module']],
  [/\b(motion|movement|someone (?:walks|moves|enters)|intruders?|person (?:is )?(?:near|there))\b/, 'pir-sensor', ['pir-sensor']],
  [/\b(temperature|too hot|gets hot|overheat\w*|too warm)\b/, 'ntc-sensor', ['ntc-sensor', 'dht']],
  [/\b(distance|obstacles?|something (?:is )?(?:close|near)|how far)\b/, 'hc-sr04', ['hc-sr04']],
];
const SETTING_A_VALUE = /^(?:please )?(?:set|make|turn|change)\s+the\b.*\b(?:red|green|blue|yellow|orange|white|\d+(?:\.\d+)?\s*(?:k|m|ohm|ω|v|ms|s|%))/;
const CALCULATOR = /\bcalculators?\b/;
const SKETCH_ONLY = /\b(code|sketch|program|script)\b/;

/** True when the sentence is only part names, counts and joining words ("a pot, a servo and a button", "three leds and a button"). */
function onlyParts(t) {
  const { text, hits } = findParts(t);
  if (hits.length < 2) return false;
  let rest = text; for (const h of [...hits].sort((a, b) => b.index - a.index)) rest = rest.slice(0, h.index) + ' ' + rest.slice(h.end);
  return rest.replace(/\b(a|an|the|and|with|plus|some|one|two|three|four|five|six|\d+)\b|[,&+]/g, ' ').trim() === '';
}
const nameOf = t => (PART_DEFS[t]?.name || t).replace(/\s*\(.*$/, '');
const list = a => (a.length < 3 ? a.join(' or ') : `${a.slice(0, -1).join(', ')} or ${a.at(-1)}`);

/** → null | { actions, code, explanation, notes, checks, ok } — `opts.sketchIsCustom` adds a heads-up that the editor's sketch is replaced */
export function makeCircuit(instruction, circuit = { parts: [], wires: [] }, opts = {}) {
  let t = String(instruction || '').toLowerCase().replace(/[!.]+$/, '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 240) return null;
  if (!/\b(why|how|what|which|where|who)\b|\?\s*$/.test(t)) t = t.replace(/\bwhen(?:ever)?\b/g, 'while');          // "when the button is pressed…" is a behaviour, not a question
  t = t.replace(/\bmoves?\b(?= (?:with|using|along with|according to)\b)/g, 'follow');          // "make a servo move with a pot"
  if (NOT_A_REQUEST.test(t)) return null;
  const calc = CALCULATOR.test(t);
  let circuitWord = CIRCUIT.test(t) || calc, wiringVerb = WIRING.test(t);
  const project = PROJECTS.find(([re]) => re.test(t));
  let loose = false;
  const bare = !circuitWord && !wiringVerb && !INTENT.test(t) && !project && onlyParts(t);          // "a pot, a servo and a button": nothing but parts
  if (!circuitWord && !wiringVerb) {
    if (!(INTENT.test(t) || project || bare) || SETTING_A_VALUE.test(t)) return null;
    loose = true;                         // decided below, once the parts are known: two or more different parts (or a project word)
  }
  if (SKETCH_ONLY.test(t) && !circuitWord && !loose) return null;
  if (PRECISE_PIN.test(t)) return null;

  const read = readParts(project ? t.replace(project[0], ' ') : t);          // the project word ("alarm") is not also a part (a buzzer)
  if (read.requests.some(q => q.type === 'dht') && read.requests.some(q => q.type === 'ntc-sensor')) read.requests = read.requests.filter(q => q.type !== 'ntc-sensor');          // "a thermometer with a DHT" is one sensor
  if (project) for (const need of project[1]) { const r = typeof need === 'string' ? { type: need, count: 1 } : need; if (!read.requests.some(q => q.type === r.type)) read.requests.push(r); }
  if (loose) for (const [re, type, alts] of SENSES) if (re.test(t) && !read.requests.some(q => alts.includes(q.type))) read.requests.push({ type, count: 1 });
  if (loose && read.requests.length < 2 && !project) return null;
  if (calc) {          // a calculator is a keypad plus a screen: add whichever of the two the sentence did not name
    const has = type => read.requests.some(r => r.type === type);
    if (!has('keypad-4x4')) read.requests.push({ type: 'keypad-4x4', count: 1 });
    if (!has('ssd1306') && !has('lcd1602')) read.requests.push({ type: 'ssd1306', count: 1 });
    read.requests = read.requests.filter(r => r.type === 'keypad-4x4' || r.type === 'ssd1306' || r.type === 'lcd1602');
  }
  if (!read.requests.length) {
    if (read.family) {
      const names = read.family.types.map(nameOf);
      return { ok: true, actions: [], code: null, explanation: `Which ${read.family.word}? I can build a circuit for: ${list(names)}. Say its name — for example "make a ${names[0]} circuit".`, notes: [], checks: [] };
    }
    return null;
  }
  const board = circuit.parts?.find(p => BOARD_SPECS[p.type]);
  const res = plan(read.requests, circuit, { board: read.board || undefined, calculator: calc });
  if (!res.ok) return { ...res, actions: [], code: null };
  const extra = [];
  if (read.board && board && board.type !== read.board) extra.push(`Your bench already has ${nameOf(board.type)}, so I used it rather than adding ${nameOf(read.board)}.`);
  if (res.code && opts.sketchIsCustom) extra.push('The sketch in the editor will be replaced by this one — undo brings it back.');
  return { ...res, explanation: [res.explanation, ...extra].filter(Boolean).join(' ') };
}

// "Write the code for my MPU and OLED", "give me a sketch for this circuit": the planner already knows how to drive every part it can
// wire, so a request for code is answered by the same planner — it finds what is already wired on the bench, adds only what is
// missing, and writes the sketch. No AI model is involved, so it is exact on every device (the small on-device models are not).
const CODE_WORD = /\b(code|sketch|program|script|firmware)\b/;
const CODE_ASK = /\b(write|make|give|generate|create|need|want|get|build|show|do|add|produce)\b|\bcode (?:for|to)\b|\bsketch (?:for|to)\b|^(?:code|sketch|program)\b/;
// Anything about HOW it should behave (timing, conditions, effects) is beyond a stock sketch: leave it to a real AI.
const CUSTOM_BEHAVIOUR = /\d|\b(every|when|whenever|if|while|until|then|after|before|once|twice|only|unless|slowly|quickly|fast|slow|blink\w*|fade|fading|toggle|flash\w*|pulse|sweep|beep\w*|alarm|threshold|compare|calculate|average|log|record|count\w*|sequence|pattern|animation|menu|game|morse|temperature in|convert)\b/;
const THIS_CIRCUIT = /\b(my|this|the|current|whole|entire|existing)\s+(circuit|bench|setup|set-up|project|parts|board|wiring)\b|\beverything\b|\bit all\b|\bthese\b/;

/** → null | { ok, actions, code, explanation, notes, checks } — only for plain "write me the code" asks the planner can answer exactly */
export function codeFor(instruction, circuit = { parts: [], wires: [] }, opts = {}) {
  const t = String(instruction || '').toLowerCase().replace(/[!.]+$/, '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 240 || !CODE_WORD.test(t) || !CODE_ASK.test(t)) return null;
  if (NOT_A_REQUEST.test(t) || PRECISE_PIN.test(t) || CUSTOM_BEHAVIOUR.test(t)) return null;
  const named = readParts(t);
  let requests = named.requests;
  if (!requests.length) {
    if (!THIS_CIRCUIT.test(t) && !/\b(for|of)\b/.test(t)) return null;
    const seen = new Map();
    for (const p of circuit.parts || []) if (!BOARD_SPECS[p.type] && PART_DEFS[p.type] && recipeFor(p.type)) seen.set(p.type, (seen.get(p.type) || 0) + 1);
    requests = [...seen].map(([type, count]) => ({ type, count }));
    if (!requests.length) return null;
  }
  const res = plan(requests, circuit, { board: named.board || undefined });
  if (!res.ok || !res.code) return null;
  const extra = [];
  if (opts.sketchIsCustom) extra.push('The sketch in the editor will be replaced by this one — undo brings it back.');
  const lead = res.noChange ? `Wrote the sketch for what is already on your bench.` : '';
  return { ...res, explanation: [lead, res.explanation, ...extra].filter(Boolean).join(' ') };
}
