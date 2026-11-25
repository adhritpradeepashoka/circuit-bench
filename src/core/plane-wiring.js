// Reads the Circuit tab for a plane (a flying wing, a fixed wing, an EDF jet): one brushless motor on one ESC, the flight controller powered from the
// ESC's 5 V, servos on the control surfaces, and a receiver. Like drone-wiring.js it checks only wires, the way real ones would behave: a wrong-way battery,
// a motor with two wires swapped (an EDF spun backwards gives almost no thrust), a servo or receiver on the battery (it would burn out), a missing signal.
// The parts are generic: a real flight controller's pads have other names, so the person matches them by job. Nothing here knows about any real board.
const T = id => `custom-${id}`;
const ESC_PINS = ['BAT+', 'BAT-', 'A', 'B', 'C', 'SIG', '5V', 'G'];
export const SERVO_OUTPUTS = ['S1', 'S2', 'S3', 'S4'];
/** What a servo output usually does on a flying wing (the flight controller mixes pitch and roll into the two elevons). */
export const SURFACE = { S1: 'left elevon', S2: 'right elevon', S3: 'output 3', S4: 'output 4' };

export function planeWiring(state) {
  const parts = state?.parts || [], wires = state?.wires || [];
  const esc = parts.find(p => p.type === T('plane-esc')), fc = parts.find(p => p.type === T('plane-fc')), motors = parts.filter(p => p.type === T('plane-motor'));
  const present = !!(esc || fc || motors.length);
  const none = { present: false, ready: false, problems: [], fatal: null, motorReversed: false, servos: {} };
  if (!present) return none;
  const quit = fatal => ({ present: true, ready: false, problems: [], fatal, motorReversed: false, servos: {} });
  if (!esc) return quit(fc ? 'There is a flight controller but no ESC: nothing can drive the motor. Add a plane ESC and solder the battery and the motor to it.' : 'There is a motor but no ESC to drive it. Add a plane ESC.');

  const par = new Map(), key = (p, pin) => `${p}|${pin}`, find = k => { while (par.get(k) !== k) { par.set(k, par.get(par.get(k))); k = par.get(k); } return k; }, ensure = k => { if (!par.has(k)) par.set(k, k); };
  for (const w of wires) { const a = key(w.a.part, w.a.pin), b = key(w.b.part, w.b.pin); ensure(a); ensure(b); par.set(find(a), find(b)); }
  const joined = (a, b) => par.has(a) && par.has(b) && find(a) === find(b), problems = [];
  const onEsc = (partId, pin) => ESC_PINS.filter(id => joined(key(partId, pin), key(esc.id, id)));
  let fatal = null;

  const bat = parts.find(p => p.type === T('drone-battery'));
  if (joined(key(esc.id, 'BAT+'), key(esc.id, 'BAT-'))) fatal = 'Short circuit: BAT+ and BAT− are joined by a wire. Take it off before you connect the battery.';
  else if (!bat || !joined(key(bat.id, '+'), key(esc.id, 'BAT+')) || !joined(key(bat.id, '-'), key(esc.id, 'BAT-'))) fatal = bat && (joined(key(bat.id, '+'), key(esc.id, 'BAT-')) || joined(key(bat.id, '-'), key(esc.id, 'BAT+'))) ? 'The battery is plugged in the wrong way round (+ to −). That would destroy the ESC: swap its two wires.' : 'The battery is not wired to the ESC. Connect the battery + to BAT+ and − to BAT−.';

  // the motor: its three wires to the ESC's three motor pads, in order
  let motorReversed = false;
  if (!motors.length) problems.push('There is no motor on the bench yet. Add a brushless motor or EDF and solder its A, B, C to the ESC.');
  if (motors.length > 1) problems.push('One ESC drives one motor. Take the extra motor off, or add a second ESC for it.');
  const m = motors[0];
  if (m) {
    const land = ['A', 'B', 'C'].map(w => onEsc(m.id, w).filter(id => ['A', 'B', 'C'].includes(id)));
    if (land.every(l => !l.length)) problems.push('The motor is not wired to the ESC, so it will not spin.');
    else if (land.some(l => !l.length)) problems.push('The motor has a wire that is not soldered to the ESC (it needs all three), so it will not spin properly.');
    else if (land.some(l => l.length > 1) || new Set(land.map(l => l[0])).size < 3) problems.push('Two of the motor\'s wires are on the same ESC pad.');
    else {
      const perm = land.map(l => 'ABC'.indexOf(l[0])), inv = (perm[0] > perm[1]) + (perm[0] > perm[2]) + (perm[1] > perm[2]);
      if (inv % 2) { motorReversed = true; problems.push('Two of the motor\'s wires are swapped, so it spins the wrong way. A propeller would push backwards and an EDF would give almost no thrust. Swap any two of its wires, or reverse it in the ESC settings.'); }
    }
    if (['A', 'B', 'C'].some(w => joined(key(m.id, w), key(esc.id, 'BAT+')) || joined(key(m.id, w), key(esc.id, 'BAT-')))) fatal = fatal || 'A motor wire is on the battery pads. That is a short through the motor: put it on A, B or C.';
  }

  // the flight controller: powered from the ESC, told the throttle on MOT → SIG
  const servos = parts.filter(p => p.type === 'servo'), rx = parts.find(p => p.type === T('drone-rx')), rail = (id, pin) => joined(key(id, pin), key(esc.id, '5V')) || (fc && joined(key(id, pin), key(fc.id, '5V')));
  const gnd = (id, pin) => joined(key(id, pin), key(esc.id, 'G')) || (fc && joined(key(id, pin), key(fc.id, 'G')));
  if (!fc) problems.push('There is no flight controller yet: nothing tells the ESC how much throttle to give. Add one and join its MOT pad to the ESC\'s SIG.');
  else {
    if (joined(key(fc.id, '5V'), key(esc.id, 'BAT+'))) fatal = fatal || 'The flight controller\'s 5V is on the battery. It would burn out. Use the ESC\'s 5V pad.';
    else if (!(joined(key(fc.id, '5V'), key(esc.id, '5V')) && joined(key(fc.id, 'G'), key(esc.id, 'G')))) fatal = fatal || 'The flight controller has no power: join its 5V and G pads to the ESC\'s 5V and G pads (the ESC makes the 5 V from the battery).';
    if (!joined(key(fc.id, 'MOT'), key(esc.id, 'SIG'))) problems.push('The ESC has no throttle signal: join the flight controller\'s MOT pad to the ESC\'s SIG pad, or the motor will not spin.');
  }

  // servos: signal to one of S1–S4, power from the 5 V rail (never the battery), ground
  const servoOn = {}; let n = 0;
  for (const sv of servos) {
    n++; const who = `Servo ${n}`;
    if (joined(key(sv.id, 'V+'), key(esc.id, 'BAT+'))) { fatal = fatal || `${who}'s power wire is on the battery (up to 25 V). It would burn out. Use the ESC's 5V pad.`; continue; }
    if (!fc) continue;
    const outs = SERVO_OUTPUTS.filter(o => joined(key(sv.id, 'PWM'), key(fc.id, o)));
    if (!outs.length) problems.push(`${who} has no signal wire: join its PWM to one of the flight controller's S1–S4 pads, or the control surface will not move.`);
    else if (outs.length > 1) problems.push(`${who}'s signal is joined to more than one flight controller output.`);
    else if (outs[0] in servoOn) problems.push(`${who} and another servo are on the same output (${outs[0]}).`);
    else servoOn[outs[0]] = true;
    if (!rail(sv.id, 'V+')) problems.push(`${who} has no power: join its V+ to the ESC's 5V pad.`);
    if (!gnd(sv.id, 'GND')) problems.push(`${who} has no ground: join its GND to the ground pad. Without a common ground its signal means nothing.`);
  }

  // the receiver, as on a drone
  if (rx && fc) {
    if (joined(key(rx.id, '5V'), key(esc.id, 'BAT+'))) fatal = fatal || 'The receiver\'s 5V wire is on the battery. It would burn out. Use the ESC\'s or the flight controller\'s 5V pad.';
    const power = rail(rx.id, '5V') && gnd(rx.id, 'G'), link = joined(key(rx.id, 'TX'), key(fc.id, 'RX1')) && joined(key(rx.id, 'RX'), key(fc.id, 'TX1'));
    if (!power) problems.push('The receiver has no power: connect its 5V and G to the 5V and ground pads.');
    else if (!link) problems.push('The receiver is powered but not talking to the flight controller: join the receiver\'s TX to the FC\'s RX1 and its RX to the FC\'s TX1 (they cross over).');
  } else if (rx) problems.push('The receiver has no flight controller to talk to.');

  return { present: true, ready: !fatal && !problems.length && !!fc && !!m, problems, fatal, motorReversed, servos: servoOn };
}
