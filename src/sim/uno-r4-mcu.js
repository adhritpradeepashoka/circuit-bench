// The Uno R4 as the simulator sees it: the Uno's AVR core plus the R4 extras that the compile-time conversion (src/core/r4-compat.js)
// talks to — a true 14-bit ADC sample and a 12-bit DAC on A0 — through a few spare I/O addresses.
import { Mcu } from './mcu.js';
import { R4_REG } from '../core/r4-compat.js';

export const R4_VCC = 5;

export class UnoR4Mcu extends Mcu {
  constructor(hex) {
    super(hex, 'atmega328p');
    this.dac = null;                       // 0–4095 while the sketch drives A0 as the DAC, otherwise null
    this.adcSample = 0;                    // the 14-bit value latched by the last channel select
    const { cpu } = this;
    cpu.writeHooks[R4_REG.adcSelect] = value => {
      const volts = this.adc.channelValues[value & 7] ?? 0;
      this.adcSample = Math.max(0, Math.min(16383, Math.round((volts / R4_VCC) * 16383)));
      return true;
    };
    cpu.readHooks[R4_REG.adcLo] = () => this.adcSample & 0xff;
    cpu.readHooks[R4_REG.adcHi] = () => this.adcSample >> 8;
    this.dacLow = 0;
    cpu.writeHooks[R4_REG.dacLo] = value => { this.dacLow = value & 0xff; return true; };
    cpu.writeHooks[R4_REG.dacHi] = value => {
      this.dac = value & 0x80 ? (((value & 0x0f) << 8) | this.dacLow) : null;
      return true;
    };
  }
  /** analogWrite on a PWM pin → its average duty; on A0 → the DAC level as a fraction of the supply (an analog voltage, not PWM). */
  pwmDutyOf(pin) {
    if (pin?.name === 'A0') return this.dac === null ? null : this.dac / 4095;
    return /^\d+$/.test(pin?.name || '') ? this.pwmDuty(Number(pin.name)) : null;
  }
}
