// The flight controller side of the drone. DOM-free.
//   tuneFor(model)   gains worked out from the drone's own weight, size and motors, so any drone built in the Assembly view starts with a controller that suits it.
//   mixerFor(model)  how roll, pitch and yaw commands turn into motor outputs for THIS drone's motor layout (not just an X quad: any count, any arrangement).
//   SketchController runs a flight-controller program written in Arduino style (setup() once, loop() every millisecond). The built-in controller is that same program
//                    (STARTER_SKETCH), so what flies is exactly what you can read, change and fly again.
// The program runs in this page, as your own code. Do not run a sketch that someone else sent you without reading it first.
import { G, RHO, steadyOmega, thrustAt, dragTorqueAt, thrustCurve } from './drone-sim.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Roll / pitch / yaw → one coefficient per motor. Positive roll = right side down, positive pitch = nose up, positive yaw = turn left (counter-clockwise from above). */
export function mixerFor(model) {
  const rho = Math.max(1e-6, ...model.motors.map(m => Math.hypot(m.r[0], m.r[1])));
  return model.motors.map(m => ({ roll: -m.r[0] / rho, pitch: m.r[1] / rho, yaw: -m.spin }));
}

/** Gains in "mixer units per rad/s", worked out so the turn-rate loop is about as quick as 0.05 s (0.12 s for yaw), with a climb gain and the throttle that hovers. */
export function tuneFor(model, volts = model.battery.volts) {
  const N = model.motors.length, mix = mixerFor(model), rho = Math.max(1e-6, ...model.motors.map(m => Math.hypot(m.r[0], m.r[1])));
  const hoverF = model.massKg * G / N, table = model.motors.map((_, i) => thrustCurve(model, i, volts)), uOf = (i, F) => { const T = table[i]; let k = 0; while (k < T.length - 2 && T[k + 1] < F) k++; const f = (F - T[k]) / Math.max(1e-9, T[k + 1] - T[k]); return clamp((k + f) / (T.length - 1), 0, 1); };
  const uh = model.motors.reduce((s, _, i) => s + uOf(i, hoverF), 0) / N, du = 0.04;
  const slope = model.motors.reduce((s, m, i) => { const a = clamp(uh - du, 0, 1), b = clamp(uh + du, 0, 1); return s + (table[i][Math.round(b * 32)] - table[i][Math.round(a * 32)]) / Math.max(1e-6, b - a); }, 0) / N;      // N of thrust per unit of throttle, at the hover throttle
  const kq = model.motors.reduce((s, m) => s + (m.prop.cp * m.prop.diameterIn * 0.0254) / (2 * Math.PI * m.prop.ct), 0) / N;
  // the torque one unit of each mixer command makes about each body axis
  const A = { roll: 0, pitch: 0, yaw: 0 };
  model.motors.forEach((m, i) => { A.roll += slope * mix[i].roll * -m.r[0]; A.pitch += slope * mix[i].pitch * m.r[1]; A.yaw += slope * kq; });
  A.roll = Math.max(A.roll, slope * N * rho * 0.05); A.pitch = Math.max(A.pitch, slope * N * rho * 0.05);          // (a layout with no arm on an axis still gets a finite gain)
  const I = model.inertia, kp = { roll: 1 / 0.05, pitch: 1 / 0.05, yaw: 1 / 0.12 }, inertia = { roll: I[1], pitch: I[0], yaw: I[2] }, out = {};
  for (const ax of ['roll', 'pitch', 'yaw']) { const p = inertia[ax] * kp[ax] / Math.max(1e-9, A[ax]); out[ax] = { p, i: p * 4, d: p * 0.003 }; }
  const tauV = 0.5; out.hover = uh; out.climb = model.massKg / (N * Math.max(1e-6, slope) * tauV);
  return out;
}

/** The mixer a sketch calls: thr 0–1 plus roll / pitch / yaw in the same units (1 = the whole throttle range). Never lets one motor go over full or under idle if it can shift the rest instead. */
export function quadMix(model, thr, roll, pitch, yaw, idle = 0.04) {
  const mix = mixerFor(model), out = mix.map(c => thr + roll * c.roll + pitch * c.pitch + yaw * c.yaw);
  let hi = Math.max(...out), lo = Math.min(...out);
  if (hi - lo > 1 - idle) { const mid = (hi + lo) / 2, s = (1 - idle) / (hi - lo); for (let i = 0; i < out.length; i++) out[i] = mid + (out[i] - mid) * s; hi = Math.max(...out); lo = Math.min(...out); }
  if (hi > 1) for (let i = 0; i < out.length; i++) out[i] -= hi - 1;
  if (lo < idle) { const d = idle - Math.min(...out); for (let i = 0; i < out.length; i++) out[i] += d; }
  return out.map(v => clamp(v, 0, 1));
}

