// Drawings of the Arduino UNO Q and VENTUNO Q (pins and geometry in src/core/ai-boards.js): board, connectors, chips, the user LEDs and a
// working 13 × 8 LED matrix whose frame the `matrix` property sets (26 hex characters, see src/core/matrix.js). Plain custom elements; pins are PART_DEFS'.
import { UNOQ_W, UNOQ_H, UNOQ_PINS, VENTUNO_W, VENTUNO_H, VENTUNO_PINS, VENTUNO_UNO_AT, HAT_AT, HAT_PITCH, QWIIC_AT } from '../core/ai-boards.js';
import { MATRIX_COLS, MATRIX_ROWS, decodeFrame } from '../core/matrix.js';

const NS = 'http://www.w3.org/2000/svg', ON = '#59c2ff', OFF = '#0b2733';
const sockets = pins => pins.map(p => `<rect x="${(p.x - 4.2).toFixed(1)}" y="${(p.y - 4.2).toFixed(1)}" width="8.4" height="8.4" rx="1" fill="#15191c"/><rect x="${(p.x - 1.6).toFixed(1)}" y="${(p.y - 1.6).toFixed(1)}" width="3.2" height="3.2" rx=".5" fill="#050607"/>`).join('');
const short = n => { const b = String(n).replace(/\.\d+$/, ''); return { IOREF: 'IOR', RESET: 'RST', '3.3V': '3V3', AREF: 'REF', GND: 'G', VIN: 'VIN' }[b] || b; };
const text = (t, x, y, size, fill, extra = '') => `<text x="${x}" y="${y}" font-size="${size}" font-family="sans-serif" fill="${fill}" ${extra}>${t}</text>`;
/** The 13 × 8 grid of LEDs: pitch in px, top-left corner. Cells carry data-i so `paint` can light them. */
const matrixSVG = (x, y, pitch) => {
  let s = `<rect x="${x - pitch * 0.7}" y="${y - pitch * 0.7}" width="${(MATRIX_COLS - 1) * pitch + pitch * 1.4}" height="${(MATRIX_ROWS - 1) * pitch + pitch * 1.4}" rx="2" fill="#06141b" stroke="#02090d"/>`;
  for (let r = 0; r < MATRIX_ROWS; r++) for (let c = 0; c < MATRIX_COLS; c++) s += `<circle class="mx" data-i="${r * MATRIX_COLS + c}" cx="${(x + c * pitch).toFixed(1)}" cy="${(y + r * pitch).toFixed(1)}" r="${(pitch * 0.34).toFixed(2)}" fill="${OFF}"/>`;
  return s;
};

class Board extends HTMLElement {
  constructor() { super(); this._matrix = ''; this._led = false; this._power = false; }
  connectedCallback() { if (this._ready) return; this._ready = true; this.style.display = 'inline-block'; this.innerHTML = this.markup(); this.paint(); }
  get matrix() { return this._matrix; }
  set matrix(v) { v = String(v || ''); if (v === this._matrix) return; this._matrix = v; this.paint(); }
  get led13() { return this._led; }
  set led13(v) { this._led = !!v; this.paint(); }
  get ledPower() { return this._power; }
  set ledPower(v) { this._power = !!v; this.paint(); }
  paint() {
    if (!this._ready) return; const bits = decodeFrame(this._matrix);
    for (const c of this.querySelectorAll('.mx')) { const on = bits[+c.dataset.i]; c.setAttribute('fill', on ? ON : OFF); if (on) c.setAttribute('filter', 'url(#glow)'); else c.removeAttribute('filter'); }
    const pwr = this.querySelector('.pwr'), led = this.querySelector('.led');
    if (pwr) pwr.setAttribute('fill', this._power ? '#5dff7a' : '#103018'); if (led) led.setAttribute('fill', this._led ? '#ffd23d' : '#4a3a0a');
  }
}
const GLOW = '<defs><filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="1.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>';

