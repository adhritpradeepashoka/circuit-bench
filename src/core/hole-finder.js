// Finds round holes and bosses on a triangle mesh, so a click near a screw hole can snap a frame to the hole's real centre and diameter.
// The mesh has no "holes" as such — only triangles — so this looks for FEATURE EDGES (sharp creases and open borders), keeps the ones that
// lie in the clicked face's plane, chains them into closed loops and keeps the loops that are circles. Pure and DOM-free (Node-testable).

/** Triangles as a flat array [x,y,z, x,y,z, x,y,z, …] in mm. → { segs:[{a:[x,y,z], b:[…], ia, ib}], verts:[[x,y,z]] } */
export function featureEdges(tris, { angleDeg = 35, eps = 1e-3 } = {}) {
  const n = Math.floor(tris.length / 9), ids = new Map(), verts = [];
  const vid = (x, y, z) => { const k = `${Math.round(x / eps)},${Math.round(y / eps)},${Math.round(z / eps)}`; let i = ids.get(k); if (i === undefined) { i = verts.length; ids.set(k, i); verts.push([x, y, z]); } return i; };
  const edges = new Map(), cosLim = Math.cos((angleDeg * Math.PI) / 180);
  for (let t = 0; t < n; t++) {
    const o = t * 9, a = vid(tris[o], tris[o + 1], tris[o + 2]), b = vid(tris[o + 3], tris[o + 4], tris[o + 5]), c = vid(tris[o + 6], tris[o + 7], tris[o + 8]);
    if (a === b || b === c || a === c) continue;
    const ux = tris[o + 3] - tris[o], uy = tris[o + 4] - tris[o + 1], uz = tris[o + 5] - tris[o + 2], vx = tris[o + 6] - tris[o], vy = tris[o + 7] - tris[o + 1], vz = tris[o + 8] - tris[o + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz); if (L < 1e-12) continue; nx /= L; ny /= L; nz /= L;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) { const k = p < q ? `${p}_${q}` : `${q}_${p}`; let e = edges.get(k); if (!e) edges.set(k, e = { a: Math.min(p, q), b: Math.max(p, q), ns: [] }); e.ns.push([nx, ny, nz]); }
  }
  const segs = [];
  for (const e of edges.values()) {
    const sharp = e.ns.length !== 2 || (e.ns[0][0] * e.ns[1][0] + e.ns[0][1] * e.ns[1][1] + e.ns[0][2] * e.ns[1][2]) < cosLim;
    if (sharp) segs.push({ ia: e.a, ib: e.b });
  }
  return { segs, verts };
}

/**
 * The circle (hole rim or round boss) nearest to a click, among the feature edges lying in the clicked face's plane.
 * @param {{segs, verts}} fe  from featureEdges()  @param {number[]} P  the clicked point  @param {number[]} N  the face's unit normal
 * @returns {{center:number[], radius:number, dist:number}|null}
 */
export function circleNear(fe, P, N, { reach = 8, maxRadius = 30, planeTol = 0.05, roundness = 0.04 } = {}) {
  const { segs, verts } = fe, onPlane = i => Math.abs((verts[i][0] - P[0]) * N[0] + (verts[i][1] - P[1]) * N[1] + (verts[i][2] - P[2]) * N[2]) <= planeTol;
  const near = i => Math.hypot(verts[i][0] - P[0], verts[i][1] - P[1], verts[i][2] - P[2]) <= maxRadius * 2 + reach;
  const adj = new Map();
  for (const s of segs) if (onPlane(s.ia) && onPlane(s.ib) && near(s.ia) && near(s.ib)) { (adj.get(s.ia) || adj.set(s.ia, []).get(s.ia)).push(s.ib); (adj.get(s.ib) || adj.set(s.ib, []).get(s.ib)).push(s.ia); }
  const seen = new Set(); let best = null;
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const comp = [], stack = [start]; seen.add(start);
    while (stack.length) { const v = stack.pop(); comp.push(v); for (const w of adj.get(v)) if (!seen.has(w)) { seen.add(w); stack.push(w); } }
    if (comp.length < 8 || comp.some(v => adj.get(v).length !== 2)) continue;                       // a circle is one closed chain: every vertex joins exactly two edges
    const c = [0, 0, 0]; for (const v of comp) for (let k = 0; k < 3; k++) c[k] += verts[v][k] / comp.length;
    const rs = comp.map(v => Math.hypot(verts[v][0] - c[0], verts[v][1] - c[1], verts[v][2] - c[2])), r = rs.reduce((a, b) => a + b, 0) / rs.length;
    if (r < 0.2 || r > maxRadius || Math.max(...rs.map(x => Math.abs(x - r))) / r > roundness) continue;
    const dist = Math.hypot(c[0] - P[0], c[1] - P[1], c[2] - P[2]), gap = Math.max(0, dist - r);
    if (gap > reach) continue;
    if (!best || gap < best.gap) best = { center: c, radius: r, dist, gap };
  }
  return best && { center: best.center, radius: best.radius, dist: best.dist };
}

