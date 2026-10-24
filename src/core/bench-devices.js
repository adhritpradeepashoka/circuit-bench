// What is on the bench, in the words a block can use. Pure (no DOM, no Blockly).
//
// The block editor never asks "which pin?": each block names a PART ("LED 2"), and the pin is found here from how the circuit is
// wired (through breadboard rows, wires and series resistors), every time a sketch is made. Re-wire the LED to another pin and the
// same blocks now drive the new pin.
//
//   describeBench(parts, circuit) → { board, devices: [Device], pins: [Pin] }
//   Device = { id, key, type, kind, label, pins: {role: Pin|null}, note, … }       (`kind` is what blocks exist for it)
//   Pin    = { name: '13' | 'A0', analog: bool, pwm: bool }
import { PART_DEFS } from './parts.js';
import { BOARD_SPECS, mainBoard } from './boards.js';

export const PWM_PINS = Object.fromEntries(Object.entries(BOARD_SPECS).map(([type, sp]) => [type, new Set(sp.pwm)]));
const MAX_HOPS = 2;

/** Short, kid-friendly name of a pin: "D13", "A0". */
export const pinLabel = pin => (pin ? (/^A\d+$/.test(pin.name) ? pin.name : `D${pin.name}`) : '');

export function describeBench(parts, circuit) {
  const board = mainBoard(parts);
  if (!board || !circuit?.uno?.board) return { board: null, devices: [], pins: [] };
  const spec = BOARD_SPECS[board.type], pwm = PWM_PINS[board.type] || new Set();
  const byNet = new Map();                                           // net index → pins of the board on it
  for (const p of circuit.uno.pins) {
    if (!p.port && p.adc === undefined) continue;
    const pin = { name: p.name, analog: /^A\d+$/.test(p.name) || p.adc !== undefined, pwm: pwm.has(p.name) };
    if (!byNet.has(p.net)) byNet.set(p.net, []);
    byNet.get(p.net).push(pin);
  }
  const best = list => list?.find(p => !/^A\d/.test(p.name)) || list?.[0] || null;     // digital name first, so "D9" not "A0" when both fit
  const netOf = (part, id) => (PART_DEFS[part.type]?.pinById?.has(id) ? circuit.netOf(part.id, id) : undefined);
  const direct = n => (n === undefined ? null : best(byNet.get(n)));
  const resistors = circuit.elements.filter(e => e.kind === 'R' && PART_DEFS[parts.find(q => q.id === e.partId)?.type]?.type === 'resistor');
  /** The board pin that drives/reads a net — straight, or through up to two resistors (an LED's own series resistor). */
  const reach = n => {
    if (n === undefined) return null;
    const d = direct(n); if (d) return d;
    let frontier = [n]; const seen = new Set(frontier);
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const next = [];
      for (const r of resistors) for (const [a, b] of [[r.a, r.b], [r.b, r.a]]) if (frontier.includes(a) && !seen.has(b)) { seen.add(b); next.push(b); const f = direct(b); if (f) return f; }
      frontier = next;
    }
    return null;
  };
  const rail = n => (n === undefined ? null : circuit.uno.gnd.has(n) ? 'gnd' : circuit.uno.v5.has(n) ? 'v5' : circuit.uno.v33.has(n) ? 'v5' : null);
  const onI2c = (part, pinId, bus) => { const n = netOf(part, pinId); return n !== undefined && (byNet.get(n) || []).some(p => p.name === spec.i2c?.[bus]); };

  const count = {}, devices = [];
  const nameOf = (part, base) => { count[base] = (count[base] || 0) + 1; return `${base} ${count[base]}`; };
  const add = (part, kind, base, extra) => {
    const d = { id: part.id, type: part.type, kind, label: nameOf(part, base), pins: {}, warn: [], ...extra };
    if (d.colour) d.label += ` (${d.colour})`;
    d.short = d.label; devices.push(d); return d;
  };
  const need = (d, role, pin, what) => { d.pins[role] = pin; if (!pin) d.warn.push(what); return pin; };

  for (const part of parts) {
    const def = PART_DEFS[part.type]; if (!def || def.isBoard || BOARD_SPECS[part.type]) continue;
    const T = part.type;
    if (T === 'resistor' || T === 'breadboard' || T === 'battery') continue;
    if (T === 'led') {
      const a = netOf(part, 'A'), c = netOf(part, 'C'), colour = part.color || 'red';
      const d = add(part, 'led', 'LED', { colour });
      const hi = reach(a), lo = reach(c);
      if (hi && !lo) { d.pins.out = hi; }
      else if (lo && !hi && rail(a) === 'v5') { d.pins.out = lo; d.activeLow = true; }          // + to 5 V, − to the pin: lit when the pin goes LOW
      else if (hi) d.pins.out = hi;
      else { d.pins.out = null; d.warn.push('is not connected to a board pin yet'); }
    } else if (T === 'rgb-led') {
      const d = add(part, 'rgb', 'RGB LED');
      for (const ch of ['R', 'G', 'B']) need(d, ch, reach(netOf(part, ch)), `${{ R: 'red', G: 'green', B: 'blue' }[ch]} leg is not connected to a board pin`);
    } else if (T === 'pushbutton') {
      const n1 = netOf(part, '1.l'), n2 = netOf(part, '2.l');
      const d = add(part, 'button', 'Button');
      const p1 = direct(n1), p2 = direct(n2);
      const pin = p1 || p2, other = p1 ? n2 : n1;
      if (!pin) d.warn.push('is not connected to a board pin yet');
      d.pins.in = pin || null;
      const r = rail(other);
      d.mode = r === 'v5' ? 'INPUT' : 'INPUT_PULLUP'; d.pressedHigh = r === 'v5';
      if (pin && !r) d.warn.push('needs its other leg joined to GND (the board then reads LOW when it is pressed)');
    } else if (T === 'slide-switch') {
      const d = add(part, 'switch', 'Switch');
      const n = { 1: netOf(part, '1'), 2: netOf(part, '2'), 3: netOf(part, '3') };
      const onCommon = direct(n[2]), on3 = direct(n[3]), on1 = direct(n[1]);
      d.mode = 'INPUT_PULLUP';
      if (onCommon) {                                                // common to the board: throws tied to the rails say which way is "on"
        d.pins.in = onCommon;
        const r1 = rail(n[1]), r3 = rail(n[3]);
        d.onHigh = r3 === 'v5' || r1 === 'gnd' ? true : r3 === 'gnd' || r1 === 'v5' ? false : true;
        if (!r1 && !r3) d.warn.push('needs a throw leg joined to GND or 5V so it reads a clear on/off');
      } else if (on3 || on1) {                                       // a throw to the board, common to a rail
        d.pins.in = on3 || on1;                                      // joined to the middle leg (a rail) only on its own side; the pull-up reads HIGH otherwise
        const r = rail(n[2]); d.onHigh = on3 ? r === 'v5' : r !== 'v5';
        if (!r) d.warn.push('needs its middle leg joined to GND or 5V');
      } else { d.pins.in = null; d.warn.push('is not connected to a board pin yet'); }
    } else if (T === 'potentiometer') {
      const d = add(part, 'pot', 'Knob'); need(d, 'sig', reach(netOf(part, 'SIG')), 'wiper (SIG) is not connected to a board pin yet');
      if (d.pins.sig && !d.pins.sig.analog) d.warn.push('wiper needs an analog pin (A0–A5)');
    } else if (T === 'ldr-module') {
      const d = add(part, 'ldr', 'Light sensor');
      d.pins.ao = direct(netOf(part, 'AO')); d.pins.do = direct(netOf(part, 'DO'));
      if (!d.pins.ao && !d.pins.do) d.warn.push('is not connected to a board pin yet');
      else if (d.pins.ao && !d.pins.ao.analog) d.warn.push('AO needs an analog pin (A0–A5)');
    } else if (T === 'ntc-sensor') {
      const d = add(part, 'ntc', 'Temperature sensor'); need(d, 'out', direct(netOf(part, 'OUT')), 'OUT is not connected to a board pin yet');
      if (d.pins.out && !d.pins.out.analog) d.warn.push('OUT needs an analog pin (A0–A5)');
    } else if (T === 'pir-sensor') {
      const d = add(part, 'pir', 'Motion sensor'); need(d, 'out', direct(netOf(part, 'OUT')), 'OUT is not connected to a board pin yet');
    } else if (T === 'dht') {
      const d = add(part, 'dht', 'Humidity sensor'); d.model = part.model === 'DHT11' ? 'DHT11' : 'DHT22';
      need(d, 'data', direct(netOf(part, 'SDA')), 'DATA is not connected to a board pin yet');
    } else if (T === 'mpu6050') {
      const d = add(part, 'mpu', 'Tilt sensor');
      d.i2c = onI2c(part, 'SDA', 'sda') && onI2c(part, 'SCL', 'scl'); if (!d.i2c) d.warn.push(`needs SDA and SCL wired to the board's I²C pins (${spec.i2c.sda}, ${spec.i2c.scl})`);
      const ad0 = netOf(part, 'AD0'); d.address = ad0 !== undefined && rail(ad0) === 'v5' ? 0x69 : 0x68;
    } else if (T === 'ssd1306') {
      const d = add(part, 'oled', 'OLED screen');
      d.i2c = onI2c(part, 'DATA', 'sda') && onI2c(part, 'CLK', 'scl'); if (!d.i2c) d.warn.push(`needs DATA and CLK wired to the board's I²C pins (${spec.i2c.sda}, ${spec.i2c.scl})`);
    } else if (T === 'lcd1602') {
      const d = add(part, 'lcd', 'Text screen');
      d.i2c = onI2c(part, 'SDA', 'sda') && onI2c(part, 'SCL', 'scl'); if (!d.i2c) d.warn.push(`needs SDA and SCL wired to the board's I²C pins (${spec.i2c.sda}, ${spec.i2c.scl})`);
    } else if (T === 'seven-segment') {
      const d = add(part, 'seg', 'Digit display'); let missing = [];
      for (const s of def.segments) { d.pins[s] = direct(netOf(part, s)) || reach(netOf(part, s)); if (!d.pins[s] && s !== 'DP') missing.push(s); }
      if (missing.length) d.warn.push(`segment${missing.length > 1 ? 's' : ''} ${missing.join(', ')} not connected to a board pin yet`);
    } else if (T === 'l298n') {
      const chans = [['A', 'IN1', 'IN2', 'ENA', 'OUT1', 'OUT2'], ['B', 'IN3', 'IN4', 'ENB', 'OUT3', 'OUT4']];
      const base = nameOf(part, 'Motor driver');
      for (const [ch, i1, i2, en, o1, o2] of chans) {
        const pin1 = direct(netOf(part, i1)), pin2 = direct(netOf(part, i2)), enable = direct(netOf(part, en));
        if (ch === 'B' && !pin1 && !pin2) continue;                     // channel B only if it is wired
        const motor = parts.find(m => m.type === 'dc-motor' && [o1, o2].some(o => { const n = netOf(part, o); return n !== undefined && ['1', '2'].some(k => netOf(m, k) === n); }));
        const d = { id: `${part.id}:${ch}`, partId: part.id, type: T, kind: 'driver', label: `${base} · motor ${ch}`, pins: { in1: pin1, in2: pin2, en: enable }, warn: [], channel: ch, motorId: motor?.id || null };
        d.short = `${base} ${ch}`; if (motor) d.label = `${base} · ${ch} (motor)`;
        if (!pin1 || !pin2) d.warn.push(`needs ${i1} and ${i2} wired to board pins`);
        devices.push(d);
      }
    } else if (def.custom && def.spec?.behaviour) {                     // parts made with the Part Creator: use what they say they are
      const b = def.spec.behaviour, r = b.roles || {};
      if (b.kind === 'led') { const d = add(part, 'led', def.name); d.pins.out = reach(netOf(part, r.anode)); if (!d.pins.out) d.warn.push('is not connected to a board pin yet'); }
      else if (b.kind === 'button') {
        const d = add(part, 'button', def.name), p1 = direct(netOf(part, r.a)), p2 = direct(netOf(part, r.b)), other = p1 ? netOf(part, r.b) : netOf(part, r.a);
        d.pins.in = p1 || p2 || null; d.mode = rail(other) === 'v5' ? 'INPUT' : 'INPUT_PULLUP'; d.pressedHigh = rail(other) === 'v5';
        if (!d.pins.in) d.warn.push('is not connected to a board pin yet');
      } else if (b.kind === 'analog-sensor') {
        const d = add(part, 'pot', def.name); need(d, 'sig', direct(netOf(part, r.out)), 'signal is not connected to a board pin yet');
        if (d.pins.sig && !d.pins.sig.analog) d.warn.push('signal needs an analog pin (A0–A5)');
      } else if (b.kind === 'digital-sensor') { const d = add(part, 'pir', def.name); need(d, 'out', direct(netOf(part, r.out)), 'signal is not connected to a board pin yet'); }
      else generic(part, def);
    } else generic(part, def);
  }

  /** Anything else — even a part invented tomorrow: every pin that reaches a board pin becomes a plain pin block. */
  function generic(part, def) {
    const wired = [];
    for (const p of def.pins) { const pin = direct(netOf(part, p.id)); if (pin) wired.push({ id: p.id, label: String(p.label || p.id).replace(/\s*\(.*\)$/, ''), pin }); }
    if (!wired.length) return;
    const base = nameOf(part, def.name);
    for (const w of wired) devices.push({ id: `${part.id}#${w.id}`, partId: part.id, type: part.type, kind: 'pin', label: `${base} · ${w.label} (${pinLabel(w.pin)})`, short: `${base} ${w.label}`, pins: { pin: w.pin }, warn: [] });
  }

  const pins = [...new Set(circuit.uno.pins.filter(p => p.port || p.adc !== undefined).map(p => p.name))].map(n => ({ name: n, analog: /^A\d+$/.test(n), pwm: pwm.has(n) }));
  return { board: { id: board.id, type: board.type, name: spec.name, spec }, devices, pins };
}

/** Dropdown options for blocks of a kind: [[label, id], …]. Always has one entry, so a block is never empty. */
export function deviceOptions(bench, kinds) {
  const list = (bench?.devices || []).filter(d => [].concat(kinds).includes(d.kind));
  return list.length ? list.map(d => [`${d.label}${d.pins.out && d.kind === 'led' ? ` (${pinLabel(d.pins.out)})` : ''}${d.warn.length ? ' ⚠' : ''}`, d.id]) : [['(none on the bench)', '']];
}
