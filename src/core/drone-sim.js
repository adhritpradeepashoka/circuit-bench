// A rigid-body multirotor simulator, built from an assembled drone. DOM-free (runs and is tested in Node). SI units inside; the assembly's millimetres are converted once.
//   droneFromAssembly(asm)  reads the parts: where each motor sits, which way it pushes, which prop is on it, the weight, where the middle of the weight is, how hard it is to turn.
//   DroneSim                steps the physics: ESC → motor → prop → thrust and torque → body → ground. Every number comes from core/drone.js, so it is as good as those estimates.
// What is simulated: thrust ∝ rpm², prop drag torque and its reaction on the body, the spin-up of the rotor (which is what gives yaw its punch), battery voltage sag and
// draining, air drag, a springy floor with friction. What is NOT: ground effect, prop wash, wind, the props flexing, motor heating, and desync. Say so wherever results are shown.
import { rotate, place, worldFrame } from './assembly-scene.js';
import { MOTOR_SIZES, makeMotor, makeProp, makeBattery, BOARDS } from './drone.js';

export const G = 9.80665, RHO = 1.225, DT = 0.001, RPM = Math.PI / 30, REST = 0.002;      // REST: how far the springy floor lets it sink when parked
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const conj = q => [-q[0], -q[1], -q[2], q[3]];
const rotInv = (q, v) => rotate(conj(q), v);

/** A LiPo cell's resting voltage against how much charge is left (typical curve): 4.2 V full, about 3.7 V halfway, 3.3 V nearly flat. */
export function cellVolts(left) {
  const t = [[0, 3.0], [0.05, 3.3], [0.2, 3.55], [0.5, 3.75], [0.8, 4.0], [1, 4.2]], f = clamp(left, 0, 1);
  for (let k = 1; k < t.length; k++) if (f <= t[k][0]) return t[k - 1][1] + (t[k][1] - t[k - 1][1]) * (f - t[k - 1][0]) / (t[k][0] - t[k - 1][0]);
  return 4.2;
}

/** The speed a motor settles at for a given voltage across it, where the motor's torque equals the prop's drag: a·w² + (kt²/R)·w + kt·i0 − kt·v/R = 0. Exact. */
export function steadyOmega(motor, prop, volts) {
  const D = prop.diameterIn * 0.0254, kt = 1 / (motor.kv * RPM), R = motor.resistance, a = (prop.cp / (2 * Math.PI)) * RHO * D ** 5 / (4 * Math.PI ** 2), b = kt * kt / R, c = kt * motor.noLoadAmps - kt * volts / R;
  if (c >= 0) return 0;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}
export const thrustAt = (prop, omega) => { const D = prop.diameterIn * 0.0254, n = omega / (2 * Math.PI); return prop.ct * RHO * n * n * D ** 4; };
export const dragTorqueAt = (prop, omega) => { const D = prop.diameterIn * 0.0254, n = omega / (2 * Math.PI); return (prop.cp / (2 * Math.PI)) * RHO * n * n * D ** 5; };

/* ── reading an assembly ── */
const centreOfPart = (part) => [0, 0, (part.dims?.size?.[2] || 0) / 2];                 // models are centred in X and Y and rest on z = 0
/** The points of a part that can touch the floor, in the part's own space (mm). */
function feetOf(part) {
  const d = part.drone; if (d?.kind === 'prop') return [];
  if (d?.kind === 'frame') return [...d.tips.map(([, x, y]) => [x, y, 0]), [d.plate / 2, d.plate / 2, 0], [-d.plate / 2, d.plate / 2, 0], [-d.plate / 2, -d.plate / 2, 0], [d.plate / 2, -d.plate / 2, 0]];
  const s = part.dims?.size; if (!s) return [];
  return [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([x, y]) => [x * s[0] / 2, y * s[1] / 2, 0]);
}
const inertiaOf = (parts) => {                                                                             // [[m, r:[x,y,z], box:[a,b,c]]] about the middle of the weight
  const I = [0, 0, 0, 0, 0, 0];                                                                           // xx yy zz xy xz yz
  for (const [m, r, [a, b, c]] of parts) {
    const rr = dot(r, r); I[0] += m * (rr - r[0] * r[0]) + m * (b * b + c * c) / 12; I[1] += m * (rr - r[1] * r[1]) + m * (a * a + c * c) / 12; I[2] += m * (rr - r[2] * r[2]) + m * (a * a + b * b) / 12;
    I[3] -= m * r[0] * r[1]; I[4] -= m * r[0] * r[2]; I[5] -= m * r[1] * r[2];
  }
  return I;
};
const invert3 = ([xx, yy, zz, xy, xz, yz]) => {
  const m = [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]], c = [[m[1][1] * m[2][2] - m[1][2] * m[2][1], m[0][2] * m[2][1] - m[0][1] * m[2][2], m[0][1] * m[1][2] - m[0][2] * m[1][1]], [m[1][2] * m[2][0] - m[1][0] * m[2][2], m[0][0] * m[2][2] - m[0][2] * m[2][0], m[0][2] * m[1][0] - m[0][0] * m[1][2]], [m[1][0] * m[2][1] - m[1][1] * m[2][0], m[0][1] * m[2][0] - m[0][0] * m[2][1], m[0][0] * m[1][1] - m[0][1] * m[1][0]]];
  const det = m[0][0] * c[0][0] + m[0][1] * c[1][0] + m[0][2] * c[2][0]; return c.map(r => r.map(v => v / det));
};
const mulM = (M, v) => [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]];

