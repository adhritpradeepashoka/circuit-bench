// The "make a calculator" recipe: the generated sketch is compiled by the real toolchain (fixtures), run on the simulated ATmega328P,
// and driven through a simulated 4×4 keypad matrix; the result shows up on Serial (the same text the screen draws).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Mcu, CPU_HZ } from '../src/sim/mcu.js';
import { Ssd1306 } from '../src/parts/ssd1306.js';
import { Lcd1602 } from '../src/parts/lcd1602.js';
import { BOARD_SPECS } from '../src/core/boards.js';
import { plan } from '../src/core/hookup/plan.js';
import { recipeEdit } from '../src/core/recipes.js';
globalThis.HTMLElement ||= class {};

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/firmware.json', import.meta.url)), 'utf8'));
const EMPTY = () => ({ format: 'virtual-lab', version: 1, parts: [], wires: [] });
const MAP = ['123A', '456B', '789C', '*0#D'];
const pinOf = n => BOARD_SPECS['arduino-uno'].pins[String(n)];

/** The sketch the recipe writes right now must be the one that was compiled: otherwise the fixtures are stale. */
function sketchFor(text, fixture) {
  const code = recipeEdit(text, EMPTY()).code;
  const f = fixtures.sketches[fixture];
  assert.ok(f?.result.ok, `${fixture} compiled`);
  assert.equal(code, f.source, `${fixture} fixture is out of date — run npm run build-firmware`);
  return f;
}
function keypadPins(src) {
  const grab = name => src.match(new RegExp(`${name}\\[\\] = \\{([^}]*)\\}`))[1].split(',').map(s => s.trim());
  return { rows: grab('ROW_PINS'), cols: grab('COL_PINS') };
}
function rig(fixture, devices = [], hold = 0.15) {
  const f = fixtures.sketches[fixture], { rows, cols } = keypadPins(f.source);
  const mcu = new Mcu(f.result.hex), out = [];
  mcu.onSerial = b => out.push(b);
  mcu.i2c.setDevices(new Map(devices));
  let held = null;
  // a pressed key joins its column to its row: the column reads LOW while the sketch drives that row LOW
  const settle = () => {
    cols.forEach((c, ci) => mcu.setInput(pinOf(c), !(held && held[1] === ci && mcu.pinMode(pinOf(rows[held[0]])) === 'L')));
  };
  const run = s => { const steps = Math.ceil(s * CPU_HZ / 4); for (let i = 0; i < steps; i++) { settle(); mcu.run(4); } };      // the matrix is scanned in microseconds, so settle every 4 cycles
  const press = k => {
    const r = MAP.findIndex(row => row.includes(k)); held = [r, MAP[r].indexOf(k)];
    run(hold); held = null; run(hold);
  };
  return { press, run, shown: () => Buffer.from(out).toString('latin1').split(/\r?\n/).filter(Boolean), type: s => [...s].forEach(press) };
}

test('calculator recipe: asks for a keypad and a screen, and writes a calculator rather than a key printer', () => {
  for (const ask of ['Make me a calculator with the OLED display and the membrane keypad', 'make a calculator', 'calculator with an lcd and keypad']) {
    const r = recipeEdit(ask, EMPTY());
    assert.ok(r?.code, ask);
    assert.match(r.code, /void calculate\(\)/);
    const types = r.actions.filter(a => a.type === 'add_part').map(a => a.partType || a.part?.type);
    assert.ok(r.actions.length > 3, 'parts and wires were added');
    assert.doesNotMatch(r.explanation, /prints each key|shows the readings/);
    void types;
  }
  assert.match(recipeEdit('make a calculator with an lcd and keypad', EMPTY()).code, /LiquidCrystal_I2C/);
  assert.match(recipeEdit('make a calculator', EMPTY()).code, /Adafruit_SSD1306/);
});

test('calculator recipe: questions about calculators are left to the AI', () => {
  assert.equal(recipeEdit('why is my calculator wrong', EMPTY()), null);
  assert.equal(recipeEdit('how does a calculator work', EMPTY()), null);
});

test('calculator on the OLED: arithmetic through the real keypad matrix', () => {
  sketchFor('make a calculator with the oled and the membrane keypad', 'calculator-oled');
  const oled = new Ssd1306();
  const t = rig('calculator-oled', [[0x3c, oled]]);
  t.run(0.5);
  assert.equal(t.shown().at(-1), '0');
  t.type('12A30#');                                     // 12 + 30
  assert.equal(t.shown().at(-1), '42');
  t.type('*');
  t.type('9C9#');                                       // 9 × 9
  assert.equal(t.shown().at(-1), '81');
  t.type('*7D2#');                                      // 7 ÷ 2
  assert.equal(t.shown().at(-1), '3.5');
  t.type('*5B8#');                                      // 5 − 8
  assert.equal(t.shown().at(-1), '-3');
  t.type('*1A2A3#');                                    // chained: 1 + 2 + 3
  assert.equal(t.shown().at(-1), '6');
  t.type('*4D0#');                                      // divide by zero
  assert.equal(t.shown().at(-1), 'Error');
  t.type('7');                                          // locked until cleared
  assert.equal(t.shown().at(-1), 'Error');
  t.type('*');
  assert.equal(t.shown().at(-1), '0');
  assert.ok(oled.on && oled.summary().litPixels > 50, 'the OLED is drawing something');
});

test('calculator on the LCD builds too and does the same sums', () => {
  sketchFor('make a calculator with an lcd and the keypad', 'calculator-lcd');
  const lcd = new Lcd1602();
  const t = rig('calculator-lcd', [[0x27, lcd]], 0.5);
  t.run(2);
  t.type('25C4#');
  assert.equal(t.shown().at(-1), '100');
  assert.equal(lcd.lines()[1].trim(), '100', 'the second LCD row shows the result');
});

test('calculator plan wires the keypad to free pins on other boards too', () => {
  for (const board of ['arduino-uno', 'arduino-nano', 'arduino-mega']) {
    const r = plan([{ type: 'keypad-4x4' }, { type: 'ssd1306' }], EMPTY(), { board, calculator: true });
    assert.ok(r.ok && /void calculate\(\)/.test(r.code), board);
  }
});
