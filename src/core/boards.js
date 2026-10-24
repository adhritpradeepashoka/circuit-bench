// Microcontroller boards: everything the netlist, simulator, compiler and AI need to know about each one, in
// one place. Pure (no DOM): pin ids are the @wokwi/elements pin names; `pins` maps each MCU-driven pin to its
// AVR port/bit (and ADC channel, for analog inputs). Adding a board means adding an entry here, a PART_DEFS
// entry for its drawing, and — only if it uses a new chip — a config in src/sim/chips.js.

const range = (n, from = 0) => Array.from({ length: n }, (_, i) => i + from);

// ATmega328P (Uno, Nano): D0–7 = PORTD, D8–13 = PORTB, A0–A5 = PORTC (ADC0–5)
const PINS_328P = {};
for (const i of range(8)) PINS_328P[String(i)] = { port: 'D', bit: i };
for (const i of range(6, 8)) PINS_328P[String(i)] = { port: 'B', bit: i - 8 };
for (const i of range(6)) PINS_328P[`A${i}`] = { port: 'C', bit: i, adc: i };

// ATmega2560 (Mega) — pins_arduino.h "mega" variant
const MEGA_DIGITAL = {
  0: 'E0', 1: 'E1', 2: 'E4', 3: 'E5', 4: 'G5', 5: 'E3', 6: 'H3', 7: 'H4', 8: 'H5', 9: 'H6', 10: 'B4', 11: 'B5', 12: 'B6', 13: 'B7',
  14: 'J1', 15: 'J0', 16: 'H1', 17: 'H0', 18: 'D3', 19: 'D2', 20: 'D1', 21: 'D0',
  22: 'A0', 23: 'A1', 24: 'A2', 25: 'A3', 26: 'A4', 27: 'A5', 28: 'A6', 29: 'A7',
  30: 'C7', 31: 'C6', 32: 'C5', 33: 'C4', 34: 'C3', 35: 'C2', 36: 'C1', 37: 'C0', 38: 'D7', 39: 'G2', 40: 'G1', 41: 'G0',
  42: 'L7', 43: 'L6', 44: 'L5', 45: 'L4', 46: 'L3', 47: 'L2', 48: 'L1', 49: 'L0', 50: 'B3', 51: 'B2', 52: 'B1', 53: 'B0',
};
const PINS_MEGA = {};
for (const [n, pb] of Object.entries(MEGA_DIGITAL)) PINS_MEGA[n] = { port: pb[0], bit: +pb[1] };
for (const i of range(8)) PINS_MEGA[`A${i}`] = { port: 'F', bit: i, adc: i };
for (const i of range(8, 8)) PINS_MEGA[`A${i}`] = { port: 'K', bit: i - 8, adc: i };

// Raspberry Pi Pico (RP2040): pins are GPIO numbers, which is also what Arduino-Pico's pinMode()/digitalWrite() take.
// GP0–GP22 are on the header, GP25 is the on-board LED, GP26–GP28 are the three ADC inputs (A0–A2).
// Everything is 3.3 V: pins, ADC reference, I²C. VBUS is the 5 V that comes straight from USB.
const PINS_RP2040 = {};
for (const i of range(23)) PINS_RP2040[String(i)] = { port: 'GP', bit: i };
PINS_RP2040['25'] = { port: 'GP', bit: 25, internal: true };
for (const i of range(3)) PINS_RP2040[`A${i}`] = { port: 'GP', bit: 26 + i, adc: i };

const powerOf = id => {
  if (/^GND(\.\d+)?$/.test(id) || id === 'AGND') return 'gnd';
  if (/^5V(\.\d+)?$/.test(id) || id === 'IOREF' || id === 'VBUS') return 'v5';
  if (id === '3.3V' || id === '3V3') return 'v33';
  if (id === 'VIN' || id === 'VSYS') return 'vin';
  return null;
};

