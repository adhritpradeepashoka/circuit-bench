// AI service: turns a plain-English instruction + the current circuit + sketch into a circuit edit
// (add/move/wire/remove parts), a firmware edit, or both.
//
// v0.1 (beta) is bring-your-own-key only: every call must carry the caller's own free key, so
// CircuitBench pays nothing and no quota bookkeeping is needed. This is intentional, not a shortcut —
// the freemium layer (a small server-funded daily quota before asking for a key) is meant to slot in
// later as a *second* way to satisfy the same call, without the client or this module's shape changing:
// a future "no userKey → try the house key under a quota, else ask for one" branch replaces the single
// `if (!userKey)` check below, and callers never need to change.
//
// Several providers are supported (Gemini, Groq, NVIDIA, Meta Llama, OpenRouter) so a student is never stuck when one
// account, model or free tier goes away — e.g. Google's key-creation flow fails for some accounts, and Google retires
// models for new keys. They are all wrapped to the same
// { ok, code, actions, explanation } shape so the rest of the app never needs to know which one answered.
//
// This module only asks the model for actions and parses what comes back — it never applies them.
// src/core/ai-actions.js (imported client-side, DOM-free so it also unit-tests here) validates each
// action against the real part/pin catalogue and applies it to the live project; a made-up part type or
// pin name is silently dropped with a warning there, never trusted blindly from the model's output.
import { RequestError } from './compile-service.mjs';
import { validatePartSpec } from '../src/core/custom-parts.js';
import { LIMITS, buildPrompt, parseReply, matchJsonFence, tryParseJson, describeContext, describeHistory, buildPartPrompt } from '../src/core/ai-prompt.js';
export { describeContext, describeHistory, buildPartPrompt };

function statusFor(httpStatus, message) {
  if (httpStatus === 429) return 429;
  if (httpStatus === 400 || httpStatus === 401 || httpStatus === 403) return /key|unauthoriz|permission/i.test(message) ? 401 : 400;
  return 502;
}

/** Is this provider error "that model isn't there (for you)" — so try the next model on the list? */
/** A hiccup at the host, not a problem with the request: worth trying the next model. */
const transient = (status, msg) => status >= 500 || status === 429 || /provider returned error|overloaded|temporarily|rate.?limit|upstream|capacity|busy/i.test(String(msg));
/** A short "safe"/"unsafe" verdict is what a moderation model returns, not an answer to the question — skip to the next model. */
export const looksLikeVerdict = text => { const t = String(text || '').trim(); return t.length < 80 && /^(?:(?:user|assistant|content) )?(?:safety|moderation)?\s*:?\s*(?:safe|unsafe)\b/i.test(t); };
const modelGone = (status, msg) => status === 404 || /no longer available|not found|does not exist|deprecated|decommission|not supported for|unknown model|invalid model|model_not_found/i.test(String(msg));

/** An OpenAI-compatible chat endpoint (Groq, NVIDIA, Meta's Llama API, OpenRouter …): one shape, many hosts. */
function openAiLike({ label, url, models, search = false, keyUrl, hint, prefer, listUrl, onlyFree = false, anyFree = false, anyChat = false, effort = '' }) {
  return {
    label, models, keyUrl, hint, prefer, onlyFree, anyFree, anyChat, listUrl: () => listUrl || url.replace(/\/chat\/completions$/, '/models'),
    listHeaders: key => ({ authorization: `Bearer ${key}` }),
    listIds: body => (Array.isArray(body?.data) ? body.data : []).filter(m => !onlyFree || m?.id === 'openrouter/free' || /:free$/.test(m?.id || '') || (m?.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0)).map(m => m?.id).filter(Boolean),
    url: () => url,
    headers: key => ({ 'content-type': 'application/json', authorization: `Bearer ${key}` }),
    body: (prompt, useSearch, model, fast) => JSON.stringify({
      model, temperature: 0.2, messages: [{ role: 'user', content: prompt }],
      ...(fast && effort === 'reasoning_effort' && /gpt-oss/.test(model) ? { reasoning_effort: 'low' } : {}),
      ...(fast && effort === 'reasoning' ? { reasoning: { effort: 'low' } } : {}),
      ...(useSearch && search ? { tools: [{ type: 'browser_search' }] } : {}),
    }),
    errorMessage: body => body?.error?.message || (typeof body?.error === 'string' ? body.error : '') || body?.detail || body?.message,
    text: body => body?.choices?.[0]?.message?.content || '',
    sources: body => (body?.choices?.[0]?.message?.executed_tools || []).flatMap(t => (Array.isArray(t?.search_results?.results) ? t.search_results.results : [])).map(r => ({ title: r?.title, url: r?.url })),
  };
}

