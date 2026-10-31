// Ready-made starting points for the Part Creator ("Start from a template"): the common components a bench
// has, already wired up to the right behaviour, so a student can make one without typing a single pin — or
// without an AI. Each template goes through validatePartSpec() like anything else (the tests check every one).
//
// pins: [id, label?]; DIP/quad templates list pins in datasheet order, pin 1 first (no sides — the package places them).

import { BOARD_TEMPLATES } from './board-templates.js';

const mod = (name, label, color, pins, behaviour, extra = {}) => ({
  name, label, color, textColor: extra.textColor || '#ffffff', description: extra.description || '', package: 'module', breadboard: extra.breadboard !== false,
  pins: pins.map(p => (Array.isArray(p) ? { id: p[0], label: p[1] || p[0] } : { id: p, label: p })), behaviour,
});
const chip = (name, label, color, pkg, pins, behaviour, description = '') => ({
  name, label, color, textColor: '#e8e8e8', description, package: pkg, breadboard: true, pins: pins.map(p => (Array.isArray(p) ? { id: p[0], label: p[1] || p[0] } : { id: p, label: p })), behaviour,
});

/** Which picture each ready-made part gets (see part-looks.js). Parts not listed keep the plain labelled box. */
const LOOK_OF = {
  'sw-spst': 'toggle', 'sw-spdt': 'slide', 'sw-reed': 'reed', 'pot-trimmer': 'trimmer', fsr: 'fsr', flex: 'flex', soil: 'soil',
  'd-1n4007': 'diode', 'd-1n4148': 'diode', 'd-schottky': 'diode', 'd-zener': 'diode',
  'opamp-lm358': 'chip', 'opamp-rr': 'chip', 'opamp-tl07x': 'chip', 'opamp-op07': 'chip', 'opamp-741': 'chip', 'inamp-ina128': 'chip',
  'q-2n2222': 'to92',  'q-bc547': 'to92', 'q-2n2907': 'to92', 'q-irlz44n': 'to220', 'q-irf540': 'to220', 'q-irf9540': 'to220',
  'reg-7805': 'to220', 'reg-1117': 'sot223', 'reg-buck': 'buck', 'relay-5v': 'relay', 'relay-12v': 'relay',
  'cap-100n': 'capDisc', 'cap-100u': 'capElectro', 'cap-1000u': 'capElectro', 'ind-10mh': 'inductor', solenoid: 'solenoid',
  'buzzer-active': 'buzzer', 'buzzer-passive': 'buzzer', speaker: 'speaker', fan: 'fan', vibe: 'vibe', pump: 'pump', 'led-bar': 'ledbar', 'servo-sg90': 'servo', stepper: 'stepper',
  hcsr04: 'hcsr04', ky040: 'encoder', 'ir-dist': 'irdist', sound: 'mic', hall: 'to92', 'signal-source': 'person',
  'gate-not': 'chip', 'gate-and': 'chip', 'gate-or': 'chip', 'gate-xor': 'chip', 'gate-nand': 'chip', 'gate-nor': 'chip', 'gate-dff': 'chip', 'gate-mux2': 'chip',
};

export const TEMPLATE_GROUPS = ['Switches & resistors', 'Diodes & transistors', 'Power', 'Capacitors & coils', 'Sound, light & motion', 'Sensors & inputs', 'Chips', 'Drone', 'Dev boards'];

