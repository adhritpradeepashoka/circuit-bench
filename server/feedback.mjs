// Feedback: anyone using the lab can send a short note (a problem, an idea). Admins read them in Settings.
// Plain text only; the signed-in person's email is kept with it (so the team can reply), nothing else about them.
export const FEEDBACK_LIMITS = { text: 2000, page: 80, perList: 200 };
export const FEEDBACK_KINDS = ['problem', 'idea', 'other'];
const clean = (s, n) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
const fail = (status, error) => ({ ok: false, status, error });

export function createMemoryFeedbackStore() {
  const rows = []; let seq = 0;
  return {
    kind: 'memory', async init() {},
    async add(r) { rows.push({ id: ++seq, ...r }); if (rows.length > 2000) rows.shift(); return seq; },
    async list(n) { return rows.slice(-n).reverse(); },
    async remove(id) { const i = rows.findIndex(r => r.id === id); if (i < 0) return false; rows.splice(i, 1); return true; },
  };
}
export function createPgFeedbackStore(pool) {
  const q = (sql, args) => pool.query(sql, args);
  return {
    kind: 'postgres',
    async init() {
      await q(`create table if not exists cb_feedback (id bigserial primary key, kind text not null, body text not null, page text not null default '', email text not null default '', created_at bigint not null)`);
      try { await q('alter table cb_feedback enable row level security'); } catch { /* not Postgres-proper (tests) */ }
    },
    async add(r) { return Number((await q('insert into cb_feedback (kind, body, page, email, created_at) values ($1,$2,$3,$4,$5) returning id', [r.kind, r.text, r.page, r.email, r.createdAt])).rows[0].id); },
    async list(n) { return (await q('select * from cb_feedback order by created_at desc limit $1', [n])).rows.map(r => ({ id: Number(r.id), kind: r.kind, text: r.body, page: r.page, email: r.email, createdAt: Number(r.created_at) })); },
    async remove(id) { return (await q('delete from cb_feedback where id = $1', [id])).rowCount > 0; },
  };
}

/** @param accounts  optional: { me(token) } — gives the sender's email when signed in, and says who is an admin */
export function createFeedback({ store = createMemoryFeedbackStore(), accounts = null, now = () => Date.now() } = {}) {
  const who = async token => (token && accounts ? accounts.me(token).catch(() => null) : null);
  return {
    async send(token, body) {
      const text = clean(body?.text, FEEDBACK_LIMITS.text); if (text.length < 3) return fail(400, 'Write a few words first.');
      const kind = FEEDBACK_KINDS.includes(body?.kind) ? body.kind : 'other', me = await who(token);
      await store.add({ kind, text, page: clean(body?.page, FEEDBACK_LIMITS.page), email: me?.email || '', createdAt: now() });
      return { ok: true };
    },
    async list(token) { const me = await who(token); if (!me?.entitlements?.admin) return fail(403, 'Admins only.'); return { ok: true, feedback: await store.list(FEEDBACK_LIMITS.perList) }; },
    async remove(token, id) { const me = await who(token); if (!me?.entitlements?.admin) return fail(403, 'Admins only.'); return (await store.remove(Number(id))) ? { ok: true } : fail(404, 'No such note.'); },
  };
}
