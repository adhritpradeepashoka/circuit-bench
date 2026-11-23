// Bakes the full-body model from the MakeHuman base mesh (CC0, https://github.com/makehumancommunity/makehuman, base.obj, hm08).
//   node scripts/body/bake-body.mjs path/to/base.obj
// Writes src/assets/body.glb (skin only, no helper geometry) and src/core/body-model.generated.js (joint centres and electrode sites).
// Frame: 1 unit = 100 mm, x = the person's right, y = front, z = up, origin on the floor between the feet (same axes as the head model).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..', '..');
const src = process.argv[2]; if (!src) { console.error('usage: node bake-body.mjs base.obj'); process.exit(1); }
const L = fs.readFileSync(src, 'utf8').split('\n');
const V = [], faces = [], jointVerts = {}; let grp = '';
for (const l of L) {
  if (l.startsWith('v ')) { const p = l.split(/\s+/); V.push([+p[1], +p[2], +p[3]]); }
  else if (l.startsWith('g ')) grp = l.slice(2).trim();
  else if (l.startsWith('f ')) { const idx = l.trim().split(/\s+/).slice(1).map(t => +t.split('/')[0] - 1); if (grp === 'body') faces.push(idx); else if (grp.startsWith('joint-')) (jointVerts[grp] ||= new Set()).add(...idx), idx.forEach(i => jointVerts[grp].add(i)); }
}
// MakeHuman: y up, +z toward the viewer (the person's front), the person's right is -x.
const used = new Map(), P = [], I = [];
const take = i => { if (!used.has(i)) { used.set(i, P.length / 3); P.push(...V[i]); } return used.get(i); };
for (const f of faces) for (let k = 1; k < f.length - 1; k++) I.push(take(f[0]), take(f[k]), take(f[k + 1]));
let minY = 1e9, maxY = -1e9, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
for (let i = 0; i < P.length; i += 3) { minX = Math.min(minX, P[i]); maxX = Math.max(maxX, P[i]); minY = Math.min(minY, P[i + 1]); maxY = Math.max(maxY, P[i + 1]); minZ = Math.min(minZ, P[i + 2]); maxZ = Math.max(maxZ, P[i + 2]); }
const k = 17.5 / (maxY - minY), cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
const conv = ([x, y, z]) => [-(x - cx) * k, (z - cz) * k, (y - minY) * k];
const pos = new Float32Array(P.length); for (let i = 0; i < P.length; i += 3) pos.set(conv([P[i], P[i + 1], P[i + 2]]), i);
const idx = new Uint32Array(I);

// joint centres
const joints = {};
for (const [g, set] of Object.entries(jointVerts)) { let c = [0, 0, 0]; for (const i of set) { const q = conv(V[i]); c = c.map((a, j) => a + q[j]); } joints[g.replace('joint-', '')] = c.map(a => +(a / set.size).toFixed(3)); }

// per-vertex normals (flat-ish smooth)
const nr = new Float32Array(pos.length);
for (let t = 0; t < idx.length; t += 3) {
  const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]], u = [0, 1, 2].map(j => pos[b * 3 + j] - pos[a * 3 + j]), v = [0, 1, 2].map(j => pos[c * 3 + j] - pos[a * 3 + j]);
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  for (const i of [a, b, c]) for (let j = 0; j < 3; j++) nr[i * 3 + j] += n[j];
}
for (let i = 0; i < nr.length; i += 3) { const l = Math.hypot(nr[i], nr[i + 1], nr[i + 2]) || 1; nr[i] /= l; nr[i + 1] /= l; nr[i + 2] /= l; }
// the conversion is a proper rotation, so the winding is preserved; check the normals point outward on average
{ let s = 0; for (let i = 0; i < nr.length; i += 3) s += nr[i + 1] * (pos[i + 1] > 0 ? 1 : 0); if (s < 0) console.warn('normals look inverted'); }

