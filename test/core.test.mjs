import test from 'node:test';
import assert from 'node:assert/strict';
import { PART_DEFS, BREADBOARD } from '../src/core/parts.js';
import { pinWorld } from '../src/core/geometry.js';
import { findSnap, applySnap } from '../src/core/snap.js';
import { compile } from '../src/core/netlist.js';
import { solve, solveDrive } from '../src/core/solver.js';
import { toProjectFile, fromProjectFile, snapshot, restore } from '../src/core/project.js';
import { parseResistance, formatOhms, compactOhms, bandNames } from '../src/core/resistance.js';

const mk = (id, type, x = 0, y = 0, rot = 0) => ({ id, type, x, y, rot });
const wire = (id, a, b) => ({ id, a, b, style: 'straight', color: '#000', width: 3, bend: .5, sag: null });

/** Put `pinId` of `part` exactly on hole `holeId` of the board, then let findSnap refine it. */
function seat(state, part, pinId, board, holeId) {
  const h = pinWorld(board, holeId), p = pinWorld(part, pinId);
  part.x += h.x - p.x + 3; part.y += h.y - p.y - 2;     // start slightly off, like a human drop
  const s = findSnap(state.parts, part);
  assert.ok(s, `no snap for ${part.id}`);
  applySnap(part, s);
  return s;
}

function build() {
  const uno = mk('uno', 'arduino-uno', 30, 30);
  const bb = mk('bb', 'breadboard', 360, 60);
  const led = mk('led', 'led', 500, 300);
  const res = mk('res', 'resistor', 500, 400);
  const state = { parts: [uno, bb, led, res], wires: [] };
  return { state, uno, bb, led, res };
}

test('geometry: rotation is about the centre and pins follow', () => {
  const led = mk('l', 'led', 100, 100);
  const a0 = pinWorld(led, 'A');
  led.rot = 90;
  const a1 = pinWorld(led, 'A');
  const cx = 100 + 20, cy = 100 + 25;
  assert.ok(Math.abs(Math.hypot(a0.x - cx, a0.y - cy) - Math.hypot(a1.x - cx, a1.y - cy)) < 1e-9);
  led.rot = 360; const a2 = pinWorld(led, 'A');
  assert.ok(Math.abs(a2.x - a0.x) < 1e-9 && Math.abs(a2.y - a0.y) < 1e-9);
});

test('breadboard topology: A–E and F–J of a column are separate conductors; rails are continuous', () => {
  const { state, bb } = build();
  const c = compile(state);
  const n = id => c.netOf('bb', id);
  assert.equal(n('A7'), n('E7'));
  assert.equal(n('F7'), n('J7'));
  assert.notEqual(n('E7'), n('F7'));
  assert.notEqual(n('A7'), n('A8'));
  assert.equal(n('TP1'), n('TP25'));
  assert.notEqual(n('TP1'), n('TN1'));
  assert.notEqual(n('TP1'), n('BP1'));
  assert.equal(BREADBOARD.pins.length, 300 + 100);
});

test('snapping seats every lead of an LED and a resistor in real holes', () => {
  const { state, bb, led, res } = build();
  const s1 = seat(state, led, 'A', bb, 'E6');
  assert.equal(s1.aligned, 2);
  const s2 = seat(state, res, '1', bb, 'D5');
  assert.equal(s2.aligned, 2);
  const c = compile(state);
  assert.equal(c.attachments.size, 4);
  assert.equal(c.netOf('led', 'A'), c.netOf('bb', 'A6'));
  assert.equal(c.netOf('led', 'C'), c.netOf('bb', 'A5'));
  assert.equal(c.netOf('res', '1'), c.netOf('bb', 'A5'));
  assert.equal(c.netOf('res', '2'), c.netOf('bb', 'A11'));
});

test('snapping does not stack two leads into one hole', () => {
  const { state, bb, led, res } = build();
  seat(state, led, 'A', bb, 'E6');
  res.x = led.x; res.y = led.y;      // dropped right on top of the LED
  const s = findSnap(state.parts, res);
  if (s) { res.x += s.dx; res.y += s.dy; }
  const c = compile(state);
  const holesUsed = [...c.attachments.values()];
  assert.equal(new Set(holesUsed).size, holesUsed.length);
});

test('end to end: D13 → LED → resistor → GND lights the LED at ~12 mA', () => {
  const { state, bb, led, res } = build();
  seat(state, led, 'A', bb, 'E6');   // anode col 6, cathode col 5
  seat(state, res, '1', bb, 'D5');   // res lead1 col 5, lead2 col 11
  state.wires.push(wire('w1', { part: 'uno', pin: '13' }, { part: 'bb', pin: 'A6' }));
  state.wires.push(wire('w2', { part: 'bb', pin: 'A11' }, { part: 'uno', pin: 'GND.1' }));
  const c = compile(state);
  assert.equal(c.issues.length, 0);

  const high = solve(c, { pins: new Map([['13', 'H']]), pressed: new Set() });
  const i = high.ledCurrent.get('led');
  assert.ok(i > 0.011 && i < 0.014, `LED current ${i}`);
  assert.equal(high.warnings.length, 0);

  const low = solve(c, { pins: new Map([['13', 'L']]), pressed: new Set() });
  assert.equal(low.ledCurrent.get('led'), 0);
  const floating = solve(c, { pins: new Map(), pressed: new Set() });
  assert.equal(floating.ledCurrent.get('led'), 0);
});

test('wrong polarity does not light the LED', () => {
  const { state, bb, led, res } = build();
  seat(state, led, 'A', bb, 'E6');
  seat(state, res, '1', bb, 'D5');
  // feed the cathode side instead
  state.wires.push(wire('w1', { part: 'uno', pin: '13' }, { part: 'bb', pin: 'A11' }));
  state.wires.push(wire('w2', { part: 'bb', pin: 'A6' }, { part: 'uno', pin: 'GND.2' }));
  const r = solve(compile(state), { pins: new Map([['13', 'H']]), pressed: new Set() });
  assert.equal(r.ledCurrent.get('led'), 0);
});

test('LED straight across D13 and GND is flagged as overcurrent', () => {
  const { state, bb, led } = build();
  seat(state, led, 'A', bb, 'E6');
  state.wires.push(wire('w1', { part: 'uno', pin: '13' }, { part: 'bb', pin: 'A6' }));
  state.wires.push(wire('w2', { part: 'bb', pin: 'A5' }, { part: 'uno', pin: 'GND.1' }));
  const r = solve(compile(state), { pins: new Map([['13', 'H']]), pressed: new Set() });
  assert.ok(r.warnings.some(w => /40 mA/.test(w.text)));
  assert.ok(r.warnings.some(w => /LED is carrying \d+ mA/.test(w.text)), 'plain electrical fact: the LED current');
  assert.ok(!r.warnings.some(w => /resistor/i.test(w.text)), 'warnings state facts, they do not give advice (that is Diagnose, a later phase)');
});

