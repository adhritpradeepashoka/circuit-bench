// A closed switch between TWO microcontroller pins (a keypad key joins a row pin to a column pin; a button can join any two). The
// circuit solver only looks at the pins once per frame, but firmware scans in microseconds: it drives a row LOW and reads the columns
// straight away. So the chip itself applies the switch: whenever a pin register changes, an input pin joined to a pin that is
// driven LOW reads LOW (HIGH likewise), otherwise it reads what the circuit says. Works on any chip that offers ports with
// pinState/setPin/addListener (the AVRs and the RP2040 adapter). Pure apart from those calls.
export class PinCoupling {
  /** @param {{ports:object, pinMode:(pin)=>string}} mcu */
  constructor(mcu) {
    this.mcu = mcu; this.pairs = []; this.partners = new Map(); this.pins = new Map(); this.ext = new Map(); this.busy = false;
    for (const port of Object.values(mcu.ports || {})) port.addListener?.(() => this.settle());
  }
  static key = p => `${p.port}${p.bit}`;
  /** The switches that are closed right now: [[pinA, pinB], …]. */
  set(pairs) {
    this.pairs = pairs || []; this.partners = new Map(); this.pins = new Map();
    for (const [a, b] of this.pairs) {
      const ka = PinCoupling.key(a), kb = PinCoupling.key(b); if (ka === kb) continue;
      this.pins.set(ka, a); this.pins.set(kb, b);
      (this.partners.get(ka) || this.partners.set(ka, []).get(ka)).push(b);
      (this.partners.get(kb) || this.partners.set(kb, []).get(kb)).push(a);
    }
    this.settle();
  }
  has(pin) { return this.partners.has(PinCoupling.key(pin)); }
  /** The circuit's own reading of an input pin; the coupling may still override it. */
  input(pin, high) { this.ext.set(PinCoupling.key(pin), !!high); this.settle(); }
  settle() {
    if (this.busy || !this.partners.size) return;
    this.busy = true;
    try {
      for (const [k, pin] of this.pins) {
        const mode = this.mcu.pinMode(pin);
        if (mode === 'H' || mode === 'L') continue;                                  // the chip drives this one
        const ps = this.partners.get(k).map(p => this.mcu.pinMode(p));
        const v = ps.includes('L') ? false : ps.includes('H') ? true : this.ext.has(k) ? this.ext.get(k) : mode === 'U';
        this.mcu.ports[pin.port]?.setPin(pin.bit, v);
      }
    } finally { this.busy = false; }
  }
}
