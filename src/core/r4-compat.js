// Arduino UNO R4 on the Uno emulation. The R4's chip (Renesas RA4M1, ARM Cortex-M4) is a different processor from the R3's, so its
// machine code cannot run on the AVR emulator. Instead a sketch written for the R4 is *converted at compile time*: this header is
// added in front of it and gives the AVR build the R4 features students use — analogReadResolution() up to 14 bits, analogWriteResolution()
// up to 12 bits, and the 12-bit DAC on A0. The reads and writes go to a few spare I/O addresses that the simulator answers
// (src/sim/uno-r4-mcu.js), which is how it can return true 14-bit ADC values and drive A0 as a real analog output.
// Not covered (not the R4's AVR-emulated part): 32-bit int (int is 16-bit here), CAN, RTC, HID/USB, OPAMP, the Wi-Fi LED matrix.

export const R4_FQBN = 'cb:uno-r4';
export const R4_HEADER_NAME = 'cb_r4_compat.h';
// Spare addresses in the ATmega328P's reserved extended-I/O range (0xE0–0xFF is unused silicon).
export const R4_REG = { adcSelect: 0xF0, adcLo: 0xF1, adcHi: 0xF2, dacLo: 0xF4, dacHi: 0xF5 };

export const R4_COMPAT_H = `// CircuitBench: Arduino UNO R4 compatibility layer (added automatically; do not edit)
#ifndef CB_R4_COMPAT_H
#define CB_R4_COMPAT_H
#include <Arduino.h>

#define Serial1 Serial      // the UNO R4's pins 0/1 UART: here the same hardware UART as Serial

#define CB_REG(a) (*(volatile uint8_t *)(a))
static uint8_t cb_read_bits = 10;      // the R4 starts at 10 bits, like the R3
static uint8_t cb_write_bits = 8;

inline void analogReadResolution(uint8_t bits) { cb_read_bits = bits < 1 ? 1 : (bits > 14 ? 14 : bits); }
inline void analogWriteResolution(uint8_t bits) { cb_write_bits = bits < 1 ? 1 : (bits > 12 ? 12 : bits); }

inline int cb_r4_analogRead(uint8_t pin) {
  CB_REG(${R4_REG.adcSelect}) = pin >= 14 ? pin - 14 : pin;                 // pick the channel; the simulator latches a 14-bit sample
  uint16_t raw = (uint16_t)CB_REG(${R4_REG.adcLo}) | ((uint16_t)CB_REG(${R4_REG.adcHi}) << 8);
  return (int)(raw >> (14 - cb_read_bits));
}

inline void cb_r4_analogWrite(uint8_t pin, int value) {
  long top = (1L << cb_write_bits) - 1;
  if (value < 0) value = 0;
  if (value > top) value = (int)top;
  if (pin == 14) {                                                          // A0 is the R4's DAC: 12-bit, a real analog level
    uint16_t level = (uint16_t)((long)value * 4095L / top);
    CB_REG(${R4_REG.dacLo}) = level & 0xFF;
    CB_REG(${R4_REG.dacHi}) = (level >> 8) | 0x80;                          // the high byte commits it (bit 7 = DAC on)
    return;
  }
  ::analogWrite(pin, (int)((long)value * 255L / top));                      // PWM pins keep their 8-bit hardware timers
}

#define analogRead(pin) cb_r4_analogRead(pin)
#define analogWrite(pin, value) cb_r4_analogWrite(pin, value)
#ifndef DAC
#define DAC A0
#endif
#ifndef AR_DEFAULT
#define AR_DEFAULT DEFAULT
#endif
#ifndef AR_INTERNAL
#define AR_INTERNAL INTERNAL
#endif
#endif
`;

/** Put the compatibility header in front of the main sketch (keeping the user's line numbers). */
// The file name in #line matters: a bare "#line 1" made Arduino's library finder lose the sketch (every #include <Wire.h> / <Servo.h> failed with "No such file").
export const r4Source = text => `#include "${R4_HEADER_NAME}"\n#line 1 "sketch.ino"\n${text}`;