export const TEMPLATES = [
  // ── Switches & resistors
  { group: 0, id: 'sw-spst', ...mod('Toggle switch (on / off)', 'SW', '#444c56', [['1', 'Contact 1'], ['2', 'Contact 2']], { kind: 'switch', roles: { common: '1', throw1: '2' } }, { description: 'Click it to flip it. Closed when flipped on.' }) },
  { group: 0, id: 'sw-spdt', ...mod('Slide switch (SPDT)', 'SPDT', '#444c56', [['COM', 'Common'], ['T1', 'Throw 1'], ['T2', 'Throw 2']], { kind: 'switch', roles: { common: 'COM', throw1: 'T1', throw2: 'T2' } }, { description: 'Click to move the common pin between the two throws.' }) },
  { group: 0, id: 'sw-reed', ...mod('Reed / tilt switch', 'REED', '#8b5e3c', [['1', 'Lead 1'], ['2', 'Lead 2']], { kind: 'switch', roles: { common: '1', throw1: '2' } }, { description: 'Closes when a magnet is near (or it is tilted). Click it to simulate that.' }) },
  { group: 0, id: 'pot-trimmer', ...mod('Trimmer potentiometer 10 kΩ', 'POT', '#2b6cb0', [['LO', 'End 1'], ['W', 'Wiper'], ['HI', 'End 2']], { kind: 'variable-resistor', roles: { a: 'LO', b: 'HI', wiper: 'W' }, ohms: 10000 }, { description: 'Right-click to move the wiper. Ends to GND and 5V, wiper to an analog pin.' }) },
  { group: 0, id: 'fsr', ...mod('Force sensor (FSR)', 'FSR', '#d9a441', [['1', 'Lead 1'], ['2', 'Lead 2']], { kind: 'variable-resistor', roles: { a: '1', b: '2' }, ohms: 100000, min: 300 }, { textColor: '#222', description: 'Resistance falls as you press harder. Use it in a voltage divider with a 10 kΩ resistor.' }) },
  { group: 0, id: 'flex', ...mod('Flex sensor', 'FLEX', '#222831', [['1', 'Lead 1'], ['2', 'Lead 2']], { kind: 'variable-resistor', roles: { a: '1', b: '2' }, ohms: 40000, min: 10000 }, { description: 'About 10 kΩ flat, 40 kΩ bent. Slide to bend it.' }) },
  { group: 0, id: 'soil', ...mod('Soil moisture probe', 'SOIL', '#2f855a', [['1', 'Probe 1'], ['2', 'Probe 2']], { kind: 'variable-resistor', roles: { a: '1', b: '2' }, ohms: 200000, min: 2000 }, { description: 'Wetter soil → lower resistance.' }) },

  // ── Diodes & transistors
  { group: 1, id: 'd-1n4007', ...mod('Diode 1N4007', '1N4007', '#2b2b2b', [['A', 'Anode'], ['K', 'Cathode']], { kind: 'diode', roles: { anode: 'A', cathode: 'K' }, vf: 0.7, imax: 1000 }, { description: 'Rectifier diode. The stripe is the cathode (K).' }) },
  { group: 1, id: 'd-1n4148', ...mod('Signal diode 1N4148', '1N4148', '#c9a24b', [['A', 'Anode'], ['K', 'Cathode']], { kind: 'diode', roles: { anode: 'A', cathode: 'K' }, vf: 0.7, imax: 200 }, { textColor: '#222' }) },
  { group: 1, id: 'd-schottky', ...mod('Schottky diode 1N5819', '1N5819', '#444', [['A', 'Anode'], ['K', 'Cathode']], { kind: 'diode', roles: { anode: 'A', cathode: 'K' }, vf: 0.3, imax: 1000 }, { description: 'Only 0.3 V drop — good for flyback protection.' }) },
  { group: 1, id: 'd-zener', ...mod('Zener diode 5.1 V', 'ZENER', '#3b6ea5', [['A', 'Anode'], ['K', 'Cathode']], { kind: 'diode', roles: { anode: 'A', cathode: 'K' }, vf: 0.7, vz: 5.1, imax: 500 }, { description: 'Put it backwards across a supply, with a resistor in series, to hold 5.1 V.' }) },
  { group: 1, id: 'opamp-lm358', ...mod('Op-amp (LM358-style)', 'LM358', '#2b2f36', [['IN+', 'Non-inverting input (+)'], ['IN-', 'Inverting input (−)'], ['OUT', 'Output'], ['V+', 'Supply +'], ['V-', 'Supply − / GND']], { kind: 'opamp', roles: { inp: 'IN+', inn: 'IN-', out: 'OUT', vcc: 'V+', vee: 'V-' }, dropHigh: 1.5, dropLow: 0.05, minSupply: 3 }, { description: 'One op-amp of a general-purpose chip. Single supply (V− to GND); the output reaches about 1.5 V below V+. Feedback resistor from OUT to IN− sets the gain.' }) },
  { group: 1, id: 'opamp-rr', ...mod('Op-amp rail-to-rail (MCP6001)', 'MCP6001', '#2b2f36', [['IN+', 'Non-inverting input (+)'], ['IN-', 'Inverting input (−)'], ['OUT', 'Output'], ['V+', 'Supply +'], ['V-', 'Supply − / GND']], { kind: 'opamp', roles: { inp: 'IN+', inn: 'IN-', out: 'OUT', vcc: 'V+', vee: 'V-' }, dropHigh: 0.03, dropLow: 0.03, minSupply: 1.8 }, { description: '1.8–6 V op-amp whose output swings almost the full supply — a good match for a 5 V Arduino ADC.' }) },
  { group: 1, id: 'opamp-tl07x', ...mod('Op-amp TL072 (JFET input, dual supply)', 'TL072', '#2b2f36', [['IN+', 'Non-inverting input (+)'], ['IN-', 'Inverting input (−)'], ['OUT', 'Output'], ['V+', 'Supply +'], ['V-', 'Supply − (or GND)']], { kind: 'opamp', roles: { inp: 'IN+', inn: 'IN-', out: 'OUT', vcc: 'V+', vee: 'V-' }, dropHigh: 1.5, dropLow: 1.5, minSupply: 7 }, { description: 'JFET-input audio / biosignal op-amp. Needs at least about ±3.5 V (7 V across the supplies); the output stays 1.5 V inside each rail. Very high input resistance.' }) },
  { group: 1, id: 'opamp-op07', ...mod('Op-amp OP07 (precision)', 'OP07', '#2b2f36', [['IN+', 'Non-inverting input (+)'], ['IN-', 'Inverting input (−)'], ['OUT', 'Output'], ['V+', 'Supply +'], ['V-', 'Supply − (or GND)']], { kind: 'opamp', roles: { inp: 'IN+', inn: 'IN-', out: 'OUT', vcc: 'V+', vee: 'V-' }, dropHigh: 2, dropLow: 2, minSupply: 9 }, { description: 'Low-offset precision op-amp for small DC signals. Needs about ±4.5 V; the output stays 2 V inside each rail.' }) },
  { group: 1, id: 'opamp-741', ...mod('Op-amp LM741 (classic)', 'LM741', '#2b2f36', [['IN+', 'Non-inverting input (+)'], ['IN-', 'Inverting input (−)'], ['OUT', 'Output'], ['V+', 'Supply +'], ['V-', 'Supply − (or GND)']], { kind: 'opamp', roles: { inp: 'IN+', inn: 'IN-', out: 'OUT', vcc: 'V+', vee: 'V-' }, dropHigh: 2, dropLow: 2, minSupply: 10 }, { description: 'The textbook op-amp. Needs about ±5 V (10 V across the supplies); the output stays 2 V inside each rail.' }) },
  { group: 1, id: 'inamp-ina128', ...mod('Instrumentation amp INA128 (gain 100)', 'INA128', '#2b2f36', [['IN+', 'Input +'], ['IN-', 'Input −'], ['OUT', 'Output'], ['REF', 'Reference (output rests here)'], ['V+', 'Supply +'], ['V-', 'Supply − (or GND)']], { kind: 'inamp', roles: { inp: 'IN+', inn: 'IN-', out: 'OUT', vcc: 'V+', vee: 'V-', ref: 'REF' }, gain: 100, bias: 'ref', dropHigh: 1, dropLow: 1, minSupply: 4.5 }, { description: 'Amplifies the DIFFERENCE between IN+ and IN− by 100 (set by its gain resistor on the real chip) and ignores what is common to both. The output rests at the voltage on REF.' }) },
  // ── Drone (wire these up and the Test tab flies what you wired: see src/core/drone-wiring.js). Drawn like the real parts, with a pin on every pad and wire tip.
  { group: 7, id: 'esp32-c3-mini', name: 'ESP32-C3 Super Mini', label: 'ESP32-C3', color: '#10161d', textColor: '#ffffff', package: 'sprite', breadboard: true,
    description: 'The 22 × 18 mm ESP32-C3 board with Wi-Fi and Bluetooth, 3.3 V logic. Wiring and parts planning only: CircuitBench does not run ESP32 code yet. For a brushed drone use GPIO0, 1, 3 and 4 for the motors (they are not boot-strap pins) and GPIO8 / GPIO9 for an MPU-6050. A 1S LiPo can go straight to 5V.',
    pins: [{ id: '5V', label: '5V in / USB', x: 12.0, y: 5.2 }, { id: 'GND', label: 'Ground', x: 21.6, y: 5.2 }, { id: '3V3', label: '3.3 V out', x: 31.2, y: 5.2 }, { id: 'GPIO4', label: 'GPIO4 (A4)', x: 40.8, y: 5.2 }, { id: 'GPIO3', label: 'GPIO3 (A3)', x: 50.4, y: 5.2 }, { id: 'GPIO2', label: 'GPIO2 (A2, boot strap)', x: 60.0, y: 5.2 }, { id: 'GPIO1', label: 'GPIO1 (A1)', x: 69.6, y: 5.2 }, { id: 'GPIO0', label: 'GPIO0 (A0)', x: 79.2, y: 5.2 }, { id: 'GPIO5', label: 'GPIO5 (A5)', x: 12.0, y: 62.8 }, { id: 'GPIO6', label: 'GPIO6', x: 21.6, y: 62.8 }, { id: 'GPIO7', label: 'GPIO7', x: 31.2, y: 62.8 }, { id: 'GPIO8', label: 'GPIO8 (SDA, blue LED)', x: 40.8, y: 62.8 }, { id: 'GPIO9', label: 'GPIO9 (SCL, BOOT button)', x: 50.4, y: 62.8 }, { id: 'GPIO10', label: 'GPIO10', x: 60.0, y: 62.8 }, { id: 'GPIO20', label: 'GPIO20 (RX)', x: 69.6, y: 62.8 }, { id: 'GPIO21', label: 'GPIO21 (TX)', x: 79.2, y: 62.8 }],
    sprite: { art: 'drone-esp32', w: 88, h: 68, note: 'SuperMini' }, behaviour: { kind: 'none' } },
  { group: 4, id: 'drv8833', name: 'Motor driver DRV8833 (dual H-bridge, 2.7-10.8 V, 1.5 A per channel)', label: 'DRV8833', color: '#b3202a', textColor: '#ffffff', package: 'sprite', breadboard: false,
    description: 'Texas Instruments dual H-bridge breakout, the usual driver for small brushed motors and a coreless drone. Power the motors from VM (2.7 to 10.8 V, a 1S LiPo works), logic is 3.3 V friendly. Motor A on AOUT1 / AOUT2 (driven by AIN1 / AIN2), motor B on BOUT1 / BOUT2. Put PWM on one input and keep the other low or high to set speed and direction. nSLEEP is pulled high on the breakout, so you can leave it open; pull it low to sleep.',
    pins: [{ id: 'VM', label: 'Motor supply VM (2.7-10.8 V)', x: 6, y: 16 }, { id: 'GND', label: 'Ground', x: 6, y: 30 }, { id: 'nSLEEP', label: 'nSLEEP (high = awake)', x: 6, y: 44 }, { id: 'AIN1', label: 'AIN1', x: 6, y: 58 }, { id: 'AIN2', label: 'AIN2', x: 6, y: 72 }, { id: 'BIN1', label: 'BIN1', x: 6, y: 86 }, { id: 'BIN2', label: 'BIN2', x: 6, y: 100 }, { id: 'AOUT1', label: 'AOUT1 (motor A)', x: 98, y: 30 }, { id: 'AOUT2', label: 'AOUT2 (motor A)', x: 98, y: 44 }, { id: 'BOUT1', label: 'BOUT1 (motor B)', x: 98, y: 72 }, { id: 'BOUT2', label: 'BOUT2 (motor B)', x: 98, y: 86 }],
    sprite: { art: 'drone-driver', w: 104, h: 116, note: '2 x 1.5 A' }, behaviour: { kind: 'hbridge', roles: { vs: 'VM', gnd: 'GND', sleep: 'nSLEEP', in1: 'AIN1', in2: 'AIN2', out1: 'AOUT1', out2: 'AOUT2', in3: 'BIN1', in4: 'BIN2', out3: 'BOUT1', out4: 'BOUT2' }, sleepPullup: 1 } },
  { group: 4, id: 'tb6612', name: 'Motor driver TB6612FNG (dual H-bridge, 15 V, 1.2 A per channel)', label: 'TB6612', color: '#1b4a8c', textColor: '#ffffff', package: 'sprite', breadboard: false,
    description: 'Toshiba dual H-bridge breakout, cooler and more efficient than an L298N. VM takes the motor battery (4.5 to 13.5 V), VCC the 3.3 or 5 V logic. STBY must be HIGH or nothing moves (tie it to VCC). Motor A on AO1 / AO2: AIN1 / AIN2 pick the direction and PWMA sets the speed. Motor B on BO1 / BO2 with BIN1 / BIN2 / PWMB.',
    pins: [{ id: 'VM', label: 'Motor supply VM (4.5-13.5 V)', x: 6, y: 16 }, { id: 'VCC', label: 'Logic supply VCC (3.3 or 5 V)', x: 6, y: 30 }, { id: 'GND', label: 'Ground', x: 6, y: 44 }, { id: 'STBY', label: 'STBY (must be HIGH)', x: 6, y: 58 }, { id: 'PWMA', label: 'PWMA (speed, motor A)', x: 6, y: 72 }, { id: 'AIN1', label: 'AIN1', x: 6, y: 86 }, { id: 'AIN2', label: 'AIN2', x: 6, y: 100 }, { id: 'BIN1', label: 'BIN1', x: 6, y: 114 }, { id: 'BIN2', label: 'BIN2', x: 6, y: 128 }, { id: 'PWMB', label: 'PWMB (speed, motor B)', x: 6, y: 142 }, { id: 'AO1', label: 'AO1 (motor A)', x: 98, y: 30 }, { id: 'AO2', label: 'AO2 (motor A)', x: 98, y: 44 }, { id: 'BO1', label: 'BO1 (motor B)', x: 98, y: 86 }, { id: 'BO2', label: 'BO2 (motor B)', x: 98, y: 100 }],
    sprite: { art: 'drone-driver', w: 104, h: 158, note: '2 x 1.2 A' }, behaviour: { kind: 'hbridge', roles: { vs: 'VM', gnd: 'GND', sleep: 'STBY', en1: 'PWMA', en2: 'PWMB', in1: 'AIN1', in2: 'AIN2', out1: 'AO1', out2: 'AO2', in3: 'BIN1', in4: 'BIN2', out3: 'BO1', out4: 'BO2' }, sleepPullup: 0 } },
  { group: 4, id: 'l9110s', name: 'Motor driver L9110S (dual H-bridge, 2.5-12 V, 0.8 A per channel)', label: 'L9110S', color: '#2a7a3b', textColor: '#ffffff', package: 'sprite', breadboard: false,
    description: 'The small two-channel H-bridge board that is cheap and common for little robots and toy motors. VCC is the motor supply (2.5 to 12 V), and the inputs are 3.3 V / 5 V friendly. Motor A on A_OA / A_OB, driven by A_IA / A_IB; motor B on B_OA / B_OB with B_IA / B_IB. One input PWM, the other LOW, for speed.',
    pins: [{ id: 'VCC', label: 'Motor supply VCC (2.5-12 V)', x: 6, y: 16 }, { id: 'GND', label: 'Ground', x: 6, y: 30 }, { id: 'A_IA', label: 'A_IA', x: 6, y: 44 }, { id: 'A_IB', label: 'A_IB', x: 6, y: 58 }, { id: 'B_IA', label: 'B_IA', x: 6, y: 72 }, { id: 'B_IB', label: 'B_IB', x: 6, y: 86 }, { id: 'A_OA', label: 'A_OA (motor A)', x: 90, y: 22 }, { id: 'A_OB', label: 'A_OB (motor A)', x: 90, y: 36 }, { id: 'B_OA', label: 'B_OA (motor B)', x: 90, y: 56 }, { id: 'B_OB', label: 'B_OB (motor B)', x: 90, y: 70 }],
    sprite: { art: 'drone-driver', w: 96, h: 102, note: '2 x 0.8 A' }, behaviour: { kind: 'hbridge', roles: { vs: 'VCC', gnd: 'GND', in1: 'A_IA', in2: 'A_IB', out1: 'A_OA', out2: 'A_OB', in3: 'B_IA', in4: 'B_IB', out3: 'B_OA', out4: 'B_OB' } } },
  { group: 7, id: 'bmotor-cw', name: 'Coreless motor 8520, clockwise (red + blue wires)', label: 'MOTOR CW', color: '#2f5fa6', textColor: '#ffffff', package: 'sprite', breadboard: false,
    description: 'A 7-8.5 mm coreless brushed motor for a tiny drone (about 2.5 Ω). Red and blue wires spin the prop clockwise when red is +; use two of these and two counter-clockwise ones. Drive each through a logic-level MOSFET, with a Schottky diode across it.',
    pins: [{ id: '+', label: 'Red wire', x: 6, y: 20 }, { id: '-', label: 'Blue wire', x: 6, y: 40 }],
    sprite: { art: 'drone-bmotor-cw', w: 132, h: 60 }, behaviour: { kind: 'motor', roles: { a: '+', b: '-' }, ohms: 2.5 } },
  { group: 7, id: 'bmotor-ccw', name: 'Coreless motor 8520, counter-clockwise (black + white wires)', label: 'MOTOR CCW', color: '#6b7280', textColor: '#ffffff', package: 'sprite', breadboard: false,
    description: 'The counter-clockwise twin of the red / blue coreless motor: black and white wires. A coreless quad uses two of each so the spins cancel out.',
    pins: [{ id: '+', label: 'Black wire', x: 6, y: 20 }, { id: '-', label: 'White wire', x: 6, y: 40 }],
    sprite: { art: 'drone-bmotor-ccw', w: 132, h: 60 }, behaviour: { kind: 'motor', roles: { a: '+', b: '-' }, ohms: 2.5 } },
  { group: 1, id: 'q-ao3400', name: 'N-MOSFET AO3400 (logic level, tiny)', label: 'AO3400', color: '#1b1b1b', textColor: '#ffffff', package: 'sprite', breadboard: false,
    description: 'The usual motor switch of a coreless brushed drone: turns fully on from a 3.3 V pin. Motor between battery + and the drain, source to ground, a 100 kΩ pull-down from gate to ground, and a Schottky diode across the motor.',
    pins: [{ id: 'G', label: 'Gate', x: 18, y: 55 }, { id: 'D', label: 'Drain', x: 32, y: 5 }, { id: 'S', label: 'Source', x: 46, y: 55 }],
    sprite: { art: 'drone-mosfet', w: 64, h: 70 }, behaviour: { kind: 'nmos', roles: { gate: 'G', drain: 'D', source: 'S' }, vth: 1.2, rds: 0.04, imax: 5700 } },
  { group: 7, id: 'drone-aio', name: 'Drone AIO flight controller (FC + 4-in-1 ESC)', label: 'AIO', color: '#16202e', textColor: '#ffffff', package: 'sprite', breadboard: false,
    description: 'The flight controller and four speed controllers on one board, like a BLITZ or Beast AIO. Solder the battery to BAT+ / BAT−, each motor\'s three wires to the three pads of one motor output (M1 back right, M2 front right, M3 back left, M4 front left, as in Betaflight), and the camera to 5V, GND and CAM. Which motor you put on which output decides how the drone flies; two motor wires swapped makes that motor spin the other way.',
    pins: [{ id: 'BAT+', label: 'Battery + (big pad)', x: 84, y: 178 }, { id: 'BAT-', label: 'Battery − (big pad)', x: 116, y: 178 },
      ...[['M4', 26, 40], ['M2', 146, 40], ['M3', 26, 160], ['M1', 146, 160]].flatMap(([m, x, y]) => ['A', 'B', 'C'].map((l, i) => ({ id: `${m}${l}`, label: `Motor ${m} pad ${l}`, x: x + i * 14, y }))),
      { id: '5V', label: 'Camera power 5 V', x: 24, y: 88 }, { id: 'G', label: 'Camera ground', x: 24, y: 102 }, { id: 'CAM', label: 'Camera video in', x: 24, y: 116 }],
    sprite: { art: 'drone-aio', w: 200, h: 200, note: 'FC + 4-in-1 ESC' }, behaviour: { kind: 'none' } },
  { group: 7, id: 'drone-motor', name: 'Drone motor', label: 'MOTOR', color: '#2f5fa6', textColor: '#ffffff', package: 'sprite', breadboard: false,
    description: 'A brushless drone motor with its three wires. Solder A, B, C to the three pads of one AIO motor output, in order. The output you pick sets where it sits on the drone: M1 back right, M2 front right, M3 back left, M4 front left (as in Betaflight). Swapping two of its wires makes it spin the other way, and then the drone will not fly properly. Its size (0802, 2207 …) is chosen in the Assembly tab.',
    pins: [{ id: 'A', label: 'Wire A (blue)', x: 192, y: 26 }, { id: 'B', label: 'Wire B (yellow)', x: 192, y: 42 }, { id: 'C', label: 'Wire C (white)', x: 192, y: 58 }],
    sprite: { art: 'drone-motor', w: 200, h: 84 }, behaviour: { kind: 'none' } },
  { group: 7, id: 'drone-battery', name: 'Drone LiPo battery', label: 'LIPO', color: '#1d2a40', textColor: '#ffffff', package: 'sprite', breadboard: false,
    description: 'The flight battery with its XT30 / XT60 plug. Red (+) to BAT+ and black (−) to BAT− on the AIO. Joining + to − makes a short circuit. The number of cells and the capacity come from the battery in your Assembly.',
    pins: [{ id: '+', label: 'Positive (red)', x: 184, y: 26 }, { id: '-', label: 'Negative (black)', x: 184, y: 52 }], sprite: { art: 'drone-battery', w: 190, h: 78, note: 'flight battery' }, behaviour: { kind: 'none' } },
  { group: 7, id: 'drone-camera', name: 'Drone FPV camera', label: 'CAM', color: '#1f2227', textColor: '#ffffff', package: 'sprite', breadboard: false,
    description: 'A micro FPV camera with its three-wire pigtail: red 5 V and black GND to the AIO 5V and GND pads, yellow VID to the CAM pad. Put its 5 V wire on the battery and it burns out.',
    pins: [{ id: '5V', label: '5 V power (red)', x: 184, y: 28 }, { id: 'GND', label: 'Ground (black)', x: 184, y: 44 }, { id: 'VID', label: 'Video out (yellow)', x: 184, y: 60 }], sprite: { art: 'drone-camera', w: 190, h: 88, note: 'FPV' }, behaviour: { kind: 'none' } },
  // ── A stack build (5-inch and bigger): a separate flight controller and 4-in-1 ESC, a capacitor on the battery pads, a receiver and a video transmitter.
  { group: 7, id: 'drone-fc', name: 'Drone flight controller (FC, for a stack)', label: 'FC', color: '#1a3a2a', textColor: '#ffffff', package: 'sprite', breadboard: false,
    description: 'The flight controller of a stack, the brain on top of a separate 4-in-1 ESC (30.5 mm boards for a 5-inch and bigger). Power it from the ESC (5V and G to the ESC\'s 5V and G), join its M1–M4 pads to the ESC\'s S1–S4 signal pads (the pad you use decides which motor is which: M1 back right, M2 front right, M3 back left, M4 front left, as in Betaflight), the camera to 5V, G and CAM, the video transmitter to VTX, and a receiver to RX1 / TX1.',
    pins: [...[['M1', 56], ['M2', 80], ['M3', 104], ['M4', 128]].map(([id, x]) => ({ id, label: `Motor ${id.slice(1)} signal out`, x, y: 178 })),
      { id: '5V', label: '5 V in (from the ESC)', x: 24, y: 60 }, { id: 'G', label: 'Ground', x: 24, y: 74 }, { id: 'CAM', label: 'Camera video in', x: 24, y: 88 }, { id: 'VTX', label: 'Video out to the transmitter', x: 24, y: 102 },
      { id: 'RX1', label: 'Receiver UART RX (join to the receiver\'s TX)', x: 176, y: 60 }, { id: 'TX1', label: 'Receiver UART TX (join to the receiver\'s RX)', x: 176, y: 74 }],
    sprite: { art: 'drone-fc', w: 200, h: 200, note: 'flight controller' }, behaviour: { kind: 'none' } },
  { group: 7, id: 'drone-esc', name: 'Drone 4-in-1 ESC (for a stack)', label: 'ESC', color: '#1f2733', textColor: '#ffffff', package: 'sprite', breadboard: false,
    description: 'Four speed controllers on one board, under a flight controller. Solder the battery to BAT+ / BAT−, each motor\'s three wires to the pads of one output (M1–M4), join S1–S4 to the flight controller\'s M1–M4 pads, and 5V and G to the flight controller. Put a low-ESR capacitor across BAT+ and BAT− on drones this size.',
    pins: [{ id: 'BAT+', label: 'Battery + (big pad)', x: 84, y: 178 }, { id: 'BAT-', label: 'Battery − (big pad)', x: 116, y: 178 },
      ...[['M4', 26, 40], ['M2', 146, 40], ['M3', 26, 160], ['M1', 146, 160]].flatMap(([m, x, y]) => ['A', 'B', 'C'].map((l, i) => ({ id: `${m}${l}`, label: `Motor ${m} pad ${l}`, x: x + i * 14, y }))),
      ...[1, 2, 3, 4].map((k, i) => ({ id: `S${k}`, label: `Signal for output M${k} (to the FC)`, x: 64 + i * 24, y: 20 })),
      { id: '5V', label: '5 V out (to the FC)', x: 24, y: 88 }, { id: 'G', label: 'Ground (to the FC)', x: 24, y: 102 }],
    sprite: { art: 'drone-esc', w: 200, h: 200, note: '4-in-1 ESC' }, behaviour: { kind: 'none' } },
  { group: 7, id: 'drone-cap', name: 'Battery capacitor (low-ESR)', label: 'CAP', color: '#27508f', textColor: '#ffffff', package: 'sprite', breadboard: false,
    description: 'A low-ESR electrolytic capacitor (about 1000 µF, 35 V) soldered across the ESC\'s battery pads, + leg to BAT+ and the striped − leg to BAT−. It soaks up the voltage spikes the ESC makes; bigger drones (5-inch and up, 4S–6S) should have one. Backwards, it pops when you plug the battery in.',
    pins: [{ id: '+', label: 'Positive leg (long)', x: 112, y: 22 }, { id: '-', label: 'Negative leg (striped)', x: 112, y: 52 }], sprite: { art: 'drone-cap', w: 120, h: 74, note: 'low ESR' }, behaviour: { kind: 'none' } },
  { group: 7, id: 'drone-rx', name: 'Radio receiver (ELRS)', label: 'RX', color: '#2a2f38', textColor: '#ffffff', package: 'sprite', breadboard: false,
    description: 'A tiny radio receiver (like an ELRS one) with its antenna. Power it from the flight controller\'s 5V and G; its TX goes to the flight controller\'s RX1 and its RX to TX1 (they cross over). Never put its 5V on the battery.',
    pins: [{ id: '5V', label: '5 V power', x: 132, y: 18 }, { id: 'G', label: 'Ground', x: 132, y: 34 }, { id: 'TX', label: 'Receiver TX (to the FC RX1)', x: 132, y: 50 }, { id: 'RX', label: 'Receiver RX (to the FC TX1)', x: 132, y: 66 }],
    sprite: { art: 'drone-rx', w: 140, h: 84, note: 'ELRS' }, behaviour: { kind: 'none' } },
  { group: 7, id: 'drone-vtx', name: 'Video transmitter (5.8 GHz)', label: 'VTX', color: '#3a3f47', textColor: '#ffffff', package: 'sprite', breadboard: false,
    description: 'The 5.8 GHz video transmitter that sends the camera picture to your goggles. Power VIN from the flight controller\'s 5V (or the battery, for most units), G to ground, and VID to the flight controller\'s VTX pad. It must have its antenna on before it is powered, or it overheats.',
    pins: [{ id: 'VIN', label: 'Power in', x: 142, y: 26 }, { id: 'G', label: 'Ground', x: 142, y: 46 }, { id: 'VID', label: 'Video in (from the FC VTX pad)', x: 142, y: 66 }], sprite: { art: 'drone-vtx', w: 150, h: 92, note: '5.8 GHz' }, behaviour: { kind: 'none' } },
  { group: 5, id: 'signal-source', ...mod('Biosignal source (body)', 'BODY', '#7a3b2e', [['E+', 'Electrode + (to IN+)'], ['E-', 'Electrode − (to IN−)'], ['REF', 'Reference electrode (to REF)']], { kind: 'signal-source', roles: { pos: 'E+', neg: 'E-', ref: 'REF' } }, { breadboard: false, description: 'A simulated body: ECG, EMG, EEG or EOG between its electrodes. Right-click to choose the signal, its strength, electrode contact and mains hum. Illustrative waveforms, not medical data.' }) },
  { group: 5, id: 'bioamp-exg-pill', name: 'BioAmp EXG Pill', label: 'EXG Pill', color: '#5b2ca0', textColor: '#ffffff', package: 'sprite', breadboard: false,
    description: 'Upside Down Labs biopotential amplifier (ECG / EMG / EEG / EOG). Electrodes on IN+, IN− and REF; VCC/GND from the Arduino 5 V; read OUT with analogRead(). Idle output is half the supply.',
    pins: [{ id: 'OUT', label: 'OUT (analog signal)', x: 2, y: 20 }, { id: 'VCC', label: 'VCC (5 V)', x: 2, y: 32 }, { id: 'GND', label: 'GND', x: 2, y: 44 }, { id: 'IN+', label: 'IN+ (electrode)', x: 148, y: 20 }, { id: 'IN-', label: 'IN− (electrode)', x: 148, y: 32 }, { id: 'REF', label: 'REF (reference electrode)', x: 148, y: 44 }],
    sprite: { art: 'bioamp-pill', w: 150, h: 64 },
    behaviour: { kind: 'inamp', roles: { inp: 'IN+', inn: 'IN-', out: 'OUT', vcc: 'VCC', vee: 'GND', ref: 'REF' }, gain: 1000, bias: 'mid', dropHigh: 0.1, dropLow: 0.1, minSupply: 3.3 } },
  { group: 5, id: 'slime-mold', name: 'Slime mold (Physarum)', label: 'Physarum', color: '#e8b923', textColor: '#3a2e00', package: 'sprite', breadboard: false,
    description: 'A slime mold you lay over an imported electrode board. The board under it senses it — the organism has no wiring of its own. The pads it covers pick up its slow oscillation (about a minute per cycle, a few mV) and pass it to their pins, measured against the board’s common net. Illustrative model, not real culture data.',
    pins: [],
    sprite: { art: 'slime-mold', w: 330, h: 330 },
    behaviour: { kind: 'slime-mold', roles: {} } },
  { group: 1, id: 'q-2n2222', ...mod('NPN transistor 2N2222', '2N2222', '#222', [['E', 'Emitter'], ['B', 'Base'], ['C', 'Collector']], { kind: 'npn', roles: { base: 'B', collector: 'C', emitter: 'E' }, beta: 100, imax: 600 }, { description: 'Arduino pin → 1 kΩ → base; emitter to GND; the load goes between the supply and the collector.' }) },
  { group: 1, id: 'q-bc547', ...mod('NPN transistor BC547', 'BC547', '#222', [['C', 'Collector'], ['B', 'Base'], ['E', 'Emitter']], { kind: 'npn', roles: { base: 'B', collector: 'C', emitter: 'E' }, beta: 200, imax: 100 }, { description: 'Small signal transistor, 100 mA max.' }) },
  { group: 1, id: 'q-2n2907', ...mod('PNP transistor 2N2907', '2N2907', '#222', [['E', 'Emitter'], ['B', 'Base'], ['C', 'Collector']], { kind: 'pnp', roles: { base: 'B', collector: 'C', emitter: 'E' }, beta: 100, imax: 600 }, { description: 'Switches the high side: emitter to the supply, base pulled low to turn on.' }) },
  { group: 1, id: 'q-irlz44n', ...mod('N-MOSFET IRLZ44N (logic level)', 'IRLZ44N', '#1b1b1b', [['G', 'Gate'], ['D', 'Drain'], ['S', 'Source']], { kind: 'nmos', roles: { gate: 'G', drain: 'D', source: 'S' }, vth: 2, rds: 0.022, imax: 47000 }, { description: 'Switches fully on from a 5 V pin. Add a 10 kΩ pull-down on the gate.' }) },
  { group: 1, id: 'q-irf540', ...mod('N-MOSFET IRF540N (needs 10 V gate)', 'IRF540N', '#1b1b1b', [['G', 'Gate'], ['D', 'Drain'], ['S', 'Source']], { kind: 'nmos', roles: { gate: 'G', drain: 'D', source: 'S' }, vth: 5.5, rds: 0.044, imax: 33000 }, { description: 'Not logic-level: a 5 V gate only half-opens it in real life — here it stays off below 5.5 V.' }) },
  { group: 1, id: 'q-irf9540', ...mod('P-MOSFET IRF9540', 'IRF9540', '#1b1b1b', [['G', 'Gate'], ['D', 'Drain'], ['S', 'Source']], { kind: 'pmos', roles: { gate: 'G', drain: 'D', source: 'S' }, vth: 4.5, rds: 0.2, imax: 19000 }, { description: 'High-side switch: source to the supply, gate pulled below it to turn on.' }) },

  // ── Power
  { group: 2, id: 'reg-7805', ...mod('Voltage regulator 7805', '7805', '#222', [['IN', 'Input'], ['GND', 'Ground'], ['OUT', 'Output 5 V']], { kind: 'regulator', roles: { vin: 'IN', gnd: 'GND', out: 'OUT' }, vout: 5, drop: 2, mode: 'linear', imax: 1500 }, { description: 'Needs at least 7 V in. Wastes the extra as heat.' }) },
  { group: 2, id: 'reg-1117', ...mod('Regulator AMS1117-3.3', '1117-3.3', '#222', [['GND', 'Ground'], ['OUT', 'Output 3.3 V'], ['IN', 'Input']], { kind: 'regulator', roles: { vin: 'IN', gnd: 'GND', out: 'OUT' }, vout: 3.3, drop: 1.1, mode: 'linear', imax: 800 }, { description: 'Low-dropout 3.3 V regulator.' }) },
  { group: 2, id: 'reg-buck', ...mod('Buck converter module (to 5 V)', 'BUCK 5V', '#1d6fa5', [['VIN', 'Input'], ['GND', 'Ground'], ['VOUT', 'Output 5 V']], { kind: 'regulator', roles: { vin: 'VIN', gnd: 'GND', out: 'VOUT' }, vout: 5, drop: 0, mode: 'switching', imax: 3000 }, { description: 'Efficient: draws less input current than the 7805.' }) },
  { group: 2, id: 'relay-5v', ...mod('Relay (5 V coil)', 'RELAY', '#2563a8', [['C+', 'Coil +'], ['C-', 'Coil −'], ['COM', 'Common'], ['NO', 'Normally open'], ['NC', 'Normally closed']], { kind: 'relay', roles: { coilA: 'C+', coilB: 'C-', common: 'COM', no: 'NO', nc: 'NC' }, ohms: 70, pick: 3.5 }, { description: 'Drive the coil with a transistor (and a diode across it). The contacts switch a separate circuit.' }) },
  { group: 2, id: 'relay-12v', ...mod('Relay (12 V coil)', 'RELAY 12V', '#2563a8', [['C+', 'Coil +'], ['C-', 'Coil −'], ['COM', 'Common'], ['NO', 'Normally open'], ['NC', 'Normally closed']], { kind: 'relay', roles: { coilA: 'C+', coilB: 'C-', common: 'COM', no: 'NO', nc: 'NC' }, ohms: 400, pick: 8 }) },

  // ── Capacitors & coils
  { group: 3, id: 'cap-100n', ...mod('Ceramic capacitor 100 nF', '100nF', '#d98c2b', [['1', 'Lead 1'], ['2', 'Lead 2']], { kind: 'capacitor', roles: { a: '1', b: '2' }, uF: 0.1 }, { description: 'Decoupling. Too small to see charge in a simulation of this speed except with large resistors.' }) },
  { group: 3, id: 'cap-100u', ...mod('Electrolytic capacitor 100 µF', '100µF', '#1c3d6e', [['+', 'Positive'], ['-', 'Negative']], { kind: 'capacitor', roles: { a: '+', b: '-' }, uF: 100 }, { description: 'Charges through a resistor: time constant = R × C.' }) },
  { group: 3, id: 'cap-1000u', ...mod('Electrolytic capacitor 1000 µF', '1000µF', '#1c3d6e', [['+', 'Positive'], ['-', 'Negative']], { kind: 'capacitor', roles: { a: '+', b: '-' }, uF: 1000 }) },
  { group: 3, id: 'ind-10mh', ...mod('Inductor 10 mH', '10mH', '#6b4f2a', [['1', 'Lead 1'], ['2', 'Lead 2']], { kind: 'inductor', roles: { a: '1', b: '2' }, mH: 10, rs: 5 }) },
  { group: 3, id: 'solenoid', ...mod('Solenoid (12 V)', 'SOLENOID', '#555d66', [['1', 'Lead 1'], ['2', 'Lead 2']], { kind: 'inductor', roles: { a: '1', b: '2' }, mH: 80, rs: 24 }, { description: 'Drive it with a transistor and put a diode across it.' }) },

  // ── Sound, light & motion
  { group: 4, id: 'buzzer-active', ...mod('Active buzzer', 'BUZZER', '#111', [['+', 'Positive'], ['-', 'Negative']], { kind: 'buzzer', roles: { a: '+', b: '-' }, ohms: 150, vmin: 2, mode: 'active' }, { description: 'Beeps by itself whenever it is powered (digitalWrite HIGH).' }) },
  { group: 4, id: 'buzzer-passive', ...mod('Passive buzzer / piezo', 'PIEZO', '#111', [['+', 'Positive'], ['-', 'Negative']], { kind: 'buzzer', roles: { a: '+', b: '-' }, ohms: 100, vmin: 1, mode: 'passive' }, { description: 'Plays the note the sketch sends with tone(pin, frequency).' }) },
  { group: 4, id: 'speaker', ...mod('Speaker 8 Ω', 'SPEAKER', '#333', [['+', 'Positive'], ['-', 'Negative']], { kind: 'buzzer', roles: { a: '+', b: '-' }, ohms: 8, vmin: 0.3, mode: 'passive' }, { description: 'Use tone() through a 100 Ω resistor — 8 Ω straight from a pin is too much current.' }) },
  { group: 4, id: 'fan', ...mod('DC fan 5 V', 'FAN', '#3a3f45', [['+', 'Positive'], ['-', 'Negative']], { kind: 'motor', roles: { a: '+', b: '-' }, ohms: 50 }, { description: 'Spins faster with more voltage. Drive it through a transistor.' }) },
  { group: 4, id: 'vibe', ...mod('Vibration motor', 'VIBE', '#6b7280', [['+', 'Positive'], ['-', 'Negative']], { kind: 'motor', roles: { a: '+', b: '-' }, ohms: 40 }) },
  { group: 4, id: 'pump', ...mod('Water pump 6 V', 'PUMP', '#2563a8', [['+', 'Positive'], ['-', 'Negative']], { kind: 'motor', roles: { a: '+', b: '-' }, ohms: 15 }) },
  { group: 4, id: 'led-bar', ...mod('LED bar graph (10 segments)', 'BAR10', '#222', [['C', 'Common cathode'], ...Array.from({ length: 10 }, (_, i) => [`A${i + 1}`, `LED ${i + 1}`])], { kind: 'led-array', roles: { common: 'C' }, segments: Array.from({ length: 10 }, (_, i) => `A${i + 1}`), color: 'green', common: 'cathode' }, { breadboard: false, description: 'Each segment needs its own resistor.' }) },
  { group: 4, id: 'servo-sg90', ...mod('Servo SG90', 'SG90', '#3b82c4', [['GND', 'Brown'], ['VCC', 'Red'], ['SIG', 'Orange']], { kind: 'servo', roles: { gnd: 'GND', vcc: 'VCC', signal: 'SIG' }, range: 180, minUs: 544, maxUs: 2400 }, { description: 'Use the Servo library. Power from 5V (a motor can brown out the Arduino\'s supply).' }) },
  { group: 4, id: 'stepper', ...mod('Stepper 28BYJ-48 + ULN2003', '28BYJ-48', '#d1d5db', [['IN1'], ['IN2'], ['IN3'], ['IN4'], ['VCC', '+5V'], ['GND', '−']], { kind: 'stepper', roles: { vcc: 'VCC', gnd: 'GND' }, coils: ['IN1', 'IN2', 'IN3', 'IN4'], steps: 2048 }, { textColor: '#222', description: 'Use the Stepper or AccelStepper library with pins in the order IN1, IN3, IN2, IN4.' }) },

  // ── Sensors & inputs
  { group: 5, id: 'hcsr04', ...mod('Ultrasonic sensor HC-SR04', 'HC-SR04', '#2b6cb0', [['VCC'], ['TRIG'], ['ECHO'], ['GND']], { kind: 'ultrasonic', roles: { vcc: 'VCC', trig: 'TRIG', echo: 'ECHO', gnd: 'GND' } }, { description: 'Right-click to set the distance of the object in front of it. Read it with pulseIn().' }) },
  { group: 5, id: 'ky040', ...mod('Rotary encoder KY-040', 'KY-040', '#2f855a', [['CLK'], ['DT'], ['SW'], ['GND']], { kind: 'encoder', roles: { a: 'CLK', b: 'DT', common: 'GND', sw: 'SW' } }, { description: 'While running, click the left side to turn it one notch back, the right side forward, and the middle to press it. Use INPUT_PULLUP.' }) },
  { group: 5, id: 'ir-dist', ...mod('Distance sensor (analog)', 'IR DIST', '#444c56', [['VCC'], ['GND'], ['OUT']], { kind: 'analog-sensor', roles: { vcc: 'VCC', gnd: 'GND', out: 'OUT' } }, { description: 'Right-click and slide to change the voltage on OUT; read it with analogRead().' }) },
  { group: 5, id: 'sound', ...mod('Sound sensor (analog)', 'KY-038', '#1d4ed8', [['VCC'], ['GND'], ['AO', 'Analog out']], { kind: 'analog-sensor', roles: { vcc: 'VCC', gnd: 'GND', out: 'AO' } }) },
  { group: 5, id: 'hall', ...mod('Hall / magnet sensor', 'HALL', '#444', [['VCC'], ['GND'], ['OUT']], { kind: 'digital-sensor', roles: { vcc: 'VCC', gnd: 'GND', out: 'OUT' } }, { description: 'Click it while running to simulate a magnet.' }) },

  // ── Chips (rules)
  { group: 6, id: 'gate-not', ...mod('NOT gate', 'NOT', '#1f2933', [['A', 'Input'], ['VCC', 'Power (2–6 V)'], ['GND', 'Ground'], ['Y', 'Output']], { kind: 'logic', roles: { vcc: 'VCC', gnd: 'GND' }, vars: {}, rules: [], outputs: { Y: '!A' } }, { description: 'One NOT gate (like a 74HC04) — Y follows the inputs. Power it with 2–6 V; HIGH is above half the supply.' }) },
  { group: 6, id: 'gate-and', ...mod('AND gate', 'AND', '#1f2933', [['A', 'Input A'], ['B', 'Input B'], ['VCC', 'Power (2–6 V)'], ['GND', 'Ground'], ['Y', 'Output']], { kind: 'logic', roles: { vcc: 'VCC', gnd: 'GND' }, vars: {}, rules: [], outputs: { Y: 'A && B' } }, { description: 'One AND gate (like a 74HC08) — Y follows the inputs. Power it with 2–6 V; HIGH is above half the supply.' }) },
  { group: 6, id: 'gate-or', ...mod('OR gate', 'OR', '#1f2933', [['A', 'Input A'], ['B', 'Input B'], ['VCC', 'Power (2–6 V)'], ['GND', 'Ground'], ['Y', 'Output']], { kind: 'logic', roles: { vcc: 'VCC', gnd: 'GND' }, vars: {}, rules: [], outputs: { Y: 'A || B' } }, { description: 'One OR gate (like a 74HC32) — Y follows the inputs. Power it with 2–6 V; HIGH is above half the supply.' }) },
  { group: 6, id: 'gate-xor', ...mod('XOR gate', 'XOR', '#1f2933', [['A', 'Input A'], ['B', 'Input B'], ['VCC', 'Power (2–6 V)'], ['GND', 'Ground'], ['Y', 'Output']], { kind: 'logic', roles: { vcc: 'VCC', gnd: 'GND' }, vars: {}, rules: [], outputs: { Y: '(A + B) % 2' } }, { description: 'One XOR gate (like a 74HC86) — Y follows the inputs. Power it with 2–6 V; HIGH is above half the supply.' }) },
  { group: 6, id: 'gate-nand', ...mod('NAND gate', 'NAND', '#1f2933', [['A', 'Input A'], ['B', 'Input B'], ['VCC', 'Power (2–6 V)'], ['GND', 'Ground'], ['Y', 'Output']], { kind: 'logic', roles: { vcc: 'VCC', gnd: 'GND' }, vars: {}, rules: [], outputs: { Y: '!(A && B)' } }, { description: 'One NAND gate (like a 74HC00) — Y follows the inputs. Power it with 2–6 V; HIGH is above half the supply.' }) },
  { group: 6, id: 'gate-nor', ...mod('NOR gate', 'NOR', '#1f2933', [['A', 'Input A'], ['B', 'Input B'], ['VCC', 'Power (2–6 V)'], ['GND', 'Ground'], ['Y', 'Output']], { kind: 'logic', roles: { vcc: 'VCC', gnd: 'GND' }, vars: {}, rules: [], outputs: { Y: '!(A || B)' } }, { description: 'One NOR gate (like a 74HC02) — Y follows the inputs. Power it with 2–6 V; HIGH is above half the supply.' }) },
  { group: 6, id: 'gate-dff', ...mod('D flip-flop', 'D-FF', '#1f2933', [['D', 'Data in'], ['CLK', 'Clock'], ['VCC', 'Power (2–6 V)'], ['GND', 'Ground'], ['Q', 'Output'], ['QN', 'Output (inverted)']], { kind: 'logic', roles: { vcc: 'VCC', gnd: 'GND' }, vars: { st: 0 }, rules: [{ when: 'rising(CLK)', set: { st: 'D' } }], outputs: { Q: 'st', QN: '!st' } }, { description: 'Remembers D on each rising edge of CLK. Q holds it until the next edge; QN is the opposite.' }) },
  { group: 6, id: 'gate-mux2', ...mod('2-to-1 multiplexer', 'MUX2', '#1f2933', [['A', 'Input 0'], ['B', 'Input 1'], ['S', 'Select'], ['VCC', 'Power (2–6 V)'], ['GND', 'Ground'], ['Y', 'Output']], { kind: 'logic', roles: { vcc: 'VCC', gnd: 'GND' }, vars: {}, rules: [], outputs: { Y: 'S ? B : A' } }, { description: 'Y copies input A while S is LOW and input B while S is HIGH.' }) },
  ...BOARD_TEMPLATES,
  chip74hc595(),
  chipGates(),
  chipCounter(),
].map(t => ({ ...t }));
for (const t of TEMPLATES) if (LOOK_OF[t.id] && t.package === 'module') t.look = LOOK_OF[t.id];

