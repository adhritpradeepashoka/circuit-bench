import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { featureEdges, findHoles } from '../src/core/hole-finder.js';
import { Assembly, worldFrame, screwFor, arc, rotate } from '../src/core/assembly-scene.js';

const part = (id, frames) => ({ id, name: id, mass: { grams: 2, source: 'estimated' }, frames });
const hole = (id, pos, dir, d, source = 'measured') => ({ id, kind: 'hole', pos, dir, diameter: d, source });
const close = (a, b, e = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < e);

test('mating puts frame B on frame A, facing it, and keeps parts rigid', () => {
  const as = new Assembly(), a = as.add(part('bracket', [hole('h', [10, 0, 5], [0, 0, 1], 3)])), b = as.add(part('leg', [hole('h', [0, 4, 0], [0, 1, 0], 3.2)]), [50, 50, 50]);
  const r = as.mate(a.id, 'h', b.id, 'h'); assert.ok(r.ok);
  const wa = worldFrame(a, a.part.frames[0]), wb = worldFrame(b, b.part.frames[0]);
  assert.ok(close(wa.pos, wb.pos), 'positions coincide'); assert.ok(close(wa.dir, wb.dir.map(v => -v)), 'directions oppose');
  assert.ok(close(wa.pos, [10, 0, 5]), 'A did not move');
});

test('re-mating, rotated parts and a part moved afterwards', () => {
  const as = new Assembly(), a = as.add(part('a', [hole('h', [0, 0, 0], [1, 0, 0], 3)])); a.T = { q: arc([1, 0, 0], [0, 1, 0]), t: [5, 5, 5] };
  const b = as.add(part('b', [hole('h', [1, 2, 3], [0, 0, 1], 3)])); as.mate(a.id, 'h', b.id, 'h');
  assert.ok(close(worldFrame(b, b.part.frames[0]).dir, [0, -1, 0], 1e-5), 'faces A, which now points +y');
  assert.equal(as.check(as.mates[0]).level, 'ok');
  b.T.t[0] += 1; assert.equal(as.check(as.mates[0]).level, 'bad', 'moving B breaks the mate');
});

test('fit checks: sizes, screws, estimates', () => {
  assert.equal(screwFor(3.2), 'M2_5'); assert.equal(screwFor(3.4), 'M3'); assert.equal(screwFor(1.1), null);
  const mk = (da, db, s = 'measured') => { const as = new Assembly(), a = as.add(part('a', [hole('h', [0, 0, 0], [0, 0, 1], da, s)])), b = as.add(part('b', [hole('h', [0, 0, 0], [0, 0, 1], db, s)])); return as.mate(a.id, 'h', b.id, 'h').check; };
  assert.equal(mk(3.4, 3.4).level, 'ok'); assert.equal(mk(3.4, 2.4).level, 'warn'); assert.equal(mk(1, 1).level, 'bad'); assert.equal(mk(3.4, 3.4, 'estimated').level, 'warn');
  const as = new Assembly(), a = as.add(part('a', [hole('h', [0, 0, 0], [0, 0, 1], 2.4)])), b = as.add(part('b', [hole('h', [0, 0, 0], [0, 0, 1], 2.4)]));
  assert.equal(as.mate(a.id, 'h', b.id, 'h', { screw: 'M3' }).check.level, 'bad', 'M3 does not pass a 2.4 hole');
});

test('bill of materials counts parts, screws and mass; removing a part drops its mates', () => {
  const as = new Assembly(), p = part('leg', [hole('h', [0, 0, 0], [0, 0, 1], 3.4)]);
  const a = as.add(p), b = as.add(p), c = as.add(p); as.mate(a.id, 'h', b.id, 'h'); as.mate(b.id, 'h', c.id, 'h');
  const bom = as.bom(); assert.deepEqual(bom.parts, [{ name: 'leg', count: 3 }]); assert.deepEqual(bom.screws, [{ thread: 'M3', count: 2 }]); assert.equal(bom.grams, 6);
  as.remove(b.id); assert.equal(as.mates.length, 0); assert.equal(as.instances.length, 2);
});

test('findHoles lists every hole on a plate, once per axis', () => {
  const s = new THREE.Shape(); s.moveTo(-16, -6); s.lineTo(16, -6); s.lineTo(16, 6); s.lineTo(-16, 6); s.closePath();
  for (const [x, r] of [[-12, 1.1], [12, 1.1], [0, 1.6]]) { const h = new THREE.Path(); h.absarc(x, 0, r, 0, Math.PI * 2, true); s.holes.push(h); }
  const g = new THREE.ExtrudeGeometry(s, { depth: 2.5, bevelEnabled: false, curveSegments: 24 });
  const hs = findHoles(featureEdges(Float32Array.from(g.toNonIndexed().attributes.position.array)));
  assert.equal(hs.length, 3, JSON.stringify(hs.map(h => [h.center.map(v => +v.toFixed(1)), +h.radius.toFixed(2)])));
  assert.deepEqual(hs.map(h => +(h.radius * 2).toFixed(1)).sort(), [2.2, 2.2, 3.2]);
  assert.ok(hs.every(h => Math.abs(Math.abs(h.axis[2]) - 1) < 1e-3), 'axes are along the plate normal');
});
