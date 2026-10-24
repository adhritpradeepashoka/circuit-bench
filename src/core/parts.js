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
// Raspberry Pi Pico: 21 × 51 mm, 40 castellated pins on a 2.54 mm pitch, USB at the top. Left column = pins 1–20 (top to bottom),
// right column = pins 40–21 (top to bottom). The ids are what a sketch calls the pin: 15 means GP15, A0 means GP26.
export const PICO_W = 21 * MM, PICO_H = 51 * MM, PICO_PITCH = 2.54 * MM;
const PICO_LEFT = ['0', '1', 'GND.1', '2', '3', '4', '5', 'GND.2', '6', '7', '8', '9', 'GND.3', '10', '11', '12', '13', 'GND.4', '14', '15'];
const PICO_RIGHT = ['VBUS', 'VSYS', 'GND.5', '3V3_EN', '3V3', 'ADC_VREF', 'A2', 'AGND', 'A1', 'A0', 'RUN', '22', 'GND.6', '21', '20', '19', '18', 'GND.7', '17', '16'];
const PICO_LABEL = { 0: 'GP0 · UART0 TX', 1: 'GP1 · UART0 RX', 4: 'GP4 · SDA', 5: 'GP5 · SCL', A0: 'GP26 · A0', A1: 'GP27 · A1', A2: 'GP28 · A2', VBUS: 'VBUS (5 V from USB)', VSYS: 'VSYS', '3V3': '3V3 (3.3 V out)', '3V3_EN': '3V3_EN', ADC_VREF: 'ADC_VREF', AGND: 'AGND', RUN: 'RUN (reset)' };
const picoLabel = id => PICO_LABEL[id] || (/^\d+$/.test(id) ? `GP${id}` : id.replace(/^GND\.\d$/, 'GND'));
const picoPins = () => {
  const x0 = (PICO_W - 7 * PICO_PITCH) / 2, y0 = (PICO_H - 19 * PICO_PITCH) / 2;
  return [...PICO_LEFT.map((id, i) => ({ id, x: x0, y: y0 + i * PICO_PITCH })), ...PICO_RIGHT.map((id, i) => ({ id, x: x0 + 7 * PICO_PITCH, y: y0 + i * PICO_PITCH }))]
    .map(p => ({ id: p.id, label: picoLabel(p.id), x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, kind: 'pin' }));
};

