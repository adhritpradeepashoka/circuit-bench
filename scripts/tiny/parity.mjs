// Checks the JavaScript runtime against the Python trainer: same weights, same tokenizer, same answers.
// Usage: node scripts/tiny/parity.mjs MODEL_DIR DATA_DIR
import { readFileSync } from 'node:fs';
import { createTiny, understand } from '../../src/sim/tiny-model.mjs';
import { stateString } from '../../src/core/bench-lang.js';
const [dir, data] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(`${dir}/tiny-model.json`, 'utf8')), bin = readFileSync(`${dir}/tiny-model.bin`);
const m = createTiny(manifest, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const rows = readFileSync(`${data}/heldout.jsonl`, 'utf8').trim().split('\n').slice(0, 300).map(l => JSON.parse(l));
let exact = 0, t0 = performance.now();
for (const r of rows) if (m.translate(`${r.request} | ${r.state}`).text === r.program) exact++;
const ms = (performance.now() - t0) / rows.length;
console.log(`JS held-out exact match ${(exact / rows.length * 100).toFixed(1)}% on ${rows.length} · ${ms.toFixed(1)} ms per request · python said ${(manifest.metrics.heldout * 100).toFixed(1)}%`);
