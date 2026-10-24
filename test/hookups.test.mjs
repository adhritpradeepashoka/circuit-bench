// "Make a <any part> circuit": the planner (core/hookup) scans the bench, adds a missing board / part, wires only what is unwired, and
// writes a matching sketch. These tests hold it to the same bar for EVERY part in the catalog — built-in, Part Creator and KiCad
// style parts alike — on all three boards: no apply warnings, no open leads, every wire where the recipe said it should be, no
// pin overloaded under any firmware output pattern, and a sketch the real toolchain compiles (skipped when it is not installed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../src/core/hookup/plan.js';
import { makeCircuit } from '../src/core/hookup/intent.js';
import { readParts, parseOhms } from '../src/core/hookup/names.js';
import { recipeEdit } from '../src/core/recipes.js';
import { applyCircuitActions } from '../src/core/ai-actions.js';
import { fromProjectFile } from '../src/core/project.js';
import { compile } from '../src/core/netlist.js';
import { solveDrive } from '../src/core/solver.js';
import { PART_DEFS } from '../src/core/parts.js';
import { createCompiler } from '../server/compile-service.mjs';
import '../src/core/custom-parts.js';

const EMPTY = () => ({ parts: [], wires: [] });
import { BOARD_SPECS } from '../src/core/boards.js';
const TYPES = Object.keys(PART_DEFS).filter(t => !BOARD_SPECS[t] && t !== 'breadboard');
const BOARDS = Object.keys(BOARD_SPECS);
const FQBN = Object.fromEntries(Object.entries(BOARD_SPECS).map(([k, s]) => [k, s.fqbn]));

function realize(result, circuit = EMPTY()) {
  const applied = applyCircuitActions(circuit, result.actions);
  const state = fromProjectFile({ format: 'virtual-lab', version: '0.1', parts: applied.parts, wires: applied.wires });
  return { applied, state, net: compile(state) };
}
/** every way the result can be wrong, as text (empty = fine) */
function problems(result, circuit = EMPTY(), { baseline = false } = {}) {
  const out = [], { applied, net } = realize(result, circuit);
  const before = baseline ? realize({ actions: [] }, circuit).net : null;
  const known = before ? new Set([...before.issues.map(i => i.text), ...before.openLeads.map(l => l.text)]) : new Set();
  if (applied.warnings.length) out.push('apply warnings: ' + applied.warnings.join(' | '));
  for (const i of net.issues) if (!known.has(i.text)) out.push('issue: ' + i.text);
  for (const l of net.openLeads) if (!known.has(l.text)) out.push('open lead: ' + l.text);
  for (const ch of result.checks) {
    const n = net.netOf(ch.part, ch.pin), e = ch.expect;
    if (n === undefined) { out.push(`check ${ch.part}.${ch.pin}: no net`); continue; }
    if (['gnd', 'v5', 'v33', 'vin'].includes(e)) { if (!net.uno[e].has(n)) out.push(`${ch.part}.${ch.pin} is not on ${e}`); }
    else if (e.startsWith('pin:')) { const p = net.uno.pins.find(q => q.name === e.slice(4)); if (!p || p.net !== n) out.push(`${ch.part}.${ch.pin} is not on pin ${e.slice(4)}`); }
    else if (e.startsWith('with:')) { const [pid, pin] = e.slice(5).split('|'); if (net.netOf(pid, pin) !== n) out.push(`${ch.part}.${ch.pin} is not joined to ${pid}.${pin}`); }
  }
  return out;
}
/** drive the pins the sketch writes in every pattern that matters (all high, all low, each one alone, each one off) and collect solver warnings */
function electrical(result, circuit = EMPTY()) {
  const { net } = realize(result, circuit), dirs = result.pins || {};
  const names = net.uno.pins.map(p => p.name), outs = names.filter(n => dirs[n] === 'out');
  const scen = [new Set(outs), new Set(), ...outs.map(o => new Set([o])), ...outs.map(o => new Set(outs.filter(x => x !== o)))];
  const seen = new Set(), found = [];
  for (const hi of scen) {
    const pins = new Map(names.map(n => [n, hi.has(n) ? 'H' : outs.includes(n) ? 'L' : 'Z']));
    for (const w of solveDrive(net, { pins, pressed: new Set(), duty: new Map(), signals: new Map(), dt: 0.01 }).warnings) if (!seen.has(w.text)) { seen.add(w.text); found.push(w.text); }
  }
  return found;
}
const apply = (result, circuit = EMPTY()) => { const a = applyCircuitActions(circuit, result.actions); return { parts: a.parts, wires: a.wires }; };
const count = (circuit, type) => circuit.parts.filter(p => p.type === type).length;

