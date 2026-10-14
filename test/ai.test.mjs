// AI "Generate Code" service — v0.1 (beta) is bring-your-own-key, so these tests never hit a real provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiService, summariseCircuit } from '../server/ai-service.mjs';
import { RequestError } from '../server/compile-service.mjs';
import { createServer } from '../server/server.mjs';

const fakeOk = text => async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });
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

test('generateCode: extracts the fenced code block and the explanation text', async () => {
  const ai = createAiService({ fetchImpl: fakeOk('Sure.\n```cpp\nvoid setup(){}\nvoid loop(){}\n```\nThis blinks the LED.') });
  const res = await ai.generateCode({ instruction: 'blink', userKey: 'k', code: 'old', circuit: { parts: [], nets: [] } });
  assert.equal(res.ok, true);
  assert.match(res.code, /void setup\(\)\{\}\s*\n\s*void loop\(\)\{\}/);
  assert.match(res.explanation, /blinks the LED/);
});

test('generateCode: a reply with no code block is a clear error, not a crash', async () => {
  const ai = createAiService({ fetchImpl: fakeOk('I am not sure what you mean.') });
  await assert.rejects(() => ai.generateCode({ instruction: 'blink', userKey: 'k' }), e => e instanceof RequestError && e.status === 502);
});

test('generateCode: an invalid-key provider error is surfaced as 401, not a generic 500', async () => {
  const ai = createAiService({ fetchImpl: fakeHttpError(400, 'API key not valid') });
  await assert.rejects(() => ai.generateCode({ instruction: 'blink', userKey: 'bad' }), e => e instanceof RequestError && e.status === 401);
});

test('generateCode: a provider rate limit is surfaced as 429', async () => {
  const ai = createAiService({ fetchImpl: fakeHttpError(429, 'Resource exhausted') });
  await assert.rejects(() => ai.generateCode({ instruction: 'blink', userKey: 'k' }), e => e instanceof RequestError && e.status === 429);
});

test('summariseCircuit: keeps it to ids/types and net names/pins, drops geometry', () => {
  const project = { parts: [{ id: 'p1', type: 'led', x: 10, y: 20, rot: 0 }], nets: [{ name: 'net-1', pins: ['p1|A'] }] };
  assert.deepEqual(summariseCircuit(project), { parts: [{ id: 'p1', type: 'led' }], nets: [{ name: 'net-1', pins: ['p1|A'] }] });
  assert.deepEqual(summariseCircuit(null), { parts: [], nets: [] });
});

test('server: POST /api/ai/generate-code round-trips through the HTTP layer', async () => {
  const ai = createAiService({ fetchImpl: fakeOk('```cpp\nvoid setup(){} void loop(){}\n```') });
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
