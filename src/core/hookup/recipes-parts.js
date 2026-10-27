// Recipes for the building blocks: battery, resistor, diodes, transistors, regulator, capacitor, inductor, op-amps, logic chips,
// the biosignal amplifiers — the parts whose "circuit" is a small experiment that prints what it measures.
import { PART_DEFS } from '../parts.js';
import { phase, ACTUATOR, SOURCE, OTHER, roleMap, PlanError, ledOnPin, loadLed } from './helpers.js';

const shortName = def => def.name.replace(/\s*\(.*$/, '').replace(/\s+/g, ' ').trim();
const b = type => PART_DEFS[type]?.spec?.behaviour || {};
const stdOhms = v => { const s = [220, 270, 330, 470, 680, 1000, 1500, 2200]; return s.reduce((a, x) => (Math.abs(x - v) < Math.abs(a - v) ? x : a), s[0]); };
const ohmText = v => (v >= 1000 ? `${v / 1000} kΩ` : `${v} Ω`);

const volts = (c, h, text) => c.sketch.show(text, `analogRead(${h}) * ${c.vref} / 1023`, 2);

/* ── battery: a circuit with no Arduino at all ───────────────────────────────────────────────── */
const battery = phase(ACTUATOR)((c, { n, req }) => {
  const ohms = req?.ohms, h = c.part('battery', { fresh: n > 0 }), v = h.props?.volts ?? 9, r = stdOhms(Math.max(220, (v - 1.9) / 0.015));
  const { r: res } = loadLed(c, { ohms: ohms && ohms > 100 ? ohms : r, from: [h, '+'], to: [h, '-'] });
  c.wiring(`Battery +: ${ohmText(res.props?.ohms || r)} resistor → LED → battery −`);
  c.say(`${h.isNew ? 'Added a' : 'Used the'} ${v} V battery with a ${ohmText(ohms && ohms > 100 ? ohms : r)} resistor and an LED — a circuit that needs no Arduino.`);
  c.mem.noBoard = true;
});

/* ── resistor: the classic "resistor + LED" circuit with that resistor ─────────────────────────── */
const resistor = phase(ACTUATOR)((c, ctx) => {
  c.say(`A resistor on its own does nothing, so here it is protecting an LED${ctx.ohms ? ` (${ohmText(ctx.ohms)})` : ''}.`);
  return LED_RECIPE(c, { ...ctx, type: 'led' });
});
let LED_RECIPE = null;
export const setLedRecipe = fn => { LED_RECIPE = fn; };

/* ── diode / Zener ────────────────────────────────────────────────────────────────────────────── */
const diode = phase(ACTUATOR)((c, { n, type }) => {
  const s = c.sketch, bh = b(type), r = roleMap(type), h = c.part(type, { fresh: n > 0 });
  if (!bh.vz) {                             // ordinary diode: pin → 1 kΩ → diode → GND, the node is read on an analog pin
    const pin = c.drive(h, r.anode, 'digital', { ohms: 1000, prefer: ['8', '7', '9'], dir: 'out' }); c.ground(h, r.cathode);
    const an = c.hook(h, r.anode, 'analog');
    s.setup(`pinMode(${pin}, OUTPUT);`); s.setup(`digitalWrite(${pin}, HIGH);`);
    volts(c, an, 'Across diode V');
    s.title ||= `${shortName(PART_DEFS[type])}: pin ${pin} (HIGH) → 1 kΩ → diode → GND. ${an} reads the voltage across the diode (about ${bh.vf} V).`;
    c.say(`${h.isNew ? 'Added a' : 'Used the'} ${shortName(PART_DEFS[type])} in series with a 1 kΩ resistor from pin ${pin}; ${an} reads the voltage across it (about ${bh.vf} V).`);
  } else {                                   // Zener: a battery above the breakdown, a resistor, the Zener backwards, read through a divider
    const rs = c.resistorAt(h, r.cathode, 470);
    c.join(rs.r, rs.near, h, r.cathode);
    const bat = c.helper('battery', [['+', rs.r, rs.far]], { props: { volts: Math.min(12, Math.ceil(bh.vz + 3)) } });
    c.join(bat, '+', rs.r, rs.far); c.ground(bat, '-'); c.ground(h, r.anode);
    const dv = c.resistorAt(h, r.cathode, 10000);
    c.join(dv.r, dv.near, h, r.cathode);
    const an = c.hook(dv.r, dv.far, 'analog'); c.pull(dv.r, dv.far, 'gnd', 10000);
    volts(c, an, 'Zener V'); s.measure(`float zener = analogRead(${an}) * ${c.vref} / 1023 * 2;`); s.readouts.pop(); s.show('Zener V', 'zener', 2);
    s.title ||= `${shortName(PART_DEFS[type])}: battery → 470 Ω → Zener (backwards) → GND; ${an} reads half of the Zener voltage through a 10 kΩ + 10 kΩ divider`;
    c.say(`${h.isNew ? 'Added a' : 'Used the'} ${shortName(PART_DEFS[type])} wired backwards behind a 470 Ω resistor and a ${bat.props.volts} V battery; a divider lets ${an} read about ${bh.vz} V (the battery − is joined to the Arduino GND).`);
  }
});

/* ── transistors and MOSFETs as LED switches ──────────────────────────────────────────────────── */
const transistor = phase(ACTUATOR)((c, { n, type }) => {
  const s = c.sketch, k = b(type).kind, r = roleMap(type), h = c.part(type, { fresh: n > 0 }), f = c.signals;
  const bjt = k === 'npn' || k === 'pnp', high = k === 'pnp' || k === 'pmos';      // a "high-side" switch sits between 5V and the load
  const ctl = bjt ? r.base : r.gate, main = bjt ? { out: r.collector, in: r.emitter } : { out: r.drain, in: r.source };
  let pin;
  if (bjt) pin = c.drive(h, ctl, f.level && !f.bool ? 'pwm' : 'digital', { ohms: 1000, prefer: ['7', '6', '5', '4'], dir: 'out' });
  else { pin = c.hook(h, ctl, f.level && !f.bool ? 'pwm' : 'digital', { dir: 'out' }); c.pull(h, ctl, high ? 'v5' : 'gnd', 10000); }
  if (high) { c.power(h, main.in); loadLed(c, { ohms: 220, from: [h, main.out], to: 'gnd' }); }
  else { c.ground(h, main.in); loadLed(c, { ohms: 220, from: 'v5', to: [h, main.out] }); }
  const on = high ? 'LOW' : 'HIGH', off = high ? 'HIGH' : 'LOW', pwmPin = /^(3|5|6|9|10|11)$/.test(pin);
  s.setup(`pinMode(${pin}, OUTPUT);`);
  if (f.bool) { s.sample(`digitalWrite(${pin}, (${f.bool.expr}) ? ${on} : ${off});`); f.consumed = true; }
  else if (f.level) { s.sample(pwmPin ? `analogWrite(${pin}, ${high ? '255 - ' : ''}${f.level.expr} / 4);` : `digitalWrite(${pin}, ${f.level.expr} > 511 ? ${on} : ${off});`); f.consumed = true; }
  else s.tick(500, [`digitalWrite(${pin}, !digitalRead(${pin}));`]);
  const nm = shortName(PART_DEFS[type]);
  c.wiring(`${nm}: pin ${pin} → ${bjt ? '1 kΩ → base' : 'gate (10 kΩ ' + (high ? 'pull-up' : 'pull-down') + ')'}; ${high ? '5V → emitter/source; the LED hangs on the collector/drain' : 'emitter/source → GND; the LED hangs on the collector/drain'}`);
  s.title ||= `${nm} switching an LED from pin ${pin}${high ? ' (LOW turns it on)' : ''}`;
  c.say(`${h.isNew ? 'Added a' : 'Used the'} ${nm}: pin ${pin} switches an LED${high ? ' (the pin goes LOW to turn it on)' : ''}${bjt ? ' through a 1 kΩ base resistor' : ''}.`);
});

/* ── regulator ────────────────────────────────────────────────────────────────────────────────── */
const regulator = phase(ACTUATOR)((c, { n, type }) => {
  const s = c.sketch, bh = b(type), r = roleMap(type), h = c.part(type, { fresh: n > 0 });
  const need = bh.vout + (bh.drop || 2), bat = c.helper('battery', [['+', h, r.vin]], { props: { volts: Math.min(12, Math.max(9, Math.ceil(need + 1))) } });
  c.join(bat, '+', h, r.vin); c.join(bat, '-', h, r.gnd); c.ground(h, r.gnd); c.ground(bat, '-');
  const ohms = Math.min(2200, Math.max(220, stdOhms((bh.vout - 1.9) / 0.012)));
  loadLed(c, { ohms, from: [h, r.out], to: 'gnd' });
  let an;
  if (bh.vout > c.logic - 0.05) { const d1 = c.resistorAt(h, r.out, 10000); c.join(d1.r, d1.near, h, r.out); an = c.hook(d1.r, d1.far, 'analog'); c.pull(d1.r, d1.far, 'gnd', 10000); s.measure(`float out = analogRead(${an}) * ${c.vref} / 1023 * 2;`); }
  else { an = c.hook(h, r.out, 'analog'); s.measure(`float out = analogRead(${an}) * ${c.vref} / 1023;`); }
  s.show('Output V', 'out', 2);
  s.title ||= `${shortName(PART_DEFS[type])}: a ${bat.props.volts} V battery in, ${bh.vout} V out (read on ${an}${bh.vout > c.logic - 0.05 ? ' through a divider' : ''})`;
  c.say(`${h.isNew ? 'Added a' : 'Used the'} ${shortName(PART_DEFS[type])} fed by a ${bat.props.volts} V battery; its ${bh.vout} V output lights an LED and is read on ${an} (the battery − is joined to the Arduino GND).`);
});

/* ── capacitor and inductor: a step response ──────────────────────────────────────────────────── */
function stepResponse(c, h, { aPin, bPin, ohms, tauUs, title, say }) {
  const s = c.sketch, pin = c.drive(h, aPin, 'digital', { ohms, prefer: ['8', '7', '9'], dir: 'out' });
  c.ground(h, bPin);
  const an = c.hook(h, aPin, 'analog');
  const gapUs = Math.max(0, Math.round(tauUs / 10 - 112)), gap = gapUs >= 3000 ? `delay(${Math.round(gapUs / 1000)});` : gapUs > 0 ? `delayMicroseconds(${gapUs});` : null;
  const settleMs = Math.max(5, Math.ceil((tauUs * 6) / 1000));
  s.serial();
  s.setup(`pinMode(${pin}, OUTPUT);`); s.setup(`digitalWrite(${pin}, LOW);`);
  s.tick(Math.max(2000, settleMs * 3), ['unsigned long t[16];', 'int v[16];', `delay(${settleMs});                 // let it discharge first`, `digitalWrite(${pin}, HIGH);       // the step`, 'unsigned long t0 = micros();',
    'for (int i = 0; i < 16; i++) {', `  v[i] = analogRead(${an});`, '  t[i] = micros() - t0;', ...(gap ? [`  ${gap}`] : []), '}', `digitalWrite(${pin}, LOW);`,
    'for (int i = 0; i < 16; i++) {', '  Serial.print(t[i]);', '  Serial.print(" us   ");', `  Serial.print(v[i] * ${c.vref} / 1023, 2);`, '  Serial.println(" V");', '}', 'Serial.println("---");']);
  s.title ||= title; c.say(say(pin, an));
}
const capacitor = phase(ACTUATOR)((c, { n, type }) => {
  const bh = b(type), r = roleMap(type), h = c.part(type, { fresh: n > 0 }), uF = bh.uF || 1;
  const ohms = Math.round(Math.min(10000, Math.max(1000, 0.1 / (uF * 1e-6)))), tau = ohms * uF * 1e-6;
  stepResponse(c, h, { aPin: r.a, bPin: r.b, ohms, tauUs: tau * 1e6,
    title: `${shortName(PART_DEFS[type])} charging through ${ohmText(ohms)}: the time constant is ${(tau * 1000).toFixed(tau < 0.01 ? 2 : 0)} ms`,
    say: (pin, an) => `${h.isNew ? 'Added a' : 'Used the'} ${shortName(PART_DEFS[type])} charged from pin ${pin} through a ${ohmText(ohms)} resistor (time constant ${(tau * 1000).toFixed(tau < 0.01 ? 2 : 0)} ms); ${an} samples the charging curve and the sketch prints it.` });
});
const inductor = phase(ACTUATOR)((c, { n, type }) => {
  const bh = b(type), r = roleMap(type), h = c.part(type, { fresh: n > 0 }), L = (bh.mH || 10) * 1e-3, ohms = 220, tau = L / (ohms + (bh.rs || 5) + 25);
  stepResponse(c, h, { aPin: r.a, bPin: r.b, ohms, tauUs: tau * 1e6,
    title: `${shortName(PART_DEFS[type])} behind ${ohms} Ω: the voltage across it jumps, then decays (time constant about ${Math.round(tau * 1e6)} µs)`,
    say: (pin, an) => `${h.isNew ? 'Added an' : 'Used the'} ${shortName(PART_DEFS[type])} behind a ${ohms} Ω resistor, stepped from pin ${pin}; ${an} samples the voltage across it and the sketch prints the decay.` });
});

/* ── op-amp: a voltage follower on a knob ─────────────────────────────────────────────────────── */
const opamp = phase(ACTUATOR)((c, { n, type }) => {
  const s = c.sketch, bh = b(type), r = roleMap(type), h = c.part(type, { fresh: n > 0 });
  const needBattery = (bh.dropHigh || 0) > 0.5 || (bh.minSupply || 0) > 4.5, v = Math.min(12, Math.max(9, Math.ceil((bh.minSupply || 3) + 1)));
  if (needBattery) { const bat = c.helper('battery', [['+', h, r.vcc]], { props: { volts: v } }); c.join(bat, '+', h, r.vcc); c.ground(bat, '-'); } else c.power(h, r.vcc);
  c.ground(h, r.vee);
  const pot = c.helper('potentiometer', [['SIG', h, r.inp]]); c.power(pot, 'VCC'); c.ground(pot, 'GND');
  c.join(pot, 'SIG', h, r.inp); c.join(h, r.out, h, r.inn);
  const an = c.hook(h, r.out, 'analog'); volts(c, an, 'Output V');
  s.title ||= `${shortName(PART_DEFS[type])} as a voltage follower: the knob's voltage appears at OUT (read on ${an})`;
  c.say(`${h.isNew ? 'Added an' : 'Used the'} ${shortName(PART_DEFS[type])} as a voltage follower: a potentiometer feeds IN+, OUT is tied to IN− and read on ${an}${needBattery ? `; it runs from a ${v} V battery (its − joined to the Arduino GND), because it needs more than 5 V` : ''}.`);
});

/* ── biosignal amplifier with its body-signal source ─────────────────────────────────────────── */
const bioAmp = phase(SOURCE)((c, { n, type }) => {
  const s = c.sketch, bh = b(type), r = roleMap(type), isSource = bh.kind === 'signal-source';
  const amp = isSource ? c.part('custom-bioamp-exg-pill', { fresh: n > 0 }) : c.part(type, { fresh: n > 0 });
  const ar = roleMap(amp.type), abh = b(amp.type);
  const src = isSource ? c.part(type, { fresh: n > 0 }) : c.helper('custom-signal-source', [[roleMap('custom-signal-source').pos, amp, ar.inp]]);
  c.power(amp, ar.vcc); c.ground(amp, ar.vee);
  c.join(src, roleMap(src.type).pos, amp, ar.inp); c.join(src, roleMap(src.type).neg, amp, ar.inn);
  if (abh.bias === 'ref') {                     // the amplifier's output rests at the voltage on REF: give it half the supply
    c.pull(amp, ar.ref, 'logic', 10000); c.pull(amp, ar.ref, 'gnd', 10000);
  }
  c.join(src, roleMap(src.type).ref, amp, ar.ref);
  const an = c.hook(amp, ar.out, 'analog');
  s.baud = 115200; s.serial();
  s.global('const unsigned long SAMPLE_US = 4000;          // 4 ms = 250 samples per second'); s.global('unsigned long nextSample;'); s.global('float baseline = 512;');
  s.setup('nextSample = micros();');
  s.sample('if ((long)(micros() - nextSample) >= 0) {'); s.sample('  nextSample += SAMPLE_US;'); s.sample(`  int raw = analogRead(${an});`); s.sample('  baseline += (raw - baseline) / 100.0;      // the slow average = the amplifier\'s resting level'); s.sample('  Serial.println((int)(raw - baseline));'); s.sample('}');
  s.title ||= `${shortName(PART_DEFS[amp.type])} → ${an}: prints the signal with its slow drift removed (open the Serial monitor). Simulated, illustrative signal — not medical data.`;
  c.say(`${amp.isNew ? 'Added a' : 'Used the'} ${shortName(PART_DEFS[amp.type])} with a body-signal source on its inputs; OUT is read on ${an} at 250 samples per second.`);
});

/* ── logic chips: gates, flip-flops, multiplexers (any chip whose rules the part declares) ──────── */
const logicChip = phase(ACTUATOR)((c, { n, type }) => {
  const s = c.sketch, def = PART_DEFS[type], bh = b(type), roles = roleMap(type), h = c.part(type, { fresh: n > 0 });
  c.power(h, roles.vcc); c.ground(h, roles.gnd); if (roles.enable) c.ground(h, roles.enable);
  const outs = (def.logic?.outputs || []).map(o => o.pin), skip = new Set([roles.vcc, roles.gnd, roles.enable, ...outs]);
  const ins = def.pins.map(p => p.id).filter(p => !skip.has(p));
  const clocks = ins.filter(p => /^(CLK|CK|CLOCK|SHCP|STCP)$/i.test(p)), datas = ins.filter(p => !clocks.includes(p));
  const inPins = ins.map(p => c.hook(h, p, 'digital', { prefer: ['2', '3', '4', '5', '6', '7'], dir: 'out' })), outPins = outs.slice(0, 4).map(p => c.hook(h, p, 'digital', { prefer: ['8', '9', '10', '11'] }));
  const arr = s.uid('inPins'), arro = s.uid('outPins');
  s.serial();
  s.global(`const int ${arr}[${ins.length}] = {${inPins.join(', ')}};            // ${ins.join(', ')}`); s.global(`const int ${arro}[${outPins.length}] = {${outPins.join(', ')}};          // ${outs.slice(0, 4).join(', ')}`);
  s.setup(`for (int i = 0; i < ${ins.length}; i++) pinMode(${arr}[i], OUTPUT);`); s.setup(`for (int i = 0; i < ${outPins.length}; i++) pinMode(${arro}[i], INPUT);`);
  const header = `${ins.join(' ')} → ${outs.slice(0, 4).join(' ')}`; s.setup(`Serial.println(F("${header}"));`);
  const show = ['for (int i = 0; i < ' + ins.length + '; i++) Serial.print(digitalRead(' + arr + '[i]));', 'Serial.print(" -> ");', `for (int i = 0; i < ${outPins.length}; i++) Serial.print(digitalRead(${arro}[i]));`, 'Serial.println();'];
  if (clocks.length) {                                   // sequential: change the data, then pulse the clock
    s.tick(1000, ['static int step = 0;', 'step++;', ...datas.map(p => `digitalWrite(${arr}[${ins.indexOf(p)}], (step >> ${datas.indexOf(p)}) & 1);`), 'delay(5);',
      ...clocks.map(p => `digitalWrite(${arr}[${ins.indexOf(p)}], HIGH);`), 'delay(5);', ...clocks.map(p => `digitalWrite(${arr}[${ins.indexOf(p)}], LOW);`), 'delay(5);', ...show]);
  } else {
    s.tick(800, ['static int combo = 0;', `for (int i = 0; i < ${ins.length}; i++) digitalWrite(${arr}[i], (combo >> i) & 1);`, 'delay(20);', ...show, `combo = (combo + 1) % ${1 << ins.length};`]);
  }
  s.title ||= `${shortName(def)}: the sketch sets every input combination and prints what the output does (inputs ${ins.join(', ')})`;
  c.say(`${h.isNew ? 'Added a' : 'Used the'} ${shortName(def)} (inputs ${ins.join(', ')} on pins ${inPins.join(', ')}; ${outs.slice(0, 4).join(', ')} read on pins ${outPins.join(', ')}); the sketch prints its truth table.`);
});

/* ── 74HC595 shift register with eight LEDs ───────────────────────────────────────────────────── */
const shift595 = phase(ACTUATOR)((c, { n, type }) => {
  const s = c.sketch, f = c.signals, h = c.part(type, { fresh: n > 0 });
  c.power(h, 'VCC'); c.ground(h, 'GND'); c.power(h, 'MR'); c.ground(h, 'OE');
  const data = c.hook(h, 'DS', 'digital', { prefer: ['11', '8', '4'], dir: 'out' }), clock = c.hook(h, 'SHCP', 'digital', { prefer: ['12', '9', '5'], dir: 'out' }), latch = c.hook(h, 'STCP', 'digital', { prefer: ['8', '10', '6'], dir: 'out' });
  for (let i = 0; i < 8; i++) loadLed(c, { ohms: 220, from: [h, `Q${i}`], to: 'gnd' });
  s.setup(`pinMode(${data}, OUTPUT);`); s.setup(`pinMode(${clock}, OUTPUT);`); s.setup(`pinMode(${latch}, OUTPUT);`);
  s.global(`void showBits(byte value) {\n  digitalWrite(${latch}, LOW);\n  shiftOut(${data}, ${clock}, MSBFIRST, value);\n  digitalWrite(${latch}, HIGH);\n}`);
  if (f.level && !f.bool) { s.sample(`showBits((1 << map(${f.level.expr}, 0, 1023, 0, 7)));`); f.consumed = true; }
  else if (f.bool) { s.sample(`showBits((${f.bool.expr}) ? 255 : 0);`); f.consumed = true; }
  else s.tick(150, ['static int i = 0;', 'showBits(1 << i);', 'i = (i + 1) % 8;']);
  c.wiring(`74HC595: DS pin ${data}, SHCP pin ${clock}, STCP pin ${latch}; MR to 5V, OE to GND; Q0 … Q7 each through a 220 Ω resistor to an LED to GND`);
  s.title ||= `74HC595 shift register on pins ${data} / ${clock} / ${latch}: eight LEDs ${f.level ? 'show ' + f.level.label : 'chase along'}`;
  c.say(`${h.isNew ? 'Added a' : 'Used the'} 74HC595 shift register (DS pin ${data}, SHCP pin ${clock}, STCP pin ${latch}) with eight LEDs on Q0–Q7, each with a 220 Ω resistor.`);
});

/* ── things with no circuit of their own ──────────────────────────────────────────────────────── */
const slime = phase(OTHER)((c, { type }) => {
  c.say('A slime mold sits on an electrode grid and is read through a BioAmp EXG Pill, so I did not build a circuit for it. The Examples menu has a ready sketch for that setup: "Slime mold electrode reader".');
  c.mem.informational = true;
});

const drone = phase(OTHER)((c, { type }) => {
  c.say('Drone parts are wired to each other, not to an Arduino: battery to the AIO, each motor to a motor pad (M1–M4), the camera to CAM. Then the Test tab flies what you wired.');
  c.mem.informational = true;
});

export const PARTS_BY_TYPE = { ...Object.fromEntries(['aio', 'motor-fr', 'motor-fl', 'motor-bl', 'motor-br', 'battery', 'camera'].map(k => [`custom-drone-${k}`, drone])), battery, resistor, 'custom-ic-74hc595': shift595, 'custom-slime-mold': slime };
export const PARTS_BY_KIND = { diode, npn: transistor, pnp: transistor, nmos: transistor, pmos: transistor, regulator, capacitor, inductor, opamp, inamp: bioAmp, 'signal-source': bioAmp, logic: logicChip };
