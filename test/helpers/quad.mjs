// Builds a real assembled quad (frame, four motors, four props, battery under the frame, ESC and flight-controller boards) the way a person would, for the drone tests.
import { Assembly, worldFrame, turn } from '../../src/core/assembly-scene.js';
import { makeDronePart } from '../../src/core/drone-parts.js';
import { validateRobotPart } from '../../src/core/robot-part.js';

export const part = id => { const p = makeDronePart(id); const v = validateRobotPart(p); if (!v.ok) throw new Error(`${id}: ${v.errors}`); return { ...v.part, drone: p.drone, generated: true }; };
export function buildQuad({ frame = 'frame-quad-220-16-30.5', motor = 'motor-2207-1900', prop = 'prop-5x4.3x3-b5', battery = 'battery-4s-1500-75', boards = true, props = true } = {}) {
  const as = new Assembly(), f = as.add(part(frame)); let k = 0;
  for (const n of ['fr', 'fl', 'bl', 'br']) {
    const m = as.add(part(motor), [300 + 80 * k, 0, 0]); const r = as.mateAll(f.id, `${n}-1-top`, m.id, 'mount-1'); if (!r.ok) throw new Error(r.error);
    if (props) { const p = as.add(part(prop), [300 + 80 * k, 200, 0]); const r2 = as.mateAll(m.id, 'shaft', p.id, 'bore-bottom'); if (!r2.ok) throw new Error(r2.error); } k++;
  }
  const b = as.add(part(battery), [0, 400, 0]); const rb = as.mateAll(f.id, 'strap-1-bottom', b.id, 'strap-top-a'); if (!rb.ok) throw new Error(rb.error);
  for (let t = 0; t < 4 && !as.autoMatch(f.id, b.id); t++) { const w = worldFrame(f, f.part.frames.find(x => x.id === 'strap-1-bottom')); turn(b, [0, 0, 1], w.pos, 90); }
  if (boards) { const e = as.add(part('board-esc-30.5'), [0, -300, 0]); const re = as.mateAll(f.id, 'stack-1-top', e.id, 'mount-1-bottom'); if (!re.ok) throw new Error(re.error); const fc = as.add(part('board-fc-30.5'), [0, -400, 0]); const rf = as.mateAll(e.id, 'mount-1-top', fc.id, 'mount-1-bottom'); if (!rf.ok) throw new Error(rf.error); }
  return as;
}
