import test from 'node:test';
import assert from 'node:assert/strict';
import { runProgram } from '../src/core/bench-lang.js';
import { applyCircuitActions } from '../src/core/ai-actions.js';

const base = { parts: [{ id: 'uno-1', type: 'arduino-uno', x: 0, y: 0 }, { id: 'led-1', type: 'led', x: 0, y: 0 }, { id: 'led-2', type: 'led', x: 0, y: 0 }, { id: 'resistor-3', type: 'resistor', x: 0, y: 0 }], wires: [] };
const go = (p, c = base) => { const r = runProgram(p, c); return r?.kind === 'edit' ? { r, out: applyCircuitActions(c, r.actions) } : r; };

test('add / del / set', () => {
  let x = go('add led color=red'); assert.equal(x.out.warnings.length, 0); assert.equal(x.out.parts.at(-1).color, 'red');
  x = go('add resistor x3 ohms=330'); assert.equal(x.out.parts.filter(p => p.type === 'resistor').length, 4);
  assert.equal(new Set(x.out.parts.map(p => p.id)).size, x.out.parts.length);
  x = go('del resistor'); assert.equal(x.out.parts.length, 3);
  assert.equal(go('del led'), null, 'two LEDs and no "all": refuse to guess');
  assert.equal(go('del led all').out.parts.length, 2);
  x = go('set resistor ohms=1000'); assert.equal(x.out.parts.find(p => p.id === 'resistor-3').ohms, 1000);
  x = go('set led-2 color=blue'); assert.equal(x.out.parts.find(p => p.id === 'led-2').color, 'blue');
});

test('build led / button / pot wire real pins and write a sketch', () => {
  let x = go('build led 9');
  assert.equal(x.out.warnings.length, 0); assert.equal(x.out.wires.length, 3);
  x = go('build button 2'); assert.equal(x.out.wires.length, 2); assert.match(x.r.code, /INPUT_PULLUP/);
  x = go('build pot A0'); assert.equal(x.out.wires.length, 3); assert.match(x.r.code, /analogRead\(A0\)/);
  assert.equal(go('build pot 9'), null, 'a pot needs an analog pin');
  assert.equal(go('build led 99'), null);
  assert.equal(go('build led 9', { parts: [], wires: [] }), null, 'no board to wire to');
});

test('blink, wire, multi-step programs', () => {
  assert.match(go('blink 9 250').r.code, /delay\(250\)/);
  const x = go('add led; add resistor; wire uno-1 9 resistor1 1');
  assert.equal(x.out.wires.length, 1, 'new parts get predictable ids (resistor1) that later commands can name');
  assert.equal(go('wire uno-1 9 resistor9 1'), null, 'an id that does not exist is refused');
  const y = go('add led color=green; build led 7; blink 7 500'); assert.equal(y.out.warnings.length, 0); assert.ok(y.r.code);
});

test('defer, off, and garbage are never executed', () => {
  assert.equal(runProgram('defer').kind, 'defer'); assert.equal(runProgram('off').kind, 'off');
  for (const bad of ['', 'rm -rf', 'add flux-capacitor', 'add led color=purple', 'add led x99', 'set led-1 ohms=5', 'add resistor ohms=-5', 'wire led-1 Q uno-1 9', 'add led; '.repeat(9), 'blink 9 5']) assert.equal(runProgram(bad, base), null, bad);
});

test('build with no pin picks a free one, wires it fully, and blink auto uses that pin', () => {
  const x = go('build led auto; blink auto 500');
  assert.equal(x.out.warnings.length, 0);
  assert.equal(x.out.wires.length, 3, 'pin → resistor → LED → GND');
  assert.match(x.r.code, /LED_PIN = 13;/);
  // a second one goes to the next free pin, not on top of the first
  const again = go('build led auto', { parts: x.out.parts, wires: x.out.wires });
  assert.equal(again.out.wires.length, 6);
  const pins = again.out.wires.filter(w => w.from.part === 'uno-1' && /^\d+$/.test(w.from.pin)).map(w => w.from.pin);
  assert.deepEqual(pins.sort(), ['12', '13']);
  assert.equal(go('build pot auto').out.warnings.length, 0);
  assert.equal(go('build button').out.wires.length, 2, 'a missing pin means auto');
});
