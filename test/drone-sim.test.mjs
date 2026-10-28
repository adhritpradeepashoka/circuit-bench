import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuad, part } from './helpers/quad.mjs';
import { droneFromAssembly, DroneSim, Esc, steadyOmega, cellVolts } from '../src/core/drone-sim.js';
import { SketchController, STARTER_SKETCH, mixerFor, quadMix, tuneFor } from '../src/core/drone-fc.js';
import { analyseQuad, makeMotor, makeProp, makeBattery } from '../src/core/drone.js';
import { Assembly } from '../src/core/assembly-scene.js';

const RC = (o = {}) => ({ armed: true, throttle: 0, roll: 0, pitch: 0, yaw: 0, mode: 'angle', ...o });
function fly(sim, fc, secs, rc) { for (let i = 0; i < secs * 1000; i++) sim.step(fc.tick(sim.sense(), typeof rc === 'function' ? rc(sim.t) : rc, sim.t)); return sim.state; }
const ready = (opts) => { const m = droneFromAssembly(buildQuad(opts)), sim = new DroneSim(m), fc = new SketchController(STARTER_SKETCH, m); fly(sim, fc, 1, RC({ armed: false })); return { m, sim, fc }; };

test('an assembled quad is read from its parts: weight, balance, motor layout, spin directions', () => {
  const m = droneFromAssembly(buildQuad()); assert.ok(m.ok, m.error); assert.equal(m.motors.length, 4);
  assert.ok(m.massKg > 0.38 && m.massKg < 0.55, String(m.massKg));
  assert.ok(Math.abs(m.com[0]) < 0.003 && Math.abs(m.com[1]) < 0.003, 'the middle of the weight sits in the middle');
  const spins = m.motors.map(x => x.spin); assert.equal(spins.reduce((a, b) => a + b, 0), 0);
  // neighbours turn opposite ways: motors across a diagonal turn the same way
  const [a, b, c, d] = m.motors; assert.equal(a.spin, c.spin); assert.equal(b.spin, d.spin); assert.notEqual(a.spin, b.spin);
  assert.ok(m.motors.every(x => x.axis[2] > 0.99), 'every motor pushes up');
  assert.deepEqual(m.leftOut, []);
});
test('what is missing is said in words', () => {
  assert.match(droneFromAssembly(new Assembly()).error, /motors/);
  assert.match(droneFromAssembly(buildQuad({ props: false })).error, /prop/);
  const noBat = buildQuad(); noBat.remove(noBat.instances.find(i => i.part.drone.kind === 'battery').id); assert.match(droneFromAssembly(noBat).error, /battery/i);
  const loose = buildQuad(); loose.add(part('camera-micro'), [500, 500, 0]); const m = droneFromAssembly(loose); assert.ok(m.ok); assert.equal(m.leftOut.length, 1); assert.match(m.notes.join(' '), /not joined/);
});
test('the ESC wants a low signal before it arms, ignores the dead band, and the motors then spin; until then the drone sits still', () => {
  const m = droneFromAssembly(buildQuad()), sim = new DroneSim(m);
  for (let i = 0; i < 400; i++) sim.step(Array(4).fill(1500)); assert.ok(sim.omega.every(w => w === 0), 'a high first signal is ignored');
  for (let i = 0; i < 600; i++) sim.step(Array(4).fill(1000)); assert.ok(sim.escs.every(e => e.armed));
  for (let i = 0; i < 300; i++) sim.step(Array(4).fill(1040)); assert.ok(sim.omega.every(w => w === 0), 'the bottom of the range is a dead band');
  for (let i = 0; i < 300; i++) sim.step(Array(4).fill(1500)); assert.ok(sim.omega.every(w => w > 500));
});
test('hover throttle in the simulator agrees with the quick estimate in the Drone check', () => {
  const as = buildQuad(), m = droneFromAssembly(as), sim = new DroneSim(m);
  for (let i = 0; i < 1000; i++) sim.step(Array(4).fill(1000));
  const m0 = m.motors[0], extra = m.massKg * 1000 - 4 * (m0.motor.massGrams + m0.prop.massGrams) - m.battery.massGrams, q = analyseQuad({ motor: m0.motor, prop: m0.prop, battery: m.battery, extraGrams: extra });
  let lo = 0, hi = 1; for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2; sim.reset(); for (let i = 0; i < 700; i++) sim.step(Array(4).fill(1000)); for (let i = 0; i < 400; i++) sim.step(Array(4).fill(1050 + 950 * mid)); (sim.v[2] > 0.02 ? (hi = mid) : (lo = mid)); }
  assert.ok(Math.abs(hi - q.hoverThrottle) < 0.06, `sim ${hi.toFixed(3)} vs estimate ${q.hoverThrottle}`);
});
test('the built-in controller (the starter sketch) takes off, holds its height and sits level', () => {
  const { sim, fc } = ready(); assert.equal(fc.error, null);
  fly(sim, fc, 0.5, RC()); let s = fly(sim, fc, 2.5, RC({ throttle: 0.75, mode: 'althold' })); assert.ok(s.altitude > 2 && s.climb > 0.8, `alt ${s.altitude} climb ${s.climb}`);
  s = fly(sim, fc, 4, RC({ throttle: 0.5, mode: 'althold' })); const alt = s.altitude; assert.ok(Math.abs(s.climb) < 0.3 && s.tilt < 2.5, `climb ${s.climb} tilt ${s.tilt}`);
  s = fly(sim, fc, 3, RC({ throttle: 0.5, mode: 'althold' })); assert.ok(Math.abs(s.altitude - alt) < 0.6, `drifted ${s.altitude - alt}`);
  assert.ok(!s.crashed);
});
test('stick right tilts it right, then it levels again; stick forward tips the nose down; yaw turns it', () => {
  const { sim, fc } = ready(); fly(sim, fc, 0.5, RC()); fly(sim, fc, 2, RC({ throttle: 0.75, mode: 'althold' }));
  let s = fly(sim, fc, 1.2, RC({ throttle: 0.5, roll: 0.5, mode: 'althold' })); assert.ok(s.roll > 12 && s.roll < 32, `roll ${s.roll}`);
  s = fly(sim, fc, 2, RC({ throttle: 0.5, mode: 'althold' })); assert.ok(Math.abs(s.roll) < 4, `roll ${s.roll}`);
  s = fly(sim, fc, 1.2, RC({ throttle: 0.5, pitch: 0.5, mode: 'althold' })); assert.ok(s.pitch < -12, `forward stick should pitch the nose down: ${s.pitch}`);
  fly(sim, fc, 2, RC({ throttle: 0.5, mode: 'althold' })); const q0 = sim.q.slice(); fly(sim, fc, 1.5, RC({ throttle: 0.5, yaw: 0.6, mode: 'althold' }));
  assert.ok(sim.w[2] < -0.3, `right yaw is a clockwise turn (negative about up): ${sim.w[2]}`);
});
test('the pack drains and sags, and a flat pack cuts the motors', () => {
  const { sim, fc } = ready(); fly(sim, fc, 0.5, RC()); const v0 = sim.state.volts; fly(sim, fc, 3, RC({ throttle: 0.75, mode: 'althold' }));
  const s = sim.state; assert.ok(s.usedMah > 0 && s.left < 1); assert.ok(cellVolts(1) > cellVolts(0.5) && cellVolts(0.5) > cellVolts(0.05));
  sim.drawnAh = sim.model.battery.mAh / 1000 * 0.95; sim.step(Array(4).fill(1500)); assert.ok(sim.state.cell < 3.4);
  const e = new Esc({ maxAmps: 30 }); for (let i = 0; i < 700; i++) e.update(1000, 0.001); assert.ok(e.armed); for (let i = 0; i < 300; i++) e.update(1900, 0.001, { motorAmps: 60, cellVolts: 3.1 }); assert.ok(e.output < 0.6, `cut to ${e.output}`);
});
test('a hover current from the simulator is close to the quick estimate', () => {
  const { m, sim, fc } = ready(); fly(sim, fc, 0.5, RC()); fly(sim, fc, 2.5, RC({ throttle: 0.75, mode: 'althold' })); const s = fly(sim, fc, 4, RC({ throttle: 0.5, mode: 'althold' }));
  const m0 = m.motors[0], extra = m.massKg * 1000 - 4 * (m0.motor.massGrams + m0.prop.massGrams) - m.battery.massGrams, q = analyseQuad({ motor: m0.motor, prop: m0.prop, battery: m.battery, extraGrams: extra });
  assert.ok(Math.abs(s.amps - q.hoverAmps) / q.hoverAmps < 0.35, `sim ${s.amps.toFixed(2)} A vs ${q.hoverAmps} A`);
});
test('a fall from height with the motors off is a crash; resting on the floor is not', () => {
  const m = droneFromAssembly(buildQuad()), sim = new DroneSim(m); for (let i = 0; i < 800; i++) sim.step(Array(4).fill(1000)); assert.ok(!sim.crashed && sim.landed);
  sim.p[2] += 4; for (let i = 0; i < 1500; i++) sim.step(Array(4).fill(1000)); assert.ok(sim.crashed); assert.ok(Math.abs(sim.altitude) < 0.02, 'and it ends up on the floor, not through it');
});
test('the mixer works for any motor layout: roll and pitch do not change the total, yaw balances', () => {
  const m = droneFromAssembly(buildQuad()), mix = mixerFor(m);
  for (const k of ['roll', 'pitch', 'yaw']) assert.ok(Math.abs(mix.reduce((s, c) => s + c[k], 0)) < 1e-9, k);
  const out = quadMix(m, 0.5, 0.2, 0, 0); assert.ok(Math.abs(out.reduce((a, b) => a + b, 0) - 2) < 1e-9); assert.ok(Math.max(...out) > 0.5 && Math.min(...out) < 0.5);
  const sat = quadMix(m, 0.95, 0.5, 0.5, 0.5); assert.ok(sat.every(v => v >= 0 && v <= 1));
  const hex = { motors: [0, 1, 2, 3, 4, 5].map(k => ({ r: [Math.cos(k * Math.PI / 3), Math.sin(k * Math.PI / 3), 0], spin: k % 2 ? -1 : 1 })) };
  const hm = mixerFor(hex); for (const k of ['roll', 'pitch', 'yaw']) assert.ok(Math.abs(hm.reduce((s, c) => s + c[k], 0)) < 1e-9, `hex ${k}`);
});
test('the same controller flies a tiny whoop and a 7 inch long-range quad: it works the gains out for each', () => {
  const builds = { '7 inch': { frame: 'frame-quad-300-16-30.5', motor: 'motor-2806-1300', prop: 'prop-7x4x3-b5', battery: 'battery-6s-1300-100' },
    whoop: { frame: 'frame-quad-65-t6.6-16', motor: 'motor-0802-22000', prop: 'prop-1.6x1.2x3-b1', battery: 'battery-1s-450-60', boards: false } };
  for (const [name, o] of Object.entries(builds)) {
    const m = droneFromAssembly(buildQuad(o)); assert.ok(m.ok, `${name}: ${m.error}`);
    const sim = new DroneSim(m), fc = new SketchController(STARTER_SKETCH, m); fly(sim, fc, 1, RC({ armed: false })); fly(sim, fc, 0.4, RC());
    fly(sim, fc, 3, RC({ throttle: 0.7, mode: 'althold' })); const s = fly(sim, fc, 4, RC({ throttle: 0.5, mode: 'althold' }));
    assert.ok(s.altitude > 0.3 && !s.crashed && s.tilt < 6 && Math.abs(s.climb) < 0.6, `${name}: alt ${s.altitude.toFixed(2)} tilt ${s.tilt.toFixed(1)} climb ${s.climb.toFixed(2)}`);
  }
});
test('a sketch that fails says why, and cannot reach the page', () => {
  const m = droneFromAssembly(buildQuad());
  assert.match(new SketchController('function loop( {', m).error, /SyntaxError/);
  assert.match(new SketchController('function setup(){}', m).error, /loop/);
  const f = new SketchController('function loop(){ undefinedThing.x = 1; }', m); f.tick({ gyro: [0, 0, 0], accel: [0, 0, 1], altitude: 0, volts: 16, amps: 0 }, RC(), 0); assert.match(f.error, /ReferenceError/);
  const probe = new SketchController(`function loop(){ Serial.println(typeof window, typeof document, typeof fetch, typeof localStorage); }`, m); probe.tick({ gyro: [0, 0, 0], accel: [0, 0, 1], altitude: 0, volts: 16, amps: 0 }, RC(), 0); assert.equal(probe.log[0], 'undefined undefined undefined undefined');
});
test('your own sketch flies the drone: a simple one that just sets the motors', () => {
  const m = droneFromAssembly(buildQuad()), sim = new DroneSim(m), fc = new SketchController(`function loop(){ const r = rc(); for (let i = 0; i < motorCount; i++) writeMotor(i, r.armed ? 0.5 : 0); }`, m);
  fly(sim, fc, 1, RC({ armed: false })); const s = fly(sim, fc, 1.5, RC()); assert.ok(s.altitude > 0.5, 'half throttle is well over hover for this quad');
});
test('the numbers inside are exact where they can be: the motor settles where torque meets drag', () => {
  const motor = makeMotor({ size: '2207', kv: 1900 }), prop = makeProp({ diameterIn: 5, pitchIn: 4.3, blades: 3 }), w = steadyOmega(motor, prop, 16);
  const kt = 1 / (motor.kv * Math.PI / 30), I = (16 - kt * w) / motor.resistance, drive = kt * (I - motor.noLoadAmps), D = 5 * 0.0254, n = w / (2 * Math.PI), load = (prop.cp / (2 * Math.PI)) * 1.225 * n * n * D ** 5;
  assert.ok(Math.abs(drive - load) / load < 1e-6);
});

