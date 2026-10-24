// What people call each part. Aliases come from the CATALOG ITSELF (every part's name, its model numbers, its id) plus a curated list of
// everyday words, so a part added later — from the Part Creator, a KiCad import, the library — is understood without touching this file.
// Pure and DOM-free.
import { PART_DEFS } from '../parts.js';

const NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const COLORS = ['red', 'green', 'blue', 'yellow', 'orange', 'white'];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// everyday words → part (beyond what the catalog's own names give)
const SYNONYMS = {
  led: ['leds?', 'light emitting diodes?'],
  'rgb-led': ['rgb(?: led)?s?', 'colou?r(?:ed)? leds?', 'tri-?colou?r leds?'],
  resistor: ['resistors?', 'resistances?'],
  pushbutton: ['push ?buttons?', 'buttons?', 'push switch(?:es)?', 'tact(?:ile)? switch(?:es)?'],
  'slide-switch': ['slide ?switch(?:es)?', 'switch(?:es)?', 'toggle(?: switch)?(?:es)?'],
  potentiometer: ['potentiometers?', 'pots?', 'knobs?', 'dials?', 'trim ?pots?', 'rotary pot(?:entiometer)?s?'],
  'seven-segment': ['7[- ]?seg(?:ment)?s?(?: display)?', 'seven[- ]?seg(?:ment)?s?(?: display)?'],
  'pir-sensor': ['pir', 'motion (?:sensor|detector)s?', 'movement (?:sensor|detector)s?', 'presence sensors?'],
  'ldr-module': ['ldr', 'photo ?resistors?', 'photo ?cells?', 'light (?:sensor|detector|level)s?', 'photo ?sensors?'],
  'ntc-sensor': ['ntc', 'thermistors?', 'temp(?:erature)? (?:sensor|probe)s?', 'thermometers?'],
  mpu6050: ['mpu(?:[- ]?6050)?', 'mpu[- ]?9250', 'accelerometers?', 'gyro(?:scope)?s?', 'imu', 'tilt sensor', 'motion tracking'],
  ssd1306: ['oleds?', 'ssd1306', 'oled (?:screen|display)s?'],
  lcd1602: ['lcds?', 'lcd ?1602', '16 ?[x×] ?2 (?:lcd|display|screen)', 'i2c lcd', 'liquid crystal(?: display)?'],
  dht: ['dht ?(?:11|22)?', 'am2302', 'humidity(?: and temp(?:erature)?)? (?:sensor|probe)s?', 'humidity', 'weather (?:sensor|station)'],
  'dc-motor': ['dc motors?', 'motors?'],
  l298n: ['l298n?', 'motor drivers?', 'h[- ]?bridges?'],
  battery: ['batter(?:y|ies)', '9 ?v(?: batter(?:y|ies))?'],
  'custom-d-1n4007': ['1n4007', 'diodes?', 'rectifier diodes?'],
  'custom-d-zener': ['zeners?(?: diodes?)?', 'zener diodes?'],
  'custom-opamp-lm358': ['lm358', 'op[- ]?amps?', 'operational amplifiers?'],
  'custom-opamp-rr': ['mcp6001', 'rail[- ]to[- ]rail op[- ]?amps?'],
  'custom-opamp-tl07x': ['tl07\\d', 'tl072'],
  'custom-opamp-op07': ['op[- ]?07'],
  'custom-opamp-741': ['lm741', '741', 'ua741'],
  'custom-inamp-ina128': ['ina128', 'instrumentation amp(?:lifier)?s?', 'in-?amps?'],
  'custom-signal-source': ['signal source', 'body signal', 'biosignal source'],
  'custom-bioamp-exg-pill': ['exg pill', 'bio ?amp', 'bio ?signal amp(?:lifier)?s?', 'ecg', 'emg', 'eeg', 'eog', 'heart ?beat monitor', 'biosignals?', 'bio-?potentials?'],
  'custom-slime-mold': ['slime mou?ld', 'physarum'],
  'custom-q-2n2222': ['2n2222', 'npn(?: transistors?)?', 'bjt', 'transistors?'],
  'custom-q-2n2907': ['2n2907', 'pnp(?: transistors?)?'],
  'custom-q-irlz44n': ['irlz44n', 'n-?mosfets?', 'mosfets?', 'power transistors?', 'logic[- ]level mosfets?'],
  'custom-reg-7805': ['7805', 'voltage regulators?', '5 ?v regulators?', 'regulators?'],
  'custom-cap-100n': ['100 ?nf', '0\\.1 ?[uµ]f', 'ceramic cap(?:acitor)?s?'],
  'custom-cap-100u': ['100 ?[uµ]f', 'electrolytic(?: cap(?:acitor)?)?s?', 'capacitors?', 'caps?'],
  'custom-ind-10mh': ['inductors?', 'coils?', '10 ?mh', 'chokes?'],
  'custom-fan': ['fans?', 'dc fans?', 'cooling fans?', 'blowers?'],
  'custom-stepper': ['steppers?(?: motors?)?', '28byj-?48', 'uln2003'],
  'custom-hall': ['hall(?: effect)?(?: sensors?)?', 'magnet(?:ic)? sensors?', 'magnet detectors?'],
  'custom-gate-not': ['not gates?', 'inverters?'],
  'custom-gate-and': ['and gates?'],
  'custom-gate-or': ['or gates?'],
  'custom-gate-xor': ['xor gates?', 'exclusive[- ]or gates?'],
  'custom-gate-nand': ['nand gates?'],
  'custom-gate-nor': ['nor gates?'],
  'custom-gate-dff': ['d[- ]?flip[- ]?flops?', 'flip[- ]?flops?', 'dff', 'latch'],
  'custom-gate-mux2': ['multiplexers?', 'mux(?:es)?', '2[- ]to[- ]1 mux(?:es)?'],
  'custom-ic-74hc595': ['74hc595', '595', 'shift ?registers?'],
  servo: ['servos?(?: motors?)?', 'sg90', 'micro servo'],
  'hc-sr04': ['hc-?sr0?4', 'ultrasonic(?: (?:sensor|ranger|rangefinder|distance sensor))?s?', 'distance (?:sensor|meter|measur\\w+)s?', 'sonar', 'range ?finders?', 'rangefinders?'],
  'ky-040': ['ky-?040', 'rotary encoders?', 'encoders?'],
  buzzer: ['buzzers?', 'piezo(?: buzzers?)?', 'speakers?', 'beepers?', 'alarms?', 'sirens?'],
  'led-bar-graph': ['led bar(?: graph)?s?', 'bar ?graphs?', 'bargraphs?', 'level meters?', 'vu meters?'],
  'relay-dpdt': ['relays?'],
  'tilt-switch': ['tilt(?: switch(?:es)?)?'],
  'sound-sensor': ['sound sensors?', 'microphones?', 'mics?', 'noise sensors?', 'sound level sensors?', 'clap sensors?'],
  'slide-pot': ['slide ?pots?', 'slider(?: pots?)?s?', 'slide potentiometers?', 'faders?'],
  'keypad-4x4': ['key ?pads?', 'num ?pads?', 'membrane keypads?', '4 ?[x×] ?4 (?:key)?pads?', 'matrix keypads?'],
  'dip-switch-8': ['dip(?: switch(?:es)?)?', 'dip-?switch(?:es)?', 'switch banks?'],
  joystick: ['joysticks?', 'thumb ?sticks?', 'analog sticks?'],
  'gas-sensor': ['gas(?: sensors?)?', 'mq-?2', 'smoke(?: sensors?| detectors?)?', 'air quality sensors?'],
  'flame-sensor': ['flame(?: sensors?)?', 'fire(?: sensors?| detectors?)?'],
  'arduino-uno': ['arduino uno', 'uno', 'arduino'],
  'arduino-uno-r4': ['(?:arduino )?uno ?r4(?: minima)?', 'arduino r4(?: minima)?', 'r4 minima'],
  'arduino-nano': ['arduino nano', 'nano'],
  'arduino-mega': ['arduino mega(?: 2560)?', 'mega(?: 2560)?'],
  'raspberry-pi-pico': ['raspberry ?pi pico(?: w)?', 'rpi ?pico', 'pi ?pico', 'pico', 'rp2040(?: board)?'],
};
// words that name a whole family: used only when nothing more specific was said
const FAMILIES = {
  display: ['seven-segment', 'ssd1306', 'lcd1602'], screen: ['ssd1306', 'lcd1602'],
  sensor: ['pir-sensor', 'ldr-module', 'ntc-sensor', 'dht', 'hc-sr04', 'mpu6050', 'gas-sensor'],
  gate: ['custom-gate-and', 'custom-gate-or', 'custom-gate-not', 'custom-gate-xor', 'custom-gate-nand', 'custom-gate-nor'],
  'logic gate': ['custom-gate-and', 'custom-gate-or', 'custom-gate-not', 'custom-gate-xor', 'custom-gate-nand', 'custom-gate-nor'],
  'op amp': null,
};
const BOARD_TYPES = new Set(['arduino-uno', 'arduino-uno-r4', 'arduino-nano', 'arduino-mega', 'raspberry-pi-pico']);

