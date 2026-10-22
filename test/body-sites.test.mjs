import test from 'node:test';
import assert from 'node:assert/strict';
import { SITE, siteSignal, sitePosition } from '../src/core/body-sites.js';
import { signalAt } from '../src/core/signals.js';

const peak = (a, b, opts) => { let m = 0; for (let i = 0; i < 4000; i++) m = Math.max(m, Math.abs(siteSignal(a, b, i / 500, opts))); return m; };

test('every site sits on the head ellipsoid', () => {
  for (const s of Object.values(SITE)) {
    const p = sitePosition(s.id), r = (p.x / 0.78) ** 2 + (p.y / 0.95) ** 2 + (p.z / 0.95) ** 2;
    assert.ok(Math.abs(r - 1) < 1e-9, s.id);
  }
});
test('alpha is stronger at the back of the head than at the front', () => {
  assert.ok(peak('O1', 'A1', { effort: 0 }) > peak('Cz', 'A1', { effort: 0 }));
});
test('eye electrodes see larger, slower steps than the brain; jaw sites see muscle', () => {
  assert.ok(peak('EOG-L', 'EOG-R', { effort: 0 }) > 3 * peak('Cz', 'Pz', { effort: 0 }));
  assert.ok(peak('EMG-ML', 'EMG-MR', { effort: 100 }) > peak('EMG-ML', 'EMG-MR', { effort: 0 }) * 3);
});
test('a placed source overrides its own signal, an unplaced one does not', () => {
  const base = { signal: 'ecg', scale: 100, contact: 5, hum: 0, effort: 50 };
  assert.notEqual(signalAt({ ...base, sp: 'O1', sn: 'A1' }, 0.37), signalAt(base, 0.37));
  assert.equal(signalAt({ ...base, sp: 'O1' }, 0.37), signalAt(base, 0.37));
});
