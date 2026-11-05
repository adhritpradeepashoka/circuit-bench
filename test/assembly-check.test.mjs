import test from 'node:test';
import assert from 'node:assert/strict';
import { Assembly } from '../src/core/assembly-scene.js';
import { explainJoin, findProblems } from '../src/core/assembly-check.js';

const hole = (id, pos, dir = [0, 0, 1], d = 3) => ({ id, kind: 'hole', pos, dir, diameter: d, source: 'measured' });
const part = (id, frames, extra = {}) => ({ id, name: id, mass: { grams: 2, source: 'estimated' }, frames, ...extra });

test('one screw is a hinge, two are a rigid mount', () => {
  const as = new Assembly(), a = as.add(part('plate', [hole('h1', [0, 0, 0]), hole('h2', [10, 0, 0])])), b = as.add(part('link', [hole('h1', [0, 0, 0], [0, 0, -1]), hole('h2', [10, 0, 0], [0, 0, -1])]), [50, 50, 50]);
  as.mate(a.id, 'h1', b.id, 'h1'); assert.match(explainJoin(as, a.id, b.id), /hinge/);
  as.autoMatch(a.id, b.id); assert.match(explainJoin(as, a.id, b.id), /rigid mount/);
});

test('loose parts, an idle servo horn and parts through each other are found', () => {
  const as = new Assembly(), a = as.add(part('plate', [hole('h', [0, 0, 0])])), b = as.add(part('link', [hole('h', [0, 0, 0], [0, 0, -1])]), [50, 0, 0]), c = as.add(part('stray', []), [200, 0, 0]);
  as.mate(a.id, 'h', b.id, 'h');
  let p = findProblems(as, { anchorId: a.id }); assert.ok(p.some(x => x.inst === c.id && /not attached/.test(x.text))); assert.ok(!p.some(x => x.inst === b.id));
  const box = (x) => ({ min: [x, 0, 0], max: [x + 20, 20, 20] });
  p = findProblems(as, { anchorId: a.id, boxes: { [a.id]: box(0), [b.id]: box(0), [c.id]: box(10) } });
  assert.ok(p.some(x => /pass through/.test(x.text) && /stray/.test(x.text)), 'c overlaps the mated pair');
  assert.ok(!p.some(x => /pass through/.test(x.text) && /plate/.test(x.text) && /link/.test(x.text)), 'screwed parts may touch');
  const s = as.add(part('servo', [hole('ear', [0, 0, 0]), { id: 'horn-screw', kind: 'hole', pos: [5, 0, 0], dir: [0, 0, 1], diameter: 2, source: 'measured' }], { kit: { kind: 'servo' } }), [90, 90, 0]);
  as.mate(a.id, 'h', s.id, 'ear'); assert.ok(findProblems(as, { anchorId: a.id }).some(x => /horn/.test(x.text)));
});
