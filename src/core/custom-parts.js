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
import { validateLogicBehaviour, compileLogic, describeLogic } from './logic.js';
import { EXTRA_BEHAVIOURS, ICON_KINDS, cleanParams } from './behaviours-extra.js';
import { TEMPLATES, POPULAR } from './part-templates.js';

export const PITCH = 9.6;                       // 0.1 inch in CSS px: pins line up with breadboard holes
const PAD = 14, MIN_W = 76, MIN_H = 56, ICON_MIN_H = 76, MAX_PINS = 64;
const DIP_PAD = 13;

/**
 * The shapes a part can come in. `auto` means the datasheet's pin numbering decides where every leg goes, so
 * the student lists pins from pin 1 and never picks sides; `rows` is the spacing between the two rows of a
 * through-hole chip, in 0.1" units, which is what lets it straddle a breadboard.
 */
export const PACKAGES = {
  module: { label: 'Module / breakout board', auto: false, hint: 'you place each pin' },
  dip: { label: 'DIP chip, 0.3" (8–20 pins: 555, 4051, 74HC595…)', auto: true, rows: 3, step: 2, insert: true, hint: 'in datasheet order, pin 1 first' },
  'dip-wide': { label: 'DIP chip, 0.6" wide (28–40 pins: ATmega328P, 8051…)', auto: true, rows: 6, step: 2, insert: true, hint: 'in datasheet order, pin 1 first' },
  quad: { label: 'Quad flat pack — pins on all four sides (QFP/QFN: a microprocessor)', auto: true, step: 4, insert: false, hint: 'in datasheet order from pin 1, anticlockwise' },
};
export const DEFAULT_PACKAGE = 'module';
const SIDES = ['left', 'right', 'top', 'bottom'];
const PIN_ID_RE = /^[A-Za-z0-9+\-_.]{1,12}$/;

export const BEHAVIOURS = {
  none: { label: 'Just connections (no electrical behaviour)', roles: [], note: 'Wires connect to it, nothing flows through it.' },
  resistor: { label: 'Resistor / load between two pins', roles: ['a', 'b'], roleLabels: { a: 'Terminal 1', b: 'Terminal 2' }, note: 'A fixed resistance between two pins (a heater, a buzzer coil, a speaker…).' },
  led: { label: 'Light (an LED inside)', roles: ['anode', 'cathode'], roleLabels: { anode: 'Anode (+)', cathode: 'Cathode (−)' }, note: 'Lights up when current flows from + to −. Needs a series resistor like any LED.' },
  button: { label: 'Push button (press it while running)', roles: ['a', 'b'], roleLabels: { a: 'Contact 1', b: 'Contact 2' }, note: 'Joins the two contacts while you hold it down in the running simulation.' },
  'analog-sensor': { label: 'Analog sensor (a slider sets its output)', roles: ['vcc', 'gnd', 'out'], roleLabels: { vcc: 'Power (VCC)', gnd: 'Ground (GND)', out: 'Signal out' }, note: 'OUT = VCC × the slider position. Read it with analogRead().' },
  mux: {
    label: 'Multiplexer (select pins pick a channel)', roles: ['vcc', 'gnd', 'common'], optional: ['enable'],
    roleLabels: { vcc: 'Power (VCC)', gnd: 'Ground (GND)', common: 'Common pin (SIG / Z)', enable: 'Enable (EN, active LOW — optional)' },
    lists: { select: 'Select pins, S0 first', channels: 'Channel pins, C0 first' },
    note: 'The common pin is joined (≈ 70 Ω) to channel n, where n is the binary number on the select pins (S0 = 1, S1 = 2, S2 = 4, S3 = 8). Works both ways, analog or digital, like a CD74HC4067 / 74HC4051. With EN HIGH (or no power) nothing is connected.',
  },
  logic: {
    label: 'Rules (a chip: gates, shift register, counter, latch…)', roles: ['vcc', 'gnd'], optional: ['enable'],
    roleLabels: { vcc: 'Power (VCC)', gnd: 'Ground (GND)', enable: 'Output enable (active LOW — optional)' },
    rules: true,
    note: 'You write what the chip remembers and what it drives, as arithmetic. A pin reads 1 above half the supply; rising(CLK) is true on the clock edge that just happened.',
  },
  'digital-sensor': { label: 'Digital sensor (on / off)', roles: ['vcc', 'gnd', 'out'], roleLabels: { vcc: 'Power (VCC)', gnd: 'Ground (GND)', out: 'Signal out' }, note: 'OUT is HIGH while it is triggered (click it while running), LOW otherwise.' },
};

