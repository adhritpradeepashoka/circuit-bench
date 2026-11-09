// Browser side of the AI "Generate Code" feature. v0.1 (beta) is bring-your-own-key: the key lives only
// in this browser's localStorage and is sent with each request — CircuitBench's own server never stores it.
import { getToken } from './session.mjs';
import { matchTemplate, heuristicSpec } from '../core/part-match.js';
import { validatePartSpec, BEHAVIOURS } from '../core/custom-parts.js';
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
  try { globalThis.dispatchEvent?.(new Event('cb-keys-changed')); } catch { /* ignore */ }
}
/** True when the student has saved their own key for any hosted provider. */
export const hasAnyKey = () => PROVIDER_IDS.some(p => !!getStoredKey(p));
export const providersWithKeys = () => PROVIDER_IDS.filter(p => !!getStoredKey(p));
/** An optional model id the student typed for a provider ('' = use the built-in list). */
export function getStoredModel(provider = getStoredProvider()) { try { return localStorage.getItem(MODEL_STORAGE + provider) || ''; } catch { return ''; } }
export function setStoredModel(model, provider = getStoredProvider()) { try { model ? localStorage.setItem(MODEL_STORAGE + provider, model) : localStorage.removeItem(MODEL_STORAGE + provider); } catch { /* ignore */ } try { globalThis.dispatchEvent?.(new Event('cb-keys-changed')); } catch { /* ignore */ } }

const noReply = status => (status === 502 || status === 503 || status === 504 ? `The AI took too long and the server gave up (HTTP ${status}). Try again, or switch provider with the menu under the chat box — Groq is usually the quickest.` : `No usable response (HTTP ${status}).`);

/** Mirrors compileEndpoint() in compile-client.js: ?compiler=URL, window.VLAB_COMPILE_URL, or same-origin. */
function aiEndpoint(loc = globalThis.location, win = globalThis, path = '/api/ai/generate-code') {
  try { const q = new URLSearchParams(loc?.search || '').get('compiler'); if (q) return q.replace(/\/?$/, path); } catch { /* ignore */ }
  if (win.VLAB_COMPILE_URL) return win.VLAB_COMPILE_URL.replace(/\/api\/compile$/, '') + path;
  return loc?.protocol === 'file:' ? null : path;
}

/** Describe a part → { ok, spec, note } (a validated part spec), or { ok:false, error, needsKey? }. */
async function createPartOnce({ description, workspace = '', refine = null, photoUrl = '', provider = getStoredProvider(), userKey = getStoredKey(provider), model = getStoredModel(provider), fetchImpl = globalThis.fetch, endpoint = aiEndpoint(globalThis.location, globalThis, '/api/ai/create-part'), signal, hosted = false, brain = false } = {}) {
  if (!userKey && !hosted) return { ok: false, needsKey: true, error: 'Add a free AI key first (open ✨ Ask AI → Settings) — then describe your part again.' };
  if (!endpoint) return { ok: false, error: 'This page was opened from a file, so there is no server to ask.' };
  let res;
  try { res = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...(hosted && getToken() ? { authorization: `Bearer ${getToken()}` } : {}) }, body: JSON.stringify(hosted ? { description, workspace, refine, photoUrl, brain, hosted: true } : { description, workspace, refine, photoUrl, brain, userKey, provider, model }), signal }); }
  catch (err) { if (err?.name === 'AbortError') throw err; return { ok: false, error: `Could not reach ${endpoint}.` }; }
  let body = null; try { body = await res.json(); } catch { /* ignore */ }
  return body || { ok: false, error: noReply(res.status) };
}

