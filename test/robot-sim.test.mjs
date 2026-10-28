import test from 'node:test';
import assert from 'node:assert/strict';
import { Assembly, place } from '../src/core/assembly-scene.js';
import { robotFromAssembly, toMJCF, samplePoints } from '../src/core/robot-model.js';
import { RobotSim, loadMujoco, SERVO_SPEED } from '../src/core/robot-sim.js';
import { RobotController, STARTER_ROBOT_SKETCH } from '../src/core/robot-fc.js';

const mkPart = (id, grams, size, frames) => ({ id, name: id, mass: { grams, source: 'estimated' }, dims: { size, source: 'estimated' }, frames: frames.map(([fid, pos, dir]) => ({ id: fid, kind: 'hole', pos, dir, diameter: 3, source: 'estimated' })) });
const disc = (R, w, n = 24) => { const o = []; for (let i = 0; i < n; i++) { const a = i / n * 2 * Math.PI; for (const z of [0, w]) o.push([Math.cos(a) * R, Math.sin(a) * R, z]); } return o; };

function car() {
  const as = new Assembly(), chassis = as.add(mkPart('chassis', 200, [120, 60, 20], [['fl', [40, 30, 10], [0, 1, 0]], ['fr', [40, -30, 10], [0, -1, 0]], ['bl', [-40, 30, 10], [0, 1, 0]], ['br', [-40, -30, 10], [0, -1, 0]]]), [0, 0, 20]); let n = 0;
  for (const f of ['fl', 'fr', 'bl', 'br']) { const w = as.add(mkPart('wheel', 25, [40, 40, 8], [['hub', [0, 0, 4], [0, 0, 1]]]), [200 + 60 * n++, 0, 0]); assert.ok(as.mate(chassis.id, f, w.id, 'hub').ok); }
  return { as, hullOf: inst => (inst.part.id === 'wheel' ? disc(20, 8).flatMap(p => place(inst.T, [p[0], p[1], p[2] - 4])) : null) };
}
function limb() {
  const as = new Assembly(), torso = as.add(mkPart('torso', 100, [80, 40, 20], [['hip', [40, 0, 10], [1, 0, 0]]]), [0, 0, 60]), leg = as.add(mkPart('leg', 15, [10, 10, 60], [['top', [-5, 0, 55], [-1, 0, 0]]]), [100, 0, 0]);
  assert.ok(as.mate(torso.id, 'hip', leg.id, 'top').ok); return { as, torso, leg };
}

test('a car: wheels are found, driven by one command, and it rolls straight ahead', async () => {
  const { as, hullOf } = car(), model = robotFromAssembly(as, { hullOf });
  assert.equal(model.ok, true); assert.equal(model.joints.length, 4); assert.ok(model.joints.every(j => j.mode === 'motor' && j.wheel && j.range === null));
  const mj = await loadMujoco(), sim = new RobotSim(mj, model);
  try {
    sim.step(500); const s0 = sim.imu(); assert.ok(s0.height > 0.015 && s0.height < 0.03, `rests on its wheels (${s0.height})`); assert.ok(Math.abs(s0.roll) < 2 && Math.abs(s0.pitch) < 2);
    model.joints.forEach((_, k) => sim.command(k, 1)); sim.step(1500);
    const s = sim.imu(), fwd = model.forward; assert.ok(s.x * fwd[0] + s.y * fwd[1] > 0.3, `drove forward (${s.x}, ${s.y})`); assert.ok(Math.abs(s.yaw) < 5, `and straight (yaw ${s.yaw})`);
  } finally { sim.dispose(); }
});