/**
 * Every round hole or boss in the mesh, found without a click: closed, circular, planar chains of feature edges.
 * One entry per axis (a through-hole has a rim on each side; the one facing away from the part's middle is kept).
 * @returns {{center:number[], axis:number[], radius:number}[]}  axis is a unit vector pointing out of the part
 */
export function findHoles(fe, { minRadius = 0.4, maxRadius = 12, roundness = 0.04, max = 40 } = {}) {
  const { segs, verts } = fe, adj = new Map();
  for (const s of segs) { (adj.get(s.ia) || adj.set(s.ia, []).get(s.ia)).push(s.ib); (adj.get(s.ib) || adj.set(s.ib, []).get(s.ib)).push(s.ia); }
  let mid = [0, 0, 0]; for (const v of verts) for (let k = 0; k < 3; k++) mid[k] += v[k] / verts.length;
  const seen = new Set(), found = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const comp = [], stack = [start]; seen.add(start);
    while (stack.length) { const v = stack.pop(); comp.push(v); for (const w of adj.get(v)) if (!seen.has(w)) { seen.add(w); stack.push(w); } }
    if (comp.length < 8 || comp.some(v => adj.get(v).length !== 2)) continue;
    const c = [0, 0, 0]; for (const v of comp) for (let k = 0; k < 3; k++) c[k] += verts[v][k] / comp.length;
    const rel = comp.map(v => [verts[v][0] - c[0], verts[v][1] - c[1], verts[v][2] - c[2]]), rs = rel.map(r => Math.hypot(...r)), r = rs.reduce((a, b) => a + b, 0) / rs.length;
    if (r < minRadius || r > maxRadius || Math.max(...rs.map(x => Math.abs(x - r))) / r > roundness) continue;
    // plane normal: sum of cross products of consecutive-ish radius vectors (robust to ordering: use the biggest cross of any two well-separated points)
    let n = null, best = 0; const m = rel.length;
    for (let i = 0; i < m; i += Math.max(1, m >> 4)) for (let j = i + 1; j < m; j += Math.max(1, m >> 4)) { const a = rel[i], b = rel[j], x = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], L = Math.hypot(...x); if (L > best) { best = L; n = x.map(v => v / L); } }
    if (!n || best < r * r * 0.5) continue;
    if (rel.some(p => Math.abs(p[0] * n[0] + p[1] * n[1] + p[2] * n[2]) > r * 0.02 + 1e-3)) continue;      // not flat
    const out = [c[0] - mid[0], c[1] - mid[1], c[2] - mid[2]]; if (out[0] * n[0] + out[1] * n[1] + out[2] * n[2] < 0) n = n.map(v => -v);
    found.push({ center: c, axis: n, radius: r, away: Math.hypot(...out) });
  }
  const kept = [];
  for (const h of found.sort((a, b) => b.away - a.away)) {                 // same axis line and radius = the other rim of one hole
    const dup = kept.find(k => Math.abs(k.radius - h.radius) < 0.05 && Math.abs(k.axis[0] * h.axis[0] + k.axis[1] * h.axis[1] + k.axis[2] * h.axis[2]) > 0.99 &&
      (() => { const d = [h.center[0] - k.center[0], h.center[1] - k.center[1], h.center[2] - k.center[2]], t = d[0] * k.axis[0] + d[1] * k.axis[1] + d[2] * k.axis[2]; return Math.hypot(d[0] - t * k.axis[0], d[1] - t * k.axis[1], d[2] - t * k.axis[2]) < 0.1; })());
    if (!dup) kept.push(h);
  }
  return kept.slice(0, max).map(({ center, axis, radius }) => ({ center, axis, radius }));
}
