// The assembly: part instances placed in one space, and the mates that join their marked frames. Pure maths and data, no DOM or three.js,
// so it runs (and is tested) in Node. Units are mm. A transform is { q:[x,y,z,w], t:[x,y,z] } taking a part's own space to the world.
import { THREADS } from './robot-part.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
export const rotate = (q, v) => { const u = [q[0], q[1], q[2]], c1 = cross(u, v), c2 = cross(u, c1); return [v[0] + 2 * (q[3] * c1[0] + c2[0]), v[1] + 2 * (q[3] * c1[1] + c2[1]), v[2] + 2 * (q[3] * c1[2] + c2[2])]; };
/** The shortest rotation taking unit vector a onto unit vector b. */
export function arc(a, b) {
  const d = dot(a, b);
  if (d > 0.999999) return [0, 0, 0, 1];
  if (d < -0.999999) { let ax = cross(a, [1, 0, 0]); if (len(ax) < 1e-3) ax = cross(a, [0, 1, 0]); ax = unit(ax); return [ax[0], ax[1], ax[2], 0]; }
  const c = cross(a, b), q = [c[0], c[1], c[2], 1 + d], l = Math.hypot(...q); return q.map(v => v / l);
}
export const place = (T, p) => { const r = rotate(T.q, p); return [r[0] + T.t[0], r[1] + T.t[1], r[2] + T.t[2]]; };
export const IDENTITY = () => ({ q: [0, 0, 0, 1], t: [0, 0, 0] });

/** A frame of an instance, in world space. */
export const worldFrame = (inst, f) => ({ pos: place(inst.T, f.pos), dir: unit(rotate(inst.T.q, f.dir)) });

/** The screw that suits a hole: the largest thread whose clearance hole is no bigger than the hole (so it passes), or null if even M1 will not. */
export function screwFor(diameter) {
  let best = null;
  for (const [name, [nominal, clearance]] of Object.entries(THREADS)) if (clearance <= diameter + 0.05 && (!best || nominal > best.nominal)) best = { name, nominal, clearance };
  return best && best.name;
}

/** Where instance B must sit so frame fb lands on frame fa of A, facing it. B keeps its own twist as far as possible. Does not change anything. */
export function mateTransform(A, fa, B, fb) {
  const wa = worldFrame(A, fa), wb = worldFrame(B, fb);
  const q = qmul(arc(wb.dir, wa.dir.map(v => -v)), B.T.q), pb = place({ q, t: [0, 0, 0] }, fb.pos);
  return { q, t: [wa.pos[0] - pb[0], wa.pos[1] - pb[1], wa.pos[2] - pb[2]] };
}
const axisAngle = (axis, deg) => { const a = unit(axis), h = (deg * Math.PI) / 360, s = Math.sin(h); return [a[0] * s, a[1] * s, a[2] * s, Math.cos(h)]; };
/** Turn an instance by `deg` about a world axis through `pivot`. */
export function turn(inst, axis, pivot, deg) {
  const r = axisAngle(axis, deg), rel = [inst.T.t[0] - pivot[0], inst.T.t[1] - pivot[1], inst.T.t[2] - pivot[2]], m = rotate(r, rel);
  const q = qmul(r, inst.T.q), l = Math.hypot(...q); inst.T = { q: q.map(v => v / l), t: [pivot[0] + m[0], pivot[1] + m[1], pivot[2] + m[2]] };
}

