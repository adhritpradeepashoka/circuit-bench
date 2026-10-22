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
//   • battery         – a voltage source between its terminals (0.5 Ω internal resistance)
//   • DC motor        – a resistive load (≈ 20 Ω running); its speed follows the voltage across it
//   • L298N           – two H-bridges: when powered (12V−GND ≥ 4.5 V) and enabled, each OUT is driven to (12V − 1.4 V) or GND by its IN
//   • PIR sensor      – powers up when VCC−GND ≥ 4.5 V; OUT is a 3.3 V / 100 Ω source (relative to its GND) while motion is triggered
import { logicDrive } from './logic.js';

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
const G_LOGIC = 1 / 40;     // S  (a CMOS output stage)
const G_OA = 1 / 25;        // S  (op-amp output resistance ≈ 25 Ω)
const OA_GAIN = 1e5;        // open-loop voltage gain
const G_MUX = 1 / 70;       // S  (CD74HC4067 on-resistance)
const G_BAT = 1 / 0.5;      // S  (battery internal resistance)
const G_DRV = 1 / 1.5;      // S  (H-bridge output)
const DRV_DROP = 1.4, DRV_MIN_SUPPLY = 4.5, LOGIC_HIGH = 2.3;
const G_DIODE = 1 / 0.5, G_ZENER = 1 / 2;     // S  (forward dynamic resistance of a silicon diode; Zener knee)
const G_BE = 1 / 10, V_BE = 0.7, V_CESAT = 0.2, G_SAT = 1 / 0.5;     // BJT: base-emitter junction, collector-emitter saturation
const G_RLY_CONTACT = 20, G_REG = 1 / 0.3;
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
  circuit.elements.forEach(e => {
    if (e.kind === 'PIR') { use(e.vcc); use(e.out); use(e.gnd); }
    else if (e.kind === 'CMP' || e.kind === 'SRC') { use(e.vcc); use(e.gnd); use(e.out); if (e.ao != null) use(e.ao); }
    else if (e.kind === 'LOGIC') { for (const n of Object.values(e.nets)) use(n); }
    else if (e.kind === 'MUX') { for (const k of [e.vcc, e.gnd, e.common, ...e.sel, ...e.ch]) use(k); if (e.en != null) use(e.en); }
    else if (e.kind === 'Q') { for (const n of [e.b, e.c, e.e, e.g, e.d, e.s]) if (n != null) use(n); }
    else if (e.kind === 'RLY') { for (const n of [e.ca, e.cb, e.com, e.no, e.nc, e.pole2?.com, e.pole2?.no, e.pole2?.nc]) if (n != null) use(n); }
    else if (e.kind === 'REG') { use(e.vin); use(e.gnd); use(e.out); }
    else if (e.kind === 'BIO') { use(e.pos); use(e.neg); use(e.ref); }
    else if (e.kind === 'SLIME') { use(e.ref); for (const t of e.taps) use(t.net); }
    else if (e.kind === 'OA') { for (const k of [e.p, e.n, e.out, e.vcc, e.vee, e.bias?.net]) if (k != null) use(k); }
    else if (e.kind === 'DRV') { use(e.vs); use(e.gnd); for (const c of e.ch) { use(c.in1); use(c.in2); use(c.out1); use(c.out2); if (c.en != null) use(c.en); } }
    else { use(e.a); use(e.b ?? e.k); }
  });
  const n = idx.size;
  const leds = circuit.elements.filter(e => e.kind === 'LED');
  const ledId = l => l.id ?? l.partId;
  const pirs = circuit.elements.filter(e => e.kind === 'PIR');
  const on = new Map(leds.map(l => [ledId(l), false]));
  const powered = new Map(pirs.map(p => [p.partId, false]));
  const cmps = circuit.elements.filter(e => e.kind === 'CMP');
  const cmpOn = new Map(cmps.map(c => [c.partId, false])), cmpHigh = new Map(cmps.map(c => [c.partId, false]));
  const srcs = circuit.elements.filter(e => e.kind === 'SRC'), srcOn = new Map(srcs.map(s => [s.partId, false]));
  const logics = circuit.elements.filter(e => e.kind === 'LOGIC');
  const logicOut = new Map(logics.map(l => [l.partId, new Map()]));     // partId → Map<pinId, volts above its own GND>
  const muxes = circuit.elements.filter(e => e.kind === 'MUX'), muxCh = new Map(muxes.map(m => [m.partId, -1]));   // -1 = nothing connected
  const drvs = circuit.elements.filter(e => e.kind === 'DRV');
  const drvKey = d => drvs.indexOf(d);
  const drvState = drvs.map(() => ({ powered: false, ch: [{ en: false, a: false, b: false }, { en: false, a: false, b: false }] }));

  const diodes = circuit.elements.filter(e => e.kind === 'D'), dState = new Map(diodes.map(d => [d.partId, 0]));      // 0 blocking · 1 forward · 2 Zener breakdown
  const qs = circuit.elements.filter(e => e.kind === 'Q'), qState = new Map(qs.map(q => [q.partId, 0]));              // 0 off · 1 active/on · 2 saturated
  const rlys = circuit.elements.filter(e => e.kind === 'RLY'), rlyOn = new Map(rlys.map(r => [r.partId, false]));
  const regs = circuit.elements.filter(e => e.kind === 'REG'), regState = new Map(regs.map(r => [r.partId, { v: 0, i: 0, iin: 0 }]));
  const oas = circuit.elements.filter(e => e.kind === 'OA'), oaState = new Map(oas.map(o => [o.partId, 'lin']));   // 'off' (no supply) · 'lin' (amplifying) · 'hi' / 'lo' (stuck at a rail)
  const dt = drive.dt > 0 ? drive.dt : 0, prior = drive.reactive || new Map();
  const reactive = new Map();
  const bjtNodes = q => (q.type === 'pnp' ? { p: q.e, n: q.b, hi: q.e, lo: q.c } : { p: q.b, n: q.e, hi: q.c, lo: q.e });
  const isMos = q => q.type === 'nmos' || q.type === 'pmos';

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
      if (e.kind === 'R' || e.kind === 'MOT') stamp(e.a, e.b, 1 / e.ohms);
      else if (e.kind === 'BAT') {
        if (e.a !== e.b) { stamp(e.a, e.b, G_BAT); b[idx.get(e.a)] += G_BAT * e.v; b[idx.get(e.b)] -= G_BAT * e.v; }
      } else if (e.kind === 'LOGIC') {
        const g = idx.get(e.gnd), driven = logicOut.get(e.partId);
        for (const [pin, volts] of driven) {
          const net = e.nets[pin];
          if (net == null || !idx.has(net) || idx.get(net) === g) continue;
          const i = idx.get(net), v = x[g] + volts;
          A[i][i] += G_LOGIC; A[g][g] += G_LOGIC; A[i][g] -= G_LOGIC; A[g][i] -= G_LOGIC;
          b[i] += G_LOGIC * v; b[g] -= G_LOGIC * v;
        }
      } else if (e.kind === 'MUX') {
        const ch = muxCh.get(e.partId);
        if (ch >= 0 && ch < e.ch.length) stamp(e.common, e.ch[ch], G_MUX);
      } else if (e.kind === 'SRC') {
        // a student-made sensor: OUT = frac × (VCC − GND) through 100 Ω, only while it has a supply (digital: only while triggered)
        const supply = x[idx.get(e.vcc)] - x[idx.get(e.gnd)];
        if (!srcOn.get(e.partId)) continue;
        const v = (e.momentary ? (drive.pressed.has(e.partId) ? 1 : 0) : e.frac) * supply;
        stamp(e.out, e.gnd, G_PIR);
        b[idx.get(e.out)] += G_PIR * v; b[idx.get(e.gnd)] -= G_PIR * v;
      } else if (e.kind === 'DRV') {
        const st = drvState[drvKey(e)];
        if (!st.powered) continue;
        const v = Math.max(0, x[idx.get(e.vs)] - x[idx.get(e.gnd)] - DRV_DROP);
        e.ch.forEach((c, k) => {
          const s = st.ch[k];
          if (!s.en) return;                                   // disabled: outputs float (the motor coasts)
          for (const [out, hi] of [[c.out1, s.a], [c.out2, s.b]]) {
            if (out === e.gnd) continue;
            stamp(out, e.gnd, G_DRV);
            b[idx.get(out)] += G_DRV * (hi ? v : 0); b[idx.get(e.gnd)] -= G_DRV * (hi ? v : 0);
          }
        });
      }
      else if (e.kind === 'LOAD') stamp(e.a, e.b, 1 / e.ohms);
      else if (e.kind === 'D') {
        const st = dState.get(e.partId);
        if (st === 1 && e.a !== e.k) { stamp(e.a, e.k, G_DIODE); b[idx.get(e.a)] += G_DIODE * e.vf; b[idx.get(e.k)] -= G_DIODE * e.vf; }
        else if (st === 2 && e.a !== e.k) { stamp(e.a, e.k, G_ZENER); b[idx.get(e.a)] -= G_ZENER * e.vz; b[idx.get(e.k)] += G_ZENER * e.vz; }
      } else if (e.kind === 'Q') {
        const st = qState.get(e.partId);
        if (isMos(e)) { if (st && e.d !== e.s) stamp(e.d, e.s, 1 / e.rds); }
        else if (st) {
          const { p, n: nn, hi, lo } = bjtNodes(e), ip = idx.get(p), in_ = idx.get(nn);
          stamp(p, nn, G_BE); b[ip] += G_BE * V_BE; b[in_] -= G_BE * V_BE;                    // the base-emitter junction
          if (st === 2) { stamp(hi, lo, G_SAT); b[idx.get(hi)] += G_SAT * V_CESAT; b[idx.get(lo)] -= G_SAT * V_CESAT; }
          else {                                                                           // collector current = gain × base current
            const k = e.beta * G_BE, ih = idx.get(hi), il = idx.get(lo);
            A[ih][ip] += k; A[ih][in_] -= k; b[ih] += k * V_BE;
            A[il][ip] -= k; A[il][in_] += k; b[il] -= k * V_BE;
          }
        }
      } else if (e.kind === 'RLY') {
        stamp(e.ca, e.cb, 1 / e.ohms);
        if (rlyOn.get(e.partId)) stamp(e.com, e.no, G_RLY_CONTACT); else if (e.nc != null) stamp(e.com, e.nc, G_RLY_CONTACT);
        if (e.pole2) { if (rlyOn.get(e.partId)) stamp(e.pole2.com, e.pole2.no, G_RLY_CONTACT); else if (e.pole2.nc != null) stamp(e.pole2.com, e.pole2.nc, G_RLY_CONTACT); }
      } else if (e.kind === 'REG') {
        const r = regState.get(e.partId), ig = idx.get(e.gnd);
        if (r.v > 0) {
          const io = idx.get(e.out);
          A[io][io] += G_REG; A[ig][ig] += G_REG; A[io][ig] -= G_REG; A[ig][io] -= G_REG;
          b[io] += G_REG * r.v; b[ig] -= G_REG * r.v;
        }
        if (r.iin) { b[idx.get(e.vin)] -= r.iin; b[ig] += r.iin; }
      } else if (e.kind === 'CAP') {
        if (dt > 0 && e.a !== e.b) {
          const g = e.farads / dt, v0 = prior.get(e.partId)?.v ?? 0;
          stamp(e.a, e.b, g); b[idx.get(e.a)] += g * v0; b[idx.get(e.b)] -= g * v0;
        }
      } else if (e.kind === 'IND') {
        const lt = dt > 0 ? e.henries / dt : 0, g = 1 / (e.rs + lt), i0 = prior.get(e.partId)?.i ?? 0, is = g * lt * i0;
        if (e.a !== e.b) { stamp(e.a, e.b, g); b[idx.get(e.a)] -= is; b[idx.get(e.b)] += is; }
      }
      else if (e.kind === 'BIO') {      // two electrodes, each a Thevenin source (± half the signal, through the skin contact) against the reference electrode
        const v = drive.signals?.get(e.partId) ?? 0, gc = 1 / e.rc;
        stamp(e.pos, e.ref, gc); b[idx.get(e.pos)] += gc * v / 2; b[idx.get(e.ref)] -= gc * v / 2;
        stamp(e.neg, e.ref, gc); b[idx.get(e.neg)] -= gc * v / 2; b[idx.get(e.ref)] += gc * v / 2;
      }
      else if (e.kind === 'SLIME') {      // each electrode net: a Thevenin source (the organism's potential there, through the agar/electrode contact) against the bath
        const vs = drive.signals?.get(e.partId) || [], gc = 1 / e.rs;
        e.taps.forEach((t, i) => { if (i === e.refIdx || t.net === e.ref) return; const v = (vs[i] ?? 0) - (vs[e.refIdx] ?? 0); stamp(t.net, e.ref, gc); b[idx.get(t.net)] += gc * v; b[idx.get(e.ref)] -= gc * v; });
      }
      else if (e.kind === 'OA') {
        const st = oaState.get(e.partId), o = idx.get(e.out), g = G_OA;
        if (st === 'lin') {      // a voltage-controlled voltage source: out = gain × (+ − −), through the output resistance
          const ip = idx.get(e.p), im = idx.get(e.n);
          const gain = e.gain ?? OA_GAIN;
          A[o][o] += g; A[o][ip] -= g * gain; A[o][im] += g * gain;
          if (e.bias?.mode === 'mid') { A[o][idx.get(e.vcc)] -= g / 2; A[o][idx.get(e.vee)] -= g / 2; }
          else if (e.bias?.mode === 'ref') A[o][idx.get(e.bias.net)] -= g;
        } else if (st === 'hi' || st === 'lo') {
          const rail = st === 'hi' ? x[idx.get(e.vcc)] - e.dropHigh : x[idx.get(e.vee)] + e.dropLow;
          A[o][o] += g; b[o] += g * rail;
        }
      }
      else if (e.kind === 'SW') { if (e.closed || (!e.fixed && drive.pressed.has(e.partId))) stamp(e.a, e.b, G_SWITCH); }
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
    const settle = iter < 30;                      // after that, stop flipping states so a marginal circuit (a source follower) still ends
    for (const d of diodes) {
      const vd = x[idx.get(d.a)] - x[idx.get(d.k)], cur = dState.get(d.partId);
      const next = d.a === d.k ? 0 : vd > d.vf + (cur === 1 ? -0.005 : 0) ? 1 : d.vz > 0 && vd < -d.vz + (cur === 2 ? 0.005 : 0) ? 2 : 0;
      if (settle && next !== cur) { dState.set(d.partId, next); changed = true; }
    }
    for (const q of qs) {
      const cur = qState.get(q.partId);
      let next = cur;
      if (isMos(q)) {
        const vgs = q.type === 'nmos' ? x[idx.get(q.g)] - x[idx.get(q.s)] : x[idx.get(q.s)] - x[idx.get(q.g)];
        next = vgs > q.vth + (cur ? -0.05 : 0.05) ? 1 : 0;
      } else {
        const { p, n: nn, hi, lo } = bjtNodes(q), vbe = x[idx.get(p)] - x[idx.get(nn)], vce = x[idx.get(hi)] - x[idx.get(lo)];
        const ib = Math.max(0, (vbe - V_BE) * G_BE);
        if (!cur) next = vbe > V_BE + 0.01 ? 1 : 0;
        else if (vbe < V_BE - 0.01 && ib <= 0) next = 0;
        else if (cur === 1) next = vce < V_CESAT && ib > 0 ? 2 : 1;
        else next = G_SAT * (vce - V_CESAT) > q.beta * ib * 1.02 ? 1 : 2;
      }
      if (settle && next !== cur) { qState.set(q.partId, next); changed = true; }
    }
    for (const r of rlys) {
      const v = Math.abs(x[idx.get(r.ca)] - x[idx.get(r.cb)]), cur = rlyOn.get(r.partId), next = cur ? v > r.pick * 0.4 : v >= r.pick;
      if (settle && next !== cur) { rlyOn.set(r.partId, next); changed = true; }
    }
    for (const r of regs) {
      const supply = x[idx.get(r.vin)] - x[idx.get(r.gnd)], st = regState.get(r.partId);
      const target = r.mode === 'switching' ? (supply >= 2.5 ? r.vout : 0) : Math.min(r.vout, Math.max(0, supply - r.drop));
      const vo = x[idx.get(r.out)] - x[idx.get(r.gnd)];
      // the current it is delivering is only known from a solve in which it was stamped (v > 0); the first time round, start from zero
      const iout = target > 0 && st.v > 0 ? Math.max(0, G_REG * (st.v - vo)) : 0;
      const iin = r.mode === 'switching' ? (target * iout) / (0.85 * Math.max(supply, 1)) : iout;
      if (Math.abs(target - st.v) > 0.005 || Math.abs(iin - st.iin) > 0.002 || Math.abs(iout - (st.i || 0)) > 0.002) { st.v = target; st.iin = iin; st.i = iout; if (settle) changed = true; }
    }
    for (const o of oas) {
      const vcc = x[idx.get(o.vcc)], vee = x[idx.get(o.vee)];
      const rest = o.bias?.mode === 'mid' ? (vcc + vee) / 2 : o.bias?.mode === 'ref' ? x[idx.get(o.bias.net)] : 0;
      const want = rest + (o.gain ?? OA_GAIN) * (x[idx.get(o.p)] - x[idx.get(o.n)]);
      const hi = vcc - o.dropHigh, lo = vee + o.dropLow;
      const next = vcc - vee < o.minSupply ? 'off' : want > hi ? 'hi' : want < lo ? 'lo' : 'lin';
      if (next !== oaState.get(o.partId)) { oaState.set(o.partId, next); changed = true; }
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
    for (const l of logics) {
      const entry = drive.logic?.get(l.partId);
      const next = entry ? logicDrive(entry.compiled, entry.state, l.roles, pin => (l.nets[pin] != null && idx.has(l.nets[pin]) ? x[idx.get(l.nets[pin])] : null)) : new Map();
      const prev = logicOut.get(l.partId);
      if (next.size !== prev.size || [...next].some(([k, v]) => Math.abs((prev.get(k) ?? NaN) - v) > 0.01)) { logicOut.set(l.partId, next); changed = true; }
    }
    for (const m of muxes) {
      const g = x[idx.get(m.gnd)], supply = x[idx.get(m.vcc)] - g, hi = net => x[idx.get(net)] - g > supply / 2;
      const ch = supply < 2 || (m.en != null && hi(m.en)) ? -1 : m.sel.reduce((n, s, i) => n | (hi(s) ? 1 << i : 0), 0);
      if (ch !== muxCh.get(m.partId)) { muxCh.set(m.partId, ch); changed = true; }
    }
    for (const s of srcs) {
      const next = x[idx.get(s.vcc)] - x[idx.get(s.gnd)] >= 2.5;
      if (next !== srcOn.get(s.partId)) { srcOn.set(s.partId, next); changed = true; }
    }
    for (const d of drvs) {
      const st = drvState[drvKey(d)], g = x[idx.get(d.gnd)];
      const p = x[idx.get(d.vs)] - g >= DRV_MIN_SUPPLY;
      if (p !== st.powered) { st.powered = p; changed = true; }
      d.ch.forEach((c, k) => {
        const s = st.ch[k], high = n => x[idx.get(n)] - g > LOGIC_HIGH;
        const next = { en: c.en == null ? true : high(c.en), a: high(c.in1), b: high(c.in2) };
        if (next.en !== s.en || next.a !== s.a || next.b !== s.b) { st.ch[k] = next; changed = true; }
      });
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
  const motorVolts = new Map(circuit.elements.filter(e => e.kind === 'MOT').map(e => [e.partId, x[idx.get(e.a)] - x[idx.get(e.b)]]));
  const drivers = new Map(drvs.map(d => {
    const st = drvState[drvKey(d)];
    return [d.partId, { powered: st.powered, ch: st.ch.map(s => (!st.powered || !s.en || s.a === s.b ? '' : s.a ? 'fwd' : 'rev')) }];
  }));
  for (const d of drvs) {
    const st = drvState[drvKey(d)];
    if (!st.powered && d.ch.some((c, k) => st.ch[k].a || st.ch[k].b)) warnings.push({ partId: d.partId, text: 'The L298N has no motor power: connect its 12V terminal to a battery (or VIN) and its GND to the Arduino GND' });
  }
  // ── the component-library parts ──
  const V = net => x[idx.get(net)];
  const amps = new Map(), devices = new Map(), loadVolts = new Map(), regulators = new Map();
  for (const d of diodes) {
    const st = dState.get(d.partId), vd = V(d.a) - V(d.k);
    const i = st === 1 ? G_DIODE * (vd - d.vf) : st === 2 ? -G_ZENER * (vd + d.vz) : 0;
    amps.set(d.partId, i); devices.set(d.partId, st === 1 ? 'conducting' : st === 2 ? 'breakdown' : 'blocking');
    if (Math.abs(i) > d.imax) warnings.push({ partId: d.partId, text: `A diode is carrying ${fmt(Math.abs(i))} (its rating: ${fmt(d.imax)})` });
  }
  for (const q of qs) {
    const st = qState.get(q.partId);
    if (isMos(q)) {
      const i = st ? Math.abs(V(q.d) - V(q.s)) / q.rds : 0;
      amps.set(q.partId, i); devices.set(q.partId, st ? 'on' : 'off');
      if (i > q.imax) warnings.push({ partId: q.partId, text: `A MOSFET is carrying ${fmt(i)} (its rating: ${fmt(q.imax)})` });
    } else {
      const { p, n: nn, hi, lo } = bjtNodes(q), ib = st ? Math.max(0, (V(p) - V(nn) - V_BE) * G_BE) : 0;
      const ic = !st ? 0 : st === 2 ? Math.max(0, G_SAT * (V(hi) - V(lo) - V_CESAT)) : q.beta * ib;
      amps.set(q.partId, ic); devices.set(q.partId, st === 2 ? 'saturated' : st ? 'active' : 'off');
      if (ib > 0.05) warnings.push({ partId: q.partId, text: `A transistor's base is being driven with ${fmt(ib)} — put a resistor (about 1 kΩ) in series with the base` });
      if (ic > q.imax) warnings.push({ partId: q.partId, text: `A transistor is carrying ${fmt(ic)} through its collector (its rating: ${fmt(q.imax)})` });
    }
  }
  for (const r of regs) {
    const st = regState.get(r.partId), vo = V(r.out) - V(r.gnd), supply = V(r.vin) - V(r.gnd);
    regulators.set(r.partId, { volts: st.v > 0 ? vo : 0, amps: st.i || 0, inputAmps: st.iin || 0, regulating: st.v > 0 });
    if ((st.i || 0) > r.imax) warnings.push({ partId: r.partId, text: `A voltage regulator is delivering ${fmt(st.i)} (its rating: ${fmt(r.imax)})` });
    if (r.mode !== 'switching' && st.v > 0 && (supply - vo) * (st.i || 0) > 1.5) warnings.push({ partId: r.partId, text: `A linear regulator is wasting ${((supply - vo) * st.i).toFixed(1)} W as heat — it will get very hot` });
  }
  for (const e of circuit.elements) {
    if (e.kind === 'LOAD') loadVolts.set(e.partId, V(e.a) - V(e.b));
    else if (e.kind === 'CAP') reactive.set(e.partId, { v: V(e.a) - V(e.b) });
    else if (e.kind === 'IND') {
      const lt = dt > 0 ? e.henries / dt : 0, g = 1 / (e.rs + lt), i0 = prior.get(e.partId)?.i ?? 0;
      reactive.set(e.partId, { i: g * (V(e.a) - V(e.b)) + g * lt * i0 });
    }
  }
  const relays = new Map(rlys.map(r => [r.partId, rlyOn.get(r.partId)]));
  return { voltage, ledCurrent, pirPowered, modules, motorVolts, drivers, muxChannels: new Map(muxCh), logicOut, warnings, deviceAmps: amps, devices, loadVolts, relays, regulators, reactive };
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
  const motorVolts = new Map();
  for (const id of dominant.res.motorVolts.keys()) motorVolts.set(id, runs.reduce((s, r) => s + r.w * (r.res.motorVolts.get(id) || 0), 0));
  // a PWM'd driver: show the direction it has most of the time
  const avg = (key, field) => {
    const out = new Map();
    for (const id of dominant.res[key].keys()) out.set(id, runs.reduce((sum, r) => sum + r.w * (field ? r.res[key].get(id)?.[field] ?? 0 : r.res[key].get(id) ?? 0), 0));
    return out;
  };
  const reactive = new Map();
  for (const [id, st] of dominant.res.reactive) reactive.set(id, Object.fromEntries(Object.keys(st).map(k => [k, runs.reduce((sum, r) => sum + r.w * (r.res.reactive.get(id)?.[k] ?? 0), 0)])));
  return {
    voltage, ledCurrent, pirPowered: dominant.res.pirPowered, modules: dominant.res.modules, motorVolts, drivers: dominant.res.drivers, muxChannels: dominant.res.muxChannels, logicOut: dominant.res.logicOut, warnings,
    deviceAmps: avg('deviceAmps'), devices: dominant.res.devices, loadVolts: avg('loadVolts'), relays: dominant.res.relays, regulators: dominant.res.regulators, reactive,
  };
}

/** A small 6 V hobby motor: ≈ 250 rpm at 6 V, nothing below the ≈ 0.6 V it takes to overcome friction. Sign = direction. */
export const MOTOR_RATED_V = 6, MOTOR_RATED_RPM = 250;
export function motorRpm(volts) {
  const v = Math.abs(volts || 0);
  if (v < 0.6) return 0;
  return Math.sign(volts) * Math.round(Math.min(1.6, (v - 0.6) / (MOTOR_RATED_V - 0.6)) * MOTOR_RATED_RPM);
}
