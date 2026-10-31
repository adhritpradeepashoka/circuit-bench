// Part creation: specs are data only, validated by one gate; a valid spec becomes a real, simulated catalogue part
// that saves with the project; the AI can design one but only through the same gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePartSpec, registerCustomPart, layoutSpec, PITCH, describeCustomSpecs } from '../src/core/custom-parts.js';
import { PART_DEFS } from '../src/core/parts.js';
import { compile } from '../src/core/netlist.js';
import { solveDrive } from '../src/core/solver.js';
import { toProjectFile, fromProjectFile } from '../src/core/project.js';
import { createAiService, buildPartPrompt } from '../server/ai-service.mjs';

const sound = {
  name: 'Sound sensor', label: 'KY-038', color: '#1d4ed8', pins: [{ id: 'VCC', side: 'bottom' }, { id: 'GND', side: 'bottom' }, { id: 'AO', label: 'Analog out', side: 'bottom' }, { id: 'DO', side: 'bottom' }],
  breadboard: true, behaviour: { kind: 'analog-sensor', roles: { vcc: 'VCC', gnd: 'GND', out: 'AO' } },
};

test('custom parts: the validator accepts a good spec, normalises it, and rejects anything unusable with plain reasons', () => {
  const v = validatePartSpec({ ...sound, onLoad: 'alert(1)', id: 'custom-sound-1' });
  assert.ok(v.ok, v.errors?.join());
  assert.equal(v.spec.id, 'custom-sound-1'); assert.equal(v.spec.onLoad, undefined, 'unknown fields are dropped');
  assert.equal(v.spec.pins[2].label, 'Analog out'); assert.equal(v.spec.pins[3].label, 'DO');
  const bad = validatePartSpec({ name: '<b>x</b>', pins: [{ id: 'A' }, { id: 'a' }, { id: 'bad pin!' }], behaviour: { kind: 'eval', roles: {} } });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some(e => /Two pins/.test(e)) && bad.errors.some(e => /Pin name/.test(e)) && bad.errors.some(e => /Unknown behaviour/.test(e)));
  assert.equal(validatePartSpec({ name: 'x', pins: [{ id: 'A' }], behaviour: { kind: 'resistor', roles: { a: 'A', b: 'A' }, ohms: 5 } }).ok, false, 'one pin, two roles');
  assert.ok(validatePartSpec({ ...sound, breadboard: true, pins: [...sound.pins, { id: 'X', side: 'left' }] }).errors.some(e => /breadboard/.test(e)));
  assert.equal(validatePartSpec({ ...sound, name: 'a<script>b' }).spec.name, 'ascriptb');
});

test('custom parts: pins sit on the 0.1" grid so they plug into a breadboard', () => {
  const { pins, w, h } = layoutSpec(validatePartSpec(sound).spec);
  assert.ok(pins.every(p => Math.abs(p.y - (h - 3)) < 1e-9));
  for (let i = 1; i < pins.length; i++) assert.ok(Math.abs(pins[i].x - pins[i - 1].x - PITCH) < 1e-9);
  assert.ok(w >= 76);
});

