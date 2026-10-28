import test from 'node:test';
import assert from 'node:assert/strict';
import { droneWiring, SLOT_POSITIONS } from '../src/core/drone-wiring.js';
import { TEMPLATES } from '../src/core/part-templates.js';
import { validatePartSpec, layoutSpec } from '../src/core/custom-parts.js';

const P = (id, type) => ({ id, type: `custom-${type}` }), W = (a, ap, b, bp) => ({ a: { part: a, pin: ap }, b: { part: b, pin: bp } });
const GOOD = { fr: 2, fl: 4, bl: 3, br: 1 };      // Betaflight order: M1 back right, M2 front right, M3 back left, M4 front left
const motorWires = (k, out, order = 'ABC') => ['A', 'B', 'C'].map((l, i) => W(k, l, 'aio', `M${out}${order[i]}`));
const bench = ({ map = GOOD, orders = {}, drop = [], cam = true } = {}) => ({
  parts: [P('aio', 'drone-aio'), P('bat', 'drone-battery'), P('cam', 'drone-camera'), ...Object.keys(GOOD).map(k => P(k, 'drone-motor'))],
  wires: [W('bat', '+', 'aio', 'BAT+'), W('bat', '-', 'aio', 'BAT-'), ...(cam ? [W('cam', '5V', 'aio', '5V'), W('cam', 'GND', 'aio', 'G'), W('cam', 'VID', 'aio', 'CAM')] : []),
    ...Object.entries(map).flatMap(([k, out]) => motorWires(k, out, orders[k] || 'ABC'))].filter(w => !drop.includes(`${w.a.part}.${w.a.pin}`)),
});

test('the drone parts are real sprites with a pin on every pad and wire tip', () => {
  const ts = TEMPLATES.filter(t => t.id.startsWith('drone-')); assert.equal(ts.length, 4);
  for (const t of ts) { const { id, group, ...raw } = t; const v = validatePartSpec({ ...raw, id: `custom-${id}` }); assert.ok(v.ok, `${id}: ${v.errors}`); assert.equal(v.spec.package, 'sprite'); const l = layoutSpec(v.spec); assert.ok(l.pins.every(p => p.x >= 0 && p.x <= l.w && p.y >= 0 && p.y <= l.h), id); }
  const aio = TEMPLATES.find(t => t.id === 'drone-aio'); assert.equal(aio.pins.length, 2 + 12 + 3);
});
test('no AIO on the bench: nothing is steered', () => { assert.equal(droneWiring({ parts: [], wires: [] }).present, false); });
test('correct wiring: every motor on its own output, none reversed, camera on', () => {
  const w = droneWiring(bench()); assert.equal(w.present, true); assert.deepEqual(w.problems, []); assert.equal(w.fatal, null); assert.equal(w.camera, true);
  assert.deepEqual(w.reversed, {}); assert.deepEqual(SLOT_POSITIONS.map(p => w.slotOf[p]), [0, 1, 2, 3]);
});
test('two motors on one output are reported, and fewer than four motors is flagged', () => {
  const w = droneWiring(bench({ map: { ...GOOD, fr: 4, fl: 4 } })); assert.ok(w.problems.some(p => /same AIO output \(M4\)/.test(p))); assert.equal(w.slotOf['front left'], 3);
  assert.ok(droneWiring({ ...bench(), parts: bench().parts.filter(p => p.id !== 'br') }).problems.some(p => /Only 3 motors/.test(p)));
});
test('swapping two wires of a motor reverses it; a rotation of the three does not', () => {
  assert.deepEqual(droneWiring(bench({ orders: { br: 'BAC' } })).reversed, { 'back right': true });
  assert.deepEqual(droneWiring(bench({ orders: { br: 'BCA' } })).reversed, {}); assert.deepEqual(droneWiring(bench({ orders: { br: 'CAB' } })).reversed, {});
  assert.ok(droneWiring(bench({ orders: { fl: 'CBA' } })).problems.some(p => /wrong way/.test(p)));
});
test('a loose motor wire, a motor on two outputs, a missing motor', () => {
  const w = droneWiring(bench({ drop: ['br.B'] })); assert.equal(w.loose['Motor 4'], true); assert.equal(w.slotOf['back right'], undefined); assert.ok(w.problems.some(p => /not soldered/.test(p)));
  const b = bench(); b.wires = b.wires.filter(x => !(x.a.part === 'fl' && x.a.pin === 'C')).concat(W('fl', 'C', 'aio', 'M1C')); assert.ok(droneWiring(b).problems.some(p => /different motor outputs/.test(p)));
});
test('battery: missing, reversed and shorted are caught', () => {
  assert.match(droneWiring({ ...bench(), wires: bench().wires.filter(w => w.a.part !== 'bat') }).fatal, /not wired/);
  const rev = bench(); rev.wires = rev.wires.map(w => (w.a.part === 'bat' ? { ...w, b: { part: 'aio', pin: w.a.pin === '+' ? 'BAT-' : 'BAT+' } } : w)); assert.match(droneWiring(rev).fatal, /wrong way/);
  const short = bench(); short.wires.push(W('aio', 'BAT+', 'aio', 'BAT-')); assert.match(droneWiring(short).fatal, /Short circuit/);
});
test('camera: needs power and video; its 5 V wire on the battery burns it out', () => {
  assert.equal(droneWiring(bench({ cam: false })).camera, false);
  const noPower = bench(); noPower.wires = noPower.wires.filter(w => !(w.a.part === 'cam' && w.a.pin !== 'VID')); const w = droneWiring(noPower); assert.equal(w.camera, false); assert.ok(w.problems.some(p => /no power/.test(p)));
  const burn = bench(); burn.wires = burn.wires.filter(x => !(x.a.part === 'cam' && x.a.pin === '5V')).concat(W('cam', '5V', 'aio', 'BAT+')); assert.match(droneWiring(burn).fatal, /burn out/);
});
test('wires through another pad still make a connection (nets, not only direct wires)', () => {
  const b = bench(); b.wires = b.wires.filter(x => !(x.a.part === 'br' && x.a.pin === 'A')); b.wires.push(W('br', 'A', 'cam', 'VID'), W('cam', 'VID', 'aio', 'M1A')); assert.equal(droneWiring(b).slotOf['back right'], 0);
});
