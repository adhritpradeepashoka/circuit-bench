// What the AI chat can do to the 3D assembly: a small, checked vocabulary of edits (add, move, turn, join, unjoin, set an angle, hold, remove).
// The AI only ever sends data; this module reads the scene for the prompt and carries the edits out on an Assembly, saying in words what it refused.
import { turn, worldFrame } from './assembly-scene.js';
import { setAngle, connected, DEFAULT_LIMITS } from './assembly-pose.js';

export const ASSEMBLY_OPS = 'add_part, move_part, rotate_part, place_next_to, measure, join, unjoin, set_angle, set_joint, hold, remove_part';
const r1 = v => Math.round(v * 10) / 10, v3 = a => `[${a.map(r1).join(',')}]`;

const AXES = { x: 0, y: 1, z: 2 };
/** Gap between two boxes on each axis (negative = they overlap by that much) and the straight-line gap when they are apart. */
export function boxGap(a, b) {
  const per = [0, 1, 2].map(k => Math.max(a.min[k] - b.max[k], b.min[k] - a.max[k])), apart = per.filter(g => g > 0);
  return { per, overlap: per.every(g => g < 0) ? -Math.max(...per) : 0, dist: apart.length ? Math.hypot(...apart) : 0 };
}
const SIDES = { '+x': [0, 1], '-x': [0, -1], '+y': [1, 1], '-y': [1, -1], '+z': [2, 1], '-z': [2, -1], right: [0, 1], left: [0, -1], front: [1, 1], behind: [1, -1], back: [1, -1], above: [2, 1], on_top: [2, 1], below: [2, -1] };
/** The 3D picture of the scene for the prompt: how big each part is, where it spans in the world, which holes are free (world position and direction), what touches or overlaps what. `boxes` = { instId: {min, max} } in world mm. */
export function describeSpace(asm, boxes) {
  const ins = asm.instances; if (!boxes || !ins.length) return '';
  const have = ins.filter(i => boxes[i.id]), out = [];
  const lo = [0, 1, 2].map(k => Math.min(...have.map(i => boxes[i.id].min[k]))), hi = [0, 1, 2].map(k => Math.max(...have.map(i => boxes[i.id].max[k])));
  out.push(`Whole scene spans x ${r1(lo[0])}..${r1(hi[0])}, y ${r1(lo[1])}..${r1(hi[1])}, z ${r1(lo[2])}..${r1(hi[2])} mm (${r1(hi[0] - lo[0])} × ${r1(hi[1] - lo[1])} × ${r1(hi[2] - lo[2])}); the floor is z = 0${lo[2] < -0.5 ? ` and the lowest part is ${r1(-lo[2])} mm BELOW it` : ''}.`);
  for (const i of have) {
    const b = boxes[i.id], free = i.part.frames.filter(f => !asm.isMated(i.id, f.id)), shown = free.slice(0, 10).map(f => { const w = worldFrame(i, f); return `${f.id} @${v3(w.pos)} →${v3(w.dir)}`; });
    out.push(`- ${i.id} (${i.part.name}): box ${r1(b.max[0] - b.min[0])} × ${r1(b.max[1] - b.min[1])} × ${r1(b.max[2] - b.min[2])} mm, x ${r1(b.min[0])}..${r1(b.max[0])}, y ${r1(b.min[1])}..${r1(b.max[1])}, z ${r1(b.min[2])}..${r1(b.max[2])}; free holes (world): ${shown.join('; ') || 'none'}${free.length > shown.length ? `; and ${free.length - shown.length} more` : ''}`);
  }
  const rel = [];
  for (let x = 0; x < have.length; x++) for (let y = x + 1; y < have.length; y++) {
    const A = have[x], B = have[y], g = boxGap(boxes[A.id], boxes[B.id]), joined = asm.mates.some(m => (m.a.inst === A.id && m.b.inst === B.id) || (m.a.inst === B.id && m.b.inst === A.id));
    if (g.overlap > 0.5 && !joined) rel.push(`${A.id} and ${B.id} OVERLAP by about ${r1(g.overlap)} mm (not joined to each other)`);
    else if (g.dist > 0 && g.dist < 15) rel.push(`${A.id} and ${B.id} are ${r1(g.dist)} mm apart`);
  }
  out.push(rel.length ? `Close or overlapping: ${rel.slice(0, 12).join('; ')}.` : 'No two parts overlap or sit within 15 mm of each other.');
  return out.join('\n');
}

