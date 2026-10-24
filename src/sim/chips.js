// The AVR chips the simulator can run, wired the way avr8js expects. avr8js ships the ATmega328P's
// peripheral configs; the ATmega2560's registers for timers 0–2, USART0, ADC and TWI sit at the same
// addresses, but its interrupt vector table is laid out differently (and it has timers 3–5, ports A–L and a
// 16-channel ADC), so those configs are derived here from the datasheet's vector table.
// Vector "address" in avr8js = (vector number − 1) × 2, in program words.
import {
  portAConfig, portBConfig, portCConfig, portDConfig, portEConfig, portFConfig, portGConfig, portHConfig, portJConfig, portKConfig, portLConfig,
  timer0Config, timer1Config, timer2Config, usart0Config, adcConfig, twiConfig,
} from 'avr8js';

const vec = n => (n - 1) * 2;

// PWM-capable Arduino pins → the timer compare unit that drives them (TCCRxA COMxy bits + OCR register).
// analogWrite() puts every timer in an 8-bit PWM mode, so the duty is OCR(low byte) / 255.
const A = { com1: 0x80, com0: 0x40 }, B = { com1: 0x20, com0: 0x10 }, C = { com1: 0x08, com0: 0x04 };
const ch = (port, bit, tccrA, unit, ocr) => ({ port, bit, tccrA, tccrB: tccrA + 1, ...unit, ocr });

const ATMEGA328P = {
  name: 'ATmega328P', flashBytes: 0x8000, sramBytes: 2048,
  ports: { B: portBConfig, C: portCConfig, D: portDConfig },
  timers: [timer0Config, timer1Config, timer2Config],
  usart: usart0Config, adc: adcConfig, twi: twiConfig,
  pwm: {
    3: ch('D', 3, 0xb0, B, 0xb4), 5: ch('D', 5, 0x44, B, 0x48), 6: ch('D', 6, 0x44, A, 0x47),
    9: ch('B', 1, 0x80, A, 0x88), 10: ch('B', 2, 0x80, B, 0x8a), 11: ch('B', 3, 0xb0, A, 0xb3),
  },
};

// ── ATmega2560 ─────────────────────────────────────────────
const PORTB = 0x25, PORTD = 0x2b, PORTE = 0x2e, PORTG = 0x34, PORTH = 0x102, PORTL = 0x10b;
const t16 = (base, timsk, tifr, v0, port, pins, extPort, extPin) => ({
  ...timer1Config,
  TCCRA: base, TCCRB: base + 1, TCCRC: base + 2, TCNT: base + 4, ICR: base + 6, OCRA: base + 8, OCRB: base + 10, OCRC: base + 12,
  TIMSK: timsk, TIFR: tifr,
  captureInterrupt: vec(v0), compAInterrupt: vec(v0 + 1), compBInterrupt: vec(v0 + 2), compCInterrupt: vec(v0 + 3), ovfInterrupt: vec(v0 + 4),
  compPortA: port, compPinA: pins[0], compPortB: port, compPinB: pins[1], compPortC: port, compPinC: pins[2],
  OCFC: 8, OCIEC: 8, externalClockPort: extPort, externalClockPin: extPin,
});
const extInt = (n, eicr) => ({ EICR: eicr, EIMSK: 0x3d, EIFR: 0x3c, index: n, iscOffset: (n % 4) * 2, interrupt: vec(n + 2) });
const EICRA = 0x69, EICRB = 0x6a;
const megaAdcChannels = {};
for (let i = 0; i < 8; i++) { megaAdcChannels[i] = { type: 0, channel: i }; megaAdcChannels[0x20 + i] = { type: 0, channel: 8 + i }; }
Object.assign(megaAdcChannels, { 0x1e: { type: 2, voltage: 1.1 }, 0x1f: { type: 2, voltage: 0 } });

const usartAt = (base, v) => ({ ...usart0Config, UCSRA: base, UCSRB: base + 1, UCSRC: base + 2, UBRRL: base + 4, UBRRH: base + 5, UDR: base + 6,
  rxCompleteInterrupt: vec(v), dataRegisterEmptyInterrupt: vec(v + 1), txCompleteInterrupt: vec(v + 2) });

