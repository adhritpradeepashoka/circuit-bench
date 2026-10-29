// Reads the Circuit tab for a drone, the way the real wires would behave: which motor is soldered to which AIO output, whether two of its wires are swapped
// (that makes it spin the other way), a loose wire, a reversed or shorted battery, and whether the camera is powered and connected.
// Two ways to build it: an AIO (flight controller and ESC on one board, whoops and small quads) or a STACK (a separate flight controller and 4-in-1 ESC, with a battery capacitor,
// the way 5-inch and bigger drones are built). Only wires count (these parts have no breadboard legs). The Test tab flies what is wired here; with neither on the bench it flies as before.
const T = id => `custom-${id}`;
/** AIO motor outputs M1…M4 are numbered as in Betaflight. */
export const SLOT_POSITIONS = ['back right', 'front right', 'back left', 'front left'];
// (every drone motor is the same part: the AIO output its wires go to decides where it sits on the drone)
const IS_MOTOR = t => /^custom-drone-motor(-(fr|fl|bl|br))?$/.test(t);
const ESC_PINS = ['BAT+', 'BAT-', '5V', 'G', ...[1, 2, 3, 4].flatMap(k => [`S${k}`, ...['A', 'B', 'C'].map(l => `M${k}${l}`)])];
const AIO_PINS = ['BAT+', 'BAT-', '5V', 'G', 'CAM', ...[1, 2, 3, 4].flatMap(k => ['A', 'B', 'C'].map(l => `M${k}${l}`))];