export class Assembly {
  constructor() { this.instances = []; this.mates = []; this.counter = 0; }
  /** @param part a validated robot part  @param at where to put it (mm) */
  add(part, at = [0, 0, 0]) {
    const n = ++this.counter, inst = { id: `${part.id}#${n}`, part, T: { q: [0, 0, 0, 1], t: [...at] } };
    this.instances.push(inst); return inst;
  }
  get(id) { return this.instances.find(i => i.id === id) || null; }
  remove(id) { this.instances = this.instances.filter(i => i.id !== id); this.mates = this.mates.filter(m => m.a.inst !== id && m.b.inst !== id); }
  /** Join frame fb of instance B to frame fa of instance A: B moves so the two frames coincide and face each other (screw axes line up). */
  mate(aInst, aFrame, bInst, bFrame, { screw } = {}) {
    const A = this.get(aInst), B = this.get(bInst); if (!A || !B) return { ok: false, error: 'Unknown part.' };
    if (A === B) return { ok: false, error: 'Pick frames on two different parts.' };
    const fa = A.part.frames.find(f => f.id === aFrame), fb = B.part.frames.find(f => f.id === bFrame);
    if (!fa || !fb) return { ok: false, error: 'Unknown frame.' };
    const kept = this.mates.filter(m => !(m.b.inst === bInst && m.b.frame === bFrame) && !(m.a.inst === bInst && m.a.frame === bFrame && m.b.inst === aInst));
    const group = this.component(bInst, kept);                                       // B brings everything already attached to it
    const fits = (() => { const wa = worldFrame(A, fa), wb = worldFrame(B, fb); return Math.hypot(wa.pos[0] - wb.pos[0], wa.pos[1] - wb.pos[1], wa.pos[2] - wb.pos[2]) < 0.1 && dot(wa.dir, wb.dir) < -0.999; })();
    if (group.includes(aInst) && !fits) return { ok: false, error: 'These two parts are already connected through other parts, and these holes do not line up where they are. Straighten the joints so the holes meet, or unjoin one first.' };
    const T0 = B.T, T1 = mateTransform(A, fa, B, fb), inv0 = [-T0.q[0], -T0.q[1], -T0.q[2], T0.q[3]], dq = qmul(T1.q, inv0);
    if (!group.includes(aInst)) for (const id of group) { const X = this.get(id), r = rotate(dq, [X.T.t[0] - T0.t[0], X.T.t[1] - T0.t[1], X.T.t[2] - T0.t[2]]), q = qmul(dq, X.T.q), l = Math.hypot(...q); X.T = { q: q.map(v => v / l), t: [T1.t[0] + r[0], T1.t[1] + r[1], T1.t[2] + r[2]] }; }
    this.mates = kept;
    const m = { a: { inst: aInst, frame: aFrame }, b: { inst: bInst, frame: bFrame }, screw: screw || null }; this.mates.push(m);
    return { ok: true, mate: m, check: this.check(m) };
  }
  /** Every part reachable from `instId` through mates (optionally through a given list of mates instead of the current ones). */
  component(instId, mates = this.mates) {
    const seen = new Set([instId]), stack = [instId];
    while (stack.length) { const v = stack.pop(); for (const m of mates) for (const [x, y] of [[m.a.inst, m.b.inst], [m.b.inst, m.a.inst]]) if (x === v && !seen.has(y)) { seen.add(y); stack.push(y); } }
    return [...seen];
  }
  isMated(instId, frameId) { return this.mates.some(m => (m.a.inst === instId && m.a.frame === frameId) || (m.b.inst === instId && m.b.frame === frameId)); }
  matesOf(instId) { return this.mates.filter(m => m.a.inst === instId || m.b.inst === instId); }
  /** While B is being dragged: the nearest free hole pair (a hole of B, a hole of another part) within `reach` (mm, or whatever `measure` returns, e.g. pixels on screen) whose sizes are compatible, else null. */
  snapFor(bInst, { reach = 7, maxSizeGap = 1.2, measure = null } = {}) {
    const B = this.get(bInst); if (!B) return null; let best = null;
    for (const fb of B.part.frames) {
      if (this.isMated(B.id, fb.id)) continue; const wb = worldFrame(B, fb);
      for (const A of this.instances) {
        if (A === B) continue;
        for (const fa of A.part.frames) {
          if (this.isMated(A.id, fa.id)) continue;
          if (fa.diameter && fb.diameter && Math.abs(fa.diameter - fb.diameter) > maxSizeGap) continue;
          const wa = worldFrame(A, fa), d = measure ? measure(wa.pos, wb.pos) : Math.hypot(wa.pos[0] - wb.pos[0], wa.pos[1] - wb.pos[1], wa.pos[2] - wb.pos[2]);
          if (d <= reach && (!best || d < best.dist)) best = { a: A.id, aFrame: fa.id, bFrame: fb.id, dist: d };
        }
      }
    }
    return best;
  }
  /** A copy of the arrangement, for undo. Part objects are shared, transforms and mates are copied. */
  snapshot() { return { instances: this.instances.map(i => ({ ...i, T: { q: [...i.T.q], t: [...i.T.t] } })), mates: this.mates.map(m => ({ a: { ...m.a }, b: { ...m.b }, screw: m.screw, angle: m.angle, min: m.min, max: m.max, fixed: m.fixed })), counter: this.counter }; }
  restore(s) { this.instances = s.instances.map(i => ({ ...i, T: { q: [...i.T.q], t: [...i.T.t] } })); this.mates = s.mates.map(m => ({ a: { ...m.a }, b: { ...m.b }, screw: m.screw, angle: m.angle, min: m.min, max: m.max, fixed: m.fixed })); this.counter = s.counter; }
  /** How well a mate fits: hole sizes, the screw that suits them, and whether the frames are still lined up (a later move can break it). */
  check(m) {
    const A = this.get(m.a.inst), B = this.get(m.b.inst); if (!A || !B) return { ok: false, notes: ['A part of this mate is gone.'], level: 'bad' };
    const fa = A.part.frames.find(f => f.id === m.a.frame), fb = B.part.frames.find(f => f.id === m.b.frame), notes = []; let level = 'ok';
    const wa = worldFrame(A, fa), wb = worldFrame(B, fb), gap = Math.hypot(wa.pos[0] - wb.pos[0], wa.pos[1] - wb.pos[1], wa.pos[2] - wb.pos[2]), tilt = dot(wa.dir, wb.dir);
    if (gap > 0.05 || tilt > -0.999) { notes.push(`These frames have come apart (${gap.toFixed(2)} mm off); mate them again.`); level = 'bad'; }
    const da = fa.diameter, db = fb.diameter, est = [fa, fb].some(f => f.source === 'estimated');
    if (da && db) {
      const small = Math.min(da, db), s = m.screw || screwFor(small);
      if (Math.abs(da - db) > 0.4) { notes.push(`Hole sizes differ by ${Math.abs(da - db).toFixed(1)} mm (${da} and ${db}).`); if (level === 'ok') level = 'warn'; }
      if (m.screw) { const cl = THREADS[m.screw]?.[1]; if (cl && cl > small + 0.05) { notes.push(`${m.screw.replace('_', '.')} needs a ${cl} mm hole; the smaller hole is ${small} mm.`); level = 'bad'; } }
      else if (!s) { notes.push(`The smaller hole (${small} mm) is too small for any screw in the table.`); level = 'bad'; }
      else notes.push(`${s.replace('_', '.')} screw fits through (hole ${small} mm).`);
    } else notes.push('One of the frames has no diameter, so the fit cannot be checked.');
    if (est) { notes.push('A size here is still an estimate.'); if (level === 'ok') level = 'warn'; }
    return { ok: level !== 'bad', level, notes };
  }
  /** Parts and screws, counted. Mates with no chosen screw use the one that suits the smaller hole. */
  bom() {
    const parts = new Map(), screws = new Map();
    for (const i of this.instances) parts.set(i.part.name, (parts.get(i.part.name) || 0) + 1);
    for (const m of this.mates) {
      const A = this.get(m.a.inst), B = this.get(m.b.inst); if (!A || !B) continue;
      const fa = A.part.frames.find(f => f.id === m.a.frame), fb = B.part.frames.find(f => f.id === m.b.frame);
      const s = m.screw || (fa?.diameter && fb?.diameter ? screwFor(Math.min(fa.diameter, fb.diameter)) : null); if (s) screws.set(s, (screws.get(s) || 0) + 1);
    }
    const grams = this.instances.reduce((g, i) => g + (i.part.mass?.grams || 0), 0);
    return { parts: [...parts].map(([name, count]) => ({ name, count })), screws: [...screws].map(([thread, count]) => ({ thread, count })), grams: Math.round(grams * 10) / 10 };
  }
}
