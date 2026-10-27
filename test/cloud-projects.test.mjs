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
