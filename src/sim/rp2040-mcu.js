// Raspberry Pi Pico (RP2040) — real firmware on a Cortex-M0+ emulator (rp2040js, MIT).
// Exposes the same surface as the AVR `Mcu` in mcu.js, so the simulator, the DC solver and the parts
// (servo, DHT, ultrasonic, I²C devices …) drive either chip the same way.
//
//  • GPIO pins are addressed like the AVR ones, as { port: 'GP', bit: n }; `ports.GP` offers pinState/setPin.
//  • ADC: 12-bit, 3.3 V reference, channels 0–3 = GP26–GP29, 4 = the die temperature sensor.
//  • Serial = USB-CDC (what arduino-pico's `Serial` is), Serial1/Serial2 = UART0/UART1; all three arrive in onSerial.
//  • Time: the clock is the emulator's own, in nanoseconds; `cpu.cycles` is exposed at `hz` so cycle-based parts work.
import { Simulator, USBCDC, GPIOPinState, I2CMode } from 'rp2040js';
import { bootromB1 } from './rp2040-bootrom.js';
import { PinCoupling } from './coupling.js';

export const RP_HZ = 125_000_000;
export const RP_VCC = 3.3;
export const FLASH_BASE = 0x10000000;
const FLASH_SIZE = 2 * 1024 * 1024;
const SILENT = { debug() {}, info() {}, warn() {}, error() {} };
const NS_PER_CYCLE = 1e9 / RP_HZ;

/** UF2 container → flash image (each 512-byte block carries 256 bytes + a target address). Throws on anything that isn't UF2. */
export function parseUf2(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Uint8Array(FLASH_SIZE).fill(0xff);
  let blocks = 0;
  for (let o = 0; o + 512 <= bytes.length; o += 512) {
    if (dv.getUint32(o, true) !== 0x0a324655 || dv.getUint32(o + 4, true) !== 0x9e5d5157) throw new Error('Not a UF2 file');
    const flags = dv.getUint32(o + 8, true), addr = dv.getUint32(o + 12, true), size = dv.getUint32(o + 16, true);
    if (flags & 1) continue;                                   // "not main flash"
    const at = addr - FLASH_BASE;
    if (at < 0 || at + size > FLASH_SIZE) throw new Error(`UF2 block at 0x${addr.toString(16)} is outside the Pico's flash`);
    out.set(bytes.subarray(o + 32, o + 32 + size), at); blocks++;
  }
  if (!blocks) throw new Error('UF2 file has no flash blocks');
  return out;
}

/** Firmware as it arrives from the compile service: UF2 or a raw .bin, Uint8Array or base64 text. */
export function firmwareImage(fw) {
  let bytes = fw;
  if (typeof fw === 'string') {
    const bin = atob(fw); bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  }
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('Rp2040Mcu needs firmware (UF2 or BIN)');
  if (bytes.length >= 512 && bytes[0] === 0x55 && bytes[1] === 0x46 && bytes[2] === 0x32 && bytes[3] === 0x0a) return parseUf2(bytes);
  if (bytes.length > FLASH_SIZE) throw new Error('Firmware is bigger than the Pico\'s 2 MB flash');
  const out = new Uint8Array(FLASH_SIZE).fill(0xff); out.set(bytes); return out;
}

/** I²C master side of the RP2040 against the same device models as the AVR bus (src/sim/i2c.js device interface). */
class RpI2CBus {
  constructor(rp) {
    this.devices = new Map(); this.active = null; this.log = [];
    for (const ctl of rp.i2c) {
      ctl.onStart = () => { this.active = null; for (const d of this.devices.values()) d.start?.(); ctl.completeStart(); };
      ctl.onConnect = (addr, mode) => {
        const dev = this.devices.get(addr);
        this.log.push(addr); if (this.log.length > 32) this.log.shift();
        const ack = !!dev && dev.connect(mode === I2CMode.Write) !== false;
        this.active = ack ? dev : null;
        ctl.completeConnect(ack);
      };
      ctl.onWriteByte = v => ctl.completeWrite(this.active ? this.active.write(v) !== false : false);
      ctl.onReadByte = ack => ctl.completeRead(this.active ? this.active.read(ack) & 0xff : 0xff);
      ctl.onStop = () => { this.active?.stop?.(); this.active = null; ctl.completeStop(); };
    }
  }
  setDevices(map) { this.devices = map; if (this.active && ![...map.values()].includes(this.active)) this.active = null; }
  unanswered() { return [...new Set(this.log.filter(a => !this.devices.has(a)))]; }
}

