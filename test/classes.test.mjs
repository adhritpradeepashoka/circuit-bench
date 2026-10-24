import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccounts, createMemoryStore, createPgStore } from '../server/accounts.mjs';
import { createClasses, createMemoryClassStore, createPgClassStore } from '../server/classes.mjs';
import { cleanSettings, mergeFeatures, openProjects, newCurriculum, cleanCurriculum, PRESETS, FEATURE_IDS } from '../src/core/classroom.js';
import { DEFAULT_CURRICULUM } from '../src/core/curriculum.js';

const OWNER = 'owner@example.com';
const verify = async c => (c.startsWith('good:') ? { email: c.slice(5), sub: c, name: c.slice(5).split('@')[0], picture: '' } : null);
async function world(pg = false, opts = {}) {
  let store = createMemoryStore(), cs = createMemoryClassStore();
  if (pg) { const { newDb } = await import('pg-mem'); const { Pool } = newDb().adapters.createPg(); const pool = new Pool(); store = createPgStore(pool); cs = createPgClassStore(pool); await store.init(); await cs.init(); }
  const accounts = createAccounts({ store, ownerEmails: [OWNER], verifyGoogle: verify, ...opts });
  const classes = createClasses({ accounts, store: cs });
  const tok = async e => (await accounts.signIn(`good:${e}`)).token;
  return { accounts, classes, tok };
}
const as = async (w, email, kind) => { const t = await w.tok(email); if (kind) assert.equal((await w.accounts.chooseKind(t, kind)).ok, true); return t; };

test('classroom rules: presets, stricter-wins, junk is ignored, the course has 30 projects', () => {
  assert.equal(DEFAULT_CURRICULUM.length, 30); assert.equal(new Set(DEFAULT_CURRICULUM.map(p => p.id)).size, 30);
  assert.equal(cleanSettings({ preset: 'everything' }).features.ai, true);
  assert.equal(cleanSettings({ preset: 'standard', features: { ai: true } }).preset, 'custom');
  assert.equal(cleanSettings({ preset: 'bogus', features: { ai: 'yes', nope: true } }).features.ai, false);
  const merged = mergeFeatures([cleanSettings({ preset: 'everything' }), cleanSettings({ preset: 'focused' })]);
  assert.equal(merged.code, true); assert.equal(merged.ai, false, 'one class says no → no');
  assert.deepEqual(Object.keys(PRESETS.focused.features), FEATURE_IDS);
  const cur = newCurriculum(), open = openProjects(cur, { p01: 'submitted' }, 'linear');
  assert.deepEqual(open.slice(0, 3).map(p => [p.id, p.open]), [['p01', true], ['p02', true], ['p03', false]]);
  assert.ok(openProjects(cur, {}, 'open').every(p => p.open));
  assert.equal(cleanCurriculum([{ id: 'x1', title: '  Hi ', goal: 'g' }, { id: 'x1', title: 'dup' }, { id: '!!', title: 'bad id' }]).length, 1);
  assert.equal(cleanCurriculum('junk').length, 30);
});

