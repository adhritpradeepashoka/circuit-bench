// The Part Creator's component library: switches, relays, variable resistors, diodes, transistors, regulators,
// capacitors, coils, buzzers, motors and LED arrays — each made from a plain spec and solved by the real solver.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePartSpec, registerCustomPart, BEHAVIOURS } from '../src/core/custom-parts.js';
import { compile } from '../src/core/netlist.js';
import { solveDrive } from '../src/core/solver.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);
let n = 0;
function make(kind, pinIds, roles, extra = {}) {
  const v = validatePartSpec({ id: `custom-lib-${kind}-${++n}`, name: `Test ${kind}`, pins: pinIds.map(id => ({ id, side: 'bottom' })), breadboard: false, behaviour: { kind, roles, ...extra } });
  assert.ok(v.ok, v.errors?.join('; '));
  registerCustomPart(v.spec);
  return v.spec;
}
const W = (a, ap, b, bp) => ({ id: `${a}${ap}${b}${bp}`, a: { part: a, pin: ap }, b: { part: b, pin: bp }, style: 'straight', color: '#000', width: 2 });
const bat = (id, volts) => ({ id, type: 'battery', x: 0, y: 0, rot: 0, volts });
const res = (id, ohms) => ({ id, type: 'resistor', x: 0, y: 0, rot: 0, ohms });
function run(parts, wires, drive = {}) {
  // the Arduino's GND is the 0 V reference; the first battery's − is tied to it
  const ref = parts.find(p => p.type === 'battery').id;
  const c = compile({ parts: [{ id: 'uno', type: 'arduino-uno', x: 900, y: 0, rot: 0 }, ...parts], wires: [...wires, W('uno', 'GND.1', ref, '-')] });
  const r = solveDrive(c, { pins: new Map(), pressed: new Set(), duty: new Map(), ...drive });
  return { c, r, v: (id, pin) => r.voltage(c.netOf(id, pin)) };
}

test('library: every behaviour has roles with labels, and params with sane ranges', () => {
  for (const [k, b] of Object.entries(BEHAVIOURS)) {
    for (const role of [...b.roles, ...(b.optional || [])]) assert.ok(b.roleLabels[role], `${k}.${role} has a label`);
    for (const p of b.params || []) {
      if (p.options) assert.ok(p.options.some(([o]) => o === p.def), `${k}.${p.key} default is an option`);
      else assert.ok(p.def >= p.min && p.def <= p.max, `${k}.${p.key} default inside its range`);
    }
  }
});

test('library: params are clamped, junk falls back to the default, and bad lists are explained', () => {
  const ok = validatePartSpec({ name: 'D', pins: [{ id: 'A' }, { id: 'K' }], behaviour: { kind: 'diode', roles: { anode: 'A', cathode: 'K' }, vf: 99, vz: 'banana', imax: -4 } });
  assert.ok(ok.ok); assert.equal(ok.spec.behaviour.vf, 5); assert.equal(ok.spec.behaviour.vz, 0); assert.equal(ok.spec.behaviour.imax, 1);
  const bad = validatePartSpec({ name: 'S', pins: [{ id: 'V' }, { id: 'G' }, { id: 'I1' }, { id: 'I2' }], behaviour: { kind: 'stepper', roles: { vcc: 'V', gnd: 'G' }, coils: ['I1', 'I2'] } });
  assert.equal(bad.ok, false); assert.ok(bad.errors.some(e => /4 coil/.test(e)));
});

test('switch: SPST is open until flipped; SPDT joins the common pin to throw 1, then throw 2', () => {
  const sw = make('switch', ['A', 'B'], { common: 'A', throw1: 'B' });
  const parts = pos => [bat('b', 5), res('r', 1000), { id: 's', type: sw.id, x: 0, y: 0, rot: 0, pos }];
  const wires = [W('b', '+', 's', 'A'), W('s', 'B', 'r', '1'), W('r', '2', 'b', '-')];
  near(run(parts(0), wires).v('r', '1'), 0, 0.01, 'open');
  near(run(parts(1), wires).v('r', '1'), 5, 0.05, 'closed');

  const spdt = make('switch', ['COM', 'T1', 'T2'], { common: 'COM', throw1: 'T1', throw2: 'T2' });
  const p2 = pos => [bat('b', 5), res('r1', 1000), res('r2', 1000), { id: 's', type: spdt.id, x: 0, y: 0, rot: 0, pos }];
  const w2 = [W('b', '+', 's', 'COM'), W('s', 'T1', 'r1', '1'), W('s', 'T2', 'r2', '1'), W('r1', '2', 'b', '-'), W('r2', '2', 'b', '-')];
  near(run(p2(0), w2).v('r1', '1'), 5, 0.05); near(run(p2(0), w2).v('r2', '1'), 0, 0.01);
  near(run(p2(1), w2).v('r2', '1'), 5, 0.05); near(run(p2(1), w2).v('r1', '1'), 0, 0.01);
});

