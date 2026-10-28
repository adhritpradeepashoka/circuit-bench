// Optional: keep the person's own AI keys with their account (encrypted on the server) so they follow them to another web address or device.
// Off until they switch it on in Settings. Local keys always win a clash; keys only on the server fill the gaps here. DOM-light: storage and the network are injected for tests.
import { PROVIDER_IDS, getStoredKey, setStoredKey, getStoredModel, setStoredModel } from './ai-client.mjs';
import { getToken, authed } from './session.mjs';

const FLAG = 'circuitbench:key-sync';
export const syncOn = (st = globalThis.localStorage) => { try { return st.getItem(FLAG) === '1'; } catch { return false; } };
export const setSyncOn = (on, st = globalThis.localStorage) => { try { on ? st.setItem(FLAG, '1') : st.removeItem(FLAG); } catch { /* ignore */ } };

const collect = () => { const keys = {}, models = {}; for (const p of PROVIDER_IDS) { const k = getStoredKey(p); if (k) keys[p] = k; const m = getStoredModel(p); if (m) models[p] = m; } return { keys, models }; };

export function createKeySync({ call = (path, method, body) => authed(path, { method, body }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) })), token = getToken, onChange = () => {}, say = () => {}, on = syncOn, wait = 1200, setTimer = setTimeout } = {}) {
  let timer = null, busy = false;
  const signedIn = () => !!token();
  async function push() { if (!signedIn() || !on()) return false; const r = await call('/api/keys', 'PUT', collect()).catch(() => null); if (r && r.status >= 400) say(r.json?.error || 'Could not sync your keys.'); return r?.status === 200; }
  /** Bring keys from the account into this browser (only where this browser has none), then send the merged set back. */
  async function sync() {
    if (busy || !signedIn() || !on()) return null; busy = true;
    try {
      const r = await call('/api/keys', 'GET').catch(() => null); if (!r) return null;
      if (r.status !== 200) { if (r.status !== 404 && r.status !== 401) say(r.json?.error || 'Could not sync your keys.'); return null; }
      let got = 0; for (const [p, k] of Object.entries(r.json.keys || {})) if (PROVIDER_IDS.includes(p) && !getStoredKey(p)) { setStoredKey(k, p); got++; }
      for (const [p, m] of Object.entries(r.json.models || {})) if (PROVIDER_IDS.includes(p) && !getStoredModel(p)) setStoredModel(m, p);
      await push(); if (got) onChange(got); return { got };
    } finally { busy = false; }
  }
  /** Call after any key or model is saved locally: sends the new set a moment later. */
  function changed() { if (!on() || !signedIn()) return; clearTimeout(timer); timer = setTimer(() => { push(); }, wait); }
  const forget = async () => { clearTimeout(timer); if (!signedIn()) return false; const r = await call('/api/keys', 'DELETE').catch(() => null); return r?.status === 200; };
  return { sync, push, changed, forget };
}
