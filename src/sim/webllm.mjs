// "On this device" AI: a small open model that runs in the student's own browser through WebGPU (WebLLM).
// No key, no server, nothing leaves the machine — but a one-time model download and a smaller brain than the hosted models.
// The model code is imported lazily so students who never use it never download it.
import { buildPrompt, parseReply } from '../core/ai-prompt.js';

export const LOCAL_PROVIDER = 'local';
export const LOCAL_MODELS = [
  { id: 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 Coder 3B', sizeMB: 2505, note: 'Best balance for most laptops (~2.5 GB download, once).' },
  { id: 'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 Coder 7B', sizeMB: 5107, note: 'Smarter, needs a strong GPU (~5 GB download, once).' },
  { id: 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 Coder 1.5B', sizeMB: 1630, note: 'Light and fast, but makes more mistakes (~1.6 GB).' },
];
export const DEFAULT_LOCAL_MODEL = LOCAL_MODELS[0].id;
const MODEL_STORAGE = 'virtual-lab:ai-model:local';
const CONTEXT = 8192;

export const webgpuAvailable = (nav = globalThis.navigator) => !!(nav && nav.gpu);
export function getLocalModel() { try { const m = localStorage.getItem(MODEL_STORAGE); return LOCAL_MODELS.some(x => x.id === m) ? m : DEFAULT_LOCAL_MODEL; } catch { return DEFAULT_LOCAL_MODEL; } }
export function setLocalModel(id) { try { localStorage.setItem(MODEL_STORAGE, id); } catch { /* ignore */ } }

let engine = null, engineModel = null, loading = null;
async function defaultFactory(modelId, onProgress) {
  const web = await import('@mlc-ai/web-llm');
  return web.CreateMLCEngine(modelId, { initProgressCallback: p => onProgress?.(p) }, { context_window_size: CONTEXT });
}
/** Load (or reuse) the engine for a model. onProgress({progress:0..1, text}). */
export async function loadLocal(modelId = getLocalModel(), { onProgress, factory = defaultFactory } = {}) {
  if (engine && engineModel === modelId) return engine;
  if (loading?.modelId === modelId) return loading.promise;
  const promise = (async () => {
    try { engine = await factory(modelId, onProgress); engineModel = modelId; return engine; }
    finally { loading = null; }
  })();
  loading = { modelId, promise };
  return promise;
}
export function resetLocal() { engine = null; engineModel = null; loading = null; }

/** Same contract as generateCode() in ai-client.mjs: { ok, code, actions, explanation, meta } or { ok:false, error }. */
export async function generateLocal({ instruction, circuit, code, context = null, history = [], modelId = getLocalModel(), onProgress, factory, now = () => Date.now() }) {
  if (!String(instruction || '').trim()) return { ok: false, error: 'Describe what you want the sketch to do.' };
  const t0 = now();
  let eng;
  try { eng = await loadLocal(modelId, { onProgress, factory }); }
  catch (err) { return { ok: false, error: `Could not start the on-device model: ${err?.message || err}. Try another model, or add a free API key instead.` }; }
  const prompt = buildPrompt({ instruction, circuit, code, context, history, compact: true });
  let text = '';
  try {
    const r = await eng.chat.completions.create({ messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 2048 });
    text = r?.choices?.[0]?.message?.content || '';
  } catch (err) { return { ok: false, error: `The on-device model failed: ${err?.message || err}. Try a smaller model, or add a free API key.` }; }
  const result = parseReply(text);
  if (!result || (!result.code && !result.actions.length && !result.explanation.trim())) {
    return { ok: false, error: 'The on-device model did not return a usable edit — small models struggle with big requests. Try a shorter, simpler instruction, or add a free API key for a stronger model.' };
  }
  return { ok: true, ...result, meta: { provider: 'On this device', model: modelId.replace(/-q\d.*$/, ''), ms: now() - t0 } };
}