test('variable resistor: a pot divides the supply by its position; a 2-wire one moves between its lowest and full resistance', () => {
  const pot = make('variable-resistor', ['LO', 'HI', 'W'], { a: 'LO', b: 'HI', wiper: 'W' }, { ohms: 10000 });
  const wires = [W('b', '+', 'p', 'HI'), W('b', '-', 'p', 'LO')];
  for (const [lvl, volts] of [[0, 0], [25, 1.25], [50, 2.5], [100, 5]]) near(run([bat('b', 5), { id: 'p', type: pot.id, x: 0, y: 0, rot: 0, level: lvl }], wires).v('p', 'W'), volts, 0.05, `at ${lvl} %`);
  const flex = make('variable-resistor', ['A', 'B'], { a: 'A', b: 'B' }, { ohms: 100000, min: 10000 });
  const f = lvl => run([bat('b', 5), res('r', 10000), { id: 'f', type: flex.id, x: 0, y: 0, rot: 0, level: lvl }], [W('b', '+', 'f', 'A'), W('f', 'B', 'r', '1'), W('r', '2', 'b', '-')]).v('r', '1');
  near(f(0), 2.5, 0.05, '10 k + 10 k'); near(f(100), 0.4545, 0.02, '100 k + 10 k');
});

test('diode: drops 0.7 V forwards, blocks backwards; a Zener holds its breakdown voltage; a fast-switching flyback pair of states settles', () => {
  const d = make('diode', ['A', 'K'], { anode: 'A', cathode: 'K' });
  const fwd = run([bat('b', 5), { id: 'd', type: d.id, x: 0, y: 0, rot: 0 }, res('r', 1000)], [W('b', '+', 'd', 'A'), W('d', 'K', 'r', '1'), W('r', '2', 'b', '-')]);
  near(fwd.v('r', '1'), 4.3, 0.05, 'forward'); assert.equal(fwd.r.devices.get('d'), 'conducting');
  const rev = run([bat('b', 5), { id: 'd', type: d.id, x: 0, y: 0, rot: 0 }, res('r', 1000)], [W('b', '+', 'd', 'K'), W('d', 'A', 'r', '1'), W('r', '2', 'b', '-')]);
  near(rev.v('r', '1'), 0, 0.01, 'reverse'); assert.equal(rev.r.devices.get('d'), 'blocking');
  const z = make('diode', ['A', 'K'], { anode: 'A', cathode: 'K' }, { vz: 5.1 });
  const zr = run([bat('b', 9), res('r', 330), { id: 'z', type: z.id, x: 0, y: 0, rot: 0 }], [W('b', '+', 'r', '1'), W('r', '2', 'z', 'K'), W('z', 'A', 'b', '-')]);
  near(zr.v('z', 'K'), 5.1, 0.25, 'zener clamp'); assert.equal(zr.r.devices.get('z'), 'breakdown');
  const big = run([bat('b', 12), { id: 'd', type: d.id, x: 0, y: 0, rot: 0 }, res('r', 2)], [W('b', '+', 'd', 'A'), W('d', 'K', 'r', '1'), W('r', '2', 'b', '-')]);
  assert.ok(big.r.warnings.some(w => /diode is carrying/.test(w.text)), 'over its rating');
});

test('NPN: no base current = off; a base resistor turns it on; a heavy drive saturates (≈ 0.2 V); gain limits the collector current in between', () => {
  const q = make('npn', ['B', 'C', 'E'], { base: 'B', collector: 'C', emitter: 'E' });
  const rig = (rb, vb = 5) => run([bat('b', 9), bat('s', vb), res('rl', 100), res('rb', rb), { id: 'q', type: q.id, x: 0, y: 0, rot: 0 }],
    [W('b', '+', 'rl', '1'), W('rl', '2', 'q', 'C'), W('q', 'E', 'b', '-'), W('s', '-', 'b', '-'), W('s', '+', 'rb', '1'), W('rb', '2', 'q', 'B')]);
  const off = rig(1000, 0); near(off.v('q', 'C'), 9, 0.05, 'off'); assert.equal(off.r.devices.get('q'), 'off');
  const sat = rig(1000); near(sat.v('q', 'C'), 0.2, 0.15, 'saturated'); assert.equal(sat.r.devices.get('q'), 'saturated');
  near(sat.v('q', 'B'), 0.7, 0.1, 'base sits one junction drop above the emitter');
  const act = rig(100000); near(act.v('q', 'C'), 9 - 0.43, 0.15, 'active: Ic = 100 × 43 µA'); assert.equal(act.r.devices.get('q'), 'active');
  const nobase = run([bat('b', 9), bat('s', 5), res('rl', 100), { id: 'q', type: q.id, x: 0, y: 0, rot: 0 }],
    [W('b', '+', 'rl', '1'), W('rl', '2', 'q', 'C'), W('q', 'E', 'b', '-'), W('s', '-', 'b', '-'), W('s', '+', 'q', 'B')]);
  assert.ok(nobase.r.warnings.some(w => /base resistor|resistor.*base/i.test(w.text)), 'a base wired straight to 5 V is flagged');
});

test('PNP: switches the high side when its base is pulled below the emitter', () => {
  const q = make('pnp', ['B', 'C', 'E'], { base: 'B', collector: 'C', emitter: 'E' });
  const rig = (basePulledLow) => run([bat('b', 9), res('rl', 100), res('rb', 1000), { id: 'q', type: q.id, x: 0, y: 0, rot: 0 }],
    [W('b', '+', 'q', 'E'), W('q', 'C', 'rl', '1'), W('rl', '2', 'b', '-'), ...(basePulledLow ? [W('q', 'B', 'rb', '1'), W('rb', '2', 'b', '-')] : [W('q', 'B', 'b', '+')])]);
  near(rig(false).v('rl', '1'), 0, 0.05, 'base at the emitter = off');
  near(rig(true).v('rl', '1'), 8.6, 0.2, 'saturated: collector ≈ supply − 0.2 − battery drop');
});

