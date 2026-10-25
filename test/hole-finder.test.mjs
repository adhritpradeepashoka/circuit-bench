// Hole snapping: a click near a screw hole finds the hole's real centre and diameter from the mesh triangles alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { featureEdges, circleNear } from '../src/core/hole-finder.js';

const tris = g => Float32Array.from((g.index ? g.toNonIndexed() : g).attributes.position.array);
/** a 32 × 12 × 2.5 plate with two through holes (r 1.1 at x = ±13.75), its top face at z = 2.5 */
function plate({ r = 1.1, segs = 24, hx = 13.75 } = {}) {
  const s = new THREE.Shape(); s.moveTo(-16, -6); s.lineTo(16, -6); s.lineTo(16, 6); s.lineTo(-16, 6); s.closePath();
  for (const x of [-hx, hx]) { const h = new THREE.Path(); h.absarc(x, 0, r, 0, Math.PI * 2, true); s.holes.push(h); }
  return new THREE.ExtrudeGeometry(s, { depth: 2.5, bevelEnabled: false, curveSegments: segs });
}

test('finds a hole from a click beside it: centre, radius, and ignores the plate outline', () => {
  const fe = featureEdges(tris(plate()));
  const hit = circleNear(fe, [13.75 + 2.5, 1, 2.5], [0, 0, 1]);
  assert.ok(hit, 'a circle was found');
  assert.ok(Math.abs(hit.center[0] - 13.75) < 0.01 && Math.abs(hit.center[1]) < 0.01 && Math.abs(hit.center[2] - 2.5) < 0.01, `centre ${hit.center.map(v => v.toFixed(3))}`);
  assert.ok(Math.abs(hit.radius - 1.1) < 0.01, `radius ${hit.radius}`);
  const other = circleNear(fe, [-13.75 - 2, -1, 2.5], [0, 0, 1]);
  assert.ok(Math.abs(other.center[0] + 13.75) < 0.01, 'the other hole is found from the other side');
});

test('no circle where there is none, far from the hole, or on the wrong plane', () => {
  const fe = featureEdges(tris(plate()));
  assert.equal(circleNear(fe, [0, 0, 2.5], [0, 0, 1]), null, 'middle of the plate: nothing within reach');
  assert.equal(circleNear(fe, [13.75 + 2, 0, 0], [0, 0, -1]) === null, false, 'the bottom face has the same holes');
  assert.equal(circleNear(fe, [13.75 + 2, 0, 1.2], [0, 0, 1]), null, 'a plane below the top face has no hole rim');
  assert.equal(circleNear(fe, [14, 6, 1], [0, 1, 0]), null, 'a side face has no circles');
});

test('works for a round boss (a shaft), at different sizes and coarse tessellation', () => {
  const shaft = new THREE.CylinderGeometry(2.4, 2.4, 4, 16).rotateX(Math.PI / 2).translate(-5.5, 0, 24.7);
  const body = new THREE.BoxGeometry(22.5, 12, 22.7).translate(0, 0, 11.35);
  const fe = featureEdges(tris(mergeGeometries([body, shaft].map(g => g.toNonIndexed()))));
  const hit = circleNear(fe, [-5.5 + 1, 0.5, 26.7], [0, 0, 1]);
  assert.ok(hit && Math.abs(hit.radius - 2.4) < 0.02 && Math.abs(hit.center[0] + 5.5) < 0.02, JSON.stringify(hit));
  const big = featureEdges(tris(plate({ r: 4, segs: 48, hx: 10 })));
  assert.ok(Math.abs(circleNear(big, [10 + 4.5, 0, 2.5], [0, 0, 1]).radius - 4) < 0.02);
});

test('a rounded rectangle outline is not mistaken for a circle', () => {
  const box = new THREE.BoxGeometry(20, 20, 4).translate(0, 0, 2);
  assert.equal(circleNear(featureEdges(tris(box)), [3, 3, 4], [0, 0, 1]), null);
});
