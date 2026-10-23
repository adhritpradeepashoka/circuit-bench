import { PART_DEFS } from './parts.js';
import { TIMED_KINDS } from './behaviours-extra.js';

// Single-wire digital parts (DHT11/DHT22): which board pin each one's DATA line reaches, and — if it can't
// work — the plain reason why. Topological, like the I²C check. Pure; tests run in Node.

/** @returns {Array<{partId, type, model, pin: object|null, attached: boolean, problems: string[]}>} */
export function dhtParts(circuit, parts) {
  const out = [];
  for (const part of parts) {
    if (part.type !== 'dht') continue;
    const net = pin => circuit.netOf(part.id, pin), name = part.model || 'DHT22', problems = [];
    const data = net('SDA');
    const pin = circuit.uno.pins.find(p => p.net === data) || null;
    if (!circuit.uno.board) problems.push(`${name}: there is no Arduino for it to talk to`);
    else {
      if (!pin) problems.push(`${name}: DATA is not connected to an Arduino pin`);
      else if (!pin.port) problems.push(`${name}: DATA is on ${pin.label}, which can only read analog voltages — use a digital pin`);
      const vcc = net('VCC'), gnd = net('GND');
      if (!(circuit.uno.v5.has(vcc) || circuit.uno.v33.has(vcc))) problems.push(`${name}: VCC has no power — connect it to 5V`);
      if (!circuit.uno.gnd.has(gnd)) problems.push(`${name}: GND is not connected to the Arduino's GND`);
    }
    out.push({ partId: part.id, type: part.type, model: name, pin: pin?.port ? pin : null, attached: problems.length === 0, problems });
  }
  return out;
}

/**
 * Student-made parts whose behaviour depends on the firmware's pin TIMING rather than on voltages: a servo (pulse
 * width), an ultrasonic sensor (TRIG in, ECHO out) and a stepper motor (the order the coils are energised in).
 * Resolves, for each one, which board pins its wires reach — and, if it can't work, the plain reason why.
 * @returns {Array<{partId, kind, spec, pins: object, attached: boolean, problems: string[]}>}
 */
export function timedParts(circuit, parts) {
  const out = [];
  for (const part of parts) {
    const def = PART_DEFS[part.type];
    if (!def?.custom) continue;
    const spec = def.spec, b = spec.behaviour;
    if (!TIMED_KINDS.has(b.kind)) continue;
    const name = spec.name, problems = [], net = pin => circuit.netOf(part.id, pin);
    const boardPin = pin => circuit.uno.pins.find(p => p.net === net(pin)) || null;
    const need = (pin, what) => {
      const bp = boardPin(pin);
      if (!circuit.uno.board) { if (!problems.length) problems.push(`${name}: there is no Arduino for it to talk to`); return null; }
      if (!bp) problems.push(`${name}: ${what} is not connected to an Arduino pin`);
      else if (!bp.port) problems.push(`${name}: ${what} is on ${bp.label}, which can only read analog voltages — use a digital pin`);
      return bp?.port ? bp : null;
    };
    const pins = {};
    if (b.kind === 'servo') pins.signal = need(b.roles.signal, 'the signal wire');
    else if (b.kind === 'ultrasonic') {
      pins.trig = need(b.roles.trig, 'TRIG'); pins.echo = need(b.roles.echo, 'ECHO');
      if (pins.trig && pins.echo && pins.trig.name === pins.echo.name) problems.push(`${name}: TRIG and ECHO are on the same pin`);
      const vcc = net(b.roles.vcc), gnd = net(b.roles.gnd);
      if (circuit.uno.board) {
        if (!(circuit.uno.v5.has(vcc) || circuit.uno.v33.has(vcc))) problems.push(`${name}: VCC has no power — connect it to 5V`);
        if (!circuit.uno.gnd.has(gnd)) problems.push(`${name}: GND is not connected to the Arduino's GND`);
      }
    } else if (b.kind === 'bldc-esc') pins.signal = need(b.roles.signal, 'the throttle wire');
    else if (b.kind === 'bldc') pins.phases = ['u', 'v', 'w'].map(r => need(b.roles[r], `phase ${r.toUpperCase()}`));
    else if (b.kind === 'stepper') {
      pins.coils = b.coils.map((c, i) => need(c, `IN${i + 1}`));
    }
    const attached = b.kind === 'stepper' ? pins.coils.every(Boolean) : b.kind === 'bldc' ? pins.phases.every(Boolean) : Object.values(pins).every(Boolean);
    out.push({ partId: part.id, kind: b.kind, spec, pins, attached: attached && !problems.length, problems });
  }
  return out;
}
