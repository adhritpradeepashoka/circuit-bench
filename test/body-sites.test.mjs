import test from 'node:test';
import assert from 'node:assert/strict';
import { SITE, SITES, siteSignal, sitePosition, surfacePoint } from '../src/core/body-sites.js';
import { signalAt } from '../src/core/signals.js';

const peak = (a, b, opts) => { let m = 0; for (let i = 0; i < 4000; i++) m = Math.max(m, Math.abs(siteSignal(a, b, i / 500, opts))); return m; };

test('every site has a position on the head scan, left sites left and right sites right', () => {
  for (const s of SITES) assert.ok(sitePosition(s.id), s.id);
  assert.ok(sitePosition('Fp1').x < 0 && sitePosition('Fp2').x > 0);
  assert.ok(sitePosition('Cz').z > sitePosition('T3').z && sitePosition('Fz').y > sitePosition('Pz').y);
  const p = surfacePoint(36, 90); assert.ok(Math.abs((p.x / 0.78) ** 2 + (p.y / 0.95) ** 2 + (p.z / 0.95) ** 2 - 1) < 1e-9);
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
