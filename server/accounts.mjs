// Accounts and privileges. Google proves who someone is (the ID token is verified HERE, on the server); this file decides
// what they may do. Roles, strongest first:
//   owner  — set by the OWNER_EMAIL env var, never stored, can't be changed or removed by anyone; can make/remove admins.
//   admin  — can grant or revoke beta access for others.
//   beta   — lifetime free access to everything (hosted AI, premium features), never counted against the user cap.
//   user   — everyone else who signs in; gets what the free tier gives (and loses it first when the site is busy).
// The UI only reflects this; every privilege is checked again server-side.
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { STAFF_THEME_IDS, themesFor } from '../src/core/staff-themes.js';

export const ROLES = ['owner', 'admin', 'beta', 'user'];
const RANK = { user: 0, beta: 1, admin: 2, owner: 3 };
export const isPrivileged = role => RANK[role] >= RANK.beta;
export const normEmail = e => String(e || '').trim().toLowerCase();
export const validEmail = e => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(String(e || '')) && String(e).length <= 254;

/** May `actor` change `target` (currently `current`) to `next`? Returns an error string or ''. */
export function whyNotAllowed(actor, current, next) {
  if (!ROLES.includes(next) || next === 'owner') return 'That role cannot be given.';
  if (current === 'owner') return 'The owner cannot be changed.';
  if (actor === 'owner') return '';
  if (actor === 'admin') return RANK[current] >= RANK.admin || next === 'admin' ? 'Only the owner can make or remove admins.' : '';
  return 'Only admins can change roles.';
}

/** What a role gets. `seat` is false when the site is full and this free user is over the cap. */
export function entitlements(role, { seat = true, freeHostedAi = false, granted = [] } = {}) {
  const priv = isPrivileged(role);
  return { hostedAi: priv || (freeHostedAi && seat), premium: priv, seat: priv || seat, admin: RANK[role] >= RANK.admin, owner: role === 'owner', themes: themesFor(role, granted) };
}

/* ── sessions: our own signed token, so Google's 1-hour ID token isn't needed after sign-in ── */
const b64 = b => Buffer.from(b).toString('base64url');
export function createSessions({ secret = randomBytes(32).toString('hex'), now = () => Date.now(), ttlMs = 30 * 24 * 3600_000 } = {}) {
  const sign = data => createHmac('sha256', secret).update(data).digest('base64url');
  return {
    issue(email) { const p = b64(JSON.stringify({ e: normEmail(email), x: now() + ttlMs })); return `${p}.${sign(p)}`; },
    verify(token) {
      const [p, sig] = String(token || '').split('.');
      if (!p || !sig) return null;
      const want = Buffer.from(sign(p)), got = Buffer.from(sig);
      if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
      try { const d = JSON.parse(Buffer.from(p, 'base64url').toString()); return d.x > now() && validEmail(d.e) ? d.e : null; } catch { return null; }
    },
  };
}

/** Verify a Google ID token → { email, sub, name, picture } or null. `verify` is injectable (tests); the default uses Google's keys. */
export function createGoogleVerifier({ clientId, jwks = null } = {}) {
  let keys = jwks;
  return async credential => {
    if (!clientId) return null;
    const { jwtVerify, createRemoteJWKSet } = await import('jose');
    keys ||= createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
    try {
      const { payload: p } = await jwtVerify(String(credential || ''), keys, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: clientId });
      if (!p.email || p.email_verified !== true) return null;
      return { email: normEmail(p.email), sub: String(p.sub), name: String(p.name || ''), picture: String(p.picture || '') };
    } catch { return null; }
  };
}

