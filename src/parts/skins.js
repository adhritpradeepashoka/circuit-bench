// How the simulation's state is shown on the real @wokwi/elements parts that the catalogue uses (src/core/native-parts.js).
// The simulator speaks one vocabulary — lit (0/1), aux (an angle or rpm), levels (per-LED 0–1) — and a skin turns that
// into the properties the element understands. `visualTarget` gives the code that paints state one object to write to,
// whether the part is one of our own drawings (cb-custom-part) or a Wokwi element.
export const SKINS = {
  'wokwi-servo': { set: (el, s) => { el.angle = s.aux || 0; } },
  'wokwi-ky-040': { set: (el, s) => { el.angle = s.aux || 0; el.pressed = !!s.lit; } },
  'wokwi-buzzer': { set: (el, s) => { el.hasSignal = !!s.lit; } },
  'wokwi-led-bar-graph': { init: el => { el.color = 'GYR'; el.values = Array(10).fill(0); }, set: (el, s) => { el.values = (s.levels || Array(10).fill(0)).map(v => (v > 0.12 ? 1 : 0)); } },
  'wokwi-small-sound-sensor': { set: (el, s) => { el.ledPower = !!s.powered; } },
  'wokwi-slide-potentiometer': {},
  'wokwi-ks2e-m-dc5': {},
  'wokwi-tilt-switch': {},
  'wokwi-hc-sr04': {},
};

const state = new WeakMap();
/** The thing to write `lit` / `aux` / `levels` on for a placed part: the cb-custom-part itself, or an adapter that paints a Wokwi element. */
export function visualTarget(root, def) {
  if (!root || !def) return null;
  if (!def.skin) return root.querySelector('cb-custom-part');
  const el = root.matches?.(def.skin) ? root : root.querySelector(def.skin);
  if (!el) return null;
  let t = state.get(el);
  if (!t) {
    const s = { lit: 0, aux: 0, levels: null, powered: false };
    const paint = () => SKINS[def.skin]?.set?.(el, s);
    t = { el, get lit() { return s.lit; }, set lit(v) { s.lit = v; paint(); }, get aux() { return s.aux; }, set aux(v) { s.aux = v; paint(); }, get levels() { return s.levels; }, set levels(v) { s.levels = v; paint(); }, get powered() { return s.powered; }, set powered(v) { s.powered = v; paint(); } };
    state.set(el, t);
  }
  return t;
}
