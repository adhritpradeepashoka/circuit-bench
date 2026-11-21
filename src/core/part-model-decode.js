// The Part Maker model's output → a part. The model writes "part language" (one line):  name|label|kind|pin ids|k=v numbers
// and this file turns it into a spec the simulator will accept: it works out which pin plays which role from the pin NAMES (the
// model never has to write the roles), then validatePartSpec has the last word. 'unknown' (or anything that does not validate) → null.
import { validatePartSpec } from './custom-parts.js';

const A = (...l) => l;
const ROLE_ALIASES = {
  switch: { common: A('COM', 'C', '1', 'COMMON'), throw1: A('T1', 'NO', '2'), throw2: A('T2', 'NC', '3') },
  'variable-resistor': { wiper: A('W', 'WIPER', 'SIG', 'OUT'), a: A('LO', 'A', 'CCW', '1', 'GND'), b: A('HI', 'B', 'CW', '2', 'VCC') },
  diode: { anode: A('A', 'ANODE', '+'), cathode: A('K', 'C', 'CATHODE', '-') },
  npn: { base: A('B', 'BASE'), collector: A('C', 'COLLECTOR'), emitter: A('E', 'EMITTER') },
  pnp: { base: A('B', 'BASE'), collector: A('C', 'COLLECTOR'), emitter: A('E', 'EMITTER') },
  nmos: { gate: A('G', 'GATE'), drain: A('D', 'DRAIN'), source: A('S', 'SOURCE') },
  pmos: { gate: A('G', 'GATE'), drain: A('D', 'DRAIN'), source: A('S', 'SOURCE') },
  regulator: { vin: A('IN', 'VIN', 'INPUT', 'VI'), gnd: A('GND', 'G'), out: A('OUT', 'VOUT', 'OUTPUT', 'VO') },
  capacitor: {}, inductor: {}, buzzer: {}, motor: {},
  servo: { vcc: A('VCC', 'V+', '5V', 'RED'), gnd: A('GND', 'G', 'BROWN', 'BLACK'), signal: A('SIG', 'SIGNAL', 'PWM', 'S', 'ORANGE', 'YELLOW') },
  ultrasonic: { vcc: A('VCC', '5V', 'V+'), gnd: A('GND', 'G'), trig: A('TRIG', 'TRIGGER'), echo: A('ECHO') },
  encoder: { a: A('CLK', 'A', 'CLOCK'), b: A('DT', 'B', 'DATA'), common: A('GND', 'COM', 'C'), sw: A('SW', 'BTN', 'SWITCH') },
  'analog-sensor': { vcc: A('VCC', 'VDD', 'V+', '5V', '3V3', 'VS', '3.3V'), gnd: A('GND', 'G', 'V-'), out: A('OUT', 'AO', 'AOUT', 'OUTPUT', 'A0', 'S', 'SIG', 'SIGNAL', 'VOUT', 'ANALOG'), dout: A('DO', 'DOUT', 'D0', 'DIGITAL') },
  'digital-sensor': { vcc: A('VCC', 'VDD', 'V+', '5V', '3V3'), gnd: A('GND', 'G'), out: A('OUT', 'DO', 'DOUT', 'D0', 'S', 'SIG', 'SIGNAL', 'OUTPUT') },
  joystick: { vcc: A('5V', 'VCC', '+5V', '3V3'), gnd: A('GND'), horz: A('VRX', 'HORZ', 'X'), vert: A('VRY', 'VERT', 'Y'), sel: A('SW', 'SEL', 'BTN') },
  opamp: { inp: A('IN+', '+', 'INP', 'NONINV'), inn: A('IN-', '-', 'INN', 'INV'), out: A('OUT'), vcc: A('V+', 'VCC', 'VS+', 'VDD'), vee: A('V-', 'VEE', 'VS-', 'GND', 'VSS') },
  inamp: { inp: A('IN+', '+', 'INP'), inn: A('IN-', '-', 'INN'), out: A('OUT'), vcc: A('V+', 'VCC', 'VS+', 'VDD'), vee: A('V-', 'VEE', 'VS-', 'GND', 'VSS'), ref: A('REF') },
  relay: { coilA: A('C+', 'COIL+', 'A1', 'COIL1'), coilB: A('C-', 'COIL-', 'A2', 'COIL2'), common: A('COM', 'C'), no: A('NO'), nc: A('NC') },
};
const POSITIONAL = { capacitor: ['a', 'b'], inductor: ['a', 'b'], buzzer: ['a', 'b'], motor: ['a', 'b'], diode: ['anode', 'cathode'], resistor: ['a', 'b'], button: ['a', 'b'], led: ['anode', 'cathode'] };
const OPTIONAL = new Set(['dout', 'sw', 'sel', 'wiper', 'ref', 'throw2', 'nc']);
const COLORS = { npn: '#2b2b2b', pnp: '#2b2b2b', nmos: '#2b2b2b', pmos: '#2b2b2b', diode: '#3a3a3a', regulator: '#2b2b2b', opamp: '#2b2b2b', inamp: '#2b6cb0', servo: '#2b6cb0', motor: '#7a7a7a', relay: '#2b6cb0', capacitor: '#8b5e34', inductor: '#8b5e34', 'analog-sensor': '#1f6f50', 'digital-sensor': '#1f6f50', ultrasonic: '#2b6cb0', joystick: '#2b2b2b', encoder: '#1f6f50', buzzer: '#2b2b2b', 'variable-resistor': '#2b6cb0', switch: '#4a4a4a' };
const NUMERIC = new Set(['ohms', 'min', 'vf', 'vz', 'beta', 'vth', 'rds', 'imax', 'vout', 'drop', 'uF', 'mH', 'rs', 'pick', 'vmin', 'gain', 'range', 'minUs', 'maxUs']);
const norm = s => String(s).toUpperCase().replace(/\s+/g, '');

