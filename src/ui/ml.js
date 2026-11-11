// The AI workspace's machine-learning tabs: Train (collect sensor data, train a small neural network), Run (try the model live and export it as C for
// the sketch) and Visualize (loss curve, decision map, the network itself, confusion matrix). The maths lives in src/core/ml.js; the project keeps
// its ML work in src/core/ml-context.js. Only workspaces that ask for it (AI boards) get the tabs.
import { activeWorkspace } from '../core/workspaces.js';
import { getMl, updateMl, onMl } from '../core/ml-context.js';
import { emptyDataset, demoDataset, parseCsv, toCsv, createTrainer, evaluate, predict, paramCount, exportC, exampleSketch, MAX_NEURONS } from '../core/ml.js';

const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const COLORS = ['#1d63ed', '#e0622b', '#1f9d55', '#a65d8c', '#c79a14', '#2aa7b8', '#cf3d34', '#6d7a75'];
const PINS = ['', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5'];
const BEGIN = '// ---- CircuitBench model (begin) ----', END = '// ---- CircuitBench model (end) ----';
const fmt = v => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
const pct = v => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '–');

export function initMl({ editor, code, sim }) {
  const canvas = document.getElementById('canvas'), toolbar = document.querySelector('.toolbar');
  if (!canvas || !toolbar) return null;
  const toggle = el('div', { className: 'view-toggle', role: 'group', ariaLabel: 'View', hidden: true }), sepAfter = el('span', { className: 'sep', hidden: true });
  const VIEWS = [['circuit', 'Circuit'], ['train', 'Train'], ['run', 'Run model'], ['viz', 'Visualize']], btn = {};
  for (const [id, label] of VIEWS) { btn[id] = el('button', { type: 'button', textContent: label }); btn[id].addEventListener('click', () => show(id)); toggle.append(btn[id]); }
  toolbar.prepend(toggle, sepAfter);
  const pane = el('div', { className: 'ml-pane', hidden: true }), secs = {};
  for (const id of ['train', 'run', 'viz']) { secs[id] = el('section', { className: 'ml-sec', hidden: true }); pane.append(secs[id]); }
  canvas.append(pane);
  let view = 'circuit', trainer = null, raf = 0, liveTimer = 0, probe = null, follow = true;

  const ds = () => getMl().dataset;
  const setDs = (d, extra = {}) => updateMl({ dataset: d, ...extra }, 'data');
  const status = t => editor.status?.(t);

  /* ── Train ─────────────────────────────────────────── */
  const T = {
    left: el('div', { className: 'ml-col' }), right: el('div', { className: 'ml-col' }),
  };
  secs.train.append(T.left, T.right);
  const card = (title, ...kids) => el('div', { className: 'ml-card' }, el('h3', { textContent: title }), ...kids);
  const row = (...kids) => el('div', { className: 'ml-row' }, ...kids);
  const button = (text, fn, cls = '') => { const b = el('button', { type: 'button', className: `ml-btn ${cls}`, textContent: text }); b.addEventListener('click', fn); return b; };

  const dataCard = el('div', { className: 'ml-card' }), trainCard = el('div', { className: 'ml-card' });
  T.left.append(dataCard); T.right.append(trainCard);

  function renderData() {
    const d = ds(), m = getMl(); dataCard.replaceChildren(el('h3', { textContent: 'Data' }));
    if (!d) {
      dataCard.append(el('p', { className: 'ml-note', textContent: 'A model learns from examples: sensor readings and what each reading means. Start from a demo, or build your own dataset from the board’s pins.' }),
        row(button('Fan demo (classify)', () => setDs(demoDataset('fan'), { model: null, history: [] }), 'primary'), button('Thermistor demo (predict a number)', () => setDs(demoDataset('ntc'), { model: null, history: [] })), button('Blank: classify', () => setDs(emptyDataset('classify'), { model: null, history: [] })), button('Blank: predict a number', () => setDs(emptyDataset('regress'), { model: null, history: [] }))));
      return;
    }
    const locked = d.samples.length > 0;
    // features
    const feats = el('div', { className: 'ml-list' });
    d.features.forEach((f, i) => {
      const name = el('input', { value: f.name, maxLength: 24, ariaLabel: 'Feature name' }), pin = el('select', { ariaLabel: 'Board pin' }, ...PINS.map(p => el('option', { value: p, textContent: p || 'no pin', selected: (f.pin || '') === p })));
      name.addEventListener('change', () => { const fs = d.features.map((g, j) => (j === i ? { ...g, name: name.value.trim() || g.name } : g)); setDs({ ...d, features: fs }, { model: null, history: [] }); });
      pin.addEventListener('change', () => { const fs = d.features.map((g, j) => { if (j !== i) return g; const { pin: _p, ...rest } = g; return pin.value ? { ...rest, pin: pin.value } : rest; }); setDs({ ...d, features: fs }); });
      const rm = button('✕', () => setDs({ ...d, features: d.features.filter((_, j) => j !== i) }, { model: null, history: [] }), 'icon'); rm.disabled = locked || d.features.length < 2; rm.title = locked ? 'Clear the samples to change the inputs' : 'Remove this input';
      feats.append(row(el('span', { className: 'ml-tag', textContent: `x${i + 1}` }), name, pin, rm));
    });
    const addF = button('+ Input', () => setDs({ ...d, features: [...d.features, { name: `x${d.features.length + 1}` }] }, { model: null, history: [] }), 'small'); addF.disabled = locked || d.features.length >= 8; addF.title = locked ? 'Clear the samples to change the inputs' : '';
    dataCard.append(el('h4', { textContent: 'Inputs (what the board measures)' }), feats, addF);
    // classes / target
    if (d.task === 'classify') {
      const cl = el('div', { className: 'ml-list' });
      d.classes.forEach((c, i) => {
        const name = el('input', { value: c, maxLength: 24, ariaLabel: 'Class name' });
        name.addEventListener('change', () => setDs({ ...d, classes: d.classes.map((g, j) => (j === i ? name.value.trim() || g : g)) }, { model: null, history: [] }));
        const n = d.samples.filter(s => s.y === i).length, rm = button('✕', () => setDs({ ...d, classes: d.classes.filter((_, j) => j !== i), samples: d.samples.filter(s => s.y !== i).map(s => ({ ...s, y: s.y > i ? s.y - 1 : s.y })) }, { model: null, history: [] }), 'icon'); rm.disabled = d.classes.length < 3; rm.title = 'Remove this class and its samples';
        cl.append(row(el('span', { className: 'ml-dot', style: `background:${COLORS[i % COLORS.length]}` }), name, el('span', { className: 'ml-count', textContent: `${n} sample${n === 1 ? '' : 's'}` }), rm));
      });
      const addC = button('+ Class', () => setDs({ ...d, classes: [...d.classes, `class ${d.classes.length + 1}`] }, { model: null, history: [] }), 'small'); addC.disabled = d.classes.length >= 8;
      dataCard.append(el('h4', { textContent: 'Classes (what the model should tell apart)' }), cl, addC);
    } else {
      const t = el('input', { value: d.target, maxLength: 24, ariaLabel: 'What to predict' }); t.addEventListener('change', () => setDs({ ...d, target: t.value.trim() || d.target }, { model: null, history: [] }));
      dataCard.append(el('h4', { textContent: 'What to predict' }), row(t));
    }
    // add a sample
    const vals = d.features.map(f => el('input', { type: 'number', step: 'any', placeholder: f.name, ariaLabel: f.name, className: 'ml-num' }));
    const lab = d.task === 'classify' ? el('select', { ariaLabel: 'Label' }, ...d.classes.map((c, i) => el('option', { value: i, textContent: c }))) : el('input', { type: 'number', step: 'any', placeholder: d.target, ariaLabel: d.target, className: 'ml-num' });
    const add = (x, y) => { if (!x.every(Number.isFinite) || !Number.isFinite(y)) { status('Fill in every value first.'); return; } setDs({ ...d, samples: [...d.samples, { x, y }] }, { model: null, history: [] }); };
    const rec = button('● Record from the board', () => { const x = readBoard(d); if (!x) { status(sim?.running ? 'None of the inputs has a board pin (A0–A5) set.' : 'Press Run in the Circuit tab first, so the board has readings to record.'); return; } add(x, d.task === 'classify' ? +lab.value : +lab.value); }, 'primary');
    dataCard.append(el('h4', { textContent: 'Add a sample' }), row(...vals, lab), row(button('Add typed values', () => add(vals.map(v => +v.value), +lab.value)), rec),
      el('p', { className: 'ml-note', textContent: 'Pick the label first, then record: the reading is taken from the pins you set above while the circuit is running. Move a slider or knob in the circuit between recordings.' }));
    // csv
    const ta = el('textarea', { className: 'ml-csv', rows: 4, placeholder: `${d.features.map(f => f.name).join(',')},${d.task === 'classify' ? 'label' : d.target}\n…`, ariaLabel: 'Paste CSV' });
    dataCard.append(el('h4', { textContent: 'Import / export (CSV)' }), ta, row(button('Load CSV', () => { const r = parseCsv(ta.value, d.task); if (!r.dataset) { status(r.problems[0] || 'Could not read that.'); return; } setDs({ ...r.dataset, features: r.dataset.features.map((f, i) => ({ ...f, ...(d.features[i]?.pin ? { pin: d.features[i].pin } : {}) })) }, { model: null, history: [] }); status(r.problems.length ? `Loaded ${r.dataset.samples.length} rows; skipped ${r.problems.length}: ${r.problems[0]}` : `Loaded ${r.dataset.samples.length} rows.`); }), button('Put my data in the box', () => { ta.value = toCsv(d); }), button('Clear samples', () => setDs({ ...d, samples: [] }, { model: null, history: [] }), 'danger'), button('Start over', () => setDs(null, { model: null, history: [] }), 'danger')));
    // list of recent samples
    if (d.samples.length) {
      const tbl = el('table', { className: 'ml-table' }), head = el('tr', {}, ...[...d.features.map(f => f.name), d.task === 'classify' ? 'label' : d.target, ''].map(h => el('th', { textContent: h })));
      tbl.append(head);
      d.samples.slice(-60).reverse().forEach(s => { const idx = d.samples.indexOf(s), x = el('button', { type: 'button', className: 'ml-btn icon', textContent: '✕', ariaLabel: 'Delete sample' }); x.addEventListener('click', () => setDs({ ...d, samples: d.samples.filter((_, k) => k !== idx) }, { model: null, history: [] }));
        tbl.append(el('tr', {}, ...s.x.map(v => el('td', { textContent: fmt(v) })), el('td', { textContent: d.task === 'classify' ? d.classes[s.y] : fmt(s.y) }), el('td', {}, x))); });
      dataCard.append(el('h4', { textContent: `${d.samples.length} samples${d.samples.length > 60 ? ' (latest 60 shown)' : ''}` }), el('div', { className: 'ml-scroll' }, tbl));
    }
    void m;
  }

  /** the current readings of the pins the inputs are tied to (null when the circuit is not running or an input has no pin) */
  function readBoard(d) {
    if (!sim?.running) return null; const snap = sim.snapshot?.(); if (!snap?.pins) return null;
    const x = d.features.map(f => { if (!f.pin) return NaN; const p = snap.pins.find(q => q.pin === f.pin); return p?.adc ?? NaN; });
    return x.every(Number.isFinite) ? x : null;
  }

  const lossCanvas = el('canvas', { className: 'ml-plot', width: 480, height: 200 });
  const trainMsg = el('p', { className: 'ml-note' });
  function renderTrain() {
    const d = ds(), m = getMl(); trainCard.replaceChildren(el('h3', { textContent: 'Train' }));
    if (!d) { trainCard.append(el('p', { className: 'ml-note', textContent: 'Choose or build a dataset first.' })); return; }
    const hid = el('input', { value: m.hidden.join(', '), ariaLabel: 'Hidden layers', className: 'ml-num' }), ep = el('input', { type: 'number', min: 1, max: 1000, value: m.epochs, className: 'ml-num', ariaLabel: 'Epochs' }), lr = el('input', { type: 'number', min: 0.001, max: 0.3, step: 0.005, value: m.lr, className: 'ml-num', ariaLabel: 'Learning rate' });
    const nm = el('input', { value: m.name, maxLength: 24, ariaLabel: 'Model name', className: 'ml-num' });
    const readHid = () => { const h = hid.value.split(/[ ,]+/).map(Number).filter(n => Number.isFinite(n) && n >= 1).slice(0, 3).map(n => Math.min(MAX_NEURONS, Math.round(n))); return h.length ? h : [8]; };
    const go = button(trainer ? 'Stop' : (m.model ? 'Train again' : 'Train'), () => (trainer ? stopTraining(true) : startTraining(readHid(), +ep.value || 150, +lr.value || 0.02)), 'primary');
    trainCard.append(
      el('div', { className: 'ml-form' }, el('label', {}, 'Hidden layers (neurons)', hid), el('label', {}, 'Epochs', ep), el('label', {}, 'Learning rate', lr)),
      el('p', { className: 'ml-note', textContent: 'A small network (8 neurons, or 12 and 6) is plenty for a few sensors, and fits on a microcontroller.' }),
      row(go, el('label', { className: 'ml-inline' }, 'Name in the sketch ', nm)), trainMsg, lossCanvas);
    nm.addEventListener('change', () => { const v = nm.value.trim(); if (/^[A-Za-z_][A-Za-z0-9_]{0,23}$/.test(v)) updateMl({ name: v }, 'name'); else { nm.value = getMl().name; status('Use letters, digits and _ (not starting with a digit).'); } });
    drawLoss(lossCanvas, trainer ? trainer.history : m.history, d.task);
    if (!trainer) trainMsg.textContent = summary();
  }
  function summary() {
    const m = getMl(), d = ds(); if (!m.model || !d) { const issue = problem(d); return issue || `${d?.samples.length ?? 0} samples ready.`; }
    const last = m.history[m.history.length - 1], ev = evaluate(m.model, d, validationIds(d));
    if (!ev) return 'Trained.';
    return d.task === 'classify' ? `Trained for ${last?.epoch ?? '?'} epochs. Held-out accuracy ${pct(ev.accuracy)} on ${ev.n} samples it never trained on.` : `Trained for ${last?.epoch ?? '?'} epochs. Average error ${fmt(ev.mae)} ${d.target} on ${ev.n} held-out samples.`;
  }
  const validationIds = d => { const n = d.samples.length; if (n < 10) return d.samples.map((_, i) => i); const t = createTrainer(d, { seed: 1 }); return t.valIds; };
  const problem = d => {
    if (!d || d.samples.length < 10) return `Add at least 10 samples (you have ${d?.samples.length ?? 0}).`;
    if (d.task === 'classify') { const few = d.classes.find((_, i) => d.samples.filter(s => s.y === i).length < 3); if (few) return `Each class needs at least 3 samples (“${few}” has fewer).`; }
    return '';
  };
  function startTraining(hidden, epochs, lr) {
    const d = ds(), issue = problem(d); if (issue) { trainMsg.textContent = issue; return; }
    updateMl({ hidden, epochs, lr }, 'settings');
    trainer = createTrainer(d, { hidden, lr, seed: 1 }); renderTrain(); trainMsg.textContent = 'Training…';
    const tick = () => {
      if (!trainer) return; const t0 = performance.now();
      while (trainer.epoch < epochs && performance.now() - t0 < 12) trainer.step(1);
      const h = trainer.history[trainer.history.length - 1]; trainMsg.textContent = `Epoch ${trainer.epoch} of ${epochs} · loss ${h ? h.loss.toFixed(3) : '–'}${d.task === 'classify' && h ? ` · accuracy ${pct(h.valAcc)}` : ''}`;
      drawLoss(lossCanvas, trainer.history, d.task);
      if (trainer.epoch >= epochs) stopTraining(false); else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  function stopTraining() {
    cancelAnimationFrame(raf); const t = trainer; trainer = null;
    if (t && t.history.length) updateMl({ model: JSON.parse(JSON.stringify(t.model)), history: t.history.slice() }, 'model');
    renderTrain();
  }

  /* ── plots ─────────────────────────────────────────── */
  const prep = (cv, w, h) => { const dpr = Math.min(2, globalThis.devicePixelRatio || 1), r = cv.getBoundingClientRect(); const W = Math.max(120, Math.round((r.width || w) )), H = Math.max(80, Math.round((r.height || h))); cv.width = W * dpr; cv.height = H * dpr; const c = cv.getContext('2d'); if (!c) return null; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H); return { c, W, H }; };
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
  function drawLoss(cv, hist, task) {
    const p = prep(cv, 480, 200); if (!p) return; const { c, W, H } = p, L = 40, B = 22, T = 8, R = 8;
    c.font = '11px system-ui'; c.fillStyle = css('--muted'); c.strokeStyle = css('--line');
    if (!hist.length) { c.fillText('The loss curve appears here while it trains.', L, H / 2); return; }
    const ys = hist.flatMap(h => [h.loss, h.valLoss]).filter(Number.isFinite), top = Math.max(...ys) * 1.05 || 1, n = Math.max(2, hist.length);
    const X = i => L + (i / (n - 1)) * (W - L - R), Y = v => T + (1 - v / top) * (H - T - B);
    c.beginPath(); c.moveTo(L, T); c.lineTo(L, H - B); c.lineTo(W - R, H - B); c.stroke();
    c.fillText(top.toFixed(2), 4, T + 8); c.fillText('0', 28, H - B); c.fillText(`epoch ${hist[hist.length - 1].epoch}`, W - 70, H - 6);
    const line = (key, col) => { c.beginPath(); let started = false; hist.forEach((h, i) => { const v = h[key]; if (!Number.isFinite(v)) return; if (!started) { c.moveTo(X(i), Y(v)); started = true; } else c.lineTo(X(i), Y(v)); }); c.strokeStyle = col; c.lineWidth = 2; c.stroke(); c.lineWidth = 1; };
    line('loss', COLORS[0]); line('valLoss', COLORS[1]);
    c.fillStyle = COLORS[0]; c.fillText('● training loss', L + 8, T + 12); c.fillStyle = COLORS[1]; c.fillText('● held-out loss', L + 100, T + 12);
    void task;
  }

  /* ── Run ───────────────────────────────────────────── */
  const runInputs = el('div', { className: 'ml-list' }), runOut = el('div', { className: 'ml-out' }), exportBox = el('div', { className: 'ml-card' });
  const runCard = el('div', { className: 'ml-card' }), runHead = el('h3', { textContent: 'Run the model' });
  secs.run.append(el('div', { className: 'ml-col' }, runCard), el('div', { className: 'ml-col' }, exportBox));
  let sliders = [];
  function renderRun() {
    const d = ds(), m = getMl().model; runCard.replaceChildren(runHead, runInputs, runOut); exportBox.replaceChildren(el('h3', { textContent: 'Put it on the board' }));
    runInputs.replaceChildren(); runOut.replaceChildren(); sliders = [];
    if (!d || !m) { runInputs.append(el('p', { className: 'ml-note', textContent: 'Train a model first (Train tab), then come back to try it here.' })); exportBox.append(el('p', { className: 'ml-note', textContent: 'Once a model is trained you can export it as a C header and add it to your sketch.' })); return; }
    const withPins = d.features.some(f => f.pin);
    if (withPins) { const c = el('input', { type: 'checkbox', checked: follow }); c.addEventListener('change', () => { follow = c.checked; }); runInputs.append(el('label', { className: 'ml-inline' }, c, ' Follow the circuit’s pins while it runs')); }
    d.features.forEach((f, i) => {
      const xs = d.samples.map(s => s.x[i]), lo = Math.min(...xs, m.mean[i] - 2 * m.std[i]), hi = Math.max(...xs, m.mean[i] + 2 * m.std[i]), mid = m.mean[i];
      const s = el('input', { type: 'range', min: Math.floor(lo), max: Math.ceil(hi), step: (hi - lo) > 50 ? 1 : 0.01, value: mid, ariaLabel: f.name }), o = el('span', { className: 'ml-val', textContent: fmt(mid) });
      s.addEventListener('input', () => { o.textContent = fmt(+s.value); showPrediction(); });
      sliders.push({ s, o, f }); runInputs.append(row(el('span', { className: 'ml-name', textContent: f.name + (f.pin ? ` (${f.pin})` : '') }), s, o));
    });
    showPrediction();
    const nm = getMl().name, pc = paramCount(m), maxW = Math.max(...m.sizes);
    const header = exportC(m, { name: nm }), sketch = exampleSketch(m, d, { name: nm });
    const ta = el('textarea', { className: 'ml-code', readOnly: true, rows: 12, value: header, ariaLabel: `${nm}.h` });
    exportBox.append(el('p', { className: 'ml-note', textContent: `${m.sizes.join(' → ')} network · ${pc} weights · about ${pc * 4} bytes of flash and ${(maxW * 2 + m.sizes[0] + m.sizes[m.sizes.length - 1]) * 4} bytes of RAM while it runs. Weights live in flash on AVR boards. The sketch calls ${nm}_predict() with the raw sensor readings.` }),
      row(button('Add model to sketch', () => addToSketch(header, nm), 'primary'), button('Use the example sketch', () => useExample(header, sketch, nm)), button('Copy header', async () => { try { await navigator.clipboard.writeText(header); status(`Copied ${nm}.h`); } catch { ta.select(); status('Select the text and copy it.'); } }), button(`Download ${nm}.h`, () => download(`${nm}.h`, header))),
      ta);
  }
  function showPrediction() {
    const d = ds(), m = getMl().model; if (!d || !m || !sliders.length) return;
    const x = sliders.map(({ s }) => +s.value), p = predict(m, x); runOut.replaceChildren();
    if (m.task === 'regress') { runOut.append(el('div', { className: 'ml-big', textContent: `${fmt(p[0])} ${m.target || ''}` })); return; }
    const best = p.indexOf(Math.max(...p)); runOut.append(el('div', { className: 'ml-big', textContent: m.classes[best], style: `color:${COLORS[best % COLORS.length]}` }));
    p.forEach((v, i) => runOut.append(el('div', { className: 'ml-bar' }, el('span', { className: 'ml-name', textContent: m.classes[i] }), el('span', { className: 'ml-track' }, el('span', { className: 'ml-fill', style: `width:${(v * 100).toFixed(1)}%;background:${COLORS[i % COLORS.length]}` })), el('span', { className: 'ml-val', textContent: pct(v) }))));
  }
  const download = (name, text) => { const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  const block = (header, nm) => `${BEGIN}\n${header.trimEnd()}\n${END}\n`;
  function addToSketch(header, nm) {
    let src = code.source; const re = new RegExp(`${BEGIN.replace(/[()]/g, '\\$&')}[\\s\\S]*?${END.replace(/[()]/g, '\\$&')}\\n?`);
    src = re.test(src) ? src.replace(re, block(header, nm)) : `${block(header, nm)}\n${src}`;
    code.source = src; status(`${nm}_predict() is now in your sketch. Call it from loop() with your sensor readings.`);
  }
  function useExample(header, sketch, nm) {
    if (code.source.trim() && !globalThis.confirm('Replace your sketch with the example that runs this model?')) return;
    code.source = `${block(header, nm)}\n${sketch.replace(/^#include "[^"]+"\n\n?/, '')}`; status('Sketch replaced with the model example. Press Run to see it classify the live pins.');
  }
  /** while the circuit runs, the sliders can follow the pins */
  function startLive() {
    clearInterval(liveTimer);
    liveTimer = setInterval(() => {
      if (view !== 'run' || !follow || !sliders.length) return; const d = ds(); const x = d && readBoard(d); if (!x) return;
      sliders.forEach(({ s, o }, i) => { s.value = x[i]; o.textContent = fmt(x[i]); }); showPrediction();
    }, 250);
  }

  /* ── Visualize ─────────────────────────────────────── */
  const vizLoss = el('canvas', { className: 'ml-plot' }), vizMap = el('canvas', { className: 'ml-plot tall' }), vizNet = el('canvas', { className: 'ml-plot' }), vizConf = el('div', { className: 'ml-conf' });
  const axX = el('select', { ariaLabel: 'Horizontal input' }), axY = el('select', { ariaLabel: 'Vertical input' });
  const mapBar = row(el('label', { className: 'ml-inline' }, 'Across ', axX), el('label', { className: 'ml-inline' }, ' Up ', axY));
  const vcol1 = el('div', { className: 'ml-col' }, card('Learning curve', vizLoss), card('Network (line width = weight size, blue positive, orange negative)', vizNet)), vcol2 = el('div', { className: 'ml-col' }, card('What the model decides', mapBar, vizMap), card('How it does on held-out samples', vizConf));
  secs.viz.append(vcol1, vcol2);
  axX.addEventListener('change', drawViz); axY.addEventListener('change', drawViz);
  function renderViz() {
    const d = ds(); const n = d?.features.length || 0;
    const fill = (sel, keep, other) => { const cur = keep ?? sel.value; sel.replaceChildren(...(d?.features || []).map((f, i) => el('option', { value: i, textContent: f.name, selected: String(i) === String(cur) }))); };
    fill(axX, axX.value && +axX.value < n ? axX.value : 0); fill(axY, axY.value && +axY.value < n && axY.value !== axX.value ? axY.value : (n > 1 ? 1 : 0));
    axY.hidden = n < 2; axY.parentElement.hidden = n < 2; drawViz();
  }
  function drawViz() {
    const d = ds(), mm = getMl(), m = mm.model; drawLoss(vizLoss, mm.history, d?.task);
    vizConf.replaceChildren(); const mp = prep(vizMap, 480, 300), np = prep(vizNet, 480, 200);
    if (!d || !m) { for (const p of [mp, np]) if (p) { p.c.fillStyle = css('--muted'); p.c.font = '12px system-ui'; p.c.fillText('Train a model to see this.', 12, 24); } return; }
    if (mp) drawMap(mp, d, m); if (np) drawNet(np, m);
    const ev = evaluate(m, d, validationIds(d));
    if (!ev) return;
    if (d.task === 'regress') { vizConf.append(el('p', { className: 'ml-note', textContent: `Average error ${fmt(ev.mae)} ${d.target}; typical miss (RMS) ${fmt(ev.rmse)} ${d.target}, over ${ev.n} samples.` })); return; }
    const t = el('table', { className: 'ml-table' }); t.append(el('tr', {}, el('th', { textContent: 'is ↓ / says →' }), ...m.classes.map(c => el('th', { textContent: c }))));
    ev.matrix.forEach((r, i) => t.append(el('tr', {}, el('th', { textContent: m.classes[i] }), ...r.map((v, j) => { const td = el('td', { textContent: v }); if (v) td.style.background = i === j ? 'rgba(31,157,85,.22)' : 'rgba(207,61,52,.25)'; return td; }))));
    vizConf.append(el('p', { className: 'ml-note', textContent: `${pct(ev.accuracy)} right on ${ev.n} samples the model did not train on.` }), t);
  }
  function drawMap({ c, W, H }, d, m) {
    const xi = +axX.value || 0, yi = d.features.length > 1 ? (+axY.value || 0) : -1, xs = d.samples.map(s => s.x[xi]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), padx = (x1 - x0) * 0.06 || 1, L = 40, B = 24, T = 8, R = 8, w = W - L - R, h = H - T - B;
    const rx = [x0 - padx, x1 + padx];
    c.font = '11px system-ui';
    const base = m.mean.slice();
    if (yi < 0 || yi === xi) {                                                  // one input: the model's output along it
      const pts = []; for (let k = 0; k <= 80; k++) { const x = rx[0] + (rx[1] - rx[0]) * k / 80; base[xi] = x; pts.push([x, predict(m, base)]); }
      if (m.task === 'regress') {
        const ys = [...d.samples.map(s => s.y), ...pts.map(p => p[1][0])], y0 = Math.min(...ys), y1 = Math.max(...ys), Y = v => T + (1 - (v - y0) / (y1 - y0 || 1)) * h, X = v => L + (v - rx[0]) / (rx[1] - rx[0]) * w;
        c.fillStyle = 'rgba(29,99,237,.45)'; d.samples.forEach(s => { c.beginPath(); c.arc(X(s.x[xi]), Y(s.y), 2.4, 0, 7); c.fill(); });
        c.beginPath(); pts.forEach(([x, p], k) => (k ? c.lineTo(X(x), Y(p[0])) : c.moveTo(X(x), Y(p[0])))); c.strokeStyle = COLORS[1]; c.lineWidth = 2.5; c.stroke(); c.lineWidth = 1;
        c.fillStyle = css('--muted'); c.fillText(fmt(y1), 4, T + 8); c.fillText(fmt(y0), 4, H - B); c.fillText(d.features[xi].name, L + w / 2 - 20, H - 6);
      } else {
        const X = v => L + (v - rx[0]) / (rx[1] - rx[0]) * w;
        m.classes.forEach((_, k) => { c.beginPath(); pts.forEach(([x, p], i) => (i ? c.lineTo(X(x), T + (1 - p[k]) * h) : c.moveTo(X(x), T + (1 - p[k]) * h))); c.strokeStyle = COLORS[k % COLORS.length]; c.lineWidth = 2.5; c.stroke(); });
        c.lineWidth = 1; c.fillStyle = css('--muted'); c.fillText('1', 28, T + 8); c.fillText('0', 28, H - B); c.fillText(`${d.features[xi].name}: probability of each class`, L + 6, H - 6);
      }
      return;
    }
    const ys = d.samples.map(s => s.x[yi]), y0 = Math.min(...ys), y1 = Math.max(...ys), pady = (y1 - y0) * 0.06 || 1, ry = [y0 - pady, y1 + pady], N = 56;
    const cw = w / N, ch = h / N;
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
      base[xi] = rx[0] + (rx[1] - rx[0]) * (a + 0.5) / N; base[yi] = ry[1] - (ry[1] - ry[0]) * (b + 0.5) / N; const p = predict(m, base);
      if (m.task === 'classify') { const k = p.indexOf(Math.max(...p)); c.fillStyle = COLORS[k % COLORS.length]; c.globalAlpha = 0.16 + 0.24 * p[k]; } else { c.fillStyle = COLORS[1]; c.globalAlpha = 0.5 * Math.max(0, Math.min(1, (p[0] - m.ym + 2 * m.ys) / (4 * m.ys))); }
      c.fillRect(L + a * cw, T + b * ch, cw + 0.6, ch + 0.6);
    }
    c.globalAlpha = 1;
    for (const s of d.samples) { const px = L + (s.x[xi] - rx[0]) / (rx[1] - rx[0]) * w, py = T + (ry[1] - s.x[yi]) / (ry[1] - ry[0]) * h; c.beginPath(); c.arc(px, py, 2.8, 0, 7); c.fillStyle = d.task === 'classify' ? COLORS[s.y % COLORS.length] : '#223'; c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 0.8; c.stroke(); }
    c.lineWidth = 1; c.fillStyle = css('--muted'); c.fillText(d.features[xi].name, L + w / 2 - 12, H - 6); c.save(); c.translate(11, T + h / 2 + 14); c.rotate(-Math.PI / 2); c.fillText(d.features[yi].name, 0, 0); c.restore();
    if (d.task === 'classify') d.classes.forEach((cl, k) => { c.fillStyle = COLORS[k % COLORS.length]; c.fillText(`● ${cl}`, L + 6 + k * 78, T + 12); });
  }
  function drawNet({ c, W, H }, m) {
    const cols = m.sizes.length, X = i => 60 + (W - 120) * (cols === 1 ? 0 : i / (cols - 1)), pos = m.sizes.map((n, l) => Array.from({ length: n }, (_, k) => [X(l), 14 + (H - 28) * (n === 1 ? 0.5 : k / (n - 1))]));
    let mx = 0; m.layers.forEach(L => L.W.forEach(r => r.forEach(v => { mx = Math.max(mx, Math.abs(v)); })));
    m.layers.forEach((L, l) => L.W.forEach((row2, k) => row2.forEach((v, j) => { c.beginPath(); c.moveTo(...pos[l][j]); c.lineTo(...pos[l + 1][k]); c.strokeStyle = v >= 0 ? 'rgba(29,99,237,.55)' : 'rgba(224,98,43,.55)'; c.lineWidth = 0.4 + 3.2 * Math.abs(v) / (mx || 1); c.stroke(); })));
    c.lineWidth = 1; c.font = '11px system-ui';
    pos.forEach((col, l) => col.forEach(([x, y], k) => { c.beginPath(); c.arc(x, y, 6, 0, 7); c.fillStyle = css('--surface'); c.fill(); c.strokeStyle = css('--text'); c.stroke();
      c.fillStyle = css('--muted'); if (l === 0) c.fillText(m.features[k] || '', 2, y + 4); if (l === cols - 1) c.fillText(m.task === 'classify' ? m.classes[k] : (m.target || 'value'), x + 10, y + 4); }));
  }

  /* ── switching views ───────────────────────────────── */
  function show(v) {
    if (v !== 'train' && trainer) stopTraining(false);
    view = v;
    for (const [id] of VIEWS) { btn[id].classList.toggle('on', id === v); btn[id].setAttribute('aria-pressed', String(id === v)); }
    pane.hidden = v === 'circuit'; document.body.classList.toggle('ml-view', v !== 'circuit');
    for (const id of ['train', 'run', 'viz']) secs[id].hidden = id !== v;
    if (v === 'train') { renderData(); renderTrain(); } else if (v === 'run') renderRun(); else if (v === 'viz') renderViz();
  }
  onMl((_, why) => { if (view === 'circuit') return; if (why === 'load') { show(view); return; } if (why === 'data' && view === 'train') { renderData(); renderTrain(); } else if (view === 'train' && why === 'model') { /* stopTraining re-renders */ } else if (view === 'run' && why !== 'settings') renderRun(); else if (view === 'viz') renderViz(); });
  addEventListener('resize', () => { if (view === 'viz') drawViz(); else if (view === 'train') drawLoss(lossCanvas, trainer ? trainer.history : getMl().history, ds()?.task); });

  /** Only workspaces that ask for it (AI boards) get the tabs; elsewhere the circuit editor is the only view. */
  function sync() {
    const on = !!activeWorkspace().ml;
    toggle.hidden = !on; sepAfter.hidden = !on;
    if (!on && view !== 'circuit') show('circuit');
    if (on && !Object.values(btn).some(b => b.classList.contains('on'))) btn.circuit.classList.add('on');
  }
  editor.on('catalog', sync); editor.on('workspace', sync); startLive(); sync();
  return { show, sync };
}
