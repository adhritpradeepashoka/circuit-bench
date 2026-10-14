// REAL Arduino firmware (built by Arduino CLI + avr-gcc + the official Arduino AVR core) running on the simulated ATmega328P.
// The hex files come from test/fixtures/firmware.json, produced by `npm run build-firmware` — no toolchain needed to run these.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Mcu, CPU_HZ } from '../src/sim/mcu.js';
import { PREBUILT } from '../src/sim/prebuilt.generated.js';
import { EXAMPLES, DEFAULT_SKETCH } from '../src/sim/examples.js';

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/firmware.json', import.meta.url)), 'utf8'));
const fw = name => { const f = fixtures.sketches[name]; assert.ok(f, `fixture ${name}`); return f; };
const boot = name => { assert.ok(fw(name).result.ok, `${name} built`); const mcu = new Mcu(fw(name).result.hex); const out = []; mcu.onSerial = b => out.push(b); return { mcu, text: () => Buffer.from(out).toString('latin1') }; };
const sec = (mcu, s) => mcu.run(Math.round(s * CPU_HZ));
const PB5 = { port: 'B', bit: 5 };

/** Run in small steps and collect the time (s) of every pin change. */
function edges(mcu, pin, seconds, step = 5000) {
  const out = []; let last = mcu.pinMode(pin);
  const end = mcu.cpu.cycles + seconds * CPU_HZ;
  while (mcu.cpu.cycles < end) { mcu.run(step); const s = mcu.pinMode(pin); if (s !== last) { out.push([mcu.seconds, s]); last = s; } }
  return out;
}

test('every fixture sketch was built by the real toolchain (and the broken one really fails)', () => {
  assert.match(fixtures.arduinoCli, /^\d+\.\d+\.\d+/);
  for (const [name, f] of Object.entries(fixtures.sketches)) if (name !== 'broken') assert.ok(f.result.ok && f.result.hex.startsWith(':'), name);
  const broken = fw('broken').result;
  assert.equal(broken.ok, false);
  assert.ok(broken.diagnostics.some(d => d.severity === 'error' && d.line === 3 && d.file === 'sketch.ino'), JSON.stringify(broken.diagnostics));
  assert.match(broken.output, /expected ';' before 'undefinedThing'/);
});

test('Blink: delay(500) toggles LED_BUILTIN every 500 ms through the real Timer0 interrupt clock', () => {
  const { mcu } = boot('blink');
  const e = edges(mcu, PB5, 2.6);
  assert.deepEqual(e.map(x => x[1]), ['H', 'L', 'H', 'L', 'H', 'L']);
  for (let i = 1; i < e.length; i++) assert.ok(Math.abs(e[i][0] - e[i - 1][0] - 0.5) < 0.004, `interval ${i}: ${e[i][0] - e[i - 1][0]}`);
});

test('millis(): a non-blocking 250 ms blink keeps time (Timer0 overflow interrupts)', () => {
  const { mcu } = boot('millis-blink');
  const e = edges(mcu, PB5, 1.6);
  assert.ok(e.length >= 6, `edges: ${e.length}`);
  for (let i = 1; i < e.length; i++) assert.ok(Math.abs(e[i][0] - e[i - 1][0] - 0.25) < 0.003, `interval ${i}: ${e[i][0] - e[i - 1][0]}`);
});

test('Serial TX: the real HardwareSerial ring buffer drains through the USART at the baud rate the firmware chose', () => {
  const { mcu, text } = boot('serial-echo');
  sec(mcu, 0.005);
  assert.ok(Math.abs(mcu.baud - 9600) < 50, `UBRR0 written by Serial.begin(9600) → ${mcu.baud} baud (the Arduino core uses double-speed mode, so real hardware is 9615 too)`);
  assert.ok(text().length < 19, 'not everything has been sent after 5 ms — the UART is paced at 9600 baud');
  sec(mcu, 0.05);
  assert.equal(text(), 'Hello from Arduino\r\n');
});

