// Parts the student makes: a declarative spec (name, look, pins, and one behaviour from a fixed menu) that
// becomes a real catalogue part — placeable, wireable, simulated, saved with the project, and editable by the AI.
//
// Nothing here runs code from the spec. A behaviour is picked from BEHAVIOURS and only parameterised (which pin
// plays which role, a resistance, a colour), so a spec typed by hand, imported from a file or written by an AI
// can only ever describe a part, never act. validatePartSpec() is the one gate every spec goes through.
//
// Pure (no DOM): the browser registers specs into PART_DEFS; the server validates AI-made ones.
import { PART_DEFS } from './parts.js';
import { LED_COLORS, DEFAULT_LED_COLOR } from './led-colors.js';
import { SETTINGS } from './controls.js';

export const PITCH = 9.6;                       // 0.1 inch in CSS px: pins line up with breadboard holes
const PAD = 14, MIN_W = 76, MIN_H = 56, MAX_PINS = 24;
const SIDES = ['left', 'right', 'top', 'bottom'];
const PIN_ID_RE = /^[A-Za-z0-9+\-_.]{1,12}$/;

export const BEHAVIOURS = {
  none: { label: 'Just connections (no electrical behaviour)', roles: [], note: 'Wires connect to it, nothing flows through it.' },
  resistor: { label: 'Resistor / load between two pins', roles: ['a', 'b'], roleLabels: { a: 'Terminal 1', b: 'Terminal 2' }, note: 'A fixed resistance between two pins (a heater, a buzzer coil, a speaker…).' },
  led: { label: 'Light (an LED inside)', roles: ['anode', 'cathode'], roleLabels: { anode: 'Anode (+)', cathode: 'Cathode (−)' }, note: 'Lights up when current flows from + to −. Needs a series resistor like any LED.' },
  button: { label: 'Push button (press it while running)', roles: ['a', 'b'], roleLabels: { a: 'Contact 1', b: 'Contact 2' }, note: 'Joins the two contacts while you hold it down in the running simulation.' },
  'analog-sensor': { label: 'Analog sensor (a slider sets its output)', roles: ['vcc', 'gnd', 'out'], roleLabels: { vcc: 'Power (VCC)', gnd: 'Ground (GND)', out: 'Signal out' }, note: 'OUT = VCC × the slider position. Read it with analogRead().' },
  'digital-sensor': { label: 'Digital sensor (on / off)', roles: ['vcc', 'gnd', 'out'], roleLabels: { vcc: 'Power (VCC)', gnd: 'Ground (GND)', out: 'Signal out' }, note: 'OUT is HIGH while it is triggered (click it while running), LOW otherwise.' },
};

const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
const hexColor = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toLowerCase() : d);

/**
 * Checks and normalises a spec. Unknown fields are dropped; anything that would make an unusable part is an error.
 * @returns {{ok: true, spec: object} | {ok: false, errors: string[]}}
 */
export function validatePartSpec(raw, { id } = {}) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['A part must be an object.'] };
  const name = str(raw.name, 40);
  if (!name) errors.push('Give the part a name.');
  const pinsIn = Array.isArray(raw.pins) ? raw.pins.slice(0, MAX_PINS + 1) : [];
  if (!pinsIn.length) errors.push('A part needs at least one pin.');
  if (pinsIn.length > MAX_PINS) errors.push(`At most ${MAX_PINS} pins.`);
  const pins = [], seen = new Set();
  for (const p of pinsIn.slice(0, MAX_PINS)) {
    const pid = str(p?.id ?? p?.name, 12).replace(/\s+/g, '_');
    if (!PIN_ID_RE.test(pid)) { errors.push(`Pin name "${pid || '(empty)'}" — use letters, digits, + - _ . (max 12).`); continue; }
    if (seen.has(pid.toLowerCase())) { errors.push(`Two pins are called "${pid}".`); continue; }
    seen.add(pid.toLowerCase());
    pins.push({ id: pid, label: str(p?.label, 40) || pid, side: SIDES.includes(p?.side) ? p.side : 'bottom' });
  }
  const b = raw.behaviour && typeof raw.behaviour === 'object' ? raw.behaviour : { kind: 'none' };
  const kind = BEHAVIOURS[b.kind] ? b.kind : null;
  if (!kind) errors.push(`Unknown behaviour "${str(b.kind, 30)}". Choose one of: ${Object.keys(BEHAVIOURS).join(', ')}.`);
  const behaviour = { kind: kind || 'none', roles: {} };
  if (kind) {
    const used = new Set();
    for (const role of BEHAVIOURS[kind].roles) {
      const pin = pins.find(p => p.id === String(b.roles?.[role] ?? ''));
      if (!pin) { errors.push(`${BEHAVIOURS[kind].roleLabels[role]}: pick which pin it is.`); continue; }
      if (used.has(pin.id)) errors.push(`Pin ${pin.id} can't be both ${BEHAVIOURS[kind].roles.filter(r => b.roles?.[r] === pin.id).map(r => BEHAVIOURS[kind].roleLabels[r]).join(' and ')}.`);
      used.add(pin.id);
      behaviour.roles[role] = pin.id;
    }
    if (kind === 'resistor') {
      const ohms = Number(b.ohms);
      if (!(ohms >= 1 && ohms <= 1e7)) errors.push('Resistance must be between 1 Ω and 10 MΩ.');
      behaviour.ohms = ohms >= 1 && ohms <= 1e7 ? +ohms.toPrecision(4) : 1000;
    }
    if (kind === 'led') behaviour.color = b.color in LED_COLORS ? b.color : DEFAULT_LED_COLOR;
  }
  const breadboard = !!raw.breadboard;
  if (breadboard && pins.some(p => p.side !== 'bottom')) errors.push('To plug into a breadboard, every pin has to be on the bottom edge.');
  if (errors.length) return { ok: false, errors };
  const spec = {
    id: /^custom-[a-z0-9-]{3,40}$/.test(String(raw.id)) ? raw.id : (id || newCustomId()),
    name, label: str(raw.label, 16) || name.slice(0, 16), description: str(raw.description, 200),
    color: hexColor(raw.color, '#2b6cb0'), textColor: hexColor(raw.textColor, '#ffffff'),
    pins, behaviour, breadboard,
  };
  return { ok: true, spec };
}