const normalize = t => String(t || '').toLowerCase().replace(/[µμ]/g, 'u').replace(/[×✕]/g, 'x').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();

/** model numbers hiding in a part's name or id: "MPU-6050", "hc-sr04", "1N4007" → regexes that accept "mpu6050", "mpu-6050", "mpu 6050" */
function modelAliases(def) {
  const out = new Set();
  const words = `${def.name} ${def.type}`.toLowerCase().replace(/[()/+,]/g, ' ').split(/\s+/).filter(Boolean);
  for (const w of words) {
    if (!/\d/.test(w) || !/[a-z]/.test(w) || w.length < 3 || /^\d+(x\d+)?$/.test(w) || /^\d+(\.\d+)?(v|mah|nf|uf|mh|ohm)$/.test(w) || /^\d+x\d+$/.test(w)) continue;
    if (/^(custom|arduino)$/.test(w)) continue;
    const flat = w.replace(/-/g, '');
    out.add(flat.replace(/([a-z])(\d)/g, '$1[- ]?$2').replace(/(\d)([a-z])/g, '$1[- ]?$2').split('').join('').replace(/-/g, '-'));
    out.add(esc(w));
  }
  return [...out];
}
function ownNameAlias(def) {
  const base = def.name.toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').replace(/[/+,]/g, ' ').replace(/\s+/g, ' ').trim();
  return base.length >= 3 ? [esc(base).replace(/ /g, '[- ]?')] : [];
}