/** The program the built-in controller runs. Everything in it is ordinary code you can change. */
export const STARTER_SKETCH = `// Flight controller. loop() runs every millisecond, like an Arduino's loop().
// Axes: x = right, y = forward, z = up.  Roll is right-side-down positive, pitch is nose-up positive.
// gyro() is in degrees per second, accel() in g, altitude() in metres, motors take 0 (stopped) to 1 (full).

const t = tune();                          // gains worked out for THIS drone from its weight, size and motors
const KP = 1, KI = 1, KD = 1;              // 1 = as worked out. Try 0.5 or 2 and fly again to see what each does.
const ANGLE_MAX = 45, RATE_MAX = 600, YAW_RATE = 200, LEVEL_P = 6;

let roll = 0, pitch = 0;                    // our own estimate of the tilt, in degrees
let iR = 0, iP = 0, iY = 0, dR = 0, dP = 0, dY = 0, lgx = 0, lgy = 0, lgz = 0;
let alt0 = 0, climb = 0, iT = 0;

function setup() {
  Serial.println('Flight controller ready: ' + motorCount + ' motors');
}

function loop() {
  const g = gyro(), a = accel(), r = rc();

  // 1. Tilt: add up the gyro (good for a moment), then pull gently toward the direction gravity points (good for a long time).
  roll += g.y * dt;  pitch += g.x * dt;
  // (A quad's accelerometer feels its own thrust, which always points along its body, so it only tells the truth when the drone is not speeding up or slowing down.
  //  That is why the pull is gentle, and only used when the reading is close to 1 g.)
  const mag = Math.hypot(a.x, a.y, a.z);
  if (mag > 0.95 && mag < 1.05) {
    roll += (degrees(Math.atan2(-a.x, a.z)) - roll) * 0.0001;
    pitch += (degrees(Math.atan2(a.y, a.z)) - pitch) * 0.0001;
  }

  // 2. Not armed: motors off, and forget what we were doing.
  if (!r.armed) {
    iR = iP = iY = iT = 0; alt0 = altitude(); climb = 0;
    for (let i = 0; i < motorCount; i++) writeMotor(i, 0);
    return;
  }

  // 3. What the pilot wants: turn rates about each axis (degrees per second).
  let wantX, wantY;
  if (r.mode === 'acro') { wantY = r.roll * RATE_MAX; wantX = -r.pitch * RATE_MAX; }
  else { wantY = LEVEL_P * (r.roll * ANGLE_MAX - roll); wantX = LEVEL_P * (-r.pitch * ANGLE_MAX - pitch); }
  const wantZ = -r.yaw * YAW_RATE;
  wantX = constrain(wantX, -RATE_MAX, RATE_MAX);  wantY = constrain(wantY, -RATE_MAX, RATE_MAX);

  // 4. Throttle. In hold-height mode the stick sets the climb speed (centre = hold still).
  // Raw throttle goes through a curve, so the middle of the stick is the throttle that hovers (like a real radio's throttle curve) and the top is about twice that.
  const hv = t.hover, top = Math.min(1, hv * 2.2);
  let thr = r.throttle < 0.5 ? r.throttle * 2 * hv : hv + (r.throttle - 0.5) * 2 * (top - hv);
  if (r.mode === 'althold') {
    const alt = altitude();
    climb += ((alt - alt0) / dt - climb) * 0.03;  alt0 = alt;
    let want = (r.throttle - 0.5) * 2 * 3;                        // up to 3 m/s
    if (Math.abs(want) < 0.25) want = 0;
    if (alt < 0.04 && want <= 0) { thr = 0; iT = 0; }
    else {
      iT = constrain(iT + (want - climb) * t.climb * 0.8 * dt, -0.15, 0.25);
      const tilt = Math.max(0.5, Math.cos(radians(Math.hypot(roll, pitch))));
      thr = (t.hover + iT + (want - climb) * t.climb) / tilt;
    }
  }

  // 5. Turn rates: compare with what the gyro says, and push the motors to close the gap (P on the error, I over time, D on the gyro).
  const eR = radians(wantY - g.y), eP = radians(wantX - g.x), eY = radians(wantZ - g.z);
  iR = constrain(iR + eR * dt, -0.6, 0.6);  iP = constrain(iP + eP * dt, -0.6, 0.6);  iY = constrain(iY + eY * dt, -0.6, 0.6);
  dR += (-(g.y - lgy) / dt - dR) * 0.2;  dP += (-(g.x - lgx) / dt - dP) * 0.2;  dY += (-(g.z - lgz) / dt - dY) * 0.2;
  lgx = g.x;  lgy = g.y;  lgz = g.z;
  const rollCmd  = KP * t.roll.p  * eR + KI * t.roll.i  * iR + KD * t.roll.d  * radians(dR);
  const pitchCmd = KP * t.pitch.p * eP + KI * t.pitch.i * iP + KD * t.pitch.d * radians(dP);
  const yawCmd   = KP * t.yaw.p   * eY + KI * t.yaw.i   * iY;

  // 6. Mix: turn "roll, pitch, yaw, throttle" into one output per motor.
  const m = quadMix(thr, rollCmd, pitchCmd, yawCmd);
  for (let i = 0; i < motorCount; i++) writeMotor(i, m[i]);
}
`;

