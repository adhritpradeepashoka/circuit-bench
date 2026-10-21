// Which I²C parts are really on the Uno's bus, at which address — and, if not, the plain reason why
// (shown in the simulator tray and handed to the AI). Topological, like a continuity check: SDA must
// share a net with A4/SDA, SCL with A5/SCL, VCC with 5 V or 3.3 V, GND with GND. Pure; tests run in Node.
import { PART_DEFS } from './parts.js';

const hex = a => `0x${a.toString(16).toUpperCase()}`;

/** @returns {Array<{partId, type, name, address, attached:boolean, problems:string[]}>} */
export function i2cParts(circuit, parts) {
  const out = [];
  const pinNet = name => circuit.uno.pins.find(p => p.name === name)?.net;
  const sda = pinNet('A4'), scl = pinNet('A5');
  const hasUno = circuit.uno.pins.length > 0;
  for (const part of parts) {
    const spec = PART_DEFS[part.type]?.i2c;
    if (!spec) continue;
    const net = pin => circuit.netOf(part.id, pin);
    const name = PART_DEFS[part.type].name.split(' ')[0];
    const problems = [];
    if (!hasUno) problems.push(`${name}: there is no Arduino for it to talk to`);
    else {
      if (net(spec.sda) == null || net(spec.sda) !== sda) problems.push(`${name}: ${spec.sda} is not connected to A4 (SDA), so the Arduino can't reach it`);
      if (net(spec.scl) == null || net(spec.scl) !== scl) problems.push(`${name}: ${spec.scl} is not connected to A5 (SCL), so the Arduino can't reach it`);
      const powered = spec.vcc.some(p => { const n = net(p); return n != null && (circuit.uno.v5.has(n) || circuit.uno.v33.has(n)); });
      const grounded = spec.gnd.some(p => { const n = net(p); return n != null && circuit.uno.gnd.has(n); });
      if (!powered) problems.push(`${name}: ${spec.vcc[0]} has no power — connect it to 5V`);
      if (!grounded) problems.push(`${name}: GND is not connected to the Arduino's GND`);
    }
    let address = spec.address;
    if (spec.addressPin) { const n = net(spec.addressPin); if (n != null && (circuit.uno.v5.has(n) || circuit.uno.v33.has(n))) address = spec.addressHigh; }
    out.push({ partId: part.id, type: part.type, name, address, attached: problems.length === 0, problems });
  }
  // Two attached devices answering at the same address corrupt each other's replies on a real bus.
  const seen = new Map();
  for (const d of out.filter(x => x.attached)) {
    if (seen.has(d.address)) { const other = seen.get(d.address); for (const x of [d, other]) { x.attached = false; x.problems.push(`${x.name}: shares address ${hex(d.address)} with another device on the bus`); } }
    else seen.set(d.address, d);
  }
  return out;
}

export { hex as i2cHex };
