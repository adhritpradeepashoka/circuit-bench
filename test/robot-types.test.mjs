import test from 'node:test';
import assert from 'node:assert/strict';
import { ROBOT_TYPES, robotType, cleanRobotType, circuitPartsFor, parts3dFor, testFor, robotTypeNotes } from '../src/core/robot-types.js';
import { parseKitId, makeKitPart, KIT_PRESETS } from '../src/core/robot-kit.js';
import { validateRobotPart } from '../src/core/robot-part.js';

test('every ready-made kit part is a valid robot part with holes that sit on the part', () => {
  for (const [, id] of KIT_PRESETS) {
    const raw = makeKitPart(id); assert.ok(raw, id);
    const v = validateRobotPart(raw); assert.ok(v.ok, `${id}: ${v.errors?.join(' ')}`);
    const [sx, sy, sz] = v.part.dims.size;
    for (const f of v.part.frames) {
      assert.ok(Math.abs(f.pos[0]) <= sx / 2 + 0.5 && Math.abs(f.pos[1]) <= sy / 2 + 0.5 && f.pos[2] >= -0.01 && f.pos[2] <= sz + 0.01, `${id}/${f.id} is off the part: ${f.pos} in ${v.part.dims.size}`);
    }
    assert.ok(v.part.mass.grams > 0);
  }
});
test('ids make the same part every time and unknown ids make nothing', () => {
  assert.deepEqual(makeKitPart('link-80'), makeKitPart('link-80'));
  assert.equal(parseKitId('servo-nope'), null); assert.equal(parseKitId('wheel-9999'), null); assert.equal(makeKitPart('motor-2207-1900'), null);
  assert.equal(parseKitId('link-120').screw, 'M3'); assert.equal(parseKitId('link-60').screw, 'M2'); assert.equal(parseKitId('wheel-43').bore, 3.1); assert.equal(parseKitId('wheel-65').bore, 5.5);
  assert.ok(validateRobotPart(makeKitPart('plate-400x400')).ok, 'a big plate keeps under the frame limit');
});
test('a servo horn hole and a link hole agree on the screw, so a joint between them checks out', () => {
  const sg = makeKitPart('servo-sg90').frames.find(f => f.id === 'horn-screw'), link = makeKitPart('link-60').frames.find(f => f.id === 'hole-1-top');
  assert.equal(sg.diameter, link.diameter);
  const big = makeKitPart('servo-mg996r').frames.find(f => f.id === 'horn-screw'), long = makeKitPart('link-120').frames.find(f => f.id === 'hole-1-top');
  assert.equal(big.diameter, long.diameter);
});
test('robot types: a known list, cleaned from anything', () => {
  assert.deepEqual(ROBOT_TYPES.map(t => t.id), ['arm', 'rover', 'drone', 'walker', 'standalone']);
  assert.equal(cleanRobotType('arm'), 'arm'); assert.equal(cleanRobotType('submarine'), null); assert.equal(cleanRobotType(undefined), null);
});
test('each type leads with parts that exist, and the Test tab opens in the right place', () => {
  const have = new Set(['arduino-uno', 'arduino-nano', 'led', 'battery', 'servo', 'hc-sr04', 'l298n', 'dc-motor', 'custom-tb6612', 'potentiometer']);
  assert.deepEqual(circuitPartsFor('arm', t => have.has(t)).slice(0, 4), ['arduino-uno', 'arduino-nano', 'servo', 'potentiometer']);
  assert.ok(circuitPartsFor('rover', t => have.has(t)).includes('l298n'));
  assert.equal(circuitPartsFor('standalone'), null); assert.equal(parts3dFor('standalone'), null); assert.equal(circuitPartsFor('nonsense'), null);
  assert.equal(testFor('arm'), 'robot'); assert.equal(testFor('rover'), 'robot'); assert.equal(testFor('drone'), 'fly'); assert.equal(testFor('standalone'), 'auto'); assert.equal(testFor(null), 'auto');
  for (const t of ROBOT_TYPES) if (t.parts3d) for (const id of t.parts3d) assert.ok(makeKitPart(id) || /^(motor|prop|frame|board|battery|camera|standoff)-/.test(id), `${t.id}: ${id} is not a part`);
});
test('every circuit part a type leads with is really in the catalogue', async () => {
  globalThis.HTMLElement ||= class {};
  const { PART_DEFS } = await import('../src/core/parts.js'); await import('../src/core/custom-parts.js');
  for (const t of ROBOT_TYPES) { const got = circuitPartsFor(t.id, x => !!PART_DEFS[x]); if (t.circuit) assert.equal(got.length, t.circuit.length, `${t.id}: ${t.circuit.filter(p => !PART_DEFS[p] && !PART_DEFS[`custom-${p}`]).join(', ')} are not in the catalogue`); }
});
test('the AI is told what is being built', () => {
  assert.match(robotTypeNotes('arm'), /ROBOT ARM/); assert.match(robotTypeNotes('rover'), /driver/i); assert.equal(robotTypeNotes(null), '');
  assert.ok(robotType('drone').notes.length > 50);
});
test('the short prompt (free hosted AI, on-device model) still knows the parts and the kind of robot', async () => {
  globalThis.HTMLElement ||= class {};
  const { buildPrompt } = await import('../src/core/ai-prompt.js');
  const mk = rt => buildPrompt({ instruction: 'make it move', circuit: { parts: [], wires: [] }, code: '', history: [], workspace: 'robotics', compact: true, robotType: rt });
  const arm = mk('arm'), none = mk(null), plain = buildPrompt({ instruction: 'make it move', circuit: { parts: [], wires: [] }, code: '', history: [], workspace: null, compact: true });
  assert.match(arm, /ROBOT ARM/); assert.match(arm, /- servo:/); assert.match(none, /- servo:/, 'a robotics project with no type still lists servos and drivers');
  assert.match(mk('rover'), /- l298n:/); assert.doesNotMatch(plain, /- servo:/); assert.doesNotMatch(plain, /ROBOT ARM/);
  const asm = buildPrompt({ instruction: 'x', assembly: { parts: '- servo-sg90 …', instances: '', joints: '' }, history: [], workspace: 'robotics', robotType: 'rover' });
  assert.match(asm, /WHEELED ROVER/); assert.match(asm, /gearmotor/);
});
