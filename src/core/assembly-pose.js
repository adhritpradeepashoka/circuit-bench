// Posing a built robot: joined parts become a rig. A part joined to another by ONE screw (or several on the same line) is a hinge:
// it can only swing about that screw, between angle limits. Parts joined at two or more separate points, or marked Fixed, move as one body.
// Dragging a part moves every part beyond it, and only as far as the hinges allow. Pure maths, no DOM; units mm and degrees.
import { worldFrame, turn } from './assembly-scene.js';

export const DEFAULT_LIMITS = [-90, 90];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const frameOf = (asm, side) => { const i = asm.get(side.inst); return i && worldFrame(i, i.part.frames.find(f => f.id === side.frame)); };
const limitsOf = m => [m.min ?? DEFAULT_LIMITS[0], m.max ?? DEFAULT_LIMITS[1]];

/** Groups the instances into rigid bodies joined by hinges. */
export function buildRig(asm) {
  const ix = new Map(asm.instances.map((i, k) => [i.id, k])), par = asm.instances.map((_, k) => k);
  const find = x => (par[x] === x ? x : (par[x] = find(par[x]))), union = (a, b) => { par[find(a)] = find(b); };
  const pairs = new Map();
  for (const m of asm.mates) { if (!ix.has(m.a.inst) || !ix.has(m.b.inst)) continue; const k = [m.a.inst, m.b.inst].sort().join('|'); (pairs.get(k) || pairs.set(k, []).get(k)).push(m); }
  const hinges = [];
  for (const ms of pairs.values()) {
    const wf = ms.map(m => frameOf(asm, m.a)), line = wf.every(f => Math.abs(dot(f.dir, wf[0].dir)) > 0.999 && Math.hypot(...cross(sub(f.pos, wf[0].pos), wf[0].dir)) < 0.15);
    if (!ms.some(m => m.fixed) && line) hinges.push(ms[0]); else ms.forEach(m => union(ix.get(m.a.inst), ix.get(m.b.inst)));
  }
  const bodyOf = id => find(ix.get(id)), members = new Map();
  asm.instances.forEach((i, k) => { const b = find(k); (members.get(b) || members.set(b, []).get(b)).push(i.id); });
  const joints = hinges.map(m => ({ mate: m, a: bodyOf(m.a.inst), b: bodyOf(m.b.inst) })).filter(j => j.a !== j.b);
  return { bodyOf, members, joints };
}
/** The parts reachable from `inst` through joins (whatever the joint). */
export function connected(asm, instId) {
  const seen = new Set([instId]), stack = [instId];
  while (stack.length) { const v = stack.pop(); for (const m of asm.mates) for (const [x, y] of [[m.a.inst, m.b.inst], [m.b.inst, m.a.inst]]) if (x === v && !seen.has(y) && asm.get(y)) { seen.add(y); stack.push(y); } }
  return [...seen];
}
/** The hinge tree of one connected robot: rooted at `anchorId`'s body if it belongs to it, else at its first part. */
function treeFor(asm, rig, grabId, anchorId) {
  const comp = connected(asm, grabId), root = rig.bodyOf(comp.includes(anchorId) ? anchorId : comp.sort((a, b) => asm.instances.findIndex(i => i.id === a) - asm.instances.findIndex(i => i.id === b))[0]);
  const up = new Map([[root, null]]), order = [root];
  for (let k = 0; k < order.length; k++) for (const j of rig.joints) { for (const [x, y, childIsB] of [[j.a, j.b, true], [j.b, j.a, false]]) if (x === order[k] && !up.has(y)) { up.set(y, { joint: j, parent: x, childIsB }); order.push(y); } }
  const below = body => { const out = [body]; for (let k = 0; k < out.length; k++) for (const [b, u] of up) if (u && u.parent === out[k]) out.push(b); return out.flatMap(b => rig.members.get(b)); };
  return { root, up, below, comp };
}
const inv3 = m => {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C; if (Math.abs(det) < 1e-12) return null;
  return [A, c * h - b * i, b * f - c * e, B, a * i - c * g, c * d - a * f, C, b * g - a * h, a * e - b * d].map(v => v / det);
};
function swing(asm, tree, link, deg) {                                     // rotate everything beyond a hinge by `deg`, within its limits; returns what was really applied
  const { joint, childIsB } = link, m = joint.mate, [lo, hi] = limitsOf(m), cur = m.angle || 0, next = Math.max(lo, Math.min(hi, cur + deg)), d = next - cur;
  if (Math.abs(d) < 1e-9) return 0;
  const f = frameOf(asm, m.a), child = joint.a === link.parent ? joint.b : joint.a;
  for (const id of tree.below(child)) turn(asm.get(id), f.dir, f.pos, childIsB ? d : -d);
  m.angle = next; return d;
}
/** Where a point fixed to a part (given in the part's own space) is in the world. */
export const pointOn = (inst, local) => worldFrame(inst, { pos: local, dir: [0, 0, 1] }).pos;

