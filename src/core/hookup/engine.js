// The hookup planner's engine: given the bench as it is and what the student asked for, it
//   1. SCANS the bench (through the real netlist, so parts seated in a breadboard count) for the board and for each part,
//   2. adds what is missing — a board, the part itself, a resistor, a driver —  and lays it out where nothing overlaps,
//   3. wires only what is not wired yet (power, ground, the bus or one signal pin chosen for THIS board), and
//   4. writes the sketch that goes with it.
// Recipes (recipes.js) say WHAT a part needs; this file does the how. It only ever produces the same edit actions the AI does,
// so every result goes through the same validation as any other edit. Pure and DOM-free.
import { PART_DEFS } from '../parts.js';
import { BOARD_SPECS, mainBoard } from '../boards.js';
import { PWM_PINS } from '../bench-devices.js';
import { compile } from '../netlist.js';
import { Sketch } from './sketch.js';

export class PlanError extends Error { constructor(message, code = 'plan') { super(message); this.code = code; } }

const NAME = { 'arduino-uno': 'Arduino Uno', 'arduino-nano': 'Arduino Nano', 'arduino-mega': 'Arduino Mega' };
const WIRE_COLOR = { v5: '#d9534f', v33: '#e8833a', vin: '#b5413d', gnd: '#2b2f33', sda: '#2e86de', scl: '#d4a017' };
const SIGNAL_COLORS = ['#2e86de', '#27ae60', '#8e44ad', '#e67e22', '#16a085', '#c0392b', '#7f8c8d', '#d35400'];
const GAP = 28, COL_GAP = 90, PAD = 70;

const pinText = n => (/^A\d+$/.test(n) ? n : `pin ${n}`);
const rotDims = p => ((((p.rot ?? p.rotate) || 0) % 180) === 90 ? { w: p.h, h: p.w } : { w: p.w, h: p.h });

