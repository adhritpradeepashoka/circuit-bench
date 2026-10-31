import test from 'node:test';
import assert from 'node:assert/strict';
import { Assembly } from '../src/core/assembly-scene.js';
import { runAssemblyOps } from '../src/core/assembly-actions.js';
import { quickAssembly, parsePropId, parseMotorId } from '../src/core/quick-assembly.js';
import { makeDronePart } from '../src/core/drone-parts.js';
import { validateRobotPart } from '../src/core/robot-part.js';

const part = id => { const v = validateRobotPart(makeDronePart(id)); assert.ok(v.ok, `${id}: ${v.errors || v.error}`); return { ...v.part, drone: makeDronePart(id).drone }; };
const pairs = asm => new Set(asm.mates.map(m => [m.a.inst, m.b.inst].sort().join('+'))).size;     // one join = several screws
const world = async frameId => {
  const asm = new Assembly(), cache = new Map(), get = id => cache.get(id) || (cache.set(id, part(id)), cache.get(id));
  const ctx = { anchorId: null, partById: id => { try { return get(id); } catch { return null; } }, addPart: async (p, at) => asm.add(p, at ? [at[0], at[1], 0] : [0, 0, 0]) };
  await runAssemblyOps(asm, [{ op: 'add_part', id: 'frame', part: frameId }], ctx);
  const snap = () => ({ instances: asm.instances.map(i => ({ id: i.id, part: i.part.id, name: i.part.name, kind: i.part.drone?.kind || null, frames: i.part.frames.map(f => f.id), wheelbase: i.part.drone?.wheelbase })), mates: asm.mates.map(m => ({ a: { inst: m.a.inst, frame: m.a.frame }, b: { inst: m.b.inst, frame: m.b.frame } })), catalog: [] });
  return { asm, ctx, snap };
};

test('"put motors on" joins four motors to the frame, for every frame size, and the edits really apply', async () => {
  for (const frame of ['frame-quad-75-t6.6-16', 'frame-quad-142-12-20', 'frame-quad-220-16-30.5', 'frame-quad-300-16-30.5']) {
    const { asm, ctx, snap } = await world(frame), q = quickAssembly('put motors on', snap());
    assert.ok(q && q.actions.length === 8, frame);
    const out = await runAssemblyOps(asm, q.actions, ctx);
    assert.equal(out.warnings.length, 0, `${frame}: ${out.warnings.join('|')}`);
    assert.equal(pairs(asm), 4); assert.equal(asm.instances.length, 5);
    assert.match(quickAssembly('put motors on', snap()).explanation, /already has a motor/);       // second time: nothing to do
  }
});
test('"put props on the motors" gives every bare motor a prop; the named prop size wins', async () => {
  const { asm, ctx, snap } = await world('frame-quad-220-16-30.5');
  await runAssemblyOps(asm, quickAssembly('add four motors', snap()).actions, ctx);
  const q = quickAssembly('Put Prop 5 x 4.3 x 3 on the motors', snap());
  assert.equal(q.actions.filter(a => a.op === 'add_part').length, 4); assert.ok(q.actions.every(a => a.op !== 'add_part' || a.part === 'prop-5x4.3x3-b5'));
  const out = await runAssemblyOps(asm, q.actions, ctx); assert.equal(out.warnings.length, 0, out.warnings.join('|')); assert.equal(pairs(asm), 8);
  assert.match(quickAssembly('put props on', snap()).explanation, /already has a prop/);
});
test('it explains what is missing instead of guessing, and leaves questions and unknown requests to the AI', async () => {
  const empty = { instances: [], mates: [], catalog: [] };
  assert.match(quickAssembly('put motors on', empty).explanation, /no frame/);
  assert.match(quickAssembly('put props on the motors', empty).explanation, /no motors/);
  assert.equal(quickAssembly('why is the drone tilted?', empty), null);
  assert.equal(quickAssembly('make the robot walk faster', empty), null);
  assert.equal(quickAssembly('', empty), null); assert.equal(quickAssembly('put motors on', null), null);
});
test('size parsing', () => {
  assert.equal(parsePropId('prop 5 x 4.3 x 3'), 'prop-5x4.3x3-b5'); assert.equal(parsePropId('3x3x3 props'), 'prop-3x3x3-b2'); assert.equal(parsePropId('props'), null);
  assert.equal(parseMotorId('put 2207 1900kv motors on'), 'motor-2207-1900'); assert.equal(parseMotorId('motor-0802-19000'), 'motor-0802-19000'); assert.equal(parseMotorId('motors'), null);
});

test('coreless brushed motors exist as parts, fit the whoop frame and are understood by name', () => {
  for (const id of ['motor-8520-12000', 'motor-0716-10000', 'motor-0720-11000', 'motor-0615-9000']) {
    const p = part(id); assert.match(p.name, /Coreless/); assert.equal(p.drone.motor.brushed, true);
    assert.ok(p.drone.motor.massGrams < 6, 'a coreless motor weighs a few grams');
  }
  assert.equal(parseMotorId('add 4 coreless motors'), 'motor-8520-12000');
  assert.equal(parseMotorId('716 motors'), 'motor-0716-10000');
});