test('5V straight to GND is reported as a short', () => {
  const { state, bb } = build();
  state.wires.push(wire('w1', { part: 'uno', pin: '5V' }, { part: 'bb', pin: 'TP3' }));
  state.wires.push(wire('w2', { part: 'bb', pin: 'TP20' }, { part: 'uno', pin: 'GND.2' }));
  const r = solve(compile(state), { pins: new Map(), pressed: new Set() });
  assert.match(r.warnings[0].text, /Short circuit/);
});

test('pushbutton straddling the trench switches an LED branch', () => {
  const { state, bb, led, res } = build();
  const btn = mk('btn', 'pushbutton', 480, 480, 90);
  state.parts.push(btn);
  // rotated: terminals 1.l/1.r are 7 pitches apart vertically → A..F row pair straddles the trench
  seat(state, btn, '1.l', bb, 'A20');
  const c0 = compile(state);
  assert.notEqual(c0.netOf('btn', '1.l'), c0.netOf('btn', '2.l'));
  assert.equal(c0.netOf('btn', '1.l'), c0.netOf('btn', '1.r'));
  // 5V → (button) → resistor → LED → GND
  seat(state, led, 'A', bb, 'H26'); seat(state, res, '1', bb, 'G13');
  const c = compile(state);
  assert.ok(c.attachments.size >= 8);
});

test('project export / import round-trips', () => {
  const { state, bb, led } = build();
  seat(state, led, 'A', bb, 'E6');
  state.wires.push(wire('w1', { part: 'uno', pin: '13' }, { part: 'bb', pin: 'A6' }));
  const file = JSON.parse(JSON.stringify(toProjectFile(state)));
  assert.ok(file.nets.some(n => n.pins.includes('uno|13') && n.pins.includes('led|A')));
  const back = fromProjectFile(file);
  assert.equal(back.parts.length, 4);
  assert.equal(back.wires.length, 1);
  const s2 = { parts: [], wires: [] }; restore(s2, snapshot({ parts: back.parts, wires: back.wires }));
  assert.equal(compile(s2).netOf('uno', '13'), compile(s2).netOf('led', 'A'));
  assert.throws(() => fromProjectFile({ nope: 1 }), /not a Virtual Lab/);
});

import { wireGeometry, paramFromHandle } from '../src/core/wirepath.js';
test('wire paths: handle drag round-trips into wire parameters', () => {
  const a = { x: 0, y: 0 }, b = { x: 100, y: 40 };
  const o = { style: 'orthogonal', bend: 0.5 };
  const g = wireGeometry(a, b, o);
  assert.equal(g.mid.x, 50);
  assert.deepEqual(paramFromHandle(a, b, o, { x: 25, y: 20 }), { bend: 0.25 });
  const c = { style: 'curve', sag: 20 };
  const gc = wireGeometry(a, b, c);
  assert.ok(Math.abs(paramFromHandle(a, b, c, gc.mid).sag - 20) < 1e-9);
  assert.match(wireGeometry(a, b, { style: 'straight' }).d, /^M0 0L100 40$/);
});

test('resistance parsing accepts what people type and keeps two significant digits', () => {
  const ok = (t, v) => { const r = parseResistance(t); assert.ok(r.ok, `${t}: ${r.error}`); assert.equal(r.ohms, v, t); return r; };
  ok('220', 220); ok('4.7k', 4700); ok('4k7', 4700); ok('10K', 10000); ok('1M', 1e6); ok('2.2 kΩ', 2200); ok('330 ohm', 330); ok('470R', 470); ok(' 1 MΩ ', 1e6); ok('0.5k', 500); ok('10M', 10e6); ok('1', 1);
  assert.equal(ok('1234', 1200).rounded, true);
  assert.equal(ok('220', 220).rounded, false);
  for (const bad of ['', 'abc', '0', '-5', '11M', '4..7k', '5 volts', '0.5']) assert.equal(parseResistance(bad).ok, false, `"${bad}" should be rejected`);
  assert.equal(formatOhms(220), '220 Ω'); assert.equal(formatOhms(4700), '4.7 kΩ'); assert.equal(formatOhms(1e6), '1 MΩ'); assert.equal(compactOhms(4700), '4.7k'); assert.equal(compactOhms(220), '220');
});

test('resistor colour code matches the standard 4-band chart', () => {
  assert.deepEqual(bandNames(220), ['red', 'red', 'brown', 'gold']);
  assert.deepEqual(bandNames(1000), ['brown', 'black', 'red', 'gold']);
  assert.deepEqual(bandNames(4700), ['yellow', 'violet', 'red', 'gold']);
  assert.deepEqual(bandNames(10000), ['brown', 'black', 'orange', 'gold']);
  assert.deepEqual(bandNames(47), ['yellow', 'violet', 'black', 'gold']);
  assert.deepEqual(bandNames(4.7 * 1), ['yellow', 'violet', 'gold', 'gold']);
  assert.deepEqual(bandNames(1e6), ['brown', 'black', 'green', 'gold']);
  assert.deepEqual(bandNames(10e6), ['brown', 'black', 'blue', 'gold']);
});

test('resistor value changes the circuit: LED current follows R, tiny R triggers the overcurrent warning', () => {
  const { state, bb, led, res } = build();
  seat(state, led, 'A', bb, 'E6'); seat(state, res, '1', bb, 'D5');
  state.wires.push(wire('w1', { part: 'uno', pin: '13' }, { part: 'bb', pin: 'A6' }));
  state.wires.push(wire('w2', { part: 'bb', pin: 'A11' }, { part: 'uno', pin: 'GND.1' }));
  const run = ohms => { res.ohms = ohms; const c = compile(state); return solve(c, { pins: new Map([['13', 'H']]), pressed: new Set() }); };
  const i220 = run(220).ledCurrent.get('led'), i1k = run(1000).ledCurrent.get('led'), i47k = run(47000).ledCurrent.get('led');
  assert.ok(i220 > 0.011 && i220 < 0.014, `220 Ω → ${i220}`);
  assert.ok(i1k > 0.0025 && i1k < 0.0035, `1 kΩ → ${i1k}`);
  assert.ok(i47k > 0 && i47k < 0.0001, `47 kΩ → ${i47k}`);
  assert.ok(i220 > i1k && i1k > i47k);
  assert.ok(run(1).warnings.length > 0, '1 Ω with an LED must warn');
});

