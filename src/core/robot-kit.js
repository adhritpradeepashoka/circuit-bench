// Everyday robot parts for the Assembly view: hobby servos, links, base plates, wheels, gear motors, casters and battery holders.
// Like the drone parts, nothing here is a stored model. A part is a short id (servo-sg90, link-80, plate-100x80, wheel-65, gearmotor-tt …) and its
// holes, size, mass and look are worked out from that id, so the same id always gives the same part and scenes and the AI can refer to parts by id.
// Hole sizes use the clearance size of the screw the pattern calls for, so a servo horn, a link and a screw agree and a mismatch shows in the joint check.
import { THREADS, ROBOT_PART_FORMAT, ROBOT_PART_VERSION } from './robot-part.js';

const clear = screw => THREADS[screw]?.[1] ?? 3.4;
const r2 = v => Math.round(v * 100) / 100;
const hole = (id, pos, dir, diameter, source = 'estimated') => ({ id, kind: 'hole', pos: pos.map(r2), dir, diameter, source });
const UP = [0, 0, 1], DOWN = [0, 0, -1];
const fin = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

/** Hobby servos. Body L (along Y) × W (along X) × H, the mounting ears are `ear` long in total at height `earZ`, the output shaft sits `shaftOff` in from the +Y end.
 *  Numbers for the SG90 / MG90S / MG996R come from their datasheets; the others are typical for the class. */
export const SERVOS = {
  sg90:   { name: 'SG90 micro servo',   L: 22.5, W: 12.2, H: 22.7, ear: 32.2, earHole: 27.6, earZ: 15.9, earT: 2.5, shaftOff: 5.8, shaftD: 4.8, shaftH: 3.2, horn: 'M2', mass: 9,    torque: 0.176, speed: 600, volts: 4.8, stall: 0.65, real: true },
  mg90s:  { name: 'MG90S metal-gear servo', L: 22.8, W: 12.4, H: 28.5, ear: 32.5, earHole: 28.0, earZ: 19.0, earT: 2.5, shaftOff: 5.8, shaftD: 4.8, shaftH: 3.6, horn: 'M2', mass: 13.4, torque: 0.216, speed: 545, volts: 4.8, stall: 0.7, real: true },
  mg996r: { name: 'MG996R servo',       L: 40.7, W: 19.7, H: 42.9, ear: 53.5, earHole: 49.5, earZ: 28.5, earT: 3, shaftOff: 10, shaftD: 5.8, shaftH: 4.5, horn: 'M3', mass: 55,   torque: 0.92, speed: 300, volts: 4.8, stall: 2.5, real: true },
  ds3218: { name: 'DS3218 servo (20 kg)', L: 40.2, W: 20.2, H: 40.5, ear: 54.5, earHole: 49.5, earZ: 27, earT: 3, shaftOff: 10, shaftD: 5.8, shaftH: 4.5, horn: 'M3', mass: 60,   torque: 1.96, speed: 340, volts: 6.0, stall: 3.2, real: false },
};
/** Gear motors and the wheel bore each one wants. */
export const GEARMOTORS = {
  tt:  { name: 'TT gear motor (yellow, 1:48)', L: 64.5, W: 22.5, H: 18.6, shaftD: 5.4, shaftLen: 9, gearbox: 37, mountSpacing: 22, mountScrew: 'M3', mass: 30, volts: 6, rpm: 200, stallTorque: 0.8, real: true },
  n20: { name: 'N20 micro gear motor', L: 22, W: 12, H: 10, shaftD: 3, shaftLen: 9, gearbox: 9, mountSpacing: 9, mountScrew: 'M1_6', mass: 10, volts: 6, rpm: 100, stallTorque: 0.12, real: true },
};

/** A part id → numbers, or null. */
export function parseKitId(id) {
  const s = String(id || ''); let m;
  if ((m = /^servo-([a-z0-9]+)$/.exec(s)) && SERVOS[m[1]]) return { kind: 'servo', key: m[1] };
  if ((m = /^link-(\d{1,3}(?:\.\d)?)(?:-(m2|m3))?$/.exec(s))) { const len = fin(Number(m[1]), 15, 400, 60); return { kind: 'link', len, screw: (m[2] || (len > 90 ? 'm3' : 'm2')).toUpperCase() }; }
  if ((m = /^plate-(\d{2,3})x(\d{2,3})$/.exec(s))) return { kind: 'plate', w: fin(Number(m[1]), 30, 400, 100), l: fin(Number(m[2]), 30, 400, 80) };
  if ((m = /^wheel-(\d{2,3})(?:-b([\d.]+))?$/.exec(s))) { const dia = fin(Number(m[1]), 20, 200, 65); return { kind: 'wheel', dia, bore: m[2] ? fin(Number(m[2]), 1.5, 12, 5.5) : (dia <= 50 ? 3.1 : 5.5) }; }
  if ((m = /^gearmotor-([a-z0-9]+)$/.exec(s)) && GEARMOTORS[m[1]]) return { kind: 'gearmotor', key: m[1] };
  if (s === 'caster-ball') return { kind: 'caster' };
  if ((m = /^holder-(2|4)aa$/.exec(s))) return { kind: 'holder', cells: Number(m[1]) };
  return null;
}