test('custom parts: behaviours are simulated — analog sensor output follows its slider, a resistor load draws current, an LED lights', () => {
  const s = validatePartSpec({ ...sound, id: 'custom-sound-t' }).spec; registerCustomPart(s);
  const W = (id, a, ap, b, bp) => ({ id, a: { part: a, pin: ap }, b: { part: b, pin: bp }, style: 'straight', color: '#000', width: 2 });
  const parts = [{ id: 'uno-1', type: 'arduino-uno', x: 0, y: 0, rot: 0 }, { id: 'snd', type: s.id, x: 500, y: 0, rot: 0, level: 30 }];
  const wires = [W('1', 'uno-1', '5V', 'snd', 'VCC'), W('2', 'uno-1', 'GND.1', 'snd', 'GND'), W('3', 'uno-1', 'A0', 'snd', 'AO')];
  let c = compile({ parts, wires });
  let r = solveDrive(c, { pins: new Map(), pressed: new Set(), duty: new Map() });
  const a0 = c.uno.pins.find(p => p.name === 'A0').net;
  assert.ok(Math.abs(r.voltage(a0) - 1.5) < 0.05, `30 % of 5 V: ${r.voltage(a0)}`);
  c = compile({ parts: [parts[0], { ...parts[1], level: 80 }], wires });
  assert.ok(Math.abs(solveDrive(c, { pins: new Map(), pressed: new Set(), duty: new Map() }).voltage(a0) - 4) < 0.05);
  // unpowered → no output
  c = compile({ parts, wires: wires.slice(1) });
  assert.ok((solveDrive(c, { pins: new Map(), pressed: new Set(), duty: new Map() }).voltage(a0) ?? 0) < 0.1);

  const lamp = validatePartSpec({ name: 'Indicator', pins: [{ id: '+', side: 'left' }, { id: '-', side: 'right' }], behaviour: { kind: 'led', roles: { anode: '+', cathode: '-' }, color: 'green' } }).spec;
  registerCustomPart(lamp);
  const res = { id: 'r', type: 'resistor', x: 0, y: 300, rot: 0, ohms: 220 };
  c = compile({ parts: [parts[0], { id: 'L', type: lamp.id, x: 300, y: 300, rot: 0 }, res], wires: [W('a', 'uno-1', '13', 'r', '1'), W('b', 'r', '2', 'L', '+'), W('c', 'L', '-', 'uno-1', 'GND.1')] });
  r = solveDrive(c, { pins: new Map([['13', 'H']]), pressed: new Set(), duty: new Map() });
  assert.ok(r.ledCurrent.get('L') > 0.008, `lit: ${r.ledCurrent.get('L')}`);
});

test('custom parts travel inside the project file and come back in a fresh catalogue; the AI prompt lists them', () => {
  const s = validatePartSpec({ ...sound, id: 'custom-travel-1' }).spec; registerCustomPart(s);
  const file = toProjectFile({ parts: [{ id: 'snd', type: s.id, x: 1, y: 2, rot: 0, level: 64 }], wires: [] });
  assert.equal(file.customParts[0].id, s.id);
  delete PART_DEFS[s.id];
  const back = fromProjectFile(JSON.parse(JSON.stringify(file)));
  assert.ok(PART_DEFS[s.id]?.custom); assert.equal(back.parts[0].level, 64);
  // a tampered spec in a file is refused (and so is the part that uses it)
  const evil = JSON.parse(JSON.stringify(file)); evil.customParts[0].id = 'custom-evil-1'; evil.customParts[0].behaviour.kind = 'script'; evil.parts[0].type = 'custom-evil-1';
  assert.throws(() => fromProjectFile(evil), /Unknown part type/);
  assert.match(describeCustomSpecs(file.customParts), /custom-travel-1: pins VCC, GND, AO, DO props: level — "Sound sensor"/);
});

