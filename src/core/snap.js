import { PART_DEFS } from './parts.js';
import { allPinsWorld, placeFlex } from './geometry.js';

export const SNAP_RADIUS = 15;  // world px: how far a lead may be from a hole and still be pulled in
export const ALIGN_TOL = 2.8;   // world px: a lead this close to a hole is electrically *in* it

export function boardHoles(parts) {
  const holes = [];
  for (const part of parts) {
    if (!PART_DEFS[part.type].isBoard) continue;
    for (const p of allPinsWorld(part)) holes.push({ partId: part.id, pinId: p.pin.id, x: p.x, y: p.y });
  }
  return holes;
}

/** Nearest hole (within tol) for a world point, ignoring holes in `taken`. */
export function holeAt(holes, x, y, tol = ALIGN_TOL, taken = null) {
  let best = null, bd = tol;
  for (const h of holes) {
    const d = Math.hypot(h.x - x, h.y - y);
    if (d < bd && !(taken && taken.has(`${h.partId}|${h.pinId}`))) { bd = d; best = h; }
  }
  return best;
}

/** Holes already holding a lead of some other component. */
export function occupiedHoles(parts, holes, ignoreIds = new Set()) {
  const taken = new Set();
  for (const part of parts) {
    if (ignoreIds.has(part.id) || !PART_DEFS[part.type].insertable) continue;
    for (const p of allPinsWorld(part).filter(q => !q.pin.noInsert)) {
      const h = holeAt(holes, p.x, p.y);
      if (h) taken.add(`${h.partId}|${h.pinId}`);
    }
  }
  return taken;
}

/**
 * Find the translation that best seats `part`'s leads into free breadboard holes.
 * Ranks candidates by (leads aligned, then shortest move) so a two-lead part lands with
 * *both* leads in holes whenever geometry allows.
 * Returns { dx, dy, aligned } or null.
 */
export function findSnap(parts, part, ignoreIds = new Set([part.id]), radius = SNAP_RADIUS) {
  if (!PART_DEFS[part.type].insertable) return null;
  const holes = boardHoles(parts);
  if (!holes.length) return null;
  const taken = occupiedHoles(parts, holes, ignoreIds);
  const pins = allPinsWorld(part).filter(q => !q.pin.noInsert);
  if (PART_DEFS[part.type].flex) { const s = snapFlex(part, pins, holes, taken, radius); if (s) return s; }
  let best = null;
  for (const p of pins) {
    for (const h of holes) {
      const d = Math.hypot(h.x - p.x, h.y - p.y);
      if (d > radius || taken.has(`${h.partId}|${h.pinId}`)) continue;
      const dx = h.x - p.x, dy = h.y - p.y;
      let aligned = 0;
      for (const q of pins) if (holeAt(holes, q.x + dx, q.y + dy, ALIGN_TOL, taken)) aligned++;
      if (!best || aligned > best.aligned || (aligned === best.aligned && d < best.d)) best = { dx, dy, aligned, d };
    }
  }
  return best;
}

/**
 * Flexible parts (the resistor): each lead goes to the free hole nearest to it, and the part stretches / turns to span exactly
 * those two holes — so both leads are dead-centre in their holes at any spacing. If only one lead is near a hole, the part is
 * translated so that lead sits in it (length and angle unchanged). Returns { dx, dy, aligned, d, place } (place = the new box).
 */
function snapFlex(part, pins, holes, taken, radius) {
  const def = PART_DEFS[part.type];
  const near = p => holes.filter(h => !taken.has(`${h.partId}|${h.pinId}`) && Math.hypot(h.x - p.x, h.y - p.y) <= radius)
    .map(h => ({ h, d: Math.hypot(h.x - p.x, h.y - p.y) })).sort((a, b) => a.d - b.d).slice(0, 6);
  const c1 = near(pins[0]), c2 = near(pins[1]);
  let best = null;
  for (const a of c1) for (const b of c2) {
    if (a.h === b.h) continue;
    if (Math.hypot(a.h.x - b.h.x, a.h.y - b.h.y) < def.minLen - 1e-6) continue;      // the body would not fit between them
    const cost = a.d + b.d;
    if (!best || cost < best.cost) best = { a: a.h, b: b.h, cost };
  }
  if (!best) return null;
  const moved = placeFlex({ type: part.type, rot: part.rot, x: 0, y: 0 }, best.a, best.b);
  return { dx: 0, dy: 0, aligned: 2, d: best.cost, place: { x: moved.x, y: moved.y, len: moved.len, rot: moved.rot } };
}

/** Apply a findSnap() result to a part: a flexible part gets its new box (x, y, len, rot); a rigid one is translated. */
export function applySnap(part, s) {
  if (!s) return;
  if (s.place) Object.assign(part, s.place); else { part.x += s.dx; part.y += s.dy; }
}
