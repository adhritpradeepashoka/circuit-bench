// Collision shapes for imported 3D parts. A convex hull fills in every cavity (a servo cradle becomes a solid block, so the servo "overlaps" it from the
// start and the physics has to switch that pair off). Instead the solid is voxelised and merged into a handful of boxes that follow its real shape,
// cavities included. Pure: takes triangles, returns boxes. Units are whatever the mesh uses (the robot model passes mm).

/** Mark every voxel a triangle touches, by sampling its surface finer than a voxel. */
function rasterise(pos, index, o, n, v, grid) {
  const tri = index ? index.length / 3 : pos.length / 9, at = k => (index ? index[k] : k) * 3;
  const idx = (x, y, z) => (z * n[1] + y) * n[0] + x;
  for (let t = 0; t < tri; t++) {
    const a = at(3 * t), b = at(3 * t + 1), c = at(3 * t + 2);
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2], bx = pos[b], by = pos[b + 1], bz = pos[b + 2], cx = pos[c], cy = pos[c + 1], cz = pos[c + 2];
    const e = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - ax, cy - ay, cz - az), Math.hypot(cx - bx, cy - by, cz - bz)), k = Math.max(1, Math.ceil(e / (v * 0.45)));
    for (let i = 0; i <= k; i++) for (let j = 0; j <= k - i; j++) {
      const u = i / k, w = j / k, s = 1 - u - w, x = Math.floor((s * ax + u * bx + w * cx - o[0]) / v), y = Math.floor((s * ay + u * by + w * cy - o[1]) / v), z = Math.floor((s * az + u * bz + w * cz - o[2]) / v);
      if (x >= 0 && y >= 0 && z >= 0 && x < n[0] && y < n[1] && z < n[2]) grid[idx(x, y, z)] = 1;
    }
  }
}

/** Fill the grid's solid: everything the outside cannot reach without crossing the surface. 0 = empty, 1 = surface, 2 = outside, then solid = not outside. */
function solidOf(grid, n) {
  const [nx, ny, nz] = n, idx = (x, y, z) => (z * ny + y) * nx + x, stack = [];
  const seed = (x, y, z) => { const i = idx(x, y, z); if (grid[i] === 0) { grid[i] = 2; stack.push(x, y, z); } };
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) { seed(x, y, 0); seed(x, y, nz - 1); }
  for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) { seed(x, 0, z); seed(x, ny - 1, z); }
  for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) { seed(0, y, z); seed(nx - 1, y, z); }
  while (stack.length) {
    const z = stack.pop(), y = stack.pop(), x = stack.pop();
    if (x > 0) seed(x - 1, y, z); if (x < nx - 1) seed(x + 1, y, z); if (y > 0) seed(x, y - 1, z); if (y < ny - 1) seed(x, y + 1, z); if (z > 0) seed(x, y, z - 1); if (z < nz - 1) seed(x, y, z + 1);
  }
  for (let i = 0; i < grid.length; i++) grid[i] = grid[i] === 2 ? 0 : 1;
}

/** Greedy merge of solid voxels into boxes: from each unused solid voxel grow along axis A, then B, then C while everything is solid and unused. */
function mergeOrder(grid0, n, [A, B, C]) {
  const grid = grid0.slice(), [nx, ny] = n, boxes = [], at = (p) => (p[2] * ny + p[1]) * nx + p[0];
  const cell = (a, b, c) => { const p = [0, 0, 0]; p[A] = a; p[B] = b; p[C] = c; return at(p); };
  for (let c = 0; c < n[C]; c++) for (let b = 0; b < n[B]; b++) for (let a = 0; a < n[A]; a++) {
    if (grid[cell(a, b, c)] !== 1) continue;
    let a1 = a; while (a1 + 1 < n[A] && grid[cell(a1 + 1, b, c)] === 1) a1++;
    let b1 = b; grow: while (b1 + 1 < n[B]) { for (let i = a; i <= a1; i++) if (grid[cell(i, b1 + 1, c)] !== 1) break grow; b1++; }
    let c1 = c; grow2: while (c1 + 1 < n[C]) { for (let j = b; j <= b1; j++) for (let i = a; i <= a1; i++) if (grid[cell(i, j, c1 + 1)] !== 1) break grow2; c1++; }
    for (let k = c; k <= c1; k++) for (let j = b; j <= b1; j++) for (let i = a; i <= a1; i++) grid[cell(i, j, k)] = 3;
    const lo = [0, 0, 0], hi = [0, 0, 0]; lo[A] = a; lo[B] = b; lo[C] = c; hi[A] = a1 + 1; hi[B] = b1 + 1; hi[C] = c1 + 1; boxes.push([...lo, ...hi]);
  }
  return boxes;
}
/** the fewest boxes of the three ways round (a part that is long in one direction merges best along it) */
function merge(grid, n) {
  let best = null; for (const order of [[0, 1, 2], [1, 2, 0], [2, 0, 1], [0, 2, 1]]) { const b = mergeOrder(grid, n, order); if (!best || b.length < best.length) best = b; }
  return best;
}

