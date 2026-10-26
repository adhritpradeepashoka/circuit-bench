import test from 'node:test';
import assert from 'node:assert/strict';
import { Assembly, worldFrame } from '../src/core/assembly-scene.js';
import { buildRig, dragTo, pointOn, setAngle } from '../src/core/assembly-pose.js';

const part = (id, frames) => ({ id, name: id, mass: { grams: 1 }, frames });
const hole = (id, pos, dir) => ({ id, kind: 'hole', pos, dir, diameter: 3, source: 'measured' });
// a link 40 mm long with a hole at each end, both openings pointing along ±Y (so every joint swings in the X–Z plane)
const link = n => part(n, [hole('p', [0, 0, 0], [0, -1, 0]), hole('q', [40, 0, 0], [0, 1, 0])]);
function arm(n = 3) {
  const as = new Assembly(), ps = [as.add(link('l0'))];
  for (let k = 1; k < n; k++) { const b = as.add(link('l' + k), [100, 0, 0]); as.mate(ps[k - 1].id, 'q', b.id, 'p'); ps.push(b); }
  return { as, ps };
}
const joined = as => as.mates.every(m => as.check(m).level !== 'bad');

test('a chain joined by single screws is a chain of hinges', () => {
  const { as } = arm(3), r = buildRig(as); assert.equal(r.joints.length, 2); assert.equal(r.members.size, 3);
});
test('two separate screws between two parts make them one rigid body', () => {
  const as = new Assembly(), a = as.add(part('a', [hole('x', [0, 0, 0], [0, 0, 1]), hole('y', [20, 0, 0], [0, 0, 1])])), b = as.add(part('b', [hole('x', [0, 0, 0], [0, 0, -1]), hole('y', [20, 0, 0], [0, 0, -1])]));
  as.mate(a.id, 'x', b.id, 'x'); as.mate(a.id, 'y', b.id, 'y'); assert.equal(buildRig(as).joints.length, 0);
});
test('dragging the end of an arm swings the links, keeps every joint joined, and stays in the hinge plane', () => {
  const { as, ps } = arm(3), end = ps[2], local = [40, 0, 0], start = pointOn(end, local);
  const out = dragTo(as, ps[0].id, end.id, local, [start[0] - 30, start[1], start[2] + 40]);
  assert.equal(out.mode, 'pose'); assert.ok(out.miss < 1, `miss ${out.miss}`);
  assert.ok(joined(as), 'joints still line up'); assert.ok(Math.abs(pointOn(end, local)[1]) < 1e-6, 'did not leave the hinge plane');
  assert.ok(Math.abs(worldFrame(ps[0], ps[0].part.frames[0]).pos[0]) < 1e-9, 'the held part did not move');
});
test('a sideways pull does nothing the hinges do not allow', () => {
  const { as, ps } = arm(3), end = ps[2], start = pointOn(end, [40, 0, 0]);
  dragTo(as, ps[0].id, end.id, [40, 0, 0], [start[0], start[1] + 60, start[2]]); assert.ok(Math.abs(pointOn(end, [40, 0, 0])[1]) < 1e-6);
});
test('limits stop a hinge', () => {
  const { as, ps } = arm(2); as.mates[0].min = -30; as.mates[0].max = 30;
  dragTo(as, ps[0].id, ps[1].id, [40, 0, 0], [0, 0, 200]); assert.ok(Math.abs(as.mates[0].angle) <= 30 + 1e-6, `${as.mates[0].angle}`); assert.ok(joined(as));
});
test('dragging the held part moves the whole robot; setAngle swings one hinge', () => {
  const { as, ps } = arm(3); const p0 = pointOn(ps[0], [0, 0, 0]);
  assert.equal(dragTo(as, ps[0].id, ps[0].id, [0, 0, 0], [p0[0] + 10, p0[1], p0[2] + 5]).mode, 'move');
  assert.ok(Math.abs(pointOn(ps[0], [0, 0, 0])[0] - p0[0] - 10) < 1e-9); assert.ok(joined(as));
  assert.ok(setAngle(as, ps[0].id, as.mates[0], 45)); assert.equal(as.mates[0].angle, 45); assert.ok(joined(as));
});
