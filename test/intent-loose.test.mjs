import test from 'node:test';
import assert from 'node:assert/strict';
import { recipeEdit } from '../src/core/recipes.js';

const bench = { parts: [{ id: 'u', type: 'arduino-uno' }], wires: [] };
const types = r => r.actions.filter(a => a.op === 'add_part').map(a => a.type);

// plain-language asks for 2–3 part circuits and their code are answered by the planner, on the device, without a model or a key
const ASKS = {
  'I want a button that turns on an led and sounds a buzzer': ['pushbutton', 'led', 'buzzer'],
  'when I press the button turn on the led and the buzzer': ['pushbutton', 'led', 'buzzer'],
  'use a pot to control the brightness of an led': ['potentiometer', 'led'],
  'make the servo follow the potentiometer': ['potentiometer', 'servo'],
  'make a servo move with a pot and light an led': ['potentiometer', 'servo', 'led'],
  'a pot, a servo and a button': ['potentiometer', 'servo', 'pushbutton'],
  'three leds and a button': ['led', 'pushbutton'],
  'build a motion alarm with a pir, a buzzer and an led': ['pir-sensor', 'buzzer', 'led'],
  'an led that gets brighter when it is dark': ['ldr-module', 'led'],
  'make a buzzer beep when motion is detected': ['pir-sensor', 'buzzer'],
  'make a doorbell with a button and a buzzer and an led': ['pushbutton', 'buzzer', 'led'],
  'create a thermometer with a dht sensor and an oled': ['dht', 'ssd1306'],
  'measure distance with an ultrasonic sensor and show it on an oled': ['hc-sr04', 'ssd1306'],
  'connect a potentiometer to an led and an oled': ['potentiometer', 'led', 'ssd1306'],
  'make an led blink when the button is pressed and beep the buzzer': ['led', 'pushbutton', 'buzzer'],
};
for (const [q, want] of Object.entries(ASKS)) {
  test(`builds on-device: "${q}"`, () => {
    const r = recipeEdit(q, bench);
    assert.ok(r, 'understood'); assert.ok(r.code, 'with its sketch');
    const got = new Set(types(r)); for (const t of want) assert.ok(got.has(t), `${t} missing: ${[...got]}`);
    assert.equal(types(r).filter(t => t === 'buzzer').length <= 1, true, 'one buzzer, not two');
  });
}

// things that are edits, questions or one part must not become a circuit build
for (const q of ['add an led', 'make the led red', 'make the led red and the resistor 1k', 'set the resistor to 330 ohms', 'remove the led and the button', 'why is my led not lighting when I press the button?', 'what does a buzzer do', 'wire the led to pin 13', 'make an led', 'show the led']) {
  test(`stays an edit/question: "${q}"`, () => assert.equal(recipeEdit(q, bench), null));
}
