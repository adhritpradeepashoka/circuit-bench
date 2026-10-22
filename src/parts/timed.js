// Parts that answer to the firmware's pin TIMING, driven by avr8js port listeners and clock events so they land on
// the right CPU cycle (like the DHT sensor): a servo (how wide is the pulse?), an HC-SR04 (TRIG in, ECHO out),
// a stepper motor (which way did the coil pattern advance?) and a frequency probe for tone() on a passive buzzer.
import { PinState } from 'avr8js';

const US = 16;                                   // CPU cycles per µs at 16 MHz

/** Base: listen to some pins of the MCU, remember what to detach. */
class Watcher {
  constructor() { this.mcu = null; this.hooks = []; this.events = []; }
  listen(mcu, pin, fn) {
    const port = mcu.ports[pin.port];
    if (!port) return;
    port.addListener(fn);
    this.hooks.push([port, fn]);
  }
  detach() {
    if (this.mcu) for (const e of this.events) this.mcu.cpu.clearClockEvent(e);
    for (const [port, fn] of this.hooks) port.removeListener(fn);
    this.hooks = []; this.events = []; this.mcu = null;
  }
}

/** A hobby servo: the horn goes to the angle given by the width of the pulse on SIGNAL (Servo library: 544 µs = 0°, 2400 µs = 180°). */
export class Servo extends Watcher {
  constructor({ range = 180, minUs = 544, maxUs = 2400 } = {}) {
    super();
    Object.assign(this, { range, minUs, maxUs });
    this.angle = range / 2; this.target = range / 2; this.pulseUs = 0; this.rise = null; this.pulses = 0; this.bit = 0; this.pinPort = null;
  }
  attach(mcu, pin) {
    if (this.mcu === mcu && this.pinPort === pin.port && this.bit === pin.bit) return;
    this.detach();
    this.mcu = mcu; this.pinPort = pin.port; this.bit = pin.bit; this.rise = null;
    this.listen(mcu, pin, () => this.watch());
  }
  watch() {
    const st = this.mcu.ports[this.pinPort].pinState(this.bit), now = this.mcu.cpu.cycles;
    if (st === PinState.High) { if (this.rise === null) this.rise = now; return; }
    if (this.rise === null) return;
    const us = (now - this.rise) / US; this.rise = null;
    if (us < 300 || us > 3000) return;                           // not a servo pulse (a PWM edge, a tone…)
    this.pulseUs = us; this.pulses++;
    this.target = Math.max(0, Math.min(this.range, ((us - this.minUs) / (this.maxUs - this.minUs)) * this.range));
  }
  /** Move the horn toward the target at a real servo's speed (≈ 0.12 s per 60°). */
  update(dt, powered) {
    if (!powered) return;
    const max = dt * 500;
    this.angle += Math.max(-max, Math.min(max, this.target - this.angle));
  }
  summary() { return { angleDeg: Math.round(this.angle), targetDeg: Math.round(this.target), pulseUs: Math.round(this.pulseUs), pulsesSeen: this.pulses }; }
}

/** HC-SR04: a ≥ 10 µs pulse on TRIG, then ECHO goes HIGH for 58 µs per cm of distance (the sound's round trip). */
export class Ultrasonic extends Watcher {
  constructor() { super(); this.distance = 50; this.busy = false; this.highSince = null; this.measurements = 0; this.trig = null; this.echo = null; }
  setDistance(cm) { this.distance = Math.max(2, Math.min(400, Number(cm) || 50)); }
  attach(mcu, trig, echo) {
    if (this.mcu === mcu && this.trig?.port === trig.port && this.trig.bit === trig.bit && this.echo?.port === echo.port && this.echo.bit === echo.bit) return;
    this.detach();
    this.mcu = mcu; this.trig = { port: trig.port, bit: trig.bit }; this.echo = { port: echo.port, bit: echo.bit };
    this.listen(mcu, trig, () => this.watch());
    this.level(false);
  }
  detach() { const m = this.mcu; super.detach(); if (m && this.echo) m.ports[this.echo.port]?.setPin(this.echo.bit, false); this.busy = false; this.highSince = null; }
  level(high) { this.mcu?.ports[this.echo.port]?.setPin(this.echo.bit, high); }
  watch() {
    if (this.busy) return;
    const st = this.mcu.ports[this.trig.port].pinState(this.trig.bit), now = this.mcu.cpu.cycles;
    if (st === PinState.High) { if (this.highSince === null) this.highSince = now; return; }
    if (this.highSince === null) return;
    const held = (now - this.highSince) / US; this.highSince = null;
    if (held < 8) return;                                         // a 10 µs trigger pulse (a little tolerance)
    this.busy = true;
    const start = 400 * US, len = Math.round(this.distance * 58.2 * US);
    this.events = [
      this.mcu.cpu.addClockEvent(() => this.level(true), start),
      this.mcu.cpu.addClockEvent(() => { this.level(false); this.busy = false; this.measurements++; this.events = []; }, start + len),
    ];
  }
  summary() { return { distanceCm: this.distance, measurements: this.measurements }; }
}

