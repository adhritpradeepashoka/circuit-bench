import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAccounts } from '../server/accounts.mjs';
import { createServer } from '../server/server.mjs';
import { createVisitors, deviceLabel, networkLabel, cleanVisitorId } from '../server/visitors.mjs';

const OWNER = 'owner@example.com', A = 'a'.repeat(24), B = 'b'.repeat(24), C = 'c'.repeat(24);
const profile = email => ({ email, sub: `sub-${email}`, name: email.split('@')[0], picture: '' });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

test('visitors: labels keep only what an admin needs, never the real address', () => {
  assert.equal(deviceLabel(UA), 'Chrome on Windows');
  assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/604.1'), 'Safari on iOS');
  assert.equal(deviceLabel(''), 'Unknown device');
  assert.equal(networkLabel('103.21.44.7'), '103.21.x.x'); assert.equal(networkLabel('::ffff:10.1.2.3'), '10.1.x.x'); assert.equal(networkLabel('2001:db8:1:2::9'), '2001:db8::');
  assert.equal(cleanVisitorId('../etc'), ''); assert.equal(cleanVisitorId(A), A);
});

test('visitors: list, block by id, network block, unblock, and a signed-in browser is not a visitor', async () => {
  const v = createVisitors({ secret: 's' });
  await v.beat({ id: A, ip: '1.2.3.4', ua: UA, page: 'robotics' });
  await v.beat({ id: B, ip: '1.2.3.9', ua: UA });
  await v.beat({ id: C, ip: '9.9.9.9', ua: UA, email: 'pete@example.com' });
  const l = await v.list(); assert.deepEqual(l.visitors.map(x => x.id).sort(), [A, B], 'the signed-in browser is an account, not a visitor'); assert.equal(l.online, 2);
  assert.equal((await v.beat({ id: A, ip: '1.2.3.4' })).blocked, false);
  const r = await v.setBlock({ id: A, blocked: true, note: 'testing', by: 'o@x.com' });
  assert.equal(r.ok, true); assert.equal((await v.beat({ id: A, ip: '1.2.3.4' })).note, 'testing');
  assert.equal((await v.beat({ id: B, ip: '1.2.3.9' })).blocked, false, 'only that visitor');
  assert.equal((await v.check(A, '5.5.5.5')).network, false);
  assert.equal((await v.setBlock({ id: C, blocked: true })).ok, false, 'a signed-in browser must be blocked as an account');
  assert.equal((await v.setBlock({ id: 'd'.repeat(24), blocked: true })).status, 404);
  // network: a new id from the same address is caught, a different address is not
  assert.equal((await v.setBlock({ id: A, blocked: true, network: true, note: 'x', adminIp: '7.7.7.7' })).ok, true);
  assert.equal((await v.beat({ id: 'e'.repeat(24), ip: '1.2.3.4' })).blocked, true, 'cleared browser data does not get around a network block');
  assert.equal((await v.beat({ id: 'f'.repeat(24), ip: '8.8.8.8' })).blocked, false);
  assert.equal((await v.list()).visitors.find(x => x.id === A).blockedNetwork, true);
  await v.setBlock({ id: A, blocked: false });
  assert.equal((await v.check('e'.repeat(24), '1.2.3.4')), null, 'unblocking lets the network back in');
  assert.equal((await v.check(A, '1.2.3.4')), null);
});

test('visitors: an admin cannot block their own network, and a block outlives a restart', async () => {
  const store = (await import('../server/visitors.mjs')).createMemoryBlockStore();
  const v = createVisitors({ secret: 's', store });
  await v.beat({ id: A, ip: '1.2.3.4', ua: UA });
  assert.match((await v.setBlock({ id: A, blocked: true, network: true, adminIp: '1.2.3.4' })).error, /your own network/);
  assert.equal((await v.check(A, '1.2.3.4')), null, 'nothing was blocked');
  await v.setBlock({ id: A, blocked: true, note: 'kept' });
  const again = createVisitors({ secret: 's', store });
  assert.equal((await again.check(A, '')).note, 'kept');
  assert.equal((await again.list()).visitors.find(x => x.id === A).blocked, true, 'still listed after they have left');
});

