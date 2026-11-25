// Drone parts for the Assembly view. Nothing here is a stored model: a part is a short id (motor-2207-1900, prop-5x4.3x3, frame-quad-220-16-30.5 …)
// and everything about it, its holes, size, mass and look, is worked out from that id. The same id always gives the same part, so scenes and the AI can refer to parts by id.
// Hole sizes use the clearance size of the screw the pattern calls for, so a motor, a frame and a screw agree, and a mismatch shows up in the joint check.
import { THREADS, ROBOT_PART_FORMAT, ROBOT_PART_VERSION } from './robot-part.js';
import { MOTOR_SIZES, MOTOR_NAMES, STACKS, BOARDS, CAMERAS, makeMotor, makeProp, makeBattery } from './drone.js';

const clear = screw => THREADS[screw]?.[1] ?? 3.4;
const r2 = v => Math.round(v * 100) / 100;
const hole = (id, pos, dir, diameter) => ({ id, kind: 'hole', pos: pos.map(r2), dir, diameter, source: 'estimated' });
const UP = [0, 0, 1], DOWN = [0, 0, -1];
const sq = (a, b = a) => [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([x, y]) => [x * a / 2, y * b / 2]);
/** Where a motor's screws go: 'cross' is the usual four on a square (the pattern is the side), 'tri' is the three-prong base of tiny-whoop motors, three screws 120° apart on a circle (the pattern is its diameter). Motor and frame use the same function, so they always line up. */
export const mountPoints = (kind, p, q = p) => kind === 'tri' ? [0, 1, 2].map(k => [Math.cos(Math.PI / 2 + k * 2 * Math.PI / 3) * p / 2, Math.sin(Math.PI / 2 + k * 2 * Math.PI / 3) * p / 2]) : sq(p, q);
const fin = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

