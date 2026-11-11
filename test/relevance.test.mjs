import test from 'node:test';
import assert from 'node:assert/strict';
import { looksRelevant, NOT_RELEVANT } from '../src/core/relevance.js';

test('bench talk is relevant; greetings, trivia and homework are not', () => {
  for (const t of ['add a servo to pin 9', 'make the LED blink', 'put a 220 ohm resistor on D3', 'swing the arm 45 degrees', 'wire the oled', 'why does my drone tip over', 'use A0 and 5 V']) assert.equal(looksRelevant(t), true, t);
  for (const t of ['hi', 'tell me a joke', 'what is the capital of india', 'write my essay on the french revolution', 'who won the cricket match', '', '   ']) assert.equal(looksRelevant(t), false, t);
  assert.match(NOT_RELEVANT, /not relevant/);
});
