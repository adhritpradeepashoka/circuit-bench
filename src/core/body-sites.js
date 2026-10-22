// Electrode sites on a head, and a simplified model of what each one picks up. Used by the Bioelectronics visualizer:
// the student drags the E+ / E− / REF electrodes of a "body" onto these sites and the simulated signal between them
// changes accordingly. DOM-free; the 3D view just draws these positions.
//
// ILLUSTRATIVE ONLY: amplitudes and polarities follow textbook patterns (alpha is strongest at the back of the head,
// blinks show at the forehead, a gaze to the right makes the right eye's outer edge positive, jaw muscle shows at the
// cheek and temple), but they are not measurements and not for medical use.

const D = Math.PI / 180;
/** Head frame: x = right ear, y = nose, z = crown. The skull is an ellipsoid with these radii (1 unit ≈ 10 cm × 0.8). */
export const HEAD_RADII = { x: 0.78, y: 0.95, z: 0.95 };

/** A surface point from a polar angle θ away from the crown and an azimuth φ clockwise from the nose (degrees). */
export function surfacePoint(theta, phi) {
  const t = theta * D, p = phi * D;
  const d = { x: Math.sin(t) * Math.sin(p), y: Math.sin(t) * Math.cos(p), z: Math.cos(t) };
  return { x: HEAD_RADII.x * d.x, y: HEAD_RADII.y * d.y, z: HEAD_RADII.z * d.z };
}

// group: which part of the menu the site belongs to. w: how strongly it picks up each source.
//   a = alpha/beta brain rhythm, b = blink, h = horizontal gaze, v = vertical gaze, m = muscle
const S = (id, name, group, theta, phi, w) => ({ id, name, group, theta, phi, w: { a: 0, b: 0, h: 0, v: 0, m: 0, ...w } });
export const SITES = [
  S('Fp1', 'Fp1 (forehead, left)', 'EEG', 72, -18, { a: 0.25, b: 1, h: 0.1, m: 0.3 }), S('Fp2', 'Fp2 (forehead, right)', 'EEG', 72, 18, { a: 0.25, b: 1, h: 0.1, m: 0.3 }),
  S('F7', 'F7 (front, left temple)', 'EEG', 72, -54, { a: 0.3, b: 0.35, h: -0.35, m: 0.4 }), S('F3', 'F3 (front, left)', 'EEG', 46, -45, { a: 0.35, b: 0.4, m: 0.1 }),
  S('Fz', 'Fz (front, middle)', 'EEG', 36, 0, { a: 0.4, b: 0.4, m: 0.1 }), S('F4', 'F4 (front, right)', 'EEG', 46, 45, { a: 0.35, b: 0.4, m: 0.1 }),
  S('F8', 'F8 (front, right temple)', 'EEG', 72, 54, { a: 0.3, b: 0.35, h: 0.35, m: 0.4 }),
  S('T3', 'T3 (above left ear)', 'EEG', 72, -90, { a: 0.4, m: 0.7 }), S('C3', 'C3 (centre, left)', 'EEG', 36, -90, { a: 0.4 }),
  S('Cz', 'Cz (top of head)', 'EEG', 0, 0, { a: 0.45 }), S('C4', 'C4 (centre, right)', 'EEG', 36, 90, { a: 0.4 }), S('T4', 'T4 (above right ear)', 'EEG', 72, 90, { a: 0.4, m: 0.7 }),
  S('P3', 'P3 (back, left)', 'EEG', 46, -135, { a: 0.7 }), S('Pz', 'Pz (back, middle)', 'EEG', 36, 180, { a: 0.75 }), S('P4', 'P4 (back, right)', 'EEG', 46, 135, { a: 0.7 }),
  S('O1', 'O1 (back of head, left)', 'EEG', 72, -162, { a: 1 }), S('O2', 'O2 (back of head, right)', 'EEG', 72, 162, { a: 1 }),
  S('A1', 'A1 (left mastoid, behind the ear)', 'Reference', 104, -98, { a: 0.03 }), S('A2', 'A2 (right mastoid, behind the ear)', 'Reference', 104, 98, { a: 0.03 }),
  S('EOG-L', 'Left eye, outer corner', 'EOG', 94, -40, { h: -1, b: 0.3, m: 0.05 }), S('EOG-R', 'Right eye, outer corner', 'EOG', 94, 40, { h: 1, b: 0.3, m: 0.05 }),
  S('EOG-U', 'Above the right eye', 'EOG', 82, 22, { v: 1, b: 0.9, m: 0.15 }), S('EOG-D', 'Below the right eye', 'EOG', 108, 22, { v: -1, b: -0.2, m: 0.1 }),
  S('EMG-F', 'Forehead (frontalis muscle)', 'EMG', 62, 0, { b: 0.5, m: 1 }),
  S('EMG-ML', 'Left cheek (masseter, jaw muscle)', 'EMG', 112, -78, { m: 1 }), S('EMG-MR', 'Right cheek (masseter, jaw muscle)', 'EMG', 112, 78, { m: 1 }),
];
export const SITE = Object.fromEntries(SITES.map(s => [s.id, s]));
export const SITE_GROUPS = ['EEG', 'EOG', 'EMG', 'Reference'];
export const sitePosition = id => (SITE[id] ? surfacePoint(SITE[id].theta, SITE[id].phi) : null);