test('resistor value survives undo snapshots and project export / import', () => {
  const { state, res } = build();
  res.ohms = 4700;
  const snap = snapshot(state); res.ohms = 100;
  restore(state, snap);
  assert.equal(state.parts.find(p => p.id === 'res').ohms, 4700);
  const file = JSON.parse(JSON.stringify(toProjectFile(state)));
  assert.equal(file.parts.find(p => p.id === 'res').ohms, 4700);
  assert.equal(fromProjectFile(file).parts.find(p => p.id === 'res').ohms, 4700);
  const old = JSON.parse(JSON.stringify(file)); delete old.parts.find(p => p.id === 'res').ohms;
  assert.equal(fromProjectFile(old).parts.find(p => p.id === 'res').ohms, 220, 'older files fall back to 220 Ω');
  assert.equal(fromProjectFile(file).parts.find(p => p.id === 'uno').ohms, undefined);
});

/* ───────────── catalogue batch 1: LED colours, RGB LED, slide switch, 7-segment, PIR ───────────── */
const W = (id, a, b) => wire(id, a, b);
const at = (part, pin) => ({ part, pin });
const drive = (pins, pressed = []) => ({ pins: new Map(Object.entries(pins)), pressed: new Set(pressed) });

test('new parts seat every lead in real holes (RGB LED, slide switch, PIR, 7-segment straddling the trench)', () => {
  const uno = mk('uno', 'arduino-uno', 30, 30), bb = mk('bb', 'breadboard', 360, 60);
  const state = { parts: [uno, bb], wires: [] };
  const rgb = mk('rgb', 'rgb-led', 500, 300), sw = mk('sw', 'slide-switch', 500, 400), pir = mk('pir', 'pir-sensor', 600, 400), seg = mk('seg', 'seven-segment', 700, 300);
  state.parts.push(rgb, sw, pir, seg);
  seat(state, rgb, 'R', bb, 'B4'); seat(state, sw, '1', bb, 'E10'); seat(state, pir, 'VCC', bb, 'E16'); seat(state, seg, 'G', bb, 'A21');
  const c = compile(state);
  for (const [p, n] of [[rgb, 4], [sw, 3], [pir, 3], [seg, 10]]) {
    const seated = PART_DEFS[p.type].pins.filter(pin => c.attachments.has(`${p.id}|${pin.id}`));
    assert.equal(seated.length, n, `${p.type}: ${seated.length}/${n} leads seated`);
  }
  // 7-segment: the top row (G F COM A B) and bottom row (E D COM C DP) land in different strips → segments are independent
  assert.notEqual(c.netOf('seg', 'A'), c.netOf('seg', 'C'));
  assert.equal(c.netOf('seg', 'COM.1'), c.netOf('seg', 'COM.2'), 'the two COM pins are one conductor inside the part');
  assert.equal(c.issues.length, 0);
});

test('LED colour sets forward voltage: blue draws less current than red from the same drive, and needs ~3 V to light', () => {
  const uno = mk('uno', 'arduino-uno'), res = { ...mk('r', 'resistor'), ohms: 220 }, led = { ...mk('l', 'led'), color: 'red' };
  const state = { parts: [uno, res, led], wires: [W('a', at('uno', '13'), at('r', '1')), W('b', at('r', '2'), at('l', 'A')), W('c', at('l', 'C'), at('uno', 'GND.1'))] };
  const i = color => { led.color = color; return solve(compile(state), drive({ 13: 'H' })).ledCurrent.get('l'); };
  const red = i('red'), green = i('green'), blue = i('blue'), white = i('white');
  assert.ok(red > 0.011 && red < 0.014, `red ${red}`);
  assert.ok(blue > 0.006 && blue < 0.009, `blue ${blue}`);
  assert.ok(red > green && green > blue, 'higher Vf → less current');
  assert.ok(white > 0.006 && white < 0.009);
  // 3.3 V through 220 Ω barely lights a blue LED (and the sim says so: far less current than red)
  const s2 = { parts: [uno, res, led], wires: [W('a', at('uno', '3.3V'), at('r', '1')), W('b', at('r', '2'), at('l', 'A')), W('c', at('l', 'C'), at('uno', 'GND.1'))] };
  led.color = 'blue'; const b33 = solve(compile(s2), drive({})).ledCurrent.get('l');
  led.color = 'red'; const r33 = solve(compile(s2), drive({})).ledCurrent.get('l');
  assert.ok(b33 < 0.002 && r33 > 0.005, `3.3 V: blue ${b33}, red ${r33}`);
});

test('RGB LED: each colour lights only when its own pin is driven (common cathode to GND)', () => {
  const uno = mk('uno', 'arduino-uno'), rgb = mk('rgb', 'rgb-led');
  const parts = [uno, rgb], wires = [W('gnd', at('rgb', 'COM'), at('uno', 'GND.1'))];
  for (const [pin, ch] of [['9', 'R'], ['10', 'G'], ['11', 'B']]) { const r = { ...mk(`r${ch}`, 'resistor'), ohms: 220 }; parts.push(r); wires.push(W(`a${ch}`, at('uno', pin), at(r.id, '1')), W(`b${ch}`, at(r.id, '2'), at('rgb', ch))); }
  const c = compile({ parts, wires });
  const lit = pins => { const s = solve(c, drive(pins)); return ['R', 'G', 'B'].map(ch => s.ledCurrent.get(`rgb:${ch}`) > 1e-4); };
  assert.deepEqual(lit({ 9: 'H' }), [true, false, false]);
  assert.deepEqual(lit({ 10: 'H' }), [false, true, false]);
  assert.deepEqual(lit({ 9: 'H', 11: 'H' }), [true, false, true]);
  assert.deepEqual(lit({}), [false, false, false]);
  const s = solve(c, drive({ 9: 'H', 10: 'H', 11: 'H' }));
  assert.ok(s.ledCurrent.get('rgb:R') > s.ledCurrent.get('rgb:B'), 'red (Vf 2.0) draws more than blue (Vf 3.0)');
});

test('slide switch joins the common pin to throw 1 or throw 3', () => {
  const uno = mk('uno', 'arduino-uno'), sw = { ...mk('sw', 'slide-switch'), pos: 0 }, res = { ...mk('r', 'resistor'), ohms: 220 }, l1 = mk('l1', 'led'), l3 = mk('l3', 'led');
  const state = { parts: [uno, sw, res, l1, l3], wires: [
    W('p', at('uno', '13'), at('sw', '2')),
    W('t1', at('sw', '1'), at('r', '1')), W('t3', at('sw', '3'), at('l3', 'A')),
    W('r2', at('r', '2'), at('l1', 'A')), W('g1', at('l1', 'C'), at('uno', 'GND.1')), W('g3', at('l3', 'C'), at('uno', 'GND.1'))] };
  const both = () => { const s = solve(compile(state), drive({ 13: 'H' })); return [s.ledCurrent.get('l1') > 1e-4, s.ledCurrent.get('l3') > 1e-4]; };
  assert.deepEqual(both(), [true, false]);
  sw.pos = 1;
  assert.deepEqual(both(), [false, true]);
});

