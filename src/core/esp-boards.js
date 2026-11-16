// Seeed XIAO ESP32-S3 on the Uno emulation. The chip (Xtensa LX7) is not something a browser can emulate, so, like the UNO R4 and UNO Q, a sketch written
// for it is *converted at compile time*: the header below goes in front of it and gives the AVR build what a XIAO sketch uses (the XIAO pin names and numbers,
// 3.3 V logic, 12-bit analogRead, ledcAttach / ledcWrite, ESP32Servo). The simulator runs that build, and each XIAO pin is a real emulated pin.
// Not covered: Wi-Fi and Bluetooth, the camera and microphone of the Sense version, FreeRTOS tasks, 32-bit int (int is 16-bit here), touch pins, deep sleep.
import { R4_HEADER_NAME } from './r4-compat.js';

export const XIAO_S3_FQBN = 'cb:xiao-esp32s3';
export const ESP_HEADER_NAME = 'cb_esp_compat.h';
export const ESP_FQBNS = [XIAO_S3_FQBN];

/** Real XIAO ESP32-S3 pin numbers (the Arduino core's D0..D10 are these GPIO numbers) and where each one lands on the emulated ATmega328P. */
export const XIAO_S3 = {
  id: 'xiao-esp32s3', ledGpio: 21, ledActiveLow: true,
  pads: [                                          // header order, top to bottom, USB at the top: left column then right column
    { id: 'D0', gpio: 1, avr: 'A0', note: 'GPIO1 · A0 · touch' }, { id: 'D1', gpio: 2, avr: 'A1', note: 'GPIO2 · A1 · touch' }, { id: 'D2', gpio: 3, avr: 'A2', note: 'GPIO3 · A2 · touch' },
    { id: 'D3', gpio: 4, avr: 'A3', note: 'GPIO4 · A3 · touch' }, { id: 'D4', gpio: 5, avr: 'A4', note: 'GPIO5 · A4 · SDA' }, { id: 'D5', gpio: 6, avr: 'A5', note: 'GPIO6 · A5 · SCL' },
    { id: 'D6', gpio: 43, avr: '1', note: 'GPIO43 · TX' },
    { id: 'D7', gpio: 44, avr: '0', note: 'GPIO44 · RX' }, { id: 'D8', gpio: 7, avr: '9', note: 'GPIO7 · SCK' }, { id: 'D9', gpio: 8, avr: '10', note: 'GPIO8 · MISO' }, { id: 'D10', gpio: 9, avr: '11', note: 'GPIO9 · MOSI' },
  ],
};
const AVR_PORT = { 0: ['D', 0], 1: ['D', 1], 9: ['B', 1], 10: ['B', 2], 11: ['B', 3], 13: ['B', 5] };
const avrPin = a => (/^A\d$/.test(a) ? { port: 'C', bit: +a[1], adc: +a[1] } : { port: AVR_PORT[a][0], bit: AVR_PORT[a][1] });
/** BOARD_SPECS "pins" for the board: the XIAO's pad names, each on its emulated pin; `LED` is the on-board user LED (not on a header). */
export const xiaoSpecPins = () => ({ ...Object.fromEntries(XIAO_S3.pads.map(p => [p.id, avrPin(p.avr)])), LED: { ...avrPin('13'), internal: true } });
export const XIAO_PWM = XIAO_S3.pads.filter(p => !/^A/.test(p.avr) && ['3', '5', '6', '9', '10', '11'].includes(p.avr)).map(p => p.id);

const avrNumber = a => (/^A\d$/.test(a) ? 14 + +a[1] : +a);
export const espCompatHeader = () => `// CircuitBench: Seeed XIAO ESP32-S3 compatibility layer (added automatically; do not edit)
#ifndef CB_ESP_COMPAT_H
#define CB_ESP_COMPAT_H
#include "${R4_HEADER_NAME}"
#include <Servo.h>

// the board's own names: D0..D10 are the ESP32-S3 GPIO numbers, exactly as in Seeed's Arduino core
#undef A0
#undef A1
#undef A2
#undef A3
#undef A4
#undef A5
#undef SDA
#undef SCL
#undef LED_BUILTIN
${XIAO_S3.pads.map(p => `#define ${p.id} ${p.gpio}`).join('\n')}
#define A0 1
#define A1 2
#define A2 3
#define A3 4
#define A4 5
#define A5 6
#define SDA 5
#define SCL 6
#define TX 43
#define RX 44
#define LED_BUILTIN ${XIAO_S3.ledGpio}      // the orange user LED: ON when the pin is LOW
#define BOOT_BUTTON 0

