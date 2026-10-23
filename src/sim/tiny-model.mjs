// The CircuitBench tiny model: a ~1.3M-parameter encoder-decoder transformer trained only on CircuitBench requests.
// Runs here in plain JavaScript (no WebGPU, no ML runtime, ~2.5 MB of weights) and answers in a few milliseconds.
// It writes "bench language" (src/core/bench-lang.js), which is validated before anything reaches the board.
import { runForCircuit, stateString } from '../core/bench-lang.js';

const MODEL_URL = '/tiny-model.json', BIN_URL = '/tiny-model.bin';

/* ── tokenizer: the same word-level BPE the trainer used ── */
const asciiOnly = s => [...String(s)].map(c => (c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127 ? c : '?')).join('');
export function makeTokenizer(vocab, merges) {
  const stoi = new Map(vocab.map((s, i) => [s, i])), rank = new Map(merges.map(([a, b], i) => [`${a}\u0000${b}`, i]));
  const word = w => {
    let s = ['▁', ...w];
    for (;;) {
      let best = Infinity, at = -1;
      for (let i = 0; i < s.length - 1; i++) { const r = rank.get(`${s[i]}\u0000${s[i + 1]}`); if (r !== undefined && r < best) { best = r; at = i; } }
      if (at < 0) return s;
      s = [...s.slice(0, at), s[at] + s[at + 1], ...s.slice(at + 2)];
    }
  };
  return {
    encode: text => asciiOnly(text).split(' ').filter(Boolean).flatMap(word).map(p => stoi.get(p) ?? 3),
    decode: ids => ids.filter(i => i > 3).map(i => vocab[i]).join('').replaceAll('▁', ' ').trim(),
  };
}

/* ── tensors ── */
const f16 = h => { const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff; return (s ? -1 : 1) * (e === 0 ? 2 ** -14 * (f / 1024) : e === 31 ? (f ? NaN : Infinity) : 2 ** (e - 15) * (1 + f / 1024)); };
export function loadWeights(manifest, buffer) {
  const dv = new DataView(buffer), w = {};
  for (const t of manifest.tensors) {
    const n = t.bytes / 2, a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = f16(dv.getUint16(t.offset + i * 2, true));
    w[t.name] = { data: a, shape: t.shape };
  }
  return w;
}
// y[T,out] = x[T,in] · W[out,in]ᵀ + b
function linear(x, T, w, b) {
  const [O, I] = w.shape, y = new Float32Array(T * O), W = w.data;
  for (let t = 0; t < T; t++) { const xo = t * I, yo = t * O; for (let o = 0; o < O; o++) { let s = b ? b.data[o] : 0; const wo = o * I; for (let i = 0; i < I; i++) s += x[xo + i] * W[wo + i]; y[yo + o] = s; } }
  return y;
}
function layerNorm(x, T, D, g, b) {
  const y = new Float32Array(T * D);
  for (let t = 0; t < T; t++) { let m = 0, v = 0; for (let i = 0; i < D; i++) m += x[t * D + i]; m /= D; for (let i = 0; i < D; i++) v += (x[t * D + i] - m) ** 2; v /= D; const s = 1 / Math.sqrt(v + 1e-5); for (let i = 0; i < D; i++) y[t * D + i] = (x[t * D + i] - m) * s * g.data[i] + b.data[i]; }
  return y;
}