/** The hobby's motor name → numbers, with any "Advanced" overrides carried in the id: -r (mΩ), -i (mA), -m (g), -a (A). */
export function parseDroneId(id) {
  const s = String(id || ''), p = s.split('-');
  if (p[0] === 'motor' && MOTOR_SIZES[p[1]]) { const over = {}; for (const t of p.slice(3)) { const v = Number(t.slice(1)); if (!Number.isFinite(v) || v <= 0) continue; if (t[0] === 'r') over.resistance = v / 1000; else if (t[0] === 'i') over.noLoadAmps = v / 1000; else if (t[0] === 'm') over.massGrams = v; else if (t[0] === 'a') over.maxAmps = v; } return { kind: 'motor', size: p[1], kv: fin(Number(p[2]), 100, 60000, MOTOR_SIZES[p[1]].kvRef), over }; }
  let m;
  if ((m = /^prop-([\d.]+)x([\d.]+)x(\d)(?:-b([\d.]+))?$/.exec(s))) return { kind: 'prop', dia: fin(Number(m[1]), 0.8, 12, 5), pitch: fin(Number(m[2]), 0.5, 10, 4.3), blades: fin(Number(m[3]), 2, 6, 3), bore: m[4] ? fin(Number(m[4]), 0.8, 8, 5) : null };
  if ((m = /^battery-(\d)s-(\d+)(?:-(\d+))?(?:-(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?))?$/.exec(s))) return { kind: 'battery', cells: fin(Number(m[1]), 1, 6, 4), mAh: fin(Number(m[2]), 100, 10000, 1500), c: fin(Number(m[3] || 75), 10, 200, 75), ...(m[4] ? { size: [fin(Number(m[4]), 10, 300, 80), fin(Number(m[5]), 5, 150, 35), fin(Number(m[6]), 3, 100, 25)] } : {}) };
  if ((m = /^frame-quad-(\d+)-(t?)(\d+(?:\.\d+)?)-([\d.]+)$/.exec(s)) && STACKS[m[4]]) return { kind: 'frame', wheelbase: fin(Number(m[1]), 40, 600, 220), motorPattern: fin(Number(m[3]), m[2] ? 3 : 6, 30, m[2] ? 6 : 16), mountKind: m[2] ? 'tri' : 'cross', stack: m[4] };
  if (BOARDS[s.replace(/^board-/, '')] && s.startsWith('board-')) return { kind: 'board', key: s.slice(6) };
  if (s.startsWith('camera-') && CAMERAS[`cam-${s.slice(7)}`]) return { kind: 'camera', key: `cam-${s.slice(7)}` };
  if ((m = /^fcwing-(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?:-m(\d+(?:\.\d+)?))?$/.exec(s))) { const l = fin(Number(m[1]), 12, 90, 36), w = fin(Number(m[2]), 12, 90, 36); return { kind: 'fcwing', l, w, px: fin(Number(m[3]), 6, l - 3, 30.5), py: fin(Number(m[4]), 6, w - 3, 30.5), ...(m[5] ? { grams: fin(Number(m[5]), 0.5, 200, 8) } : {}) }; }
  if ((m = /^rx-(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(s))) return { kind: 'rx', l: fin(Number(m[1]), 8, 80, 20), w: fin(Number(m[2]), 6, 50, 12), h: fin(Number(m[3]), 2, 30, 6) };
  if ((m = /^antenna-(\d+(?:\.\d+)?)$/.exec(s))) return { kind: 'antenna', len: fin(Number(m[1]), 15, 400, 90) };
  if ((m = /^edf-(\d+(?:\.\d+)?)(?:-m(\d+(?:\.\d+)?))?$/.exec(s))) return { kind: 'edf', dia: fin(Number(m[1]), 25, 120, 50), ...(m[2] ? { grams: fin(Number(m[2]), 5, 600, 70) } : {}) };
  if ((m = /^standoff-(m1_6|m2|m3)-(\d+(?:\.\d+)?)$/.exec(s))) return { kind: 'standoff', screw: m[1].toUpperCase(), h: fin(Number(m[2]), 2, 40, 6) };
  return null;
}
export const motorId = ({ size, kv, over = {} }) => `motor-${size}-${Math.round(kv)}${over.resistance ? `-r${Math.round(over.resistance * 1000)}` : ''}${over.noLoadAmps ? `-i${Math.round(over.noLoadAmps * 1000)}` : ''}${over.massGrams ? `-m${over.massGrams}` : ''}${over.maxAmps ? `-a${over.maxAmps}` : ''}`;
/** A bore that suits the usual motor shaft for a prop's size (change it in the builder if yours differs). */
export const defaultBore = dia => (dia <= 1.8 ? 1.0 : dia <= 2.6 ? 1.5 : dia <= 3.2 ? 2.0 : dia <= 4.2 ? 3.0 : 5.0);

/** The geometry a part needs, in numbers (the viewer turns it into a shape). */
export function makeDronePart(id) {
  const d = parseDroneId(id); if (!d) return null;
  const base = { format: ROBOT_PART_FORMAT, version: ROBOT_PART_VERSION, id, category: 'Drone', model: { file: `${id}.gen`, format: 'gen', units: 'mm', up: 'z' } };
  if (d.kind === 'motor') {
    const mo = makeMotor({ size: d.size, kv: d.kv, over: d.over }), [sd, sh] = mo.stator, [a, b] = mo.mount.pattern, mk = mo.mount.kind || 'cross', hd = clear(mo.mount.screw);
    const bellR = mo.body ? mo.body.dia / 2 : sd / 2 + (sd < 12 ? 1.1 : 2.2), baseT = Math.max(1.2, sd / 9), bellH = mo.body ? mo.body.h : sh + 3.5, shaftLen = mo.body ? mo.body.shaftLen : 3 + mo.shaftMm * 1.4, root = baseT + bellH, hx = (mk === 'tri' ? a / 2 : Math.hypot(a, b) / 2) + hd;
    const baseR = Math.max(bellR, hx + 0.8);
    return { ...base, name: mo.brushed ? `Coreless motor ${d.size} (brushed)` : `Motor ${d.size} ${Math.round(d.kv)}Kv`, mass: { grams: mo.massGrams, source: d.over.massGrams ? 'datasheet' : 'estimated' }, dims: { size: [2 * baseR, 2 * baseR, root + shaftLen], source: 'estimated' }, drone: { ...d, motor: mo, bellR, baseR, baseT, root, shaftLen, mountKind: mk },
      frames: [...mountPoints(mk, a, b).map(([x, y], k) => hole(`mount-${k + 1}`, [x, y, 0], DOWN, hd)), { id: 'shaft', kind: 'shaft', pos: [0, 0, root], dir: UP, diameter: mo.shaftMm, source: 'estimated' }] };
  }
  if (d.kind === 'prop') {
    const p = makeProp({ diameterIn: d.dia, pitchIn: d.pitch, blades: d.blades }), bore = d.bore ?? defaultBore(d.dia), hubR = Math.max(bore * 0.95 + 1.6, 4), hubH = Math.max(4, bore * 1.1), R = d.dia * 25.4 / 2;
    return { ...base, name: `Prop ${d.dia}×${d.pitch}×${d.blades}`, mass: { grams: Math.round(p.massGrams * 10) / 10, source: 'estimated' }, dims: { size: [2 * R, 2 * R, hubH], source: 'estimated' }, drone: { ...d, bore, hubR, hubH, R },
      frames: [hole('bore-bottom', [0, 0, 0], DOWN, bore), hole('bore-top', [0, 0, hubH], UP, bore)] };
  }
  if (d.kind === 'battery') {
    const b = makeBattery({ cells: d.cells, mAh: d.mAh, c: d.c }), [l, w, h] = d.size || b.sizeMm; b.sizeMm = [l, w, h];
    return { ...base, name: `Battery ${d.cells}S ${d.mAh} mAh${d.c !== 75 ? ` ${d.c}C` : ''}`, mass: { grams: Math.round(b.massGrams * 10) / 10, source: 'estimated' }, dims: { size: [l, w, h], source: d.size ? 'measured' : 'estimated' }, drone: { ...d, battery: b, sizeMm: [l, w, h] },
      frames: [[-10, 'a'], [10, 'b']].flatMap(([x, k]) => [hole(`strap-top-${k}`, [x, 0, h], UP, 3.4), hole(`strap-bottom-${k}`, [x, 0, 0], DOWN, 3.4)]) };
  }
  if (d.kind === 'frame') {
    const W = d.wheelbase, t = W < 100 ? 1.5 : W < 180 ? 3 : 4, st = STACKS[d.stack], hd = clear(st.screw), mk = d.mountKind || 'cross', mhd = clear(d.motorPattern <= 6 ? 'M1_4' : d.motorPattern <= 9 ? 'M2' : 'M3'), arm = Math.max(9, d.motorPattern + 5), plate = Math.max(st.pattern[0] + 9, 22);
    const tips = [45, 135, 225, 315].map((deg, k) => [['fr', 'fl', 'bl', 'br'][k], Math.cos(deg * Math.PI / 180) * W / 2, Math.sin(deg * Math.PI / 180) * W / 2]);
    const frames = [];
    for (const [n, x, y] of tips) mountPoints(mk, d.motorPattern).forEach(([hx, hy], k) => { frames.push(hole(`${n}-${k + 1}-top`, [x + hx, y + hy, t], UP, mhd), hole(`${n}-${k + 1}-bottom`, [x + hx, y + hy, 0], DOWN, mhd)); });
    sq(...st.pattern).forEach(([x, y], k) => frames.push(hole(`stack-${k + 1}-top`, [x, y, t], UP, hd), hole(`stack-${k + 1}-bottom`, [x, y, 0], DOWN, hd)));
    [-10, 10].forEach((y, k) => frames.push(hole(`strap-${k + 1}-bottom`, [0, y, 0], DOWN, 3.4), hole(`strap-${k + 1}-top`, [0, y, t], UP, 3.4)));
    [-6, 6].forEach((x, k) => frames.push(hole(`camera-${k + 1}-top`, [x, plate / 2 + 8, t], UP, 2.4)));
    const R = W / 2 + arm;
    return { ...base, name: `Quad frame ${W} mm (${mk === 'tri' ? `3-prong ${d.motorPattern} mm` : `${d.motorPattern}×${d.motorPattern}`} motors, ${d.stack} stack)`, mass: { grams: Math.round(0.0016 * W * W * t / 4 * 10) / 10, source: 'estimated' }, dims: { size: [2 * R, 2 * R, t], source: 'estimated' }, drone: { ...d, t, arm, plate, tips, mhd, hd, mountKind: mk }, frames };
  }
  if (d.kind === 'board') {
    const b = BOARDS[d.key], st = STACKS[b.stack], hd = clear(st.screw), [l, w] = b.sizeMm;
    return { ...base, name: b.name, mass: { grams: b.mass, source: b.real ? 'datasheet' : 'estimated' }, dims: { size: [l, w, b.sizeMm[2]], source: b.real ? 'datasheet' : 'estimated' }, drone: { ...d, board: b, hd, pattern: st.pattern },
      frames: sq(...st.pattern).flatMap(([x, y], k) => [hole(`mount-${k + 1}-top`, [x, y, 1.6], UP, hd), hole(`mount-${k + 1}-bottom`, [x, y, 0], DOWN, hd)]) };
  }
  if (d.kind === 'camera') {
    const c = CAMERAS[d.key], [l, w, h] = c.sizeMm;
    return { ...base, name: c.name, mass: { grams: c.mass, source: 'estimated' }, dims: { size: [l, w, h], source: 'estimated' }, drone: { ...d, cam: c, sizeMm: [l, w, h] }, frames: [-6, 6].map((x, k) => hole(`mount-${k + 1}-bottom`, [x, 0, 0], DOWN, 2.4)) };
  }
  if (d.kind === 'standoff') {
    const hd = clear(d.screw), r = d.screw === 'M3' ? 2.75 : 2.1;
    return { ...base, name: `Standoff ${d.screw.replace('_', '.')} × ${d.h} mm`, mass: { grams: Math.round(Math.PI * (r * r - (hd / 2) ** 2) * d.h * 0.0027 * 10) / 10, source: 'estimated' }, dims: { size: [2 * r, 2 * r, d.h], source: 'estimated' }, drone: { ...d, r, hd },
      frames: [hole('bottom', [0, 0, 0], DOWN, hd), hole('top', [0, 0, d.h], UP, hd)] };
  }
  if (d.kind === 'fcwing') {
    const hd = clear(Math.max(d.px, d.py) <= 17 ? 'M1_6' : Math.max(d.px, d.py) <= 27 ? 'M2' : 'M3'), grams = d.grams ?? Math.max(1, Math.round(d.l * d.w * 0.0062 * 10) / 10), H = 5;
    return { ...base, name: `Flight controller ${d.l}×${d.w} mm`, mass: { grams, source: d.grams ? 'measured' : 'estimated' }, dims: { size: [d.l, d.w, H], source: 'estimated' }, drone: { ...d, hd, H },
      frames: sq(d.px, d.py).flatMap(([x, y], k) => [hole(`mount-${k + 1}-top`, [x, y, 1.6], UP, hd), hole(`mount-${k + 1}-bottom`, [x, y, 0], DOWN, hd)]) };
  }
  if (d.kind === 'rx') {
    return { ...base, name: `Receiver ${d.l}×${d.w}×${d.h} mm`, mass: { grams: Math.max(0.5, Math.round(d.l * d.w * d.h * 0.0012 * 10) / 10), source: 'estimated' }, dims: { size: [d.l, d.w, d.h], source: 'estimated' }, drone: { ...d },
      frames: [hole('ant-port', [d.l / 2, 0, d.h / 2], [1, 0, 0], 2), hole('mount-1-bottom', [-d.l / 2 + 3, 0, 0], DOWN, 2.4), hole('mount-2-bottom', [d.l / 2 - 3, 0, 0], DOWN, 2.4)] };
  }
  if (d.kind === 'antenna') {
    return { ...base, name: `Antenna ${d.len} mm`, mass: { grams: Math.max(0.5, Math.round((1 + d.len * 0.015) * 10) / 10), source: 'estimated' }, dims: { size: [6, 6, d.len + 3], source: 'estimated' }, drone: { ...d },
      frames: [hole('base', [0, 0, 0], DOWN, 2.2)] };
  }
  if (d.kind === 'edf') {
    const outer = d.dia + 6, L = Math.round(d.dia * 1.3);
    return { ...base, name: `EDF ${d.dia} mm`, mass: { grams: d.grams ?? Math.round(70 * (d.dia / 50) ** 3), source: d.grams ? 'measured' : 'estimated' }, dims: { size: [outer, L, outer], source: 'estimated' }, drone: { ...d, outer, L },
      frames: [hole('mount-1-bottom', [0, -L / 4, 0], DOWN, 3.4), hole('mount-2-bottom', [0, L / 4, 0], DOWN, 3.4)] };
  }
  return null;
}
/** Parts offered ready-made in the list (the builder makes the rest). */
export const DRONE_PRESETS = [
  ['Tiny whoop 75 mm (3-prong 0802 motors)', 'frame-quad-75-t6.6-16'], ['Whoop frame 65 mm', 'frame-quad-65-9-16'], ['3 inch frame 142 mm', 'frame-quad-142-12-20'], ['5 inch frame 220 mm', 'frame-quad-220-16-30.5'], ['7 inch frame 300 mm', 'frame-quad-300-16-30.5'],
  ['Drone motor (choose its size after adding)', 'motor-2207-1900'], ['Coreless motor 8520 (brushed, 1S)', 'motor-8520-12000'], ['Coreless motor 0716 (brushed, 1S)', 'motor-0716-10000'], ['Coreless motor 0720 (brushed, 1S)', 'motor-0720-11000'], ['Coreless motor 0615 (brushed, 1S)', 'motor-0615-9000'],
  ['Prop 5×4.3×3', 'prop-5x4.3x3-b5'], ['Prop 3×3×3', 'prop-3x3x3-b2'], ['Flight controller 30.5', 'board-fc-30.5'], ['4-in-1 ESC 30.5', 'board-esc-30.5'], ['AIO 25.5', 'board-aio-25.5'], ['iFlight BLITZ F411 1S AIO', 'board-aio-iflight-blitz-f411-1s'], ['Happymodel X12 AIO', 'board-aio-happymodel-x12'], ['HGLRC Zeus13 AIO', 'board-aio-hglrc-zeus13'], ['iFlight Beast F7 AIO', 'board-aio-iflight-beast-f7'], ['Whoop AIO 16', 'board-aio-16'],
  ['Battery 4S 1500 mAh', 'battery-4s-1500-75'], ['Battery 6S 1300 mAh', 'battery-6s-1300-100'], ['Battery 1S 450 mAh', 'battery-1s-450-60'], ['Camera micro', 'camera-micro'], ['Camera nano', 'camera-nano'], ['Standoff M3 × 6', 'standoff-m3-6'], ['Standoff M2 × 6', 'standoff-m2-6'],
];
/** Parts for a fixed-wing plane. Every size here is a stand-in made from the numbers in the id, not a real board or fan: change the id (or use "Make a part") to match yours. */
export const PLANE_PRESETS = [
  ['Battery 3S 2200 mAh 100C', 'battery-3s-2200-100'], ['Battery 4S 2200 mAh 100C', 'battery-4s-2200-100'], ['Battery 3S 1300 mAh 75C', 'battery-3s-1300-75'],
  ['EDF 50 mm ducted fan', 'edf-50'], ['EDF 64 mm ducted fan', 'edf-64'], ['Motor (outrunner, choose its size after adding)', 'motor-2207-1900'], ['Prop 6×4×2', 'prop-6x4x2-b5'],
  ['Flight controller 36×36 (holes 30.5)', 'fcwing-36x36-30.5x30.5'], ['Flight controller 25×25 (holes 20)', 'fcwing-25x25-20x20'], ['Receiver 20×12×6', 'rx-20x12x6'], ['Antenna 90 mm', 'antenna-90'],
  ['Standoff M3 × 6', 'standoff-m3-6'], ['Standoff M2 × 6', 'standoff-m2-6'],
];
export const MOTOR_SIZE_LIST = MOTOR_NAMES;
/** What the AI is told about drone part ids. */
export const DRONE_ID_HELP = `Drone parts are made from ids, not listed one by one. Formats: motor-<size>-<Kv> (e.g. motor-2207-1900; sizes like 0802 1404 1806 2207 2806 3110), prop-<diameter in>x<pitch>x<blades>[-b<bore mm>] (prop-5x4.3x3-b5), battery-<cells>s-<mAh>[-<C>] (battery-4s-1500-75), frame-quad-<wheelbase mm>-<motor mount mm>-<stack mm> (frame-quad-220-16-30.5; stacks 30.5, 26, 25.5, 20, 16), board-fc-30.5, board-esc-30.5, board-aio-25.5, board-aio-16, real AIOs (board-aio-iflight-blitz-f411-1s, board-aio-happymodel-x12, board-aio-hglrc-zeus13, board-aio-iflight-beast-f7, board-aio-jhemcu-f405pro, board-aio-betafpv-f4-1s, board-aio-betafpv-f405-20a), camera-micro, camera-nano, standoff-m3-6 or standoff-m2-6 (height in mm). Holes: a motor has mount-1..4 (underside) and shaft; a prop has bore-bottom and bore-top; a frame has fr/fl/bl/br-1..4-top|bottom (lowercase) for its four motor mounts, stack-1..4-top|bottom, strap-1..2-top|bottom and camera-1..2-top; a board has mount-1..4-top|bottom; a standoff has top and bottom; a battery has strap-top-a|b and strap-bottom-a|b; a camera has mount-1..2-bottom. To fit a motor on a frame, join its mount-1 to the frame's fr-1-top (the other three screws line up by themselves). A prop goes on a motor by joining the prop's bore-bottom to the motor's shaft. A battery can also carry its measured size: battery-<cells>s-<mAh>-<C>-<length>x<width>x<height> in mm (battery-3s-2200-100-115x35x25).
Plane parts (fixed wing / flying wing): edf-<fan diameter mm>[-m<grams>] (edf-50; holes mount-1-bottom, mount-2-bottom; the fan points along Y), fcwing-<length>x<width>-<hole spacing X>x<hole spacing Y>[-m<grams>] (fcwing-36x36-30.5x30.5; a flight controller of any size, holes mount-1..4-top|bottom), rx-<length>x<width>x<height> (rx-20x12x6; holes ant-port, mount-1-bottom, mount-2-bottom), antenna-<length mm> (antenna-90; hole base: join it to a receiver's ant-port). These are stand-ins made from the numbers in the id, not a real board: say so if asked, and use the student's own numbers when they give them. A plane's printed airframe is a part the student imports (STL) with the holes they marked: put the electronics next to or inside it, and only join to holes that exist.`;
