// Plain-words help while assembling, for ANY parts (a student's own frames and mounts included): it reads only the mates and the holes, never a lesson script.
//   explainJoin  : after two parts are joined, say what the join is (a hinge that swings, or a fixed mount) and why.
//   findProblems : what is probably wrong with the build so far (loose parts, parts through each other, a servo with nothing on it), each pointing at a part.
const nm = i => `“${i.part.name}”`;

/** Mates directly between two instances. */
export const matesBetween = (asm, a, b) => asm.mates.filter(m => (m.a.inst === a && m.b.inst === b) || (m.a.inst === b && m.b.inst === a));

/** What a join is, in a sentence or two. `extra` = how many more holes lined up and joined themselves. */
export function explainJoin(asm, aInst, bInst) {
  const A = asm.get(aInst), B = asm.get(bInst); if (!A || !B) return '';
  const ms = matesBetween(asm, aInst, bInst), soft = ms.some(m => [A, B].some(i => i.part.frames.find(f => f.id === (m.a.inst === i.id ? m.a.frame : m.b.frame))?.custom));
  if (soft && ms.length === 1) return `${nm(A)} and ${nm(B)} are held at one spot. It is not a screw, so use glue, tape or a zip tie, and it can still swivel there.`;
  if (ms.length === 1) return `One screw joins ${nm(A)} and ${nm(B)}, so ${nm(B)} can swing about it, like a hinge. Line up a second hole pair to make it a fixed mount.`;
  if (ms.length >= 2) return `${ms.length} screws join ${nm(A)} and ${nm(B)}. Two holes that line up stop it turning, so this is a rigid mount.`;
  return '';
}

/**
 * What is probably wrong. `boxes` (optional) maps instance id → world bounding box {min:[x,y,z], max:[x,y,z]} in mm, so parts that pass through each other can be found.
 * Returns [{ level: 'warn'|'info', inst, text }], worst first.
 */
export function findProblems(asm, { anchorId = null, boxes = null } = {}) {
  const out = [], ins = asm.instances; if (!ins.length) return out;
  // 1. parts that are not joined to anything, or a group cut off from the rest
  if (ins.length > 1) {
    const root = (anchorId && asm.get(anchorId)) || ins.reduce((best, i) => (asm.component(i.id).length > asm.component(best.id).length ? i : best), ins[0]);
    const main = new Set(asm.component(root.id));
    for (const i of ins) if (!main.has(i.id)) out.push({ level: 'warn', inst: i.id, text: asm.matesOf(i.id).length ? `${nm(i)} is joined to some parts, but not to the main robot.` : `${nm(i)} is not attached to anything. Drag it next to a hole, or use Join holes.` });
  }
  // 2. a servo that is fixed down but has nothing on its horn
  for (const i of ins) {
    const k = i.part.kit; if (k?.kind !== 'servo') continue; const horn = i.part.frames.find(f => /horn/.test(f.id)); if (!horn) continue;
    if (asm.matesOf(i.id).length && !asm.isMated(i.id, horn.id)) out.push({ level: 'info', inst: i.id, text: `Nothing is on the horn of ${nm(i)} yet. A servo only does work through its horn.` });
  }
  // 3. parts that push through each other (not counting parts that are screwed together, which touch on purpose)
  if (boxes) for (let x = 0; x < ins.length; x++) for (let y = x + 1; y < ins.length; y++) {
    const A = ins[x], B = ins[y], a = boxes[A.id], b = boxes[B.id]; if (!a || !b || matesBetween(asm, A.id, B.id).length) continue;
    const dep = [0, 1, 2].map(k => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]));
    if (dep.every(d => d > 3)) out.push({ level: 'warn', inst: A.id, text: `${nm(A)} and ${nm(B)} seem to pass through each other (about ${Math.round(Math.min(...dep))} mm). Move one away, or join them properly.` });
  }
  // 4. joints that have come apart or do not fit
  for (const m of asm.mates) { const c = asm.check(m); if (c.level === 'bad') out.push({ level: 'warn', inst: m.a.inst, text: c.notes[0] }); }
  return out.sort((p, q) => (p.level === q.level ? 0 : p.level === 'warn' ? -1 : 1));
}