test('MOSFET: draws no gate current, and switches drain → source above its threshold (N and P)', () => {
  const nm = make('nmos', ['G', 'D', 'S'], { gate: 'G', drain: 'D', source: 'S' }, { vth: 2, rds: 0.1 });
  const rig = vg => run([bat('b', 9), bat('g', vg), res('rl', 10), { id: 'm', type: nm.id, x: 0, y: 0, rot: 0 }],
    [W('b', '+', 'rl', '1'), W('rl', '2', 'm', 'D'), W('m', 'S', 'b', '-'), W('g', '-', 'b', '-'), W('g', '+', 'm', 'G')]);
  near(rig(5).v('m', 'D'), 0.09, 0.05, 'on: ≈ 0.9 A × 0.1 Ω'); near(rig(1.5).v('m', 'D'), 9, 0.05, 'below threshold');
  const pm = make('pmos', ['G', 'D', 'S'], { gate: 'G', drain: 'D', source: 'S' }, { vth: 2 });
  const hi = vg => run([bat('b', 9), res('rl', 10), { id: 'm', type: pm.id, x: 0, y: 0, rot: 0 }, bat('g', vg)],
    [W('b', '+', 'm', 'S'), W('m', 'D', 'rl', '1'), W('rl', '2', 'b', '-'), W('m', 'G', 'g', '+'), W('g', '-', 'b', '-')]);
  near(hi(0).v('rl', '1'), 8.49, 0.1, 'gate low = on (9 V through the battery\'s 0.5 Ω)'); near(hi(9).v('rl', '1'), 0, 0.05, 'gate at the supply = off');
});

test('regulator: linear holds its output until the input falls to output + dropout; it draws what it delivers; switching modules draw less', () => {
  const reg = make('regulator', ['IN', 'GND', 'OUT'], { vin: 'IN', gnd: 'GND', out: 'OUT' }, { vout: 5, drop: 2 });
  const rig = (spec, vin) => run([bat('b', vin), { id: 'g', type: spec.id, x: 0, y: 0, rot: 0 }, res('rl', 100), res('probe', 1e6)],
    [W('b', '+', 'g', 'IN'), W('b', '-', 'g', 'GND'), W('g', 'OUT', 'rl', '1'), W('rl', '2', 'b', '-')]);
  near(rig(reg, 9).v('g', 'OUT'), 5, 0.15, '9 V in'); near(rig(reg, 6).v('g', 'OUT'), 4, 0.2, 'dropout: 6 − 2');
  assert.ok(rig(reg, 9).r.regulators.get('g').regulating);
  const lin = rig(reg, 9).r.regulators.get('g'), sw = make('regulator', ['IN', 'GND', 'OUT'], { vin: 'IN', gnd: 'GND', out: 'OUT' }, { vout: 5, mode: 'switching' });
  const swr = rig(sw, 9).r.regulators.get('g');
  near(lin.inputAmps, lin.amps, 0.005, 'linear: current in = current out'); assert.ok(swr.inputAmps < lin.inputAmps * 0.7, 'switching draws less');
});

test('relay: the coil closes COM–NO (and opens COM–NC) once it has its pull-in voltage, electrically separate from the contact side', () => {
  const rl = make('relay', ['C+', 'C-', 'COM', 'NO', 'NC'], { coilA: 'C+', coilB: 'C-', common: 'COM', no: 'NO', nc: 'NC' });
  const rig = vc => run([bat('l', 12), bat('c', vc), res('ro', 1000), res('rc', 1000), { id: 'k', type: rl.id, x: 0, y: 0, rot: 0 }],
    [W('c', '+', 'k', 'C+'), W('c', '-', 'k', 'C-'), W('l', '+', 'k', 'COM'), W('k', 'NO', 'ro', '1'), W('k', 'NC', 'rc', '1'), W('ro', '2', 'l', '-'), W('rc', '2', 'l', '-')]);
  const off = rig(0.5); near(off.v('ro', '1'), 0, 0.05); near(off.v('rc', '1'), 12, 0.2); assert.equal(off.r.relays.get('k'), false);
  const on = rig(5); near(on.v('ro', '1'), 12, 0.2); near(on.v('rc', '1'), 0, 0.05); assert.equal(on.r.relays.get('k'), true);
});

