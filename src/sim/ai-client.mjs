// Browser side of the AI "Generate Code" feature. v0.1 (beta) is bring-your-own-key: the key lives only
// in this browser's localStorage and is sent with each request — CircuitBench's own server never stores it.
const KEY_STORAGE = 'virtual-lab:ai-key';              // before there were several providers: one key for whichever was selected
const PROVIDER_STORAGE = 'virtual-lab:ai-provider';
const MODEL_STORAGE = 'virtual-lab:ai-model:';
export const DEFAULT_PROVIDER = 'gemini';

/** The providers a student can switch between. Each keeps its own saved key (and optional model id) in this browser. */
export const PROVIDER_INFO = {
  gemini: { label: 'Gemini', keyUrl: 'https://aistudio.google.com/apikey', hint: 'Free key at Google AI Studio. If that page says "project creation failed" (a known Google-side bug on some accounts), use one of the other providers.', model: 'gemini-3.8-flash' },
  groq: { label: 'Groq', keyUrl: 'https://console.groq.com/keys', hint: 'Free key at console.groq.com — no Google account step. Can search the web for part pinouts.', model: 'openai/gpt-oss-120b' },
  nvidia: { label: 'NVIDIA', keyUrl: 'https://build.nvidia.com/settings/api-keys', hint: 'Free key at build.nvidia.com (keys start with nvapi-). Runs Meta Llama and Nemotron models.', model: 'meta/llama-3.3-70b-instruct' },
  meta: { label: 'Meta Llama', keyUrl: 'https://llama.developer.meta.com/', hint: 'Key from the Llama API at llama.developer.meta.com.', model: 'Llama-4-Maverick-17B-128E-Instruct-FP8' },
  openrouter: { label: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys', hint: 'One key for hundreds of models, including free ones — type any model id in the box below.', model: 'meta-llama/llama-3.3-70b-instruct:free' },
};
export const PROVIDER_IDS = Object.keys(PROVIDER_INFO);

export function getStoredProvider() { try { const p = localStorage.getItem(PROVIDER_STORAGE); return PROVIDER_INFO[p] ? p : DEFAULT_PROVIDER; } catch { return DEFAULT_PROVIDER; } }
export function setStoredProvider(provider) { try { localStorage.setItem(PROVIDER_STORAGE, provider); } catch { /* ignore */ } }
/** The key saved for a provider (default: the selected one). A key saved before providers had their own belongs to the provider that was selected then. */
export function getStoredKey(provider = getStoredProvider()) {
  try { return localStorage.getItem(`${KEY_STORAGE}:${provider}`) || (provider === getStoredProvider() ? localStorage.getItem(KEY_STORAGE) || '' : ''); } catch { return ''; }
}
export function setStoredKey(key, provider = getStoredProvider()) {
  try {
    if (provider === getStoredProvider()) localStorage.removeItem(KEY_STORAGE);      // fold the old single key into the per-provider one
    key ? localStorage.setItem(`${KEY_STORAGE}:${provider}`, key) : localStorage.removeItem(`${KEY_STORAGE}:${provider}`);
  } catch { /* ignore */ }
}
/** True when the student has saved their own key for any hosted provider. */
export const hasAnyKey = () => PROVIDER_IDS.some(p => !!getStoredKey(p));
export const providersWithKeys = () => PROVIDER_IDS.filter(p => !!getStoredKey(p));
/** An optional model id the student typed for a provider ('' = use the built-in list). */
export function getStoredModel(provider = getStoredProvider()) { try { return localStorage.getItem(MODEL_STORAGE + provider) || ''; } catch { return ''; } }
export function setStoredModel(model, provider = getStoredProvider()) { try { model ? localStorage.setItem(MODEL_STORAGE + provider, model) : localStorage.removeItem(MODEL_STORAGE + provider); } catch { /* ignore */ } }

const noReply = status => (status === 502 || status === 503 || status === 504 ? `The AI took too long and the server gave up (HTTP ${status}). Try again, or switch provider with the menu under the chat box — Groq is usually the quickest.` : `No usable response (HTTP ${status}).`);

/** Mirrors compileEndpoint() in compile-client.js: ?compiler=URL, window.VLAB_COMPILE_URL, or same-origin. */
function aiEndpoint(loc = globalThis.location, win = globalThis, path = '/api/ai/generate-code') {
  try { const q = new URLSearchParams(loc?.search || '').get('compiler'); if (q) return q.replace(/\/?$/, path); } catch { /* ignore */ }
  if (win.VLAB_COMPILE_URL) return win.VLAB_COMPILE_URL.replace(/\/api\/compile$/, '') + path;
  return loc?.protocol === 'file:' ? null : path;
}

/** Describe a part → { ok, spec, note } (a validated part spec), or { ok:false, error, needsKey? }. */
export async function createPart({ description, provider = getStoredProvider(), userKey = getStoredKey(provider), model = getStoredModel(provider), fetchImpl = globalThis.fetch, endpoint = aiEndpoint(globalThis.location, globalThis, '/api/ai/create-part'), signal } = {}) {
  if (!userKey) return { ok: false, needsKey: true, error: 'Add a free AI key first (open ✨ Ask AI → Settings) — then describe your part again.' };
  if (!endpoint) return { ok: false, error: 'This page was opened from a file, so there is no server to ask.' };
  let res;
  try { res = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description, userKey, provider, model }), signal }); }
  catch (err) { if (err?.name === 'AbortError') throw err; return { ok: false, error: `Could not reach ${endpoint}.` }; }
  let body = null; try { body = await res.json(); } catch { /* ignore */ }
  return body || { ok: false, error: noReply(res.status) };
}

/**
 * @returns {Promise<{ok:boolean, code?:string, explanation?:string, error?:string, needsKey?:boolean}>}
 */
export async function generateCode({ instruction, circuit, code, context = null, history = [], provider = getStoredProvider(), userKey = getStoredKey(provider), model = getStoredModel(provider), fetchImpl = globalThis.fetch, endpoint = aiEndpoint(), signal } = {}) {
  if (!userKey) return { ok: false, needsKey: true, error: 'Add a free API key in Settings → AI to use this (beta, bring-your-own-key for now).' };
  if (!endpoint) return { ok: false, error: 'This page was opened from a file, so there is no server to ask. Run the app from the server (npm run server) to use AI features.' };
  let res;
  try {
    res = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction, circuit, code, context, history, userKey, provider, model }), signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return { ok: false, error: `Could not reach ${endpoint}.` };
  }
  let body = null;
  try { body = await res.json(); } catch { /* ignore */ }
  if (!body) return { ok: false, error: noReply(res.status) };
  return body;
}
