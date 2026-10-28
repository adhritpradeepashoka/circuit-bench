// Reads ANY assembled robot (a dog, a car, a single limb, an arm…) into a plain description a physics engine can run: rigid bodies, the hinges between
// them, which hinges are driven, masses and shapes. Nothing here knows about drones or any particular robot: bodies come from how the parts are joined
// (core/assembly-pose.js), hinges from the single-screw joints, shapes from each part's own 3D points (or its box when there are none).
// Pure maths, no DOM, no physics engine: units are metres, kilograms, radians out; the assembly's millimetres and degrees in.
import { buildRig } from './assembly-pose.js';
import { worldFrame, place, rotate } from './assembly-scene.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const MM = 1e-3, MAX_POINTS = 160, MIN_MASS = 0.0005;
export const JOINT_MODES = ['servo', 'motor', 'free'];

/** At most `max` of the points (flat x,y,z list), always keeping the ones furthest out in 26 directions, so the shape keeps its corners. */
export function samplePoints(flat, max = MAX_POINTS) {
  const n = Math.floor(flat.length / 3); if (n <= max) return Array.from({ length: n }, (_, i) => [flat[3 * i], flat[3 * i + 1], flat[3 * i + 2]]);
  const keep = new Set(), dirs = []; for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) dirs.push([x, y, z]);
  for (const d of dirs) { let best = -1, bv = -Infinity; for (let i = 0; i < n; i++) { const v = flat[3 * i] * d[0] + flat[3 * i + 1] * d[1] + flat[3 * i + 2] * d[2]; if (v > bv) { bv = v; best = i; } } keep.add(best); }
  const step = Math.max(1, Math.floor(n / (max - keep.size))); for (let i = 0; i < n && keep.size < max; i += step) keep.add(i);
  return [...keep].map(i => [flat[3 * i], flat[3 * i + 1], flat[3 * i + 2]]);
}

/** The eight corners of a part's box in the world (parts are modelled centred in X and Y and resting on z = 0), in mm. */
function boxPoints(inst) {
  const s = inst.part.dims?.size || [10, 10, 10], out = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [0, 1]) out.push(place(inst.T, [x * s[0] / 2, y * s[1] / 2, z * s[2]]));
  return out;
}
const centreMm = inst => place(inst.T, inst.part.com || [0, 0, (inst.part.dims?.size?.[2] || 0) / 2]);
const extentsMm = inst => { const s = inst.part.dims?.size || [10, 10, 10], q = inst.T.q, ax = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(a => rotate(q, a)); return [0, 1, 2].map(k => Math.abs(ax[0][k]) * s[0] + Math.abs(ax[1][k]) * s[1] + Math.abs(ax[2][k]) * s[2]); };

/** Inertia (about the middle of the weight) of boxes: xx yy zz xy xz yz. */
function inertiaOf(items) {
  const I = [0, 0, 0, 0, 0, 0];
  for (const [m, r, [a, b, c]] of items) {
    const rr = dot(r, r); I[0] += m * (rr - r[0] * r[0]) + m * (b * b + c * c) / 12; I[1] += m * (rr - r[1] * r[1]) + m * (a * a + c * c) / 12; I[2] += m * (rr - r[2] * r[2]) + m * (a * a + b * b) / 12;
    I[3] -= m * r[0] * r[1]; I[4] -= m * r[0] * r[2]; I[5] -= m * r[1] * r[2];
  }
  const floor = 2e-9; for (let k = 0; k < 3; k++) I[k] = Math.max(I[k], floor);
  return I;
}