test('capacitor: with a time step it charges through a resistor along the RC curve; without one it is an open circuit; an inductor ramps the current', () => {
  const cap = make('capacitor', ['P', 'N'], { a: 'P', b: 'N' }, { uF: 100 });
  const parts = [bat('b', 5), res('r', 10000), { id: 'c', type: cap.id, x: 0, y: 0, rot: 0 }];
  const wires = [W('b', '+', 'r', '1'), W('r', '2', 'c', 'P'), W('c', 'N', 'b', '-')];
  near(run(parts, wires).v('c', 'P'), 5, 0.01, 'no time step: open, sits at the supply');
  let reactive = new Map(), v = 0;
  for (let i = 0; i < 10; i++) { const o = run(parts, wires, { dt: 0.1, reactive }); reactive = o.r.reactive; v = o.v('c', 'P'); }
  near(v, 3.07, 0.1, 'after one time constant (backward Euler)');
  for (let i = 0; i < 100; i++) { const o = run(parts, wires, { dt: 0.1, reactive }); reactive = o.r.reactive; v = o.v('c', 'P'); }
  near(v, 5, 0.02, 'fully charged');

  const ind = make('inductor', ['P', 'N'], { a: 'P', b: 'N' }, { mH: 100, rs: 1 });
  const ip = [bat('b', 5), res('r', 4), { id: 'l', type: ind.id, x: 0, y: 0, rot: 0 }], iw = [W('b', '+', 'r', '1'), W('r', '2', 'l', 'P'), W('l', 'N', 'b', '-')];
  near(run(ip, iw).v('l', 'P'), 0.909, 0.03, 'DC: just its wire resistance (1 Ω of 5.5 Ω incl. the battery)');
  reactive = new Map(); let first = null;
  for (let i = 0; i < 5; i++) { const o = run(ip, iw, { dt: 0.001, reactive }); reactive = o.r.reactive; if (i === 0) first = o.r.reactive.get('l').i; }
  assert.ok(first < 0.1, `current starts near zero: ${first}`);
  for (let i = 0; i < 200; i++) { const o = run(ip, iw, { dt: 0.001, reactive }); reactive = o.r.reactive; }
  near(reactive.get('l').i, 0.909, 0.03, 'settles at V / R');
});

test('buzzer and motor are loads whose voltage is reported; an LED array lights each listed pin (common cathode or anode)', () => {
  const bz = make('buzzer', ['P', 'N'], { a: 'P', b: 'N' });
  const o = run([bat('b', 5), { id: 'z', type: bz.id, x: 0, y: 0, rot: 0 }], [W('b', '+', 'z', 'P'), W('b', '-', 'z', 'N')]);
  near(o.r.loadVolts.get('z'), 5, 0.3);
  const arr = make('led-array', ['C', 'S1', 'S2', 'S3'], { common: 'C' }, { segments: ['S1', 'S2', 'S3'], color: 'green' });
  const l = run([bat('b', 5), res('r1', 220), res('r3', 220), { id: 'a', type: arr.id, x: 0, y: 0, rot: 0 }],
    [W('b', '+', 'r1', '1'), W('r1', '2', 'a', 'S1'), W('b', '+', 'r3', '1'), W('r3', '2', 'a', 'S3'), W('a', 'C', 'b', '-')]);
  assert.ok(l.r.ledCurrent.get('a:S1') > 0.005 && l.r.ledCurrent.get('a:S3') > 0.005 && !l.r.ledCurrent.get('a:S2'), 'S1 and S3 light, S2 does not');
});

test('encoder: A and B pull to the common pin in the Gray-code pattern as the phase advances', () => {
  const enc = make('encoder', ['A', 'B', 'C'], { a: 'A', b: 'B', common: 'C' });
  const at = phase => { const r = run([bat('b', 5), res('ra', 10000), res('rb', 10000), { id: 'e', type: enc.id, x: 0, y: 0, rot: 0, phase }],
    [W('b', '+', 'ra', '1'), W('b', '+', 'rb', '1'), W('ra', '2', 'e', 'A'), W('rb', '2', 'e', 'B'), W('e', 'C', 'b', '-')]); return [r.v('e', 'A') < 1 ? 0 : 1, r.v('e', 'B') < 1 ? 0 : 1].join(''); };
  assert.deepEqual([0, 1, 2, 3].map(at), ['11', '01', '00', '10']);
});

test('templates: every ready-made part passes the validator and keeps its behaviour', async () => {
  const { TEMPLATES, TEMPLATE_GROUPS } = await import('../src/core/part-templates.js');
  assert.ok(TEMPLATES.length >= 40);
  const ids = new Set();
  for (const t of TEMPLATES) {
    assert.ok(!ids.has(t.id), `unique id ${t.id}`); ids.add(t.id);
    assert.ok(TEMPLATE_GROUPS[t.group], `${t.id} has a group`);
    const { id, group, ...spec } = t;
    const v = validatePartSpec(spec);
    assert.ok(v.ok, `${t.name}: ${v.errors?.join('; ')}`);
    assert.equal(v.spec.behaviour.kind, t.behaviour.kind);
    registerCustomPart(v.spec);
  }
});

// ── parts that follow the firmware's pin timing, run against REAL compiled sketches ──
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Mcu, CPU_HZ } from '../src/sim/mcu.js';
import { Servo, Ultrasonic, Stepper, Bldc, BldcEsc, FreqProbe } from '../src/parts/timed.js';
import { renderArt } from '../src/core/part-art.js';
import { BOARD_SPECS } from '../src/core/boards.js';

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/firmware.json', import.meta.url)), 'utf8'));
function boot(name) {
  const f = fixtures.sketches[name]; assert.ok(f?.result.ok, `${name} built`);
  const mcu = new Mcu(f.result.hex), out = [];
  mcu.onSerial = b => out.push(b);
  return { mcu, text: () => Buffer.from(out).toString('latin1'), run: s => mcu.run(Math.round(s * CPU_HZ)) };
}
const pinOf = n => { const p = BOARD_SPECS['arduino-uno'].pins[String(n)]; return { port: p.port, bit: p.bit }; };

