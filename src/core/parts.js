import { WOKWI_PINS } from './pins.generated.js';
import { buildBreadboard, breadboardSVG } from './breadboard.js';

const MM = 96 / 25.4; // CSS px per mm — @wokwi/elements draw everything in mm-sized SVGs

export const BREADBOARD = buildBreadboard();

const prettyUnoLabel = n => {
  if (/^\d+$/.test(n)) return `D${n}`;
  if (n === 'A5.2') return 'A5 / SCL';
  if (n === 'A4.2') return 'A4 / SDA';
  return n.replace(/^GND\.\d$/, 'GND');
};

// Nano / Mega pin labels: D-numbers, plain GND / 5V for the duplicates
const prettyBoardLabel = n => {
  if (/^\d+(\.2)?$/.test(n)) return `D${n.replace('.2', '')}${n.endsWith('.2') ? ' (ICSP)' : ''}`;
  if (n === 'SDA') return 'SDA (= D20)';
  if (n === 'SCL') return 'SCL (= D21)';
  if (n === '20') return 'D20 / SDA';
  if (n === '21') return 'D21 / SCL';
  return n.replace(/^(GND|5V|RESET)\.\d$/, '$1');
};
const ICSP = new Set(['12.2', '5V.2', '13.2', '11.2', 'RESET.3', 'GND.3']);

const fromWokwi = (tag, labeler = n => n) =>
  WOKWI_PINS[tag].map(p => ({ id: p.name, label: labeler(p.name), x: p.x, y: p.y, kind: 'pin' }));

/**
 * Part catalogue. Every entry:
 *   w,h         – box in CSS px at scale 1 (the unrotated footprint; rotation is about its centre)
 *   pins        – connection points in the same local coordinates
 *   groups      – pins that are *internally one conductor* (used by the netlist)
 *   insertable  – leads can be pushed into breadboard holes
 */
