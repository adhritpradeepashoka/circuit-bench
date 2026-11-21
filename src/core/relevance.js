// Is a chat message about the bench at all? The tiny model uses this to tell "I can't do that, but it is about your project" from "this has nothing to do
// with the project", and to answer the second with one plain line instead of guessing. Pure; no model involved.
import { PART_DEFS } from './parts.js';
const WORDS = `arduino uno nano mega pico esp32 esp8266 raspberry microbit micro:bit board circuit wire wires wiring pin pins gpio led leds resistor resistors capacitor diode transistor mosfet
button switch pushbutton potentiometer sensor sensors buzzer speaker display oled lcd screen keypad servo servos motor motors stepper driver l298n relay battery volt volts voltage amp amps
current ohm ohms breadboard ground gnd power vcc 5v 3v3 analog digital pwm uart i2c spi serial sketch code program upload compile loop setup delay blink read write
drone quad quadcopter prop propeller props frame flight controller esc robot robotics arm leg wheel wheels chassis link bracket plate gear hinge joint joints angle axis rotate move place join screw hole holes mount part parts assembly
simulate simulation sim run test physics gravity floor collision torque speed stop endstop limit range exoskeleton servo-x ultrasonic imu gyro accelerometer temperature light ldr pir camera wifi bluetooth module chip ic
bioamp exg pill emg ecg eeg eog electrode electrodes biosignal biosignals bioelectronics muscle heartbeat heart brainwave signal signals amplifier opamp input inputs output outputs controlled control controls controller envelope threshold filter model train training neural dataset transducer transducers ultrasonic acoustic levitation levitate frequency wavelength field pressure
add remove delete undo connect disconnect attach detach fix change make build create open close turn on off help how what why where which can could should explain tutorial lesson project workspace pack`.split(/\s+/);
const SET = new Set(WORDS.filter(Boolean));
// words that are only "bench" in combination: a message made of these alone (a greeting, a joke, homework) is not about the project
const DOMAIN = WORDS.filter(w => !['add', 'remove', 'delete', 'undo', 'make', 'build', 'create', 'open', 'close', 'turn', 'on', 'off', 'help', 'how', 'what', 'why', 'where', 'which', 'can', 'could', 'should', 'explain', 'fix', 'change', 'move', 'run', 'test', 'read', 'write', 'stop', 'limit', 'range', 'light', 'power', 'speed', 'current', 'place', 'project', 'connect', 'disconnect', 'attach', 'detach', 'open', 'close', 'part', 'parts', 'code', 'program', 'frame', 'link', 'plate', 'screen', 'camera', 'chip', 'ic', 'module', 'lesson', 'tutorial', 'workspace', 'pack'].includes(w));
const DOMAIN_SET = new Set(DOMAIN), DOMAIN_STEMS = DOMAIN.filter(w => w.length >= 4);
export const NOT_RELEVANT = 'Your message was not relevant. Please try asking the AI assistant for help on relevant topics: your circuit, parts, wiring, code or robot.';
/** True when the message mentions something from the bench (a part, a pin, wiring, code, a robot, the simulator…). */
// every part in the catalogue counts too (its id and the words of its name), including parts a workspace or a student added
let catalogue = null, catalogueSize = -1;
const catalogueWords = () => {
  const keys = Object.keys(PART_DEFS); if (catalogue && keys.length === catalogueSize) return catalogue;
  catalogue = new Set(); catalogueSize = keys.length;
  for (const k of keys) for (const w of `${k} ${PART_DEFS[k]?.label || ''} ${PART_DEFS[k]?.name || ''}`.toLowerCase().match(/[a-z0-9]{3,}/g) || []) if (!['the', 'and', 'with', 'for', 'custom'].includes(w)) catalogue.add(w);
  return catalogue;
};
export function looksRelevant(text) {
  const t = String(text || '').toLowerCase(); if (!t.trim()) return false;
  const tokens = t.match(/[a-z0-9:+\\-]+/g) || [];
  if (tokens.some(w => DOMAIN_SET.has(w) || DOMAIN_SET.has(w.replace(/s$/, '')))) return true;
  const cat = catalogueWords(); if (tokens.some(w => cat.has(w) || cat.has(w.replace(/s$/, '')))) return true;
  if (/\b(a|d)\d{1,2}\b|\b\d+\s?(k|m)?\s?(ohm|ohms|v|volt|volts|ma|mah|hz|khz|rpm|deg|degrees|mm|g)\b/.test(t)) return true;     // pin names, values with units
  return DOMAIN_STEMS.some(w => t.includes(w));
}