test('servo: the Servo library’s pulse width sets the horn angle (544 µs = 0°, 2400 µs = 180°), and the horn moves at a real servo’s pace', () => {
  const { mcu, run, text } = boot('servo-cmd');
  const s = new Servo(); s.attach(mcu, pinOf(9));
  run(0.2);
  near(s.target, 90, 1.5, 'write(90) on boot'); near(s.pulseUs, 1472, 6);
  mcu.serialWrite('c'); run(0.2);
  assert.match(text(), /ok/); near(s.target, 180, 1.5);
  s.update(0.05, true); near(s.angle, 90 + 25, 1, 'moves 500°/s at most');
  for (let i = 0; i < 20; i++) s.update(0.05, true); near(s.angle, 180, 0.1);
  mcu.serialWrite('a'); run(0.2); near(s.target, 0, 1.5);
  const frozen = s.angle; s.update(1, false); assert.equal(s.angle, frozen, 'no power, no movement');
  s.detach();
});

test('ultrasonic: pulseIn() on ECHO measures 58 µs per centimetre after a 10 µs TRIG pulse', () => {
  const { mcu, run, text } = boot('ultrasonic-read');
  const u = new Ultrasonic(); u.setDistance(100); u.attach(mcu, pinOf(7), pinOf(8));
  run(0.6);
  const reads = [...text().matchAll(/cm=(\d+)/g)].map(m => +m[1]);
  assert.ok(reads.length >= 3, text());
  for (const r of reads.slice(1)) near(r, 100, 2, 'reading');
  u.setDistance(30); run(0.5);
  near(+[...text().matchAll(/cm=(\d+)/g)].pop()[1], 30, 2, 'after moving the object');
  assert.ok(u.measurements >= 5);
  u.detach();
  const quiet = boot('ultrasonic-read'); quiet.run(0.5);
  assert.match(quiet.text(), /cm=0/, 'no sensor, pulseIn times out');
});

test('stepper: the Stepper library’s coil pattern turns the shaft one step at a time, forwards and back', () => {
  const { mcu, run, text } = boot('stepper-spin');
  const st = new Stepper({ steps: 2048 }); st.attach(mcu, [8, 9, 10, 11].map(pinOf));
  for (let i = 0; i < 300 && !/done/.test(text()); i++) run(0.01);
  assert.match(text(), /done/);
  near(st.angle, 90, 2, '512 of 2048 steps = a quarter turn');
  for (let i = 0; i < 300 && !/back/.test(text()); i++) run(0.01);
  assert.match(text(), /back/); near(st.angle, 45, 2, 'then 256 steps back');
});

test('BLDC with a real six-step sketch: the motor reaches the commutation rate, reverses on command, and a drawn sprite spins', () => {
  const { mcu, run, text } = boot('bldc-sixstep');
  const m = new Bldc({ poles: 7 }); m.attach(mcu, [3, 4, 5].map(pinOf));
  run(0.05); for (let i = 0; i < 30; i++) { run(0.02); m.update(0.02); }
  // 1 step per ~1.65 ms ≈ 606 steps/s → 101 electrical rev/s → /7 pole pairs → ≈ 866 rpm
  near(m.rpm, 866, 90, 'forward rpm');
  mcu.serialWrite('r'); for (let i = 0; i < 60; i++) { run(0.02); m.update(0.02); }
  assert.ok(m.rpm < -700, `reversed: ${m.rpm}`);
  const v = validatePartSpec({ name: 'BLDC', package: 'art', pins: [{ id: 'U', x: 4, y: 10 }, { id: 'V', x: 4, y: 20 }, { id: 'W', x: 4, y: 30 }], art: { w: 80, h: 50, svg: '<g id="rotor"><circle cx="45" cy="25" r="18" fill="#889"/><rect x="43" y="8" width="4" height="12" fill="#d33"/></g>', motion: [{ target: 'rotor', kind: 'spin', driver: 'rpm', pivot: [45, 25] }] }, behaviour: { kind: 'bldc', roles: { u: 'U', v: 'V', w: 'W' }, poles: 7 } });
  assert.ok(v.ok, v.errors?.join('; '));
  assert.match(renderArt(v.spec.art, { aux: m.rpm }), /animation:cp-spin 0\.0[0-9]s linear infinite reverse/);
});

test('BLDC with an ESC: the real Servo-library sketch arms it, then half throttle on an 11.1 V pack gives about 5,500 rpm (1000 Kv)', () => {
  const { mcu, run, text } = boot('bldc-esc');
  const e = new BldcEsc({ kv: 1000, minUs: 1000, maxUs: 2000 }); e.attach(mcu, pinOf(9));
  for (let i = 0; i < 60; i++) { run(0.05); e.update(0.05, 11.1); }
  assert.match(text(), /armed/); assert.ok(e.armed);
  near(e.rpm, 5550, 120, 'rpm');
});

test('buzzer tone(): the frequency probe reads the note the sketch plays', () => {
  const { mcu, run } = boot('tone-play');
  const p = new FreqProbe(); p.attach(mcu, pinOf(6));
  let f = 0; for (let i = 0; i < 12; i++) { run(0.02); f = p.update() || f; }
  near(f, 440, 12);
  p.detach();
});

