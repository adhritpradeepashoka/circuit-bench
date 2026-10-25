// Synthetic biosignals for the Bioelectronics workspace: what a pair of electrodes would pick up, as a voltage over time.
// These are ILLUSTRATIVE waveforms (a textbook-shaped ECG, bursty EMG noise, rhythmic EEG, stepping EOG), not measurements —
// the app says so wherever they appear. Pure functions of time, so the same moment always gives the same voltage.

export const SIGNAL_KINDS = [
  ['ecg', 'ECG — heartbeat (about 1 mV)'],
  ['emg', 'EMG — muscle activity (bursts, up to ~2 mV)'],
  ['eeg', 'EEG — brain rhythms (tens of µV)'],
  ['eog', 'EOG — eye movement (steps, ~0.5 mV)'],
  ['sine', 'Test sine, 10 Hz (1 mV)'],
];
import { SITE, siteSignal } from './body-sites.js';
import { subject as liveSubject } from './subject.js';
export const MAINS_HZ = 50;           // India (and most of the world)

const g = (x, mu, sd) => Math.exp(-0.5 * ((x - mu) / sd) ** 2);
/** Deterministic pseudo-noise in [-1, 1] for sample number n (so a replay is identical). */
const noise = n => { let h = Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b; h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15; return ((h >>> 0) / 4294967295) * 2 - 1; };
/** Linearly-smoothed noise at a given rate (Hz) — band-limits the hiss a little. */
const smoothNoise = (t, rate) => { const x = t * rate, i = Math.floor(x), f = x - i; return noise(i) * (1 - f) + noise(i + 1) * f; };

/** One heartbeat: P, Q, R, S, T as Gaussians, phase 0..1 within the beat. Volts, R peak ≈ 1 mV. */
export function ecgBeat(phase) {
  return 0.00012 * g(phase, 0.16, 0.025) - 0.00015 * g(phase, 0.285, 0.008) + 0.001 * g(phase, 0.31, 0.011) - 0.00025 * g(phase, 0.335, 0.009) + 0.00030 * g(phase, 0.55, 0.045);
}

/** The signal (volts) between the two electrodes at time t (seconds) for a signal-source part's settings. */
export function signalAt(p, t) {
  const kind = p.signal || 'ecg', scale = Math.max(0, (p.scale ?? 100) / 100);
  let v = 0;
  if (SITE[p.sp] && SITE[p.sn]) v = siteSignal(p.sp, p.sn, t, { effort: p.effort ?? 50, subject: liveSubject });     // electrodes placed on the head model: the signal depends on where
  else if (kind === 'ecg') {
    const period = 60 / Math.max(20, Math.min(220, p.bpm ?? 70)), ph = (t % period) / period;
    v = ecgBeat(ph) + 0.00004 * Math.sin(2 * Math.PI * 0.25 * t);               // + slow breathing sway
  } else if (kind === 'emg') {
    const effort = Math.max(0, Math.min(1, (p.effort ?? 50) / 100));
    v = 0.002 * effort * smoothNoise(t, 1500);
  } else if (kind === 'eeg') {
    v = 0.000020 * Math.sin(2 * Math.PI * 10 * t) + 0.000008 * Math.sin(2 * Math.PI * 20 * t + 1) + 0.000010 * smoothNoise(t, 300);
  } else if (kind === 'eog') {
    const k = Math.floor(t / 2.5), up = noise(k * 7 + 3) > 0 ? 1 : -1, f = Math.min(1, (t - k * 2.5) / 0.12);
    v = 0.0005 * up * (f < 1 ? f : 1) * (1 - (t - k * 2.5) / 2.5 * 0.4);
  } else v = 0.001 * Math.sin(2 * Math.PI * 10 * t);
  v *= scale;
  // mains pickup: shows up as a difference only when an electrode's contact is poor (unequal skin resistance)
  const contactK = Math.max(0, p.contact ?? 5), hum = Math.max(0, Math.min(1, (p.hum ?? 0) / 100));
  v += 0.0005 * hum * Math.min(4, contactK / 25) * Math.sin(2 * Math.PI * MAINS_HZ * t);
  return v;
}
