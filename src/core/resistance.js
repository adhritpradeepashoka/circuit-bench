// Resistor values: parsing what people type ("4.7k", "4k7", "220", "1M", "330 ohm"), formatting, and the
// 4-band colour code (same maths as the @wokwi/elements resistor, so the strip we show matches the part).

export const MIN_OHMS = 1;
export const MAX_OHMS = 10e6;
export const DEFAULT_OHMS = 220;
export const PRESETS = [100, 220, 330, 470, 1000, 2200, 4700, 10000, 22000, 47000, 100000, 1000000];

const trim = n => String(+n.toFixed(2));

/** "4.7 kΩ", "220 Ω", "1 MΩ" */
export function formatOhms(v) {
  if (v >= 1e6) return `${trim(v / 1e6)} MΩ`;
  if (v >= 1e3) return `${trim(v / 1e3)} kΩ`;
  return `${trim(v)} Ω`;
}
/** Compact form for an input box: "4.7k", "220", "1M". */
export function compactOhms(v) {
  if (v >= 1e6) return `${trim(v / 1e6)}M`;
  if (v >= 1e3) return `${trim(v / 1e3)}k`;
  return trim(v);
}

const MULT = { '': 1, r: 1, k: 1e3, m: 1e6 };
const UNIT = '(?:\\s*(?:[ΩΩ]|ohms?))?';

/**
 * @returns {{ok:true, ohms:number, rounded:boolean} | {ok:false, error:string}}
 * Two significant digits are kept (a 4-band resistor cannot encode more), so 1234 → 1200 Ω.
 */
export function parseResistance(text) {
  const s = String(text ?? '').trim();
  if (!s) return { ok: false, error: 'Type a value, like 220, 4.7k or 1M.' };
  let m, value;
  if ((m = new RegExp(`^(\\d+)([kKmMrR])(\\d+)${UNIT}$`, 'i').exec(s))) value = parseFloat(`${m[1]}.${m[3]}`) * MULT[m[2].toLowerCase()];   // 4k7
  else if ((m = new RegExp(`^(\\d*\\.?\\d+)\\s*([kKmMrR]?)${UNIT}$`, 'i').exec(s))) value = parseFloat(m[1]) * MULT[m[2].toLowerCase()];
  else return { ok: false, error: 'Type a value, like 220, 4.7k or 1M.' };
  if (!Number.isFinite(value) || value < MIN_OHMS * 0.995 || value > MAX_OHMS * 1.005) return { ok: false, error: `Use a value from ${formatOhms(MIN_OHMS)} to ${formatOhms(MAX_OHMS)}.` };
  const ohms = Math.min(MAX_OHMS, Math.max(MIN_OHMS, Number(value.toPrecision(2))));
  return { ok: true, ohms, rounded: Math.abs(ohms - value) > 1e-9 * value };
}

export const BAND_COLORS = { '-2': '#C3C7C0', '-1': '#F1D863', 0: '#000000', 1: '#8F4814', 2: '#FB0000', 3: '#FC9700', 4: '#FCF800', 5: '#00B800', 6: '#0000FF', 7: '#A803D6', 8: '#808080', 9: '#FCFCFC' };
export const BAND_NAMES = { '-2': 'silver', '-1': 'gold', 0: 'black', 1: 'brown', 2: 'red', 3: 'orange', 4: 'yellow', 5: 'green', 6: 'blue', 7: 'violet', 8: 'grey', 9: 'white' };

/** [digit, digit, multiplier exponent] — identical to the Wokwi resistor's breakValue(). */
export function bandDigits(value) {
  const exponent = value >= 1e10 ? 9 : value >= 1e9 ? 8 : value >= 1e8 ? 7 : value >= 1e7 ? 6 : value >= 1e6 ? 5 : value >= 1e5 ? 4
    : value >= 1e4 ? 3 : value >= 1e3 ? 2 : value >= 1e2 ? 1 : value >= 1e1 ? 0 : value >= 1 ? -1 : -2;
  const base = Math.round(value / 10 ** exponent) % 100;
  return [Math.floor(base / 10), base % 10, exponent];
}
/** Colour names for the 4 bands, e.g. 220 → ['red','red','brown','gold'] (gold = ±5 %). */
export function bandNames(value) {
  const [a, b, e] = bandDigits(value);
  return [BAND_NAMES[a], BAND_NAMES[b], BAND_NAMES[e], 'gold'];
}
export function bandColors(value) {
  const [a, b, e] = bandDigits(value);
  return [BAND_COLORS[a], BAND_COLORS[b], BAND_COLORS[e], BAND_COLORS[-1]];
}
