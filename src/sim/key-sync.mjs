// Signed-in people's own AI keys are kept with their account (encrypted on the server) so they follow them to another web address or device. On by default.
// Keys that exist only on the server are never applied silently: the first time the AI is used on a device that lacks them, the person is asked (offer()).
// Local keys always win a clash. DOM-light: storage, the network and the question are injected for tests.
import { PROVIDER_IDS, getStoredKey, setStoredKey, getStoredModel, setStoredModel } from './ai-client.mjs';
import { getToken, authed } from './session.mjs';

const FLAG = 'circuitbench:key-sync';
export const syncOn = (st = globalThis.localStorage) => { try { return st.getItem(FLAG) !== '0'; } catch { return true; } };          // on unless this browser opted out
export const setSyncOn = (on, st = globalThis.localStorage) => { try { on ? st.removeItem(FLAG) : st.setItem(FLAG, '0'); } catch { /* ignore */ } };
const DECLINED = 'circuitbench:key-offer-declined';

const collect = () => { const keys = {}, models = {}; for (const p of PROVIDER_IDS) { const k = getStoredKey(p); if (k) keys[p] = k; const m = getStoredModel(p); if (m) models[p] = m; } return { keys, models }; };

export function createKeySync({ call = (path, method, body) => authed(path, { method, body }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) })), token = getToken, onChange = () => {}, say = () => {}, on = syncOn, wait = 1200, setTimer = setTimeout } = {}) {
  let timer = null, busy = false, pending = null;                       // pending: keys the account holds that this device does not, waiting for the person's yes
  const signedIn = () => !!token();
  const merged = () => { const l = collect(); return { keys: { ...(pending?.keys || {}), ...l.keys }, models: { ...(pending?.models || {}), ...l.models } }; };       // never send a smaller set than the account already has
  async function push() { if (!signedIn() || !on()) return false; const r = await call('/api/keys', 'PUT', merged()).catch(() => null); if (r && r.status >= 400) say(r.json?.error || 'Could not sync your keys.'); return r?.status === 200; }
  /** Bring keys from the account into this browser (only where this browser has none), then send the merged set back. */
  async function sync() {
    if (busy || !signedIn() || !on()) return null; busy = true;
    try {
      const r = await call('/api/keys', 'GET').catch(() => null); if (!r) return null;
      if (r.status !== 200) { if (r.status !== 404 && r.status !== 401) say(r.json?.error || 'Could not sync your keys.'); return null; }
      const keys = {}, models = {}; for (const [p, k] of Object.entries(r.json.keys || {})) if (PROVIDER_IDS.includes(p) && !getStoredKey(p)) keys[p] = k;
      for (const [p, m] of Object.entries(r.json.models || {})) if (PROVIDER_IDS.includes(p) && !getStoredModel(p)) models[p] = m;
      pending = Object.keys(keys).length ? { keys, models } : null;
      await push(); return { got: 0, waiting: pending ? Object.keys(pending.keys).length : 0 };
    } finally { busy = false; }
  }
  /** Call after any key or model is saved locally: sends the new set a moment later. */
  function changed() { if (!on() || !signedIn()) return; clearTimeout(timer); timer = setTimer(() => { push(); }, wait); }
  /** Ask whether to use the keys the account holds (only if this device lacks them and the person has not just said no). `ask` is the page's question dialog. Returns how many keys were taken. */
  async function offer(ask) {
    if (!signedIn() || !on()) return 0; if (!pending) await sync(); if (!pending) return 0;
    try { if (globalThis.sessionStorage?.getItem(DECLINED) === '1') return 0; } catch { /* ignore */ }
    const n = Object.keys(pending.keys).length;
    const yes = await ask({ title: 'Use your saved AI keys?', body: `Your account has ${n} AI key${n > 1 ? 's' : ''} saved from another device. Use ${n > 1 ? 'them' : 'it'} on this one? They stay encrypted on CircuitBench's server and are only ever sent back to you.`, yes: 'Use my keys', no: 'Not now' });
    if (!yes) { try { globalThis.sessionStorage?.setItem(DECLINED, '1'); } catch { /* ignore */ } return 0; }
    for (const [p, k] of Object.entries(pending.keys)) setStoredKey(k, p); for (const [p, m] of Object.entries(pending.models || {})) setStoredModel(m, p);
    pending = null; onChange(n); return n;
  }
  const forget = async () => { clearTimeout(timer); if (!signedIn()) return false; const r = await call('/api/keys', 'DELETE').catch(() => null); return r?.status === 200; };
  return { sync, push, changed, forget, offer, get waiting() { return !!pending; } };
}
