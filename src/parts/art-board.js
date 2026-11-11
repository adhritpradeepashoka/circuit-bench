// Boards drawn from Arduino's own top-view drawings (src/parts/art/*.js, built by scripts/build-board-art.mjs; credit: Arduino, CC BY-SA 4.0).
// The drawing is loaded on demand. Boards with an LED matrix get one circle per LED on top of it; the `matrix` property (26 hex characters,
// the 13-wide frame of src/core/matrix.js) lights them. The 12 × 8 matrix of the UNO R4 WiFi uses the first 12 columns.
import { decodeFrame, MATRIX_COLS } from '../core/matrix.js';
import { BOARD_GEOM } from '../core/board-geometry.generated.js';

const NS = 'http://www.w3.org/2000/svg';

class ArtBoard extends HTMLElement {
  constructor() { super(); this._matrix = ''; this._on = false; }
  /** subclasses: the part type, a loader for the drawing, and the LED colours */
  get spec() { return this.constructor.spec; }
  connectedCallback() {
    if (this._ready) return; this._ready = true;
    const g = BOARD_GEOM[this.spec.type];
    this.style.display = 'inline-block'; this.style.width = `${g.w}px`; this.style.height = `${g.h}px`;
    this.spec.load().then(m => {
      const a = m.ART, svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('width', g.w); svg.setAttribute('height', g.h); svg.setAttribute('viewBox', a.vb.join(' ')); svg.style.display = 'block';
      svg.innerHTML = a.svg;
      this.replaceChildren(svg); this.paint();
    }).catch(() => { this.textContent = this.spec.type; });
  }
  get matrix() { return this._matrix; }
  set matrix(v) { v = String(v || ''); if (v === this._matrix) return; this._matrix = v; this.paint(); }
  get led13() { return this._on; } set led13(v) { this._on = !!v; }
  get ledPower() { return this._pwr; } set ledPower(v) { this._pwr = !!v; }
  paint() {
    const bits = decodeFrame(this._matrix);
    for (const c of this.querySelectorAll('.mx')) { const on = bits[+c.dataset.i]; c.setAttribute('fill', on ? this.spec.on : this.spec.off); if (on) c.setAttribute('style', `filter:drop-shadow(0 0 3px ${this.spec.on})`); else c.removeAttribute('style'); }
  }
}

/** The boards that have an Arduino drawing: tag, part type, the drawing module, and (for those with a matrix) the columns and LED colours. */
export const ART_BOARDS = [
  { tag: 'cb-uno-r4', type: 'arduino-uno-r4', load: () => import('./art/uno-r4-minima.js') },
  { tag: 'cb-uno-r4-wifi', type: 'arduino-uno-r4-wifi', load: () => import('./art/uno-r4-wifi.js'), cols: 12, on: '#ff4638', off: '#8a6a14' },
  { tag: 'cb-uno-q', type: 'arduino-uno-q', load: () => import('./art/uno-q.js'), cols: 13, on: '#59c2ff', off: '#8a6a14' },
  { tag: 'cb-ventuno-q', type: 'arduino-ventuno-q', load: () => import('./art/ventuno-q.js'), cols: 13, on: '#59c2ff', off: '#8a6a14' },
];
if (globalThis.customElements) for (const spec of ART_BOARDS) if (!customElements.get(spec.tag)) customElements.define(spec.tag, class extends ArtBoard { static spec = spec; });