test('AI part creation: the reply must pass the validator; one repair round with the reasons; never code', async () => {
  const replies = [
    '```json\n' + JSON.stringify({ name: 'KY-038', sizeMm: { w: 34, h: 16 }, imageUrls: ['https://example.com/ky038.jpg'] }) + '\n```',      // the photo lookup
    '```json\n' + JSON.stringify({ ...sound, behaviour: { kind: 'analog-sensor', roles: { vcc: 'VCC', gnd: 'GND', out: 'NOPE' } } }) + '\n```',
    '```json\n' + JSON.stringify({ ...sound, note: 'DO is not simulated' }) + '\n```',
  ];
  const prompts = [];
  const bodies = [];
  const fetchImpl = async (_u, o) => { const b = JSON.parse(o.body); bodies.push(b); prompts.push(b.contents[0].parts[0].text); const text = replies.shift(); return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] }, groundingMetadata: { groundingChunks: [{ web: { title: 'KY-038 datasheet', uri: 'https://example.com/ky038' } }] } }] }) }; };
  const ai = createAiService({ fetchImpl, photoFetch: async () => ({ type: 'image/jpeg', bytes: new Uint8Array(5000), url: 'https://example.com/ky038.jpg' }) });
  const r = await ai.createPart({ description: 'KY-038 sound sensor', userKey: 'k' });
  assert.equal(r.ok, true); assert.equal(r.spec.name, 'Sound sensor'); assert.equal(r.note, 'DO is not simulated');
  assert.equal(prompts.length, 3, 'photo lookup, first try, repair');
  assert.deepEqual(bodies[0].tools, [{ google_search: {} }], 'the part lookup asks the model to search the web');
  assert.ok(bodies[1].contents[0].parts[1].inlineData?.data, 'the real photo goes to the model with the drawing request');
  assert.equal(r.photo.url, 'https://example.com/ky038.jpg'); assert.equal(r.photo.grounded, true);
  assert.deepEqual(r.sources, [{ title: 'KY-038 datasheet', url: 'https://example.com/ky038' }]);
  assert.match(prompts[2], /previous answer was rejected[\s\S]*Signal out: pick which pin/);
  assert.match(buildPartPrompt('x'), /look it up on the web/);
  assert.match(buildPartPrompt('x'), /no statements, no loops, no assignment/);
  await assert.rejects(ai.createPart({ description: '', userKey: 'k' }), /Describe the part/);
  await assert.rejects(ai.createPart({ description: 'x' }), /API key/);
});

const mux16 = () => ({
  name: 'CD74HC4067 16-channel mux', label: '74HC4067',
  pins: [...Array.from({ length: 16 }, (_, i) => ({ id: `C${i}`, side: 'left' })), ...['S0', 'S1', 'S2', 'S3', 'SIG', 'EN', 'VCC', 'GND'].map(id => ({ id, side: 'right' }))],
  behaviour: { kind: 'mux', roles: { vcc: 'VCC', gnd: 'GND', common: 'SIG', enable: 'EN' }, select: ['S0', 'S1', 'S2', 'S3'], channels: Array.from({ length: 16 }, (_, i) => `C${i}`) },
});

test('multiplexer behaviour: validated (select bits vs channel count, no pin with two jobs), accepts "S0, S1" text lists', () => {
  assert.ok(validatePartSpec(mux16()).ok, validatePartSpec(mux16()).errors?.join());
  const few = mux16(); few.behaviour.select = ['S0', 'S1'];
  assert.match(validatePartSpec(few).errors.join(), /2 select pins can only pick 4 channels, but there are 16/);
  const dup = mux16(); dup.behaviour.channels = ['C0', 'SIG'];
  assert.match(validatePartSpec(dup).errors.join(), /SIG already has another job/);
  const text = mux16(); text.behaviour.select = 'S0, S1, S2, S3'; delete text.behaviour.roles.enable;
  const v = validatePartSpec(text);
  assert.deepEqual(v.spec.behaviour.select, ['S0', 'S1', 'S2', 'S3']); assert.equal(v.spec.behaviour.roles.enable, undefined, 'EN is optional');
});

