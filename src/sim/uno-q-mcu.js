// The UNO Q / VENTUNO Q as the simulator sees them: the R4-style AVR emulation (14-bit ADC, 12-bit DAC on A0) with a 3.3 V supply, plus the
// 13 × 8 LED matrix that the compile-time layer (src/core/unoq-compat.js) writes to through two spare I/O addresses.
import { UnoR4Mcu } from './uno-r4-mcu.js';
import { R4_REG } from '../core/r4-compat.js';
import { UNOQ_REG, MATRIX_BYTES } from '../core/unoq-compat.js';

export const UNOQ_VCC = 3.3;

export class UnoQMcu extends UnoR4Mcu {
  constructor(hex) {
    super(hex);
    this.matrix = new Uint8Array(MATRIX_BYTES);
    this.matrixIdx = 0;
    const { cpu } = this;
    cpu.writeHooks[R4_REG.adcSelect] = value => {                      // the same 14-bit sampling as the R4, against 3.3 V
      const volts = this.adc.channelValues[value & 7] ?? 0;
      this.adcSample = Math.max(0, Math.min(16383, Math.round((volts / UNOQ_VCC) * 16383)));
      return true;
    };
    cpu.writeHooks[UNOQ_REG.matrixIndex] = value => { this.matrixIdx = value; return true; };
    cpu.writeHooks[UNOQ_REG.matrixByte] = value => { if (this.matrixIdx < MATRIX_BYTES) this.matrix[this.matrixIdx] = value & 0xff; return true; };
  }
  /** The frame the sketch last drew, as the 26-character hex string the board drawing and the project file use. */
  get matrixHex() { return [...this.matrix].map(b => b.toString(16).padStart(2, '0')).join(''); }
}
