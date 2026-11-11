// The machine-learning work of the open project (AI boards workspace): its dataset, training settings and trained model. One place holds it;
// the project record keeps it (src/ui/projects.js), and the Train / Run / Visualize tabs read and write it here.
import { cleanDataset } from './ml.js';

const blank = () => ({ dataset: null, hidden: [8], epochs: 150, lr: 0.02, model: null, history: [], name: 'model' });
let state = blank(); const listeners = [];

const cleanModel = (m, ds) => {
  if (!m || !Array.isArray(m.layers) || !Array.isArray(m.sizes) || !ds) return null;
  const ok = m.layers.length === m.sizes.length - 1 && m.sizes[0] === ds.features.length && m.layers.every((L, l) => Array.isArray(L.W) && L.W.length === m.sizes[l + 1] && L.W.every(r => Array.isArray(r) && r.length === m.sizes[l] && r.every(Number.isFinite)) && Array.isArray(L.b) && L.b.length === m.sizes[l + 1] && L.b.every(Number.isFinite));
  const outs = ds.task === 'classify' ? ds.classes.length : 1;
  if (!ok || m.task !== ds.task || m.sizes[m.sizes.length - 1] !== outs || !Array.isArray(m.mean) || m.mean.length !== m.sizes[0] || !Array.isArray(m.std) || m.std.length !== m.sizes[0] || !m.mean.every(Number.isFinite) || !m.std.every(v => Number.isFinite(v) && v > 0)) return null;
  return { task: m.task, sizes: m.sizes.slice(), layers: m.layers.map(L => ({ W: L.W.map(r => r.slice()), b: L.b.slice() })), mean: m.mean.slice(), std: m.std.slice(), ym: Number.isFinite(m.ym) ? m.ym : 0, ys: Number.isFinite(m.ys) && m.ys > 0 ? m.ys : 1, classes: ds.classes, features: ds.features.map(f => f.name), target: ds.target };
};
export function cleanMl(raw) {
  const out = blank(); if (!raw || typeof raw !== 'object') return out;
  out.dataset = raw.dataset ? cleanDataset(raw.dataset) : null;
  if (Array.isArray(raw.hidden)) out.hidden = raw.hidden.slice(0, 3).map(n => Math.max(1, Math.min(32, Math.round(+n) || 8)));
  if (out.hidden.length === 0) out.hidden = [8];
  out.epochs = Math.max(1, Math.min(1000, Math.round(+raw.epochs) || 150)); out.lr = Math.max(0.001, Math.min(0.3, +raw.lr || 0.02));
  out.model = cleanModel(raw.model, out.dataset);
  out.history = out.model && Array.isArray(raw.history) ? raw.history.slice(-1000).filter(h => h && Number.isFinite(h.epoch) && Number.isFinite(h.loss)).map(h => ({ epoch: h.epoch, loss: h.loss, acc: Number.isFinite(h.acc) ? h.acc : NaN, valLoss: Number.isFinite(h.valLoss) ? h.valLoss : NaN, valAcc: Number.isFinite(h.valAcc) ? h.valAcc : NaN })) : [];
  out.name = /^[A-Za-z_][A-Za-z0-9_]{0,23}$/.test(raw.name || '') ? raw.name : 'model';
  return out;
}
export const getMl = () => state;
export const hasMl = () => !!(state.dataset && state.dataset.samples.length) || !!state.model;
export function setMl(raw) { state = cleanMl(raw); listeners.slice().forEach(fn => fn(state, 'load')); }
/** change part of the state in place and tell the tabs ('data', 'model', ...) */
export function updateMl(patch, why = 'edit') { Object.assign(state, patch); listeners.slice().forEach(fn => fn(state, why)); onSave?.(); }
export const onMl = fn => { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn) >>> 0, 1); };
let onSave = null; export const onMlSave = fn => { onSave = fn; };
/** what a project file keeps: nothing for a project that has no ML work */
export const exportMl = () => (hasMl() ? JSON.parse(JSON.stringify({ ...state, model: state.model, history: state.history.map(h => ({ ...h, acc: Number.isFinite(h.acc) ? h.acc : null, valAcc: Number.isFinite(h.valAcc) ? h.valAcc : null, valLoss: Number.isFinite(h.valLoss) ? h.valLoss : null })) })) : undefined);