test('native Wokwi parts: the DPDT relay switches both poles together; the bar graph lights only the LEDs whose own two pins are driven; a pair-less bar graph is rejected', () => {
  const r = (id, ohms) => res(id, ohms);
  const build = volts => run([bat('b', 12), bat('k', volts), r('ra', 1000), r('rb', 1000), { id: 'k1', type: 'relay-dpdt', x: 0, y: 0, rot: 0 }],
    [W('k', '+', 'k1', 'COIL1'), W('k', '-', 'k1', 'COIL2'), W('b', '+', 'k1', 'P1'), W('b', '+', 'k1', 'P2'), W('k1', 'NO1', 'ra', '1'), W('ra', '2', 'b', '-'), W('k1', 'NO2', 'rb', '1'), W('rb', '2', 'b', '-')]);
  // (battery k is the coil supply; its − must share the reference — tie it through the Arduino GND)
  const off = build(0), on = build(5);
  near(off.v('ra', '1'), 0, 0.2); near(off.v('rb', '1'), 0, 0.2);
  near(on.v('ra', '1'), 12, 0.3); near(on.v('rb', '1'), 12, 0.3, 'pole 2 follows the same coil');
  const bar = run([bat('b', 5), r('r3', 220), { id: 'bar', type: 'led-bar-graph', x: 0, y: 0, rot: 0 }], [W('b', '+', 'r3', '1'), W('r3', '2', 'bar', 'A3'), W('bar', 'C3', 'b', '-')]);
  assert.ok((bar.r.ledCurrent.get('bar:A3') || 0) > 0.005, 'LED 3 lights');
  assert.ok(!bar.r.ledCurrent.get('bar:A4'), 'LED 4 does not');
  const bad = validatePartSpec({ name: 'B', pins: [{ id: 'A1' }, { id: 'A2' }], behaviour: { kind: 'led-array', roles: {}, segments: ['A1', 'A2'] } });
  assert.equal(bad.ok, false); assert.ok(bad.errors.some(e => /common pin|second pin/.test(e)));
});

test('native Wokwi inputs: keypad keys, DIP switches, the joystick dividers and the sensors\' DOUT comparator', () => {
  const r = (id, ohms) => res(id, ohms);
  // keypad: R2 is fed 5 V; pressing key (row 2, column 3) = bit 6 puts that voltage on C3 (through a 1 k to GND)
  const pad = keys => run([bat('b', 5), r('rl', 1000), { id: 'kp', type: 'keypad-4x4', x: 0, y: 0, rot: 0, keys }],
    [W('b', '+', 'kp', 'R2'), W('kp', 'C3', 'rl', '1'), W('rl', '2', 'b', '-')]);
  near(pad(0).v('rl', '1'), 0, 0.1, 'no key: C3 floats low'); near(pad(1 << 6).v('rl', '1'), 5, 0.2, 'key held: R2 joins C3');
  near(pad(1 << 5).v('rl', '1'), 0, 0.1, 'a different key does nothing to C3');
  // DIP: switch 4 joins 4a to 4b
  const dip = bits => run([bat('b', 5), r('rl', 1000), { id: 'dp', type: 'dip-switch-8', x: 0, y: 0, rot: 0, bits }],
    [W('b', '+', 'dp', '4a'), W('dp', '4b', 'rl', '1'), W('rl', '2', 'b', '-')]);
  near(dip(0).v('rl', '1'), 0, 0.1); near(dip(1 << 3).v('rl', '1'), 5, 0.2);
  // joystick: HORZ sits at half supply in the middle and follows jx; SEL pulls to GND when pressed
  const joy = p => run([bat('b', 5), { id: 'jy', type: 'joystick', x: 0, y: 0, rot: 0, ...p }], [W('b', '+', 'jy', 'VCC'), W('b', '-', 'jy', 'GND')]);
  near(joy({}).v('jy', 'HORZ'), 2.5, 0.1); near(joy({ jx: 100 }).v('jy', 'HORZ'), 5, 0.1); near(joy({ jy: 0 }).v('jy', 'VERT'), 0, 0.1);
  // gas sensor: DOUT is LOW above the threshold, HIGH below it (and AOUT follows the level)
  const gas = level => run([bat('b', 5), { id: 'gs', type: 'gas-sensor', x: 0, y: 0, rot: 0, level }], [W('b', '+', 'gs', 'VCC'), W('b', '-', 'gs', 'GND')]);
  near(gas(20).v('gs', 'DOUT'), 5, 0.3, 'low gas: DOUT high'); near(gas(80).v('gs', 'DOUT'), 0, 0.3, 'lots of gas: DOUT low'); near(gas(80).v('gs', 'AOUT'), 4, 0.2);
});

