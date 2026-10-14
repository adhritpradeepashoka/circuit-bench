import { PART_DEFS } from './parts.js';

/** Size of a part's box (unrotated). Flexible parts (the resistor) stretch: their width is the lead spacing `len`. */
export function partSize(part) {
  const def = PART_DEFS[part.type];
  return def.flex ? { w: Math.max(def.minLen, part.len ?? def.len), h: def.h } : { w: def.w, h: def.h };
}

/** The part's pins with local coordinates. Flexible parts put lead 1 at the left end and lead 2 at the right end of the box. */
export function localPins(part) {
  const def = PART_DEFS[part.type];
  if (!def.flex) return def.pins;
  const { w, h } = partSize(part);
  return def.pins.map((pin, i) => ({ ...pin, x: i === 0 ? 0 : w, y: h / 2 }));
}

/** Local (unrotated, top-left origin) point → world point. Rotation is about the part's centre,
 *  matching `transform-origin: 50% 50%` on the DOM wrapper. */
export function localToWorld(part, lx, ly) {
  const { w, h } = partSize(part);
  const a = ((part.rot || 0) * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const dx = lx - w / 2, dy = ly - h / 2;
  return { x: part.x + w / 2 + dx * c - dy * s, y: part.y + h / 2 + dx * s + dy * c };
}

export function pinWorld(part, pinId) {
  const pin = localPins(part).find(p => p.id === pinId);
  return pin ? localToWorld(part, pin.x, pin.y) : null;
}

export function allPinsWorld(part) {
  return localPins(part).map(pin => ({ pin, ...localToWorld(part, pin.x, pin.y) }));
}

export function partBounds(part) {
  const { w, h } = partSize(part);
  const pts = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => localToWorld(part, x, y));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Place a flexible part so that lead 1 is exactly at world point p1 and lead 2 exactly at p2
 * (length = distance between them, never below the body length; angle follows the line). Mutates x, y, len, rot.
 */
export function placeFlex(part, p1, p2) {
  const def = PART_DEFS[part.type];
  const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const len = Math.max(def.minLen, d);
  const ang = d < 1e-9 ? (part.rot || 0) : (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
  // if the two points are closer than the body allows, keep lead 1 fixed and extend along the line
  const q2 = d < 1e-9 || d >= def.minLen ? p2 : { x: p1.x + Math.cos((ang * Math.PI) / 180) * len, y: p1.y + Math.sin((ang * Math.PI) / 180) * len };
  const cx = (p1.x + q2.x) / 2, cy = (p1.y + q2.y) / 2;
  part.len = len; part.rot = ang; part.x = cx - len / 2; part.y = cy - def.h / 2;
  return part;
}
