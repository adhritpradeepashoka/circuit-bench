import test from 'node:test';
import assert from 'node:assert/strict';
import { droneWiring } from '../src/core/drone-wiring.js';

const P = (id, type) => ({ id, type: `custom-${type}` });
const W = (a, ap, b, bp) => ({ a: { part: a, pin: ap }, b: { part: b, pin: bp } });
// a correctly built stack: battery → ESC, capacitor across the pads, FC powered from the ESC, signal wires, four motors, camera
function stack({ cap = true, reverseCap = false, signals = [1, 2, 3, 4], power = true, skipMotor = 0, extra = [], extraParts = [] } = {}) {
  const parts = [P('bat', 'drone-battery'), P('esc', 'drone-esc'), P('fc', 'drone-fc'), ...(cap ? [P('cap', 'drone-cap')] : []), P('cam', 'drone-camera'), ...[1, 2, 3, 4].map(k => P(`m${k}`, 'drone-motor')), ...extraParts];
  const wires = [W('bat', '+', 'esc', 'BAT+'), W('bat', '-', 'esc', 'BAT-'),
    ...(cap ? [W('cap', reverseCap ? '-' : '+', 'esc', 'BAT+'), W('cap', reverseCap ? '+' : '-', 'esc', 'BAT-')] : []),
    ...(power ? [W('fc', '5V', 'esc', '5V'), W('fc', 'G', 'esc', 'G')] : []),
    ...signals.map(k => W('esc', `S${k}`, 'fc', `M${k}`)),
    W('cam', '5V', 'fc', '5V'), W('cam', 'GND', 'fc', 'G'), W('cam', 'VID', 'fc', 'CAM'),
    ...[1, 2, 3, 4].filter(k => k !== skipMotor).flatMap(k => ['A', 'B', 'C'].map(l => W(`m${k}`, l, 'esc', `M${k}${l}`))), ...extra];
  return { parts, wires };
}

test('a correct stack (ESC + FC + capacitor) is present, has no problems, and every motor lands on its own slot', () => {
  const w = droneWiring(stack());
  assert.equal(w.present, true); assert.equal(w.fatal, null); assert.deepEqual(w.problems, []); assert.equal(w.camera, true);
  assert.equal(Object.keys(w.slotOf).length, 4); assert.deepEqual(Object.keys(w.reversed), []);
});
test('the FC pad that feeds an ESC output decides the slot: crossed signals still fly, two outputs on one FC pad is a problem', () => {
  const crossed = stack(); crossed.wires = crossed.wires.filter(x => !(x.a.pin === 'S1' || x.a.pin === 'S2')).concat([W('esc', 'S1', 'fc', 'M2'), W('esc', 'S2', 'fc', 'M1')]);
  const w = droneWiring(crossed); assert.deepEqual(w.problems, []); assert.equal(Object.keys(w.slotOf).length, 4);
  const twice = stack(); twice.wires = twice.wires.filter(x => x.a.pin !== 'S2').concat([W('esc', 'S2', 'fc', 'M1')]);
  assert.ok(droneWiring(twice).problems.some(p => /same flight controller output/.test(p)));
});
test('missing signal wire: that motor does not spin and the problem names the pad', () => {
  const w = droneWiring(stack({ signals: [1, 2, 4] }));
  assert.ok(w.problems.some(p => /S3/.test(p) && /signal/.test(p))); assert.equal(Object.keys(w.slotOf).length, 3);
});
test('big drones: no capacitor is a warning, a backwards one is fatal, a loose one is explained', () => {
  assert.ok(droneWiring(stack({ cap: false })).problems.some(p => /capacitor/i.test(p))); assert.equal(droneWiring(stack({ cap: false })).fatal, null);
  assert.match(droneWiring(stack({ reverseCap: true })).fatal, /backwards/);
  const loose = stack(); loose.wires = loose.wires.filter(x => x.a.part !== 'cap');
  assert.ok(droneWiring(loose).problems.some(p => /not soldered across/.test(p)));
});
test('an FC with no power is fatal; an FC without an ESC (or the other way round) says what is missing', () => {
  assert.match(droneWiring(stack({ power: false })).fatal, /no power/);
  assert.match(droneWiring({ parts: [P('fc', 'drone-fc')], wires: [] }).fatal, /no 4-in-1 ESC/);
  const noFc = stack(); noFc.parts = noFc.parts.filter(p => p.id !== 'fc'); noFc.wires = noFc.wires.filter(x => x.a.part !== 'fc' && x.b.part !== 'fc');
  assert.match(droneWiring(noFc).fatal, /no flight controller/);
});
test('battery on the ESC: reversed or shorted is fatal, same as an AIO', () => {
  const rev = stack(); rev.wires = rev.wires.filter(x => x.a.part !== 'bat').concat([W('bat', '+', 'esc', 'BAT-'), W('bat', '-', 'esc', 'BAT+')]);
  assert.ok(droneWiring(rev).fatal);
  assert.match(droneWiring(stack({ extra: [W('esc', 'BAT+', 'esc', 'BAT-')] })).fatal, /Short/);
});
test('receiver and video transmitter: wired right is clean, wired wrong says exactly what to change; 5 V on the battery is fatal', () => {
  const rx = [P('rx', 'drone-rx')], vtx = [P('vtx', 'drone-vtx')];
  const good = [W('rx', '5V', 'fc', '5V'), W('rx', 'G', 'fc', 'G'), W('rx', 'TX', 'fc', 'RX1'), W('rx', 'RX', 'fc', 'TX1'), W('vtx', 'VIN', 'fc', '5V'), W('vtx', 'G', 'fc', 'G'), W('vtx', 'VID', 'fc', 'VTX')];
  assert.deepEqual(droneWiring(stack({ extraParts: [...rx, ...vtx], extra: good })).problems, []);
  const straight = good.map(x => (x.a.pin === 'TX' ? W('rx', 'TX', 'fc', 'TX1') : x.a.pin === 'RX' && x.a.part === 'rx' ? W('rx', 'RX', 'fc', 'RX1') : x));
  assert.ok(droneWiring(stack({ extraParts: rx, extra: straight.filter(x => x.a.part === 'rx') })).problems.some(p => /cross over/.test(p)));
  assert.ok(droneWiring(stack({ extraParts: vtx, extra: [W('vtx', 'VIN', 'fc', '5V'), W('vtx', 'G', 'fc', 'G')] })).problems.some(p => /VTX pad/.test(p)));
  assert.match(droneWiring(stack({ extraParts: rx, extra: [W('rx', '5V', 'esc', 'BAT+'), W('rx', 'G', 'fc', 'G')] })).fatal, /receiver/);
});
test('an AIO build is untouched by all this (no capacitor warning, same checks)', () => {
  const parts = [P('bat', 'drone-battery'), P('aio', 'drone-aio'), ...[1, 2, 3, 4].map(k => P(`m${k}`, 'drone-motor'))];
  const wires = [W('bat', '+', 'aio', 'BAT+'), W('bat', '-', 'aio', 'BAT-'), ...[1, 2, 3, 4].flatMap(k => ['A', 'B', 'C'].map(l => W(`m${k}`, l, 'aio', `M${k}${l}`)))];
  const w = droneWiring({ parts, wires }); assert.equal(w.fatal, null); assert.ok(!w.problems.some(p => /capacitor/i.test(p))); assert.equal(Object.keys(w.slotOf).length, 4);
});