// ── every part × every board ───────────────────────────────────────────────────────────────────
for (const board of BOARDS) {
  test(`every part in the catalog → a clean, safe circuit on ${board}`, () => {
    const failures = [];
    for (const type of TYPES) {
      const r = plan([{ type }], EMPTY(), { board });
      if (!r.ok) { failures.push(`${type}: refused — ${r.explanation}`); continue; }
      const want = r.informational ? null : board;
      const bench = realize(r).applied;
      if (want && !bench.parts.some(p => p.type === board) && !r.noBoard) failures.push(`${type}: no ${board} on the bench`);
      for (const p of problems(r)) failures.push(`${type}: ${p}`);
      for (const w of electrical(r)) failures.push(`${type}: electrical — ${w}`);
      if (!r.informational && !r.actions.length) failures.push(`${type}: nothing was built`);
      if (!r.explanation) failures.push(`${type}: no explanation`);
    }
    assert.deepEqual(failures, []);
  });
}

// ── asking twice changes nothing; a part that is already there is used, not duplicated ─────────────
test('asking again for a circuit that is already built changes nothing', () => {
  const failures = [];
  for (const type of TYPES) {
    const r1 = plan([{ type }], EMPTY()), c1 = apply(r1);
    const r2 = plan([{ type }], c1);
    if (r2.actions.length) failures.push(`${type}: a second request added ${r2.actions.length} actions (${r2.actions.filter(a => a.op === 'add_part').map(a => a.type).join(', ') || 'wires only'})`);
    for (const p of problems(r2, c1)) failures.push(`${type}: ${p}`);
  }
  assert.deepEqual(failures, []);
});

test('a part that is on the bench but not wired is used, not duplicated', () => {
  const failures = [];
  for (const type of TYPES) {
    const r1 = plan([{ type }], EMPTY()), a = apply(r1);
    const keep = new Set(a.parts.filter(p => p.type === type || !!BOARD_SPECS[p.type]).map(p => p.id));
    const bench = { parts: a.parts.filter(p => keep.has(p.id)), wires: [] };
    if (!bench.parts.some(p => p.type === type)) continue;
    const r = plan([{ type }], bench), added = r.actions.filter(x => x.op === 'add_part' && x.type === type).length;
    if (added) failures.push(`${type}: added another one next to the one on the bench`);
    for (const p of problems(r, bench, { baseline: true })) failures.push(`${type}: ${p}`);
    for (const w of electrical(r, bench)) failures.push(`${type}: electrical — ${w}`);
  }
  assert.deepEqual(failures, []);
});

