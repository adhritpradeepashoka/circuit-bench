// Arduino UNO R4 Minima: R4 sketches are converted at compile time and run on the Uno emulation with a true 14-bit ADC and a 12-bit DAC on A0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UnoR4Mcu } from '../src/sim/uno-r4-mcu.js';
import { R4_COMPAT_H, R4_HEADER_NAME, R4_REG, R4_FQBN, r4Source } from '../src/core/r4-compat.js';
import { BOARD_SPECS } from '../src/core/boards.js';
import { PART_DEFS } from '../src/core/parts.js';
import { readParts } from '../src/core/hookup/names.js';
import { BOARDS } from '../server/compile-service.mjs';

const fx = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/r4-firmware.json', import.meta.url)), 'utf8'));
const boot = () => { const f = fx.sketches['r4-features']; assert.ok(f?.hex); const mcu = new UnoR4Mcu(f.hex), out = []; mcu.onSerial = b => out.push(b); return { mcu, last: () => Buffer.from(out).toString().trim().split('\n').pop().trim() }; };
const settle = mcu => { for (let i = 0; i < 40; i++) mcu.run(160000); };

test('spec: UNO R4 is a 5 V, 14-bit board with the R3 pin layout, built through the conversion', () => {
  const s = BOARD_SPECS['arduino-uno-r4'];
  assert.equal(s.fqbn, R4_FQBN); assert.equal(s.logic, 5); assert.equal(s.adcBits, 14); assert.equal(s.emulation, 'uno-r4');
  const ids = t => PART_DEFS[t].pins.map(p => `${p.id}@${p.x},${p.y}`).sort();
  assert.deepEqual(ids('arduino-uno-r4'), ids('arduino-uno'), 'same header as the R3');
  assert.equal(PART_DEFS['arduino-uno-r4'].tag, 'cb-uno-r4', 'its own drawing, not the R3’s');
  assert.equal(BOARDS[R4_FQBN].real, 'arduino:avr:uno'); assert.ok(BOARDS[R4_FQBN].compat);
});

test('conversion: the header goes first, the student’s line numbers stay put, and the register addresses match the simulator', () => {
  const src = r4Source('void setup() {}\nvoid loop() {}\n');
  assert.equal(src.split('\n').slice(0, 2).join('|'), `#include "${R4_HEADER_NAME}"|#line 1`);
  assert.ok(src.endsWith('void setup() {}\nvoid loop() {}\n'));
  for (const a of [R4_REG.adcSelect, R4_REG.adcLo, R4_REG.adcHi, R4_REG.dacLo, R4_REG.dacHi]) assert.ok(R4_COMPAT_H.includes(`(${a})`), `register ${a} is used by the header`);
  for (const f of ['analogReadResolution', 'analogWriteResolution', 'cb_r4_analogRead', 'cb_r4_analogWrite']) assert.ok(R4_COMPAT_H.includes(f), f);
});

test('names: "uno r4" is the R4, plain "uno" is still the R3', () => {
  assert.equal(readParts('make an uno r4 circuit').board, 'arduino-uno-r4');
  assert.equal(readParts('arduino uno r4 minima with an led').board, 'arduino-uno-r4');
  assert.equal(readParts('make a servo circuit on an arduino uno').board, 'arduino-uno');
});

test('ADC: analogReadResolution(14) returns the true 14-bit value of the pin voltage', () => {
  const { mcu, last } = boot();
  for (const [v, want] of [[2.5, 8192], [5, 16383], [0.01, 33], [1.25, 4096]]) {
    mcu.setAnalog(1, v); settle(mcu);
    assert.ok(Math.abs(+last() - want) <= 2, `${v} V → ${last()} (want ${want})`);
  }
});

test('DAC: analogWrite(A0, …) at 12 bits sets a real analog level on A0; PWM pins stay PWM', () => {
  const { mcu } = boot();
  mcu.setAnalog(1, 2.5); settle(mcu);
  assert.equal(mcu.dac, 2048); assert.ok(Math.abs(mcu.pwmDutyOf({ name: 'A0' }) - 0.5) < 0.001);
  mcu.setAnalog(1, 5); settle(mcu);
  assert.equal(mcu.dac, 4095);
  assert.equal(mcu.pwmDutyOf({ name: '9' }), null, 'a pin the sketch never used makes no PWM');
});