test('7-segment: lit segments follow the driven pins (digit 3 = A B C D G)', () => {
  const uno = mk('uno', 'arduino-uno'), seg = mk('seg', 'seven-segment');
  const wires = [W('com', at('seg', 'COM.1'), at('uno', 'GND.1'))];
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'].forEach((s, i) => wires.push(W(`w${s}`, at('uno', String(2 + i)), at('seg', s))));
  const c = compile({ parts: [uno, seg], wires });
  const digit3 = { 2: 'H', 3: 'H', 4: 'H', 5: 'H', 6: 'L', 7: 'L', 8: 'H', 9: 'L' };
  const s = solve(c, drive(digit3));
  const lit = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'].map(k => (s.ledCurrent.get(`seg:${k}`) > 1e-4 ? 1 : 0));
  assert.deepEqual(lit, [1, 1, 1, 1, 0, 0, 1, 0]);
  assert.ok(s.warnings.length > 0, 'driving segments without resistors is flagged');
});

test('PIR sensor: needs power, then OUT follows the trigger', () => {
  const uno = mk('uno', 'arduino-uno'), pir = mk('pir', 'pir-sensor');
  const state = { parts: [uno, pir], wires: [W('v', at('uno', '5V'), at('pir', 'VCC')), W('g', at('uno', 'GND.1'), at('pir', 'GND')), W('o', at('pir', 'OUT'), at('uno', '2'))] };
  const c = compile(state), out = c.uno.pins.find(p => p.name === '2').net;
  assert.ok(Math.abs(solve(c, drive({ 2: 'Z' }, ['pir'])).voltage(out) - 3.3) < 0.1, 'triggered → ~3.3 V');
  assert.ok(solve(c, drive({ 2: 'Z' }, [])).voltage(out) < 0.2, 'idle → low');
  // unpowered: no VCC wire
  const c2 = compile({ parts: [uno, pir], wires: [W('g', at('uno', 'GND.1'), at('pir', 'GND')), W('o', at('pir', 'OUT'), at('uno', '2'))] });
  const s2 = solve(c2, drive({ 2: 'Z' }, ['pir']));
  assert.ok(s2.voltage(c2.uno.pins.find(p => p.name === '2').net) < 0.2, 'no power → OUT stays dead even when triggered');
  assert.ok(s2.warnings.some(w => /PIR sensor has no supply/.test(w.text)));
  // powered from a pin driven HIGH also works (5 V − 25 Ω drop is still ≥ 4.5 V at ~µA load)
  const c3 = compile({ parts: [uno, pir], wires: [W('v', at('uno', '8'), at('pir', 'VCC')), W('g', at('uno', 'GND.1'), at('pir', 'GND')), W('o', at('pir', 'OUT'), at('uno', '2'))] });
  assert.ok(solve(c3, drive({ 8: 'H', 2: 'Z' }, ['pir'])).voltage(c3.uno.pins.find(p => p.name === '2').net) > 3);
});

test('LED colour and switch position survive undo snapshots and project files', () => {
  const led = { ...mk('led', 'led'), color: 'blue' }, sw = { ...mk('sw', 'slide-switch'), pos: 1 };
  const state = { parts: [mk('uno', 'arduino-uno'), led, sw], wires: [] };
  const snap = snapshot(state); led.color = 'red'; sw.pos = 0;
  restore(state, snap);
  assert.equal(state.parts.find(p => p.id === 'led').color, 'blue'); assert.equal(state.parts.find(p => p.id === 'sw').pos, 1);
  const file = JSON.parse(JSON.stringify(toProjectFile(state)));
  const back = fromProjectFile(file);
  assert.equal(back.parts.find(p => p.id === 'led').color, 'blue'); assert.equal(back.parts.find(p => p.id === 'sw').pos, 1);
  delete file.parts.find(p => p.id === 'led').color; file.parts.find(p => p.id === 'sw').pos = 'garbage';
  const old = fromProjectFile(file);
  assert.equal(old.parts.find(p => p.id === 'led').color, 'red', 'missing colour → red');
  assert.equal(old.parts.find(p => p.id === 'sw').pos, 0, 'junk falls back to position 0');
  file.parts.find(p => p.id === 'led').color = 'plaid';
  assert.equal(fromProjectFile(file).parts.find(p => p.id === 'led').color, 'red', 'unknown colour → red');
});

/* ───────────── analog parts: potentiometer, LDR module, NTC sensor, PWM averaging ───────────── */
const a0 = (c, name = 'A0') => c.uno.pins.find(p => p.name === name).net;

test('potentiometer is a real 10 kΩ divider: SIG = VCC × position, and it loads what it drives', () => {
  const uno = mk('uno', 'arduino-uno'), pot = { ...mk('pot', 'potentiometer'), level: 0 };
  const state = { parts: [uno, pot], wires: [W('v', at('uno', '5V'), at('pot', 'VCC')), W('g', at('uno', 'GND.1'), at('pot', 'GND')), W('s', at('pot', 'SIG'), at('uno', 'A0'))] };
  const volts = level => { pot.level = level; const c = compile(state); return solve(c, drive({})).voltage(a0(c)); };
  assert.ok(volts(0) < 0.01); assert.ok(Math.abs(volts(25) - 1.25) < 0.02); assert.ok(Math.abs(volts(50) - 2.5) < 0.02);
  assert.ok(Math.abs(volts(75) - 3.75) < 0.02); assert.ok(volts(100) > 4.99);
  // wired as a plain resistor (SIG unconnected → only the GND–VCC ends matter): 5 V across 10 kΩ = 0.5 mA, no warnings
  const c = compile(state); assert.equal(solve(c, drive({})).warnings.length, 0);
});

