import { CPU, AVRIOPort, AVRTimer, PinState, avrInstruction, AVRADC, AVRUSART, AVRTWI } from 'avr8js';
import { I2CBus } from './i2c.js';
import { CHIPS } from './chips.js';

export const CPU_HZ = 16_000_000;

/** Intel HEX → flash image. Handles extended segment/linear address records, so >64 KB firmware (Mega) loads too. */
export function parseIntelHex(hex, size = 0x8000) {
  const bytes = new Uint8Array(size).fill(0xff);
  let base = 0;
  for (const line of hex.split(/\r?\n/)) {
    if (!line.startsWith(':')) continue;
    const count = parseInt(line.slice(1, 3), 16), addr = parseInt(line.slice(3, 7), 16), type = parseInt(line.slice(7, 9), 16);
    const byte = i => parseInt(line.slice(9 + i * 2, 11 + i * 2), 16);
    if (type === 1) break;
    if (type === 2) { base = ((byte(0) << 8) | byte(1)) << 4; continue; }    // extended segment address
    if (type === 4) { base = ((byte(0) << 8) | byte(1)) << 16; continue; }   // extended linear address
    if (type !== 0) continue;
    for (let i = 0; i < count; i++) if (base + addr + i < bytes.length) bytes[base + addr + i] = byte(i);
  }
  return bytes;
}