/**
 * Everything the simulator needs to know about an assembled drone, or why it can't fly yet.
 * Motors count only if a prop is joined to them; parts not joined to the drone are left out (and reported).
 */
export function droneFromAssembly(asm) {
  const drone = asm.instances.filter(i => i.part.drone), kindOf = k => drone.filter(i => i.part.drone.kind === k);
  const motorsAll = kindOf('motor'); if (!motorsAll.length) return { ok: false, error: 'Add motors (and props, a frame and a battery) in the Assembly view first.' };
  const seed = kindOf('frame')[0] || motorsAll.slice().sort((a, b) => asm.component(b.id).length - asm.component(a.id).length)[0], inGroup = new Set(asm.component(seed.id)), notes = [];
  const left = asm.instances.filter(i => !inGroup.has(i.id)); if (left.length) notes.push(`${left.length} part${left.length > 1 ? 's are' : ' is'} not joined to the drone and ${left.length > 1 ? 'are' : 'is'} left out: ${left.map(i => i.part.name).join(', ')}.`);
  const mine = asm.instances.filter(i => inGroup.has(i.id)), motorList = motorsAll.filter(i => inGroup.has(i.id));
  const rows = [];
  for (const m of motorList) {
    const link = asm.matesOf(m.id).map(x => asm.get(x.a.inst === m.id ? x.b.inst : x.a.inst)).find(o => o?.part.drone?.kind === 'prop');
    const sf = m.part.frames.find(f => f.id === 'shaft'), w = worldFrame(m, sf);
    rows.push({ inst: m, prop: link || null, pos: mul(w.pos, 1e-3), axis: w.dir });
  }
  const live = rows.filter(r => r.prop); if (!live.length) return { ok: false, error: 'No motor has a prop on it. Join a prop’s bore-bottom to a motor’s shaft.' };
  const bat = kindOf('battery').find(i => inGroup.has(i.id)); if (!bat) return { ok: false, error: 'Add a battery and join it to the frame.' };
  // weight and centre
  const masses = mine.map(i => { const g = (i.part.mass?.grams || 0) / 1000, c = place(i.T, centreOfPart(i.part)); return { inst: i, m: g, c: mul(c, 1e-3), box: (i.part.dims?.size || [0, 0, 0]).map(v => v * 1e-3) }; });
  const wire = 0.005, total = masses.reduce((s, x) => s + x.m, 0) + wire;
  const com = mul(masses.reduce((s, x) => add(s, mul(x.c, x.m)), [0, 0, 0]), 1 / (total - wire));
  const I = inertiaOf([...masses.map(x => [x.m, sub(x.c, com), x.box]), [wire, [0, 0, 0], [0.03, 0.03, 0.01]]]);
  // feet and the floor
  const feetW = []; for (const i of mine) for (const f of feetOf(i.part)) feetW.push(mul(place(i.T, f), 1e-3));
  const zmin = Math.min(...feetW.map(p => p[2]), ...live.map(r => r.pos[2] - 0.01));
  // the way the motors push, and which way each prop turns (neighbours opposite: sorted around the middle and alternated)
  const motors = live.map(r => ({ ...r, r: sub(r.pos, com) }));
  const order = motors.map((m, k) => [Math.atan2(m.r[1], m.r[0]), k]).sort((a, b) => a[0] - b[0]);
  order.forEach(([, k], n) => { motors[k].spin = n % 2 ? -1 : 1; });
  const up = [0, 0, 1], avgAxis = motors.reduce((s, m) => add(s, m.axis), [0, 0, 0]).map(v => v / motors.length);
  if (dot(avgAxis, up) < 0.9) notes.push('The motors do not point straight up, so this drone will not lift off level. Check how the motors are mounted.');
  const missing = rows.length - live.length; if (missing) notes.push(`${missing} motor${missing > 1 ? 's have' : ' has'} no prop and will just spin its bell.`);
  const bd = bat.part.drone, battery = makeBattery({ cells: bd.cells, mAh: bd.mAh, c: bd.c });
  const cfgs = motors.map(m => { const md = m.inst.part.drone, pd = m.prop.part.drone; return { motor: makeMotor({ size: md.size, kv: md.kv, over: md.over }), prop: makeProp({ diameterIn: pd.dia, pitchIn: pd.pitch, blades: pd.blades }), propMassKg: m.prop.part.mass.grams / 1000 }; });
  const board = mine.find(i => i.part.drone?.kind === 'board' && ['esc', 'aio'].includes(i.part.drone.board?.kind)), escAmps = board ? board.part.drone.board.maxAmps : null;
  const span = Math.max(...motors.map(m => Math.hypot(m.r[0], m.r[1]))), area = Math.PI * span * span;
  return {
    ok: true, notes, massKg: total, com, inertia: I, inertiaInv: invert3(I), battery, escAmps,
    motors: motors.map((m, k) => ({ id: m.inst.id, name: m.inst.part.name, r: m.r, axis: m.axis, spin: m.spin, ...cfgs[k], propId: m.prop.id })),
    feet: feetW.map(p => sub(p, com)), zOffset: com[2] - zmin,
    dragArea: { side: clamp(0.5 * span * 0.08, 0.001, 0.05), top: clamp(0.25 * area, 0.003, 0.2) },                    // Cd·A estimates
    leftOut: left.map(i => i.id),
  };
}

