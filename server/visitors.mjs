// Anonymous visitors: people using the lab without signing in. A browser makes itself a random visitor id the first
// time and checks in with it (POST /api/visit), so an admin can see who is here and block one.
//
// What is kept, and why it is small: a visitor id, when they were first and last here, which page they are on, a
// plain device label ("Chrome on Windows") and a COARSE network label ("103.21.x.x"). The real IP address is never
// stored: only a salted hash of it, which is enough to recognise the same network again and block it.
//
// What a block can and cannot do (be honest about it in the UI):
//   · a block by id is gone when the person clears their browser data or opens a private window;
//   · a block by network also catches that, but hits everyone behind the same address (a school, a phone carrier);
//   · neither stops someone who signs in with Google: accounts are blocked separately, in the people list.
// The lab itself runs in the browser, so the blocked screen and the refusals from the server are the guardrail, not a wall.
import { createHmac, randomBytes } from 'node:crypto';

export const cleanVisitorId = v => (/^[a-z0-9]{16,32}$/.test(String(v || '')) ? String(v) : '');
const cleanPage = p => (/^[a-z0-9-]{1,60}$/.test(String(p || '')) ? String(p) : '');
const cleanNote = n => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 200);

/** "Chrome on Windows": enough to tell two visitors apart, nothing that identifies a person. */
export function deviceLabel(ua) {
  const s = String(ua || '');
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /SamsungBrowser/.test(s) ? 'Samsung Internet' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\/|CriOS/.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : '';
  const os = /Windows/.test(s) ? 'Windows' : /iPhone|iPad|iPod/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /CrOS/.test(s) ? 'ChromeOS' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : '';
  return browser && os ? `${browser} on ${os}` : browser || os || 'Unknown device';
}
/** Only the start of the address, so an admin can recognise a network without learning where someone lives. */
export function networkLabel(ip) {
  const s = String(ip || '').replace(/^::ffff:/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return `${s.split('.').slice(0, 2).join('.')}.x.x`;
  if (s.includes(':')) return `${s.split(':').filter(Boolean).slice(0, 2).join(':')}::`;
  return 'unknown network';
}

/* ── the blocklist is the only thing kept for good: same interface in memory (tests, local dev) and Postgres ── */
export function createMemoryBlockStore() {
  const m = new Map();
  return { kind: 'memory', async list() { return [...m.values()]; }, async put(rec) { m.set(rec.key, rec); }, async remove(key) { m.delete(key); } };
}
export function createPgBlockStore(pool) {
  return {
    kind: 'postgres',
    async init() {
      await pool.query('create table if not exists cb_blocks (key text primary key, rec text not null, at bigint not null)');
      try { await pool.query('alter table cb_blocks enable row level security'); } catch { /* not Postgres-proper (tests) */ }
    },
    async list() { return (await pool.query('select rec from cb_blocks')).rows.map(r => { try { return JSON.parse(r.rec); } catch { return null; } }).filter(Boolean); },
    async put(rec) { await pool.query('insert into cb_blocks (key, rec, at) values ($1,$2,$3) on conflict (key) do update set rec = excluded.rec, at = excluded.at', [rec.key, JSON.stringify(rec), rec.at || Date.now()]); },
    async remove(key) { await pool.query('delete from cb_blocks where key = $1', [key]); },
  };
}

export function createVisitors({ store = createMemoryBlockStore(), secret = randomBytes(32).toString('hex'), now = () => Date.now(), onlineMs = 120_000, keepMs = 3 * 24 * 3600_000, max = 1000, maxStreams = 2000 } = {}) {
  const seen = new Map();                   // id → what we know about a visitor who is (or recently was) here
  const blocks = new Map();                 // 'v:<id>' or 'n:<network hash>' → the block record
  const hash = ip => createHmac('sha256', secret).update(`net:${ip}`).digest('hex').slice(0, 16);
  const ready = store.list().then(rows => { for (const r of rows) blocks.set(r.key, r); }).catch(() => {});
  const prune = () => { const t = now(); for (const [k, v] of seen) if (t - v.last > keepMs) seen.delete(k); };

  /* live line: an open page hears at once when it is blocked or unblocked */
  const watchers = new Map(); let open = 0;
  const watch = (id, fn) => {
    if (open >= maxStreams) return null;
    if (!watchers.has(id)) watchers.set(id, new Set());
    watchers.get(id).add(fn); open++;
    return () => { if (watchers.get(id)?.delete(fn)) open--; if (!watchers.get(id)?.size) watchers.delete(id); };
  };
  const ping = id => { for (const fn of watchers.get(id) || []) try { fn(); } catch { /* a closed connection */ } };
  const pingNetwork = h => { for (const v of seen.values()) if (v.ip === h) ping(v.id); };

  /** The block that applies to this visitor, or null: by id first, then by network. */
  async function check(id, ip) {
    await ready;
    const vid = cleanVisitorId(id), hit = (vid && blocks.get(`v:${vid}`)) || (ip ? blocks.get(`n:${hash(ip)}`) : null);
    return hit ? { note: hit.note || '', network: hit.key.startsWith('n:') } : null;
  }
  /** A page checked in. `email` is set when the request carried a valid sign-in: then the person is an account, not a visitor, and account rules apply. */
  async function beat({ id, ip, ua, page, email = '' }) {
    await ready;
    const vid = cleanVisitorId(id); if (!vid) return { blocked: false };
    prune(); const t = now(), cur = seen.get(vid);
    seen.set(vid, { id: vid, first: cur?.first ?? t, last: t, ip: ip ? hash(ip) : '', net: networkLabel(ip), device: deviceLabel(ua), page: cleanPage(page) || cur?.page || '', email: String(email || '') });
    if (seen.size > max) { const oldest = [...seen.values()].sort((a, b) => a.last - b.last)[0]; seen.delete(oldest.id); }
    if (email) return { blocked: false };
    const hit = await check(vid, ip); return hit ? { blocked: true, note: hit.note, network: hit.network } : { blocked: false };
  }

  const view = (id, v, b) => ({
    id, online: !!v && now() - v.last <= onlineMs, first: v?.first ?? b?.first ?? null, last: v?.last ?? b?.last ?? null,
    device: v?.device || b?.device || 'Unknown device', net: v?.net || b?.net || '', page: v?.page || '',
    blocked: !!(b || (v?.ip && blocks.get(`n:${v.ip}`))), blockedNetwork: !!(b?.netKey && blocks.has(b.netKey)) || !!(v?.ip && blocks.has(`n:${v.ip}`)),
    note: b?.note || (v?.ip && blocks.get(`n:${v.ip}`)?.note) || '', by: b?.by || (v?.ip && blocks.get(`n:${v.ip}`)?.by) || '', at: b?.at ?? null,
  });
  /** Everyone using the lab without signing in, most recent first, plus anyone blocked (so a block stays visible after they leave). */
  async function list() {
    await ready; prune();
    const out = new Map();
    for (const v of seen.values()) if (!v.email) out.set(v.id, view(v.id, v, blocks.get(`v:${v.id}`)));
    for (const [k, b] of blocks) if (k.startsWith('v:') && !out.has(b.id)) out.set(b.id, view(b.id, null, b));
    const rows = [...out.values()].sort((a, b) => Number(b.online) - Number(a.online) || (b.last || 0) - (a.last || 0));
    return { visitors: rows, online: rows.filter(r => r.online).length };
  }
  /** Block or unblock one visitor. `adminIp` is the admin's own address: blocking it would lock them out of their own console. */
  async function setBlock({ id, blocked, network = false, note = '', by = '', adminIp = '' }) {
    await ready;
    const vid = cleanVisitorId(id), v = seen.get(vid), cur = blocks.get(`v:${vid}`);
    if (!vid || (!v && !cur)) return { ok: false, status: 404, error: 'That visitor is not here any more.' };
    if (v?.email) return { ok: false, status: 400, error: `That browser is signed in as ${v.email}. Block the account instead.` };
    const netHash = v?.ip || (cur?.netKey || '').slice(2);
    if (!blocked) {
      const keys = [`v:${vid}`, cur?.netKey, netHash && `n:${netHash}`].filter(Boolean);
      for (const k of keys) if (blocks.delete(k)) await store.remove(k);
      ping(vid); if (netHash) pingNetwork(netHash);
      return { ok: true, visitor: view(vid, v, null) };
    }
    if (network) {
      if (!netHash) return { ok: false, status: 400, error: 'This visitor has no network address on record, so only the browser can be blocked.' };
      if (adminIp && hash(adminIp) === netHash) return { ok: false, status: 400, error: 'That is your own network. Blocking it would lock you out too.' };
    }
    const n = cleanNote(note), at = now();
    const rec = { key: `v:${vid}`, id: vid, note: n, by: String(by || ''), at, device: v?.device || cur?.device || '', net: v?.net || cur?.net || '', first: v?.first ?? cur?.first ?? at, last: v?.last ?? cur?.last ?? at, ...(network ? { netKey: `n:${netHash}` } : {}) };
    blocks.set(rec.key, rec); await store.put(rec);
    if (network) { const nrec = { key: `n:${netHash}`, note: n, by: rec.by, at, net: rec.net, via: vid }; blocks.set(nrec.key, nrec); await store.put(nrec); }
    else if (cur?.netKey && blocks.delete(cur.netKey)) await store.remove(cur.netKey);       // narrowed from "network" to "browser only"
    ping(vid); if (netHash && network) pingNetwork(netHash);
    return { ok: true, visitor: view(vid, v, rec) };
  }
  return { beat, check, list, setBlock, watch, ping, hash, ready, blocks };
}