/** VENTUNO Q: 160 × 100 mm. Uno headers and the 40-pin HAT header, Qwiic, the 13 × 8 matrix, the Dragonwing SoM under its heat sink and fan, three camera sockets, RJ45, USB, HDMI, power and an M.2 slot. */
class VentunoQ extends Board {
  markup() {
    const W = VENTUNO_W, H = VENTUNO_H, [ox, oy] = VENTUNO_UNO_AT, uno = VENTUNO_PINS.filter(p => !/^H\d|^Q/.test(p.id)), hat = VENTUNO_PINS.filter(p => /^H\d/.test(p.id)), q = VENTUNO_PINS.filter(p => /^Q/.test(p.id));
    const hdr = (x1, x2, y) => `<rect x="${x1 + ox - 6}" y="${y + oy - 6}" width="${x2 - x1 + 12}" height="12" rx="1.5" fill="#0d1113" opacity=".6"/>`;
    const lab = (p, y) => text(p.id === 'A5.2' ? 'SCL' : p.id === 'A4.2' ? 'SDA' : short(p.id), p.x, y, 4.6, '#e3f6f8', 'text-anchor="middle"');
    const fin = [...Array(9)].map((_, i) => `<rect x="${352 + i * 11}" y="104" width="6" height="140" rx="1" fill="#aab2b8"/>`).join('');
    return `<svg xmlns="${NS}" width="${W.toFixed(1)}" height="${H.toFixed(1)}" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}">${GLOW}
      <rect x="0.5" y="0.5" width="${(W - 1).toFixed(1)}" height="${(H - 1).toFixed(1)}" rx="9" fill="#0a5f6a" stroke="#06454d" stroke-width="1.4"/>
      <g fill="#e9eef0" stroke="#9aa2a9">${[190, 232, 274].map(x => `<rect x="${x}" y="4" width="34" height="13" rx="1.5"/>`).join('')}</g>${text('CSI 0 · 1 · 2', 244, 29, 5, '#e3f6f8', 'text-anchor="middle"')}
      ${matrixSVG(44, 46, 7)}${text('8 × 13 LED MATRIX', 89, 30, 5, '#bfeff3', 'text-anchor="middle" letter-spacing=".4"')}
      <rect x="338" y="${HAT_AT[1] - 6}" width="${19 * HAT_PITCH + 12}" height="26" rx="2" fill="#0d1113" opacity=".6"/>${text('JHAT · 40-pin (Raspberry Pi layout)', 430, HAT_AT[1] - 12, 5.6, '#e3f6f8', 'text-anchor="middle"')}
      <rect x="338" y="${HAT_AT[1] - 5.5}" width="9" height="9" fill="none" stroke="#ffd23d" stroke-width="1"/>
      <rect x="346" y="90" width="112" height="150" rx="4" fill="#9aa4ab" stroke="#6b757c"/>${fin}
      <circle cx="402" cy="170" r="40" fill="#1b2125" stroke="#0a0d0f" stroke-width="2"/>${[0, 60, 120, 180, 240, 300].map(a => `<path d="M402 170 L${(402 + 34 * Math.cos((a - 20) * Math.PI / 180)).toFixed(1)} ${(170 + 34 * Math.sin((a - 20) * Math.PI / 180)).toFixed(1)} A34 34 0 0 1 ${(402 + 34 * Math.cos((a + 25) * Math.PI / 180)).toFixed(1)} ${(170 + 34 * Math.sin((a + 25) * Math.PI / 180)).toFixed(1)} Z" fill="#39434a"/>`).join('')}<circle cx="402" cy="170" r="9" fill="#0a0d0f"/>
      ${text('Dragonwing IQ8 · 40 TOPS', 402, 262, 7, '#e3f6f8', 'text-anchor="middle" font-weight="700"')}${text('STM32H5F5 (MCU)', 250, 138, 6, '#e3f6f8')}<rect x="228" y="116" width="40" height="40" rx="2" fill="#16191c" stroke="#000" opacity="0"/>
      <rect x="226" y="108" width="14" height="14" rx="1.5" fill="#16191c" stroke="#000"/>${text('MCU', 233, 118, 4.4, '#d7dce0', 'text-anchor="middle"')}
      <g><rect x="538" y="20" width="68" height="64" rx="2" fill="#c9ced3" stroke="#7b848c"/><rect x="548" y="32" width="48" height="38" rx="2" fill="#2a2f34"/>${text('2.5G RJ45', 572, 80, 5, '#1b2125', 'text-anchor="middle"')}
        <rect x="548" y="96" width="58" height="36" rx="2" fill="#c9ced3" stroke="#7b848c"/><rect x="548" y="140" width="58" height="36" rx="2" fill="#c9ced3" stroke="#7b848c"/>${text('USB 3.0 ×2', 577, 192, 5, '#e3f6f8', 'text-anchor="middle"')}
        <rect x="552" y="206" width="54" height="22" rx="2" fill="#c9ced3" stroke="#7b848c"/>${text('HDMI', 579, 241, 5, '#e3f6f8', 'text-anchor="middle"')}
        <rect x="560" y="252" width="46" height="18" rx="6" fill="#c9ced3" stroke="#7b848c"/><rect x="566" y="257" width="34" height="8" rx="4" fill="#2a2f34"/>${text('USB-C PD', 583, 282, 5, '#e3f6f8', 'text-anchor="middle"')}</g>
      <rect x="462" y="286" width="70" height="34" rx="2" fill="#2f3a40" stroke="#141a1d"/>${text('M.2 NVMe', 497, 307, 5, '#e3f6f8', 'text-anchor="middle"')}
      <rect x="330" y="326" width="50" height="46" rx="3" fill="#1a1d20" stroke="#000"/>${text('7–24 V', 355, 352, 5, '#e3f6f8', 'text-anchor="middle"')}
      <g fill="#2d7a3a" stroke="#1b4d25">${[0, 1, 2].map(i => `<rect x="${396 + i * 20}" y="338" width="18" height="34" rx="1.5"/>`).join('')}</g>${text('7–24 V SCREW', 426, 332, 5, '#e3f6f8', 'text-anchor="middle"')}
      <rect x="${QWIIC_AT[0] - 8}" y="${QWIIC_AT[1] - 8}" width="${3 * HAT_PITCH + 16}" height="16" rx="2" fill="#0d1113" opacity=".6"/>${text('Qwiic', QWIIC_AT[0] + 14, QWIIC_AT[1] - 12, 5, '#e3f6f8', 'text-anchor="middle"')}
      ${hdr(87, 255.5, 9)}${hdr(131, 255.5, 191.5)}
      <circle class="pwr" cx="${ox + 205}" cy="${oy - 30}" r="3" fill="#103018"/>${text('ON', ox + 205, oy - 19, 5, '#e3f6f8', 'text-anchor="middle"')}
      ${text('VENTUNO Q', 150, 126, 16, '#f2fdfe', 'font-weight="800" text-anchor="middle"')}${text('QUALCOMM · ARDUINO', 150, 138, 5.6, '#bfeff3', 'text-anchor="middle" letter-spacing="1.4"')}
      ${sockets(VENTUNO_PINS)}${uno.filter(p => p.y < oy + 100).map(p => lab(p, p.y + 13)).join('')}${uno.filter(p => p.y > oy + 100).map(p => lab(p, p.y - 8)).join('')}
      ${hat.map(p => text(String(p.label.split(' · ')[0]), p.x, p.y + (p.y === HAT_AT[1] ? -7 : 13), 3.6, '#e3f6f8', 'text-anchor="middle"')).join('')}${q.map(p => text(p.id.slice(1), p.x, p.y + 13, 3.8, '#e3f6f8', 'text-anchor="middle"')).join('')}
    </svg>`;
  }
}
for (const [tag, cls] of [['cb-ventuno-q', VentunoQ]]) if (globalThis.customElements && !customElements.get(tag)) customElements.define(tag, cls);