/* ── the electronic speed controller ── */
/** Takes the 1000–2000 µs pulse a flight controller sends, as a real ESC does: it must see the lowest pulse for a moment before it arms, ignores a dead band at the bottom, and
 *  holds back when it is asked for more current than it can take, or when the pack is nearly flat. */
export class Esc {
  constructor({ maxAmps = 35 } = {}) { this.maxAmps = maxAmps; this.reset(); }
  reset() { this.armed = false; this.lowFor = 0; this.output = 0; this.limit = 1; this.status = 'waiting for a low signal to arm'; }
  /** @returns throttle 0–1 to put across the motor */
  update(us, dt, { motorAmps = 0, cellVolts: cv = 4 } = {}) {
    const low = !(us > 1050);
    if (!this.armed) { this.lowFor = low ? this.lowFor + dt : 0; if (this.lowFor >= 0.5) { this.armed = true; this.status = 'armed'; } this.output = 0; return 0; }
    // the limits come in gently (a real ESC does it in a few ms)
    // A real ESC lets a motor run over its rating for a moment (burst) and then backs off slowly. A limit that reacts faster than the flight controller does would cut the very motor the controller is pushing harder, and turn its corrections upside down.
    const wantLimit = motorAmps > this.maxAmps * 1.25 ? clamp(this.limit * (this.maxAmps * 1.25 / motorAmps), 0.2, 1) : 1, cutoff = cv < 3.3 ? clamp((cv - 3.0) / 0.3, 0, 1) : 1;
    this.limit += (Math.min(wantLimit, cutoff) - this.limit) * Math.min(1, dt * (wantLimit < this.limit ? 8 : 20));
    this.status = this.limit < 0.98 ? (cutoff < 1 ? 'battery nearly flat: cutting power' : 'current limit') : 'armed';
    this.output = low ? 0 : clamp((us - 1050) / 950, 0, 1) * this.limit; return this.output;
  }
}

