import test from 'node:test';
import assert from 'node:assert/strict';
import { PACKS, installPack, removePack, isInstalled, partAvailable, packTypes, dependentsOf } from '../src/core/packs.js';
import { BOARD_TEMPLATES } from '../src/core/board-templates.js';
import { validatePartSpec } from '../src/core/custom-parts.js';
import { TEMPLATES } from '../src/core/part-templates.js';

test('ESP normal has the three common chips, expanded has many more; Arduino expanded has many more than the regular pack', () => {
  const by = id => PACKS.find(p => p.id === id);
  assert.equal(by('esp-normal').types.length, 3);
  assert.ok(by('esp-expanded').types.length >= 8);
  assert.ok(by('arduino-expanded').types.length >= 8 && by('arduino-boards').types.length === 3);
});
test('every board in a pack is a valid, correctly pinned part', () => {
  for (const t of BOARD_TEMPLATES) {
    const v = validatePartSpec({ ...t, id: `custom-${t.id}` }); assert.ok(v.ok, `${t.id}: ${v.errors}`);
    assert.ok(v.spec.pins.length >= 8, t.id);
    for (const p of v.spec.pins) assert.ok(p.x >= 0 && p.x <= t.sprite.w && p.y >= 0 && p.y <= t.sprite.h, `${t.id} ${p.id}`);
  }
  assert.ok(TEMPLATES.some(t => t.id === 'esp32-c3-mini'));
});
test('an expanded pack brings its regular pack along and cannot be left without it', () => {
  try { localStorage.clear(); } catch { /* no storage here: packs fall back to memory */ }
  for (const p of PACKS) removePack(p.id);
  assert.ok(installPack('esp-expanded'));
  assert.ok(isInstalled('esp-normal') && isInstalled('esp-expanded'));
  assert.equal(removePack('esp-normal'), false, 'still needed by the expanded pack');
  assert.equal(dependentsOf('esp-normal').length, 1);
  assert.ok(removePack('esp-expanded') && removePack('esp-normal'));
  assert.equal(partAvailable('custom-esp32-devkit'), false);
});