/** Which pin plays which role, worked out from the pin names. Returns the roles object, or null when a required role has no pin. */
export function rolesFor(kind, pins) {
  const table = ROLE_ALIASES[kind]; if (!table && !POSITIONAL[kind]) return null;
  const ids = pins.map(norm), used = new Set(), roles = {};
  const take = (role, aliases) => { for (const al of aliases) { const i = ids.findIndex((p, k) => !used.has(k) && p === al); if (i >= 0) { used.add(i); roles[role] = pins[i]; return true; } } return false; };
  const order = Object.keys(table || {});
  // the specific names first (OUT before S, IN+ before +), then position for the plain two-pin parts
  for (const role of order) if (!(kind === 'variable-resistor' && (role === 'a' || role === 'b'))) take(role, table[role]);
  if (kind === 'variable-resistor') {
    if (pins.length === 3) { const rest = pins.filter((_, i) => !used.has(i)); if (!roles.wiper) { roles.wiper = pins[1]; used.add(1); } const others = pins.filter((_, i) => !used.has(i)); roles.a = others[0]; roles.b = others[1]; }
    else { roles.a = pins[0]; roles.b = pins[1]; }
  }
  const pos = POSITIONAL[kind];
  if (pos) for (const role of pos) if (!roles[role]) { const i = ids.findIndex((_, k) => !used.has(k)); if (i >= 0) { used.add(i); roles[role] = pins[i]; } }
  for (const role of order) if (!roles[role] && !OPTIONAL.has(role) && !(kind === 'variable-resistor')) return null;
  if (kind === 'switch' && pins.length === 2) { roles.common = pins[0]; roles.throw1 = pins[1]; delete roles.throw2; }
  return roles;
}

/** "name|label|kind|pins|k=v k=v" → { name, label, kind, pins:[ids], params:{} } or null. */
export function parsePartLanguage(text) {
  const t = String(text || '').trim();
  if (!t || t === 'unknown') return null;
  const [name, label, kind, pinsText, paramText = ''] = t.split('|');
  if (!name || !label || !kind || !pinsText) return null;
  const pins = pinsText.trim().split(/\s+/); if (new Set(pins).size !== pins.length) return null;
  const params = {};
  for (const kv of paramText.trim().split(/\s+/).filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (k === 'mode') { if (['linear', 'switching', 'active', 'passive'].includes(v)) params.mode = v; continue; }
    if (NUMERIC.has(k) && v !== undefined && v !== '' && Number.isFinite(Number(v))) params[k] = Number(v);
  }
  return { name: name.trim(), label: label.trim(), kind: kind.trim(), pins, params };
}

/** The part language → a validated part spec (a generic board; the caller may swap in a built-in template's own drawing), or null. */
export function specFromPartLanguage(text) {
  const p = parsePartLanguage(text); if (!p) return null;
  const roles = rolesFor(p.kind, p.pins); if (!roles) return null;
  const behaviour = { kind: p.kind, roles, ...p.params };
  const v = validatePartSpec({ name: p.name.slice(0, 40), label: p.label.slice(0, 16), description: `${p.name}, made on this device from your words. Check the pins against the datasheet.`, color: COLORS[p.kind] || '#2b6cb0', textColor: '#ffffff', package: 'module', breadboard: true, pins: p.pins.map(id => ({ id, label: id, side: 'bottom' })), behaviour });
  return v.ok ? v.spec : null;
}
