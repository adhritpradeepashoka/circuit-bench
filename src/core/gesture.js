// Gestures from muscle signals: the features a classifier sees (how strong each channel is over a short window), a way to collect examples of a
// gesture from the simulated person, and a small trained network that says which gesture it is. The network and trainer are src/core/ml.js; this
// file only turns signals into a dataset. ILLUSTRATIVE signals, so the result is a teaching demo and not a medical device.
import { signalAt } from './signals.js';
import { neutralSubject } from './subject.js';
import { channelLabel } from './mix-context.js';
import { createTrainer, predict, evaluate } from './ml.js';

/** The gestures a new project starts with: what the person does (a held muscle event, or nothing) and the elbow bend that gesture stands for (0..1). */
export const defaultGestures = () => [{ name: 'Rest', ev: '', bend: 0 }, { name: 'Flex arm', ev: 'flexR', bend: 1 }, { name: 'Fist', ev: 'fistR', bend: 0.25 }];
/** What a person can be asked to do while recording. */
export const GESTURE_ACTIONS = { '': 'Nothing (relax)', flexR: 'Flex right arm', flexL: 'Flex left arm', fistR: 'Fist, right hand', fistL: 'Fist, left hand', jaw: 'Clench jaw', brow: 'Raise eyebrows' };

export const WINDOW = 0.25;       // seconds of signal behind each feature
/** One feature per channel: the RMS of its signal over the last window, in mV. A channel with no electrodes placed reads 0. */
export function windowFeatures(chs, t, subject, win = WINDOW, n = 50) {
  return chs.map(p => {
    if (!(p.sp && p.sn)) return 0;
    let e = 0; for (let k = 0; k < n; k++) { const v = signalAt(p, t - win + (k / n) * win, subject); e += v * v; }
    return Math.sqrt(e / n) * 1000;
  });
}
export const featureNames = chs => chs.map((p, i) => `${channelLabel(p, i).slice(0, 20).trim()} RMS`);

/** Collect `count` examples of a gesture from a simulated person doing it (a held `ev`, or nothing), at random moments. */
export function sampleGesture(chs, ev, count = 30, seed = 1) {
  const out = []; let s = seed * 7919;
  for (let i = 0; i < count; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const subject = { ...neutralSubject(), holds: ev ? [ev] : [], autoBlink: true }, t = 2 + (s % 60000) / 1000;
    out.push(windowFeatures(chs, t, subject));
  }
  return out;
}

/** A dataset from gestures with their samples: classes are the gesture names. */
export function gestureDataset(chs, gestures, samplesBy) {
  const features = featureNames(chs).map(name => ({ name })), samples = [];
  gestures.forEach((g, y) => { for (const x of samplesBy[y] || []) if (x.length === features.length) samples.push({ x, y }); });
  return { task: 'classify', features, classes: gestures.map(g => g.name.slice(0, 24)), target: null, samples };
}

/** Why training cannot start yet, or ''. */
export function trainProblem(ds) {
  if (!ds || ds.classes.length < 2) return 'Add at least two gestures.';
  const counts = ds.classes.map((_, i) => ds.samples.filter(s => s.y === i).length), low = counts.findIndex(n => n < 5);
  if (low >= 0) return `Record “${ds.classes[low]}” first (at least 5 examples of every gesture).`;
  return '';
}

/** Train to the end (small data: a fraction of a second). Returns { model, history, accuracy, matrix }. */
export function trainGesture(ds, { hidden = [8], epochs = 120, lr = 0.03 } = {}) {
  const tr = createTrainer(ds, { hidden, lr }); tr.step(epochs);
  const ev = evaluate(tr.model, ds, tr.valIds.length ? tr.valIds : undefined);
  return { model: JSON.parse(JSON.stringify(tr.model)), history: tr.history.slice(), accuracy: ev?.accuracy ?? NaN, matrix: ev?.matrix };
}

/** Which gesture the features look like: { index, p (its probability), probs }. */
export function recognise(model, x) {
  if (!model || model.sizes[0] !== x.length) return null;
  const probs = predict(model, x), index = probs.indexOf(Math.max(...probs));
  return { index, p: probs[index], probs };
}
