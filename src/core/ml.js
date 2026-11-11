// Small neural networks for the AI workspace (TinyML on a UNO Q / VENTUNO Q class board): a dataset of sensor readings, a trainer
// (dense layers, ReLU, Adam; softmax for classes, mean squared error for a number), a predictor, and an exporter that writes the trained
// network as a C header the sketch can include. Pure and deterministic (seeded), so the page and the tests share one implementation.

export const MAX_HIDDEN_LAYERS = 3, MAX_NEURONS = 32;

/** a small seeded random generator (mulberry32) */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = r => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

/** A dataset: `features` are { name, pin? }, `classes` are label names (classification) or null (regression); each sample is { x: number[], y: class index | number }. */
export function emptyDataset(task = 'classify') {
  return { task, features: [{ name: 'A0', pin: 'A0' }], classes: task === 'classify' ? ['yes', 'no'] : null, target: task === 'regress' ? 'value' : null, samples: [] };
}
export function cleanDataset(d) {
  const task = d?.task === 'regress' ? 'regress' : 'classify';
  const features = (Array.isArray(d?.features) ? d.features : []).slice(0, 12).map((f, i) => ({ name: String(f?.name || `x${i + 1}`).slice(0, 24), ...(typeof f?.pin === 'string' && /^A\d{1,2}$/.test(f.pin) ? { pin: f.pin } : {}) }));
  if (!features.length) features.push({ name: 'A0', pin: 'A0' });
  const classes = task === 'classify' ? (Array.isArray(d?.classes) && d.classes.length >= 2 ? d.classes.slice(0, 8).map(c => String(c).slice(0, 24)) : ['yes', 'no']) : null;
  const samples = (Array.isArray(d?.samples) ? d.samples : []).filter(s => Array.isArray(s?.x) && s.x.length === features.length && s.x.every(Number.isFinite) && Number.isFinite(s.y) && (task === 'regress' || (Number.isInteger(s.y) && s.y >= 0 && s.y < classes.length))).slice(0, 5000).map(s => ({ x: s.x.slice(), y: s.y }));
  return { task, features, classes, target: task === 'regress' ? String(d?.target || 'value').slice(0, 24) : null, samples };
}

/** CSV text → dataset samples. First line = header; the last column is the label (a name) or the target (a number). Returns { dataset, problems }. */
export function parseCsv(text, task = 'classify') {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean), problems = [];
  if (lines.length < 2) return { dataset: null, problems: ['Paste a header line and at least one row.'] };
  const cells = l => l.split(/[,\t;]/).map(c => c.trim());
  const head = cells(lines[0]); if (head.length < 2) return { dataset: null, problems: ['Each row needs at least one feature and a label.'] };
  const names = head.slice(0, -1), rows = lines.slice(1).map(cells);
  const classes = []; const samples = [];
  rows.forEach((r, n) => {
    if (r.length !== head.length) { problems.push(`Row ${n + 2} has ${r.length} columns, not ${head.length}.`); return; }
    const x = r.slice(0, -1).map(Number); if (!x.every(Number.isFinite)) { problems.push(`Row ${n + 2} has a feature that is not a number.`); return; }
    if (task === 'regress') { const y = Number(r[r.length - 1]); if (!Number.isFinite(y)) { problems.push(`Row ${n + 2}: the target is not a number.`); return; } samples.push({ x, y }); }
    else { let k = classes.indexOf(r[r.length - 1]); if (k < 0) { classes.push(r[r.length - 1]); k = classes.length - 1; } samples.push({ x, y: k }); }
  });
  if (task === 'classify' && classes.length < 2) problems.push('Need at least two different labels.');
  if (!samples.length || (task === 'classify' && classes.length < 2)) return { dataset: null, problems };
  return { dataset: cleanDataset({ task, features: names.map(name => ({ name })), classes: task === 'classify' ? classes : null, target: task === 'regress' ? head[head.length - 1] : null, samples }), problems };
}
export function toCsv(d) {
  const head = [...d.features.map(f => f.name), d.task === 'classify' ? 'label' : d.target || 'value'].join(',');
  return [head, ...d.samples.map(s => [...s.x, d.task === 'classify' ? d.classes[s.y] : s.y].join(','))].join('\n');
}

