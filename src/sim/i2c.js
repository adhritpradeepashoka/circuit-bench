// I²C (TWI) bus for the simulated ATmega328P. avr8js emulates the chip's TWI peripheral and asks an event
// handler what the *outside world* does at each step of a transfer — this is that outside world: the
// devices wired to A4/SDA and A5/SCL. A device with no ACK (nothing at that address, or not wired/powered)
// NACKs exactly like real hardware, so Wire.endTransmission() returns 2 and libraries report "not found".
//
// Device interface (all optional except connect/write/read):
//   start()                    a START or repeated START was sent
//   connect(write) → boolean   addressed for write (true) or read (false); return ACK
//   write(byte)   → boolean    a byte from the master; return ACK
//   read(ack)     → byte       the master clocks a byte out of us; ack=false on the last one
//   stop()                     STOP

export class I2CBus {
  constructor(twi) {
    this.twi = twi;
    this.devices = new Map();     // 7-bit address → device
    this.active = null;           // the device addressed since the last START
    this.log = [];                // recent addresses seen, for diagnostics ("the sketch talked to 0x3D, nothing answered")
    twi.eventHandler = this;
  }

  /** Replace the attached devices (called whenever the wiring changes). */
  setDevices(map) { this.devices = map; if (this.active && ![...map.values()].includes(this.active)) this.active = null; }

  start() { this.active = null; for (const d of this.devices.values()) d.start?.(); this.twi.completeStart(); }
  stop() { this.active?.stop?.(); this.active = null; this.twi.completeStop(); }
  connectToSlave(addr, write) {
    const dev = this.devices.get(addr);
    this.log.push(addr); if (this.log.length > 32) this.log.shift();
    const ack = !!dev && dev.connect(write) !== false;
    this.active = ack ? dev : null;
    this.twi.completeConnect(ack);
  }
  writeByte(value) { this.twi.completeWrite(this.active ? this.active.write(value) !== false : false); }
  readByte(ack) { this.twi.completeRead(this.active ? this.active.read(ack) & 0xff : 0xff); }

  /** Addresses the firmware tried that nothing answered — "it's looking for 0x3D but your display is at 0x3C". */
  unanswered() { return [...new Set(this.log.filter(a => !this.devices.has(a)))]; }
}