test('LDR module follows Wokwi’s conventions: AO falls as light rises, DO is HIGH in the dark', () => {
  const uno = mk('uno', 'arduino-uno'), ldr = { ...mk('ldr', 'ldr-module'), lux: 500 };
  const state = { parts: [uno, ldr], wires: [W('v', at('uno', '5V'), at('ldr', 'VCC')), W('g', at('uno', 'GND.1'), at('ldr', 'GND')), W('a', at('ldr', 'AO'), at('uno', 'A0')), W('d', at('ldr', 'DO'), at('uno', '2'))] };
  const read = lux => { ldr.lux = lux; const c = compile(state), s = solve(c, drive({ 2: 'Z' })); return { ao: s.voltage(a0(c)), dout: s.voltage(c.uno.pins.find(p => p.name === '2').net), mod: s.modules.get('ldr') }; };
  const bright = read(50000), office = read(500), dark = read(1);
  assert.ok(bright.ao < office.ao && office.ao < dark.ao, 'AO falls as light rises');
  assert.ok(dark.dout > 4.5 && dark.mod.out, 'dark → DO HIGH');
  assert.ok(bright.dout < 0.3 && !bright.mod.out, 'bright → DO LOW');
  assert.ok(read(80).dout > 4 && read(120).dout < 0.5, 'threshold ≈ 100 lux');
  // round trip through Wokwi's own published lux formula (from their LDR example sketch)
  for (const lux of [5, 50, 500, 5000, 50000]) {
    const adc = Math.floor(read(lux).ao / 5 * 1024), v = adc / 1024 * 5, res = 2000 * v / (1 - v / 5);
    const back = Math.pow(50 * 1e3 * Math.pow(10, 0.7) / res, 1 / 0.7);
    assert.ok(Math.abs(back - lux) / lux < 0.05, `lux ${lux} → ADC ${adc} → ${back.toFixed(1)}`);
  }
  // unpowered module: DO stays off
  const c2 = compile({ parts: [uno, ldr], wires: [W('g', at('uno', 'GND.1'), at('ldr', 'GND')), W('d', at('ldr', 'DO'), at('uno', '2'))] });
  assert.ok(solve(c2, drive({ 2: 'Z' })).voltage(c2.uno.pins.find(p => p.name === '2').net) < 0.2);
});

test('NTC module matches Wokwi’s Steinhart–Hart example: OUT falls as it gets hotter', () => {
  const uno = mk('uno', 'arduino-uno'), ntc = { ...mk('ntc', 'ntc-sensor'), temp: 25 };
  const state = { parts: [uno, ntc], wires: [W('v', at('uno', '5V'), at('ntc', 'VCC')), W('g', at('uno', 'GND.1'), at('ntc', 'GND')), W('o', at('ntc', 'OUT'), at('uno', 'A0'))] };
  const adcAt = t => { ntc.temp = t; const c = compile(state); return Math.floor(solve(c, drive({})).voltage(a0(c)) / 5 * 1023); };
  assert.ok(Math.abs(adcAt(25) - 512) <= 2, `25 °C ≈ half scale, got ${adcAt(25)}`);
  assert.ok(adcAt(-10) > adcAt(0) && adcAt(0) > adcAt(25) && adcAt(25) > adcAt(60) && adcAt(60) > adcAt(80));
  const BETA = 3950;   // Wokwi's example: celsius = 1 / (log(1 / (1023. / a - 1)) / BETA + 1 / 298.15) - 273.15
  for (const t of [-20, 0, 25, 50, 75]) { const a = adcAt(t), back = 1 / (Math.log(1 / (1023 / a - 1)) / BETA + 1 / 298.15) - 273.15; assert.ok(Math.abs(back - t) < 1.5, `${t} °C → ADC ${a} → ${back.toFixed(1)} °C`); }
});

test('PWM: an LED on a PWM pin gets duty × the current of a steady HIGH (average model)', () => {
  const uno = mk('uno', 'arduino-uno'), res = { ...mk('r', 'resistor'), ohms: 220 }, led = mk('l', 'led');
  const c = compile({ parts: [uno, res, led], wires: [W('a', at('uno', '9'), at('r', '1')), W('b', at('r', '2'), at('l', 'A')), W('c', at('l', 'C'), at('uno', 'GND.1'))] });
  const full = solveDrive(c, { pins: new Map([['9', 'H']]), pressed: new Set() }).ledCurrent.get('l');
  for (const d of [0.1, 0.25, 0.5, 0.9]) {
    const i = solveDrive(c, { pins: new Map([['9', 'P']]), duty: new Map([['9', d]]), pressed: new Set() }).ledCurrent.get('l');
    assert.ok(Math.abs(i - d * full) < 1e-9, `duty ${d}: ${i} vs ${d * full}`);
  }
  assert.equal(solveDrive(c, { pins: new Map([['9', 'P']]), duty: new Map([['9', 0.001]]), pressed: new Set() }).ledCurrent.get('l'), 0, 'near-zero duty = steadily off');
  // three PWM pins (RGB) expand exactly
  const rgb = mk('rgb', 'rgb-led'), parts = [uno, rgb], wires = [W('g', at('rgb', 'COM'), at('uno', 'GND.1'))];
  for (const [pin, ch] of [['9', 'R'], ['10', 'G'], ['11', 'B']]) { const r = { ...mk(`r${ch}`, 'resistor'), ohms: 220 }; parts.push(r); wires.push(W(`a${ch}`, at('uno', pin), at(r.id, '1')), W(`b${ch}`, at(r.id, '2'), at('rgb', ch))); }
  const c2 = compile({ parts, wires });
  const s = solveDrive(c2, { pins: new Map([['9', 'P'], ['10', 'P'], ['11', 'P']]), duty: new Map([['9', 0.5], ['10', 0.25], ['11', 1]]), pressed: new Set() });
  const r = s.ledCurrent.get('rgb:R'), g = s.ledCurrent.get('rgb:G'), bl = s.ledCurrent.get('rgb:B');
  assert.ok(r > 0 && g > 0 && bl > 0);
  const gFull = solveDrive(c2, { pins: new Map([['10', 'H']]), pressed: new Set() }).ledCurrent.get('rgb:G');
  assert.ok(Math.abs(g - 0.25 * gFull) / gFull < 0.05, `green at 25 %: ${g} vs ${0.25 * gFull}`);
});

test('analog part values persist (undo snapshots + project files) and are clamped', () => {
  const state = { parts: [mk('uno', 'arduino-uno'), { ...mk('pot', 'potentiometer'), level: 80 }, { ...mk('ldr', 'ldr-module'), lux: 12.5 }, { ...mk('ntc', 'ntc-sensor'), temp: -7 }], wires: [] };
  const back = fromProjectFile(JSON.parse(JSON.stringify(toProjectFile(state))));
  assert.deepEqual([back.parts[1].level, back.parts[2].lux, back.parts[3].temp], [80, 12.5, -7]);
  const s2 = { parts: [], wires: [] }; restore(s2, snapshot(state));
  assert.deepEqual([s2.parts[1].level, s2.parts[2].lux, s2.parts[3].temp], [80, 12.5, -7]);
  const file = JSON.parse(JSON.stringify(toProjectFile(state)));
  file.parts[1].level = 900; file.parts[2].lux = -5; file.parts[3].temp = 'hot';
  const bad = fromProjectFile(file);
  assert.deepEqual([bad.parts[1].level, bad.parts[2].lux, bad.parts[3].temp], [100, 0.1, 25], 'clamped / defaulted');
});

