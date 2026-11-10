// Runs a robot described by core/robot-model.js on the MuJoCo physics engine (WebAssembly, loaded the first time it is needed and only on the user's own
// computer, so it costs the server nothing). Servos are position actuators that move no faster than a real hobby servo and push no harder than its stall
// torque; wheels are velocity-driven motors with a torque limit; everything else swings free. The sketch sees angles, the body's tilt and spin, and height.
import { toMJCF } from './robot-model.js';

const RAD = Math.PI / 180, DEG = 180 / Math.PI, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const SERVO_SPEED = 500;                  // deg/s, a typical 9 g servo at 5 V (0.12 s per 60°)
export const WHEEL_RAD_S = 30;                   // rad/s at full command (about 290 rpm, a common geared hobby motor)
export const DT = 0.002;

let loading = null;
/** The engine, loaded once. Rejects with a readable message when the browser cannot run WebAssembly or the file cannot be fetched. */
export function loadMujoco() {
  return (loading ||= import('@mujoco/mujoco').then(m => (m.default || m)()).catch(e => { loading = null; throw new Error(`The physics engine could not be loaded (${e?.message || e}).`); }));
}

export class RobotSim {
  constructor(mj, model, opts = {}) {
    this.mj = mj; this.model = model; this.opts = opts; this.exclude = [];
    this.build(opts.selfCollide === false ? [] : null);
  }
  /** Compile the model. With `exclude` null, parts that already overlap at the start (screwed-together neighbours) are found first and left out of collision. */
  build(exclude) {
    const { mj, model } = this;
    this.xml = toMJCF(model, { dt: DT, ...this.opts, exclude: exclude || [] });
    this.m = mj.MjModel.from_xml_string(this.xml); this.d = new mj.MjData(this.m);
    if (exclude === null) {
      mj.mj_forward(this.m, this.d); this.bid = model.bodies.map((_, i) => mj.mj_name2id(this.m, mj.mjtObj.mjOBJ_BODY.value ?? mj.mjtObj.mjOBJ_BODY, `b${i}`));
      const seen = new Set(), ex = [];
      for (const [a, b] of this.partContacts(-1)) { const key = a + ':' + b; if (!seen.has(key)) { seen.add(key); ex.push([a, b]); } }
      if (ex.length) { this.d.delete(); this.m.delete(); this.exclude = ex; this.xml = toMJCF(model, { dt: DT, ...this.opts, exclude: ex }); this.m = mj.MjModel.from_xml_string(this.xml); this.d = new mj.MjData(this.m); }
    }
    const obj = mj.mjtObj, id = (kind, name) => mj.mj_name2id(this.m, kind.value ?? kind, name);
    this.bid = model.bodies.map((_, i) => id(obj.mjOBJ_BODY, `b${i}`));
    this.jq = model.joints.map((_, k) => { const j = id(obj.mjOBJ_JOINT, `j${k}`); return { q: this.m.jnt_qposadr[j], dof: this.m.jnt_dofadr[j] }; });
    this.act = model.joints.map((_, k) => id(obj.mjOBJ_ACTUATOR, `a${k}`));
    this.free = !model.fixedBase; this.cmd = model.joints.map(() => 0); this.target = model.joints.map(() => 0); this.v0 = [0, 0, 0]; this.acc = [0, 0, 0]; this.t = 0;
    this.reset();
  }
  /** Pairs of robot parts [a, b] (body indices) touching now; `maxDist` −1 means actually overlapping (penetration deeper than 0.1 mm). Floor contacts are left out. */
  partContacts(maxDist = -0.0001) {
    const { d, m } = this, out = [];
    for (let i = 0; i < d.ncon; i++) {
      const c = d.contact.get(i); if (c.dist > (maxDist === -1 ? 0 : maxDist)) continue;
      const b1 = m.geom_bodyid[c.geom1], b2 = m.geom_bodyid[c.geom2], i1 = this.bid.indexOf(b1), i2 = this.bid.indexOf(b2);
      if (i1 >= 0 && i2 >= 0) out.push(i1 < i2 ? [i1, i2] : [i2, i1]);
    }
    return out;
  }
  /** Is hinge k pressed against one of its limits (within 0.5°)? */
  atStop(k) { const j = this.model.joints[k]; if (!j?.range) return 0; const a = this.angle(k); return a <= j.range[0] + 0.5 ? -1 : a >= j.range[1] - 0.5 ? 1 : 0; }
  /** Sweep hinge k through its range with the others at zero and report the angles where parts first press into each other (any pair, including neighbours that
   *  already overlap at the screw: those count once they sink 1.5 mm deeper than they started). Uses its own copy of the model with every collision on. */
  sweep(k, step = 2) {
    const j = this.model.joints[k], { mj } = this; if (!j?.range) return null;
    const xml = toMJCF(this.model, { dt: DT, ...this.opts, selfCollide: true, exclude: [] }), m = mj.MjModel.from_xml_string(xml), d = new mj.MjData(m);
    try {
      const bid = this.model.bodies.map((_, i) => mj.mj_name2id(m, mj.mjtObj.mjOBJ_BODY.value ?? mj.mjtObj.mjOBJ_BODY, `b${i}`)), jq = m.jnt_qposadr[mj.mj_name2id(m, mj.mjtObj.mjOBJ_JOINT.value ?? mj.mjtObj.mjOBJ_JOINT, `j${k}`)];
      const depths = () => { const o = new Map(); for (let i = 0; i < d.ncon; i++) { const c = d.contact.get(i), i1 = bid.indexOf(m.geom_bodyid[c.geom1]), i2 = bid.indexOf(m.geom_bodyid[c.geom2]); if (i1 < 0 || i2 < 0) continue; const key = i1 < i2 ? i1 + ':' + i2 : i2 + ':' + i1; o.set(key, Math.min(o.get(key) ?? 0, c.dist)); } return o; };
      const at = t => { mj.mj_resetData(m, d); d.qpos[jq] = t * RAD; mj.mj_forward(m, d); return depths(); };
      const base = at(0), hit = t => { for (const [key, dist] of at(t)) if (dist < (base.get(key) ?? 0) - (base.has(key) ? 0.0015 : 0.0005)) return key.split(':').map(Number); return null; };
      const run = dir => { const lim = dir > 0 ? j.range[1] : j.range[0]; let last = 0; for (let a = step; a <= Math.abs(lim) + 1e-9; a += step) { const t = dir * a; if (hit(t)) return { angle: last, with: hit(t) }; last = t; } if (Math.abs(lim) > last * dir) { const w = hit(lim); if (w) return { angle: last, with: w }; } return null; };
      const up = run(1), down = run(-1);
      return { min: down ? Math.max(down.angle, j.range[0]) : j.range[0], max: up ? Math.min(up.angle, j.range[1]) : j.range[1], hitUp: up?.with || null, hitDown: down?.with || null };
    } finally { d.delete(); m.delete(); }
  }
  reset() {
    this.mj.mj_resetData(this.m, this.d); this.t = 0; this.cmd.fill(0); this.target.fill(0); this.v0 = [0, 0, 0]; this.acc = [0, 0, 0];
    for (const a of this.act) if (a >= 0) this.d.ctrl[a] = 0;
    this.mj.mj_forward(this.m, this.d);
  }
  /** Command one hinge: a servo takes an angle (degrees, within its range); a wheel takes a speed from −1 to 1; a free hinge ignores it. */
  command(k, v) { const j = this.model.joints[k]; if (!j || !Number.isFinite(v)) return; this.cmd[k] = j.mode === 'servo' ? clamp(v, j.range[0], j.range[1]) : clamp(v, -1, 1); }
  step(n = 1) {
    const { d, m, mj } = this;
    for (let s = 0; s < n; s++) {
      for (const [k, j] of this.model.joints.entries()) {
        const a = this.act[k]; if (a < 0) continue;
        if (j.mode === 'servo') { const want = this.cmd[k], dv = (j.servo?.speed || SERVO_SPEED) * DT; this.target[k] += clamp(want - this.target[k], -dv, dv); d.ctrl[a] = this.target[k] * RAD; }
        else d.ctrl[a] = this.cmd[k] * WHEEL_RAD_S;
      }
      mj.mj_step(m, d); this.t += DT;
    }
    if (this.free) { const v = [d.qvel[0], d.qvel[1], d.qvel[2]], dt = DT * n; this.acc = [(v[0] - this.v0[0]) / dt, (v[1] - this.v0[1]) / dt, (v[2] - this.v0[2]) / dt]; this.v0 = v; }
  }
  /** A body's place in the world, metres and a (x, y, z, w) quaternion. */
  bodyPose(i) { const b = this.bid[i], p = this.d.xpos, q = this.d.xquat; return { pos: [p[3 * b], p[3 * b + 1], p[3 * b + 2]], quat: [q[4 * b + 1], q[4 * b + 2], q[4 * b + 3], q[4 * b]] }; }
  angle(k) { return this.d.qpos[this.jq[k].q] * DEG; }
  speed(k) { return this.d.qvel[this.jq[k].dof] * DEG; }
  /** What a gyro, accelerometer and tilt sensor on the main body would say. */
  imu() {
    const root = this.bodyPose(0), [x, y, z, w] = root.quat;
    const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) * DEG, pitch = Math.asin(clamp(2 * (w * y - z * x), -1, 1)) * DEG, yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * DEG;
    const g = this.free ? [this.d.qvel[3] * DEG, this.d.qvel[4] * DEG, this.d.qvel[5] * DEG] : [0, 0, 0];
    const f = [this.acc[0], this.acc[1], this.acc[2] + 9.81], R = [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]];
    const a = [0, 1, 2].map(r => R[0][r] * f[0] + R[1][r] * f[1] + R[2][r] * f[2]);                  // R transposed times the specific force: in the body's own axes
    return { roll, pitch, yaw, gx: g[0], gy: g[1], gz: g[2], ax: a[0], ay: a[1], az: a[2], height: (root.pos[2] - (this.model.floorZ || 0)), x: root.pos[0], y: root.pos[1], speed: Math.hypot(this.d.qvel[0], this.d.qvel[1]) };
  }
  /** The first body's centre, so a camera can follow it. */
  get centre() { return this.bodyPose(0).pos; }
  dispose() { try { this.d.delete(); this.m.delete(); } catch { /* already gone */ } }
}
