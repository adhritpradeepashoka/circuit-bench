import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/core/netlist.js';
import { describeBench } from '../src/core/bench-devices.js';
import { generateSketch, BLOCKS } from '../src/core/blocks.js';

// A bench is just parts + wires; pins are found through the netlist, like in the app.
const P = (id, type, extra = {}) => ({ id, type, x: 0, y: 0, rot: 0, ...extra });
const at = s => ({ part: s.slice(0, s.indexOf('.')), pin: s.slice(s.indexOf('.') + 1) });
const W = (a, b) => ({ id: `w${a}${b}`, a: at(a), b: at(b) });
const bench = (parts, wires) => { const state = { parts, wires }; return describeBench(parts, compile(state)); };
// tiny program builders (Blockly's saved JSON shape)
let n = 0; const id = () => `b${++n}`;
const num = v => ({ block: { type: 'cb_number', id: id(), fields: { NUM: v } } });
const blk = (type, o = {}) => ({ type, id: id(), ...o });
const chain = (...bs) => { for (let i = 0; i < bs.length - 1; i++) bs[i].next = { block: bs[i + 1] }; return bs[0]; };
const prog = (setup, loop, variables = []) => ({ variables, blocks: { blocks: [setup && blk('cb_setup', { inputs: { DO: { block: setup } } }), loop && blk('cb_loop', { inputs: { DO: { block: loop } } })].filter(Boolean) } });

test('devices: an LED behind its resistor on pin 9, wired through wires only', () => {
  const b = bench([P('uno', 'arduino-uno'), P('r', 'resistor'), P('l', 'led', { color: 'green' })], [W('uno.9', 'r.1'), W('r.2', 'l.A'), W('l.C', 'uno.GND.1')]);
  assert.equal(b.devices.length, 1);
  assert.equal(b.devices[0].kind, 'led'); assert.equal(b.devices[0].label, 'LED 1 (green)'); assert.equal(b.devices[0].pins.out.name, '9'); assert.equal(b.devices[0].pins.out.pwm, true);
});

test('devices: an LED nobody wired says so, and several of the same part are numbered', () => {
  const b = bench([P('uno', 'arduino-uno'), P('l1', 'led'), P('l2', 'led', { color: 'blue' })], [W('uno.13', 'l2.A')]);
  assert.deepEqual(b.devices.map(d => d.label), ['LED 1 (red)', 'LED 2 (blue)']);
  assert.equal(b.devices[0].pins.out, null); assert.match(b.devices[0].warn[0], /not connected/);
  assert.equal(b.devices[1].pins.out.name, '13');
});

