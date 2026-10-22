// The "component library" behaviours of the Part Creator: switches, relays, variable resistors, diodes,
// transistors, regulators, capacitors, coils, sounders, motors, LED arrays and the timed sensors/actuators.
// Each one is only a NAME plus the few numbers it needs ("params"); the physics lives in solver.js and the
// timing in src/parts/*.js, so a part made from one of these is still just data — never code.
//
//   roles      pins every part of this kind must have (role → which of the part's pins)
//   optional   pins it may have
//   lists      ordered lists of pins (e.g. the segments of an LED bar)
//   params     numbers/choices the maker sets once, while designing the part  (min/max are enforced)
//   props      values the person using the part changes while running (a switch position, a slider)
//   settings   how those props are shown in the right-click panel
//
// Pure data (no DOM) so the server can validate AI-made specs with the same rules.

const roles = (labels, optional = {}) => ({ roles: Object.keys(labels), roleLabels: { ...labels, ...optional }, optional: Object.keys(optional) });
const pct = v => `${Math.round(v)} %`;

export const EXTRA_BEHAVIOURS = {
  switch: {
    label: 'Switch (click it to flip it)',
    ...roles({ common: 'Common (COM)', throw1: 'Throw 1' }, { throw2: 'Throw 2 (leave empty for a plain on/off switch)' }),
    props: { pos: 0 }, toggle: true,
    note: 'Click the part to flip it, even while the simulation runs. With no Throw 2 it is a plain on/off switch (closed when flipped). With a Throw 2, COM joins Throw 1 until you flip it, then Throw 2 (like a slide switch). Also covers toggles, tilt and reed switches.',
  },
  relay: {
    label: 'Relay (a coil closes a contact)',
    ...roles({ coilA: 'Coil +', coilB: 'Coil −', common: 'Contact COM', no: 'Contact NO (normally open)' }, { nc: 'Contact NC (normally closed — optional)', common2: 'Second pole COM (optional — a DPDT relay)', no2: 'Second pole NO (optional)', nc2: 'Second pole NC (optional)' }),
    params: [
      { key: 'ohms', label: 'Coil resistance', unit: 'Ω', min: 20, max: 5000, step: 10, def: 70 },
      { key: 'pick', label: 'Pulls in at', unit: 'V', min: 1, max: 30, step: 0.5, def: 3.5 },
    ],
    note: 'When the coil has about its pull-in voltage across it, COM joins NO (and leaves NC). The contact side is electrically separate from the coil, like a real relay. Remember the coil needs a transistor from an Arduino pin.',
  },
  'variable-resistor': {
    label: 'Variable resistor (a slider sets its resistance: pot, flex, force, soil probe…)',
    ...roles({ a: 'End 1 (low end)', b: 'End 2 (high end)' }, { wiper: 'Wiper (leave empty for a rheostat / 2-wire sensor)' }),
    params: [
      { key: 'ohms', label: 'Full resistance', unit: 'Ω', min: 10, max: 5e6, step: 100, def: 10000 },
      { key: 'min', label: 'Lowest resistance (2-wire only)', unit: 'Ω', min: 0, max: 5e6, step: 100, def: 0 },
    ],
    props: { level: 50 },
    settings: [{ key: 'level', label: 'Position', min: 0, max: 100, step: 1, fmt: pct }],
    note: 'With a wiper it is a potentiometer: End 1 to wiper is full × position, wiper to End 2 is the rest. With no wiper it is one resistor between End 1 and End 2 that moves from "lowest" to "full" as the slider goes 0 → 100 % (a rheostat, flex sensor, force sensor, soil probe…).',
  },
  diode: {
    label: 'Diode (one-way valve; Zener if you set a breakdown voltage)',
    ...roles({ anode: 'Anode (+)', cathode: 'Cathode (−, the stripe)' }),
    params: [
      { key: 'vf', label: 'Forward drop', unit: 'V', min: 0.1, max: 5, step: 0.05, def: 0.7 },
      { key: 'vz', label: 'Zener breakdown (0 = ordinary diode)', unit: 'V', min: 0, max: 100, step: 0.1, def: 0 },
      { key: 'imax', label: 'Maximum current', unit: 'mA', min: 1, max: 100000, step: 10, def: 1000 },
    ],
    note: 'Current flows anode → cathode once the forward drop is exceeded (silicon 0.7 V, Schottky 0.3 V). Backwards it blocks — unless it is a Zener, which conducts backwards above its breakdown voltage.',
  },
  npn: {
    label: 'NPN transistor (BJT: a small base current switches a big collector current)',
    ...roles({ base: 'Base (B)', collector: 'Collector (C)', emitter: 'Emitter (E)' }),
    params: [
      { key: 'beta', label: 'Current gain (hFE)', unit: '×', min: 10, max: 1000, step: 10, def: 100 },
      { key: 'imax', label: 'Maximum collector current', unit: 'mA', min: 10, max: 50000, step: 10, def: 500 },
    ],
    note: 'Turns on when the base is about 0.7 V above the emitter; then the collector current is the base current × gain, until it saturates. Needs a resistor in the base circuit.',
  },
  pnp: {
    label: 'PNP transistor (BJT, switches on the high side)',
    ...roles({ base: 'Base (B)', collector: 'Collector (C)', emitter: 'Emitter (E)' }),
    params: [
      { key: 'beta', label: 'Current gain (hFE)', unit: '×', min: 10, max: 1000, step: 10, def: 100 },
      { key: 'imax', label: 'Maximum collector current', unit: 'mA', min: 10, max: 50000, step: 10, def: 500 },
    ],
    note: 'Like an NPN upside down: turns on when the base is about 0.7 V BELOW the emitter, and current flows emitter → collector.',
  },
  nmos: {
    label: 'N-channel MOSFET (gate voltage switches drain → source)',
    ...roles({ gate: 'Gate (G)', drain: 'Drain (D)', source: 'Source (S)' }),
    params: [
      { key: 'vth', label: 'Gate threshold', unit: 'V', min: 0.5, max: 10, step: 0.1, def: 2 },
      { key: 'rds', label: 'On-resistance', unit: 'Ω', min: 0.001, max: 100, step: 0.01, def: 0.1 },
      { key: 'imax', label: 'Maximum drain current', unit: 'mA', min: 10, max: 200000, step: 100, def: 5000 },
    ],
    note: 'No gate current at all. When the gate is above the source by more than the threshold, drain and source are joined by its small on-resistance. Logic-level parts (IRLZ44N) switch fully at 5 V; the IRF540 needs about 10 V.',
  },
  pmos: {
    label: 'P-channel MOSFET (switches on the high side)',
    ...roles({ gate: 'Gate (G)', drain: 'Drain (D)', source: 'Source (S)' }),
    params: [
      { key: 'vth', label: 'Gate threshold (size, positive)', unit: 'V', min: 0.5, max: 10, step: 0.1, def: 2 },
      { key: 'rds', label: 'On-resistance', unit: 'Ω', min: 0.001, max: 100, step: 0.01, def: 0.1 },
      { key: 'imax', label: 'Maximum drain current', unit: 'mA', min: 10, max: 200000, step: 100, def: 5000 },
    ],
    note: 'Turns on when the gate is lower than the source by more than the threshold. Source goes to the supply, drain to the load.',
  },
  regulator: {
    label: 'Voltage regulator (7805, AMS1117, LM317, buck / boost module)',
    ...roles({ vin: 'Input (VIN)', gnd: 'Ground (GND)', out: 'Output (VOUT)' }),
    params: [
      { key: 'vout', label: 'Output voltage', unit: 'V', min: 1, max: 30, step: 0.1, def: 5 },
      { key: 'drop', label: 'Dropout (linear only)', unit: 'V', min: 0, max: 5, step: 0.1, def: 2 },
      { key: 'mode', label: 'Type', options: [['linear', 'Linear (wastes the extra voltage as heat)'], ['switching', 'Switching buck / boost module']], def: 'linear' },
      { key: 'imax', label: 'Maximum output current', unit: 'mA', min: 10, max: 20000, step: 10, def: 1000 },
    ],
    note: 'Holds its output steady while the input is high enough. A linear one needs the input at least "dropout" above the output and draws the same current in as it gives out; a switching one works from lower voltages and draws less.',
  },
  capacitor: {
    label: 'Capacitor (stores charge; smoothing, timing, debounce)',
    ...roles({ a: 'Terminal 1 (+)', b: 'Terminal 2 (−)' }),
    params: [{ key: 'uF', label: 'Capacitance', unit: 'µF', min: 0.0001, max: 1e6, step: 1, def: 100 }],
    note: 'Starts empty and charges through whatever feeds it, so voltage across it rises over time (time constant R × C). Passes changes, blocks steady DC once charged.',
  },
  inductor: {
    label: 'Inductor / coil (solenoid, choke)',
    ...roles({ a: 'Terminal 1', b: 'Terminal 2' }),
    params: [
      { key: 'mH', label: 'Inductance', unit: 'mH', min: 0.001, max: 1e5, step: 1, def: 10 },
      { key: 'rs', label: 'Wire resistance', unit: 'Ω', min: 0.01, max: 1e4, step: 0.5, def: 1 },
    ],
    note: 'Resists changes in current: it ramps up over time (time constant L ÷ R) and then behaves like its wire resistance. Also covers solenoids.',
  },
  buzzer: {
    label: 'Buzzer / speaker (makes sound)',
    ...roles({ a: 'Terminal + ', b: 'Terminal −' }),
    params: [
      { key: 'ohms', label: 'Coil / load resistance', unit: 'Ω', min: 8, max: 10000, step: 10, def: 150 },
      { key: 'vmin', label: 'Sounds from', unit: 'V', min: 0.5, max: 12, step: 0.5, def: 2 },
      { key: 'mode', label: 'Type', options: [['active', 'Active (beeps by itself when powered)'], ['passive', 'Passive (plays the tone() the sketch sends)'], ['auto', 'Either (beeps when powered, or plays tone())']], def: 'active' },
    ],
    note: 'Active: a steady beep while the voltage across it is high enough. Passive: plays whatever frequency the sketch makes on the pin (tone()). The sound plays through your speakers while the simulation runs.',
  },
  motor: {
    label: 'Motor / fan / pump (spins when powered)',
    ...roles({ a: 'Terminal 1', b: 'Terminal 2' }),
    params: [{ key: 'ohms', label: 'Winding resistance', unit: 'Ω', min: 1, max: 1000, step: 1, def: 20 }],
    note: 'A resistive load that spins faster with more voltage across it (about 250 rpm at 6 V) and backwards if you swap the wires. Use an L298N or a transistor to drive it — a pin alone cannot.',
  },
  'led-array': {
    label: 'LED array (bar graph, matrix row, multi-segment display)',
    roles: [], roleLabels: { common: 'Common pin (shared by every LED — leave empty if each LED has its own second pin)' }, optional: ['common'],
    lists: { segments: 'LED pins, first to last' },
    optionalLists: { cathodes: 'Second pin of each LED, in the same order (only when the LEDs do not share a common pin)' },
    params: [
      { key: 'common', label: 'Common is the', options: [['cathode', 'Cathode (−): drive segments HIGH'], ['anode', 'Anode (+): drive segments LOW']], def: 'cathode' },
    ],
    note: 'Every listed pin lights its own LED between that pin and the common pin. Each still needs a series resistor.',
  },
  servo: {
    label: 'Servo (follows the pulse width on its signal wire)',
    ...roles({ vcc: 'Power (VCC)', gnd: 'Ground (GND)', signal: 'Signal (pulse in)' }),
    params: [
      { key: 'range', label: 'Travel', unit: '°', min: 30, max: 360, step: 10, def: 180 },
      { key: 'minUs', label: 'Pulse for 0°', unit: 'µs', min: 300, max: 1500, step: 10, def: 544 },
      { key: 'maxUs', label: 'Pulse for full travel', unit: 'µs', min: 1500, max: 3000, step: 10, def: 2400 },
    ],
    note: 'The horn turns to the angle given by the width of the pulse the sketch sends (Servo library: 544 µs = 0°, 2400 µs = 180°). It only moves while it has a supply of at least 4 V.',
  },
  ultrasonic: {
    label: 'Ultrasonic distance sensor (HC-SR04)',
    ...roles({ vcc: 'Power (VCC)', gnd: 'Ground (GND)', trig: 'Trigger (TRIG, input)', echo: 'Echo (ECHO, output)' }),
    props: { dist: 50 },
    settings: [{ key: 'dist', label: 'Distance to object', min: 2, max: 400, step: 1, fmt: v => `${Math.round(v)} cm` }],
    note: 'A 10 µs pulse on TRIG makes ECHO go HIGH for 58 µs per centimetre of distance (pulseIn() measures it). Set the distance with the slider. VCC must come from the Arduino 5V.',
  },
  encoder: {
    label: 'Rotary encoder (click left / right to turn it)',
    ...roles({ a: 'Output A (CLK)', b: 'Output B (DT)', common: 'Common (GND)' }, { sw: 'Push switch (SW — optional)' }),
    props: { phase: 0 },
    note: 'While running, click the left side to turn one notch anticlockwise, the right side for clockwise, and the middle to press the shaft. A and B pull to the common pin in the quadrature pattern real encoders give, so use INPUT_PULLUP on them.',
  },
  keypad: {
    label: 'Matrix keypad (rows × columns of push keys)',
    ...roles({}),
    lists: { rows: 'Row pins, row 1 first', cols: 'Column pins, column 1 first' },
    props: { keys: 0 },
    note: 'Pressing a key joins its row pin to its column pin. Scan it like a real keypad: drive one row at a time (or use INPUT_PULLUP on the rows and pull one column LOW) and read the others. Click a key while the simulation runs.',
  },
  'switch-bank': {
    label: 'DIP switch bank (each switch joins two pins)',
    ...roles({}),
    lists: { a: 'Side A pins, switch 1 first', b: 'Side B pins, switch 1 first (same order)' },
    props: { bits: 0 },
    note: 'Switch n joins A-pin n to B-pin n when it is flipped ON. Click a switch to flip it (works while the simulation runs). Wire one side to GND or 5V and the other to Arduino pins with INPUT_PULLUP.',
  },
  joystick: {
    label: 'Analog joystick (two potentiometers and a push button)',
    ...roles({ vcc: 'Power (VCC)', gnd: 'Ground (GND)', horz: 'Horizontal out (HORZ)', vert: 'Vertical out (VERT)' }, { sel: 'Push button (SEL — optional)' }),
    props: { jx: 50, jy: 50, jsel: 0 },
    settings: [
      { key: 'jx', label: 'Horizontal', min: 0, max: 100, step: 1, fmt: pct },
      { key: 'jy', label: 'Vertical', min: 0, max: 100, step: 1, fmt: pct },
    ],
    note: 'HORZ and VERT are voltage dividers that sit at half the supply in the middle and move towards VCC or GND as the stick moves. SEL pulls to GND while the stick is pressed, so use INPUT_PULLUP. Drag the stick, or use the sliders in the right-click panel.',
  },
  opamp: {
    label: 'Op-amp (amplifies the difference between its two inputs)',
    ...roles({ inp: 'Non-inverting input (+)', inn: 'Inverting input (−)', out: 'Output', vcc: 'Positive supply (V+)', vee: 'Negative supply (V− / GND)' }),
    params: [
      { key: 'dropHigh', label: 'Output stops this far below V+', unit: 'V', min: 0, max: 5, step: 0.05, def: 1.5 },
      { key: 'dropLow', label: 'Output stops this far above V−', unit: 'V', min: 0, max: 5, step: 0.05, def: 0.05 },
      { key: 'minSupply', label: 'Needs at least this supply', unit: 'V', min: 1, max: 30, step: 0.1, def: 3 },
    ],
    note: 'Open-loop gain 100 000: the output tries to make (+) and (−) equal, so with negative feedback (a resistor from OUT to −) it amplifies by a known ratio, and with none it is a comparator that swings to a supply rail. The output cannot go past its supply (less the "stops this far" margins). Gain-bandwidth, slew rate and input offset are not modelled.',
  },
  inamp: {
    label: 'Instrumentation / bio-signal amplifier (fixed gain on the difference of two inputs)',
    ...roles({ inp: 'Input + (IN+)', inn: 'Input − (IN−)', out: 'Output', vcc: 'Positive supply (V+)', vee: 'Negative supply (GND / V−)' }, { ref: 'Reference pin (REF — optional)' }),
    params: [
      { key: 'gain', label: 'Gain', unit: '×', min: 1, max: 100000, step: 1, def: 100 },
      { key: 'bias', label: 'Output rests at', options: [['mid', 'Half the supply (single-supply bio amps)'], ['ref', 'The REF pin voltage (INA128 style)'], ['zero', 'Ground / V− (no offset)']], def: 'mid' },
      { key: 'dropHigh', label: 'Output stops this far below V+', unit: 'V', min: 0, max: 5, step: 0.05, def: 0.1 },
      { key: 'dropLow', label: 'Output stops this far above V−', unit: 'V', min: 0, max: 5, step: 0.05, def: 0.1 },
      { key: 'minSupply', label: 'Needs at least this supply', unit: 'V', min: 1, max: 40, step: 0.1, def: 3 },
    ],
    props: { sp: '', sn: '', sr: '', effort: 50, scale: 100, contact: 5, hum: 0 },       // electrode sites on the Visualizer's head (blank = wired by hand)
    note: 'Output = rest level + gain × (IN+ − IN−), limited to the supply. The rest level is half the supply, the REF pin, or ground, as chosen. Input impedance is very high. Filtering and noise are not modelled.',
  },
  'slime-mold': {
    label: 'Slime mold (Physarum) on an electrode grid',
    ...roles({ ref: 'Bath / reference electrode (REF)' }),
    props: { mperiod: 60, mamp: 1.2, mspeed: 1, mstim: 0, mnoise: 40, mcontact: 5 },
    settings: [
      { key: 'mperiod', label: 'Oscillation period', kind: 'range', min: 10, max: 180, step: 1, fmt: v => `${Math.round(v)} s` },
      { key: 'mamp', label: 'Amplitude', kind: 'range', min: 0, max: 10, step: 0.1, fmt: v => `${(+v).toFixed(1)} mV` },
      { key: 'mspeed', label: 'Time speed-up (watch it in a short run)', kind: 'range', min: 1, max: 120, step: 1, fmt: v => `×${Math.round(v)}` },
      { key: 'mstim', label: 'Stimulus: repellent ← → food', kind: 'range', min: -100, max: 100, step: 5, fmt: v => (v > 0 ? `food +${Math.round(v)}` : v < 0 ? `repellent ${Math.round(v)}` : 'none') },
      { key: 'mnoise', label: 'Electrode noise', kind: 'range', min: 0, max: 300, step: 5, fmt: v => `${Math.round(v)} µV` },
      { key: 'mcontact', label: 'Electrode contact resistance', kind: 'range', min: 1, max: 100, step: 1, fmt: v => `${Math.round(v)} kΩ` },
    ],
    note: 'Lay this over an imported electrode board (drag it on top). Each of the board’s electrode pads that the organism covers picks up its slow electrical rhythm — a wave that travels out from the pacemaker lobe — and passes it to that pad’s pin, measured against REF. Wire a pin and a reference pin to a BioAmp Pill, then read the Pill with the Arduino. A modelled, illustrative signal — not data from a real culture.',
  },
  'signal-source': {
    label: 'Biosignal source (electrodes on a body: ECG, EMG, EEG, EOG)',
    ...roles({ pos: 'Electrode + (IN+)', neg: 'Electrode − (IN−)', ref: 'Reference electrode (REF)' }),
    props: { signal: 'ecg', bpm: 70, effort: 50, scale: 100, contact: 5, hum: 0, attached: 1, sp: '', sn: '', sr: '' },
    settings: [
      { key: 'signal', label: 'Signal', kind: 'select', options: [['ecg', 'ECG — heartbeat'], ['emg', 'EMG — muscle'], ['eeg', 'EEG — brain'], ['eog', 'EOG — eyes'], ['sine', 'Test sine 10 Hz']] },
      { key: 'bpm', label: 'Heart rate (ECG)', kind: 'range', min: 40, max: 180, step: 1, fmt: v => `${Math.round(v)} bpm` },
      { key: 'effort', label: 'Muscle effort (EMG)', kind: 'range', min: 0, max: 100, step: 1, fmt: v => `${Math.round(v)} %` },
      { key: 'scale', label: 'Signal strength', kind: 'range', min: 0, max: 300, step: 5, fmt: v => `${Math.round(v)} %` },
      { key: 'contact', label: 'Electrode contact resistance', kind: 'range', min: 1, max: 100, step: 1, fmt: v => `${Math.round(v)} kΩ` },
      { key: 'hum', label: 'Mains hum (50 Hz pickup)', kind: 'range', min: 0, max: 100, step: 1, fmt: v => `${Math.round(v)} %` },
      { key: 'attached', label: 'Electrodes', kind: 'select', options: [[1, 'On the body'], [0, 'Peeled off']] },
    ],
    note: 'A simulated body: the voltage between IN+ and IN− follows the chosen biosignal (a typical, illustrative waveform — not a medical measurement). Wire the three electrodes to an amplifier such as the BioAmp EXG Pill. Poor contact plus mains hum adds 50 Hz interference, like a real bench.',
  },
  stepper: {
    label: 'Stepper motor (counts the coil pattern the sketch sends)',
    ...roles({ vcc: 'Power (VCC)', gnd: 'Ground (GND)' }),
    lists: { coils: 'Coil inputs IN1…IN4, in order' },
    params: [{ key: 'steps', label: 'Steps per turn', unit: '', min: 20, max: 8192, step: 1, def: 2048 }],
    note: 'Each time the coil inputs advance to the next pattern (full or half steps), the shaft turns one step. Wire it like a 28BYJ-48 with its ULN2003 board: IN1…IN4 to four Arduino pins, power to 5V.',
  },
};

/** Behaviours drawn with a schematic symbol / live indicator in the middle of the part (see iconSVG in src/parts/elements.js). */
export const ICON_KINDS = new Set(['switch', 'relay', 'variable-resistor', 'diode', 'npn', 'pnp', 'nmos', 'pmos', 'regulator', 'capacitor', 'inductor', 'buzzer', 'motor', 'led-array', 'servo', 'ultrasonic', 'encoder', 'stepper', 'keypad', 'switch-bank', 'joystick']);

/** Behaviours that need the firmware's pin timing (not just the solved voltages). */
export const TIMED_KINDS = new Set(['servo', 'ultrasonic', 'stepper']);

/** Clamp/clean the params of a behaviour. Unknown keys are dropped, bad values fall back to the default. */
export function cleanParams(def, raw) {
  const out = {};
  for (const p of def.params || []) {
    const v = raw?.[p.key];
    if (p.options) { out[p.key] = p.options.some(([o]) => o === v) ? v : p.def; continue; }
    const n = Number(v);
    out[p.key] = v !== undefined && v !== null && v !== '' && Number.isFinite(n) ? Math.min(p.max, Math.max(p.min, +n.toPrecision(6))) : p.def;
  }
  return out;
}