test('Serial RX: bytes typed into the monitor reach Serial.read() (echoed in upper case)', () => {
  const { mcu, text } = boot('serial-echo');
  sec(mcu, 0.05);
  mcu.serialWrite('Hello, world 42!');
  sec(mcu, 0.3);
  assert.equal(text(), 'Hello from Arduino\r\nHELLO, WORLD 42!');
});

test('real C++: float, long, classes, structs, String and millis() all work', () => {
  const { mcu, text } = boot('real-cpp');
  sec(mcu, 0.4);
  assert.equal(text(), '1.4142\r\n300000\r\n25\r\nABC42\r\nearly\r\n');
});

test('analogRead → Serial.print: the real ADC driver reads the volts we feed it, and map() is Arduino’s own', () => {
  const { mcu, text } = boot('analog-print');
  mcu.setAnalog(0, 2.5); sec(mcu, 0.35);
  assert.match(text(), /A0=512 127\r\n/);
  const before = text().length;
  mcu.setAnalog(0, 5); sec(mcu, 0.35);
  assert.match(text().slice(before), /A0=1023 255\r\n/);
  mcu.setAnalog(0, 0); sec(mcu, 0.35);
  assert.match(text(), /A0=0 0\r\n/);
});

test('analogWrite: the real core programs the timers; duty is read from OCRx; 0 and 255 become steady levels', () => {
  const { mcu } = boot('pwm');
  sec(mcu, 0.02);
  assert.ok(Math.abs(mcu.pwmDuty(9) - 128 / 255) < 1e-9);
  assert.ok(Math.abs(mcu.pwmDuty(6) - 64 / 255) < 1e-9);
  assert.equal(mcu.pwmDuty(3), null); assert.equal(mcu.pinMode({ port: 'D', bit: 3 }), 'H');
  assert.equal(mcu.pwmDuty(5), null); assert.equal(mcu.pinMode({ port: 'D', bit: 5 }), 'L');
});

test('INPUT_PULLUP + digitalRead follows the outside world', () => {
  const { mcu } = boot('button-led');
  mcu.setInput({ port: 'D', bit: 2 }, true); sec(mcu, 0.01); assert.equal(mcu.pinMode(PB5), 'L');
  mcu.setInput({ port: 'D', bit: 2 }, false); sec(mcu, 0.01); assert.equal(mcu.pinMode(PB5), 'H');
  mcu.setInput({ port: 'D', bit: 2 }, true); sec(mcu, 0.01); assert.equal(mcu.pinMode(PB5), 'L');
});

test('digitalWrite lands on the right port/bit for pins from every port', () => {
  const { mcu } = boot('seg-rgb');
  sec(mcu, 0.02);
  const high = [[2, 'D', 2], [3, 'D', 3], [4, 'D', 4], [5, 'D', 5], [8, 'B', 0], [14, 'C', 0], [16, 'C', 2]];
  for (const [, port, bit] of high) assert.equal(mcu.pinMode({ port, bit }), 'H', `${port}${bit}`);
  for (const [port, bit] of [['D', 6], ['D', 7], ['B', 1], ['C', 1]]) assert.equal(mcu.pinMode({ port, bit }), 'L', `${port}${bit}`);
});

test('the bundled example sketches ship with real prebuilt firmware that boots', () => {
  assert.ok(PREBUILT[DEFAULT_SKETCH], 'default sketch is prebuilt');
  for (const [id, ex] of Object.entries(EXAMPLES)) {
    const p = PREBUILT[ex.code];
    assert.ok(p && p.hex.startsWith(':') && p.size.flash > 500, `${id} prebuilt`);
    const mcu = new Mcu(p.hex); sec(mcu, 0.05);      // boots and runs without faulting
    assert.ok(mcu.cpu.cycles >= 0.05 * CPU_HZ);
  }
  const { mcu } = { mcu: new Mcu(PREBUILT[DEFAULT_SKETCH].hex) };
  const e = edges(mcu, PB5, 1.1);
  assert.deepEqual(e.map(x => x[1]), ['H', 'L', 'H'], 'the default example blinks D13');
});

test('Mcu refuses to run without firmware (no hidden default program)', () => {
  assert.throws(() => new Mcu(), /needs Intel HEX/);
  assert.throws(() => new Mcu(''), /needs Intel HEX/);
});
