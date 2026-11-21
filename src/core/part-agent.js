// The Part Maker agent: a role that does one job (make the part ACCURATELY) and a checker that holds its answer against the facts it was
// given before the student ever sees it. Pure functions; the server runs them between the AI's answer and the reply (a failed check
// goes back to the AI as a repair round), and the tests run them directly.
import { guessKind } from './part-match.js';

export const PART_AGENT_ROLE = `You are the Part Maker agent. You do one job: define electronics parts so that they match the real part exactly. You do not chat, you do not design circuits. Accuracy rules, in this order: (1) the real pin names in datasheet order, (2) the real behaviour and typical values, (3) every number the student gave, (4) the real look. If you cannot verify something, leave it standard and say so in "note"; never invent a pin, a value or a part number.`;

const squash = s => String(s || '').toLowerCase().replace(/[^a-z0-9+]/g, '');
const nums = s => [...new Set((String(s || '').toLowerCase().replace(/(\d)\s*,\s*(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) || []))];

/** The part-number-like tokens in the request (ina128, 1n4007, hc-sr04, sg90): their digits are part of the NAME, not a specification to apply. */
const partNumberDigits = text => new Set((String(text || '').toLowerCase().match(/[a-z]{1,6}-?\d[a-z0-9-]*/g) || []).flatMap(t => t.match(/\d+(?:\.\d+)?/g) || []));

/**
 * Hold a validated spec against what is known. Returns a list of plain-language problems (empty = it checks out):
 *  - the datasheet's pin list (facts.pins) must be matched pin for pin, in count and, for a chip, in order;
 *  - the real size (facts.sizeMm) must be within 35%;
 *  - the behaviour must not be "none" when the words name a kind of part the simulator can model;
 *  - every number the student stated must appear somewhere in the part (a behaviour number or the note), never silently dropped.
 */
export function checkPart(spec, { description = '', facts = null, note = '' } = {}) {
  const problems = [];
  const pins = (spec?.pins || []).map(p => squash(p.id)), labels = (spec?.pins || []).map(p => squash(p.label));
  const real = Array.isArray(facts?.pins) ? facts.pins.map(String).filter(Boolean) : [];
  if (real.length >= 2 && real.length <= 64) {
    if (real.length !== pins.length) problems.push(`The datasheet lists ${real.length} pins (${real.slice(0, 12).join(', ')}) but the part has ${pins.length}.`);
    else {
      const wrong = real.map((r, i) => [r, i]).filter(([r, i]) => { const q = squash(r); return q && pins[i] !== q && labels[i] !== q && !pins[i].includes(q) && !q.includes(pins[i]); });
      if (wrong.length > Math.max(1, Math.floor(real.length / 4))) problems.push(`Pin names/order differ from the datasheet at ${wrong.slice(0, 4).map(([r, i]) => `pin ${i + 1} should be ${r}`).join(', ')}.`);
    }
  }
  const w = Number(facts?.sizeMm?.w), h = Number(facts?.sizeMm?.h), sw = Number(spec?.sizeMm?.w), sh = Number(spec?.sizeMm?.h);
  if (w > 0 && h > 0 && sw > 0 && sh > 0) {
    const off = (a, b) => Math.abs(a - b) / b > 0.35;
    const [fa, fb] = [Math.max(w, h), Math.min(w, h)], [sa, sb] = [Math.max(sw, sh), Math.min(sw, sh)];
    if (off(sa, fa) || off(sb, fb)) problems.push(`The real part is about ${fa} x ${fb} mm but the drawing is ${sa} x ${sb} mm.`);
  }
  if (spec?.behaviour?.kind === 'none' && guessKind(description) !== 'analog-sensor' && /\b(led|servo|motor|relay|button|switch|resistor|diode|transistor|mosfet|regulator|buzzer|potentiometer|op-?amp|capacitor|inductor|encoder|stepper|ultrasonic)\b/i.test(description)) problems.push(`The request names a part the simulator can model, so the behaviour should not be "none".`);
  const skip = partNumberDigits(description), have = `${JSON.stringify(spec?.behaviour || {})} ${spec?.note || ''} ${note} ${spec?.description || ''} ${spec?.name || ''} ${spec?.label || ''}`.toLowerCase();
  const dropped = nums(description).filter(n => !skip.has(n) && !have.includes(n));
  if (dropped.length) problems.push(`The student gave ${dropped.slice(0, 4).join(', ')} but it appears nowhere in the part: apply it to a behaviour number, or write it in "note".`);
  return problems;
}

/** A remembered part trimmed for a prompt: [{request, spec}] → text the AI can copy conventions from. */
export function describeExamples(examples) {
  const list = (Array.isArray(examples) ? examples : []).slice(0, 3);
  if (!list.length) return '';
  return `\nPARTS THE STUDENTS ALREADY APPROVED that resemble this request (they were checked by a person; copy their pin names, naming and behaviour numbers unless the student asks for something different):\n${list.map(e => `Request: ${String(e.request).slice(0, 160)}\n${JSON.stringify(e.spec).slice(0, 1400)}`).join('\n')}\n`;
}
