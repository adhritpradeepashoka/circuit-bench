// New components, each driven by real Arduino libraries compiled by the real toolchain (test/fixtures/firmware.json):
// the 16×2 I²C LCD (LiquidCrystal_I2C) and the DHT11/DHT22 sensor (Adafruit DHT), plus the motor driver in the solver.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Mcu, CPU_HZ } from '../src/sim/mcu.js';
import { Lcd1602 } from '../src/parts/lcd1602.js';
import { Dht, dhtBytes } from '../src/parts/dht.js';
import { BOARD_SPECS } from '../src/core/boards.js';

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/firmware.json', import.meta.url)), 'utf8'));
function boot(name) {
  const f = fixtures.sketches[name]; assert.ok(f?.result.ok, `${name} built`);
  const mcu = new Mcu(f.result.hex), out = [];
  mcu.onSerial = b => out.push(b);
  return { mcu, text: () => Buffer.from(out).toString('latin1'), run: s => mcu.run(Math.round(s * CPU_HZ)) };
}

test('LCD 16×2 (I²C): LiquidCrystal_I2C prints text, a custom character and the backlight; clear() and setCursor work', () => {
  const { mcu, text, run } = boot('lcd-hello');
  const lcd = new Lcd1602();
  mcu.i2c.setDevices(new Map([[0x27, lcd]]));
  for (let i = 0; i < 40 && !/drawn/.test(text()); i++) run(0.05);     // init() waits ~1 s for the LCD to power up
  assert.match(text(), /drawn/);
  assert.equal(lcd.backlight, true);
  assert.deepEqual(lcd.lines(), ['Hello, world!   ', '  ? CircuitBench']);
  assert.equal(lcd.characters()[16 + 2], 0, 'character code 0 = the custom heart');
  assert.deepEqual([...lcd.cgram.slice(0, 8)], [0, 10, 31, 31, 14, 4, 0, 0]);
  const font = lcd.font(new Uint8Array(256 * 8));
  assert.equal(font[1], 0b01010, 'symmetric row survives mirroring'); assert.equal(font[5], 0b00100);
  run(0.7);
  assert.match(lcd.lines()[0], /^Count: \d+ *$/);
  const n1 = +lcd.lines()[0].slice(7); run(0.35);
  assert.ok(+lcd.lines()[0].slice(7) >= n1 + 3, 'the counter keeps updating');
});

test('LCD: with nothing at 0x27 the library talks to no one, and the address shows up as unanswered', () => {
  const { mcu, run } = boot('lcd-hello');
  run(1.3);
  assert.ok(mcu.i2c.unanswered().includes(0x27));
});

test('DHT bytes: DHT22 encodes tenths and a sign bit; DHT11 whole numbers; both with a checksum; values clamp to the part’s range', () => {
  assert.deepEqual(dhtBytes('DHT22', 23.4, 51.2), [0x02, 0x00, 0x00, 0xea, (0x02 + 0xea) & 0xff]);
  assert.deepEqual(dhtBytes('DHT22', -10.1, 0).slice(2, 4), [0x80, 101]);
  assert.deepEqual(dhtBytes('DHT11', 26, 55), [55, 0, 26, 0, 81]);
  assert.equal(dhtBytes('DHT11', 70, 5)[2], 50); assert.equal(dhtBytes('DHT11', 70, 5)[0], 20);
});

for (const [name, model, pin, temp, hum, expect] of [
  ['dht22-read', 'DHT22', '7', 23.4, 51.2, /t:23\.4 h:51\.2/],
  ['dht11-read', 'DHT11', '4', 26, 55, /t:26\.0 h:55\.0/],
]) {
  test(`${model}: the Adafruit DHT library reads the temperature and humidity set on the part, and follows changes`, () => {
    const { mcu, text, run } = boot(name);
    const dht = new Dht(model);
    dht.setValues({ temp: temp, humidity: hum });
    dht.attach(mcu, BOARD_SPECS['arduino-uno'].pins[pin]);
    run(0.5);
    assert.match(text(), expect);
    assert.ok(dht.reads >= 1);
    dht.setValues({ temp: model === 'DHT22' ? -5.5 : 31, humidity: 70 });
    run(2.2);
    assert.match(text().split('\n').filter(Boolean).pop(), model === 'DHT22' ? /t:-5\.5 h:70\.0/ : /t:31\.0 h:70\.0/);
  });
}

