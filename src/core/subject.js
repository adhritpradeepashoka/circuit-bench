// The "subject" of the Bioelectronics workbench: a simulated person whose state you can change while the signals run — focused or drowsy,
// looking left, blinking, clenching the jaw, twitching a cheek. Electrode placement then decides what each channel picks up.
// Pure data plus a few small functions of time, so a replay gives the same voltages. ILLUSTRATIVE, like the rest of the model.

/** How long each event lasts, in seconds. */
export const EVENT_KINDS = {
  blink: { dur: 0.4, label: 'Blink' },
  jaw: { dur: 2.2, label: 'Clench jaw' },
  twitchL: { dur: 0.3, label: 'Twitch left cheek' },
  twitchR: { dur: 0.3, label: 'Twitch right cheek' },
  brow: { dur: 1.2, label: 'Raise eyebrows' },
};
export const MINDS = { relaxed: 'Relaxed, eyes closed', focused: 'Focused', drowsy: 'Drowsy' };
/** Gaze targets as [horizontal, vertical] in units of a full glance. 'auto' = the subject glances about on its own. */
export const GAZES = { auto: null, center: [0, 0], left: [-1, 0], right: [1, 0], up: [0, 1], down: [0, -1] };
/** How strongly each mental state scales each brain rhythm. */
export const MIND_RHYTHMS = { relaxed: { alpha: 1, beta: 1, theta: 0 }, focused: { alpha: 0.35, beta: 2.4, theta: 0 }, drowsy: { alpha: 0.6, beta: 0.6, theta: 1 } };

/** A neutral subject: the behaviour the workbench always had (random blinks and glances, relaxed). */
export const neutralSubject = () => ({ mind: 'relaxed', autoBlink: true, gaze: { to: 'auto', from: 'auto', t0: -1e9 }, events: [] });

const smoothstep = x => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };
/** The strength (0..1) of an event at time t: quick rise, hold, quick fall. */
export function envelope(ev, t) {
  const k = EVENT_KINDS[ev.type]; if (!k) return 0; const a = t - ev.t0; if (a < 0 || a > k.dur) return 0;
  const rise = ev.type === 'blink' ? 0.05 : ev.type.startsWith('twitch') ? 0.04 : 0.12, fall = ev.type === 'blink' ? 0.25 : 0.2;
  return smoothstep(a / rise) * smoothstep((k.dur - a) / fall);
}
/** How much of each event is active at time t, summed over the events fired so far. */
export function eventLevels(subject, t) {
  const L = { blink: 0, jaw: 0, twitchL: 0, twitchR: 0, brow: 0 };
  for (const ev of subject.events || []) if (ev.type in L) L[ev.type] = Math.min(1.5, L[ev.type] + envelope(ev, t));
  return L;
}
/** Where the eyes are pointing at time t: [h, v] in glance units, easing to a new target in ~0.12 s. null while the subject is in 'auto'. */
export function gazeAt(subject, t) {
  const g = subject.gaze; if (!g || g.to === 'auto') return null;
  const to = GAZES[g.to] || [0, 0], from = GAZES[g.from] || [0, 0], f = smoothstep((t - g.t0) / 0.12);
  return [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f];
}

/** The live subject the app shares (the sliders, the simulation and the traces all read it). */
export const subject = {
  ...neutralSubject(), simNow: null,
  /** Time on the clock the signals use: the simulation's own clock while it runs, otherwise the wall clock. */
  now() { return this.simNow != null ? this.simNow : performance.now() / 1000; },
  fire(type) { if (!(type in EVENT_KINDS)) return; const t = this.now(); this.events = this.events.filter(e => t - e.t0 < 12); this.events.push({ type, t0: t }); },
  look(dir) { if (!(dir in GAZES)) return; const t = this.now(); this.gaze = { from: this.gaze.to === 'auto' ? 'center' : this.gaze.to, to: dir, t0: t }; },
  setMind(m) { if (m in MIND_RHYTHMS) this.mind = m; },
  reset() { Object.assign(this, neutralSubject()); },
};