export const PART_DEFS = {
  'arduino-uno': {
    type: 'arduino-uno', name: 'Arduino Uno R3', category: 'Boards', tag: 'wokwi-arduino-uno',
    w: 72.58 * MM, h: 53.34 * MM, pins: fromWokwi('wokwi-arduino-uno', prettyUnoLabel),
    groups: [{ id: 'gnd', pins: ['GND.1', 'GND.2', 'GND.3'] }, { id: 'a4', pins: ['A4', 'A4.2'] }, { id: 'a5', pins: ['A5', 'A5.2'] }],
    insertable: false, layer: 1,
  },
  'arduino-uno-r4': {
    type: 'arduino-uno-r4', name: 'Arduino UNO R4 Minima', category: 'Boards', tag: 'cb-uno-r4',
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
  'raspberry-pi-pico': {
    type: 'raspberry-pi-pico', name: 'Raspberry Pi Pico', category: 'Boards', tag: 'cb-pi-pico',
    w: PICO_W, h: PICO_H, pins: picoPins(),
    groups: [{ id: 'gnd', pins: ['GND.1', 'GND.2', 'GND.3', 'GND.4', 'GND.5', 'GND.6', 'GND.7', 'AGND'] }],
    insertable: true, layer: 1,
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
  lcd1602: {
    type: 'lcd1602', name: 'LCD 16×2 (I²C backpack)', category: 'Displays', tag: 'wokwi-lcd1602',
    w: 80 * MM, h: 36 * MM,
    pins: [['GND', 4, 32, 'GND'], ['VCC', 4, 41.5, 'VCC (5 V)'], ['SDA', 4, 51, 'SDA (I²C data)'], ['SCL', 4, 60.5, 'SCL (I²C clock)']].map(([id, x, y, label]) => ({ id, label, x, y, kind: 'pin' })),
    groups: [], insertable: false, layer: 2,
    i2c: { sda: 'SDA', scl: 'SCL', vcc: ['VCC'], gnd: ['GND'], address: 0x27 },
    aiNote: 'HD44780 16×2 character LCD on a PCF8574 I²C backpack at address 0x27. Wire GND→GND, VCC→5V, SDA→the board\'s SDA pin, SCL→its SCL pin. Library available: LiquidCrystal_I2C (LiquidCrystal_I2C lcd(0x27, 16, 2); then lcd.init(); lcd.backlight(); lcd.setCursor(col, row); lcd.print(...)). lcd.init() takes about 1 s. Custom characters with lcd.createChar(0..7, bytes) and lcd.write(n) — call lcd.setCursor() after createChar, or the next print goes into character memory instead of the screen.',
  },
  dht: {
    type: 'dht', name: 'DHT22 / DHT11 Temp + Humidity', category: 'Sensors', tag: 'wokwi-dht22',
    w: 15.1 * MM, h: 30.885 * MM,
    pins: [['VCC', 15, 114.9, 'VCC (3.3–5 V)'], ['SDA', 24.5, 114.9, 'DATA (to a digital pin)'], ['NC', 34.1, 114.9, 'NC (not connected)'], ['GND', 43.8, 114.9, 'GND']].map(([id, x, y, label]) => ({ id, label, x, y, kind: 'pin' })),
    groups: [], insertable: true, layer: 2, props: { model: 'DHT22', temp: 24, humidity: 40 },
    aiNote: 'Single-wire digital sensor (not analog, not I²C). Wire VCC→5V, GND→GND, DATA→any digital pin. The "model" prop is DHT22 or DHT11 — the sketch must say the same type. Library available: DHT sensor library (#include <DHT.h>; DHT dht(pin, DHT22); dht.begin(); dht.readTemperature(); dht.readHumidity(); — returns NaN when the read fails, and the sensor can only be read every 2 s). The student sets temperature/humidity by right-clicking it.',
  },
  'dc-motor': {
    type: 'dc-motor', name: 'DC Motor', category: 'Motors', tag: 'cb-dc-motor',
    w: 120, h: 120,
    pins: [{ id: '1', label: 'Motor + (red)', x: 44, y: 116, kind: 'pin' }, { id: '2', label: 'Motor − (black)', x: 76, y: 116, kind: 'pin' }],
    groups: [], insertable: false, layer: 2,
    aiNote: '3–6 V hobby motor (≈ 20 Ω, ~250 rpm at 6 V). It reverses when its two leads are swapped. NEVER wire it straight to an Arduino pin (it needs far more than 40 mA) — drive it through an l298n motor driver: OUT1/OUT2 (or OUT3/OUT4) to the motor.',
  },
  l298n: {
    type: 'l298n', name: 'L298N Motor Driver', category: 'Motors', tag: 'cb-l298n',
    w: 170, h: 172,
    pins: [
      ['OUT1', 7, 60, 'OUT1 (motor A)'], ['OUT2', 7, 80, 'OUT2 (motor A)'], ['OUT3', 163, 60, 'OUT3 (motor B)'], ['OUT4', 163, 80, 'OUT4 (motor B)'],
      ['12V', 30, 164, '12V (motor supply in)'], ['GND', 50, 164, 'GND'], ['5V', 70, 164, '5V (logic)'],
      ['ENA', 92, 166, 'ENA (enable A — PWM sets speed)'], ['IN1', 101.6, 166, 'IN1'], ['IN2', 111.2, 166, 'IN2'], ['IN3', 120.8, 166, 'IN3'], ['IN4', 130.4, 166, 'IN4'], ['ENB', 140, 166, 'ENB (enable B — PWM sets speed)'],
    ].map(([id, x, y, label]) => ({ id, label, x, y, kind: 'pin' })),
    groups: [], insertable: false, layer: 2,
    aiNote: 'Dual H-bridge. Motor A: IN1/IN2 set direction (HIGH/LOW = forward, LOW/HIGH = reverse, both the same = stop), ENA enables it (analogWrite on ENA sets the speed; left unconnected, its jumper keeps it fully on). Motor B: IN3/IN4/ENB → OUT3/OUT4. Power: 12V from a battery (6–12 V) or the board\'s VIN, and GND MUST be shared with the Arduino\'s GND. Outputs drop ≈ 1.4 V. Wire ENA/ENB to PWM pins if speed control is wanted.',
  },
  battery: {
    type: 'battery', name: 'Battery (9 V)', category: 'Power', tag: 'cb-battery',
    w: 76, h: 128,
    pins: [{ id: '+', label: '+ (positive)', x: 23, y: 9, kind: 'pin' }, { id: '-', label: '− (negative)', x: 51, y: 10, kind: 'pin' }],
    groups: [], insertable: false, layer: 2, props: { volts: 9 },
    aiNote: 'A DC supply between + and −; "volts" prop (1.5–12, default 9). Its − must be joined to the Arduino GND when it powers something the Arduino controls.',
  },
};

for (const def of Object.values(PART_DEFS)) def.pinById = new Map(def.pins.map(p => [p.id, p]));

export const CATALOG_ORDER = ['arduino-uno', 'arduino-nano', 'arduino-mega', 'arduino-uno-r4', 'raspberry-pi-pico', 'breadboard', 'led', 'rgb-led', 'resistor', 'pushbutton', 'slide-switch', 'potentiometer', 'seven-segment', 'pir-sensor', 'ldr-module', 'ntc-sensor', 'dht', 'mpu6050', 'ssd1306', 'lcd1602', 'dc-motor', 'l298n', 'battery'];
export const boardSVGMarkup = () => breadboardSVG(BREADBOARD);
