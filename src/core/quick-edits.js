// The instant assistant: understands the common, plainly worded requests ("add a red LED", "make the resistor 330 ohms",
// "remove the button", "blink pin 9 every half second") and turns them straight into circuit edits or a sketch — no download,
// no GPU, no network, milliseconds. Anything it is not sure about returns null so a model can take over.
// Pure and DOM-free; its actions go through the same validation (applyCircuitActions) as the AI's.
import { PART_DEFS } from './parts.js';

const NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
// what people call each part (first match in a request wins, longer phrases first)
const NAMES = [
  ['arduino-nano', /\barduino nano\b|\bnano\b/], ['arduino-mega', /\barduino mega\b|\bmega\b/], ['arduino-uno', /\barduino uno\b|\buno\b/],
  ['rgb-led', /\brgb( led)?s?\b/], ['led', /\bleds?\b/], ['resistor', /\bresistors?\b/],
  ['pushbutton', /\bpush ?buttons?\b|\bbuttons?\b/], ['slide-switch', /\bslide ?switch(es)?\b|\bswitch(es)?\b/],
  ['potentiometer', /\bpotentiometers?\b|\bpots?\b|\bknobs?\b|\bdials?\b/], ['seven-segment', /\b7[- ]?segment\b|\bseven[- ]segment\b/],
  ['pir-sensor', /\bpir\b|\bmotion sensors?\b/], ['ldr-module', /\bldr\b|\bphoto ?resistors?\b|\blight sensors?\b/],
  ['ntc-sensor', /\bntc\b|\bthermistors?\b|\btemperature sensors?\b/], ['mpu6050', /\bmpu[- ]?6050\b|\baccelerometers?\b|\bgyro(scope)?\b/],
  ['ssd1306', /\boled\b|\bssd1306\b/], ['lcd1602', /\blcd\b/], ['dht', /\bdht\d*\b|\bhumidity sensors?\b/],
  ['l298n', /\bl298n?\b|\bmotor driver\b/], ['dc-motor', /\bmotors?\b/], ['battery', /\bbatter(y|ies)\b/], ['breadboard', /\bbreadboards?\b/],
];
const COLORS = ['red', 'green', 'blue', 'yellow', 'orange', 'white'];
const label = t => PART_DEFS[t]?.name || t;