let cache = { key: '', table: [] };
/** → [{ type, re, weight }] — rebuilt when the catalog changes size */
export function aliasTable() {
  const types = Object.keys(PART_DEFS);
  const key = types.join(',');
  if (cache.key === key) return cache.table;
  const table = [];
  for (const type of types) {
    const def = PART_DEFS[type]; if (!def || type === 'breadboard') continue;
    const sources = new Set([...(SYNONYMS[type] || []), ...modelAliases(def), ...ownNameAlias(def)]);
    for (const src of sources) {
      let re; try { re = new RegExp(`(?<![\\w-])(?:${src})(?![\\w-])`, 'i'); } catch { continue; }
      table.push({ type, re, src });
    }
  }
  cache = { key, table };
  return table;
}

/** Longest match first, no overlaps: [{ type, index, end }] in text order. */
export function findParts(raw) {
  const text = normalize(raw), hits = [];
  const cand = [];
  for (const a of aliasTable()) {
    const g = new RegExp(a.re.source, 'gi');
    let m; while ((m = g.exec(text))) { if (!m[0]) { g.lastIndex++; continue; } cand.push({ type: a.type, index: m.index, end: m.index + m[0].length, len: m[0].length }); }
  }
  cand.sort((a, b) => b.len - a.len || a.index - b.index);
  const taken = new Array(text.length).fill(false);
  for (const c of cand) {
    let free = true; for (let i = c.index; i < c.end; i++) if (taken[i]) { free = false; break; }
    if (!free) continue;
    for (let i = c.index; i < c.end; i++) taken[i] = true;
    hits.push(c);
  }
  return { text, hits: hits.sort((a, b) => a.index - b.index) };
}

