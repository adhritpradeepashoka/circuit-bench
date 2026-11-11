// UNO Q / VENTUNO Q on the AVR emulation: the board specs, the compile-time conversion, and the matrix + 3.3 V ADC the emulator answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BOARD_SPECS } from '../src/core/boards.js';
import { UNOQ_COMPAT_H, UNOQ_HEADER_NAME, UNOQ_REG, unoqSource, UNOQ_FQBN, VENTUNO_FQBN } from '../src/core/unoq-compat.js';
import { BOARDS, normaliseRequest } from '../server/compile-service.mjs';
import { UnoQMcu } from '../src/sim/uno-q-mcu.js';
import { decodeFrame } from '../src/core/matrix.js';

test('both boards are runnable specs: 3.3 V logic, 14-bit ADC, the matrix, a Linux side, compile target registered', () => {
  for (const [type, fqbn] of [['arduino-uno-q', UNOQ_FQBN], ['arduino-ventuno-q', VENTUNO_FQBN]]) {
    const s = BOARD_SPECS[type];
    assert.equal(s.fqbn, fqbn); assert.equal(s.logic, 3.3); assert.equal(s.adcBits, 14); assert.equal(s.emulation, 'uno-q'); assert.ok(s.matrix && s.linux);
    assert.ok(BOARDS[fqbn]?.compat && BOARDS[fqbn].unoq, 'the compile service builds it');
    assert.doesNotThrow(() => normaliseRequest({ sketch: 'void setup(){} void loop(){}', fqbn }));
  }
});

test('the conversion drops the library includes (the header supplies them) and keeps the user\'s line numbers', () => {
  const src = '#include <Arduino_LED_Matrix.h>\n#include <Arduino_RouterBridge.h>\nArduino_LED_Matrix matrix;\nvoid setup() { Monitor.begin(); matrix.begin(); }\nvoid loop() {}\n';
  const out = unoqSource(src);
  assert.match(out, new RegExp(`^#include "${UNOQ_HEADER_NAME}"\\n#line 1 "sketch.ino"\\n// #include <Arduino_LED_Matrix.h>\\n// #include <Arduino_RouterBridge.h>\\nArduino_LED_Matrix matrix;`));
  for (const w of ['class Arduino_LED_Matrix', 'loadFrame', 'renderBitmap', 'class CbBridge', '#define Monitor Serial']) assert.ok(UNOQ_COMPAT_H.includes(w), w);
});

test('a real AVR program that draws two matrix bytes lights those LEDs, and reads A0 against 3.3 V', () => {
  const hex = readFileSync(new URL('./fixtures/unoq-matrix.hex', import.meta.url), 'utf8');
  const mcu = new UnoQMcu(hex);
  mcu.adc.channelValues[0] = 3.0;                               // 3.0 V on A0: 91 % of 3.3 V (it would be only 60 % of a 5 V supply)
  mcu.run(20000);
  const bits = decodeFrame(mcu.matrixHex);
  assert.equal(mcu.matrixHex, 'a5' + '00'.repeat(11) + '81');
  assert.deepEqual(bits.slice(0, 8), [1, 0, 1, 0, 0, 1, 0, 1]);
  assert.deepEqual(bits.slice(96, 104), [1, 0, 0, 0, 0, 0, 0, 1]);
  assert.ok(mcu.adcSample > 14000 && mcu.adcSample < 15500, `14-bit sample against 3.3 V: ${mcu.adcSample}`);
  assert.equal(UNOQ_REG.matrixIndex, 0xE0);
});