test('new analog parts seat their leads (potentiometer on the board; sensor modules when rotated)', () => {
  const uno = mk('uno', 'arduino-uno'), bb = mk('bb', 'breadboard', 360, 60);
  const pot = mk('pot', 'potentiometer', 500, 300), ntc = mk('ntc', 'ntc-sensor', 600, 300, 90);
  const state = { parts: [uno, bb, pot, ntc], wires: [] };
  seat(state, pot, 'GND', bb, 'E5'); seat(state, ntc, 'GND', bb, 'E15');
  const c = compile(state);
  assert.equal(PART_DEFS.potentiometer.pins.filter(p => c.attachments.has(`pot|${p.id}`)).length, 3);
  assert.equal(PART_DEFS['ntc-sensor'].pins.filter(p => c.attachments.has(`ntc|${p.id}`)).length, 3);
  assert.equal(new Set(['GND', 'VCC', 'OUT'].map(p => c.netOf('ntc', p))).size, 3, 'rotated module leads land in three different strips');
});

/* ───────────── electrical realism + fact-only diagnostics ───────────── */
const boardWith = (extra = []) => ({ uno: mk('uno', 'arduino-uno', 30, 30), bb: mk('bb', 'breadboard', 360, 60), extra });

test('regression (user report): a correctly built series LED + 220 Ω is silent — no warnings, no issues, no open leads', () => {
  for (const [label, wires, pins] of [
    ['5V supply', [wire('a', { part: 'uno', pin: '5V' }, { part: 'bb', pin: 'A6' }), wire('b', { part: 'bb', pin: 'A11' }, { part: 'uno', pin: 'GND.1' })], {}],
    ['D13 driven HIGH', [wire('a', { part: 'uno', pin: '13' }, { part: 'bb', pin: 'A6' }), wire('b', { part: 'bb', pin: 'A11' }, { part: 'uno', pin: 'GND.1' })], { 13: 'H' }],
    ['3.3V supply', [wire('a', { part: 'uno', pin: '3.3V' }, { part: 'bb', pin: 'A6' }), wire('b', { part: 'bb', pin: 'A11' }, { part: 'uno', pin: 'GND.1' })], {}],
  ]) {
    const { state, bb, led, res } = build();
    seat(state, led, 'A', bb, 'E6'); seat(state, res, '1', bb, 'D5'); state.wires.push(...wires);
    const c = compile(state), r = solveDrive(c, { pins: new Map(Object.entries(pins)), pressed: new Set() });
    assert.deepEqual(r.warnings, [], `${label}: warnings`); assert.deepEqual(c.issues, [], `${label}: issues`); assert.deepEqual(c.openLeads, [], `${label}: open leads`);
    assert.ok(r.ledCurrent.get('led') > 0.004 && r.ledCurrent.get('led') < 0.02, `${label}: ${r.ledCurrent.get('led')}`);
  }
});

test('regression (user report): LED straddling the + and − rails with the resistor connected at one end only', () => {
  const { state, bb, led, res } = build();
  led.rot = 90;
  state.wires.push(wire('r', { part: 'uno', pin: '5V' }, { part: 'bb', pin: 'BP3' }), wire('k', { part: 'uno', pin: 'GND.1' }, { part: 'bb', pin: 'BN3' }));
  seat(state, led, 'A', bb, 'BP20');
  state.wires.push(wire('rw', { part: 'uno', pin: '5V' }, { part: 'res', pin: '1' }));               // resistor: one lead on the + supply, the other lead nowhere
  const c = compile(state), r = solve(c, { pins: new Map(), pressed: new Set() });
  assert.equal(c.attachments.get('led|A').startsWith('bb|BP'), true); assert.equal(c.attachments.get('led|C').startsWith('bb|BN'), true, 'the LED really is across the two rails');
  assert.equal(c.attachments.has('res|2'), false, 'the resistor’s second lead is in no hole');
  // the resistor is not in the LED's path
  assert.deepEqual(c.openLeads.map(o => [o.partId, o.pin]), [['res', '2']]);
  assert.match(c.openLeads[0].text, /Resistor 220 Ω: lead 2 is not connected to anything, so no current flows through it/);
  // the LED carries a real-LED-sized fault current (≈ (5 − 1.9) / (15 Ω + 0.5 Ω)), not the 600 mA an over-stiff model gave
  const i = r.ledCurrent.get('led');
  assert.ok(i > 0.15 && i < 0.25, `LED current ${i}`);
  const led_w = r.warnings.find(w => w.partId === 'led');
  assert.match(led_w.text, /carrying \d+ mA/); assert.match(led_w.text, /anode is connected directly to 5V and its cathode directly to GND/);
  assert.ok(!r.warnings.some(w => /short circuit/i.test(w.text)), 'an LED path is not called a short circuit');
  assert.ok(!r.warnings.some(w => /resistor|add a|wire its|should|needs/i.test(w.text)), 'facts only — no advice');
});

test('supplies are not ideal: 5V (USB, 500 mA) and 3.3V (regulator, 150 mA) report what they deliver and their limits; a dead short is a short', () => {
  const load = (pin, ohms) => {
    const { state, res } = build(); res.ohms = ohms;
    state.wires.push(wire('a', { part: 'uno', pin }, { part: 'res', pin: '1' }), wire('b', { part: 'res', pin: '2' }, { part: 'uno', pin: 'GND.1' }));
    const c = compile(state); return solve(c, { pins: new Map(), pressed: new Set() });
  };
  assert.deepEqual(load('5V', 1000).warnings, [], '5 mA is nothing');
  assert.deepEqual(load('5V', 220).warnings, [], '23 mA is fine');
  const usb = load('5V', 8).warnings;
  assert.equal(usb.length, 1); assert.match(usb[0].text, /^5V is delivering 5\d\d mA \(supply limit 500 mA\)$/);
  const ldo = load('3.3V', 10).warnings;
  assert.equal(ldo.length, 1); assert.match(ldo[0].text, /^3\.3V is delivering \d+ mA \(supply limit 150 mA\)$/);
  assert.deepEqual(load('3.3V', 100).warnings, [], '33 mA from 3.3V is fine');
  // 1 Ω across 5V: ~3.3 A — a short by any reasonable definition
  const dead = load('5V', 1).warnings;
  assert.match(dead[0].text, /^Short circuit: 5V is connected to GND through about [0-9.]+ Ω/);
  assert.doesNotMatch(load('5V', 8).warnings.map(w => w.text).join(), /Short circuit/, '8 Ω across 5V is an overload, not a short');
  // the supply sags a little under load (0.5 Ω output resistance)
  const { state, res } = build(); res.ohms = 10;
  state.wires.push(wire('a', { part: 'uno', pin: '5V' }, { part: 'res', pin: '1' }), wire('b', { part: 'res', pin: '2' }, { part: 'uno', pin: 'GND.1' }));
  const c = compile(state), r = solve(c, { pins: new Map(), pressed: new Set() });
  const v5 = r.voltage(c.netOf('res', '1'));
  assert.ok(v5 > 4.6 && v5 < 4.9, `5V pin under a 10 Ω load: ${v5} V`);
});

