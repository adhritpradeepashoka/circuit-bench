import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccounts } from '../server/accounts.mjs';
import { createCloudProjects, createMemoryProjectStore } from '../server/cloud-projects.mjs';
import { createLocalStore, newProject } from '../src/core/projects.js';
import { createSyncedStore } from '../src/core/cloud-sync.js';

const fakeStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
async function world() {
  const acc = createAccounts({ ownerEmails: [], verifyGoogle: async c => ({ email: c.slice(5), sub: c, name: 'x', picture: '' }) });
  const cloud = createCloudProjects({ accounts: acc, store: createMemoryProjectStore() });
  const tokens = { a: (await acc.signIn('good:kid@example.com')).token, b: (await acc.signIn('good:kid@example.com')).token, other: (await acc.signIn('good:other@example.com')).token };
  const device = (who = 'a', open = null) => {
    const storage = fakeStorage(), local = createLocalStore(storage), token = () => tokens[who];
    const call = fn => async (...args) => { if (!token()) return null; const r = await fn(token(), ...args); return r; };
    const api = { list: call(t => cloud.list(t)), get: call((t, id) => cloud.get(t, id)), put: call((t, id, b) => cloud.put(t, id, b)), remove: call((t, id) => cloud.remove(t, id)) };
    const scene = { read: id => { try { return JSON.parse(storage.getItem(`circuitbench:robot-scene:${id}`)); } catch { return null; } }, write: (id, v) => (v ? storage.setItem(`circuitbench:robot-scene:${id}`, JSON.stringify(v)) : storage.removeItem(`circuitbench:robot-scene:${id}`)) };
    const timers = []; const store = createSyncedStore(local, { api, scene, storage, skip: () => open, wait: 0, setTimer: fn => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
    return { store, local, scene, storage, tick: async () => { while (timers.length) timers.shift()(); await store.flush(); await store.sync(); } };
  };
  return { cloud, tokens, device };
}

test('sync: a project made on one device (with its 3D scene) appears on another', async () => {
  const w = await world(), a = w.device('a'), b = w.device('b');
  const p = newProject({ name: 'Quad', workspace: 'robotics', data: { x: 1 }, now: 1000 }); await a.store.save(p); a.scene.write(p.id, { parts: [{ part: 'frame', T: {} }] });
  await a.tick(); const out = await b.store.sync();
  assert.equal(out.pulled, 1); const got = await b.store.load(p.id); assert.equal(got.name, 'Quad'); assert.deepEqual(got.data, { x: 1 }); assert.equal(got.workspace, 'robotics');
  assert.deepEqual(b.scene.read(p.id), { parts: [{ part: 'frame', T: {} }] });
});
test('sync: newest save wins both ways, and an edit on one device reaches the other', async () => {
  const w = await world(), a = w.device('a'), b = w.device('b'); const p = newProject({ name: 'One', data: { v: 1 }, now: 1000 }); await a.store.save(p); await a.tick(); await b.store.sync();
  await b.store.save({ ...(await b.store.load(p.id)), data: { v: 2 }, name: 'Two', updatedAt: 5000 }); await b.tick(); await a.store.sync();
  assert.deepEqual((await a.store.load(p.id)).data, { v: 2 }); assert.equal((await a.store.load(p.id)).name, 'Two');
  await a.local.save({ ...(await a.store.load(p.id)), data: { v: 0 }, updatedAt: 3000 });       // an older edit made offline never beats the newer one
  await a.store.sync(); assert.deepEqual((await a.store.load(p.id)).data, { v: 2 });
});
test('sync: deleting on one device deletes it on the other, and an open project is never rewritten under you', async () => {
  const w = await world(), a = w.device('a'), p = newProject({ name: 'Gone', now: 1000 }), q = newProject({ name: 'Keep', now: 1000 }); await a.store.save(p); await a.store.save(q); await a.tick();
  const b = w.device('b', q.id); await b.store.sync(); assert.equal((await b.store.list()).length, 2);
  await a.store.remove(p.id); await a.store.flush(); await a.store.sync(); await b.store.sync();
  assert.deepEqual((await b.store.list()).map(m => m.name), ['Keep']);
  await a.store.save({ ...(await a.store.load(q.id)), data: { n: 9 }, updatedAt: 9000 }); await a.tick(); await b.store.sync();
  assert.equal((await b.store.load(q.id)).data, null, 'the project open on this device is left alone');
});
test('sync: signed out it does nothing, and what you did signed out is sent after you sign in; accounts never mix', async () => {
  const w = await world(), a = w.device('a'), nobody = w.device(null), other = w.device('other');
  const p = newProject({ name: 'Offline', now: 1000 }); await nobody.store.save(p); await nobody.tick(); assert.equal((await nobody.store.list()).length, 1);
  assert.equal(await nobody.store.sync(), null);
  await a.store.save(newProject({ name: 'Mine', now: 1000 })); await a.tick(); assert.deepEqual((await other.store.sync()).pulled, 0); assert.equal((await other.store.list()).length, 0);
  await a.store.remove((await a.store.list())[0].id); assert.equal((await a.store.list()).length, 0);
});
test('sync: a delete made while signed out reaches the server at the next sync', async () => {
  const w = await world(), a = w.device('a'); const p = newProject({ name: 'Doomed', now: 1000 }); await a.store.save(p); await a.tick();
  const phone = w.device('b'); await phone.store.sync();
  const offline = createSyncedStore(phone.local, { api: { list: async () => null, get: async () => null, put: async () => null, remove: async () => null }, storage: phone.storage, wait: 0 });
  await offline.remove(p.id); await offline.flush(); await phone.store.sync(); assert.equal((await phone.store.list()).length, 0, 'it is not brought back');
  await a.store.sync(); assert.equal((await a.store.list()).length, 0);
});

test('sync: the blank first project every new browser makes is not copied to the cloud, but an edited one is', async () => {
  const w = await world(), a = w.device('a'), b = w.device('b');
  await a.store.save(newProject({ name: 'My first project', now: 1000 })); await a.tick(); assert.equal((await w.cloud.list(w.tokens.a)).projects.length, 0);
  const q = newProject({ name: 'Real work', now: 1000 }); await a.store.save(q); await a.tick(); await b.store.save(newProject({ name: 'My first project', now: 1000 })); await b.tick();
  assert.deepEqual((await b.store.list()).map(m => m.name).sort(), ['My first project', 'Real work']); assert.equal((await w.cloud.list(w.tokens.a)).projects.length, 1);
  const edited = newProject({ name: 'My first project', now: 1000 }); edited.updatedAt = 1000 + 60_000; await a.local.save(edited); await a.store.sync(); assert.equal((await w.cloud.list(w.tokens.a)).projects.length, 2, 'once you have worked on it, it syncs');
});
