import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccounts, createMemoryStore, createPgStore, createSessions, createPresence, whyNotAllowed, entitlements, createGoogleVerifier } from '../server/accounts.mjs';
import { createServer } from '../server/server.mjs';

const OWNER = 'owner@example.com';
const profile = (email, name = email.split('@')[0]) => ({ email, sub: `sub-${email}`, name, picture: '' });
function make(extra = {}) {
  const verifyGoogle = async cred => (cred.startsWith('good:') ? profile(cred.slice(5)) : null);
  return createAccounts({ ownerEmails: [OWNER], verifyGoogle, ...extra });
}

test('role rules: only the owner makes admins; admins manage beta; the owner is untouchable', () => {
  assert.equal(whyNotAllowed('owner', 'user', 'admin'), '');
  assert.equal(whyNotAllowed('owner', 'admin', 'user'), '');
  assert.equal(whyNotAllowed('admin', 'user', 'beta'), '');
  assert.equal(whyNotAllowed('admin', 'beta', 'user'), '');
  assert.match(whyNotAllowed('admin', 'user', 'admin'), /owner/);
  assert.match(whyNotAllowed('admin', 'admin', 'user'), /owner/);
  assert.match(whyNotAllowed('owner', 'owner', 'user'), /cannot/);
  assert.match(whyNotAllowed('owner', 'user', 'owner'), /cannot/);
  assert.match(whyNotAllowed('beta', 'user', 'beta'), /admins/);
  assert.match(whyNotAllowed('user', 'user', 'beta'), /admins/);
});

test('entitlements: beta and up always get everything; free users get nothing extra unless allowed and seated', () => {
  assert.deepEqual([entitlements('beta').hostedAi, entitlements('beta').premium, entitlements('beta', { seat: false }).seat], [true, true, true]);
  assert.equal(entitlements('user').hostedAi, false);
  assert.equal(entitlements('user', { freeHostedAi: true }).hostedAi, true);
  assert.equal(entitlements('user', { freeHostedAi: true, seat: false }).hostedAi, false);
  assert.equal(entitlements('admin').admin, true); assert.equal(entitlements('beta').admin, false); assert.equal(entitlements('owner').owner, true);
});

test('sessions: signed, expiring, tamper-proof', () => {
  let t = 1000; const s = createSessions({ secret: 'k', now: () => t, ttlMs: 500 });
  const tok = s.issue('A@Example.com');
  assert.equal(s.verify(tok), 'a@example.com');
  assert.equal(createSessions({ secret: 'other', now: () => t }).verify(tok), null);
  assert.equal(s.verify(tok.replace(/^./, c => (c === 'e' ? 'f' : 'e'))), null);
  assert.equal(s.verify('garbage'), null);
  t = 2000; assert.equal(s.verify(tok), null, 'expired');
});

test('presence: the cap seats free users in order of arrival; beta never counts and never loses a seat', () => {
  let t = 0; const p = createPresence({ cap: 2, ttlMs: 100, now: () => t });
  p.beat('a', false); t++; p.beat('b', false); t++; p.beat('c', false); p.beat('vip', true);
  assert.deepEqual(['a', 'b', 'c', 'vip'].map(e => p.seat(e)), [true, true, false, true]);
  assert.deepEqual(p.counts(), { online: 4, free: 3, privileged: 1, cap: 2 });
  t += 200; p.beat('c', false);                       // everyone else went quiet: c now has a seat
  assert.equal(p.seat('c'), true);
  assert.equal(createPresence({ cap: 0 }).seat('anyone'), true, 'no cap, no limit');
});

test('sign-in, the owner, granting and revoking beta, and what an admin can and cannot do', async () => {
  const acc = make();
  assert.equal(await acc.signIn('bad-token'), null);
  const o = await acc.signIn(`good:${OWNER}`), u = await acc.signIn('good:kid@example.com');
  assert.equal(o.me.role, 'owner'); assert.equal(u.me.role, 'user'); assert.equal(u.me.entitlements.premium, false);
  assert.equal((await acc.setRole(u.token, 'x@example.com', 'beta')).status, 403, 'a normal user cannot grant');
  // the owner invites someone before they have ever signed in; when they do, they are already beta
  assert.equal((await acc.setRole(o.token, 'Future@Example.com', 'beta')).ok, true);
  const f = await acc.signIn('good:future@example.com');
  assert.equal(f.me.role, 'beta'); assert.equal(f.me.entitlements.hostedAi, true);
  // owner makes an admin; the admin manages beta but cannot make admins or touch the owner
  await acc.setRole(o.token, 'kid@example.com', 'admin');
  const k = await acc.me(u.token); assert.equal(k.role, 'admin');
  assert.equal((await acc.setRole(u.token, 'future@example.com', 'user')).ok, true, 'admin revokes beta');
  assert.equal((await acc.me(f.token)).role, 'user', 'takes effect on the very next request');
  assert.equal((await acc.setRole(u.token, 'new@example.com', 'admin')).ok, false);
  assert.equal((await acc.setRole(u.token, OWNER, 'user')).ok, false);
  assert.equal((await acc.setRole(o.token, OWNER, 'user')).ok, false);
  assert.equal((await acc.setRole(o.token, 'not-an-email', 'beta')).status, 400);
  const list = await acc.listUsers(o.token);
  assert.ok(list.users.some(x => x.email === 'kid@example.com' && x.role === 'admin'));
  assert.equal(await acc.listUsers(f.token), null, 'not an admin any more');
});

