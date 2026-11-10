// Everyday robot parts for the Assembly view: hobby servos, links, base plates, wheels, gear motors, casters and battery holders.
// Like the drone parts, nothing here is a stored model. A part is a short id (servo-sg90, link-80, plate-100x80, wheel-65, gearmotor-tt …) and its
// holes, size, mass and look are worked out from that id, so the same id always gives the same part and scenes and the AI can refer to parts by id.
// Hole sizes use the clearance size of the screw the pattern calls for, so a servo horn, a link and a screw agree and a mismatch shows in the joint check.
import { THREADS, ROBOT_PART_FORMAT, ROBOT_PART_VERSION } from './robot-part.js';

const clear = screw => THREADS[screw]?.[1] ?? 3.4;
const r2 = v => Math.round(v * 100) / 100;
const hole = (id, pos, dir, diameter, source = 'estimated') => ({ id, kind: 'hole', pos: pos.map(r2), dir, diameter, source });
const UP = [0, 0, 1], DOWN = [0, 0, -1];
/** The SG90's ear-to-ear screw distance: plates and links carry holes at this spacing so a servo can be screwed down with both ears. */
const SERVO_EAR = 27.6;
const fin = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

/** Hobby servos. Body L (along Y) × W (along X) × H, the mounting ears are `ear` long in total at height `earZ`, the output shaft sits `shaftOff` in from the +Y end.
 *  Numbers for the SG90 / MG90S / MG996R come from their datasheets; the others are typical for the class. */
