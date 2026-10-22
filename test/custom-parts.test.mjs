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