/** The scene and the parts available, as short text for the prompt. */
export function describeAssembly(asm, catalog, anchorId = null, boxes = null) {
  const parts = catalog.map(p => `- ${p.id} — ${p.name}${p.category ? ` (${p.category})` : ''}, ${p.mass?.grams ?? '?'} g. Holes (id Ø mm, position in the part's own space, outward direction): ${p.frames.map(f => `${f.id} Ø${f.diameter ?? '?'} @${v3(f.pos)} →${v3(f.dir)}`).join('; ') || 'none marked'}`);
  const inst = asm.instances.map(i => `- ${i.id} (${i.part.name}) origin ${v3(i.T.t)} mm, quaternion ${i.T.q.map(v => Math.round(v * 1000) / 1000).join(',')}${anchorId === i.id ? ', HELD STILL' : ''}`);
  const joints = asm.mates.map(m => `- ${m.a.inst} ${m.a.frame} ⇄ ${m.b.inst} ${m.b.frame}: ${m.fixed ? 'fixed' : 'hinge'}, angle ${Math.round(m.angle || 0)}°, limits ${m.min ?? DEFAULT_LIMITS[0]}..${m.max ?? DEFAULT_LIMITS[1]}°`);
  const space = describeSpace(asm, boxes);
  return { parts: parts.join('\n'), instances: (inst.join('\n') || '(nothing placed yet)') + (space ? `\n\nIn space (world mm):\n${space}` : ''), joints: joints.join('\n') || '(nothing joined yet)' };
}

/**
 * Carry out edits. `ctx` supplies the parts that need the 3D view: addPart(part, [x,y]|null) → the new instance; partById(id); anchorId (read and written).
 * Returns { done, warnings }. A bad edit is skipped with a warning and the rest still run.
 */