// GPIO number -> the emulated pin it lands on
static inline uint8_t cb_pin(int g) {
  switch (g) {
${XIAO_S3.pads.map(p => `    case ${p.gpio}: return ${avrNumber(p.avr)};`).join('\n')}
    case ${XIAO_S3.ledGpio}: return 13;
  }
  return 12;                                                        // a pin this board does not have: harmless
}
#define pinMode(p, m) ::pinMode(cb_pin(p), m)
#define digitalWrite(p, v) ::digitalWrite(cb_pin(p), v)
#define digitalRead(p) ::digitalRead(cb_pin(p))
#undef analogRead
#undef analogWrite
#define analogRead(p) cb_r4_analogRead(cb_pin(p))
#define analogWrite(p, v) cb_r4_analogWrite(cb_pin(p), v)
static uint8_t cb_esp_boot = (cb_read_bits = 12, 0);                // the ESP32-S3 reads 12 bits by default, against 3.3 V

// LEDC (the ESP32's PWM): ledcAttach(pin, freq, bits) then ledcWrite(pin, duty); PWM here is 8-bit hardware on pins D8 to D10
static uint8_t cb_ledc_bits[64];
inline bool ledcAttach(uint8_t pin, uint32_t, uint8_t bits) { if (pin < 64) cb_ledc_bits[pin] = bits; return true; }
inline uint32_t ledcSetup(uint8_t, uint32_t f, uint8_t) { return f; }
inline void ledcAttachPin(uint8_t, uint8_t) {}
inline void ledcDetach(uint8_t) {}
inline void ledcWrite(uint8_t pin, uint32_t duty) {
  uint8_t bits = pin < 64 && cb_ledc_bits[pin] ? cb_ledc_bits[pin] : 8; long top = (1L << bits) - 1;
  if ((long)duty > top) duty = (uint32_t)top;
  cb_r4_analogWrite(cb_pin(pin), (int)((long)duty * 255L / top));   // (analogWrite is a macro here that maps the pin once already)
}

// ESP32Servo: the same Servo class, with the XIAO's pin numbers
class CbServo : public Servo {
 public:
  uint8_t attach(int pin) { return Servo::attach(cb_pin(pin)); }
  uint8_t attach(int pin, int minUs, int maxUs) { return Servo::attach(cb_pin(pin), minUs, maxUs); }
  void setPeriodHertz(int) {}
  int attached() { return Servo::attached(); }
};
#define Servo CbServo

// small ESP32 helpers
#define INPUT_PULLDOWN INPUT
#define ADC_0db 0
#define ADC_2_5db 1
#define ADC_6db 2
#define ADC_11db 3
inline void analogSetAttenuation(uint8_t) {}
inline void analogSetPinAttenuation(uint8_t, uint8_t) {}
inline uint32_t analogReadMilliVolts(uint8_t pin) { return (uint32_t)((long)cb_r4_analogRead(cb_pin(pin)) * 3300L / ((1L << cb_read_bits) - 1)); }
// Serial.printf(...) exists on the ESP32 but not on AVR: the line is turned into cb_printf(...) below
#include <stdio.h>
#define cb_printf(...) do { char cb_b[80]; snprintf(cb_b, sizeof cb_b, __VA_ARGS__); Serial.print(cb_b); } while (0)
#endif
`;

/** The libraries that exist on the real board but not for the AVR build: their include lines are dropped (Servo / ESP32Servo become the layer's own). */
const LIBS = /^[ \t]*#[ \t]*include[ \t]*[<"](?:ESP32Servo|Servo|WiFi|WiFiClient|BluetoothSerial|esp_sleep|esp32-hal-ledc|Arduino)\.h[>"][^\n]*$/gm;
/** Put the layer in front of the main sketch (keeping the user's line numbers; see r4Source for why #line carries a file name). */
const FIX = t => t
  .replace(/\bWire\.begin\(\s*[^(),]+,\s*[^()]+\)/g, 'Wire.begin()')                    // Wire.begin(SDA, SCL): the pins are fixed here (D4, D5)
  .replace(/\bSerial\.printf\(/g, 'cb_printf(');
export const espSource = text => `#include "${ESP_HEADER_NAME}"\n#line 1 "sketch.ino"\n${FIX(text.replace(LIBS, m => `// ${m.trim()}`))}`;
