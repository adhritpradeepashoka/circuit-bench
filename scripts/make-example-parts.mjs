// Builds public/robot-parts/kame32/index.json (the Assembly tab's example parts) from the STL files next to it.
import fs from 'node:fs'; import path from 'node:path';
import { PartDraft } from '../src/core/assembly-draft.js';
import { validateRobotPart } from '../src/core/robot-part.js';
import { featureEdges, findHoles } from '../src/core/hole-finder.js';
const dir = path.resolve('public/robot-parts/kame32');
function stats(buf) {   // bbox (mm) and volume (mm³) of a binary or ascii STL
  let v = [];
  if (buf.slice(0, 5).toString() === 'solid' && buf.slice(0, 400).toString().includes('facet')) { for (const m of buf.toString().matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) v.push([+m[1], +m[2], +m[3]]); }
  else { const n = buf.readUInt32LE(80); for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const o = 84 + i * 50 + 12 + k * 12; v.push([buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)]); } }
  const mn = [0, 1, 2].map(i => Math.min(...v.map(p => p[i]))), mx = [0, 1, 2].map(i => Math.max(...v.map(p => p[i]))); let vol = 0;
  for (let i = 0; i < v.length; i += 3) { const [a, b, c] = [v[i], v[i + 1], v[i + 2]]; vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; }
  return { size: mx.map((x, i) => x - mn[i]), vol: Math.abs(vol), mn, mx, tris: Float32Array.from(v.flat()) };
}
const NAMES = { 'bracket-left-sg90': 'Kame32 bracket (left, SG90)', 'bracket-right-sg90': 'Kame32 bracket (right, SG90)', 'leg-left-sg90': 'Kame32 leg (left, SG90)', 'leg-right-sg90': 'Kame32 leg (right, SG90)', 'leg-link': 'Kame32 leg link', foot: 'Kame32 foot', bushing: 'Kame32 bushing', 'servo-sg90': 'SG90 servo' };
const parts = [];
for (const [id, name] of Object.entries(NAMES)) {
  const file = `${id}.stl`, buf = fs.readFileSync(path.join(dir, file)), s = stats(buf), d = new PartDraft();
  d.setMesh({ file, format: 'stl', bytes: buf.length, rawSize: s.size }); d.name = name; d.category = 'Example parts';
  const servo = id === 'servo-sg90';
  d.blurb = servo ? 'SG90 micro servo model from the FreeCAD parts library (github.com/FreeCAD/FreeCAD-library). Body, mounting ears and splined output shaft; no horn.' : 'Printed part from Kame32 by Javier Isabel (github.com/JavierIH/kame32), GPL-3.0. Click its holes to mark them.';
  if (servo) { d.massGrams = 9; d.massSource = 'datasheet'; } else { d.massGrams = Math.round(s.vol / 1000 * 1.24 * 0.3 * 10) / 10; d.massSource = 'estimated'; }        // PLA at ~30 % effective fill — a guess, not a weighing
  // every round hole, in the Assembly tab's space (centred in X/Y, resting on the grid at z = 0)
  const c = [(s.mn[0] + s.mx[0]) / 2, (s.mn[1] + s.mx[1]) / 2, s.mn[2]];
  findHoles(featureEdges(s.tris)).forEach(h => d.addFrame({ pos: h.center.map((v, i) => v - c[i]), dir: h.axis, kind: 'hole', diameter: h.radius * 2 }));
  if (servo) for (const y of [-2.4, 25.0]) for (const [z, dir] of [[18.4, [0, 0, 1]], [15.9, [0, 0, -1]]]) d.addFrame({ pos: [0, y - c[1], z - c[2]], dir, kind: 'hole', diameter: 2 });    // the two ear slots (open-ended, so not found as closed circles): 27.4 mm apart, 2 mm
  const r = validateRobotPart(d.toDescription()); if (!r.ok) throw new Error(id + ': ' + r.errors.join('; '));
  parts.push({ ...r.part, id: 'kame32-' + id });
}
fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ source: 'https://github.com/JavierIH/kame32', licence: 'GPL-3.0', parts }, null, 1));
console.log(parts.map(p => `${p.id} ${p.mass.grams} g, holes: ${p.frames.map(f => f.diameter.toFixed(1)).join(' ')}`).join('\n'));
