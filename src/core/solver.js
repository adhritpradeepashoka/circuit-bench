// Small DC operating-point solver (modified nodal analysis, all sources are Norton/Thevenin
// with a series resistance so the matrix is pure conductance).
//
//   • Uno power pins  – ideal-ish voltage sources (1 mΩ)
//   • Uno I/O pins    – 25 Ω push-pull drivers when the firmware drives them, weak pull-up when
//                       INPUT_PULLUP, high-impedance otherwise
//   • resistor        – linear
//   • pushbutton      – ~50 mΩ when pressed, open otherwise
//   • LED             – piecewise-linear diode: per-colour Vf (red ≈ 1.9 V … blue/white ≈ 3.1 V), 5 Ω dynamic resistance above it
//   • slide switch    – a switch that is always joined to one throw (state comes from the part)
//   • sensor-module comparator (LDR DO) – HIGH when AO is above half the supply, only while powered
//   • PIR sensor      – powers up when VCC−GND ≥ 4.5 V; OUT is a 3.3 V / 100 Ω source (relative to its GND) while motion is triggered
export const VCC = 5;
const G_SOURCE = 1000;      // S  (1 mΩ)
const G_PIN = 1 / 25;       // S  (ATmega328P output ≈ 25 Ω)
const G_PULLUP = 1 / 35000; // S
const G_SWITCH = 20;        // S
const G_LED_DEFAULT = 1 / 15; // S  (used when an LED element carries no rd of its own)
const gOn = l => (l.rd ? 1 / l.rd : G_LED_DEFAULT);
const G_PIR = 1 / 100;      // S  (module output ≈ 100 Ω)
const PIR_OUT_V = 3.3, PIR_MIN_SUPPLY = 4.5;
const G_CMP = 1 / 500;      // S  (comparator output on sensor modules)
const CMP_MIN_SUPPLY = 3.0;
const G_MIN = 1e-9;         // S  to ground on every node: keeps floating nets solvable

export const LIMITS = { pinA: 0.04, ledA: 0.03 };
// The Uno's supplies are not ideal: 5V comes from USB through a polyfuse (~0.5 Ω, 500 mA), 3.3V from a small regulator (150 mA).
const SUPPLY = { GND: { r: 0.001, limitA: Infinity }, '5V': { r: 0.5, limitA: 0.5 }, '3.3V': { r: 1, limitA: 0.15 }, VIN: { r: 0.5, limitA: 1 } };

function gauss(A, b, n) {
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-30) continue;
    if (p !== c) { [A[p], A[c]] = [A[c], A[p]]; [b[p], b[c]] = [b[c], b[p]]; }
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = A[r][r] ? s / A[r][r] : 0;
  }
  return x;
}

/**
 * @param circuit  result of compile()
 * @param drive    { pins: Map<unoPinName, 'H'|'L'|'Z'|'U'>, pressed: Set<partId> }
 */
