// DHT11 / DHT22 temperature + humidity sensor: the single-wire protocol, timed in CPU cycles.
//
// The sketch pulls DATA low (≥ 1 ms for a DHT22, ≥ 18 ms for a DHT11) and releases it. The sensor answers ~30 µs
// later: 80 µs low, 80 µs high, then 40 bits — each a 50 µs low followed by a high of ~27 µs (0) or ~70 µs (1) —
// and a final 50 µs low before letting the line float high again. Libraries (Adafruit DHT) time those pulses by
// counting loop iterations with interrupts off, so the waveform has to land on the simulated pin at the right
// cycle; it is scheduled with avr8js clock events, not at frame boundaries.
//
// Data: DHT22 → humidity×10 (16 bit), temperature×10 (15 bit + sign bit), checksum.
//       DHT11 → humidity (integer, decimal), temperature (integer, decimal tenths; bit 7 = negative), checksum.
import { PinState } from 'avr8js';

const US = 16;                                     // CPU cycles per µs at 16 MHz

export const DHT_RANGE = {
  DHT22: { tMin: -40, tMax: 80, hMin: 0, hMax: 100 },
  DHT11: { tMin: 0, tMax: 50, hMin: 20, hMax: 90 },
};

/** The 5 bytes a sensor sends for a reading. */
export function dhtBytes(model, tempC, humidity) {
  const r = DHT_RANGE[model] || DHT_RANGE.DHT22;
  const t = Math.max(r.tMin, Math.min(r.tMax, Number(tempC) || 0)), h = Math.max(r.hMin, Math.min(r.hMax, Number(humidity) || 0));
  let b;
  if (model === 'DHT11') {
    const ti = Math.trunc(Math.abs(t)), tf = Math.round((Math.abs(t) - ti) * 10) % 10;
    b = [Math.round(h), 0, ti, tf | (t < 0 ? 0x80 : 0)];
  } else {
    const h10 = Math.round(h * 10), t10 = Math.round(Math.abs(t) * 10);
    b = [h10 >> 8, h10 & 0xff, ((t10 >> 8) & 0x7f) | (t < 0 ? 0x80 : 0), t10 & 0xff];
  }
  return [...b, (b[0] + b[1] + b[2] + b[3]) & 0xff];
}

export class Dht {
  constructor(model = 'DHT22') {
    this.model = model;
    this.tempC = 24; this.humidity = 40;
    this.mcu = null; this.port = null; this.bit = 0;
    this.lowSince = null; this.busy = false; this.events = [];
    this.reads = 0;                                 // completed transmissions (shown to the AI: "the sketch is reading it")
    this.lastTrigger = null;                        // 'ok' | 'too-short' — why the last start pulse did / didn't get an answer
    this.onPort = () => this.watch();
  }

  setValues({ temp, humidity }) { if (temp != null) this.tempC = Number(temp); if (humidity != null) this.humidity = Number(humidity); }

  /** Connect DATA to one MCU pin ({port, bit}); null detaches. The line idles high (the module's pull-up). */
  attach(mcu, pin) {
    if (this.mcu === mcu && this.port === mcu?.ports[pin?.port] && this.bit === pin?.bit) return;
    this.detach();
    if (!mcu || !pin?.port || !mcu.ports[pin.port]) return;
    this.mcu = mcu; this.port = mcu.ports[pin.port]; this.bit = pin.bit;
    this.port.addListener(this.onPort);
    this.level(true);
  }
  detach() {
    if (!this.mcu) return;
    for (const e of this.events) this.mcu.cpu.clearClockEvent(e);
    this.events = []; this.busy = false; this.lowSince = null;
    this.port.removeListener(this.onPort);
    this.mcu = null; this.port = null;
  }

  level(high) { this.port?.setPin(this.bit, high); }

  /** The firmware changed the port: is it pulling DATA low, or has it just let go after a long enough start pulse? */
  watch() {
    if (this.busy) return;
    const state = this.port.pinState(this.bit), now = this.mcu.cpu.cycles;
    if (state === PinState.Low) { if (this.lowSince === null) this.lowSince = now; return; }
    if (this.lowSince === null || state === PinState.High) { this.lowSince = null; return; }
    const held = (now - this.lowSince) / US;                  // µs the host held the line low
    this.lowSince = null;
    const need = this.model === 'DHT11' ? 15000 : 800;
    if (held < need) { this.lastTrigger = 'too-short'; return; }
    this.lastTrigger = 'ok';
    this.respond();
  }

  respond() {
    this.busy = true;
    const steps = [[30, false], [80, true], [80, false]];      // [µs from the previous edge, level after it]
    for (const byte of dhtBytes(this.model, this.tempC, this.humidity)) {
      for (let i = 7; i >= 0; i--) steps.push([50, true], [byte & (1 << i) ? 70 : 27, false]);
    }
    steps.push([50, true]);                                    // last low, then release
    let at = 0;
    this.events = steps.map(([us, high]) => {
      at += us * US;
      const ev = () => this.level(high);
      return this.mcu.cpu.addClockEvent(ev, at);
    });
    const done = () => { this.busy = false; this.events = []; this.reads++; };
    this.events.push(this.mcu.cpu.addClockEvent(done, at + 1));
  }

  summary() { return { model: this.model, tempC: this.tempC, humidity: this.humidity, reads: this.reads, ...(this.lastTrigger === 'too-short' ? { problem: `start pulse too short for a ${this.model}` } : {}) }; }
}
