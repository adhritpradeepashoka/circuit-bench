import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccounts } from '../server/accounts.mjs';
import { createCommunity, createPgCommunity, createMemoryCommunity, LIMITS } from '../server/community.mjs';
import { createServer } from '../server/server.mjs';

const OWNER = 'owner@example.com';
const accounts = () => createAccounts({ ownerEmails: [OWNER], verifyGoogle: async c => (c.startsWith('good:') ? { email: c.slice(5), sub: c, name: c.slice(5).split('@')[0], picture: '' } : null) });
async function setup(storeFactory = createMemoryCommunity, now) {
  const acc = accounts(), store = storeFactory(); await store.init();
  const community = createCommunity({ accounts: acc, store, now });
  const tok = async e => (await acc.signIn(`good:${e}`)).token;
  return { acc, community, owner: await tok(OWNER), kid: await tok('kid@example.com'), kid2: await tok('kid2@example.com') };
}

for (const [name, factory] of [['memory', () => createMemoryCommunity()], ['postgres (pg-mem)', async () => { const { newDb } = await import('pg-mem'); const { Pool } = newDb().adapters.createPg(); return createPgCommunity(new Pool()); }]]) {
  test(`community (${name}): updates from the team, topics from anyone, comments, ownership`, async () => {
    const st = await factory();
    const acc = accounts(); await st.init();
    const c = createCommunity({ accounts: acc, store: st });
    const owner = (await acc.signIn(`good:${OWNER}`)).token, kid = (await acc.signIn('good:kid@example.com')).token, kid2 = (await acc.signIn('good:kid2@example.com')).token;
    assert.equal((await c.create(kid, { kind: 'update', title: 'Hi', body: 'x' })).status, 403, 'users cannot post updates');
    assert.equal((await c.create('', { kind: 'topic', title: 'Hi', body: 'x' })).status, 401);
    const up = (await c.create(owner, { kind: 'update', title: 'Beta is live', body: 'Welcome!' })).post;
    const tp = (await c.create(kid, { kind: 'topic', title: 'Slime mold ideas', body: 'Anyone tried a grid?' })).post;
    assert.deepEqual((await c.list('update')).posts.map(p => p.title), ['Beta is live']);
    assert.equal((await c.list()).posts.length, 2);
    assert.equal((await c.comment(kid2, tp.id, 'I did!')).ok, true);
    assert.equal((await c.comment('', tp.id, 'anon')).status, 401);
    assert.equal((await c.comment(kid2, tp.id, '   ')).status, 400);
    const r = await c.read(tp.id, kid2);
    assert.equal(r.comments.length, 1); assert.equal(r.comments[0].mine, true); assert.equal(r.post.mine, false);
    assert.equal((await c.list('topic')).posts[0].comments, 1);
    // who may change what
    assert.equal((await c.remove(kid2, tp.id)).status, 403);
    assert.equal((await c.edit(kid, tp.id, { pinned: true })).status, 403, 'only the team pins');
    assert.equal((await c.edit(owner, up.id, { pinned: true })).post.pinned, true);
    assert.equal((await c.list()).posts[0].id, up.id, 'pinned first');
    assert.equal((await c.removeComment(kid, r.comments[0].id)).status, 403);
    assert.equal((await c.removeComment(owner, r.comments[0].id)).ok, true, 'staff can moderate');
    assert.equal((await c.remove(kid, tp.id)).ok, true, 'authors can delete their own');
    assert.equal((await c.read(tp.id)).status, 404);
  });
}

test('community: plain text only, length limits, and a per-person rate limit', async () => {
  let t = 0; const { community, kid } = await setup(createMemoryCommunity, () => t);
  const big = await community.create(kid, { kind: 'topic', title: 'T'.repeat(500), body: '<img src=x onerror=alert(1)>\u0000\u0007hi' });
  assert.equal(big.post.title.length, LIMITS.title);
  assert.equal(big.post.body, '<img src=x onerror=alert(1)>hi', 'control characters stripped; markup is kept as inert text for the page to show with textContent');
  assert.equal((await community.create(kid, { kind: 'topic', title: '', body: 'x' })).status, 400);
  assert.equal((await community.create(kid, { kind: 'weird', title: 'a', body: 'b' })).status, 400);
  let last; for (let i = 0; i < LIMITS.perMinute + 1; i++) last = await community.comment(kid, big.post.id, `c${i}`);
  assert.equal(last.status, 429);
  t += 61_000; assert.equal((await community.comment(kid, big.post.id, 'later')).ok, true);
  assert.equal(JSON.stringify(big.post).includes('kid@example.com'), false, 'no email addresses leak to readers');
});