test('multiplexer behaviour: the select pins pick which channel reaches SIG; EN HIGH or no power disconnects it', () => {
  const s = validatePartSpec({ ...mux16(), id: 'custom-mux-t' }).spec; registerCustomPart(s);
  const W = (id, a, ap, b, bp) => ({ id, a: { part: a, pin: ap }, b: { part: b, pin: bp }, style: 'straight', color: '#000', width: 2 });
  const parts = [{ id: 'uno-1', type: 'arduino-uno', x: 0, y: 0, rot: 0 }, { id: 'mx', type: s.id, x: 500, y: 0, rot: 0 }, { id: 'pot', type: 'potentiometer', x: 900, y: 0, rot: 0, level: 30 }];
  const base = [W('p', 'uno-1', '5V', 'mx', 'VCC'), W('g', 'uno-1', 'GND.1', 'mx', 'GND'), W('sig', 'mx', 'SIG', 'uno-1', 'A0'),
    W('s0', 'uno-1', '2', 'mx', 'S0'), W('s1', 'uno-1', '3', 'mx', 'S1'), W('s2', 'uno-1', '4', 'mx', 'S2'), W('s3', 'uno-1', '5', 'mx', 'S3'), W('en', 'uno-1', '6', 'mx', 'EN'),
    W('c0', 'mx', 'C0', 'uno-1', '5V'), W('c5', 'mx', 'C5', 'pot', 'SIG'), W('pv', 'pot', 'VCC', 'uno-1', '5V'), W('pg', 'pot', 'GND', 'uno-1', 'GND.2')];
  const c = compile({ parts, wires: base });
  const a0 = c.uno.pins.find(p => p.name === 'A0').net;
  const read = sel => { const pins = new Map([['6', 'L']]); [2, 3, 4, 5].forEach((p, i) => pins.set(String(p), sel & (1 << i) ? 'H' : 'L')); return solveDrive(c, { pins, pressed: new Set(), duty: new Map() }); };
  let r = read(0);
  assert.ok(r.voltage(a0) > 4.9, `C0 = 5 V: ${r.voltage(a0)}`); assert.equal(r.muxChannels.get('mx'), 0);
  r = read(5);
  assert.ok(Math.abs(r.voltage(a0) - 1.5) < 0.1, `C5 = pot at 30 %: ${r.voltage(a0)}`);
  r = read(9);                                                  // C9: nothing there → floating
  assert.ok(Math.abs(r.voltage(a0) ?? 0) < 0.1);
  const off = solveDrive(c, { pins: new Map([['2', 'L'], ['3', 'L'], ['4', 'L'], ['5', 'L'], ['6', 'H']]), pressed: new Set(), duty: new Map() });
  assert.equal(off.muxChannels.get('mx'), -1, 'EN HIGH disables');
  const unpowered = compile({ parts, wires: base.filter(w => w.id !== 'p') });
  assert.equal(solveDrive(unpowered, { pins: new Map([['6', 'L']]), pressed: new Set(), duty: new Map() }).muxChannels.get('mx'), -1);
  assert.match(describeCustomSpecs([s]), /Select pins, S0 first: S0, S1, S2, S3/);
});

// ── the rules language ──────────────────────────────────────────────────
import { parseExpr, runExpr } from '../src/core/expr.js';
import { compileLogic, createLogicState, tickLogic, logicDrive } from '../src/core/logic.js';

test('expressions: arithmetic only — no code can reach out of one, however it is written', () => {
  const ctx = { get: n => ({ a: 3, b: 4 }[n] ?? 0), pin: () => 0 };
  assert.equal(runExpr('(a + b) * 2 % 10', ctx), 4);
  assert.equal(runExpr('a > b ? 1 : 0b101 & 0x3', ctx), 1);
  assert.equal(runExpr('clamp(a * 9, 0, 10) + min(a, b)', ctx), 13);
  assert.equal(runExpr('1 / 0', ctx), 0, 'no infinities leak out');
  for (const bad of ['fetch("x")', 'globalThis.x', 'A-B.C', 'a.constructor', 'a = 2', '[1,2]', '`x`', 'a ? 1', 'import(1)', '()=>1', 'eval(1)', 'a["b"]']) {
    assert.throws(() => parseExpr(bad), undefined, `${bad} is rejected`);
  }
  // A bare word like "window" is only ever a name to look up — there is no object behind it, and a part
  // that mentions one is refused when it's neither a pin nor one of its own memory values.
  assert.equal(runExpr('window + 1', { get: () => undefined, pin: () => 0 }), 1);
  assert.deepEqual([...parseExpr('window').names], ['window']);
  assert.throws(() => parseExpr('a'.padEnd(401, '+a')), /too long/);
  assert.throws(() => parseExpr('('.repeat(60) + '1' + ')'.repeat(60)), /too deeply/);
});

