import test from 'node:test';
import assert from 'node:assert/strict';
import { quickPlane } from '../src/core/quick-plane.js';
import { quickDrone } from '../src/core/quick-drone.js';
import { planeWiring } from '../src/core/plane-wiring.js';
import { TEMPLATES } from '../src/core/part-templates.js';
import { ROBOT_TYPES, robotType, circuitPartsFor, robotTypeNotes } from '../src/core/robot-types.js';
import { buildPrompt } from '../src/core/ai-prompt.js';

// apply the actions the way the bench does (parts and wires only: that is all this builder emits)
const apply = (circuit, actions) => {
  const parts = [...circuit.parts], wires = [...circuit.wires];
  for (const a of actions) {
    if (a.op === 'add_part') { assert.ok(a.type === 'servo' || TEMPLATES.some(t => `custom-${t.id}` === a.type), a.type); parts.push({ id: a.id, type: a.type, x: a.x, y: a.y }); }
    if (a.op === 'add_wire') { assert.ok(parts.some(p => p.id === a.from.part) && parts.some(p => p.id === a.to.part)); wires.push({ from: a.from, to: a.to }); }
  }
  return { parts, wires };
};
const check = c => planeWiring({ parts: c.parts, wires: c.wires.map(w => ({ a: w.from, b: w.to })) });
const built = () => apply({ parts: [], wires: [] }, quickPlane('build a flying wing with an edf').actions);
const without = (c, f) => ({ parts: c.parts, wires: c.wires.filter(w => !f(w)) });
const W = (a, pa, b, pb) => ({ from: { part: a, pin: pa }, to: { part: b, pin: pb } });

test('plane parts exist with the pins the check and the builder use', () => {
  const pins = id => TEMPLATES.find(t => t.id === id).pins.map(p => p.id);
  assert.deepEqual(pins('plane-esc'), ['BAT+', 'BAT-', 'A', 'B', 'C', 'SIG', '5V', 'G']);
  assert.deepEqual(pins('plane-fc'), ['5V', 'G', 'RX1', 'TX1', 'S1', 'S2', 'S3', 'S4', 'MOT']);
  assert.deepEqual(pins('plane-motor'), ['A', 'B', 'C']);
  for (const id of ['plane-esc', 'plane-fc']) assert.match(TEMPLATES.find(t => t.id === id).description, /./);
});

test('"build a flying wing with an EDF" makes a plane that the check passes, with both elevons', () => {
  const q = quickPlane('build a flying wing with an edf'); assert.ok(q);
  assert.match(q.explanation, /generic/); assert.match(q.explanation, /CoreWing/); assert.doesNotMatch(q.explanation, /\bpin ?out is\b/i, 'no invented pinout');
  const w = check(apply({ parts: [], wires: [] }, q.actions));
  assert.deepEqual(w.problems, []); assert.equal(w.fatal, null); assert.equal(w.ready, true); assert.deepEqual(Object.keys(w.servos).sort(), ['S1', 'S2']);
});

test('the builder leaves quads to the drone builder and other chat alone', () => {
  assert.equal(quickPlane('build a 5 inch quad'), null); assert.equal(quickPlane('add a red led'), null);
  assert.equal(quickPlane('why does my edf spin the wrong way'), null, 'diagnosing is for the model');
  assert.ok(quickDrone('make a 5 inch quad')); assert.equal(quickDrone('build a flying wing with an edf'), null);
  assert.ok(quickPlane('make a fixed wing drone circuit'), 'a fixed-wing "drone" is still a plane');
});

test('a second ask adds nothing; a half-wired bench is completed', () => {
  const done = built(); assert.deepEqual(quickPlane('build a plane circuit', done).actions, []);
  const half = { parts: done.parts, wires: done.wires.filter(w => w.from.part !== 'motor') };
  const fixed = apply(half, quickPlane('wire up the motor on my plane', half).actions); assert.deepEqual(check(fixed).problems, []);
});

test('nothing on the bench is not a plane', () => { assert.equal(planeWiring({ parts: [], wires: [] }).present, false); });

test('battery: missing, reversed and shorted are caught', () => {
  assert.match(check(without(built(), w => w.from.part === 'battery')).fatal, /not wired/);
  const rev = built(); rev.wires = rev.wires.map(w => (w.from.part === 'battery' ? { from: w.from, to: { part: 'esc', pin: w.to.pin === 'BAT+' ? 'BAT-' : 'BAT+' } } : w)); assert.match(check(rev).fatal, /wrong way round/);
  const short = built(); short.wires.push(W('esc', 'BAT+', 'esc', 'BAT-')); assert.match(check(short).fatal, /Short circuit/);
});