test('blocks → sketch: blink, with pinMode, in setup and loop', () => {
  const b = bench([P('uno', 'arduino-uno'), P('r', 'resistor'), P('l', 'led')], [W('uno.13', 'r.1'), W('r.2', 'l.A'), W('l.C', 'uno.GND.1')]);
  const body = chain(blk('led_set', { fields: { DEV: 'l', S: 'ON' } }), blk('cb_wait', { inputs: { S: num(1) } }), blk('led_set', { fields: { DEV: 'l', S: 'OFF' } }), blk('cb_wait', { inputs: { S: num(0.5) } }));
  const { code, warnings } = generateSketch(prog(null, body), b);
  assert.deepEqual(warnings, []);
  assert.match(code, /void setup\(\) \{\n  Serial\.begin\(9600\);\n  pinMode\(13, OUTPUT\);/);
  assert.match(code, /void loop\(\) \{\n  digitalWrite\(13, HIGH\);\n  delay\(\(unsigned long\)\(\(1\) \* 1000\.0\)\);\n  digitalWrite\(13, LOW\);/);
});

test('blocks: button controls two different LEDs, each found by its own wiring', () => {
  const b = bench([P('uno', 'arduino-uno'), P('btn', 'pushbutton'), P('l1', 'led'), P('l2', 'led')], [W('btn.1.l', 'uno.2'), W('btn.2.l', 'uno.GND.1'), W('l1.A', 'uno.8'), W('l1.C', 'uno.GND.1'), W('l2.A', 'uno.9'), W('l2.C', 'uno.GND.1')]);
  const cond = { block: blk('button_down', { fields: { DEV: 'btn' } }) };
  const loop = blk('cb_ifelse', { inputs: { C: cond, DO: { block: blk('led_set', { fields: { DEV: 'l1', S: 'ON' } }) }, ELSE: { block: blk('led_set', { fields: { DEV: 'l2', S: 'ON' } }) } } });
  const { code, warnings } = generateSketch(prog(null, loop), b);
  assert.deepEqual(warnings, []);
  assert.match(code, /pinMode\(2, INPUT_PULLUP\);/); assert.match(code, /if \(\(digitalRead\(2\) == LOW\)\) \{\n    digitalWrite\(8, HIGH\);\n  \} else \{\n    digitalWrite\(9, HIGH\);/);
});

test('blocks: a knob dims an LED; maths, variables, say and compare all come out as valid-looking code', () => {
  const b = bench([P('uno', 'arduino-uno'), P('pot', 'potentiometer'), P('l', 'led')], [W('pot.SIG', 'uno.A0'), W('pot.VCC', 'uno.5V'), W('pot.GND', 'uno.GND.1'), W('l.A', 'uno.9'), W('l.C', 'uno.GND.1')]);
  const knob = { block: blk('pot_value', { fields: { DEV: 'pot' } }) };
  const vars = [{ id: 'v1', name: 'my level' }];
  const loop = chain(
    blk('variables_set', { fields: { VAR: { id: 'v1' } }, inputs: { VALUE: knob } }),
    blk('led_bright', { fields: { DEV: 'l' }, inputs: { V: { block: blk('variables_get', { fields: { VAR: { id: 'v1' } } }) } } }),
    blk('cb_say', { inputs: { X: { block: blk('cb_join', { inputs: { A: { block: blk('cb_text', { fields: { TEXT: 'level "x" ' } }) }, B: { block: blk('variables_get', { fields: { VAR: { id: 'v1' } } }) } } }) } } }),
    blk('math_change', { fields: { VAR: { id: 'v1' } }, inputs: { DELTA: num(2) } }));
  const { code, warnings } = generateSketch(prog(null, loop, vars), b);
  assert.deepEqual(warnings, []);
  assert.match(code, /float v_my_level = 0;/); assert.match(code, /v_my_level = \(analogRead\(A0\) \* 100\.0 \/ 1023\.0\);/);
  assert.match(code, /analogWrite\(9, \(int\)\(constrain\(\(v_my_level\) \* 2\.55, 0, 255\)\)\);/);
  assert.match(code, /Serial\.println\(\(String\(String\("level \\"x\\" "\)\) \+ String\(v_my_level\)\)\);/); assert.match(code, /v_my_level \+= 2;/);
  assert.match(code, /pinMode\(A0, INPUT\);/);
});

test('blocks: a part that is not wired gives words, not broken code; a deleted part too; loose blocks never run', () => {
  const b = bench([P('uno', 'arduino-uno'), P('l', 'led')], []);
  const loop = chain(blk('led_set', { fields: { DEV: 'l', S: 'ON' }, id: 'x1' }), blk('led_set', { fields: { DEV: 'gone', S: 'ON' }, id: 'x2' }));
  const p = prog(null, loop); p.blocks.blocks.push(blk('cb_wait', { id: 'x3', x: 500, y: 500 }));
  const { code, warnings } = generateSketch(p, b);
  assert.deepEqual(warnings.map(w => w.block), ['x1', 'x2', 'x3']);
  assert.match(warnings[0].text, /LED 1 \(red\) .*not connected/); assert.match(warnings[1].text, /no longer on the bench/); assert.match(warnings[2].text, /on its own/);
  assert.doesNotMatch(code, /digitalWrite/);
});

test('blocks: sensors, screens, 7-segment, motor driver and any-other-part blocks each produce their own sketch pieces', () => {
  const parts = [P('uno', 'arduino-uno'), P('ntc', 'ntc-sensor'), P('dht', 'dht', { model: 'DHT11' }), P('lcd', 'lcd1602'), P('oled', 'ssd1306'), P('mpu', 'mpu6050'), P('seg', 'seven-segment'), P('drv', 'l298n'), P('mot', 'dc-motor'), P('pir', 'pir-sensor')];
  const wires = [W('ntc.OUT', 'uno.A1'), W('dht.SDA', 'uno.2'), W('lcd.SDA', 'uno.A4'), W('lcd.SCL', 'uno.A5'), W('oled.DATA', 'uno.A4'), W('oled.CLK', 'uno.A5'), W('mpu.SDA', 'uno.A4'), W('mpu.SCL', 'uno.A5'),
    ...['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((s, i) => W(`seg.${s}`, `uno.${i + 3}`)), W('drv.IN1', 'uno.10'), W('drv.IN2', 'uno.11'), W('drv.ENA', 'uno.9'), W('drv.OUT1', 'mot.1'), W('drv.OUT2', 'mot.2'), W('pir.OUT', 'uno.12')];
  const b = bench(parts, wires);
  assert.deepEqual(b.devices.map(d => d.kind).sort(), ['dht', 'driver', 'lcd', 'mpu', 'ntc', 'oled', 'pir', 'seg']);
  const say = (T, dev, f = {}) => blk(T, { fields: { DEV: dev, ...f } });
  const loop = chain(
    blk('lcd_text', { fields: { DEV: 'lcd', R: '0', C: 1 }, inputs: { X: { block: say('ntc_temp', 'ntc') } } }),
    blk('lcd_text', { fields: { DEV: 'lcd', R: '1', C: 3 }, inputs: { X: { block: say('dht_read', 'dht', { W: 'H' }) } } }),
    blk('oled_text', { fields: { DEV: 'oled', L: '2' }, inputs: { X: { block: say('mpu_tilt', 'mpu', { W: 'pitch' }) } } }),
    blk('seg_digit', { fields: { DEV: 'seg' }, inputs: { N: num(7) } }),
    blk('motor_run', { fields: { DEV: 'drv:A', DIR: 'B' }, inputs: { V: num(60) } }),
    blk('cb_if', { inputs: { C: { block: say('pir_motion', 'pir') }, DO: { block: blk('motor_stop', { fields: { DEV: 'drv:A' } }) } } }));
  const { code, warnings } = generateSketch(prog(null, loop), b);
  assert.deepEqual(warnings, []);
  for (const re of [/#include <DHT\.h>/, /DHT dht_dht\(2, DHT11\);/, /LiquidCrystal_I2C cb_lcd\(0x27, 16, 2\);/, /Adafruit_SSD1306 cb_oled/, /float cb_ntc\(int pin\)/, /cb_ntc\(A1\)/, /cb_tilt\(0x68, false\)/,
    /cb_lcd_print\(2, 1, String\(cb_num\(dht_dht\.readHumidity\(\)\)\)\);/, /cb_oled_line\(2,/, /cb_digit_seg\(\(int\)\(7\)\);/, /digitalWrite\(10, LOW\);\ndigitalWrite\(11, HIGH\);|digitalWrite\(10, LOW\);/, /analogWrite\(9, /, /digitalRead\(12\) == HIGH/, /pinMode\(12, INPUT\)/]) assert.match(code, re, String(re));
  assert.equal((code.match(/void setup\(\)/g) || []).length, 1); assert.equal((code.match(/Wire\.begin\(\)/g) || []).length, 1, 'shared bus is started once');
});

test('blocks: parts the app has never heard of still get pin blocks; any-pin blocks work with no parts at all', () => {
  const b = bench([P('uno', 'arduino-uno'), P('m', 'dc-motor')], [W('m.1', 'uno.6')]);
  assert.equal(b.devices[0].kind, 'pin'); assert.match(b.devices[0].label, /DC Motor 1 · Motor \+ \(D6\)/);
  const loop = chain(blk('pin_set', { fields: { DEV: b.devices[0].id, S: 'HIGH' } }), blk('anypin_set', { fields: { PIN: '4', S: 'LOW' } }), blk('anypin_pwm', { fields: { PIN: '5' }, inputs: { V: num(128) } }));
  const { code } = generateSketch(prog(null, loop), b);
  assert.match(code, /digitalWrite\(6, HIGH\);/); assert.match(code, /digitalWrite\(4, LOW\);/); assert.match(code, /analogWrite\(5, \(int\)constrain\(128, 0, 255\)\);/); assert.match(code, /pinMode\(6, OUTPUT\);/);
  assert.deepEqual(generateSketch(prog(null, chain(blk('anypin_set', { fields: { PIN: 'drop table', S: 'LOW' } }))), { devices: [], pins: [] }).warnings, [], 'a bad pin name is ignored, not pasted into code');
});

test('blocks: a light that cannot dim warns; text is escaped into one safe line', () => {
  const b = bench([P('uno', 'arduino-uno'), P('l', 'led')], [W('l.A', 'uno.7'), W('l.C', 'uno.GND.1')]);
  const r = generateSketch(prog(null, chain(blk('led_bright', { fields: { DEV: 'l' }, id: 'dim', inputs: { V: num(50) } }), blk('cb_say', { inputs: { X: { block: blk('cb_text', { fields: { TEXT: 'a\nb"); evil(); //é' } }) } } }))), b);
  assert.equal(r.warnings.length, 1); assert.match(r.warnings[0].text, /D7 cannot dim/);
  assert.match(r.code, /Serial\.println\(String\("a b\\"\); evil\(\); \/\/\?"\)\);/);
});

test('every block type has a definition with a generator (and variables use Blockly\'s own)', () => {
  for (const [t, d] of Object.entries(BLOCKS)) { assert.equal(typeof d.gen, 'function', t); if (!t.startsWith('variables_') && t !== 'math_change') assert.ok(d.json.message0, t); }
});

import { buildToolbox, starterProgram } from '../src/core/blocks-toolbox.js';

test('toolbox: drawers follow the bench, device blocks are pre-filled, every block type exists', () => {
  const b = bench([P('uno', 'arduino-uno'), P('r', 'resistor'), P('l', 'led')], [W('uno.13', 'r.1'), W('r.2', 'l.A'), W('l.C', 'uno.GND.1')]);
  const tb = buildToolbox(b), names = tb.contents.map(c => c.name);
  assert.ok(names.includes('Lights')); assert.ok(!names.includes('Screens')); assert.ok(!names.includes('Motors'));
  const lights = tb.contents.find(c => c.name === 'Lights');
  assert.equal(lights.contents[0].fields.DEV, 'l');
  for (const c of tb.contents) for (const k of c.contents || []) assert.ok(BLOCKS[k.type] || k.type.startsWith('variables_'), k.type);
  assert.ok(buildToolbox({ devices: [], pins: [] }).contents.length >= 6);
});

test('starter: a button and a light make a working program with no warnings', () => {
  const b = bench([P('uno', 'arduino-uno'), P('r', 'resistor'), P('l', 'led'), P('bt', 'pushbutton')], [W('uno.13', 'r.1'), W('r.2', 'l.A'), W('l.C', 'uno.GND.1'), W('bt.1.l', 'uno.2'), W('bt.2.l', 'uno.GND.1')]);
  const s = starterProgram(b); assert.ok(s);
  const { code, warnings } = generateSketch(s, b);
  assert.deepEqual(warnings, []); assert.match(code, /digitalRead\(2\)/); assert.match(code, /digitalWrite\(13, HIGH\)/);
  const blink = starterProgram(bench([P('uno', 'arduino-uno'), P('l', 'led')], [W('uno.13', 'l.A')]));
  assert.match(generateSketch(blink, bench([P('uno', 'arduino-uno'), P('l', 'led')], [W('uno.13', 'l.A')])).code, /delay/);
});

test('an empty block workspace never wipes a sketch the blocks did not write (the starter Blink, typed code), but can still clear its own', async () => {
  const { emptyMayReplace, generateSketch, GENERATED_HEADER } = await import('../src/core/blocks.js');
  const { DEFAULT_SKETCH } = await import('../src/sim/examples.js');
  assert.equal(emptyMayReplace(DEFAULT_SKETCH, true), false, 'starter Blink survives opening the blocks');
  assert.equal(emptyMayReplace('void setup(){}\nvoid loop(){ /* mine */ }', true), false, 'typed code survives');
  assert.equal(emptyMayReplace(`${GENERATED_HEADER} — x\nvoid loop(){}`, true), true, 'code the blocks wrote is cleared with them');
  assert.equal(emptyMayReplace('', true), true); assert.equal(emptyMayReplace(`${GENERATED_HEADER}`, false), false, 'only on a forced refresh');
  assert.ok(generateSketch({ blocks: { languageVersion: 0, blocks: [] }, variables: [] }, { parts: [], wires: [] }).code.startsWith(GENERATED_HEADER), 'the generator writes the header the guard looks for');
});
