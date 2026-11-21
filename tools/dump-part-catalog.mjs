// Dump the built-in part templates the Part Maker model learns from (kinds it can express) → scripts/part-model/templates.json
import { TEMPLATES } from '../src/core/part-templates.js';
import { writeFileSync } from 'node:fs';
const KINDS = new Set(['variable-resistor', 'diode', 'npn', 'pnp', 'nmos', 'pmos', 'regulator', 'capacitor', 'inductor', 'buzzer', 'motor', 'servo', 'ultrasonic', 'encoder', 'analog-sensor', 'digital-sensor', 'opamp', 'inamp', 'relay', 'switch']);
const KEEP = ['ohms', 'min', 'vf', 'vz', 'beta', 'vth', 'rds', 'imax', 'vout', 'drop', 'mode', 'uF', 'mH', 'rs', 'pick', 'vmin', 'gain', 'range', 'minUs', 'maxUs'];
const asc = s => String(s).replace(/Ω/g, 'ohm').replace(/[µμ]/g, 'u').replace(/[^\x20-\x7e]/g, '');
const out = TEMPLATES.filter(t => KINDS.has(t.behaviour.kind) && t.pins.length && !t.pins.some(p => /\.\d$/.test(p.id))).map(t => ({
  id: t.id, name: asc(t.name), label: asc(t.label), kind: t.behaviour.kind, pins: t.pins.map(p => p.id),
  params: Object.fromEntries(KEEP.filter(k => t.behaviour[k] !== undefined && typeof t.behaviour[k] !== 'object').map(k => [k, t.behaviour[k]])),
}));
writeFileSync(new URL('../scripts/part-model/templates.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(out.length, 'templates');
