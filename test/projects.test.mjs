// Saved projects: the storage layer (pure, Node) — the UI flow is covered in ui-smoke.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalStore, newProject, uniqueName, cleanName, WORKSPACES, DEFAULT_WORKSPACE } from '../src/core/projects.js';

const memStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };

test('local store: save / list (newest first) / load / remove round-trip', async () => {
  const store = createLocalStore(memStorage());
  assert.deepEqual(await store.list(), []);
  const a = await store.save(newProject({ name: 'Blink', data: { parts: [] }, now: 1000 }));
  const b = await store.save(newProject({ name: 'Button', now: 2000 }));
  assert.deepEqual((await store.list()).map(m => m.name), ['Button', 'Blink']);
  assert.deepEqual((await store.load(a.id)).data, { parts: [] });
  assert.equal((await store.list())[0].data, undefined, 'the list holds metadata only');
  await store.save({ ...a, updatedAt: 3000 });
  assert.equal((await store.list())[0].id, a.id, 'saving bumps it to the top');
  await store.remove(b.id);
  assert.deepEqual((await store.list()).map(m => m.id), [a.id]);
  assert.equal(await store.load(b.id), null);
});

test('local store: corrupt or foreign storage never throws on read; a full store throws on save so the user can be told', async () => {
  const s = memStorage();
  s.setItem('circuitbench:projects', '{not json'); s.setItem('circuitbench:project:x', 'nope');
  const store = createLocalStore(s);
  assert.deepEqual(await store.list(), []);
  assert.equal(await store.load('x'), null);
  const full = createLocalStore({ ...memStorage(), setItem: () => { throw new Error('QuotaExceededError'); } });
  await assert.rejects(() => full.save(newProject({ name: 'x' })), /Quota/);
});

test('projects: every project records its workspace; unknown ones fall back to the default; names are cleaned and made unique', () => {
  assert.equal(newProject({ name: 'x' }).workspace, DEFAULT_WORKSPACE);
  assert.equal(newProject({ name: 'x', workspace: 'warp-drive' }).workspace, DEFAULT_WORKSPACE);
  assert.ok(WORKSPACES['arduino-uno'].available);
  assert.ok(Object.values(WORKSPACES).some(w => !w.available), 'future workspaces are listed as coming soon');
  assert.equal(cleanName('  my   project \n'), 'my project');
  assert.equal(cleanName('   '), 'Untitled project');
  assert.equal(cleanName('x'.repeat(200)).length, 80);
  assert.equal(uniqueName('Blink', ['blink', 'Blink 2']), 'Blink 3');
  assert.equal(uniqueName('New', ['Old']), 'New');
});
