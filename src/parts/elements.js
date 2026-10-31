// Drawings for parts @wokwi/elements doesn't have: a DC motor, an L298N motor-driver module and a battery.
// Plain custom elements (no framework) sized in CSS px; their pin positions live in PART_DEFS (src/core/parts.js),
// so these files only draw. Each one is a tiny SVG with a few live properties the simulator sets.

import { LOBES, MM_TO_PX } from '../core/slime.js';
import { lookSVG } from '../core/part-looks.js';
import { ICON_KINDS } from '../core/behaviours-extra.js';
import { layoutSpec } from '../core/custom-parts.js';
import { renderArt } from '../core/part-art.js';
import { droneSprite } from './drone-art.js';
import { WOKWI_PINS } from '../core/pins.generated.js';

const svgNS = 'http://www.w3.org/2000/svg';

export const MOTOR_W = 120, MOTOR_H = 120;
export const L298N_W = 170, L298N_H = 172;
export const BATTERY_W = 76, BATTERY_H = 128;
export const R4_PX_W = 72.58 * 96 / 25.4, R4_PX_H = 53.34 * 96 / 25.4;
export const PICO_PX_W = 21 * 96 / 25.4, PICO_PX_H = 51 * 96 / 25.4;

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


/** Raspberry Pi Pico: green board, micro-USB at the top, BOOTSEL button, RP2040 chip, on-board LED (GP25) and the pin names printed beside the pins. */
class PiPico extends CbElement {
  constructor() { super(); this._led = false; this._power = false; }
  get led13() { return this._led; }
  set led13(v) { v = !!v; if (v === this._led) return; this._led = v; this.update(); }
  get ledPower() { return this._power; }
  set ledPower(v) { v = !!v; if (v === this._power) return; this._power = v; this.update(); }
  markup() {
    const W = PICO_PX_W, H = PICO_PX_H, P = 2.54 * 96 / 25.4, x0 = (W - 7 * P) / 2, y0 = (H - 19 * P) / 2;
    const L = ['GP0', 'GP1', 'GND', 'GP2', 'GP3', 'GP4', 'GP5', 'GND', 'GP6', 'GP7', 'GP8', 'GP9', 'GND', 'GP10', 'GP11', 'GP12', 'GP13', 'GND', 'GP14', 'GP15'];
    const R = ['VBUS', 'VSYS', 'GND', '3V3E', '3V3', 'VREF', 'GP28', 'AGND', 'GP27', 'GP26', 'RUN', 'GP22', 'GND', 'GP21', 'GP20', 'GP19', 'GP18', 'GND', 'GP17', 'GP16'];
    let labels = '', holes = '';
    L.forEach((t, i) => { const y = y0 + i * P; holes += `<rect x="${(x0 - 2.5).toFixed(1)}" y="${(y - 2.5).toFixed(1)}" width="5" height="5" rx="1.2" fill="#d9b04a"/>`; labels += `<text x="${(x0 + 5).toFixed(1)}" y="${(y + 2).toFixed(1)}" font-size="5.2" font-family="sans-serif" fill="${t === 'GND' || t === 'AGND' ? '#cfe9d6' : '#fff'}" text-anchor="start">${t}</text>`; });
    R.forEach((t, i) => { const y = y0 + i * P, x = x0 + 7 * P; holes += `<rect x="${(x - 2.5).toFixed(1)}" y="${(y - 2.5).toFixed(1)}" width="5" height="5" rx="1.2" fill="#d9b04a"/>`; labels += `<text x="${(x - 5).toFixed(1)}" y="${(y + 2).toFixed(1)}" font-size="5.2" font-family="sans-serif" fill="${t === 'GND' || t === 'AGND' ? '#cfe9d6' : '#fff'}" text-anchor="end">${t}</text>`; });
    const cx = W / 2;
    return `<svg xmlns="${svgNS}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="4" fill="#1b7f3b" stroke="#0f5a28"/>
      ${holes}
      <rect x="${cx - 10}" y="0" width="20" height="14" rx="1.5" fill="#c9ced3" stroke="#7b848c"/><rect x="${cx - 7}" y="10" width="14" height="3" fill="#8d959c"/>
      <rect x="${cx - 6}" y="19" width="12" height="7" rx="1.5" fill="#f1f1ee" stroke="#a9a9a4"/>
      <circle class="pwr" cx="${cx - 4}" cy="33" r="1.9" fill="#3b1111"/>
      <circle class="led" cx="${cx + 4}" cy="33" r="2.3" fill="#17401f" stroke="#0f2f17" stroke-width=".6"/>
      <rect x="${cx - 11}" y="62" width="22" height="22" rx="2" fill="#16181b" stroke="#000"/><circle cx="${cx - 7}" cy="66" r="1.2" fill="#454a50"/>
      <text x="${cx}" y="76.5" font-size="5.4" font-family="sans-serif" font-weight="700" fill="#cfd4d9" text-anchor="middle">RP2040</text>
      <rect x="${cx - 8}" y="104" width="16" height="9" rx="1.5" fill="#16181b"/>
      <text x="${cx}" y="136" font-size="7" font-family="sans-serif" font-weight="700" fill="#f4faf5" text-anchor="middle">Pico</text>
      ${labels}
      <rect x="${cx - 14}" y="${H - 14}" width="28" height="8" rx="1" fill="#0f5a28"/>${[-8, 0, 8].map(dx => `<circle cx="${cx + dx}" cy="${H - 10}" r="1.5" fill="#d9b04a"/>`).join('')}
    </svg>`;
  }
  update() {
    const led = this.querySelector('.led'), pwr = this.querySelector('.pwr');
    if (led) led.setAttribute('fill', this._led ? '#7dff8f' : '#17401f');
    if (pwr) pwr.setAttribute('fill', this._power ? '#ff4d4d' : '#3b1111');
  }
}