test('LED colours have their own knee AND slope: blue/white are stiffer (25 Ω) than red (15 Ω)', () => {
  const via = (color, ohms) => {
    const { state, bb, led, res } = build(); led.color = color; res.ohms = ohms;
    seat(state, led, 'A', bb, 'E6'); seat(state, res, '1', bb, 'D5');
    state.wires.push(wire('a', { part: 'uno', pin: '5V' }, { part: 'bb', pin: 'A6' }), wire('b', { part: 'bb', pin: 'A11' }, { part: 'uno', pin: 'GND.1' }));
    return solve(compile(state), { pins: new Map(), pressed: new Set() }).ledCurrent.get('led');
  };
  assert.ok(Math.abs(via('red', 220) - 3.1 / 235.5) < 1e-4, `red: ${via('red', 220)}`);
  assert.ok(Math.abs(via('blue', 220) - 1.9 / 245.5) < 1e-4, `blue: ${via('blue', 220)}`);
  assert.ok(Math.abs(via('red', 1) - 3.1 / 16.5) < 1e-3, 'a 1 Ω “resistor”: limited by the LED’s own resistance and the supply, ~190 mA (a real LED would be destroyed)');
});

test('open leads: a lead is "open" only if nothing but breadboard holes touch it', () => {
  const { state, bb, led, res } = build();
  seat(state, led, 'A', bb, 'E6'); seat(state, res, '1', bb, 'D5');
  // LED cathode and resistor lead 1 share strip 5, so each is connected to the other's pin; LED anode (strip 6) and resistor lead 2 (strip 11) touch nothing
  assert.deepEqual(compile(state).openLeads.map(o => `${o.partId}.${o.pin}`).sort(), ['led.A', 'res.2']);
  state.wires.push(wire('a', { part: 'uno', pin: '13' }, { part: 'bb', pin: 'A6' }));            // LED anode strip now has a source on it
  assert.deepEqual(compile(state).openLeads.map(o => `${o.partId}.${o.pin}`), ['res.2']);
  state.wires.push(wire('b', { part: 'bb', pin: 'A11' }, { part: 'uno', pin: 'GND.1' }));        // the resistor's far strip goes to GND
  assert.deepEqual(compile(state).openLeads.map(o => `${o.partId}.${o.pin}`), [], 'a closed series loop has no open leads');
  // an unplaced part off the board with no wires
  const { state: s2 } = build(); assert.equal(compile(s2).openLeads.length, 4, 'parts floating off the board with no wires: every lead is open');
});

/* ───────────── flexible resistor: fits exactly between any two holes ───────────── */
import { partSize, localPins, placeFlex, allPinsWorld } from '../src/core/geometry.js';
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const leadsOf = r => allPinsWorld(r).map(p => ({ x: p.x, y: p.y }));

test('flexible resistor: pins sit exactly `len` apart at any angle; the box follows the lead spacing', () => {
  const r = mk('r', 'resistor', 100, 100); r.len = 57.6;
  assert.deepEqual(partSize(r), { w: 57.6, h: PART_DEFS.resistor.h });
  for (const rot of [0, 33, 90, 180, 270, 359]) {
    r.rot = rot; const [a, b] = leadsOf(r);
    assert.ok(near(Math.hypot(b.x - a.x, b.y - a.y), 57.6), `rot ${rot}`);
  }
  r.len = 100; r.rot = 0; const [a, b] = leadsOf(r); assert.ok(near(b.x - a.x, 100));
  r.len = 10; assert.equal(partSize(r).w, PART_DEFS.resistor.minLen, 'never shorter than the 4-pitch body');
  assert.equal(localPins(mk('u', 'arduino-uno')).length, PART_DEFS['arduino-uno'].pins.length, 'rigid parts are unchanged');
});

test('placeFlex: lead 1 and lead 2 land exactly on the two requested points, however far apart or tilted', () => {
  const r = mk('r', 'resistor');
  for (const [p1, p2] of [[{ x: 10, y: 10 }, { x: 40, y: 50 }], [{ x: 500.25, y: 300.5 }, { x: 500.25, y: 358.1 }], [{ x: 0, y: 0 }, { x: -80, y: 3 }], [{ x: 200, y: 200 }, { x: 201.4, y: 199 }]]) {
    placeFlex(r, p1, p2);
    const [a, b] = leadsOf(r), want = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (want >= PART_DEFS.resistor.minLen) { assert.ok(near(a.x, p1.x, 1e-9) && near(a.y, p1.y, 1e-9) && near(b.x, p2.x, 1e-9) && near(b.y, p2.y, 1e-9), JSON.stringify([p1, p2])); assert.ok(near(r.len, want)); }
    else { assert.ok(near(a.x, p1.x) && near(a.y, p1.y), 'lead 1 stays put'); assert.ok(near(r.len, PART_DEFS.resistor.minLen), 'too-close points stretch to the body length'); }
  }
});