/** Two demo datasets, generated from a seed: a classifier and a regression. */
export function demoDataset(id, seed = 7) {
  const r = rng(seed), samples = [];
  if (id === 'fan') {
    // an LDR (A0, bright = high) and a thermistor (A1, hot = high): the fan is off when it is cool, low when warm, high when hot - and off at night whatever the temperature
    for (let i = 0; i < 240; i++) {
      const light = Math.round(80 + r() * 860), temp = Math.round(200 + r() * 600);
      const heat = temp + (light - 480) * 0.25;                                          // sun on the sensor warms it
      const y = light < 200 ? 0 : heat < 470 ? 0 : heat < 640 ? 1 : 2;
      samples.push({ x: [light + Math.round(gauss(r) * 12), temp + Math.round(gauss(r) * 12)], y });
    }
    return cleanDataset({ task: 'classify', features: [{ name: 'light', pin: 'A0' }, { name: 'temp', pin: 'A1' }], classes: ['off', 'low', 'high'], samples });
  }
  if (id === 'ntc') {
    // an NTC thermistor in a divider: the ADC count is not linear in temperature
    const beta = 3950, r0 = 10000, t0 = 298.15;
    for (let i = 0; i < 160; i++) {
      const c = -10 + r() * 90, rt = r0 * Math.exp(beta * (1 / (c + 273.15) - 1 / t0)), adc = 1023 * rt / (rt + 10000);
      samples.push({ x: [Math.round(adc + gauss(r) * 2)], y: Math.round((c + gauss(r) * 0.4) * 10) / 10 });
    }
    return cleanDataset({ task: 'regress', features: [{ name: 'adc', pin: 'A0' }], target: 'celsius', samples });
  }
  return emptyDataset();
}

// ── the network ──────────────────────────────────────────────────────────────────────────────────────────────

/** weights are stored per layer as { W: rows of `in` numbers (one row per neuron), b }, in plain arrays so a model saves as JSON */
export function initModel(ds, { hidden = [8], seed = 1 } = {}) {
  const r = rng(seed), sizes = [ds.features.length, ...hidden.slice(0, MAX_HIDDEN_LAYERS).map(h => Math.max(1, Math.min(MAX_NEURONS, Math.round(h)))), ds.task === 'classify' ? ds.classes.length : 1];
  const layers = [];
  for (let l = 0; l < sizes.length - 1; l++) {
    const fan = sizes[l], s = Math.sqrt(2 / fan);
    layers.push({ W: Array.from({ length: sizes[l + 1] }, () => Array.from({ length: fan }, () => gauss(r) * s)), b: new Array(sizes[l + 1]).fill(0) });
  }
  const n = ds.samples.length || 1, mean = ds.features.map((_, j) => ds.samples.reduce((a, s) => a + s.x[j], 0) / n);
  const std = ds.features.map((_, j) => Math.sqrt(ds.samples.reduce((a, s) => a + (s.x[j] - mean[j]) ** 2, 0) / n) || 1);
  let ym = 0, ys = 1; if (ds.task === 'regress') { ym = ds.samples.reduce((a, s) => a + s.y, 0) / n; ys = Math.sqrt(ds.samples.reduce((a, s) => a + (s.y - ym) ** 2, 0) / n) || 1; }
  return { task: ds.task, sizes, layers, mean, std, ym, ys, classes: ds.classes, features: ds.features.map(f => f.name), target: ds.target };
}

