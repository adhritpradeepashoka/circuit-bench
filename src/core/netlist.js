import { SITE } from './body-sites.js';
import { PART_DEFS } from './parts.js';
import { allPinsWorld, localToWorld } from './geometry.js';
import { tapsUnder } from './slime.js';
import { BOARD_SCALE } from './custom-parts.js';
import { boardHoles, holeAt } from './snap.js';
import { ledVf, ledRd } from './led-colors.js';
import { formatOhms } from './resistance.js';
import { POT_OHMS, FIXED_OHMS, ldrOhms, ntcOhms } from './sensors.js';

export const pkey = (partId, pinId) => `${partId}|${pinId}`;
export const splitKey = k => { const i = k.indexOf('|'); return { partId: k.slice(0, i), pinId: k.slice(i + 1) }; };

class UnionFind {
  constructor() { this.p = new Map(); }
  find(a) {
    if (!this.p.has(a)) this.p.set(a, a);
    let r = a;
    while (this.p.get(r) !== r) r = this.p.get(r);
    while (this.p.get(a) !== r) { const n = this.p.get(a); this.p.set(a, r); a = n; }
    return r;
  }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(rb, ra); }
}

import { BOARD_SPECS, boardPowerPin, mainBoard } from './boards.js';

export const MOTOR_OHMS = 20;      // a small 3–6 V hobby motor, running

/**
 * Build the electrical model from the editor state:
 *   • breadboard internal strips and rails            (from the part definition)
 *   • Uno internal ties (GND pins, duplicate SDA/SCL) (from the part definition)
 *   • pushbutton terminals that are one conductor     (from the part definition)
 *   • leads that are physically seated in a hole      (geometry)
 *   • explicit wires
 * Returns nets + the two-terminal elements the DC solver needs.
 */
