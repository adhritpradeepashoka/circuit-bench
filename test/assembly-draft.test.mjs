import test from 'node:test';
import assert from 'node:assert/strict';
import { PartDraft } from '../src/core/assembly-draft.js';
import { validateRobotPart } from '../src/core/robot-part.js';

test('a snapped hole keeps its measured diameter and is marked measured', () => {
  const d = new PartDraft(); d.setMesh({ file: 'a.stl', format: 'stl', bytes: 10, rawSize: [32, 12, 26.7] });
  const f = d.addFrame({ pos: [13.75, 0, 18], dir: [0, 0, 1], kind: 'hole', diameter: 2.2 });
  assert.equal(f.diameter, 2.2); assert.equal(f.source, 'measured');
  const g = d.addFrame({ pos: [0, 0, 1], dir: [0, 0, 1], kind: 'hole' });
  assert.equal(g.source, 'estimated'); assert.equal(g.diameter, 3);
  const face = d.addFrame({ pos: [0, 0, 1], dir: [0, 0, 1], kind: 'face', diameter: 5 });
  assert.equal(face.diameter, undefined, 'kinds without a diameter ignore it');
});

test('a draft with frames and a mass validates as a robot part', () => {
  const d = new PartDraft(); d.name = 'Test servo'; d.setMesh({ file: 'a.stl', format: 'stl', bytes: 10, rawSize: [32, 12, 26.7] });
  d.addFrame({ pos: [13.75, 0, 18], dir: [0, 0, 1], kind: 'hole', diameter: 2.2 }); d.massGrams = 9;
  const r = validateRobotPart(d.toDescription()); assert.ok(r.ok, JSON.stringify(r.errors));
});
