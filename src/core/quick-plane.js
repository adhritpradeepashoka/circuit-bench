// The instant plane builder: "build a flying wing with an EDF", "wire up my plane", "make a fixed wing circuit" are answered by rules, not a language model,
// for the same reason as quick-drone.js: it is about two dozen exact wires. Places the parts in tidy columns and wires them exactly as plane-wiring.js checks.
// The flight controller is GENERIC: a real board (a CoreWing F405 Wing Mini, say) names its pads differently, and the answer says so instead of pretending to know it.
const T = id => `custom-${id}`;
const WORDS = /\b(plane|airplane|aeroplane|fixed[- ]?wing|flying[- ]?wing|wing|edf|jet|glider|elevons?)\b/;
const VERBS = /\b(build|make|create|set ?up|wire|wiring|circuit|add|design|need|want|give|how)\b/;
const same = (w, a, pa, b, pb) => { const f = w.from || w.a, t = w.to || w.b; return !!f && !!t && ((f.part === a && f.pin === pa && t.part === b && t.pin === pb) || (f.part === b && f.pin === pb && t.part === a && t.pin === pa)); };

export function quickPlane(instruction, circuit = { parts: [], wires: [] }) {
  const raw = String(instruction || '').trim();
  if (!raw || raw.length > 240) return null;
  const t = raw.toLowerCase().replace(/[!?]+$/, '').replace(/\s+/g, ' ');
  if (/\b(why|wrong|broken|not working|doesn'?t|won'?t|fix|error|problem|swap|reverse[sd]?|spins?|check)\b/.test(t)) return null;      // diagnosing is for the model, which is told what the plane check found
  const parts = circuit.parts || [], has = type => parts.filter(p => p.type === T(type)), servosOn = parts.filter(p => p.type === 'servo');
  const haveBoard = has('plane-esc').length || has('plane-fc').length;
  const wantsBuild = WORDS.test(t) && VERBS.test(t), wantsWire = /\b(wire|connect|solder|hook)\b/.test(t) && /\b(motor|edf|esc|servos?)\b/.test(t) && haveBoard;
  if (!wantsBuild && !wantsWire) return null;
  const edf = /\b(edf|ducted|jet)\b/.test(t), actions = [], id = {};
  const bx = parts.length ? Math.round(Math.max(...parts.map(p => (p.x || 0) + 220)) / 10) * 10 + 40 : 40;
  const ensure = (key, type, x, y, wantId, extra = {}) => {
    const found = type === 'servo' ? null : has(type)[0];
    if (found) { id[key] = found.id; return; }
    id[key] = wantId; actions.push({ op: 'add_part', id: wantId, type: type === 'servo' ? 'servo' : T(type), x: bx + x, y, ...extra });
  };
  ensure('bat', 'drone-battery', 0, 60, 'battery'); ensure('esc', 'plane-esc', 250, 40, 'esc'); ensure('motor', 'plane-motor', 520, 30, 'motor');
  ensure('fc', 'plane-fc', 250, 230, 'fc'); ensure('rx', 'drone-rx', 520, 150, 'receiver');
  const sv = [];                                       // the servos already on the bench are reused; a flying wing has two elevons
  for (let k = 0; k < 2; k++) { if (servosOn[k]) { id[`s${k + 1}`] = servosOn[k].id; } else { id[`s${k + 1}`] = `elevon${k + 1}`; actions.push({ op: 'add_part', id: `elevon${k + 1}`, type: 'servo', x: bx + 520, y: 270 + k * 140 }); } sv.push(`s${k + 1}`); }
  const wires = [], W = (a, pa, b, pb) => wires.push([a, pa, b, pb]);
  W('bat', '+', 'esc', 'BAT+'); W('bat', '-', 'esc', 'BAT-');
  for (const l of 'ABC') W('motor', l, 'esc', l);
  W('esc', 'SIG', 'fc', 'MOT'); W('esc', '5V', 'fc', '5V'); W('esc', 'G', 'fc', 'G');
  W('rx', '5V', 'fc', '5V'); W('rx', 'G', 'fc', 'G'); W('rx', 'TX', 'fc', 'RX1'); W('rx', 'RX', 'fc', 'TX1');
  sv.forEach((s, k) => { W(s, 'PWM', 'fc', `S${k + 1}`); W(s, 'V+', 'esc', '5V'); W(s, 'GND', 'fc', 'G'); });
  for (const [a, pa, b, pb] of wires) {
    if ((circuit.wires || []).some(w => same(w, id[a], pa, id[b], pb))) continue;
    actions.push({ op: 'add_wire', from: { part: id[a], pin: pa }, to: { part: id[b], pin: pb } });
  }
  if (!actions.length) return { actions: [], code: null, explanation: 'Everything for the plane is already on the bench and wired. Look at the Plane check on the canvas, or ask me what to change.' };
  return {
    actions, code: null,
    explanation: `Here is a flying-wing circuit${edf ? ' with an EDF' : ''}: the battery to the ESC's BAT+ and BAT−, the motor${edf ? ' (the EDF\'s motor)' : ''} on the ESC's A, B, C in order, the ESC's SIG to the flight controller's MOT pad, and the ESC's 5V and ground to the flight controller, the receiver and both elevon servos (the servos' power comes from the ESC's 5V, never the battery). S1 is the left elevon and S2 the right. Two things to know: the flight controller here is generic, so on your real board (a CoreWing F405 Wing Mini, for example) the pads have other names: read its pinout and match each wire by its job before soldering. And check that your ESC has a 5 V output (a BEC): if it does not, power the flight controller and servos from a separate BEC.`,
  };
}
