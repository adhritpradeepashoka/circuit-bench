// The sketch that drives a robot in the Test tab (a dog, a car, an arm…). It is JavaScript that looks like an Arduino sketch: setup() once, loop() every 10 ms.
// It sees what the real board would: joint angles (an encoder or servo feedback), the body's tilt and spin (an IMU) and the keys, and it can only do what a board
// can: write a servo angle or a motor speed. Everything it may call is listed in `api`; the page's own objects (window, fetch, storage…) are hidden from it.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v)), num = v => (Number.isFinite(v) ? v : 0);
export const CONTROL_DT = 0.01;

export const STARTER_ROBOT_SKETCH = `// Every joint follows its slider on the right. Servos go to an angle within their limits; wheels spin at the slider's speed.
// The arrow keys / WASD also drive wheeled robots: Up/Down = forward/back, Left/Right = turn.
// Everything you can use:
//   jointCount, jointName(i), isMotor(i), minAngle(i), maxAngle(i), jointSide(i)   about each joint (side: + left, - right of the middle)
//   servoWrite(i, degrees)   motorWrite(i, -1..1)                                  move a joint
//   angle(i), speed(i)                                                            where a joint is, in degrees and degrees per second
//   imu()  -> roll, pitch, yaw (degrees)  gx, gy, gz (degrees per second)  ax, ay, az (m/s²)       height()  -> metres off the floor
//   input() -> drive, turn, strafe, lift (keys or sticks, -1..1)     slider(i) -> -1..1     millis(), Serial.println(...)
function setup() {}

function loop() {
  const k = input();
  for (let i = 0; i < jointCount; i++) {
    if (isMotor(i)) {
      const turn = jointSide(i) > 0 ? k.turn : -k.turn;
      motorWrite(i, constrain(slider(i) + k.drive + turn, -1, 1));
    } else {
      const mid = (minAngle(i) + maxAngle(i)) / 2, half = (maxAngle(i) - minAngle(i)) / 2;
      servoWrite(i, mid + slider(i) * half);
    }
  }
}
`;

export class RobotController {
  /** @param code the sketch  @param model from robotFromAssembly  */
  constructor(code, model) {
    this.model = model; this.log = []; this.error = null; this.writes = model.joints.map(() => null); this.state = null; this.time = 0; this.started = false;
    const say = (...a) => { if (this.log.length < 400) this.log.push(a.map(v => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : String(v))).join(' ')); };
    const J = model.joints, at = i => J[Math.round(i)];
    const api = {
      dt: CONTROL_DT, PI: Math.PI, jointCount: J.length,
      jointName: i => at(i)?.name || '', isMotor: i => at(i)?.mode === 'motor', isFree: i => at(i)?.mode === 'free', jointSide: i => num(at(i)?.side),
      minAngle: i => (at(i)?.range ? at(i).range[0] : -180), maxAngle: i => (at(i)?.range ? at(i).range[1] : 180),
      servoWrite: (i, deg) => { const j = at(i); if (j && j.mode === 'servo' && Number.isFinite(deg)) this.writes[Math.round(i)] = deg; },
      motorWrite: (i, v) => { const j = at(i); if (j && j.mode === 'motor' && Number.isFinite(v)) this.writes[Math.round(i)] = clamp(v, -1, 1); },
      angle: i => num(this.state?.angles[Math.round(i)]), speed: i => num(this.state?.speeds[Math.round(i)]),
      imu: () => ({ ...this.state.imu }), height: () => this.state.imu.height, input: () => ({ ...this.state.input }), slider: i => num(this.state?.sliders[Math.round(i)]),
      micros: () => Math.round(this.time * 1e6), millis: () => Math.round(this.time * 1e3),
      constrain: (x, a, b) => clamp(x, a, b), map: (x, a, b, c, d) => c + (x - a) * (d - c) / (b - a), radians: d => d * Math.PI / 180, degrees: r => r * 180 / Math.PI,
      Serial: { println: (...a) => say(...a), print: (...a) => say(...a), begin: () => {} },
    };
    const names = Object.keys(api), blocked = ['window', 'document', 'globalThis', 'self', 'fetch', 'localStorage', 'sessionStorage', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'indexedDB', 'navigator'];
    try {
      const fn = new Function(...names, ...blocked, `"use strict";\n${code}\n;return { setup: typeof setup === 'function' ? setup : null, loop: typeof loop === 'function' ? loop : null };`);
      this.prog = fn(...names.map(n => api[n]), ...blocked.map(() => undefined));
      if (!this.prog.loop) this.error = 'The sketch has no loop() function.';
    } catch (e) { this.error = `${e.name}: ${e.message}`; }
  }
  /** One control step: what the sensors say now → the new command for each joint (null = leave it). */
  tick(state, time) {
    this.state = state; this.time = time; this.writes = this.writes.map(() => null);
    if (this.error) return this.writes;
    try { if (!this.started) { this.started = true; this.prog.setup?.(); } this.prog.loop(); }
    catch (e) { this.error = `${e.name}: ${e.message}`; }
    return this.writes;
  }
}