test('op-amp: non-inverting amplifier gain 1+Rf/Rg, a follower, rail clipping, a comparator, and no output without a supply', () => {
  const r = (id, ohms) => res(id, ohms);
  const oa = { id: 'oa', type: 'custom-opamp-lm358', x: 0, y: 0, rot: 0 };
  // 5 V supply; input 0.2 V from a divider (b: 5 V, 24 k over 1 k); gain 1 + 10k/1k = 11 → 2.2 V
  const amp = (vin, rf = 10000) => run([bat('b', 5), r('ra', 24000), r('rb', 1000), r('rf', rf), r('rg', 1000), oa],
    [W('b', '+', 'oa', 'V+'), W('b', '-', 'oa', 'V-'), W('b', '+', 'ra', '1'), W('ra', '2', 'rb', '1'), W('rb', '2', 'b', '-'), W('ra', '2', 'oa', 'IN+'),
      W('oa', 'OUT', 'rf', '1'), W('rf', '2', 'oa', 'IN-'), W('rf', '2', 'rg', '1'), W('rg', '2', 'b', '-')]);
  near(amp().v('oa', 'OUT'), 2.2, 0.05, 'gain of 11');
  // a follower (OUT wired to IN−) repeats the input
  const fol = run([bat('b', 5), r('ra', 24000), r('rb', 1000), oa], [W('b', '+', 'oa', 'V+'), W('b', '-', 'oa', 'V-'), W('b', '+', 'ra', '1'), W('ra', '2', 'rb', '1'), W('rb', '2', 'b', '-'), W('ra', '2', 'oa', 'IN+'), W('oa', 'OUT', 'oa', 'IN-')]);
  near(fol.v('oa', 'OUT'), 0.2, 0.02, 'follower');
  // too much gain clips below V+ (LM358: 1.5 V short of the rail) — ratio 1+100k/1k × 0.2 V = 20 V wants more than 3.5 V
  near(amp(0, 100000).v('oa', 'OUT'), 3.5, 0.1, 'clips 1.5 V under the rail');
  // a comparator: no feedback, IN+ above IN− → high rail; below → low
  const cmp = (vp, vn) => run([bat('b', 5), bat('p', vp), bat('n', vn), oa], [W('b', '+', 'oa', 'V+'), W('b', '-', 'oa', 'V-'), W('p', '+', 'oa', 'IN+'), W('n', '+', 'oa', 'IN-')]);
  near(cmp(3, 2).v('oa', 'OUT'), 3.5, 0.1, 'high'); near(cmp(2, 3).v('oa', 'OUT'), 0.05, 0.1, 'low');
  // no supply → the output is not driven
  const dead = run([bat('b', 1), oa, r('rl', 1000)], [W('b', '+', 'oa', 'V+'), W('b', '-', 'oa', 'V-'), W('oa', 'OUT', 'rl', '1'), W('rl', '2', 'b', '-')]);
  assert.ok(Math.abs(dead.v('oa', 'OUT')) < 0.2, 'unpowered op-amp does not drive');
});

test('logic parts in the catalogue: gates follow their truth tables from a battery supply, and the D flip-flop is built in', async () => {
  const { PART_DEFS } = await import('../src/core/parts.js');
  for (const id of ['not', 'and', 'or', 'xor', 'nand', 'nor', 'dff', 'mux2']) assert.ok(PART_DEFS[`custom-gate-${id}`]?.builtin, `${id} is in the catalogue`);
  assert.equal(PART_DEFS['custom-gate-and'].category, 'Logic');
  const { compileLogic, createLogicState, logicDrive } = await import('../src/core/logic.js');
  const out = (id, inputs) => {
    const def = PART_DEFS[`custom-gate-${id}`], compiled = def.logic, state = createLogicState(compiled);
    const volts = pin => (pin in inputs ? inputs[pin] * 5 : pin === 'VCC' ? 5 : 0);
    return logicDrive(compiled, state, def.spec.behaviour.roles, volts);
  };
  const y = (id, a, b) => out(id, { A: a, B: b }).get('Y');
  const table = { and: [0, 0, 0, 1], or: [0, 1, 1, 1], xor: [0, 1, 1, 0], nand: [1, 1, 1, 0], nor: [1, 0, 0, 0] };
  for (const [id, want] of Object.entries(table)) [[0, 0], [0, 1], [1, 0], [1, 1]].forEach(([a, b], i) => near(y(id, a, b) ?? 0, want[i] * 5, 0.1, `${id}(${a},${b})`));
  near(out('not', { A: 0 }).get('Y'), 5, 0.1); near(out('not', { A: 1 }).get('Y'), 0, 0.1);
  near(out('mux2', { A: 0, B: 1, S: 1 }).get('Y'), 5, 0.1, 'S high picks B'); near(out('mux2', { A: 0, B: 1, S: 0 }).get('Y'), 0, 0.1, 'S low picks A');
});