function chip74hc595() {
  const pins = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'GND', 'Q7S', 'MR', 'SHCP', 'STCP', 'OE', 'DS', 'Q0', 'VCC'];
  return {
    group: 6, id: 'ic-74hc595', ...chip('Shift register 74HC595', '74HC595', '#1f2933', 'dip', pins, {
      kind: 'logic', roles: { vcc: 'VCC', gnd: 'GND', enable: 'OE' }, vars: { shift: 0, latch: 0 },
      rules: [{ when: '!MR', set: { shift: '0' } }, { when: 'rising(SHCP) && MR', set: { shift: '(shift * 2 + DS) % 256' } }, { when: 'rising(STCP)', set: { latch: 'shift' } }],
      outputs: { Q0: 'latch & 1', Q1: '(latch >> 1) & 1', Q2: '(latch >> 2) & 1', Q3: '(latch >> 3) & 1', Q4: '(latch >> 4) & 1', Q5: '(latch >> 5) & 1', Q6: '(latch >> 6) & 1', Q7: '(latch >> 7) & 1', Q7S: '(shift >> 7) & 1' },
    }, 'Serial in, 8 parallel outs. shiftOut() clocks bits in; a pulse on STCP copies them to the outputs.'),
  };
}
function chipGates() {
  const pins = ['A1', 'B1', 'Y1', 'A2', 'B2', 'Y2', 'GND', 'Y3', 'A3', 'B3', 'Y4', 'A4', 'B4', 'VCC'];
  return {
    group: 6, id: 'ic-74hc00', ...chip('Quad NAND gate 74HC00', '74HC00', '#1f2933', 'dip', pins, {
      kind: 'logic', roles: { vcc: 'VCC', gnd: 'GND' }, vars: {}, rules: [],
      outputs: { Y1: '!(A1 && B1)', Y2: '!(A2 && B2)', Y3: '!(A3 && B3)', Y4: '!(A4 && B4)' },
    }, 'Four NAND gates. Needs 2–6 V on VCC.'),
  };
}
function chipCounter() {
  const pins = ['CLK', 'MR', 'Q0', 'Q1', 'Q2', 'Q3', 'GND', 'VCC'];
  return {
    group: 6, id: 'ic-counter', ...chip('4-bit counter', 'CNT4', '#1f2933', 'dip', pins, {
      kind: 'logic', roles: { vcc: 'VCC', gnd: 'GND' }, vars: { n: 0 },
      rules: [{ when: 'MR', set: { n: '0' } }, { when: 'rising(CLK) && !MR', set: { n: '(n + 1) % 16' } }],
      outputs: { Q0: 'n & 1', Q1: '(n >> 1) & 1', Q2: '(n >> 2) & 1', Q3: '(n >> 3) & 1' },
    }, 'Counts rising edges on CLK from 0 to 15; MR (HIGH) resets it.'),
  };
}

