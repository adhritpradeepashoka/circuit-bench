import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { splitSteps, solveSteps, applyToCopy } from '../src/core/compound.js';
import { quickEdit } from '../src/core/quick-edits.js';
import { createTiny, understandRouted } from '../src/sim/tiny-model.mjs';

const load = n => { const m = JSON.parse(fs.readFileSync(new URL(`../public/${n}.json`, import.meta.url))); const b = fs.readFileSync(new URL(`../public/${n}.bin`, import.meta.url)); return createTiny(m, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const small = load('tiny-model'), large = load('tiny-model-large');
const solve = async (s, c) => quickEdit(s, c) || (await understandRouted({ small, large: async () => large }, s, c).then(u => u && (u.kind === 'off' ? { actions: [], explanation: u.explanation, kind: 'off' } : { ...u, viaModel: true })));

test('splitSteps: lists share the verb, steps stay steps, single steps and unclear pieces are left alone', () => {
  assert.deepEqual(splitSteps('add a resistor and an led'), ['add a resistor', 'add an led']);
  assert.deepEqual(splitSteps('add a red led, a resistor and a button'), ['add a red led', 'add a resistor', 'add a button']);
  assert.deepEqual(splitSteps('add a button, then blink the led'), ['add a button', 'blink the led']);
  assert.deepEqual(splitSteps('add a servo and connect it to pin 9'), ['add a servo', 'connect it to pin 9']);
  assert.equal(splitSteps('add an led'), null);
  assert.equal(splitSteps('connect the led to pin 13 and ground'), null, 'not a step: do not guess');
});

test('applyToCopy: later steps see what earlier steps added', () => {
  const c = applyToCopy({ parts: [], wires: [] }, [{ op: 'add_part', id: 'led', type: 'led' }, { op: 'add_wire', from: { part: 'led', pin: 'A' }, to: { part: 'u', pin: 'D13' } }, { op: 'remove_part', id: 'led' }]);
  assert.equal(c.parts.length, 0); assert.equal(c.wires.length, 0, 'removing a part takes its wires');
});

test('"add a resistor and an led" is answered on the device as two adds', async () => {
  const r = await solveSteps('add a resistor and an led', { parts: [{ id: 'u', type: 'arduino-uno' }], wires: [] }, solve);
  assert.deepEqual(r.actions.filter(a => a.op === 'add_part').map(a => a.type), ['resistor', 'led']);
});

test('a request with a step nothing understands is not half-answered: the whole request goes on (null)', async () => {
  const c = { parts: [{ id: 'u', type: 'arduino-uno' }], wires: [] };
  assert.equal(await solveSteps('add a led and write me a poem about the moon', c, solve), null);
  assert.equal(await solveSteps('add an led and show the distance on the oled', c, async (s, k) => (/distance/.test(s) ? null : solve(s, k))), null);
});

test('"add a button, then wire it to pin 2": "it" is the button, and it is not added twice', async () => {
  const r = await solveSteps('add a button, then wire it to pin 2', { parts: [{ id: 'u', type: 'arduino-uno' }], wires: [] }, solve);
  assert.equal(r.actions.filter(a => a.op === 'add_part').length, 1);
  assert.ok(r.actions.some(a => a.op === 'add_wire'));
});
