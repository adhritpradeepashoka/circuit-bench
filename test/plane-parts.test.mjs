import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildDroneMesh } from '../src/ui/drone-models.js';
import { parseDroneId, makeDronePart, PLANE_PRESETS, DRONE_ID_HELP } from '../src/core/drone-parts.js';
import { validateRobotPart } from '../src/core/robot-part.js';
import { robotType, parts3dFor } from '../src/core/robot-types.js';

const mesh = id => { const p = makeDronePart(id), g = buildDroneMesh(THREE, p); g.updateMatrixWorld(true); return { p, b: new THREE.Box3().setFromObject(g) }; };

test('every plane preset is a valid 3D part that rests on the floor', () => {
  for (const [, id] of PLANE_PRESETS) {
    const p = makeDronePart(id); assert.ok(p, id); const v = validateRobotPart(p); assert.ok(v.ok, `${id}: ${v.errors?.join('; ')}`);
    const { b } = mesh(id); assert.ok(Math.abs(b.min.z) < 0.01, `${id} rests on z = 0 (${b.min.z})`); assert.ok(b.max.z > 0.5, id);
  }
});

test('a 3S 2200 mAh 100C battery can be made, and its measured size replaces the guess', () => {
  const guess = makeDronePart('battery-3s-2200-100'); assert.equal(guess.drone.cells, 3); assert.equal(guess.drone.mAh, 2200); assert.equal(guess.drone.c, 100); assert.match(guess.name, /3S 2200 mAh 100C/); assert.equal(guess.dims.source, 'estimated');
  const real = makeDronePart('battery-3s-2200-100-115x35x25'); assert.deepEqual(real.dims.size, [115, 35, 25]); assert.equal(real.dims.source, 'measured'); assert.deepEqual(real.drone.battery.sizeMm, [115, 35, 25]);
  const { b } = mesh('battery-3s-2200-100-115x35x25'); assert.ok(b.max.x - b.min.x >= 115, 'the model is the size that was typed');
  assert.equal(parseDroneId('battery-4s-1500-75').size, undefined);
});

test('an EDF, a flight controller of any size, a receiver and an antenna: holes sit on the drawn part', () => {
  const edf = makeDronePart('edf-50'); assert.ok(edf.dims.size[0] > 50); assert.equal(edf.mass.source, 'estimated'); assert.equal(makeDronePart('edf-50-m85').mass.grams, 85);
  const fc = makeDronePart('fcwing-36x25-30.5x20'); assert.equal(fc.frames.length, 8); assert.deepEqual(fc.frames.find(f => f.id === 'mount-1-top').pos.slice(0, 2), [15.25, 10]);
  assert.deepEqual(fc.dims.size.slice(0, 2), [36, 25]); assert.equal(makeDronePart('fcwing-36x25-30.5x20-m9').mass.grams, 9);
  assert.ok(makeDronePart('rx-20x12x6').frames.some(f => f.id === 'ant-port') && makeDronePart('antenna-90').frames.some(f => f.id === 'base'));
  for (const id of ['edf-50', 'fcwing-36x25-30.5x20', 'rx-20x12x6', 'antenna-90']) {
    const { p, b } = mesh(id); for (const f of p.frames) assert.ok(f.pos[0] >= b.min.x - 0.6 && f.pos[0] <= b.max.x + 0.6 && f.pos[1] >= b.min.y - 0.6 && f.pos[1] <= b.max.y + 0.6, `${id}/${f.id} is outside the drawn shape`);
  }
  for (const bad of ['edf-', 'fcwing-36x36', 'rx-1x2', 'antenna-', 'battery-3s']) assert.equal(parseDroneId(bad), null, bad);
});

test('the plane lists its own 3D parts, and the AI is told the new ids', () => {
  const ids = parts3dFor('plane'); assert.ok(ids.includes('battery-3s-2200-100') && ids.includes('edf-50') && ids.includes('antenna-90')); assert.equal(robotType('drone').parts3d.includes('edf-50'), false);
  for (const w of ['edf-', 'fcwing-', 'rx-', 'antenna-', '115x35x25']) assert.ok(DRONE_ID_HELP.includes(w), w);
});
