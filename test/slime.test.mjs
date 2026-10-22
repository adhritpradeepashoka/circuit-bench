import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePartSpec, registerCustomPart } from '../src/core/custom-parts.js';
import { compile } from '../src/core/netlist.js';
import { solveDrive } from '../src/core/solver.js';
import { PART_DEFS } from '../src/core/parts.js';
import { coverage, slimePotentials } from '../src/core/slime.js';
import '../src/core/part-templates.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);

test('the organism covers its lobes and not the space around them', () => {
  assert.ok(coverage(0, 0) > 0.95 && coverage(-18, -12) > 0.9);
  assert.ok(coverage(60, 60) < 0.01 && coverage(0, 50) < 0.05);
});

test('covered pads oscillate with the wave and the stimulus; uncovered pads only carry a little noise; a pad further from the pacemaker lags', () => {
  const taps = [{ pads: [{ x: 0, y: 0 }] }, { pads: [{ x: 90, y: 90 }] }, { pads: [{ x: 15, y: 20 }] }];
  const peak = (k, p, secs = 240) => { let m = 0; for (let i = 0; i < secs * 10; i++) m = Math.max(m, Math.abs(slimePotentials(taps, p, i / 10)[k])); return m; };
  assert.ok(peak(0, { mamp: 3 }) > 1.5e-3, 'a covered pad swings by millivolts');
  assert.ok(peak(1, { mamp: 3 }) < 2e-4, 'an uncovered pad only sees electrode noise');
  assert.ok(peak(0, { mstim: 100 }) > 1.2 * peak(0, { mstim: 0 }) && peak(0, { mstim: -100 }) < 0.8 * peak(0, { mstim: 0 }), 'food strengthens it, a repellent weakens it');
  assert.ok(peak(0, { mamp: 0, mnoise: 0 }) === 0, 'no amplitude, no noise: silent');
  assert.deepEqual(slimePotentials(taps, {}, 12.5), slimePotentials(taps, {}, 12.5), 'deterministic');
  // two covered pads are the same rhythm at different phases (the wave travels): the signals correlate but are not equal
  const a = [], b = []; for (let i = 0; i < 2400; i++) { const v = slimePotentials([taps[0], taps[2]], { mnoise: 0 }, i / 10); a.push(v[0]); b.push(v[1]); }
  assert.ok(a.some((x, i) => Math.abs(x - b[i]) > 5e-4));
});

test('an organism laid over an imported board feeds the board’s electrode pins, and a BioAmp Pill reads the difference between two of them', () => {
  const v = validatePartSpec({
    id: 'custom-test-grid', name: 'Grid', package: 'board', breadboard: false,
    pins: [{ id: 'A', x: 5, y: 5 }, { id: 'B', x: 5, y: 15 }, { id: 'C', x: 5, y: 25 }],
    board: { w: 80, h: 80, shape: 'rect', cx: 40, cy: 40, r: 40, pads: [
      { x: 40, y: 40, w: 8, h: 8, shape: 'rect', hole: 0, pin: 'A', side: 'F' },      // under the organism's centre
      { x: 70, y: 70, w: 8, h: 8, shape: 'rect', hole: 0, pin: 'B', side: 'F' },      // far corner: uncovered
      { x: 5, y: 5, w: 1.7, h: 1.7, shape: 'rect', hole: 1, pin: 'A', side: 'F' },    // a header hole: ignored
    ], tracks: [] },
    behaviour: { kind: 'none', roles: {} },
  });
  assert.ok(v.ok, v.errors?.join('; ')); registerCustomPart(v.spec);
  const grid = { id: 'g', type: 'custom-test-grid', x: 0, y: 0, rot: 0 };
  const { w, h } = PART_DEFS['custom-test-grid'], m = PART_DEFS['custom-slime-mold'];
  assert.ok(m, 'the slime mold part is in the catalogue');
  const mold = { id: 'm', type: 'custom-slime-mold', x: w / 2 - m.w / 2, y: h / 2 - m.h / 2, rot: 0, mamp: 1, mnoise: 0 };
  const pill = { id: 'p', type: 'custom-bioamp-exg-pill', x: 600, y: 600, rot: 0 };
  const bat = { id: 'b', type: 'battery', x: 900, y: 0, rot: 0, volts: 5 };
  const W = (a, ap, b, bp) => ({ id: `${a}${ap}${b}${bp}`, a: { part: a, pin: ap }, b: { part: b, pin: bp }, style: 'straight', color: '#000', width: 2 });
  const c = compile({ parts: [{ id: 'uno', type: 'arduino-uno', x: 1500, y: 0, rot: 0 }, bat, grid, mold, pill],
    wires: [W('b', '+', 'p', 'VCC'), W('b', '-', 'p', 'GND'), W('b', '-', 'uno', 'GND.1'), W('g', 'A', 'p', 'IN+'), W('g', 'B', 'p', 'IN-'), W('m', 'REF', 'p', 'REF')] });
  const e = c.elements.find(x => x.kind === 'SLIME');
  assert.ok(e, 'the organism found the board under it');
  assert.deepEqual(e.taps.map(t => t.pin).sort(), ['A', 'B'], 'one tap per electrode net; the header hole is not an electrode');
  const t = 37, vs = slimePotentials(e.taps, mold, t);
  const r = solveDrive(c, { pins: new Map(), pressed: new Set(), duty: new Map(), signals: new Map([['m', vs]]) });
  near(r.voltage(c.netOf('p', 'OUT')), 2.5 + 1000 * (vs[0] - vs[1]), 0.08, 'the Pill amplifies A − B');
  assert.ok(Math.abs(vs[0] - vs[1]) > 3e-4, 'a covered pad against an uncovered one is a real signal');
});