export function createPlanner(circuitIn, opts = {}) {
  const inParts = (circuitIn?.parts || []).filter(p => PART_DEFS[p.type]);
  const inWires = (circuitIn?.wires || []).map(w => (w.a ? w : { ...w, a: w.from, b: w.to })).filter(w => w.a && w.b);
  const state0 = { parts: inParts.map(p => ({ ...p, rot: p.rot ?? p.rotate ?? 0 })), wires: inWires.map(w => ({ ...w, a: { ...w.a }, b: { ...w.b } })) };
  let net0 = null;
  if (state0.parts.length) { try { net0 = compile(state0); } catch { net0 = null; } }

  const handles = state0.parts.map(p => ({ id: p.id, type: p.type, def: PART_DEFS[p.type], x: p.x || 0, y: p.y || 0, w: PART_DEFS[p.type].w, h: PART_DEFS[p.type].h, rot: p.rot, isNew: false, props: p }));
  const actions = [], checks = [], notes = [], said = [], claimed = new Set();
  const sketch = new Sketch();
  const usedPins = new Set();                       // board pins that carry something already (existing wires + what we hand out)
  const usedIds = new Set(handles.map(h => h.id));
  const dirs = {};                                 // what the sketch does with each pin it was given: 'out' | 'in' | 'io'
  const setDir = (name, d) => { dirs[name] = dirs[name] === 'out' || d === 'out' ? 'out' : dirs[name] === 'io' || d === 'io' ? 'io' : 'in'; };
  const wired = new Set();                          // "partId|pin" we wired in this plan (so we never wire a pin twice to the same thing)
  let board = null, boardAdded = false, colorIdx = 0;

  // ── scanning ──────────────────────────────────────────────────────────────────────────────────
  const netOf = (h, pin) => (!h.isNew && net0 ? net0.netOf(h.id, String(pin)) : undefined);
  const boardPinsOn = n => (n === undefined || !net0 ? [] : net0.uno.pins.filter(p => p.net === n));
  const railOn = n => (n === undefined || !net0 ? null : net0.uno.gnd.has(n) ? 'gnd' : net0.uno.v5.has(n) ? 'v5' : net0.uno.v33.has(n) ? 'v33' : net0.uno.vin.has(n) ? 'vin' : null);
  const lone = (h, pin) => { const n = netOf(h, pin); return n === undefined || net0.nets[n].keys.length === 1; };
  if (net0) for (const p of net0.uno.pins) if (net0.nets[p.net].keys.length > 1) usedPins.add(p.name);
  for (const h of handles) if (BOARD_SPECS[h.type] && !board && h.id === mainBoard(state0.parts)?.id) board = h;

  /** The board pin a net reaches, straight or through up to two resistors (an LED's own series resistor). */
  function reach(n) {
    if (n === undefined || !net0) return null;
    const direct = boardPinsOn(n); if (direct.length) return direct.find(p => !/^A\d/.test(p.name)) || direct[0];
    const res = net0.elements.filter(e => e.kind === 'R' && state0.parts.find(q => q.id === e.partId)?.type === 'resistor');
    let frontier = [n]; const seen = new Set(frontier);
    for (let hop = 0; hop < 2; hop++) {
      const next = [];
      for (const r of res) for (const [a, b] of [[r.a, r.b], [r.b, r.a]]) if (frontier.includes(a) && !seen.has(b)) { seen.add(b); next.push(b); const f = boardPinsOn(b); if (f.length) return f[0]; }
      frontier = next;
    }
    return null;
  }

  // ── ids, placement ────────────────────────────────────────────────────────────────────────────
  const baseName = type => type.replace(/^custom-/, '').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 14) || 'part';
  const freshId = type => { const b = baseName(type); let n = 1; while (usedIds.has(`${b}${n}`)) n++; usedIds.add(`${b}${n}`); return `${b}${n}`; };

  const layout = (() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const h of handles) { const d = rotDims(h); minX = Math.min(minX, h.x); minY = Math.min(minY, h.y); maxX = Math.max(maxX, h.x + d.w); maxY = Math.max(maxY, h.y + d.h); }
    const empty = !handles.length;
    return { x: empty ? PAD : maxX + PAD + 20, y: empty ? PAD : minY, top: empty ? PAD : minY, colW: 0, cur: empty ? PAD : minY, limit: 0 };
  })();
  function place(h) {
    const d = rotDims(h);
    if (layout.limit === 0) layout.limit = layout.top + 560;
    if (layout.cur > layout.top && layout.cur + d.h > layout.limit) { layout.x += layout.colW + COL_GAP; layout.cur = layout.top; layout.colW = 0; }
    h.x = Math.round(layout.x); h.y = Math.round(layout.cur);
    layout.cur += d.h + GAP; layout.colW = Math.max(layout.colW, d.w);
    if (BOARD_SPECS[h.type]) { layout.limit = Math.max(layout.limit, layout.top + d.h + 40); }
  }

  // ── adding parts ──────────────────────────────────────────────────────────────────────────────
  function addNew(type, props = {}) {
    const def = PART_DEFS[type]; if (!def) throw new PlanError(`There is no part called "${type}".`, 'unknown-part');
    const id = freshId(type), h = { id, type, def, x: 0, y: 0, w: def.w, h: def.h, rot: 0, isNew: true, props };
    handles.push(h); place(h);
    const clean = {}; for (const [k, v] of Object.entries(props)) if (def.props && k in def.props) clean[k] = v;
    actions.push({ op: 'add_part', id, type, x: h.x, y: h.y, rotate: 0, ...(Object.keys(clean).length ? { props: clean } : {}) });
    return h;
  }

  /** The board: the one on the bench, or a new one (the student's choice, else an Uno). */
  function getBoard(want = null) {
    if (board) return board;
    const type = BOARD_SPECS[want] ? want : opts.board && BOARD_SPECS[opts.board] ? opts.board : 'arduino-uno';
    board = addNew(type); boardAdded = true; claimed.add(board.id);
    return board;
  }
  const spec = () => BOARD_SPECS[getBoard().type];

  /** Find `type` on the bench (a part already wired wins, so we finish what the student started) or add one. */
  function part(type, { props = {}, fresh = opts.forceNew } = {}) {
    if (!fresh) {
      const cands = handles.filter(h => h.type === type && !h.isNew && !claimed.has(h.id));
      const score = h => h.def.pins.filter(p => { const n = netOf(h, p.id); return n !== undefined && net0.nets[n].keys.length > 1; }).length;
      cands.sort((a, b) => score(b) - score(a));
      if (cands[0]) { claimed.add(cands[0].id); return cands[0]; }
    }
    const h = addNew(type, props); claimed.add(h.id); return h;
  }
  const existing = (type) => handles.filter(h => h.type === type && !h.isNew && !claimed.has(h.id));

  // ── board pins ────────────────────────────────────────────────────────────────────────────────
  const boardPinIds = () => getBoard().def.pins.filter(p => !p.noInsert).map(p => p.id);
  const railPin = kind => {
    const b = getBoard();
    const re = { gnd: /^GND(\.\d+)?$/, v5: /^5V(\.\d+)?$/, v33: /^3\.3V$/, vin: /^VIN$/ }[kind];
    const id = boardPinIds().find(i => re.test(i)); if (!id) throw new PlanError(`The ${NAME[b.type]} has no ${kind} pin.`, 'no-rail');
    return id;
  };
  const AVOID = () => { const s = spec(); return new Set(['0', '1', s.i2c.sda, s.i2c.scl]); };
  const isNano = () => getBoard().type === 'arduino-nano';
  function candidates(kind, order) {
    const b = getBoard(), s = spec(), pins = Object.keys(s.pins);
    const digital = pins.filter(n => /^\d+$/.test(n)).map(Number).sort((a, c) => a - c).map(String);
    const analog = pins.filter(n => /^A\d+$/.test(n) && s.pins[n].adc !== undefined && !(isNano() && /^A[67]$/.test(n)));
    const pwm = PWM_PINS[b.type] || new Set();
    if (kind === 'analog') return analog;
    if (kind === 'pwm') { const p = digital.filter(n => pwm.has(n)); const pref = ['11', '6', '5', '3', '9', '10'];      // 9 and 10 last: the Servo library takes Timer1 and with it PWM on those two
      return order === 'high' ? p.reverse() : [...pref.filter(n => p.includes(n)), ...p.filter(n => !pref.includes(n))]; }
    const plain = digital.filter(n => !pwm.has(n)), pw = digital.filter(n => pwm.has(n));        // PWM pins are scarce: hand them out last
    const dig = order === 'high' ? [...plain.reverse(), ...pw.reverse()] : [...plain, ...pw];
    return [...dig, ...(isNano() ? analog.filter(n => /^A[0-5]$/.test(n)) : analog)];       // analog pins double as digital ones when the real ones run out
  }
  /** A free board pin of the wanted kind ('digital' | 'pwm' | 'analog'); `order: 'high'` counts down from 13 (LED convention). */
  function freePin(kind, { order = 'low', exclude = [] } = {}) {
    const avoid = AVOID();
    const pool = candidates(kind, order).filter(n => !usedPins.has(n) && !exclude.includes(n));
    const pick = pool.find(n => !avoid.has(n)) ?? pool[0];
    if (!pick) throw new PlanError(`There is no free ${kind === 'analog' ? 'analog' : kind === 'pwm' ? 'PWM' : 'digital'} pin left on the ${NAME[getBoard().type]} for all of that at once — ask for fewer parts together${getBoard().type === 'arduino-mega' ? '' : ' or use a Mega'}.`, 'no-pin');
    usedPins.add(pick); return pick;
  }

  // ── wiring ────────────────────────────────────────────────────────────────────────────────────
  const pinOf = (h, p) => { if (!h.def.pinById.has(String(p))) throw new PlanError(`${h.def.name} has no pin "${p}".`, 'bad-pin'); return String(p); };
  function rawWire(a, pa, b, pb, color) {
    pa = pinOf(a, pa); pb = pinOf(b, pb);
    const key = [`${a.id}|${pa}`, `${b.id}|${pb}`].sort().join('~'); if (wired.has(key)) return false; wired.add(key);
    actions.push({ op: 'add_wire', from: { part: a.id, pin: pa }, to: { part: b.id, pin: pb }, color: color || SIGNAL_COLORS[colorIdx++ % SIGNAL_COLORS.length] });
    return true;
  }
  const describe = (h) => `${h.def.name.replace(/ \(.*$/, '')}`;
  const record = (h, pin, expect, text) => { checks.push({ part: h.id, pin: String(pin), expect }); if (!h.quiet) sketch.wiring.push(`${describe(h)} ${pin} → ${text}`); };

  /** Join part pin → the board's power rail ('v5' | 'v33' | 'vin' | 'gnd'), unless it is on a rail already. */
  function rail(h, pin, kind) {
    const b = getBoard(), n = netOf(h, pin), now = railOn(n);
    const label = { v5: '5V', v33: '3.3V', vin: 'VIN', gnd: 'GND' }[kind];
    if (now === kind) { record(h, pin, kind, label); return; }
    if (now && now !== kind) { notes.push(`${describe(h)} ${pin} is already on ${{ v5: '5V', v33: '3.3V', vin: 'VIN', gnd: 'GND' }[now]}, so I left it there.`); checks.push({ part: h.id, pin: String(pin), expect: now }); return; }
    rawWire(h, pin, b, railPin(kind), WIRE_COLOR[kind]); record(h, pin, kind, label);
  }
  const power = (h, pin, kind = 'v5') => rail(h, pin, kind);
  const ground = (h, pin) => rail(h, pin, 'gnd');

  /**
   * Join part pin → a board pin of the wanted kind, reusing the pin it is already wired to. Returns the pin NAME ("13", "A0").
   * kind: 'digital' | 'pwm' | 'analog'; order/prefer: which end to take free pins from.
   */
  function hook(h, pin, kind = 'digital', { order = 'low', prefer = null, exclude = [], label = null, dir = 'in' } = {}) {
    const b = getBoard(), n = netOf(h, pin), onNet = boardPinsOn(n);
    if (onNet.length) {
      const p = onNet.find(q => kind === 'analog' ? q.adc !== undefined : true) || null;
      if (!p) throw new PlanError(`${describe(h)} ${pin} is wired to ${onNet[0].name}, which can't read an analog value — move that wire to A0–A5 and ask again.`, 'wrong-pin');
      usedPins.add(p.name); setDir(p.name, dir); record(h, pin, `pin:${p.name}`, pinText(p.name)); return p.name;
    }
    let name = null;
    if (prefer) { const list = [].concat(prefer).map(String); const ok = q => !usedPins.has(q) && candidates(kind, order).includes(q), pw = PWM_PINS[b.type] || new Set();
      name = kind === 'digital' ? (list.find(q => ok(q) && !pw.has(q)) ?? candidates(kind, order).find(q => !usedPins.has(q) && !exclude.includes(q) && !pw.has(q) && !AVOID().has(q) && /^\d+$/.test(q)) ?? list.find(ok) ?? null) : list.find(ok) ?? null; if (name) usedPins.add(name); }
    name ??= freePin(kind, { order, exclude });
    rawWire(h, pin, b, name); setDir(name, dir); record(h, pin, `pin:${name}`, label || pinText(name)); return name;
  }
  /** The board's I²C pair, joined to the part's SDA/SCL pins. */
  function bus(h, sdaPin, sclPin) {
    const b = getBoard(), s = spec();
    for (const [pin, name, kind] of [[sdaPin, s.i2c.sda, 'sda'], [sclPin, s.i2c.scl, 'scl']]) {
      const n = netOf(h, pin), onNet = boardPinsOn(n);
      if (onNet.some(p => p.name === name)) { record(h, pin, `pin:${name}`, name); usedPins.add(name); setDir(name, 'io'); continue; }
      if (onNet.length) { notes.push(`${describe(h)} ${pin} is wired to ${onNet[0].name}, not to the I²C pin ${name}.`); checks.push({ part: h.id, pin: String(pin), expect: `pin:${onNet[0].name}` }); continue; }
      usedPins.add(name); setDir(name, 'io');
      // Mega: the header pins are labelled SDA / SCL (the same net as 20 / 21)
      const boardPin = b.type === 'arduino-mega' ? (kind === 'sda' ? 'SDA' : 'SCL') : name;
      rawWire(h, pin, b, boardPin, WIRE_COLOR[kind]); record(h, pin, `pin:${name}`, name);
    }
  }
  /** Join two parts pin to pin (no board). Existing parts already joined are left alone. */
  function join(a, pa, b, pb, { color = null, text = null } = {}) {
    if (!a.isNew && !b.isNew && net0) { const x = netOf(a, pa), y = netOf(b, pb); if (x !== undefined && x === y) { checks.push({ part: a.id, pin: String(pa), expect: `with:${b.id}|${pb}` }); return; } }
    rawWire(a, pa, b, pb, color);
    checks.push({ part: a.id, pin: String(pa), expect: `with:${b.id}|${pb}` });
    if (!a.quiet && !b.quiet) sketch.wiring.push(`${describe(a)} ${pa} → ${text || `${describe(b)} ${pb}`}`);
  }
  /**
   * A helper part (resistor, diode, battery, LED…) that hangs off the part we are building. If the bench already has one of that
   * type wired to the same spot, it IS the helper (so asking twice builds nothing twice); otherwise a new one is added.
   * `links` = [[helperPin, otherHandle, otherPin], …]: the helper counts as already there when one of those pins shares a net with
   * the other part's pin (a net that is only a power rail doesn't count on its own — too many things hang on a rail).
   */
  function helper(type, links = [], { props = {}, accept = null, stray = null } = {}) {
    for (const cand of handles.filter(h => h.type === type && !h.isNew && !claimed.has(h.id))) {
      const hit = links.filter(([hp, other, op]) => { const a = netOf(cand, hp), b = netOf(other, op); return a !== undefined && a === b; });
      if (!hit.length) continue;
      if (!hit.some(([hp]) => !railOn(netOf(cand, hp))) && hit.length !== links.length) continue;
      if (accept && !accept(cand)) continue;
      claimed.add(cand.id); cand.quiet = true; return cand;
    }
    // nothing wired to the spot, but a loose one of the right value is lying on the bench: use it rather than add a twin
    for (const cand of handles.filter(h => h.type === type && !h.isNew && !claimed.has(h.id))) {
      if (!cand.def.pins.every(p => lone(cand, p.id)) && !(stray && stray(cand))) continue;
      if (!Object.entries(props).every(([k, v]) => cand.props?.[k] === v)) continue;
      if (accept && !accept(cand)) continue;
      claimed.add(cand.id); cand.quiet = true; return cand;
    }
    const h = addNew(type, props); claimed.add(h.id); h.quiet = true; return h;
  }
  /** A resistor with one lead on part pin (h, pin). → { r, near, far }: near = the lead on that pin, far = the other. far: 'pin' (not a rail) | 'gnd' | 'v5' | null */
  function resistorAt(h, pin, ohms = 220, far = null) {
    const nets = r => [netOf(r, '1'), netOf(r, '2')];
    const farOk = r => {
      if (!far) return true;
      const [a, b] = nets(r), here = netOf(h, pin), other = a === here ? b : a;
      if (other === undefined) return true;                     // the far lead is loose: ours to finish
      return far === 'pin' ? !railOn(other) : railOn(other) === far;
    };
    // a resistor hanging from a board pin with its other lead loose (the pin half of a circuit someone started) is ours to finish
    const hanging = r => { const ends = ['1', '2'].map(e => ({ e, n: netOf(r, e) })); const onPin = ends.filter(x => x.n !== undefined && boardPinsOn(x.n).length), loose = ends.filter(x => x.n === undefined || net0.nets[x.n].keys.length === 1); return far === 'pin' && onPin.length === 1 && loose.length === 1; };
    const r = helper('resistor', [['1', h, pin], ['2', h, pin]], { props: { ohms }, accept: farOk, stray: hanging });
    const here = netOf(h, pin), loose = e => netOf(r, e) === undefined || net0?.nets[netOf(r, e)]?.keys.length === 1;
    const near = r.isNew ? '2' : here !== undefined && netOf(r, '1') === here ? '1' : here !== undefined && netOf(r, '2') === here ? '2' : loose('2') ? '2' : loose('1') ? '1' : '2';
    return { r, near, far: near === '1' ? '2' : '1' };
  }
  /** board pin ──[ohms]── part pin. Returns the board pin's name. A part pin already on a board pin (with or without a resistor) keeps it. */
  function drive(h, pin, kind, { ohms = 220, ...o } = {}) {
    const here = netOf(h, pin);
    if (here !== undefined && boardPinsOn(here).length) return hook(h, pin, kind, o);
    const { r, near, far } = resistorAt(h, pin, ohms, 'pin');
    const name = hook(r, far, kind, o); join(r, near, h, pin);
    return name;
  }
  /** part pin ──[ohms]── power rail ('gnd' | 'v5' | …): a pull-up / pull-down / divider leg. Returns the resistor handle. */
  function pull(h, pin, railKind, ohms = 10000) {
    const { r, near, far } = resistorAt(h, pin, ohms, railKind);
    join(r, near, h, pin); rail(r, far, railKind);
    return r;
  }
  /** A resistor (new) from a board pin / rail / part pin to another: returns its handle. */
  const resistor = (ohms = 220) => { const r = addNew('resistor', { ohms }); claimed.add(r.id); r.quiet = true; return r; };

  // what the sources in this plan offer the actuators: a yes/no (a button, a motion sensor) and/or a 0–1023 level (a knob, a light sensor)
  const mem = {};
  const signals = { bool: null, level: null, later: [], leds: [] };
  const wiring = text => { if (!sketch.wiring.includes(text)) sketch.wiring.push(text); };
  const mark = (h, pin, expect) => { checks.push({ part: h.id, pin: String(pin), expect }); usedPins.add(String(expect).replace(/^(pin|via):/, '')); };
  const say = text => { if (text && !said.includes(text)) said.push(text); };

  function finish() {
    const wireCount = actions.filter(a => a.op === 'add_wire').length, partCount = actions.filter(a => a.op === 'add_part').length;
    return { actions, checks, notes, said, sketch, board, boardAdded, wireCount, partCount, handles, claimed, usedPins, dirs, mem };
  }

  return {
    sketch, opts, signals, wiring, mark, mem, handles, board: () => board, getBoard, spec, part, existing, addNew, railPin, freePin, power, ground, rail, hook, bus, join, resistor, helper, resistorAt, drive, pull, say, reach, netOf, boardPinsOn, railOn, lone,
    nets: () => net0, state0, finish, claimed, usedPins, notes, isNano,
    free: kind => freePin(kind),
    boardName: () => NAME[getBoard().type],
    wasBoardAdded: () => boardAdded,
  };
}