export const SERVOS = {
  sg90:   { name: 'SG90 micro servo',   L: 22.5, W: 12.2, H: 22.7, ear: 32.2, earHole: 27.6, earZ: 15.9, earT: 2.5, shaftOff: 5.8, shaftD: 4.8, shaftH: 3.2, horn: 'M2', mass: 9,    torque: 0.176, speed: 600, volts: 4.8, stall: 0.65, real: true },
  mg90s:  { name: 'MG90S metal-gear servo', L: 22.8, W: 12.4, H: 28.5, ear: 32.5, earHole: 28.0, earZ: 19.0, earT: 2.5, shaftOff: 5.8, shaftD: 4.8, shaftH: 3.6, horn: 'M2', mass: 13.4, torque: 0.216, speed: 545, volts: 4.8, stall: 0.7, real: true },
  mg996r: { name: 'MG996R servo',       L: 40.7, W: 19.7, H: 42.9, ear: 53.5, earHole: 49.5, earZ: 28.5, earT: 3, shaftOff: 10, shaftD: 5.8, shaftH: 4.5, horn: 'M3', mass: 55,   torque: 0.92, speed: 300, volts: 4.8, stall: 2.5, real: true },
  // DSSERVO RDS51150 (150 kg, dual shaft): no ears. It is bolted down by M2.5 holes tapped into its two large faces (drawing DSSERVO-RDS51150-Drawing.pdf: body 65 × 30 × 48, standing on its lower shaft so the part spans z 0 to 61.4, 4 holes on a 24 × 24 pattern on the top face, 3 on the bottom, 61.4 over both horns). Shaft 13.4 mm in from the +Y end.
  rds51150: { name: 'RDS51150 servo (150 kg, dual shaft)', style: 'block', L: 65, W: 30, H: 48, ear: 0, earHole: 24, earZ: 0, earT: 0, shaftOff: 13.4, shaftD: 12, shaftH: 6.7, horn: 'M3', mass: 163, torque: 16.2, speed: 286, volts: 12, stall: 8, real: true,
    faceTop: [[-12, -29.5], [12, -29.5], [-12, -5.5], [12, -5.5]], faceBottom: [[12, -29.5], [-12, -29.5], [12, -17.5]], faceScrew: 'M2.5' },
  ds3218: { name: 'DS3218 servo (20 kg)', L: 40.2, W: 20.2, H: 40.5, ear: 54.5, earHole: 49.5, earZ: 27, earT: 3, shaftOff: 10, shaftD: 5.8, shaftH: 4.5, horn: 'M3', mass: 60,   torque: 1.96, speed: 340, volts: 6.0, stall: 3.2, real: false },
};
/** Size classes of hobby servo: servos of one class share their ear and screw pattern, so a student only has to pick a class (and measure the case if theirs is a little different). */
export const SERVO_CLASSES = {
  micro:    { base: 'sg90',     label: 'Micro (9 g, like an SG90)',            blurb: 'Small, 2 ears, about 23 × 12 × 23 mm' },
  mini:     { base: 'mg90s',    label: 'Mini (13 g, like an MG90S)',           blurb: 'Metal gears, 2 ears, about 23 × 12 × 28 mm' },
  standard: { base: 'mg996r',   label: 'Standard (55 g, like an MG996R / DS3218)', blurb: 'The common big hobby servo, 2 ears, about 40 × 20 × 43 mm' },
  block:    { base: 'rds51150', label: 'Block (150 kg, like an RDS51150)',     blurb: 'No ears, screw holes in the big faces, a shaft on both ends' },
};
/** Popular models people type in: the class they belong to and what is printed on the box. torque kg·cm, speed s per 60°, volts. Sizes only where we know them; the rest follow the class. */
export const KNOWN_SERVOS = {
  sg90: ['micro', {}], 'sg 90': ['micro', {}], mg90s: ['mini', {}], mg90: ['mini', {}], mg995: ['standard', { torque: 10, speed: 0.20, volts: 6 }], mg996r: ['standard', {}], mg946r: ['standard', { torque: 13, speed: 0.17, volts: 6 }],
  ds3218: ['standard', {}], ds3225: ['standard', { torque: 25, speed: 0.15, volts: 6.8 }], rds3225: ['standard', { torque: 25, speed: 0.15, volts: 6.8 }], rds51150: ['block', {}], ds3115: ['standard', { torque: 15, speed: 0.16, volts: 6 }],
};
/** Look a typed servo name up in the known list → { cls, over } or null. Spaces, dashes and case do not matter. */
export function findKnownServo(text) { const t = String(text || '').toLowerCase().replace(/[^a-z0-9]/g, ''); for (const [k, v] of Object.entries(KNOWN_SERVOS)) if (t.includes(k.replace(/[^a-z0-9]/g, ''))) return { cls: v[0], over: v[1], name: k.toUpperCase() }; return null; }
/** The id of a servo made from a class and the numbers a student can read or measure. Any number left out comes from the class. */
export function servoId(cls, o = {}) {
  const t = [['L', o.L], ['W', o.W], ['H', o.H], ['T', o.torque], ['S', o.speed], ['V', o.volts], ['M', o.mass]].filter(([, v]) => Number.isFinite(v) && v > 0).map(([k, v]) => `${k}${+Number(v).toFixed(2)}`);
  return ['servo-x', cls, ...t].join('-');
}
function customServo(cls, tokens) {
  const base = SERVOS[SERVO_CLASSES[cls].base], v = {}; for (const t of tokens) { const m = /^([LWHTSVM])(\d+(?:\.\d+)?)$/.exec(t); if (!m) return null; v[m[1]] = Number(m[2]); }
  const k = v.L ? v.L / base.L : 1, kh = v.H ? v.H / base.H : 1, L = fin(v.L ?? base.L, 12, 120, base.L), W = fin(v.W ?? base.W, 6, 60, base.W), H = fin(v.H ?? base.H, 10, 100, base.H);
  const out = { ...base, name: tokens.length ? `Custom ${SERVO_CLASSES[cls].label.split(' (')[0].toLowerCase()} servo ${r2(L)}×${r2(W)}×${r2(H)}` : `Servo, ${SERVO_CLASSES[cls].label.split(' (')[0].toLowerCase()}`, L, W, H, real: false,
    ear: r2(base.ear * k), earHole: r2(base.earHole * k), earZ: r2(base.earZ * kh), shaftOff: r2(Math.min(base.shaftOff * k, L / 2 - 2)) };
  if (base.faceTop) { const kw = W / base.W; out.faceTop = base.faceTop.map(([x, y]) => [r2(x * kw), r2(y * k)]); out.faceBottom = base.faceBottom.map(([x, y]) => [r2(x * kw), r2(y * k)]); out.earHole = r2(base.earHole * kw); }
  if (v.T) out.torque = r2(v.T * 0.0980665);                       // the box says kg·cm; physics wants N·m
  if (v.S) out.speed = r2(60 / v.S);                               // the box says seconds per 60°; the simulator wants °/s
  if (v.V) out.volts = v.V; if (v.M) out.mass = v.M;
  return out;
}
/** Gear motors and the wheel bore each one wants. */
export const GEARMOTORS = {
  tt:  { name: 'TT gear motor (yellow, 1:48)', L: 64.5, W: 22.5, H: 18.6, shaftD: 5.4, shaftLen: 9, gearbox: 37, mountSpacing: 22, mountScrew: 'M3', mass: 30, volts: 6, rpm: 200, stallTorque: 0.8, real: true },
  n20: { name: 'N20 micro gear motor', L: 22, W: 12, H: 10, shaftD: 3, shaftLen: 9, gearbox: 9, mountSpacing: 9, mountScrew: 'M1_6', mass: 10, volts: 6, rpm: 100, stallTorque: 0.12, real: true },
};