// electrode sites: the skin vertex nearest a point on the muscle, pushed out along a direction
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], sub = (a, b) => a.map((v, i) => v - b[i]), add = (a, b) => a.map((v, i) => v + b[i]), mul = (a, s) => a.map(v => v * s);
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
const skin = (centre, dir, radius) => {          // among vertices within `radius` of the line through `centre` along `dir`, the one furthest along dir
  let best = null, bs = -1e9;
  for (let i = 0; i < pos.length; i += 3) {
    const p = [pos[i], pos[i + 1], pos[i + 2]], d = sub(p, centre), along = dot(d, dir), perp = sub(d, mul(dir, along));
    if (Math.hypot(...perp) < radius && along > bs && along > -0.5) { bs = along; best = p; }
  }
  return best;
};
// hand tip = the arm vertex furthest from the elbow
const handOf = s => { const e = joints[`${s}-elbow`], sh = joints[`${s}-shoulder`], sgn = s === 'r' ? 1 : -1; let best = null, bd = 0; for (let i = 0; i < pos.length; i += 3) { if (pos[i] * sgn < e[0] * sgn - 0.2 || pos[i + 2] < 5) continue; const p = [pos[i], pos[i + 1], pos[i + 2]], d = Math.hypot(...sub(p, e)); if (d > bd) { bd = d; best = p; } } return best; };
const sites = {}, arm = {};
for (const s of ['r', 'l']) {
  const sh = joints[`${s}-shoulder`], el = joints[`${s}-elbow`], hand = handOf(s), up = norm(sub(el, sh));
  const fore = norm(sub(hand, el)), back = [0, -1, 0], front = [0, 1, 0], S = s.toUpperCase();
  arm[s] = { shoulder: sh, elbow: el, hand: hand.map(v => +v.toFixed(3)) };
  const along = (a, b, t) => add(a, mul(sub(b, a), t));
  sites[`bicep-${S}`] = skin(along(sh, el, 0.55), front, 0.35);
  sites[`tricep-${S}`] = skin(along(sh, el, 0.55), back, 0.35);
  sites[`delt-${S}`] = skin(along(sh, el, 0.08), [0, 0, 1], 0.4);
  sites[`flexor-${S}`] = skin(along(el, hand, 0.28), norm([0, 1, -0.1]), 0.5);
  sites[`extensor-${S}`] = skin(along(el, hand, 0.28), norm([0, -1, 0.1]), 0.5);
  sites[`elbow-${S}`] = skin(el, back, 0.25);                      // the bony point of the elbow: a good reference
  sites[`wrist-${S}`] = skin(along(el, hand, 0.82), back, 0.25);
  void up; void fore;
}
// chest and abdomen for ECG (limb-lead-like placements)
const sc = joints['spine-2'] || [0, 0, 12], cl = joints['r-clavicle'], cll = joints['l-clavicle'], pel = joints['pelvis'];
const chestZ = cl[2] - 1.3;
sites['ecg-RA'] = skin([cl[0] * 0.6, 0, chestZ], [0, 1, 0], 0.3);
sites['ecg-LA'] = skin([cll[0] * 0.6, 0, chestZ], [0, 1, 0], 0.3);
sites['ecg-LL'] = skin([pel[0] - (-1.2), 0, pel[2] + 0.8], [0, 1, 0], 0.3);
sites['ecg-V'] = skin([cll[0] * 0.25, 0, chestZ - 1.4], [0, 1, 0], 0.3);
void sc;
for (const [k2, v] of Object.entries(sites)) { if (!v) { console.error('no skin found for', k2); process.exit(1); } sites[k2] = v.map(a => +a.toFixed(3)); }

// glb
const pb = Buffer.from(pos.buffer), nb = Buffer.from(nr.buffer), ib = Buffer.from(idx.buffer), bin = Buffer.concat([pb, nb, ib]);
const mn = [0, 1, 2].map(j => Math.min(...Array.from({ length: pos.length / 3 }, (_, i) => pos[i * 3 + j]))), mx = [0, 1, 2].map(j => Math.max(...Array.from({ length: pos.length / 3 }, (_, i) => pos[i * 3 + j])));
const gj = { asset: { version: '2.0', generator: 'CircuitBench bake-body (MakeHuman CC0 base mesh)' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'body' }], meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }] }], buffers: [{ byteLength: bin.length }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pb.length, target: 34962 }, { buffer: 0, byteOffset: pb.length, byteLength: nb.length, target: 34962 }, { buffer: 0, byteOffset: pb.length + nb.length, byteLength: ib.length, target: 34963 }],
  accessors: [{ bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min: mn, max: mx }, { bufferView: 1, componentType: 5126, count: pos.length / 3, type: 'VEC3' }, { bufferView: 2, componentType: 5125, count: idx.length, type: 'SCALAR' }] };
let js = Buffer.from(JSON.stringify(gj)); while (js.length % 4) js = Buffer.concat([js, Buffer.from(' ')]);
let b2 = bin; while (b2.length % 4) b2 = Buffer.concat([b2, Buffer.alloc(1)]);
const tot = 12 + 8 + js.length + 8 + b2.length, h1 = Buffer.alloc(12), c1 = Buffer.alloc(8), c2 = Buffer.alloc(8);
h1.writeUInt32LE(0x46546C67, 0); h1.writeUInt32LE(2, 4); h1.writeUInt32LE(tot, 8); c1.writeUInt32LE(js.length, 0); c1.writeUInt32LE(0x4E4F534A, 4); c2.writeUInt32LE(b2.length, 0); c2.writeUInt32LE(0x004E4942, 4);
fs.writeFileSync(path.join(root, 'src/assets/body.glb'), Buffer.concat([h1, c1, js, c2, b2]));
fs.writeFileSync(path.join(root, 'src/core/body-model.generated.js'),
`// GENERATED by scripts/body/bake-body.mjs from the MakeHuman base mesh (CC0). Do not edit by hand.
// Units: 1 = 100 mm; x = the person's right, y = front, z = up; origin on the floor between the feet. The person is 1.75 m tall in an A-pose.
export const BODY_HEIGHT = 17.5;
export const BODY_ARMS = ${JSON.stringify(arm)};
export const BODY_SITES = ${JSON.stringify(sites)};
`);
console.log('verts', pos.length / 3, 'glb bytes', tot, 'sites', Object.keys(sites).length, 'arm', JSON.stringify(arm));
