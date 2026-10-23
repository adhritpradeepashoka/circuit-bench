// "Bench language": the tiny, strict command language the CircuitBench model speaks. The model turns a plainly worded
// request into a few short commands; this file turns the commands into real circuit actions and sketches — and refuses
// anything that is not valid, so a wrong guess can never put nonsense on the board. DOM-free.
//
//   add TYPE [xN] [key=value …]       add led color=red   ·   add resistor x3 ohms=330
//   del REF [all]                      del led-2   ·   del resistor all
//   set REF key=value [all]            set resistor-1 ohms=1000
//   wire REF PIN REF PIN               wire uno-1 9 resistor-1 1
//   blink PIN MS                       blink 9 500
//   build led|button|pot PIN           a ready LED+resistor / button / potentiometer circuit on that pin
//   defer                              "this needs a bigger AI"      ·   off     "outside what CircuitBench does"
// Commands are separated by ";". REF is a part id (led-2) or a part type (led).
import { PART_DEFS } from './parts.js';
import { blinkSketch } from './quick-edits.js';

const COLORS = new Set(['red', 'green', 'blue', 'yellow', 'orange', 'white']);
const BOARDS = ['arduino-uno', 'arduino-nano', 'arduino-mega'];
const PIN = /^(A\d{1,2}|\d{1,2})$/;
const name = t => PART_DEFS[t]?.name || t;

export function parseProgram(text) {
  const cmds = String(text || '').trim().split(/\s*;\s*/).filter(Boolean).map(c => c.split(/\s+/));
  return cmds.length && cmds.length <= 8 ? cmds : null;
}