/** Arduino UNO R4 Minima: same header positions as the R3 (shields and jumper wires fit alike), but a USB-C port, the square Renesas RA4M1 and the R4's teal board. */
class UnoR4 extends CbElement {
  constructor() { super(); this._led = false; this._power = false; }
  get led13() { return this._led; }
  set led13(v) { v = !!v; if (v === this._led) return; this._led = v; this.update(); }
  get ledPower() { return this._power; }
  set ledPower(v) { v = !!v; if (v === this._power) return; this._power = v; this.update(); }
  markup() {
    const W = R4_PX_W, H = R4_PX_H;
    const pins = WOKWI_PINS['wokwi-arduino-uno'];
    const sockets = pins.map(p => `<rect x="${(p.x - 4.2).toFixed(1)}" y="${(p.y - 4.2).toFixed(1)}" width="8.4" height="8.4" rx="1" fill="#15191c"/><rect x="${(p.x - 1.6).toFixed(1)}" y="${(p.y - 1.6).toFixed(1)}" width="3.2" height="3.2" fill="#d9b04a"/>`).join('');
    const hdr = (x1, x2, y) => `<rect x="${x1 - 6}" y="${y - 6}" width="${x2 - x1 + 12}" height="12" rx="1.5" fill="#0d1113" opacity=".55"/>`;
    const short = n => { const b = n.replace(/\.\d+$/, ''); return { IOREF: 'IOR', RESET: 'RST', '3.3V': '3V3', AREF: 'REF', GND: 'G' }[b] || b; };
    const lab = (t, x, y, a = 'middle') => `<text x="${x}" y="${y}" font-size="4.6" font-family="sans-serif" fill="#e9fbfc" text-anchor="${a}">${t}</text>`;
    const top = pins.filter(p => p.y < 100), bot = pins.filter(p => p.y > 100);
    const topLabels = top.map(p => lab(p.name === 'A5.2' ? 'SCL' : p.name === 'A4.2' ? 'SDA' : short(p.name), p.x, p.y + 13)).join('');
    const botLabels = bot.map(p => lab(short(p.name), p.x, p.y - 8)).join('');
    return `<svg xmlns="${svgNS}" width="${W}" height="${H}" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}">
      <rect x="0.5" y="0.5" width="${(W - 1).toFixed(1)}" height="${(H - 1).toFixed(1)}" rx="7" fill="#0b7f89" stroke="#075a62" stroke-width="1.2"/>
      ${hdr(87, 255.5, 9)}${hdr(131, 255.5, 191.5)}
      <rect x="-2" y="62" width="34" height="30" rx="2" fill="#c9ced3" stroke="#7b848c"/><rect x="2" y="68" width="22" height="18" rx="3" fill="#2a2f34"/>
      <text x="14" y="80" font-size="5.5" font-family="sans-serif" fill="#e5e9ec" text-anchor="middle">USB-C</text>
      <rect x="-3" y="128" width="46" height="46" rx="2" fill="#16181b" stroke="#000"/><circle cx="26" cy="151" r="8" fill="#050607" stroke="#2b2f33"/>
      <rect x="112" y="76" width="54" height="54" rx="3" fill="#15181b" stroke="#000"/><circle cx="121" cy="85" r="2.4" fill="#454a50"/>
      <text x="139" y="105" font-size="9" font-family="sans-serif" font-weight="700" fill="#d7dce0" text-anchor="middle">RA4M1</text>
      <text x="139" y="116" font-size="5.5" font-family="sans-serif" fill="#9aa2a9" text-anchor="middle">Renesas</text>
      <circle cx="62" cy="40" r="9" fill="#cfd4d9" stroke="#8a9299"/><circle cx="62" cy="40" r="5.5" fill="#2a2f34"/><text x="62" y="58" font-size="5.5" font-family="sans-serif" fill="#e9fbfc" text-anchor="middle">RESET</text>
      <circle class="pwr" cx="205" cy="62" r="3" fill="#2d0f0f"/><text x="205" y="73" font-size="5.5" font-family="sans-serif" fill="#e9fbfc" text-anchor="middle">ON</text>
      <circle class="led" cx="238" cy="62" r="3" fill="#4a3a0a"/><text x="238" y="73" font-size="5.5" font-family="sans-serif" fill="#e9fbfc" text-anchor="middle">L</text>
      <text x="196" y="150" font-size="13" font-family="sans-serif" font-weight="800" fill="#f2fdfe" text-anchor="middle">UNO R4</text>
      <text x="196" y="162" font-size="7" font-family="sans-serif" letter-spacing="2" fill="#bfeff3" text-anchor="middle">MINIMA</text>
      ${sockets}${topLabels}${botLabels}
    </svg>`;
  }
  update() {
    const led = this.querySelector('.led'), pwr = this.querySelector('.pwr');
    if (led) led.setAttribute('fill', this._led ? '#ffd23d' : '#4a3a0a');
    if (pwr) pwr.setAttribute('fill', this._power ? '#5dff7a' : '#2d0f0f');
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

for (const [tag, cls] of [['cb-dc-motor', DcMotor], ['cb-l298n', L298n], ['cb-battery', Battery], ['cb-pi-pico', PiPico]]) {
  if (globalThis.customElements && !customElements.get(tag)) customElements.define(tag, cls);
}

/**
 * The UNO R4 Minima is the R3's own drawing (header, pins, LEDs, reset button — all the real detail) re-skinned: teal board,
 * USB-C instead of the big USB-B, a square Renesas RA4M1 instead of the long ATmega, and its own name. Where the wokwi R3 element
 * is not available (a bare test page) the standalone drawing above is used instead.
 */
const SVG = 'http://www.w3.org/2000/svg';
const mk = (tag, attrs, text) => { const e = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
function skinR4(root) {
  const svg = root?.querySelector('svg');
  if (!svg || svg.querySelector('#r4-skin')) return;
  svg.querySelector('path[fill="#2b6b99"]')?.setAttribute('fill', '#0b7f89');                      // the board
  for (const g of svg.querySelectorAll('g')) {
    if ((g.getAttribute('style') || '').includes('#b3b2b2')) g.setAttribute('display', 'none');   // the big USB-B connector
    if (g.querySelector(':scope > rect[fill="url(#mcu-leads)"]')) g.setAttribute('display', 'none');   // the long ATmega package
  }
  const skin = mk('g', { id: 'r4-skin' });
  const chip = mk('g', { transform: 'translate(-8.7 -7.9)' }), name = mk('g', { transform: 'translate(-5 -7)' });   // chip near the middle of the board
  skin.append(
    mk('rect', { x: -1.6, y: 13.4, width: 8, height: 3.6, rx: 1.5, fill: '#cfd4d9', stroke: '#8a9299', 'stroke-width': 0.15 }),   // USB-C shell
    mk('rect', { x: -0.4, y: 14.5, width: 5.6, height: 1.4, rx: 0.7, fill: '#2a2f34' }),
  );
  chip.append(
    mk('rect', { x: 36.2, y: 31.4, width: 11, height: 11, rx: 0.4, fill: '#16191c', stroke: '#050607', 'stroke-width': 0.15 }),   // RA4M1, square
    mk('circle', { cx: 37.6, cy: 32.8, r: 0.55, fill: '#4a5056' }),
    mk('text', { x: 41.7, y: 37.4, fill: '#d7dce0', 'font-size': 1.9, 'font-weight': 700, 'text-anchor': 'middle', 'font-family': 'sans-serif' }, 'RA4M1'),
    mk('text', { x: 41.7, y: 39.5, fill: '#8d959c', 'font-size': 1.1, 'text-anchor': 'middle', 'font-family': 'sans-serif' }, 'RENESAS'),
  );
  name.append(
    mk('text', { x: 54, y: 37, fill: '#f2fdfe', 'font-size': 3.4, 'font-weight': 800, 'text-anchor': 'middle', 'font-family': 'sans-serif' }, 'UNO R4'),
    mk('text', { x: 54, y: 40.2, fill: '#bfeff3', 'font-size': 1.7, 'letter-spacing': 0.5, 'text-anchor': 'middle', 'font-family': 'sans-serif' }, 'MINIMA'),
  );
  for (let i = 0; i < 16; i++) { const t = 36.2 + 0.6 + i * 0.6875; chip.append(mk('rect', { x: t, y: 30.9, width: 0.25, height: 0.5, fill: '#b8bec4' }), mk('rect', { x: t, y: 42.4, width: 0.25, height: 0.5, fill: '#b8bec4' })); }
  skin.append(chip, name);
  svg.append(skin);
}
function defineUnoR4() {
  if (!globalThis.customElements || customElements.get('cb-uno-r4')) return;
  const Base = customElements.get('wokwi-arduino-uno');
  if (!Base) { customElements.define('cb-uno-r4', UnoR4); return; }
  customElements.define('cb-uno-r4', class extends Base {
    firstUpdated(c) { super.firstUpdated?.(c); skinR4(this.shadowRoot); }
    updated(c) { super.updated?.(c); skinR4(this.shadowRoot); }
  });
}
defineUnoR4();

/** A student-made part (src/core/custom-parts.js): drawn from its spec — body, name, pins with their labels. */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * A little schematic symbol (or live indicator) in the middle of a student-made part: the symbol of the
 * component it behaves like, so a diode reads as a diode, with state drawn in — a switch's lever, a relay's
 * contact, a servo's horn, a motor's blades, a bar graph's lit segments.
 *   st = { lit: 0–1, aux: number (angle in degrees, or rpm), levels: number[] (per-LED brightness) }
 */
function iconSVG(spec, st, cx, cy, fg) {
  const kind = spec.behaviour.kind, b = spec.behaviour, lit = st.lit || 0, aux = st.aux || 0;
  const line = `stroke="${fg}" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  const on = '#ffd60a';
  const g = inner => `<g transform="translate(${cx} ${cy})">${inner}</g>`;
  switch (kind) {
    case 'switch': {
      const spdt = !!b.roles.throw2, closed = spdt ? true : lit > 0.5;
      const tip = spdt ? (lit > 0.5 ? [11, 6] : [11, -6]) : closed ? [11, 0] : [10, -8];
      return g(`<circle cx="-11" cy="0" r="1.8" fill="${fg}"/><circle cx="11" cy="${spdt ? -6 : 0}" r="1.8" fill="${fg}"/>${spdt ? `<circle cx="11" cy="6" r="1.8" fill="${fg}"/>` : ''}<path d="M-11 0 L${tip[0]} ${tip[1]}" ${line}/>`);
    }
    case 'relay':
      return g(`<path d="M-14 4 q2-7 4 0 q2-7 4 0 q2-7 4 0" ${line}/><circle cx="8" cy="-4" r="1.6" fill="${fg}"/><circle cx="14" cy="2" r="1.6" fill="${fg}"/><path d="M8 -4 L${lit > 0.5 ? '14 2' : '12 -5'}" ${line}/><circle cx="-13" cy="-6" r="2.6" fill="${lit > 0.5 ? on : '#00000055'}" stroke="#0005" stroke-width=".5"/>`);
    case 'variable-resistor':
      return g(`<rect x="-12" y="-4" width="24" height="8" ${line}/><path d="M-5 11 L5 -9 M5 -9 l-1 4 M5 -9 l-4 1" ${line}/>`);
    case 'diode':
      return g(`<path d="M-12 0h8M4 0h8M-4 -7v14l8-7zM4 -7v14" ${line}/>${b.vz ? `<path d="M4 -7l-3 -2M4 7l3 2" ${line}/>` : ''}`);
    case 'npn': case 'pnp': {
      const out = kind === 'npn';
      return g(`<circle cx="2" cy="0" r="12" ${line}/><path d="M-14 0h8M-6 -7v14M-6 -3L4 -9v-3M-6 3L4 9v3" ${line}/><path d="${out ? 'M4 9 l-4 -1 M4 9 l-1 -4' : 'M-6 3 l4 -1 M-6 3 l1 4'}" ${line}/>`);
    }
    case 'nmos': case 'pmos':
      return g(`<path d="M-14 4h6M-8 -8v16M-5 -8v4M-5 -2v4M-5 4v4M-5 -6h12v-6M-5 6h12v6M-5 0h12" ${line}/><path d="${kind === 'nmos' ? 'M-1 0 l4 -2 M-1 0 l4 2' : 'M6 0 l-4 -2 M6 0 l-4 2'}" ${line}/>`);
    case 'regulator':
      return g(`<rect x="-14" y="-9" width="28" height="18" rx="3" ${line}/><text y="4.5" text-anchor="middle" font-size="10" font-weight="800" font-family="sans-serif" fill="${fg}">${+b.vout}V</text>`);
    case 'capacitor':
      return g(`<path d="M-12 0h9M3 0h9M-3 -8v16M3 -8v16" ${line}/>`);
    case 'inductor':
      return g(`<path d="M-14 3 a4 5 0 0 1 8 0 a4 5 0 0 1 8 0 a4 5 0 0 1 8 0" ${line}/>`);
    case 'buzzer': {
      const wave = lit > 0.5 ? `<path d="M8 -6 q4 6 0 12 M12 -9 q7 9 0 18" ${line} stroke="${on}"/>` : '';
      return g(`<path d="M-12 -3h5l6 -5v16l-6 -5h-5z" fill="${fg}" opacity=".9"/>${wave}`);
    }
    case 'bldc': case 'bldc-esc': {
      const dur = aux ? Math.max(0.08, Math.min(3, 60 / Math.abs(aux))) : 0;
      const spin = aux ? `style="transform-origin:0 0;animation:cp-spin ${dur.toFixed(2)}s linear infinite${aux < 0 ? ' reverse' : ''}"` : '';
      return g(`<circle r="12" ${line}/><g ${spin}><path d="M0 0L0 -9M0 0L7.8 4.5M0 0L-7.8 4.5" ${line} stroke-width="2.4"/></g><circle r="2" fill="${fg}"/>`);
    }
    case 'motor': {
      const dur = aux ? Math.max(0.12, Math.min(3, 60 / Math.abs(aux))) : 0;
      const spin = aux ? `style="transform-origin:0 0;animation:cp-spin ${dur.toFixed(2)}s linear infinite${aux < 0 ? ' reverse' : ''}"` : '';
      return g(`<circle r="12" ${line}/><g ${spin}><path d="M0 -9v18M-9 0h18" ${line}/></g><circle r="2" fill="${fg}"/>`);
    }
    case 'led-array': {
      const n = b.segments.length, w = Math.min(5, 40 / Math.max(1, n)), total = n * (w + 1), color = { red: '#ff3b30', green: '#34c759', blue: '#3b82f6', yellow: '#ffd60a', orange: '#ff9f0a', white: '#ffffff' }[b.color] || '#34c759';
      const lv = st.levels || [];
      return g(b.segments.map((_, i) => `<rect x="${(-total / 2 + i * (w + 1)).toFixed(1)}" y="-6" width="${w.toFixed(1)}" height="12" rx="1" fill="${color}" opacity="${(0.18 + 0.82 * (lv[i] || 0)).toFixed(2)}" stroke="#0004" stroke-width=".4"/>`).join(''));
    }
    case 'servo': {
      const a = (-90 + (aux / (b.range || 180)) * 180 - 90) * Math.PI / 180, r = 11;
      return g(`<path d="M-12 8 A15 15 0 0 1 12 8" ${line} opacity=".5"/><circle cx="0" cy="6" r="3" fill="${fg}"/><path d="M0 6 L${(Math.cos(a) * r).toFixed(1)} ${(6 + Math.sin(a) * r).toFixed(1)}" ${line} stroke-width="2.4"/>`);
    }
    case 'ultrasonic':
      return g(`<circle cx="-9" cy="0" r="8" ${line}/><circle cx="9" cy="0" r="8" ${line}/><circle cx="-9" cy="0" r="3" fill="${fg}" opacity=".6"/><circle cx="9" cy="0" r="3" fill="${fg}" opacity=".6"/>`);
    case 'encoder': {
      const a = aux * Math.PI / 180;
      return g(`<circle r="11" ${line}/><path d="M0 0 L${(Math.sin(a) * 9).toFixed(1)} ${(-Math.cos(a) * 9).toFixed(1)}" ${line} stroke-width="2.2"/>${lit ? `<circle r="4" fill="${on}"/>` : ''}`);
    }
    case 'stepper': {
      const a = aux * Math.PI / 180;
      return g(`<circle r="11" ${line}/><circle r="3" fill="${fg}"/><circle cx="${(Math.sin(a) * 8).toFixed(1)}" cy="${(-Math.cos(a) * 8).toFixed(1)}" r="2.2" fill="${on}"/>`);
    }
    default: return '';
  }
}

export function customPartSVG(spec, { lit = 0, aux = 0, levels = null } = {}) {
  const { w, h, pins } = layoutSpec(spec);
  if (spec.package === 'board' && spec.board) return boardSVG(spec, w, h, pins);
  if (spec.package === 'art' && spec.art) return artSVG(spec, w, h, pins, { lit, aux, levels });
  if (spec.package === 'sprite' && spec.sprite) return spriteSVG(spec, w, h, pins);
  if (spec.package === 'dip' || spec.package === 'dip-wide') return dipSVG(spec, w, h, pins);
  if (spec.look && lookSVG(spec.look, spec, w, h, pins)) {
    const dots = pins.map(p => `<rect x="${(p.x - 2.4).toFixed(1)}" y="${(p.y - 2.4).toFixed(1)}" width="4.8" height="4.8" rx="0.8" fill="#d9b44a" stroke="#8a6d1d" stroke-width="0.6"><title>${esc(p.label || p.id)}</title></rect>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${lookSVG(spec.look, spec, w, h, pins)}${dots}</svg>`;
  }
  if (spec.package === 'module' && !spec.look && !LIVE_ICON_KINDS.has(spec.behaviour.kind)) return moduleBoardSVG(spec, w, h, pins);
  const inset = 9, bw = w - inset * 2, bh = h - inset * 2;
  const kind = spec.behaviour.kind;
  const leads = pins.map(p => {
    const end = { left: [inset, p.y], right: [w - inset, p.y], top: [p.x, inset], bottom: [p.x, h - inset] }[p.side];
    return `<line x1="${p.x}" y1="${p.y}" x2="${end[0]}" y2="${end[1]}" stroke="#9aa3ab" stroke-width="2.2"/><rect x="${(p.x - 2.4).toFixed(1)}" y="${(p.y - 2.4).toFixed(1)}" width="4.8" height="4.8" rx="0.8" fill="#d9b44a" stroke="#8a6d1d" stroke-width="0.6"/>`;
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
    : kind === 'button' || kind === 'digital-sensor' ? `<circle class="cp-cap" cx="${w / 2}" cy="${h / 2 - 7}" r="6.5" fill="#20262c" stroke="#0006"/>`
    : ICON_KINDS.has(kind) ? iconSVG(spec, { lit, aux, levels }, w / 2, h / 2 - 16, spec.textColor) : '';
  const nameY = ICON_KINDS.has(kind) ? h / 2 + 5 : kind === 'led' || kind === 'button' || kind === 'digital-sensor' ? h / 2 + 8 : h / 2 + 3;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${leads}
    <rect x="${inset}" y="${inset}" width="${bw}" height="${bh}" rx="5" fill="${spec.color}" stroke="#0005"/>
    ${extra}${pin1}
    ${labels}
    <text x="${w / 2}" y="${nameY}" text-anchor="middle" font-size="8.5" font-weight="700" font-family="sans-serif" fill="${spec.textColor}"
      stroke="${spec.color}" stroke-width="${quad ? 2.2 : 0}" paint-order="stroke">${esc(spec.label)}</text>
  </svg>`;
}
const LIVE_ICON_KINDS = new Set([...ICON_KINDS].filter(k => k !== 'hbridge').concat(['led', 'button', 'digital-sensor']));
/** Any breakout board without a ready-made picture, drawn like the real thing: a coloured PCB, gold pads where the pins are, the pin names in silkscreen along the
 *  edges, and the main chip in the middle carrying the part's label. The fallback for every module the AI or a student defines without its own drawing. */
function moduleBoardSVG(spec, w, h, pins) {
  const size = 5.4, ink = spec.textColor || '#ffffff';
  const pads = pins.map(p => `<circle cx="${p.x}" cy="${p.y}" r="2.9" fill="#d9b44a" stroke="#8a6d1d" stroke-width=".6"><title>${esc(p.label || p.id)}</title></circle><circle cx="${p.x}" cy="${p.y}" r="1.1" fill="#0d1215"/>`).join('');
  const names = pins.map(p => {
    const pos = { left: [p.x + 6, p.y + size * 0.36, 'start'], right: [p.x - 6, p.y + size * 0.36, 'end'], top: [p.x, p.y + 6, 'end'], bottom: [p.x, p.y - 6, 'start'] }[p.side];
    if (!pos) return '';
    const vertical = p.side === 'top' || p.side === 'bottom';
    return `<text x="${pos[0]}" y="${pos[1]}" text-anchor="${pos[2]}" font-size="${size}" font-family="sans-serif" font-weight="700" fill="${ink}" opacity=".9"${vertical ? ` transform="rotate(-90 ${pos[0]} ${pos[1]})"` : ''}>${esc(p.id)}</text>`;
  }).join('');
  const cw = Math.min(34, Math.max(20, w * 0.34)), ch = Math.min(30, Math.max(16, h * 0.34)), cx = w / 2 - cw / 2, cy = h / 2 - ch / 2;
  const chip = w >= 56 && h >= 40 ? `<rect x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" rx="2" fill="#16181c" stroke="#000" stroke-width=".8"/><circle cx="${(cx + 3.6).toFixed(1)}" cy="${(cy + 3.6).toFixed(1)}" r="1.3" fill="#555a62"/>
    <text x="${w / 2}" y="${(h / 2 + 2.4).toFixed(1)}" text-anchor="middle" font-size="${Math.min(8, Math.max(4.6, (cw - 4) / Math.max(4, String(spec.label).length) * 1.45)).toFixed(1)}" font-family="monospace" font-weight="700" fill="#cfd3d8">${esc(spec.label)}</text>` : `<text x="${w / 2}" y="${(h / 2 + 3).toFixed(1)}" text-anchor="middle" font-size="7.5" font-family="sans-serif" font-weight="800" fill="${ink}">${esc(spec.label)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="4" fill="${spec.color}" stroke="#05080c" stroke-width="1.2"/><rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="3" fill="none" stroke="#ffffff" stroke-opacity=".15"/>${chip}${names}${pads}</svg>`;
}
/** A part drawn by the AI (or the student) as SVG: its picture, with the moving pieces driven by the live simulation, and a lead dot on every pin. */
function artSVG(spec, w, h, pins, st) {
  const dots = pins.map(p => `<rect x="${(p.x - 2.4).toFixed(1)}" y="${(p.y - 2.4).toFixed(1)}" width="4.8" height="4.8" rx="0.8" fill="#d9b44a" stroke="#8a6d1d" stroke-width="0.6"><title>${esc(p.label || p.id)}</title></rect>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${renderArt(spec.art, { lit: st.lit, aux: st.aux, level: st.levels?.[0] })}${dots}</svg>`;
}
/** Simple pictures of real modules (a "sprite"): the board, its header pins and connector, with each pin lead ending on its connection point. */
function spriteSVG(spec, w, h, pins) {
  if (spec.sprite.art.startsWith('drone-')) return droneSprite(spec.sprite.art, spec, w, h, pins);
  const lbl = pins.map(p => `<text x="${p.x < w / 2 ? p.x + 24 : p.x - 8}" y="${p.y + 2.2}" text-anchor="${p.x < w / 2 ? 'start' : 'end'}" font-size="5.6" font-family="monospace" fill="#fff" stroke="#3a1c6e" stroke-width="1.6" paint-order="stroke">${esc(p.id)}</text>`).join('');
  if (spec.sprite.art === 'bioamp-pill') {
    // the Upside Down Labs BioAmp EXG Pill: a purple board, a 3-pin header out of the left edge and a white 3-pin connector on the right
    const left = pins.filter(p => p.x < w / 2), right = pins.filter(p => p.x >= w / 2);
    const bx = 20, bw = w - 40, by = 8, bh = h - 16;
    const header = `<rect x="2" y="${by + 6}" width="${bx + 6}" height="${bh - 12}" rx="1.5" fill="#1b1b1f"/>` + left.map(p => `<rect x="0" y="${p.y - 1.6}" width="${bx + 4}" height="3.2" fill="#c9ccd1" stroke="#8b9096" stroke-width=".5"/>`).join('');
    const conn = `<rect x="${w - 34}" y="${by + 4}" width="32" height="${bh - 8}" rx="3" fill="#f3f1ea" stroke="#b9b5a6"/>` + right.map(p => `<rect x="${w - 8}" y="${p.y - 1.8}" width="7" height="3.6" rx="1" fill="#c9a227"/>`).join('');
    const smd = Array.from({ length: 9 }, (_, i) => `<rect x="${bx + 14 + i * 5.6}" y="${by + 3.2}" width="3.4" height="2.2" fill="#d9b44a"/><rect x="${bx + 14 + i * 5.6}" y="${by + bh - 5.4}" width="3.4" height="2.2" fill="#d9b44a"/>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      ${header}
      <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="3.5" fill="${spec.color}" stroke="#2a1055"/>
      ${smd}
      <rect x="${w / 2 - 12}" y="${h / 2 - 11}" width="24" height="22" rx="1.5" fill="#26262c" stroke="#111"/>
      ${Array.from({ length: 6 }, (_, i) => `<rect x="${w / 2 - 12 + i * 4 + 0.8}" y="${h / 2 - 13}" width="1.6" height="2.2" fill="#c9ccd1"/><rect x="${w / 2 - 12 + i * 4 + 0.8}" y="${h / 2 + 10.8}" width="1.6" height="2.2" fill="#c9ccd1"/>`).join('')}
      <text x="${w / 2}" y="${by + bh - 2.4}" text-anchor="middle" font-size="3.6" font-family="sans-serif" font-weight="700" fill="#e9d8ff">Upside Down Labs · BioAmp EXG Pill</text>
      ${conn}${lbl}
    </svg>`;
  }
  if (spec.sprite.art === 'slime-mold') {
    // the organism: translucent yellow lobes joined by veins; the same lobes the model senses with (src/core/slime.js)
    const S = MM_TO_PX, cx = w / 2, cy = h / 2;
    const lobes = LOBES.map(l => `<circle cx="${(cx + l.x * S).toFixed(1)}" cy="${(cy + l.y * S).toFixed(1)}" r="${(l.r * S).toFixed(1)}"/>`).join('');
    const veins = LOBES.slice(1).map((l, i) => `<path d="M${(cx + LOBES[0].x * S).toFixed(1)} ${(cy + LOBES[0].y * S).toFixed(1)} Q${(cx + l.x * S * 0.5 + (i % 2 ? 9 : -9)).toFixed(1)} ${(cy + l.y * S * 0.5 + (i % 3 ? -7 : 7)).toFixed(1)} ${(cx + l.x * S).toFixed(1)} ${(cy + l.y * S).toFixed(1)}" fill="none" stroke="#c9961a" stroke-width="${i === 0 ? 3.2 : 2}" stroke-linecap="round" opacity=".75"/>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <defs><filter id="slimeblur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3.2"/></filter></defs>
      <g fill="#f0d23c" fill-opacity=".5" filter="url(#slimeblur)">${lobes}</g>
      <g fill="none" stroke="#c9961a" stroke-width="1.2" opacity=".5">${LOBES.map(l => `<circle cx="${(cx + l.x * S).toFixed(1)}" cy="${(cy + l.y * S).toFixed(1)}" r="${(l.r * S).toFixed(1)}" stroke-dasharray="2 4"/>`).join('')}</g>
      ${veins}
      <circle cx="${(cx + LOBES[0].x * S).toFixed(1)}" cy="${(cy + LOBES[0].y * S).toFixed(1)}" r="4.2" fill="#c9961a"/>
      <text x="${cx}" y="${cy + 3}" text-anchor="middle" font-size="9" font-weight="700" font-family="sans-serif" fill="#6b4f00">Physarum</text>
    </svg>`;
  }
  return '';
}
/** An imported KiCad board, drawn at true size: the outline, the copper tracks, the pads (square SMD electrodes, round header holes) and a pin lead on each connection point. */
function boardSVG(spec, w, h, pins) {
  const S = 96 / 25.4, m = 6, b = spec.board, X = v => +(v * S + m).toFixed(2);
  const body = b.shape === 'circle'
    ? `<circle cx="${X(b.cx)}" cy="${X(b.cy)}" r="${+(b.r * S).toFixed(2)}" fill="${spec.color}" fill-opacity=".16" stroke="${spec.color}" stroke-width="1.6"/>`
    : `<rect x="${m}" y="${m}" width="${+(b.w * S).toFixed(2)}" height="${+(b.h * S).toFixed(2)}" rx="3" fill="${spec.color}" fill-opacity=".16" stroke="${spec.color}" stroke-width="1.6"/>`;
  const tracks = b.tracks.map(t => `<line x1="${X(t.x1)}" y1="${X(t.y1)}" x2="${X(t.x2)}" y2="${X(t.y2)}" stroke="#c9a227" stroke-width="${Math.max(1, +(t.w * S).toFixed(2))}" stroke-linecap="round"/>`).join('');
  const pads = b.pads.map(p => {
    const cx = X(p.x), cy = X(p.y), pw = +(p.w * S).toFixed(2), ph = +(p.h * S).toFixed(2);
    const gold = p.hole ? '#d9b44a' : '#e0c15a';
    const shape = p.shape === 'circle' || p.shape === 'oval' ? `<ellipse cx="${cx}" cy="${cy}" rx="${pw / 2}" ry="${ph / 2}" fill="${gold}" stroke="#8a6d1d" stroke-width=".6"/>`
      : `<rect x="${(cx - pw / 2).toFixed(2)}" y="${(cy - ph / 2).toFixed(2)}" width="${pw}" height="${ph}" rx="${p.shape === 'roundrect' ? Math.min(pw, ph) * 0.15 : 0.6}" fill="${gold}" stroke="#8a6d1d" stroke-width=".6"/>`;
    return shape + (p.hole ? `<circle cx="${cx}" cy="${cy}" r="${+(p.hole * S / 2).toFixed(2)}" fill="#14201a"/>` : '');
  }).join('');
  const marks = pins.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3.4" fill="none" stroke="#ffffff" stroke-width="1" opacity=".9"/><text x="${p.x + 5}" y="${p.y - 4}" font-size="6" font-family="monospace" fill="${spec.color}" stroke="#fff" stroke-width="2" paint-order="stroke">${esc(p.id)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}${tracks}${pads}${marks}
    <text x="${w / 2}" y="${h - m - 3}" text-anchor="middle" font-size="8" font-weight="700" font-family="sans-serif" fill="${spec.color}" stroke="#fff" stroke-width="2.4" paint-order="stroke">${esc(spec.label)}</text></svg>`;
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
  constructor() { super(); this._spec = null; this._lit = 0; this._aux = 0; this._levels = null; }
  set spec(s) { this._spec = s; this.render(); }
  get spec() { return this._spec; }
  set lit(v) { v = Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 10) / 10; if (v === this._lit) return; this._lit = v; this.render(); }
  get lit() { return this._lit; }
  /** An angle (servo, encoder, stepper) or a speed (motor, in rpm) — whatever the part's picture needs besides "lit". */
  set aux(v) { v = Math.round(Number(v) || 0); if (v === this._aux) return; this._aux = v; this.render(); }
  get aux() { return this._aux; }
  /** Per-LED brightness 0–1 for an LED array. */
  set levels(v) { const key = JSON.stringify((v || []).map(x => Math.round(x * 5) / 5)); if (key === this._levelsKey) return; this._levelsKey = key; this._levels = v ? v.map(x => Math.round(x * 5) / 5) : null; this.render(); }
  get levels() { return this._levels; }
  connectedCallback() { this.style.display = 'inline-block'; this.render(); }
  render() { if (this._spec) this.innerHTML = customPartSVG(this._spec, { lit: this._lit, aux: this._aux, levels: this._levels }); }
}
if (globalThis.customElements && !customElements.get('cb-custom-part')) customElements.define('cb-custom-part', CustomPart);
