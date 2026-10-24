// Shared pieces for the recipe files: ordering phases, what a source offers an actuator, and "an LED on a pin".
import { PART_DEFS } from '../parts.js';
import { PlanError } from './engine.js';

export const SOURCE = 0, SINK = 1, ACTUATOR = 2, OTHER = 3;
export const phase = n => fn => { fn.phase = n; return fn; };
export const roleMap = type => PART_DEFS[type]?.spec?.behaviour?.roles || {};
export { PlanError };

/** Offer a yes/no reading to the actuators (the first source wins). */
export function offerBool(c, expr, label) { if (!c.signals.bool) c.signals.bool = { expr, label }; }
/** Offer a 0–1023 reading ("more of the thing → higher"). */
export function offerLevel(c, expr, label) { if (!c.signals.level) c.signals.level = { expr, label }; }

/** LED + series resistor on a free pin (counting down from 13), or the one already on the bench. Returns { pin, led, isNew }. */
export function ledOnPin(c, { color, ohms = 220, kind = 'digital', fresh = false, type = 'led', anode = 'A', cathode = 'C' } = {}) {
  c.getBoard();
  if (!fresh) {
    for (const led of c.existing(type)) {
      const a = c.netOf(led, anode), cat = c.netOf(led, cathode), p = c.reach(a);
      if (p) { c.claimed.add(led.id); c.mark(led, anode, `via:${p.name}`); if (c.railOn(cat) !== 'gnd' && c.lone(led, cathode)) c.ground(led, cathode); return { pin: p.name, led, isNew: false }; }
      if (c.lone(led, anode)) {            // an LED nobody finished: give it a resistor and a pin
        c.claimed.add(led.id);
        const pin = c.drive(led, anode, kind, { ohms, order: 'high', dir: 'out' });
        c.ground(led, cathode); return { pin, led, isNew: false };
      }
    }
  }
  const led = c.part(type, { props: color && type === 'led' ? { color } : {}, fresh: true });
  led.quiet = true;
  const pin = c.drive(led, anode, kind, { ohms, order: 'high', dir: 'out' });
  c.ground(led, cathode);
  c.wiring(`LED: pin ${pin} → ${ohms} Ω resistor → LED → GND`);
  return { pin, led, isNew: true };
}


/**
 * An LED with its resistor between two nodes — `from` / `to` are 'v5' | 'gnd' (a rail) or [handle, pin] (a part's pin). Used to show that a
 * driver, relay or regulator really switches something. Already on the bench? Then it is that one.
 */
export function loadLed(c, { ohms = 220, from = 'v5', to = 'gnd', color = null } = {}) {
  const ends = (end, pin) => (Array.isArray(end) ? [[pin, end[0], end[1]]] : []);
  let led, res;
  if (Array.isArray(from)) {                       // anchored at the supply side: resistor first, then the LED behind it
    const { r, near, far } = c.resistorAt(from[0], from[1], ohms);
    res = r; c.join(r, near, from[0], from[1]);
    led = c.helper('led', [['A', r, far], ...ends(to, 'C')], { props: color ? { color } : {} });
    c.join(r, far, led, 'A');
  } else {                                         // anchored at the sink side: LED first, then its resistor
    led = c.helper('led', ends(to, 'C'), { props: color ? { color } : {} });
    const { r, near, far } = c.resistorAt(led, 'A', ohms);
    res = r; c.join(r, near, led, 'A');
    c.power(r, far, from);
  }
  if (Array.isArray(to)) c.join(led, 'C', to[0], to[1]); else c.ground(led, 'C');
  return { led, r: res };
}

/** "a NPN transistor" → "an NPN transistor", "an DHT22" → "a DHT22": the recipes write "a", this picks the right article from how the next word is said. */
export function fixArticles(text) {
  return String(text).replace(/\b([Aa])n? (?=([A-Za-z0-9][A-Za-z0-9-]*))/g, (m, a, _g, off, str) => {
    const word = str.slice(off + m.length).match(/^[A-Za-z0-9][A-Za-z0-9-]*/)[0];
    let an;
    if (/^\d/.test(word)) an = /^(?:8\d*|11|18)(?![\d.])/.test(word);
    else if (/^[A-Z]{2,5}\d*(?:-|$)/.test(word) || /^[A-Z]-/.test(word)) an = /^[AEFHILMNORSX]/.test(word) && !/^(?:MOSFET|MOS)/.test(word) && !/^U/.test(word);     // initialisms: said letter by letter
    else an = /^[aeiou]/i.test(word) && !/^(?:uni|use|usb|one|eu)/i.test(word);
    return `${a}${an ? 'n' : ''} `;
  });
}
