// Learned recipes: the bigger AI's sketch becomes a template that only keeps if every check passes; the instant tier then rebuilds it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
globalThis.HTMLElement ||= class {};
const L = await import('../src/core/learned.js');
const { recipeEdit } = await import('../src/core/recipes.js');
const { plan } = await import('../src/core/hookup/plan.js');
const { applyCircuitActions } = await import('../src/core/ai-actions.js');

const EMPTY = () => ({ format: 'virtual-lab', version: 1, parts: [], wires: [] });
const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/firmware.json', import.meta.url)), 'utf8'));

/** What a bigger AI might hand back: its own circuit (its own pin choices) and its own sketch. */
const aiBench = () => ({
  format: 'virtual-lab', version: 1,
  parts: [{ id: 'u', type: 'arduino-uno', x: 0, y: 0, rotate: 0 }, { id: 'pb', type: 'pushbutton', x: 200, y: 0, rotate: 0 }, { id: 'l', type: 'led', x: 200, y: 100, rotate: 0 }, { id: 'r', type: 'resistor', x: 300, y: 100, rotate: 0, ohms: 220 }],
  wires: [
    { id: 'w1', from: { part: 'pb', pin: '1.l' }, to: { part: 'u', pin: '2' } }, { id: 'w2', from: { part: 'pb', pin: '2.l' }, to: { part: 'u', pin: 'GND.1' } },
    { id: 'w3', from: { part: 'l', pin: 'A' }, to: { part: 'r', pin: '1' } }, { id: 'w4', from: { part: 'r', pin: '2' }, to: { part: 'u', pin: '8' } }, { id: 'w5', from: { part: 'l', pin: 'C' }, to: { part: 'u', pin: 'GND.1' } },
  ],
});

test('keywords: what is wanted, without part names or filler', () => {
  assert.deepEqual(L.keywordsFrom('Make me a calculator with the OLED display and the membrane keypad'), ['calculator']);
  assert.deepEqual(L.keywordsFrom('build a doorbell with a button and a buzzer'), ['doorbell']);
  assert.deepEqual(L.keywordsFrom('add a button and an led'), []);
});

test('validateRecipe: slots must match real pins; includes must be plain library headers; nothing else sneaks in', () => {
  const ok = { v: 1, title: 'Doorbell', keywords: ['doorbell'], parts: ['pushbutton', 'led'], template: '#include <Wire.h>\nvoid setup(){ pinMode(@@led.A@@, OUTPUT); }\nvoid loop(){}' };
  assert.ok(L.validateRecipe(ok).ok, L.validateRecipe(ok).errors?.join());
  const bad = t => L.validateRecipe({ ...ok, template: t }).ok;
  assert.equal(bad('#include "/etc/passwd"\n@@led.A@@'), false);
  assert.equal(bad('#include <../../secret.h>\n@@led.A@@'), false);
  assert.equal(bad('@@led.ZZ@@'), false);                     // no such pin
  assert.equal(bad('@@ssd1306.DATA@@'), false);               // part is not in the recipe
  assert.equal(bad('x @@ y'), false);
  assert.equal(bad('asm volatile("nop"); @@led.A@@'), false);
  assert.equal(bad('x'.repeat(L.MAX_TEMPLATE + 1)), false);
  assert.equal(L.validateRecipe({ ...ok, parts: ['arduino-uno'] }).ok, false);
  assert.equal(L.validateRecipe({ ...ok, keywords: ['Door Bell!'] }).ok, false);
  assert.equal(L.validateRecipe({ ...ok, v: 2 }).ok, false);
});

test('pin map follows wires through a series resistor', () => {
  const { map, dupes } = L.pinMapOf(aiBench());
  assert.equal(map['pushbutton.1.l'], '2');
  assert.equal(map['led.A'], '8');
  assert.deepEqual(dupes, []);
});

const AI_CODE = `void setup() {\n  pinMode(2, INPUT_PULLUP);\n  pinMode(8, OUTPUT);\n}\nvoid loop() {\n  digitalWrite(8, digitalRead(2) == LOW);\n  delay(8);\n}\n`;
const GOOD_TEMPLATE = `void setup() {\n  pinMode(@@pushbutton.1.l@@, INPUT_PULLUP);\n  pinMode(@@led.A@@, OUTPUT);\n}\nvoid loop() {\n  digitalWrite(@@led.A@@, digitalRead(@@pushbutton.1.l@@) == LOW);\n  delay(8);\n}\n`;

test('learning: a faithful template is kept and rebuilt on other boards', () => {
  const r = L.prepareLearning({ request: 'make a doorbell with a button and an led', project: aiBench(), code: AI_CODE, template: GOOD_TEMPLATE });
  assert.ok(r.ok, r.reason);
  assert.deepEqual(r.recipe.keywords, ['doorbell']);
  assert.deepEqual(r.recipe.parts.sort(), ['led', 'pushbutton']);
  assert.deepEqual(r.instances.map(i => i.board), ['arduino-uno', 'arduino-mega']);
  for (const i of r.instances) { assert.ok(!/@@/.test(i.code), 'every slot filled'); assert.match(i.code, /delay\(8\)/, 'the delay is left alone'); }
});

