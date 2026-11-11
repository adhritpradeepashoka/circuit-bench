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

/* ── a part bolted to a servo's shaft or horn turns with the servo ── */
import { makeKitPart } from '../src/core/robot-kit.js';
function armOn(servoId, hornFrames = ['horn-1']) {
  const as = new Assembly(), pl = makeKitPart('plate-100x80'), sv = makeKitPart(servoId), lk = makeKitPart('link-80');
  const P = as.add(pl, [0, 0, 0]), S = as.add(sv, [0, 0, 40]), L = as.add(lk, [0, 0, 80]);
  const top = pl.frames.filter(f => /-top$/.test(f.id)), e1 = sv.frames.find(f => f.id === 'ear-1-bottom'), e2 = sv.frames.find(f => f.id === 'ear-2-bottom'), ear = Math.abs(e1.pos[1] - e2.pos[1]);
  const pair = top.flatMap(a => top.map(b => [a, b])).find(([a, b]) => Math.abs(Math.abs(a.pos[1] - b.pos[1]) - ear) < 0.3 && Math.abs(a.pos[0] - b.pos[0]) < 0.3);
  assert.ok(pair && as.mate(P.id, pair[0].id, S.id, 'ear-1-bottom').ok && as.mate(P.id, pair[1].id, S.id, 'ear-2-bottom').ok, 'the servo case is screwed to the plate by its ears');
  for (const [k, h] of hornFrames.entries()) assert.ok(as.mate(S.id, h, L.id, k ? 'hole-1-top' : 'hole-1-top').ok, `link screwed to ${h}`);
  return { as, P, S, L };
}
test('a link screwed to the servo horn is a hinge about the shaft, driven at that servo\'s real torque and speed', async () => {
  for (const [id, torque] of [['servo-sg90', 0.176], ['servo-ds3218', 1.96]]) {
    const { as, P, S } = armOn(id), model = robotFromAssembly(as, { anchorId: P.id });
    assert.equal(model.ok, true); assert.equal(model.joints.length, 1); const j = model.joints[0];
    assert.equal(j.mode, 'servo'); assert.deepEqual(j.axis.map(v => Math.round(v)), [0, 0, 1], 'it turns about the shaft');
    const sh = as.get(S.id).part.frames.find(f => f.id === 'shaft'), w = [as.get(S.id).T.t[0] + sh.pos[0], as.get(S.id).T.t[1] + sh.pos[1]];
    assert.ok(Math.hypot(j.anchor[0] * 1000 - w[0], j.anchor[1] * 1000 - w[1]) < 1.5, 'the hinge sits on the shaft, not on the screw hole');
    assert.equal(j.servo.torque, torque); assert.match(toMJCF(model), new RegExp(`forcerange="-${torque} ${torque}"`));
  }
});
test('the servo moves what is bolted to it: 60° on the command turns the link 60°', async () => {
  const { as, P } = armOn('servo-sg90'), model = robotFromAssembly(as, { anchorId: P.id }), mj = await loadMujoco(), sim = new RobotSim(mj, model);
  try { sim.step(250); sim.command(0, 60); sim.step(1200); assert.ok(Math.abs(Math.abs(sim.angle(0)) - 60) < 4, `turned ${sim.angle(0)}°`); } finally { sim.dispose(); }
});

import { parseKitId as pk, servoId, findKnownServo, SERVO_CLASSES } from '../src/core/robot-kit.js';
import { validateRobotPart } from '../src/core/robot-part.js';
test('parametric servo: a size class plus a few numbers makes any servo, with every hole on the part and the label numbers converted', () => {
  for (const cls of Object.keys(SERVO_CLASSES)) for (const o of [{}, { L: 50, W: 24, H: 46, torque: 20, speed: 0.15, volts: 7.4 }, { L: 25, W: 13, H: 25 }]) {
    const id = servoId(cls, o), p = makeKitPart(id); assert.ok(p, id); assert.ok(validateRobotPart(p).ok, `${id} is a valid part`);
    const [w, l, h] = p.dims.size; for (const f of p.frames) assert.ok(Math.abs(f.pos[0]) <= w / 2 + 0.01 && Math.abs(f.pos[1]) <= l / 2 + 0.01 && f.pos[2] >= -0.01 && f.pos[2] <= h + 0.01, `${id}/${f.id} is on the part`);
  }
  const s = pk(servoId('standard', { torque: 10, speed: 0.2 })).servo; assert.ok(Math.abs(s.torque - 0.98) < 0.01, 'kg·cm → N·m'); assert.equal(s.speed, 300, 'seconds per 60° → degrees per second');
  assert.equal(pk('servo-x-bogus'), null); assert.equal(pk('servo-x-standard-Lx'), null);
  assert.equal(findKnownServo('TowerPro MG-995').cls, 'standard'); assert.equal(findKnownServo('my mystery servo'), null);
});
test('a parametric servo drives what is bolted to its horn at the strength written on its label', () => {
  const { as, P } = armOn(servoId('standard', { torque: 10, speed: 0.2 })), model = robotFromAssembly(as, { anchorId: P.id });
  assert.equal(model.joints.length, 1); assert.ok(Math.abs(model.joints[0].servo.torque - 0.98) < 0.01); assert.equal(model.joints[0].servo.speed, 300);
});

