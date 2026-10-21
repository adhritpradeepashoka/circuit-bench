// I²C: real Arduino firmware (Wire, Adafruit_MPU6050, Adafruit_SSD1306 — built by the real toolchain into
// test/fixtures/firmware.json) running on the simulated ATmega328P against the MPU-6050 and SSD1306 models,
// plus the wiring check that decides which parts are on the bus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Mcu, CPU_HZ } from '../src/sim/mcu.js';
import { Mpu6050, gravityInBody, bodyRates } from '../src/parts/mpu6050.js';
import { Ssd1306 } from '../src/parts/ssd1306.js';
import { i2cParts } from '../src/core/i2c.js';
import { compile } from '../src/core/netlist.js';

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/firmware.json', import.meta.url)), 'utf8'));
function boot(name, devices) {
  const f = fixtures.sketches[name]; assert.ok(f?.result.ok, `${name} built`);
  const mcu = new Mcu(f.result.hex), out = [];
  mcu.onSerial = b => out.push(b);
  mcu.i2c.setDevices(new Map(devices));
  return { mcu, text: () => Buffer.from(out).toString('latin1'), run: s => mcu.run(Math.round(s * CPU_HZ)) };
}
const lastLine = (text, prefix) => text.split(/\r?\n/).filter(l => l.startsWith(prefix)).pop();

test('MPU-6050 model: gravity follows the tilt; yaw does not change it; rates map Euler motion into the body frame', () => {
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
  let g = gravityInBody(0, 0); close(g.x, 0); close(g.y, 0); close(g.z, 1);
  g = gravityInBody(90, 0); close(g.y, 1); close(g.z, 0);                // on its right side
  g = gravityInBody(0, 90); close(g.x, -1);                              // nose up
  g = gravityInBody(180, 0); close(g.z, -1);                             // upside down
  const w = bodyRates({ roll: 0, pitch: 0 }, { droll: 10, dpitch: 20, dyaw: 30 });
  close(w.x, 10); close(w.y, 20); close(w.z, 30);
});

test('MPU-6050 registers: WHO_AM_I, asleep after power-up (zeros), DEVICE_RESET, ranges scale the counts', () => {
  const m = new Mpu6050();
  assert.equal(m.readRegister(0x75), 0x68);
  assert.equal(m.asleep, true);
  assert.equal(m.readRegister(0x3f), 0, 'asleep: data registers stay 0');
  m.writeRegister(0x6b, 0);
  const z = () => ((m.readRegister(0x3f) << 8) | m.readRegister(0x40)) << 16 >> 16;
  assert.equal(z(), 16384, '±2 g: 1 g = 16384');
  m.writeRegister(0x1c, 3 << 3);
  assert.equal(z(), 2048, '±16 g: 1 g = 2048');
  m.setPose({ roll: 0, pitch: 0, yaw: 0, temp: 36.53 }, 0);
  assert.equal((m.readRegister(0x41) << 8 | m.readRegister(0x42)) << 16 >> 16, 0, 'temp register: 36.53 °C reads 0');
  m.writeRegister(0x6b, 0x80);
  assert.equal(m.asleep, true, 'reset puts it back to sleep');
  assert.equal(m.regs[0x1c], 0);
});

test('MPU-6050 gyro: turning the board shows up as rotation rate, and settles back to 0 when you stop', () => {
  const m = new Mpu6050(); m.writeRegister(0x6b, 0);
  for (let i = 0; i <= 20; i++) m.setPose({ yaw: i * 3 }, i * 0.02);   // 3° per 20 ms = 150 °/s about Z
  assert.ok(Math.abs(m.readings().gyro.z - 150) < 5, `gyro z ${m.readings().gyro.z}`);
  for (let i = 21; i <= 60; i++) m.setPose({ yaw: 60 }, i * 0.02);
  assert.ok(Math.abs(m.readings().gyro.z) < 1, `settled ${m.readings().gyro.z}`);
});

test('firmware: raw Wire code finds the MPU-6050 (ACK, WHO_AM_I 68) and reads +1 g on Z lying flat, then gravity moves as it tilts', () => {
  const mpu = new Mpu6050();
  const { text, run } = boot('i2c-mpu-raw', [[0x68, mpu]]);
  run(0.35);
  assert.match(text(), /ack:0\r?\n/);
  assert.match(text(), /who:68\r?\n/);
  assert.equal(lastLine(text(), 'a:'), 'a:0,0,16384');
  mpu.setPose({ roll: 90, pitch: 0, yaw: 0 }, 1);                      // onto its side: gravity moves from Z to Y
  run(0.25);
  assert.equal(lastLine(text(), 'a:'), 'a:0,16384,0');
});

test('firmware: with nothing at 0x68, endTransmission reports a NACK (2) — exactly what a miswired sensor does', () => {
  const { text, run } = boot('i2c-mpu-raw', []);
  run(0.2);
  assert.match(text(), /ack:2\r?\n/);
});

