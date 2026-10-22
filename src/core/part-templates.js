// Ready-made starting points for the Part Creator ("Start from a template"): the common components a bench
// has, already wired up to the right behaviour, so a student can make one without typing a single pin — or
// without an AI. Each template goes through validatePartSpec() like anything else (the tests check every one).
//
// pins: [id, label?]; DIP/quad templates list pins in datasheet order, pin 1 first (no sides — the package places them).

const mod = (name, label, color, pins, behaviour, extra = {}) => ({
  name, label, color, textColor: extra.textColor || '#ffffff', description: extra.description || '', package: 'module', breadboard: extra.breadboard !== false,
  pins: pins.map(p => (Array.isArray(p) ? { id: p[0], label: p[1] || p[0] } : { id: p, label: p })), behaviour,
});
const chip = (name, label, color, pkg, pins, behaviour, description = '') => ({
  name, label, color, textColor: '#e8e8e8', description, package: pkg, breadboard: true, pins: pins.map(p => (Array.isArray(p) ? { id: p[0], label: p[1] || p[0] } : { id: p, label: p })), behaviour,
});

export const TEMPLATE_GROUPS = ['Switches & resistors', 'Diodes & transistors', 'Power', 'Capacitors & coils', 'Sound, light & motion', 'Sensors & inputs', 'Chips'];

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
  chip74hc595(),
  chipGates(),
  chipCounter(),
].map(t => ({ ...t }));

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
  'servo-sg90': 'Motors', 'stepper': 'Motors', 'fan': 'Motors', 'relay-5v': 'Motors',
  'hcsr04': 'Sensors', 'hall': 'Sensors', 'ir-dist': 'Sensors',
  'ky040': 'Input', 'pot-trimmer': 'Input',
  'buzzer-active': 'Sound', 'buzzer-passive': 'Sound',
  'd-1n4007': 'Semiconductors', 'd-zener': 'Semiconductors', 'q-2n2222': 'Semiconductors', 'q-2n2907': 'Semiconductors', 'q-irlz44n': 'Semiconductors',
  'reg-7805': 'Power', 'cap-100n': 'Passives', 'cap-100u': 'Passives', 'ind-10mh': 'Passives',
  'led-bar': 'Displays', 'ic-74hc595': 'Chips',
};
