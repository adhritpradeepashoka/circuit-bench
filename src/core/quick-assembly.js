// The instant assistant for the 3D Assembly view: plain requests like "put motors on", "add props", "put the servo in place" become
// the same checked edits the AI would send (assembly-actions.js), with no model, no key and no network. It never guesses where a
// part goes: it only joins holes it knows pair up (motor mounts to a frame's motor mounts, a prop's bore to a motor shaft, a servo
// to the bracket holes of the same size). Anything it is not sure about returns null so a real AI can take over.
// Pure and DOM-free. `scene` = { instances:[{ id, part, name, kind, frames:[holeId…], wheelbase?, tri? }], mates:[{ a:{inst,frame}, b:{inst,frame} }], catalog:[{ id, name, category }] }.

const TIPS = ['fr', 'fl', 'bl', 'br'];
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
// a sensible motor for a frame of this size (the student can change it in the part's panel afterwards)
const motorFor = wheelbase => (wheelbase < 100 ? 'motor-0802-19000' : wheelbase < 180 ? 'motor-1404-3800' : wheelbase < 260 ? 'motor-2207-1900' : 'motor-2806-1300');
const bore = dia => (dia <= 1.8 ? 1 : dia <= 2.6 ? 1.5 : dia <= 3.2 ? 2 : dia <= 4.2 ? 3 : 5);
const propFor = wheelbase => (wheelbase < 100 ? 'prop-1.2x1.2x3-b1' : wheelbase < 180 ? 'prop-3x3x3-b2' : wheelbase < 260 ? 'prop-5x4.3x3-b5' : 'prop-7x4x3-b5');

const usedHoles = scene => { const s = new Set(); for (const m of scene.mates || []) { s.add(`${m.a.inst}:${m.a.frame}`); s.add(`${m.b.inst}:${m.b.frame}`); } return s; };
const joinedTo = (scene, inst, hole) => (scene.mates || []).some(m => (m.a.inst === inst && m.a.frame === hole) || (m.b.inst === inst && m.b.frame === hole));
const nextId = (scene, base, taken) => { let k = 1; const ids = new Set([...(scene.instances || []).map(i => i.id), ...taken]); while (ids.has(`${base}${k}`)) k++; return `${base}${k}`; };
const ofKind = (scene, kind) => (scene.instances || []).filter(i => i.kind === kind);
const num = (t, re) => { const m = re.exec(t); return m ? Number(m[1]) : null; };

/** "prop 5 x 4.3 x 3", "5x4.3x3 props", "prop-5x4.3x3-b5" → an id, or null */
export function parsePropId(text) {
  let m = /prop-([\d.]+)x([\d.]+)x(\d)(?:-b([\d.]+))?/.exec(text);
  if (m) return `prop-${+m[1]}x${+m[2]}x${m[3]}-b${m[4] ? +m[4] : bore(+m[1])}`;
  m = /(\d+(?:\.\d+)?)\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)\s*(?:x|×|by)\s*(\d)\b/.exec(text);
  return m ? `prop-${+m[1]}x${+m[2]}x${m[3]}-b${bore(+m[1])}` : null;
}
/** "2207 1900kv motors", "motor-2207-1900" → an id, or null */
export function parseMotorId(text) {
  let m = /motor-(\d{4})-(\d{3,6})/.exec(text); if (m) return `motor-${m[1]}-${m[2]}`;
  m = /\b(\d{4})\b[^\d]{0,6}(\d{3,6})\s*kv\b/.exec(text) || /\b(\d{4})\s*(?:motors?)?\b[^\d]{0,4}(\d{3,6})\s*kv/.exec(text);
  return m ? `motor-${m[1]}-${m[2]}` : null;
}

const MOUNT_WORDS = /\b(put|place|add|attach|mount|fit|install|stick|put on|set|join|connect)\b/;