export const PART_DEFS = {
  'arduino-uno': {
    type: 'arduino-uno', name: 'Arduino Uno R3', category: 'Boards', tag: 'wokwi-arduino-uno',
    w: 72.58 * MM, h: 53.34 * MM, pins: fromWokwi('wokwi-arduino-uno', prettyUnoLabel),
    groups: [{ id: 'gnd', pins: ['GND.1', 'GND.2', 'GND.3'] }, { id: 'a4', pins: ['A4', 'A4.2'] }, { id: 'a5', pins: ['A5', 'A5.2'] }],
    insertable: false, layer: 1,
  },
  'arduino-nano': {
    type: 'arduino-nano', name: 'Arduino Nano', category: 'Boards', tag: 'wokwi-arduino-nano',
    w: 44.9 * MM, h: 17.8 * MM,
    // the ICSP header points up off the board, so it never drops into breadboard holes
    pins: fromWokwi('wokwi-arduino-nano', n => ({ A4: 'A4 / SDA', A5: 'A5 / SCL', A6: 'A6 (analog in only)', A7: 'A7 (analog in only)' }[n] || prettyBoardLabel(n))).map(p => (ICSP.has(p.id) ? { ...p, noInsert: true } : p)),
    groups: [{ id: 'gnd', pins: ['GND.1', 'GND.2', 'GND.3'] }, { id: 'v5', pins: ['5V', '5V.2'] }, { id: 'reset', pins: ['RESET', 'RESET.2', 'RESET.3'] },
      { id: 'd11', pins: ['11', '11.2'] }, { id: 'd12', pins: ['12', '12.2'] }, { id: 'd13', pins: ['13', '13.2'] }],
    insertable: true, layer: 1,
  },
  'arduino-mega': {
    type: 'arduino-mega', name: 'Arduino Mega 2560', category: 'Boards', tag: 'wokwi-arduino-mega',
    w: 102.66 * MM, h: 50.8 * MM, pins: fromWokwi('wokwi-arduino-mega', prettyBoardLabel),
    groups: [{ id: 'gnd', pins: ['GND.1', 'GND.2', 'GND.3', 'GND.4', 'GND.5'] }, { id: 'v5', pins: ['5V', '5V.1', '5V.2'] }, { id: 'sda', pins: ['SDA', '20'] }, { id: 'scl', pins: ['SCL', '21'] }],
    insertable: false, layer: 1,
  },
  breadboard: {
    type: 'breadboard', name: 'Solderless Breadboard', category: 'Prototyping', tag: null,
    w: BREADBOARD.width, h: BREADBOARD.height, pins: BREADBOARD.pins, groups: BREADBOARD.groups,
    insertable: false, isBoard: true, layer: 0,
  },
  led: {
    type: 'led', name: 'LED', category: 'Basic', tag: 'wokwi-led',
    w: 40, h: 50, pins: fromWokwi('wokwi-led', n => (n === 'A' ? 'Anode (+)' : 'Cathode (−)')),
    groups: [], insertable: true, layer: 2, props: { color: 'red' },
  },
  'rgb-led': {
    type: 'rgb-led', name: 'RGB LED', category: 'Basic', tag: 'wokwi-rgb-led',
    w: 42.125, h: 75.578, pins: fromWokwi('wokwi-rgb-led', n => (n === 'COM' ? 'Common cathode (−)' : `${{ R: 'Red', G: 'Green', B: 'Blue' }[n]} anode (+)`)),
    groups: [], insertable: true, layer: 2,
    channels: [{ id: 'R', a: 'R', k: 'COM', vf: 2.0, rd: 15 }, { id: 'G', a: 'G', k: 'COM', vf: 3.0, rd: 25 }, { id: 'B', a: 'B', k: 'COM', vf: 3.0, rd: 25 }],
  },
  resistor: {
    // A resistor's legs bend: it stretches to fit exactly between any two holes (lead spacing `len`, any angle). Body: 4 pitches long.
    type: 'resistor', name: 'Resistor', category: 'Basic', tag: 'wokwi-resistor', flex: true,
    w: 57.6, h: 11.34, len: 57.6, minLen: 38.4, pins: fromWokwi('wokwi-resistor', n => `Lead ${n}`),
    groups: [], insertable: true, layer: 2, ohms: 220, props: { ohms: 220, len: 57.6 },
  },
  pushbutton: {
    type: 'pushbutton', name: 'Pushbutton', category: 'Input', tag: 'wokwi-pushbutton',
    w: 17.802 * MM, h: 12 * MM, pins: fromWokwi('wokwi-pushbutton', n => `Terminal ${n}`),
    groups: [{ id: 'sw1', pins: ['1.l', '1.r'] }, { id: 'sw2', pins: ['2.l', '2.r'] }],
    insertable: true, layer: 2,
  },
  'slide-switch': {
    type: 'slide-switch', name: 'Slide Switch', category: 'Input', tag: 'wokwi-slide-switch',
    w: 32.125, h: 37.875, pins: fromWokwi('wokwi-slide-switch', n => ({ 1: 'Throw 1', 2: 'Common', 3: 'Throw 3' }[n])),
    groups: [], insertable: true, layer: 2, props: { pos: 0 },
  },
  potentiometer: {
    type: 'potentiometer', name: 'Potentiometer', category: 'Input', tag: 'wokwi-potentiometer',
    w: 75.578, h: 78.578, pins: fromWokwi('wokwi-potentiometer', n => ({ GND: 'GND', SIG: 'Wiper (signal)', VCC: 'VCC' }[n])),
    groups: [], insertable: true, layer: 2, props: { level: 50 },
  },
  'seven-segment': {
    type: 'seven-segment', name: '7-Segment Display', category: 'Displays', tag: 'wokwi-7segment',
    w: 47.422, h: 86.141, pins: fromWokwi('wokwi-7segment', n => (n.startsWith('COM') ? 'Common cathode (−)' : n === 'DP' ? 'Decimal point' : `Segment ${n}`)),
    groups: [{ id: 'com', pins: ['COM.1', 'COM.2'] }], insertable: true, layer: 2,
    segments: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'],   // element order: values[0..7]
  },
  'pir-sensor': {
    type: 'pir-sensor', name: 'PIR Motion Sensor', category: 'Sensors', tag: 'wokwi-pir-motion-sensor',
    w: 90.703, h: 95.391, pins: fromWokwi('wokwi-pir-motion-sensor', n => (n === 'OUT' ? 'OUT (signal)' : n)),
    groups: [], insertable: true, layer: 2, interactive: true,
  },
  'ldr-module': {
    type: 'ldr-module', name: 'Photoresistor Module', category: 'Sensors', tag: 'wokwi-photoresistor-sensor',
    w: 173.656, h: 64.469, pins: fromWokwi('wokwi-photoresistor-sensor', n => ({ VCC: 'VCC', GND: 'GND', DO: 'DO (digital)', AO: 'AO (analog)' }[n])),
    groups: [], insertable: true, layer: 2, props: { lux: 500 },
  },
  'ntc-sensor': {
    type: 'ntc-sensor', name: 'NTC Temperature Sensor', category: 'Sensors', tag: 'wokwi-ntc-temperature-sensor',
    w: 135.391, h: 74.797, pins: fromWokwi('wokwi-ntc-temperature-sensor', n => ({ GND: 'GND', VCC: 'VCC', OUT: 'OUT (analog)' }[n])),
    groups: [], insertable: true, layer: 2, props: { temp: 25 },
  },
  // I²C parts: `i2c` says which pins are the bus and power, and the address (src/core/i2c.js decides whether
  // a part is really on the bus; src/parts/* hold the device models the simulated chip talks to).
  mpu6050: {
    type: 'mpu6050', name: 'MPU-6050 Accelerometer + Gyro', category: 'Sensors', tag: 'wokwi-mpu6050',
    w: 21.6 * MM, h: 16.2 * MM, pins: fromWokwi('wokwi-mpu6050', n => ({ INT: 'INT (interrupt)', AD0: 'AD0 (address: GND → 0x68, VCC → 0x69)', XCL: 'XCL (aux I²C, unused)', XDA: 'XDA (aux I²C, unused)', SDA: 'SDA (I²C data → A4)', SCL: 'SCL (I²C clock → A5)', GND: 'GND', VCC: 'VCC' }[n])),
    groups: [], insertable: true, layer: 2, props: { roll: 0, pitch: 0, yaw: 0, temp: 25 }, inspector: true,
    i2c: { sda: 'SDA', scl: 'SCL', vcc: ['VCC'], gnd: ['GND'], address: 0x68, addressPin: 'AD0', addressHigh: 0x69 },
    aiNote: 'I²C at 0x68 (0x69 if AD0 is wired to VCC). Wire VCC→5V, GND→GND, SDA→A4, SCL→A5. Libraries available: Wire, Adafruit_MPU6050 (+ Adafruit_Sensor). Accel reads +1 g on Z when flat. The student tilts it by right-clicking it (roll/pitch/yaw).',
  },
  ssd1306: {
    type: 'ssd1306', name: 'OLED Display 128×64 (SSD1306)', category: 'Displays', tag: 'wokwi-ssd1306',
    w: 150, h: 116, pins: fromWokwi('wokwi-ssd1306', n => ({ DATA: 'DATA (SDA → A4)', CLK: 'CLK (SCL → A5)', DC: 'DC (SPI only)', RST: 'RST (optional)', CS: 'CS (SPI only)', '3V3': '3.3 V out', VIN: 'VIN (5 V in)', GND: 'GND' }[n])),
    groups: [], insertable: false, layer: 2,
    i2c: { sda: 'DATA', scl: 'CLK', vcc: ['VIN', '3V3'], gnd: ['GND'], address: 0x3c },
    aiNote: 'I²C at 0x3C. Wire VIN→5V, GND→GND, DATA→A4 (SDA), CLK→A5 (SCL). Libraries available: Wire, Adafruit_SSD1306 + Adafruit_GFX (use display.begin(SSD1306_SWITCHCAPVCC, 0x3C), and call display.display() after drawing).',
  },
};

for (const def of Object.values(PART_DEFS)) def.pinById = new Map(def.pins.map(p => [p.id, p]));

export const CATALOG_ORDER = ['arduino-uno', 'arduino-nano', 'arduino-mega', 'breadboard', 'led', 'rgb-led', 'resistor', 'pushbutton', 'slide-switch', 'potentiometer', 'seven-segment', 'pir-sensor', 'ldr-module', 'ntc-sensor', 'mpu6050', 'ssd1306'];
export const boardSVGMarkup = () => breadboardSVG(BREADBOARD);