const sr595 = () => ({
  name: '74HC595 shift register', pins: ['VCC', 'GND', 'OE', 'MR', 'DS', 'SHCP', 'STCP', 'Q0', 'Q1', 'Q2'].map(id => ({ id })),
  behaviour: {
    kind: 'logic', roles: { vcc: 'VCC', gnd: 'GND', enable: 'OE' }, vars: { shift: 0, latch: 0 },
    rules: [{ when: '!MR', set: { shift: '0' } }, { when: 'rising(SHCP) && MR', set: { shift: '(shift * 2 + DS) % 256' } }, { when: 'rising(STCP)', set: { latch: 'shift' } }],
    outputs: { Q0: 'latch & 1', Q1: '(latch >> 1) & 1', Q2: '(latch >> 2) & 1' },
  },
});

test('rules parts: a 74HC595 written as rules really shifts, latches, clears and honours its enable pin', () => {
  const spec = validatePartSpec({ ...sr595(), id: 'custom-595-u' }).spec;
  const compiled = compileLogic(spec), state = createLogicState(compiled);
  const roles = spec.behaviour.roles;
  const v = { VCC: 5, GND: 0, OE: 0, MR: 5, DS: 0, SHCP: 0, STCP: 0 };
  const read = p => v[p] ?? null;
  const tick = () => tickLogic(compiled, state, roles, read);
  const out = () => { const d = logicDrive(compiled, state, roles, read); return ['Q0', 'Q1', 'Q2'].map(p => (d.has(p) ? (d.get(p) > 2.5 ? 1 : 0) : null)); };
  tick();
  for (const bit of [1, 0, 1]) { v.DS = bit * 5; v.SHCP = 0; tick(); v.SHCP = 5; tick(); }     // MSB first → 0b101
  assert.equal(state.vars.shift, 5);
  assert.deepEqual(out(), [0, 0, 0], 'nothing on the outputs until it is latched');
  v.STCP = 0; tick(); v.STCP = 5; tick();
  assert.equal(state.vars.latch, 5);
  assert.deepEqual(out(), [1, 0, 1]);
  v.OE = 5;
  assert.deepEqual(out(), [null, null, null], 'OE HIGH lets the outputs go');
  v.OE = 0; v.MR = 0; tick();
  assert.equal(state.vars.shift, 0, 'MR LOW clears it');
  v.VCC = 0; tick();
  assert.deepEqual(out(), [null, null, null]);
  assert.deepEqual(state.vars, { shift: 0, latch: 0 }, 'losing power forgets everything');
});

test('rules parts: a NAND gate needs no memory, and a bad rule is reported rather than loaded', () => {
  const nand = validatePartSpec({ name: '74HC00', pins: ['VCC', 'GND', 'A', 'B', 'Y'].map(id => ({ id })), behaviour: { kind: 'logic', roles: { vcc: 'VCC', gnd: 'GND' }, outputs: { Y: '!(A && B)' } } });
  assert.ok(nand.ok, nand.errors?.join());
  const compiled = compileLogic(nand.spec), state = createLogicState(compiled);
  const v = { VCC: 5, GND: 0, A: 5, B: 5 };
  const drive = () => logicDrive(compiled, state, { vcc: 'VCC', gnd: 'GND' }, p => v[p] ?? null).get('Y');
  assert.ok(drive() < 0.5); v.B = 0; assert.ok(drive() > 4.5);
  const bad = validatePartSpec({ name: 'x', pins: ['VCC', 'GND', 'Y'].map(id => ({ id })), behaviour: { kind: 'logic', roles: { vcc: 'VCC', gnd: 'GND' }, vars: { n: 0 }, rules: [{ when: 'rising(NOPE)', set: { missing: '1' } }], outputs: { Y: 'n', GND: '1' } } });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some(e => /no pin called “NOPE”/.test(e)), bad.errors.join());
  assert.ok(bad.errors.some(e => /“missing” isn't one of this part's memory values/.test(e)));
  assert.ok(bad.errors.some(e => /GND is the power pin/.test(e)));
});

