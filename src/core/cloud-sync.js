// Keeps a signed-in person's projects in step between this browser and the server, so they follow them to another
// browser, device or web address. A wrapper around the local store: it has the same five methods, so the rest of the
// app does not know it is there. Without an account it does nothing at all and the app works exactly as before.
//
// The rule is "newest save wins", per project. A delete leaves a tombstone on the server so other devices delete it too.
// The 3D scene of a robotics project rides along with the project. Imported 3D model files do not (they stay in the
// browser they were imported in). DOM-free: the page passes in the pieces that touch the network and storage.

const PENDING = 'circuitbench:sync-deletes';

/**
 * @param local   a store from createLocalStore()
 * @param api     { list(), get(id), put(id, project), remove(id) } → resolves to the server's JSON, or null when not signed in / unreachable
 * @param scene   { read(id) → object|null, write(id, object|null) }: the robotics scene kept beside a project
 * @param skip    () => id of the project open right now (a pull never rewrites the one you are editing)
 */
export function createSyncedStore(local, { api, scene = { read: () => null, write() {} }, skip = () => null, storage = globalThis.localStorage, status = () => {}, onChange = () => {}, wait = 2500, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let chain = Promise.resolve(), timers = new Map(), enabled = true;
  const run = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p.catch(() => null); };      // one network job at a time, and a failure never blocks the next
  const pend = () => { try { const v = JSON.parse(storage.getItem(PENDING) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  const setPend = l => { try { l.length ? storage.setItem(PENDING, JSON.stringify([...new Set(l)])) : storage.removeItem(PENDING); } catch { /* ignore */ } };

  /** The blank "My first project" every new browser makes for itself: not worth a cloud copy, or each device would add another. */
  const pristine = m => m.name === 'My first project' && (m.updatedAt || 0) - (m.createdAt || 0) < 20_000;
  async function push(id) {
    const p = await local.load(id); if (!p || pristine(p)) return false;
    const r = await api.put(id, { id, name: p.name, workspace: p.workspace, createdAt: p.createdAt, updatedAt: p.updatedAt, data: p.data ?? null, scene: scene.read(id) ?? null });
    return !!r?.ok;
  }
  async function pull(id, remote) {
    const r = await api.get(id); if (!r?.ok) return false;
    const p = r.project; await local.save({ id, name: p.name, workspace: p.workspace, createdAt: p.createdAt, updatedAt: p.updatedAt, data: p.data });
    scene.write(id, p.scene ?? null); return true;
  }

  /** Compare every project here with the server's and bring the older side up to date. Returns counts. */
  async function sync() {
    if (!enabled) return null;
    const out = { pulled: 0, pushed: 0, removed: 0 };
    for (const id of pend()) { const d = await api.remove(id); if (d?.ok) setPend(pend().filter(x => x !== id)); }          // deletes made while signed out go first
    const rl = await api.list(); if (!rl?.ok) return null;
    const remote = new Map(rl.projects.map(p => [p.id, p])), mine = new Map((await local.list()).map(m => [m.id, m])), open = skip();
    for (const [id, r] of remote) {
      const l = mine.get(id);
      if (r.deleted) { if (l && l.id !== open && (l.updatedAt || 0) <= r.updatedAt) { await local.remove(id); scene.write(id, null); out.removed++; } else if (l && (l.updatedAt || 0) > r.updatedAt && await push(id)) out.pushed++; continue; }
      if (!l) { if (await pull(id, r)) out.pulled++; }
      else if ((l.updatedAt || 0) > r.updatedAt) { if (await push(id)) out.pushed++; }
      else if ((l.updatedAt || 0) < r.updatedAt && id !== open) { if (await pull(id, r)) out.pulled++; }
    }
    for (const [id] of mine) if (!remote.has(id) && !pend().includes(id) && await push(id)) out.pushed++;
    if (out.pulled || out.removed) { onChange(out); status(`Synced your projects: ${out.pulled} brought in${out.removed ? `, ${out.removed} removed` : ''}.`); }
    return out;
  }
  function schedule(id) {
    if (!enabled) return; clearTimer(timers.get(id));
    timers.set(id, setTimer(() => { timers.delete(id); run(() => push(id)); }, wait));
  }
  /** Send anything waiting now (the page is being hidden or closed). */
  function flush() { for (const [id, t] of timers) { clearTimer(t); timers.delete(id); run(() => push(id)); } return chain; }

  return {
    kind: 'synced',
    list: () => local.list(), load: id => local.load(id),
    async save(project) { const p = await local.save(project); schedule(p.id); return p; },
    async remove(id) {
      clearTimer(timers.get(id)); timers.delete(id); await local.remove(id);
      run(async () => { const r = await api.remove(id); if (!r?.ok) setPend([...pend(), id]); });                       // couldn't tell the server (signed out, offline): tell it at the next sync
    },
    sync: () => run(sync),
    scheduleScene: schedule, flush, setEnabled(v) { enabled = !!v; },
  };
}
