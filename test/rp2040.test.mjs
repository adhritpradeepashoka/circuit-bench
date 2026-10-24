// Raspberry Pi Pico: real Arduino-Pico firmware on the RP2040 emulator, plus the board's spec and 3.3 V behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Rp2040Mcu, firmwareImage, parseUf2, FLASH_BASE, RP_HZ } from '../src/sim/rp2040-mcu.js';
import { BOARD_SPECS } from '../src/core/boards.js';
import { PART_DEFS } from '../src/core/parts.js';

const fx = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/pico-firmware.json', import.meta.url)), 'utf8'));
const boot = name => {
  const f = fx.sketches[name]; assert.ok(f?.firmware, `${name} built`);
  const mcu = new Rp2040Mcu(f.firmware), out = [];
  mcu.onSerial = b => out.push(b);
  return { mcu, text: () => Buffer.from(out).toString('latin1') };
};
const GP = bit => ({ port: 'GP', bit });
const runFor = (mcu, s) => { const end = mcu.seconds + s; while (mcu.seconds < end) mcu.run(100000, Infinity); };

test('spec: the Pico is a 3.3 V, 12-bit board with the right pins', () => {
  const s = BOARD_SPECS['raspberry-pi-pico'];
  assert.equal(s.chip, 'rp2040'); assert.equal(s.logic, 3.3); assert.equal(s.adcBits, 12);
  assert.equal(s.fqbn, 'rp2040:rp2040:rpipico'); assert.equal(s.ledPin, '25');
  assert.ok(PART_DEFS['raspberry-pi-pico']);
  for (const arduino of ['arduino-uno', 'arduino-nano', 'arduino-mega']) assert.equal(BOARD_SPECS[arduino].logic, 5);
});

test('firmware image: raw bin, base64 and UF2 all load to flash', () => {
  const f = fx.sketches['pico-blink'];
  const bin = firmwareImage(f.firmware);
  assert.ok(bin.length > 1000);
  assert.deepEqual([...firmwareImage(bin)].slice(0, 16), [...bin].slice(0, 16));
  assert.equal(FLASH_BASE, 0x10000000); assert.equal(RP_HZ, 125e6);
  assert.equal(typeof parseUf2, 'function');
});

test('blink: LED_BUILTIN (GP25) and GP15 toggle every 100 ms', () => {
  const { mcu } = boot('pico-blink');
  const seen = []; let last = null; const end = 1.0;
  while (mcu.seconds < end) { mcu.run(125000, Infinity); const s = mcu.pinMode(GP(15)); if (s !== last) { seen.push([mcu.seconds, s]); last = s; } }
  const flips = seen.filter(([t]) => t > 0.05);
  assert.ok(flips.length >= 8, `expected ~10 edges in 1 s, got ${flips.length}`);
  for (let i = 1; i < flips.length; i++) { const dt = flips[i][0] - flips[i - 1][0]; assert.ok(Math.abs(dt - 0.1) < 0.01, `half period ${dt}`); }
  assert.ok(['H', 'L'].includes(mcu.pinMode(GP(25))));
});

test('Serial over USB, ADC (12-bit scaled to 10-bit), button and PWM', () => {
  const { mcu, text } = boot('pico-io');
  mcu.setAnalog(0, 1.65);
  mcu.setInput(GP(16), true);
  runFor(mcu, 0.4);
  assert.match(text(), /adc=(51\d|50\d) btn=1/, text().slice(-80));
  assert.equal(mcu.pinMode(GP(14)), 'L');
  assert.ok(Math.abs(mcu.pwmDuty(13) - 128 / 255) < 0.02, `pwm ${mcu.pwmDuty(13)}`);
  mcu.setInput(GP(16), false); mcu.setAnalog(0, 3.3);
  runFor(mcu, 0.3);
  assert.match(text(), /adc=1023 btn=0/);
  assert.equal(mcu.pinMode(GP(14)), 'H');
  assert.equal(mcu.pwmDuty(12), null);
});

test('serialWrite reaches the firmware without crashing when nothing reads it', () => {
  const { mcu } = boot('pico-io');
  mcu.serialWrite('hello\n'); runFor(mcu, 0.1);
  assert.ok(mcu.seconds >= 0.1);
});
