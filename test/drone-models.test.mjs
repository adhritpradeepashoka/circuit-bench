import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildDroneMesh } from '../src/ui/drone-models.js';
import { makeDronePart, DRONE_PRESETS } from '../src/core/drone-parts.js';

const part = id => { const p = makeDronePart(id); return { ...p, drone: p.drone }; };
const box = (id) => { const p = part(id), g = buildDroneMesh(THREE, p); g.updateMatrixWorld(true); return { p, g, b: new THREE.Box3().setFromObject(g) }; };

test('every drone part has a 3D shape made of its own coloured meshes, resting on the floor', () => {
  for (const [, id] of DRONE_PRESETS) {
    const { g, b } = box(id); const meshes = []; g.traverse(o => { if (o.isMesh) meshes.push(o); });
    assert.ok(meshes.length >= 1, id); assert.ok(meshes.every(m => m.userData.fixed && m.material.color), `${id}: every mesh keeps its own colour`);
    assert.ok(b.min.z > -0.01 && b.min.z < 0.01, `${id} rests on z = 0 (min ${b.min.z})`);
    assert.ok(!Number.isNaN(b.max.x) && b.max.z > 0.5, id);
  }
});
test('the colours differ by kind: a carbon frame is dark, a LiPo is blue, props are not the frame colour', () => {
  const col = id => { const { g } = box(id); const c = new Set(); g.traverse(o => { if (o.isMesh) c.add(o.material.color.getHex()); }); return c; };
  assert.ok(col('frame-quad-220-16-30.5').has(0x24282c)); assert.ok(col('battery-4s-1500-75').has(0x2f5fc9)); assert.ok(!col('prop-5x4.3x3-b5').has(0x24282c)); assert.ok(col('board-fc-30.5').size >= 3);
});
test('a model always covers its marked holes: every hole position sits inside the shape drawn for it', () => {
  for (const id of ['frame-quad-220-16-30.5', 'frame-quad-65-9-16', 'motor-2207-1900', 'board-esc-30.5', 'battery-4s-1500-75', 'camera-micro', 'standoff-m3-6']) {
    const { p, b } = box(id), pad = 0.6;
    for (const f of p.frames) { assert.ok(f.pos[0] >= b.min.x - pad && f.pos[0] <= b.max.x + pad && f.pos[1] >= b.min.y - pad && f.pos[1] <= b.max.y + pad, `${id}/${f.id} at ${f.pos} outside the shape ${b.min.toArray()} … ${b.max.toArray()}`); }
  }
});
test('the camera holes on a frame have material around them (the front shelf), not thin air', () => {
  const { p, g } = box('frame-quad-220-16-30.5'), ray = new THREE.Raycaster();
  for (const f of p.frames.filter(x => x.id.startsWith('camera-'))) {
    const around = [[3, 0], [-3, 0], [0, 3], [0, -3]].filter(([dx, dy]) => { ray.set(new THREE.Vector3(f.pos[0] + dx, f.pos[1] + dy, 20), new THREE.Vector3(0, 0, -1)); return ray.intersectObject(g, true).length > 0; });
    assert.ok(around.length >= 3, `${f.id}: only ${around.length} of 4 neighbours are on the frame`);
  }
});
