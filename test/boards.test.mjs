// Nano + Mega: real firmware (built for each board by the real toolchain) on the right chip config.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Mcu, CPU_HZ, parseIntelHex } from '../src/sim/mcu.js';
import { Mpu6050 } from '../src/parts/mpu6050.js';
import { BOARD_SPECS, mainBoard } from '../src/core/boards.js';
import { compile } from '../src/core/netlist.js';
import { i2cParts } from '../src/core/i2c.js';
import { PART_DEFS } from '../src/core/parts.js';
import { compileSketch } from '../src/sim/compile-client.js';

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/firmware.json', import.meta.url)), 'utf8'));
const boot = (name, chip) => {
  const f = fixtures.sketches[name]; assert.ok(f?.result.ok, `${name} built`);
  const mcu = new Mcu(f.result.hex, chip), out = [];
  mcu.onSerial = b => out.push(b);
  return { mcu, f, text: () => Buffer.from(out).toString('latin1') };
};
function edges(mcu, pin, seconds, step = 4000) {
  const out = []; let last = mcu.pinMode(pin); const end = mcu.cpu.cycles + seconds * CPU_HZ;
  while (mcu.cpu.cycles < end) { mcu.run(step); const s = mcu.pinMode(pin); if (s !== last) { out.push([mcu.seconds, s]); last = s; } }
  return out;
}

test('fixtures were built for the right board', () => {
  assert.equal(fixtures.sketches['mega-tour'].fqbn, 'arduino:avr:mega');
  assert.equal(fixtures.sketches['nano-analog'].fqbn, 'arduino:avr:nano');
  assert.equal(fixtures.sketches.blink.fqbn, 'arduino:avr:uno');
});

test('Mega 2560: delay()/millis() keep real time (Timer0 on its own vector), LED_BUILTIN is PB7, Serial works (USART0 vectors), D40 drives PORTG', () => {
  const { mcu, text } = boot('mega-tour', 'atmega2560');
  const spec = BOARD_SPECS['arduino-mega'];
  mcu.i2c.setDevices(new Map([[0x68, new Mpu6050()]]));
  mcu.setAnalog(8, 2.5);
  const e = edges(mcu, spec.pins['13'], 1.6).slice(1);   // drop setup's pinMode(OUTPUT) step (input → LOW)
  assert.ok(e.length >= 5, `LED toggles (${e.length} edges)`);
  for (let i = 1; i < e.length; i++) assert.ok(Math.abs(e[i][0] - e[i - 1][0] - 0.25) < 0.004, `250 ms apart: ${e[i][0] - e[i - 1][0]}`);
  assert.match(text(), /ack:0\r?\n/, 'I²C on pins 20/21 reaches the device (TWI vector)');
  assert.match(text(), /a8:51[12]\r?\n/, 'analogRead(A8) uses MUX5 → ADC channel 8');
  const ts = [...text().matchAll(/t:(\d+)/g)].map(m => +m[1]);
  assert.ok(ts.length >= 2 && Math.abs(ts[1] - ts[0] - 500) <= 2, `millis() advances 500 per loop (${ts})`);
  assert.equal(mcu.pinMode(spec.pins['40']), 'H');
  assert.ok(Math.abs(mcu.pwmDuty(44) - 64 / 255) < 0.01, `Timer5 PWM on D44: ${mcu.pwmDuty(44)}`);
});

test('Nano: same chip as the Uno; A6/A7 are analog-only inputs that analogRead sees', () => {
  const { mcu, text } = boot('nano-analog', 'atmega328p');
  const spec = BOARD_SPECS['arduino-nano'];
  mcu.setAnalog(spec.pins.A6.adc, 1.25); mcu.setAnalog(spec.pins.A7.adc, 5);
  mcu.run(0.3 * CPU_HZ);
  assert.match(text(), /a6:25[56] a7:1023/);
  assert.equal(mcu.pinMode(spec.pins.A6), 'Z', 'no digital port behind A6');
});

