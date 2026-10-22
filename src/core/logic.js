// The "logic" behaviour: a part described as rules instead of being picked from a menu, so a chip nobody
// has coded support for — a shift register, a logic gate, a counter, a latch — can still be simulated.
//
// A part says what it remembers ("vars"), what changes it ("rules": when this happens, set that) and what it
// drives ("outputs": this pin = this expression). Every expression goes through src/core/expr.js, which is
// arithmetic on numbers and nothing else — no code from a spec is ever run. So a part written by a student,
// loaded from a shared project or invented by the AI is still only data.
//
// Levels are read relative to the part's own GND: a pin is 1 above half the supply. Outputs drive a rail
// (or volts, for a pin listed in "analog") through ~40 Ω, like a real CMOS output.
import { parseExpr, evalExpr } from './expr.js';

export const MIN_SUPPLY = 2;        // V — below this the chip is off and forgets everything
export const OUT_OHMS = 40;
const MAX_VARS = 16, MAX_RULES = 24, MAX_OUTPUTS = 32;
const VAR_RE = /^[A-Za-z_][A-Za-z0-9_]{0,23}$/;

const numOr = (v, d) => (Number.isFinite(+v) ? +v : d);

/**
 * Check a logic behaviour against the part's pins and pre-parse every expression.
 * @returns {{ok:true, behaviour:object}|{ok:false, errors:string[]}}
 */
export function validateLogicBehaviour(b, pinIds, roles) {
  const errors = [], pins = new Set(pinIds);
  const vars = {};
  const varsIn = b?.vars && typeof b.vars === 'object' ? b.vars : {};
  for (const [k, v] of Object.entries(varsIn).slice(0, MAX_VARS + 1)) {
    if (!VAR_RE.test(k)) { errors.push(`“${k}” isn't a usable memory name (letters, digits and _, starting with a letter).`); continue; }
    if (pins.has(k)) { errors.push(`“${k}” is already a pin name, so it can't also be a memory name.`); continue; }
    vars[k] = numOr(v, 0);
  }
  if (Object.keys(varsIn).length > MAX_VARS) errors.push(`At most ${MAX_VARS} memory values.`);

  const known = name => pins.has(name) || name in vars;
  const compile = (src, where) => {
    try {
      const { node, names, pins: refs } = parseExpr(src);
      for (const n of names) if (!known(n)) errors.push(`${where}: “${n}” is neither a pin nor a memory value.`);
      for (const p of refs) if (!pins.has(p)) errors.push(`${where}: there is no pin called “${p}”.`);
      return node;
    } catch (err) { errors.push(`${where}: ${err.message}`); return null; }
  };

  const rules = [];
  const rulesIn = Array.isArray(b?.rules) ? b.rules : [];
  if (rulesIn.length > MAX_RULES) errors.push(`At most ${MAX_RULES} rules.`);
  rulesIn.slice(0, MAX_RULES).forEach((r, i) => {
    const where = `Rule ${i + 1}`;
    const when = compile(r?.when ?? '1', `${where} (“when”)`);
    const sets = [];
    const setIn = r?.set && typeof r.set === 'object' ? r.set : {};
    if (!Object.keys(setIn).length) errors.push(`${where}: it doesn't set anything.`);
    for (const [k, expr] of Object.entries(setIn)) {
      if (!(k in vars)) { errors.push(`${where}: “${k}” isn't one of this part's memory values — add it to “vars”.`); continue; }
      const node = compile(expr, `${where} (setting ${k})`);
      if (node) sets.push({ name: k, node });
    }
    if (when && sets.length) rules.push({ when, sets, src: { when: String(r?.when ?? '1'), set: { ...setIn } } });
  });

  const outputs = [];
  const outIn = b?.outputs && typeof b.outputs === 'object' ? b.outputs : {};
  const analog = new Set((Array.isArray(b?.analog) ? b.analog : []).map(String));
  if (Object.keys(outIn).length > MAX_OUTPUTS) errors.push(`At most ${MAX_OUTPUTS} driven pins.`);
  for (const [pin, expr] of Object.entries(outIn).slice(0, MAX_OUTPUTS)) {
    if (!pins.has(pin)) { errors.push(`There is no pin called “${pin}” to drive.`); continue; }
    if (pin === roles?.vcc || pin === roles?.gnd) { errors.push(`${pin} is the power pin, so the part can't drive it.`); continue; }
    const node = compile(expr, `Output ${pin}`);
    if (node) outputs.push({ pin, node, analog: analog.has(pin) });
  }
  for (const a of analog) if (!outIn[a]) errors.push(`“${a}” is listed as an analog output but isn't driven.`);
  if (!outputs.length && !errors.length) errors.push('A logic part has to drive at least one pin (“outputs”).');

  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  return {
    ok: true,
    behaviour: {
      vars, analog: [...analog].filter(a => outIn[a]),
      rules: rules.map(r => r.src),
      outputs: Object.fromEntries(outputs.map(o => [o.pin, String(outIn[o.pin])])),
      compiled: { vars, rules, outputs },        // parsed trees, rebuilt on load — never stored in a project file
    },
  };
}