test('HTTP: community routes', async () => {
  const acc = accounts(), community = createCommunity({ accounts: acc });
  const srv = createServer({ compiler: { version: async () => 'x' }, accounts: acc, community });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (path, { method = 'GET', body, token } = {}) => { const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
  try {
    const kid = (await acc.signIn('good:kid@example.com')).token, owner = (await acc.signIn(`good:${OWNER}`)).token;
    assert.equal((await call('/api/community/posts', { method: 'POST', token: kid, body: { kind: 'update', title: 'a', body: 'b' } })).status, 403);
    const made = await call('/api/community/posts', { method: 'POST', token: owner, body: { kind: 'update', title: 'Hello', body: 'World' } });
    assert.equal(made.status, 200);
    const id = made.body.post.id;
    assert.equal((await call('/api/community/posts?kind=update')).body.posts.length, 1);
    assert.equal((await call(`/api/community/posts/${id}/comments`, { method: 'POST', token: kid, body: { body: 'nice' } })).status, 200);
    const read = await call(`/api/community/posts/${id}`, { token: kid });
    assert.equal(read.body.comments[0].body, 'nice');
    assert.equal((await call(`/api/community/comments/${read.body.comments[0].id}`, { method: 'DELETE', token: kid })).status, 200);
    assert.equal((await call('/api/community/posts/abc')).status, 404);
  } finally { srv.close(); }
});

for (const [name, factory] of [['memory', () => createMemoryCommunity()], ['postgres (pg-mem)', async () => { const { newDb } = await import('pg-mem'); const { Pool } = newDb().adapters.createPg(); return createPgCommunity(new Pool()); }]]) {
  test(`community (${name}): post flairs — team flairs for the team, the rest for everyone, filter by flair`, async () => {
    const st = await factory(); await st.init();
    const acc = accounts(), c = createCommunity({ accounts: acc, store: st });
    const owner = (await acc.signIn(`good:${OWNER}`)).token, kid = (await acc.signIn('good:kid@example.com')).token;
    assert.equal((await c.create(kid, { flair: 'fix', title: 'Fixed', body: 'x' })).status, 403, 'a user cannot use a team flair');
    assert.equal((await c.create(kid, { flair: 'nonsense', title: 'a', body: 'b' })).status, 400);
    const fix = (await c.create(owner, { flair: 'fix', title: 'ESC part maker fixed', body: 'It works now' })).post;
    const bug = (await c.create(kid, { flair: 'bug', title: 'Resistor sticks', body: 'Legs catch' })).post;
    const q = (await c.create(kid, { flair: 'question', title: 'How do I wire a BLDC?', body: '?' })).post;
    const legacy = (await c.create(kid, { kind: 'topic', title: 'Old style', body: 'no flair given' })).post;
    assert.deepEqual([fix.flair, bug.flair, q.flair, legacy.flair], ['fix', 'bug', 'question', 'discussion']);
    assert.deepEqual([fix.kind, bug.kind], ['update', 'topic'], 'team flairs are updates, the rest topics');
    assert.deepEqual((await c.list(null, 'bug')).posts.map(p => p.title), ['Resistor sticks']);
    assert.deepEqual((await c.list('update')).posts.map(p => p.title), ['ESC part maker fixed']);
    assert.equal((await c.read(q.id)).post.flair, 'question', 'readable without signing in');
    // changing a flair follows the same rules
    assert.equal((await c.edit(kid, q.id, { flair: 'update' })).status, 403);
    assert.equal((await c.edit(kid, q.id, { flair: 'idea' })).post.flair, 'idea');
    assert.equal((await c.edit(owner, q.id, { flair: 'roadmap' })).post.kind, 'update');
  });
}

test('HTTP: /blog and /blog/<id> serve the blog page, anyone can read posts without signing in, the lab stays at /', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'cb-blog-')); await writeFile(join(dir, 'index.html'), '<title>LAB</title>'); await writeFile(join(dir, 'blog.html'), '<title>BLOG</title>');
  const acc = accounts(), community = createCommunity({ accounts: acc });
  const srv = createServer({ accounts: acc, community, staticDir: dir });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`, get = async p => (await fetch(base + p)).text();
  try {
    const owner = (await acc.signIn(`good:${OWNER}`)).token;
    const post = (await community.create(owner, { flair: 'fix', title: 'Fixed', body: 'ok' })).post;
    assert.match(await get('/blog'), /BLOG/); assert.match(await get(`/blog/${post.id}`), /BLOG/); assert.match(await get('/'), /LAB/);
    const listed = await (await fetch(`${base}/api/community/posts?flair=fix`)).json();      // no Authorization header at all
    assert.deepEqual(listed.posts.map(p => p.flair), ['fix']);
    assert.equal((await fetch(`${base}/api/community/posts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ flair: 'bug', title: 'a', body: 'b' }) })).status, 401, 'posting needs sign-in');
  } finally { srv.close(); }
});

test('team themes: the owner and admins get theirs, the owner can grant more, nobody else can', async () => {
  const { themesFor } = await import('../src/core/staff-themes.js');
  assert.deepEqual(themesFor('owner'), ['founder', 'operator']); assert.deepEqual(themesFor('admin'), ['operator']); assert.deepEqual(themesFor('user'), []);
  const acc = accounts(), owner = (await acc.signIn(`good:${OWNER}`)).token, kid = (await acc.signIn('good:kid@example.com')).token, adm = (await acc.signIn('good:adm@example.com')).token;
  assert.deepEqual((await acc.me(kid)).entitlements.themes, []);
  assert.equal((await acc.setThemes(kid, 'kid@example.com', ['founder'])).status, 403, 'users cannot grant themselves');
  await acc.setRole(owner, 'adm@example.com', 'admin');
  assert.equal((await acc.setThemes(adm, 'kid@example.com', ['founder'])).status, 403, 'admins cannot grant either');
  assert.equal((await acc.setThemes(owner, 'kid@example.com', ['nope'])).status, 400);
  assert.equal((await acc.setThemes(owner, 'kid@example.com', ['operator'])).ok, true);
  assert.deepEqual((await acc.me(kid)).entitlements.themes, ['operator']);
  assert.deepEqual((await acc.me(adm)).entitlements.themes, ['operator']);
  assert.deepEqual((await acc.me(owner)).entitlements.themes, ['founder', 'operator']);
  assert.equal((await acc.setThemes(owner, 'kid@example.com', [])).ok, true);
  assert.deepEqual((await acc.me(kid)).entitlements.themes, []);
});