export function solve(circuit, drive) {
  const sources = [];
  const addPower = (set, v, tag) => set.forEach(net => sources.push({ net, v, g: 1 / SUPPLY[tag].r, tag, power: true, limitA: SUPPLY[tag].limitA }));
  addPower(circuit.uno.gnd, 0, 'GND');
  addPower(circuit.uno.v5, VCC, '5V');
  addPower(circuit.uno.v33, 3.3, '3.3V');
  addPower(circuit.uno.vin, 4.6, 'VIN');
  for (const pin of circuit.uno.pins) {
    const mode = drive.pins.get(pin.name) || 'Z';
    if (mode === 'H') sources.push({ net: pin.net, v: VCC, g: G_PIN, tag: pin.label });
    else if (mode === 'L') sources.push({ net: pin.net, v: 0, g: G_PIN, tag: pin.label });
    else if (mode === 'U') sources.push({ net: pin.net, v: VCC, g: G_PULLUP, tag: pin.label, pullup: true });
  }

  const idx = new Map();
  const use = n => { if (!idx.has(n)) idx.set(n, idx.size); return idx.get(n); };
  sources.forEach(s => use(s.net));
  circuit.elements.forEach(e => { if (e.kind === 'PIR') { use(e.vcc); use(e.out); use(e.gnd); } else if (e.kind === 'CMP') { use(e.vcc); use(e.gnd); use(e.ao); use(e.out); } else { use(e.a); use(e.b ?? e.k); } });
  const n = idx.size;
  const leds = circuit.elements.filter(e => e.kind === 'LED');
  const ledId = l => l.id ?? l.partId;
  const pirs = circuit.elements.filter(e => e.kind === 'PIR');
  const on = new Map(leds.map(l => [ledId(l), false]));
  const powered = new Map(pirs.map(p => [p.partId, false]));
  const cmps = circuit.elements.filter(e => e.kind === 'CMP');
  const cmpOn = new Map(cmps.map(c => [c.partId, false])), cmpHigh = new Map(cmps.map(c => [c.partId, false]));

  let x = new Float64Array(n);
  for (let iter = 0; iter < 40; iter++) {
    const A = Array.from({ length: n }, () => new Float64Array(n));
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) A[i][i] += G_MIN;
    for (const s of sources) { const i = idx.get(s.net); A[i][i] += s.g; b[i] += s.g * s.v; }
    const stamp = (na, nb, g) => {
      const i = idx.get(na), j = idx.get(nb);
      if (i === j) return;
      A[i][i] += g; A[j][j] += g; A[i][j] -= g; A[j][i] -= g;
    };
    for (const e of circuit.elements) {
      if (e.kind === 'R') stamp(e.a, e.b, 1 / e.ohms);
      else if (e.kind === 'SW') { if (e.closed || drive.pressed.has(e.partId)) stamp(e.a, e.b, G_SWITCH); }
      else if (e.kind === 'PIR' && powered.get(e.partId)) {
        const v = drive.pressed.has(e.partId) ? PIR_OUT_V : 0;      // idle output is driven low once powered
        stamp(e.out, e.gnd, G_PIR);
        b[idx.get(e.out)] += G_PIR * v; b[idx.get(e.gnd)] -= G_PIR * v;
      } else if (e.kind === 'CMP' && cmpOn.get(e.partId)) {
        const v = cmpHigh.get(e.partId) ? Math.max(0, x[idx.get(e.vcc)] - x[idx.get(e.gnd)]) : 0;
        stamp(e.out, e.gnd, G_CMP);
        b[idx.get(e.out)] += G_CMP * v; b[idx.get(e.gnd)] -= G_CMP * v;
      } else if (e.kind === 'LED' && on.get(ledId(e)) && e.a !== e.k) {
        stamp(e.a, e.k, gOn(e));
        b[idx.get(e.a)] += gOn(e) * e.vf;
        b[idx.get(e.k)] -= gOn(e) * e.vf;
      }
    }
    x = gauss(A, b, n);
    let changed = false;
    for (const l of leds) {
      const vd = x[idx.get(l.a)] - x[idx.get(l.k)];
      const next = l.a !== l.k && vd > l.vf;
      if (next !== on.get(ledId(l))) { on.set(ledId(l), next); changed = true; }
    }
    for (const p of pirs) {
      const next = x[idx.get(p.vcc)] - x[idx.get(p.gnd)] >= PIR_MIN_SUPPLY;
      if (next !== powered.get(p.partId)) { powered.set(p.partId, next); changed = true; }
    }
    for (const c of cmps) {
      const supply = x[idx.get(c.vcc)] - x[idx.get(c.gnd)];
      const on2 = supply >= CMP_MIN_SUPPLY, hi = on2 && x[idx.get(c.ao)] - x[idx.get(c.gnd)] > supply / 2;
      if (on2 !== cmpOn.get(c.partId)) { cmpOn.set(c.partId, on2); changed = true; }
      if (hi !== cmpHigh.get(c.partId)) { cmpHigh.set(c.partId, hi); changed = true; }
    }
    if (!changed) break;
  }

  const voltage = net => (idx.has(net) ? x[idx.get(net)] : null);
  const ledCurrent = new Map();
  for (const l of leds) {
    const vd = x[idx.get(l.a)] - x[idx.get(l.k)];
    ledCurrent.set(ledId(l), on.get(ledId(l)) && l.a !== l.k ? Math.max(0, gOn(l) * (vd - l.vf)) : 0);
  }

  // Health checks (things that would hurt real hardware)
  const warnings = [];
  const fmt = a => `${Math.round(a * 1000)} mA`;
  // supplies: current per net (5V and IOREF pins on one net count together)
  const supplyNets = new Map();
  for (const s of sources) {
    const i = s.g * (s.v - x[idx.get(s.net)]);
    if (s.power) {
      if (s.v > 0) { const e = supplyNets.get(s.net) || { tag: s.tag, v: s.v, i: 0, limitA: s.limitA, r: 1 / s.g }; e.i += i; supplyNets.set(s.net, e); }
    } else if (!s.pullup && Math.abs(i) > LIMITS.pinA) warnings.push({ text: `${s.tag} is sourcing/sinking ${fmt(Math.abs(i))} (Arduino pin rating: 40 mA)` });
  }
  const powerTag = new Map(sources.filter(s => s.power).map(s => [s.net, s.tag]));
  for (const e of supplyNets.values()) {
    if (e.i <= e.limitA) continue;
    const external = Math.max(0, e.v / e.i - e.r);             // resistance of the path outside the supply itself
    warnings.unshift({ text: external < 2 ? `Short circuit: ${e.tag} is connected to GND through about ${external.toFixed(1)} Ω (${fmt(e.i)})` : `${e.tag} is delivering ${fmt(e.i)} (supply limit ${fmt(e.limitA)})` });
  }
  // a plain fact about the path: which supplies the LED's leads are connected straight to
  const directNote = l => (powerTag.has(l.a) && powerTag.has(l.k) ? `; its anode is connected directly to ${powerTag.get(l.a)} and its cathode directly to ${powerTag.get(l.k)}` : powerTag.has(l.a) ? `; its anode is connected directly to ${powerTag.get(l.a)}` : powerTag.has(l.k) ? `; its cathode is connected directly to ${powerTag.get(l.k)}` : '');
  for (const l of leds) {
    const i = ledCurrent.get(ledId(l));
    if (i > LIMITS.ledA) warnings.push({ partId: l.partId, text: `${l.channel ? `An LED segment/colour (${l.channel})` : 'An LED'} is carrying ${fmt(i)} (5 mm LED rating: ~30 mA)${directNote(l)}` });
  }
  for (const p of pirs) if (!powered.get(p.partId)) warnings.push({ partId: p.partId, text: 'A PIR sensor has no supply (VCC − GND is below 4.5 V)' });
  const pirPowered = new Map(powered);
  const modules = new Map(cmps.map(c => [c.partId, { powered: cmpOn.get(c.partId), out: cmpHigh.get(c.partId) }]));
  return { voltage, ledCurrent, pirPowered, modules, warnings };
}