test('motor: two wires swapped spins it backwards, a missing or doubled wire is named', () => {
  const sw = built(); sw.wires = sw.wires.map(w => (w.from.part === 'motor' && w.from.pin === 'A' ? { from: w.from, to: { part: 'esc', pin: 'B' } } : w.from.part === 'motor' && w.from.pin === 'B' ? { from: w.from, to: { part: 'esc', pin: 'A' } } : w));
  const r = check(sw); assert.equal(r.motorReversed, true); assert.ok(r.problems.some(p => /wrong way.*EDF/.test(p)));
  const rot = built(); rot.wires = rot.wires.map(w => (w.from.part === 'motor' ? { from: w.from, to: { part: 'esc', pin: { A: 'B', B: 'C', C: 'A' }[w.from.pin] } } : w)); assert.equal(check(rot).motorReversed, false, 'a rotation of the three wires is not a reversal');
  assert.ok(check(without(built(), w => w.from.part === 'motor' && w.from.pin === 'B')).problems.some(p => /not soldered/.test(p)));
  assert.ok(check(without(built(), w => w.from.part === 'motor')).problems.some(p => /not wired to the ESC/.test(p)));
  const two = built(); two.wires = two.wires.filter(w => !(w.from.part === 'motor' && w.from.pin === 'C')); two.wires.push(W('motor', 'C', 'esc', 'B')); assert.ok(check(two).problems.some(p => /same ESC pad/.test(p)));
  const onBat = built(); onBat.wires.push(W('motor', 'A', 'esc', 'BAT+')); assert.ok(check(onBat).fatal);
});

test('flight controller: power, throttle signal and the 5 V burn-out are caught', () => {
  assert.match(check(without(built(), w => w.from.part === 'esc' && w.from.pin === '5V' && w.to.part === 'fc')).fatal, /no power/);
  assert.ok(check(without(built(), w => w.from.pin === 'SIG')).problems.some(p => /throttle signal/.test(p)));
  const burn = built(); burn.wires = burn.wires.filter(w => !(w.from.part === 'esc' && w.from.pin === '5V' && w.to.part === 'fc')); burn.wires.push(W('fc', '5V', 'esc', 'BAT+')); assert.match(check(burn).fatal, /burn out/);
  assert.match(check({ parts: built().parts.filter(p => p.id !== 'esc'), wires: [] }).fatal, /no ESC/);
  assert.ok(check({ parts: built().parts.filter(p => p.id !== 'fc'), wires: built().wires.filter(w => w.from.part !== 'fc' && w.to.part !== 'fc') }).problems.some(p => /no flight controller/.test(p)));
});

test('servos: signal, power from the 5 V rail, ground; the battery is never their supply', () => {
  assert.ok(check(without(built(), w => w.from.part === 'elevon1' && w.from.pin === 'PWM')).problems.some(p => /no signal wire/.test(p)));
  assert.ok(check(without(built(), w => w.from.part === 'elevon2' && w.from.pin === 'V+')).problems.some(p => /no power/.test(p)));
  assert.ok(check(without(built(), w => w.from.part === 'elevon2' && w.from.pin === 'GND')).problems.some(p => /no ground/.test(p)));
  const same = built(); same.wires = same.wires.map(w => (w.from.part === 'elevon2' && w.from.pin === 'PWM' ? { from: w.from, to: { part: 'fc', pin: 'S1' } } : w)); assert.ok(check(same).problems.some(p => /same output \(S1\)/.test(p)));
  const burn = built(); burn.wires = burn.wires.map(w => (w.from.part === 'elevon1' && w.from.pin === 'V+' ? { from: w.from, to: { part: 'esc', pin: 'BAT+' } } : w)); assert.match(check(burn).fatal, /Servo 1.*battery/);
});

test('receiver: power, the crossed serial link, and never the battery', () => {
  assert.ok(check(without(built(), w => w.from.part === 'receiver' && w.from.pin === 'TX')).problems.some(p => /cross over/.test(p)));
  assert.ok(check(without(built(), w => w.from.part === 'receiver' && w.from.pin === '5V')).problems.some(p => /no power/.test(p)));
  const burn = built(); burn.wires = burn.wires.map(w => (w.from.part === 'receiver' && w.from.pin === '5V' ? { from: w.from, to: { part: 'esc', pin: 'BAT+' } } : w)); assert.match(check(burn).fatal, /receiver/);
});

test('the Plane robot type: listed, its parts exist, and the AI is told about it and the check', () => {
  assert.ok(ROBOT_TYPES.some(t => t.id === 'plane')); assert.equal(robotType('plane').test, 'auto');
  const exists = id => TEMPLATES.some(t => `custom-${t.id}` === id) || ['servo', 'mpu6050', 'battery', 'pushbutton', 'led'].includes(id);
  assert.ok(circuitPartsFor('plane', exists).includes('custom-plane-fc') && circuitPartsFor('plane', exists).includes('custom-plane-esc') && circuitPartsFor('plane', exists).includes('servo'));
  assert.match(robotTypeNotes('plane'), /EDF/); assert.match(robotTypeNotes('plane'), /do not invent its pinout/);
  const bad = check(without(built(), w => w.from.pin === "SIG"));
  const prompt = buildPrompt({ instruction: 'why does it not spin', circuit: { parts: [], wires: [] }, code: '', context: { plane: bad }, workspace: 'robotics', robotType: 'plane' });
  assert.match(JSON.stringify(prompt), /Plane wiring check: problems found/); assert.match(JSON.stringify(prompt), /FIXED-WING PLANE/);
});
