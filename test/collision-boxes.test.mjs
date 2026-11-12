import test from 'node:test';
import assert from 'node:assert/strict';
import { boxesFromMesh } from '../src/core/collision-boxes.js';

/** an axis-aligned block as 12 triangles */
export function blockMesh([x0, y0, z0], [x1, y1, z1]) {
  const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6], [1, 2, 6], [1, 6, 5], [3, 0, 4], [3, 4, 7]];
  return f.flatMap(t => t.flatMap(i => c[i]));
}
const inside = (r, p) => r.boxes.some(b => p.every((v, k) => Math.abs(v - b.c[k]) <= b.h[k]));

test('a U-shaped cradle keeps its cavity: a point in the opening is free, the walls and floor are solid', () => {
  const pos = [...blockMesh([0, 0, 0], [40, 20, 3]), ...blockMesh([0, 0, 3], [3, 20, 30]), ...blockMesh([37, 0, 3], [40, 20, 30])];
  const r = boxesFromMesh({ pos }); assert.ok(r, 'boxes found'); assert.ok(r.boxes.length < 120, `${r.boxes.length} boxes`);
  assert.ok(!inside(r, [20, 10, 15]), 'the middle of the opening is empty');
  assert.ok(!inside(r, [20, 10, 8]), 'just above the floor is empty');
  assert.ok(inside(r, [1.5, 10, 15]), 'left wall'); assert.ok(inside(r, [38.5, 10, 15]), 'right wall'); assert.ok(inside(r, [20, 10, 1.5]), 'floor');
  assert.ok(!inside(r, [20, 10, 40]) && !inside(r, [-5, 10, 15]), 'nothing outside');
});

test('a plain block becomes one box of about its own size, and an empty mesh gives none', () => {
  const one = boxesFromMesh({ pos: blockMesh([0, 0, 0], [30, 20, 10]) }), big = one.boxes.slice().sort((a, b) => b.h[0] * b.h[1] * b.h[2] - a.h[0] * a.h[1] * a.h[2])[0];
  assert.ok(one.boxes.length <= 14, `${one.boxes.length} boxes`);                       // (a few slivers along an edge are fine)
  assert.ok(Math.abs(big.h[0] * 2 - 30) < 2.5 && Math.abs(big.h[1] * 2 - 20) < 2.5 && Math.abs(big.h[2] * 2 - 10) < 2.5, 'one box is the block');
  assert.equal(boxesFromMesh({ pos: [] }), null);
});
