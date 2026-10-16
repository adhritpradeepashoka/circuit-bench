// AI "Ask AI" service — v0.1 (beta) is bring-your-own-key, so these tests never hit a real provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiService } from '../server/ai-service.mjs';
import { RequestError } from '../server/compile-service.mjs';
import { createServer } from '../server/server.mjs';

const fakeGeminiJson = obj => async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(obj) + '\n```' }] } }] }) });
const fakeGeminiText = text => async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });
const fakeHttpError = (status, message) => async () => ({ ok: false, status, json: async () => ({ error: { message } }) });
// The real-world shape: a ```json block with {actions, explanation} ONLY, and the sketch (if any) in its
// own separate ```cpp block with real newlines — this is the contract that avoids the JSON-escaping bug below.
const fakeGeminiSplit = (obj, code) => fakeGeminiText('```json\n' + JSON.stringify(obj) + '\n```' + (code != null ? '\n```cpp\n' + code + '\n```' : ''));

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

test('generateCode: a firmware-only reply — actions/explanation in the json block, the sketch in its own ```cpp block — round-trips', async () => {
  const ai = createAiService({ fetchImpl: fakeGeminiSplit({ actions: [], explanation: 'Blinks faster.' }, 'void setup() {\n  pinMode(13, OUTPUT);\n}\nvoid loop() {}') });
  const res = await ai.generateCode({ instruction: 'blink faster', userKey: 'k', code: 'old', circuit: { parts: [], wires: [] } });
  assert.equal(res.ok, true);
  assert.deepEqual(res.actions, []);
  assert.match(res.code, /pinMode/);
  assert.equal(res.explanation, 'Blinks faster.');
});

test('generateCode: regression — multi-line code with real (unescaped) newlines would break JSON.parse if it were put inside the json block; keeping it in a separate ```cpp block (the required contract) is unaffected', async () => {
  // This is the exact failure mode that used to silently kill the whole response: a model embeds the
  // sketch, with real newlines, as a JSON string value. Confirm that shape is genuinely invalid JSON...
  const brokenJsonText = '```json\n{"actions":[],"code":"void setup() {\n  pinMode(13, OUTPUT);\n}","explanation":"x"}\n```';
  assert.throws(() => JSON.parse(/```json\s*\n([\s\S]*?)```/i.exec(brokenJsonText)[1]));
  // ...and confirm the real prompt/parse contract keeps the code out of the json block entirely, so this
  // can't happen: actions+explanation parse from a small, code-free json object every time.
  const ai = createAiService({ fetchImpl: fakeGeminiSplit({ actions: [{ op: 'add_wire', from: { part: 'uno-1', pin: '13' }, to: { part: 'led1', pin: 'A' } }], explanation: 'Wired it up.' }, 'void setup() {\n  pinMode(13, OUTPUT);\n}\nvoid loop() {}') });
  const res = await ai.generateCode({ instruction: 'wire D13 to the LED', userKey: 'k' });
  assert.equal(res.ok, true);
  assert.equal(res.actions.length, 1);
  assert.match(res.code, /pinMode/);
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

test('generateCode: the prompt tells the model it directly controls the circuit, and must not decline a wiring/placement request as "physical" (regression: a model that believed otherwise replied with no actions and told the student to wire it themselves)', async () => {
  let sentPrompt = null;
  const ai = createAiService({
    fetchImpl: async (url, opts) => {
      sentPrompt = JSON.parse(opts.body).contents[0].parts[0].text;
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '```json\n{"actions":[{"op":"add_wire","from":{"part":"uno-1","pin":"13"},"to":{"part":"led1","pin":"A"}}],"explanation":"Wired it."}\n```' }] } }] }) };
    },
  });
  await ai.generateCode({ instruction: 'wire the LED to pin 13', userKey: 'k' });
  assert.match(sentPrompt, /you directly control the circuit/i);
  assert.match(sentPrompt, /never reply that this .can.t be done by you/i);
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
