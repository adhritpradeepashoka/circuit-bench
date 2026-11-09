// Part Maker without a big model: (1) match a description to one of the ready-made templates, (2) make a sensible
// generic part from keywords when nothing else answers. Pure functions — no network, no model, instant.
import { BEHAVIOURS, validatePartSpec } from './custom-parts.js';

const STOP = new Set('a an the and or of for with to in on module sensor board breakout part chip component unit simple basic standard kit pin pins add make create me my want need please'.split(' '));
const norm = s => String(s || '').toLowerCase().replace(/[‐-―−]/g, '-');
const squash = s => norm(s).replace(/[^a-z0-9]/g, '');
const words = s => norm(s).split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w));
// the words people use for the same thing
const SYN = { led: ['light', 'diode'], motor: ['dc'], mosfet: ['fet', 'nmos', 'pmos'], transistor: ['bjt', 'npn', 'pnp'], pot: ['potentiometer', 'trimmer', 'knob'], resistor: ['ohm'], capacitor: ['cap'], regulator: ['ldo', 'reg'], buzzer: ['piezo', 'beeper'], ultrasonic: ['sonar', 'distance', 'hcsr04'], switch: ['toggle', 'slide'], opamp: ['op-amp', 'operational'] };
const expand = ws => { const out = new Set(ws); for (const w of ws) for (const [k, v] of Object.entries(SYN)) if (w === k || v.includes(w)) { out.add(k); v.forEach(x => out.add(x)); } return out; };