/** Compiles and runs a sketch. One instance per flight. */
export class SketchController {
  constructor(code, model) {
    this.model = model; this.code = code; this.log = []; this.error = null; this.out = model.motors.map(() => 1000); this.time = 0; this.sensors = null; this.rcv = null; this.started = false;
    this._tune = null;
    const lastLog = [], say = (...a) => { if (this.log.length < 400) this.log.push(a.map(v => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : String(v))).join(' ')); };
    const api = {
      dt: 0.001, motorCount: model.motors.length, PI: Math.PI, DEG_TO_RAD: Math.PI / 180,
      gyro: () => ({ x: this.sensors.gyro[0] * 180 / Math.PI, y: this.sensors.gyro[1] * 180 / Math.PI, z: this.sensors.gyro[2] * 180 / Math.PI }),
      accel: () => ({ x: this.sensors.accel[0], y: this.sensors.accel[1], z: this.sensors.accel[2] }),
      altitude: () => this.sensors.altitude, voltage: () => this.sensors.volts, current: () => this.sensors.amps,
      rc: () => this.rcv, armed: () => this.rcv.armed,
      writeMotor: (i, v) => { if (i >= 0 && i < this.out.length) this.out[i] = Number.isFinite(v) && v > 0 ? 1050 + 950 * Math.min(1, v) : 1000; },
      writeMicroseconds: (i, us) => { if (i >= 0 && i < this.out.length) this.out[i] = clamp(Number.isFinite(us) ? us : 1000, 800, 2200); },
      tune: () => (this._tune ||= tuneFor(model)), quadMix: (thr, r, p, y) => quadMix(model, thr, r, p, y),
      micros: () => Math.round(this.time * 1e6), millis: () => Math.round(this.time * 1e3),
      constrain: (x, a, b) => clamp(x, a, b), map: (x, a, b, c, d) => c + (x - a) * (d - c) / (b - a), radians: d => d * Math.PI / 180, degrees: r => r * 180 / Math.PI,
      Serial: { println: (...a) => say(...a), print: (...a) => say(...a), begin: () => {} },
    };
    const names = Object.keys(api), blocked = ['window', 'document', 'globalThis', 'self', 'fetch', 'localStorage', 'sessionStorage', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'indexedDB', 'navigator'];
    try {
      const fn = new Function(...names, ...blocked, `"use strict";\n${code}\n;return { setup: typeof setup === 'function' ? setup : null, loop: typeof loop === 'function' ? loop : null };`);
      const prog = fn(...names.map(n => api[n]), ...blocked.map(() => undefined)); this.prog = prog;
      if (!prog.loop) this.error = 'The sketch has no loop() function.';
    } catch (e) { this.error = `${e.name}: ${e.message}`; }
  }
  /** One 1 ms tick: give it what the sensors and the radio say; get the pulse (µs) for each ESC. */
  tick(sensors, rc, time) {
    if (this.error) return this.out.map(() => 1000);
    this.sensors = sensors; this.rcv = rc; this.time = time; this.out = this.out.map(() => 1000);
    try { if (!this.started) { this.started = true; this.prog.setup?.(); } this.prog.loop(); }
    catch (e) { this.error = `${e.name}: ${e.message}`; return this.out.map(() => 1000); }
    return this.out;
  }
}
export { RHO, steadyOmega, thrustAt, dragTorqueAt };
