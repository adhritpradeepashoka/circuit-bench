// src/core/ai-actions.js — turns the AI's proposed circuit edits into a new project. Pure/DOM-free, so
// it's exercised directly here (same way it runs server-side and in the browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCircuitActions, describeCatalog } from '../src/core/ai-actions.js';
import { compile } from '../src/core/netlist.js';
import { fromProjectFile } from '../src/core/project.js';

// applyCircuitActions takes and returns the project-file shape — the same shape editor.exportProject()
// produces and fromProjectFile()/editor.importProject() consume, parts' rotation included ("rotate",
// not "rot" — a prior version of this fixture used "rot", which matched the old (buggy) implementation
// but not what production actually sends it; a part the AI's actions never touched then had its real
// rotation silently zeroed on import, since ai-panel.js's own "rotate: p.rot" remap turned it into
// "rotate: undefined" for every untouched part).
const BASE = { parts: [{ id: 'uno-1', type: 'arduino-uno', x: 40, y: 56, rotate: 0 }, { id: 'bb-1', type: 'breadboard', x: 360, y: 78, rotate: 0 }], wires: [] };

/** applyCircuitActions returns project-file shape (wires use from/to); compile() wants live-state shape (a/b) — go through fromProjectFile like editor.importProject() really does. */
const toLiveState = ({ parts, wires }) => fromProjectFile({
  format: 'virtual-lab', version: '0.1',
  parts,
  wires: wires.map(w => ({ id: w.id, from: w.from, to: w.to, style: w.style, color: w.color, width: w.width, bend: w.bend, sag: w.sag })),
});

test('add_part + add_wire: a new LED wired straight to D13 and GND ends up on the same two nets as the Uno', () => {
  const actions = [
    { op: 'add_part', id: 'led1', type: 'led', props: { color: 'blue' } },
    { op: 'add_wire', from: { part: 'uno-1', pin: '13' }, to: { part: 'led1', pin: 'A' } },
    { op: 'add_wire', from: { part: 'led1', pin: 'C' }, to: { part: 'uno-1', pin: 'GND.1' } },
  ];
  const result = applyCircuitActions(BASE, actions);
  assert.deepEqual(result.warnings, []);
  const led = result.parts.find(p => p.id === 'led1');
  assert.equal(led.color, 'blue');
  // Wired directly (no breadboard involved) still has to show up as real electrical nets.
  const { netOf } = compile(toLiveState(result));
  assert.equal(netOf('led1', 'A'), netOf('uno-1', '13'));
  assert.equal(netOf('led1', 'C'), netOf('uno-1', 'GND.1'));
});

test('a made-up part type or pin name is dropped with a warning, not applied', () => {
  const { parts, wires, warnings } = applyCircuitActions(BASE, [
    { op: 'add_part', id: 'x1', type: 'flux-capacitor' },
    { op: 'add_wire', from: { part: 'uno-1', pin: 'not-a-real-pin' }, to: { part: 'bb-1', pin: 'A1' } },
  ]);
  assert.equal(parts.length, BASE.parts.length);
  assert.equal(wires.length, 0);
  assert.equal(warnings.length, 2);
});

test('duplicate ids are deduped, and a later action in the same batch that reuses the requested id follows the rename (the AI meant "the part I just added")', () => {
  const project = { parts: [...BASE.parts, { id: 'led1', type: 'led', x: 0, y: 0, rotate: 0, color: 'red' }], wires: [] };
  const { parts } = applyCircuitActions(project, [
    { op: 'add_part', id: 'led1', type: 'led' },             // collides with the pre-existing led1 -> renamed to led1-2
    { op: 'set_prop', id: 'led1', key: 'color', value: 'green' }, // the AI still calls it "led1" — follows the remap to the part it just added
  ]);
  assert.equal(parts.filter(p => p.type === 'led').length, 2);
  assert.equal(parts.find(p => p.id === 'led1').color, 'red');       // the original is untouched
  assert.equal(parts.find(p => p.id === 'led1-2').color, 'green');   // the new one got the edit
});

test('remove_part also removes any wire touching it', () => {
  const project = {
    parts: [...BASE.parts, { id: 'led1', type: 'led', x: 0, y: 0, rotate: 0 }],
    wires: [{ id: 'w1', from: { part: 'uno-1', pin: '13' }, to: { part: 'led1', pin: 'A' }, style: 'straight', color: '#000', width: 3, bend: .5, sag: null }],
  };
  const { parts, wires } = applyCircuitActions(project, [{ op: 'remove_part', id: 'led1' }]);
  assert.equal(parts.some(p => p.id === 'led1'), false);
  assert.equal(wires.length, 0);
});

test('move_part / rotate_part / remove_wire', () => {
  const project = {
    parts: [...BASE.parts, { id: 'led1', type: 'led', x: 0, y: 0, rotate: 0 }],
    wires: [{ id: 'w1', from: { part: 'uno-1', pin: '13' }, to: { part: 'led1', pin: 'A' }, style: 'straight', color: '#000', width: 3, bend: .5, sag: null }],
  };
  const { parts, wires } = applyCircuitActions(project, [
    { op: 'move_part', id: 'led1', x: 200, y: 150 },
    { op: 'rotate_part', id: 'led1', rotate: 90 },
    { op: 'remove_wire', id: 'w1' },
  ]);
  const led = parts.find(p => p.id === 'led1');
  assert.equal(led.x, 200); assert.equal(led.y, 150); assert.equal(led.rotate, 90);
  assert.equal(wires.length, 0);
});

test('a part the actions never touch keeps its real rotation through the round trip (regression: used to silently zero it)', () => {
  const project = { parts: [{ id: 'uno-1', type: 'arduino-uno', x: 40, y: 56, rotate: 90 }], wires: [] };
  const { parts } = applyCircuitActions(project, [{ op: 'add_part', id: 'led1', type: 'led' }]);
  assert.equal(parts.find(p => p.id === 'uno-1').rotate, 90);
  const imported = fromProjectFile({ format: 'virtual-lab', version: '0.1', parts, wires: [] });
  assert.equal(imported.parts.find(p => p.id === 'uno-1').rot, 90);
});

test('an add_part with no x/y does not collide with existing parts, and the result still imports cleanly through fromProjectFile', () => {
  const { parts, wires } = applyCircuitActions(BASE, [{ op: 'add_part', id: 'led1', type: 'led' }, { op: 'add_part', id: 'led2', type: 'led' }]);
  const led1 = parts.find(p => p.id === 'led1'), led2 = parts.find(p => p.id === 'led2');
  assert.notDeepEqual([led1.x, led1.y], [led2.x, led2.y]);
  const imported = fromProjectFile({ format: 'virtual-lab', version: '0.1', parts, wires: wires.map(w => ({ id: w.id, from: w.from, to: w.to, style: w.style, color: w.color, width: w.width, bend: w.bend, sag: w.sag })) });
  assert.equal(imported.parts.length, parts.length);
});

test('describeCatalog mentions every part type and the breadboard rail/hole naming', () => {
  const text = describeCatalog();
  for (const t of ['arduino-uno', 'breadboard', 'led', 'resistor', 'pushbutton']) assert.match(text, new RegExp(t));
  assert.match(text, /TP1-25/);
});

test('actions is tolerant of junk input instead of throwing', () => {
  assert.doesNotThrow(() => applyCircuitActions(BASE, null));
  assert.doesNotThrow(() => applyCircuitActions(BASE, [null, 42, { op: 'add_part' }, { op: 'nonsense' }]));
  const { warnings } = applyCircuitActions(BASE, [null, { op: 'add_part' }]);
  assert.ok(warnings.length >= 1);
});
