// Reads the Circuit tab for a drone, the way the real wires would behave: which motor is soldered to which AIO output, whether two of its wires are swapped
// (that makes it spin the other way), a loose wire, a reversed or shorted battery, and whether the camera is powered and connected.
// Only wires count (these parts have no breadboard legs). The Test tab flies what is wired here; with no AIO on the bench it flies as before.
const T = id => `custom-${id}`;
/** AIO motor outputs M1…M4 are numbered as in Betaflight. */
export const SLOT_POSITIONS = ['back right', 'front right', 'back left', 'front left'];
// (every drone motor is the same part: the AIO output its wires go to decides where it sits on the drone)
const IS_MOTOR = t => /^custom-drone-motor(-(fr|fl|bl|br))?$/.test(t);
const AIO_PINS = ['BAT+', 'BAT-', '5V', 'G', 'CAM', ...[1, 2, 3, 4].flatMap(k => ['A', 'B', 'C'].map(l => `M${k}${l}`))];

export function droneWiring(state) {
  const parts = state?.parts || [], wires = state?.wires || [], aio = parts.find(p => p.type === T('drone-aio'));
  if (!aio) return { present: false, problems: [], fatal: null, slotOf: {}, reversed: {}, loose: {}, camera: true };
  const par = new Map(), key = (p, pin) => `${p}|${pin}`, find = k => { while (par.get(k) !== k) { par.set(k, par.get(par.get(k))); k = par.get(k); } return k; }, ensure = k => { if (!par.has(k)) par.set(k, k); };
  for (const w of wires) { const a = key(w.a.part, w.a.pin), b = key(w.b.part, w.b.pin); ensure(a); ensure(b); par.set(find(a), find(b)); }
  const joined = (a, b) => par.has(a) && par.has(b) && find(a) === find(b), problems = [], slotOf = {}, reversed = {}, loose = {};
  const onAio = (partId, pin) => AIO_PINS.filter(id => joined(key(partId, pin), key(aio.id, id)));
  let fatal = null;

  const bat = parts.find(p => p.type === T('drone-battery'));
  if (joined(key(aio.id, 'BAT+'), key(aio.id, 'BAT-'))) fatal = 'Short circuit: BAT+ and BAT− are joined by a wire. Take it off before you connect the battery.';
  else if (!bat || !joined(key(bat.id, '+'), key(aio.id, 'BAT+')) || !joined(key(bat.id, '-'), key(aio.id, 'BAT-'))) fatal = bat && (joined(key(bat.id, '+'), key(aio.id, 'BAT-')) || joined(key(bat.id, '-'), key(aio.id, 'BAT+'))) ? 'The battery is plugged in the wrong way round (+ to −). That would destroy the board: swap its two wires.' : 'The battery is not wired to the AIO. Connect the battery + to BAT+ and − to BAT−.';

  const motors = parts.filter(p => IS_MOTOR(p.type)); let n = 0;
  for (const m of motors) {
    n++; const who = `Motor ${n}`, land = ['A', 'B', 'C'].map(w => onAio(m.id, w).filter(id => /^M[1-4][ABC]$/.test(id)));
    if (land.every(l => l.length === 0)) { problems.push(`${who} is not wired to the AIO, so it will not spin.`); loose[who] = true; continue; }
    if (land.some(l => l.length === 0)) { problems.push(`${who} has a wire that is not soldered to a pad (it needs all three), so it will not spin properly.`); loose[who] = true; continue; }
    if (land.some(l => l.length > 1)) { problems.push(`${who} has two of its wires on the same pad.`); loose[who] = true; continue; }
    const outs = new Set(land.map(l => l[0][1])), letters = land.map(l => l[0][2]);
    if (outs.size > 1) { problems.push(`${who}'s wires go to different motor outputs (${[...outs].map(o => `M${o}`).join(', ')}), so it will not spin.`); loose[who] = true; continue; }
    if (new Set(letters).size < 3) { problems.push(`${who} has two wires on the same pad.`); loose[who] = true; continue; }
    const slot = Number([...outs][0]) - 1, pos = SLOT_POSITIONS[slot], perm = letters.map(l => 'ABC'.indexOf(l)), inversions = (perm[0] > perm[1]) + (perm[0] > perm[2]) + (perm[1] > perm[2]);
    if (pos in slotOf) { problems.push(`Two motors are on the same AIO output (M${slot + 1}).`); continue; }
    slotOf[pos] = slot;
    if (inversions % 2) { reversed[pos] = true; problems.push(`The ${pos} motor (on M${slot + 1}) has two wires swapped, so it spins the wrong way. Swap any two of its wires, or reverse it in the ESC settings.`); }
  }
  if (motors.length && motors.length < 4) problems.push(`Only ${motors.length} motor${motors.length > 1 ? 's are' : ' is'} on the bench; a quadcopter needs four.`);

  const cam = parts.find(p => p.type === T('drone-camera')); let camera = false;
  if (cam) {
    if (joined(key(cam.id, '5V'), key(aio.id, 'BAT+'))) fatal = fatal || 'The camera\'s 5 V wire is on the battery (up to 16.8 V). It would burn out. Use the 5V pad.';
    const power = joined(key(cam.id, '5V'), key(aio.id, '5V')) && joined(key(cam.id, 'GND'), key(aio.id, 'G')), video = joined(key(cam.id, 'VID'), key(aio.id, 'CAM'));
    camera = power && video;
    if (!camera) problems.push(!power && video ? 'The camera has its video wire but no power: connect 5V and GND too.' : power ? 'The camera is powered but its video wire is not on the CAM pad.' : 'The camera is not wired to the AIO (5V, GND and CAM), so FPV is off.');
  }
  return { present: true, problems, fatal, slotOf, reversed, loose, camera };
}
