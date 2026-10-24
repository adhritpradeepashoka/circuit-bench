// Compiles the Raspberry Pi Pico test sketches (test/firmware/pico-*.ino) with Arduino-Pico and the Uno R4 ones (r4-*.ino, converted for
// the Uno emulation) and writes test/fixtures/pico-firmware.json and r4-firmware.json, so the test-suite needs no ARM toolchain. Needs the rp2040 core (scripts/setup-toolchain.sh).
// Run: node scripts/build-pico-firmware.mjs
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createCompiler } from '../server/compile-service.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const compiler = createCompiler();
const version = await compiler.version();
if (!version) { console.error('Cannot run Arduino CLI (see README).'); process.exit(1); }
const dir = join(root, 'test/firmware'), out = {}, r4 = {};
for (const file of readdirSync(dir).filter(f => /^r4-.*\.ino$/.test(f)).sort()) {
  const source = readFileSync(join(dir, file), 'utf8');
  const res = await compiler.compile({ sketch: source, fqbn: 'cb:uno-r4' });
  if (!res.ok) { console.error(`${file} failed:\n${res.output}`); process.exit(1); }
  r4[file.replace(/\.ino$/, '')] = { source, fqbn: 'cb:uno-r4', hex: res.hex, size: res.size };
  console.log(`  ${file.padEnd(20)} ${res.size?.flash ?? '?'} B flash`);
}
writeFileSync(join(root, 'test/fixtures/r4-firmware.json'), JSON.stringify({ arduinoCli: version, sketches: r4 }));
for (const file of readdirSync(dir).filter(f => f.startsWith('pico-') && f.endsWith('.ino')).sort()) {
  const source = readFileSync(join(dir, file), 'utf8');
  const r = await compiler.compile({ sketch: source, fqbn: 'rp2040:rp2040:rpipico' });
  if (!r.ok) { console.error(`${file} failed:\n${r.output}`); process.exit(1); }
  out[file.replace(/\.ino$/, '')] = { source, fqbn: 'rp2040:rp2040:rpipico', firmware: r.firmware, format: r.format, size: r.size };
  console.log(`  ${file.padEnd(20)} ${r.size?.flash ?? '?'} B flash`);
}
mkdirSync(join(root, 'test/fixtures'), { recursive: true });
writeFileSync(join(root, 'test/fixtures/pico-firmware.json'), JSON.stringify({ arduinoCli: version, sketches: out }));
console.log('wrote test/fixtures/pico-firmware.json');
