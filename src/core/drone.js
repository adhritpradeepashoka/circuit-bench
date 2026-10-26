// Multirotor physics, the same for every part: a brushless motor is a DC motor behind an ESC, a propeller is a load that grows with rpm²,
// a battery is a voltage source with internal resistance. Everything here is an ESTIMATE from typical values (not measured on real parts),
// and each number is overridable ("Advanced") so someone with a thrust table can enter real data. SI units inside; grams, mm, mAh, Kv at the edges.
const RHO = 1.225, G = 9.80665, IN = 0.0254, RPM = Math.PI / 30;

/** Standard stator sizes named the way the hobby does: the first two digits are the stator diameter and the last two its height, in mm (2207 = 22 × 7). */
const CORE = {
  '0802': { stator: [8, 2], mass: 1.6, kvRef: 22000, rRef: 0.9, i0Ref: 0.35, maxA: 4, shaft: 1.0, mount: { pattern: [6, 6], screw: 'M1_4', note: 'tiny whoop motors differ a lot between brands' }, cells: [1, 1], estimated: true },
  '1103': { stator: [11, 3], mass: 4.5, kvRef: 8000, rRef: 0.2, i0Ref: 0.5, maxA: 8, shaft: 1.5, mount: { pattern: [9, 9], screw: 'M2' }, cells: [2, 3], estimated: false },
  '1404': { stator: [14, 4], mass: 9.5, kvRef: 4600, rRef: 0.12, i0Ref: 0.6, maxA: 14, shaft: 2.0, mount: { pattern: [9, 9], screw: 'M2' }, cells: [3, 4], estimated: true },
  '1806': { stator: [18, 6], mass: 17, kvRef: 2300, rRef: 0.075, i0Ref: 0.8, maxA: 20, shaft: 3.0, mount: { pattern: [12, 12], screw: 'M3' }, cells: [3, 4], estimated: true },
  '2207': { stator: [22, 7], mass: 31, kvRef: 1900, rRef: 0.045, i0Ref: 1.0, maxA: 35, shaft: 5.0, mount: { pattern: [16, 16], screw: 'M3' }, cells: [4, 6], estimated: false },
  '2306': { stator: [23, 6], mass: 33, kvRef: 2400, rRef: 0.04, i0Ref: 1.1, maxA: 35, shaft: 5.0, mount: { pattern: [16, 16], screw: 'M3' }, cells: [4, 6], estimated: false },
  '2806': { stator: [28, 6], mass: 52, kvRef: 1300, rRef: 0.06, i0Ref: 1.0, maxA: 40, shaft: 5.0, mount: { pattern: [19, 19], screw: 'M3' }, cells: [4, 6], estimated: false },
};
/** Every other size is derived from its stator volume with the scaling real motors follow (mass, current, winding), and is marked estimated. */
export const MOTOR_NAMES = ['0603', '0702', '0703', '0802', '0803', '0804', '0903', '1002', '1102', '1103', '1104', '1105', '1106', '1202', '1204', '1303', '1306', '1404', '1407', '1408', '1507', '1606', '1704', '1806', '1808', '2004', '2005', '2006', '2204', '2205', '2206', '2207', '2208', '2304', '2305', '2306', '2307', '2308', '2506', '2507', '2806', '2807', '2808', '3004', '3110', '3508'];
function derive(name) {
  const d = Number(name.slice(0, 2)), h = Number(name.slice(2)), vol = d * d * h, ratio = vol / 3388;
  const cells = d <= 8 ? [1, 1] : d <= 12 ? [2, 3] : d <= 15 ? [3, 4] : d <= 19 ? [3, 4] : d <= 23 ? [4, 6] : d <= 28 ? [4, 6] : [6, 6], c = d <= 8 ? 1 : d <= 12 ? 2 : d <= 15 ? 3 : d <= 23 ? 4 : 6;
  const kvRef = Math.round(32000 * (22 / d) ** 0.9 / (c * 3.7) / 50) * 50, k = kvRef / 1900;
  return { stator: [d, h], mass: Math.round((0.0092 * vol + 0.6) * 10) / 10, kvRef, rRef: Math.round(1.25e-8 * ratio ** 0.58 * kvRef * kvRef * 1e4) / 1e4, i0Ref: Math.round(0.9 * ratio ** 0.55 * k ** 0.5 * 100) / 100, maxA: Math.max(3, Math.round(35 * ratio ** 0.8)), shaft: d < 9 ? 1.0 : d < 12 ? 1.5 : d < 15 ? 2 : d < 19 ? 3 : 5,
    mount: d <= 8 ? { pattern: [6, 6], screw: 'M1_4' } : d <= 15 ? { pattern: [9, 9], screw: 'M2' } : d <= 18 ? { pattern: [12, 12], screw: 'M3' } : d <= 24 ? { pattern: [16, 16], screw: 'M3' } : { pattern: [19, 19], screw: 'M3' }, cells, estimated: true };
}
export const MOTOR_SIZES = Object.fromEntries(MOTOR_NAMES.map(n => [n, CORE[n] || derive(n)]));
/** Build a motor from a size and a Kv. Winding resistance scales with Kv² and no-load current with Kv, as it does for real windings of one size. Overrides win. */
export function makeMotor({ size = '2207', kv, over = {} } = {}) {
  const s = MOTOR_SIZES[size]; if (!s) throw new Error(`Unknown motor size ${size}.`);
  kv = Number.isFinite(kv) ? kv : s.kvRef; const k = kv / s.kvRef;
  const m = { size, kv, resistance: s.rRef * k * k, noLoadAmps: s.i0Ref * k, massGrams: s.mass, maxAmps: s.maxA, mount: s.mount, shaftMm: s.shaft, stator: s.stator, source: 'estimated (typical for this size)' };
  for (const key of ['kv', 'resistance', 'noLoadAmps', 'massGrams', 'maxAmps']) if (Number.isFinite(over[key]) && over[key] > 0) { m[key] = over[key]; m.source = 'entered by you'; }
  return m;
}
/** A propeller. Coefficients follow pitch/diameter: more pitch gives more thrust per rpm but needs more power. Overridable. */
export function makeProp({ diameterIn = 5, pitchIn = 4.3, blades = 3, over = {} } = {}) {
  const r = pitchIn / diameterIn, bf = 1 + 0.18 * (blades - 2);
  const p = { diameterIn, pitchIn, blades, ct: (0.09 + 0.12 * (r - 0.5)) * (1 + 0.1 * (blades - 2)), cp: (0.04 + 0.09 * (r - 0.5)) * bf, massGrams: 0.45 * diameterIn ** 1.6 * (blades / 3) ** 0.6, source: 'estimated' };
  for (const key of ['ct', 'cp', 'massGrams']) if (Number.isFinite(over[key]) && over[key] > 0) { p[key] = over[key]; p.source = 'entered by you'; }
  return p;
}
/** A LiPo pack: S cells in series, capacity, discharge rating. Mass, size and resistance from typical energy density (about 125 Wh/kg). */
export function makeBattery({ cells = 4, mAh = 1500, c = 75, over = {} } = {}) {
  const wh = cells * 3.7 * mAh / 1000, mass = wh / 125 * 1000, vol = wh / 0.27 * 1000, h = cells === 1 ? 6 : 17 + (cells - 4) * 1, w = Math.sqrt(vol / h / 1.9) * 1.0, l = w * 1.9;
  const b = { cells, mAh, c, volts: cells * 4.2, nominal: cells * 3.7, resistance: cells * 0.0075 / (mAh / 1000) * (75 / c) ** 0.5 / 1.4, massGrams: mass, sizeMm: [l, w, h].map(v => Math.round(v * 10) / 10), maxAmps: mAh / 1000 * c, wh, source: 'estimated' };
  for (const key of ['resistance', 'massGrams', 'mAh']) if (Number.isFinite(over[key]) && over[key] > 0) { b[key] = over[key]; b.source = 'entered by you'; }
  return b;
}
/** Boards share a few stack sizes. */
export const STACKS = {
  '30.5': { pattern: [30.5, 30.5], screw: 'M3', note: 'standard stack (5 in and up)' },
  '25.5': { pattern: [25.5, 25.5], screw: 'M2', note: 'AIO and 3–4 in stacks' },
  '20': { pattern: [20, 20], screw: 'M2', note: 'micro stack' },
  '16': { pattern: [16, 16], screw: 'M1_6', note: 'whoop AIO' },
};
export const BOARDS = {
  'fc-30.5': { name: 'Flight controller 30.5', kind: 'fc', stack: '30.5', sizeMm: [36, 36, 5], mass: 8, cost: 3500 },
  'esc-30.5': { name: '4-in-1 ESC 30.5 (45 A)', kind: 'esc', stack: '30.5', sizeMm: [41, 36, 6], mass: 14, cost: 4500, maxAmps: 45 },
  'aio-25.5': { name: 'AIO board 25.5 (FC + 4-in-1 ESC)', kind: 'aio', stack: '25.5', sizeMm: [32, 32, 5], mass: 6, cost: 4000, maxAmps: 25 },
  'aio-16': { name: 'Whoop AIO 16 (FC + ESC, 1S)', kind: 'aio', stack: '16', sizeMm: [26, 26, 4], mass: 3, cost: 2800, maxAmps: 5 },
};
export const CAMERAS = {
  'cam-micro': { name: 'FPV camera, micro (19 mm)', widthMm: 19, sizeMm: [19, 19, 20], mass: 6, cost: 1800 },
  'cam-nano': { name: 'FPV camera, nano (14 mm)', widthMm: 14, sizeMm: [14, 14, 15], mass: 2.5, cost: 1500 },
};

