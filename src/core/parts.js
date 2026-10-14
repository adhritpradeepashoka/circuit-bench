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
};

for (const def of Object.values(PART_DEFS)) def.pinById = new Map(def.pins.map(p => [p.id, p]));

export const CATALOG_ORDER = ['arduino-uno', 'breadboard', 'led', 'rgb-led', 'resistor', 'pushbutton', 'slide-switch', 'potentiometer', 'seven-segment', 'pir-sensor', 'ldr-module', 'ntc-sensor'];
export const boardSVGMarkup = () => breadboardSVG(BREADBOARD);
