import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAccounts } from '../server/accounts.mjs';
import { createServer } from '../server/server.mjs';
import { cleanPerms, hasLimits, lockedWorkspace, offByAdmin, isBlocked, PERMISSION_IDS, PERMISSION_PRESETS } from '../src/core/permissions.js';

const OWNER = 'owner@example.com';
const profile = email => ({ email, sub: `sub-${email}`, name: email.split('@')[0], picture: '' });
const make = () => createAccounts({ ownerEmails: [OWNER], verifyGoogle: async c => (c.startsWith('good:') ? profile(c.slice(5)) : null) });
const login = async (a, email) => (await a.signIn(`good:${email}`)).token;

test('permissions: whatever arrives from the network is cleaned', () => {
  assert.deepEqual(cleanPerms(null), { off: [], workspace: null, blocked: false, note: '' });
  const c = cleanPerms({ off: ['ai', 'ai', 'nonsense', 7], workspace: 'robotics', blocked: 'yes', note: `  ${'x'.repeat(300)}  ` });
  assert.deepEqual(c.off, ['ai']); assert.equal(c.workspace, 'robotics'); assert.equal(c.blocked, false, 'only a real true blocks'); assert.equal(c.note.length, 200);
  assert.equal(cleanPerms({ workspace: '../etc/passwd' }).workspace, null);
  assert.equal(hasLimits({}), false); assert.equal(hasLimits({ off: ['ai'] }), true); assert.equal(hasLimits({ blocked: true }), true); assert.equal(hasLimits({ workspace: 'robotics' }), true);
  const me = { permissions: { off: ['ai'], workspace: 'robotics', blocked: true } };
  assert.deepEqual([lockedWorkspace(me), offByAdmin(me), isBlocked(me), lockedWorkspace({})], ['robotics', ['ai'], true, null]);
  for (const pr of PERMISSION_PRESETS) assert.ok(cleanPerms(pr.perms).off.every(id => PERMISSION_IDS.includes(id)), `${pr.id} only names real features`);
});

test('admin limits: an admin limits a beta tester, who then sees them in /me and is refused by the server', async () => {
  const a = make(), owner = await login(a, OWNER), pete = await login(a, 'pete@example.com');
  assert.equal((await a.me(pete)).permissions, undefined, 'no limits, nothing to show');
  assert.equal(await a.allows(pete, 'ai'), true);
  const r = await a.setPerms(owner, 'pete@example.com', { off: ['ai'], workspace: 'robotics' });
  assert.equal(r.ok, true);
  const me = await a.me(pete);
  assert.deepEqual([me.permissions.off, me.permissions.workspace], [['ai'], 'robotics']);
  assert.equal(await a.allows(pete, 'ai'), false); assert.equal(await a.allows(pete, 'community'), true);
  assert.equal(await a.allows(owner, 'ai'), true, 'the owner is never limited');
  await a.setPerms(owner, 'pete@example.com', {});
  assert.equal((await a.me(pete)).permissions, undefined); assert.equal(await a.allows(pete, 'ai'), true);
});

test('admin limits: who may limit whom', async () => {
  const a = make(), owner = await login(a, OWNER), adm = await login(a, 'adm@example.com'), pete = await login(a, 'pete@example.com');
  await a.setRole(owner, 'adm@example.com', 'admin');
  assert.equal((await a.setPerms(pete, 'adm@example.com', { off: ['ai'] })).ok, false, 'a free user cannot');
  assert.equal((await a.setPerms(adm, 'pete@example.com', { off: ['ai'] })).ok, true, 'an admin can limit a free user');
  assert.match((await a.setPerms(adm, OWNER, { blocked: true })).error, /owner/);
  assert.match((await a.setPerms(adm, 'adm@example.com', { blocked: true })).error, /yourself|own/);
  assert.match((await a.setPerms(owner, 'adm@example.com', { off: ['ai'] })).ok ? 'ok' : 'no', /ok/, 'the owner can limit an admin');
  await a.setRole(owner, 'adm2@example.com', 'admin');
  assert.match((await a.setPerms(adm, 'adm2@example.com', { off: ['ai'] })).error, /owner/, 'an admin cannot limit another admin');
});