/** One motor with one prop at a throttle (0–1), fed by a pack that sags under load. Returns what the motor, prop and pack are doing. */
export function operatingPoint(motor, prop, battery, throttle, motorsOnPack = 4) {
  const D = prop.diameterIn * IN, cq = prop.cp / (2 * Math.PI), kt = 1 / (motor.kv * RPM), R = motor.resistance, i0 = motor.noLoadAmps;
  let vt = battery.nominal * 1.05, w = 0, I = 0;
  for (let k = 0; k < 40; k++) {                                         // the pack's voltage depends on the current, which depends on the voltage
    const v = throttle * vt; let lo = 0, hi = Math.max(1e-9, v / kt);
    for (let j = 0; j < 60; j++) { w = (lo + hi) / 2; const cur = (v - kt * w) / R, drive = kt * (cur - i0), load = cq * RHO * (w / (2 * Math.PI)) ** 2 * D ** 5; if (drive > load) lo = w; else hi = w; }
    I = Math.max(0, (v - kt * w) / R); const vNew = battery.nominal * 1.05 - throttle * I * motorsOnPack * battery.resistance;
    if (Math.abs(vNew - vt) < 1e-6) break; vt = vNew;
  }
  const n = w / (2 * Math.PI), thrustN = prop.ct * RHO * n * n * D ** 4, shaftW = cq * RHO * n ** 3 * D ** 5 * 2 * Math.PI, packAmps = throttle * I;
  return { throttle, rpm: w / RPM, thrustGrams: thrustN / G * 1000, motorAmps: I, packAmpsPerMotor: packAmps, electricalW: vt * packAmps, shaftW, efficiencyGPerW: packAmps ? (thrustN / G * 1000) / (vt * packAmps) : 0, packVolts: vt };
}
/** What a quad built from these parts does: weight, thrust-to-weight, hover throttle and current, and flight time. extraGrams = frame, boards, camera, wires. */
export function analyseQuad({ motor, prop, battery, extraGrams = 0, motors = 4, avionicsAmps = 1.0 }) {
  const mass = motors * (motor.massGrams + prop.massGrams) + battery.massGrams + extraGrams, weightN = mass / 1000 * G, notes = [];
  const full = operatingPoint(motor, prop, battery, 1, motors), twr = motors * full.thrustGrams / mass;
  let lo = 0, hi = 1; for (let k = 0; k < 40; k++) { const d = (lo + hi) / 2; operatingPoint(motor, prop, battery, d, motors).thrustGrams * motors / 1000 * G > weightN ? (hi = d) : (lo = d); }
  const hover = twr > 1 ? operatingPoint(motor, prop, battery, hi, motors) : null, amps = hover ? hover.packAmpsPerMotor * motors + avionicsAmps : null;
  if (twr < 1) notes.push('It cannot lift its own weight with these parts.'); else if (twr < 2) notes.push('Thrust-to-weight under 2: it will hover but fly sluggishly.');
  if (full.motorAmps > motor.maxAmps) notes.push(`At full throttle each motor draws ${full.motorAmps.toFixed(0)} A, above the ${motor.maxAmps} A it is good for.`);
  if (full.packAmpsPerMotor * motors > battery.maxAmps) notes.push(`The pack is asked for ${(full.packAmpsPerMotor * motors).toFixed(0)} A at full throttle but is rated ${battery.maxAmps.toFixed(0)} A.`);
  const cellsOk = MOTOR_SIZES[motor.size]?.cells; if (cellsOk && (battery.cells < cellsOk[0] || battery.cells > cellsOk[1])) notes.push(`${motor.size} motors are usually run on ${cellsOk[0] === cellsOk[1] ? cellsOk[0] : cellsOk.join('–')}S, not ${battery.cells}S.`);
  return { massGrams: Math.round(mass * 10) / 10, twr: Math.round(twr * 100) / 100, maxThrustGramsEach: Math.round(full.thrustGrams), maxMotorAmps: Math.round(full.motorAmps * 10) / 10, hoverThrottle: hover ? Math.round(hi * 1000) / 1000 : null, hoverAmps: amps && Math.round(amps * 100) / 100, flightMinutes: amps ? Math.round(battery.mAh / 1000 * 0.8 / amps * 600) / 10 : null, notes };
}