function findTypes(text) {
  const out = [];
  let rest = text;
  for (const [type, re] of NAMES) { const m = re.exec(rest); if (m && PART_DEFS[type]) { out.push({ type, index: m.index }); rest = rest.replace(re, ' '.repeat(m[0].length)); } }
  return out.sort((a, b) => a.index - b.index).map(x => x.type);
}
const count = text => {
  const m = /\b(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\b(?=[^.]{0,24}\b(led|resistor|button|switch|sensor|pot|motor|battery|display|board)s?\b)/.exec(text);
  return m ? Math.min(10, /^\d/.test(m[1]) ? +m[1] : NUM_WORDS[m[1]]) : 1;
};
/** "330 ohm", "4.7k", "10 kΩ", "1M" → ohms */
export function parseOhms(text) {
  const m = /(\d+(?:\.\d+)?)\s*(k|m|meg)?\s*(?:ohms?|Ω|ω)?\b/i.exec(text.replace(/,/g, ''));
  if (!m || !/(ohm|Ω|ω|\d\s*k\b|\d\s*m(eg)?\b)/i.test(text)) return null;
  const v = +m[1] * (/^k$/i.test(m[2] || '') ? 1e3 : /^m(eg)?$/i.test(m[2] || '') ? 1e6 : 1);
  return v > 0 && v <= 1e7 ? Math.round(v) : null;
}
const idsOfType = (circuit, type) => (circuit?.parts || []).filter(p => p.type === type).map(p => p.id);
const fmtMs = ms => (ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`);

function blinkSketch(pin, ms) {
  return `// Blink pin ${pin}: on for ${fmtMs(ms)}, off for ${fmtMs(ms)}.
const int LED_PIN = ${pin};

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(${ms});
  digitalWrite(LED_PIN, LOW);
  delay(${ms});
}
`;
}

/** → { actions, code, explanation } or null when this is not something the instant assistant is sure about. */
export function quickEdit(instruction, circuit = { parts: [], wires: [] }) {
  const raw = String(instruction || '').trim();
  if (!raw || raw.length > 200) return null;
  const t = raw.toLowerCase().replace(/[!?]+$/, '').replace(/\s+/g, ' ');
  if (/\b(why|how|what|explain|help|wrong|broken|not working|doesn'?t work|and then|then|also)\b|[;]/.test(t) || (t.match(/\band\b/g) || []).length > 1) return null;   // questions and multi-step asks go to a model

  // ── blink pin N ──
  const blink = /\bblink\b.*?\bpin\s*(a?\d{1,2})\b|\bblink\b.*?\b(?:on|at|using)\s+(a?\d{1,2})\b/.exec(t);
  if (blink) {
    const pin = (blink[1] || blink[2]).toUpperCase();
    if (/^A[0-5]$/.test(pin) || (/^\d+$/.test(pin) && +pin <= 13)) {
      const every = /(?:every|each|per)\s+(\d+(?:\.\d+)?|half a|half|a|one)\s*(ms|milliseconds?|s|secs?|seconds?)?/.exec(t) || /(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?)/.exec(t);
      let ms = 500;
      if (every) { const n = /half/.test(every[1]) ? 0.5 : /^(a|one)$/.test(every[1]) ? 1 : +every[1]; ms = Math.round(n * (/^m/.test(every[2] || (n > 20 ? 'ms' : 's')) ? 1 : 1000)); }
      if (ms < 10 || ms > 60_000) return null;
      return { actions: [], code: blinkSketch(pin, ms), explanation: `Here is a sketch that blinks pin ${pin} every ${fmtMs(ms)}. Wire an LED (with a resistor) from pin ${pin} to GND for it to light up.` };
    }
  }

  const types = findTypes(t);

  // ── add ──
  if (/^(please |can you |could you |just )?(add|put|place|insert|drop|get me|give me|i (want|need))\b/.test(t) && types.length === 1) {
    const type = types[0], n = count(t), props = {};
    if (type === 'led') { const c = COLORS.find(x => new RegExp(`\\b${x}\\b`).test(t)); if (c) props.color = c; }
    if (type === 'resistor') { const ohms = parseOhms(t); if (ohms) props.ohms = ohms; }
    const id = type.replace(/[^a-z0-9]/g, '').slice(0, 6);
    const actions = Array.from({ length: n }, (_, i) => ({ op: 'add_part', id: `${id}${n > 1 || idsOfType(circuit, type).length ? i + 1 + idsOfType(circuit, type).length : ''}`, type, ...(Object.keys(props).length ? { props } : {}) }));
    const extra = Object.entries(props).map(([k, v]) => `${k} ${v}`).join(', ');
    return { actions, code: null, explanation: `Added ${n === 1 ? 'a' : n} ${label(type)}${n > 1 ? 's' : ''}${extra ? ` (${extra})` : ''}. Drag ${n > 1 ? 'them' : 'it'} where you like and wire ${n > 1 ? 'them' : 'it'} up.` };
  }

  const byId = /^(?:remove|delete)\s+(?:the\s+)?([a-z0-9-]+)$/.exec(t);
  if (byId && (circuit?.parts || []).some(p => p.id === byId[1])) return { actions: [{ op: 'remove_part', id: byId[1] }], code: null, explanation: `Removed ${byId[1]}.` };
  // ── remove ──
  if (/^(please |can you |could you |just )?(remove|delete|get rid of|take away|take out)\b/.test(t) && types.length === 1) {
    const type = types[0], ids = idsOfType(circuit, type);
    if (!ids.length) return { actions: [], code: null, explanation: `There is no ${label(type)} on the board to remove.` };
    if (ids.length > 1 && !/\b(all|every|each)\b/.test(t)) return { actions: [], code: null, explanation: `There are ${ids.length} of those (${ids.join(', ')}). Say "remove all ${label(type)}s", or name one, e.g. "remove ${ids[0]}".` };
    return { actions: ids.map(id => ({ op: 'remove_part', id })), code: null, explanation: `Removed ${ids.length === 1 ? `the ${label(type)}` : `all ${ids.length} ${label(type)}s`}.` };
  }

  // ── set a value ──
  if (/\b(set|change|make|turn|adjust)\b/.test(t) && types.length === 1) {
    const type = types[0], ids = idsOfType(circuit, type);
    if (!ids.length) return { actions: [], code: null, explanation: `There is no ${label(type)} on the board yet. Say "add a ${label(type)}" first.` };
    let key = null, value = null;
    if (type === 'resistor') { value = parseOhms(t); key = 'ohms'; }
    else if (type === 'led') { value = COLORS.find(x => new RegExp(`\\b${x}\\b`).test(t)); key = 'color'; }
    else if (type === 'battery') { const m = /(\d+(?:\.\d+)?)\s*(?:v|volts?)\b/.exec(t); if (m && +m[1] > 0 && +m[1] <= 24) { key = 'volts'; value = +m[1]; } }
    else if (type === 'ntc-sensor' || type === 'dht') { const m = /(-?\d+(?:\.\d+)?)\s*(?:°|degrees?)?\s*c\b|to\s+(-?\d+(?:\.\d+)?)\b/.exec(t); if (m && PART_DEFS[type].props?.temp !== undefined) { key = 'temp'; value = +(m[1] ?? m[2]); } }
    if (key == null || value == null || value === '') return null;
    const targets = ids.length > 1 && !/\b(all|every|each)\b/.test(t) ? null : ids;
    if (!targets) return { actions: [], code: null, explanation: `There are ${ids.length} of those (${ids.join(', ')}). Say "all" or name one.` };
    return { actions: targets.map(id => ({ op: 'set_prop', id, key, value })), code: null, explanation: `Set ${targets.length === 1 ? `the ${label(type)}` : `all ${targets.length} ${label(type)}s`} ${key} to ${value}.` };
  }
  return null;
}
