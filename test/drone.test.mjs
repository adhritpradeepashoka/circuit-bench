import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMotor, makeProp, makeBattery, analyseQuad, operatingPoint, MOTOR_SIZES, STACKS, BOARDS } from '../src/core/drone.js';

const fiveInch = (over = {}) => analyseQuad({ motor: makeMotor({ size: '2207', kv: 1900, over: over.motor }), prop: makeProp({ diameterIn: 5, pitchIn: 4.3, blades: 3 }), battery: makeBattery({ cells: over.cells || 4, mAh: over.mAh || 1500, c: 75 }), extraGrams: 120 });

test('a typical 5 inch quad lands in a believable range (estimates, not measurements)', () => {
  const q = fiveInch(); assert.ok(q.massGrams > 380 && q.massGrams < 560, String(q.massGrams)); assert.ok(q.twr > 4 && q.twr < 12, String(q.twr));
  assert.ok(q.maxThrustGramsEach > 700 && q.maxThrustGramsEach < 1400); assert.ok(q.hoverThrottle > 0.2 && q.hoverThrottle < 0.5); assert.ok(q.flightMinutes > 3 && q.flightMinutes < 20);
});
test('a tiny whoop on 1S can lift itself but is light on thrust', () => {
  const q = analyseQuad({ motor: makeMotor({ size: '0802', kv: 22000 }), prop: makeProp({ diameterIn: 1.6, pitchIn: 1.2, blades: 3 }), battery: makeBattery({ cells: 1, mAh: 300, c: 60 }), extraGrams: 8 });
  assert.ok(q.twr > 1.5 && q.twr < 5, String(q.twr)); assert.ok(q.massGrams < 40);
});
test('physics moves the right way: more Kv spins faster, a heavier pack lowers thrust-to-weight, voltage sags under load', () => {
  const p = makeProp({ diameterIn: 5, pitchIn: 4.3 }), b = makeBattery({ cells: 4, mAh: 1500 });
  assert.ok(operatingPoint(makeMotor({ size: '2207', kv: 2400 }), p, b, 0.7).rpm > operatingPoint(makeMotor({ size: '2207', kv: 1700 }), p, b, 0.7).rpm);
  assert.ok(fiveInch({ mAh: 3000 }).twr < fiveInch({ mAh: 1000 }).twr);
  const full = operatingPoint(makeMotor({ size: '2207' }), p, b, 1), idle = operatingPoint(makeMotor({ size: '2207' }), p, b, 0.05); assert.ok(full.packVolts < idle.packVolts);
  assert.ok(operatingPoint(makeMotor({ size: '2207' }), p, b, 0.8).thrustGrams < full.thrustGrams);
});
test('energy balance: electrical power in is at least the shaft power out', () => {
  const o = operatingPoint(makeMotor({ size: '2207' }), makeProp({ diameterIn: 5, pitchIn: 4.3 }), makeBattery({ cells: 4, mAh: 1500 }), 0.8); assert.ok(o.electricalW > o.shaftW && o.shaftW > 0);
});
test('Advanced overrides win and are labelled', () => {
  const m = makeMotor({ size: '2207', kv: 1900, over: { resistance: 0.03, massGrams: 29 } }); assert.equal(m.resistance, 0.03); assert.equal(m.massGrams, 29); assert.match(m.source, /entered/);
  assert.match(makeMotor({ size: '2207' }).source, /estimated/); assert.throws(() => makeMotor({ size: '9999' }));
});
test('mismatches are called out in words', () => {
  const bad = analyseQuad({ motor: makeMotor({ size: '2207', kv: 2400 }), prop: makeProp({ diameterIn: 5, pitchIn: 4.3 }), battery: makeBattery({ cells: 1, mAh: 300, c: 30 }), extraGrams: 120 });
  assert.ok(bad.notes.length >= 1); assert.ok(bad.twr < 1 ? bad.notes.some(n => /lift/.test(n)) : true);
});
test('every motor size and board has a mount pattern the Assembly can turn into holes', () => {
  for (const [id, s] of Object.entries(MOTOR_SIZES)) assert.ok(s.mount.pattern[0] > 0 && s.mount.screw, id);
  for (const [id, b] of Object.entries(BOARDS)) assert.ok(STACKS[b.stack], id);
});

import { parseDroneId, makeDronePart, DRONE_PRESETS, motorId } from '../src/core/drone-parts.js';
import { validateRobotPart } from '../src/core/robot-part.js';
import { Assembly } from '../src/core/assembly-scene.js';
import { MOTOR_NAMES } from '../src/core/drone.js';

test('there are plenty of motor sizes, each with sane numbers', () => {
  assert.ok(MOTOR_NAMES.length >= 40); for (const n of MOTOR_NAMES) { const s = MOTOR_SIZES[n]; assert.ok(s.kvRef > 500 && s.rRef > 0.001 && s.mass > 0.5 && s.mount.pattern[0] > 0, n); const m = makeMotor({ size: n }); assert.ok(Number.isFinite(m.resistance) && m.resistance > 0, n); }
});
test('every drone part id makes a valid robot part, and ids round-trip', () => {
  for (const [, id] of DRONE_PRESETS) { const p = makeDronePart(id); assert.ok(p, id); const v = validateRobotPart(p); assert.ok(v.ok, `${id}: ${v.errors}`); }
  const id = motorId({ size: '2207', kv: 1900, over: { resistance: 0.03, massGrams: 29 } }); assert.equal(id, 'motor-2207-1900-r30-m29'); const d = parseDroneId(id); assert.equal(d.over.resistance, 0.03); assert.equal(d.over.massGrams, 29);
  assert.equal(parseDroneId('motor-9999-1'), null); assert.equal(makeDronePart('nonsense'), null);
});
test('a motor screws onto a frame with one join: its other three holes line up and are joined too; the prop sits on the bell around the shaft', () => {
  const as = new Assembly(), part = id => { const p = makeDronePart(id); return validateRobotPart(p).part; };
  const f = as.add(part('frame-quad-220-16-30.5')), m = as.add(part('motor-2207-1900'), [200, 0, 0]), p = as.add(part('prop-5x4.3x3-b5'), [0, 200, 0]);
  const r = as.mateAll(f.id, 'fr-1-top', m.id, 'mount-1'); assert.ok(r.ok, r.error); assert.equal(r.extra, 3); assert.equal(as.mates.length, 4);
  assert.ok(as.mates.every(x => as.check(x).level !== 'bad'));
  const r2 = as.mateAll(m.id, 'shaft', p.id, 'bore-bottom'); assert.ok(r2.ok); assert.ok(as.check(r2.mate).level !== 'bad', as.check(r2.mate).notes.join(' '));
});
