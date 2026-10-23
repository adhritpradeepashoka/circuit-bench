// The compile service. Pure request/diagnostic logic always runs; the tests that need Arduino CLI skip themselves without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseRequest, findForbidden, parseDiagnostics, createCompiler, RequestError } from '../server/compile-service.mjs';
import { createServer } from '../server/server.mjs';

test('request validation: names, sizes, boards, exactly one main sketch', () => {
  assert.equal(normaliseRequest({ sketch: 'void setup(){}' }).main, 'sketch.ino');
  const multi = normaliseRequest({ files: [{ name: 'main.ino', content: '' }, { name: 'helper.h', content: '' }, { name: 'util.cpp', content: '' }] });
  assert.equal(multi.main, 'main.ino'); assert.equal(multi.fqbn, 'arduino:avr:uno');
  const bad = b => assert.throws(() => normaliseRequest(b), RequestError);
  bad(null); bad({}); bad({ sketch: 5 }); bad({ files: [] });
  bad({ files: [{ name: '../evil.ino', content: '' }] }); bad({ files: [{ name: 'a/b.ino', content: '' }] });
  bad({ files: [{ name: 'notes.txt', content: '' }] }); bad({ files: [{ name: 'a.h', content: '' }] });
  bad({ files: [{ name: 'a.ino', content: '' }, { name: 'a.ino', content: '' }] });
  bad({ sketch: 'x', fqbn: 'esp32:esp32:esp32' });
  assert.throws(() => normaliseRequest({ sketch: 'x'.repeat(300 * 1024) }), e => e.status === 413);
});

test('isolation guards: no absolute/parent includes, no .incbin/.include', () => {
  for (const bad of ['#include "/etc/passwd"', '#include </etc/hosts>', '#include "../secret.h"', '  #  include "a/../../b.h"', '#include "C:\\\\x.h"', '#include_next "/x"', 'asm(".incbin \\"/etc/passwd\\"");', 'asm(".include \\"x\\"");'])
    assert.ok(findForbidden('a.ino', bad), bad);
  for (const ok of ['#include <Wire.h>', '#include "helper.h"', '#include <avr/pgmspace.h>', '#include "sub/dir.h"', 'int included = 1;'])
    assert.equal(findForbidden('a.ino', ok), null, ok);
});

test('GCC output → diagnostics (paths stripped, library files excluded, severities kept)', () => {
  const out = [
    "/tmp/vlab-x/sketch/sketch.ino: In function 'void setup()':",
    "/tmp/vlab-x/sketch/sketch.ino:3:3: error: expected ';' before 'undefinedThing'",
    "/tmp/vlab-x/sketch/sketch.ino:7:9: warning: unused variable 'x' [-Wunused-variable]",
    "/tmp/vlab-x/sketch/helper.h:2:1: fatal error: Nope.h: No such file or directory",
    '/opt/core/arduino/Print.h:10:1: error: in a library file',
    "/tmp/vlab-x/sketch/sketch.ino:9:1: note: declared here",
  ].join('\n');
  const d = parseDiagnostics(out, '/tmp/vlab-x/sketch');
  assert.deepEqual(d.map(x => [x.file, x.line, x.col, x.severity]), [['sketch.ino', 3, 3, 'error'], ['sketch.ino', 7, 9, 'warning'], ['helper.h', 2, 1, 'error'], ['sketch.ino', 9, 1, 'note']]);
  assert.equal(d[0].message, "expected ';' before 'undefinedThing'");
});

test('CORS is off by default and opt-in via corsOrigin (preflight answered without touching the compiler)', async () => {
  const stub = { compile: async () => { throw new Error('should not be called'); }, version: async () => '0' };
  for (const [corsOrigin, expectStatus] of [[null, 403], ['*', 204]]) {
    const server = createServer({ compiler: stub, corsOrigin });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const pre = await fetch(`${base}/api/compile`, { method: 'OPTIONS', headers: { origin: 'http://elsewhere.test', 'access-control-request-method': 'POST' } });
      assert.equal(pre.status, expectStatus);
      assert.equal(pre.headers.get('access-control-allow-origin'), corsOrigin);
      const health = await fetch(`${base}/api/health`);
      assert.equal(health.headers.get('access-control-allow-origin'), corsOrigin);
    } finally { await new Promise(r => server.close(r)); }
  }
});

const compiler = createCompiler();
const haveToolchain = !!(await compiler.version());
const skip = haveToolchain ? false : 'Arduino CLI not available';

