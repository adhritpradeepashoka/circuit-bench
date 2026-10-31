import test from 'node:test';
import assert from 'node:assert/strict';
import { quickDrone } from '../src/core/quick-drone.js';
import { droneWiring } from '../src/core/drone-wiring.js';
import { TEMPLATES } from '../src/core/part-templates.js';

// apply the actions the way the bench does (parts and wires only: that is all this builder emits)
const apply = (circuit, actions) => {
  const parts = [...circuit.parts], wires = [...circuit.wires];
  for (const a of actions) {
    if (a.op === 'add_part') { assert.ok(TEMPLATES.some(t => `custom-${t.id}` === a.type), a.type); parts.push({ id: a.id, type: a.type, x: a.x, y: a.y }); }
    if (a.op === 'add_wire') { assert.ok(parts.some(p => p.id === a.from.part) && parts.some(p => p.id === a.to.part)); wires.push({ from: a.from, to: a.to }); }
  }
  return { parts, wires };
};
const check = c => droneWiring({ parts: c.parts, wires: c.wires.map(w => ({ a: w.from, b: w.to })) });

test('"build a drone circuit" makes a small AIO drone that the wiring check passes', () => {
  const q = quickDrone('can you build a drone circuit for me?'); assert.ok(q);
  const w = check(apply({ parts: [], wires: [] }, q.actions));
  assert.deepEqual(w.problems, []); assert.equal(w.fatal, null); assert.equal(w.camera, true);
  assert.deepEqual(Object.keys(w.slotOf).sort(), ['back left', 'back right', 'front left', 'front right']);
});

test('"make a 5 inch quad" builds a stack with a capacitor, receiver and video transmitter, and it checks out', () => {
  const q = quickDrone('make a 5 inch quad'); assert.ok(q);
  assert.ok(q.actions.some(a => a.type === 'custom-drone-cap') && q.actions.some(a => a.type === 'custom-drone-esc') && !q.actions.some(a => a.type === 'custom-drone-aio'));
  const w = check(apply({ parts: [], wires: [] }, q.actions));
  assert.deepEqual(w.problems, []); assert.equal(w.fatal, null);
});

test('a second ask on a finished bench adds nothing; a half-wired bench is completed', () => {
  const done = apply({ parts: [], wires: [] }, quickDrone('build a drone circuit').actions);
  assert.deepEqual(quickDrone('build a drone circuit', done).actions, []);
  const half = { parts: done.parts, wires: done.wires.filter((_, i) => i % 3) };
  const fixed = apply(half, quickDrone('wire up the motors on my drone', half).actions);
  assert.deepEqual(check(fixed).problems, []);
});

test('diagnosis questions and unrelated asks are left to the model', () => {
  assert.equal(quickDrone('why does my drone motor spin the wrong way'), null);
  assert.equal(quickDrone('add a red led'), null);
});