Object.assign(BEHAVIOURS, EXTRA_BEHAVIOURS);

const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
const hexColor = (v, d) => {
  const t = String(v).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  return /^#[0-9a-f]{3}$/.test(t) ? `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}` : d;      // #abc → #aabbcc
};

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
    for (const role of BEHAVIOURS[kind].optional || []) {
      const want = String(b.roles?.[role] ?? '');
      if (!want) continue;
      const pin = pins.find(p => p.id === want);
      if (!pin) { errors.push(`${BEHAVIOURS[kind].roleLabels[role]}: there is no pin "${want}".`); continue; }
      if (used.has(pin.id)) { errors.push(`Pin ${pin.id} already has another job.`); continue; }
      used.add(pin.id); behaviour.roles[role] = pin.id;
    }
    for (const [list, what] of Object.entries(BEHAVIOURS[kind].lists || {})) {
      const ids = (Array.isArray(b[list]) ? b[list] : String(b[list] ?? '').split(/[\s,]+/)).map(v => String(v).trim()).filter(Boolean);
      const out = [];
      for (const want of ids.slice(0, 16)) {
        const pin = pins.find(p => p.id === want);
        if (!pin) { errors.push(`${what}: there is no pin "${want}".`); continue; }
        if (used.has(pin.id)) { errors.push(`Pin ${pin.id} already has another job.`); continue; }
        used.add(pin.id); out.push(pin.id);
      }
      behaviour[list] = out;
    }
    if (kind === 'mux') {
      const s = behaviour.select.length, c = behaviour.channels.length;
      if (s < 1 || s > 4) errors.push('A multiplexer needs 1–4 select pins.');
      if (c < 2) errors.push('A multiplexer needs at least 2 channel pins.');
      else if (s >= 1 && c > 2 ** s) errors.push(`${s} select pin${s > 1 ? 's' : ''} can only pick ${2 ** s} channels, but there are ${c}.`);
    }
    if (kind === 'resistor') {
      const ohms = Number(b.ohms);
      if (!(ohms >= 1 && ohms <= 1e7)) errors.push('Resistance must be between 1 Ω and 10 MΩ.');
      behaviour.ohms = ohms >= 1 && ohms <= 1e7 ? +ohms.toPrecision(4) : 1000;
    }
    if (kind === 'led') behaviour.color = b.color in LED_COLORS ? b.color : DEFAULT_LED_COLOR;
    if (BEHAVIOURS[kind].params) {
      Object.assign(behaviour, cleanParams(BEHAVIOURS[kind], b));
      if (kind === 'variable-resistor') behaviour.min = Math.min(behaviour.min, behaviour.ohms);
    }
    if (kind === 'led-array' && behaviour.segments.length < 1) errors.push('An LED array needs at least one LED pin.');
    if (kind === 'stepper' && behaviour.coils.length !== 4) errors.push('A stepper motor needs exactly 4 coil input pins (IN1…IN4).');
    if (kind === 'logic') {
      const v = validateLogicBehaviour(b, pins.map(p => p.id), behaviour.roles);
      if (v.ok) Object.assign(behaviour, { vars: v.behaviour.vars, rules: v.behaviour.rules, outputs: v.behaviour.outputs, analog: v.behaviour.analog });
      else errors.push(...v.errors);
    }
  }
  const pkg = PACKAGES[raw.package] ? raw.package : DEFAULT_PACKAGE;
  const shape = PACKAGES[pkg];
  // A through-hole chip always straddles the trench; a surface-mount one can never plug in at all.
  const breadboard = shape.auto ? !!shape.insert : !!raw.breadboard;
  if (shape.auto) {
    const min = shape.step === 4 ? 8 : 4;
    if (pins.length < min) errors.push(`A ${shape.label.split(/[,—(]/)[0].trim()} needs at least ${min} pins.`);
    else if (pins.length % shape.step) {
      errors.push(shape.step === 4
        ? `A quad flat pack has the same number of pins on each of its four sides, so the total has to divide by 4 (you have ${pins.length}).`
        : `A DIP chip has the same number of pins on each side, so the total has to be even (you have ${pins.length}).`);
    }
  } else if (breadboard && pins.some(p => p.side !== 'bottom')) {
    errors.push('To plug into a breadboard, every pin of a module has to be on the bottom edge (or choose a chip package).');
  }
  if (errors.length) return { ok: false, errors };
  const spec = {
    id: /^custom-[a-z0-9-]{3,40}$/.test(String(raw.id)) ? raw.id : (id || newCustomId()),
    name, label: str(raw.label, 16) || name.slice(0, 16), description: str(raw.description, 200),
    color: hexColor(raw.color, '#2b6cb0'), textColor: hexColor(raw.textColor, '#ffffff'),
    pins, behaviour, breadboard, package: pkg,
  };
  return { ok: true, spec };
}