/* ── user stores: same interface in memory (tests, local dev) and Postgres (Supabase/Neon) ── */
export function createMemoryStore() {
  const rows = new Map();
  return {
    kind: 'memory',
    async get(email) { return rows.get(normEmail(email)) || null; },
    async login({ email, sub, name, picture }, now = Date.now()) {
      const e = normEmail(email), cur = rows.get(e) || { email: e, role: 'user', createdAt: now };
      const row = { ...cur, sub, name, picture, lastSeen: now }; rows.set(e, row); return row;
    },
    async setRole(email, role, by, now = Date.now()) {
      const e = normEmail(email), cur = rows.get(e) || { email: e, createdAt: now, name: '', picture: '' };
      const row = { ...cur, role, grantedBy: by || null, grantedAt: now }; rows.set(e, row); return row;
    },
    async setThemes(email, themes) {
      const e = normEmail(email), cur = rows.get(e) || { email: e, role: 'user', createdAt: Date.now(), name: '', picture: '' };
      const row = { ...cur, themes }; rows.set(e, row); return row;
    },
    async setKind(email, kind) {
      const e = normEmail(email), cur = rows.get(e) || { email: e, role: 'user', createdAt: Date.now(), name: '', picture: '' };
      const row = { ...cur, kind }; rows.set(e, row); return row;
    },
    async list() { return [...rows.values()].sort((a, b) => a.email.localeCompare(b.email)); },
    async remove(email) { return rows.delete(normEmail(email)); },
  };
}
const toRow = r => !r ? null : ({ email: r.email, role: r.role, sub: r.sub, name: r.name, picture: r.picture, createdAt: Number(r.created_at), lastSeen: r.last_seen == null ? null : Number(r.last_seen), grantedBy: r.granted_by, grantedAt: r.granted_at == null ? null : Number(r.granted_at), themes: String(r.themes || '').split(',').filter(Boolean), kind: r.kind || '' });
export function createPgStore(pool) {
  return {
    kind: 'postgres',
    async init() {
      await pool.query(`create table if not exists cb_users (
        email text primary key, role text not null default 'user', sub text, name text not null default '', picture text not null default '',
        created_at bigint not null, last_seen bigint, granted_by text, granted_at bigint)`);
      await pool.query("alter table cb_users add column if not exists themes text not null default ''");
      await pool.query("alter table cb_users add column if not exists kind text not null default ''");
      // Supabase exposes public tables over its Data API; with row level security on and no policies, only this server (the owner role) can read them.
      try { await pool.query('alter table cb_users enable row level security'); } catch { /* not Postgres-proper (tests) */ }
    },
    async get(email) { return toRow((await pool.query('select * from cb_users where email = $1', [normEmail(email)])).rows[0]); },
    async login({ email, sub, name, picture }, now = Date.now()) {
      const r = await pool.query(`insert into cb_users (email, sub, name, picture, created_at, last_seen) values ($1,$2,$3,$4,$5,$5)
        on conflict (email) do update set sub = excluded.sub, name = excluded.name, picture = excluded.picture, last_seen = excluded.last_seen returning *`, [normEmail(email), sub, name, picture, now]);
      return toRow(r.rows[0]);
    },
    async setRole(email, role, by, now = Date.now()) {
      const r = await pool.query(`insert into cb_users (email, role, created_at, granted_by, granted_at) values ($1,$2,$3,$4,$3)
        on conflict (email) do update set role = excluded.role, granted_by = excluded.granted_by, granted_at = excluded.granted_at returning *`, [normEmail(email), role, now, by || null]);
      return toRow(r.rows[0]);
    },
    async setThemes(email, themes) {
      const r = await pool.query(`insert into cb_users (email, themes, created_at) values ($1,$2,$3)
        on conflict (email) do update set themes = excluded.themes returning *`, [normEmail(email), themes.join(','), Date.now()]);
      return toRow(r.rows[0]);
    },
    async setKind(email, kind) {
      const r = await pool.query(`insert into cb_users (email, kind, created_at) values ($1,$2,$3)
        on conflict (email) do update set kind = excluded.kind returning *`, [normEmail(email), kind, Date.now()]);
      return toRow(r.rows[0]);
    },
    async list() { return (await pool.query('select * from cb_users order by email')).rows.map(toRow); },
    async remove(email) { return (await pool.query('delete from cb_users where email = $1', [normEmail(email)])).rowCount > 0; },
  };
}

/* ── presence: who is on the site right now. Free users beyond `cap` (in order of arrival) lose the free-tier extras; privileged users never do. ── */
export function createPresence({ cap = 0, ttlMs = 150_000, now = () => Date.now() } = {}) {
  const seen = new Map();      // email → { first, last }
  const prune = () => { const t = now(); for (const [k, v] of seen) if (t - v.last > ttlMs) seen.delete(k); };
  return {
    beat(email, privileged) {
      prune(); const t = now(), cur = seen.get(email);
      seen.set(email, { first: cur?.first ?? t, last: t, privileged });
    },
    seat(email) {
      prune(); if (!cap || seen.get(email)?.privileged) return true;
      const free = [...seen.entries()].filter(([, v]) => !v.privileged).sort((a, b) => a[1].first - b[1].first || a[0].localeCompare(b[0])).map(([k]) => k);
      const i = free.indexOf(email); return i < 0 ? free.length < cap : i < cap;
    },
    counts() { prune(); const v = [...seen.values()]; return { online: v.length, free: v.filter(x => !x.privileged).length, privileged: v.filter(x => x.privileged).length, cap }; },
  };
}