const relu = v => (v > 0 ? v : 0);
function forward(m, xs, keep) {
  let a = xs; const acts = keep ? [a] : null, pre = keep ? [] : null;
  m.layers.forEach((L, l) => {
    const z = L.W.map((row, i) => { let s = L.b[i]; for (let j = 0; j < row.length; j++) s += row[j] * a[j]; return s; });
    pre?.push(z);
    const last = l === m.layers.length - 1;
    a = last ? z : z.map(relu); acts?.push(a);
  });
  return { out: a, acts, pre };
}
const softmax = z => { const mx = Math.max(...z), e = z.map(v => Math.exp(v - mx)), s = e.reduce((p, q) => p + q, 0); return e.map(v => v / s); };
const norm = (m, x) => x.map((v, j) => (v - m.mean[j]) / m.std[j]);

/** classification: the class probabilities; regression: the predicted number (in the sensor's own units) */
export function predict(m, x) {
  const { out } = forward(m, norm(m, x));
  return m.task === 'classify' ? softmax(out) : [out[0] * m.ys + m.ym];
}
export const predictClass = (m, x) => { const p = predict(m, x); return p.indexOf(Math.max(...p)); };

/** An Adam trainer you drive a few epochs at a time (so a page can draw the loss curve between steps). 20 % of the samples are held out for validation. */
export function createTrainer(ds, { hidden = [8], lr = 0.02, batch = 16, seed = 1, valSplit = 0.2 } = {}) {
  const r = rng(seed + 101), model = initModel(ds, { hidden, seed });
  const idx = ds.samples.map((_, i) => i); for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const nVal = ds.samples.length >= 10 ? Math.max(1, Math.round(ds.samples.length * valSplit)) : 0, val = idx.slice(0, nVal), train = idx.slice(nVal);
  const X = ds.samples.map(s => norm(model, s.x)), Y = ds.samples.map(s => (ds.task === 'classify' ? s.y : (s.y - model.ym) / model.ys));
  const mom = model.layers.map(L => ({ mW: L.W.map(row => row.map(() => 0)), vW: L.W.map(row => row.map(() => 0)), mb: L.b.map(() => 0), vb: L.b.map(() => 0) }));
  let t = 0, epoch = 0; const history = [];
  const lossOf = ids => {
    if (!ids.length) return { loss: NaN, acc: NaN };
    let loss = 0, ok = 0;
    for (const i of ids) { const o = forward(model, X[i]).out; if (ds.task === 'classify') { const p = softmax(o); loss -= Math.log(Math.max(p[Y[i]], 1e-9)); if (p.indexOf(Math.max(...p)) === Y[i]) ok++; } else loss += (o[0] - Y[i]) ** 2; }
    return { loss: loss / ids.length, acc: ds.task === 'classify' ? ok / ids.length : NaN };
  };
  function epochStep() {
    for (let i = train.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [train[i], train[j]] = [train[j], train[i]]; }
    for (let s = 0; s < train.length; s += batch) {
      const ids = train.slice(s, s + batch), gW = model.layers.map(L => L.W.map(row => row.map(() => 0))), gb = model.layers.map(L => L.b.map(() => 0));
      for (const i of ids) {
        const { out, acts, pre } = forward(model, X[i], true);
        let d = ds.task === 'classify' ? softmax(out).map((p, k) => p - (k === Y[i] ? 1 : 0)) : [2 * (out[0] - Y[i])];
        for (let l = model.layers.length - 1; l >= 0; l--) {
          const L = model.layers[l], a = acts[l], nd = new Array(a.length).fill(0);
          for (let k = 0; k < L.W.length; k++) { gb[l][k] += d[k]; for (let j = 0; j < a.length; j++) { gW[l][k][j] += d[k] * a[j]; nd[j] += d[k] * L.W[k][j]; } }
          if (l > 0) d = nd.map((v, j) => (pre[l - 1][j] > 0 ? v : 0));
        }
      }
      t++; const n = ids.length, b1 = 0.9, b2 = 0.999, c1 = 1 - b1 ** t, c2 = 1 - b2 ** t;
      model.layers.forEach((L, l) => {
        const M = mom[l];
        for (let k = 0; k < L.W.length; k++) {
          for (let j = 0; j < L.W[k].length; j++) { const g = gW[l][k][j] / n; M.mW[k][j] = b1 * M.mW[k][j] + (1 - b1) * g; M.vW[k][j] = b2 * M.vW[k][j] + (1 - b2) * g * g; L.W[k][j] -= lr * (M.mW[k][j] / c1) / (Math.sqrt(M.vW[k][j] / c2) + 1e-8); }
          const g = gb[l][k] / n; M.mb[k] = b1 * M.mb[k] + (1 - b1) * g; M.vb[k] = b2 * M.vb[k] + (1 - b2) * g * g; L.b[k] -= lr * (M.mb[k] / c1) / (Math.sqrt(M.vb[k] / c2) + 1e-8);
        }
      });
    }
    epoch++; const tr = lossOf(train), va = lossOf(val);
    history.push({ epoch, loss: tr.loss, acc: tr.acc, valLoss: va.loss, valAcc: va.acc });
    return history[history.length - 1];
  }
  return { model, history, step(n = 1) { for (let i = 0; i < n && train.length; i++) epochStep(); return history[history.length - 1]; }, get epoch() { return epoch; }, trainIds: train, valIds: val };
}