/* ── a little deterministic noise ── */
const hash = n => { let h = Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b; h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15; return ((h >>> 0) / 4294967295) * 2 - 1; };
const smooth = (t, rate, seed = 0) => { const x = t * rate, i = Math.floor(x), f = x - i; return hash(i + seed * 7919) * (1 - f) + hash(i + 1 + seed * 7919) * f; };
const bump = (t, t0, w) => Math.exp(-0.5 * ((t - t0) / w) ** 2);

/** The body-wide sources at time t, each roughly in volts at weight 1. They are shared by every site, scaled by its weights. */
export function sources(t, { effort = 50 } = {}) {
  // Blink: a short positive spike every ~4 s. Gaze: steps left/right and up/down every 2.5 s.
  const kb = Math.floor(t / 4.1), tb = kb * 4.1 + 1.3 + 0.8 * (hash(kb * 13 + 1) + 1) / 2;
  const blink = 0.00018 * bump(t, tb, 0.07);
  const kg = Math.floor(t / 2.5), ph = Math.min(1, (t - kg * 2.5) / 0.1), decay = 1 - ((t - kg * 2.5) / 2.5) * 0.25;
  const h = (hash(kg * 7 + 3) > 0 ? 1 : -1) * 0.0004 * ph * decay, v = hash(kg * 11 + 5) * 0.00012 * ph;
  const alpha = 0.000030 * Math.sin(2 * Math.PI * 10 * t) * (0.65 + 0.35 * Math.sin(2 * Math.PI * 0.3 * t));      // waxes and wanes
  const beta = 0.000009 * Math.sin(2 * Math.PI * 21 * t + 1) + 0.000008 * smooth(t, 300, 3);
  // Muscle: bursts of broadband noise, strength set by the effort slider.
  const emg = 0.002 * Math.max(0, Math.min(1, effort / 100)) * smooth(t, 1500, 5);
  return { alpha, beta, blink, h, v, emg };
}

/** What one site picks up at time t, in volts, relative to the body's zero. */
export function siteVoltage(id, t, opts) {
  const s = SITE[id]; if (!s) return 0;
  const x = sources(t, opts), w = s.w;
  // a little extra variety so two different sites are never identical copies: each has its own slow phase and hiss
  const k = SITES.indexOf(s) + 1;
  const brain = w.a * (x.alpha * Math.cos(k * 0.9) + x.beta) + 0.000004 * smooth(t, 200, k) * (w.a > 0.1 ? 1 : 0.2);
  return brain + w.b * x.blink + w.h * x.h + w.v * x.v + w.m * x.emg * (0.7 + 0.3 * Math.cos(k));
}

/** The signal between electrode sites `pos` and `neg` (volts). An unplaced electrode reads 0, like a loose lead. */
export function siteSignal(pos, neg, t, opts) { return siteVoltage(pos, t, opts) - siteVoltage(neg, t, opts); }

/** A one-line reading of the montage for the panel. */
export function describeMontage(pos, neg, ref) {
  const n = id => SITE[id]?.name || '—';
  if (!pos || !neg) return 'Drag E+ and E− onto the head. Until both are placed, the source uses its own settings.';
  const g = id => SITE[id]?.group;
  let what = 'a mix of brain, eye and muscle activity';
  if ([pos, neg].every(i => g(i) === 'EEG' || g(i) === 'Reference') && ![pos, neg].some(i => /^Fp|^F7|^F8/.test(i))) what = 'mostly brain rhythm (EEG)';
  else if ([pos, neg].some(i => g(i) === 'EOG')) what = 'mostly eye movement (EOG)';
  else if ([pos, neg].some(i => g(i) === 'EMG')) what = 'mostly muscle (EMG)';
  return `E+ ${n(pos)} · E− ${n(neg)}${ref ? ` · REF ${n(ref)}` : ''} — expect ${what}.`;
}