import { buildRig, isMate, setAngle } from '../src/core/assembly-pose.js';
test('the joint slider finds a horn-bolted hinge: setAngle swings the link about the servo shaft', () => {
  const { as, P, S, L } = armOn('servo-sg90'), mate = as.mates.find(m => /^horn/.test(m.a.frame) || /^horn/.test(m.b.frame));
  assert.ok(buildRig(as).joints.some(j => isMate(j.mate, mate)), 'the UI sees it as a hinge, so it shows the slider');
  const before = as.get(L.id).T.t.slice(); assert.ok(setAngle(as, P.id, mate, 40), 'setAngle works on it'); assert.equal(mate.angle, 40);
  const after = as.get(L.id).T.t; assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) > 1, 'the link actually swung');
});

test('hold in the air: the main body is fixed 25 cm up, the hinges still swing and nothing falls', async () => {
  const { as } = armOn('servo-sg90'), model = robotFromAssembly(as, { hold: true });
  assert.equal(model.ok, true); assert.equal(model.fixedBase, true); assert.ok(model.floorZ <= 0);
  const mj = await loadMujoco(), sim = new RobotSim(mj, model);
  try { sim.step(250); const h0 = sim.imu().height; sim.command(0, 50); sim.step(1200); assert.ok(Math.abs(sim.imu().height - h0) < 0.003, 'the body did not fall'); assert.ok(Math.abs(Math.abs(sim.angle(0)) - 50) < 5, `swung ${sim.angle(0)}°`); } finally { sim.dispose(); }
});

test('parts collide: a swinging arm is stopped by the body it hinges from, and the range sweep finds that angle', async () => {
  const as = new Assembly(), torso = as.add(mkPart('torso', 100, [80, 40, 20], [['hip', [40, 0, 10], [0, 0, 1]]]), [0, 0, 60]), arm = as.add(mkPart('arm', 15, [60, 10, 10], [['top', [-31, 0, 0], [0, 0, -1]]]), [100, 0, 0]);
  assert.ok(as.mate(torso.id, 'hip', arm.id, 'top').ok);
  const model = robotFromAssembly(as, { anchorId: torso.id }), mj = await loadMujoco(), sim = new RobotSim(mj, model);
  try {
    assert.match(sim.xml, /conaffinity="3"/); const sw = sim.sweep(0, 2); assert.ok(sw.max < 40 && sw.min > -40 && sw.hitUp, `sweep finds the clash (${JSON.stringify(sw)})`);
    assert.equal(sim.atStop(0), 0);
    sim.command(0, 90); sim.step(1500); assert.ok(sim.angle(0) < sw.max + 6, `the servo is blocked by the body, not driven through it (${sim.angle(0)}° vs clash at ${sw.max}°)`);
    const off = new RobotSim(mj, model, { selfCollide: false }); try { off.command(0, 90); off.step(1500); assert.ok(off.angle(0) > 80, 'with collisions off it goes straight through'); assert.equal(off.atStop(0), 1); } finally { off.dispose(); }
  } finally { sim.dispose(); }
});

test('the AI sees the scene in 3D: sizes, free holes, overlaps; place_next_to and measure use real boxes', async () => {
  const { describeAssembly, runAssemblyOps } = await import('../src/core/assembly-actions.js');
  const as = new Assembly(), a = as.add(mkPart('plate', 100, [80, 40, 10], [['h1', [0, 0, 5], [0, 0, 1]]]), [0, 0, 0]), b = as.add(mkPart('blk', 20, [20, 20, 20], [['t', [0, 0, 10], [0, 0, 1]]]), [300, 0, 0]);
  const half = i => i.part.dims.size.map(v => v / 2), boxes = () => Object.fromEntries(as.instances.map(i => { const h = half(i); return [i.id, { min: i.T.t.map((v, k) => v - h[k]), max: i.T.t.map((v, k) => v + h[k]) }]; }));
  const d = describeAssembly(as, [], null, boxes()); assert.match(d.instances, /In space/); assert.match(d.instances, /box 80 × 40 × 10 mm/); assert.match(d.instances, /free holes \(world\): h1/);
  const ctx = { boxOf: id => boxes()[id], anchorId: null };
  let r = await runAssemblyOps(as, [{ op: 'place_next_to', id: b.id, to: a.id, side: '+x', gap: 5 }], ctx); assert.equal(r.done, 1, JSON.stringify(r));
  assert.ok(Math.abs(boxes()[b.id].min[0] - (boxes()[a.id].max[0] + 5)) < 1e-6, 'five millimetres clear on +x'); assert.ok(Math.abs(b.T.t[1]) < 1e-6, 'centred on the other axes');
  r = await runAssemblyOps(as, [{ op: 'place_next_to', id: b.id, to: a.id, side: '+z', align: 'minx' }], ctx); assert.ok(Math.abs(boxes()[b.id].min[2] - boxes()[a.id].max[2]) < 1e-6 && Math.abs(boxes()[b.id].min[0] - boxes()[a.id].min[0]) < 1e-6);
  b.T.t[2] = 0; b.T.t[0] = 20; assert.match(describeAssembly(as, [], null, boxes()).instances, /OVERLAP/);
  r = await runAssemblyOps(as, [{ op: 'measure', a: a.id, b: b.id }], ctx); assert.equal(r.done, 0); assert.match(r.notes[0], /overlap/);
});
