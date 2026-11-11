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

test('the Arduino AI pack holds the real UNO Q and VENTUNO Q parts: Uno-header geometry, datasheet labels, the HAT header, no duplicate pins, all inside the drawing', async () => {
  const { PART_DEFS } = await import('../src/core/parts.js');
  const p = PACKS.find(x => x.id === 'arduino-ai'); assert.ok(p && !p.requires); assert.deepEqual(p.types, ['arduino-uno-q', 'arduino-ventuno-q']);
  assert.ok(!PACKS.find(x => x.id === 'arduino-expanded').types.includes('arduino-uno-q'));
  for (const t of p.types) { const d = PART_DEFS[t]; assert.ok(d, t); const ids = d.pins.map(x => x.id); assert.equal(new Set(ids).size, ids.length, `${t}: unique pin ids`); for (const pin of d.pins) assert.ok(pin.x > 0 && pin.x < d.w && pin.y > 0 && pin.y < d.h, `${t} ${pin.id} inside the board`); for (const g of d.groups) for (const id of g.pins) assert.ok(ids.includes(id), `${t} group pin ${id}`); }
  const q = PART_DEFS['arduino-uno-q'], uno = PART_DEFS['arduino-uno'];
  assert.equal(q.pins.length, 31); for (const u of uno.pins) { const m = q.pins.find(x => x.id === u.id); assert.ok(m && m.x === u.x && m.y === u.y, `${u.id} sits where the Uno's does`); }
  assert.equal(q.pins.find(x => x.id === 'A4.2').label, 'D20 · SDA (Wire)'); assert.ok(q.groups.some(g => g.pins.includes('A4.2') && g.pins.includes('A4')), 'D20/D21 are tied to the simulated I²C pins A4/A5');
  const v = PART_DEFS['arduino-ventuno-q']; assert.equal(v.pins.filter(x => /^H\d+$/.test(x.id)).length, 40); assert.equal(v.pins.filter(x => /^Q/.test(x.id)).length, 4);
  assert.equal(v.pins.find(x => x.id === 'H3').label, '3 · GPIO2 · SDA (I2C1)'); assert.equal(v.pins.find(x => x.id === 'H19').label, '19 · GPIO10 · MOSI (SPI0)');
  assert.ok(v.groups.find(g => g.id === 'gnd').pins.includes('H6'));
});
