// What each part needs to be a working circuit. A recipe gets the planner `c` (scan / add / wire / sketch) and says, in a few lines,
// which pins go where and what the sketch does. Recipes are keyed by exact part (the built-in ones) or by BEHAVIOUR KIND, so every
// part of that kind — the library's, the Part Creator's, a KiCad import — is wired the same way from the roles it declares.
//
// Sources (a button, a knob, a sensor) offer the actuators something to follow:
//   c.signals.bool   { expr, label }  yes/no       c.signals.level { expr, label }  a 0–1023 reading
// Actuators (LED, servo, buzzer, motor…) follow the bool, else the level, else do a little demo of their own.
import { PART_DEFS } from '../parts.js';
import { phase, SOURCE, SINK, ACTUATOR, OTHER, offerBool, offerLevel, ledOnPin, roleMap, PlanError } from './helpers.js';

/* ── boards ────────────────────────────────────────────────────────────────────────────────────── */
const board = type => phase(OTHER)(c => {
  const have = c.getBoard(type);
  if (have.type !== type) { c.say(`There is already ${c.boardName()} on the bench, and only one board runs at a time — so I kept it. Remove it first if you want the ${PART_DEFS[type].name} instead.`); return; }
  c.sketch.title = `${PART_DEFS[type].name}: blinks its own LED (pin ${c.spec().ledPin})`;
  c.sketch.setup('pinMode(LED_BUILTIN, OUTPUT);');
  c.sketch.tick(500, ['digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));']);
  c.say(`${c.wasBoardAdded() ? 'Added' : 'Used'} the ${PART_DEFS[type].name} with a sketch that blinks its own LED.`);
});

/* ── LED, button, switch, knob ─────────────────────────────────────────────────────────────────── */
const ledRecipe = phase(ACTUATOR)((c, { n, count, color, ohms, type = 'led' }) => {
  const s = c.sketch, f = c.signals, custom = type !== 'led' && PART_DEFS[type]?.spec?.behaviour?.kind === 'led', roles = custom ? roleMap(type) : {};
  const bool = f.bool, level = f.level && !bool ? f.level : null;
  const { pin, led, isNew } = ledOnPin(c, { color, ohms, kind: level ? 'pwm' : 'digital', fresh: n > 0, ...(custom ? { type, anode: roles.anode, cathode: roles.cathode } : {}) });
  c.signals.leds.push({ pin, led });
  s.setup(`pinMode(${pin}, OUTPUT);`);
  if (bool) { s.sample(`digitalWrite(${pin}, (${bool.expr}) ? HIGH : LOW);`); c.signals.consumed = true; }
  else if (level) {
    const pwm = c.spec().pwm.includes(pin);
    s.sample(pwm ? `analogWrite(${pin}, ${level.expr} / 4);` : `digitalWrite(${pin}, ${level.expr} > 511 ? HIGH : LOW);`); c.signals.consumed = true;
  } else if (count === 1) { s.tick(500, [`digitalWrite(${pin}, !digitalRead(${pin}));`]); }
  else if (n === count - 1) {
    const pins = c.signals.leds.map(x => x.pin);
    s.global(`const int ledPins[] = {${pins.join(', ')}};`);
    s.tick(300, ['static int lit = 0;', `for (int i = 0; i < ${pins.length}; i++) digitalWrite(ledPins[i], i == lit ? HIGH : LOW);`, `lit = (lit + 1) % ${pins.length};`]);
  }
  s.title ||= count === 1 ? `LED on pin ${pin}${bool ? ` — follows ${bool.label}` : level ? ` — brightness follows ${level.label}` : ': blinks once a second'}` : `${count} LEDs: they light up one after another`;
  const label = custom ? PART_DEFS[type].name.replace(/\s*\(.*$/, '') : 'LED';
  c.say(isNew ? `Added a ${label} with a ${ohms} Ω resistor on pin ${pin}.` : `Used the ${label} already on pin ${pin}.`);
});

const buttonRecipe = phase(SOURCE)((c, { n }) => {
  const s = c.sketch, b = c.part('pushbutton', { fresh: n > 0 });
  const pin = c.hook(b, '1.l', 'digital', { prefer: ['2', '3', '4', '5'] }); c.ground(b, '2.l');
  s.setup(`pinMode(${pin}, INPUT_PULLUP);`);
  const v = s.uid('pressed'); s.global(`bool ${v} = false;`); s.sample(`${v} = digitalRead(${pin}) == LOW;`);
  offerBool(c, v, 'the button'); s.title ||= `Button on pin ${pin} (wired to GND): pressing it reads LOW`;
  c.say(`${c.nets() && !b.isNew ? 'Used the' : 'Added a'} pushbutton on pin ${pin}.`);
});

const switchRecipe = phase(SOURCE)((c, { n }) => {
  const s = c.sketch, w = c.part('slide-switch', { fresh: n > 0 });
  const pin = c.hook(w, '2', 'digital', { prefer: ['2', '3', '4', '5'] }); c.ground(w, '1'); c.power(w, '3', 'logic');
  s.setup(`pinMode(${pin}, INPUT);`);
  const v = s.uid('switchOn'); s.global(`bool ${v} = false;`); s.sample(`${v} = digitalRead(${pin}) == HIGH;`);
  offerBool(c, v, 'the switch'); s.title ||= `Slide switch on pin ${pin}: HIGH when slid to the supply side`;
  c.say(`${w.isNew ? 'Added a' : 'Used the'} slide switch on pin ${pin}.`);
});

const potRecipe = phase(SOURCE)((c, { n }) => {
  const s = c.sketch, p = c.part('potentiometer', { fresh: n > 0 });
  const pin = c.hook(p, 'SIG', 'analog'); c.power(p, 'VCC'); c.ground(p, 'GND');
  const v = s.uid('knob'); s.measure(`int ${v} = analogRead(${pin});`); s.show('Knob', v);
  offerLevel(c, `analogRead(${pin})`, 'the knob'); s.title ||= `Potentiometer on ${pin}: analogRead gives 0 – 1023`;
  c.say(`${p.isNew ? 'Added a' : 'Used the'} potentiometer on ${pin}.`);
});

const CORE_BY_TYPE = {
  'arduino-uno': board('arduino-uno'), 'arduino-nano': board('arduino-nano'), 'arduino-mega': board('arduino-mega'), 'arduino-uno-r4': board('arduino-uno-r4'), 'raspberry-pi-pico': board('raspberry-pi-pico'),
  led: ledRecipe, pushbutton: buttonRecipe, 'slide-switch': switchRecipe, potentiometer: potRecipe,
};

import { SENSORS_BY_TYPE, SENSORS_BY_KIND } from './recipes-sensors.js';
import { ACTUATORS_BY_TYPE, ACTUATORS_BY_KIND } from './recipes-actuators.js';
import { PARTS_BY_TYPE, PARTS_BY_KIND, setLedRecipe } from './recipes-parts.js';
setLedRecipe(ledRecipe);
export const BY_TYPE = { ...CORE_BY_TYPE, ...SENSORS_BY_TYPE, ...ACTUATORS_BY_TYPE, ...PARTS_BY_TYPE };
export const BY_KIND = { ...SENSORS_BY_KIND, ...ACTUATORS_BY_KIND, ...PARTS_BY_KIND, led: ledRecipe };
export function recipeFor(type) { return BY_TYPE[type] || BY_KIND[PART_DEFS[type]?.spec?.behaviour?.kind] || null; }
export { SOURCE, SINK, ACTUATOR, OTHER, PlanError, roleMap, ledOnPin, offerBool, offerLevel };
