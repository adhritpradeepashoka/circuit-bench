// Real firmware for the XIAO ESP32-S3 (built by tools/build-xiao-fixtures.mjs with the same conversion the compile service uses), run in the emulator.
// A compile succeeding proves little; these check what the pins and the ADC actually do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BOARD_SPECS } from '../src/core/boards.js';
import { avrInstruction } from 'avr8js';
import { UnoQMcu } from '../src/sim/uno-q-mcu.js';

const spec = BOARD_SPECS['xiao-esp32s3'], P = id => spec.pins[id];
const load = name => new UnoQMcu(readFileSync(new URL(`./fixtures/${name}.hex`, import.meta.url), 'utf8'));
const avrPin = ({ port, bit }) => ({ D: 0, B: 8, C: 14 })[port] + bit;           // Arduino pin number of an AVR pad

test('blink on LED_BUILTIN: the board LED pin is driven both ways, and the LED is lit while the pin is LOW', () => {
  const mcu = load('xiao-blink'), seen = new Set();
  for (let i = 0; i < 400; i++) { mcu.run(10000); seen.add(mcu.pinMode(P('LED'))); }
  assert.ok(seen.has('H') && seen.has('L'), `LED pin states: ${[...seen]}`);
  assert.equal(spec.ledActiveLow, true);
});

test('ledcWrite(D9, 64) at 8 bits is a 25 % PWM on the pad the drawing calls D9 and on no other pwm pad', () => {
  const mcu = load('xiao-pwm'); mcu.run(400000);
  assert.ok(Math.abs(mcu.pwmDuty(avrPin(P('D9'))) - 64 / 255) < 0.01, `duty ${mcu.pwmDuty(avrPin(P('D9')))}`);
  for (const id of ['D8', 'D10']) assert.equal(mcu.pwmDuty(avrPin(P(id))), null, `${id} should be idle`);
});

test('D1 follows D2 (pull-up) and D6 is its inverse: the pads reach the right AVR pins in both directions', () => {
  const mcu = load('xiao-pins'); mcu.run(50000);
  assert.equal(mcu.pinMode(P('D2')), 'U');                                       // INPUT_PULLUP took effect on D2
  mcu.setInput(P('D2'), true); mcu.run(50000);
  assert.equal(mcu.pinMode(P('D1')), 'H'); assert.equal(mcu.pinMode(P('D6')), 'L');
  mcu.setInput(P('D2'), false); mcu.run(50000);
  assert.equal(mcu.pinMode(P('D1')), 'L'); assert.equal(mcu.pinMode(P('D6')), 'H');
});

// Width of the servo pulses on D8 in microseconds, measured edge to edge in CPU cycles, with D0 held at `volts` (3.3 V is full scale on this board: 4095)
function pulsesUs(volts) {
  const mcu = load('xiao-servo'); mcu.adc.channelValues[0] = volts; mcu.run(2_000_000);
  const { cpu } = mcu, { port, bit } = P('D8'), out = [], end = cpu.cycles + 800_000;
  let prev = mcu.ports[port].pinState(bit) === 1, t0 = 0;
  while (cpu.cycles < end) {
    avrInstruction(cpu); cpu.tick();
    const hi = mcu.ports[port].pinState(bit) === 1;
    if (hi && !prev) t0 = cpu.cycles; if (!hi && prev && t0) out.push((cpu.cycles - t0) / 16);
    prev = hi;
  }
  return out;
}

test('servo on D8 driven from D0: the pulse is 0.5 ms at 0 V, 1.45 ms at 1.65 V and 2.4 ms at 3.3 V, every 20 ms', () => {
  for (const [v, us] of [[0, 500], [1.65, 1450], [3.3, 2400]]) {
    const p = pulsesUs(v); assert.ok(p.length >= 2, `${v} V: no pulses`);
    for (const w of p) assert.ok(Math.abs(w - us) < 15, `${v} V: ${w} us, wanted about ${us}`);
  }
});