export function compile(state) {
  const uf = new UnionFind();
  const parts = state.parts;
  const byId = new Map(parts.map(p => [p.id, p]));

  for (const part of parts) {
    const def = PART_DEFS[part.type];
    for (const pin of def.pins) uf.find(pkey(part.id, pin.id));
    for (const g of def.groups) for (let i = 1; i < g.pins.length; i++) uf.union(pkey(part.id, g.pins[0]), pkey(part.id, g.pins[i]));
  }

  // Leads seated in holes
  const holes = boardHoles(parts);
  const attachments = new Map(); // component pin key → hole key
  for (const part of parts) {
    if (!PART_DEFS[part.type].insertable) continue;
    for (const p of allPinsWorld(part).filter(q => !q.pin.noInsert)) {
      const h = holeAt(holes, p.x, p.y);
      if (!h) continue;
      const a = pkey(part.id, p.pin.id), b = pkey(h.partId, h.pinId);
      uf.union(a, b);
      attachments.set(a, b);
    }
  }

  // Wires
  for (const w of state.wires) {
    if (byId.has(w.a.part) && byId.has(w.b.part)) uf.union(pkey(w.a.part, w.a.pin), pkey(w.b.part, w.b.pin));
  }

  // Number the nets
  const rootIndex = new Map();
  const nets = [];
  const netOfKey = new Map();
  for (const part of parts) for (const pin of PART_DEFS[part.type].pins) {
    const k = pkey(part.id, pin.id), r = uf.find(k);
    let idx = rootIndex.get(r);
    if (idx === undefined) { idx = nets.length; rootIndex.set(r, idx); nets.push({ index: idx, keys: [] }); }
    nets[idx].keys.push(k);
    netOfKey.set(k, idx);
  }
  const netOf = (partId, pinId) => netOfKey.get(pkey(partId, pinId));

  // Elements + sources
  const elements = [];
  const issues = [];
  // The microcontroller board (Uno / Nano / Mega). `uno` keeps its historical name: it is "the board that runs the firmware".
  const uno = { pins: [], gnd: new Set(), v5: new Set(), v33: new Set(), vin: new Set(), board: null, spec: null };
  const main = mainBoard(parts);
  for (const part of parts) {
    if (BOARD_SPECS[part.type]) {
      if (part !== main) { issues.push({ partId: part.id, text: `Only one microcontroller board runs at a time: the ${BOARD_SPECS[part.type].name} isn't running (the ${BOARD_SPECS[main.type].name} is)` }); continue; }
      const spec = BOARD_SPECS[part.type];
      uno.board = part; uno.spec = spec;
      for (const pin of PART_DEFS[part.type].pins) {
        const n = netOf(part.id, pin.id), power = boardPowerPin(pin.id);
        if (power) uno[power].add(n);
        else if (spec.pins[pin.id]) uno.pins.push({ name: pin.id, label: pin.label, net: n, partId: part.id, ...spec.pins[pin.id] });
      }
    } else if (part.type === 'resistor') {
      const a = netOf(part.id, '1'), b = netOf(part.id, '2');
      elements.push({ kind: 'R', partId: part.id, a, b, ohms: part.ohms || PART_DEFS.resistor.ohms });
      if (a === b) issues.push({ partId: part.id, text: 'A resistor has both leads on the same strip, so it does nothing.' });
    } else if (part.type === 'led') {
      const a = netOf(part.id, 'A'), k = netOf(part.id, 'C');
      elements.push({ kind: 'LED', id: part.id, partId: part.id, a, k, vf: ledVf(part.color), rd: ledRd(part.color) });
      if (a === k) issues.push({ partId: part.id, text: 'An LED has both leads on the same strip, so it is shorted out.' });
    } else if (part.type === 'rgb-led') {
      const def = PART_DEFS['rgb-led'];
      for (const ch of def.channels) elements.push({ kind: 'LED', id: `${part.id}:${ch.id}`, partId: part.id, channel: ch.id, a: netOf(part.id, ch.a), k: netOf(part.id, ch.k), vf: ch.vf, rd: ch.rd });
      if (def.channels.some(ch => netOf(part.id, ch.a) === netOf(part.id, ch.k))) issues.push({ partId: part.id, text: 'An RGB LED has a colour lead on the same strip as its common cathode, so that colour is shorted out.' });
    } else if (part.type === 'seven-segment') {
      const com = netOf(part.id, 'COM.1');
      for (const seg of PART_DEFS['seven-segment'].segments) elements.push({ kind: 'LED', id: `${part.id}:${seg}`, partId: part.id, channel: seg, a: netOf(part.id, seg), k: com, vf: 2.0, rd: 20 });
      if (PART_DEFS['seven-segment'].segments.some(s => netOf(part.id, s) === com)) issues.push({ partId: part.id, text: 'A display segment shares a strip with the common pin, so it is shorted out.' });
    } else if (part.type === 'pushbutton') {
      elements.push({ kind: 'SW', partId: part.id, a: netOf(part.id, '1.l'), b: netOf(part.id, '2.l') });
      if (netOf(part.id, '1.l') === netOf(part.id, '2.l')) issues.push({ partId: part.id, text: 'A pushbutton has both sides on the same strip, so it is always \"pressed\".' });
    } else if (part.type === 'slide-switch') {
      // SPDT: the common pin (2) is joined to throw 1 or throw 3 depending on the handle position
      elements.push({ kind: 'SW', partId: part.id, a: netOf(part.id, '2'), b: netOf(part.id, part.pos ? '3' : '1'), closed: true });
    } else if (part.type === 'potentiometer') {
      const f = Math.min(1, Math.max(0, (part.level ?? 50) / 100)), sig = netOf(part.id, 'SIG');
      elements.push({ kind: 'R', partId: part.id, a: sig, b: netOf(part.id, 'GND'), ohms: Math.max(1, POT_OHMS * f) });
      elements.push({ kind: 'R', partId: part.id, a: netOf(part.id, 'VCC'), b: sig, ohms: Math.max(1, POT_OHMS * (1 - f)) });
    } else if (part.type === 'ldr-module') {
      const vcc = netOf(part.id, 'VCC'), gnd = netOf(part.id, 'GND'), ao = netOf(part.id, 'AO');
      elements.push({ kind: 'R', partId: part.id, a: vcc, b: ao, ohms: FIXED_OHMS });
      elements.push({ kind: 'R', partId: part.id, a: ao, b: gnd, ohms: ldrOhms(part.lux ?? 500) });
      elements.push({ kind: 'CMP', partId: part.id, vcc, gnd, ao, out: netOf(part.id, 'DO') });
    } else if (part.type === 'ntc-sensor') {
      const vcc = netOf(part.id, 'VCC'), gnd = netOf(part.id, 'GND'), out = netOf(part.id, 'OUT');
      elements.push({ kind: 'R', partId: part.id, a: vcc, b: out, ohms: FIXED_OHMS });
      elements.push({ kind: 'R', partId: part.id, a: out, b: gnd, ohms: ntcOhms(part.temp ?? 25) });
    } else if (PART_DEFS[part.type].i2c) {
      // I²C breakout boards carry pull-ups on SDA/SCL to their supply, so an idle bus reads HIGH
      const { sda, scl, vcc } = PART_DEFS[part.type].i2c, v = netOf(part.id, vcc[0]);
      elements.push({ kind: 'R', partId: part.id, a: netOf(part.id, sda), b: v, ohms: 4700 });
      elements.push({ kind: 'R', partId: part.id, a: netOf(part.id, scl), b: v, ohms: 4700 });
    } else if (PART_DEFS[part.type].custom) {
      const { kind, roles, ohms, color } = PART_DEFS[part.type].spec.behaviour, r = role => netOf(part.id, roles[role]);
      if (kind === 'resistor') elements.push({ kind: 'R', partId: part.id, a: r('a'), b: r('b'), ohms });
      else if (kind === 'led') elements.push({ kind: 'LED', partId: part.id, a: r('anode'), k: r('cathode'), vf: ledVf(color), rd: ledRd(color) });
      else if (kind === 'button') elements.push({ kind: 'SW', partId: part.id, a: r('a'), b: r('b') });
      else if (kind === 'analog-sensor') {
        const level = Math.min(100, Math.max(0, part.level ?? 50)), bh = PART_DEFS[part.type].spec.behaviour;
        elements.push({ kind: 'SRC', partId: part.id, vcc: r('vcc'), gnd: r('gnd'), out: r('out'), frac: level / 100 });
        if (roles.dout) {      // the module's comparator: DOUT flips when the level passes the threshold
          const above = level >= (bh.threshold ?? 50);
          elements.push({ kind: 'SRC', partId: part.id, vcc: r('vcc'), gnd: r('gnd'), out: r('dout'), frac: (bh.doutActive === 'high' ? above : !above) ? 1 : 0 });
        }
      }
      else if (kind === 'opamp') {
        const bh = PART_DEFS[part.type].spec.behaviour;
        elements.push({ kind: 'OA', partId: part.id, p: r('inp'), n: r('inn'), out: r('out'), vcc: r('vcc'), vee: r('vee'), dropHigh: bh.dropHigh, dropLow: bh.dropLow, minSupply: bh.minSupply });
      }
      else if (kind === 'slime-mold') {
        // the organism lies over an imported board: each electrode net of the board under its centre becomes a source against the bath (REF)
        const mid = localToWorld(part, PART_DEFS[part.type].w / 2, PART_DEFS[part.type].h / 2);
        const under = parts.find(b => b !== part && PART_DEFS[b.type]?.spec?.board && (() => {
          const bd = PART_DEFS[b.type]; const q = localToWorld(b, bd.w / 2, bd.h / 2); const a = -((b.rot || 0) * Math.PI) / 180;
          const dx = mid.x - q.x, dy = mid.y - q.y, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
          return Math.abs(lx) <= bd.w / 2 && Math.abs(ly) <= bd.h / 2;
        })());
        if (under) {
          const bs = PART_DEFS[under.type].spec.board, M = 6;
          const taps = tapsUnder(bs, (x, y) => localToWorld(under, x * BOARD_SCALE + M, y * BOARD_SCALE + M), mid, part.rot, pin => netOf(under.id, pin)).filter(t => t.net != null);
          if (taps.length) elements.push({ kind: 'SLIME', partId: part.id, ref: r('ref'), taps, rs: 2000 + 1000 * Math.max(1, part.mcontact ?? 5) });
        }
      }
      else if (kind === 'signal-source') {
        if (part.attached !== 0) elements.push({ kind: 'BIO', partId: part.id, pos: r('pos'), neg: r('neg'), ref: r('ref'), rc: 2000 + 1000 * Math.max(1, part.contact ?? 5) });
      }
      else if (kind === 'inamp') {
        const bh = PART_DEFS[part.type].spec.behaviour;
        elements.push({ kind: 'OA', partId: part.id, p: r('inp'), n: r('inn'), out: r('out'), vcc: r('vcc'), vee: r('vee'), dropHigh: bh.dropHigh, dropLow: bh.dropLow, minSupply: bh.minSupply, gain: bh.gain, bias: bh.bias === 'ref' && roles.ref ? { mode: 'ref', net: r('ref') } : { mode: bh.bias === 'zero' ? 'zero' : bh.bias === 'ref' ? 'zero' : 'mid' } });
        // electrodes placed on the Visualizer's head: this amplifier's own inputs are fed by the body (a channel per amplifier)
        if (part.sp && part.sn && SITE[part.sp] && SITE[part.sn] && roles.ref) elements.push({ kind: 'BIO', partId: part.id, pos: r('inp'), neg: r('inn'), ref: r('ref'), rc: 2000 + 1000 * Math.max(1, part.contact ?? 5) });
      }
      else if (kind === 'keypad') {
        const bh = PART_DEFS[part.type].spec.behaviour, cols = bh.cols.length;
        bh.rows.forEach((rp, i) => bh.cols.forEach((cp, j) => {
          if (((part.keys ?? 0) >> (i * 4 + j)) & 1) elements.push({ kind: 'SW', partId: part.id, a: netOf(part.id, rp), b: netOf(part.id, cp), closed: true, fixed: true });
        }));
      }
      else if (kind === 'switch-bank') {
        const bh = PART_DEFS[part.type].spec.behaviour;
        bh.a.forEach((ap, i) => { if (((part.bits ?? 0) >> i) & 1) elements.push({ kind: 'SW', partId: part.id, a: netOf(part.id, ap), b: netOf(part.id, bh.b[i]), closed: true, fixed: true }); });
      }
      else if (kind === 'joystick') {
        const div = (pin, level) => {
          const f = Math.min(1, Math.max(0, level / 100));
          elements.push({ kind: 'R', partId: part.id, a: r('vcc'), b: r(pin), ohms: Math.max(1, 10000 * (1 - f)) });
          elements.push({ kind: 'R', partId: part.id, a: r(pin), b: r('gnd'), ohms: Math.max(1, 10000 * f) });
        };
        div('horz', part.jx ?? 50); div('vert', part.jy ?? 50);
        if (roles.sel && part.jsel) elements.push({ kind: 'SW', partId: part.id, a: r('sel'), b: r('gnd'), closed: true, fixed: true });
      }
      else if (kind === 'mux') {
        const b = PART_DEFS[part.type].spec.behaviour, n = pin => netOf(part.id, pin);
        elements.push({ kind: 'MUX', partId: part.id, vcc: r('vcc'), gnd: r('gnd'), common: r('common'), en: roles.enable ? r('enable') : null, sel: b.select.map(n), ch: b.channels.map(n) });
      } else if (kind === 'logic') {
        const def = PART_DEFS[part.type];
        elements.push({
          kind: 'LOGIC', partId: part.id, partType: part.type, vcc: r('vcc'), gnd: r('gnd'),
          roles, nets: Object.fromEntries(def.pins.map(q => [q.id, netOf(part.id, q.id)])),
          outputs: (def.logic?.outputs || []).map(o => o.pin),
        });
        if (!def.logic) issues.push({ partId: part.id, text: `${def.name}: its rules could not be read, so it does nothing` });
      } else if (kind === 'switch') {
        if (roles.throw2) elements.push({ kind: 'SW', partId: part.id, a: r('common'), b: part.pos ? r('throw2') : r('throw1'), closed: true });
        else elements.push({ kind: 'SW', partId: part.id, a: r('common'), b: r('throw1'), closed: !!part.pos });
        if (r('common') === r('throw1') && !roles.throw2) issues.push({ partId: part.id, text: `${PART_DEFS[part.type].name}: both contacts are on the same strip, so the switch does nothing` });
      } else if (kind === 'relay') {
        const bh = PART_DEFS[part.type].spec.behaviour;
        elements.push({ kind: 'RLY', partId: part.id, ca: r('coilA'), cb: r('coilB'), com: r('common'), no: r('no'), nc: roles.nc ? r('nc') : null, ohms: bh.ohms, pick: bh.pick, ...(roles.common2 && roles.no2 ? { pole2: { com: r('common2'), no: r('no2'), nc: roles.nc2 ? r('nc2') : null } } : {}) });
      } else if (kind === 'variable-resistor') {
        const bh = PART_DEFS[part.type].spec.behaviour, f = Math.min(1, Math.max(0, (part.level ?? 50) / 100));
        if (roles.wiper) {
          elements.push({ kind: 'R', partId: part.id, a: r('a'), b: r('wiper'), ohms: Math.max(1, bh.ohms * f) });
          elements.push({ kind: 'R', partId: part.id, a: r('wiper'), b: r('b'), ohms: Math.max(1, bh.ohms * (1 - f)) });
        } else elements.push({ kind: 'R', partId: part.id, a: r('a'), b: r('b'), ohms: Math.max(1, bh.min + (bh.ohms - bh.min) * f) });
      } else if (kind === 'diode') {
        const bh = PART_DEFS[part.type].spec.behaviour;
        elements.push({ kind: 'D', partId: part.id, a: r('anode'), k: r('cathode'), vf: bh.vf, vz: bh.vz, imax: bh.imax / 1000 });
        if (r('anode') === r('cathode')) issues.push({ partId: part.id, text: `${PART_DEFS[part.type].name}: both ends are on the same strip, so it does nothing` });
      } else if (kind === 'npn' || kind === 'pnp') {
        const bh = PART_DEFS[part.type].spec.behaviour;
        elements.push({ kind: 'Q', partId: part.id, type: kind, b: r('base'), c: r('collector'), e: r('emitter'), beta: bh.beta, imax: bh.imax / 1000 });
      } else if (kind === 'nmos' || kind === 'pmos') {
        const bh = PART_DEFS[part.type].spec.behaviour;
        elements.push({ kind: 'Q', partId: part.id, type: kind, g: r('gate'), d: r('drain'), s: r('source'), vth: bh.vth, rds: bh.rds, imax: bh.imax / 1000 });
      } else if (kind === 'regulator') {
        const bh = PART_DEFS[part.type].spec.behaviour;
        elements.push({ kind: 'REG', partId: part.id, vin: r('vin'), gnd: r('gnd'), out: r('out'), vout: bh.vout, drop: bh.drop, mode: bh.mode, imax: bh.imax / 1000 });
      } else if (kind === 'capacitor') {
        elements.push({ kind: 'CAP', partId: part.id, a: r('a'), b: r('b'), farads: PART_DEFS[part.type].spec.behaviour.uF * 1e-6 });
      } else if (kind === 'inductor') {
        const bh = PART_DEFS[part.type].spec.behaviour;
        elements.push({ kind: 'IND', partId: part.id, a: r('a'), b: r('b'), henries: bh.mH * 1e-3, rs: bh.rs });
      } else if (kind === 'buzzer') {
        const bh = PART_DEFS[part.type].spec.behaviour;
        elements.push({ kind: 'LOAD', partId: part.id, a: r('a'), b: r('b'), ohms: bh.ohms });
      } else if (kind === 'motor') {
        const bh = PART_DEFS[part.type].spec.behaviour;
        elements.push({ kind: 'LOAD', partId: part.id, a: r('a'), b: r('b'), ohms: bh.ohms, heavy: true });
      } else if (kind === 'led-array') {
        const bh = PART_DEFS[part.type].spec.behaviour, cat = bh.common !== 'anode', pairs = bh.cathodes?.length === bh.segments.length && bh.cathodes.length > 0;
        const com = pairs ? null : r('common');
        bh.segments.forEach((seg, i) => {
          const n = netOf(part.id, seg);
          if (pairs) elements.push({ kind: 'LED', id: `${part.id}:${seg}`, partId: part.id, channel: seg, a: n, k: netOf(part.id, bh.cathodes[i]), vf: ledVf(bh.color || 'red'), rd: ledRd(bh.color || 'red') });   // each LED has its own two pins (anode, cathode)
          else elements.push({ kind: 'LED', id: `${part.id}:${seg}`, partId: part.id, channel: seg, a: cat ? n : com, k: cat ? com : n, vf: ledVf(bh.color || 'red'), rd: ledRd(bh.color || 'red') });
        });
      } else if (kind === 'encoder') {
        // A and B each pull to the common pin through a contact; the phase (0–3) walks the Gray code 00 → 01 → 11 → 10
        const ph = part.phase ?? 0, closedA = ph === 1 || ph === 2, closedB = ph === 2 || ph === 3;
        elements.push({ kind: 'SW', partId: part.id, a: r('a'), b: r('common'), closed: closedA, fixed: true });
        elements.push({ kind: 'SW', partId: part.id, a: r('b'), b: r('common'), closed: closedB, fixed: true });
        if (roles.sw) elements.push({ kind: 'SW', partId: part.id, a: r('sw'), b: r('common') });
      } else if (kind === 'digital-sensor') elements.push({ kind: 'SRC', partId: part.id, vcc: r('vcc'), gnd: r('gnd'), out: r('out'), frac: 1, momentary: true });
    } else if (part.type === 'dht') {
      elements.push({ kind: 'R', partId: part.id, a: netOf(part.id, 'SDA'), b: netOf(part.id, 'VCC'), ohms: 10000 });   // the module's pull-up on DATA
    } else if (part.type === 'dc-motor') {
      elements.push({ kind: 'MOT', partId: part.id, a: netOf(part.id, '1'), b: netOf(part.id, '2'), ohms: MOTOR_OHMS });
    } else if (part.type === 'battery') {
      elements.push({ kind: 'BAT', partId: part.id, a: netOf(part.id, '+'), b: netOf(part.id, '-'), v: part.volts ?? 9 });
      if (netOf(part.id, '+') === netOf(part.id, '-')) issues.push({ partId: part.id, text: 'The battery\'s + and − are connected together: that is a short circuit.' });
    } else if (part.type === 'l298n') {
      const n = pin => netOf(part.id, pin), alone = pin => nets[n(pin)].keys.length === 1;      // nothing on ENA → its jumper holds the channel enabled
      elements.push({
        kind: 'DRV', partId: part.id, vs: n('12V'), gnd: n('GND'),
        ch: [{ in1: n('IN1'), in2: n('IN2'), en: alone('ENA') ? null : n('ENA'), out1: n('OUT1'), out2: n('OUT2') },
          { in1: n('IN3'), in2: n('IN4'), en: alone('ENB') ? null : n('ENB'), out1: n('OUT3'), out2: n('OUT4') }],
      });
    } else if (part.type === 'pir-sensor') {
      elements.push({ kind: 'PIR', partId: part.id, vcc: netOf(part.id, 'VCC'), out: netOf(part.id, 'OUT'), gnd: netOf(part.id, 'GND') });
    }
  }

  // Human-friendly net names
  for (const net of nets) {
    const named = net.keys.map(splitKey).map(({ partId, pinId }) => {
      const part = byId.get(partId);
      return BOARD_SPECS[part?.type] ? PART_DEFS[part.type].pinById.get(pinId).label : null;
    }).filter(Boolean);
    net.name = named.length ? named.filter((v, i, a) => a.indexOf(v) === i)[0] : `N${net.index + 1}`;
    net.pinCount = net.keys.length;
  }

  // Leads that go nowhere: a resistor / LED lead whose net holds no other part's pin (breadboard holes don't count) and no wire.
  const isBoard = id => PART_DEFS[byId.get(id)?.type]?.isBoard;
  const LEADS = { resistor: [['1', 'lead 1'], ['2', 'lead 2']], led: [['A', 'anode (+)'], ['C', 'cathode (−)']] };
  const openLeads = [];
  for (const part of parts) for (const [pin, name] of LEADS[part.type] || []) {
    const key = pkey(part.id, pin);
    if (nets[netOfKey.get(key)].keys.some(k => k !== key && !isBoard(splitKey(k).partId))) continue;
    openLeads.push({ partId: part.id, pin, text: part.type === 'resistor' ? `Resistor ${formatOhms(part.ohms || 220)}: ${name} is not connected to anything, so no current flows through it` : `LED: ${name} is not connected to anything` });
  }

  // A motor straight on an I/O pin: it would need far more current than the pin can give.
  const ioNets = new Map(uno.pins.filter(p => p.port).map(p => [p.net, p.label]));
  for (const e of elements) if (e.kind === 'MOT' || (e.kind === 'LOAD' && e.heavy)) for (const t of [e.a, e.b]) if (ioNets.has(t)) issues.push({ partId: e.partId, text: `A DC motor is wired straight to ${ioNets.get(t)}: an Arduino pin can't power a motor (40 mA max) — drive it through an L298N motor driver` });

  return { nets, netOf, netOfKey, elements, uno, attachments, issues, openLeads };
}
