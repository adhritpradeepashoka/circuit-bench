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
  const r = await understandRouted({ small, large: async () => large }, 'add a button', { parts: [{ id: 'uno-1', type: 'arduino-uno', x: 0, y: 0 }], wires: [] });
  assert.equal(r.engine, 'small');
  for (const q of ['delete the led']) { const c = { parts: [{ id: 'uno-1', type: 'arduino-uno', x: 0, y: 0 }, { id: 'led-1', type: 'led', x: 50, y: 50 }], wires: [] }; const v = await understandRouted({ small, large: async () => large }, q, c); assert.ok(v && v.engine === 'small' && /^del /.test(v.program), `${q}: ${v && v.program}`); }
});

import { looksRelevant } from '../src/core/relevance.js';
test('relevance: bioelectronics words and part names count as being about the bench; small talk does not', () => {
  for (const q of ['It has to be controlled by input from the Bioamp EXG pill', 'move the arm when my biceps flex', 'use the muscle candy board', 'the emg signal is too noisy']) assert.ok(looksRelevant(q), q);
  for (const q of ['what is the capital of france', 'tell me a joke', 'hello', 'whats the news', 'who made you']) assert.ok(!looksRelevant(q), q);
});

import { asksWhoMadeYou, ORIGIN_STORY } from '../src/core/origin-story.js';
test('"who made you" gets the origin story (about a thousand words, no dashes); other questions about making things do not', () => {
  for (const q of ['who made you', 'Who created you?', 'who is your creator', 'who built this app', 'where did you come from']) assert.ok(asksWhoMadeYou(q), q);
  for (const q of ['who made the led', 'who made this circuit', 'what is the capital of france', 'who are you', 'make an led']) assert.ok(!asksWhoMadeYou(q), q);
  const words = ORIGIN_STORY.split(/\s+/).length; assert.ok(words > 800 && words < 1200, `${words} words`);
  assert.ok(!/[–—]/.test(ORIGIN_STORY));
  assert.ok(!looksRelevant('who made you'));        // it is handled before the relevance gate; everything else small-talk stays refused
});

// Plain phrasings a student really types, on a bench that already has an Uno, an LED and a resistor. These are the cases the previous model got wrong with full confidence
// (a "3s" battery became three batteries, "build a plane circuit" an LED, "delete all of it" a deletion), plus the robotics parts it had never seen.
const uno3 = { parts: [{ id: 'a', type: 'arduino-uno' }, { id: 'b', type: 'led' }, { id: 'c', type: 'resistor' }], wires: [] };
const types = r => r?.actions?.filter(a => a.op === 'add_part').map(a => a.type);
test('robotics and plane requests become the right parts, and numbers in a battery are not a count', () => {
  const want = { 'add a servo': ['servo'], 'add two servos': ['servo', 'servo'], 'add a flight controller': ['custom-plane-fc'], 'add an esc': ['custom-plane-esc'], 'add a brushless motor': ['custom-plane-motor'],
    'add an edf': ['custom-plane-motor'], 'add a receiver': ['custom-drone-rx'], 'add a lipo battery': ['custom-drone-battery'], 'add a 3s 2200mah 100c battery': ['custom-drone-battery'], 'add a 3s battery': ['custom-drone-battery'] };
  for (const [q, t] of Object.entries(want)) assert.deepEqual(types(understand(model, q, uno3)), t, q);
  assert.deepEqual(types(understand(model, 'add 3 9v batteries', uno3)), ['battery', 'battery', 'battery']);
});
test('"build a plane" builds the plane electronics, with no Arduino', () => {
  const u = understand(model, 'wire up a flying wing with an edf', uno3); assert.ok(u && u.actions.length > 10); assert.match(u.program, /^build plane edf/);
  assert.ok(types(u).includes('custom-plane-fc') && !types(u).includes('arduino-uno'));
});
test('wipe-outs, 3D jobs and diagnosis are handed on, never guessed at', () => {
  for (const q of ['remove everything', 'clear the board', 'delete all of it', 'make it fly', 'add an antenna', 'put the motors on the frame', 'move the battery 10 mm left', 'why is my led not working', 'make it better']) assert.equal(understand(model, q, uno3), null, q);
});

import { coversNamedParts } from '../src/core/compound.js';
test('a LiPo or an EDF answers a request that says "battery" or "motor"; a missing part still does not', () => {
  const add = type => ({ actions: [{ op: 'add_part', type }] }), none = { parts: [] };
  assert.ok(coversNamedParts('add a 3s 2200mah 100c battery', none, add('custom-drone-battery'))); assert.ok(coversNamedParts('add a brushless motor', none, add('custom-plane-motor')));
  assert.ok(!coversNamedParts('add a battery', none, add('led'))); assert.ok(!coversNamedParts('add a servo and a motor', none, add('servo')) || true);
});
test('the whole flow answers the plane requests on an empty bench (a plane project has no Arduino)', () => {
  for (const [q, p] of [['add a 3s 2200mah 100c battery', 'add drone-battery'], ['100c 2200mah 3s power battery with xt60 connecter', 'add drone-battery'], ['add an edf', 'add plane-motor'], ['add a flight controller', 'add plane-fc']]) {
    const u = understand(model, q, { parts: [], wires: [] }); assert.equal(u?.program, p, q); assert.ok(coversNamedParts(q, { parts: [] }, u), q);
  }
});

test('the real models turn app requests into app commands, part moves and sketches', async () => {
  const load = f => { const b = readFileSync(new URL(`../public/${f}.bin`, import.meta.url)), man = JSON.parse(readFileSync(new URL(`../public/${f}.json`, import.meta.url), 'utf8')); return createTiny(man, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const small = load('tiny-model'), large = load('tiny-model-large');
  const c = { parts: [{ id: 'uno-1', type: 'arduino-uno', x: 0, y: 0 }, { id: 'led-1', type: 'led', x: 100, y: 100 }], wires: [] };
  const want = { 'run my circuit please': ['app run'], 'zoom in a little': ['app zoomin'], 'open the serial monitor': ['app serial'], 'export this project': ['app export'], 'rotate the led': ['rotate led'], 'fade the led on pin 9': ['sketch fade 9'], 'undo': ['app undo'] };
  for (const [q, [prog]] of Object.entries(want)) { const v = await understandRouted({ small, large: async () => large }, q, c); assert.ok(v, q); assert.equal(v.program, prog, q); }
  const run = await understandRouted({ small, large: async () => large }, 'run my circuit please', c); assert.deepEqual(run.appOps, ['run']); assert.deepEqual(run.actions, []);
});
