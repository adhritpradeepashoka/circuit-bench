import test from 'node:test';
import assert from 'node:assert/strict';
import { runProgram, runForCircuit } from '../src/core/bench-lang.js';
import { APP_OPS } from '../src/core/app-ops.js';
import { sketchFor } from '../src/core/sketches.js';
import { runAppOps } from '../src/ui/app-ops.js';
import { runSteps } from '../src/core/ai-steps.js';
import fs from 'node:fs';

const circuit = {
  parts: [{ id: 'uno-1', type: 'arduino-uno', x: 0, y: 0 }, { id: 'led-1', type: 'led', x: 100, y: 100, rotate: 90 }, { id: 'resistor-1', type: 'resistor', x: 200, y: 100 }],
  wires: [{ id: 'w1', from: { part: 'uno-1', pin: '9' }, to: { part: 'resistor-1', pin: '1' } }, { id: 'w2', from: { part: 'resistor-1', pin: '2' }, to: { part: 'led-1', pin: 'A' } }],
};

test('app commands only accept names from the table', () => {
  for (const name of Object.keys(APP_OPS)) assert.deepEqual(runProgram(`app ${name}`, circuit).appOps, [name]);
  assert.equal(runProgram('app formatdisk', circuit), null);
  assert.equal(runProgram('app run stop', circuit), null);
  assert.deepEqual(runProgram('app run; app zoomin; app run', circuit).appOps, ['run', 'zoomin']);
});

test('every app op points at a button that exists in index.html (or an event the editor emits)', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const [name, d] of Object.entries(APP_OPS)) if (d.click) assert.ok(html.includes(`id="${d.click}"`), `${name}: no #${d.click} in index.html`);
});

test('rotate, move and unwire become real circuit actions', () => {
  assert.deepEqual(runProgram('rotate led-1', circuit).actions, [{ op: 'rotate_part', id: 'led-1', rotate: 180 }]);
  assert.deepEqual(runProgram('rotate led-1 270', circuit).actions, [{ op: 'rotate_part', id: 'led-1', rotate: 0 }]);
  assert.equal(runProgram('rotate led-1 33', circuit), null);
  assert.deepEqual(runProgram('move resistor-1 left 2', circuit).actions, [{ op: 'move_part', id: 'resistor-1', x: 40, y: 100 }]);
  assert.equal(runProgram('move resistor-1 sideways', circuit), null);
  assert.deepEqual(runProgram('unwire resistor-1', circuit).actions.map(a => a.id), ['w1', 'w2']);
  assert.deepEqual(runProgram('unwire resistor-1 1', circuit).actions.map(a => a.id), ['w1']);
  assert.deepEqual(runProgram('unwire all', circuit).actions.map(a => a.id), ['w1', 'w2']);
  assert.match(runProgram('unwire led-1 C', circuit).explanation, /no wires/i);
});

test('wire ids survive the numbered-id adapter', () => {
  const real = { parts: [{ id: 'led-k3j2a', type: 'led', x: 0, y: 0 }, { id: 'resistor-9x', type: 'resistor', x: 5, y: 5 }], wires: [{ id: 'wire-abc', from: { part: 'resistor-9x', pin: '2' }, to: { part: 'led-k3j2a', pin: 'A' } }] };
  const r = runForCircuit('unwire led; rotate resistor; app run', real);
  assert.deepEqual(r.actions, [{ op: 'remove_wire', id: 'wire-abc' }, { op: 'rotate_part', id: 'resistor-9x', rotate: 90 }]);
  assert.deepEqual(r.appOps, ['run']);
});

test('ready-made sketches check their pins', () => {
  assert.match(sketchFor('fade', '9'), /analogWrite\(9/);
  assert.equal(sketchFor('fade', '7'), null);                       // pin 7 has no PWM
  assert.match(sketchFor('sweep', '10'), /Servo/);
  assert.equal(sketchFor('sweep', '99'), null);
  assert.match(sketchFor('tone', 'A1'), /tone\(A1/);
  assert.match(sketchFor('hello'), /Serial\.println/);
  assert.equal(sketchFor('weird', '9'), null);
  const r = runProgram('sketch fade 9; app run', circuit);
  assert.match(r.code, /analogWrite/); assert.deepEqual(r.appOps, ['run']);
  assert.equal(runProgram('sketch fade 7', circuit), null);
});

test('runAppOps presses only buttons that exist and are enabled', () => {
  const pressed = [], emitted = [];
  const doc = { getElementById: id => id === 'runBtn' ? { click: () => pressed.push(id) } : id === 'simStop' ? { disabled: true, click: () => pressed.push(id) } : null };
  const r = runAppOps(['run', 'stop', 'zoomin', 'partmaker', 'nonsense'], { doc, editor: { emit: e => emitted.push(e) } });
  assert.deepEqual(pressed, ['runBtn']); assert.deepEqual(emitted, ['create-part']);
  assert.deepEqual(r.done, ['run', 'partmaker']); assert.deepEqual(r.missing, ['stop', 'zoomin', 'nonsense']);
});

test('a multi-step request keeps the app buttons from every step', async () => {
  const step = async (instr, cur, code, i) => i === 0 ? { ok: true, actions: [{ op: 'add_part', id: 'led9', type: 'led' }] } : { ok: true, appOps: ['run'], explanation: 'x' };
  const r = await runSteps({ instruction: 'add an led and run it', steps: ['add an led', 'run it'], circuit: { parts: [], wires: [] }, step });
  assert.deepEqual(r.appOps, ['run']); assert.equal(r.actions.length, 1);
});

import { looksLikeAppRequest } from '../src/core/app-intent.js';
test('app requests skip the part rules; part requests do not', () => {
  for (const t of ['wipe the serial monitor', 'switch project', 'run it', 'zoom in', 'undo that', 'show the code', 'mute the buzzer', 'export my project', 'remove all wires', 'rotate the dht22 90 degrees',
    'check my sketch for errors', 'open the part maker', 'clear the code', 'pause the simulation', 'disconnect the led', 'move the led left 2 steps', 'switch to blocks'])
    assert.ok(looksLikeAppRequest(t), t);
  for (const t of ['add an led', 'add a 3s 2200mah lipo pack', 'add a slide switch', 'make the led blink', 'build a plane with an edf', 'set the resistor to 1k', 'remove the resistor', 'add 3 buzzers',
    'put one 2s battery pack 2600mah in this sketch', 'wire up an led on pin 9', 'make it blink faster', 'add a servo and connect it to pin 9', 'add a motor driver'])
    assert.ok(!looksLikeAppRequest(t), t);
});

import { looksLikeQuestion } from '../src/core/app-intent.js';
test('questions are told apart from requests', () => {
  for (const t of ['why wont the simulation start', 'how do i export my project?', 'what does the compile button do', 'where is the serial monitor', 'is the simulation accurate']) assert.ok(looksLikeQuestion(t), t);
  for (const t of ['run it', 'start the simulation', 'zoom in', 'can you run it', 'whats new in circuitbench', 'export my project', 'open the serial monitor']) assert.ok(!looksLikeQuestion(t), t);
});

import { asksMoreThanAButton } from '../src/core/app-intent.js';
test('a request for more than the button does is not answered by pressing it', () => {
  for (const t of ['can you make my simulation run faster', 'run it for ten minutes', 'zoom in twice', 'run it at double speed']) assert.ok(asksMoreThanAButton(t), t);
  for (const t of ['run my circuit please', 'zoom in a little', 'open the serial monitor', 'export this project']) assert.ok(!asksMoreThanAButton(t), t);
});