for (const pg of [false, true]) {
  test(`classes (${pg ? 'postgres (pg-mem)' : 'memory'}): teacher makes a class, students join, hand in, teacher reviews`, async () => {
    const w = await world(pg), { classes } = w;
    const teacher = await as(w, 'ms.rao@school.org', 'teacher'), kid = await as(w, 'asha@school.org'), kid2 = await as(w, 'ben@school.org', 'student');
    assert.equal((await classes.create(kid, {})).status, 403, 'a non-teacher cannot make a class');
    const made = await classes.create(teacher, { name: '  Grade 9 Robotics ' }); assert.equal(made.ok, true); assert.equal(made.class.name, 'Grade 9 Robotics'); assert.match(made.class.code, /^[A-Z2-9]{6}$/);
    const id = made.class.id, code = made.class.code;
    assert.equal((await classes.join(kid, 'zzzzzz')).status, 404);
    assert.equal((await classes.join(kid, code.toLowerCase())).ok, true, 'codes are not case sensitive');
    assert.equal((await classes.join(kid, code)).already, true);
    assert.equal((await classes.join(kid2, code)).ok, true);
    assert.equal((await w.accounts.me(kid)).kind, 'student', 'joining with a code makes an unset account a student');
    assert.equal((await classes.join(teacher, code)).status, 403);
    // the student's view: only the first project is open
    let v = await classes.view(kid, id); assert.equal(v.role, 'student'); assert.equal(v.projects[0].status, 'todo'); assert.equal(v.projects[1].status, 'locked');
    assert.equal((await classes.submit(kid, id, { projectId: 'p02', data: {} })).status, 403, 'cannot skip ahead in a linear class');
    assert.equal((await classes.submit(kid, id, { projectId: 'p01', data: { parts: [1] }, note: 'my led' })).ok, true);
    v = await classes.view(kid, id); assert.equal(v.projects[0].status, 'submitted'); assert.equal(v.projects[1].status, 'todo', 'the next one unlocks');
    // the teacher's view
    const t = await classes.view(teacher, id); assert.equal(t.role, 'teacher'); assert.equal(t.roster.length, 2);
    assert.equal(t.roster.find(r => r.email === 'asha@school.org').progress.p01.status, 'submitted');
    assert.equal((await classes.view(kid, id)).role, 'student'); assert.equal((await classes.work(kid, id, 'asha@school.org', 'p01')).status, 404, 'a student cannot open handed-in work');
    assert.deepEqual((await classes.work(teacher, id, 'asha@school.org', 'p01')).data, { parts: [1] });
    assert.equal((await classes.review(teacher, id, { email: 'asha@school.org', projectId: 'p01', status: 'returned', comment: 'add a resistor' })).ok, true);
    v = await classes.view(kid, id); assert.equal(v.projects[0].status, 'returned'); assert.equal(v.projects[0].comment, 'add a resistor');
    assert.equal((await classes.review(kid, id, { email: 'ben@school.org', projectId: 'p01', status: 'done' })).status, 404, 'a student cannot review');
    // another teacher cannot see the class
    const other = await as(w, 'mr.k@school.org', 'teacher'); assert.equal((await classes.view(other, id)).status, 404); assert.equal((await classes.patch(other, id, { name: 'x' })).status, 404);
    // roster and list
    assert.equal((await classes.list(teacher)).classes[0].students, 2); assert.equal((await classes.list(kid)).classes[0].done, 0);
    assert.equal((await classes.removeStudent(teacher, id, 'ben@school.org')).ok, true); assert.equal((await classes.view(kid2, id)).status, 404);
    assert.equal((await classes.leave(kid, id)).ok, true);
    const nc = await classes.newCode(teacher, id); assert.match(nc.code, /^[A-Z2-9]{6}$/); assert.equal((await classes.join(kid, code)).status, nc.code === code ? 200 : 404, 'the old code stops working');
    assert.equal((await classes.remove(other, id)).status, 404); assert.equal((await classes.remove(teacher, id)).ok, true); assert.equal((await classes.list(teacher)).classes.length, 0);
  });

  test(`classes (${pg ? 'postgres (pg-mem)' : 'memory'}): switches are per class, the stricter one wins, and the server enforces them`, async () => {
    const w = await world(pg), { classes } = w;
    const teacher = await as(w, 't@school.org', 'teacher'), teacher2 = await as(w, 't2@school.org', 'teacher'), kid = await as(w, 'k@school.org', 'student');
    const a = (await classes.create(teacher, { name: 'A' })).class, b = (await classes.create(teacher2, { name: 'B' })).class;
    await classes.join(kid, a.code);
    let me = await w.accounts.me(kid); assert.equal(me.classroom.features.ai, false, 'new classes start Focused'); assert.equal(me.classroom.features.code, true);
    assert.equal(await classes.allowed(kid, 'ai'), false);
    assert.equal(me.classroom.features.themes, true, 'students may change the look unless the teacher locks it');
    assert.equal(me.classroom.features.personal, true);
    assert.equal(await classes.allowed(kid, 'ai', { personal: true }), true, 'their personal profile has everything on');
    assert.equal((await classes.patch(teacher, a.id, { settings: { features: { personal: false } } })).class.settings.preset, 'custom');
    assert.equal(await classes.allowed(kid, 'ai', { personal: true }), false, 'a class can switch the personal profile off');
    assert.equal((await classes.patch(teacher, a.id, { settings: { preset: 'focused' } })).ok, true);
    assert.equal((await classes.patch(teacher, a.id, { settings: { preset: 'everything' } })).ok, true);
    assert.equal(await classes.allowed(kid, 'ai'), true, 'the teacher switched it on');
    await classes.join(kid, b.code); assert.equal(await classes.allowed(kid, 'ai'), false, 'the second class is Focused, so the stricter one wins');
    assert.equal((await classes.patch(teacher, a.id, { settings: { features: { community: false } } })).class.settings.preset, 'custom');
    assert.equal((await classes.patch(teacher, a.id, { unlock: 'open' })).class.settings.unlock, 'open');
    assert.equal((await classes.patch(teacher, a.id, { curriculum: [{ id: 'mine', title: 'My first one', goal: 'g' }] })).curriculum.length, 1);
    assert.equal((await classes.view(kid, a.id)).projects[0].title, 'My first one', 'each class has its own copy of the course');
    assert.equal((await classes.view(kid, b.id)).projects.length, 30);
    // a single user, a teacher and a signed-out visitor are never limited
    assert.equal(await classes.allowed(teacher, 'ai'), true); assert.equal(await classes.allowed('', 'ai'), true);
  });
}