test('firmware: Adafruit_MPU6050 begin() succeeds and getEvent() reports gravity in m/s² and the temperature', () => {
  const mpu = new Mpu6050(); mpu.setPose({ roll: 0, pitch: 0, yaw: 0, temp: 31 }, 0);
  const { text, run } = boot('i2c-mpu-adafruit', [[0x68, mpu]]);
  run(0.6);
  assert.match(text(), /mpu ok/);
  assert.match(lastLine(text(), 'z:'), /^z:9\.8 x:0\.0 t:31$/);
  mpu.setPose({ roll: 0, pitch: 90, yaw: 0, temp: 31 }, 1);            // nose up: X sees -1 g
  run(0.3);
  assert.match(lastLine(text(), 'z:'), /^z:0\.0 x:-9\.8 t:31$/);
});

test('firmware: Adafruit_MPU6050 says "no mpu" when the sensor is not on the bus', () => {
  const { text, run } = boot('i2c-mpu-adafruit', []);
  run(0.4);
  assert.match(text(), /no mpu/);
});

test('firmware: Adafruit_SSD1306 draws into the OLED — the 10×10 block lands top-left and the pixel bottom-right, not mirrored', () => {
  const oled = new Ssd1306();
  const { text, run } = boot('i2c-oled', [[0x3c, oled]]);
  run(1.2);
  assert.match(text(), /drawn/);
  assert.equal(oled.on, true);
  for (const [x, y] of [[0, 0], [9, 9], [5, 2]]) assert.equal(oled.pixel(x, y), true, `(${x},${y}) lit`);
  for (const [x, y] of [[10, 10], [64, 32], [127, 0], [0, 63]]) assert.equal(oled.pixel(x, y), false, `(${x},${y}) dark`);
  assert.equal(oled.pixel(127, 63), true);
  assert.equal(oled.summary().litPixels, 101);
});

test('SSD1306 model: command arguments, addressing modes, Co bit, invert', () => {
  const o = new Ssd1306();
  const send = (ctrl, ...bytes) => { o.start(); o.connect(true); o.write(ctrl); for (const b of bytes) o.write(b); };
  send(0x00, 0x8d, 0x14, 0xa1, 0xc8, 0x20, 0x00, 0x21, 0, 127, 0x22, 0, 7, 0xaf);
  assert.equal(o.on, true); assert.equal(o.mode, 0); assert.equal(o.chargePump, true);
  send(0x40, 0x01);                                   // one byte of data at (col 0, page 0): bit 0 = row 0
  assert.equal(o.pixel(0, 0), true);
  assert.equal(o.pixel(1, 0), false);
  send(0x80, 0xa7);                                   // Co=1: single command byte → invert
  assert.equal(o.invert, true); assert.equal(o.pixel(0, 0), false); assert.equal(o.pixel(1, 0), true);
});

// ── wiring: which parts are on the bus ──
const uno = { id: 'uno-1', type: 'arduino-uno', x: 0, y: 0, rot: 0 };
const wire = (id, a, ap, b, bp) => ({ id, a: { part: a, pin: ap }, b: { part: b, pin: bp }, style: 'straight', color: '#000', width: 2 });
const mpuWires = [wire('w1', 'uno-1', 'A4', 'm', 'SDA'), wire('w2', 'uno-1', 'A5', 'm', 'SCL'), wire('w3', 'uno-1', '5V', 'm', 'VCC'), wire('w4', 'uno-1', 'GND.1', 'm', 'GND')];

test('wiring: a properly wired MPU-6050 is on the bus at 0x68; AD0 to 5V moves it to 0x69', () => {
  const parts = [uno, { id: 'm', type: 'mpu6050', x: 400, y: 0, rot: 0 }];
  let [d] = i2cParts(compile({ parts, wires: mpuWires }), parts);
  assert.equal(d.attached, true); assert.equal(d.address, 0x68); assert.deepEqual(d.problems, []);
  [d] = i2cParts(compile({ parts, wires: [...mpuWires, wire('w5', 'uno-1', '5V', 'm', 'AD0')] }), parts);
  assert.equal(d.address, 0x69);
});

test('wiring: each missing connection is named, and the header SDA/SCL pins count the same as A4/A5', () => {
  const parts = [uno, { id: 'm', type: 'mpu6050', x: 400, y: 0, rot: 0 }];
  const [d] = i2cParts(compile({ parts, wires: [mpuWires[0], mpuWires[3]] }), parts);
  assert.equal(d.attached, false);
  assert.ok(d.problems.some(p => /SCL is not connected to A5/.test(p)));
  assert.ok(d.problems.some(p => /VCC has no power/.test(p)));
  const header = [wire('w1', 'uno-1', 'A4.2', 'm', 'SDA'), wire('w2', 'uno-1', 'A5.2', 'm', 'SCL'), mpuWires[2], mpuWires[3]];
  assert.equal(i2cParts(compile({ parts, wires: header }), parts)[0].attached, true);
});

test('wiring: two devices on the same address are both flagged, not silently merged', () => {
  const parts = [uno, { id: 'm', type: 'mpu6050', x: 400, y: 0, rot: 0 }, { id: 'n', type: 'mpu6050', x: 400, y: 200, rot: 0 }];
  const w2 = mpuWires.map((w, i) => ({ ...w, id: `x${i}`, b: { ...w.b, part: 'n' } }));
  const ds = i2cParts(compile({ parts, wires: [...mpuWires, ...w2] }), parts);
  assert.ok(ds.every(d => !d.attached && d.problems.some(p => /shares address 0x68/.test(p))));
});
