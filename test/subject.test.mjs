// The subject: mind state, gaze and one-off events change what each electrode pair picks up, depending on where the electrodes are.
import test from 'node:test';
import assert from 'node:assert/strict';
import { siteSignal } from '../src/core/body-sites.js';
import { neutralSubject } from '../src/core/subject.js';

const sub = patch => ({ ...neutralSubject(), autoBlink: false, ...patch });
const win = (a, b, subject, t0, t1, effort = 0) => { const v = []; for (let t = t0; t < t1; t += 0.002) v.push(siteSignal(a, b, t, { effort, subject })); return v; };
const peak = v => Math.max(...v.map(Math.abs)), rms = v => Math.sqrt(v.reduce((s, x) => s + x * x, 0) / v.length);

test('the default subject is unchanged: random blinks and glances still happen', () => {
  const v = win('Fp1', 'A1', neutralSubject(), 0, 12, 0); assert.ok(peak(v) > 1e-4, 'blinks show at the forehead');
});

test('a fired blink is a spike at the forehead and the eye, and hardly shows at the back of the head', () => {
  const s = sub({ events: [{ type: 'blink', t0: 5 }] });
  const fore = peak(win('Fp1', 'A1', s, 4.8, 5.6)), back = peak(win('O1', 'A1', s, 4.8, 5.6)), calm = peak(win('Fp1', 'A1', s, 1, 3));
  assert.ok(fore > 8e-5, `forehead ${fore}`); assert.ok(fore > calm * 3, 'well above the quiet baseline'); assert.ok(back < fore / 3, `back ${back}`);
});

test('looking right drives the right-eye electrode positive relative to the left, and left reverses it', () => {
  const right = sub({ gaze: { from: 'center', to: 'right', t0: 0 } }), left = sub({ gaze: { from: 'center', to: 'left', t0: 0 } });
  const r = siteSignal('EOG-R', 'EOG-L', 3, { effort: 0, subject: right }), l = siteSignal('EOG-R', 'EOG-L', 3, { effort: 0, subject: left });
  assert.ok(r > 3e-4 && l < -3e-4, `${r} ${l}`);
  const up = sub({ gaze: { from: 'center', to: 'up', t0: 0 } }); assert.ok(siteSignal('EOG-U', 'EOG-D', 3, { effort: 0, subject: up }) > 1e-4, 'up shows between above and below the eye');
});

test('jaw clench shows at the cheeks, much less at the forehead and the back of the head', () => {
  const s = sub({ events: [{ type: 'jaw', t0: 2 }] });
  const cheek = rms(win('EMG-ML', 'EMG-MR', s, 2.4, 3.6)), cheekVsRef = rms(win('EMG-ML', 'A1', s, 2.4, 3.6)), rest = rms(win('EMG-ML', 'A1', s, 0, 1)), back = rms(win('O1', 'A1', s, 2.4, 3.6));
  assert.ok(cheekVsRef > rest * 5, `${cheekVsRef} vs ${rest}`); assert.ok(cheekVsRef > back * 5); assert.ok(cheek >= 0);
});

test('a cheek twitch is one-sided, and brow raise shows on the forehead muscle', () => {
  const L = sub({ events: [{ type: 'twitchL', t0: 2 }] });
  const left = peak(win('EMG-ML', 'A1', L, 2, 2.4)), right = peak(win('EMG-MR', 'A1', L, 2, 2.4)); assert.ok(left > right * 3, `${left} ${right}`);
  const B = sub({ events: [{ type: 'brow', t0: 2 }] });
  assert.ok(rms(win('EMG-F', 'A1', B, 2.2, 3)) > rms(win('EMG-ML', 'A1', B, 2.2, 3)) * 3, 'forehead muscle, not the jaw');
});

test('focus lowers alpha at the back of the head and raises beta; drowsy adds slow theta', () => {
  const band = (s, hz) => { let re = 0, im = 0, n = 0; for (let t = 0; t < 4; t += 0.002) { const v = siteSignal('O1', 'A1', t, { effort: 0, subject: s }); re += v * Math.cos(2 * Math.PI * hz * t); im += v * Math.sin(2 * Math.PI * hz * t); n++; } return Math.hypot(re, im) / n; };
  const rel = sub({ mind: 'relaxed' }), foc = sub({ mind: 'focused' }), drw = sub({ mind: 'drowsy' });
  assert.ok(band(foc, 10) < band(rel, 10) * 0.6, 'alpha down when focused'); assert.ok(band(foc, 21) > band(rel, 21) * 1.5, 'beta up when focused');
  assert.ok(band(drw, 5.5) > band(rel, 5.5) * 3, 'theta when drowsy');
});
