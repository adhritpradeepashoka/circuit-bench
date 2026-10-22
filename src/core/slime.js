// A slime mold (Physarum polycephalum) laid over an electrode grid. The organism is a few lobes joined by veins; where a lobe
// covers an electrode pad, that pad picks up the organism's electrical rhythm: a slow oscillation (about a minute per cycle) that
// travels outward from a pacemaker lobe, so pads further along see it later — the surface-potential waves recorded from real
// Physarum. Pads the organism does not cover only see a little electrode noise. Pure functions of time, so a replay is identical.
//
// ILLUSTRATIVE: the amplitude (a few mV), period and wave shape follow published recordings in general terms; they are a model for
// teaching and demos, not data from a real culture.

export const MM_TO_PX = 96 / 25.4;
/** The organism's footprint: lobes (x, y, radius in mm, from the centre of the part). The first lobe is the pacemaker. */
export const LOBES = [
  { x: -18, y: -12, r: 14 }, { x: 0, y: 0, r: 22 }, { x: 20, y: -8, r: 14 }, { x: -12, y: 20, r: 15 }, { x: 17, y: 21, r: 12 }, { x: 4, y: -30, r: 10 }, { x: 31, y: 6, r: 8 },
];
export const SLIME_DEFAULTS = { mperiod: 60, mamp: 1.2, mspeed: 1, mstim: 0, mnoise: 40 };
const WAVELENGTH_MM = 90;

const hash = n => { let h = Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b; h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15; return ((h >>> 0) / 4294967295) * 2 - 1; };
const smooth = (t, rate, seed) => { const x = t * rate, i = Math.floor(x), f = x - i; return hash(i + seed * 7919) * (1 - f) + hash(i + 1 + seed * 7919) * f; };

/** How much of the organism sits over (x, y) mm from its centre: 1 inside a lobe, 0 outside, soft at the rim. */
export function coverage(x, y) {
  let c = 0;
  for (const l of LOBES) c = Math.max(c, 1 / (1 + Math.exp((Math.hypot(x - l.x, y - l.y) - l.r) / (0.16 * l.r))));
  return c;
}

/**
 * The potential (volts, relative to the bath) of each tap at time t seconds. `taps[i].pads` are the tap's pads, in mm from the
 * organism's centre (already turned into the organism's own frame). A tap with several pads reads their average, as its pads are one net.
 */
export function slimePotentials(taps, p, t) {
  const o = { ...SLIME_DEFAULTS, ...p };
  const stim = Math.max(-1, Math.min(1, (o.mstim || 0) / 100));                // + food (attractant): stronger and faster; − repellent (light, salt): weaker and slower
  const T = Math.max(5, o.mperiod) / (1 + 0.4 * stim), amp = Math.max(0, o.mamp) * 1e-3 * (1 + 0.5 * stim), te = t * Math.max(0.01, o.mspeed || 1);
  const pace = LOBES[0], envelope = 0.7 + 0.3 * Math.sin((2 * Math.PI * te) / (T * 3.3) + 0.6);
  return taps.map((tap, k) => {
    let sum = 0;
    for (const pad of tap.pads) {
      const c = coverage(pad.x, pad.y), d = Math.hypot(pad.x - pace.x, pad.y - pace.y), ph = 2 * Math.PI * (te / T - d / WAVELENGTH_MM);
      const wave = Math.sin(ph) + 0.3 * Math.sin(2 * ph + 0.9);
      const drift = 0.25 * Math.sin((2 * Math.PI * te) / (T * 7) + d * 0.05);
      sum += c * amp * envelope * (wave + drift) + (o.mnoise || 0) * 1e-6 * (0.4 + 0.6 * c) * smooth(te, 40, k + 1);
    }
    return sum / Math.max(1, tap.pads.length);
  });
}

/**
 * Pads of the board under an organism, grouped into one tap per connection pin: [{ net, pin, pads: [{x, y}] }] with positions in mm
 * from the organism's centre. `board` is the board part's spec geometry (mm from its own top-left), `place` turns a board-local
 * point in mm into world px, and `centre`/`rot` are the organism's world centre (px) and rotation (degrees).
 */
export function tapsUnder(board, place, centre, rot, netOf) {
  const a = (-(rot || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), byPin = new Map();
  for (const pad of board.pads || []) {
    if (!pad.pin || pad.hole || pad.w < 3) continue;                 // electrodes are the big surface pads, not the header holes
    const w = place(pad.x, pad.y), dx = (w.x - centre.x) / MM_TO_PX, dy = (w.y - centre.y) / MM_TO_PX;
    if (!byPin.has(pad.pin)) byPin.set(pad.pin, []);
    byPin.get(pad.pin).push({ x: dx * c - dy * s, y: dx * s + dy * c });
  }
  return [...byPin].map(([pin, pads]) => ({ pin, net: netOf(pin), pads }));
}
