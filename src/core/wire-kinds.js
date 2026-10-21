// What a wire physically is, and how it is drawn. Electrically every kind is the same conductor; the kind is
// about realism and readability — the same choices a student makes at a real bench:
//   normal     – a jumper wire (the default look)
//   hookup     – solid insulated wire with stripped copper ends, the neat flat kind used on a breadboard
//   alligator  – a thick lead with a crocodile clip on each end, for grabbing a bare component leg
//   auto       – pick for me: alligator if an end grabs a bare leg, hookup if both ends are in the
//                breadboard, otherwise a jumper
// Pure (no DOM): the editor turns the SVG strings below into the overlay.
import { PART_DEFS } from './parts.js';

export const WIRE_KINDS = {
  auto: { name: 'Automatic', blurb: 'Picks the right wire for where it goes' },
  normal: { name: 'Normal', blurb: 'Jumper wire' },
  hookup: { name: 'Hookup', blurb: 'Solid wire with stripped ends, lies flat on a breadboard' },
  alligator: { name: 'Alligator', blurb: 'Clip lead that grabs a bare leg or terminal' },
};
export const DEFAULT_WIRE_KIND = 'auto';
/** Wires saved before kinds existed keep looking the way they did. */
export const LEGACY_WIRE_KIND = 'normal';

// Parts whose pins are bare metal legs (no header a jumper could plug into).
const BARE_LEADS = new Set(['led', 'rgb-led', 'resistor', 'pushbutton', 'slide-switch', 'potentiometer', 'seven-segment']);

/**
 * The concrete kind a wire is drawn as. `typeOf(partId)` → that part's type; `seated(endpoint)` → whether that
 * endpoint is a component leg already pushed into a breadboard hole (then it's wired like the hole it sits in,
 * not grabbed with a clip).
 */
export function resolveWireKind(wire, typeOf, seated = () => false) {
  const k = wire.kind || LEGACY_WIRE_KIND;
  if (k !== 'auto') return WIRE_KINDS[k] ? k : 'normal';
  const onBoard = ep => PART_DEFS[typeOf(ep.part)]?.isBoard || seated(ep);
  const bare = ep => BARE_LEADS.has(typeOf(ep.part)) && !seated(ep);
  if (bare(wire.a) || bare(wire.b)) return 'alligator';
  if (onBoard(wire.a) && onBoard(wire.b)) return 'hookup';
  return 'normal';
}

/** Small icons for the wire-type menu (24×14). */
export const WIRE_KIND_ICONS = {
  normal: '<svg viewBox="0 0 24 14" width="24" height="14"><path d="M3 7H19" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="20.5" cy="7" r="2.6" fill="currentColor"/></svg>',
  hookup: '<svg viewBox="0 0 24 14" width="24" height="14"><path d="M9 7H21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><rect x="2" y="3.5" width="7.5" height="7" rx="1" fill="currentColor"/></svg>',
  alligator: '<svg viewBox="0 0 24 14" width="24" height="14"><path d="M2 5.2L11 2.8V11.2L2 8.8Z" fill="currentColor" opacity=".55"/><rect x="10" y="3" width="8" height="8" rx="2.4" fill="currentColor"/><path d="M18 7H23" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M3 5.5l1-.6 1 .6 1-.6 1 .6 1-.6" fill="none" stroke="#fff" stroke-width=".7"/></svg>',
  auto: '<svg viewBox="0 0 24 14" width="24" height="14"><path d="M5 12L14 3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M17 1.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7zM20.5 7l.45 1 1 .45-1 .45-.45 1-.45-1-1-.45 1-.45z" fill="currentColor"/></svg>',
};
export const WIRE_KIND_ORDER = ['normal', 'hookup', 'alligator', 'auto'];

const n2 = v => +v.toFixed(2);
const at = (p, u) => `translate(${n2(p.x)} ${n2(p.y)}) rotate(${n2((Math.atan2(u.y, u.x) * 180) / Math.PI)})`;

