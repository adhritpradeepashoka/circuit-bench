// The one editable value each analog part has (right-click it): slider range, display format, presets.
import { formatOhms } from './resistance.js';

const trim = n => String(+n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2));
const fmtLux = v => `${trim(v)} lux`;

export const CONTROLS = {
  potentiometer: {
    key: 'level', title: 'Potentiometer', label: 'Wiper position', min: 0, max: 100, step: 1,
    fmt: v => `${Math.round(v)} %`, note: 'SIG = VCC × position (GND end = 0 %, VCC end = 100 %)',
    presets: [{ label: '0 %', v: 0 }, { label: '25 %', v: 25 }, { label: '50 %', v: 50 }, { label: '75 %', v: 75 }, { label: '100 %', v: 100 }],
  },
  'ldr-module': {
    key: 'lux', title: 'Light level', label: 'Illuminance', min: 0.1, max: 1e5, log: true,
    fmt: fmtLux, note: 'AO falls as light rises; DO is HIGH when darker than ≈100 lux',
    presets: [{ label: 'Dark', v: 1 }, { label: 'Dim room', v: 50 }, { label: 'Office', v: 500 }, { label: 'Overcast', v: 5000 }, { label: 'Sunlight', v: 50000 }],
  },
  'ntc-sensor': {
    key: 'temp', title: 'Temperature', label: 'Temperature', min: -24, max: 80, step: 1,
    fmt: v => `${Math.round(v)} °C`, note: 'OUT falls as it gets hotter (β = 3950, 10 kΩ at 25 °C)',
    presets: [{ label: '−10 °C', v: -10 }, { label: '0 °C', v: 0 }, { label: '25 °C', v: 25 }, { label: '40 °C', v: 40 }, { label: '80 °C', v: 80 }],
  },
};

/** Slider position 0–100 ↔ value (linear, or log10 for lux). */
export const toValue = (c, s) => (c.log ? Math.pow(10, Math.log10(c.min) + (Math.log10(c.max) - Math.log10(c.min)) * s / 100) : c.min + (c.max - c.min) * s / 100);
export const toSlider = (c, v) => (c.log ? 100 * (Math.log10(v) - Math.log10(c.min)) / (Math.log10(c.max) - Math.log10(c.min)) : 100 * (v - c.min) / (c.max - c.min));

/** Short text drawn next to a part on the canvas, or null. */
export function partLabel(part) {
  if (part.type === 'resistor') return formatOhms(part.ohms);
  const c = CONTROLS[part.type];
  return c ? c.fmt(part[c.key]) : null;
}
