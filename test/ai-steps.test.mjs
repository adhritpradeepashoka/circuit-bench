import test from 'node:test'; import assert from 'node:assert/strict';
import { looksBig, parsePlan, runSteps, stepInstruction } from '../src/core/ai-steps.js';

test('looksBig: short asks are not, long or multi-part asks are', () => {
  assert.equal(looksBig('add an LED'), false);
  assert.equal(looksBig('add 8 LEDs and 8 resistors, then wire them, then write a sketch that chases them'), true);
  assert.equal(looksBig('build the whole traffic light project'), false);
});
test('parsePlan reads JSON, a fenced reply, or numbered lines, and caps the length', () => {
  assert.deepEqual(parsePlan('{"steps":["add an LED","wire it"]}'), ['add an LED', 'wire it']);
  assert.deepEqual(parsePlan('```json\n{"steps":["add an LED"]}\n```'), ['add an LED']);
  assert.deepEqual(parsePlan('1. add an LED\n2. wire it to pin 13'), ['add an LED', 'wire it to pin 13']);
  assert.equal(parsePlan(JSON.stringify({ steps: Array.from({ length: 30 }, (_, i) => `step number ${i}`) })).length, 12);
});
test('runSteps: each step sees the circuit the last one left, results join up, and a failure keeps the finished steps', async () => {
  const seen = [];
  const step = async (ins, cur, code, i) => {
    seen.push(cur.parts.length);
    if (i === 2) return { ok: false, error: 'model got confused' };
    return { ok: true, actions: [{ op: 'add_part', id: `r${i}`, type: 'resistor', x: 100 * i, y: 100 }], code: i === 1 ? 'void setup(){}' : null };
  };
  const r = await runSteps({ instruction: 'big', steps: ['a thing', 'b thing', 'c thing'], circuit: { parts: [], wires: [] }, step });
  assert.deepEqual(seen, [0, 1, 2]);
  assert.equal(r.ok, true); assert.equal(r.done, 2); assert.equal(r.actions.length, 2); assert.equal(r.code, 'void setup(){}');
  assert.match(r.explanation, /stopped at step 3/);
  assert.match(stepInstruction('big', ['x1 step', 'y2 step'], 1, ['did x1.']), /part 2 of 2[\s\S]*did x1[\s\S]*y2 step/);
});
test('runSteps: a first-step failure is not ok', async () => {
  const r = await runSteps({ instruction: 'big', steps: ['one thing'], circuit: {}, step: async () => ({ ok: false, error: 'no' }) });
  assert.equal(r.ok, false);
});