async function withServer(fn) {
  const server = createServer({ compiler });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { await new Promise(r => server.close(r)); }
}
const post = (base, body, path = '/api/compile') => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('service: real compile → hex + sizes; repeat is served from cache', { skip }, async () => {
  await withServer(async base => {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.ok(health.ok && /^\d+\.\d+/.test(health.arduinoCli)); assert.ok(health.boards['arduino:avr:uno']);
    const src = 'void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, !digitalRead(13)); delay(100); }\n';
    const r = await (await post(base, { sketch: src })).json();
    assert.ok(r.ok, r.output); assert.ok(r.hex.startsWith(':') && r.hex.trim().endsWith(':00000001FF'));
    assert.ok(r.size.flash > 400 && r.size.flash < 3000 && r.size.flashMax === 32256 && r.size.ramMax === 2048);
    assert.match(r.output, /Sketch uses \d+ bytes/); assert.ok(!/vlab-/.test(r.output), 'no temp paths leak');
    assert.equal(r.cached, false);
    const again = await (await post(base, { sketch: src })).json();
    assert.ok(again.ok && again.cached && again.hex === r.hex);
  });
});

test('service: syntax and undefined-name errors come back as real GCC diagnostics with line numbers', { skip }, async () => {
  await withServer(async base => {
    const r = await (await post(base, { sketch: 'void setup() {\n  int x = 1\n  y = 2;\n}\nvoid loop() {}\n' })).json();
    assert.equal(r.ok, false);
    assert.ok(r.diagnostics.some(d => d.severity === 'error' && d.line === 3 && d.file === 'sketch.ino'), JSON.stringify(r.diagnostics));
    assert.match(r.output, /sketch\.ino:3:\d+: error:/); assert.ok(!/vlab-|\/tmp\//.test(r.output));
    const missing = await (await post(base, { sketch: '#include <NoSuchLibrary.h>\nvoid setup() {}\nvoid loop() {}\n' })).json();
    assert.equal(missing.ok, false); assert.match(missing.output, /NoSuchLibrary\.h: No such file or directory/);
  });
});

test('service: multi-file sketches, real libraries, prototypes and #define all work', { skip }, async () => {
  await withServer(async base => {
    const r = await (await post(base, { files: [
      { name: 'blinker.ino', content: '#include "config.h"\n#include <Wire.h>\nvoid setup() { pinMode(LED, OUTPUT); Wire.begin(); }\nvoid loop() { toggle(); delay(100); }\n' },
      { name: 'config.h', content: '#define LED 7\nvoid toggle();\n' },
      { name: 'extra.cpp', content: '#include <Arduino.h>\nvoid toggle() { digitalWrite(7, !digitalRead(7)); }\n' },
    ] })).json();
    assert.ok(r.ok, r.output);
  });
});

test('service: hostile input is refused before the compiler sees it', { skip }, async () => {
  await withServer(async base => {
    for (const sketch of ['#include "/etc/passwd"\nvoid setup(){} void loop(){}', 'void setup(){ asm(".incbin \\"/etc/passwd\\""); } void loop(){}']) {
      const res = await post(base, { sketch }); assert.equal(res.status, 400);
      const b = await res.json(); assert.equal(b.ok, false); assert.ok(b.error);
    }
    assert.equal((await post(base, { sketch: 'x', fqbn: 'evil:board:x' })).status, 400);
    assert.equal((await post(base, '{not json')).status, 400);
    assert.equal((await post(base, { sketch: 'x'.repeat(500_000) })).status, 413);
    assert.equal((await fetch(`${base}/api/compile`)).status, 405);
    assert.equal((await fetch(`${base}/api/nope`)).status, 404);
    assert.equal((await fetch(`${base}/`)).status, 404, 'no static dir configured');
  });
});

test('service: concurrent requests are queued, not dropped', { skip }, async () => {
  await withServer(async base => {
    const jobs = [1, 2, 3, 4].map(n => post(base, { sketch: `int n = ${n};\nvoid setup() { pinMode(${n + 4}, OUTPUT); }\nvoid loop() {}\n` }).then(r => r.json()));
    const results = await Promise.all(jobs);
    assert.ok(results.every(r => r.ok), results.map(r => r.output).join('\n'));
    assert.equal(new Set(results.map(r => r.hex)).size, 4, 'four different programs');
  });
});

test('server: /api/config exposes only the public Google client ID (null when unset)', async () => {
  const { createServer } = await import('../server/server.mjs');
  for (const [cfg, want] of [[{}, null], [{ googleClientId: 'abc.apps.googleusercontent.com' }, 'abc.apps.googleusercontent.com']]) {
    const server = createServer({ compiler: { version: async () => null }, publicConfig: cfg });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    try {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/config`);
      assert.deepEqual(await r.json(), { googleClientId: want, accounts: false });
    } finally { server.close(); }
  }
});
