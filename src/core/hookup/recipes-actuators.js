// Recipes for things that DO something: colour and segment LEDs, servo, buzzer, LED bar, relay, motors and their drivers.
// Each follows what the sources in the plan offer — a yes/no (c.signals.bool), else a 0–1023 level (c.signals.level) — or runs a demo.
import { PART_DEFS } from '../parts.js';
import { phase, ACTUATOR, OTHER, roleMap, PlanError, loadLed } from './helpers.js';

const shortName = def => def.name.replace(/\s*\(.*$/, '').replace(/\s+/g, ' ').trim();
const isPwm = (c, pin) => c.spec().pwm.includes(pin);

/* ── RGB LED ─────────────────────────────────────────────────────────────────────────────────── */
const rgb = phase(ACTUATOR)((c, { n, ohms }) => {
  const s = c.sketch, h = c.part('rgb-led', { fresh: n > 0 }), f = c.signals;
  c.ground(h, 'COM');
  const pins = {};
  for (const ch of ['R', 'G', 'B']) pins[ch] = c.drive(h, ch, 'pwm', { ohms: ohms || 220, dir: 'out' });
  const { R, G, B } = pins, v = s.uid('colour');
  s.setup(`pinMode(${R}, OUTPUT);`); s.setup(`pinMode(${G}, OUTPUT);`); s.setup(`pinMode(${B}, OUTPUT);`);
  s.global(`void ${v}(int t) {                     // t = 0 … 767 walks round the rainbow\n  int r = 0, g = 0, b = 0;\n  if (t < 256) { r = 255 - t; g = t; }\n  else if (t < 512) { g = 511 - t; b = t - 256; }\n  else { b = 767 - t; r = t - 512; }\n  analogWrite(${R}, r); analogWrite(${G}, g); analogWrite(${B}, b);\n}`);
  if (f.bool) { s.sample(`${v}((${f.bool.expr}) ? 0 : 255);`); f.consumed = true; }
  else if (f.level) { s.sample(`${v}(map(${f.level.expr}, 0, 1023, 0, 767));`); f.consumed = true; }
  else s.tick(15, ['static int t = 0;', `${v}(t);`, 't = (t + 1) % 768;']);
  c.wiring(`RGB LED: red on pin ${R}, green on pin ${G}, blue on pin ${B} (each through a ${ohms || 220} Ω resistor); the common leg to GND`);
  s.title ||= `RGB LED on pins ${R}, ${G}, ${B}: ${f.bool || f.level ? 'colour follows ' + (f.bool || f.level).label : 'cycles through the rainbow'}`;
  c.say(`${h.isNew ? 'Added an' : 'Used the'} RGB LED (red ${R}, green ${G}, blue ${B}; common cathode to GND, three ${ohms || 220} Ω resistors).`);
});

/* ── 7-segment display ───────────────────────────────────────────────────────────────────────── */
const seven = phase(ACTUATOR)((c, { n, ohms }) => {
  const s = c.sketch, h = c.part('seven-segment', { fresh: n > 0 }), f = c.signals;
  c.ground(h, 'COM.1');
  const segs = ['A', 'B', 'C', 'D', 'E', 'F', 'G'], pins = [];
  for (const sg of segs) pins.push(c.drive(h, sg, 'digital', { ohms: ohms || 220, dir: 'out' }));
  const arr = s.uid('segPins'), show = s.uid('showDigit');
  s.global(`const int ${arr}[7] = {${pins.join(', ')}};                       // segments A … G`);
  s.global('const byte DIGITS[10] = {0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110, 0b1101101, 0b1111101, 0b0000111, 0b1111111, 0b1101111};   // bit 0 = A … bit 6 = G');
  s.global(`void ${show}(int d) {\n  for (int i = 0; i < 7; i++) digitalWrite(${arr}[i], (DIGITS[d] >> i) & 1);\n}`);
  s.setup(`for (int i = 0; i < 7; i++) pinMode(${arr}[i], OUTPUT);`);
  if (f.bool) { s.sample(`${show}((${f.bool.expr}) ? 8 : 0);`); f.consumed = true; }
  else if (f.level) { s.sample(`${show}(map(${f.level.expr}, 0, 1023, 0, 9));`); f.consumed = true; }
  else s.tick(1000, ['static int d = 0;', `${show}(d);`, 'd = (d + 1) % 10;']);
  c.wiring(`7-segment: segments A … G on pins ${pins.join(', ')} (each through a ${ohms || 220} Ω resistor); COM to GND`);
  s.title ||= `7-segment display: ${f.bool || f.level ? 'shows a digit that follows ' + (f.bool || f.level).label : 'counts 0 – 9'}`;
  c.say(`${h.isNew ? 'Added a' : 'Used the'} 7-segment display (segments A–G on pins ${pins.join(', ')}, seven ${ohms || 220} Ω resistors, COM to GND).`);
});

/* ── servo ───────────────────────────────────────────────────────────────────────────────────── */
const servo = phase(ACTUATOR)((c, { n, type }) => {
  const s = c.sketch, r = roleMap(type), h = c.part(type, { fresh: n > 0 }), f = c.signals;
  c.power(h, r.vcc, 'v5'); c.ground(h, r.gnd);
  const pin = c.hook(h, r.signal, 'digital', { prefer: ['7', '8', '4', '12'], dir: 'out' }), v = s.uid('servo');
  s.include('Servo.h'); s.global(`Servo ${v};`); s.setup(`${v}.attach(${pin});`);
  if (f.bool) { s.sample(`${v}.write((${f.bool.expr}) ? 180 : 0);`); f.consumed = true; }
  else if (f.level) { s.sample(`${v}.write(map(${f.level.expr}, 0, 1023, 0, 180));`); f.consumed = true; }
  else s.tick(15, ['static int angle = 0, step = 1;', `${v}.write(angle);`, 'angle += step;', 'if (angle >= 180 || angle <= 0) step = -step;']);
  s.title ||= `Servo on pin ${pin}: ${f.bool || f.level ? 'follows ' + (f.bool || f.level).label : 'sweeps 0° – 180°'}`;
  c.say(`${h.isNew ? 'Added a' : 'Used the'} servo (signal on pin ${pin}, powered from 5V).`);
});

/* ── buzzer ──────────────────────────────────────────────────────────────────────────────────── */
const buzzer = phase(ACTUATOR)((c, { n, type }) => {
  const s = c.sketch, r = roleMap(type), h = c.part(type, { fresh: n > 0 }), f = c.signals;
  // a Pico or UNO R4 pin is good for far less than an Uno's 40 mA: a bare buzzer would ask for more, so it gets a series resistor there
  const pin = (c.logic < 4 || (c.spec().pinMaxA ?? 1) < 0.03) ? c.drive(h, r.a, 'digital', { ohms: 150, prefer: ['8', '7', '6', '12'], dir: 'out' }) : c.hook(h, r.a, 'digital', { prefer: ['8', '7', '6', '12'], dir: 'out' }); c.ground(h, r.b);
  if (f.bool) { s.sample(`if (${f.bool.expr}) tone(${pin}, 880); else noTone(${pin});`); f.consumed = true; }
  else if (f.level) { s.sample(`tone(${pin}, map(${f.level.expr}, 0, 1023, 200, 2000));`); f.consumed = true; }
  else { s.global('const int NOTES[] = {262, 294, 330, 349, 392, 440, 494, 523};      // C D E F G A B C'); s.tick(400, ['static int i = 0;', `tone(${pin}, NOTES[i], 300);`, 'i = (i + 1) % 8;']); }
  s.title ||= `Buzzer on pin ${pin}: ${f.bool ? 'sounds while ' + f.bool.label + ' is on' : f.level ? 'pitch follows ' + f.level.label : 'plays a scale'}`;
  c.say(`${h.isNew ? 'Added a' : 'Used the'} buzzer (+ on pin ${pin}, − to GND).`);
});

/* ── LED arrays (bar graph) ──────────────────────────────────────────────────────────────────── */
const ledArray = phase(ACTUATOR)((c, { n, type, ohms }) => {
  const s = c.sketch, b = PART_DEFS[type].spec.behaviour, h = c.part(type, { fresh: n > 0 }), f = c.signals, roles = roleMap(type);
  const pins = [], anodeCommon = b.common === 'anode';
  if (b.cathodes?.length === b.segments.length && b.cathodes.length) {
    b.segments.forEach((sg, i) => { pins.push(c.drive(h, sg, 'digital', { ohms: ohms || 220, dir: 'out' })); c.ground(h, b.cathodes[i]); });
  } else if (roles.common) {
    if (anodeCommon) c.power(h, roles.common); else c.ground(h, roles.common);
    b.segments.forEach(sg => pins.push(c.drive(h, sg, 'digital', { ohms: ohms || 220, dir: 'out' })));
  } else throw new PlanError(`${shortName(PART_DEFS[type])} has no common pin to wire.`, 'no-common');
  const on = anodeCommon && !b.cathodes?.length ? 'LOW' : 'HIGH', off = on === 'HIGH' ? 'LOW' : 'HIGH', arr = s.uid('barPins'), N = pins.length;
  s.global(`const int ${arr}[${N}] = {${pins.join(', ')}};`);
  s.setup(`for (int i = 0; i < ${N}; i++) pinMode(${arr}[i], OUTPUT);`);
  if (f.level && !f.bool) { s.sample(`int lit = map(${f.level.expr}, 0, 1023, 0, ${N});`); s.sample(`for (int i = 0; i < ${N}; i++) digitalWrite(${arr}[i], i < lit ? ${on} : ${off});`); f.consumed = true; }
  else if (f.bool) { s.sample(`for (int i = 0; i < ${N}; i++) digitalWrite(${arr}[i], (${f.bool.expr}) ? ${on} : ${off});`); f.consumed = true; }
  else s.tick(120, ['static int pos = 0, dir = 1;', `for (int i = 0; i < ${N}; i++) digitalWrite(${arr}[i], i == pos ? ${on} : ${off});`, 'pos += dir;', `if (pos >= ${N - 1} || pos <= 0) dir = -dir;`]);
  c.wiring(`${shortName(PART_DEFS[type])}: the ${N} LEDs on pins ${pins.join(', ')} (each through a ${ohms || 220} Ω resistor); the other side to GND`);
  s.title ||= `${shortName(PART_DEFS[type])}: ${f.level && !f.bool ? 'a level meter that follows ' + f.level.label : f.bool ? 'all on while ' + f.bool.label : 'a light bouncing back and forth'}`;
  c.say(`${h.isNew ? 'Added a' : 'Used the'} ${shortName(PART_DEFS[type]).toLowerCase()} (${N} LEDs on pins ${pins.join(', ')}, each with a ${ohms || 220} Ω resistor).`);
});

/* ── relay: a transistor from the pin, a diode across the coil, an LED on the contact ──────────── */
const relay = phase(ACTUATOR)((c, { n, type }) => {
  const s = c.sketch, r = roleMap(type), h = c.part(type, { fresh: n > 0 }), f = c.signals;
  const q = c.helper('custom-q-2n2222', [['C', h, r.coilB]]);
  const d = c.helper('custom-d-1n4007', [['K', h, r.coilA], ['A', h, r.coilB]]);
  const pin = c.drive(q, 'B', 'digital', { ohms: 1000, prefer: ['7', '6', '5', '4'], dir: 'out' });
  c.ground(q, 'E');
  c.power(h, r.coilA, 'v5'); c.join(h, r.coilB, q, 'C');
  c.join(d, 'K', h, r.coilA); c.join(d, 'A', h, r.coilB);
  c.power(h, r.common, 'v5'); loadLed(c, { from: [h, r.no], to: 'gnd' });
  s.setup(`pinMode(${pin}, OUTPUT);`);
  if (f.bool) { s.sample(`digitalWrite(${pin}, (${f.bool.expr}) ? HIGH : LOW);`); f.consumed = true; }
  else if (f.level) { s.sample(`digitalWrite(${pin}, ${f.level.expr} > 511 ? HIGH : LOW);`); f.consumed = true; }
  else s.tick(2000, [`digitalWrite(${pin}, !digitalRead(${pin}));`]);
  c.wiring(`Relay: pin ${pin} → 1 kΩ → NPN transistor base; transistor emitter → GND; coil between 5V and the collector, with a diode across it; the contact switches an LED`);
  s.title ||= `Relay on pin ${pin} (through a transistor): ${f.bool || f.level ? 'follows ' + (f.bool || f.level).label : 'clicks on and off every 2 s'}`;
  c.say(`${h.isNew ? 'Added a' : 'Used the'} relay, driven from pin ${pin} through a 2N2222 transistor with a 1N4007 flyback diode; its contact lights an LED.`);
});

/* ── DC motor: L298N driver + battery ────────────────────────────────────────────────────────── */
function motorWithDriver(c, { n }) {
  const s = c.sketch, f = c.signals;
  const drv = c.part('l298n', { fresh: n > 0 }), mot = c.part('dc-motor', { fresh: n > 0 });
  const bat = c.part('battery', { props: { volts: 9 }, fresh: n > 0 });
  const board = c.getBoard();
  c.join(mot, '1', drv, 'OUT1'); c.join(mot, '2', drv, 'OUT2');
  c.join(bat, '+', drv, '12V'); c.join(bat, '-', drv, 'GND'); c.ground(drv, 'GND'); c.ground(bat, '-');
  const in1 = c.hook(drv, 'IN1', 'digital', { prefer: ['8', '7', '4', '12'], dir: 'out' }), in2 = c.hook(drv, 'IN2', 'digital', { prefer: ['7', '8', '4', '12'], exclude: [in1], dir: 'out' }), ena = c.hook(drv, 'ENA', 'pwm', { dir: 'out' });
  const v = s.uid('drive');
  s.setup(`pinMode(${in1}, OUTPUT);`); s.setup(`pinMode(${in2}, OUTPUT);`); s.setup(`pinMode(${ena}, OUTPUT);`);
  s.global(`void ${v}(int speed) {            // -255 … 255\n  digitalWrite(${in1}, speed > 0);\n  digitalWrite(${in2}, speed < 0);\n  analogWrite(${ena}, abs(speed));\n}`);
  if (f.bool) { s.sample(`${v}((${f.bool.expr}) ? 255 : 0);`); f.consumed = true; }
  else if (f.level) { s.sample(`${v}(map(${f.level.expr}, 0, 1023, -255, 255));`); f.consumed = true; }
  else {
    s.serial(); s.global('const int SPEEDS[] = {0, 51, 102, 153, 204, 255, 0, -51, -102, -153, -204, -255};');
    s.tick(600, ['static int i = 0;', `${v}(SPEEDS[i]);`, 'Serial.print("speed ");', 'Serial.println(SPEEDS[i]);', 'i = (i + 1) % 12;']);
  }
  c.wiring('Motor: OUT1 / OUT2 → the motor; L298N 12V → battery +; battery − → L298N GND and the Arduino GND');
  s.title ||= `DC motor through an L298N (IN1 pin ${in1}, IN2 pin ${in2}, ENA pin ${ena}): ${f.bool || f.level ? 'follows ' + (f.bool || f.level).label : 'ramps up, stops, reverses'}`;
  c.say(`${mot.isNew ? 'Added a' : 'Used the'} DC motor with an L298N driver and a 9 V battery (IN1 pin ${in1}, IN2 pin ${in2}, ENA pin ${ena}); the battery − is joined to the Arduino GND.`);
}
const motorDriven = phase(ACTUATOR)((c, ctx) => {
  // asking for the motor or the driver gives the whole circuit; ask once even if both were named
  if (c.mem.motor) return; c.mem.motor = true; motorWithDriver(c, ctx);
});

/* ── a bare 2-wire motor / fan (kind 'motor'): a MOSFET from a PWM pin, a diode across it ───────── */
const motorKind = phase(ACTUATOR)((c, { n, type }) => {
  const s = c.sketch, r = roleMap(type), h = c.part(type, { fresh: n > 0 }), f = c.signals;
  const q = c.helper('custom-q-irlz44n', [['D', h, r.b]]);
  const d = c.helper('custom-d-1n4007', [['K', h, r.a], ['A', h, r.b]]);
  c.power(h, r.a, 'v5'); c.join(h, r.b, q, 'D'); c.ground(q, 'S');
  const pin = c.hook(q, 'G', 'pwm', { dir: 'out' }); c.pull(q, 'G', 'gnd', 10000);
  c.join(d, 'K', h, r.a); c.join(d, 'A', h, r.b);
  const nm = shortName(PART_DEFS[type]);
  s.setup(`pinMode(${pin}, OUTPUT);`);
  if (f.bool) { s.sample(`digitalWrite(${pin}, (${f.bool.expr}) ? HIGH : LOW);`); f.consumed = true; }
  else if (f.level) { s.sample(`analogWrite(${pin}, ${f.level.expr} / 4);`); f.consumed = true; }
  else s.tick(30, ['static int speed = 0, step = 5;', `analogWrite(${pin}, speed);`, 'speed += step;', 'if (speed >= 255 || speed <= 0) step = -step;']);
  c.wiring(`${nm}: + to 5V, − to the MOSFET drain; MOSFET source to GND, gate to pin ${pin} (10 kΩ pull-down); a diode across the motor`);
  s.title ||= `${nm} through a MOSFET on pin ${pin}: ${f.bool || f.level ? 'follows ' + (f.bool || f.level).label : 'speeds up and slows down'}`;
  c.say(`${h.isNew ? 'Added a' : 'Used the'} ${nm.toLowerCase()}, switched by an IRLZ44N MOSFET from pin ${pin} with a 1N4007 flyback diode (a pin can't power a motor directly).`);
});

/* ── stepper (a ULN2003 board: IN1 … IN4) ────────────────────────────────────────────────────── */
const stepper = phase(ACTUATOR)((c, { n, type }) => {
  const s = c.sketch, b = PART_DEFS[type].spec.behaviour, r = roleMap(type), h = c.part(type, { fresh: n > 0 }), f = c.signals;
  c.power(h, r.vcc, 'v5'); c.ground(h, r.gnd);
  const pins = b.coils.map(p => c.hook(h, p, 'digital', { prefer: ['8', '9', '10', '11', '4', '5', '6', '7'], dir: 'out' })), arr = s.uid('coilPins');
  s.global(`const int ${arr}[4] = {${pins.join(', ')}};            // IN1 … IN4`);
  s.global('const byte HALF_STEPS[8] = {0b0001, 0b0011, 0b0010, 0b0110, 0b0100, 0b1100, 0b1000, 0b1001};   // which coils, bit 0 = IN1');
  s.setup(`for (int i = 0; i < 4; i++) pinMode(${arr}[i], OUTPUT);`);
  const body = ['static int phase = 0;', `for (int i = 0; i < 4; i++) digitalWrite(${arr}[i], (HALF_STEPS[phase] >> i) & 1);`, 'phase = (phase + 1) % 8;'];
  if (f.bool) { s.tick(4, [`if (${f.bool.expr}) {`, ...body.map(l => `  ${l}`), '}']); f.consumed = true; }
  else s.tick(4, body);
  s.title ||= `Stepper on pins ${pins.join(', ')}: ${f.bool ? 'turns while ' + f.bool.label + ' is on' : 'turns slowly (half steps)'}`;
  c.say(`${h.isNew ? 'Added a' : 'Used the'} stepper motor (IN1–IN4 on pins ${pins.join(', ')}, powered from 5V).`);
});

export const ACTUATORS_BY_TYPE = { 'rgb-led': rgb, 'seven-segment': seven, 'dc-motor': motorDriven, l298n: motorDriven };
export const ACTUATORS_BY_KIND = { servo, buzzer, 'led-array': ledArray, relay, motor: motorKind, stepper };
