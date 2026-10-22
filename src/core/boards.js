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

const powerOf = id => {
  if (/^GND(\.\d+)?$/.test(id)) return 'gnd';
  if (/^5V(\.\d+)?$/.test(id) || id === 'IOREF') return 'v5';
  if (id === '3.3V') return 'v33';
  if (id === 'VIN') return 'vin';
  return null;
};

export const BOARD_SPECS = {
  'arduino-uno': {
    name: 'Arduino Uno', chip: 'atmega328p', fqbn: 'arduino:avr:uno', pins: PINS_328P, ledPin: '13',
    i2c: { sda: 'A4', scl: 'A5' }, ram: 2048, flash: 32256,
  },
  'arduino-nano': {
    name: 'Arduino Nano', chip: 'atmega328p', fqbn: 'arduino:avr:nano', ledPin: '13',
    pins: { ...PINS_328P, A6: { adc: 6 }, A7: { adc: 7 } },             // A6/A7: analog-only on the Nano (no digital port)
    i2c: { sda: 'A4', scl: 'A5' }, ram: 2048, flash: 30720,
  },
  'arduino-mega': {
    name: 'Arduino Mega 2560', chip: 'atmega2560', fqbn: 'arduino:avr:mega', pins: PINS_MEGA, ledPin: '13',
    i2c: { sda: '20', scl: '21' }, ram: 8192, flash: 253952,
  },
};
export const DEFAULT_BOARD = 'arduino-uno';
export const boardSpec = type => BOARD_SPECS[type] || null;
export const isMcuBoard = type => !!BOARD_SPECS[type];
/** gnd | v5 | v33 | vin | null — what a board's power pin is. */
export const boardPowerPin = powerOf;
/** The board in a circuit that runs firmware (the first one, if several were placed). */
export const mainBoard = parts => parts.find(p => BOARD_SPECS[p.type]) || null;