/** The Part Maker's request is big (the whole behaviour list and drawing rules): Groq's free tier refuses it, and any free tier can run out. When the provider says the request is too large or its quota is used up, try the other providers you have a key for. */
const TOO_BIG = /too large|tokens per minute|\bTPM\b|context (length|window)|maximum context|reduce (your|the) (message|prompt)/i;
const USED_UP = /quota|rate.?limit|resource.?exhausted|\b429\b|too many requests/i;
export async function createPart(opts = {}) {
  if (opts.hosted) return createPartOnce(opts);
  const cur = opts.provider || getStoredProvider(), label = id => PROVIDER_INFO[id]?.label || id;
  // Groq's free tier cannot take this request at all, so it only goes first when it is the only key there is.
  const others = PROVIDER_IDS.filter(id => id !== cur && id !== 'groq' && getStoredKey(id));
  const order = cur === 'groq' && others.length ? others : [cur, ...others];
  const failures = []; let first = null;
  for (const id of order) {
    opts.onProgress?.(id, label(id), failures.length);
    const r = await createPartOnce(id === cur ? { ...opts, provider: id } : { ...opts, provider: id, userKey: getStoredKey(id), model: getStoredModel(id) });
    if (r.ok) return failures.length ? { ...r, note: `${r.note ? `${r.note} ` : ''}(${failures.map(f => label(f.id)).join(', ')} could not answer, so ${label(id)} made it.)`.trim() } : r;
    first ||= r;
    if (r.needsKey || opts.signal?.aborted) return r;
    failures.push({ id, error: String(r.error || '') });
  }
  if (failures.length < 2) { const f = failures[0]; return f && TOO_BIG.test(f.error) ? { ...first, error: `${first.error} The Part Maker needs a bigger model than ${label(f.id)}'s free tier allows: pick Gemini or OpenRouter in the AI menu.` } : first; }
  return { ...first, error: `No provider could make it. ${failures.map(f => `${label(f.id)}: ${f.error.replace(/\s+/g, ' ').slice(0, 140)}`).join(' · ')}` };
}

/**
 * @returns {Promise<{ok:boolean, code?:string, explanation?:string, error?:string, needsKey?:boolean}>}
 */
export async function generateCode({ instruction, circuit, code, context = null, history = [], assembly = null, workspace = null, robotType = null, provider = getStoredProvider(), userKey = getStoredKey(provider), model = getStoredModel(provider), fetchImpl = globalThis.fetch, endpoint = aiEndpoint(), signal, hosted = false } = {}) {
  if (!userKey && !hosted) return { ok: false, needsKey: true, error: 'Add a free API key in Settings → AI to use this (beta, bring-your-own-key for now).' };
  if (!endpoint) return { ok: false, error: 'This page was opened from a file, so there is no server to ask. Run the app from the server (npm run server) to use AI features.' };
  let res;
  try {
    res = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...(hosted && getToken() ? { authorization: `Bearer ${getToken()}` } : {}) }, body: JSON.stringify(hosted ? { instruction, circuit, code, context, history, assembly, workspace, robotType, hosted: true } : { instruction, circuit, code, context, history, assembly, workspace, robotType, userKey, provider, model }), signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return { ok: false, error: `Could not reach ${endpoint}.` };
  }
  let body = null;
  try { body = await res.json(); } catch { /* ignore */ }
  if (!body) return { ok: false, error: noReply(res.status) };
  return body;
}


/** One part, made by several workers at once and combined:
 *   1. a ready-made template that clearly matches the words → instant, no AI at all;
 *   2. the "brain" (name, pins, behaviour — a SMALL request): the on-device model when it is switched on, otherwise any provider with a key
 *      (Groq's free tier is fine for this one), otherwise a plain keyword guess — so a part always comes out;
 *   3. the "picture" (a detailed drawing — the BIG request) from the providers that can take it, started as soon as the brain is back and
 *      merged into it when it arrives. If it never arrives you keep the brain's part with its generic board.
 *  onPartial(res) is called as soon as there is a usable part; the returned promise resolves with the final one. */