test('snapping: both leads land dead-centre in their holes — same row, rail-to-row, and diagonal', () => {
  const holeXY = (bb, id) => pinWorld(bb, id);
  const drop = (from, to) => {
    const { state, bb, res } = build();
    const a = holeXY(bb, from), b = holeXY(bb, to);
    placeFlex(res, { x: a.x + 3.1, y: a.y - 2.4 }, { x: b.x - 2.2, y: b.y + 3.3 });       // dropped a few pixels off, like a human
    const s = findSnap(state.parts, res); assert.ok(s, `${from}→${to}: no snap`); applySnap(res, s);
    const [p1, p2] = leadsOf(res);
    assert.ok(near(p1.x, a.x, 1e-6) && near(p1.y, a.y, 1e-6), `${from}: lead 1 on hole`);
    assert.ok(near(p2.x, b.x, 1e-6) && near(p2.y, b.y, 1e-6), `${to}: lead 2 on hole`);
    const c = compile(state);
    assert.equal(c.attachments.get('res|1'), `bb|${from}`); assert.equal(c.attachments.get('res|2'), `bb|${to}`);
    return res;
  };
  const same = drop('D5', 'D11'); assert.ok(near(same.len, 57.6), '6 pitches = the old rigid spacing, now exact');
  const wide = drop('D5', 'D17'); assert.ok(near(wide.len, 115.2), '12 pitches');
  const short = drop('D5', 'D9'); assert.ok(near(short.len, 38.4), '4 pitches = the shortest a body allows');
  const railToRow = drop('BP11', 'J11'); assert.ok(railToRow.len > 20 && railToRow.len < 60, `rail→row spans ${railToRow.len.toFixed(2)} px (a fixed 6-pitch resistor could never do this)`);
  assert.ok(Math.abs(Math.sin((railToRow.rot * Math.PI) / 180)) > 0.8, 'and it stands (nearly) upright — rail holes are not on the column grid, so it tilts a little, exactly as far as it needs to');
  const diag = drop('D5', 'A12'); assert.ok(Math.abs(diag.rot) > 1 && Math.abs(diag.rot % 90) > 1, 'a diagonal is fine too');
});

test('snapping: holes too close together for the body are refused; a taken hole is skipped; one lead near a hole slides the part', () => {
  const { state, bb, res, led } = build();
  const h = id => pinWorld(bb, id);
  // adjacent holes are 9.6 px apart — the body needs 38.4
  placeFlex(res, h('D5'), h('D6')); res.rot = 0;
  const s = findSnap(state.parts, res);
  assert.ok(!s || !s.place || s.place.len >= 38.4 - 1e-9, 'never squeezes the body into a hole pair it cannot fit');
  // an LED already in D5: the resistor's lead 1 must not take that hole
  seat(state, led, 'A', bb, 'E6');                                        // LED leads in E6 and E5 (col 5)
  const r2 = mk('r2', 'resistor'); state.parts.push(r2);
  placeFlex(r2, { x: h('D5').x + 1, y: h('D5').y + 1 }, { x: h('D11').x, y: h('D11').y });
  const s2 = findSnap(state.parts, r2); applySnap(r2, s2);
  const c = compile(state);
  assert.notEqual(c.attachments.get('r2|1'), 'bb|E5', 'E5 is taken by the LED');
});

test('the fixed circuit: 5V wire → + rail → resistor (rail to main area) → LED → GND is clean and lights the LED', () => {
  const { state, bb, led, res } = build();
  const h = id => pinWorld(bb, id);
  placeFlex(res, h('BP11'), h('J11')); applySnap(res, findSnap(state.parts, res));       // resistor bridges the + rail and column 11
  led.rot = 0; seat(state, led, 'A', bb, 'I11');                                          // LED anode in column 11, cathode in column 10
  state.wires.push(wire('v', { part: 'uno', pin: '5V' }, { part: 'bb', pin: 'BP3' }), wire('g', { part: 'bb', pin: 'F10' }, { part: 'uno', pin: 'GND.1' }));
  const c = compile(state), r = solveDrive(c, { pins: new Map(), pressed: new Set() });
  assert.equal(c.attachments.get('res|1'), 'bb|BP11'); assert.equal(c.attachments.get('res|2'), 'bb|J11');
  assert.equal(c.attachments.get('led|A'), 'bb|I11'); assert.equal(c.attachments.get('led|C'), 'bb|I10');
  assert.deepEqual(c.openLeads, []); assert.deepEqual(c.issues, []); assert.deepEqual(r.warnings, []);
  assert.ok(r.ledCurrent.get('led') > 0.011 && r.ledCurrent.get('led') < 0.015, `LED ${r.ledCurrent.get('led')}`);
});

test('resistor length persists (undo snapshots, project files); older files get the default 6-pitch length', () => {
  const state = { parts: [mk('uno', 'arduino-uno'), { ...mk('r', 'resistor', 10, 20, 37.5), len: 73.25, ohms: 470 }], wires: [] };
  const s2 = { parts: [], wires: [] }; restore(s2, snapshot(state));
  assert.equal(s2.parts[1].len, 73.25); assert.equal(s2.parts[1].rot, 37.5);
  const file = JSON.parse(JSON.stringify(toProjectFile(state)));
  assert.equal(fromProjectFile(file).parts[1].len, 73.25); assert.equal(fromProjectFile(file).parts[1].rot, 37.5);
  delete file.parts[1].len; assert.equal(fromProjectFile(file).parts[1].len, 57.6);
  file.parts[1].len = 5; assert.equal(fromProjectFile(file).parts[1].len, 38.4, 'clamped to the body length');
});

test('a new LED rises to the top of its strip; a dragged resistor lets go when moved away', async () => {
  const { raiseInStrips } = await import('../src/core/snap.js');
  const bb = mk('bb', 'breadboard', 0, 0);
  const led = mk('d1', 'led', 0, 0);
  const state = { parts: [bb, led] };
  seat(state, led, 'A', bb, 'E5');                   // dropped low, on row E
  const before = pinWorld(led, 'A');
  assert.ok(raiseInStrips(state.parts, led), 'should climb');
  const after = pinWorld(led, 'A');
  assert.ok(after.y < before.y - 1, 'moved up');
  assert.ok(Math.abs(after.y - pinWorld(bb, 'A5').y) < 0.01, 'leads now in row A');
  // a blocked column stops the climb
  const led2 = mk('d2', 'led', 0, 0);
  state.parts.push(led2);
  seat(state, led2, 'A', bb, 'E9');
  const blocker = mk('r9', 'resistor', 0, 0);
  state.parts.push(blocker);
  seat(state, blocker, '1', bb, 'C9');
  raiseInStrips(state.parts, led2);
  assert.ok(Math.abs(pinWorld(led2, 'A').y - pinWorld(bb, 'D9').y) < 0.01, 'stops under the part in C9');

  // resistor: far-away holes do not grab its leads
  const r = mk('r1', 'resistor', 0, 0);
  const st2 = { parts: [bb, r] };
  const h1 = pinWorld(bb, 'A10'), h2 = pinWorld(bb, 'A22');
  r.x = h1.x - 2; r.y = h1.y - PART_DEFS.resistor.h / 2 + 3;
  const len0 = r.len ?? PART_DEFS.resistor.len;
  const s = findSnap(st2.parts, r);
  if (s && s.place) assert.ok(Math.abs(s.place.len - len0) <= 20 + 1e-6, 'stretch is limited');
  assert.ok(h2.x - h1.x > 100);
});