test('visitors: live line pings the blocked visitor, and the server refuses them', async () => {
  const a = createAccounts({ ownerEmails: [OWNER], verifyGoogle: async c => (c.startsWith('good:') ? profile(c.slice(5)) : null) });
  const visitors = createVisitors({ secret: 's' });
  const srv = createServer({ accounts: a, visitors, ai: { createPart: async () => ({ ok: true }), generateCode: async () => ({ ok: true }) } });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port;
  const req = (path, { method = 'GET', body, headers = {} } = {}) => new Promise((res, rej) => { const q = http.request({ port, host: '127.0.0.1', path, method, headers: { 'content-type': 'application/json', ...headers } }, r => { let d = ''; r.on('data', c => (d += c)); r.on('end', () => res({ status: r.statusCode, body: d ? JSON.parse(d) : null })); }); q.on('error', rej); q.end(body ? JSON.stringify(body) : undefined); });
  const owner = (await a.signIn(`good:${OWNER}`)).token, pete = (await a.signIn('good:pete@example.com')).token, auth = { authorization: `Bearer ${owner}` };
  try {
    assert.equal((await req('/api/visit', { method: 'POST', body: { id: A } })).body.blocked, false);
    assert.equal((await req('/api/visit', { method: 'POST', body: { id: B }, headers: { authorization: `Bearer ${pete}` } })).body.blocked, false);
    assert.equal((await req('/api/admin/visitors')).status, 403, 'not an admin');
    assert.equal((await req('/api/admin/visitors', { headers: { authorization: `Bearer ${pete}` } })).status, 403);
    const list = await req('/api/admin/visitors', { headers: auth }); assert.deepEqual(list.body.visitors.map(x => x.id), [A], 'Pete is signed in, so he is not in the visitor list');
    // a held live line for visitor A hears the block
    const heard = new Promise((res, rej) => { const q = http.get({ port, host: '127.0.0.1', path: `/api/live?v=${A}` }, r => { r.on('data', c => { if (String(c).includes('data: refresh')) { q.destroy(); res(true); } }); }); q.on('error', e => (e.code === 'ECONNRESET' ? res(true) : rej(e))); setTimeout(() => res(false), 3000).unref(); });
    await new Promise(r => setTimeout(r, 150));
    const set = await req('/api/admin/visitors', { method: 'POST', headers: auth, body: { id: A, blocked: true, note: 'nope' } });
    assert.equal(set.body.ok, true); assert.equal(await heard, true, 'the open page was told at once');
    const refused = await req('/api/ai/create-part', { method: 'POST', headers: { 'x-cb-visitor': A }, body: { x: 1 } });
    assert.equal(refused.status, 403); assert.match(refused.body.error, /blocked this visitor: nope/);
    assert.equal((await req('/api/ai/create-part', { method: 'POST', headers: { 'x-cb-visitor': B }, body: { x: 1 } })).status, 200, 'another visitor is fine');
    assert.equal((await req('/api/ai/create-part', { method: 'POST', headers: { 'x-cb-visitor': A, authorization: `Bearer ${pete}` }, body: { x: 1 } })).status, 200, 'signed in: the account rules apply, not the visitor block');
    assert.equal((await req('/api/visit', { method: 'POST', body: { id: A } })).body.blocked, true);
    assert.equal((await req('/api/config')).status, 200, 'the page itself still loads its settings');
    assert.equal((await req('/api/admin/visitors', { method: 'POST', headers: { authorization: `Bearer ${pete}` }, body: { id: A, blocked: false } })).status, 403);
    await req('/api/admin/visitors', { method: 'POST', headers: auth, body: { id: A, blocked: false } });
    assert.equal((await req('/api/ai/create-part', { method: 'POST', headers: { 'x-cb-visitor': A }, body: { x: 1 } })).status, 200, 'unblocked');
  } finally { srv.closeAllConnections?.(); srv.close(); }
});

test('visitors: the real address comes from the host edge only when that is trusted', async () => {
  const seen = [];
  const mk = trust => createServer({ trustProxyHeaders: trust, visitors: { beat: async o => { seen.push(o.ip); return { blocked: false }; }, check: async () => null }, accounts: createAccounts({}) });
  for (const trust of [false, true]) {
    const srv = mk(trust); await new Promise(r => srv.listen(0, '127.0.0.1', r));
    await new Promise(res => { const q = http.request({ port: srv.address().port, host: '127.0.0.1', path: '/api/visit', method: 'POST', headers: { 'content-type': 'application/json', 'true-client-ip': '203.0.113.9', 'x-forwarded-for': '6.6.6.6' } }, r => { r.resume(); r.on('end', res); }); q.end('{"id":"' + A + '"}'); });
    srv.closeAllConnections?.(); srv.close();
  }
  assert.match(seen[0], /127\.0\.0\.1/, 'not trusted: the socket address, and a forged header is ignored');
  assert.equal(seen[1], '203.0.113.9', 'trusted (Render): the edge header, never X-Forwarded-For');
});
