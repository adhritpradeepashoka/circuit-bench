import test from 'node:test';
import assert from 'node:assert/strict';
import { quickEdit, parseOhms } from '../src/core/quick-edits.js';
import { applyCircuitActions } from '../src/core/ai-actions.js';

const board = (...types) => ({ parts: types.map((type, i) => ({ id: `${type}-${i + 1}`, type, x: 0, y: 0 })), wires: [] });
const applied = (text, circuit) => { const r = quickEdit(text, circuit); return r && { r, out: applyCircuitActions(circuit, r.actions) }; };

test('parseOhms understands 330, 4.7k, 10 kΩ, 1M and refuses bare numbers', () => {
  assert.equal(parseOhms('a 330 ohm resistor'), 330); assert.equal(parseOhms('4.7k'), 4700); assert.equal(parseOhms('10 kΩ'), 10000); assert.equal(parseOhms('1M'), 1e6);
  assert.equal(parseOhms('add 3 resistors'), null);
});

test('add: parts, counts, colours and resistor values', () => {
  const c = board('arduino-uno');
  let a = applied('add a red LED', c); assert.deepEqual(a.out.parts.at(-1).color, 'red'); assert.equal(a.out.warnings.length, 0);
  a = applied('Please add 3 LEDs', c); assert.equal(a.out.parts.filter(p => p.type === 'led').length, 3);
  a = applied('put a 4.7k resistor on the board', c); assert.equal(a.out.parts.at(-1).ohms, 4700);
  a = applied('add an oled display', c); assert.equal(a.out.parts.at(-1).type, 'ssd1306');
  a = applied('i need a light sensor', c); assert.equal(a.out.parts.at(-1).type, 'ldr-module');
  a = applied('add a potentiometer', c); assert.equal(a.out.parts.at(-1).type, 'potentiometer');
  const twice = applyCircuitActions(a.out, quickEdit('add an led', a.out).actions); assert.equal(new Set(twice.parts.map(p => p.id)).size, twice.parts.length, 'ids stay unique');
});

test('remove: one, all, ambiguous, missing, by id', () => {
  const c = board('led', 'led', 'resistor');
  assert.equal(applied('remove the resistor', c).out.parts.length, 2);
  assert.equal(quickEdit('delete the led', c).actions.length, 0, 'two LEDs: asks which');
  assert.match(quickEdit('delete the led', c).explanation, /led-1/);
  assert.equal(applied('remove all leds', c).out.parts.length, 1);
  assert.match(quickEdit('remove the button', c).explanation, /no Pushbutton/i);
  assert.equal(applied('delete led-2', c).out.parts.length, 2);
});

test('set: resistor value, led colour, battery volts, temperature', () => {
  const c = board('resistor', 'led', 'battery', 'ntc-sensor');
  assert.equal(applied('change the resistor to 1k', c).out.parts[0].ohms, 1000);
  assert.equal(applied('make the LED blue', c).out.parts[1].color, 'blue');
  assert.equal(applied('set the battery to 5V', c).out.parts[2].volts, 5);
  assert.equal(applied('set the temperature sensor to 40 degrees c', c).out.parts[3].temp, 40);
  assert.match(quickEdit('set the potentiometer to 50', c).explanation, /no Potentiometer/i);
});

test('blink: a sketch for the pin and the time, with wiring advice', () => {
  const r = quickEdit('blink pin 9 every half second', board());
  assert.match(r.code, /LED_PIN = 9/); assert.match(r.code, /delay\(500\)/); assert.match(r.explanation, /pin 9/);
  assert.match(quickEdit('blink the led on pin 13 every 2 seconds', board()).code, /delay\(2000\)/);
  assert.match(quickEdit('blink pin 5 every 250 ms', board()).code, /delay\(250\)/);
  assert.equal(quickEdit('blink pin 99', board()), null);
});

test('anything unclear, a question, or multi-step goes to a model', () => {
  for (const q of ['why is my led not working', 'explain how a resistor works', 'add an led and a resistor and wire them to pin 9', 'make me a slime mold circuit', 'hello', '', 'add a flux capacitor', 'what is ohms law']) assert.equal(quickEdit(q, board('led')), null, q);
});

test('build-style requests are left for the tiny model instead of dropping a bare part', () => {
  for (const q of ['add an led and make a circuit', 'wire up a button', 'set up an led', 'add a led and connect it']) assert.equal(quickEdit(q, { parts: [], wires: [] }), null, q);
  assert.ok(quickEdit('add an led', { parts: [], wires: [] }), 'a plain add still works instantly');
});
