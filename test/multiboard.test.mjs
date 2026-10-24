// Several boards on one bench: the chip layer's UART hooks, with real firmware on both ends of a serial link.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Mcu, CPU_HZ } from '../src/sim/mcu.js';
import { BOARD_SPECS } from '../src/core/boards.js';
import { compile } from '../src/core/netlist.js';
import { Rp2040Mcu } from '../src/sim/rp2040-mcu.js';

const picoFx = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/pico-firmware.json', import.meta.url)), 'utf8'));

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/firmware.json', import.meta.url)), 'utf8'));
const hexOf = name => { const f = fixtures.sketches[name]; assert.ok(f?.result.ok, `${name} built`); return f.result.hex; };
const wire = (id, a, ap, b, bp) => ({ id, a: { part: a, pin: ap }, b: { part: b, pin: bp }, style: 'straight', color: '#000', width: 2 });

/** Run two chips side by side, handing every byte board A's UART `ua` sends to board B's UART `ub` (and back). */
function pair(a, b, { ua = 0, ub = 0, both = false } = {}) {
  const heard = { a: [], b: [] };
  a.attachSerial(x => heard.a.push(x), (i, byte) => { if (i === ua) b.uartWrite(ub, byte); });
  b.attachSerial(x => heard.b.push(x), (i, byte) => { if (both && i === ub) a.uartWrite(ua, byte); });
  return { heard, run(seconds) { const end = seconds * CPU_HZ, step = 4000; for (let t = 0; t < end; t += step) { a.run(step); b.run(step); } } };
}

test('two Unos: board A’s Serial.print arrives at board B’s Serial.read, and B reacts to it', () => {
  const a = new Mcu(hexOf('link-sender')), b = new Mcu(hexOf('link-receiver'));
  const { run } = pair(a, b);
  const led = () => b.pinMode({ port: 'B', bit: 5 });
  assert.equal(led(), 'Z', 'before anything is heard B’s pin is still an input');
  run(1);
  assert.equal(led(), 'H', 'B saw a "msg:" line and lit D13');
  assert.equal(a.uartActive(0), true); assert.equal(b.uartActive(0), true);
  assert.ok(Math.abs(a.uartBaud(0) - 9600) < 100 && Math.abs(b.uartBaud(0) - 9600) < 100, `baud rates: ${a.uartBaud(0)}, ${b.uartBaud(0)}`);
});

test('a board that never calls Serial.begin has no active UART', () => {
  const m = new Mcu(hexOf('blink')); m.run(0.1 * CPU_HZ);
  assert.equal(m.uartActive(0), false);
});

test('the Mega’s Serial1–Serial3 UARTs exist and Serial1 works (USART1 registers + vectors)', () => {
  const mega = new Mcu(hexOf('mega-serial1'), 'atmega2560'), got = [];
  mega.attachSerial(() => {}, (i, byte) => { if (i === 1) got.push(byte); });
  mega.run(0.05 * CPU_HZ);
  assert.deepEqual(mega.usarts.length, 4);
  assert.equal(mega.uartActive(1), true); assert.equal(mega.uartActive(2), false);
  for (const c of 'abc') mega.uartWrite(1, c.charCodeAt(0));
  mega.run(0.1 * CPU_HZ);
  assert.equal(String.fromCharCode(...got), 'ABC', 'bytes in on RX1 come back out of TX1');
});

test('board specs: every board says which pins its UARTs use, and they are real pins', () => {
  for (const [id, spec] of Object.entries(BOARD_SPECS)) {
    assert.ok(spec.uarts?.length, `${id} has uarts`);
    for (const u of spec.uarts) { assert.ok(spec.pins[u.tx] && spec.pins[u.rx], `${id} ${u.name}: pins ${u.tx}/${u.rx} exist`); }
  }
  assert.deepEqual(BOARD_SPECS['arduino-mega'].uarts.map(u => u.tx), ['1', '18', '16', '14']);
});

test('netlist: two boards wired TX→RX share a net; the second board’s pins are keyed by its part', () => {
  const parts = [{ id: 'uno-1', type: 'arduino-uno', x: 0, y: 0, rot: 0 }, { id: 'uno-2', type: 'arduino-uno', x: 500, y: 0, rot: 0 }];
  const c = compile({ parts, wires: [wire('w1', 'uno-1', '1', 'uno-2', '0'), wire('w2', 'uno-1', 'GND.1', 'uno-2', 'GND.1')] });
  const tx = c.boards[0].pins.find(p => p.name === '1'), rx = c.boards[1].pins.find(p => p.name === '0');
  assert.equal(tx.key, '1'); assert.equal(rx.key, 'uno-2/0');
  assert.equal(c.netOf?.(tx) ?? c.netOf?.('1'), c.netOf?.(rx) ?? c.netOf?.('uno-2/0'));
});

test('Pico: Serial1 (UART0) is a link UART — it sends, receives, reports its baud — and USB Serial is not', () => {
  const pico = new Rp2040Mcu(picoFx.sketches['pico-serial1'].firmware), sent = [];
  pico.attachSerial(() => {}, (i, byte) => { if (i === 0) sent.push(byte); });
  const run = s => { const end = pico.seconds + s; while (pico.seconds < end) pico.run(100000, Infinity); };
  run(0.3);
  assert.match(String.fromCharCode(...sent), /hello from pico/);
  assert.equal(pico.uartActive(0), true); assert.equal(pico.uartActive(1), false);
  assert.ok(Math.abs(pico.uartBaud(0) - 9600) < 100, `baud ${pico.uartBaud(0)}`);
  sent.length = 0;
  for (const c of 'xyz') pico.uartWrite(0, c.charCodeAt(0));
  run(0.2);
  assert.equal(String.fromCharCode(...sent), 'xyz', 'what arrives on RX is echoed on TX');
});

test('different chips link too: an Uno’s Serial.print reaches a Pico’s Serial1', () => {
  const uno = new Mcu(hexOf('link-sender')), pico = new Rp2040Mcu(picoFx.sketches['pico-serial1'].firmware), echoed = [];
  uno.attachSerial(() => {}, (i, byte) => { if (i === 0) pico.uartWrite(0, byte); });
  pico.attachSerial(() => {}, (i, byte) => { if (i === 0) echoed.push(byte); });
  for (let t = 0; t < 0.8; t += 0.0005) { uno.run(0.0005 * CPU_HZ); pico.run(0.0005 * 125e6, Infinity); }
  assert.match(String.fromCharCode(...echoed), /msg:\d+/);
});

test('Serial.begin() called again (rate change, or after Serial.end) keeps printing — avr8js used to wipe UCSRA’s UDRE bit and stall the core', () => {
  const m = new Mcu(hexOf('serial-rebegin')), out = []; m.onSerial = b => out.push(b);
  m.run(0.6 * CPU_HZ);
  assert.equal(String.fromCharCode(...out).replace(/\r/g, ''), 'a\nb\nc\n');
});