/** Drag: pull the point `local` of part `grabId` toward `target`. Parts beyond the grabbed one follow; hinges stop at their limits.
 *  Grabbing the held (anchor) part moves the whole robot instead. Returns { mode: 'move' | 'pose' | 'free', miss } (miss = mm still to go). */
export function dragTo(asm, anchorId, grabId, local, target, { iters = 24, damping = 12 } = {}) {
  const rig = buildRig(asm), grab = asm.get(grabId); if (!grab) return { mode: 'free', miss: 0 };
  const tree = treeFor(asm, rig, grabId, anchorId), gb = rig.bodyOf(grabId);
  if (tree.comp.length === 1 || !rig.joints.some(j => tree.up.has(j.a) || tree.up.has(j.b))) { if (tree.comp.length === 1) return { mode: 'free', miss: 0 }; }
  if (gb === tree.root) {
    const d = sub(target, pointOn(grab, local)); for (const id of tree.comp) { const i = asm.get(id); i.T = { q: i.T.q, t: [i.T.t[0] + d[0], i.T.t[1] + d[1], i.T.t[2] + d[2]] }; } return { mode: 'move', miss: 0 };
  }
  const path = []; for (let b = gb; tree.up.get(b); b = tree.up.get(b).parent) path.unshift(tree.up.get(b));      // root → grabbed body
  let miss = 0;
  for (let it = 0; it < iters; it++) {
    const P = pointOn(grab, local), e = sub(target, P); miss = Math.hypot(...e); if (miss < 0.05) break;
    const cols = path.map(l => { const f = frameOf(asm, l.joint.mate.a), s = l.childIsB ? 1 : -1; return cross(f.dir, sub(P, f.pos)).map(v => v * s * Math.PI / 180); });      // mm per degree
    let lock = path.map(() => false);
    for (let pass = 0; pass < 2; pass++) {
      const J = cols.map((c, k) => (lock[k] ? [0, 0, 0] : c)), M = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (const c of J) for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) M[r * 3 + q] += c[r] * c[q];
      const lam = damping * damping * 1e-4; for (let r = 0; r < 3; r++) M[r * 4] += lam;
      const W = inv3(M); if (!W) break;
      const y = [0, 1, 2].map(r => W[r * 3] * e[0] + W[r * 3 + 1] * e[1] + W[r * 3 + 2] * e[2]);
      let dth = J.map(c => dot(c, y));
      const big = Math.max(...dth.map(Math.abs)); if (big > 6) dth = dth.map(v => v * 6 / big);                  // at most 6° per step
      const stuck = path.map((l, k) => { const [lo, hi] = limitsOf(l.joint.mate), a = l.joint.mate.angle || 0; return (dth[k] > 0 && a >= hi - 1e-6) || (dth[k] < 0 && a <= lo + 1e-6); });
      if (pass === 0 && stuck.some(Boolean)) { lock = stuck; continue; }
      path.forEach((l, k) => { if (!lock[k] || pass === 1) swing(asm, tree, l, dth[k]); }); break;
    }
  }
  const e = sub(target, pointOn(grab, local)); return { mode: 'pose', miss: Math.hypot(...e) };
}
/** Set one hinge to an angle (degrees, within its limits) by swinging the side away from the anchor. */
export function setAngle(asm, anchorId, mate, deg) {
  const rig = buildRig(asm), j = rig.joints.find(x => x.mate === mate); if (!j) return false;
  const tree = treeFor(asm, rig, mate.a.inst, anchorId), link = tree.up.get(j.a) && tree.up.get(j.a).joint === j ? tree.up.get(j.a) : tree.up.get(j.b);
  if (!link) return false; swing(asm, tree, link, deg - (mate.angle || 0)); return true;
}