export const newCustomId = () => `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Box size and pin positions (CSS px, local to the part) from a spec: pins sit on a 0.1" grid along their side. */
export function layoutSpec(spec) {
  const by = s => spec.pins.filter(p => p.side === s);
  const horiz = Math.max(by('top').length, by('bottom').length), vert = Math.max(by('left').length, by('right').length);
  const w = Math.max(MIN_W, Math.ceil((horiz + 1) * PITCH + PAD * 2 + (vert ? 2 * PITCH : 0)));
  const h = Math.max(MIN_H, Math.ceil((vert + 1) * PITCH + PAD * 2 + (horiz ? 2 * PITCH : 0)));
  const along = (n, len) => { const start = (len - (n - 1) * PITCH) / 2; return i => +(start + i * PITCH).toFixed(2); };
  const pins = [];
  for (const side of SIDES) {
    const list = by(side);
    const at = along(list.length, side === 'left' || side === 'right' ? h : w);
    list.forEach((p, i) => {
      const t = at(i);
      const [x, y] = { left: [3, t], right: [w - 3, t], top: [t, 3], bottom: [t, h - 3] }[side];
      pins.push({ id: p.id, label: p.label, x, y, kind: 'pin', side });
    });
  }
  return { w, h, pins };
}

/** The PART_DEFS entry for a spec. */
export function partDefFromSpec(spec) {
  const { w, h, pins } = layoutSpec(spec);
  const k = spec.behaviour.kind;
  const props = k === 'analog-sensor' ? { level: 50 } : undefined;
  const roleText = Object.entries(spec.behaviour.roles).map(([r, p]) => `${p} = ${BEHAVIOURS[k].roleLabels[r]}`).join(', ');
  return {
    type: spec.id, name: spec.name, category: 'My parts', tag: 'cb-custom-part', custom: true, spec,
    w, h, pins, groups: [], insertable: spec.breadboard, layer: 2, ...(props ? { props } : {}),
    interactive: k === 'button' || k === 'digital-sensor',
    aiNote: `Student-made part. ${BEHAVIOURS[k].note}${roleText ? ` (${roleText})` : ''}${k === 'resistor' ? ` Resistance ${spec.behaviour.ohms} Ω.` : ''}${spec.description ? ` Description: ${spec.description}` : ''}`,
  };
}

/** Add (or update) a custom part in the live catalogue. Returns its def. */
export function registerCustomPart(spec) {
  const def = partDefFromSpec(spec);
  def.pinById = new Map(def.pins.map(p => [p.id, p]));
  PART_DEFS[spec.id] = def;
  if (spec.behaviour.kind === 'analog-sensor') {
    SETTINGS[spec.id] = { title: spec.name, note: BEHAVIOURS['analog-sensor'].note, fields: [{ key: 'level', label: 'Output', kind: 'range', min: 0, max: 100, step: 1, fmt: v => `${Math.round(v)} %` }] };
  } else delete SETTINGS[spec.id];
  return def;
}

export const isCustomType = type => /^custom-/.test(String(type)) && !!PART_DEFS[type]?.custom;
export const customTypes = () => Object.keys(PART_DEFS).filter(isCustomType);
/** The specs a project uses, for saving them inside the project file. */
export const specsUsed = parts => [...new Set(parts.map(p => p.type))].filter(isCustomType).map(t => PART_DEFS[t].spec);

/** One catalogue line per custom part, in the same shape describeCatalog() uses — for the AI prompt. */
export function describeCustomSpecs(specs) {
  const out = [];
  for (const raw of Array.isArray(specs) ? specs.slice(0, 20) : []) {
    const v = validatePartSpec(raw);
    if (!v.ok) continue;
    out.push(`- ${v.spec.id}: pins ${v.spec.pins.map(p => p.id).join(', ')}${v.spec.behaviour.kind === 'analog-sensor' ? ' props: level' : ''} — "${v.spec.name}". ${partDefFromSpec(v.spec).aiNote}`);
  }
  return out.join('\n');
}
