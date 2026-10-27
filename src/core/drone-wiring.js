// Reads the Circuit tab for a drone: which motor is wired to which AIO output, and whether the battery and camera are connected.
// Only wires count (these parts have no breadboard legs). The Test tab flies what is wired here; with no AIO on the bench it flies as before.
const T = id => `custom-${id}`;
export const SLOT_POSITIONS = ['front right', 'front left', 'back left', 'back right'];       // AIO pads M1…M4
const MOTOR_POS = { 'drone-motor-fr': 'front right', 'drone-motor-fl': 'front left', 'drone-motor-bl': 'back left', 'drone-motor-br': 'back right' };

export function droneWiring(state) {
  const parts = state?.parts || [], wires = state?.wires || [], aio = parts.find(p => p.type === T('drone-aio'));
  if (!aio) return { present: false, problems: [], fatal: null, slotOf: {}, camera: true };
  const par = new Map(), find = k => { while (par.get(k) !== k) { par.set(k, par.get(par.get(k))); k = par.get(k); } return k; }, key = (p, pin) => `${p}|${pin}`;
  for (const p of parts) for (const pin of ['BAT+', 'BAT-', 'M1', 'M2', 'M3', 'M4', 'CAM', 'PHASES', '+', '-', 'VID']) par.set(key(p.id, pin), key(p.id, pin));
  const ensure = k => { if (!par.has(k)) par.set(k, k); };
  for (const w of wires) { const a = key(w.a.part, w.a.pin), b = key(w.b.part, w.b.pin); ensure(a); ensure(b); par.set(find(a), find(b)); }
  const same = (a, b) => par.has(a) && par.has(b) && find(a) === find(b), problems = [], slotOf = {};
  let fatal = null;
  const bat = parts.find(p => p.type === T('drone-battery'));
  if (!bat || !same(key(bat.id, '+'), key(aio.id, 'BAT+')) || !same(key(bat.id, '-'), key(aio.id, 'BAT-'))) fatal = bat && (same(key(bat.id, '+'), key(aio.id, 'BAT-')) || same(key(bat.id, '-'), key(aio.id, 'BAT+'))) ? 'The battery is wired the wrong way round (+ to −). Swap its two wires.' : 'The battery is not wired to the AIO. Connect the battery + to BAT+ and − to BAT−.';
  for (const m of parts.filter(p => MOTOR_POS[p.type.replace(/^custom-/, '')])) {
    const pos = MOTOR_POS[m.type.replace(/^custom-/, '')], hit = [0, 1, 2, 3].filter(s => same(key(m.id, 'PHASES'), key(aio.id, `M${s + 1}`)));
    if (hit.length === 1) slotOf[pos] = hit[0];
    else if (hit.length > 1) problems.push(`The ${pos} motor is wired to more than one AIO pad (${hit.map(s => `M${s + 1}`).join(', ')}).`);
    else problems.push(`The ${pos} motor is not wired to an AIO pad, so it will not spin.`);
  }
  const used = Object.values(slotOf); if (new Set(used).size < used.length) problems.push('Two motors share one AIO pad.');
  for (const [pos, s] of Object.entries(slotOf)) if (SLOT_POSITIONS[s] !== pos) problems.push(`The ${pos} motor is on M${s + 1}, which the flight controller thinks is the ${SLOT_POSITIONS[s]} one. Expect strange flying.`);
  const cam = parts.find(p => p.type === T('drone-camera')), camera = !!cam && same(key(cam.id, 'VID'), key(aio.id, 'CAM'));
  return { present: true, problems, fatal, slotOf, camera };
}
