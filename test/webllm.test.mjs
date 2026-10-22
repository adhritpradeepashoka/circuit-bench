import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLocal, loadLocal, resetLocal, webgpuAvailable, LOCAL_MODELS } from '../src/sim/webllm.mjs';
import { buildPrompt, relevantTypes } from '../src/core/ai-prompt.js';

const circuit = { parts: [{ id: 'uno-1', type: 'arduino-uno', x: 0, y: 0 }], wires: [] };
const fakeFactory = reply => async (id, onProgress) => { onProgress?.({ progress: 1 }); return { chat: { completions: { create: async req => { fakeFactory.last = req; return { choices: [{ message: { content: reply } }] }; } } } }; };

test('webgpuAvailable follows navigator.gpu', () => {
  assert.equal(webgpuAvailable({ gpu: {} }), true);
  assert.equal(webgpuAvailable({}), false);
  assert.equal(webgpuAvailable(null), false);
});

test('compact prompt is far smaller and still lists the relevant parts', () => {
  const full = buildPrompt({ instruction: 'blink the led', circuit, code: '' });
  const small = buildPrompt({ instruction: 'blink the led', circuit, code: '', compact: true });
  assert.ok(small.length < full.length / 3);
  assert.ok(relevantTypes('blink the led', circuit).has('led'));
  assert.match(small, /- led:/);
});

test('generateLocal returns the same shape as the hosted client', async () => {
  resetLocal();
  const reply = '```json\n{"actions":[{"op":"add_part","id":"l1","type":"led"}],"explanation":"Added an LED."}\n```';
  const res = await generateLocal({ instruction: 'add an led', circuit, code: '', factory: fakeFactory(reply), modelId: LOCAL_MODELS[0].id });
  assert.equal(res.ok, true);
  assert.equal(res.actions[0].op, 'add_part');
  assert.equal(res.meta.provider, 'On this device');
  assert.match(fakeFactory.last.messages[0].content, /add an led/);
});

test('generateLocal reports unusable replies and engine failures', async () => {
  resetLocal();
  const bad = await generateLocal({ instruction: 'x', circuit, code: '', factory: fakeFactory(''), modelId: 'm1' });
  assert.equal(bad.ok, false);
  resetLocal();
  const boom = await generateLocal({ instruction: 'x', circuit, code: '', factory: async () => { throw new Error('no gpu'); }, modelId: 'm2' });
  assert.equal(boom.ok, false); assert.match(boom.error, /no gpu/);
  assert.equal((await generateLocal({ instruction: '  ', circuit, code: '' })).ok, false);
});

test('loadLocal reuses the engine for the same model', async () => {
  resetLocal(); let n = 0;
  const f = async () => { n++; return {}; };
  await loadLocal('a', { factory: f }); await loadLocal('a', { factory: f });
  assert.equal(n, 1);
});

test('pickBuild falls back to the f32 build without shader-f16', async () => {
  const { pickBuild } = await import('../src/sim/webllm.mjs');
  const nav = f16 => ({ gpu: { requestAdapter: async () => ({ features: new Set(f16 ? ['shader-f16'] : []) }) } });
  assert.match(await pickBuild('Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC', nav(true)), /q4f16_1/);
  assert.match(await pickBuild('Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC', nav(false)), /q4f32_1/);
  await assert.rejects(pickBuild('m', { gpu: { requestAdapter: async () => null } }), /adapter/i);
});
