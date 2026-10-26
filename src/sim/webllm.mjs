// "On this device" AI: a small open model that runs in the student's own browser through WebGPU (WebLLM).
// No key, no server, nothing leaves the machine — but a one-time model download and a smaller brain than the hosted models.
// The model code is imported lazily so students who never use it never download it.
import { buildPrompt, parseReply } from '../core/ai-prompt.js';

export const LOCAL_PROVIDER = 'local';
export const LOCAL_MODELS = [
  { id: 'Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 Coder 0.5B (tiny)', sizeMB: 945, note: 'Tiny and fast (~0.9 GB download, once): runs on almost any laptop, but it is the weakest — good for simple edits and quick questions.' },
  { id: 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 Coder 1.5B', sizeMB: 1630, note: 'Default: fits integrated graphics (~1.6 GB download, once), but makes more mistakes.' },
  { id: 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 Coder 3B', sizeMB: 2505, note: 'Smarter; wants a graphics card or a fast laptop (~2.5 GB download, once).' },
  { id: 'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 Coder 7B', sizeMB: 5107, note: 'Smarter, needs a strong GPU (~5 GB download, once).' },
];
export const DEFAULT_LOCAL_MODEL = 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC';   // integrated GPUs are the common case, so start with the model they can hold
const TINY = 'Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC';
const MODEL_STORAGE = 'virtual-lab:ai-model:local';
const CONTEXT = 4096;

let probed = null;   // null = not asked yet, true/false = the browser really can (not) give us a GPU adapter
/** navigator.gpu existing is not enough: many machines expose it but hand back no adapter (driver blocklist, hardware acceleration off). */
export const webgpuAvailable = (nav = globalThis.navigator) => !!(nav && nav.gpu) && probed !== false;
export const NO_ADAPTER_HELP = 'Your browser has WebGPU but could not get a graphics adapter. Turn on hardware acceleration (Chrome/Edge → Settings → System), update your graphics driver, or check chrome://gpu — or use a free API key instead.';
export async function requestAdapter(nav = globalThis.navigator) {
  for (const opts of [undefined, { powerPreference: 'low-power' }, { powerPreference: 'high-performance' }]) {
    try { const a = await nav.gpu.requestAdapter(opts); if (a) return a; } catch { /* try the next */ }
  }
  return null;
}
/** Ask once whether a usable adapter exists; webgpuAvailable() turns false if not so the UI stops offering the on-device model. */
export async function probeWebGPU(nav = globalThis.navigator) {
  if (!(nav && nav.gpu)) return (probed = false);
  return (probed = !!(await requestAdapter(nav)));
}
export function getLocalModel() { try { const m = localStorage.getItem(MODEL_STORAGE); return LOCAL_MODELS.some(x => x.id === m) ? m : DEFAULT_LOCAL_MODEL; } catch { return DEFAULT_LOCAL_MODEL; } }
export function setLocalModel(id) { try { localStorage.setItem(MODEL_STORAGE, id); } catch { /* ignore */ } }

let engine = null, engineModel = null, loading = null, usedModel = null;
const sizeOf = id => LOCAL_MODELS.find(m => m.id === id)?.sizeMB ?? (id === TINY ? 945 : 0);
/** The q4f16 builds need the GPU's shader-f16 feature; many laptops lack it, so use the q4f32 build of the same model there. */
export async function pickBuild(modelId, nav = globalThis.navigator) {
  try {
    const adapter = await requestAdapter(nav);
    if (!adapter) { probed = false; const e = new Error(NO_ADAPTER_HELP); e.noAdapter = true; throw e; }
    if (!adapter.features.has('shader-f16')) return modelId.replace('q4f16_1', 'q4f32_1');
  } catch (err) { if (err?.noAdapter) throw err; }
  return modelId;
}
async function defaultFactory(modelId, onProgress) {
  modelId = await pickBuild(modelId);
  const web = await import('@mlc-ai/web-llm');
  return web.CreateMLCEngine(modelId, { initProgressCallback: p => onProgress?.(p) }, { context_window_size: CONTEXT });
}
/** Load (or reuse) the engine for a model. onProgress({progress:0..1, text}). */
export async function loadLocal(modelId = getLocalModel(), { onProgress, factory = defaultFactory } = {}) {
  if (engine && engineModel === modelId) return engine;
  if (loading?.modelId === modelId) return loading.promise;
  const promise = (async () => {
    try {
      // too big for this GPU's memory? step down a size rather than failing
      const chain = [modelId, ...LOCAL_MODELS.map(m => m.id).filter(id => id !== modelId && sizeOf(id) < sizeOf(modelId)).reverse(), TINY].filter((id, i, a) => a.indexOf(id) === i && (id === modelId || sizeOf(id) < sizeOf(modelId)));
      let lastErr;
      for (const id of chain) {
        try { engine = await factory(id, onProgress); engineModel = modelId; usedModel = id; return engine; } catch (err) { lastErr = err; if (/adapter|WebGPU is not supported/i.test(err?.message || '')) break; }
      }
      throw lastErr;
    } finally { loading = null; }
  })();
  loading = { modelId, promise };
  return promise;
}
export function resetLocal() { engine = null; engineModel = null; loading = null; }

/** Same contract as generateCode() in ai-client.mjs: { ok, code, actions, explanation, meta } or { ok:false, error }. */
export async function generateLocal({ instruction, circuit, code, context = null, history = [], assembly = null, modelId = getLocalModel(), onProgress, factory, now = () => Date.now() }) {
  if (!String(instruction || '').trim()) return { ok: false, error: 'Describe what you want the sketch to do.' };
  const t0 = now();
  let eng;
  try { eng = await loadLocal(modelId, { onProgress, factory }); }
  catch (err) { return { ok: false, error: `Could not start the on-device model: ${err?.message || err}. Try another model, or add a free API key instead.` }; }
  const prompt = buildPrompt({ instruction, circuit, code, context, history, assembly, compact: true });
  let text = '';
  try {
    const r = await eng.chat.completions.create({ messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 2048 });
    text = r?.choices?.[0]?.message?.content || '';
  } catch (err) { return { ok: false, error: `The on-device model failed: ${err?.message || err}. Try a smaller model, or add a free API key.` }; }
  const result = parseReply(text);
  if (!result || (!result.code && !result.actions.length && !result.explanation.trim())) {
    return { ok: false, error: 'The on-device model did not return a usable edit — small models struggle with big requests. Try a shorter, simpler instruction, or add a free API key for a stronger model.' };
  }
  return { ok: true, ...result, meta: { provider: 'On this device', model: (usedModel || modelId).replace(/-q\d.*$/, ''), ms: now() - t0 } };
}

/* ── managing the downloaded models (they live in the browser's cache, 1–5 GB each) ── */
const allIds = () => LOCAL_MODELS.flatMap(m => [m.id, m.id.replace('q4f16_1', 'q4f32_1')]).concat(TINY, TINY.replace('q4f16_1', 'q4f32_1')).filter((id, i, a) => a.indexOf(id) === i);
/** Which on-device models are currently downloaded in this browser. */
export async function cachedModels({ web = null } = {}) {
  try { web ||= await import('@mlc-ai/web-llm'); const out = []; for (const id of allIds()) if (await web.hasModelInCache(id)) out.push(id); return out; } catch { return []; }
}
/** Stop using the engine and delete every downloaded on-device model from this browser. Returns how many were removed. */
export async function deleteLocalModels({ web = null } = {}) {
  try { await engine?.unload?.(); } catch { /* ignore */ }
  resetLocal();
  try { web ||= await import('@mlc-ai/web-llm'); } catch { return 0; }
  let n = 0;
  for (const id of allIds()) { try { if (await web.hasModelInCache(id)) { await web.deleteModelAllInfoInCache(id); n++; } } catch { /* keep going */ } }
  return n;
}