/** → { kind:'edit', actions, code, explanation } | { kind:'defer' } | { kind:'off', explanation } | null (invalid → treat as defer) */
export function runProgram(text, circuit = { parts: [], wires: [] }) {
  const cmds = parseProgram(text); if (!cmds) return null;
  if (cmds.length === 1 && cmds[0][0] === 'defer') return { kind: 'defer' };
  if (cmds.length === 1 && cmds[0][0] === 'off') return { kind: 'off', explanation: 'I only help with your CircuitBench circuit and sketch — try asking me to add a part, change a value or build a simple circuit.' };

  const parts = (circuit.parts || []).map(p => ({ id: p.id, type: p.type }));       // grows as we plan additions
  const actions = [], said = []; let code = null;
  const board = () => parts.find(p => BOARDS.includes(p.type));
  const ids = type => parts.filter(p => p.type === type).map(p => p.id);
  const fresh = type => { let n = 1; const base = type.replace(/[^a-z0-9]/g, ''); while (parts.some(p => p.id === `${base}${n}`)) n++; return `${base}${n}`; };
  const addPart = (type, props = {}) => {
    const id = fresh(type); parts.push({ id, type });
    actions.push({ op: 'add_part', id, type, ...(Object.keys(props).length ? { props } : {}) }); return id;
  };
  const ref = r => parts.find(p => p.id === r)?.id || null;
  const refs = (r, all) => { const byId = ref(r); if (byId) return [byId]; const l = ids(r); return l.length === 1 || (all && l.length) ? l : null; };
  const pinOk = (id, pin) => !!PART_DEFS[parts.find(p => p.id === id)?.type]?.pinById?.has(String(pin));
  const wire = (a, pa, b, pb) => { if (!pinOk(a, pa) || !pinOk(b, pb)) return false; actions.push({ op: 'add_wire', from: { part: a, pin: String(pa) }, to: { part: b, pin: String(pb) } }); return true; };
  const gnd = b => PART_DEFS[parts.find(p => p.id === b)?.type]?.pins.find(p => /^GND/.test(p.id))?.id;
  const props = kv => { const o = {}; for (const s of kv) { const m = /^([a-z]+)=(-?[\w.]+)$/.exec(s); if (!m) return null; const [, k, v] = m; o[k] = k === 'color' ? v : +v; if (k !== 'color' && !Number.isFinite(o[k])) return null; } return o; };
  const okProps = (type, o) => o && Object.entries(o).every(([k, v]) => PART_DEFS[type]?.props && k in PART_DEFS[type].props && (k !== 'color' || COLORS.has(v)) && (k !== 'ohms' || (v > 0 && v <= 1e7)));

  for (const c of cmds) {
    const [op, ...a] = c;
    if (op === 'add') {
      const type = a[0]; if (!PART_DEFS[type] || BOARDS.includes(type)) return null;
      let n = 1, rest = a.slice(1); if (/^x\d+$/.test(rest[0] || '')) { n = +rest[0].slice(1); rest = rest.slice(1); }
      const p = props(rest); if (n < 1 || n > 10 || !okProps(type, p)) return null;
      for (let i = 0; i < n; i++) addPart(type, p);
      said.push(`Added ${n === 1 ? 'a' : n} ${name(type)}${n > 1 ? 's' : ''}${Object.keys(p).length ? ` (${Object.entries(p).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`);
    } else if (op === 'del') {
      const all = a.at(-1) === 'all', t = refs(a[0], all); if (!t) return null;
      for (const id of t) { actions.push({ op: 'remove_part', id }); parts.splice(parts.findIndex(p => p.id === id), 1); }
      said.push(`Removed ${t.join(', ')}`);
    } else if (op === 'set') {
      const all = a.at(-1) === 'all', t = refs(a[0], all), p = props(a.slice(1).filter(x => x !== 'all')); if (!t || !p || !Object.keys(p).length) return null;
      const type = parts.find(x => x.id === t[0]).type; if (!okProps(type, p)) return null;
      for (const id of t) for (const [k, v] of Object.entries(p)) actions.push({ op: 'set_prop', id, key: k, value: v });
      said.push(`Set ${t.join(', ')} ${Object.entries(p).map(([k, v]) => `${k} to ${v}`).join(', ')}`);
    } else if (op === 'wire') {
      const [ra, pa, rb, pb] = a, x = refs(ra, false), y = refs(rb, false); if (!x || !y || !wire(x[0], pa, y[0], pb)) return null;
      said.push(`Wired ${x[0]} ${pa} to ${y[0]} ${pb}`);
    } else if (op === 'blink') {
      const pin = String(a[0]).toUpperCase(), ms = +a[1]; if (!PIN.test(pin) || !(ms >= 10 && ms <= 60000)) return null;
      code = blinkSketch(pin, ms); said.push(`Wrote a sketch that blinks pin ${pin} every ${ms} ms`);
    } else if (op === 'build') {
      const kind = a[0], pin = String(a[1]).toUpperCase(), b = board()?.id; if (!b || !PIN.test(pin) || !pinOk(b, pin)) return null;
      const g = gnd(b); if (!g) return null;
      if (kind === 'led') {
        const led = addPart('led'), r = addPart('resistor', { ohms: 220 });
        if (!wire(b, pin, r, '1') || !wire(r, '2', led, 'A') || !wire(led, 'C', b, g)) return null;
        said.push(`Built an LED with a 220 Ω resistor on pin ${pin}`);
      } else if (kind === 'button') {
        const btn = addPart('pushbutton');
        if (!wire(btn, '1.l', b, pin) || !wire(btn, '2.l', b, g)) return null;
        code = `// Press the button (pin ${pin} to GND) to light the built-in LED on pin 13.\nvoid setup() {\n  pinMode(${pin}, INPUT_PULLUP);\n  pinMode(13, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(13, digitalRead(${pin}) == LOW ? HIGH : LOW);\n}\n`;
        said.push(`Built a button on pin ${pin} that lights the built-in LED`);
      } else if (kind === 'pot') {
        if (!/^A\d/.test(pin)) return null;
        const pot = addPart('potentiometer'), five = PART_DEFS[parts.find(p => p.id === b).type].pins.find(p => p.id === '5V')?.id;
        if (!five || !wire(pot, 'SIG', b, pin) || !wire(pot, 'VCC', b, five) || !wire(pot, 'GND', b, g)) return null;
        code = `// Read the potentiometer on ${pin} and print it.\nvoid setup() {\n  Serial.begin(9600);\n}\n\nvoid loop() {\n  Serial.println(analogRead(${pin}));\n  delay(100);\n}\n`;
        said.push(`Built a potentiometer on ${pin} and a sketch that prints its value`);
      } else return null;
    } else return null;
  }
  return { kind: 'edit', actions, code, explanation: `${said.join('. ')}.` };
}

/* ── adapter between a real circuit and the model ─────────────────────────────────────────────
 * The model never sees the editor's random part ids (led-k3j2a). It sees tidy numbered ones (led-1, led-2, uno-1) and answers in
 * those; we translate back to the real ids before anything touches the board. */
const PREFIX = { 'arduino-uno': 'uno', 'arduino-nano': 'nano', 'arduino-mega': 'mega', breadboard: 'bb' };
export function canonicalIds(circuit) {
  const n = {}, toReal = new Map(), toCanon = new Map();
  for (const p of circuit?.parts || []) {
    const base = PREFIX[p.type] || p.type; n[base] = (n[base] || 0) + 1;
    const c = `${base}-${n[base]}`; toReal.set(c, p.id); toCanon.set(p.id, c);
  }
  return { toReal, toCanon };
}
/** The part list as the model reads it: "uno-1 led-1 led-2". */
export const stateString = circuit => [...canonicalIds(circuit).toCanon.values()].slice(0, 24).join(' ');
/** Run a program written in the model's numbered ids against the real circuit; the result speaks in real ids. */
export function runForCircuit(program, circuit) {
  const { toReal, toCanon } = canonicalIds(circuit);
  const canonical = { parts: (circuit?.parts || []).map(p => ({ ...p, id: toCanon.get(p.id) })), wires: [] };
  const r = runProgram(program, canonical);
  if (!r || r.kind !== 'edit') return r;
  const real = id => toReal.get(id) ?? id;
  const actions = r.actions.map(a => ({ ...a, ...(a.id ? { id: real(a.id) } : {}), ...(a.from ? { from: { ...a.from, part: real(a.from.part) } } : {}), ...(a.to ? { to: { ...a.to, part: real(a.to.part) } } : {}) }));
  return { ...r, actions };
}