/** Everything the routes need, from one object. */
export function createAccounts({ store = createMemoryStore(), sessions = createSessions(), verifyGoogle = async () => null, presence = createPresence(), ownerEmails = [], freeHostedAi = false, teacherSignup = true, now = () => Date.now() } = {}) {
  let classroom = null;                                       // set by the classroom module: async (email, kind) → what this person's classes allow
  const owners = new Set(ownerEmails.map(normEmail).filter(Boolean));
  const roleOf = row => (owners.has(normEmail(row?.email)) ? 'owner' : row?.role || 'user');
  const view = (row, email = row?.email) => {
    const role = owners.has(normEmail(email)) ? 'owner' : row?.role || 'user';
    return { email: normEmail(email), name: row?.name || '', picture: row?.picture || '', role, kind: row?.kind || '', teacherSignup, entitlements: entitlements(role, { seat: presence.seat(normEmail(email)), freeHostedAi, granted: row?.themes }) };
  };
  async function signIn(credential) {
    const g = await verifyGoogle(credential); if (!g) return null;
    const row = await store.login(g, now());
    return { token: sessions.issue(g.email), me: { ...view(row), classroom: await classroom?.(g.email, row?.kind || '') } };
  }
  async function auth(token) {                               // → { email, role, row } or null
    const email = sessions.verify(token); if (!email) return null;
    const row = await store.get(email); const role = roleOf(row || { email });
    return { email, role, row };
  }
  async function me(token, { beat = false } = {}) {
    const a = await auth(token); if (!a) return null;
    if (beat) presence.beat(a.email, isPrivileged(a.role));
    return { ...view(a.row || { email: a.email }, a.email), classroom: await classroom?.(a.email, a.row?.kind || ''), online: a.role === 'owner' || a.role === 'admin' ? presence.counts() : undefined };
  }
  async function listUsers(token) {
    const a = await auth(token); if (!a || RANK[a.role] < RANK.admin) return null;
    const rows = await store.list(); const have = new Set(rows.map(r => normEmail(r.email)));
    const all = [...rows, ...[...owners].filter(o => !have.has(o)).map(o => ({ email: o, role: 'owner' }))].map(r => ({ ...r, role: roleOf(r) }));
    return { users: all, online: presence.counts() };
  }
  async function setRole(token, email, role) {
    const a = await auth(token); if (!a || RANK[a.role] < RANK.admin) return { ok: false, status: 403, error: 'Admins only.' };
    if (!validEmail(email)) return { ok: false, status: 400, error: 'That is not a valid email address.' };
    const target = normEmail(email), row = await store.get(target), current = roleOf(row || { email: target });
    const why = whyNotAllowed(a.role, current, role);
    if (why) return { ok: false, status: 403, error: why };
    if (role === 'user' && !row?.sub) { await store.remove(target); return { ok: true, user: { email: target, role: 'user' } }; }   // never signed in: just forget the invite
    return { ok: true, user: await store.setRole(target, role, a.email, now()) };
  }
  /** Owner only: choose which team themes a person may wear (on top of what their role gives). */
  async function setThemes(token, email, themes) {
    const a = await auth(token); if (!a || a.role !== 'owner') return { ok: false, status: 403, error: 'Only the owner can grant themes.' };
    if (!validEmail(email)) return { ok: false, status: 400, error: 'That is not a valid email address.' };
    if (!Array.isArray(themes) || themes.some(t => !STAFF_THEME_IDS.includes(t))) return { ok: false, status: 400, error: 'Unknown theme.' };
    const row = await store.setThemes(normEmail(email), [...new Set(themes)]);
    return { ok: true, user: { email: row.email, role: roleOf(row), themes: row.themes } };
  }
  const KIND_IDS = ['single', 'teacher', 'student'];
  /** You pick what kind of account you are once, the first time. Teachers can be switched off site-wide (TEACHER_SIGNUP=0); changing later is for admins. */
  async function chooseKind(token, kind) {
    const a = await auth(token); if (!a) return { ok: false, status: 401, error: 'Please sign in again.' };
    if (!KIND_IDS.includes(kind)) return { ok: false, status: 400, error: 'Pick single user, teacher or student.' };
    if (a.row?.kind && a.role !== 'owner') return { ok: false, status: 403, error: 'Your account type is already set. Ask an admin to change it.' };
    if (kind === 'teacher' && !teacherSignup && RANK[a.role] < RANK.admin) return { ok: false, status: 403, error: 'Teacher accounts are not open for sign-up yet. Ask an admin.' };
    return { ok: true, kind: (await store.setKind(a.email, kind)).kind };
  }
  async function setKindFor(token, email, kind) {
    const a = await auth(token); if (!a || RANK[a.role] < RANK.admin) return { ok: false, status: 403, error: 'Admins only.' };
    if (!validEmail(email)) return { ok: false, status: 400, error: 'That is not a valid email address.' };
    if (kind !== '' && !KIND_IDS.includes(kind)) return { ok: false, status: 400, error: 'Unknown account type.' };
    return { ok: true, user: { email: normEmail(email), kind: (await store.setKind(email, kind)).kind } };
  }
  return { signIn, me, auth, listUsers, setRole, setThemes, chooseKind, setKindFor, setClassroom: fn => { classroom = fn; }, presence, store, owners };
}