/** Common parts that ship in the default catalogue (sidebar) instead of the Part Creator's template list: template id → sidebar category. */
export const POPULAR = {
  ...Object.fromEntries(BOARD_TEMPLATES.map(t => [t.id, 'Boards'])),
  'drone-aio': 'Drone', 'drone-motor': 'Drone', 'drone-battery': 'Drone', 'drone-camera': 'Drone', 'drone-fc': 'Drone', 'drone-esc': 'Drone', 'drone-cap': 'Drone', 'drone-rx': 'Drone', 'drone-vtx': 'Drone', 'esp32-c3-mini': 'Boards', 'bmotor-cw': 'Drone', 'bmotor-ccw': 'Drone', 'q-ao3400': 'Semiconductors', drv8833: 'Motors', tb6612: 'Motors', l9110s: 'Motors', 'd-schottky': 'Semiconductors',
  'stepper': 'Motors', 'fan': 'Motors',
  'hall': 'Sensors',
  'd-1n4007': 'Semiconductors', 'd-zener': 'Semiconductors', 'q-2n2222': 'Semiconductors', 'q-2n2907': 'Semiconductors', 'q-irlz44n': 'Semiconductors', 'opamp-lm358': 'Semiconductors', 'opamp-rr': 'Semiconductors', 'opamp-tl07x': 'Semiconductors', 'opamp-op07': 'Semiconductors', 'opamp-741': 'Semiconductors', 'inamp-ina128': 'Semiconductors', 'bioamp-exg-pill': 'Biosignal', 'signal-source': 'Biosignal', 'slime-mold': 'Biosignal',
  'reg-7805': 'Power', 'cap-100n': 'Passives', 'cap-100u': 'Passives', 'ind-10mh': 'Passives',
  'ic-74hc595': 'Chips',
  'gate-not': 'Logic', 'gate-and': 'Logic', 'gate-or': 'Logic', 'gate-xor': 'Logic', 'gate-nand': 'Logic', 'gate-nor': 'Logic', 'gate-dff': 'Logic', 'gate-mux2': 'Logic',
};
/** Templates that have a real @wokwi/elements equivalent in the catalogue (src/core/native-parts.js), so they are not offered as templates any more. */
export const HAS_WOKWI_PART = new Set(['servo-sg90', 'hcsr04', 'ky040', 'buzzer-active', 'buzzer-passive', 'led-bar', 'relay-5v', 'pot-trimmer', 'sound']);
