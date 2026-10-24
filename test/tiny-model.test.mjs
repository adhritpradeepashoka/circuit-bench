import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTiny, understand } from '../src/sim/tiny-model.mjs';

const b = readFileSync(new URL('../public/tiny-model.bin', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../public/tiny-model.json', import.meta.url), 'utf8'));
const model = createTiny(manifest, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

test('shipped tiny model is small and reports its metrics', () => {
  assert.ok(b.byteLength < 3e6);
  assert.ok(manifest.metrics.val > 0.99);
});

test('translates simple requests into Bench language', () => {
  const t = (req, state) => model.translate(`${req} | ${state}`).text;
  assert.match(t('add an led', 'uno-1 bb-1'), /^add led/);
  assert.match(t('delete led-1', 'uno-1 led-1'), /^del led-1/);
});

test('stays out of scope: unrelated chat is not turned into edits', () => {
  const r = understand(model, 'write me a poem about the ocean', { parts: [], wires: [] });
  assert.ok(r === null || r.kind === 'off');
});

test('"I want a basic LED circuit" works on an empty bench (adds an Uno first)', () => {
  const b = readFileSync(new URL('../public/tiny-model.bin', import.meta.url)), man = JSON.parse(readFileSync(new URL('../public/tiny-model.json', import.meta.url), 'utf8'));
  const model = createTiny(man, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  for (const q of ['I want a basic LED circuit', 'I want a basic LED Circuit']) {
    const u = understand(model, q, { parts: [], wires: [] });
    assert.ok(u, q);
    assert.equal(u.actions[0].type, 'arduino-uno');
    assert.equal(u.actions.filter(a => a.op === 'add_wire').length, 3);
  }
});

test('"make a <part> circuit" scans the bench, adds what is missing and wires only what is not wired', async () => {
  const { recipeEdit } = await import('../src/core/recipes.js');
  const empty = recipeEdit('make a MPU circuit', { parts: [], wires: [] });
  assert.deepEqual(empty.actions.filter(a => a.op === 'add_part').map(a => a.type), ['arduino-uno', 'mpu6050']);
  assert.equal(empty.actions.filter(a => a.op === 'add_wire').length, 4);
  assert.match(empty.code, /Wire\.h/);
  const have = { parts: [{ id: 'u', type: 'arduino-uno' }, { id: 'm', type: 'mpu6050' }], wires: [{ from: { part: 'm', pin: 'VCC' }, to: { part: 'u', pin: '5V' } }] };
  const r = recipeEdit('build an mpu circuit', have);
  assert.equal(r.actions.filter(a => a.op === 'add_part').length, 0, 'reuses the MPU already there');
  assert.equal(r.actions.filter(a => a.op === 'add_wire').length, 3, 'skips the wire that exists');
  assert.equal(recipeEdit('how do I make an mpu circuit', have), null, 'questions go to a bigger AI');
  const two = recipeEdit('make an mpu and oled circuit', { parts: [], wires: [] });
  assert.equal(two.actions.filter(a => a.op === 'add_part').length, 3, 'one board, two parts');
});
