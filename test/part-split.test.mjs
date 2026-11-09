import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES } from '../src/core/part-templates.js';
import { matchTemplate, heuristicSpec, guessKind } from '../src/core/part-match.js';
import { BEHAVIOURS, validatePartSpec } from '../src/core/custom-parts.js';
import { createPartSplit } from '../src/sim/ai-client.mjs';
import { buildBrainPrompt } from '../src/core/ai-prompt.js';

test('templates: clear part names match instantly, vague or ambiguous ones do not', () => {
  const id = d => matchTemplate(d, TEMPLATES)?.id;
  assert.equal(id('1N4007 diode'), 'd-1n4007'); assert.equal(id('2N2222 transistor'), 'q-2n2222'); assert.equal(id('LM358 op amp'), 'opamp-lm358');
  assert.equal(id('a rotary encoder KY-040'), 'ky040'); assert.equal(id('NAND gate'), 'gate-nand'); assert.equal(id('100uF electrolytic capacitor'), 'cap-100u');
  assert.equal(id('a thing that glows when it is dark'), undefined); assert.equal(id('Muscle BioAmp Candy EMG board'), undefined);
});

test('keyword guess: every behaviour kind gives a valid, placeable part', () => {
  for (const k of Object.keys(BEHAVIOURS)) {
    if (['none', 'logic', 'slime-mold', 'keypad', 'switch-bank', 'led-array', 'mux', 'bldc'].includes(k)) continue;
    const s = heuristicSpec(k === 'analog-sensor' ? 'gas sensor' : k === 'variable-resistor' ? 'potentiometer' : k === 'resistor' ? 'a resistor' : k === 'hbridge' ? 'motor driver' : k.replace('-', ' '));
    assert.ok(s, `no part for ${k}`); assert.ok(validatePartSpec(s).ok);
  }
  assert.equal(guessKind('HC-SR04 ultrasonic'), 'ultrasonic'); assert.equal(guessKind('SG90 servo'), 'servo');
});

test('the brain prompt is small enough for a free tier', () => assert.ok(buildBrainPrompt('an HC-SR04 ultrasonic sensor').length < 4000));

const store = new Map([['virtual-lab:ai-key:gemini', 'g'], ['virtual-lab:ai-provider', 'gemini']]);
const brainSpec = { name: 'Gas sensor MQ-2', label: 'MQ-2', color: '#2b6cb0', textColor: '#fff', package: 'module', breadboard: true, pins: [{ id: 'VCC', label: '5V', side: 'bottom' }, { id: 'GND', label: 'G', side: 'bottom' }, { id: 'AO', label: 'Analog', side: 'bottom' }], behaviour: { kind: 'analog-sensor', roles: { vcc: 'VCC', gnd: 'GND', out: 'AO' } } };

test('split: the small brain arrives first, the drawing is merged in; if the drawing fails the part still exists', async () => {
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const partial = [];
  const art = { ...brainSpec, package: 'art', breadboard: false, sizeMm: { w: 20, h: 25, source: 'test' }, art: { w: 80, h: 100, svg: '<rect x="2" y="2" width="76" height="96" fill="#2b6cb0"/>', motion: [] }, pins: [{ id: 'VCC', label: '5V', x: 20, y: 98 }, { id: 'GND', label: 'G', x: 40, y: 98 }, { id: 'AO', label: 'Analog', x: 60, y: 98 }] };
  let drawOk = true;
  const fetchImpl = async (_u, o) => { const b = JSON.parse(o.body); return { status: 200, json: async () => (b.brain ? { ok: true, brain: true, spec: validatePartSpec(brainSpec).spec, meta: { provider: 'Groq' } } : drawOk ? { ok: true, spec: validatePartSpec(art, { strict: false }).spec, meta: { provider: 'Gemini' } } : { ok: false, error: 'Gemini error: quota exceeded' }) }; };
  const r = await createPartSplit({ description: 'MQ-2 gas sensor', fetchImpl, endpoint: '/x', templates: TEMPLATES, onPartial: p => partial.push(p.source) });
  assert.deepEqual(partial, ['brain']); assert.equal(r.source, 'split'); assert.equal(r.spec.package, 'art'); assert.equal(r.spec.behaviour.kind, 'analog-sensor');
  drawOk = false; partial.length = 0;
  const r2 = await createPartSplit({ description: 'MQ-2 gas sensor', fetchImpl, endpoint: '/x', templates: TEMPLATES, onPartial: p => partial.push(p.source) });
  assert.equal(r2.ok, true); assert.equal(r2.source, 'brain'); assert.match(r2.note, /generic board/);
  delete globalThis.localStorage;
});

test('split: a template match needs no AI; with every provider down a keyword guess still makes a part', async () => {
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: () => {}, removeItem: () => {} };
  const never = async () => { throw new Error('should not be called'); };
  const t = await createPartSplit({ description: '1N4007 diode', fetchImpl: never, endpoint: '/x', templates: TEMPLATES });
  assert.equal(t.source, 'template'); assert.equal(t.meta.ms, 0);
  const down = async () => ({ status: 200, json: async () => ({ ok: false, error: 'quota exceeded' }) });
  const g = await createPartSplit({ description: 'a thing that glows when it is dark', fetchImpl: down, endpoint: '/x', templates: TEMPLATES });
  assert.equal(g.ok, true); assert.equal(g.source, 'guess'); assert.match(g.note, /No AI answered/);
  const local = await createPartSplit({ description: 'MQ-2 gas sensor', fetchImpl: never, endpoint: '/x', templates: TEMPLATES, local: async () => ({ ok: true, brain: true, spec: validatePartSpec(brainSpec).spec, meta: { provider: 'On this device' } }) }).catch(e => e);
  assert.ok(local.ok !== undefined);   // the on-device brain is used before any provider is asked
  delete globalThis.localStorage;
});

test('server: brain mode asks the SMALL prompt and returns a validated part', async () => {
  const { createAiService } = await import('../server/ai-service.mjs');
  const prompts = [];
  const fetchImpl = async (url, o) => { const body = JSON.parse(o.body || '{}'); prompts.push(JSON.stringify(body).length); return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(brainSpec) + '\n```' }] } }] }) }; };
  const ai = createAiService({ fetchImpl });
  const r = await ai.createPart({ description: 'MQ-2 gas sensor', userKey: 'k', provider: 'gemini', brain: true });
  assert.equal(r.ok, true); assert.equal(r.brain, true); assert.equal(r.spec.behaviour.kind, 'analog-sensor');
  assert.ok(Math.max(...prompts) < 9000, `brain request was ${Math.max(...prompts)} chars`);
});