/* ── the simulator ── */
export class DroneSim {
  constructor(model, opts = {}) {
    if (!model?.ok) throw new Error(model?.error || 'No drone.'); this.model = model; this.opts = { avionicsAmps: 1.0, ...opts };
    this.escs = model.motors.map(m => new Esc({ maxAmps: model.escAmps ? model.escAmps : m.motor.maxAmps }));
    const m = model.massKg; this.kFloor = m * G / (4 * 0.002); this.cFloor = 2 * 0.7 * Math.sqrt(this.kFloor * m / 4);
    this.tau = model.motors.map(x => 0.005 * x.prop.diameterIn + 0.005);
    this.J = model.motors.map(x => x.propMassKg * (x.prop.diameterIn * 0.0254 / 2) ** 2 / 3 + 3e-7);          // a prop as thin rods, plus a little for the bell
    this.angularDrag = 0.15 * (model.inertia[0] + model.inertia[1] + model.inertia[2]) / 3;
    this.reset();
  }
  reset() {
    const mo = this.model; this.p = [mo.com[0], mo.com[1], mo.zOffset]; this.v = [0, 0, 0]; this.q = [0, 0, 0, 1]; this.w = [0, 0, 0];
    this.omega = mo.motors.map(() => 0); this.thrust = mo.motors.map(() => 0); this.amps = mo.motors.map(() => 0); this.throttle = mo.motors.map(() => 0);
    this.drawnAh = 0; this.packAmps = 0; this.t = 0; this.landed = true; this.maxSpeed = 0; this.maxAlt = 0; this.crashed = false; this.crashSpeed = 0; this.impact = 0; this.wasTouching = false; this.contact = 0;
    this.accelBody = [0, 0, 1]; this.escs.forEach(e => e.reset()); this.updatePack();
  }
  get battery() { return this.model.battery; }
  /** Fraction of charge left (we treat 95 % of the rated capacity as usable). */
  get left() { return clamp(1 - this.drawnAh / (this.model.battery.mAh / 1000 * 0.95), 0, 1); }
  updatePack() { const b = this.model.battery; this.cell = cellVolts(this.left); this.volts = Math.max(0.5, this.cell * b.cells - this.packAmps * b.resistance); }
  /** Advance one tick (default 1 ms). us = the pulse (µs) sent to each ESC. */
  step(us, dt = DT) {
    const mo = this.model, N = mo.motors.length; let F = [0, 0, 0], Tq = [0, 0, 0], total = this.opts.avionicsAmps;
    this.updatePack(); const perCell = this.volts / mo.battery.cells, vb0 = rotInv(this.q, this.v);
    { const common = Math.min(...this.escs.map(e => e.limit)); for (const e of this.escs) e.limit = common; }      // one current limit for the whole board: backing one motor off alone would fight the flight controller
    for (let i = 0; i < N; i++) {
      const m = mo.motors[i], thr = this.escs[i].update(us[i] ?? 1000, dt, { motorAmps: this.amps[i], cellVolts: perCell }); this.throttle[i] = thr;
      const kt = 1 / (m.motor.kv * RPM), target = thr > 0 ? steadyOmega(m.motor, m.prop, thr * this.volts) : 0, lagUp = this.tau[i], lag = target >= this.omega[i] ? lagUp : lagUp * 1.5, maxAlpha = kt * m.motor.maxAmps * 2 / this.J[i];
      const alpha = clamp((target - this.omega[i]) / lag, -maxAlpha, maxAlpha); this.omega[i] = Math.max(0, this.omega[i] + alpha * dt);
      // air flowing along the shaft (climbing, or falling) takes thrust away: it fades to nothing as the climb speed nears what the prop's pitch can push
      const vax = dot(vb0, m.axis), vpitch = Math.max(1, this.omega[i] / (2 * Math.PI) * m.prop.pitchIn * 0.0254), inflow = clamp(vax / vpitch, 0, 1);
      const th = thrustAt(m.prop, this.omega[i]) * (1 - inflow) * (m.wrongWay ? 0.2 : 1), Q = dragTorqueAt(m.prop, this.omega[i]) * (1 - 0.5 * inflow); this.thrust[i] = th;
      const motorAmps = Math.max(0, m.motor.noLoadAmps * (this.omega[i] > 0 ? 1 : 0) + (Q + this.J[i] * alpha) / kt); this.amps[i] = motorAmps; total += thr * motorAmps;
      F = add(F, mul(m.axis, th)); Tq = add(Tq, cross(m.r, mul(m.axis, th))); Tq = add(Tq, mul(m.axis, -m.spin * (Q + this.J[i] * alpha)));
    }
    this.packAmps = total; this.drawnAh += total * dt / 3600;
    // forces on the body, in the world
    const q = this.q, Fw = rotate(q, F); let a = [Fw[0], Fw[1], Fw[2]];
    const vb = rotInv(q, this.v), da = mo.dragArea, cd = [0.5 * RHO * da.side, 0.5 * RHO * da.side, 0.5 * RHO * da.top];
    const dragB = [-cd[0] * vb[0] * Math.abs(vb[0]), -cd[1] * vb[1] * Math.abs(vb[1]), -cd[2] * vb[2] * Math.abs(vb[2])], dragW = rotate(q, dragB); a = add(a, dragW);
    const specificB = rotInv(q, mul(add(Fw, dragW), 1 / mo.massKg)); this.accelBody = specificB;
    // the floor
    let touching = 0;
    for (const f of mo.feet) {
      const rw = rotate(q, f), pz = this.p[2] + rw[2]; if (pz >= 0) continue;
      const vp = add(this.v, rotate(q, cross(this.w, f))), depth = -pz, N_ = Math.max(0, this.kFloor * depth - this.cFloor * vp[2]); touching++;
      const vt = Math.hypot(vp[0], vp[1]), mu = 0.6 * N_ / Math.max(vt, 0.03), Ft = [-vp[0] * mu, -vp[1] * mu, 0], Fp = [Ft[0], Ft[1], N_];
      a = add(a, Fp); Tq = add(Tq, cross(f, rotInv(q, Fp)));
    }
    this.contact = touching;
    // move
    const acc = add(mul(a, 1 / mo.massKg), [0, 0, -G]); this.v = add(this.v, mul(acc, dt)); this.p = add(this.p, mul(this.v, dt));
    const Iw = [mo.inertia[0] * this.w[0] + mo.inertia[3] * this.w[1] + mo.inertia[4] * this.w[2], mo.inertia[3] * this.w[0] + mo.inertia[1] * this.w[1] + mo.inertia[5] * this.w[2], mo.inertia[4] * this.w[0] + mo.inertia[5] * this.w[1] + mo.inertia[2] * this.w[2]];
    const net = sub(sub(Tq, cross(this.w, Iw)), mul(this.w, this.angularDrag)), wd = mulM(mo.inertiaInv, net); this.w = add(this.w, mul(wd, dt));
    const dq = qmul(this.q, [this.w[0] * 0.5 * dt, this.w[1] * 0.5 * dt, this.w[2] * 0.5 * dt, 0]); let nq = [this.q[0] + dq[0], this.q[1] + dq[1], this.q[2] + dq[2], this.q[3] + dq[3]]; const l = Math.hypot(...nq); this.q = nq.map(x => x / l);
    this.t += dt; const speed = Math.hypot(...this.v); this.maxSpeed = Math.max(this.maxSpeed, speed); this.maxAlt = Math.max(this.maxAlt, this.altitude); this.landed = touching > 0 && speed < 0.3;
    if (touching && !this.wasTouching && this.impact > 6) { this.crashed = true; this.crashSpeed = this.impact; } this.wasTouching = touching > 0; this.impact = Math.max(0, -this.v[2]);
  }
  /** What a flight controller sees: the gyro in rad/s, the accelerometer in g (both in the body's axes), and the height above the floor in metres. */
  sense() { return { gyro: [...this.w], accel: this.accelBody.map(v => v / G), altitude: this.altitude, volts: this.volts, amps: this.packAmps }; }
  get altitude() { return this.p[2] - this.model.zOffset + REST; }
  get tiltDeg() { const u = rotInv(this.q, [0, 0, 1]); return Math.acos(clamp(u[2], -1, 1)) * 180 / Math.PI; }
  get speed() { return Math.hypot(...this.v); }
  get state() {
    const u = rotInv(this.q, [0, 0, 1]);
    return { t: this.t, altitude: this.altitude, speed: this.speed, climb: this.v[2], tilt: this.tiltDeg, roll: Math.atan2(-u[0], u[2]) * 180 / Math.PI, pitch: Math.atan2(u[1], u[2]) * 180 / Math.PI, volts: this.volts, cell: this.volts / this.model.battery.cells, amps: this.packAmps, usedMah: this.drawnAh * 1000, left: this.left,
      rpm: this.omega.map(w => w / RPM), thrustGrams: this.thrust.map(t => t / G * 1000), throttle: [...this.throttle], escStatus: this.escs.map(e => e.status), landed: this.landed, crashed: this.crashed, maxAlt: this.maxAlt, maxSpeed: this.maxSpeed };
  }
}

/** For the flight controller: how much thrust each motor makes at a throttle, at a pack voltage (the controller's model of its own drone). */
export function thrustCurve(model, i, volts, points = 33) {
  const m = model.motors[i], T = []; for (let k = 0; k < points; k++) { const u = k / (points - 1); T.push(thrustAt(m.prop, u > 0 ? steadyOmega(m.motor, m.prop, u * volts) : 0)); } return T;
}
export { MOTOR_SIZES, BOARDS };
