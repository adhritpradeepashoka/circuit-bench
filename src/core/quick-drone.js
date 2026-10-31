// The instant drone builder: "build a drone circuit", "make a 5 inch quad", "set up an fpv whoop" are answered by rules, not a language
// model, because a drone circuit is about 25 exact wires and a small hosted model gets some of them wrong every time. This places the parts in
// tidy columns and wires them exactly as the part descriptions say (the same wiring drone-wiring.js checks). Parts already on the bench are reused;
// only what is missing is added, and wires that already exist are not doubled. Pure and DOM-free; actions go through the usual validation.

const T = id => `custom-${id}`;
const WORDS = /\b(drone|quad(?:copter)?|fpv|whoop|tinywhoop|multirotor)\b/;
const VERBS = /\b(build|make|create|set ?up|wire|wiring|circuit|add|design|need|want|give|how)\b/;

const same = (w, a, pa, b, pb) => { const f = w.from || w.a, t = w.to || w.b; return !!f && !!t && ((f.part === a && f.pin === pa && t.part === b && t.pin === pb) || (f.part === b && f.pin === pb && t.part === a && t.pin === pa)); };

export function quickDrone(instruction, circuit = { parts: [], wires: [] }) {
  const raw = String(instruction || '').trim();
  if (!raw || raw.length > 240) return null;
  const t = raw.toLowerCase().replace(/[!?]+$/, '').replace(/\s+/g, ' ');
  if (/\b(why|wrong|broken|not working|doesn'?t|won'?t|fix|error|problem|swap|reverse[sd]?|spins?)\b/.test(t)) return null;      // diagnosing a drone is for the model, which is told what the check found
  const parts = circuit.parts || [], has = type => parts.filter(p => p.type === T(type));
  const haveBoard = has('drone-aio').length || has('drone-esc').length;
  const wantsBuild = WORDS.test(t) && VERBS.test(t);
  const wantsWire = /\b(wire|connect|solder|hook)\b/.test(t) && /\bmotors?\b/.test(t) && haveBoard;
  if (!wantsBuild && !wantsWire) return null;
  const stack = has('drone-esc').length || has('drone-fc').length ? !has('drone-aio').length : /\b(stack|[5-9] ?(?:inch|in|")|1\d ?inch|large|big|long.?range|freestyle|race|racing|capacitor|elrs|receiver|vtx)\b/.test(t) && !/\b(aio|whoop)\b/.test(t);

  const actions = [], id = {};
  const bx = parts.length ? Math.round(Math.max(...parts.map(p => (p.x || 0) + 220)) / 10) * 10 + 40 : 40;
  const ensure = (key, type, x, y, wantId) => {
    const found = has(type)[0];
    if (found) { id[key] = found.id; return; }
    id[key] = wantId; actions.push({ op: 'add_part', id: wantId, type: T(type), x: bx + x, y });
  };
  // motors: output order M1…M4 (Betaflight: back right, front right, back left, front left)
  // On an AIO each motor sits beside its own output (M4 top left, M2 top right, M3 bottom left, M1 bottom right; right-hand ones turned round so their wires face the board),
  // so the wires run short and straight. A stack's four outputs are on one side, so there the motors stand in a column.
  const motors = has('drone-motor'), AIO_X = 290, spot = !stack ? { 1: [2 * AIO_X - 30, 40 + 160 - 42, 180], 2: [2 * AIO_X - 30, 40 + 40 - 42, 180], 3: [0, 40 + 160 - 42, 0], 4: [0, 40 + 40 - 42, 0] } : null;
  for (let k = 0; k < 4; k++) {
    if (motors[k]) { id[`m${k + 1}`] = motors[k].id; continue; }
    const [mx, my, rot] = spot ? spot[k + 1] : [0, 40 + k * 100, 0];
    id[`m${k + 1}`] = `motor${k + 1}`; actions.push({ op: 'add_part', id: `motor${k + 1}`, type: T('drone-motor'), x: bx + mx, y: my, ...(rot ? { rotate: rot } : {}) });
  }
  const wires = [], W = (a, pa, b, pb) => wires.push([a, pa, b, pb]);
  if (!stack) {
    ensure('aio', 'drone-aio', AIO_X, 40, 'aio'); ensure('bat', 'drone-battery', AIO_X + 5, 270, 'battery'); ensure('cam', 'drone-camera', AIO_X + 5, 370, 'camera');
    W('bat', '+', 'aio', 'BAT+'); W('bat', '-', 'aio', 'BAT-');
    W('cam', '5V', 'aio', '5V'); W('cam', 'GND', 'aio', 'G'); W('cam', 'VID', 'aio', 'CAM');
    for (let k = 1; k <= 4; k++) for (const l of 'ABC') W(`m${k}`, l, 'aio', `M${k}${l}`);
  } else {
    ensure('esc', 'drone-esc', 290, 40, 'esc'); ensure('fc', 'drone-fc', 540, 40, 'fc'); ensure('cap', 'drone-cap', 290, 260, 'cap'); ensure('bat', 'drone-battery', 290, 350, 'battery');
    ensure('cam', 'drone-camera', 540, 260, 'camera'); ensure('rx', 'drone-rx', 540, 370, 'receiver'); ensure('vtx', 'drone-vtx', 540, 480, 'vtx');
    W('bat', '+', 'esc', 'BAT+'); W('bat', '-', 'esc', 'BAT-'); W('cap', '+', 'esc', 'BAT+'); W('cap', '-', 'esc', 'BAT-');
    W('esc', '5V', 'fc', '5V'); W('esc', 'G', 'fc', 'G');
    for (let k = 1; k <= 4; k++) W('esc', `S${k}`, 'fc', `M${k}`);
    for (let k = 1; k <= 4; k++) for (const l of 'ABC') W(`m${k}`, l, 'esc', `M${k}${l}`);
    W('cam', '5V', 'fc', '5V'); W('cam', 'GND', 'fc', 'G'); W('cam', 'VID', 'fc', 'CAM');
    W('rx', '5V', 'fc', '5V'); W('rx', 'G', 'fc', 'G'); W('rx', 'TX', 'fc', 'RX1'); W('rx', 'RX', 'fc', 'TX1');
    W('vtx', 'VIN', 'fc', '5V'); W('vtx', 'G', 'fc', 'G'); W('vtx', 'VID', 'fc', 'VTX');
  }
  for (const [a, pa, b, pb] of wires) {
    if ((circuit.wires || []).some(w => same(w, id[a], pa, id[b], pb))) continue;
    actions.push({ op: 'add_wire', from: { part: id[a], pin: pa }, to: { part: id[b], pin: pb } });
  }
  if (!actions.length) return { actions: [], code: null, explanation: 'Everything for the drone is already on the bench and wired. Press the check in the Test tab, or ask me what to change.' };
  return {
    actions, code: null,
    explanation: stack
      ? `Here is a 5-inch style stack, wired the way a real one is: battery and the capacitor across the ESC's BAT+ and BAT−, the ESC's 5V and ground to the flight controller, S1–S4 to the flight controller's M1–M4, each motor's three wires to one ESC output (M1 back right, M2 front right, M3 back left, M4 front left), the camera, receiver and video transmitter to the flight controller. Next: build the frame in the Assembly tab, then fly it in Test.`
      : `Here is a small drone on one AIO board: battery to BAT+ / BAT−, each motor's three wires (A, B, C in order) to one motor output (M1 back right, M2 front right, M3 back left, M4 front left), and the camera to 5V, G and CAM. Next: build the frame in the Assembly tab, then fly it in Test. Say "make it a 5 inch stack" for a bigger build with a separate flight controller and ESC.`,
  };
}