test('a motor screwed on by one hole swings round that screw, and the second hole then joins by swinging it into line (rigid after that)', async () => {
  const { Assembly, worldFrame, turn } = await import('../src/core/assembly-scene.js'), { part } = await import('./helpers/quad.mjs');
  for (const [frame, motor] of [['frame-quad-220-16-30.5', 'motor-2207-1900'], ['frame-quad-75-t6.6-16', 'motor-0802-22000']]) {
    const as = new Assembly(), f = as.add(part(frame)), mo = as.add(part(motor));
    const r1 = as.mate(f.id, 'fr-1-top', mo.id, 'mount-1'); assert.ok(r1.ok, r1.error);
    const w = worldFrame(mo, mo.part.frames.find(x => x.id === 'mount-1')); turn(mo, w.dir, w.pos, 53);                      // the motor has swung out of line
    const r2 = as.mate(f.id, 'fr-2-top', mo.id, 'mount-2'); assert.ok(r2.ok, `${frame}: ${r2.error}`);
    const wa = worldFrame(f, f.part.frames.find(x => x.id === 'fr-2-top')), wb = worldFrame(mo, mo.part.frames.find(x => x.id === 'mount-2'));
    assert.ok(Math.hypot(wa.pos[0] - wb.pos[0], wa.pos[1] - wb.pos[1], wa.pos[2] - wb.pos[2]) < 0.1, `${frame}: the second holes meet`);
    assert.ok(as.autoMatch(f.id, mo.id) >= 1, `${frame}: the remaining holes join`);
    const far = as.mate(f.id, 'bl-1-top', mo.id, 'mount-3'); assert.ok(!far.ok && /swing|apart/.test(far.error), 'a hole on the far arm cannot be reached by swinging');
  }
});
