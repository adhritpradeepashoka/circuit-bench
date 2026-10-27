import test from 'node:test';
import assert from 'node:assert/strict';
import { droneWiring, SLOT_POSITIONS } from '../src/core/drone-wiring.js';
import { makeDronePart } from '../src/core/drone-parts.js';
import { TEMPLATES } from '../src/core/part-templates.js';

const P = (id, type) => ({ id, type: `custom-${type}` }), W = (a, ap, b, bp) => ({ a: { part: a, pin: ap }, b: { part: b, pin: bp } });
const bench = (map = { fr: 'M1', fl: 'M2', bl: 'M3', br: 'M4' }, extra = {}) => ({
  parts: [P('aio', 'drone-aio'), P('bat', 'drone-battery'), P('cam', 'drone-camera'), ...['fr', 'fl', 'bl', 'br'].map(k => P(k, `drone-motor-${k}`))],
  wires: [W('bat', '+', 'aio', 'BAT+'), W('bat', '-', 'aio', 'BAT-'), W('cam', 'VID', 'aio', 'CAM'), ...Object.entries(map).map(([k, m]) => W(k, 'PHASES', 'aio', m))], ...extra,
});

test('drone templates are valid circuit parts', () => { assert.ok(TEMPLATES.filter(t => t.id.startsWith('drone-')).length === 7); });
test('no AIO on the bench: nothing is steered', () => { assert.equal(droneWiring({ parts: [], wires: [] }).present, false); });
test('correct wiring has no problems and maps each motor to its own pad', () => {
  const w = droneWiring(bench()); assert.equal(w.present, true); assert.deepEqual(w.problems, []); assert.equal(w.fatal, null); assert.equal(w.camera, true);
  assert.deepEqual(SLOT_POSITIONS.map((p, i) => w.slotOf[p]), [0, 1, 2, 3]);
});
test('swapped motors are reported and mapped to the pads they are on', () => {
  const w = droneWiring(bench({ fr: 'M2', fl: 'M1', bl: 'M3', br: 'M4' })); assert.equal(w.slotOf['front right'], 1); assert.equal(w.slotOf['front left'], 0); assert.ok(w.problems.some(p => /strange flying/.test(p)));
});
test('missing battery, reversed battery, loose motor and loose camera are caught', () => {
  assert.match(droneWiring({ ...bench(), wires: bench().wires.filter(w => w.a.part !== 'bat') }).fatal, /battery is not wired/);
  const rev = bench(); rev.wires = rev.wires.map(w => (w.a.part === 'bat' ? { ...w, b: { part: 'aio', pin: w.a.pin === '+' ? 'BAT-' : 'BAT+' } } : w)); assert.match(droneWiring(rev).fatal, /wrong way/);
  assert.ok(droneWiring({ ...bench(), wires: bench().wires.filter(w => w.a.part !== 'br') }).problems.some(p => /back right motor is not wired/.test(p)));
  assert.equal(droneWiring({ ...bench(), wires: bench().wires.filter(w => w.a.part !== 'cam') }).camera, false);
});
test('a wire through a second part still connects (nets, not just direct wires)', () => {
  const b = bench(); b.parts.push(P('x', 'drone-camera')); b.wires = b.wires.filter(w => w.a.part !== 'br'); b.wires.push(W('br', 'PHASES', 'x', 'VID'), W('x', 'VID', 'aio', 'M4')); assert.equal(droneWiring(b).slotOf['back right'], 3);
});
