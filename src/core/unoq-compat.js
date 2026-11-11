// Boards with an LED matrix and a Linux / Wi-Fi side — Arduino UNO Q, VENTUNO Q (STM32U585 / STM32H5F5) and UNO R4 WiFi (RA4M1) — on the AVR emulation.
// Their real microcontrollers are ARM Cortex-M parts that no browser emulator runs, so, exactly like the UNO R4 Minima (src/core/r4-compat.js), a sketch for them
// is *converted at compile time*: this header goes in front of it, the Arduino_LED_Matrix library and the Monitor / Bridge objects that Arduino's libraries provide
// on these boards are supplied here, and the AVR build is what the simulator runs. The matrix talks to the simulator through two spare I/O addresses
// (src/sim/uno-q-mcu.js), so frames a sketch draws light the matrix drawn on the board.
// The Linux side (Qualcomm QRB2210 / Dragonwing) and the radios (ESP32-S3) are not emulated: Bridge calls are accepted and do nothing, WiFiS3 / ArduinoBLE do not build.
// Not covered: 32-bit int (int is 16-bit here), Zephyr threads, ArduinoGraphics text drawing, the camera and audio pipelines.
import { R4_HEADER_NAME } from './r4-compat.js';

export const UNOQ_FQBN = 'cb:uno-q', VENTUNO_FQBN = 'cb:ventuno-q', R4WIFI_FQBN = 'cb:uno-r4-wifi';
export const UNOQ_HEADER_NAME = 'cb_unoq_compat.h';
// Spare addresses in the ATmega328P's reserved extended-I/O range (0xE0–0xEF is unused silicon; 0xF0–0xF5 are the R4 ADC/DAC).
export const UNOQ_REG = { matrixIndex: 0xE0, matrixByte: 0xE1 };
export const MATRIX_BYTES = 13;                           // room for 104 LEDs, row by row from the top-left, 8 per byte, most significant bit first

/** The conversion header for a board whose LED matrix is `cols` wide (13: UNO Q / VENTUNO Q, 12: UNO R4 WiFi). */
export const compatHeader = (cols = 13) => `// CircuitBench: Arduino ${cols === 13 ? 'UNO Q / VENTUNO Q' : 'UNO R4 WiFi'} compatibility layer (added automatically; do not edit)
#ifndef CB_UNOQ_COMPAT_H
#define CB_UNOQ_COMPAT_H
#include "${R4_HEADER_NAME}"
#define CB_COLS ${cols}
#define CB_LEDS (CB_COLS * 8)

#define Monitor Serial          // the Arduino App Lab serial monitor on the UNO Q / VENTUNO Q

// Arduino_LED_Matrix: CB_COLS columns x 8 rows. A frame is CB_LEDS bits, row by row from the top-left, most significant bit first.
class Arduino_LED_Matrix {
 public:
  void begin() { clear(); }
  void end() { clear(); }
  void clear() { for (uint8_t i = 0; i < CB_COLS; i++) put(i, 0); }
  // 32-bit words, first bit = top-left LED (word 0, bit 31): 3 words on the R4 WiFi, 4 on the UNO Q
  void loadFrame(const uint32_t *frame) {
    for (uint8_t b = 0; b < CB_COLS; b++) {
      uint8_t v = 0;
      for (uint8_t k = 0; k < 8; k++) { uint8_t n = b * 8 + k; v = (uint8_t)((v << 1) | ((frame[n >> 5] >> (31 - (n & 31))) & 1)); }
      put(b, v);
    }
  }
  // a bitmap of 0/1 bytes, any rows x columns up to 8 x CB_COLS, anchored top-left
  template <typename T, uint8_t R, uint8_t C> void renderBitmap(T (&bm)[R][C], uint8_t rows = R, uint8_t cols = C) { bitmap(&bm[0][0], rows, cols, C); }
  void renderBitmap(const uint8_t *bm, uint8_t rows, uint8_t cols) { bitmap(bm, rows, cols, cols); }
  // one byte per LED (0 = off, anything else = on), CB_LEDS of them
  void draw(const uint8_t *levels) { bitmap(levels, 8, CB_COLS, CB_COLS); }
  void setGrayscaleBits(uint8_t) {}
 private:
  void put(uint8_t i, uint8_t v) { CB_REG(${UNOQ_REG.matrixIndex}) = i; CB_REG(${UNOQ_REG.matrixByte}) = v; }
  void bitmap(const uint8_t *bm, uint8_t rows, uint8_t cols, uint8_t stride) {
    uint8_t out[CB_COLS] = {0};
    for (uint8_t r = 0; r < rows && r < 8; r++) for (uint8_t c = 0; c < cols && c < CB_COLS; c++)
      if (bm[(uint16_t)r * stride + c]) { uint8_t n = r * CB_COLS + c; out[n >> 3] |= (uint8_t)(0x80 >> (n & 7)); }
    for (uint8_t i = 0; i < CB_COLS; i++) put(i, out[i]);
  }
};
typedef Arduino_LED_Matrix ArduinoLEDMatrix;      // the name the UNO R4 WiFi library uses

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
export const UNOQ_COMPAT_H = compatHeader(13);
export const columnsOf = fqbn => (fqbn === R4WIFI_FQBN ? 12 : 13);

/** Libraries that exist on the real boards but not for the AVR build: their include lines are dropped (the header above supplies them). */
const LIBS = /^[ \t]*#[ \t]*include[ \t]*[<"](?:Arduino_LED_Matrix|Arduino_RouterBridge|ArduinoGraphics)\.h[>"][^\n]*$/gm;
/** Put the compatibility header in front of the main sketch (keeping the user's line numbers; see r4Source for why #line carries a file name). */
export const unoqSource = text => `#include "${UNOQ_HEADER_NAME}"\n#line 1 "sketch.ino"\n${text.replace(LIBS, m => `// ${m.trim()}`)}`;