/** The geometry a part needs, in numbers (the viewer turns it into a shape). Z up, centred in X and Y, resting on z = 0. */
export function makeKitPart(id) {
  const d = parseKitId(id); if (!d) return null;
  const base = { format: ROBOT_PART_FORMAT, version: ROBOT_PART_VERSION, id, model: { file: `${id}.gen`, format: 'gen', units: 'mm', up: 'z' } };
  if (d.kind === 'servo') {
    const s = SERVOS[d.key], src = s.real ? 'datasheet' : 'estimated', hd = clear(s.horn), yShaft = s.L / 2 - s.shaftOff, top = s.H + s.shaftH, ex = s.earHole / 2;
    return { ...base, category: 'Servos', name: s.name, mass: { grams: s.mass, source: src }, dims: { size: [s.W, s.ear, top], source: src }, kit: { ...d, servo: s, yShaft, top },
      frames: [
        hole('ear-1-top', [0, ex, s.earZ + s.earT], UP, 2.4, src), hole('ear-1-bottom', [0, ex, s.earZ], DOWN, 2.4, src),
        hole('ear-2-top', [0, -ex, s.earZ + s.earT], UP, 2.4, src), hole('ear-2-bottom', [0, -ex, s.earZ], DOWN, 2.4, src),
        { id: 'shaft', kind: 'shaft', pos: [0, yShaft, top].map(r2), dir: UP, diameter: s.shaftD, source: src },
        hole('horn-screw', [0, yShaft, top], UP, hd, src),
        hole('base-1', [0, -s.L / 2 + 3, 0], DOWN, 2.4, 'estimated'),
      ] };
  }
  if (d.kind === 'link') {
    const w = d.len > 90 ? 16 : 12, t = 3, hd = clear(d.screw), pts = [0, 1, 2].map(k => -d.len / 2 + 6 + k * (d.len - 12) / 2).map(r2);   // end, middle, end
    return { ...base, category: 'Structure', name: `Link ${d.len} mm (${d.screw})`, mass: { grams: r2(d.len * w * t * 0.0012), source: 'estimated' }, dims: { size: [d.len, w, t], source: 'estimated' }, kit: { ...d, w, t, hd, pts },
      frames: pts.flatMap((x, k) => [hole(`hole-${k + 1}-top`, [x, 0, t], UP, hd), hole(`hole-${k + 1}-bottom`, [x, 0, 0], DOWN, hd)]) };
  }
  if (d.kind === 'plate') {
    const t = 3, hd = clear('M3'); let pitch = 10; while (((Math.floor((d.w - 12) / pitch) + 1) * (Math.floor((d.l - 12) / pitch) + 1)) > 90) pitch += 5;
    const nx = Math.floor((d.w - 12) / pitch), ny = Math.floor((d.l - 12) / pitch), frames = [];
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) { const x = -nx * pitch / 2 + i * pitch, y = -ny * pitch / 2 + j * pitch; frames.push(hole(`h${i + 1}-${j + 1}-top`, [x, y, t], UP, hd), hole(`h${i + 1}-${j + 1}-bottom`, [x, y, 0], DOWN, hd)); }
    return { ...base, category: 'Structure', name: `Base plate ${d.w}×${d.l} mm`, mass: { grams: r2(d.w * d.l * t * 0.0012), source: 'estimated' }, dims: { size: [d.w, d.l, t], source: 'estimated' }, kit: { ...d, t, hd, pitch, nx, ny }, frames };
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
  ['SG90 micro servo', 'servo-sg90'], ['MG90S metal-gear servo', 'servo-mg90s'], ['MG996R servo', 'servo-mg996r'], ['DS3218 servo (20 kg)', 'servo-ds3218'],
  ['Link 40 mm', 'link-40'], ['Link 60 mm', 'link-60'], ['Link 80 mm', 'link-80'], ['Link 120 mm (M3)', 'link-120'], ['Link 160 mm (M3)', 'link-160'],
  ['Base plate 100×80', 'plate-100x80'], ['Base plate 150×100', 'plate-150x100'], ['Base plate 200×150', 'plate-200x150'],
  ['TT gear motor', 'gearmotor-tt'], ['N20 gear motor', 'gearmotor-n20'], ['Wheel 65 mm (TT)', 'wheel-65'], ['Wheel 43 mm (N20)', 'wheel-43'], ['Ball caster', 'caster-ball'],
  ['4×AA battery holder', 'holder-4aa'], ['2×AA battery holder', 'holder-2aa'],
];
/** What the AI is told about these part ids. */
export const KIT_ID_HELP = 'Everyday robot parts are made from ids too: servo-<sg90|mg90s|mg996r|ds3218>, link-<length mm>[-m2|-m3], plate-<width>x<length> (mm), wheel-<diameter mm>[-b<bore mm>], gearmotor-<tt|n20>, caster-ball, holder-<2|4>aa. A servo\'s output hole is "horn-screw" (an M2 or M3 hole on the shaft); a link has holes "hole-1-top/bottom" … "hole-3-*"; a plate has a grid of "h<i>-<j>-top/bottom" holes; a wheel\'s bore is "bore-in"/"bore-out"; a gear motor\'s shafts are "shaft-left"/"shaft-right" and its screws "mount-1-*".';