/** A part id → numbers, or null. */
export function parseKitId(id) {
  const s = String(id || ''); let m;
  if ((m = /^servo-x-(micro|mini|standard|block)((?:-[LWHTSVM]\d+(?:\.\d+)?)*)$/.exec(s))) { const sv = customServo(m[1], m[2].split('-').filter(Boolean)); return sv ? { kind: 'servo', key: `x-${m[1]}`, servo: sv } : null; }
  if ((m = /^servo-([a-z0-9]+)$/.exec(s)) && SERVOS[m[1]]) return { kind: 'servo', key: m[1] };
  if ((m = /^link-(\d{1,3}(?:\.\d)?)(?:-(m2|m3))?$/.exec(s))) { const len = fin(Number(m[1]), 15, 400, 60); return { kind: 'link', len, screw: (m[2] || (len > 90 ? 'm3' : 'm2')).toUpperCase() }; }
  if ((m = /^plate-(\d{2,3})x(\d{2,3})(?:-f(\d{1,2}))?$/.exec(s))) return { kind: 'plate', w: fin(Number(m[1]), 30, 400, 100), l: fin(Number(m[2]), 30, 400, 80), feet: m[3] ? fin(Number(m[3]), 4, 60, 18) : 0 };
  if ((m = /^wheel-(\d{2,3})(?:-b([\d.]+))?$/.exec(s))) { const dia = fin(Number(m[1]), 20, 200, 65); return { kind: 'wheel', dia, bore: m[2] ? fin(Number(m[2]), 1.5, 12, 5.5) : (dia <= 50 ? 3.1 : 5.5) }; }
  if ((m = /^gearmotor-([a-z0-9]+)$/.exec(s)) && GEARMOTORS[m[1]]) return { kind: 'gearmotor', key: m[1] };
  if ((m = /^bracket-([a-z0-9]+)$/.exec(s)) && SERVOS[m[1]] && SERVOS[m[1]].style !== 'block') return { kind: 'bracket', key: m[1] };
  if (s === 'caster-ball') return { kind: 'caster' };
  if ((m = /^holder-(2|4)aa$/.exec(s))) return { kind: 'holder', cells: Number(m[1]) };
  return null;
}

