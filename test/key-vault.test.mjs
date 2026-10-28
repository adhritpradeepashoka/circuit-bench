import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccounts } from '../server/accounts.mjs';
import { createKeyVault, createMemoryKeyStore, createPgKeyStore } from '../server/key-vault.mjs';
import { createKeySync, setSyncOn } from '../src/sim/key-sync.mjs';

const accounts = () => createAccounts({ ownerEmails: ['o@example.com'], verifyGoogle: async c => (c.startsWith('good:') ? { email: c.slice(5), sub: c, name: c.slice(5), picture: '' } : null) });

for (const [name, factory] of [['memory', () => createMemoryKeyStore()], ['postgres (pg-mem)', async () => { const { newDb } = await import('pg-mem'); const { Pool } = newDb().adapters.createPg(); return createPgKeyStore(new Pool()); }]]) {
  test(`key vault (${name}): private per account, encrypted at rest, wiped on delete`, async () => {
    const acc = accounts(), st = await factory(); await st.init(); const v = createKeyVault({ accounts: acc, store: st, secret: 'shh' });
    const me = (await acc.signIn('good:me@example.com')).token, other = (await acc.signIn('good:other@example.com')).token;
    assert.equal((await v.get('')).status, 401);
    assert.deepEqual((await v.get(me)).keys, {});
    assert.equal((await v.put(me, { keys: { gemini: 'AIza-secret-123' }, models: { gemini: 'm1' } })).ok, true);
    assert.equal((await v.get(me)).keys.gemini, 'AIza-secret-123'); assert.equal((await v.get(me)).models.gemini, 'm1');
    assert.deepEqual((await v.get(other)).keys, {}, 'another account sees nothing');
    const raw = await st.get('me@example.com'); assert.ok(!raw.blob.includes('AIza') && !Buffer.from(raw.blob, 'base64').toString('latin1').includes('AIza'), 'not stored in the clear');
    assert.equal((await v.put(me, { keys: { 'bad id!': 'x' } })).status, 400); assert.equal((await v.put(me, { keys: { groq: '' } })).status, 400);
    assert.equal((await createKeyVault({ accounts: acc, store: st, secret: 'other' }).get(me)).status, 500, 'a different secret cannot read it');
    assert.equal((await v.remove(me)).ok, true); assert.deepEqual((await v.get(me)).keys, {});
  });
}
test('key vault is off without a secret', async () => { const acc = accounts(), v = createKeyVault({ accounts: acc }); const t = (await acc.signIn('good:a@example.com')).token; assert.equal(v.enabled, false); assert.equal((await v.get(t)).status, 503); });

test('key sync (browser side): fills gaps from the account, local keys win, nothing happens when off or signed out', async () => {
  const mem = new Map(); globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
  const sent = []; let server = { keys: { gemini: 'G-server', groq: 'Q-server' }, models: {} };
  const call = async (path, method, body) => { sent.push(method); if (method === 'GET') return { status: 200, json: { ok: true, ...server } }; if (method === 'PUT') { server = body; return { status: 200, json: { ok: true } }; } return { status: 200, json: { ok: true } }; };
  let signed = true, pulled = 0; const ks = createKeySync({ call, token: () => (signed ? 't' : ''), onChange: n => { pulled = n; }, on: () => mem.get('circuitbench:key-sync') === '1' });
  assert.equal(await ks.sync(), null, 'off by default'); assert.deepEqual(sent, []);
  setSyncOn(true); mem.set('virtual-lab:ai-key:gemini', 'G-local');
  const r = await ks.sync(); assert.equal(r.got, 1); assert.equal(pulled, 1);
  assert.equal(mem.get('virtual-lab:ai-key:gemini'), 'G-local', 'the local key wins'); assert.equal(mem.get('virtual-lab:ai-key:groq'), 'Q-server', 'a missing key is filled in');
  assert.deepEqual(server.keys, { gemini: 'G-local', groq: 'Q-server' }, 'the merged set goes back');
  signed = false; sent.length = 0; assert.equal(await ks.sync(), null); assert.deepEqual(sent, []);
  delete globalThis.localStorage;
});
