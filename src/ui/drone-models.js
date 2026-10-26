// The 3D shapes of the drone parts, drawn from each part's numbers (see core/drone-parts.js). Z up, centred in X and Y, resting on z = 0,
// with the same hole positions the part's frames say, so a model and its marked holes always agree.
export function buildDroneMesh(THREE, part) {
  const d = part.drone, g = new THREE.Group(), mat = () => new THREE.MeshStandardMaterial({ color: 0xb8c4cc });
  const add = (geo, x = 0, y = 0, z = 0) => { geo.translate(x, y, z); const m = new THREE.Mesh(geo, mat()); g.add(m); return m; };
  const cyl = (r, h, z0, seg = 36) => { const geo = new THREE.CylinderGeometry(r, r, h, seg); geo.rotateX(Math.PI / 2); return add(geo, 0, 0, z0 + h / 2); };
  const plate = (shape, t, z0 = 0) => { const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 20 }); return add(geo, 0, 0, z0); };
  const rrect = (w, h, r, pts = null) => { const s = new THREE.Shape(), x = -w / 2, y = -h / 2; r = Math.min(r, w / 2, h / 2); s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s; };
  const holes = (shape, pts, r) => { for (const [x, y] of pts) { const h = new THREE.Path(); h.absarc(x, y, r, 0, Math.PI * 2, true); shape.holes.push(h); } return shape; };
  const sq = (a, b = a) => [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([x, y]) => [x * a / 2, y * b / 2]);
  if (d.kind === 'motor') {
    const [a, b] = d.motor.mount.pattern, hd = part.frames[0].diameter, s = new THREE.Shape(); s.absarc(0, 0, d.baseR, 0, Math.PI * 2, false);
    plate(holes(s, sq(a, b), hd / 2), d.baseT); cyl(d.bellR, d.root - d.baseT, d.baseT, 48); cyl(d.motor.shaftMm / 2, d.shaftLen, d.root);
  } else if (d.kind === 'prop') {
    const s = new THREE.Shape(); s.absarc(0, 0, d.hubR, 0, Math.PI * 2, false); const h = new THREE.Path(); h.absarc(0, 0, d.bore / 2, 0, Math.PI * 2, true); s.holes.push(h); plate(s, d.hubH);
    const L = d.R - d.hubR, chord = Math.max(2.5, d.dia * 25.4 * 0.11), pitch = Math.atan2(d.pitch, Math.PI * 0.7 * d.dia);
    for (let k = 0; k < d.blades; k++) { const geo = new THREE.BoxGeometry(L, chord, 0.8); geo.rotateX(pitch); geo.translate(d.hubR + L / 2 - 0.5, 0, d.hubH / 2); geo.rotateZ(k * 2 * Math.PI / d.blades); add(geo); }
  } else if (d.kind === 'battery') { const [l, w, h] = d.sizeMm; add(new THREE.BoxGeometry(l, w, h), 0, 0, h / 2); add(new THREE.BoxGeometry(l * 0.18, w * 0.5, 2), l / 2 + 1, 0, h / 2); }
  else if (d.kind === 'frame') {
    const { t, arm, plate: P, tips, mhd, hd } = d, W = d.wheelbase, st = d.stack, mp = d.motorPattern, stackPat = sq(...(({ '30.5': [30.5], '25.5': [25.5], '20': [20], '16': [16] })[st]));
    for (const [, x, y] of tips) {                                                       // an arm: a bar from the middle out to the motor, with the motor's four holes at its end
      const ang = Math.atan2(y, x), c = Math.cos(ang), s2 = Math.sin(ang), hw = arm / 2, Lr = Math.hypot(x, y) + hw * 0.9, pts = [[0, -hw], [Lr, -hw], [Lr, hw], [0, hw]].map(([u, v]) => [u * c - v * s2, u * s2 + v * c]);
      const s = new THREE.Shape(); pts.forEach(([px, py], i) => (i ? s.lineTo(px, py) : s.moveTo(px, py))); s.closePath(); plate(holes(s, sq(mp).map(([hx, hy]) => [x + hx, y + hy]), mhd / 2), t);
    }
    plate(holes(rrect(P, P, 4), stackPat, hd / 2), t, 0);
  } else if (d.kind === 'board') {
    const [l, w] = d.board.sizeMm, side = Math.max(d.pattern[0] + 6, Math.min(l, w) - 2); plate(holes(rrect(side, side, 2), sq(...d.pattern), d.hd / 2), 1.6);
    add(new THREE.BoxGeometry(8, 6, 3), 0, side / 2 - 2, 1.6 + 1.5); add(new THREE.BoxGeometry(7, 7, 1.2), 0, -2, 1.6 + 0.6);
    if (d.board.kind !== 'fc') add(new THREE.BoxGeometry(side * 0.7, 4, 3), 0, -side / 2 + 4, 1.6 + 1.5);
  } else if (d.kind === 'camera') { const [l, w, h] = d.sizeMm; add(new THREE.BoxGeometry(l, w, h * 0.7), 0, 0, h * 0.35); const lens = new THREE.CylinderGeometry(l * 0.3, l * 0.3, h * 0.5, 24); lens.rotateX(Math.PI / 2); lens.rotateX(-Math.PI / 2 * 0); add(lens, 0, w * 0.1, h * 0.7 + h * 0.15); }
  else if (d.kind === 'standoff') { const s = new THREE.Shape(); s.absarc(0, 0, d.r, 0, Math.PI * 2, false); const h = new THREE.Path(); h.absarc(0, 0, d.hd / 2, 0, Math.PI * 2, true); s.holes.push(h); plate(s, d.h); }
  return g;
}