export async function createPartSplit({ description, templates = [], local = null, onProgress, onPartial, drawMs = 110_000, signal, ...rest } = {}) {
  const note = msg => onProgress?.(msg);
  const text = String(description || '').trim();
  if (!text) return { ok: false, error: 'Describe the part first.' };
  const hit = matchTemplate(text, templates);
  if (hit) {
    const { id, group, ...raw } = hit, v = validatePartSpec(raw);
    if (v.ok) return { ok: true, spec: v.spec, source: 'template', note: `This is the built-in "${hit.name}" template — instant, no AI needed.`, meta: { provider: 'Templates', model: 'built-in', ms: 0 } };
  }
  // ── the brain
  let brain = null; const why = [];
  if (local) { note('Asking the model on this device…'); const r = await local(text).catch(e => ({ ok: false, error: String(e?.message || e) })); if (r?.ok) brain = r; else why.push(`On this device: ${String(r?.error || 'no answer').slice(0, 100)}`); }
  if (!brain) {
    const cur = rest.provider || getStoredProvider(), ids = [cur, ...PROVIDER_IDS.filter(id => id !== cur)].filter(id => id === cur ? !!(rest.userKey || getStoredKey(id) || rest.hosted) : !!getStoredKey(id));
    for (const id of ids.length ? ids : [cur]) {
      if (signal?.aborted) return { ok: false, error: 'Stopped.' };
      note(`Working out the pins with ${PROVIDER_INFO[id]?.label || id}…`);
      const r = await createPartOnce({ ...rest, description: text, signal, brain: true, provider: id, ...(id === cur ? {} : { userKey: getStoredKey(id), model: getStoredModel(id) }) });
      if (r.ok) { brain = r; break; }
      if (r.needsKey && !rest.hosted) continue;
      why.push(`${PROVIDER_INFO[id]?.label || id}: ${String(r.error || 'no answer').replace(/\s+/g, ' ').slice(0, 100)}`);
    }
  }
  if (!brain) {
    const spec = heuristicSpec(text);
    if (!spec) return { ok: false, error: `No AI could make that part right now. ${why.join(' · ')}` };
    return { ok: true, spec, source: 'guess', note: `No AI answered, so this is a plain ${BEHAVIOURS[spec.behaviour.kind]?.label || 'part'} made from your words — check the pins. (${why.join(' · ').slice(0, 220)})`, meta: { provider: 'Keywords', model: 'built-in', ms: 0 } };
  }
  const first = { ...brain, source: 'brain', note: brain.note || '' };
  onPartial?.(first);
  // ── the picture (only the providers with a key that can take the big request)
  if (!rest.hosted && !PROVIDER_IDS.some(id => id !== 'groq' && getStoredKey(id)) && !getStoredKey(rest.provider || getStoredProvider())) return first;
  note('Drawing it in detail…');
  const stop = new AbortController(), link = () => stop.abort(); signal?.addEventListener('abort', link);
  const timer = setTimeout(link, drawMs);
  try {
    const instruction = 'Keep EVERY pin id and the whole "behaviour" exactly as in this draft. Only change the look: package "art" with a detailed, true-to-scale drawing of the real part, each pin given x and y at the end of its lead (drop "side"), and sizeMm.';
    const r = await createPart({ ...rest, description: text, refine: { spec: JSON.stringify(brain.spec), instruction }, signal: stop.signal });
    if (r?.ok && r.spec?.package === 'art') {
      const ids = s => (s.pins || []).map(p => p.id).sort().join('|');
      const merged = validatePartSpec({ ...r.spec, behaviour: brain.spec.behaviour });
      if (merged.ok && ids(merged.spec) === ids(brain.spec)) return { ...r, spec: merged.spec, source: 'split', note: `${brain.meta?.provider ? `Pins and behaviour: ${brain.meta.provider}. ` : ''}Drawing: ${r.meta?.provider || 'AI'}.`.trim(), meta: r.meta };
    }
    return { ...first, note: `${first.note} (The detailed drawing didn't come through, so this uses a generic board.)`.trim() };
  } catch (err) {
    if (err?.name === 'AbortError' && signal?.aborted) throw err;
    return { ...first, note: `${first.note} (The detailed drawing took too long, so this uses a generic board.)`.trim() };
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', link); }
}