/** A crocodile clip at end p, its jaws on the pin and its insulating boot running along u (into the wire). */
export function alligatorClip(p, u, color, edge) {
  return `<g class="wire-clip" transform="${at(p, u)}">`
    + `<rect x="8.5" y="-4.4" width="15" height="8.8" rx="3.2" fill="${color}" stroke="${edge}" stroke-width=".9"/>`
    + `<path d="M10 -3.2L1.6 -1.6Q-.6 -.9 -.6 0Q-.6 .9 1.6 1.6L10 3.2Z" fill="#c9ced3" stroke="#6f777e" stroke-width=".6"/>`
    + `<path d="M10 0L-.2 0" stroke="#59616a" stroke-width=".55"/>`
    + `<path d="M1.6 -1.2l.9 .9l.9 -.9l.9 .9l.9 -.9M1.6 1.2l.9 -.9l.9 .9l.9 -.9l.9 .9" fill="none" stroke="#7a838b" stroke-width=".4"/>`
    + `<circle cx="9.2" cy="0" r="1" fill="#8d959c"/></g>`;
}
/** A stripped end: bare copper for the first few px, then the insulation starts. */
export function strippedEnd(p, u, width, edge) {
  const L = 5.5, q = { x: p.x + u.x * L, y: p.y + u.y * L };
  return `<path d="M${n2(p.x)} ${n2(p.y)}L${n2(q.x)} ${n2(q.y)}" stroke="#b9773f" stroke-width="${n2(width * 0.62 + 0.6)}" stroke-linecap="round"/>`
    + `<path d="M${n2(p.x)} ${n2(p.y)}L${n2(q.x)} ${n2(q.y)}" stroke="#e8b27c" stroke-width="${n2(width * 0.28)}" stroke-linecap="round"/>`
    + `<circle cx="${n2(q.x)}" cy="${n2(q.y)}" r="${n2(width / 2 + 0.6)}" fill="none" stroke="${edge}" stroke-width=".7"/>`;
}

/**
 * Everything drawn for one wire except the hit area and selection halo.
 * @param kind resolved kind ('normal' | 'hookup' | 'alligator')
 */
export function wireArt(kind, a, b, g, color, edge, width) {
  if (kind === 'alligator') {
    const sw = width + 1.6;                                     // a thicker, softer cord
    return `<path class="wire-edge" d="${g.d}" stroke="${edge}" stroke-width="${n2(sw + 1.8)}"/>`
      + `<path class="wire-core" d="${g.d}" stroke="${color}" stroke-width="${n2(sw)}"/>`
      + alligatorClip(a, g.ends.a, color, edge) + alligatorClip(b, g.ends.b, color, edge);
  }
  if (kind === 'hookup') {
    const sw = Math.max(1.6, width - 0.6);                      // solid-core: slimmer, crisp edge
    return `<path class="wire-edge" d="${g.d}" stroke="${edge}" stroke-width="${n2(sw + 1.2)}"/>`
      + `<path class="wire-core" d="${g.d}" stroke="${color}" stroke-width="${n2(sw)}"/>`
      + strippedEnd(a, g.ends.a, sw, edge) + strippedEnd(b, g.ends.b, sw, edge);
  }
  return `<path class="wire-edge" d="${g.d}" stroke="${edge}" stroke-width="${n2(width + 1.8)}"/>`
    + `<path class="wire-core" d="${g.d}" stroke="${color}" stroke-width="${n2(width)}"/>`
    + `<circle cx="${n2(a.x)}" cy="${n2(a.y)}" r="${n2(width / 2 + 1.3)}" fill="${color}" stroke="${edge}" stroke-width="1"/>`
    + `<circle cx="${n2(b.x)}" cy="${n2(b.y)}" r="${n2(width / 2 + 1.3)}" fill="${color}" stroke="${edge}" stroke-width="1"/>`;
}