/** Is this body a wheel, seen from the hinge it turns on: round about the hinge, and thinner than it is wide? */
function looksLikeWheel(points, axis, centre) {
  if (points.length < 6) return false;
  const u = Math.abs(axis[0]) < 0.9 ? cross(axis, [1, 0, 0]) : cross(axis, [0, 1, 0]), L = Math.hypot(...u), e1 = mul(u, 1 / L), e2 = cross(axis, e1);
  let lo = Infinity, hi = -Infinity; const r = [];
  for (const p of points) { const d = sub(p, centre); const a = dot(d, axis); lo = Math.min(lo, a); hi = Math.max(hi, a); r.push(Math.hypot(dot(d, e1), dot(d, e2))); }
  const R = Math.max(...r), width = hi - lo; if (R < 1e-6) return false;
  const lat = [0, 0]; for (const p of points) { const d = sub(p, centre); lat[0] = Math.max(lat[0], Math.abs(dot(d, e1))); lat[1] = Math.max(lat[1], Math.abs(dot(d, e2))); }
  return width < R * 1.4 && Math.min(lat[0], lat[1]) > 0.7 * Math.max(lat[0], lat[1]);
}

/**
 * @param asm        the Assembly
 * @param opts.anchorId  a part held still (bolted to the world): the robot is fixed there, like an arm on a bench. Without one the robot is free and is dropped on the floor.
 * @param opts.hullOf    (inst) → flat [x,y,z,…] of the part's 3D points in the world, mm (the viewer supplies them); without it each part is its box
 * @param opts.modes     { [jointKey]: 'servo' | 'motor' | 'free' } what drives each hinge; the default is a servo, or a motor for a wheel
 */