/** how a finished model does on the held-out samples (or all of them when there are too few): accuracy and a confusion matrix, or the mean error */
export function evaluate(m, ds, ids = ds.samples.map((_, i) => i)) {
  if (!ids.length) return null;
  if (m.task === 'regress') { let e = 0, e2 = 0; for (const i of ids) { const d = predict(m, ds.samples[i].x)[0] - ds.samples[i].y; e += Math.abs(d); e2 += d * d; } return { mae: e / ids.length, rmse: Math.sqrt(e2 / ids.length), n: ids.length }; }
  const k = m.classes.length, matrix = Array.from({ length: k }, () => new Array(k).fill(0)); let ok = 0;
  for (const i of ids) { const s = ds.samples[i], p = predictClass(m, s.x); matrix[s.y][p]++; if (p === s.y) ok++; }
  return { accuracy: ok / ids.length, matrix, n: ids.length };
}

export const paramCount = m => m.layers.reduce((s, L) => s + L.b.length + L.W.reduce((a, row) => a + row.length, 0), 0);

// ── export to C ──────────────────────────────────────────────────────────────────────────────────────────────

const cname = s => String(s).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase() || 'X';
const num = v => { const s = Number(v.toPrecision(8)).toString(); return /[.eE]/.test(s) ? `${s}f` : `${s}.0f`; };

