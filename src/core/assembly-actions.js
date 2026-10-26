// What the AI chat can do to the 3D assembly: a small, checked vocabulary of edits (add, move, turn, join, unjoin, set an angle, hold, remove).
// The AI only ever sends data; this module reads the scene for the prompt and carries the edits out on an Assembly, saying in words what it refused.
import { turn, worldFrame } from './assembly-scene.js';
import { setAngle, connected, DEFAULT_LIMITS } from './assembly-pose.js';

export const ASSEMBLY_OPS = 'add_part, move_part, rotate_part, join, unjoin, set_angle, set_joint, hold, remove_part';
const r1 = v => Math.round(v * 10) / 10, v3 = a => `[${a.map(r1).join(',')}]`;

/** The scene and the parts available, as short text for the prompt. */
export function describeAssembly(asm, catalog, anchorId = null) {
  const parts = catalog.map(p => `- ${p.id} — ${p.name}${p.category ? ` (${p.category})` : ''}, ${p.mass?.grams ?? '?'} g. Holes (id Ø mm, position in the part's own space, outward direction): ${p.frames.map(f => `${f.id} Ø${f.diameter ?? '?'} @${v3(f.pos)} →${v3(f.dir)}`).join('; ') || 'none marked'}`);
  const inst = asm.instances.map(i => `- ${i.id} (${i.part.name}) origin ${v3(i.T.t)} mm, quaternion ${i.T.q.map(v => Math.round(v * 1000) / 1000).join(',')}${anchorId === i.id ? ', HELD STILL' : ''}`);
  const joints = asm.mates.map(m => `- ${m.a.inst} ${m.a.frame} ⇄ ${m.b.inst} ${m.b.frame}: ${m.fixed ? 'fixed' : 'hinge'}, angle ${Math.round(m.angle || 0)}°, limits ${m.min ?? DEFAULT_LIMITS[0]}..${m.max ?? DEFAULT_LIMITS[1]}°`);
  return { parts: parts.join('\n'), instances: inst.join('\n') || '(nothing placed yet)', joints: joints.join('\n') || '(nothing joined yet)' };
}

/**
 * Carry out edits. `ctx` supplies the parts that need the 3D view: addPart(part, [x,y]|null) → the new instance; partById(id); anchorId (read and written).
 * Returns { done, warnings }. A bad edit is skipped with a warning and the rest still run.
 */
export async function runAssemblyOps(asm, ops, ctx) {
  const alias = new Map(), warnings = []; let done = 0;
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
  return { done, warnings };
}
export { worldFrame };
