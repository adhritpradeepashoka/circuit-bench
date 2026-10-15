// AI "Ask AI" service — v0.1 (beta) is bring-your-own-key, so these tests never hit a real provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiService } from '../server/ai-service.mjs';
import { RequestError } from '../server/compile-service.mjs';
import { createServer } from '../server/server.mjs';

const fakeGeminiJson = obj => async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(obj) + '\n```' }] } }] }) });
const fakeGeminiText = text => async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });
const fakeHttpError = (status, message) => async () => ({ ok: false, status, json: async () => ({ error: { message } }) });

test('generateCode: no key is refused with needsKey (no network call made)', async () => {
  let called = false;
  const ai = createAiService({ fetchImpl: async () => { called = true; } });
  await assert.rejects(() => ai.generateCode({ instruction: 'blink' }), err => err instanceof RequestError && err.status === 428 && err.needsKey === true);
  assert.equal(called, false);
});

test('generateCode: empty instruction is refused before any key check', async () => {
  const ai = createAiService({ fetchImpl: async () => { throw new Error('should not be called'); } });
  await assert.rejects(() => ai.generateCode({ instruction: '  ' }), RequestError);
});

test('generateCode: a firmware-only reply (code, no actions) round-trips', async () => {
  const ai = createAiService({ fetchImpl: fakeGeminiJson({ actions: [], code: 'void setup(){}\nvoid loop(){}', explanation: 'Blinks faster.' }) });
  const res = await ai.generateCode({ instruction: 'blink faster', userKey: 'k', code: 'old', circuit: { parts: [], wires: [] } });
  assert.equal(res.ok, true);
  assert.deepEqual(res.actions, []);
  assert.match(res.code, /void setup/);
  assert.equal(res.explanation, 'Blinks faster.');
});

test('generateCode: a circuit-only reply (actions, code:null) round-trips without inventing code', async () => {
  const actions = [{ op: 'add_part', id: 'led2', type: 'led' }, { op: 'add_wire', from: { part: 'uno-1', pin: '13' }, to: { part: 'led2', pin: 'A' } }];
  const ai = createAiService({ fetchImpl: fakeGeminiJson({ actions, code: null, explanation: 'Added a second LED on D13.' }) });
  const res = await ai.generateCode({ instruction: 'add another LED on pin 13', userKey: 'k' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.actions, actions);
  assert.equal(res.code, null);
});

test('generateCode: a reply with neither actions nor code is a clear error, not a crash', async () => {
  const ai = createAiService({ fetchImpl: fakeGeminiJson({ actions: [], code: null, explanation: 'I am not sure.' }) });
  await assert.rejects(() => ai.generateCode({ instruction: 'blink', userKey: 'k' }), e => e instanceof RequestError && e.status === 502);
});

test('generateCode: falls back to a bare ```cpp block if the model ignores the JSON format', async () => {
  const ai = createAiService({ fetchImpl: fakeGeminiText('Sure.\n```cpp\nvoid setup(){}\nvoid loop(){}\n```\nDone.') });
  const res = await ai.generateCode({ instruction: 'blink', userKey: 'k' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.actions, []);
  assert.match(res.code, /void setup/);
});

test('generateCode: an invalid-key provider error is surfaced as 401, not a generic 500', async () => {
  const ai = createAiService({ fetchImpl: fakeHttpError(400, 'API key not valid') });
  await assert.rejects(() => ai.generateCode({ instruction: 'blink', userKey: 'bad' }), e => e instanceof RequestError && e.status === 401);
});

test('generateCode: a provider rate limit is surfaced as 429', async () => {
  const ai = createAiService({ fetchImpl: fakeHttpError(429, 'Resource exhausted') });
  await assert.rejects(() => ai.generateCode({ instruction: 'blink', userKey: 'k' }), e => e instanceof RequestError && e.status === 429);
});

test('generateCode: the groq provider parses its OpenAI-shaped response and hits the OpenAI-compatible endpoint', async () => {
  let seenUrl = null, seenAuth = null;
  const ai = createAiService({
    fetchImpl: async (url, opts) => {
      seenUrl = url; seenAuth = opts.headers.authorization;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '```json\n{"actions":[],"code":"void setup(){} void loop(){}","explanation":"Switched to Groq."}\n```' } }] }) };
    },
  });
  const res = await ai.generateCode({ instruction: 'blink', userKey: 'gk', provider: 'groq' });
  assert.equal(res.ok, true);
  assert.match(res.code, /void setup/);
  assert.equal(res.explanation, 'Switched to Groq.');
  assert.match(seenUrl, /api\.groq\.com/);
  assert.equal(seenAuth, 'Bearer gk');
});

test('generateCode: an unknown provider name is rejected before any network call', async () => {
  let called = false;
  const ai = createAiService({ fetchImpl: async () => { called = true; } });
  await assert.rejects(() => ai.generateCode({ instruction: 'blink', userKey: 'k', provider: 'bogus' }), RequestError);
  assert.equal(called, false);
});

test('server: POST /api/ai/generate-code round-trips through the HTTP layer', async () => {
  const ai = createAiService({ fetchImpl: fakeGeminiJson({ actions: [], code: 'void setup(){} void loop(){}', explanation: 'ok' }) });
  const server = createServer({ ai, compiler: { version: async () => null } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    let r = await fetch(`${base}/api/ai/generate-code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction: 'blink' }) });
    assert.equal(r.status, 428);
    assert.equal((await r.json()).error, 'AI features need a free API key for now — add one in Settings → AI.');

    r = await fetch(`${base}/api/ai/generate-code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction: 'blink', userKey: 'k' }) });
    assert.equal(r.status, 200);
    assert.match((await r.json()).code, /void setup/);

    r = await fetch(`${base}/api/ai/generate-code`, { method: 'GET' });
    assert.equal(r.status, 405);
  } finally {
    server.close();
  }
});
