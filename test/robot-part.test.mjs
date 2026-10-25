// The robot part description (core/robot-part.js): data only, every number checked, every reference resolved, provenance kept.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRobotPart, provenanceOf, ROBOT_PART_FORMAT } from '../src/core/robot-part.js';

/** A demo micro servo. The numbers are ESTIMATES (marked so): the validator and the bill of materials must keep saying so. */
const servo = () => ({
  format: ROBOT_PART_FORMAT, version: 1, id: 'demo-micro-servo', name: 'Micro servo (demo)', category: 'Actuators', author: 'demo',
  model: { file: 'micro-servo.glb', format: 'glb', units: 'mm', up: 'z' },
  mass: { grams: 9, source: 'estimated' }, dims: { size: [22.5, 12, 22.7], source: 'estimated' },
  frames: [
    { id: 'ear-left', kind: 'hole', pos: [-13.75, 0, 16.5], dir: [0, 0, -1], diameter: 2.2, thread: 'M2', through: true, source: 'estimated' },
    { id: 'ear-right', kind: 'hole', pos: [13.75, 0, 16.5], dir: [0, 0, -1], diameter: 2.2, thread: 'M2', through: true, source: 'estimated' },
    { id: 'horn', kind: 'horn', pos: [-5.5, 0, 22.7], dir: [0, 0, 1], diameter: 4.8, teeth: 21, source: 'estimated' },
    { id: 'wires', kind: 'connector', pos: [11.25, 0, 8], dir: [1, 0, 0], source: 'estimated' },
  ],
  joints: [{ id: 'shaft', type: 'revolute', frame: 'horn', range: [0, 180] }],
  actuators: [{ id: 'drive', kind: 'servo', joint: 'shaft', params: { stallTorque: 0.176, noLoadSpeed: 600, supplyVolts: 4.8, stallCurrent: 0.65, idleCurrent: 0.01 }, source: 'estimated', port: 'servo' }],
  sensors: [{ id: 'pos', kind: 'encoder', joint: 'shaft' }],
  ports: [{ circuitPart: 'servo' }],
});

test('a complete part validates, is cleaned, and its estimates are called out', () => {
  const r = validateRobotPart(servo());
  assert.ok(r.ok, r.errors?.join());
  assert.equal(r.part.id, 'demo-micro-servo');
  assert.equal(r.part.frames.length, 4);
  assert.deepEqual(r.part.frames[0].dir, [0, 0, -1]);
  assert.equal(r.part.frames[0].thread, 'M2');
  assert.ok(r.warnings.some(w => /mass is estimated/.test(w)));
  const p = provenanceOf(r.part);
  assert.equal(p.verified, false);
  assert.ok(p.estimated.includes('mass') && p.estimated.includes('frame ear-left') && p.estimated.includes('actuator drive'));
  // once measured, it is verified
  const m = servo(); m.mass.source = 'measured'; m.dims.source = 'datasheet'; m.frames.forEach(f => { f.source = 'measured'; }); m.actuators[0].source = 'datasheet';
  assert.equal(provenanceOf(validateRobotPart(m).part).verified, true);
});

test('directions are normalised; a zero direction, a missing source or a bad number is refused', () => {
  const a = servo(); a.frames[0].dir = [0, 0, -5];
  assert.deepEqual(validateRobotPart(a).part.frames[0].dir, [0, 0, -1]);
  const bad = (mutate, re) => { const s = servo(); mutate(s); const r = validateRobotPart(s); assert.equal(r.ok, false, String(re)); assert.match(r.errors.join(' | '), re); };
  bad(s => { s.frames[0].dir = [0, 0, 0]; }, /must point somewhere/);
  bad(s => { delete s.mass.source; }, /say where it came from/);
  bad(s => { s.mass.source = 'guess'; }, /say where it came from/);
  bad(s => { s.mass.grams = 'heavy'; }, /mass\.grams must be a number/);
  bad(s => { s.mass.grams = -3; }, /mass\.grams must be between/);
  bad(s => { s.frames[0].pos = [1, 2]; }, /three numbers/);
  bad(s => { s.frames[0].diameter = 0; }, /diameter must be between/);
  bad(s => { s.frames[0].thread = 'M7'; }, /unknown thread/);
  bad(s => { s.frames[1].id = 'ear-left'; }, /Two frames are called/);
  bad(s => { s.frames[0].kind = 'magic'; }, /kind must be one of/);
  bad(s => { s.version = 2; }, /Unsupported version/);
  bad(s => { s.format = 'other'; }, /not a CircuitBench robot part/);
  bad(s => { s.name = ''; s.id = ''; }, /needs a name/);
});

test('references must resolve: joints to frames, actuators to joints, encoders to joints', () => {
  const bad = (mutate, re) => { const s = servo(); mutate(s); const r = validateRobotPart(s); assert.equal(r.ok, false); assert.match(r.errors.join(' | '), re); };
  bad(s => { s.joints[0].frame = 'nowhere'; }, /frame "nowhere" does not exist/);
  bad(s => { s.actuators[0].joint = 'nope'; }, /joint "nope" does not exist/);
  bad(s => { s.sensors[0].joint = 'nope'; }, /joint "nope" does not exist/);
  bad(s => { s.joints[0].range = [180, 0]; }, /range must be/);
  bad(s => { delete s.joints[0].range; }, /range must be/);
  bad(s => { s.actuators[0].params.stallTorque = undefined; }, /stallTorque.*required/);
  bad(s => { s.actuators[0].kind = 'warp-drive'; }, /kind must be one of/);
  bad(s => { s.model.file = '../../etc/passwd'; }, /file name may only use/);
  bad(s => { s.model.format = 'exe'; }, /Say the model format/);
});

test('other actuator kinds carry their own physics; strings are cleaned; sizes are capped', () => {
  const s = servo();
  s.joints.push({ id: 'wheel', type: 'revolute', frame: 'horn', range: [-360, 360] });
  s.actuators.push({ id: 'motor', kind: 'dc-motor', joint: 'wheel', params: { torqueConstant: 0.002, resistance: 2.5, gearRatio: 48, supplyVolts: 6 }, source: 'datasheet' });
  s.actuators.push({ id: 'step', kind: 'stepper', joint: 'wheel', params: { stepsPerRev: 200, holdingTorque: 0.4 }, source: 'datasheet' });
  s.blurb = '<script>alert(1)</script>Hello';
  const r = validateRobotPart(s);
  assert.ok(r.ok, r.errors?.join());
  assert.equal(r.part.blurb, 'scriptalert(1)/scriptHello');
  assert.equal(r.part.actuators.find(a => a.id === 'motor').params.gearRatio, 48);
  const many = servo(); many.joints = []; many.actuators = []; many.sensors = []; many.frames = Array.from({ length: 500 }, (_, i) => ({ id: `f${i}`, kind: 'point', pos: [0, 0, 0], dir: [0, 0, 1], source: 'measured' }));
  assert.equal(validateRobotPart(many).part.frames.length, 200, 'no more than 200 frames are kept');
  assert.equal(validateRobotPart(null).ok, false);
});