/** An AVR microcontroller (ATmega328P by default, or ATmega2560): CPU + timers + ADC + GPIO + UART0 + TWI, from src/sim/chips.js. */
export class Mcu {
  /** @param {string} hex Intel HEX firmware — the output of a real Arduino build. @param {string} chip 'atmega328p' | 'atmega2560' */
  constructor(hex, chip = 'atmega328p') {
    if (typeof hex !== 'string' || !hex.includes(':')) throw new Error('Mcu needs Intel HEX firmware');
    const spec = CHIPS[chip];
    if (!spec) throw new Error(`Unknown chip ${chip}`);
    this.chip = spec;
    const bytes = parseIntelHex(hex, spec.flashBytes);
    const program = new Uint16Array(bytes.length / 2);
    new Uint8Array(program.buffer).set(bytes);
    // avr8js data space = sramBytes + 0x100 register/IO bytes; the 2560's extended I/O (0x100–0x1FF) sits below its RAM, so add it
    this.cpu = new CPU(program, spec.sramBytes + (spec.ports.L ? 0x100 : 0));
    this.timers = spec.timers.map(cfg => new AVRTimer(this.cpu, cfg));
    this.ports = Object.fromEntries(Object.entries(spec.ports).map(([k, cfg]) => [k, new AVRIOPort(this.cpu, cfg)]));
    this.adc = new AVRADC(this.cpu, spec.adc);
    this.adc.channelValues.fill(0);
    // UART0 (Serial): the firmware's own UBRR/UCSR writes set the baud rate; bytes leave via onSerial
    this.usart = new AVRUSART(this.cpu, spec.usart, CPU_HZ);
    this.onSerial = null;                       // (byte) => void
    this.rxQueue = [];
    this.usart.onByteTransmit = byte => this.onSerial?.(byte);
    this.usart.onRxComplete = () => this.pumpRx();
    // Serial1–3 (Mega): only the board-to-board links use them
    this.usarts = [this.usart, ...(spec.extraUsarts || []).map(cfg => new AVRUSART(this.cpu, cfg, CPU_HZ))];
    this.uartQueues = this.usarts.map(() => []);
    this.uartOut = null;
    this.usarts.forEach((u, i) => {
      if (i === 0) u.onByteTransmit = byte => { this.onSerial?.(byte); this.uartOut?.(0, byte); };
      else u.onByteTransmit = byte => this.uartOut?.(i, byte);
      const pump = () => { const q = this.uartQueues[i]; while (q.length && !u.rxBusy) { if (u.writeByte(q[0]) === false) break; q.shift(); } };
      if (i > 0) u.onRxComplete = pump;
      else u.onRxComplete = () => { this.pumpRx(); pump(); };
    });
    // TWI (Wire / I²C): the bus answers for whatever devices are wired to the board's SDA/SCL
    this.twi = new AVRTWI(this.cpu, spec.twi, CPU_HZ);
    this.i2c = new I2CBus(this.twi);
  }
  /** Send text (or bytes) to the firmware's Serial input. */
  serialWrite(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    for (const b of bytes) this.rxQueue.push(b);
    this.pumpRx();
  }
  pumpRx() {
    while (this.rxQueue.length && !this.usart.rxBusy) {
      if (this.usart.writeByte(this.rxQueue[0]) === false) break;
      this.rxQueue.shift();
    }
  }
  get baud() { return this.usart.baudRate || 0; }
  /** Board-to-board wiring: monitorFn gets Serial's bytes (the monitor), uartFn(i, byte) every byte any UART transmits. */
  attachSerial(monitorFn, uartFn) { this.onSerial = monitorFn; this.uartOut = uartFn; }
  /** A byte arriving on UART i's RX pin from another board. */
  uartWrite(i, byte) {
    if (i === 0) { this.serialWrite(Uint8Array.of(byte)); return; }
    const u = this.usarts[i]; if (!u) return;
    const q = this.uartQueues[i]; q.push(byte);
    while (q.length && !u.rxBusy) { if (u.writeByte(q[0]) === false) break; q.shift(); }
  }
  /** Has the firmware switched UART i on (transmitter or receiver enabled)? */
  uartActive(i) { const u = this.usarts[i]; return !!u && !!(this.cpu.data[u.config.UCSRB] & 0x18); }
  uartBaud(i) { return this.usarts[i]?.baudRate || 0; }
  /** Volts (0–5) presented to ADC channel n (A0 = 0 …). */
  setAnalog(channel, volts) {
    if (channel >= this.adc.channelValues.length) return;
    if (this.waves?.has(channel)) { this.waves.delete(channel); Object.defineProperty(this.adc.channelValues, channel, { value: 0, writable: true, configurable: true, enumerable: true }); }
    this.adc.channelValues[channel] = Math.max(0, Math.min(5, volts));
  }
  /** An analog input that keeps changing WHILE the firmware runs (a biosignal): each analogRead sees the voltage at the moment of the conversion, not the value from the last frame. */
  setAnalogWave(channel, volts) {
    if (channel >= this.adc.channelValues.length) return;
    (this.waves ||= new Set()).add(channel);
    Object.defineProperty(this.adc.channelValues, channel, { get: () => Math.max(0, Math.min(5, volts(this.seconds))), set: () => {}, configurable: true, enumerable: true });
  }
  /**
   * If `pin` (Arduino number) is currently producing PWM (analogWrite), the duty cycle 0–1; otherwise null.
   * Read from the timer registers, not sampled from the fast waveform — the DC solver uses the average.
   */
  pwmDuty(pin) {
    const p = this.chip.pwm[pin];
    if (!p) return null;
    const d = this.cpu.data;
    if (!(d[p.tccrA] & p.com1)) return null;                  // compare output not connected
    if (!(d[p.tccrB] & 0x07)) return null;                    // timer stopped
    if (!(d[this.chip.ports[p.port].DDR] & (1 << p.bit))) return null;   // pin is not an output
    const duty = Math.min(255, d[p.ocr]) / 255;
    return d[p.tccrA] & p.com0 ? 1 - duty : duty;             // COMx0 set → inverting mode
  }
  get seconds() { return this.cpu.cycles / CPU_HZ; }
  run(cycles) {
    const { cpu } = this, target = cpu.cycles + cycles;
    while (cpu.cycles < target) { avrInstruction(cpu); cpu.tick(); }
  }
  /** What the firmware is doing to one pin: 'H' | 'L' | 'U' (input, pull-up) | 'Z' (input). */
  pinMode({ port, bit }) {
    if (!port || !this.ports[port]) return 'Z';                  // analog-only pins (Nano A6/A7)
    switch (this.ports[port].pinState(bit)) {
      case PinState.High: return 'H';
      case PinState.Low: return 'L';
      case PinState.InputPullUp: return 'U';
      default: return 'Z';
    }
  }
  /** Feed the outside world back into an input pin. */
  setInput({ port, bit }, high) { if (port && this.ports[port]) this.ports[port].setPin(bit, high); }
}