/** The trained network as a header: weights in flash (PROGMEM on AVR), `cb_predict(in, out)` filling `out` with class scores (probabilities) or the number. */
export function exportC(m, { name = 'model' } = {}) {
  const id = cname(name), reg = m.task === 'regress', maxW = Math.max(...m.sizes), last = m.sizes[m.sizes.length - 1];
  const out = [];
  out.push(`// ${name}: ${m.sizes.join(' → ')} network exported by CircuitBench (${paramCount(m)} weights, ${paramCount(m) * 4} bytes of flash).`);
  out.push(`// Inputs, in this order: ${m.features.join(', ')}.${reg ? ` Output: ${m.target || 'value'}.` : ` Outputs: ${m.classes.map((c, i) => `${i} = ${c}`).join(', ')}.`}`);
  out.push(`#ifndef CB_MODEL_${id}_H`, `#define CB_MODEL_${id}_H`, '#include <math.h>', '#ifdef __AVR__', '#include <avr/pgm_space.h>', '#define CB_READ(p) pgm_read_float(p)', '#else', '#define PROGMEM', '#define CB_READ(p) (*(p))', '#endif', '');
  out.push(`#define ${id}_INPUTS ${m.sizes[0]}`, `#define ${id}_OUTPUTS ${last}`);
  if (!reg) m.classes.forEach((c, i) => out.push(`#define ${id}_CLASS_${cname(c)} ${i}`));
  out.push('', `static const float ${id}_MEAN[${m.sizes[0]}] PROGMEM = { ${m.mean.map(num).join(', ')} };`, `static const float ${id}_STD[${m.sizes[0]}] PROGMEM = { ${m.std.map(num).join(', ')} };`);
  m.layers.forEach((L, l) => {
    out.push(`static const float ${id}_W${l}[${L.W.length * L.W[0].length}] PROGMEM = { ${L.W.flat().map(num).join(', ')} };   // ${L.W.length} x ${L.W[0].length}, one row per neuron`);
    out.push(`static const float ${id}_B${l}[${L.b.length}] PROGMEM = { ${L.b.map(num).join(', ')} };`);
  });
  out.push('', `// Run the network. in[] holds the raw sensor values; out[] gets ${reg ? 'the predicted number' : 'one probability per class'}. Returns ${reg ? '0' : 'the index of the most likely class'}.`);
  out.push(`static int ${name}_predict(const float *in, float *out) {`, `  float a[${maxW}], z[${maxW}];`, `  for (int j = 0; j < ${id}_INPUTS; j++) a[j] = (in[j] - CB_READ(&${id}_MEAN[j])) / CB_READ(&${id}_STD[j]);`);
  m.layers.forEach((L, l) => {
    const nin = L.W[0].length, nout = L.W.length, isLast = l === m.layers.length - 1;
    out.push(`  for (int k = 0; k < ${nout}; k++) {`, `    float s = CB_READ(&${id}_B${l}[k]);`, `    for (int j = 0; j < ${nin}; j++) s += CB_READ(&${id}_W${l}[k * ${nin} + j]) * a[j];`, `    z[k] = ${isLast ? 's' : 's > 0 ? s : 0'};`, '  }', `  for (int k = 0; k < ${nout}; k++) a[k] = z[k];`);
  });
  if (reg) out.push(`  out[0] = a[0] * ${num(m.ys)} + ${num(m.ym)};`, '  return 0;');
  else out.push(`  float mx = a[0]; for (int k = 1; k < ${last}; k++) if (a[k] > mx) mx = a[k];`, '  float sum = 0; for (int k = 0; k < ' + last + '; k++) { out[k] = expf(a[k] - mx); sum += out[k]; }', `  int best = 0; for (int k = 0; k < ${last}; k++) { out[k] /= sum; if (out[k] > out[best]) best = k; }`, '  return best;');
  out.push('}', '', `#endif`, '');
  return out.join('\n');
}

/** A sketch that reads the sensors, runs the model and reports on Serial. Features without a pin read 0 until the student wires one. */
export function exampleSketch(m, ds, { name = 'model' } = {}) {
  const id = cname(name), reg = m.task === 'regress';
  const reads = ds.features.map((f, i) => `  in[${i}] = ${f.pin ? `analogRead(${f.pin})` : '0'};   // ${f.name}`).join('\n');
  return `#include "${name}.h"\n\nvoid setup() {\n  Serial.begin(9600);\n}\n\nvoid loop() {\n  float in[${id}_INPUTS], out[${id}_OUTPUTS];\n${reads}\n  int best = ${name}_predict(in, out);\n${reg ? `  Serial.print("${m.target || 'value'} = ");\n  Serial.println(out[0]);` : `  const char *names[] = { ${m.classes.map(c => JSON.stringify(c)).join(', ')} };\n  Serial.print(names[best]);\n  Serial.print(" (");\n  Serial.print(out[best] * 100, 0);\n  Serial.println("%)");`}\n  delay(500);\n}\n`;
}
