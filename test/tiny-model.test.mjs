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

/* ── the router: small first, the larger model when the small one is unsure ── */
import { understandRouted } from '../src/sim/tiny-model.mjs';
const fake = (text, minProb) => ({ translate: () => ({ text, minProb }) });
const bench = { parts: [{ id: 'uno-1', type: 'arduino-uno', x: 0, y: 0 }], wires: [] };
test('router: a sure small model answers alone and the larger one is never asked', async () => {
  let asked = 0;
  const r = await understandRouted({ small: fake('add led', 0.99), large: async () => { asked++; return fake('add resistor', 1); } }, 'add an led', bench);
  assert.equal(r.engine, 'small'); assert.equal(asked, 0); assert.equal(r.program, 'add led');
});
test('router: an unsure small model hands over to the larger one', async () => {
  const r = await understandRouted({ small: fake('add resistor', 0.6), large: async () => fake('add led', 0.97) }, 'hey um add an led thanks', bench);
  assert.equal(r.engine, 'large'); assert.equal(r.program, 'add led');
});
test('router: both unsure, or the larger model not here yet, or a broken download, means null (the chosen AI answers)', async () => {
  assert.equal(await understandRouted({ small: fake('add led', 0.6), large: async () => fake('add led', 0.7) }, 'something odd', bench), null);
  assert.equal(await understandRouted({ small: fake('add led', 0.6), large: async () => null }, 'something odd', bench), null);
  assert.equal(await understandRouted({ small: fake('add led', 0.6), large: async () => { throw new Error('offline'); } }, 'something odd', bench), null);
  assert.equal(await understandRouted({ small: fake('add led', 0.6) }, 'something odd', bench), null);
  assert.equal(await understandRouted({ small: fake('defer', 0.99) }, 'help me', bench), null);
});
test('router with the real models: plain requests stay on the small one, and the larger file is a valid model of the same format', async () => {
  const load = f => { const b = readFileSync(new URL(`../public/${f}.bin`, import.meta.url)), man = JSON.parse(readFileSync(new URL(`../public/${f}.json`, import.meta.url), 'utf8')); return createTiny(man, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const small = load('tiny-model'), large = load('tiny-model-large');
  assert.ok(large.config.D > small.config.D);
  const r = await understandRouted({ small, large: async () => large }, 'add an led', { parts: [{ id: 'uno-1', type: 'arduino-uno', x: 0, y: 0 }], wires: [] });
  assert.equal(r.engine, 'small');
  for (const q of ['remove resistor-1']) { const c = { parts: [{ id: 'uno-1', type: 'arduino-uno', x: 0, y: 0 }, { id: q.split(' ')[1], type: q.split(' ')[1].replace(/-\d+$/, ''), x: 50, y: 50 }], wires: [] }; const v = await understandRouted({ small, large: async () => large }, q, c); assert.ok(v && v.engine === 'small' && /^del /.test(v.program), `${q}: ${v && v.program}`); }
});

import { looksRelevant } from '../src/core/relevance.js';
test('relevance: bioelectronics words and part names count as being about the bench; small talk does not', () => {
  for (const q of ['It has to be controlled by input from the Bioamp EXG pill', 'move the arm when my biceps flex', 'use the muscle candy board', 'the emg signal is too noisy']) assert.ok(looksRelevant(q), q);
  for (const q of ['what is the capital of france', 'tell me a joke', 'hello', 'whats the news', 'who made you']) assert.ok(!looksRelevant(q), q);
});
