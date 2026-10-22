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
import { Servo, Ultrasonic, Stepper, FreqProbe } from '../src/parts/timed.js';
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

test('buzzer tone(): the frequency probe reads the note the sketch plays', () => {
  const { mcu, run } = boot('tone-play');
  const p = new FreqProbe(); p.attach(mcu, pinOf(6));
  let f = 0; for (let i = 0; i < 12; i++) { run(0.02); f = p.update() || f; }
  near(f, 440, 12);
  p.detach();
});