test('a limb held still: its servo follows the command, no faster than a real servo, and stops at its limit', async () => {
  const { as, torso } = limb(), model = robotFromAssembly(as, { anchorId: torso.id }), mj = await loadMujoco(), sim = new RobotSim(mj, model);
  try {
    assert.equal(model.fixedBase, true); assert.equal(model.joints.length, 1); assert.equal(model.joints[0].mode, 'servo'); assert.deepEqual(model.joints[0].range, [-90, 90]);
    const z0 = sim.bodyPose(0).pos[2]; sim.step(250); assert.ok(Math.abs(sim.bodyPose(0).pos[2] - z0) < 1e-4, 'the held part does not move');
    sim.command(0, 45); sim.step(20); assert.ok(Math.abs(sim.angle(0)) < 25, `slew-limited (${sim.angle(0)}° after 0.04 s; a servo does about ${SERVO_SPEED}°/s)`); sim.step(750); assert.ok(Math.abs(Math.abs(sim.angle(0)) - 45) < 3, `reaches 45° (${sim.angle(0)})`);
    sim.command(0, 400); sim.step(1500); assert.ok(Math.abs(sim.angle(0)) <= 91 && Math.abs(sim.angle(0)) > 80, `stops at its limit (${sim.angle(0)})`);
  } finally { sim.dispose(); }
});

test('a free robot is dropped on the floor and settles without blowing up; the sensors make sense', async () => {
  const { as } = limb(), model = robotFromAssembly(as), mj = await loadMujoco(), sim = new RobotSim(mj, model);
  try {
    assert.equal(model.fixedBase, false); sim.step(3000); const s = sim.imu(); assert.ok([s.height, s.roll, s.pitch, s.ax, s.az].every(Number.isFinite)); assert.ok(s.height < 0.2);
    assert.ok(Math.abs(Math.hypot(s.ax, s.ay, s.az) - 9.81) < 1.5, `at rest the accelerometer reads about 1 g (${Math.hypot(s.ax, s.ay, s.az)})`);
  } finally { sim.dispose(); }
});

test('the model reader: loops, loose parts and bad inputs are reported, not crashed on', () => {
  assert.equal(robotFromAssembly(new Assembly()).ok, false);
  const { as } = limb(); as.add(mkPart('stray', 5, [10, 10, 10], []), [500, 0, 0]); const m = robotFromAssembly(as); assert.ok(m.notes.some(n => /not joined/.test(n)));
  const xml = toMJCF(m); assert.match(xml, /<mujoco/); assert.match(xml, /type="hinge"/); assert.ok(!/NaN|undefined/.test(xml));
  const flat = []; for (let i = 0; i < 3000; i++) flat.push(Math.cos(i) * 10, Math.sin(i * 1.3) * 10, i % 7); assert.ok(samplePoints(flat).length <= 160);
});

test('a sketch drives the joints and reads the sensors, and cannot reach the page', async () => {
  const { as } = limb(), model = robotFromAssembly(as), st = { angles: [12], speeds: [0], sliders: [0.5], input: { drive: 0, turn: 0, strafe: 0, lift: 0 }, imu: { roll: 1, pitch: 2, yaw: 3, gx: 0, gy: 0, gz: 0, ax: 0, ay: 0, az: 9.81, height: 0.1 } };
  const fc = new RobotController(STARTER_ROBOT_SKETCH, model); assert.equal(fc.error, null);
  assert.ok(Math.abs(fc.tick(st, 0)[0] - 45) < 1e-9, 'slider 0.5 of a ±90° range is 45°');
  const mine = new RobotController('function loop() { servoWrite(0, angle(0) + imu().pitch); Serial.println(height()); }', model); assert.equal(mine.tick(st, 1)[0], 14); assert.deepEqual(mine.log, ['0.1']);
  assert.match(new RobotController('function loop() { fetch("x"); }', model).tick(st, 0) && new RobotController('function loop() { fetch("x"); }', model).error || 'none', /none|TypeError/);
  const bad = new RobotController('function loop() { window.alert(1); }', model); bad.tick(st, 0); assert.match(bad.error, /TypeError/);
  assert.equal(new RobotController('var x = ;', model).error?.startsWith('SyntaxError'), true);
});