/** A family word ("display", "sensor", "gate") with nothing more specific → the types it could mean. */
export function familyIn(text) {
  for (const [w, list] of Object.entries(FAMILIES)) if (list && new RegExp(`(?<![\\w-])${esc(w)}s?(?![\\w-])`).test(text)) return { word: w, types: list.filter(t => PART_DEFS[t]) };
  return null;
}

const countBefore = (text, index) => {
  let pre = text.slice(Math.max(0, index - 28), index).replace(/\s+$/, '');
  let color = null, count = null;
  const cm = new RegExp(`(?:^|[\\s,])(${COLORS.join('|')})$`).exec(pre);
  if (cm) { color = cm[1]; pre = pre.slice(0, cm.index).replace(/\s+$/, ''); }
  const nm = /(?:^|[\s,])(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten)$/.exec(pre);
  if (nm) count = /^\d/.test(nm[1]) ? +nm[1] : NUM_WORDS[nm[1]];
  return { count, color };
};
const wordCount = (text, index, end) => {                      // "leds x3", "3x led"
  const after = /^\s*(?:x|\*)\s*(\d{1,2})\b/.exec(text.slice(end));
  return after ? +after[1] : null;
};

/** "330 ohm", "4.7k", "10 kΩ", "1M" → ohms (or null) */
export function parseOhms(text) {
  const t = String(text || '').replace(/,/g, '');
  const m = /(\d+(?:\.\d+)?)\s*(k|m|meg)?\s*(?:ohms?|Ω|ω)\b|(\d+(?:\.\d+)?)\s*(k|meg)\b/i.exec(t);
  if (!m) return null;
  const num = +(m[1] ?? m[3]), unit = (m[2] ?? m[4] ?? '').toLowerCase();
  const v = num * (unit === 'k' ? 1e3 : unit === 'm' || unit === 'meg' ? 1e6 : 1);
  return v > 0 && v <= 1e7 ? Math.round(v) : null;
}

/** Everything a request says about WHICH parts: → { requests:[{type,count,color?,ohms?}], board, family } */
export function readParts(raw) {
  const { text, hits } = findParts(raw);
  const merged = new Map(); let board = null;
  for (const h of hits) {
    if (BOARD_TYPES.has(h.type)) { board ||= h.type; continue; }
    const { count, color } = countBefore(text, h.index);
    const explicit = count ?? wordCount(text, h.index, h.end);
    const r = merged.get(h.type) || { type: h.type, count: 0 };
    r.count = explicit ? Math.min(8, r.count + explicit) : Math.max(1, r.count);       // "mq-2 gas sensor" is one part named twice
    if (color && h.type === 'led') r.color = color;
    merged.set(h.type, r);
  }
  const requests = [...merged.values()];
  // a resistor next to an LED is that LED's resistor: one circuit, not two
  const ohms = parseOhms(text);
  const led = requests.find(r => r.type === 'led'), res = requests.find(r => r.type === 'resistor');
  let out = requests;
  if (led && res) { out = requests.filter(r => r !== res); if (ohms) led.ohms = ohms; }
  else if (ohms) for (const r of requests) if (['resistor', 'led', 'battery'].includes(r.type)) r.ohms = ohms;
  return { requests: out, board, text, family: requests.length ? null : familyIn(text) };
}
