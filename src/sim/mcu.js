import {
  CPU, AVRIOPort, AVRTimer, PinState, avrInstruction,
  portBConfig, portCConfig, portDConfig, timer0Config, timer1Config, timer2Config, AVRADC, adcConfig, AVRUSART, usart0Config, AVRTWI, twiConfig,
} from 'avr8js';
import { I2CBus } from './i2c.js';

export const CPU_HZ = 16_000_000;

export function parseIntelHex(hex) {
  const bytes = new Uint8Array(0x8000).fill(0xff);   // 32 KB flash
  for (const line of hex.split(/\r?\n/)) {
    if (!line.startsWith(':')) continue;
    const count = parseInt(line.slice(1, 3), 16), addr = parseInt(line.slice(3, 7), 16), type = parseInt(line.slice(7, 9), 16);
    if (type === 1) break;
    if (type !== 0) continue;
    for (let i = 0; i < count; i++) if (addr + i < bytes.length) bytes[addr + i] = parseInt(line.slice(9 + i * 2, 11 + i * 2), 16);
  }
  return bytes;
}

// PWM-capable pins: which timer-compare register + control bits drive them (ATmega328P datasheet §14–§17)
const PWM_PINS = {
  3:  { port: 'D', bit: 3, tccrA: 0xb0, tccrB: 0xb1, com1: 0x20, com0: 0x10, ocr: 0xb4 },   // OC2B
  5:  { port: 'D', bit: 5, tccrA: 0x44, tccrB: 0x45, com1: 0x20, com0: 0x10, ocr: 0x48 },   // OC0B
  6:  { port: 'D', bit: 6, tccrA: 0x44, tccrB: 0x45, com1: 0x80, com0: 0x40, ocr: 0x47 },   // OC0A
  9:  { port: 'B', bit: 1, tccrA: 0x80, tccrB: 0x81, com1: 0x80, com0: 0x40, ocr: 0x88 },   // OC1A
  10: { port: 'B', bit: 2, tccrA: 0x80, tccrB: 0x81, com1: 0x20, com0: 0x10, ocr: 0x8a },   // OC1B
  11: { port: 'B', bit: 3, tccrA: 0xb0, tccrB: 0xb1, com1: 0x80, com0: 0x40, ocr: 0xb3 },   // OC2A
};
const DDR = { B: 0x24, C: 0x27, D: 0x2a };

/** ATmega328P: CPU + 3 timers + ADC + GPIO ports B/C/D, exactly the avr8js reference wiring. */
export class Mcu {
  /** @param {string} hex Intel HEX firmware — the output of a real Arduino build. */
  constructor(hex) {
    if (typeof hex !== 'string' || !hex.includes(':')) throw new Error('Mcu needs Intel HEX firmware');
    const bytes = parseIntelHex(hex);
    const program = new Uint16Array(bytes.length / 2);
    new Uint8Array(program.buffer).set(bytes);
    this.cpu = new CPU(program, 2048);
    this.timers = [timer0Config, timer1Config, timer2Config].map(cfg => new AVRTimer(this.cpu, cfg));
    this.ports = { B: new AVRIOPort(this.cpu, portBConfig), C: new AVRIOPort(this.cpu, portCConfig), D: new AVRIOPort(this.cpu, portDConfig) };
    this.adc = new AVRADC(this.cpu, adcConfig);
    this.adc.channelValues.fill(0);
    // UART0 (Serial): the firmware's own UBRR/UCSR writes set the baud rate; bytes leave via onSerial
    this.usart = new AVRUSART(this.cpu, usart0Config, CPU_HZ);
    this.onSerial = null;                       // (byte) => void
    this.rxQueue = [];
    this.usart.onByteTransmit = byte => this.onSerial?.(byte);
    this.usart.onRxComplete = () => this.pumpRx();
    // TWI (Wire / I²C on A4 = SDA, A5 = SCL): the bus answers for whatever devices are wired up
    this.twi = new AVRTWI(this.cpu, twiConfig, CPU_HZ);
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
  /** Volts (0–5) presented to ADC channel 0–5 (pins A0–A5). */
  setAnalog(channel, volts) { this.adc.channelValues[channel] = Math.max(0, Math.min(5, volts)); }
  /**
   * If `pin` (Arduino number) is currently producing PWM (analogWrite), the duty cycle 0–1; otherwise null.
   * Read from the timer registers, not sampled from the fast waveform — the DC solver uses the average.
   */
  pwmDuty(pin) {
    const p = PWM_PINS[pin];
    if (!p) return null;
    const d = this.cpu.data;
    if (!(d[p.tccrA] & p.com1)) return null;                  // compare output not connected
    if (!(d[p.tccrB] & 0x07)) return null;                    // timer stopped
    if (!(d[DDR[p.port]] & (1 << p.bit))) return null;        // pin is not an output
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
    switch (this.ports[port].pinState(bit)) {
      case PinState.High: return 'H';
      case PinState.Low: return 'L';
      case PinState.InputPullUp: return 'U';
      default: return 'Z';
    }
  }
  /** Feed the outside world back into an input pin. */
  setInput({ port, bit }, high) { this.ports[port].setPin(bit, high); }
}