export function robotFromAssembly(asm, { anchorId = null, hullOf = null, modes = {} } = {}) {
  if (!asm.instances.length) return { ok: false, error: 'Nothing is built yet. Add parts in Assembly and join them first.' };
  const rig = buildRig(asm), notes = [];
  const mass = id => Math.max(0, (asm.get(id).part.mass?.grams || 0) / 1000);
  const bodyMass = new Map(); for (const [b, ids] of rig.members) bodyMass.set(b, ids.reduce((s, id) => s + mass(id), 0));
  // the root: the body that is held still, else the heaviest one (a dog's trunk, a car's chassis)
  const anchorBody = anchorId && asm.get(anchorId) ? rig.bodyOf(anchorId) : null;
  const root = anchorBody ?? [...bodyMass].sort((a, b) => b[1] - a[1])[0][0], fixedBase = anchorBody != null;
  // the tree of hinges out from the root; anything not reached is left out, and a hinge that would close a loop is reported
  const order = [root], up = new Map([[root, null]]), loops = [];
  for (let k = 0; k < order.length; k++) for (const j of rig.joints) {
    for (const [x, y, childIsB] of [[j.a, j.b, true], [j.b, j.a, false]]) if (x === order[k]) { if (!up.has(y)) { up.set(y, { joint: j, parent: x, childIsB }); order.push(y); } else if (up.get(y)?.joint !== j && up.get(x)?.joint !== j && !loops.includes(j)) loops.push(j); }
  }
  const leftOut = [...rig.members].filter(([b]) => !up.has(b)).flatMap(([, ids]) => ids);
  if (leftOut.length) notes.push(`${leftOut.length} part${leftOut.length > 1 ? 's are' : ' is'} not joined to the rest and ${leftOut.length > 1 ? 'are' : 'is'} left out: ${leftOut.map(id => asm.get(id).part.name).join(', ')}.`);
  if (loops.length) notes.push(`${loops.length} hinge${loops.length > 1 ? 's close' : ' closes'} a loop (a linkage); ${loops.length > 1 ? 'they are' : 'it is'} left loose in the physics for now.`);

  const bodies = [], index = new Map(), allPts = [];
  for (const b of order) {
    const ids = rig.members.get(b), insts = ids.map(id => asm.get(id)), mt = insts.map(i => Math.max(mass(i.id), 0)), total = Math.max(mt.reduce((s, v) => s + v, 0), MIN_MASS);
    const cs = insts.map(i => mul(centreMm(i), MM)), com = mt.reduce((s, m, k) => add(s, mul(cs[k], m || total / insts.length / 1000)), [0, 0, 0]), wsum = mt.reduce((s, m) => s + (m || total / insts.length / 1000), 0), c = mul(com, 1 / wsum);
    const inertia = inertiaOf(insts.map((i, k) => [mt[k] || MIN_MASS, sub(cs[k], c), extentsMm(i).map(v => v * MM)]));
    const pts = []; for (const i of insts) { const raw = hullOf?.(i); const w = raw && raw.length >= 12 ? samplePoints(raw) : boxPoints(i); for (const p of w) { const q = mul(p, MM); pts.push(q); allPts.push(q); } }
    const heaviest = insts.slice().sort((a, b2) => mass(b2.id) - mass(a.id))[0];
    index.set(b, bodies.length); bodies.push({ key: b, name: heaviest.part.name.replace(/^Kame32 /, ''), members: ids, mass: total, origin: c, inertia, points: pts, parent: null, joint: null });
  }
  const joints = [];
  for (const body of bodies.slice(1)) {
    const u = up.get(body.key), m = u.joint.mate, wf = (() => { const side = m.a, i = asm.get(side.inst); return worldFrame(i, i.part.frames.find(f => f.id === side.frame)); })();
    const parent = bodies[index.get(u.parent)], axis = (() => { const d = wf.dir, L = Math.hypot(...d) || 1; return mul(d, 1 / L); })(), anchor = mul(wf.pos, MM);
    const key = `${m.a.inst}:${m.a.frame}|${m.b.inst}:${m.b.frame}`, wheel = looksLikeWheel(body.points, axis, anchor), explicit = m.min != null || m.max != null;
    const mode = JOINT_MODES.includes(modes[key]) ? modes[key] : (wheel && !explicit ? 'motor' : 'servo'), lo = (m.min ?? -90) - (m.angle || 0), hi = (m.max ?? 90) - (m.angle || 0);
    body.parent = bodies.indexOf(parent); body.joint = joints.length;
    joints.push({ key, name: `${body.name}${parent ? ` on ${parent.name}` : ''}`, body: bodies.indexOf(body), axis, anchor, range: mode === 'motor' ? null : [lo, hi], mode, wheel, fixed: !!m.fixed });
  }
  // Forward is +Y (the way the drone's arrow points), or +X when the wheels' axles run along Y. A wheel's "positive" is whichever way drives the robot forward, so the same
  // command on every wheel drives straight even though the left and right axles face opposite ways.
  const wheels = joints.filter(j => j.mode === 'motor' && j.wheel), alongX = wheels.length ? wheels.reduce((s, j) => s + Math.abs(j.axis[0]) - Math.abs(j.axis[1]), 0) >= 0 : true, forward = alongX ? [0, 1, 0] : [1, 0, 0];
  for (const j of wheels) { const roll = [j.axis[1], -j.axis[0], 0], d = dot(roll, forward); if (d < -1e-6) j.axis = mul(j.axis, -1); }
  const leftV = [-forward[1], forward[0], 0];                                                                 // up × forward: the robot's left (for a robot facing +Y that is −X)
  for (const j of joints) j.side = dot(sub(j.anchor, bodies[0].origin), leftV);                              // how far each hinge sits to the left (+) or right (−) of the main body, metres
  const massKg = bodies.reduce((s, b) => s + b.mass, 0), zmin = Math.min(...allPts.map(p => p[2])), top = Math.max(...allPts.map(p => p[2]));
  const lift = fixedBase ? 0 : 0.003 - zmin;                                      // a free robot starts just above the floor and is dropped; a held one stays where it is
  if (fixedBase) { if (zmin < -0.001) notes.push('Part of the robot is below the floor. Use “Drop all” in Assembly first.'); }
  if (massKg < 0.002) notes.push('The whole robot weighs almost nothing; check the part masses in Assembly.');
  if (!joints.length) notes.push(fixedBase ? 'Nothing is hinged to the part you are holding still, so nothing can move.' : 'Nothing is hinged: this will just be a rigid object that falls and lands. Join parts by one screw to make a hinge.');
  return { ok: true, notes, fixedBase, forward, lift, floorZ: fixedBase ? Math.min(0, zmin - 0.001) : 0, bodies, joints, massKg, size: { height: top - zmin }, leftOut };
}