export const newCustomId = () => `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Box size and pin positions (CSS px, local to the part) from a spec: pins sit on a 0.1" grid along their side. */
export function layoutSpec(spec) {
  if (spec.package === 'quad') return layoutQuad(spec);
  if (PACKAGES[spec.package]?.rows) return layoutDip(spec, PACKAGES[spec.package].rows * PITCH);
  const by = s => spec.pins.filter(p => p.side === s);
  const horiz = Math.max(by('top').length, by('bottom').length), vert = Math.max(by('left').length, by('right').length);
  // side pins print their names inside the body, so leave room for them either side of the part's own label
  const longest = side => Math.max(0, ...by(side).map(p => p.id.length));
  const textRoom = vert ? Math.ceil((longest('left') + longest('right')) * 3.6 + String(spec.label || '').length * 5.6 + 34) : 0;
  const w = Math.max(MIN_W, textRoom, Math.ceil((horiz + 1) * PITCH + PAD * 2 + (vert ? 2 * PITCH : 0)));
  const h = Math.max(ICON_KINDS.has(spec.behaviour?.kind) ? ICON_MIN_H : MIN_H, Math.ceil((vert + 1) * PITCH + PAD * 2 + (horiz ? 2 * PITCH : 0)));   // a part with a symbol in the middle needs room for it above the pin names
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

/**
 * A DIP chip, laid out the way the package really is: two rows of legs 0.3" apart — exactly the width of a
 * breadboard's centre trench, so it straddles it like the real thing — with pin 1 at the bottom left and the
 * numbering running anticlockwise (along the bottom, then back along the top), notch on the left.
 */
export const DIP_ROWS = 3 * PITCH;       // 0.3 inch between the two rows of legs
function layoutDip(spec, rows = DIP_ROWS) {
  const n = spec.pins.length, half = Math.ceil(n / 2);
  const w = Math.max(MIN_W, Math.round((half - 1) * PITCH + DIP_PAD * 2));
  const h = Math.round(rows + DIP_PAD * 2);
  const x0 = (w - (half - 1) * PITCH) / 2;
  const yBot = (h + rows) / 2, yTop = (h - rows) / 2;
  const pins = spec.pins.map((p, i) => {
    const bottom = i < half;
    const col = bottom ? i : n - 1 - i;                       // top row runs back from the right
    return { id: p.id, label: p.label, x: +(x0 + col * PITCH).toFixed(2), y: bottom ? yBot : yTop, kind: 'pin', side: bottom ? 'bottom' : 'top', number: i + 1 };
  });
  return { w, h, pins };
}

/**
 * A quad flat pack — the microprocessor shape: pins on all four sides, numbered the way every QFP datasheet
 * numbers them, anticlockwise seen from above starting at the top of the left side. Surface mount, so unlike a
 * DIP it doesn't plug into a breadboard; on a real bench it would sit on a breakout board.
 */
function layoutQuad(spec) {
  const n = spec.pins.length, k = n / 4, span = (k - 1) * PITCH;
  const longest = Math.max(0, ...spec.pins.map(p => String(p.id).length));
  const pad = Math.max(20, Math.ceil(longest * 2.5) + 14);     // room for the pin names printed inside the body
  const size = Math.max(MIN_W, Math.ceil(span + pad * 2));
  const at = i => +((size - span) / 2 + i * PITCH).toFixed(2);
  const pins = spec.pins.map((p, i) => {
    const side = ['left', 'bottom', 'right', 'top'][Math.floor(i / k)];
    const j = i % k;
    const t = at(side === 'right' || side === 'top' ? k - 1 - j : j);   // the right side runs upward, the top runs back to the left
    const [x, y] = { left: [3, t], bottom: [t, size - 3], right: [size - 3, t], top: [t, 3] }[side];
    return { id: p.id, label: p.label, x, y, kind: 'pin', side, number: i + 1 };
  });
  return { w: size, h: size, pins };
}

/** The PART_DEFS entry for a spec. */
export function partDefFromSpec(spec) {
  const { w, h, pins } = layoutSpec(spec);
  const k = spec.behaviour.kind, B = BEHAVIOURS[k];
  const props = k === 'analog-sensor' ? { level: 50 } : B.props ? { ...B.props } : undefined;
  const logic = k === 'logic' ? compileLogic(spec) : null;
  const roleText = [...Object.entries(spec.behaviour.roles).map(([r, p]) => `${p} = ${B.roleLabels[r]}`),
    ...Object.keys(B.lists || {}).map(l => `${B.lists[l]}: ${spec.behaviour[l].join(', ')}`)].join('; ');
  const paramText = (B.params || []).map(p => `${p.label} ${spec.behaviour[p.key]}${p.unit ? ` ${p.unit}` : ''}`).join(', ');
  return {
    type: spec.id, name: spec.name, category: BUILTIN_CATEGORY.get(spec.id) || 'My parts', tag: 'cb-custom-part', custom: true, spec, ...(BUILTIN_CATEGORY.has(spec.id) ? { builtin: true } : {}),
    w, h, pins, groups: [], insertable: spec.breadboard, layer: 2, ...(props ? { props } : {}), ...(logic ? { logic } : {}),
    interactive: k === 'button' || k === 'digital-sensor' || !!B.toggle || k === 'encoder',
    aiNote: `Student-made part. ${B.note}${roleText ? ` (${roleText})` : ''}${k === 'resistor' ? ` Resistance ${spec.behaviour.ohms} Ω.` : ''}${paramText ? ` Settings: ${paramText}.` : ''}${k === 'logic' ? ` ${describeLogic(spec.behaviour)}` : ''}${spec.description ? ` Description: ${spec.description}` : ''}`,
  };
}

const BUILTIN_CATEGORY = new Map(TEMPLATES.filter(t => POPULAR[t.id]).map(t => [`custom-${t.id}`, POPULAR[t.id]]));

/** Add (or update) a custom part in the live catalogue. Returns its def. */
export function registerCustomPart(spec) {
  const def = partDefFromSpec(spec);
  def.pinById = new Map(def.pins.map(p => [p.id, p]));
  PART_DEFS[spec.id] = def;
  if (spec.behaviour.kind === 'analog-sensor') {
    SETTINGS[spec.id] = { title: spec.name, note: BEHAVIOURS['analog-sensor'].note, fields: [{ key: 'level', label: 'Output', kind: 'range', min: 0, max: 100, step: 1, fmt: v => `${Math.round(v)} %` }] };
  } else if (BEHAVIOURS[spec.behaviour.kind].settings) {
    SETTINGS[spec.id] = { title: spec.name, note: BEHAVIOURS[spec.behaviour.kind].note, fields: BEHAVIOURS[spec.behaviour.kind].settings };
  } else delete SETTINGS[spec.id];
  return def;
}

export const customTypes = () => Object.keys(PART_DEFS).filter(isCustomType).filter(t => !PART_DEFS[t].builtin);
export const builtinTypes = () => Object.keys(PART_DEFS).filter(t => PART_DEFS[t].builtin);
export const isCustomType = type => /^custom-/.test(String(type)) && !!PART_DEFS[type]?.custom;
/** The specs a project uses, for saving them inside the project file. */
export const specsUsed = parts => [...new Set(parts.map(p => p.type))].filter(isCustomType).map(t => PART_DEFS[t].spec);

/** One catalogue line per custom part, in the same shape describeCatalog() uses — for the AI prompt. */
export function describeCustomSpecs(specs) {
  const out = [];
  for (const raw of Array.isArray(specs) ? specs.slice(0, 20) : []) {
    const v = validatePartSpec(raw);
    if (!v.ok) continue;
    out.push(`- ${v.spec.id}: pins ${v.spec.pins.map(p => p.id).join(', ')}${Object.keys(partDefFromSpec(v.spec).props || {}).length ? ` props: ${Object.keys(partDefFromSpec(v.spec).props).join(', ')}` : ''} — "${v.spec.name}". ${partDefFromSpec(v.spec).aiNote}`);
  }
  return out.join('\n');
}

// The popular parts are part of the default catalogue: registered here, before any project loads.
for (const t of TEMPLATES) {
  if (!POPULAR[t.id]) continue;
  const { id: _i, group: _g, ...raw } = t;
  const v = validatePartSpec({ ...raw, id: `custom-${t.id}` });
  if (v.ok) registerCustomPart(v.spec);
}