export async function runAssemblyOps(asm, ops, ctx) {
  const alias = new Map(), warnings = [], notes = []; let done = 0;
  const inst = id => asm.get(alias.get(id) || id);
  const num = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  const mateOf = (a, b) => asm.mates.find(m => (m.a.inst === a && m.b.inst === b) || (m.a.inst === b && m.b.inst === a));
  for (const op of Array.isArray(ops) ? ops : []) {
    const o = op && typeof op === 'object' ? op : {}, say = t => warnings.push(`${o.op || 'edit'}: ${t}`);
    try {
      if (o.op === 'add_part') {
        const part = ctx.partById(o.part); if (!part) { say(`there is no part “${o.part}”. Only the listed parts exist.`); continue; }
        const x = num(o.x), y = num(o.y), i = await ctx.addPart(part, x != null && y != null ? [x, y] : null); if (!i) { say('could not be added.'); continue; }
        if (num(o.z) != null) i.T.t[2] = num(o.z); if (o.id) alias.set(o.id, i.id); done++;
      } else if (o.op === 'move_part' || o.op === 'rotate_part') {
        const i = inst(o.id); if (!i) { say(`no part “${o.id}”.`); continue; }
        if (connected(asm, i.id).length > 1) { say(`${i.part.name} is joined to other parts. Change a joint angle, or unjoin it first.`); continue; }
        if (o.op === 'move_part') { const t = [num(o.x), num(o.y), num(o.z)]; if (t.every(v => v == null)) { say('needs x, y or z.'); continue; } i.T = { q: i.T.q, t: i.T.t.map((v, k) => (t[k] == null ? v : t[k])) }; }
        else { const ax = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[String(o.axis).toLowerCase()], deg = num(o.deg); if (!ax || deg == null) { say('needs axis x, y or z and deg.'); continue; } turn(i, ax, i.T.t, deg); }
        done++;
      } else if (o.op === 'place_next_to') {
        const i = inst(o.id), t = inst(o.to), side = SIDES[String(o.side || '').toLowerCase()]; if (!i || !t) { say('both parts must exist.'); continue; } if (!side) { say('side must be +x, -x, +y, -y, +z or -z (or left, right, front, behind, above, below).'); continue; }
        if (connected(asm, i.id).length > 1) { say(`${i.part.name} is joined to other parts. Unjoin it first.`); continue; }
        const bi = ctx.boxOf?.(i.id), bt = ctx.boxOf?.(t.id); if (!bi || !bt) { say('the 3D view is not ready to measure that.'); continue; }
        const [k, sg] = side, gap = num(o.gap) ?? 0, d = [0, 0, 0];
        for (let a = 0; a < 3; a++) d[a] = a === k ? (sg > 0 ? bt.max[k] + gap - bi.min[k] : bt.min[k] - gap - bi.max[k]) : ((bt.min[a] + bt.max[a]) - (bi.min[a] + bi.max[a])) / 2;
        for (const al of String(o.align || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean)) { const a = AXES[al[al.length - 1]], how = al.slice(0, -1); if (a == null || a === k) continue; d[a] = how === 'min' ? bt.min[a] - bi.min[a] : how === 'max' ? bt.max[a] - bi.max[a] : d[a]; }   // e.g. "minz" lines the bottoms up
        i.T = { q: i.T.q, t: i.T.t.map((v, a) => v + d[a]) }; done++;
      } else if (o.op === 'measure') {
        const A = inst(o.a), B = inst(o.b); if (!A || !B) { say('both parts must exist.'); continue; }
        const ba = ctx.boxOf?.(A.id), bb = ctx.boxOf?.(B.id); if (!ba || !bb) { say('the 3D view is not ready to measure that.'); continue; }
        const g = boxGap(ba, bb), c = [0, 1, 2].map(a => (bb.min[a] + bb.max[a]) / 2 - (ba.min[a] + ba.max[a]) / 2);
        notes.push(`${A.part.name} to ${B.part.name}: ${g.overlap > 0 ? `their boxes overlap by about ${r1(g.overlap)} mm` : `${r1(g.dist)} mm apart`} (gap by axis x ${r1(g.per[0])}, y ${r1(g.per[1])}, z ${r1(g.per[2])}); centre to centre ${v3(c)} mm.`);
      } else if (o.op === 'join') {
        const A = inst(o.a?.id), B = inst(o.b?.id); if (!A || !B) { say('both parts must exist.'); continue; }
        const r = asm.mateAll(A.id, o.a.hole, B.id, o.b.hole); if (!r.ok) { say(r.error); continue; }
        if (r.check.level === 'bad') warnings.push(`join: ${r.check.notes.join(' ')}`); done++;
      } else if (o.op === 'unjoin') {
        const A = inst(o.a), B = o.b ? inst(o.b) : null; if (!A) { say('no such part.'); continue; }
        const n = asm.mates.length; asm.mates = asm.mates.filter(m => (B ? !((m.a.inst === A.id && m.b.inst === B.id) || (m.a.inst === B.id && m.b.inst === A.id)) : m.a.inst !== A.id && m.b.inst !== A.id));
        if (asm.mates.length === n) say('nothing was joined there.'); else done++;
      } else if (o.op === 'set_angle' || o.op === 'set_joint') {
        const A = inst(o.a), B = inst(o.b), m = A && B && mateOf(A.id, B.id); if (!m) { say('those two parts are not joined.'); continue; }
        if (o.op === 'set_joint') {
          if (o.type === 'fixed') { m.fixed = true; if (m.angle) setAngle(asm, ctx.anchorId, m, 0); } else if (o.type === 'hinge') m.fixed = false;
          if (num(o.min) != null) m.min = num(o.min); if (num(o.max) != null) m.max = num(o.max);
        } else {
          const deg = num(o.deg); if (deg == null) { say('needs deg.'); continue; } if (m.fixed) { say('that joint is fixed; make it a hinge first.'); continue; }
          const lo = m.min ?? DEFAULT_LIMITS[0], hi = m.max ?? DEFAULT_LIMITS[1]; if (deg < lo || deg > hi) warnings.push(`set_angle: ${deg}° is outside this joint's limits (${lo}° to ${hi}°), so it went to ${Math.max(lo, Math.min(hi, deg))}°.`);
          if (!setAngle(asm, ctx.anchorId, m, Math.max(lo, Math.min(hi, deg)))) { say('that joint is rigid (held by two or more screws), so it cannot swing.'); continue; }
        }
        done++;
      } else if (o.op === 'hold') { const i = inst(o.id); if (!i) { say(`no part “${o.id}”.`); continue; } ctx.anchorId = i.id; done++; }
      else if (o.op === 'remove_part') { const i = inst(o.id); if (!i) { say(`no part “${o.id}”.`); continue; } ctx.removePart ? ctx.removePart(i.id) : asm.remove(i.id); done++; }
      else say('is not something I can do in the 3D view.');
    } catch (e) { say(e.message || 'failed.'); }
  }
  return { done, warnings, notes };
}
export { worldFrame };
