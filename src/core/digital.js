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