/** Parsed form for a spec that has already been validated (project load, AI reply). Returns null if it no longer checks out. */
export function compileLogic(spec) {
  const b = spec?.behaviour;
  if (!b || b.kind !== 'logic') return null;
  const v = validateLogicBehaviour(b, spec.pins.map(p => p.id), b.roles);
  return v.ok ? v.behaviour.compiled : null;
}

export const createLogicState = compiled => ({ vars: { ...compiled.vars }, last: null, powered: false });

/**
 * One moment in time: work out the levels, fire any rule whose "when" is true, and update the part's memory.
 * Call this whenever an input could have changed (CircuitBench calls it on every MCU pin change, so a
 * shift register sees every clock pulse exactly as the firmware sent it).
 * @param read (pinId) => volts, or null when nothing is connected
 */
export function tickLogic(compiled, state, roles, read) {
  const gnd = read(roles.gnd), vcc = read(roles.vcc);
  const supply = (vcc ?? 0) - (gnd ?? 0);
  if (!(supply >= MIN_SUPPLY)) {                       // no power: a real chip forgets its state
    if (state.powered) { state.vars = { ...compiled.vars }; state.last = null; }
    state.powered = false;
    return state;
  }
  const half = supply / 2, base = gnd ?? 0;
  const level = pin => { const v = read(pin); return v == null ? 0 : v - base > half ? 1 : 0; };
  const now = {};
  const levelOf = pin => (pin in now ? now[pin] : (now[pin] = level(pin)));
  const last = state.last;
  const ctx = {
    get: name => (name in state.vars ? state.vars[name] : levelOf(name)),
    pin: (fn, pin) => {
      if (fn === 'v') { const v = read(pin); return v == null ? 0 : v - base; }
      const cur = levelOf(pin), was = last ? last[pin] ?? cur : cur;
      return fn === 'rising' ? (cur && !was ? 1 : 0) : fn === 'falling' ? (!cur && was ? 1 : 0) : cur !== was ? 1 : 0;
    },
  };
  for (const rule of compiled.rules) {
    if (!evalExpr(rule.when, ctx)) continue;
    for (const s of rule.sets) {
      const value = evalExpr(s.node, ctx);
      state.vars[s.name] = Number.isFinite(value) ? value : 0;
    }
  }
  for (const pin of Object.keys(now)) now[pin] = levelOf(pin);
  state.last = now;
  state.powered = true;
  return state;
}

/**
 * What the part is driving right now, as volts relative to its own GND (null = that pin is left floating).
 * Pure: safe to call repeatedly while the circuit solver converges.
 */
export function logicDrive(compiled, state, roles, read) {
  const gnd = read(roles.gnd), vcc = read(roles.vcc);
  const supply = (vcc ?? 0) - (gnd ?? 0);
  const out = new Map();
  if (!(supply >= MIN_SUPPLY)) return out;
  const base = gnd ?? 0, half = supply / 2;
  if (roles.enable) { const e = read(roles.enable); if (e != null && e - base > half) return out; }   // active-low enable
  const ctx = {
    get: name => (name in state.vars ? state.vars[name] : (() => { const v = read(name); return v == null ? 0 : v - base > half ? 1 : 0; })()),
    pin: (fn, pin) => {
      if (fn === 'v') { const v = read(pin); return v == null ? 0 : v - base; }
      const cur = (() => { const v = read(pin); return v == null ? 0 : v - base > half ? 1 : 0; })();
      const was = state.last ? state.last[pin] ?? cur : cur;
      return fn === 'rising' ? (cur && !was ? 1 : 0) : fn === 'falling' ? (!cur && was ? 1 : 0) : cur !== was ? 1 : 0;
    },
  };
  for (const o of compiled.outputs) {
    const value = evalExpr(o.node, ctx);
    out.set(o.pin, o.analog ? Math.min(supply, Math.max(0, value)) : (value ? supply : 0));
  }
  return out;
}

/** A short plain-English summary of what the rules do, for the simulator tray and the AI. */
export function describeLogic(behaviour) {
  const rules = (behaviour.rules || []).map(r => `when ${r.when} → ${Object.entries(r.set).map(([k, v]) => `${k} = ${v}`).join(', ')}`);
  const outs = Object.entries(behaviour.outputs || {}).map(([p, e]) => `${p} = ${e}`);
  return [rules.length ? `Rules: ${rules.join('; ')}` : '', outs.length ? `Drives: ${outs.join('; ')}` : ''].filter(Boolean).join('. ');
}