test('rules parts: wired to an Arduino, the shift register drives a real LED from the solver', () => {
  const spec = validatePartSpec({ ...sr595(), id: 'custom-595-s' }).spec;
  registerCustomPart(spec);
  const compiled = compileLogic(spec), state = createLogicState(compiled);
  const W = (id, a, ap, b, bp) => ({ id, a: { part: a, pin: ap }, b: { part: b, pin: bp }, style: 'straight', color: '#000', width: 2 });
  const parts = [{ id: 'uno-1', type: 'arduino-uno', x: 0, y: 0, rot: 0 }, { id: 'sr', type: spec.id, x: 500, y: 0, rot: 0 },
    { id: 'r', type: 'resistor', x: 900, y: 0, rot: 0, ohms: 220 }, { id: 'led', type: 'led', x: 1100, y: 0, rot: 0, color: 'red' }];
  const c = compile({
    parts,
    wires: [W('v', 'uno-1', '5V', 'sr', 'VCC'), W('g', 'uno-1', 'GND.1', 'sr', 'GND'), W('oe', 'uno-1', 'GND.2', 'sr', 'OE'), W('mr', 'uno-1', '5V', 'sr', 'MR'),
      W('d', 'uno-1', '2', 'sr', 'DS'), W('c1', 'uno-1', '3', 'sr', 'SHCP'), W('l', 'uno-1', '4', 'sr', 'STCP'),
      W('q', 'sr', 'Q0', 'r', '1'), W('rl', 'r', '2', 'led', 'A'), W('lg', 'led', 'C', 'uno-1', 'GND.3')],
  });
  const logic = new Map([['sr', { compiled, state }]]);
  let res = null;
  const read = pin => (res ? res.voltage(c.netOf('sr', pin)) : pin === 'VCC' || pin === 'MR' ? 5 : 0);
  const set = pins => { res = solveDrive(c, { pins: new Map(Object.entries(pins)), pressed: new Set(), duty: new Map(), logic }); tickLogic(compiled, state, spec.behaviour.roles, read); res = solveDrive(c, { pins: new Map(Object.entries(pins)), pressed: new Set(), duty: new Map(), logic }); };
  set({ 2: 'H', 3: 'L', 4: 'L' }); set({ 2: 'H', 3: 'H', 4: 'L' });        // shift a 1 in
  assert.ok((res.ledCurrent.get('led') || 0) < 1e-5, 'not latched yet');
  set({ 2: 'L', 3: 'L', 4: 'L' }); set({ 2: 'L', 3: 'L', 4: 'H' });        // latch
  assert.ok(res.ledCurrent.get('led') > 0.008, `Q0 lights the LED: ${res.ledCurrent.get('led')}`);
  assert.equal(res.logicOut.get('sr').get('Q0') > 2.5, true);
});

test('DIP packages: pins land in two rows 0.3" apart in datasheet order, so a chip straddles the breadboard trench', () => {
  const ids = ['CH4', 'CH6', 'COM', 'CH7', 'CH5', 'INH', 'VEE', 'VSS', 'C', 'B', 'A', 'CH3', 'CH0', 'CH1', 'CH2', 'VDD'];
  const v = validatePartSpec({ name: 'CD4051', package: 'dip', pins: ids.map(id => ({ id })), behaviour: { kind: 'mux', roles: { vcc: 'VDD', gnd: 'VSS', common: 'COM', enable: 'INH' }, select: ['A', 'B', 'C'], channels: ['CH0', 'CH1', 'CH2', 'CH3', 'CH4', 'CH5', 'CH6', 'CH7'] } });
  assert.ok(v.ok, v.errors?.join());
  assert.equal(v.spec.breadboard, true, 'a DIP always plugs in');
  const { pins, h } = layoutSpec(v.spec);
  const at = id => pins.find(p => p.id === id);
  assert.equal(at('CH4').side, 'bottom'); assert.equal(at('VSS').side, 'bottom');     // pins 1–8 along the bottom
  assert.equal(at('C').side, 'top'); assert.equal(at('VDD').side, 'top');             // 9–16 back along the top
  assert.equal(at('CH4').x, at('VDD').x, 'pin 1 and pin 16 face each other');
  assert.equal(at('VSS').x, at('C').x, 'pin 8 and pin 9 face each other');
  assert.ok(Math.abs(at('CH4').y - at('VDD').y - 3 * PITCH) < 1e-6, '0.3 inch between the rows');
  assert.equal(+(at('CH6').x - at('CH4').x).toFixed(2), PITCH, '0.1 inch along a row');
  assert.ok(h >= 3 * PITCH, 'the body spans both rows');
  // the shape is enforced, so a chip can't come back as one long comb of pins again
  assert.match(validatePartSpec({ name: 'x', package: 'dip', pins: ids.slice(0, 15).map(id => ({ id })), behaviour: { kind: 'none' } }).errors.join(), /same number of pins on each side/);
  assert.match(validatePartSpec({ name: 'x', package: 'dip', pins: [{ id: 'A' }, { id: 'B' }], behaviour: { kind: 'none' } }).errors.join(), /at least 4 pins/);
  // a module is unchanged: a single header row along the bottom
  const mod = validatePartSpec({ name: 'm', breadboard: true, pins: [{ id: 'VCC' }, { id: 'GND' }], behaviour: { kind: 'none' } });
  assert.equal(mod.spec.package, 'module');
  assert.ok(layoutSpec(mod.spec).pins.every(p => p.side === 'bottom'));
});

