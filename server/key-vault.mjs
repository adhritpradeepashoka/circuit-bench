// An opt-in vault for a signed-in person's own AI provider keys, so they follow them to another web address or device (a browser keeps them per address).
// Keys are encrypted with AES-256-GCM before they touch the database, with a key made from the server's secret and the person's email, so a copy of the table alone is unreadable.
// The secret is KEY_VAULT_SECRET, or (if that is not set) the database URL, which every deploy already has and only the server knows. Without any secret the vault is off.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { normEmail } from './accounts.mjs';

export const LIMITS = { providers: 12, keyLen: 600, modelLen: 120 };
const fail = (status, error) => ({ ok: false, status, error });
const idOk = s => /^[a-z0-9-]{1,24}$/.test(String(s));

export function createMemoryKeyStore() {
  const rows = new Map();
  return { async init() {}, async get(email) { return rows.get(email) || null; }, async put(email, row) { rows.set(email, row); }, async remove(email) { rows.delete(email); } };
}
export function createPgKeyStore(pool) {
  const q = (sql, args) => pool.query(sql, args);
  return {
    async init() { await q('create table if not exists cb_keys (email text primary key, blob text not null, updated_at bigint not null)'); try { await q('alter table cb_keys enable row level security'); } catch { /* not Postgres-proper (tests) */ } },
    async get(email) { const r = (await q('select blob, updated_at from cb_keys where email = $1', [email])).rows[0]; return r ? { blob: r.blob, updatedAt: Number(r.updated_at) } : null; },
    async put(email, r) { await q('insert into cb_keys (email, blob, updated_at) values ($1,$2,$3) on conflict (email) do update set blob = $2, updated_at = $3', [email, r.blob, r.updatedAt]); },
    async remove(email) { await q('delete from cb_keys where email = $1', [email]); },
  };
}

export function createKeyVault({ accounts, store = createMemoryKeyStore(), secret = '', now = () => Date.now() }) {
  const keyFor = email => scryptSync(String(secret), `cb-keys:${email}`, 32);
  const seal = (email, obj) => { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', keyFor(email), iv), ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'); };
  const open = (email, blob) => { const b = Buffer.from(blob, 'base64'), d = createDecipheriv('aes-256-gcm', keyFor(email), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')); };
  async function who(token) { const me = token ? await accounts.me(token) : null; return me?.email ? normEmail(me.email) : null; }
  const off = fail(503, 'Key sync is not set up on this server.'), need = fail(401, 'Sign in to sync your keys.');
  return {
    enabled: !!secret,
    async get(token) {
      if (!secret) return off; const e = await who(token); if (!e) return need;
      const r = await store.get(e); if (!r) return { ok: true, keys: {}, models: {}, updatedAt: 0 };
      try { const v = open(e, r.blob); return { ok: true, keys: v.keys || {}, models: v.models || {}, updatedAt: r.updatedAt }; } catch { return fail(500, 'Your saved keys could not be read (the server secret changed). Save them again.'); }
    },
    /** Replaces what is stored with { keys: {provider: key}, models: {provider: id} }. */
    async put(token, b) {
      if (!secret) return off; const e = await who(token); if (!e) return need; if (!b || typeof b !== 'object') return fail(400, 'Send the keys as JSON.');
      const keys = {}, models = {};
      for (const [p, k] of Object.entries(b.keys || {})) { if (!idOk(p) || typeof k !== 'string' || !k.trim() || k.length > LIMITS.keyLen) return fail(400, `Bad key for “${String(p).slice(0, 24)}”.`); keys[p] = k.trim(); }
      for (const [p, m] of Object.entries(b.models || {})) if (idOk(p) && typeof m === 'string' && m.length <= LIMITS.modelLen && m) models[p] = m;
      if (Object.keys(keys).length > LIMITS.providers) return fail(400, 'Too many providers.');
      const updatedAt = now(); await store.put(e, { blob: seal(e, { keys, models }), updatedAt }); return { ok: true, updatedAt };
    },
    async remove(token) { if (!secret) return off; const e = await who(token); if (!e) return need; await store.remove(e); return { ok: true }; },
  };
}
