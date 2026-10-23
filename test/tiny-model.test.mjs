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
