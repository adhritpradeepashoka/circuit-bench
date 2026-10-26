import test from 'node:test';
import assert from 'node:assert/strict';
import { Assembly } from '../src/core/assembly-scene.js';
import { describeAssembly, runAssemblyOps, ASSEMBLY_OPS } from '../src/core/assembly-actions.js';
import { buildPrompt, parseReply } from '../src/core/ai-prompt.js';

const hole = (id, pos, dir, d = 3) => ({ id, kind: 'hole', pos, dir, diameter: d, source: 'measured' });
const link = n => ({ id: n, name: n, category: 'Test', mass: { grams: 1 }, frames: [hole('p', [0, 0, 0], [0, -1, 0]), hole('q', [40, 0, 0], [0, 1, 0])] });
const setup = () => { const asm = new Assembly(), cat = [link('link')], ctx = { anchorId: null, partById: id => cat.find(p => p.id === id), addPart: async (p, at) => asm.add(p, at ? [at[0], at[1], 0] : [asm.instances.length * 100, 0, 0]) }; return { asm, cat, ctx }; };

test('the AI can build a two-link arm and bend it, in one batch with its own short names', async () => {
  const { asm, cat, ctx } = setup();
  const out = await runAssemblyOps(asm, [
    { op: 'add_part', id: 'upper', part: 'link' }, { op: 'add_part', id: 'lower', part: 'link' },
    { op: 'join', a: { id: 'upper', hole: 'q' }, b: { id: 'lower', hole: 'p' } }, { op: 'set_angle', a: 'upper', b: 'lower', deg: 40 }], ctx);
  assert.equal(out.done, 4, out.warnings.join('|')); assert.equal(asm.instances.length, 2); assert.equal(asm.mates.length, 1); assert.equal(Math.round(asm.mates[0].angle), 40);
  assert.ok(asm.mates.every(m => asm.check(m).level !== 'bad'));
  assert.ok(describeAssembly(asm, cat).joints.includes('hinge, angle 40'));
});
test('bad edits are skipped with a reason and the rest still run', async () => {
  const { asm, ctx } = setup();
  const out = await runAssemblyOps(asm, [{ op: 'add_part', part: 'nope' }, { op: 'add_part', id: 'a', part: 'link' }, { op: 'join', a: { id: 'a', hole: 'zz' }, b: { id: 'ghost', hole: 'p' } }, { op: 'explode' }, { op: 'set_angle', a: 'a', b: 'a', deg: 5 }], ctx);
  assert.equal(out.done, 1); assert.equal(out.warnings.length, 4); assert.ok(out.warnings.some(w => /no part “nope”|there is no part/.test(w)));
});
test('angles outside the limits are clamped and said so; joined parts refuse a plain move', async () => {
  const { asm, ctx } = setup();
  await runAssemblyOps(asm, [{ op: 'add_part', id: 'a', part: 'link' }, { op: 'add_part', id: 'b', part: 'link' }, { op: 'join', a: { id: 'a', hole: 'q' }, b: { id: 'b', hole: 'p' } }], ctx);
  const [ia, ib] = asm.instances.map(i => i.id), o = await runAssemblyOps(asm, [{ op: 'set_angle', a: ia, b: ib, deg: 170 }, { op: 'move_part', id: ib, x: 10 }], { ...ctx, anchorId: asm.instances[0].id, partById: ctx.partById });
  assert.equal(Math.round(asm.mates[0].angle), 90); assert.ok(o.warnings.some(w => /outside this joint's limits/.test(w))); assert.ok(o.warnings.some(w => /joined to other parts/.test(w)));
});
test('hold, unjoin, set_joint and remove work', async () => {
  const { asm, ctx } = setup();
  await runAssemblyOps(asm, [{ op: 'add_part', id: 'a', part: 'link' }, { op: 'add_part', id: 'b', part: 'link' }, { op: 'join', a: { id: 'a', hole: 'q' }, b: { id: 'b', hole: 'p' } }, { op: 'set_joint', a: 'a', b: 'b', type: 'hinge', min: -45, max: 45 }, { op: 'hold', id: 'b' }], ctx);
  assert.equal(asm.mates[0].max, 45); assert.equal(ctx.anchorId, asm.instances[1].id);
  const [ia, ib] = asm.instances.map(i => i.id), o = await runAssemblyOps(asm, [{ op: 'unjoin', a: ia, b: ib }, { op: 'remove_part', id: ia }], ctx); assert.equal(o.done, 2); assert.equal(asm.instances.length, 1); assert.equal(asm.mates.length, 0);
});
test('the 3D prompt lists the parts, the scene and the allowed edits, and its reply parses like any other', () => {
  const { asm, cat } = setup(), p = buildPrompt({ instruction: 'make an arm', assembly: describeAssembly(asm, cat) });
  assert.ok(p.includes('link — link') && p.includes('q Ø3') && p.includes(ASSEMBLY_OPS) && !p.includes('Arduino')); assert.ok(p.includes('make an arm'));
  const r = parseReply('```json\n{"actions":[{"op":"add_part","part":"link"}],"explanation":"Added a link."}\n```'); assert.equal(r.actions.length, 1);
});