export function droneWiring(state) {
  const parts = state?.parts || [], wires = state?.wires || [], aio = parts.find(p => p.type === T('drone-aio')), esc = parts.find(p => p.type === T('drone-esc')), fc = parts.find(p => p.type === T('drone-fc'));
  const stack = !aio && !!(esc || fc), board = aio || esc, what = aio ? 'AIO' : 'ESC';       // `board` is the one the battery and the motors are soldered to
  if (!aio && !stack) return { present: false, problems: [], fatal: null, slotOf: {}, reversed: {}, loose: {}, camera: true };
  if (stack && !esc) return { present: true, problems: [], fatal: 'There is a flight controller but no 4-in-1 ESC: nothing can drive the motors. Add an ESC and solder the battery and motors to it.', slotOf: {}, reversed: {}, loose: {}, camera: false };
  const par = new Map(), key = (p, pin) => `${p}|${pin}`, find = k => { while (par.get(k) !== k) { par.set(k, par.get(par.get(k))); k = par.get(k); } return k; }, ensure = k => { if (!par.has(k)) par.set(k, k); };
  for (const w of wires) { const a = key(w.a.part, w.a.pin), b = key(w.b.part, w.b.pin); ensure(a); ensure(b); par.set(find(a), find(b)); }
  const joined = (a, b) => par.has(a) && par.has(b) && find(a) === find(b), problems = [], slotOf = {}, reversed = {}, loose = {};
  const onAio = (partId, pin) => (aio ? AIO_PINS : ESC_PINS).filter(id => joined(key(partId, pin), key(board.id, id)));
  let fatal = null;

  const bat = parts.find(p => p.type === T('drone-battery'));
  if (joined(key(board.id, 'BAT+'), key(board.id, 'BAT-'))) fatal = 'Short circuit: BAT+ and BAT− are joined by a wire. Take it off before you connect the battery.';
  else if (!bat || !joined(key(bat.id, '+'), key(board.id, 'BAT+')) || !joined(key(bat.id, '-'), key(board.id, 'BAT-'))) fatal = bat && (joined(key(bat.id, '+'), key(board.id, 'BAT-')) || joined(key(bat.id, '-'), key(board.id, 'BAT+'))) ? 'The battery is plugged in the wrong way round (+ to −). That would destroy the board: swap its two wires.' : `The battery is not wired to the ${what}. Connect the battery + to BAT+ and − to BAT−.`;

  if (stack && !fc) fatal = fatal || 'There is an ESC but no flight controller: nothing tells the motors what to do. Add a flight controller and join its M1–M4 pads to the ESC signal pads.';
  if (stack && esc && fc && !fatal && !(joined(key(fc.id, '5V'), key(esc.id, '5V')) && joined(key(fc.id, 'G'), key(esc.id, 'G')))) fatal = 'The flight controller has no power: join its 5V and G pads to the ESC\'s 5V and G pads (the ESC makes the 5 V from the battery).';
  // the battery capacitor: a low-ESR electrolytic across BAT+ / BAT− soaks up the voltage spikes the ESC makes; big drones need one, and it must go the right way round
  const cap = parts.find(p => p.type === T('drone-cap'));
  if (cap) {
    if (joined(key(cap.id, '+'), key(board.id, 'BAT-')) || joined(key(cap.id, '-'), key(board.id, 'BAT+'))) fatal = fatal || 'The capacitor is on backwards (its + leg is on BAT− or its − leg on BAT+). It would pop the moment you plug in the battery.';
    else if (!(joined(key(cap.id, '+'), key(board.id, 'BAT+')) && joined(key(cap.id, '-'), key(board.id, 'BAT-')))) problems.push('The capacitor is on the bench but not soldered across BAT+ and BAT−, so it does nothing.');
  } else if (stack) problems.push('No capacitor on the battery pads. Drones this size need a low-ESR capacitor (about 1000 µF, 35 V) soldered across BAT+ and BAT−, or the ESC\'s voltage spikes can kill it.');

  const motors = parts.filter(p => IS_MOTOR(p.type)); let n = 0;
  for (const m of motors) {
    n++; const who = `Motor ${n}`, land = ['A', 'B', 'C'].map(w => onAio(m.id, w).filter(id => /^M[1-4][ABC]$/.test(id)));
    if (land.every(l => l.length === 0)) { problems.push(`${who} is not wired to the AIO, so it will not spin.`); loose[who] = true; continue; }
    if (land.some(l => l.length === 0)) { problems.push(`${who} has a wire that is not soldered to a pad (it needs all three), so it will not spin properly.`); loose[who] = true; continue; }
    if (land.some(l => l.length > 1)) { problems.push(`${who} has two of its wires on the same pad.`); loose[who] = true; continue; }
    const outs = new Set(land.map(l => l[0][1])), letters = land.map(l => l[0][2]);
    if (outs.size > 1) { problems.push(`${who}'s wires go to different motor outputs (${[...outs].map(o => `M${o}`).join(', ')}), so it will not spin.`); loose[who] = true; continue; }
    if (new Set(letters).size < 3) { problems.push(`${who} has two wires on the same pad.`); loose[who] = true; continue; }
    let slot = Number([...outs][0]) - 1;
    if (stack) {                       // the flight controller's M-pad that feeds this ESC output decides which motor it is
      const sig = fc ? [1, 2, 3, 4].filter(k => joined(key(fc.id, `M${k}`), key(esc.id, `S${slot + 1}`))) : [];
      if (!sig.length) { problems.push(`${who} (ESC output M${slot + 1}) has no signal wire: join the ESC's S${slot + 1} pad to one of the flight controller's M1–M4 pads, or it will not spin.`); loose[who] = true; continue; }
      if (sig.length > 1) { problems.push(`${who}'s signal pad S${slot + 1} is joined to more than one flight controller output.`); loose[who] = true; continue; }
      slot = sig[0] - 1;
    }
    const pos = SLOT_POSITIONS[slot], perm = letters.map(l => 'ABC'.indexOf(l)), inversions = (perm[0] > perm[1]) + (perm[0] > perm[2]) + (perm[1] > perm[2]);
    if (pos in slotOf) { problems.push(`Two motors are on the same ${stack ? 'flight controller output' : 'AIO output'} (M${slot + 1}).`); continue; }
    slotOf[pos] = slot;
    if (inversions % 2) { reversed[pos] = true; problems.push(`The ${pos} motor (on M${slot + 1}) has two wires swapped, so it spins the wrong way. Swap any two of its wires, or reverse it in the ESC settings.`); }
  }
  if (motors.length && motors.length < 4) problems.push(`Only ${motors.length} motor${motors.length > 1 ? 's are' : ' is'} on the bench; a quadcopter needs four.`);

  const fcb = aio || fc, cam = parts.find(p => p.type === T('drone-camera')); let camera = false;      // `fcb`: the board with the 5V, G, CAM pads
  if (cam && !fcb) problems.push('The camera has no flight controller to connect to.');
  else if (cam) {
    if (joined(key(cam.id, '5V'), key(board.id, 'BAT+'))) fatal = fatal || 'The camera\'s 5 V wire is on the battery (up to 25 V). It would burn out. Use the 5V pad.';
    const power = joined(key(cam.id, '5V'), key(fcb.id, '5V')) && joined(key(cam.id, 'GND'), key(fcb.id, 'G')), video = joined(key(cam.id, 'VID'), key(fcb.id, 'CAM'));
    camera = power && video;
    if (!camera) problems.push(!power && video ? 'The camera has its video wire but no power: connect 5V and GND too.' : power ? 'The camera is powered but its video wire is not on the CAM pad.' : `The camera is not wired to the ${aio ? 'AIO' : 'flight controller'} (5V, GND and CAM), so FPV is dark.`);
  }
  if (stack && fc) {
    // the radio link and the video transmitter: they do not change how it flies here, but a real build needs them wired right
    const rx = parts.find(p => p.type === T('drone-rx')), vtx = parts.find(p => p.type === T('drone-vtx'));
    if (rx) {
      if (joined(key(rx.id, '5V'), key(board.id, 'BAT+'))) fatal = fatal || 'The receiver\'s 5V wire is on the battery. It would burn out. Use the flight controller\'s 5V pad.';
      const power = joined(key(rx.id, '5V'), key(fc.id, '5V')) && joined(key(rx.id, 'G'), key(fc.id, 'G')), link = joined(key(rx.id, 'TX'), key(fc.id, 'RX1')) && joined(key(rx.id, 'RX'), key(fc.id, 'TX1'));
      if (!power) problems.push('The receiver has no power: connect its 5V and G to the flight controller\'s 5V and G pads.');
      else if (!link) problems.push('The receiver is powered but not talking to the flight controller: join the receiver\'s TX to the FC\'s RX1 and its RX to the FC\'s TX1 (they cross over).');
    }
    if (vtx) {
      const power = (joined(key(vtx.id, 'VIN'), key(fc.id, '5V')) || joined(key(vtx.id, 'VIN'), key(board.id, 'BAT+'))) && joined(key(vtx.id, 'G'), key(fc.id, 'G')), video = joined(key(vtx.id, 'VID'), key(fc.id, 'VTX'));
      if (!power) problems.push('The video transmitter has no power: connect VIN (5 V, or the battery for most 5.8 GHz units) and G.');
      else if (!video) problems.push('The video transmitter is powered but its video wire is not on the flight controller\'s VTX pad, so the picture never leaves the drone.');
      else if (camera === false && cam) problems.push('The video transmitter is wired, but the camera feeding it is not (see the camera note above).');
    }
  }
  return { present: true, problems, fatal, slotOf, reversed, loose, camera };
}
