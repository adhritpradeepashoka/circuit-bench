// Put a board's pins on the header pads of its Arduino drawing (src/core/board-geometry.generated.js): the pins keep their ids, labels and order and take
// the pad positions of the drawing — the top header left to right, then the bottom header (whose first pad, when there is one more pad than pins, is the unconnected one).
import { BOARD_GEOM } from './board-geometry.generated.js';
const QWIIC_IDS = ['QGND', 'Q3V3', 'QSDA', 'QSCL'];
export function seatOnArt(all, type) {
  const g = BOARD_GEOM[type], extra = new Map();                                // the 40-pin HAT header and Qwiic connector have their own pads in the drawing
  const pins = all.filter(p => { const h = /^H(\d+)$/.exec(p.id); if (h && g.hat) { extra.set(p.id, g.hat[+h[1] - 1]); return false; } if (g.qwiic && QWIIC_IDS.includes(p.id)) { extra.set(p.id, g.qwiic[QWIIC_IDS.indexOf(p.id)]); return false; } return true; });
  const ys = pins.map(p => p.y), mid = (Math.min(...ys) + Math.max(...ys)) / 2;
  const top = pins.filter(p => p.y < mid).sort((a, b) => a.x - b.x), bottom = pins.filter(p => p.y >= mid).sort((a, b) => a.x - b.x);
  if (top.length !== g.top.length || bottom.length > g.bottom.length) throw new Error(`${type}: ${pins.length} pins do not fit the drawing's headers`);
  const off = g.bottom.length - bottom.length, put = new Map();
  top.forEach((p, i) => put.set(p.id, g.top[i])); bottom.forEach((p, i) => put.set(p.id, g.bottom[i + off]));
  return all.map(p => { const q = put.get(p.id) || extra.get(p.id); return { ...p, x: q[0], y: q[1] }; });
}
export const artSize = type => ({ w: BOARD_GEOM[type].w, h: BOARD_GEOM[type].h });