// Several providers so a student isn't stuck when one account, model or free tier goes away. Each has a list of models
// tried in order (the first one the key can actually use wins) and the student can type their own model id too.
export const PROVIDERS = {
  gemini: {
    label: 'Gemini',
    models: ['gemini-3.8-flash', 'gemini-2.5-flash'],      // last-resort list; the live list from Google (see discover()) wins
    prefer: [/^gemini-(\d+(?:\.\d+)?)-flash$/, /^gemini-(\d+(?:\.\d+)?)-flash-lite$/, /^gemini-(\d+(?:\.\d+)?)-pro$/],
    listUrl: key => `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`,
    listHeaders: () => ({}),
    listIds: body => (Array.isArray(body?.models) ? body.models : []).filter(m => (m?.supportedGenerationMethods || []).includes('generateContent')).map(m => String(m.name || '').replace(/^models\//, '')),
    url: (key, model) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    headers: () => ({ 'content-type': 'application/json' }),
    // search: Google Search grounding, so a part lookup is based on the real datasheet instead of recall.
    // fast: Gemini 2.5/3.x "think" before answering by default, which is most of the wait; edits don't need it
    body: (prompt, search, model, fast) => JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, ...(fast && /flash/.test(model) ? { thinkingConfig: /gemini-2\./.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: 'low' } } : {}) },
      ...(search ? { tools: [{ google_search: {} }] } : {}),
    }),
    errorMessage: body => body?.error?.message,
    text: body => body?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '',
    sources: body => (body?.candidates?.[0]?.groundingMetadata?.groundingChunks || []).map(c => ({ title: c?.web?.title, url: c?.web?.uri })),
  },
  // openai/gpt-oss-120b, not llama-3.3-70b-versatile — that one needs Groq's paid tier and 404s on free accounts.
  groq: openAiLike({ label: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', models: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'], search: true, effort: 'reasoning_effort', prefer: [/^openai\/gpt-oss-(\d+)b$/, /llama-?(\d+(?:\.\d+)?)-(?:maverick|scout)/, /^llama-(\d+(?:\.\d+)?)-70b-versatile$/] }),
  nvidia: openAiLike({ label: 'NVIDIA', url: 'https://integrate.api.nvidia.com/v1/chat/completions', models: ['meta/llama-3.3-70b-instruct', 'meta/llama-3.1-70b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct', 'meta/llama-3.1-8b-instruct'], anyChat: true, prefer: [/^meta\/llama-(\d+(?:\.\d+)?)-70b-instruct$/, /^meta\/llama-(\d+(?:\.\d+)?)-(?:maverick|scout)/, /^nvidia\/llama-[\d.]+-nemotron-(?:super-)?(?:70|49)b/, /^meta\/llama-(\d+(?:\.\d+)?)-405b-instruct$/, /^(?:deepseek-ai\/deepseek-v(\d+(?:\.\d+)?)|mistralai\/mistral-large(?:-(\d+))?|qwen\/qwen[\d.]*-(?:coder-)?(?:32|72|235)b[\w.-]*)$/, /^meta\/llama-(\d+(?:\.\d+)?)-8b-instruct$/] }),
  meta: openAiLike({ label: 'Meta Llama', url: 'https://api.llama.com/compat/v1/chat/completions', models: ['Llama-4-Maverick-17B-128E-Instruct-FP8', 'Llama-3.3-70B-Instruct'], prefer: [/^llama-(\d+(?:\.\d+)?)-maverick/i, /^llama-(\d+(?:\.\d+)?)-70b-instruct$/i] }),
  // openrouter/free is OpenRouter's own router: it hands the request to whichever free model is up right now, so it survives retirements.
  openrouter: openAiLike({ label: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', models: ['meta-llama/llama-3.3-70b-instruct:free', 'openrouter/free'], effort: 'reasoning', onlyFree: true, anyFree: true, prefer: [/^meta-llama\/llama-(\d+(?:\.\d+)?)-70b-instruct:free$/, /^(?:openai\/gpt-oss-(\d+)b|qwen\/qwen[\d.]*-(\d+)b[\w.-]*|deepseek\/deepseek-(?:chat|v)[\w.-]*|mistralai\/mistral[\w.-]*|google\/gemma-(\d+)[\w.-]*):free$/, /^openrouter\/free$/] }),
};
/** What the browser needs to draw the provider picker. */
export const PROVIDER_LIST = Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, models: p.models }));