/** The geometry a part needs, in numbers (the viewer turns it into a shape). Z up, centred in X and Y, resting on z = 0. */
/** The four screw holes of a cross horn, up to 8 mm from the shaft (less on a narrow servo, so the holes stay on the part). A part screwed to these (or to the shaft itself) turns with the servo: see buildRig in assembly-pose.js. */
const hornHoles = (yShaft, z, dir, src, tail = '', R = 8) => [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([x, y], k) => hole(`horn-${k + 1}${tail}`, [x * R, yShaft + y * R, z], dir, 2.2, src));
export function makeKitPart(id) {
  const d = parseKitId(id); if (!d) return null;
  const base = { format: ROBOT_PART_FORMAT, version: ROBOT_PART_VERSION, id, model: { file: `${id}.gen`, format: 'gen', units: 'mm', up: 'z' } };
  if (d.kind === 'servo') {
    const s = d.servo || SERVOS[d.key], src = s.real ? 'datasheet' : 'estimated', hd = clear(s.horn), hr = Math.min(8, s.W / 2 - 0.6, s.L / 2 - Math.abs(s.L / 2 - s.shaftOff) - 0.6), yShaft = s.L / 2 - s.shaftOff, top = s.H + s.shaftH, ex = s.earHole / 2;
    if (s.style === 'block') {                                                                                                                   // no ears: M2.5 holes in the two big faces, and a shaft out of each
      const fh = clear(s.faceScrew), at = ([x, y]) => [x, y];
      return { ...base, category: 'Servos', name: s.name, mass: { grams: s.mass, source: src }, dims: { size: [s.W, s.L, s.H + 2 * s.shaftH], source: src }, kit: { ...d, servo: s, yShaft, top },
        frames: [
          ...s.faceTop.map((p, k) => hole(`face-top-${k + 1}`, [...at(p), s.H + s.shaftH], UP, fh, src)),
          ...s.faceBottom.map((p, k) => hole(`face-bottom-${k + 1}`, [...at(p), s.shaftH], DOWN, fh, src)),
          { id: 'shaft', kind: 'shaft', pos: [0, yShaft, top + s.shaftH].map(r2), dir: UP, diameter: s.shaftD, source: src },
          { id: 'shaft-bottom', kind: 'shaft', pos: [0, yShaft, 0].map(r2), dir: DOWN, diameter: s.shaftD, source: src },
          hole('horn-screw', [0, yShaft, top + s.shaftH], UP, hd, src), hole('horn-screw-bottom', [0, yShaft, 0], DOWN, hd, src),
          ...hornHoles(yShaft, top + s.shaftH, UP, src, '', hr), ...hornHoles(yShaft, 0, DOWN, src, '-bottom', hr),
        ] };
    }
    return { ...base, category: 'Servos', name: s.name, mass: { grams: s.mass, source: src }, dims: { size: [s.W, s.ear, top], source: src }, kit: { ...d, servo: s, yShaft, top },
      frames: [
        hole('ear-1-top', [0, ex, s.earZ + s.earT], UP, 2.4, src), hole('ear-1-bottom', [0, ex, s.earZ], DOWN, 2.4, src),
        hole('ear-2-top', [0, -ex, s.earZ + s.earT], UP, 2.4, src), hole('ear-2-bottom', [0, -ex, s.earZ], DOWN, 2.4, src),
        { id: 'shaft', kind: 'shaft', pos: [0, yShaft, top].map(r2), dir: UP, diameter: s.shaftD, source: src },
        hole('horn-screw', [0, yShaft, top], UP, hd, src),
        ...hornHoles(yShaft, top, UP, src, '', hr),
        hole('base-1', [0, -s.L / 2 + 3, 0], DOWN, 2.4, 'estimated'),
      ] };
  }
  if (d.kind === 'link') {
    const w = d.len > 90 ? 16 : 12, t = 3, hd = clear(d.screw), pts = [0, 1, 2].map(k => -d.len / 2 + 6 + k * (d.len - 12) / 2).map(r2);   // end, middle, end
    // two more holes a servo's ear-to-ear distance (27.6 mm, the SG90) in from each end, so a servo can be fixed to the end of a link with two screws
    const pair = d.len >= 52 ? [[-pts[2] + SERVO_EAR, 'pair-1'], [pts[2] - SERVO_EAR, 'pair-2']] : [];
    return { ...base, category: 'Structure', name: `Link ${d.len} mm (${d.screw})`, mass: { grams: r2(d.len * w * t * 0.0012), source: 'estimated' }, dims: { size: [d.len, w, t], source: 'estimated' }, kit: { ...d, w, t, hd, pts, pairs: pair.map(q => r2(q[0])) },
      frames: [...pts.flatMap((x, k) => [hole(`hole-${k + 1}-top`, [x, 0, t], UP, hd), hole(`hole-${k + 1}-bottom`, [x, 0, 0], DOWN, hd)]), ...pair.flatMap(([x, id]) => [hole(`${id}-top`, [x, 0, t], UP, hd), hole(`${id}-bottom`, [x, 0, 0], DOWN, hd)])] };
  }
  if (d.kind === 'plate') {
    const t = 3, f = d.feet, hd = clear('M3'); let pitch = 10; while (((Math.floor((d.w - 12) / pitch) + 1) * (Math.floor((d.l - 12) / pitch) + 1)) > 90) pitch += 5;
    const nx = Math.floor((d.w - 12) / pitch), ny = Math.floor((d.l - 12) / pitch), frames = [];
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) { const x = -nx * pitch / 2 + i * pitch, y = -ny * pitch / 2 + j * pitch; frames.push(hole(`h${i + 1}-${j + 1}-top`, [x, y, f + t], UP, hd), hole(`h${i + 1}-${j + 1}-bottom`, [x, y, f], DOWN, hd)); }
    // the mounting holes of the common servos, in the middle of the plate. On a plate with feet there is an opening there for the servo's body to hang through (as on a real arm base)
    const servoHoles = [['sv-sg90', 13.8], ['sv-mg996r', 24.75]].filter(([, y]) => d.l > 2 * y + 12).flatMap(([n, y]) => [[`${n}-1-top`, y], [`${n}-2-top`, -y]].map(([id, yy]) => hole(id, [0, yy, f + t], UP, 2.4)));
    const opening = f && d.l > 40 ? [13, 24] : null;
    return { ...base, category: 'Structure', name: `Base plate ${d.w}×${d.l} mm${f ? ` on ${f} mm feet` : ''}`, mass: { grams: r2(d.w * d.l * t * 0.0012 + (f ? 4 * f * 0.1 : 0)), source: 'estimated' }, dims: { size: [d.w, d.l, f + t], source: 'estimated' }, kit: { ...d, t, hd, pitch, nx, ny, servoHoles: servoHoles.map(q => q.pos.slice(0, 2)), opening }, frames: [...frames, ...servoHoles] };
  }
  if (d.kind === 'bracket') {                                                                         // an L-bracket: a foot that bolts to a servo horn, and an upright a second servo screws onto, so the two shafts are at right angles
    const sv = SERVOS[d.key], t = 3, hd = clear(sv.horn), hd2 = 2.4, wb = Math.max(24, sv.W + 12), zc = t + sv.earHole / 2 + 4, hUp = Math.round((zc + sv.earHole / 2 + 5) * 10) / 10, Lf = Math.round(Math.max(40, sv.earZ + 26)), xUp = Lf / 2, xh = -Lf / 2 + 8, open = [sv.W + 2, sv.L + 1.5];
    const up = [[1, zc + sv.earHole / 2], [2, zc - sv.earHole / 2]].flatMap(([k, z]) => [hole(`up-${k}-out`, [xUp, 0, z], [1, 0, 0], hd2), hole(`up-${k}-in`, [xUp - t, 0, z], [-1, 0, 0], hd2)]);
    return { ...base, category: 'Structure', name: `L-bracket for ${sv.name}`, mass: { grams: r2((Lf * wb * t + hUp * wb * t) * 0.0012), source: 'estimated' }, dims: { size: [Lf, wb, hUp], source: 'estimated' },
      kit: { ...d, t, hd, hd2, wb, zc, hUp, Lf, xh, open, earHole: sv.earHole },
      frames: [hole('foot-1-top', [xh, 0, t], UP, hd), hole('foot-1-bottom', [xh, 0, 0], DOWN, hd), ...up] };
  }
  if (d.kind === 'wheel') {
    const wd = Math.max(8, d.dia * 0.32), hubR = Math.max(d.bore / 2 + 2.5, 6);
    return { ...base, category: 'Wheels & drive', name: `Wheel ${d.dia} mm`, mass: { grams: r2(Math.max(4, d.dia * 0.45)), source: 'estimated' }, dims: { size: [d.dia, d.dia, wd], source: 'estimated' }, kit: { ...d, wd, hubR },
      frames: [hole('bore-in', [0, 0, 0], DOWN, d.bore), hole('bore-out', [0, 0, wd], UP, d.bore)] };
  }
  if (d.kind === 'gearmotor') {
    const g = GEARMOTORS[d.key], src = g.real ? 'datasheet' : 'estimated', hd = clear(g.mountScrew), sp = g.mountSpacing / 2, yS = g.W / 2 + g.shaftLen;
    return { ...base, category: 'Wheels & drive', name: g.name, mass: { grams: g.mass, source: src }, dims: { size: [g.L, g.W + g.shaftLen * 2, g.H], source: src }, kit: { ...d, motor: g, hd },
      frames: [
        { id: 'shaft-left', kind: 'shaft', pos: [-g.L / 2 + g.gearbox / 2, -yS, g.H / 2].map(r2), dir: [0, -1, 0], diameter: g.shaftD, source: src },
        { id: 'shaft-right', kind: 'shaft', pos: [-g.L / 2 + g.gearbox / 2, yS, g.H / 2].map(r2), dir: [0, 1, 0], diameter: g.shaftD, source: src },
        hole('mount-1-top', [-g.L / 2 + g.gearbox / 2 - sp, 0, g.H], UP, hd, src), hole('mount-1-bottom', [-g.L / 2 + g.gearbox / 2 - sp, 0, 0], DOWN, hd, src),
        hole('mount-2-top', [-g.L / 2 + g.gearbox / 2 + sp, 0, g.H], UP, hd, src), hole('mount-2-bottom', [-g.L / 2 + g.gearbox / 2 + sp, 0, 0], DOWN, hd, src),
      ] };
  }
  if (d.kind === 'caster') {
    const hd = clear('M3');
    return { ...base, category: 'Wheels & drive', name: 'Ball caster', mass: { grams: 12, source: 'estimated' }, dims: { size: [34, 24, 16], source: 'estimated' }, kit: { ...d, hd },
      frames: [-12, 12].flatMap((x, k) => [hole(`mount-${k + 1}-top`, [x, 0, 16], UP, hd), hole(`mount-${k + 1}-bottom`, [x, 0, 12], DOWN, hd)]) };
  }
  if (d.kind === 'holder') {
    const l = d.cells === 4 ? 63 : 58, w = d.cells === 4 ? 58 : 32, h = 16, hd = clear('M3');
    return { ...base, category: 'Power', name: `${d.cells}×AA battery holder`, mass: { grams: d.cells === 4 ? 30 : 18, source: 'estimated' }, dims: { size: [l, w, h], source: 'estimated' }, kit: { ...d, sizeMm: [l, w, h], hd },
      frames: [-1, 1].flatMap((s, k) => [hole(`mount-${k + 1}-bottom`, [s * (l / 2 - 8), 0, 0], DOWN, hd), hole(`mount-${k + 1}-top`, [s * (l / 2 - 8), 0, h], UP, hd)]) };
  }
  return null;
}

