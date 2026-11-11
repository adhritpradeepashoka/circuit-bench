import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFrame, encodeFrame, fromRows, invert, toggle, scrollFrames, PRESETS, MATRIX_LEDS, EMPTY_FRAME } from '../src/core/matrix.js';
import { propsOf } from '../src/core/project.js';

test('a matrix frame round-trips through its 26-character hex form, and bad input is an empty frame', () => {
  for (const name of Object.keys(PRESETS)) { const bits = fromRows(PRESETS[name]), hex = encodeFrame(bits); assert.equal(hex.length, 26); assert.deepEqual(decodeFrame(hex), bits, name); }
  assert.equal(encodeFrame(new Array(MATRIX_LEDS).fill(0)), EMPTY_FRAME); assert.deepEqual(decodeFrame('nonsense'), new Array(MATRIX_LEDS).fill(0));
  const b = fromRows(PRESETS.Border); assert.equal(b.filter(Boolean).length, 13 * 2 + 6 * 2); assert.equal(invert(b).filter(Boolean).length, MATRIX_LEDS - b.filter(Boolean).length); assert.equal(toggle(b, 0)[0], 0);
});
test('scrolling text slides a 13-wide window across the columns', () => {
  const cols = [[1, 0, 0, 0, 0, 0, 0, 1], [0, 1, 0, 0, 0, 0, 1, 0]], f = scrollFrames(cols); assert.equal(f.length, 13 * 2 + 2 - 13 + 1); assert.ok(f.every(x => x.length === MATRIX_LEDS)); assert.ok(f.some(x => x.some(Boolean)));
});
test('the matrix is a saved part property and a malformed one is dropped', () => {
  assert.equal(propsOf({ type: 'arduino-uno-q', matrix: '0001831E3CFBE3FE0FE03E00E0' }).matrix, '0001831e3cfbe3fe0fe03e00e0');
  assert.equal(propsOf({ type: 'arduino-ventuno-q', matrix: 'zzz' }).matrix, ''); assert.equal(propsOf({ type: 'arduino-uno-q' }).matrix, '');
});
