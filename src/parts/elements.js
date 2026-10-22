// Drawings for parts @wokwi/elements doesn't have: a DC motor, an L298N motor-driver module and a battery.
// Plain custom elements (no framework) sized in CSS px; their pin positions live in PART_DEFS (src/core/parts.js),
// so these files only draw. Each one is a tiny SVG with a few live properties the simulator sets.

import { layoutSpec } from '../core/custom-parts.js';

const svgNS = 'http://www.w3.org/2000/svg';

export const MOTOR_W = 120, MOTOR_H = 120;
export const L298N_W = 170, L298N_H = 172;
export const BATTERY_W = 76, BATTERY_H = 128;

class CbElement extends HTMLElement {
  connectedCallback() {
    if (this._ready) return;
    this._ready = true;
    this.style.display = 'inline-block';
    this.innerHTML = this.markup();
    this.update?.();
  }
}

/** Hobby DC motor, seen from the shaft end; the hub spins at the simulated speed (and direction). */
class DcMotor extends CbElement {
  constructor() { super(); this._rpm = 0; }
  get rpm() { return this._rpm; }
  set rpm(v) { v = Math.round(Number(v) || 0); if (v === this._rpm) return; this._rpm = v; this.update(); }
  markup() {
    return `<svg xmlns="${svgNS}" width="${MOTOR_W}" height="${MOTOR_H}" viewBox="0 0 ${MOTOR_W} ${MOTOR_H}">
      <defs>
        <radialGradient id="cbm-can" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#f4f6f8"/><stop offset=".6" stop-color="#b9c0c7"/><stop offset="1" stop-color="#7d868f"/></radialGradient>
        <style>@keyframes cbm-spin { to { transform: rotate(360deg); } }</style>
      </defs>
      <path d="M44 92 L44 106 M76 92 L76 106" stroke="#999" stroke-width="5"/>
      <path d="M44 100 C44 112 44 112 44 116" stroke="#d6262b" stroke-width="3" fill="none"/>
      <path d="M76 100 C76 112 76 112 76 116" stroke="#222" stroke-width="3" fill="none"/>
      <circle cx="60" cy="54" r="42" fill="url(#cbm-can)" stroke="#5d656c" stroke-width="1.5"/>
      <circle cx="60" cy="54" r="30" fill="none" stroke="#8b939a" stroke-width="1"/>
      <circle cx="28" cy="54" r="2.6" fill="#59616a"/><circle cx="92" cy="54" r="2.6" fill="#59616a"/>
      <g class="hub" style="transform-origin:60px 54px">
        <rect x="56.5" y="22" width="7" height="64" rx="3.5" fill="#f0b429" stroke="#9a6b00" stroke-width="1"/>
        <circle cx="60" cy="54" r="9" fill="#e8a317" stroke="#9a6b00" stroke-width="1"/>
        <circle cx="60" cy="54" r="2.4" fill="#5b3d00"/>
      </g>
      <text x="38" y="113" font-size="9" font-family="sans-serif" font-weight="700" fill="#d6262b">+</text>
      <text x="80" y="113" font-size="9" font-family="sans-serif" font-weight="700" fill="#333">−</text>
      <text class="rpm" x="60" y="10" font-size="9" font-family="sans-serif" text-anchor="middle" fill="#334"></text>
    </svg>`;
  }
  update() {
    const hub = this.querySelector('.hub'), label = this.querySelector('.rpm');
    if (!hub) return;
    const rpm = this._rpm;
    hub.style.animation = rpm ? `cbm-spin ${Math.max(0.12, 60 / Math.abs(rpm)).toFixed(3)}s linear infinite${rpm < 0 ? ' reverse' : ''}` : 'none';
    label.textContent = rpm ? `${Math.abs(rpm)} rpm ${rpm > 0 ? '↻' : '↺'}` : '';
  }
}

