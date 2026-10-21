// Browser side of the AI "Generate Code" feature. v0.1 (beta) is bring-your-own-key: the key lives only
// in this browser's localStorage and is sent with each request — CircuitBench's own server never stores it.
const KEY_STORAGE = 'virtual-lab:ai-key';
const PROVIDER_STORAGE = 'virtual-lab:ai-provider';
export const DEFAULT_PROVIDER = 'gemini';

export function getStoredKey() { try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; } }
export function setStoredKey(key) { try { key ? localStorage.setItem(KEY_STORAGE, key) : localStorage.removeItem(KEY_STORAGE); } catch { /* ignore */ } }
export function getStoredProvider() { try { return localStorage.getItem(PROVIDER_STORAGE) || DEFAULT_PROVIDER; } catch { return DEFAULT_PROVIDER; } }
export function setStoredProvider(provider) { try { localStorage.setItem(PROVIDER_STORAGE, provider); } catch { /* ignore */ } }

/** Mirrors compileEndpoint() in compile-client.js: ?compiler=URL, window.VLAB_COMPILE_URL, or same-origin. */
function aiEndpoint(loc = globalThis.location, win = globalThis) {
  try { const q = new URLSearchParams(loc?.search || '').get('compiler'); if (q) return q.replace(/\/?$/, '/api/ai/generate-code'); } catch { /* ignore */ }
  if (win.VLAB_COMPILE_URL) return win.VLAB_COMPILE_URL.replace(/\/api\/compile$/, '') + '/api/ai/generate-code';
  return loc?.protocol === 'file:' ? null : '/api/ai/generate-code';
}

/**
 * @returns {Promise<{ok:boolean, code?:string, explanation?:string, error?:string, needsKey?:boolean}>}
 */
export async function generateCode({ instruction, circuit, code, context = null, userKey = getStoredKey(), provider = getStoredProvider(), fetchImpl = globalThis.fetch, endpoint = aiEndpoint(), signal } = {}) {
  if (!userKey) return { ok: false, needsKey: true, error: 'Add a free API key in Settings → AI to use this (beta, bring-your-own-key for now).' };
  if (!endpoint) return { ok: false, error: 'This page was opened from a file, so there is no server to ask. Run the app from the server (npm run server) to use AI features.' };
  let res;
  try {
    res = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction, circuit, code, context, userKey, provider }), signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return { ok: false, error: `Could not reach ${endpoint}.` };
  }
  let body = null;
  try { body = await res.json(); } catch { /* ignore */ }
  if (!body) return { ok: false, error: `No usable response (HTTP ${res.status}).` };
  return body;
}
