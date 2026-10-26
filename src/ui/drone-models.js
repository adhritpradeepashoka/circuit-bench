// The 3D shapes of the drone parts, drawn from each part's numbers (see core/drone-parts.js). Z up, centred in X and Y, resting on z = 0,
// with the same hole positions the part's frames say, so a model and its marked holes always agree. Each part has its own real-world colours (carbon frame, blue LiPo,
// green circuit boards …); those meshes are flagged `userData.fixed` so the Assembly view's per-instance tint leaves them alone.
export const DRONE_COLOURS = { carbon: 0x24282c, motorBase: 0x2b2f33, bell: 0x2f8fa8, steel: 0xdfe3e6, prop: 0x58b4e8, hub: 0x20262b, lipo: 0x2f5fc9, label: 0xf2f4f6, xt60: 0xf2c200, fc: 0x1f7a44, esc: 0x262c33, chip: 0x111417, camBody: 0x15181b, glass: 0x0e1c28, lens: 0xb8c0c6, brass: 0xc9a24a, usb: 0xc8ced3 };

export function buildDroneMesh(THREE, part) {
  const d = part.drone, g = new THREE.Group(), C = DRONE_COLOURS;
  const add = (geo, x = 0, y = 0, z = 0, color = C.carbon, o = {}) => {
    geo.translate(x, y, z); const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, metalness: o.metal ?? 0.15, roughness: o.rough ?? 0.55, side: THREE.DoubleSide, transparent: o.alpha != null, opacity: o.alpha ?? 1 }));
    m.userData.fixed = true; g.add(m); return m;
  };
  const cyl = (r, h, z0, color, seg = 36, o = {}, r2 = r) => { const geo = new THREE.CylinderGeometry(r2, r, h, seg); geo.rotateX(Math.PI / 2); return add(geo, 0, 0, z0 + h / 2, color, o); };
  const plate = (shape, t, z0 = 0, color = C.carbon, o = {}) => add(new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 20 }), 0, 0, z0, color, o);
  const rrect = (w, h, r) => { const s = new THREE.Shape(), x = -w / 2, y = -h / 2; r = Math.min(r, w / 2, h / 2); s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s; };
  const holes = (shape, pts, r) => { for (const [x, y] of pts) { const h = new THREE.Path(); h.absarc(x, y, r, 0, Math.PI * 2, true); shape.holes.push(h); } return shape; };
  const slot = (shape, cx, cy, w, h) => { const p = new THREE.Path(), x = cx - w / 2, y = cy - h / 2; p.moveTo(x, y); p.lineTo(x + w, y); p.lineTo(x + w, y + h); p.lineTo(x, y + h); p.closePath(); shape.holes.push(p); return shape; };
  const mountPts = (kind, p, q = p) => kind === 'tri' ? [0, 1, 2].map(k => [Math.cos(Math.PI / 2 + k * 2 * Math.PI / 3) * p / 2, Math.sin(Math.PI / 2 + k * 2 * Math.PI / 3) * p / 2]) : sq(p, q);
  const sq = (a, b = a) => [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([x, y]) => [x * a / 2, y * b / 2]);
  if (d.kind === 'motor') {
    const [a, b] = d.motor.mount.pattern, hd = part.frames[0].diameter, pts = mountPts(d.mountKind, a, b), lug = hd / 2 + 1.6, hub = Math.min(d.baseR, d.bellR * 1.05);
    // a real motor base: a round hub with four lugs reaching out to the screw holes (a flat cross), the holes at the part's mounting pattern, with a screw head in each
    const s = new THREE.Shape(); s.absarc(0, 0, hub, 0, Math.PI * 2, false);
    plate(holes(s, [], 0), d.baseT, 0, C.motorBase, { metal: 0.4 });
    for (const [x, y] of pts) {
      const L = Math.hypot(x, y), ang = Math.atan2(y, x), c = Math.cos(ang), s2 = Math.sin(ang), arm = [[0, -lug * 0.8], [L, -lug], [L, lug], [0, lug * 0.8]].map(([u, v]) => [u * c - v * s2, u * s2 + v * c]);
      const lugShape = new THREE.Shape(); arm.forEach(([px, py], k) => (k ? lugShape.lineTo(px, py) : lugShape.moveTo(px, py))); lugShape.closePath();
      const rim = new THREE.Path(); rim.absarc(x, y, hd / 2, 0, Math.PI * 2, true); lugShape.holes.push(rim); plate(lugShape, d.baseT, 0, C.motorBase, { metal: 0.4 });
      const head = new THREE.CylinderGeometry(hd / 2 + 0.7, hd / 2 + 0.7, 1.4, 20); head.rotateX(Math.PI / 2); add(head, x, y, d.baseT + 0.7, C.steel, { metal: 0.9, rough: 0.3 });   // the screw head on top of the lug
    }
    cyl(d.bellR * 0.85, Math.max(1, d.baseT * 0.5), d.baseT, 0xb87333, 36, { metal: 0.6, rough: 0.4 });                                           // the copper windings (stator)
    for (const dx of [-1.2, 0, 1.2]) { const w = new THREE.CylinderGeometry(0.45, 0.45, d.baseR * 1.6, 8); w.rotateZ(Math.PI / 2); add(w, -d.baseR * 0.9, dx, d.baseT * 0.5, [0xc23b2f, 0x1c1c1c, 0xd9a400][dx < 0 ? 0 : dx > 0 ? 2 : 1]); }
    const bellH = d.root - d.baseT; cyl(d.bellR * 0.97, 1.2, d.baseT, C.motorBase, 48, { metal: 0.4 });                                   // a dark ring at the foot
    cyl(d.bellR, bellH - 1.2 - 0.8, d.baseT + 1.2, C.bell, 48, { metal: 0.7, rough: 0.35 }); cyl(d.bellR * 0.78, 0.8, d.root - 0.8, C.motorBase, 48, { metal: 0.4 }, d.bellR * 0.9);    // the anodised bell, and its cap
    cyl(d.motor.shaftMm / 2, d.shaftLen, d.root, C.steel, 24, { metal: 0.9, rough: 0.25 });
  } else if (d.kind === 'prop') {
    const s = new THREE.Shape(); s.absarc(0, 0, d.hubR, 0, Math.PI * 2, false); const h = new THREE.Path(); h.absarc(0, 0, d.bore / 2, 0, Math.PI * 2, true); s.holes.push(h); plate(s, d.hubH, 0, C.hub);
    const L = d.R - d.hubR + 1, chord = Math.max(2.5, d.dia * 25.4 * 0.12), pitch = Math.atan2(d.pitch, Math.PI * 0.7 * d.dia);
    for (let k = 0; k < d.blades; k++) {                                                                                           // a blade: widest at 60 %, rounded at the tip, set at the pitch angle
      const sh = new THREE.Shape(); sh.moveTo(0, -chord * 0.4); sh.quadraticCurveTo(L * 0.55, -chord * 0.75, L * 0.85, -chord * 0.5); sh.quadraticCurveTo(L * 1.02, -chord * 0.1, L, chord * 0.1); sh.quadraticCurveTo(L * 0.9, chord * 0.55, L * 0.55, chord * 0.5); sh.quadraticCurveTo(L * 0.25, chord * 0.45, 0, chord * 0.4); sh.closePath();
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.7, bevelEnabled: false }); geo.rotateX(pitch); geo.computeBoundingBox(); geo.translate(d.hubR - 0.5, 0, Math.max(d.hubH / 2 - 0.2, -geo.boundingBox.min.z)); geo.rotateZ(k * 2 * Math.PI / d.blades);          // (never lower than the hub's underside, which sits on the bell) add(geo, 0, 0, 0, C.prop, { rough: 0.35, alpha: 0.92 });
    }
  } else if (d.kind === 'battery') {
    const [l, w, h] = d.sizeMm; add(new THREE.BoxGeometry(l, w, h), 0, 0, h / 2, C.lipo, { rough: 0.45 }); add(new THREE.BoxGeometry(l * 0.5, w * 0.8, 0.3), -l * 0.1, 0, h + 0.1, C.label, { rough: 0.8 });          // the pack, and its white label
    add(new THREE.BoxGeometry(l * 0.14, w * 0.34, Math.min(8, h * 0.55)), l / 2 + l * 0.07, 0, Math.min(8, h * 0.55) / 2 + 1, C.xt60, { rough: 0.5 });          // XT60 plug
    for (const dy of [-1.5, 1.5]) { const wire = new THREE.CylinderGeometry(0.9, 0.9, l * 0.2, 8); wire.rotateZ(Math.PI / 2); add(wire, l / 2 + l * 0.04, dy, h * 0.4, 0xc23b2f); }
  } else if (d.kind === 'frame') {
    const { t, arm, plate: P, tips, mhd, hd } = d, W = d.wheelbase, st = d.stack, mp = d.motorPattern, mk = d.mountKind || 'cross', stackPat = sq(...(({ '30.5': [30.5], '25.5': [25.5], '20': [20], '16': [16] })[st]));
    for (const [, x, y] of tips) {                                                       // an arm: a bar from the middle out to the motor, with the motor's four holes at its end
      const ang = Math.atan2(y, x), c = Math.cos(ang), s2 = Math.sin(ang), hw = arm / 2, Lr = Math.hypot(x, y) + hw * 0.9, pts = [[0, -hw], [Lr, -hw], [Lr, hw], [0, hw]].map(([u, v]) => [u * c - v * s2, u * s2 + v * c]);
      const s = new THREE.Shape(); pts.forEach(([px, py], i) => (i ? s.lineTo(px, py) : s.moveTo(px, py))); s.closePath(); plate(holes(s, mountPts(mk, mp).map(([hx, hy]) => [x + hx, y + hy]), mhd / 2), t, 0, C.carbon, { metal: 0.3 });
    }
    const body = holes(rrect(P, P, 4), stackPat, hd / 2); for (const sy of [-10, 10]) slot(body, 0, sy, 14, 3.8);                                                 // the battery strap passes through these slots
    plate(body, t, 0, C.carbon, { metal: 0.3 });
    const tabMesh = plate(holes(rrect(26, 16, 3), [[-6, 0], [6, 0]], 1.2), t, 0, C.carbon, { metal: 0.3 }); tabMesh.geometry.translate(0, P / 2 + 8, 0);      // the camera's shelf at the front (holes at y = plate/2 + 8, as the part's frames say)
  } else if (d.kind === 'board') {
    const [l, w] = d.board.sizeMm, side = Math.max(d.pattern[0] + 6, Math.min(l, w) - 2), pcb = d.board.kind === 'esc' ? C.esc : C.fc;
    plate(holes(rrect(side, side, 2), sq(...d.pattern), d.hd / 2), 1.6, 0, pcb, { rough: 0.4 });
    add(new THREE.BoxGeometry(7, 7, 1.2), 0, -2, 1.6 + 0.6, C.chip);                                                                                  // the processor
    add(new THREE.BoxGeometry(8, 6, 3), 0, side / 2 - 2, 1.6 + 1.5, C.usb, { metal: 0.8, rough: 0.3 });                                                  // USB port
    if (d.board.kind !== 'fc') { add(new THREE.BoxGeometry(side * 0.7, 4, 3), 0, -side / 2 + 4, 1.6 + 1.5, C.chip); const cap = new THREE.CylinderGeometry(3.4, 3.4, 8, 20); cap.rotateX(Math.PI / 2); add(cap, side * 0.3, 0, 1.6 + 4, 0x2a2e33, { metal: 0.5 }); }   // MOSFET row and a big capacitor
  } else if (d.kind === 'camera') {
    const [l, w, h] = d.sizeMm; add(new THREE.BoxGeometry(l, w, h * 0.7), 0, 0, h * 0.35, C.camBody);                                               // the body
    add(new THREE.CylinderGeometry(l * 0.34, l * 0.34, w * 0.6, 28), 0, w * 0.4, h * 0.5, C.lens, { metal: 0.8, rough: 0.3 });                           // the lens barrel, pointing forward (+Y)
    const glass = new THREE.CircleGeometry(l * 0.26, 28); glass.rotateX(-Math.PI / 2); add(glass, 0, w * 0.7 + 0.1, h * 0.5, C.glass, { metal: 0.2, rough: 0.1 });
  } else if (d.kind === 'standoff') { const s = new THREE.Shape(); s.absarc(0, 0, d.r, 0, Math.PI * 2, false); const h = new THREE.Path(); h.absarc(0, 0, d.hd / 2, 0, Math.PI * 2, true); s.holes.push(h); plate(s, d.h, 0, C.brass, { metal: 0.8, rough: 0.3 }); }
  return g;
}
