import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTiny } from '../src/sim/tiny-model.mjs';
import { partFromModel } from '../src/sim/part-model.mjs';
import { specFromPartLanguage, rolesFor, parsePartLanguage } from '../src/core/part-model-decode.js';
import { createPartSplit } from '../src/sim/ai-client.mjs';
import { TEMPLATES } from '../src/core/part-templates.js';
import { validatePartSpec } from '../src/core/custom-parts.js';

const pub = f => new URL(`../public/${f}`, import.meta.url);
const bin = readFileSync(pub('part-model.bin'));
const model = createTiny(JSON.parse(readFileSync(pub('part-model.json'), 'utf8')), bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));

test('decoder: every catalog part the model learned turns into a valid part with the roles the built-in template has', () => {
  const asc = s => s.replace(/Ω/g, 'ohm').replace(/[µμ]/g, 'u').replace(/[^\x20-\x7e]/g, '');
  const byName = new Map(TEMPLATES.map(t => [asc(t.name), t]));
  let checked = 0;
  for (const t of TEMPLATES) {
    if (/\.\d$/.test(t.pins.map(p => p.id).join(' '))) continue;
    const spec = specFromPartLanguage(`${asc(t.name)}|${asc(t.label)}|${t.behaviour.kind}|${t.pins.map(p => p.id).join(' ')}|`);
    if (!spec) continue;                                               // kinds the model does not write (logic, boards…)
    assert.deepEqual(Object.entries(spec.behaviour.roles).sort(), Object.entries(byName.get(asc(t.name)).behaviour.roles).sort(), t.name); checked++;
  }
  assert.ok(checked >= 40, `only ${checked} templates checked`);
});

test('decoder refuses what it cannot be sure of', () => {
  assert.equal(specFromPartLanguage('unknown'), null);
  assert.equal(specFromPartLanguage('x|x|diode|A A|'), null, 'duplicate pins');
  assert.equal(specFromPartLanguage('x|x|npn|P Q R|'), null, 'no pin plays the base');
  assert.equal(specFromPartLanguage('x|x|warpdrive|A B|'), null);
  assert.deepEqual(parsePartLanguage('R|1k|resistor|1 2|ohms=1000').params, { ohms: 1000 });
  assert.deepEqual(rolesFor('npn', ['E', 'B', 'C']), { base: 'B', collector: 'C', emitter: 'E' });
});

const ask = q => partFromModel(model, q, { templates: TEMPLATES });
test('model: names, numbers and kinds come out right (and validate)', () => {
  let r = ask('ina128 with gain 500'); assert.equal(r.spec.behaviour.kind, 'inamp'); assert.equal(r.spec.behaviour.gain, 500); assert.deepEqual(r.spec.pins.map(p => p.id), ['IN+', 'IN-', 'OUT', 'REF', 'V+', 'V-']);
  r = ask('4.7k resistor'); assert.equal(r.spec.behaviour.ohms, 4700);
  r = ask('zener 3.3v'); assert.equal(r.spec.behaviour.vz, 3.3);
  r = ask('tip120'); assert.deepEqual(r.spec.pins.map(p => p.id), ['B', 'C', 'E']);
  r = ask('add a 10uf capacitor'); assert.equal(r.spec.behaviour.uF, 10);
  r = ask('lm35'); assert.equal(r.spec.behaviour.kind, 'analog-sensor');
  for (const q of ['ina128 with gain 500', 'sg90 servo', 'hc-sr04', 'bioamp exg pill gain 2000']) assert.equal(validatePartSpec(ask(q).spec).ok, true, q);
});

test('model: a built-in template it recognises keeps its own accurate drawing', () => {
  const r = ask('hc-sr04'); assert.equal(r.spec.package, TEMPLATES.find(t => t.id === 'hcsr04').package);
});

test('model: unknown parts, things it cannot model, nonsense and a bare number are NOT answered (the bigger AI gets them)', () => {
  for (const q of ['mpu6050', 'arduino uno', 'my cool new flux sensor xyz9000', 'make a rocket engine', 'lets make 12v', 'a motor driver', 'l298n', 'esp32 cam']) assert.equal(ask(q), null, q);
});

test('Part Maker order: your approved part, then built-in template, then the model on this device, then the AI', async () => {
  let aiCalls = 0; const fetchImpl = async () => { aiCalls++; return { status: 200, json: async () => ({ ok: false, error: 'no' }) }; };
  const device = async d => partFromModel(model, d, { templates: TEMPLATES });
  const r = await createPartSplit({ description: 'a 22k resistor', templates: TEMPLATES, device, fetchImpl, endpoint: '/x', userKey: 'k' });
  assert.equal(r.source, 'on-device'); assert.equal(r.spec.behaviour.ohms, 22000); assert.equal(aiCalls, 0);
  const off = await createPartSplit({ description: 'a 22k resistor', templates: TEMPLATES, device: null, fetchImpl, endpoint: '/x', userKey: 'k' });
  assert.notEqual(off.source, 'on-device', 'with the model switched off the AI path runs');
  assert.ok(aiCalls > 0);
});

test('plain values are read by rule, exactly', async () => {
  const { valuePart } = await import('../src/sim/part-model.mjs');
  const o = (q) => specFromPartLanguage(valuePart(q));
  assert.equal(o('a 22k resistor').behaviour.ohms, 22000);
  assert.equal(o('4.7k ohm resistor').behaviour.ohms, 4700);
  assert.equal(o('resistor 100 ohm').behaviour.ohms, 100);
  assert.equal(o('2.2M resistor').behaviour.ohms, 2200000);
  assert.equal(o('100nF capacitor').behaviour.uF, 0.1);
  assert.equal(o('100 pf cap').behaviour.uF, 0.0001);
  assert.equal(o('1000uf capacitor').behaviour.uF, 1000);
  assert.equal(o('10 mH inductor').behaviour.mH, 10);
  assert.equal(o('5.1v zener').behaviour.vz, 5.1);
  assert.equal(valuePart('10k potentiometer'), null, 'a pot is the model\'s job');
  assert.equal(valuePart('an LM35'), null);
  assert.equal(ask('a 22k resistor').spec.behaviour.ohms, 22000);
});