const AVR_PWM_328 = ['3', '5', '6', '9', '10', '11'];
const AVR_PWM_MEGA = [...range(12, 2).map(String), '44', '45', '46'];

export const BOARD_SPECS = {
  'arduino-uno': {
    name: 'Arduino Uno', chip: 'atmega328p', fqbn: 'arduino:avr:uno', pins: PINS_328P, ledPin: '13',
    i2c: { sda: 'A4', scl: 'A5' }, ram: 2048, flash: 32256,
    chipName: 'ATmega328P', logic: 5, adcBits: 10, pwm: AVR_PWM_328, pwmPrefer: ['11', '6', '5', '3', '9', '10'],
    avoid: ['0', '1', 'A4', 'A5'],
  },
  'arduino-nano': {
    name: 'Arduino Nano', chip: 'atmega328p', fqbn: 'arduino:avr:nano', ledPin: '13',
    pins: { ...PINS_328P, A6: { adc: 6 }, A7: { adc: 7 } },             // A6/A7: analog-only on the Nano (no digital port)
    i2c: { sda: 'A4', scl: 'A5' }, ram: 2048, flash: 30720,
    chipName: 'ATmega328P', logic: 5, adcBits: 10, pwm: AVR_PWM_328, pwmPrefer: ['11', '6', '5', '3', '9', '10'],
    avoid: ['0', '1', 'A4', 'A5'],
  },
  'arduino-mega': {
    name: 'Arduino Mega 2560', chip: 'atmega2560', fqbn: 'arduino:avr:mega', pins: PINS_MEGA, ledPin: '13',
    i2c: { sda: '20', scl: '21' }, ram: 8192, flash: 253952,
    chipName: 'ATmega2560', logic: 5, adcBits: 10, pwm: AVR_PWM_MEGA, pwmPrefer: ['11', '6', '5', '3', '9', '10'],
    avoid: ['0', '1', '20', '21'], i2cHeader: { sda: 'SDA', scl: 'SCL' },
  },
  'raspberry-pi-pico': {
    name: 'Raspberry Pi Pico', chip: 'rp2040', fqbn: 'rp2040:rp2040:rpipico', pins: PINS_RP2040, ledPin: '25',
    i2c: { sda: '4', scl: '5' }, ram: 264 * 1024, flash: 2 * 1024 * 1024,
    chipName: 'RP2040', logic: 3.3, adcBits: 12, pwm: range(23).map(String), pwmPrefer: [],
    aiNote: 'Pins are GPIO numbers: pinMode(15, OUTPUT) is GP15, and A0–A2 are GP26–GP28 (the only analog inputs). Every pin can do PWM (analogWrite, 0–255). I²C (Wire) is SDA = GP4, SCL = GP5. All logic and the ADC reference are 3.3 V: never put 5 V on a pin (use a voltage divider), and power sensors from 3V3 unless they need 5 V (VBUS). analogRead returns 0–1023 for 0–3.3 V. Serial is USB serial. LED_BUILTIN is GP25 (the on-board LED).',
    highFrom: 15, pinOhms: 40, pinMaxA: 0.015, pinRatingText: 'Pico pin limit: about 12 mA, 16 mA at the very most', pullG: 1 / 60000, inputThreshold: 1.65,
    avoid: ['0', '1', '4', '5'], rails: { gnd: 'GND.1', v5: 'VBUS', v33: '3V3', vin: 'VSYS' },
  },
};
export const DEFAULT_BOARD = 'arduino-uno';
export const boardSpec = type => BOARD_SPECS[type] || null;
export const isMcuBoard = type => !!BOARD_SPECS[type];
/** gnd | v5 | v33 | vin | null — what a board's power pin is. */
export const boardPowerPin = powerOf;
/** The board in a circuit that runs firmware (the first one, if several were placed). */
export const mainBoard = parts => parts.find(p => BOARD_SPECS[p.type]) || null;