/**
 * Like solve(), but understands PWM: drive.duty is Map<pin, 0–1> for pins the firmware drives with analogWrite.
 * A PWM pin is 'H' for `duty` of the time and 'L' for the rest, so the averaged result is the weighted mean of the
 * H/L solutions (exact for LED brightness, which follows average current). Up to 4 PWM pins are expanded exactly.
 */
export function solveDrive(circuit, drive) {
  const duty = [...(drive.duty || [])];
  const pins = new Map(drive.pins);
  const active = [];
  for (const [name, d] of duty) {
    if (d <= 0.004) pins.set(name, 'L');
    else if (d >= 0.996) pins.set(name, 'H');
    else active.push([name, d]);
  }
  const exact = active.slice(0, 4);
  for (const [name, d] of active.slice(4)) pins.set(name, d >= 0.5 ? 'H' : 'L');
  if (!exact.length) return solve(circuit, { ...drive, pins });

  const runs = [];
  for (let mask = 0; mask < 1 << exact.length; mask++) {
    let w = 1; const p = new Map(pins);
    exact.forEach(([name, d], i) => { const hi = mask & (1 << i); p.set(name, hi ? 'H' : 'L'); w *= hi ? d : 1 - d; });
    if (w > 1e-9) runs.push({ w, res: solve(circuit, { ...drive, pins: p }) });
  }
  const dominant = runs.reduce((a, b) => (b.w > a.w ? b : a));
  const ledCurrent = new Map();
  for (const id of dominant.res.ledCurrent.keys()) ledCurrent.set(id, runs.reduce((s, r) => s + r.w * (r.res.ledCurrent.get(id) || 0), 0));
  const seen = new Set(), warnings = [];
  for (const r of runs) for (const wn of r.res.warnings) if (!seen.has(wn.text)) { seen.add(wn.text); warnings.push(wn); }
  const voltage = net => {
    let s = 0;
    for (const r of runs) { const v = r.res.voltage(net); if (v == null) return null; s += r.w * v; }
    return s;
  };
  return { voltage, ledCurrent, pirPowered: dominant.res.pirPowered, modules: dominant.res.modules, warnings };
}
