import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccounts } from '../server/accounts.mjs';
import { createCloudProjects, createMemoryProjectStore, createPgProjectStore, LIMITS } from '../server/cloud-projects.mjs';

const accounts = () => createAccounts({ ownerEmails: ['o@example.com'], verifyGoogle: async c => (c.startsWith('good:') ? { email: c.slice(5), sub: c, name: c.slice(5), picture: '' } : null) });
const P = (o = {}) => ({ name: 'Quad', workspace: 'robotics', createdAt: 1000, updatedAt: 2000, data: { circuit: { a: 1 } }, scene: { parts: [{ part: 'x', T: {} }] }, ...o });

for (const [name, factory] of [['memory', () => createMemoryProjectStore()], ['postgres (pg-mem)', async () => { const { newDb } = await import('pg-mem'); const { Pool } = newDb().adapters.createPg(); return createPgProjectStore(new Pool()); }]]) {
  test(`cloud projects (${name}): private per account, newest wins, deletes travel`, async () => {
    const acc = accounts(), st = await factory(); await st.init(); let t = 5000; const c = createCloudProjects({ accounts: acc, store: st, now: () => t });
    const me = (await acc.signIn('good:me@example.com')).token, other = (await acc.signIn('good:other@example.com')).token;
    assert.equal((await c.list('')).status, 401); assert.equal((await c.put('', 'p-abc1', P())).status, 401);
    assert.equal((await c.put(me, 'p-abc1', P())).ok, true);
    assert.deepEqual((await c.list(me)).projects.map(p => [p.id, p.name, p.workspace, p.updatedAt, p.deleted]), [['p-abc1', 'Quad', 'robotics', 2000, false]]);
    assert.deepEqual((await c.list(other)).projects, [], 'another account sees nothing');
    assert.equal((await c.get(other, 'p-abc1')).status, 404);
    const got = (await c.get(me, 'p-abc1')).project; assert.deepEqual(got.scene, P().scene); assert.deepEqual(got.data, P().data);
    assert.equal((await c.put(me, 'p-abc1', P({ name: 'Old', updatedAt: 1500 }))).kept, 'server', 'an older copy never replaces a newer one');
    assert.equal((await c.get(me, 'p-abc1')).project.name, 'Quad');
    assert.equal((await c.put(me, 'p-abc1', P({ name: 'New', updatedAt: 3000 }))).ok, true); assert.equal((await c.get(me, 'p-abc1')).project.name, 'New');
    assert.equal((await c.put(me, 'bad id!', P())).status, 400); assert.equal((await c.put(me, 'p-abc2', P({ updatedAt: 'x' }))).status, 400);
    assert.equal((await c.put(me, 'p-abc2', P({ data: 'str' }))).status, 400);
    assert.equal((await c.put(me, 'p-abc2', P({ data: { big: 'x'.repeat(LIMITS.projectBytes) } }))).status, 413);
    assert.equal((await c.remove(me, 'p-abc1')).ok, true);
    const gone = (await c.list(me)).projects[0]; assert.equal(gone.deleted, true); assert.ok(gone.updatedAt > 3000, 'the delete is newer than the last save');
    assert.equal((await c.get(me, 'p-abc1')).project.data, null);
    assert.equal((await c.put(me, 'p-abc1', P({ updatedAt: 3500 }))).kept, 'server', 'an old save cannot undo a delete');
    assert.equal((await c.put(me, 'p-abc1', P({ updatedAt: 9000 }))).ok, true, 'but a newer save brings it back');
  });
}
test('cloud projects: a person can keep up to the limit of projects', async () => {
  const acc = accounts(), c = createCloudProjects({ accounts: acc, store: createMemoryProjectStore() }), tok = (await acc.signIn('good:z@example.com')).token;
  for (let i = 0; i < LIMITS.perUser; i++) assert.equal((await c.put(tok, `p-n${i}x`, P())).ok, true);
  assert.equal((await c.put(tok, 'p-onetoomany', P())).status, 409); assert.equal((await c.put(tok, 'p-n0x', P({ updatedAt: 3000 }))).ok, true, 'saving an existing one is still fine');
});

for (const [name, factory] of [['memory', () => createMemoryProjectStore()], ['postgres (pg-mem)', async () => { const { newDb } = await import('pg-mem'); const { Pool } = newDb().adapters.createPg(); return createPgProjectStore(new Pool()); }]]) {
  test(`public gallery (${name}): private by default, shared on request, no email shown, stops when unshared, copy-safe`, async () => {
    const acc = accounts(), st = await factory(); await st.init(); const c = createCloudProjects({ accounts: acc, store: st, now: () => 9000 });
    const me = (await acc.signIn('good:ada.lovelace@example.com')).token, other = (await acc.signIn('good:bob@example.com')).token;
    await c.put(me, 'p-aaa-1', P({ name: 'Blinker' })); await c.put(me, 'p-aaa-2', P({ name: 'Secret robot' }));
    assert.equal((await c.gallery('')).projects.length, 0, 'nothing is public until the owner says so');
    assert.equal((await c.setPublic(other, 'p-aaa-1', true)).status, 404, 'someone else cannot share my project');
    const r = await c.setPublic(me, 'p-aaa-1', true); assert.equal(r.ok, true); assert.match(r.handle, /^[0-9a-f]{16}$/);
    const g = (await c.gallery('')).projects; assert.equal(g.length, 1); assert.equal(g[0].name, 'Blinker'); assert.equal(g[0].author, 'A CircuitBench maker');
    assert.equal(JSON.stringify(g).includes('@'.concat('example')), false, 'an email must never appear');
    assert.equal((await c.gallery('blink')).projects.length, 1); assert.equal((await c.gallery('zzz')).projects.length, 0);
    const got = await c.galleryGet(g[0].handle, 'p-aaa-1'); assert.equal(got.ok, true); assert.deepEqual(got.project.data, { circuit: { a: 1 } });
    assert.equal((await c.galleryGet(g[0].handle, 'p-aaa-2')).status, 404, 'a private project of the same owner is not reachable');
    await c.put(me, 'p-aaa-1', P({ name: 'Blinker v2', updatedAt: 3000 }));
    assert.equal((await c.gallery('')).projects[0].name, 'Blinker v2', 'saving an edit keeps it public');
    assert.equal((await c.list(me)).projects.find(p => p.id === 'p-aaa-1').public, true);
    await c.setPublic(me, 'p-aaa-1', false); assert.equal((await c.gallery('')).projects.length, 0);
    assert.equal((await c.galleryGet(g[0].handle, 'p-aaa-1')).status, 404);
    await c.setPublic(me, 'p-aaa-1', true); await c.remove(me, 'p-aaa-1'); assert.equal((await c.gallery('')).projects.length, 0, 'a deleted project disappears from the gallery');
  });
}
