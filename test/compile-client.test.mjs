import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSketch, compileEndpoint } from '../src/sim/compile-client.js';
import { DEFAULT_SKETCH } from '../src/sim/examples.js';

const json = (body, status = 200) => ({ status, json: async () => body });

test('bundled example sketches use prebuilt firmware and never touch the network', async () => {
  let calls = 0;
  const r = await compileSketch(DEFAULT_SKETCH, { fetchImpl: async () => { calls++; throw new Error('no'); } });
  assert.equal(calls, 0); assert.ok(r.ok && r.prebuilt && r.hex.startsWith(':'));
  const crlf = await compileSketch(DEFAULT_SKETCH.replace(/\n/g, '\r\n'), { fetchImpl: async () => { calls++; } });
  assert.ok(crlf.prebuilt, 'line endings do not defeat the match');
});

test('anything else is sent to the compile service and its real build result comes back', async () => {
  let sent;
  const fetchImpl = async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return json({ ok: true, hex: ':00000001FF', output: 'Sketch uses 10 bytes', size: { flash: 10 }, diagnostics: [], cached: false, ms: 812 }); };
  const r = await compileSketch('void setup(){} void loop(){}', { fetchImpl, endpoint: '/api/compile', prebuilt: {} });
  assert.equal(sent.url, '/api/compile'); assert.deepEqual(sent.body.files, [{ name: 'sketch.ino', content: 'void setup(){} void loop(){}' }]);
  assert.ok(r.ok); assert.equal(r.ms, 812); assert.equal(r.size.flash, 10);
});

test('compile errors carry the compiler output and line diagnostics', async () => {
  const diag = [{ file: 'sketch.ino', line: 3, col: 3, severity: 'error', message: "expected ';'" }];
  const r = await compileSketch('x', { fetchImpl: async () => json({ ok: false, output: 'sketch.ino:3:3: error: expected ;', diagnostics: diag, error: 'Compilation failed.' }), prebuilt: {} });
  assert.equal(r.ok, false); assert.deepEqual(r.diagnostics, diag); assert.match(r.output, /error/); assert.ok(!r.unreachable);
});

test('an unreachable service is reported clearly, with how to start it', async () => {
  const r = await compileSketch('x', { fetchImpl: async () => { throw new TypeError('fetch failed'); }, prebuilt: {}, endpoint: 'http://localhost:9/api/compile' });
  assert.equal(r.ok, false); assert.ok(r.unreachable);
  assert.match(r.output, /npm run server/); assert.match(r.output, /localhost:9/);
  assert.match(r.output, /arduino-cli core install arduino:avr/); assert.match(r.output, /npm run doctor/);
  const html = await compileSketch('x', { fetchImpl: async () => ({ status: 404, json: async () => { throw new SyntaxError('not json'); } }), prebuilt: {} });
  assert.ok(html.unreachable && /HTTP 404/.test(html.error));
});

test('aborting a compile propagates (the UI cancels stale requests)', async () => {
  await assert.rejects(compileSketch('x', { fetchImpl: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }, prebuilt: {} }), /aborted/);
});

test('a page opened from disk (file://) explains how to reach a service instead of firing a doomed request', async () => {
  assert.equal(compileEndpoint({ search: '', protocol: 'file:' }, {}), null);
  assert.equal(compileEndpoint({ search: '?compiler=http://localhost:8787', protocol: 'file:' }, {}), 'http://localhost:8787/api/compile', 'an explicit ?compiler= still works');
  let calls = 0;
  const r = await compileSketch('void setup(){} void loop(){}', { fetchImpl: async () => { calls++; }, endpoint: null, prebuilt: {} });
  assert.equal(calls, 0); assert.ok(r.unreachable);
  assert.match(r.output, /opened from a file/); assert.match(r.output, /\?compiler=http:\/\/127\.0\.0\.1:8787/); assert.match(r.output, /VLAB_CORS_ORIGIN/);
});

test('endpoint resolution: ?compiler=… overrides, otherwise same-origin', () => {
  assert.equal(compileEndpoint({ search: '' }, {}), '/api/compile');
  assert.equal(compileEndpoint({ search: '?compiler=http://localhost:8787' }, {}), 'http://localhost:8787/api/compile');
  assert.equal(compileEndpoint({ search: '' }, { VLAB_COMPILE_URL: 'https://x.test/api/compile' }), 'https://x.test/api/compile');
});

test('multi-file projects are sent as files (never prebuilt), CRLF normalised', async () => {
  let sent;
  const fetchImpl = async (url, init) => { sent = JSON.parse(init.body); return json({ ok: true, hex: ':00000001FF', output: '', size: {}, diagnostics: [] }); };
  const files = [{ name: 'blinker.ino', content: DEFAULT_SKETCH }, { name: 'config.h', content: '#define LED 7\r\n' }];
  const r = await compileSketch(files, { fetchImpl });
  assert.ok(r.ok && !r.prebuilt, 'two files never match the single-file prebuilt table even if one is an example');
  assert.deepEqual(sent.files.map(f => f.name), ['blinker.ino', 'config.h']); assert.equal(sent.files[1].content, '#define LED 7\n');
});