/** L298N dual H-bridge module: screw terminals OUT1/OUT2 (motor A) and OUT3/OUT4 (motor B), power, logic header. */
class L298n extends CbElement {
  constructor() { super(); this._power = false; this._dirs = ['', '']; }
  get ledPower() { return this._power; }
  set ledPower(v) { v = !!v; if (v === this._power) return; this._power = v; this.update(); }
  /** Per channel: '' (off / braking), 'fwd' or 'rev' — lights the direction LEDs. */
  set channels(v) { const next = [v?.[0] || '', v?.[1] || '']; if (next.join() === this._dirs.join()) return; this._dirs = next; this.update(); }
  markup() {
    const term = (x, y, label, vertical) => `<g><rect x="${x - 7}" y="${y - 7}" width="14" height="14" rx="1.5" fill="#1f6fc5" stroke="#124b87"/><circle cx="${x}" cy="${y}" r="4.2" fill="#cfd5db" stroke="#7b848c"/><path d="M${x - 2.6} ${y} h5.2" stroke="#59616a" stroke-width="1.2"/>
      <text x="${vertical ? x : x}" y="${y + (vertical ? -11 : 3)}" ${vertical ? '' : ''} font-size="7" font-family="sans-serif" fill="#fff" text-anchor="middle" dx="${vertical ? 0 : x < 85 ? 18 : -18}">${label}</text></g>`;
    const hdr = (x, label) => `<rect x="${x - 3.6}" y="155" width="7.2" height="14" fill="#222"/><rect x="${x - 1.2}" y="160" width="2.4" height="9" fill="#d9b44a"/><text x="${x}" y="150" font-size="5.5" font-family="sans-serif" fill="#fff" text-anchor="middle" transform="rotate(-90 ${x} 150)">${label}</text>`;
    return `<svg xmlns="${svgNS}" width="${L298N_W}" height="${L298N_H}" viewBox="0 0 ${L298N_W} ${L298N_H}">
      <rect x="0.5" y="0.5" width="169" height="171" rx="5" fill="#c4202b" stroke="#8c121b"/>
      <circle cx="9" cy="9" r="4" fill="#8c121b"/><circle cx="161" cy="9" r="4" fill="#8c121b"/><circle cx="9" cy="163" r="4" fill="#8c121b"/><circle cx="161" cy="163" r="4" fill="#8c121b"/>
      <rect x="40" y="6" width="90" height="62" rx="2" fill="#26292d"/>
      ${Array.from({ length: 9 }, (_, i) => `<rect x="${45 + i * 9.6}" y="10" width="4.6" height="54" fill="#3a3e43"/>`).join('')}
      <rect x="62" y="70" width="46" height="18" rx="1.5" fill="#111"/><text x="85" y="82" font-size="7" font-family="monospace" fill="#bbb" text-anchor="middle">L298N</text>
      ${term(7, 60, 'OUT1')}${term(7, 80, 'OUT2')}${term(163, 60, 'OUT3')}${term(163, 80, 'OUT4')}
      ${term(30, 164, '12V', true)}${term(50, 164, 'GND', true)}${term(70, 164, '5V', true)}
      ${hdr(92, 'ENA')}${hdr(101.6, 'IN1')}${hdr(111.2, 'IN2')}${hdr(120.8, 'IN3')}${hdr(130.4, 'IN4')}${hdr(140, 'ENB')}
      <circle class="pwr" cx="150" cy="112" r="3.2" fill="#3b1111" stroke="#2a0b0b"/><text x="150" y="122" font-size="5.5" font-family="sans-serif" fill="#fff" text-anchor="middle">PWR</text>
      <circle class="dirA" cx="24" cy="98" r="2.6" fill="#3b1111"/><circle class="dirB" cx="146" cy="98" r="2.6" fill="#3b1111"/>
      <text x="85" y="104" font-size="6.5" font-family="sans-serif" fill="#fff" text-anchor="middle">MOTOR A  ·  MOTOR B</text>
    </svg>`;
  }
  update() {
    const pwr = this.querySelector('.pwr');
    if (!pwr) return;
    pwr.setAttribute('fill', this._power ? '#ff4d4d' : '#3b1111');
    const color = d => (d === 'fwd' ? '#4cff7a' : d === 'rev' ? '#ffd23f' : '#3b1111');
    this.querySelector('.dirA').setAttribute('fill', color(this._dirs[0]));
    this.querySelector('.dirB').setAttribute('fill', color(this._dirs[1]));
  }
}

/** A 9 V-style battery with snap terminals on top. The label shows its voltage. */
class Battery extends CbElement {
  constructor() { super(); this._volts = 9; }
  get volts() { return this._volts; }
  set volts(v) { v = Number(v) || 0; if (v === this._volts) return; this._volts = v; this.update(); }
  markup() {
    return `<svg xmlns="${svgNS}" width="${BATTERY_W}" height="${BATTERY_H}" viewBox="0 0 ${BATTERY_W} ${BATTERY_H}">
      <rect x="18" y="4" width="10" height="12" rx="2" fill="#c9ced3" stroke="#7b848c"/>
      <path d="M44 6 h14 l-3 10 h-8 z" fill="#c9ced3" stroke="#7b848c"/>
      <rect x="4" y="14" width="68" height="110" rx="6" fill="#222831"/>
      <rect x="4" y="14" width="68" height="34" rx="6" fill="#e6b31e"/><rect x="4" y="40" width="68" height="8" fill="#e6b31e"/>
      <text x="23" y="32" font-size="13" font-family="sans-serif" font-weight="800" fill="#7a1d1d" text-anchor="middle">+</text>
      <text x="51" y="32" font-size="13" font-family="sans-serif" font-weight="800" fill="#222" text-anchor="middle">−</text>
      <text class="v" x="38" y="86" font-size="20" font-family="sans-serif" font-weight="800" fill="#f2f2f2" text-anchor="middle">9V</text>
      <text x="38" y="104" font-size="8" font-family="sans-serif" fill="#9aa3ad" text-anchor="middle">BATTERY</text>
    </svg>`;
  }
  update() { const t = this.querySelector('.v'); if (t) t.textContent = `${+this._volts.toFixed(1)}V`; }
}