/** → { actions, explanation } or null when this is not something the instant assistant is sure about. */
export function quickAssembly(instruction, scene) {
  const t = String(instruction || '').toLowerCase().replace(/[“”"]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 200 || !scene || !Array.isArray(scene.instances)) return null;
  if (!MOUNT_WORDS.test(t) && !/\b(on|in place|onto)\b/.test(t)) return null;
  if (/\?$|^(why|what|how|which|can you|could you explain)\b/.test(t)) return null;
  const frames = ofKind(scene, 'frame'), motors = ofKind(scene, 'motor'), props = ofKind(scene, 'prop');
  const wantsMotor = /\bmotors?\b/.test(t) && !/\bprops?\b.*\b(on|onto|to)\b.*\bmotors?\b/.test(t) && !/\bon (?:the |all )?motors?\b/.test(t);
  const wantsProp = /\b(props?|propellers?|blades?)\b/.test(t);
  const actions = [], said = [], taken = [];

  // ── motors onto a frame's motor mounts
  if (wantsMotor && !wantsProp) {
    if (!frames.length) return { actions: [], explanation: 'There is no frame in the scene yet. Add a frame first, then I can put the motors on its arms.' };
    const frame = frames[0], free = TIPS.filter(n => !joinedTo(scene, frame.id, `${n}-1-top`) && frame.frames.includes(`${n}-1-top`));
    if (!free.length) return { actions: [], explanation: 'Every motor mount on the frame already has a motor.' };
    const asked = num(t, new RegExp(`\\b(\\d|${Object.keys(WORDS).join('|')})\\b(?=\\s*(?:drone )?motors?)`)), n = /\ball\b|\bfour\b|\b4\b/.test(t) || asked == null ? free.length : Math.min(free.length, WORDS[asked] || +asked || free.length);
    const id = parseMotorId(t) || (motors[0] && motors[0].part) || motorFor(frame.wheelbase || 220);
    for (const tip of free.slice(0, n)) {
      const mid = nextId(scene, 'motor', taken); taken.push(mid);
      actions.push({ op: 'add_part', id: mid, part: id }, { op: 'join', a: { id: frame.id, hole: `${tip}-1-top` }, b: { id: mid, hole: 'mount-1' } });
    }
    return { actions, explanation: `Putting ${actions.length / 2} ${id.replace('motor-', '')} motor${actions.length > 2 ? 's' : ''} on the frame's arms. Press Apply to see them.` };
  }

  // ── props onto the motors' shafts
  if (wantsProp) {
    if (!motors.length) return { actions: [], explanation: 'There are no motors in the scene yet. Put the motors on the frame first, then I can put props on them.' };
    const bare = motors.filter(m => !joinedTo(scene, m.id, 'shaft'));
    if (!bare.length) return { actions: [], explanation: 'Every motor already has a prop.' };
    const frame = frames[0], id = parsePropId(t) || (props[0] && props[0].part) || propFor(frame?.wheelbase || 220);
    for (const m of bare) { const pid = nextId(scene, 'prop', taken); taken.push(pid); actions.push({ op: 'add_part', id: pid, part: id }, { op: 'join', a: { id: m.id, hole: 'shaft' }, b: { id: pid, hole: 'bore-bottom' } }); }
    return { actions, explanation: `Putting ${id.replace('prop-', 'a ').replace(/-b[\d.]+$/, '')} prop on ${bare.length === 1 ? 'the motor' : `each of the ${bare.length} motors`}. Press Apply to see them.` };
  }

  // ── a servo into place on a bracket (same-size holes only)
  if (/\bservos?\b/.test(t)) {
    const servoPart = (scene.catalog || []).find(p => /servo/i.test(`${p.id} ${p.name}`)) || null;
    const servo = scene.instances.find(i => /servo/i.test(`${i.part} ${i.name}`));
    const targets = scene.instances.filter(i => /bracket|leg|mount|holder/i.test(`${i.part} ${i.name}`) && i !== servo);
    if (!servo && !servoPart) return { actions: [], explanation: 'I can’t find a servo part in the list. Add one from the parts library first.' };
    if (targets.length !== 1) return { actions: [], explanation: targets.length ? 'There is more than one bracket in the scene. Tell me which one the servo goes on, for example “put the servo on the left bracket”.' : 'There is no bracket in the scene for the servo to go in. Add one first.' };
    return null;      // which holes pair up depends on the part, so the AI (which can read the hole sizes) takes it from here
  }
  return null;
}
