// The Arduino AI boards, drawn as real parts: the UNO Q and the VENTUNO Q. Pin positions come from the Uno's own header geometry (the UNO Q uses the
// Uno footprint, so shields and jumper wires land where they would on a real board) and, for the VENTUNO Q, from the same Uno headers plus its 40-pin
// HAT header and Qwiic connector. Labels follow the Arduino datasheets (ABX00162/ABX00173 and ABX00181). Both boards carry a 13 × 8 LED matrix
// (src/core/matrix.js). Neither runs a sketch here yet: they are for wiring, planning and the matrix.
import { WOKWI_PINS } from './pins.generated.js';

const MM = 96 / 25.4, r2 = n => Math.round(n * 100) / 100;
export const UNOQ_W = 72.58 * MM, UNOQ_H = 53.34 * MM;               // the Uno footprint
export const VENTUNO_W = 160 * MM, VENTUNO_H = 100 * MM;             // 160 × 100 mm
export const VENTUNO_UNO_AT = [28, 160];                              // where the Uno-style headers sit on the VENTUNO Q drawing
export const HAT_AT = [330, 42], HAT_PITCH = 9.6, QWIIC_AT = [506, 344];

const UNOQ_LABEL = {
  0: 'D0 · RX (Serial1)', 1: 'D1 · TX (Serial1)', 2: 'D2', 3: 'D3 · PWM (not 5 V safe)', 4: 'D4 · CAN TX', 5: 'D5 · PWM · CAN RX', 6: 'D6 · PWM', 7: 'D7', 8: 'D8', 9: 'D9 · PWM',
  10: 'D10 · SS · PWM', 11: 'D11 · MOSI · PWM', 12: 'D12 · MISO', 13: 'D13 · SCK', 'A5.2': 'D21 · SCL (Wire)', 'A4.2': 'D20 · SDA (Wire)', AREF: 'AREF', IOREF: 'IOREF (3.3 V)', RESET: 'RESET',
  '3.3V': '3V3 (out)', '5V': '5V (out)', VIN: 'VIN (7–24 V in)', A0: 'A0 · DAC0 (not 5 V safe)', A1: 'A1 · DAC1 (not 5 V safe)', A2: 'A2 (not 5 V safe)', A3: 'A3 (not 5 V safe)', A4: 'A4 · SDA (I2C3)', A5: 'A5 · SCL (I2C3)',
};
const unoLabel = n => UNOQ_LABEL[n] || n.replace(/^GND\.\d$/, 'GND');
const unoPins = (dx = 0, dy = 0, label = unoLabel) => WOKWI_PINS['wokwi-arduino-uno'].map(p => ({ id: p.name, label: label(p.name), x: r2(p.x + dx), y: r2(p.y + dy), kind: 'pin' }));
// On the real boards SDA/SCL (D20/D21) are their own pins. The simulator's AVR core has one I²C bus on the A4/A5 pins, so here D20/D21 are tied to A4/A5
// (a part on either reaches the same bus; A4/A5 cannot be used as separate GPIO at the same time as I²C).
const UNO_GROUPS = [{ id: 'gnd', pins: ['GND.1', 'GND.2', 'GND.3'] }, { id: 'sda', pins: ['A4', 'A4.2'] }, { id: 'scl', pins: ['A5', 'A5.2'] }];

export const UNOQ_PINS = unoPins();
export const UNOQ_GROUPS = UNO_GROUPS;

// ── VENTUNO Q ──
const VENT_LABEL = n => (n === '3' ? 'D3 · PWM' : n === 'A0' ? 'A0 (not 5 V tolerant)' : n === 'A1' ? 'A1 (not 5 V tolerant)' : n === '5' ? 'D5 · PWM · CAN-FD RX' : n === '4' ? 'D4 · CAN-FD TX' : unoLabel(n).replace(' (not 5 V safe)', ''));
// the 40-pin JHAT header: Raspberry Pi numbering, level-translated to 3.3 V
const HAT = [['3V3', '3V3'], ['5V', '5V'], ['GPIO2', 'GPIO2 · SDA (I2C1)'], ['5V', '5V'], ['GPIO3', 'GPIO3 · SCL (I2C1)'], ['GND', 'GND'], ['GPIO4', 'GPIO4'], ['GPIO14', 'GPIO14 · TX (UART0)'], ['GND', 'GND'], ['GPIO15', 'GPIO15 · RX (UART0)'],
  ['GPIO17', 'GPIO17'], ['GPIO18', 'GPIO18 · I2S CLK'], ['GPIO27', 'GPIO27'], ['GND', 'GND'], ['GPIO22', 'GPIO22'], ['GPIO23', 'GPIO23'], ['3V3', '3V3'], ['GPIO24', 'GPIO24'], ['GPIO10', 'GPIO10 · MOSI (SPI0)'], ['GND', 'GND'],
  ['GPIO9', 'GPIO9 · MISO (SPI0)'], ['GPIO25', 'GPIO25'], ['GPIO11', 'GPIO11 · SCLK (SPI0)'], ['GPIO8', 'GPIO8 · CE0 (SPI0)'], ['GND', 'GND'], ['GPIO7', 'GPIO7 · CE1'], ['GPIO0', 'GPIO0 · ID SD'], ['GPIO1', 'GPIO1 · ID SC'], ['GPIO5', 'GPIO5'], ['GND', 'GND'],
  ['GPIO6', 'GPIO6'], ['GPIO12', 'GPIO12'], ['GPIO13', 'GPIO13'], ['GND', 'GND'], ['GPIO19', 'GPIO19 · I2S FS'], ['GPIO16', 'GPIO16'], ['GPIO26', 'GPIO26'], ['GPIO20', 'GPIO20 · I2S DIN'], ['GND', 'GND'], ['GPIO21', 'GPIO21 · I2S DOUT']];
const hatPins = () => HAT.map(([name, label], i) => ({ id: `H${i + 1}`, label: `${i + 1} · ${label}`, x: r2(HAT_AT[0] + ((i >> 1) * HAT_PITCH)), y: r2(HAT_AT[1] + (i % 2) * HAT_PITCH), kind: 'pin' }));
const QWIIC = [['QGND', 'Qwiic GND'], ['Q3V3', 'Qwiic 3V3'], ['QSDA', 'Qwiic SDA (PC9)'], ['QSCL', 'Qwiic SCL (PA8)']];
const qwiicPins = () => QWIIC.map(([id, label], i) => ({ id, label, x: r2(QWIIC_AT[0] + i * HAT_PITCH), y: QWIIC_AT[1], kind: 'pin' }));
export const VENTUNO_PINS = [...unoPins(VENTUNO_UNO_AT[0], VENTUNO_UNO_AT[1], VENT_LABEL), ...hatPins(), ...qwiicPins()];
const hatOf = name => HAT.map(([n], i) => (n === name ? `H${i + 1}` : null)).filter(Boolean);
export const VENTUNO_GROUPS = [
  { id: 'gnd', pins: ['GND.1', 'GND.2', 'GND.3', ...hatOf('GND'), 'QGND'] },
  { id: 'sda', pins: ['A4', 'A4.2', 'QSDA'] }, { id: 'scl', pins: ['A5', 'A5.2', 'QSCL'] },
  { id: 'v33', pins: ['3.3V', ...hatOf('3V3'), 'Q3V3'] }, { id: 'v5', pins: ['5V', ...hatOf('5V')] },
];

/** The AI boards a new project can start from (drawn and wired; their STM32 firmware support is separate). */
export const AI_BOARD_TYPES = ['arduino-uno-q', 'arduino-ventuno-q'];
