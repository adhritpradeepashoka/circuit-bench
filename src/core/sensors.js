// Electrical models for the analog parts. Conventions follow Wokwi's parts so sketches written for them behave the same:
//   • potentiometer   10 kΩ track, wiper = SIG. value% is how far the wiper is towards VCC.
//   • LDR module      AO = VCC · R_ldr / (R_ldr + 10 kΩ)   → AO FALLS as light rises.
//                     R_ldr = 50 kΩ · (10 lux / lux)^0.7   (γ = 0.7, RL10 = 50 kΩ)
//                     DO (comparator) is HIGH while AO is above half the supply, i.e. when it is darker than ~100 lux.
//   • NTC module      OUT = VCC · R_ntc / (R_ntc + 10 kΩ)  → OUT FALLS as temperature rises.
//                     R_ntc = 10 kΩ · exp(3950 · (1/T − 1/298.15 K))   (β = 3950, 10 kΩ at 25 °C)
export const POT_OHMS = 10000;
export const FIXED_OHMS = 10000;
export const LDR = { gamma: 0.7, rl10: 50e3, minLux: 0.1, maxLux: 1e5 };
export const NTC = { beta: 3950, r25: 10e3, minC: -24, maxC: 80 };

export const ldrOhms = lux => LDR.rl10 * Math.pow(10 / Math.min(LDR.maxLux, Math.max(LDR.minLux, lux)), LDR.gamma);
export const ntcOhms = tC => NTC.r25 * Math.exp(NTC.beta * (1 / (tC + 273.15) - 1 / 298.15));