export class Rp2040Mcu {
  /** @param {Uint8Array|string} firmware UF2 / BIN (or base64 of either) — the output of a real Arduino-Pico build. */
  constructor(firmware) {
    const image = firmwareImage(firmware);
    this.hz = RP_HZ;
    this.vcc = RP_VCC;
    const sim = new Simulator();                                // we only borrow its clock + chip; our own loop drives it
    this.clock = sim.clock;
    this.rp = sim.rp2040;
    this.rp.logger = SILENT;
    this.rp.loadBootrom(bootromB1);
    this.rp.flash.set(image);
    this.chip = { name: 'rp2040', vcc: RP_VCC, hz: RP_HZ, adcBits: 12 };
    this.onSerial = null;
    // Serial (USB CDC) and Serial1/Serial2 (UART0/UART1) all land in the serial monitor
    this.cdc = new USBCDC(this.rp.usbCtrl);
    this.cdc.onSerialData = buf => { for (const b of buf) this.onSerial?.(b); };
    this.uartOut = null;
    this.rp.uart.forEach((u, i) => { u.onByte = b => { this.onSerial?.(b); this.uartOut?.(i, b); }; });
    this.usart = { onConfigurationChange: null };
    this.i2c = new RpI2CBus(this.rp);
    // GPIO as an AVR-style "port" so pinState/setPin users (DHT, HC-SR04, servo, encoders …) work unchanged
    const gp = this.rp.gpio;
    // a pin the firmware drives reads back as the level it drives (the pad is wired to the input buffer)
    for (const pin of gp) pin.addListener(state => { if (state === GPIOPinState.High || state === GPIOPinState.Low) pin.setInputValue(state === GPIOPinState.High); });
    const watchers = new Map();                                  // fn → [[pin, unsubscribe]…]
    this.ports = {
      GP: {
        pinState: bit => gp[bit] ? gp[bit].value : GPIOPinState.Input,
        setPin: (bit, high) => { gp[bit]?.setInputValue(!!high); },
        pin: bit => (gp[bit]?.inputValue ? 1 : 0),
        // fires on any GPIO change, like an AVR port listener
        addListener: fn => { if (!watchers.has(fn)) watchers.set(fn, gp.map(pin => pin.addListener(() => fn()))); },
        removeListener: fn => { for (const off of watchers.get(fn) || []) off(); watchers.delete(fn); },
      },
    };
    // cycle-based scheduling, as parts expect from an AVR CPU (cycles at `hz`; events are relative to now)
    const self = this;
    this.cpu = {
      get cycles() { return Math.floor(self.clock.nanos / NS_PER_CYCLE); },
      addClockEvent(fn, inCycles) {
        const alarm = self.clock.createAlarm(fn);
        alarm.schedule(Math.max(1, inCycles) * NS_PER_CYCLE);
        return alarm;
      },
      clearClockEvent(alarm) { alarm?.cancel(); return true; },
    };
    this.rp.core.PC = FLASH_BASE;
    this.rp.onBreak = () => {};
    this.halted = false;
    this.rxBusy = false;
  }
  get seconds() { return this.clock.nanos / 1e9; }
  get baud() { return 115200; }
  attachSerial(monitorFn, uartFn) { this.onSerial = monitorFn; this.uartOut = uartFn; }
  uartWrite(i, byte) { this.rp.uart[i]?.feedByte(byte); }
  uartActive(i) { const u = this.rp.uart[i]; return !!u && !!u.enabled; }
  uartBaud(i) { return this.rp.uart[i]?.baudRate || 115200; }       // USB CDC has no baud rate; the monitor just needs a plausible one