/**
 * @param mesh { pos: flat xyz, index?: triangle indices }
 * @returns { boxes: [{ c: [x,y,z], h: [hx,hy,hz] }] (centre and half sizes), voxel } or null when the mesh is empty or too complicated for boxes
 */
export function boxesFromMesh(mesh, { voxel = 0, maxBoxes = 1200, shrink = 0.5 } = {}) {
  const { pos, index = null } = mesh; if (!pos || pos.length < 9) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { if (pos[i + k] < lo[k]) lo[k] = pos[i + k]; if (pos[i + k] > hi[k]) hi[k] = pos[i + k]; }
  const size = hi.map((h, k) => h - lo[k]), big = Math.max(...size); if (!(big > 0)) return null;
  let v = voxel || 1.0;          // about a millimetre, so a part and its neighbour a millimetre away stay apart
  for (let attempt = 0; attempt < 5; attempt++, v *= 1.35) {
    const o = lo.map(l => l - v), n = size.map(s => Math.ceil(s / v) + 3);                    // a one-voxel margin so the outside can flow all the way round
    if (n[0] * n[1] * n[2] > 12_000_000) continue;
    const grid = new Uint8Array(n[0] * n[1] * n[2]); rasterise(pos, index, o, n, v, grid); solidOf(grid, n);
    const solid = grid.slice(), b = merge(grid, n); if (!b.length) return null;
    if (b.length <= maxBoxes) {
      // the surface voxels are fatter than the real surface by up to half a voxel: pull in only the faces that look at empty space, so a part that fits
      // snugly in a cradle still fits, and boxes that touch each other leave no seam
      const [nx, ny] = n, at = (x, y, z) => solid[(z * ny + y) * nx + x] === 1;
      const open = (box, axis, side) => {                                       // does the layer just beyond this face hold any empty voxel?
        const [x0, y0, z0, x1, y1, z1] = box, c = side < 0 ? [x0, y0, z0][axis] - 1 : [x1, y1, z1][axis];
        const ranges = [[x0, x1], [y0, y1], [z0, z1]]; ranges[axis] = [c, c + 1];
        if (c < 0 || c >= n[axis]) return true;
        for (let z = ranges[2][0]; z < ranges[2][1]; z++) for (let y = ranges[1][0]; y < ranges[1][1]; y++) for (let x = ranges[0][0]; x < ranges[0][1]; x++) if (!at(x, y, z)) return true;
        return false;
      };
      const out = b.map(box => {
        const lo = [box[0], box[1], box[2]].map((q, k) => o[k] + q * v), hi = [box[3], box[4], box[5]].map((q, k) => o[k] + q * v);
        for (let k = 0; k < 3; k++) { if (open(box, k, -1)) lo[k] += shrink * v; if (open(box, k, 1)) hi[k] -= shrink * v; if (hi[k] - lo[k] < 0.2 * v) { const m = (lo[k] + hi[k]) / 2; lo[k] = m - 0.1 * v; hi[k] = m + 0.1 * v; } }
        return { c: lo.map((l, k) => (l + hi[k]) / 2), h: lo.map((l, k) => (hi[k] - l) / 2) };
      });
      return { boxes: out, voxel: v };
    }
  }
  return null;
}