export function createTiny(manifest, buffer) {
  const { D, H, NE, ND, maxIn, maxOut } = manifest.config, hd = D / H, w = loadWeights(manifest, buffer), tok = makeTokenizer(manifest.vocab, manifest.merges);
  const g = n => w[n];
  const mha = (p, q, Tq, kv, Tk, causal) => {
    const Q = linear(q, Tq, g(`${p}.q.weight`), g(`${p}.q.bias`)), K = linear(kv, Tk, g(`${p}.k.weight`), g(`${p}.k.bias`)), V = linear(kv, Tk, g(`${p}.v.weight`), g(`${p}.v.bias`));
    const out = new Float32Array(Tq * D), sc = new Float32Array(Tk);
    for (let h = 0; h < H; h++) for (let t = 0; t < Tq; t++) {
      let mx = -Infinity; const lim = causal ? t + 1 : Tk;
      for (let s = 0; s < lim; s++) { let a = 0; for (let i = 0; i < hd; i++) a += Q[t * D + h * hd + i] * K[s * D + h * hd + i]; a /= Math.sqrt(hd); sc[s] = a; if (a > mx) mx = a; }
      let sum = 0; for (let s = 0; s < lim; s++) { sc[s] = Math.exp(sc[s] - mx); sum += sc[s]; }
      for (let s = 0; s < lim; s++) { const a = sc[s] / sum; for (let i = 0; i < hd; i++) out[t * D + h * hd + i] += a * V[s * D + h * hd + i]; }
    }
    return linear(out, Tq, g(`${p}.o.weight`), g(`${p}.o.bias`));
  };
  const add = (x, y) => { for (let i = 0; i < x.length; i++) x[i] += y[i]; return x; };
  const ffn = (p, x, T) => { const h = linear(x, T, g(`${p}.f1.weight`), g(`${p}.f1.bias`)); for (let i = 0; i < h.length; i++) if (h[i] < 0) h[i] = 0; return linear(h, T, g(`${p}.f2.weight`), g(`${p}.f2.bias`)); };
  const embed = (ids, pos) => { const x = new Float32Array(ids.length * D), E = g('emb.weight').data, P = g(pos).data, sc = Math.sqrt(D); for (let t = 0; t < ids.length; t++) for (let i = 0; i < D; i++) x[t * D + i] = E[ids[t] * D + i] * sc + P[t * D + i]; return x; };
  const ln = (n, x, T) => layerNorm(x, T, D, g(`${n}.weight`), g(`${n}.bias`));

  function encode(ids) {
    const T = ids.length; let x = embed(ids, 'pe.weight');
    for (let l = 0; l < NE; l++) { const p = `enc.${l}`, h = ln(`${p}.ln1`, x, T); add(x, mha(`${p}.sa`, h, T, h, T, false)); add(x, ffn(p, ln(`${p}.ln2`, x, T), T)); }
    return ln('lne', x, T);
  }
  function stepLogits(mem, S, tgt) {
    const T = tgt.length; let x = embed(tgt, 'pd.weight');
    for (let l = 0; l < ND; l++) {
      const p = `dec.${l}`, h = ln(`${p}.ln1`, x, T); add(x, mha(`${p}.sa`, h, T, h, T, true));
      add(x, mha(`${p}.ca`, ln(`${p}.lnc`, x, T), T, mem, S, false)); add(x, ffn(p, ln(`${p}.ln2`, x, T), T));
    }
    const last = ln('lnd', x, T).subarray((T - 1) * D, T * D), E = g('emb.weight').data, V = manifest.vocab.length, out = new Float32Array(V);
    for (let v = 0; v < V; v++) { let s = 0; for (let i = 0; i < D; i++) s += last[i] * E[v * D + i]; out[v] = s; }
    return out;
  }
  /** Greedy decode. Returns the text and how sure the model was (lowest token probability along the way). */
  function translate(text) {
    const src = tok.encode(text).slice(0, maxIn), mem = encode(src), tgt = [1]; let minP = 1, sumLog = 0;
    for (let i = 0; i < maxOut - 1; i++) {
      const lg = stepLogits(mem, src.length, tgt); let mx = -Infinity, arg = 0; for (let v = 0; v < lg.length; v++) if (lg[v] > mx) { mx = lg[v]; arg = v; }
      let z = 0; for (let v = 0; v < lg.length; v++) z += Math.exp(lg[v] - mx); const p = 1 / z;
      if (arg === 2) break;
      minP = Math.min(minP, p); sumLog += Math.log(p); tgt.push(arg);
    }
    return { text: tok.decode(tgt.slice(1)), minProb: minP, avgLogProb: sumLog / Math.max(1, tgt.length - 1) };
  }
  return { translate, tokenizer: tok, config: manifest.config, metrics: manifest.metrics };
}

/** Understand a request about this circuit → { kind:'edit', actions, code, explanation, program, confidence } | { kind:'off', explanation } | null (defer to a bigger AI). */
export function understand(model, instruction, circuit, { minConfidence = 0.9 } = {}) {
  const req = String(instruction || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!req || req.length > 220) return null;
  const out = model.translate(`${req} | ${stateString(circuit)}`);
  if (out.minProb < minConfidence) return null;
  const r = runForCircuit(out.text, circuit);
  if (!r || r.kind === 'defer') return null;
  return { ...r, program: out.text, confidence: out.minProb };
}

let loading = null;
/** Fetch and build the model once (about 2.5 MB). */
export function loadTiny({ fetchImpl = globalThis.fetch, manifestUrl = MODEL_URL, binUrl = BIN_URL } = {}) {
  loading ||= (async () => {
    const [m, b] = await Promise.all([fetchImpl(manifestUrl).then(r => { if (!r.ok) throw new Error('model not found'); return r.json(); }), fetchImpl(binUrl).then(r => { if (!r.ok) throw new Error('model not found'); return r.arrayBuffer(); })]);
    return createTiny(m, b);
  })().catch(e => { loading = null; throw e; });
  return loading;
}
