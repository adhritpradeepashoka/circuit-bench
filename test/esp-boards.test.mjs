import test from 'node:test';
import assert from 'node:assert/strict';
import { espSource, espCompatHeader, XIAO_S3, xiaoSpecPins, ESP_HEADER_NAME } from '../src/core/esp-boards.js';
import { BOARD_SPECS } from '../src/core/boards.js';
import { PART_DEFS } from '../src/core/parts.js';

test('XIAO ESP32-S3: every pad on the drawing is a pin on the emulated chip, and nothing is mapped twice', () => {
  const spec = BOARD_SPECS['xiao-esp32s3'], def = PART_DEFS['xiao-esp32s3'];
  assert.equal(def.pins.length, 14);
  for (const p of def.pins) if (!/^(5V|GND|3V3)$/.test(p.id)) assert.ok(spec.pins[p.id], `${p.id} has no emulated pin`);
  const used = Object.values(xiaoSpecPins()).map(p => `${p.port}${p.bit}`);
  assert.equal(new Set(used).size, used.length);
  assert.equal(spec.logic, 3.3); assert.equal(spec.adcBits, 12);
  assert.deepEqual(spec.i2c, { sda: 'D4', scl: 'D5' });
  assert.ok(spec.pins.D4.adc === 4 && spec.pins.D5.adc === 5);                 // D4 / D5 are the AVR's I²C pins (PC4 / PC5)
  for (const id of spec.pwm) assert.ok(spec.pins[id] && !spec.pins[id].adc);
  assert.deepEqual(spec.pwm, ['D8', 'D9', 'D10']); assert.deepEqual(spec.uarts, [{ name: 'Serial1', tx: 'D6', rx: 'D7' }]);
  assert.equal(spec.fqbn, 'cb:xiao-esp32s3'); assert.ok(spec.ledActiveLow);
});

test('XIAO ESP32-S3: the pads sit where the real board has them (USB at the top, left D0-D6, right 5V GND 3V3 D10 D9 D8 D7)', () => {
  const def = PART_DEFS['xiao-esp32s3'], by = Object.fromEntries(def.pins.map(p => [p.id, p]));
  assert.ok(Math.abs(by['5V'].x - by.D0.x - 6 * 2.54 * 96 / 25.4) < 0.1);       // the rows are 15.24 mm apart
  assert.ok(by.D1.y > by.D0.y && by.D6.y > by.D5.y && by.D7.y > by.D8.y);
  assert.ok(Math.abs(by.D0.y - by['5V'].y) < 0.01 && Math.abs(by.D6.y - by.D7.y) < 0.01);
  assert.ok(Math.abs(by.D1.y - by.D0.y - 2.54 * 96 / 25.4) < 0.1);             // 2.54 mm pitch
});

test('XIAO ESP32-S3: the conversion keeps line numbers, drops ESP-only includes and fixes ESP-only calls', () => {
  const src = espSource('#include <ESP32Servo.h>\n#include <Wire.h>\nvoid setup(){ Wire.begin(5, 6); Serial.printf("%d\\n", 3); }\nvoid loop(){}');
  assert.ok(src.startsWith(`#include "${ESP_HEADER_NAME}"\n#line 1 "sketch.ino"\n// #include <ESP32Servo.h>\n#include <Wire.h>`));
  assert.ok(src.includes('Wire.begin();') && src.includes('cb_printf("%d\\n", 3)'));
  const h = espCompatHeader();
  for (const p of XIAO_S3.pads) assert.ok(h.includes(`#define ${p.id} ${p.gpio}`) && h.includes(`case ${p.gpio}: return`), p.id);
  assert.ok(h.includes('#define LED_BUILTIN 21') && h.includes('cb_read_bits = 12') && h.includes('ledcWrite') && h.includes('class CbServo'));
});