/** Model ids a provider offers, best first: for each "prefer" pattern, the newest version (highest number in the id) first. */
export function rankModels(p, ids) {
  const seen = new Set(), out = [];
  const pool = ids.filter(id => !/preview|exp(erimental)?\b|image|tts|audio|live|embed|guard|whisper|vision|moderation|robotics|thinking|-1b|-3b/i.test(id));
  for (const re of p.prefer || []) {
    const hit = pool.filter(id => re.test(id) && (!p.onlyFree || /:free$/.test(id) || id === 'openrouter/free')).map(id => ({ id, v: parseFloat(id.match(re)?.[1] ?? '0') || 0 }));
    hit.sort((a, b) => b.v - a.v || a.id.length - b.id.length);
    for (const { id } of hit) if (!seen.has(id)) { seen.add(id); out.push(id); }
  }
  if (p.anyChat) for (const id of pool) if (!seen.has(id) && /instruct|chat|nemotron|llama|qwen|deepseek|mistral|mixtral|gemma|gpt-oss|phi|glm|kimi|granite/i.test(id) && !/reward|safety|nv-embed|rerank|clip|vlm|parse|translate|\b(?:vila|neva|paligemma|kosmos)\b/i.test(id)) { seen.add(id); out.push(id); }   // lists include retired models, so after the favourites try everything chat-like
  if (p.anyFree) for (const id of pool) if (!seen.has(id) && /:free$/.test(id)) { seen.add(id); out.push(id); }       // then any other free model that is up
  return out;
}

