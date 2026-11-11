// Arduino UNO Q and VENTUNO Q on the AVR emulation. Their real microcontrollers (STM32U585 and STM32H5F5, ARM Cortex-M33) run Zephyr-based
// firmware that no browser emulator runs, so — exactly like the UNO R4 (src/core/r4-compat.js) — a sketch for them is *converted at compile
// time*: this header goes in front of it, the Arduino_LED_Matrix library and the Monitor / Bridge objects that Arduino's own libraries provide
// on these boards are supplied here, and the AVR build is what the simulator runs. The matrix talks to the simulator through two spare I/O
// addresses (src/sim/uno-q-mcu.js), so frames a sketch draws light the board's real 13 × 8 matrix drawing.
// The Linux side (Qualcomm QRB2210 / Dragonwing) is not emulated: Bridge calls are accepted and do nothing, and the simulator only *shows* a Linux console.
// Not covered: 32-bit int (int is 16-bit here), 3-way Zephyr threads, ArduinoGraphics text drawing, the Wi-Fi/BLE radios, the camera and audio pipelines.
import { R4_HEADER_NAME } from './r4-compat.js';

export const UNOQ_FQBN = 'cb:uno-q', VENTUNO_FQBN = 'cb:ventuno-q';
export const UNOQ_HEADER_NAME = 'cb_unoq_compat.h';
// Spare addresses in the ATmega328P's reserved extended-I/O range (0xE0–0xEF is unused silicon; 0xF0–0xF5 are the R4 ADC/DAC).
export const UNOQ_REG = { matrixIndex: 0xE0, matrixByte: 0xE1 };
export const MATRIX_BYTES = 13;                           // 104 LEDs, row by row from the top-left, 8 per byte, most significant bit first

export const UNOQ_COMPAT_H = `// CircuitBench: Arduino UNO Q / VENTUNO Q compatibility layer (added automatically; do not edit)
#ifndef CB_UNOQ_COMPAT_H
#define CB_UNOQ_COMPAT_H
#include "${R4_HEADER_NAME}"

#define Monitor Serial          // the Arduino App Lab serial monitor on these boards

// Arduino_LED_Matrix: 13 columns x 8 rows. A frame is 104 bits, row by row from the top-left, most significant bit first.
class Arduino_LED_Matrix {
 public:
  void begin() { clear(); }
  void end() { clear(); }
  void clear() { for (uint8_t i = 0; i < ${MATRIX_BYTES}; i++) put(i, 0); }
  // four 32-bit words, first bit = top-left LED (word 0, bit 31)
  void loadFrame(const uint32_t *frame) {
    for (uint8_t b = 0; b < ${MATRIX_BYTES}; b++) {
      uint8_t v = 0;
      for (uint8_t k = 0; k < 8; k++) { uint8_t n = b * 8 + k; v = (uint8_t)((v << 1) | ((frame[n >> 5] >> (31 - (n & 31))) & 1)); }
      put(b, v);
    }
  }
  // a bitmap of 0/1 bytes, any rows x columns up to 8 x 13, anchored top-left
  template <typename T, uint8_t R, uint8_t C> void renderBitmap(T (&bm)[R][C], uint8_t rows = R, uint8_t cols = C) { bitmap(&bm[0][0], rows, cols, C); }
  void renderBitmap(const uint8_t *bm, uint8_t rows, uint8_t cols) { bitmap(bm, rows, cols, cols); }
  // one byte per LED (0 = off, anything else = on), 104 of them
  void draw(const uint8_t *levels) { bitmap(levels, 8, 13, 13); }
  void setGrayscaleBits(uint8_t) {}
 private:
  void put(uint8_t i, uint8_t v) { CB_REG(${UNOQ_REG.matrixIndex}) = i; CB_REG(${UNOQ_REG.matrixByte}) = v; }
  void bitmap(const uint8_t *bm, uint8_t rows, uint8_t cols, uint8_t stride) {
    uint8_t out[${MATRIX_BYTES}] = {0};
    for (uint8_t r = 0; r < rows && r < 8; r++) for (uint8_t c = 0; c < cols && c < 13; c++)
      if (bm[(uint16_t)r * stride + c]) { uint8_t n = r * 13 + c; out[n >> 3] |= (uint8_t)(0x80 >> (n & 7)); }
    for (uint8_t i = 0; i < ${MATRIX_BYTES}; i++) put(i, out[i]);
  }
};

// Arduino_RouterBridge: the link to the Linux side. Here every call is accepted and nothing answers.
class CbBridge {
 public:
  bool begin() { return true; }
  template <typename... A> bool call(const char *, A...) { return false; }
  template <typename... A> void notify(const char *, A...) {}
  template <typename F> bool provide(const char *, F) { return true; }
  template <typename F> bool provide_safe(const char *, F) { return true; }
};
static CbBridge Bridge;
#endif
`;

/** Libraries that exist on the real boards but not for the AVR build: their include lines are dropped (the header above supplies them). */
const LIBS = /^[ \t]*#[ \t]*include[ \t]*[<"](?:Arduino_LED_Matrix|Arduino_RouterBridge|ArduinoGraphics)\.h[>"][^\n]*$/gm;
/** Put the compatibility header in front of the main sketch (keeping the user's line numbers; see r4Source for why #line carries a file name). */
export const unoqSource = text => `#include "${UNOQ_HEADER_NAME}"\n#line 1 "sketch.ino"\n${text.replace(LIBS, m => `// ${m.trim()}`)}`;