test('blocking: no new sign-in, nothing allowed, and an invited person can be limited before they ever sign in', async () => {
  const a = make(), owner = await login(a, OWNER), pete = await login(a, 'pete@example.com');
  await a.setPerms(owner, 'pete@example.com', { blocked: true, note: 'testing' });
  assert.equal(await a.isBlocked(pete), true); assert.equal(await a.allows(pete, 'community'), false);
  assert.equal((await a.me(pete)).permissions.blocked, true, 'the open page can still read that it is blocked');
  const again = await a.signIn('good:pete@example.com'); assert.equal(again.blocked, true); assert.equal(again.note, 'testing'); assert.equal(again.token, undefined);
  assert.equal((await a.signIn(`good:${OWNER}`)).blocked, undefined, 'the owner cannot be blocked out');
  await a.setPerms(owner, 'pete@example.com', { blocked: false });
  assert.ok((await a.signIn('good:pete@example.com')).token, 'unblocked: back in');
  await a.setPerms(owner, 'new@example.com', { workspace: 'robotics' });
  const list = await a.listUsers(owner); assert.deepEqual(list.users.find(u => u.email === 'new@example.com').perms.workspace, 'robotics');
  assert.equal((await a.signIn('good:new@example.com')).me.permissions.workspace, 'robotics', 'it is waiting for them when they first sign in');
});

test('live: the open page is told the moment an admin changes its access', async () => {
  const a = make(), owner = await login(a, OWNER), pete = await login(a, 'pete@example.com');
  let heard = 0; const off = a.watch('pete@example.com', () => heard++);
  await a.setPerms(owner, 'pete@example.com', { off: ['ai'] }); assert.equal(heard, 1);
  await a.setRole(owner, 'pete@example.com', 'beta'); assert.equal(heard, 2, 'a role change counts too');
  off(); await a.setPerms(owner, 'pete@example.com', {}); assert.equal(heard, 2, 'a closed page is not told');
});

test('live: over HTTP, /api/live streams a refresh to the person and /api/admin/permissions is for admins', async t => {
  const a = make(), server = createServer({ accounts: a }), owner = await login(a, OWNER), pete = await login(a, 'pete@example.com');
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port; t.after(() => server.closeAllConnections?.() || server.close());
  const post = (path, tok, body) => new Promise(res => { const rq = http.request({ port, path, method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: JSON.parse(d || '{}') })); }); rq.end(JSON.stringify(body)); });
  assert.equal((await post('/api/admin/permissions', pete, { email: 'x@example.com', perms: { blocked: true } })).status, 403);
  const heard = new Promise((resolve, reject) => {
    const rq = http.get({ port, path: '/api/live', headers: { authorization: `Bearer ${pete}` } }, r => {
      assert.match(r.headers['content-type'], /event-stream/);
      let d = ''; r.on('data', c => { d += c; if (d.includes('data: refresh')) { rq.destroy(); resolve(true); } });
    }); rq.on('error', e => { if (e.code !== 'ECONNRESET') reject(e); });
    setTimeout(() => reject(new Error('no refresh heard')), 4000).unref();
  });
  await new Promise(r => setTimeout(r, 150));
  assert.equal((await post('/api/admin/permissions', owner, { email: 'pete@example.com', perms: { off: ['ai'] } })).status, 200);
  assert.equal(await heard, true);
  const gated = await new Promise(res => { const rq = http.request({ port, path: '/api/ai/create-part', method: 'POST', headers: { authorization: `Bearer ${pete}`, 'content-type': 'application/json' } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d })); }); rq.end('{}'); });
  assert.equal(gated.status, 403); assert.match(gated.body, /admin turned/);
  server.closeAllConnections?.();
});