/** Parts offered ready-made in the list. [name, id] */
export const KIT_PRESETS = [
  ['Servo, micro (9 g class)', 'servo-x-micro'], ['Servo, mini (metal gear)', 'servo-x-mini'], ['Servo, standard (55 g class)', 'servo-x-standard'], ['Servo, large (high torque)', 'servo-x-block'],
  ['Link 40 mm', 'link-40'], ['Link 60 mm', 'link-60'], ['Link 80 mm', 'link-80'], ['Link 120 mm (M3)', 'link-120'], ['Link 160 mm (M3)', 'link-160'],
  ['Base plate 100×80', 'plate-100x80'], ['Base plate 100×50 on feet (for servos)', 'plate-100x50-f18'], ['L-bracket for SG90 (turns a servo 90°)', 'bracket-sg90'], ['L-bracket for MG996R', 'bracket-mg996r'], ['Base plate 150×100', 'plate-150x100'], ['Base plate 200×150', 'plate-200x150'],
  ['TT gear motor', 'gearmotor-tt'], ['N20 gear motor', 'gearmotor-n20'], ['Wheel 65 mm (TT)', 'wheel-65'], ['Wheel 43 mm (N20)', 'wheel-43'], ['Ball caster', 'caster-ball'],
  ['4×AA battery holder', 'holder-4aa'], ['2×AA battery holder', 'holder-2aa'],
];
/** What the AI is told about these part ids. */
export const KIT_ID_HELP = 'Everyday robot parts are made from ids too: servo-<sg90|mg90s|mg996r|ds3218>, link-<length mm>[-m2|-m3], bracket-<servo key> (an L-bracket: its foot "foot-1-top/bottom" takes a servo horn, its upright "up-1-out" and "up-2-out" take a servo\'s "ear-1-bottom" and "ear-2-bottom", which turns that servo\'s shaft 90° from the first: yaw then pitch), plate-<width>x<length>[-f<feet height mm>] (mm; with feet it has an opening so a servo body hangs through, e.g. plate-100x80-f18), wheel-<diameter mm>[-b<bore mm>], gearmotor-<tt|n20>, caster-ball, holder-<2|4>aa. A servo\'s output hole is "horn-screw" (an M2 or M3 hole on the shaft); a link has holes "hole-1-top/bottom" … "hole-3-*"; a plate has a grid of "h<i>-<j>-top/bottom" holes and, in the middle, servo mounting holes "sv-sg90-1-top"/"sv-sg90-2-top" (and "sv-mg996r-*"): screw a servo down by joining its "ear-1-bottom" to the first and the second joins by itself; a link of 52 mm or more has "pair-1"/"pair-2" holes beside its end holes for the same; a wheel\'s bore is "bore-in"/"bore-out"; a gear motor\'s shafts are "shaft-left"/"shaft-right" and its screws "mount-1-*".';
