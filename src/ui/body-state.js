// What the simulated body is doing right now, as the 3D views need it: how far each elbow is bent and how hard each muscle is working.
// One shared place, so the dock and the Visualizer always show the same person. The bend comes from, in order: a servo in the running circuit
// (the exoskeleton's own joint), the gesture the trained model recognises, or the muscle itself (the person flexing).
import { subject as person, eventLevels } from '../core/subject.js';
import { elbowFromMuscle, elbowFromServo } from '../core/arm-rig.js';

export const bodyState = {
  /** set by main: () => [{ partId, angle|null }] for the servos in the circuit, and whether the circuit is running */
  servos: () => [], running: () => false,
  /** set by the gesture panel when a model is recognising: { bend: 0..1, name } or null */
  gesture: null, followGesture: false,
  cur: { flexR: 0, flexL: 0, fistR: 0, fistL: 0, elbowR: 0, elbowL: 0 }, last: 0, source: 'muscle', servoAngle: null,
  /** advance the smoothing to the present and return { elbowR, elbowL, glow:{flexR,fistR,flexL,fistL}, source, servoAngle } */
  pose(now = performance.now() / 1000) {
    const dt = Math.min(0.2, Math.max(0, now - (this.last || now))); this.last = now;
    const lv = eventLevels(person, person.now()), c = this.cur, k = 1 - Math.exp(-dt * 9);
    for (const m of ['flexR', 'flexL', 'fistR', 'fistL']) c[m] += (Math.min(1, lv[m]) - c[m]) * k;
    const servo = this.running() ? this.servos().find(s => s.angle != null) : null;
    let target, source = 'muscle';
    if (servo) { target = elbowFromServo(servo.angle); source = 'servo'; this.servoAngle = servo.angle; }
    else if (this.followGesture && this.gesture) { target = elbowFromMuscle(this.gesture.bend); source = 'gesture'; this.servoAngle = null; }
    else { target = elbowFromMuscle(Math.max(c.flexR, c.fistR * 0.25)); this.servoAngle = null; }
    c.elbowR += (target - c.elbowR) * (servo ? 1 : k);        // a servo already moves at its own speed
    c.elbowL += (elbowFromMuscle(Math.max(c.flexL, c.fistL * 0.25)) - c.elbowL) * k;
    this.source = source;
    return { elbowR: c.elbowR, elbowL: c.elbowL, glow: { flexR: c.flexR, flexL: c.flexL, fistR: c.fistR, fistL: c.fistL }, source, servoAngle: this.servoAngle };
  },
};