const ATMEGA2560 = {
  name: 'ATmega2560', flashBytes: 0x40000, sramBytes: 8192,
  ports: {
    A: portAConfig,
    B: { ...portBConfig, pinChange: { ...portBConfig.pinChange, pinChangeInterrupt: vec(10) } },
    C: portCConfig,
    D: { ...portDConfig, pinChange: undefined, externalInterrupts: [extInt(0, EICRA), extInt(1, EICRA), extInt(2, EICRA), extInt(3, EICRA)] },
    E: { ...portEConfig, externalInterrupts: [null, null, null, null, extInt(4, EICRB), extInt(5, EICRB), extInt(6, EICRB), extInt(7, EICRB)] },
    F: portFConfig, G: portGConfig, H: portHConfig, J: portJConfig,
    K: { ...portKConfig, pinChange: { PCIE: 2, PCICR: 0x68, PCIFR: 0x3b, PCMSK: 0x6d, pinChangeInterrupt: vec(12), mask: 0xff, offset: 0 } },
    L: portLConfig,
  },
  timers: [
    { ...timer0Config, compAInterrupt: vec(22), compBInterrupt: vec(23), ovfInterrupt: vec(24), compPortA: PORTB, compPinA: 7, compPortB: PORTG, compPinB: 5, externalClockPort: PORTD, externalClockPin: 7 },
    { ...timer1Config, captureInterrupt: vec(17), compAInterrupt: vec(18), compBInterrupt: vec(19), compCInterrupt: vec(20), ovfInterrupt: vec(21),
      OCRC: 0x8c, OCFC: 8, OCIEC: 8, compPortA: PORTB, compPinA: 5, compPortB: PORTB, compPinB: 6, compPortC: PORTB, compPinC: 7, externalClockPort: PORTD, externalClockPin: 6 },
    { ...timer2Config, compAInterrupt: vec(14), compBInterrupt: vec(15), ovfInterrupt: vec(16), compPortA: PORTB, compPinA: 4, compPortB: PORTH, compPinB: 6 },
    t16(0x90, 0x71, 0x38, 32, PORTE, [3, 4, 5], PORTE, 6),
    t16(0xa0, 0x72, 0x39, 42, PORTH, [3, 4, 5], PORTH, 7),
    t16(0x120, 0x73, 0x3a, 47, PORTL, [3, 4, 5], PORTL, 2),
  ],
  usart: { ...usart0Config, rxCompleteInterrupt: vec(26), dataRegisterEmptyInterrupt: vec(27), txCompleteInterrupt: vec(28) },
  extraUsarts: [usartAt(0xc8, 36), usartAt(0xd0, 51), usartAt(0x130, 54)],      // Serial1–3
  adc: { ...adcConfig, adcInterrupt: vec(30), numChannels: 16, muxInputMask: 0x3f, muxChannels: megaAdcChannels },
  twi: { ...twiConfig, twiInterrupt: vec(40) },
  pwm: {
    2: ch('E', 4, 0x90, B, 0x9a), 3: ch('E', 5, 0x90, C, 0x9c), 4: ch('G', 5, 0x44, B, 0x48), 5: ch('E', 3, 0x90, A, 0x98),
    6: ch('H', 3, 0xa0, A, 0xa8), 7: ch('H', 4, 0xa0, B, 0xaa), 8: ch('H', 5, 0xa0, C, 0xac), 9: ch('H', 6, 0xb0, B, 0xb4),
    10: ch('B', 4, 0xb0, A, 0xb3), 11: ch('B', 5, 0x80, A, 0x88), 12: ch('B', 6, 0x80, B, 0x8a), 13: ch('B', 7, 0x44, A, 0x47),
    44: ch('L', 5, 0x120, C, 0x12c), 45: ch('L', 4, 0x120, B, 0x12a), 46: ch('L', 3, 0x120, A, 0x128),
  },
};

export const CHIPS = { atmega328p: ATMEGA328P, atmega2560: ATMEGA2560 };