/** The 8 half-step positions of a 4-coil stepper (IN1…IN4 energised): 1000 → 1100 → 0100 → 0110 → 0010 → 0011 → 0001 → 1001. */
const RING = ['1000', '1100', '0100', '0110', '0010', '0011', '0001', '1001'];
/**
 * A stepper motor: every time the coil pattern moves to the next place on the ring the shaft turns that much.
 * Full-step drive (two coils at a time) moves 2 ring places per step; half-step drive moves 1.
 */
export class Stepper extends Watcher {
  constructor({ steps = 2048 } = {}) { super(); this.steps = steps; this.angle = 0; this.pos = null; this.count = 0; this.pins = []; }
  attach(mcu, pins) {
    this.detach();
    this.mcu = mcu; this.pins = pins.map(p => ({ port: p.port, bit: p.bit }));
    for (const p of pins) this.listen(mcu, p, () => this.watch());
    this.pos = this.read();
  }
  read() {
    const bits = this.pins.map(p => (this.mcu.ports[p.port].pinState(p.bit) === PinState.High ? '1' : '0')).join('');
    const i = RING.indexOf(bits);
    return i >= 0 ? i : null;
  }
  watch() {
    const now = this.read();
    if (now === null) return;                                     // all off, or a pattern that isn't a stepper state
    if (this.pos !== null && now !== this.pos) {
      const d = ((now - this.pos + 12) % 8) - 4;                  // −4 … +3 half-steps
      this.angle += d * (180 / this.steps); this.count += d;
    }
    this.pos = now;
  }
  summary() { return { angleDeg: Math.round(this.angle * 10) / 10, turns: Math.round((this.angle / 360) * 100) / 100, stepsTaken: this.count }; }
}

/** Counts rising edges on one pin so a passive buzzer can play the tone() the sketch makes. */
export class FreqProbe extends Watcher {
  constructor() { super(); this.edges = 0; this.t0 = 0; this.freq = 0; this.last = 0; this.bit = 0; this.pinPort = null; this.high = false; }
  attach(mcu, pin) {
    if (this.mcu === mcu && this.pinPort === pin.port && this.bit === pin.bit) return;
    this.detach();
    this.mcu = mcu; this.pinPort = pin.port; this.bit = pin.bit; this.t0 = mcu.seconds; this.edges = 0; this.freq = 0;
    this.listen(mcu, pin, () => {
      const high = this.mcu.ports[this.pinPort].pinState(this.bit) === PinState.High;
      if (high && !this.high) { this.edges++; this.last = this.mcu.seconds; }
      this.high = high;
    });
  }
  /** Call about once a frame: the frequency over the last ~60 ms (0 when the pin has gone quiet). */
  update() {
    if (!this.mcu) return 0;
    const now = this.mcu.seconds, span = now - this.t0;
    if (now - this.last > 0.08) { this.freq = 0; this.edges = 0; this.t0 = now; return 0; }
    if (span >= 0.06) { this.freq = this.edges / span; this.edges = 0; this.t0 = now; }
    return this.freq;
  }
}
