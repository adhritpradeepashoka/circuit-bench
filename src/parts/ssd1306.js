// SSD1306 128×64 monochrome OLED on I²C (0x3C). A command-level model of the controller: the same command
// stream Adafruit_SSD1306, U8g2 or hand-written Wire code sends lands in 1 KB of display RAM, which is then
// drawn pixel for pixel. Pure and DOM-free — renderRGBA() hands back the bytes for the canvas.

export const OLED_ADDR = 0x3c;
export const OLED_W = 128, OLED_H = 64;

// Commands that take argument bytes, and how many.
const ARGS = { 0x20: 1, 0x21: 2, 0x22: 2, 0x26: 6, 0x27: 6, 0x29: 5, 0x2a: 5, 0x81: 1, 0x8d: 1, 0xa3: 2, 0xa8: 1, 0xd3: 1, 0xd5: 1, 0xd8: 1, 0xd9: 1, 0xda: 1, 0xdb: 1 };

export class Ssd1306 {
  constructor() { this.ram = new Uint8Array(OLED_W * 8); this.reset(); }
  reset() {
    this.ram.fill(0);
    this.on = false; this.invert = false; this.allOn = false; this.contrast = 0x7f;
    this.mode = 2;                                   // page addressing after reset
    this.col = 0; this.page = 0; this.colStart = 0; this.colEnd = 127; this.pageStart = 0; this.pageEnd = 7;
    this.segRemap = false; this.comReverse = false; this.startLine = 0; this.chargePump = false;
    this.cmd = null; this.args = []; this.ctrl = null; this.version = 0;
  }
  get lit() { return this.on; }

  command(b) {
    if (this.cmd !== null) {                         // collecting arguments for a multi-byte command
      this.args.push(b);
      if (this.args.length >= ARGS[this.cmd]) { this.run(this.cmd, this.args); this.cmd = null; this.args = []; }
      return;
    }
    if (ARGS[b]) { this.cmd = b; this.args = []; return; }
    this.run(b, []);
  }
  run(c, a) {
    if (c === 0xae) this.on = false;
    else if (c === 0xaf) this.on = true;
    else if (c === 0xa6) this.invert = false;
    else if (c === 0xa7) this.invert = true;
    else if (c === 0xa4) this.allOn = false;
    else if (c === 0xa5) this.allOn = true;
    else if (c === 0xa0) this.segRemap = false;
    else if (c === 0xa1) this.segRemap = true;
    else if (c === 0xc0) this.comReverse = false;
    else if (c === 0xc8) this.comReverse = true;
    else if (c >= 0x40 && c <= 0x7f) this.startLine = c & 0x3f;
    else if (c >= 0xb0 && c <= 0xb7) this.page = c & 7;
    else if (c <= 0x0f) this.col = (this.col & 0xf0) | c;
    else if (c >= 0x10 && c <= 0x1f) this.col = (this.col & 0x0f) | ((c & 0x0f) << 4);
    else if (c === 0x20) this.mode = a[0] & 3;
    else if (c === 0x21) { this.colStart = a[0] & 127; this.colEnd = a[1] & 127; this.col = this.colStart; }
    else if (c === 0x22) { this.pageStart = a[0] & 7; this.pageEnd = a[1] & 7; this.page = this.pageStart; }
    else if (c === 0x81) this.contrast = a[0];
    else if (c === 0x8d) this.chargePump = !!(a[0] & 0x04);
    this.version++;
  }
  data(b) {
    this.ram[this.page * OLED_W + this.col] = b;
    if (this.mode === 0) {                           // horizontal: across the column window, then the next page
      if (++this.col > this.colEnd) { this.col = this.colStart; if (++this.page > this.pageEnd) this.page = this.pageStart; }
    } else if (this.mode === 1) {                    // vertical: down the page window, then the next column
      if (++this.page > this.pageEnd) { this.page = this.pageStart; if (++this.col > this.colEnd) this.col = this.colStart; }
    } else if (++this.col > 127) this.col = 0;       // page mode: wraps within the page
    this.version++;
  }

  /** Is the pixel at screen position (x, y) on (as the viewer sees it, with the module's usual A1/C8 mounting upright)? */
  pixel(x, y) {
    if (!this.on) return false;
    if (this.allOn) return !this.invert;
    const col = this.segRemap ? x : 127 - x;
    const row = ((this.comReverse ? y : 63 - y) + this.startLine) & 63;
    const on = !!(this.ram[(row >> 3) * OLED_W + col] & (1 << (row & 7)));
    return on !== this.invert;
  }
  /** RGBA bytes for a 128×64 ImageData. */
  renderRGBA(out = new Uint8ClampedArray(OLED_W * OLED_H * 4), on = [0xd7, 0xf1, 0xff], off = [0x0b, 0x0d, 0x10]) {
    const level = 0.45 + 0.55 * (this.contrast / 255);
    for (let y = 0; y < OLED_H; y++) for (let x = 0; x < OLED_W; x++) {
      const i = (y * OLED_W + x) * 4, c = this.pixel(x, y) ? on.map(v => v * level) : off;
      out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255;
    }
    return out;
  }
  /** Rough text-free summary for the AI: is anything drawn, and roughly how much. */
  summary() {
    if (!this.on) return { on: false, litPixels: 0 };
    let n = 0; for (let y = 0; y < OLED_H; y++) for (let x = 0; x < OLED_W; x++) if (this.pixel(x, y)) n++;
    return { on: true, litPixels: n, inverted: this.invert };
  }

  // ── I²C device interface ── first byte after the address is a control byte: 0x00 commands, 0x40 data;
  // Co (bit 7) set means only one byte follows before the next control byte.
  start() { this.ctrl = null; }
  connect() { this.ctrl = null; return true; }
  write(b) {
    if (this.ctrl === null) { this.ctrl = b; return true; }
    if (this.ctrl & 0x40) this.data(b); else this.command(b);
    if (this.ctrl & 0x80) this.ctrl = null;
    return true;
  }
  read() { return this.on ? 0x00 : 0x40; }           // status byte: bit 6 = display off
}