test('a half-wired bench is finished without breaking what is there', () => {
  const failures = [];
  for (const type of TYPES) {
    const r1 = plan([{ type }], EMPTY()), a = apply(r1);
    for (const keepEvery of [2, 3]) {
      const bench = { parts: a.parts, wires: a.wires.filter((w, i) => i % keepEvery === 0) };
      const r = plan([{ type }], bench);
      if (!r.ok) { failures.push(`${type} (1 in ${keepEvery}): refused — ${r.explanation}`); continue; }
      for (const p of problems(r, bench, { baseline: true })) failures.push(`${type} (1 in ${keepEvery}): ${p}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('the student’s own wiring wins: a part already on a pin keeps that pin', () => {
  const bench = { parts: [{ id: 'uno1', type: 'arduino-uno', x: 0, y: 0, rotate: 0 }, { id: 's1', type: 'servo', x: 400, y: 0, rotate: 0 }], wires: [{ id: 'w1', from: { part: 's1', pin: 'SIG' }, to: { part: 'uno1', pin: '5' } }] };
  const sig = PART_DEFS.servo.pins.find(p => /sig/i.test(p.id) || /sig/i.test(p.label || ''))?.id;
  const bench2 = { ...bench, wires: [{ id: 'w1', from: { part: 's1', pin: sig }, to: { part: 'uno1', pin: '5' } }] };
  const r = plan([{ type: 'servo' }], bench2);
  assert.ok(r.ok); assert.match(r.code, /attach\(5\)/); assert.equal(count(apply(r, bench2), 'servo'), 1);
  assert.deepEqual(problems(r, bench2), []);
});

// ── several parts, several of one part ───────────────────────────────────────────────────────────
test('several instances get their own ids, their own pins, and still compile-clean wiring', () => {
  for (const [type, n] of [['led', 3], ['servo', 3], ['hc-sr04', 2], ['mpu6050', 2], ['dht', 2], ['pushbutton', 3], ['potentiometer', 2], ['custom-q-2n2222', 2], ['rgb-led', 2], ['buzzer', 2]]) {
    const r = plan([{ type, count: n }], EMPTY());
    assert.ok(r.ok, `${type}: ${r.explanation}`);
    const c = apply(r);
    assert.equal(count(c, type), n, `${type} × ${n}`);
    assert.equal(new Set(c.parts.map(p => p.id)).size, c.parts.length, `${type}: ids are unique`);
    assert.deepEqual(problems(r), [], type);
    assert.deepEqual(electrical(r), [], type);
  }
});

test('random mixes of 2–4 parts either build cleanly or say plainly that the board is out of pins', () => {
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  let built = 0, refused = 0; const failures = [];
  for (let i = 0; i < 160; i++) {
    const group = Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => TYPES[Math.floor(rnd() * TYPES.length)]);
    const board = BOARDS[i % BOARDS.length];
    const r = plan(group.map(type => ({ type })), EMPTY(), { board });
    if (!r.ok) { refused++; if (!/no free .* pin left|only one board/.test(r.explanation) || r.actions.length) failures.push(`${group}: bad refusal "${r.explanation}"`); continue; }
    built++;
    for (const p of [...problems(r), ...electrical(r)]) failures.push(`${group} on ${board}: ${p}`);
  }
  assert.deepEqual(failures, []); assert.ok(built > 100, `built ${built}, refused ${refused}`);
});

// ── boards ───────────────────────────────────────────────────────────────────────────────────
test('the board on the bench is the board that gets used', () => {
  const nano = apply(plan([{ type: 'led' }], EMPTY(), { board: 'arduino-nano' }));
  const r = plan([{ type: 'mpu6050' }], nano, { board: 'arduino-uno' });
  assert.equal(count(apply(r, nano), 'arduino-uno'), 0); assert.equal(count(apply(r, nano), 'arduino-nano'), 1);
  const m = makeCircuit('make an mpu6050 circuit on an uno', nano);
  assert.match(m.explanation, /already has Arduino Nano/);
});

test('I²C parts use the board’s own I²C pins (A4/A5, SDA/SCL on a Mega) and two sensors share the bus', () => {
  for (const [board, a, b] of [['arduino-uno', 'A4', 'A5'], ['arduino-nano', 'A4', 'A5'], ['arduino-mega', '20', '21']]) {
    const r = plan([{ type: 'mpu6050' }, { type: 'ssd1306' }], EMPTY(), { board });
    assert.ok(r.ok, r.explanation);
    const { net } = realize(r);
    assert.ok(r.checks.some(c => c.expect === `pin:${a}`) && r.checks.some(c => c.expect === `pin:${b}`), board);
    assert.deepEqual(problems(r), [], board);
    assert.equal(net.issues.length, 0);
  }
});

test('running out of pins is an honest refusal, never a half-built circuit', () => {
  const r = plan([{ type: 'dip-switch-8', count: 2 }, { type: 'keypad-4x4', count: 2 }, { type: 'led-bar-graph' }], EMPTY());
  assert.equal(r.ok, false); assert.equal(r.actions.length, 0); assert.equal(r.code, null);
  assert.match(r.explanation, /no free .* pin left/);
});

test('a part with no ready-made recipe is still added, and the answer says so', () => {
  const r = plan([{ type: 'custom-slime-mold' }], EMPTY());
  assert.ok(r.ok); assert.match(r.explanation, /slime/i);
  assert.equal(r.explanation.includes('unchanged'), false);
});

// ── sketches compile on the real toolchain ───────────────────────────────────────────────────────
const compiler = createCompiler();
const haveToolchain = !!(await compiler.version().catch(() => null));
for (const board of BOARDS) {
  test(`every generated sketch compiles for ${board}`, { skip: haveToolchain ? false : 'no Arduino CLI here', timeout: 600000 }, async () => {
    const failures = [];
    for (const type of TYPES) {
      const r = plan([{ type }], EMPTY(), { board });
      if (!r.code) continue;
      const b = await compiler.compile({ sketch: r.code, fqbn: FQBN[board] });
      if (!b.ok) failures.push(`${type}: ${String(b.output).slice(0, 300)}`);
    }
    assert.deepEqual(failures, []);
  });
}
test('mixed circuits compile too (several parts, one sketch)', { skip: haveToolchain ? false : 'no Arduino CLI here', timeout: 300000 }, async () => {
  const failures = [];
  for (const group of [['mpu6050', 'ssd1306', 'pushbutton'], ['hc-sr04', 'servo', 'buzzer'], ['dht', 'lcd1602', 'led'], ['potentiometer', 'rgb-led', 'led-bar-graph'], ['ky-040', 'custom-stepper'], ['ldr-module', 'custom-fan', 'relay-dpdt'], ['joystick', 'servo'], ['pir-sensor', 'buzzer', 'led'], ['custom-gate-and', 'pushbutton']]) {
    for (const board of BOARDS) {
      const r = plan(group.map(type => ({ type })), EMPTY(), { board });
      if (!r.ok) { failures.push(`${group} on ${board}: ${r.explanation}`); continue; }
      const b = await compiler.compile({ sketch: r.code, fqbn: FQBN[board] });
      if (!b.ok) failures.push(`${group} on ${board}: ${String(b.output).slice(0, 300)}`);
      for (const p of [...problems(r), ...electrical(r)]) failures.push(`${group} on ${board}: ${p}`);
    }
  }
  assert.deepEqual(failures, []);
});

// ── understanding the request ────────────────────────────────────────────────────────────────
const typesOf = text => readParts(text).requests.map(r => r.type);
test('names: every part is found by its name, its model number and its everyday words', () => {
  for (const [text, want] of [
    ['make a MPU circuit', ['mpu6050']], ['mpu-6050 circuit', ['mpu6050']], ['an accelerometer circuit', ['mpu6050']], ['gyro setup', ['mpu6050']],
    ['I want a basic LED circuit', ['led']], ['rgb led circuit', ['rgb-led']], ['hook up an oled', ['ssd1306']], ['lcd circuit', ['lcd1602']],
    ['dht22 circuit', ['dht']], ['humidity sensor setup', ['dht']], ['hc-sr04 circuit', ['hc-sr04']], ['an ultrasonic distance sensor circuit', ['hc-sr04']],
    ['servo circuit', ['servo']], ['sg90 circuit', ['servo']], ['stepper motor circuit', ['custom-stepper']], ['28byj-48 circuit', ['custom-stepper']],
    ['relay circuit', ['relay-dpdt']], ['buzzer circuit', ['buzzer']], ['piezo circuit', ['buzzer']], ['joystick circuit', ['joystick']],
    ['rotary encoder circuit', ['ky-040']], ['ky-040 circuit', ['ky-040']], ['keypad circuit', ['keypad-4x4']], ['dip switch circuit', ['dip-switch-8']],
    ['pir circuit', ['pir-sensor']], ['motion sensor circuit', ['pir-sensor']], ['light sensor circuit', ['ldr-module']], ['ldr circuit', ['ldr-module']],
    ['thermistor circuit', ['ntc-sensor']], ['gas sensor circuit', ['gas-sensor']], ['mq-2 circuit', ['gas-sensor']], ['flame sensor circuit', ['flame-sensor']],
    ['sound sensor circuit', ['sound-sensor']], ['hall sensor circuit', ['custom-hall']], ['tilt switch circuit', ['tilt-switch']],
    ['2n2222 circuit', ['custom-q-2n2222']], ['pnp transistor circuit', ['custom-q-2n2907']], ['mosfet circuit', ['custom-q-irlz44n']], ['transistor circuit', ['custom-q-2n2222']],
    ['1n4007 circuit', ['custom-d-1n4007']], ['zener circuit', ['custom-d-zener']], ['diode circuit', ['custom-d-1n4007']],
    ['op amp circuit', ['custom-opamp-lm358']], ['lm741 circuit', ['custom-opamp-741']], ['ina128 circuit', ['custom-inamp-ina128']], ['ecg circuit', ['custom-bioamp-exg-pill']],
    ['7805 circuit', ['custom-reg-7805']], ['capacitor circuit', ['custom-cap-100u']], ['100nf circuit', ['custom-cap-100n']], ['inductor circuit', ['custom-ind-10mh']],
    ['and gate circuit', ['custom-gate-and']], ['xor gate circuit', ['custom-gate-xor']], ['d flip flop circuit', ['custom-gate-dff']], ['multiplexer circuit', ['custom-gate-mux2']], ['74hc595 circuit', ['custom-ic-74hc595']],
    ['battery circuit', ['battery']], ['led bar graph circuit', ['led-bar-graph']], ['7 segment display circuit', ['seven-segment']], ['slide pot circuit', ['slide-pot']], ['potentiometer circuit', ['potentiometer']],
    ['fan circuit', ['custom-fan']], ['dc motor circuit', ['dc-motor']], ['l298n circuit', ['l298n']],
    ['mpu and an oled and a button', ['mpu6050', 'ssd1306', 'pushbutton']],
  ]) assert.deepEqual(typesOf(text), want, text);
});
test('names: counts, colours and resistor values', () => {
  assert.deepEqual(readParts('wire up 3 red leds').requests, [{ type: 'led', count: 3, color: 'red' }]);
  assert.deepEqual(readParts('two servos circuit').requests, [{ type: 'servo', count: 2 }]);
  assert.deepEqual(readParts('a 330 ohm resistor and an led').requests, [{ type: 'led', count: 1, ohms: 330 }], 'a resistor next to an LED is that LED’s resistor');
  assert.equal(readParts('mq-2 gas sensor circuit').requests[0].count, 1, 'a part named twice is one part');
  assert.equal(readParts('dht22 circuit with a nano').board, 'arduino-nano');
  assert.equal(parseOhms('a 4.7k resistor'), 4700); assert.equal(parseOhms('10 kΩ'), 10000); assert.equal(parseOhms('330 ohm'), 330); assert.equal(parseOhms('2 leds'), null);
});

test('requests: circuit asks are answered; questions, edits and precise pin instructions are left to the other assistants', () => {
  for (const ok of ['make a MPU circuit', 'Make an mpu6050 circuit!', 'I want a basic LED circuit', 'hook up a servo', 'wire up the oled', 'set up a dht22', 'build me a relay circuit', 'create a 74hc595 circuit', 'servo and potentiometer circuit', 'give me a pir circuit', 'mpu6050 circuit please'])
    assert.ok(makeCircuit(ok, EMPTY()), ok);
  for (const no of ['why is my mpu circuit not working?', 'how do I make an mpu circuit', 'what is an mpu6050 circuit', 'remove the mpu circuit', 'change the led circuit to 330 ohm', 'make the servo circuit faster', 'connect the led to pin 9', 'make a servo circuit on pin 9', 'add a led', 'blink pin 9 every second', 'explain this circuit', 'write code for the mpu', 'make a coffee machine circuit'])
    assert.equal(makeCircuit(no, EMPTY()), null, no);
});
test('requests: a family word asks which one instead of guessing', () => {
  const r = makeCircuit('make a display circuit', EMPTY());
  assert.equal(r.actions.length, 0); assert.match(r.explanation, /Which display/); assert.match(r.explanation, /OLED/i);
  assert.match(makeCircuit('make a logic gate circuit', EMPTY()).explanation, /Which/);
  assert.match(makeCircuit('sensor circuit', EMPTY()).explanation, /Which sensor/);
});
test('requests: the sketch warning appears only when it matters', () => {
  assert.match(makeCircuit('make a servo circuit', EMPTY(), { sketchIsCustom: true }).explanation, /sketch in the editor will be replaced/);
  assert.doesNotMatch(makeCircuit('make a servo circuit', EMPTY()).explanation, /replaced/);
});
test('recipeEdit (what the chat panel calls) returns actions + a sketch + a sentence', () => {
  const r = recipeEdit('make an mpu circuit', EMPTY());
  assert.ok(r.actions.length > 3 && /Wire\.h/.test(r.code) && r.explanation);
  assert.equal(recipeEdit('hello', EMPTY()), null);
});

test('the sketches do what the circuit says (spot checks of the generated code)', () => {
  const code = (...types) => plan(types.map(type => ({ type })), EMPTY()).code;
  assert.match(code('mpu6050'), /0x68/); assert.match(code('hc-sr04'), /pulseIn/); assert.match(code('servo'), /Servo/);
  assert.match(code('dht'), /DHT/); assert.match(code('pushbutton', 'led'), /INPUT_PULLUP/); assert.match(code('potentiometer', 'led'), /analogRead/);
  assert.match(code('ssd1306'), /Adafruit_SSD1306/); assert.match(code('lcd1602'), /LiquidCrystal_I2C/);
  assert.match(code('custom-ic-74hc595'), /shiftOut/); assert.match(code('ky-040'), /digitalRead/);
});

test('sentences use the right article (an NPN, an 8-way, an LCD, a DHT22, a servo)', async () => {
  const { fixArticles } = await import('../src/core/hookup/helpers.js');
  for (const [a, b] of [['Added a NPN transistor', 'Added an NPN transistor'], ['Added an DHT22', 'Added a DHT22'], ['Added a 8-way DIP switch', 'Added an 8-way DIP switch'], ['Added a OLED', 'Added an OLED'],
    ['a LCD', 'an LCD'], ['Added a MPU-6050', 'Added an MPU-6050'], ['Added a ultrasonic sensor', 'Added an ultrasonic sensor'], ['Added a servo', 'Added a servo'], ['a 9 V battery', 'a 9 V battery'], ['a 1 kΩ resistor', 'a 1 kΩ resistor'], ['an 220 Ω resistor', 'a 220 Ω resistor'], ['segments A … G', 'segments A … G'], ['Added a PIR', 'Added a PIR']])
    assert.equal(fixArticles(a), b);
  assert.match(plan([{ type: 'custom-q-2n2222' }], EMPTY()).explanation, /Added an NPN/);
});

test('a part the student makes (Part Creator) works like a built-in one: found by its name, wired from the roles it declares', async () => {
  const { validatePartSpec, registerCustomPart } = await import('../src/core/custom-parts.js');
  const mk = (id, name, behaviour, pins) => { const v = validatePartSpec({ id, name, category: 'Basic', w: 60, h: 60, pins, behaviour }, { id }); assert.ok(v.ok, v.errors?.join()); registerCustomPart(v.spec); };
  mk('test-lamp', 'Garden lamp', { kind: 'led', roles: { anode: 'P', cathode: 'M' } }, [{ id: 'P', label: 'plus', x: 10, y: 55 }, { id: 'M', label: 'minus', x: 50, y: 55 }]);
  mk('test-blob', 'Mystery blob', { kind: 'none', roles: {} }, [{ id: 'A', label: 'a', x: 10, y: 55 }, { id: 'B', label: 'b', x: 50, y: 55 }]);
  const lamp = makeCircuit('make a garden lamp circuit', EMPTY());
  assert.ok(lamp && lamp.actions.some(a => a.type === 'test-lamp'), 'found by its own name');
  assert.deepEqual(problems(lamp), []); assert.deepEqual(electrical(lamp), []);
  const again = plan([{ type: 'test-lamp' }], apply(lamp));
  assert.equal(again.actions.length, 0, 'asking again changes nothing');
  const blob = makeCircuit('make a mystery blob circuit', EMPTY());
  assert.ok(blob.actions.some(a => a.type === 'test-blob'), 'a part with no behaviour is still put on the bench…');
  assert.match(blob.explanation, /ready-made circuit/, '…and the answer says there is no circuit for it');
});