/** Rank templates against a description → [{ template, score }], best first. Score ≥ 0.6 with a clear lead is a confident match. */
export function rankTemplates(description, templates) {
  const text = norm(description), flat = squash(description), ws = [...expand(words(description))];
  if (!ws.length) return [];
  const out = [];
  for (const t of templates) {
    const names = words(`${t.id} ${t.name} ${t.label}`), nameSet = expand(names), head = squash(`${t.label}`), idSq = squash(t.id.replace(/^custom-/, ''));
    let score = 0;
    // a part number written anywhere in the text (ky040, 1n4007, 2n2222, sg90, lm358…) is the strongest signal
    for (const tok of new Set([...names, head])) if (tok.length >= 4 && /\d/.test(tok) && flat.includes(tok.replace(/[^a-z0-9]/g, ''))) score = Math.max(score, 0.95);
    if (idSq.length >= 5 && /\d/.test(idSq) && flat.includes(idSq)) score = Math.max(score, 0.95);
    const hit = ws.filter(w => nameSet.has(w)).length, total = Math.max(names.length, 1);
    const cover = hit / Math.min(ws.length + 0.0001, total + 1);                               // how much of what they said the template's name accounts for
    const share = hit / total;                                                                   // how much of the template's name they said
    score = Math.max(score, Math.min(0.9, 0.55 * cover + 0.45 * share) * (hit ? 1 : 0));
    if (new RegExp(`(^|[^a-z0-9])${norm(t.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text)) score = Math.max(score, 0.9);
    if (score > 0) out.push({ template: t, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** The template this description clearly names, or null (then a model has to do it). */
export function matchTemplate(description, templates) {
  const r = rankTemplates(description, templates), best = r[0], next = r[1];
  if (!best || best.score < 0.62) return null;
  if (next && next.score > best.score - 0.08 && best.score < 0.9) return null;               // two equally good guesses: don't pick for them
  return best.template;
}

const KIND_WORDS = [
  ['ultrasonic', /ultrason|sonar|hc-?sr04|distance sensor/], ['servo', /servo|sg90|mg90|rds/], ['stepper', /stepper|28byj|nema/], ['motor', /\bmotor\b|dc motor|vibrat/], ['hbridge', /h-?bridge|motor driver|l298|l293|drv8|tb6612/],
  ['relay', /relay/], ['buzzer', /buzzer|piezo|speaker|beeper/], ['led', /\bled\b|lamp|light bulb/], ['button', /button|push ?switch|tactile/], ['switch', /\bswitch\b|toggle|slide/],
  ['variable-resistor', /potentiometer|\bpot\b|trimmer|ldr|photoresistor|thermistor|flex|force sensor|fsr/], ['resistor', /resistor|heater/],
  ['digital-sensor', /pir|motion|hall|reed|tilt|ir (obstacle|sensor)|flame|touch|limit|digital/], ['analog-sensor', /sensor|temperature|humidity|light|gas|mq-?\d|soil|moisture|pressure|emg|ecg|eeg|pulse|load cell|microphone|sound|analog/],
  ['regulator', /regulator|ldo|7805|buck|boost|converter/], ['opamp', /op-?amp|lm358|lm741|amplifier/], ['inamp', /instrumentation|ina\d{3}|inamp/], ['joystick', /joystick/], ['encoder', /encoder|ky-?040/],
  ['npn', /\bnpn\b|2n2222|bc547/], ['pnp', /\bpnp\b|2n2907/], ['nmos', /mosfet|irlz44|irf540|\bnmos\b/], ['diode', /diode|1n4\d{3}|zener|schottky/], ['capacitor', /capacitor/], ['inductor', /inductor|coil/],
];
const PIN_NAME = { a: 'A', b: 'B', vcc: 'VCC', gnd: 'GND', out: 'OUT', dout: 'DOUT', anode: 'A', cathode: 'K', common: 'COM', throw1: 'T1', throw2: 'T2', coilA: 'COIL+', coilB: 'COIL-', no: 'NO', nc: 'NC', wiper: 'W', base: 'B', collector: 'C', emitter: 'E', gate: 'G', drain: 'D', source: 'S', vin: 'VIN', signal: 'SIG', trig: 'TRIG', echo: 'ECHO', vs: 'VS', in1: 'IN1', in2: 'IN2', out1: 'OUT1', out2: 'OUT2', horz: 'HORZ', vert: 'VERT', sel: 'SEL', inp: 'IN+', inn: 'IN-', vee: 'VEE', ref: 'REF', u: 'U', v: 'V', w: 'W' };

/** What kind of behaviour does this description sound like? */
export function guessKind(description) { const t = norm(description); return (KIND_WORDS.find(([, re]) => re.test(t)) || ['analog-sensor'])[0]; }

const titleOf = d => { const t = String(d || '').replace(/\s+/g, ' ').trim().replace(/^(a|an|the)\s+/i, ''); return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 40) || 'My part'; };
const labelOf = d => { const w = words(d); const tok = w.find(x => /\d/.test(x)) || w[0] || 'PART'; return tok.toUpperCase().slice(0, 12); };

/** A working generic part from nothing but the words: right kind, its needed pins, a tidy board. Used when no model could answer. */
export function heuristicSpec(description) {
  const kind = guessKind(description), b = BEHAVIOURS[kind] || BEHAVIOURS['analog-sensor'], roles = {}, pins = [];
  for (const role of [...b.roles]) { const id = PIN_NAME[role] || role.toUpperCase().slice(0, 8); if (pins.some(p => p.id === id)) continue; roles[role] = id; pins.push({ id, label: b.roleLabels?.[role] || role, side: 'bottom' }); }
  if (kind === 'stepper') for (const n of [1, 2, 3, 4]) pins.push({ id: `IN${n}`, label: `Coil input ${n}`, side: 'bottom' });
  const extra = kind === 'stepper' ? { coils: ['IN1', 'IN2', 'IN3', 'IN4'], steps: 2048 } : kind === 'resistor' ? { ohms: 1000 } : kind === 'variable-resistor' ? { ohms: 10000 } : {};
  const color = { servo: '#2f3a4a', motor: '#8a8f98', relay: '#2b6cb0', buzzer: '#222831', led: '#2b6cb0', ultrasonic: '#2b6cb0' }[kind] || '#2b6cb0';
  const raw = { name: titleOf(description), label: labelOf(description), description: `Made from the words "${String(description).slice(0, 80)}" — check the pins, then save.`, color, textColor: '#ffffff', package: 'module', breadboard: true, pins, behaviour: { kind, roles, ...extra } };
  const v = validatePartSpec(raw);
  return v.ok ? v.spec : null;
}