/** The MJCF text MuJoCo reads. Bodies sit at their centre of mass with world-aligned axes; shapes are convex hulls of each body's points. */
export function toMJCF(model, { dt = 0.002, floorFriction = 1.0, servo = { stall: 0.18, kp: 1.0, kv: 0.04 }, motor = { stall: 0.12, kv: 0.006 }, armature = 2e-5, damping = 0.002 } = {}) {
  const f = v => (Number.isFinite(v) ? Number(v.toPrecision(7)) : 0), vec = a => a.map(f).join(' '), esc = s => String(s).replace(/[^\w ]/g, '_');
  const assets = [], kids = new Map(); model.bodies.forEach((b, i) => { if (b.parent != null) (kids.get(b.parent) || kids.set(b.parent, []).get(b.parent)).push(i); });
  const lift = [0, 0, model.lift];
  const body = i => {
    const b = model.bodies[i], j = b.joint != null ? model.joints[b.joint] : null, o = add(b.origin, lift), parentO = b.parent != null ? add(model.bodies[b.parent].origin, lift) : [0, 0, 0], rel = sub(o, parentO);
    assets.push(`<mesh name="m${i}" vertex="${b.points.map(p => vec(sub(p, b.origin))).join(' ')}"/>`);
    const I = b.inertia, inner = [];
    if (b.parent == null && !model.fixedBase) inner.push('<freejoint name="root"/>');
    if (j) inner.push(`<joint name="j${b.joint}" type="hinge" axis="${vec(j.axis)}" pos="${vec(sub(add(j.anchor, lift), o))}" ${j.range ? `limited="true" range="${f(j.range[0])} ${f(j.range[1])}"` : ''} armature="${armature}" damping="${j.mode === 'free' ? damping * 0.5 : damping}" frictionloss="${j.mode === 'free' ? 0.0005 : 0}"/>`);
    inner.push(`<inertial pos="0 0 0" mass="${f(b.mass)}" fullinertia="${vec(I)}"/>`, `<geom type="mesh" mesh="m${i}" mass="0" contype="2" conaffinity="1" friction="${f(floorFriction)} 0.005 0.0001" rgba="0.6 0.7 0.8 1"/>`);
    for (const k of kids.get(i) || []) inner.push(body(k));
    return `<body name="b${i}" pos="${vec(rel)}">${inner.join('')}</body>`;
  };
  const rootBody = body(0), act = [];
  for (const [k, j] of model.joints.entries()) {
    if (j.mode === 'servo') act.push(`<position name="a${k}" joint="j${k}" kp="${servo.kp}" kv="${servo.kv}" ctrllimited="true" ctrlrange="${f(j.range[0] * Math.PI / 180)} ${f(j.range[1] * Math.PI / 180)}" forcelimited="true" forcerange="${-servo.stall} ${servo.stall}"/>`);
    else if (j.mode === 'motor') act.push(`<velocity name="a${k}" joint="j${k}" kv="${motor.kv}" ctrllimited="true" ctrlrange="-60 60" forcelimited="true" forcerange="${-motor.stall} ${motor.stall}"/>`);
  }
  return `<mujoco model="robot"><compiler angle="degree" autolimits="true"/><option timestep="${dt}" integrator="implicitfast" gravity="0 0 -9.81"/>
<asset>${assets.join('')}</asset>
<worldbody><geom name="floor" type="plane" pos="0 0 ${f(model.floorZ)}" size="20 20 0.1" contype="1" conaffinity="2" friction="${f(floorFriction)} 0.005 0.0001"/>${rootBody}</worldbody>
<actuator>${act.join('')}</actuator></mujoco>`;
}
