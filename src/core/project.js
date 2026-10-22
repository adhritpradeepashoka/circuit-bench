import { PART_DEFS } from './parts.js';
import { compile } from './netlist.js';
import { WOKWI_ELEMENTS_VERSION } from './pins.generated.js';
import { DEFAULT_OHMS, MIN_OHMS, MAX_OHMS } from './resistance.js';
import { LED_COLORS, DEFAULT_LED_COLOR } from './led-colors.js';
import { WIRE_KINDS, LEGACY_WIRE_KIND } from './wire-kinds.js';
import { validatePartSpec, registerCustomPart, specsUsed } from './custom-parts.js';

/** Per-part editable properties (ohms, LED colour, switch position) — the keys come from PART_DEFS[type].props. */
const num = (lo, hi) => (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, +v)) : d);
const clean = {
  ohms: (v, d) => (+v ? Math.min(MAX_OHMS, Math.max(MIN_OHMS, +v)) : d),
  color: v => (v in LED_COLORS ? v : DEFAULT_LED_COLOR),
  pos: v => (+v ? 1 : 0),
  level: num(0, 100),      // potentiometer, %
  lux: num(0.1, 1e5),      // photoresistor
  temp: num(-40, 80),      // NTC / DHT, °C
  humidity: num(0, 100),   // DHT, %RH
  model: v => (v === 'DHT11' ? 'DHT11' : 'DHT22'),
  volts: num(1.5, 12),     // battery
  dist: num(2, 400),       // ultrasonic sensor, cm
  phase: v => ((+v || 0) & 3),   // rotary encoder quadrature phase
  signal: v => (['ecg', 'emg', 'eeg', 'eog', 'sine'].includes(v) ? v : 'ecg'), bpm: num(40, 180), effort: num(0, 100), scale: num(0, 300), contact: num(1, 100), hum: num(0, 100), attached: v => (+v === 0 ? 0 : 1),   // biosignal source
  keys: v => ((+v || 0) & 0xffff), bits: v => ((+v || 0) & 0xffff),   // keypad: one bit per key; DIP bank: one bit per switch
  jx: num(0, 100), jy: num(0, 100), jsel: v => (+v ? 1 : 0),   // joystick
  len: num(38.4, 600),     // resistor lead spacing (world px)
  roll: num(-180, 180), pitch: num(-90, 90), yaw: num(-180, 180),   // MPU-6050 orientation, degrees
};
export const propsOf = part => Object.fromEntries(Object.keys(PART_DEFS[part.type]?.props || {}).map(k => { const d = PART_DEFS[part.type].props[k]; return [k, clean[k](part[k] ?? d, d)]; }));

export const FORMAT = 'virtual-lab';
export const VERSION = '0.1';

export const snapshot = state => JSON.stringify({
  parts: state.parts.map(p => ({ id: p.id, type: p.type, x: p.x, y: p.y, rot: p.rot, ...propsOf(p) })),
  wires: state.wires.map(w => ({ ...w, a: { ...w.a }, b: { ...w.b } })),
});

export function restore(state, json) {
  const s = typeof json === 'string' ? JSON.parse(json) : json;
  state.parts = s.parts.map(p => ({ id: p.id, type: p.type, x: p.x, y: p.y, rot: p.rot || 0, ...propsOf(p) }));
  state.wires = s.wires.map(w => ({ ...w, a: { ...w.a }, b: { ...w.b } }));
}

export function toProjectFile(state) {
  const c = compile(state);
  return {
    format: FORMAT,
    version: VERSION,
    libraries: { '@wokwi/elements': WOKWI_ELEMENTS_VERSION, avr8js: '0.21.1' },
    ...(specsUsed(state.parts).length ? { customParts: specsUsed(state.parts) } : {}),   // student-made parts travel with the project
    parts: state.parts.map(p => ({ id: p.id, type: p.type, x: +p.x.toFixed(2), y: +p.y.toFixed(2), rotate: p.rot || 0, ...propsOf(p) })),
    wires: state.wires.map(w => ({
      id: w.id, from: { part: w.a.part, pin: w.a.pin }, to: { part: w.b.part, pin: w.b.pin },
      style: w.style, color: w.color, width: w.width, bend: w.bend, sag: w.sag, kind: w.kind || LEGACY_WIRE_KIND,
    })),
    // Derived, for humans / other tools. Ignored on import.
    seated: [...c.attachments].map(([lead, hole]) => ({ lead, hole })),
    nets: c.nets.map(n => ({ name: n.name, pins: n.keys.filter(k => !PART_DEFS[state.parts.find(p => p.id === k.split('|')[0])?.type]?.isBoard) }))
      .filter(n => n.pins.length > 1),
  };
}

export function fromProjectFile(data) {
  if (!data || data.format !== FORMAT || !Array.isArray(data.parts) || !Array.isArray(data.wires)) throw new Error('This file is not a Virtual Lab project.');
  // Student-made parts the project carries: validated (data only, never code), then added to the catalogue.
  for (const raw of Array.isArray(data.customParts) ? data.customParts.slice(0, 50) : []) {
    const v = validatePartSpec(raw);
    if (v.ok && v.spec.id === raw.id) registerCustomPart(v.spec);
  }
  const ids = new Set();
  const parts = data.parts.map(p => {
    if (!PART_DEFS[p.type]) throw new Error(`Unknown part type "${p.type}".`);
    ids.add(p.id);
    return { id: String(p.id), type: p.type, x: +p.x || 0, y: +p.y || 0, rot: ((+p.rotate || 0) % 360 + 360) % 360, ...propsOf(p) };
  });
  const wires = data.wires.filter(w => ids.has(w.from?.part) && ids.has(w.to?.part)).map(w => ({
    id: String(w.id), a: { part: w.from.part, pin: String(w.from.pin) }, b: { part: w.to.part, pin: String(w.to.pin) },
    style: w.style || 'straight', color: w.color || '#454d53', width: +w.width || 3, bend: w.bend ?? 0.5, sag: w.sag ?? null,
    kind: WIRE_KINDS[w.kind] ? w.kind : LEGACY_WIRE_KIND,
  }));
  return { parts, wires };
}