export function createAiService({ fetchImpl = globalThis.fetch, now = () => Date.now(), attemptMs = 35000, budgetMs = 85000 } = {}) {
  // Free models come and go (Google closed gemini-2.5-flash to new keys; Groq retires models) — so ask the provider
  // which models THIS key can use, newest first, and remember the answer for a while. The built-in list is the fallback.
  const found = new Map(), works = new Map();   // works: the model that last answered for this key (listed ≠ usable: NVIDIA lists models an account can't call)
  const keyId = (p, userKey) => `${p.label}:${userKey.slice(-6)}:${userKey.length}`;
  async function discover(p, userKey) {
    if (!p.prefer || !p.listUrl) return [];
    const ck = keyId(p, userKey), hit = found.get(ck);
    if (hit && now() - hit.at < 30 * 60 * 1000) return hit.ids;
    let ids = [];
    try {
      const res = await fetchImpl(p.listUrl(userKey), { method: 'GET', headers: p.listHeaders(userKey), signal: AbortSignal.timeout(8000) });
      if (res?.ok) ids = rankModels(p, p.listIds(await res.json()));
    } catch { /* offline listing: use the built-in list */ }
    found.set(ck, { at: now(), ids });
    return ids;
  }
  function needKey(userKey, provider) {
    const p = PROVIDERS[provider];
    if (!p) throw new RequestError(`Unknown AI provider "${provider}".`);
    if (!userKey) {
      const err = new RequestError('AI features need a free API key for now — add one in Settings → AI.', 428);
      err.needsKey = true;
      throw err;
    }
    return p;
  }
  /**
   * One call to the provider. `search` asks it to look things up on the web first (Google Search grounding /
   * Groq browser search); keys and plans differ, so if the provider rejects the tool we quietly try again
   * without it rather than failing the student's request.
   */
  async function ask(p, userKey, prompt, { search = false, model = '' } = {}) {
    const typed = /^[\w./:@-]{1,80}$/.test(String(model || '')) ? String(model) : '';
    const wanted = typed ? [typed] : [...new Set([works.get(keyId(p, userKey)), ...(await discover(p, userKey)).slice(0, p.anyChat ? 8 : 6), ...p.models].filter(Boolean))].slice(0, p.anyChat ? 8 : 7);   // a model the student typed is the only one tried
    const tried = [], t0 = now();
    let res, body, msg, fast = true;
    for (let i = 0; i < wanted.length; i++) {
      // A slow free tier can hold one request for minutes; the host in front of us gives up on the whole thing after a while.
      // So every attempt has its own timeout, and the whole walk down the list has a budget.
      const left = budgetMs - (now() - t0);
      if (left < 4000) throw new RequestError(`${p.label} is taking too long right now (tried ${tried.concat(wanted[i]).slice(0, 3).join(', ')}). Try again, or switch provider with the menu under the chat box.`, 504);
      try {
        res = await fetchImpl(p.url(userKey, wanted[i]), { method: 'POST', headers: p.headers(userKey), body: p.body(prompt, search, wanted[i], fast), signal: AbortSignal.timeout(Math.min(attemptMs, left)) });
      } catch (err) {
        if (err?.name === 'TimeoutError' || err?.name === 'AbortError') { tried.push(wanted[i]); if (i < wanted.length - 1) continue; throw new RequestError(`${p.label} did not answer in time (${wanted[i]}). Try again, or switch provider with the menu under the chat box.`, 504); }
        throw new RequestError(`Could not reach ${p.label} — check your connection and try again.`, 502);
      }
      try { body = await res.json(); } catch { body = null; }
      if (res.ok) {
        if ((!String(p.text(body) || '').trim() || looksLikeVerdict(p.text(body))) && i < wanted.length - 1) { tried.push(wanted[i]); continue; }   // an empty answer (a reasoning model that ran out of room) or a moderation verdict: try the next model
        break;
      }
      msg = p.errorMessage(body) || `HTTP ${res.status}`;
      if (fast && res.status === 400 && /reason|thinking|effort|unknown (field|param)|unrecognized|unexpected|extra inputs|invalid json payload/i.test(msg) && !/key/i.test(msg)) { fast = false; i--; continue; }   // this model doesn't take the speed-up hint: same model, plain request
      tried.push(wanted[i]);
      if (search && !modelGone(res.status, msg) && /tool|search|grounding|not supported|unsupported|invalid argument|400/i.test(`${msg} ${res.status}`)) return ask(p, userKey, prompt, { search: false, model });
      if (i < wanted.length - 1 && (modelGone(res.status, msg) || transient(res.status, msg))) continue;            // that model isn't available to this key — try the next one
      throw new RequestError(`${p.label} error: ${msg}${modelGone(res.status, msg) ? ` — none of ${tried.length > 1 ? `the ${tried.length} models I tried (${tried.slice(0, 4).join(', ')}${tried.length > 4 ? '…' : ''})` : `“${tried[0]}”`} is open to this key. Type a model your account can use in the AI settings, or pick another provider.` : ''}`, statusFor(res.status, msg));
    }
    if (!typed) works.set(keyId(p, userKey), wanted[Math.min(tried.length, wanted.length - 1)]);
    const sources = [];
    for (const s of p.sources?.(body) || []) if (s?.url && !sources.some(x => x.url === s.url)) sources.push({ title: String(s.title || s.url).slice(0, 120), url: String(s.url).slice(0, 500) });
    return { text: p.text(body), sources: sources.slice(0, 6), searched: search && sources.length > 0, meta: { provider: p.label, model: wanted[Math.min(tried.length, wanted.length - 1)], ms: Math.max(0, now() - t0), tried: tried.length } };
  }

  /** Describe a part in words → a validated part spec (one repair round if the first answer doesn't validate). */
  async function createPart({ description, userKey, provider = 'gemini', model }) {
    if (!description || !String(description).trim()) throw new RequestError('Describe the part you want to make.');
    const p = needKey(userKey, provider);
    let problems = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { text, sources, searched, meta } = await ask(p, userKey, buildPartPrompt(description, problems), { search: true, model });
      const m = matchJsonFence(text);
      const raw = m ? tryParseJson(m[1]) : null;
      if (!raw) { problems = ['The reply had no valid json block.']; continue; }
      const v = validatePartSpec(raw);
      if (v.ok) return { ok: true, spec: v.spec, note: String(raw.note || '').slice(0, 300), sources, searched, meta };
      problems = v.errors;
    }
    throw new RequestError(`The AI's part didn't check out: ${problems.join(' ')} Try describing it differently, or build it in the Part Creator.`, 502);
  }

  async function generateCode({ instruction, circuit, code, context, history, userKey, provider = 'gemini', model }) {
    if (!instruction || !String(instruction).trim()) throw new RequestError('Describe what you want the sketch to do.');
    const p = needKey(userKey, provider);
    const prompt = buildPrompt({ instruction, circuit, code, context, history });
    const { text, meta } = await ask(p, userKey, prompt, { model });
    const result = parseReply(text);
    // actions:[] + code:null is not automatically a failure: a model that correctly decides nothing
    // needs to change (the sketch already does what was asked, or the circuit already has the part)
    // answers exactly this way, with the reasoning in "explanation". That's a valid, useful reply — only
    // a reply with NOTHING at all (parseReply found no json/code block, or an empty explanation too) is
    // actually unusable and worth erroring on.
    if (!result || (!result.code && !result.actions.length && !result.explanation.trim())) {
      throw new RequestError('The AI did not return a usable edit — try rephrasing the instruction.', 502);
    }
    return { ok: true, ...result, meta };
  }

  return { generateCode, createPart };
}
