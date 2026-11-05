// The 3D shapes of the everyday robot parts (servos, links, plates, wheels, gear motors …), drawn from each part's numbers (see core/robot-kit.js).
// Z up, centred in X and Y, resting on z = 0, with the same holes the part's frames say. Meshes are flagged `userData.fixed` so each part keeps its real colours.
const C = { servo: 0x2b6cb0, servoDark: 0x1c2733, horn: 0xf5f5f0, steel: 0xdfe3e6, alu: 0xaeb8c0, plate: 0x6b7a86, tire: 0x1b1d20, rim: 0xe6c200, motor: 0xe8b800, gear: 0xd8d8d0, black: 0x15181b, brass: 0xc9a227, holder: 0x2b2f33, red: 0xc23b2f };

export function buildKitMesh(THREE, part) {
  const d = part.kit, g = new THREE.Group();
  const add = (geo, x = 0, y = 0, z = 0, color = C.alu, o = {}) => {
    geo.translate(x, y, z); const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, metalness: o.metal ?? 0.15, roughness: o.rough ?? 0.55, side: THREE.DoubleSide }));
    m.userData.fixed = true; g.add(m); return m;
  };
  const box = (w, l, h, x, y, z0, color, o) => add(new THREE.BoxGeometry(w, l, h), x, y, z0 + h / 2, color, o);
  const cyl = (r, h, z0, color, seg = 36, o = {}, x = 0, y = 0) => { const geo = new THREE.CylinderGeometry(r, r, h, seg); geo.rotateX(Math.PI / 2); return add(geo, x, y, z0 + h / 2, color, o); };
  const cylY = (r, len, x, y0, z, color, o = {}) => { const geo = new THREE.CylinderGeometry(r, r, len, 24); return add(geo, x, y0 + len / 2, z, color, o); };       // along Y
  const rrect = (w, h, r) => { const s = new THREE.Shape(), x = -w / 2, y = -h / 2; r = Math.min(r, w / 2, h / 2); s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s; };
  const holes = (shape, pts, r) => { for (const [x, y] of pts) { const h = new THREE.Path(); h.absarc(x, y, r, 0, Math.PI * 2, true); shape.holes.push(h); } return shape; };
  const plate = (shape, t, z0, color, o) => add(new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 16 }), 0, 0, z0, color, o);

  if (d.kind === 'servo') {
    const s = d.servo, ex = s.earHole / 2;
    box(s.W, s.L, s.H, 0, 0, 0, C.servo, { rough: 0.5 });                                                                                  // the body
    const ears = holes(rrect(s.W, s.ear, 1.5), [[0, ex], [0, -ex]], 1.2); plate(ears, s.earT, s.earZ, C.servo);                                  // mounting ears, with their screw holes
    cyl(s.W * 0.42, 2.2, s.H, C.servoDark, 28, {}, 0, d.yShaft);                                                                            // the round boss round the shaft
    cyl(s.shaftD / 2, s.shaftH, s.H, C.steel, 20, { metal: 0.8, rough: 0.3 }, 0, d.yShaft);                                                  // splined output shaft
    cyl(0.9, 1.2, s.H + s.shaftH - 0.2, C.steel, 12, { metal: 0.8 }, 0, d.yShaft);                                                          // the screw head
    cyl(1.0, 0.1, s.H - 0.1, C.black, 6, {}, 0, -s.L / 2 + 3);
    box(3.5, 1.2, 4, 0, -s.L / 2 - 0.6, s.H * 0.2, C.black); for (const [k, c] of [0x7a4a1a, C.red, 0xe8a200].entries()) box(0.8, 5, 0.8, (k - 1) * 1.1, -s.L / 2 - 3, s.H * 0.2 + 1.5, c);   // the three-wire lead
  } else if (d.kind === 'link') {
    const s = rrect(d.len, d.w, d.w / 2 - 0.1); plate(holes(s, [...d.pts, ...(d.pairs || [])].map(x => [x, 0]), d.hd / 2), d.t, 0, C.alu, { metal: 0.4, rough: 0.45 });
  } else if (d.kind === 'plate') {
    const pts = []; for (let i = 0; i <= d.nx; i++) for (let j = 0; j <= d.ny; j++) pts.push([-d.nx * d.pitch / 2 + i * d.pitch, -d.ny * d.pitch / 2 + j * d.pitch]);
    const sh = holes(rrect(d.w, d.l, 4), [...pts, ...(d.servoHoles || [])], d.hd / 2);
    if (d.opening) { const o = new THREE.Path(), [ow, ol] = d.opening; o.moveTo(-ow / 2, -ol / 2); o.lineTo(ow / 2, -ol / 2); o.lineTo(ow / 2, ol / 2); o.lineTo(-ow / 2, ol / 2); o.closePath(); sh.holes.push(o); }
    plate(sh, d.t, d.feet, C.plate, { metal: 0.3 });
    if (d.feet) for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) cyl(4.5, d.feet, 0, C.holder, 20, { metal: 0.3 }, sx * (d.w / 2 - 7), sy * (d.l / 2 - 7));
  } else if (d.kind === 'bracket') {
    const foot = new THREE.Shape(); foot.moveTo(-d.Lf / 2, -d.wb / 2); foot.lineTo(d.Lf / 2, -d.wb / 2); foot.lineTo(d.Lf / 2, d.wb / 2); foot.lineTo(-d.Lf / 2, d.wb / 2); foot.closePath(); holes(foot, [[d.xh, 0]], d.hd / 2); plate(foot, d.t, 0, C.alu, { metal: 0.4 });
    const upr = new THREE.Shape(); upr.moveTo(0, -d.wb / 2); upr.lineTo(d.hUp, -d.wb / 2); upr.lineTo(d.hUp, d.wb / 2); upr.lineTo(0, d.wb / 2); upr.closePath();     // (u, v) = (height, width), turned upright below
    const o = new THREE.Path(), [ow, ol] = d.open; o.moveTo(d.zc - ol / 2, -ow / 2); o.lineTo(d.zc + ol / 2, -ow / 2); o.lineTo(d.zc + ol / 2, ow / 2); o.lineTo(d.zc - ol / 2, ow / 2); o.closePath(); upr.holes.push(o);
    holes(upr, [[d.zc + d.earHole / 2, 0], [d.zc - d.earHole / 2, 0]], d.hd2 / 2);
    const g2 = new THREE.ExtrudeGeometry(upr, { depth: d.t, bevelEnabled: false }); g2.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));    // (u, v, w) → (w, v, u): height along Z, thickness along X
    add(g2, d.Lf / 2 - d.t, 0, 0, C.alu, { metal: 0.4, rough: 0.45 });
  } else if (d.kind === 'wheel') {
    const R = d.dia / 2, tireT = Math.max(2.5, R * 0.14);
    const tire = new THREE.Shape(); tire.absarc(0, 0, R, 0, Math.PI * 2, false); const inner = new THREE.Path(); inner.absarc(0, 0, R - tireT, 0, Math.PI * 2, true); tire.holes.push(inner); plate(tire, d.wd, 0, C.tire, { rough: 0.9 });
    const disc = new THREE.Shape(); disc.absarc(0, 0, R - tireT + 0.1, 0, Math.PI * 2, false); const bore = new THREE.Path(); bore.absarc(0, 0, d.bore / 2, 0, Math.PI * 2, true); disc.holes.push(bore);
    plate(disc, d.wd * 0.55, d.wd * 0.225, C.rim, { rough: 0.5 });
    const hub = new THREE.Shape(); hub.absarc(0, 0, d.hubR, 0, Math.PI * 2, false); const hb = new THREE.Path(); hb.absarc(0, 0, d.bore / 2, 0, Math.PI * 2, true); hub.holes.push(hb); plate(hub, d.wd, 0, C.rim, { rough: 0.5 });
  } else if (d.kind === 'gearmotor') {
    const m = d.motor, x0 = -m.L / 2, gx = x0 + m.gearbox / 2, mw = m.L - m.gearbox;
    box(m.gearbox, m.W, m.H, gx, 0, 0, C.motor, { rough: 0.6 });                                                                             // the gearbox (yellow, like the real one)
    const cm = new THREE.CylinderGeometry(m.H * 0.46, m.H * 0.46, mw, 28); cm.rotateZ(Math.PI / 2); add(cm, x0 + m.gearbox + mw / 2, 0, m.H / 2, C.alu, { metal: 0.7, rough: 0.35 });   // the can
    for (const sgn of [-1, 1]) cylY(m.shaftD / 2, m.shaftLen, gx, sgn > 0 ? m.W / 2 : -m.W / 2 - m.shaftLen, m.H / 2, C.steel, { metal: 0.8, rough: 0.3 });
    for (const sgn of [-1, 1]) { const sp = m.mountSpacing / 2; const hole = new THREE.CylinderGeometry(d.hd / 2, d.hd / 2, m.H + 0.4, 14); hole.rotateX(Math.PI / 2); add(hole, gx + sgn * sp, 0, m.H / 2, C.black); }       // the screw holes are shown as dark bars
    box(1.2, 4, 3, x0 + m.L + 0.6, 0, m.H / 2 - 1.5, C.brass);
  } else if (d.kind === 'caster') {
    box(34, 24, 3, 0, 0, 12, C.alu, { metal: 0.4 }); cyl(5, 12, 0, C.alu, 24, { metal: 0.6 }, 0, 0);
    const ball = new THREE.SphereGeometry(5.5, 24, 16); add(ball, 0, 0, 5.5, C.steel, { metal: 0.9, rough: 0.25 });
  } else if (d.kind === 'holder') {
    const [l, w, h] = d.sizeMm; box(l, w, h, 0, 0, 0, C.holder);
    const ys = d.cells === 4 ? [-21, -7, 7, 21] : [-7.4, 7.4];
    for (const cy of ys) { const cg = new THREE.CylinderGeometry(6.6, 6.6, l * 0.8, 20); cg.rotateZ(Math.PI / 2); add(cg, 0, cy, h * 0.55 + 0.5, 0xc9ccd1, { metal: 0.7 }); }
  }
  return g;
}