test('learning: sloppy templates are refused', () => {
  const learn = template => L.prepareLearning({ request: 'make a doorbell with a button and an led', project: aiBench(), code: AI_CODE, template });
  assert.match(learn(GOOD_TEMPLATE.replace('delay(8)', 'delay(@@led.A@@)')).reason, /plain number/, 'a pin slot where a delay was');
  assert.match(learn(GOOD_TEMPLATE.replace('INPUT_PULLUP', 'INPUT')).reason, /not the same sketch/, 'the AI changed the sketch');
  assert.match(learn(AI_CODE).reason, /no pin slots|slots/, 'nothing was generalised');
  assert.match(learn(GOOD_TEMPLATE.replace('digitalRead(@@pushbutton.1.l@@)', 'digitalRead(2)')).reason, /not the same sketch|hard-coded/);
  const withConst = 'const int BTN = 2;\n' + AI_CODE.replace('pinMode(2,', 'pinMode(BTN,');
  assert.match(L.prepareLearning({ request: 'make a doorbell with a button and an led', project: aiBench(), code: withConst, template: withConst.replace(/digitalRead\(2\)/, 'digitalRead(@@pushbutton.1.l@@)').replace(/\(8,/g, '(@@led.A@@,') }).reason, /hard-coded/, 'a pin kept in a constant');
  assert.match(learn(GOOD_TEMPLATE.replace(/@@led\.C@@/g, '@@led.C@@').replace(/@@led\.A@@/g, '@@led.C@@')).reason, /not wired|not the same/);
  assert.match(L.prepareLearning({ request: 'add a button and an led', project: aiBench(), code: AI_CODE, template: GOOD_TEMPLATE }).reason, /names nothing but parts/);
  const twice = aiBench(); twice.parts.push({ id: 'l2', type: 'led', x: 0, y: 200, rotate: 0 });
  assert.match(L.prepareLearning({ request: 'make a doorbell with a button and an led', project: twice, code: AI_CODE, template: GOOD_TEMPLATE }).reason, /appears twice/);
});

test('using a learned recipe: matched by keyword, wired by the planner, pins filled in', () => {
  const learned = [L.prepareLearning({ request: 'make a doorbell with a button and an led', project: aiBench(), code: AI_CODE, template: GOOD_TEMPLATE }).recipe];
  const r = recipeEdit('make me a doorbell', EMPTY(), { learned });
  assert.ok(r?.code, 'matched');
  assert.ok(r.actions.some(a => a.op === 'add_part' && a.type === 'pushbutton'));
  assert.match(r.explanation, /recipe the AI taught me/);
  const after = applyCircuitActions(EMPTY(), r.actions), { map } = L.pinMapOf({ parts: after.parts, wires: after.wires });
  assert.ok(r.code.includes(`pinMode(${map['led.A']}, OUTPUT)`), 'the sketch uses the pin the planner really wired');
  // questions, other parts and unrelated requests do not match
  assert.equal(recipeEdit('why is my doorbell silent', EMPTY(), { learned }), null);
  assert.equal(recipeEdit('make a doorbell with an lcd', EMPTY(), { learned }), null);
  assert.equal(recipeEdit('make me a thermostat', EMPTY(), { learned }), null);
  // on a Mega the pins differ from the Uno's, and the sketch follows
  const mega = recipeEdit('make a doorbell on the mega', EMPTY(), { learned });
  assert.ok(mega?.code && !/@@/.test(mega.code));
});

test('round trip with the real calculator: its template filled with the planner pins is exactly the sketch that was compiled', () => {
  const src = fixtures.sketches['calculator-oled'].source;
  const res = plan([{ type: 'keypad-4x4' }, { type: 'ssd1306' }], EMPTY(), { calculator: true });
  const after = applyCircuitActions(EMPTY(), res.actions), { map } = L.pinMapOf({ parts: after.parts, wires: after.wires });
  const rows = ['R1', 'R2', 'R3', 'R4'].map(p => map[`keypad-4x4.${p}`]), cols = ['C1', 'C2', 'C3', 'C4'].map(p => map[`keypad-4x4.${p}`]);
  assert.ok(rows.every(Boolean) && cols.every(Boolean));
  const tpl = src.replace(/ROW_PINS\[\] = \{[^}]*\}/, `ROW_PINS[] = {${['R1', 'R2', 'R3', 'R4'].map(p => `@@keypad-4x4.${p}@@`).join(', ')}}`).replace(/COL_PINS\[\] = \{[^}]*\}/, `COL_PINS[] = {${['C1', 'C2', 'C3', 'C4'].map(p => `@@keypad-4x4.${p}@@`).join(', ')}}`);
  assert.equal(L.fillTemplate(tpl, map).code, src);
  assert.ok(L.validateRecipe({ v: 1, title: 'Calculator', keywords: ['calculator'], parts: ['keypad-4x4', 'ssd1306'], template: tpl }).ok);
});
