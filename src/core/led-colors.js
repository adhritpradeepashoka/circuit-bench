// LED colours: forward voltage and dynamic (slope) resistance differ by chemistry — the solver uses both.
//   vf = voltage at which it starts conducting; rd = the LED's own resistance above that knee (5 mm LEDs: ~15 Ω red/yellow/green, ~25 Ω blue/white).
export const LED_COLORS = {
  red:    { name: 'Red',    vf: 1.9, rd: 15, hex: '#e5392f' },
  yellow: { name: 'Yellow', vf: 2.0, rd: 15, hex: '#f2c21b' },
  orange: { name: 'Orange', vf: 2.0, rd: 15, hex: '#f28a1b' },
  green:  { name: 'Green',  vf: 2.1, rd: 15, hex: '#2fae4e' },
  blue:   { name: 'Blue',   vf: 3.1, rd: 25, hex: '#2f6cf0' },
  white:  { name: 'White',  vf: 3.1, rd: 25, hex: '#e9edf0' },
};
export const DEFAULT_LED_COLOR = 'red';
export const ledRd = color => (LED_COLORS[color] || LED_COLORS[DEFAULT_LED_COLOR]).rd;
export const ledVf = color => (LED_COLORS[color] || LED_COLORS[DEFAULT_LED_COLOR]).vf;
