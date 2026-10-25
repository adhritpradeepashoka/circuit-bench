// The example parts shipped with the Assembly tab: every description is a valid robot part and has its STL next to it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateRobotPart } from '../src/core/robot-part.js';
const dir = new URL('../public/robot-parts/kame32/', import.meta.url);
test('kame32 example parts are valid, have meshes, a licence and sensible sizes', () => {
  const j = JSON.parse(fs.readFileSync(new URL('index.json', dir), 'utf8'));
  assert.equal(j.licence, 'GPL-3.0'); assert.ok(fs.existsSync(new URL('LICENSE', dir)));
  assert.ok(j.parts.length >= 7);
  for (const p of j.parts) {
    const r = validateRobotPart(p); assert.ok(r.ok, `${p.id}: ${r.errors}`);
    const f = new URL(p.model.file, dir); assert.ok(fs.existsSync(f), p.model.file); assert.equal(fs.statSync(f).size, p.model.bytes);
    assert.ok(Math.max(...p.dims.size) < 80 && Math.max(...p.dims.size) > 5, `${p.id} size`);
  }
});