test('quad flat packs: pins run anticlockwise from the top of the left side, on all four sides, and never plug in', () => {
  const ids = Array.from({ length: 32 }, (_, i) => `P${i + 1}`);
  const v = validatePartSpec({ name: 'MPU', package: 'quad', pins: ids.map(id => ({ id })), behaviour: { kind: 'none' } });
  assert.ok(v.ok, v.errors?.join());
  assert.equal(v.spec.breadboard, false, 'surface mount: it has no legs to push into a board');
  const { pins, w, h } = layoutSpec(v.spec);
  assert.equal(w, h, 'a quad package is square');
  const at = n => pins[n - 1];
  assert.deepEqual([1, 8, 9, 16, 17, 24, 25, 32].map(n => at(n).side), ['left', 'left', 'bottom', 'bottom', 'right', 'right', 'top', 'top']);
  assert.ok(at(1).y < at(8).y, 'pin 1 at the top of the left side, running down');
  assert.ok(at(9).x < at(16).x, 'the bottom runs left to right');
  assert.ok(at(17).y > at(24).y, 'the right side runs back up');
  assert.ok(at(25).x > at(32).x, 'the top runs right to left');
  assert.ok(Math.abs(at(1).x - at(8).x) < 1e-9 && Math.abs(at(2).y - at(1).y - PITCH) < 1e-9, 'one side is a straight 0.1" column');
  assert.equal(at(1).x, 3); assert.equal(at(9).y, h - 3);                      // legs sit on the edges
  // the shape is enforced, so a processor can't come back as a comb or a lopsided chip
  assert.match(validatePartSpec({ name: 'x', package: 'quad', pins: ids.slice(0, 30).map(id => ({ id })), behaviour: { kind: 'none' } }).errors.join(), /divide by 4/);
  assert.match(validatePartSpec({ name: 'x', package: 'quad', pins: ids.slice(0, 4).map(id => ({ id })), behaviour: { kind: 'none' } }).errors.join(), /at least 8 pins/);
});

test('wide DIPs: a 40-pin chip gets 0.6" between its rows, so it still lands on breadboard holes', () => {
  const v = validatePartSpec({ name: 'ATmega328P', package: 'dip-wide', pins: Array.from({ length: 40 }, (_, i) => ({ id: `P${i + 1}` })), behaviour: { kind: 'none' } });
  assert.ok(v.ok, v.errors?.join());
  assert.equal(v.spec.breadboard, true);
  const { pins } = layoutSpec(v.spec);
  assert.ok(Math.abs(pins[0].y - pins[39].y - 6 * PITCH) < 1e-6, '0.6 inch between the rows');
  assert.equal(pins[0].side, 'bottom'); assert.equal(pins[39].side, 'top');
  const gaps = (pins[0].y - pins[39].y) / PITCH;
  assert.ok(Math.abs(gaps - Math.round(gaps)) < 1e-9, 'a whole number of hole pitches apart, so both rows land on holes');
});