test('BioAmp EXG Pill and instrumentation amp: output rests at half supply, follows gain × (IN+ − IN−), clips at the rails; INA rests at REF; extra op-amps need their supply', async () => {
  const { PART_DEFS } = await import('../src/core/parts.js');
  assert.equal(PART_DEFS['custom-bioamp-exg-pill'].category, 'Biosignal'); assert.deepEqual(PART_DEFS['custom-bioamp-exg-pill'].pins.map(p => p.id), ['OUT', 'VCC', 'GND', 'IN+', 'IN-', 'REF']);
  const pill = (vp, vn) => run([bat('b', 5), bat('p', vp), bat('n', vn), { id: 'px', type: 'custom-bioamp-exg-pill', x: 0, y: 0, rot: 0 }],
    [W('b', '+', 'px', 'VCC'), W('b', '-', 'px', 'GND'), W('p', '+', 'px', 'IN+'), W('n', '+', 'px', 'IN-'), W('p', '-', 'b', '-'), W('n', '-', 'b', '-')]);
  near(pill(0, 0).v('px', 'OUT'), 2.5, 0.05, 'idle at half supply');
  near(pill(0.001, 0).v('px', 'OUT'), 3.5, 0.1, '1 mV × 1000 = +1 V');
  near(pill(0, 0.001).v('px', 'OUT'), 1.5, 0.1, 'the other way');
  near(pill(0.5, 0).v('px', 'OUT'), 4.9, 0.1, 'clips just below the rail');
  const ina = ref => run([bat('b', 12), bat('p', 0.02), bat('r', ref), { id: 'ia', type: 'custom-inamp-ina128', x: 0, y: 0, rot: 0 }],
    [W('b', '+', 'ia', 'V+'), W('b', '-', 'ia', 'V-'), W('p', '+', 'ia', 'IN+'), W('r', '+', 'ia', 'REF'), W('p', '-', 'b', '-'), W('r', '-', 'b', '-'), W('ia', 'IN-', 'b', '-')]);
  near(ina(2.5).v('ia', 'OUT'), 4.5, 0.1, 'REF + 100 × 20 mV');
  const tl = vs => run([bat('b', vs), { id: 'o', type: 'custom-opamp-tl07x', x: 0, y: 0, rot: 0 }, res('rl', 1000)], [W('b', '+', 'o', 'V+'), W('b', '-', 'o', 'V-'), W('o', 'OUT', 'rl', '1'), W('rl', '2', 'b', '-')]);
  assert.ok(Math.abs(tl(5).v('o', 'OUT')) < 0.2, 'TL072 needs more than 5 V to wake up');
});

test('biosignal source through the BioAmp Pill: the ADC-side voltage follows the ECG, strength scales it, a peeled-off electrode gives a flat line at half supply', async () => {
  const { signalAt, ecgBeat } = await import('../src/core/signals.js');
  // the textbook shape: R peak is the largest positive point (~1 mV), S/Q dips are negative, nothing is NaN
  const samples = Array.from({ length: 1000 }, (_, i) => ecgBeat(i / 1000));
  near(Math.max(...samples), 0.001, 0.0002, 'R peak ≈ 1 mV'); assert.ok(Math.min(...samples) < -0.0001 && samples.every(Number.isFinite));
  near(signalAt({ signal: 'ecg', bpm: 60 }, 0.31), signalAt({ signal: 'ecg', bpm: 60 }, 1.31), 5e-5, 'periodic with the heart rate (plus a slow breathing sway)');
  assert.ok(Math.abs(signalAt({ signal: 'emg', effort: 0 }, 0.5)) < 1e-9, 'a relaxed muscle is silent');
  assert.ok(Math.abs(signalAt({ signal: 'emg', effort: 100 }, 0.5)) + Math.abs(signalAt({ signal: 'emg', effort: 100 }, 0.51)) > 0, 'a tensed one is not');
  const chain = (vs, part = {}) => run([bat('b', 5), { id: 'bs', type: 'custom-signal-source', x: 0, y: 0, rot: 0, ...part }, { id: 'px', type: 'custom-bioamp-exg-pill', x: 0, y: 0, rot: 0 }],
    [W('b', '+', 'px', 'VCC'), W('b', '-', 'px', 'GND'), W('bs', 'E+', 'px', 'IN+'), W('bs', 'E-', 'px', 'IN-'), W('bs', 'REF', 'px', 'REF')], { signals: new Map([['bs', vs]]) });
  near(chain(0).v('px', 'OUT'), 2.5, 0.05, 'idle at half supply');
  near(chain(0.001).v('px', 'OUT'), 3.5, 0.1, '1 mV × 1000');
  near(chain(0.001, { attached: 0 }).v('px', 'OUT'), 2.5, 0.05, 'peeled-off electrodes pick nothing up');
});

test('head channels: each BioAmp Pill with electrode sites placed is its own channel, even with nothing wired to its inputs or REF', async () => {
  const { signalAt } = await import('../src/core/signals.js');
  const pill = (id, extra) => ({ id, type: 'custom-bioamp-exg-pill', x: 0, y: 0, rot: 0, ...extra });
  const parts = [bat('b', 5), pill('p1', { sp: 'O1', sn: 'A1', sr: 'A2' }), pill('p2', { sp: 'EOG-L', sn: 'EOG-R', sr: 'A2' }), pill('p3')];
  const wires = ['p1', 'p2', 'p3'].flatMap(p => [W('b', '+', p, 'VCC'), W('b', '-', p, 'GND')]);
  const t = 1.234;
  const signals = new Map([['p1', signalAt(parts[1], t)], ['p2', signalAt(parts[2], t)]]);
  const { c, r, v } = run(parts, wires, { signals });
  assert.equal(c.elements.filter(e => e.kind === 'BIO').length, 2, 'only the Pills with both E+ and E− placed get a body');
  for (const [id, want] of [['p1', signals.get('p1')], ['p2', signals.get('p2')]]) near(v(id, 'OUT'), 2.5 + 1000 * want, 0.05, `${id} follows its own sites`);
  assert.notEqual(signals.get('p1'), signals.get('p2'));
  near(v('p3', 'OUT'), 2.5, 0.05, 'an unplaced channel idles at half supply');
});