test('account type: chosen once, teachers can be closed, admins can change it, owner can demo every type', async () => {
  const w = await world(false, { teacherSignup: false }); const { accounts, classes } = w;
  const u = await w.tok('new@x.org');
  assert.equal((await accounts.me(u)).kind, '');
  assert.equal((await accounts.chooseKind(u, 'teacher')).status, 403, 'teacher sign-up is closed');
  assert.equal((await accounts.chooseKind(u, 'robot')).status, 400);
  assert.equal((await accounts.chooseKind(u, 'single')).ok, true);
  assert.equal((await accounts.chooseKind(u, 'student')).status, 403, 'cannot change it yourself afterwards');
  const owner = await w.tok(OWNER);
  assert.equal((await accounts.setKindFor(u, 'new@x.org', 'teacher')).status, 403);
  assert.equal((await accounts.setKindFor(owner, 'new@x.org', 'teacher')).ok, true); assert.equal((await accounts.me(u)).kind, 'teacher');
  assert.equal((await accounts.chooseKind(owner, 'student')).ok, true, 'the owner may switch freely');
  assert.equal((await accounts.chooseKind(owner, 'teacher')).ok, true);
  const demo = await classes.demo(owner); assert.equal(demo.ok, true);
  const v = await classes.view(owner, demo.class.id); assert.equal(v.roster.length, 6); assert.ok(Object.keys(v.roster[2].progress).length >= 3);
  assert.equal((await classes.demo(u)).status, 403);
});

test('http: a student whose class turned AI and the community off gets a 403 from the API itself', async () => {
  const { createServer } = await import('../server/server.mjs'); const { createCommunity, createMemoryCommunity } = await import('../server/community.mjs');
  const w = await world(false), cstore = createMemoryCommunity(); await cstore.init();
  const server = createServer({ accounts: w.accounts, classes: w.classes, community: createCommunity({ accounts: w.accounts, store: cstore }), ai: { generateCode: async () => ({ ok: true }), createPart: async () => ({ ok: true }) } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const teacher = await as(w, 't@school.org', 'teacher'), kid = await as(w, 'k@school.org', 'student'), free = await as(w, 'f@x.org', 'single');
    const c = (await w.classes.create(teacher, { name: 'A' })).class; await w.classes.join(kid, c.code);
    const call = (path, tok, body) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    assert.equal((await call('/api/ai/generate-code', kid, { prompt: 'x' })).status, 403);
    assert.equal((await fetch(base + '/api/ai/generate-code', { method: 'POST', headers: { authorization: `Bearer ${kid}`, 'content-type': 'application/json', 'x-cb-profile': 'personal' }, body: '{"prompt":"x"}' })).status, 200, 'the personal profile is not limited');
    assert.equal((await call('/api/community/posts', kid)).status, 403);
    assert.equal((await call('/api/community/posts', free)).status, 200);
    assert.equal((await call('/api/ai/generate-code', free, { prompt: 'x' })).status, 200);
    await w.classes.patch(teacher, c.id, { settings: { preset: 'everything' } });
    assert.equal((await call('/api/ai/generate-code', kid, { prompt: 'x' })).status, 200);
    assert.equal((await call('/api/classes/join', kid, { code: 'ZZZZZZ' })).status, 404);
    assert.equal((await call('/api/account/kind', free, { kind: 'teacher' })).status, 403);
  } finally { server.close(); }
});
