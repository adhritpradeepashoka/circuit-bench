import test from 'node:test';
import assert from 'node:assert/strict';
import { checkToolchain, formatChecks } from '../server/doctor.mjs';

const down = async () => { throw new TypeError('fetch failed'); };
const up = async () => ({ json: async () => ({ ok: true, arduinoCli: '1.5.1' }) });
const stub = ({ version = '1.5.1', build = { ok: true, size: { flash: 444 }, ms: 900 } } = {}) => ({ config: { cli: 'arduino-cli' }, version: async () => version, compile: async () => build });

test('doctor: no Arduino CLI → says how to install it for the platform, and stops there', async () => {
  for (const [platform, needle] of [['win32', /Windows.*PATH/s], ['darwin', /brew install arduino-cli/], ['linux', /install\.sh/]]) {
    const checks = await checkToolchain(stub({ version: null }), { platform, fetchImpl: down });
    assert.deepEqual(checks.map(c => [c.name, c.ok]), [['Compile service', false], ['Arduino CLI', false]]);
    assert.match(checks[1].fix, needle, platform);
    assert.match(formatChecks(checks), /Fix the ✗ items above/);
  }
});

test('doctor: CLI present but the AVR core is missing → tells you the exact command', async () => {
  const build = { ok: false, output: 'Error during build: Platform \'arduino:avr\' not found: platform not installed\n' };
  const checks = await checkToolchain(stub({ build }), { fetchImpl: down });
  const core = checks.find(c => c.name.includes('AVR core'));
  assert.equal(core.ok, false); assert.match(core.fix, /arduino-cli core update-index && arduino-cli core install arduino:avr/);
  assert.match(core.detail, /platform not installed|Platform/);
});

test('doctor: everything installed but the service is not running → "now start it"; service up → "reload and press Run"', async () => {
  let checks = await checkToolchain(stub(), { fetchImpl: down });
  assert.deepEqual(checks.map(c => c.ok), [false, true, true]);
  assert.match(checks[0].fix, /npm run server/);
  assert.match(formatChecks(checks), /Your machine can compile\. Now start the service:\s+npm run server/);
  checks = await checkToolchain(stub(), { fetchImpl: up });
  assert.deepEqual(checks.map(c => c.ok), [true, true, true]); assert.match(checks[0].detail, /Arduino CLI 1\.5\.1/);
  assert.match(formatChecks(checks), /All good — the compile service is up/);
});

test('doctor: a thrown compile error is reported, not a crash', async () => {
  const compiler = { config: {}, version: async () => '1.5.1', compile: async () => { throw new Error('spawn ENOENT avr-gcc'); } };
  const checks = await checkToolchain(compiler, { fetchImpl: down });
  assert.equal(checks.at(-1).ok, false); assert.match(checks.at(-1).detail, /ENOENT/);
});
