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
    '```json\n' + JSON.stringify({ ...sound, behaviour: { kind: 'analog-sensor', roles: { vcc: 'VCC', gnd: 'GND', out: 'NOPE' } } }) + '\n```',
    '```json\n' + JSON.stringify({ ...sound, note: 'DO is not simulated' }) + '\n```',
  ];
  const prompts = [];
  const fetchImpl = async (_u, o) => { prompts.push(JSON.parse(o.body).contents[0].parts[0].text); const text = replies.shift(); return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) }; };
  const ai = createAiService({ fetchImpl });
  const r = await ai.createPart({ description: 'KY-038 sound sensor', userKey: 'k' });
  assert.equal(r.ok, true); assert.equal(r.spec.name, 'Sound sensor'); assert.equal(r.note, 'DO is not simulated');
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /previous answer was rejected[\s\S]*Signal out: pick which pin/);
  assert.match(buildPartPrompt('x'), /cannot write code/);
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
