// Cloud copies of a signed-in person's projects, so they follow them to another browser, device or web address.
// One row per (account email, project id). The page keeps working with no account: this only adds a copy.
// A delete leaves a small "tombstone" so the other devices learn it was deleted instead of bringing it back.
// What is stored: the project's own data (circuit + code, or the robotics settings) and its 3D scene (which parts, where).
// NOT stored: imported 3D model files — those stay in the browser they were imported in.
import { normEmail } from './accounts.mjs';

export const LIMITS = { projectBytes: 2_500_000, perUser: 100, name: 80, workspace: 40 };
const fail = (status, error) => ({ ok: false, status, error });
const idOk = id => /^p-[a-z0-9-]{3,40}$/.test(String(id || ''));
const meta = r => ({ id: r.id, name: r.name, workspace: r.workspace, createdAt: r.createdAt, updatedAt: r.updatedAt, deleted: !!r.deleted });

export function createMemoryProjectStore() {
  const rows = new Map();                                   // `${email}\n${id}` → row
  const key = (e, id) => `${e}\n${id}`;
  return {
    async init() {},
    async list(email) { return [...rows.values()].filter(r => r.email === email).map(meta); },
    async get(email, id) { return rows.get(key(email, id)) || null; },
    async put(email, row) { rows.set(key(email, row.id), { ...row, email }); },
    async count(email) { return [...rows.values()].filter(r => r.email === email && !r.deleted).length; },
  };
}
const R = r => r && ({ id: r.id, name: r.name, workspace: r.workspace, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at), deleted: !!r.deleted, payload: r.payload });
export function createPgProjectStore(pool) {
  const q = (sql, args) => pool.query(sql, args);
  return {
    async init() {
      await q(`create table if not exists cb_projects (email text not null, id text not null, name text not null, workspace text not null, created_at bigint not null, updated_at bigint not null, deleted boolean not null default false, payload text not null default '', primary key (email, id))`);
      try { await q('alter table cb_projects enable row level security'); } catch { /* not Postgres-proper (tests) */ }
    },
    async list(email) { return (await q('select id, name, workspace, created_at, updated_at, deleted from cb_projects where email = $1', [email])).rows.map(r => meta(R(r))); },
    async get(email, id) { return R((await q('select * from cb_projects where email = $1 and id = $2', [email, id])).rows[0]); },
    async put(email, r) {
      await q(`insert into cb_projects (email, id, name, workspace, created_at, updated_at, deleted, payload) values ($1,$2,$3,$4,$5,$6,$7,$8)
               on conflict (email, id) do update set name = $3, workspace = $4, created_at = $5, updated_at = $6, deleted = $7, payload = $8`,
        [email, r.id, r.name, r.workspace, r.createdAt, r.updatedAt, !!r.deleted, r.payload || '']);
    },
    async count(email) { return Number((await q('select count(*) as n from cb_projects where email = $1 and deleted = false', [email])).rows[0].n); },
  };
}

export function createCloudProjects({ accounts, store = createMemoryProjectStore(), now = () => Date.now() }) {
  async function who(token) { const me = token ? await accounts.me(token) : null; return me?.email ? normEmail(me.email) : null; }
  const need = fail(401, 'Sign in to sync your projects.');
  return {
    async list(token) { const e = await who(token); if (!e) return need; return { ok: true, projects: await store.list(e) }; },
    async get(token, id) {
      const e = await who(token); if (!e) return need; if (!idOk(id)) return fail(400, 'Bad project id.');
      const r = await store.get(e, id); if (!r) return fail(404, 'No such project.');
      let body = {}; try { body = r.payload ? JSON.parse(r.payload) : {}; } catch { body = {}; }
      return { ok: true, project: { ...meta(r), data: body.data ?? null, scene: body.scene ?? null } };
    },
    /** Last writer wins by updatedAt: an older copy never replaces a newer one. */
    async put(token, id, b) {
      const e = await who(token); if (!e) return need; if (!idOk(id)) return fail(400, 'Bad project id.');
      if (!b || typeof b !== 'object') return fail(400, 'Send the project as JSON.');
      const updatedAt = Number(b.updatedAt), createdAt = Number(b.createdAt) || updatedAt;
      if (!Number.isFinite(updatedAt) || updatedAt <= 0) return fail(400, 'The project has no save time.');
      const name = String(b.name ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.name) || 'Untitled project', workspace = String(b.workspace || 'arduino-uno').replace(/[^\w-]/g, '').slice(0, LIMITS.workspace) || 'arduino-uno';
      for (const k of ['data', 'scene']) if (b[k] != null && typeof b[k] !== 'object') return fail(400, `“${k}” must be an object.`);
      const payload = JSON.stringify({ data: b.data ?? null, scene: b.scene ?? null });
      if (payload.length > LIMITS.projectBytes) return fail(413, 'This project is too big to sync (over 2.5 MB).');
      const old = await store.get(e, id);
      if (old && old.updatedAt > updatedAt) return { ok: true, kept: 'server', updatedAt: old.updatedAt };
      if (!old && await store.count(e) >= LIMITS.perUser) return fail(409, `You can sync up to ${LIMITS.perUser} projects.`);
      await store.put(e, { id, name, workspace, createdAt, updatedAt, deleted: false, payload });
      return { ok: true, updatedAt };
    },
    async remove(token, id) {
      const e = await who(token); if (!e) return need; if (!idOk(id)) return fail(400, 'Bad project id.');
      const old = await store.get(e, id); if (!old) return { ok: true };
      await store.put(e, { ...old, deleted: true, payload: '', updatedAt: Math.max(now(), old.updatedAt + 1) });
      return { ok: true };
    },
  };
}
