import test from 'node:test';
import assert from 'node:assert/strict';
const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
const { learnPart, learnedParts, learnedTemplates, matchLearned, examplesFor, forgetLearnedPart } = await import('../src/core/learned-parts.js');
const { checkPart, describeExamples, PART_AGENT_ROLE } = await import('../src/core/part-agent.js');
const { createPartSplit } = await import('../src/sim/ai-client.mjs');
const { createAiService } = await import('../server/ai-service.mjs');
const { buildBrainPrompt, buildPartPrompt } = await import('../src/core/ai-prompt.js');
const { validatePartSpec } = await import('../src/core/custom-parts.js');
const { TEMPLATES } = await import('../src/core/part-templates.js');

const bio = { name: 'BioAmp EXG Pill', label: 'EXG Pill', description: 'Bio-potential amplifier.', color: '#2b6cb0', textColor: '#ffffff', package: 'module', breadboard: true,
  pins: [{ id: 'VCC', label: 'VCC', side: 'bottom' }, { id: 'GND', label: 'GND', side: 'bottom' }, { id: 'OUT', label: 'OUT', side: 'bottom' }], behaviour: { kind: 'analog-sensor', roles: { vcc: 'VCC', gnd: 'GND', out: 'OUT' } } };
const ina = { ...bio, name: 'INA128', label: 'INA128', pins: ['V-IN', 'V+IN', 'RG', 'REF', 'VEE', 'VCC', 'OUT'].map(id => ({ id, label: id, side: 'bottom' })), behaviour: { kind: 'inamp', roles: { inp: 'V+IN', inn: 'V-IN', out: 'OUT', vcc: 'VCC', vee: 'VEE', ref: 'REF' } } };

test('an approved part is remembered, survives a reload, and is found again from the student\'s own words', () => {
  mem.clear();
  assert.equal(learnPart('the bioamp exg pill from upside down labs', bio), true);
  const list = learnedParts(); assert.equal(list.length, 1);
  const t = learnedTemplates(list);
  assert.equal(matchLearned('bioamp exg pill', t)?.name, 'BioAmp EXG Pill');
  assert.equal(matchLearned('add the BioAmp EXG Pill please', t)?.name, 'BioAmp EXG Pill');
  assert.equal(matchLearned('an ultrasonic distance sensor', t), null, 'an unrelated request is not matched');
});

test('a request with a number the remembered part never had is a different part: the AI makes it', () => {
  mem.clear(); learnPart('ina128 instrumentation amp', ina);
  const t = learnedTemplates();
  assert.ok(matchLearned('ina128 instrumentation amp', t));
  assert.equal(matchLearned('ina128 with gain 1000', t), null);
});

test('damaged or invalid entries are ignored, forgetting removes, the list is capped', () => {
  mem.clear(); learnPart('x', bio);
  assert.equal(learnPart('bad', { name: 'x', pins: [] }), false);
  mem.set('virtual-lab:learned-parts', JSON.stringify([{ id: 'a', request: 'junk', spec: { nope: 1 } }, null, 5, ...JSON.parse(mem.get('virtual-lab:learned-parts'))]));
  assert.equal(learnedParts().length, 1);
  assert.equal(forgetLearnedPart('learned-bioamp-exg-pill'), true); assert.equal(learnedParts().length, 0);
  for (let i = 0; i < 90; i++) learnPart(`part ${i}`, { ...bio, name: `Thing ${i}` });
  assert.equal(learnedParts().length, 80);
});

test('Part Maker answers a remembered part instantly, with no AI call, and still asks the AI for anything new', async () => {
  const zorb = { ...bio, name: 'Zorbex Flux Sensor', label: 'ZORBEX' };
  mem.clear(); learnPart('zorbex flux sensor', zorb);
  let calls = 0; const fetchImpl = async () => { calls++; return { status: 200, json: async () => ({ ok: false, error: 'no' }) }; };
  const r = await createPartSplit({ description: 'zorbex flux sensor', templates: TEMPLATES, learned: learnedTemplates(), fetchImpl, endpoint: '/x', userKey: 'k' });
  assert.equal(r.ok, true); assert.equal(r.source, 'learned'); assert.equal(calls, 0);
  assert.equal(validatePartSpec(r.spec).ok, true);
  const bodies = []; const f2 = async (_u, o) => { bodies.push(JSON.parse(o.body)); return { status: 200, json: async () => ({ ok: true, brain: true, spec: validatePartSpec(bio).spec, meta: {} }) }; };
  await createPartSplit({ description: 'zorbex flux sensor with 10 times more sensitivity', templates: TEMPLATES, learned: learnedTemplates(), fetchImpl: f2, endpoint: '/x', userKey: 'k', provider: 'gemini' });
  assert.ok(bodies[0].brain && bodies[0].examples.length === 1, 'the similar approved part goes along as an example');
});

test('agent checker: pins against the datasheet, size, dropped numbers, "none" for a modellable part', () => {
  const spec = validatePartSpec(ina).spec;
  assert.deepEqual(checkPart(spec, { description: 'ina128', facts: { pins: ['V-IN', 'V+IN', 'RG', 'REF', 'VEE', 'VCC', 'OUT'] } }), []);
  assert.match(checkPart(spec, { description: 'ina128', facts: { pins: ['1', '2', '3', '4', '5', '6', '7', '8'] } })[0], /8 pins/);
  assert.match(checkPart(spec, { description: 'ina128', facts: { pins: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] } })[0], /differ from the datasheet/);
  assert.match(checkPart(spec, { description: 'ina128 gain 1000' })[0], /1000/);
  assert.deepEqual(checkPart(spec, { description: 'ina128 gain 1000', note: 'Gain 1000 set with RG.' }), []);
  assert.deepEqual(checkPart(spec, { description: 'INA128' }), [], 'digits inside a part number are not a specification');
  const none = validatePartSpec({ ...bio, behaviour: { kind: 'none' } }).spec;
  assert.match(checkPart(none, { description: 'a servo motor' })[0], /none/);
});

test('prompts carry the agent role and the approved examples', () => {
  const ex = examplesFor('bioamp pill', (mem.clear(), learnPart('bioamp exg pill', bio), learnedTemplates()));
  assert.equal(ex.length, 1); assert.ok(!('art' in ex[0].spec));
  for (const p of [buildBrainPrompt('x', null, ex), buildPartPrompt('x', null, { examples: ex })]) { assert.ok(p.includes(PART_AGENT_ROLE)); assert.ok(p.includes('ALREADY APPROVED')); }
  assert.equal(describeExamples([]), '');
});

test('server: the agent sends a part that drops a stated number back for repair, and sanitises examples', async () => {
  const replies = [{ ...ina }, { ...ina, note: 'Gain 1000 set with RG.' }, { ...ina, note: 'Gain 1000 set with RG.' }]; const prompts = [];
  const fetchImpl = async (_u, o) => { const gen = /Part wanted/.test(o.body || ''); if (gen) prompts.push(o.body); const r = gen ? (replies.shift() || replies.at(-1)) : {}; return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(r) + '\n```' }] } }] }) }; };
  const ai = createAiService({ fetchImpl });
  const r = await ai.createPart({ description: 'ina128 with gain 1000', userKey: 'k', provider: 'gemini', brain: true, examples: [{ request: 'ok', spec: bio }, { request: 'evil', spec: { name: 1 } }, 'junk'] });
  assert.equal(r.ok, true); assert.equal(prompts.length, 2); assert.match(prompts[1], /appears nowhere/);
  assert.equal((prompts[0].match(/ALREADY APPROVED/g) || []).length, 1);
});
