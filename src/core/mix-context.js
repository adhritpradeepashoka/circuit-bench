// What a mixed project is FOR, worked out from the parts in it — so the interface can adapt instead of showing every panel all the time.
// A body source or a BioAmp in the circuit means there is a person to trigger and watch; a servo or a robot means something can move;
// an AI workspace means gestures can be trained. DOM-free, so tests can run it.
import { PART_DEFS } from './parts.js';
import { SITE } from './body-sites.js';

/** The parts that read the body: body-source blocks and amplifiers that take electrode sites (each one is a channel). */
export function bodyChannels(parts) {
  return parts.filter(p => {
    const kind = PART_DEFS[p.type]?.spec?.behaviour?.kind;
    return kind === 'signal-source' || (kind === 'inamp' && 'sp' in (PART_DEFS[p.type].props || {}));
  });
}
export const servoParts = parts => parts.filter(p => p.type === 'servo' || PART_DEFS[p.type]?.spec?.behaviour?.kind === 'servo');

/** Which held muscles a placed channel can see (limb events like flexR / fistL), by its electrode sites. */
export function channelMuscles(p) {
  const out = new Set();
  for (const id of [p.sp, p.sn]) { const s = SITE[id]; if (s?.limb) for (const k of Object.keys(s.limb)) if (s.limb[k] >= 0.5) out.add(k); }
  return [...out];
}

/** Short names for what a channel is on, for labels: "right biceps", "left forearm", "chest". */
export function channelLabel(p, i = 0) {
  const place = id => ({ bicep: 'biceps', tricep: 'triceps', delt: 'shoulder', flexor: 'forearm (flexors)', extensor: 'forearm (extensors)', ecg: 'chest' })[(id || '').split('-')[0]];
  const side = id => (/-R$/.test(id || '') ? 'right ' : /-L$/.test(id || '') ? 'left ' : '');
  const on = [p.sp, p.sn].find(id => SITE[id]?.frame === 'body' && place(id));
  return on ? `${side(on)}${place(on)}` : `Channel ${i + 1}`;
}

/**
 * The shape of the project.
 *   scenario: 'exo' (muscle → servo/robot joint), 'gesture' (a person to train on), 'monitor' (only watching signals), or '' (no body in the project)
 *   modules: which panels to show, in order: 'body' (trigger muscles), 'arm' (the joint), 'gesture' (train and recognise)
 */
export function mixContext(parts, ws = {}) {
  const channels = bodyChannels(parts), servos = servoParts(parts), hasBody = channels.length > 0;
  const mover = servos.length > 0 || !!ws.robotics, learns = !!ws.ml;
  const modules = [];
  if (hasBody) { modules.push('body'); if (mover) modules.push('arm'); if (learns) modules.push('gesture'); }
  const scenario = !hasBody ? '' : mover ? 'exo' : learns ? 'gesture' : 'monitor';
  const placed = channels.filter(p => p.sp && p.sn), covered = new Set(placed.flatMap(channelMuscles));
  const title = { exo: 'Muscle → movement', gesture: 'Gesture lab', monitor: 'The body', '': '' }[scenario] + (scenario === 'exo' && learns ? ' + gestures' : '');
  const next = !hasBody ? '' : !placed.length ? 'Place electrodes on the body first (or press “Place on right arm”).' : '';
  return { channels, servos, hasBody, mover, learns, scenario, modules, placed, covered: [...covered], title, next };
}

/** A sensible first placement: channel 1 on the right biceps, channel 2 on the right forearm, further channels on the left arm. Returns [{ id, sp, sn }] and the shared reference. */
export function suggestPlacement(channels) {
  const pairs = [['bicep-R', 'elbow-R'], ['flexor-R', 'wrist-R'], ['bicep-L', 'elbow-L'], ['flexor-L', 'wrist-L'], ['tricep-R', 'elbow-R'], ['extensor-R', 'wrist-R']];
  return { assign: channels.slice(0, pairs.length).map((p, i) => ({ id: p.id, sp: pairs[i][0], sn: pairs[i][1] })), ref: 'elbow-R' };
}