test('DHT: not connected → the library reports a failed read (NaN), exactly like a real unplugged sensor', () => {
  const { text, run } = boot('dht22-read');
  run(0.5);
  assert.match(text(), /fail/);
});

// ── motors ──────────────────────────────────────────────────────────────
import { compile } from '../src/core/netlist.js';
import { solveDrive, motorRpm } from '../src/core/solver.js';
const wire = (id, a, ap, b, bp) => ({ id, a: { part: a, pin: ap }, b: { part: b, pin: bp }, style: 'straight', color: '#000', width: 2 });
const motorRig = (extra = []) => ({
  parts: [{ id: 'uno-1', type: 'arduino-uno', x: 0, y: 0, rot: 0 }, { id: 'drv', type: 'l298n', x: 400, y: 0, rot: 0 }, { id: 'mot', type: 'dc-motor', x: 700, y: 0, rot: 0 }, { id: 'bat', type: 'battery', x: 400, y: 300, rot: 0, volts: 9 }],
  wires: [wire('w1', 'uno-1', '8', 'drv', 'IN1'), wire('w2', 'uno-1', '9', 'drv', 'IN2'), wire('w3', 'drv', 'OUT1', 'mot', '1'), wire('w4', 'drv', 'OUT2', 'mot', '2'),
    wire('w5', 'bat', '+', 'drv', '12V'), wire('w6', 'bat', '-', 'drv', 'GND'), wire('w7', 'drv', 'GND', 'uno-1', 'GND.1'), ...extra],
});

test('L298N + DC motor: IN1/IN2 set direction, both equal stops, ENA PWM sets speed, no battery → a clear warning', () => {
  let c = compile(motorRig());
  const run = (pins, duty = new Map()) => solveDrive(c, { pins: new Map(Object.entries(pins)), pressed: new Set(), duty });
  let r = run({ 8: 'H', 9: 'L' });
  assert.ok(r.motorVolts.get('mot') > 6 && r.motorVolts.get('mot') < 7.6, `forward: 9 V − 1.4 V bridge drop, less the output resistance: ${r.motorVolts.get('mot')}`);
  assert.deepEqual(r.drivers.get('drv'), { powered: true, ch: ['fwd', ''] });
  assert.ok(motorRpm(r.motorVolts.get('mot')) > 250);
  r = run({ 8: 'L', 9: 'H' });
  assert.ok(r.motorVolts.get('mot') < -6, 'reverse');
  r = run({ 8: 'H', 9: 'H' });
  assert.ok(Math.abs(r.motorVolts.get('mot')) < 0.01, 'brake');
  // speed control on ENA (pin 10, analogWrite 50 %)
  c = compile(motorRig([wire('w8', 'uno-1', '10', 'drv', 'ENA')]));
  r = run({ 8: 'H', 9: 'L', 10: 'P' }, new Map([['10', 0.5]]));
  const half = r.motorVolts.get('mot');
  assert.ok(half > 3 && half < 4.6, `half speed: ${half}`);
  r = run({ 8: 'H', 9: 'L', 10: 'L' });
  assert.ok(Math.abs(r.motorVolts.get('mot')) < 0.01, 'ENA LOW: disabled');
  // no battery
  c = compile({ ...motorRig(), wires: motorRig().wires.filter(w => !['w5', 'w6'].includes(w.id)) });
  r = run({ 8: 'H', 9: 'L' });
  assert.ok(r.warnings.some(w => /no motor power/.test(w.text)));
});

test('DC motor straight on an Arduino pin is flagged (and overloads the pin)', () => {
  const c = compile({ parts: [{ id: 'uno-1', type: 'arduino-uno', x: 0, y: 0, rot: 0 }, { id: 'mot', type: 'dc-motor', x: 700, y: 0, rot: 0 }], wires: [wire('a', 'uno-1', '9', 'mot', '1'), wire('b', 'mot', '2', 'uno-1', 'GND.1')] });
  assert.ok(c.issues.some(i => /straight to D9/.test(i.text)));
  const r = solveDrive(c, { pins: new Map([['9', 'H']]), pressed: new Set(), duty: new Map() });
  assert.ok(r.warnings.some(w => /D9 is sourcing/.test(w.text)));
});