for (const [tag, cls] of [['cb-dc-motor', DcMotor], ['cb-l298n', L298n], ['cb-battery', Battery]]) {
  if (globalThis.customElements && !customElements.get(tag)) customElements.define(tag, cls);
}

/** A student-made part (src/core/custom-parts.js): drawn from its spec — body, name, pins with their labels. */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function customPartSVG(spec, { lit = 0 } = {}) {
  const { w, h, pins } = layoutSpec(spec);
  if (spec.package === 'dip' || spec.package === 'dip-wide') return dipSVG(spec, w, h, pins);
  const inset = 9, bw = w - inset * 2, bh = h - inset * 2;
  const kind = spec.behaviour.kind;
  const leads = pins.map(p => {
    const end = { left: [inset, p.y], right: [w - inset, p.y], top: [p.x, inset], bottom: [p.x, h - inset] }[p.side];
    return `<line x1="${p.x}" y1="${p.y}" x2="${end[0]}" y2="${end[1]}" stroke="#9aa3ab" stroke-width="2.2"/><rect x="${p.x - 2.4}" y="${p.y - 2.4}" width="4.8" height="4.8" rx="0.8" fill="#d9b44a" stroke="#8a6d1d" stroke-width="0.6"/>`;
  }).join('');
  // A rotated label grows upward from its anchor, so a top-edge pin anchors a band's height below the body
  // edge — otherwise long names ran up out of the chip. Quad packages print smaller: four sides of names.
  const quad = spec.package === 'quad';
  const size = quad ? 4.4 : 5.6, band = quad ? 16 : 14;
  const labels = pins.map(p => {
    const pos = { left: [inset + 3, p.y + size * 0.4, 'start'], right: [w - inset - 3, p.y + size * 0.4, 'end'], top: [p.x, inset + band, 'start'], bottom: [p.x, h - inset - 3.5, 'start'] }[p.side];
    const vertical = p.side === 'top' || p.side === 'bottom';
    return `<text x="${pos[0]}" y="${pos[1]}" text-anchor="${pos[2]}" font-size="${size}" font-family="monospace" fill="${spec.textColor}" opacity=".85"${vertical ? ` transform="rotate(-90 ${pos[0]} ${pos[1]})"` : ''}>${esc(p.id)}</text>`;
  }).join('');
  // Pin 1 marker: every real quad package has one, and without it the numbering is unreadable.
  const pin1 = quad ? `<circle cx="${(inset + 5).toFixed(2)}" cy="${(inset + 5).toFixed(2)}" r="2.2" fill="${spec.textColor}" opacity=".7"><title>pin 1: ${esc(pins[0]?.id || '')}</title></circle>` : '';
  const color = { red: '#ff3b30', green: '#34c759', blue: '#3b82f6', yellow: '#ffd60a', orange: '#ff9f0a', white: '#ffffff' }[spec.behaviour.color] || '#ff3b30';
  const extra = kind === 'led'
    ? `<circle class="cp-led" cx="${w / 2}" cy="${h / 2 - 7}" r="6" fill="${color}" opacity="${0.25 + 0.75 * lit}" stroke="#0003"/>${lit ? `<circle cx="${w / 2}" cy="${h / 2 - 7}" r="11" fill="${color}" opacity="${0.35 * lit}"/>` : ''}`
    : kind === 'button' || kind === 'digital-sensor' ? `<circle class="cp-cap" cx="${w / 2}" cy="${h / 2 - 7}" r="6.5" fill="#20262c" stroke="#0006"/>` : '';
  const nameY = kind === 'led' || kind === 'button' || kind === 'digital-sensor' ? h / 2 + 8 : h / 2 + 3;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${leads}
    <rect x="${inset}" y="${inset}" width="${bw}" height="${bh}" rx="5" fill="${spec.color}" stroke="#0005"/>
    ${extra}${pin1}
    ${labels}
    <text x="${w / 2}" y="${nameY}" text-anchor="middle" font-size="8.5" font-weight="700" font-family="sans-serif" fill="${spec.textColor}"
      stroke="${spec.color}" stroke-width="${quad ? 2.2 : 0}" paint-order="stroke">${esc(spec.label)}</text>
  </svg>`;
}
/**
 * A DIP chip, drawn the way the real package looks: two rows of legs 0.3" apart (so it straddles the
 * breadboard's trench), a notch and a dot at the pin-1 end, the part number across the middle, and each
 * leg's name printed beside it. Pin names run along the legs because at 0.1" pitch that is the only way
 * eight of them fit in a row — exactly how silkscreen on a real board reads.
 */
function dipSVG(spec, w, h, pins) {
  const top = pins.find(p => p.side === 'top')?.y ?? 15, bot = pins.find(p => p.side === 'bottom')?.y ?? 44;
  const bodyT = top + 1.6, bodyB = bot - 1.6, bodyX = 4.5, bodyW = w - bodyX * 2;
  const legs = pins.map(p => {
    const [y1, y2] = p.side === 'top' ? [bodyT, p.y - 4.2] : [bodyB, p.y + 4.2];
    return `<rect x="${(p.x - 2.1).toFixed(2)}" y="${Math.min(y1, y2).toFixed(2)}" width="4.2" height="${Math.abs(y2 - y1).toFixed(2)}" rx="0.7" fill="#cfd5db" stroke="#8d969e" stroke-width="0.5"/>`
      + `<rect x="${(p.x - 2.4).toFixed(2)}" y="${(p.y - 2.4).toFixed(2)}" width="4.8" height="4.8" rx="0.8" fill="#d9b44a" stroke="#8a6d1d" stroke-width="0.6"/>`;
  }).join('');
  // Both rows read bottom-to-top, like silkscreen. rotate(-90) with text-anchor="start" makes a label grow
  // upwards from its anchor, so the anchor goes at the BOTTOM of the band each row gets: just inside the body
  // edge for the bottom row, a band's height below the body edge for the top row. The part number is drawn
  // last, with a halo, so it stays readable where a long pin name reaches the middle.
  const band = Math.min(16, Math.max(9, (bodyB - bodyT) / 2 - 3));
  const names = pins.map(p => {
    const y = +(p.side === 'top' ? bodyT + band : bodyB - 2.4).toFixed(2);
    return `<text x="${p.x}" y="${y}" text-anchor="start" font-size="3.4" font-family="monospace" fill="${spec.textColor}" opacity=".85" transform="rotate(-90 ${p.x} ${y})" dy="1.2">${esc(p.id)}</text>`;
  }).join('');
  const one = pins[0];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${legs}
    <rect x="${bodyX}" y="${bodyT.toFixed(2)}" width="${bodyW.toFixed(2)}" height="${(bodyB - bodyT).toFixed(2)}" rx="1.6" fill="${spec.color}" stroke="#0006" stroke-width="0.7"/>
    <path d="M${bodyX} ${((bodyT + bodyB) / 2 - 3.6).toFixed(2)} a3.6 3.6 0 0 0 0 7.2z" fill="#00000038" stroke="#00000022" stroke-width="0.4"/>
    <circle cx="${(bodyX + 3.2).toFixed(2)}" cy="${(bodyB - 3.4).toFixed(2)}" r="1.3" fill="${spec.textColor}" opacity=".7"><title>pin 1: ${esc(one.id)}</title></circle>
    ${names}
    <text x="${(w / 2).toFixed(2)}" y="${((bodyT + bodyB) / 2 + 2.1).toFixed(2)}" text-anchor="middle" font-size="6" font-weight="700" font-family="sans-serif" fill="${spec.textColor}"
      stroke="${spec.color}" stroke-width="1.9" paint-order="stroke">${esc(spec.label)}</text>
  </svg>`;
}

class CustomPart extends HTMLElement {
  constructor() { super(); this._spec = null; this._lit = 0; }
  set spec(s) { this._spec = s; this.render(); }
  get spec() { return this._spec; }
  set lit(v) { v = Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 10) / 10; if (v === this._lit) return; this._lit = v; this.render(); }
  get lit() { return this._lit; }
  connectedCallback() { this.style.display = 'inline-block'; this.render(); }
  render() { if (this._spec) this.innerHTML = customPartSVG(this._spec, { lit: this._lit }); }
}
if (globalThis.customElements && !customElements.get('cb-custom-part')) customElements.define('cb-custom-part', CustomPart);