test('Intel HEX: extended linear address records place code above 64 KB', () => {
  const hex = ':020000040001F9\n:0400000001020304F2\n:00000001FF';
  const bytes = parseIntelHex(hex, 0x40000);
  assert.deepEqual([...bytes.slice(0x10000, 0x10004)], [1, 2, 3, 4]);
});

test('boards: the first microcontroller board in a circuit is the one that runs', () => {
  assert.equal(mainBoard([{ type: 'breadboard' }, { id: 'm', type: 'arduino-mega' }, { id: 'u', type: 'arduino-uno' }]).id, 'm');
  assert.equal(mainBoard([{ type: 'led' }]), null);
});

const wire = (id, a, ap, b, bp) => ({ id, a: { part: a, pin: ap }, b: { part: b, pin: bp }, style: 'straight', color: '#000', width: 2 });

test('netlist: a Mega’s pins, power and I²C bus (D20/D21) come from its board spec; a second board is flagged, not run', () => {
  const parts = [{ id: 'mega-1', type: 'arduino-mega', x: 0, y: 0, rot: 0 }, { id: 'm', type: 'mpu6050', x: 600, y: 0, rot: 0 }];
  const wires = [wire('w1', 'mega-1', '20', 'm', 'SDA'), wire('w2', 'mega-1', '21', 'm', 'SCL'), wire('w3', 'mega-1', '5V', 'm', 'VCC'), wire('w4', 'mega-1', 'GND.2', 'm', 'GND')];
  const c = compile({ parts, wires });
  assert.equal(c.uno.spec.chip, 'atmega2560');
  assert.deepEqual(c.uno.pins.find(p => p.name === 'A12'), { ...c.uno.pins.find(p => p.name === 'A12'), port: 'K', bit: 4, adc: 12 });
  assert.equal(c.uno.pins.find(p => p.name === '53').port, 'B');
  const [d] = i2cParts(c, parts);
  assert.ok(d.attached, d.problems.join('; '));
  // Uno-style A4/A5 wiring on a Mega is explained in the Mega's own pin names
  const [bad] = i2cParts(compile({ parts, wires: [wire('w1', 'mega-1', 'A4', 'm', 'SDA'), ...wires.slice(1)] }), parts);
  assert.match(bad.problems.join(), /not connected to D20 \(SDA\)/);
  const two = compile({ parts: [...parts, { id: 'uno-1', type: 'arduino-uno', x: 0, y: 400, rot: 0 }], wires });
  assert.ok(two.issues.some(i => i.partId === 'uno-1' && /Only one microcontroller/.test(i.text)));
});

test('netlist: a Nano plugs into the breadboard; its A6/A7 are analog-only pins, ICSP header pins never seat in holes', () => {
  const nano = PART_DEFS['arduino-nano'];
  assert.ok(nano.insertable && nano.pins.some(p => p.noInsert), 'ICSP pins are marked');
  const c = compile({ parts: [{ id: 'nano-1', type: 'arduino-nano', x: 0, y: 0, rot: 0 }], wires: [] });
  const a6 = c.uno.pins.find(p => p.name === 'A6');
  assert.equal(a6.adc, 6); assert.equal(a6.port, undefined);
  assert.equal(c.uno.spec.fqbn, 'arduino:avr:nano');
});

test('compile client: sends the board fqbn; prebuilt Uno firmware is reused for the Nano (same chip) but never for the Mega', async () => {
  const sent = [];
  const fetchImpl = async (_u, o) => { sent.push(JSON.parse(o.body)); return { status: 200, json: async () => ({ ok: true, hex: ':00000001FF', diagnostics: [] }) }; };
  const prebuilt = { 'void setup(){}\nvoid loop(){}\n': { hex: 'PRE', size: {}, output: '' } };
  const src = 'void setup(){}\nvoid loop(){}\n';
  assert.equal((await compileSketch(src, { fetchImpl, endpoint: '/x', prebuilt, fqbn: 'arduino:avr:nano' })).hex, 'PRE');
  const mega = await compileSketch(src, { fetchImpl, endpoint: '/x', prebuilt, fqbn: 'arduino:avr:mega' });
  assert.equal(mega.fqbn, 'arduino:avr:mega'); assert.equal(sent[0].fqbn, 'arduino:avr:mega');
});