test('a cap on free users leaves beta untouched', async () => {
  const acc = make({ presence: createPresence({ cap: 1 }), freeHostedAi: true });
  const a = await acc.signIn('good:a@example.com'), b = await acc.signIn('good:b@example.com');
  const o = await acc.signIn(`good:${OWNER}`); await acc.setRole(o.token, 'c@example.com', 'beta'); const c = await acc.signIn('good:c@example.com');
  for (const x of [a, b, c]) await acc.me(x.token, { beat: true });
  assert.equal((await acc.me(a.token)).entitlements.hostedAi, true);
  assert.equal((await acc.me(b.token)).entitlements.hostedAi, false, 'second free user is over the cap');
  assert.equal((await acc.me(c.token)).entitlements.hostedAi, true, 'beta is exempt');
});

test('the Postgres store behaves like the memory store (pg-mem)', async () => {
  const { newDb } = await import('pg-mem');
  const { Pool } = newDb().adapters.createPg();
  const pg = createPgStore(new Pool()); await pg.init();
  const acc = make({ store: pg });
  const o = await acc.signIn(`good:${OWNER}`);
  assert.equal((await acc.setRole(o.token, 'b@example.com', 'beta')).ok, true);
  const b = await acc.signIn('good:b@example.com'); assert.equal(b.me.role, 'beta');
  assert.equal((await acc.setRole(o.token, 'b@example.com', 'user')).ok, true);
  assert.equal((await acc.me(b.token)).role, 'user');
  assert.equal((await acc.listUsers(o.token)).users.length >= 2, true);
  assert.equal((await acc.setRole(o.token, 'never@example.com', 'beta')).ok, true);
  assert.equal((await acc.setRole(o.token, 'never@example.com', 'user')).ok, true);
  assert.equal(await pg.get('never@example.com'), null, 'revoking an unused invite forgets it');
});

test('Google verification needs the right audience, issuer and a verified email', async () => {
  const { SignJWT, generateKeyPair } = await import('jose');
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwks = async () => publicKey;
  const mk = (claims, { aud = 'cid', iss = 'https://accounts.google.com' } = {}) => new SignJWT({ email: 'a@b.com', email_verified: true, name: 'A', ...claims }).setProtectedHeader({ alg: 'RS256' }).setSubject('1').setIssuer(iss).setAudience(aud).setExpirationTime('1h').sign(privateKey);
  const v = createGoogleVerifier({ clientId: 'cid', jwks });
  assert.equal((await v(await mk({})))?.email, 'a@b.com');
  assert.equal(await v(await mk({}, { aud: 'other' })), null);
  assert.equal(await v(await mk({}, { iss: 'https://evil.example' })), null);
  assert.equal(await v(await mk({ email_verified: false })), null);
  assert.equal(await v('nonsense'), null);
  assert.equal(await createGoogleVerifier({ clientId: '' })('x'), null);
});

async function http(accounts, hostedAi = null, aiCalls = []) {
  const ai = { generateCode: async b => { aiCalls.push(b); return { ok: true, actions: [], code: null, explanation: 'hi' }; }, createPart: async () => ({ ok: true }) };
  const srv = createServer({ compiler: { version: async () => 'x', compile: async () => ({}) }, ai, accounts, hostedAi });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (path, { method = 'GET', body, token } = {}) => { const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
  return { call, close: () => srv.close() };
}

test('HTTP: sign-in, /api/me, admin routes, and the included AI is only for entitled members', async () => {
  const acc = make(), calls = [];
  const { call, close } = await http(acc, { key: 'SERVER-KEY', provider: 'groq', model: 'm' }, calls);
  try {
    assert.equal((await call('/api/config')).body.accounts, true);
    assert.equal((await call('/api/auth/google', { method: 'POST', body: { credential: 'nope' } })).status, 401);
    const o = (await call('/api/auth/google', { method: 'POST', body: { credential: `good:${OWNER}` } })).body;
    const u = (await call('/api/auth/google', { method: 'POST', body: { credential: 'good:kid@example.com' } })).body;
    assert.equal((await call('/api/me', { token: u.token })).body.me.role, 'user');
    assert.equal((await call('/api/me')).status, 401);
    assert.equal((await call('/api/admin/users', { token: u.token })).status, 403);
    assert.equal((await call('/api/admin/users', { token: o.token })).status, 200);
    // included AI: not signed in, free user, then a beta member
    const ask = token => call('/api/ai/generate-code', { method: 'POST', token, body: { instruction: 'x', hosted: true, userKey: 'attacker', provider: 'gemini' } });
    assert.equal((await ask()).status, 401);
    assert.equal((await ask(u.token)).status, 403);
    assert.equal((await call('/api/admin/users', { method: 'POST', token: o.token, body: { email: 'kid@example.com', role: 'beta' } })).status, 200);
    assert.equal((await ask(u.token)).status, 200);
    assert.deepEqual([calls.at(-1).userKey, calls.at(-1).provider, calls.at(-1).hosted], ['SERVER-KEY', 'groq', undefined], 'the server key is used, the client cannot choose it');
    // revoke: gone on the next request
    assert.equal((await call('/api/admin/users?email=kid@example.com', { method: 'DELETE', token: o.token })).status, 200);
    assert.equal((await ask(u.token)).status, 403);
    // a BYO-key request still works with no account at all
    assert.equal((await call('/api/ai/generate-code', { method: 'POST', body: { instruction: 'x', userKey: 'mine', provider: 'gemini' } })).status, 200);
  } finally { close(); }
});

test('HTTP: included AI not configured on the server → a clear 503, never a leaked key', async () => {
  const acc = make(); const { call, close } = await http(acc, null);
  try {
    const o = (await call('/api/auth/google', { method: 'POST', body: { credential: `good:${OWNER}` } })).body;
    const r = await call('/api/ai/generate-code', { method: 'POST', token: o.token, body: { instruction: 'x', hosted: true } });
    assert.equal(r.status, 503);
  } finally { close(); }
});
