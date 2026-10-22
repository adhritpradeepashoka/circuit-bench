// 16×2 character LCD on an I²C "backpack": a PCF8574 I/O expander driving an HD44780 controller in 4-bit mode.
// This is the model the simulated chip talks to over I²C (see src/sim/i2c.js), at the register level, so the
// real LiquidCrystal_I2C library drives it unchanged.
//
// PCF8574 → HD44780 wiring on the common backpack:  P0 = RS, P1 = RW, P2 = E, P3 = backlight, P4–P7 = D4–D7.
// The controller latches the data lines on the falling edge of E. It starts in 8-bit mode (only D4–D7 are wired,
// so each latch is the high nibble of a byte), and the library switches it to 4-bit mode, after which every byte
// arrives as two nibbles, high first.

export const LCD_COLS = 16, LCD_ROWS = 2;
const LINE_LEN = 40;                       // each DDRAM line holds 40 characters; 16 are visible
const RS = 0x01, E = 0x04, BL = 0x08;

export class Lcd1602 {
  constructor() {
    this.port = 0;                         // last byte written to the PCF8574
    this.ddram = new Uint8Array(0x80).fill(0x20);
    this.cgram = new Uint8Array(64);
    this.ac = 0; this.toCgram = false;
    this.eightBit = true; this.pending = null;
    this.twoLine = false; this.increment = true; this.autoShift = false; this.shift = 0;
    this.displayOn = false; this.cursorOn = false; this.blinkOn = false;
    this.backlight = false;
    this.version = 0;                      // bumps whenever what's on the glass changes
  }

  // ── I²C device interface ─────────────────
  connect() { return true; }
  write(byte) {
    const prev = this.port;
    this.port = byte & 0xff;
    const bl = !!(this.port & BL);
    if (bl !== this.backlight) { this.backlight = bl; this.version++; }
    if ((prev & E) && !(this.port & E)) this.latch(!!(prev & RS), (prev >> 4) & 0x0f);   // falling edge of E: latch what was on the lines
    return true;
  }
  read() { return this.port | 0xf0; }      // quasi-bidirectional port: released lines read high

  // ── HD44780 ──────────────────────────────
  latch(rs, nibble) {
    if (this.eightBit) { this.exec(rs, nibble << 4); return; }
    if (this.pending === null) { this.pending = nibble; return; }
    const value = (this.pending << 4) | nibble; this.pending = null;
    this.exec(rs, value);
  }

  exec(rs, v) {
    if (rs) { this.data(v); return; }
    if (v & 0x80) { this.toCgram = false; this.ac = v & 0x7f; }
    else if (v & 0x40) { this.toCgram = true; this.ac = v & 0x3f; }
    else if (v & 0x20) { this.eightBit = !!(v & 0x10); this.twoLine = !!(v & 0x08); this.pending = null; }
    else if (v & 0x10) {
      const right = !!(v & 0x04);
      if (v & 0x08) this.shift += right ? -1 : 1;            // display shift: the text moves, the cursor stays with it
      else this.moveCursor(right);
    } else if (v & 0x08) { this.displayOn = !!(v & 0x04); this.cursorOn = !!(v & 0x02); this.blinkOn = !!(v & 0x01); }
    else if (v & 0x04) { this.increment = !!(v & 0x02); this.autoShift = !!(v & 0x01); }
    else if (v & 0x02) { this.ac = 0; this.toCgram = false; this.shift = 0; }
    else if (v & 0x01) { this.ddram.fill(0x20); this.ac = 0; this.toCgram = false; this.shift = 0; this.increment = true; }
    this.version++;
  }

  data(v) {
    if (this.toCgram) { this.cgram[this.ac & 0x3f] = v & 0x1f; this.ac = (this.ac + (this.increment ? 1 : -1)) & 0x3f; }
    else {
      this.ddram[this.ac & 0x7f] = v;
      this.moveCursor(this.increment);
      if (this.autoShift) this.shift += this.increment ? 1 : -1;
    }
    this.version++;
  }

  /** DDRAM addresses run 0x00–0x27 (line 1) and 0x40–0x67 (line 2), wrapping from one to the other. */
  moveCursor(forward) {
    if (!this.twoLine) { this.ac = (this.ac + (forward ? 1 : 79)) % 80; return; }
    let line = this.ac >= 0x40 ? 1 : 0, col = (this.ac & 0x3f) + (forward ? 1 : -1);
    if (col >= LINE_LEN) { col = 0; line ^= 1; } else if (col < 0) { col = LINE_LEN - 1; line ^= 1; }
    this.ac = line * 0x40 + col;
  }

  // ── what the student sees ────────────────
  /** Character codes on the glass, row by row (16 × 2). Blank when the display is switched off. */
  characters() {
    const out = new Uint8Array(LCD_COLS * LCD_ROWS).fill(0x20);
    if (!this.displayOn) return out;
    const rows = this.twoLine ? 2 : 1;
    for (let r = 0; r < rows; r++) for (let c = 0; c < LCD_COLS; c++) {
      const col = ((c + this.shift) % LINE_LEN + LINE_LEN) % LINE_LEN;
      out[r * LCD_COLS + c] = this.ddram[r * 0x40 + col];
    }
    return out;
  }
  /** The visible text (custom characters show as '?'), one string per row. */
  lines() {
    const ch = this.characters();
    return [0, 1].map(r => String.fromCharCode(...ch.slice(r * LCD_COLS, (r + 1) * LCD_COLS).map(c => (c < 0x10 ? 63 : c))));
  }
  /** Where the cursor is on the glass, or null when it is hidden/off-screen. */
  cursor() {
    const row = this.ac >= 0x40 ? 1 : 0, col = (((this.ac & 0x3f) - this.shift) % LINE_LEN + LINE_LEN) % LINE_LEN;
    return { x: col, y: row, show: this.displayOn && this.cursorOn && col < LCD_COLS, blink: this.blinkOn };
  }
  /** The element's font with characters 0–7 (and their 8–15 mirrors) replaced by the sketch's custom characters. */
  font(base) {
    const f = new Uint8Array(base);
    for (let c = 0; c < 16; c++) for (let row = 0; row < 8; row++) {
      const bits = this.cgram[(c & 7) * 8 + row];
      let mirrored = 0;                                       // CGRAM bit 4 is the left-most pixel; the element draws bit 0 on the left
      for (let b = 0; b < 5; b++) if (bits & (1 << b)) mirrored |= 1 << (4 - b);
      f[c * 8 + row] = mirrored;
    }
    return f;
  }
  summary() { return { text: this.lines(), backlight: this.backlight, displayOn: this.displayOn }; }
}