  /**
   * Run `cycles` CPU cycles of emulated time. If the browser can't keep up it stops early (`budgetMs`) and the
   * simulation simply runs slower than real time rather than freezing the page.
   */
  run(cycles, budgetMs = 14) {
    const { clock, rp } = this, core = rp.core;
    const target = clock.nanos + cycles * NS_PER_CYCLE;
    const deadline = typeof performance !== 'undefined' ? performance.now() + budgetMs : Infinity;
    let n = 0;
    while (clock.nanos < target) {
      if (core.waiting) {
        clock.tick(Math.max(1, Math.min(clock.nanosToNextAlarm, target - clock.nanos)));
      } else {
        clock.tick(core.executeInstruction() * NS_PER_CYCLE);
      }
      if ((++n & 0x3fff) === 0 && performance.now() > deadline) break;
    }
  }

  /** Send text (or bytes) to the firmware's Serial input. */
  serialWrite(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    for (const b of bytes) { this.cdc.sendSerialByte(b); }
  }

  /** Volts (0–3.3) presented to ADC channel n (A0 = GP26 = 0 …). */
  setAnalog(channel, volts) {
    const ch = this.rp.adc.channelValues;
    if (channel >= ch.length - 1) return;                       // channel 4 is the on-die temperature sensor
    if (this.waves?.has(channel)) { this.waves.delete(channel); Object.defineProperty(ch, channel, { value: 0, writable: true, configurable: true, enumerable: true }); }
    ch[channel] = this.toCounts(volts);
  }
  setAnalogWave(channel, volts) {
    const ch = this.rp.adc.channelValues;
    if (channel >= ch.length - 1) return;
    (this.waves ||= new Set()).add(channel);
    Object.defineProperty(ch, channel, { get: () => this.toCounts(volts(this.seconds)), set: () => {}, configurable: true, enumerable: true });
  }
  toCounts(v) { return Math.max(0, Math.min(4095, Math.round((Math.max(0, Math.min(RP_VCC, v)) / RP_VCC) * 4095))); }

  /**
   * If GPIO `n` is producing PWM (analogWrite), the duty cycle 0–1; otherwise null. Read from the PWM slice registers
   * (the DC solver wants the average, not the fast waveform).
   */
  pwmDuty(n) {
    const pin = this.rp.gpio[n];
    if (!pin || pin.functionSelect !== 4 || !pin.rawOutputEnable) return null;
    const slice = this.rp.pwm.channels[(n >> 1) & 7], b = n & 1;
    if (!(slice.csr & 1)) return null;                           // slice disabled
    const cc = b ? (slice.cc >>> 16) & 0xffff : slice.cc & 0xffff;
    const duty = Math.min(1, cc / (slice.top + 1));
    return slice.csr & (b ? 8 : 4) ? 1 - duty : duty;            // A_INV / B_INV
  }

  pwmDutyOf(pin) { return pin?.port === 'GP' ? this.pwmDuty(pin.bit) : null; }

  /** What the firmware is doing to one pin: 'H' | 'L' | 'U' (input, pull-up) | 'D' (input, pull-down) | 'Z' (input). */
  pinMode({ port, bit }) {
    if (port !== 'GP' || !this.rp.gpio[bit]) return 'Z';
    switch (this.rp.gpio[bit].value) {
      case GPIOPinState.High: return 'H';
      case GPIOPinState.Low: return 'L';
      case GPIOPinState.InputPullUp: return 'U';
      case GPIOPinState.InputPullDown: return 'D';
      default: return 'Z';
    }
  }
  /** Feed the outside world back into an input pin. */
  setInput({ port, bit }, high) {
    if (port !== 'GP') return;
    if (this.coupling?.has({ port, bit })) this.coupling.input({ port, bit }, high); else this.ports.GP.setPin(bit, high);
  }
  /** Closed switches between two of this chip's own pins (a keypad key): applied at once, between instructions. */
  setCoupling(pairs) { (this.coupling ||= new PinCoupling(this)).set(pairs); }
}
