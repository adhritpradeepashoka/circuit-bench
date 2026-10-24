// Recipes for things that MEASURE: knobs, light / temperature / gas / sound / flame / motion sensors, the I²C parts, distance,
// encoders, joysticks, keypads and the biosignal amplifiers — plus the two screens that SHOW what they measure.
import { PART_DEFS } from '../parts.js';
import { phase, SOURCE, SINK, offerBool, offerLevel, roleMap, PlanError } from './helpers.js';

const shortName = def => def.name.replace(/\s*\(.*$/, '').replace(/\s+/g, ' ').trim();

/* ── analog modules: power, ground and one analog pin ─────────────────────────────────────────── */
function analogModule(c, h, { vcc, gnd, out, title, label, convert = null, more = null }, n) {
  const s = c.sketch;
  c.power(h, vcc); c.ground(h, gnd);
  const pin = c.hook(h, out, 'analog');
  const v = s.uid('raw');
  s.measure(`int ${v} = analogRead(${pin});`);
  if (convert) convert(s, v, pin); else s.show(label, v);
  offerLevel(c, `analogRead(${pin})`, label.toLowerCase());
  s.title ||= title(pin);
  more?.(pin);
  return pin;
}

const ldr = phase(SOURCE)((c, { n }) => {
  const h = c.part('ldr-module', { fresh: n > 0 });
  const pin = analogModule(c, h, {
    vcc: 'VCC', gnd: 'GND', out: 'AO', label: 'Light', title: p => `Photoresistor module: AO on ${p} — a HIGH reading means dark`,
    convert: (s, v) => { const lux = s.uid('lux'); s.measure(`float ${lux} = 10.0 * pow(50000.0 / (10000.0 * ${v} / max(1, 1023 - ${v})), 1.0 / 0.7);`); s.show('Light lux', lux, 0); },
  }, n);
  // brighter should mean "more": the module's AO falls as light rises
  c.signals.level = c.signals.level && c.signals.level.label !== 'light' ? c.signals.level : { expr: `1023 - analogRead(${pin})`, label: 'the light' };
  c.say(`${h.isNew ? 'Added a' : 'Used the'} photoresistor module (AO on ${pin}); the sketch prints the light level in lux.`);
});

const ntc = phase(SOURCE)((c, { n }) => {
  const h = c.part('ntc-sensor', { fresh: n > 0 });
  const pin = analogModule(c, h, {
    vcc: 'VCC', gnd: 'GND', out: 'OUT', label: 'Temp', title: p => `NTC temperature sensor: OUT on ${p} (10 kΩ at 25 °C, β = 3950)`,
    convert: (s, v) => { const t = s.uid('tempC'); s.measure(`float ${t} = 1.0 / (1.0 / 298.15 + log((10000.0 * ${v} / max(1, 1023 - ${v})) / 10000.0) / 3950.0) - 273.15;`); s.show('Temp C', t, 1); },
  }, n);
  c.signals.level = { expr: `1023 - analogRead(${pin})`, label: 'the temperature' };
  c.say(`${h.isNew ? 'Added a' : 'Used the'} temperature sensor (OUT on ${pin}); the sketch prints °C.`);
});

/* every "analog-sensor" part: sound, gas, flame, the Part Creator's own */
const analogKind = phase(SOURCE)((c, { n, type }) => {
  const def = PART_DEFS[type], r = roleMap(type), h = c.part(type, { fresh: n > 0 });
  const label = shortName(def).replace(/\s*Sensor$/i, '');
  const pin = analogModule(c, h, { vcc: r.vcc, gnd: r.gnd, out: r.out, label, title: p => `${shortName(def)}: ${r.out} on ${p}` }, n);
  c.say(`${h.isNew ? 'Added a' : 'Used the'} ${shortName(def).toLowerCase()} (${r.out} on ${pin}); the sketch prints its reading.`);
});

/* ── digital sensors: PIR, tilt, hall … ──────────────────────────────────────────────────────── */
function digitalSensor(c, h, { vcc, gnd, out, name, rail = 'logic' }, n) {
  const s = c.sketch;
  c.power(h, vcc, rail); c.ground(h, gnd);
  const pin = c.hook(h, out, 'digital', { prefer: ['2', '3', '4', '5', '6', '7'] });
  const v = s.uid('active'); s.global(`bool ${v} = false;`);
  s.setup(`pinMode(${pin}, INPUT);`); s.sample(`${v} = digitalRead(${pin}) == HIGH;`);
  s.show(name, `(${v} ? "yes" : "no")`);
  offerBool(c, v, `the ${name.toLowerCase()} sensor`);
  s.title ||= `${name} sensor: OUT on pin ${pin} is HIGH while it is triggered`;
  return pin;
}
const pir = phase(SOURCE)((c, { n }) => {
  const h = c.part('pir-sensor', { fresh: n > 0 });
  const pin = digitalSensor(c, h, { vcc: 'VCC', gnd: 'GND', out: 'OUT', name: 'Motion', rail: 'v5' }, n);
  c.say(`${h.isNew ? 'Added a' : 'Used the'} PIR motion sensor (OUT on pin ${pin}).`);
});
const digitalKind = phase(SOURCE)((c, { n, type }) => {
  const def = PART_DEFS[type], r = roleMap(type), h = c.part(type, { fresh: n > 0 });
  const name = shortName(def).replace(/\s*(sensor|switch)$/i, '') || 'Input';
  const pin = digitalSensor(c, h, { vcc: r.vcc, gnd: r.gnd, out: r.out, name: name.charAt(0).toUpperCase() + name.slice(1) }, n);
  c.say(`${h.isNew ? 'Added a' : 'Used the'} ${shortName(def).toLowerCase()} (OUT on pin ${pin}).`);
});

/* ── DHT ─────────────────────────────────────────────────────────────────────────────────────── */
const dht = phase(SOURCE)((c, { n }) => {
  const s = c.sketch, h = c.part('dht', { fresh: n > 0 });
  c.power(h, 'VCC'); c.ground(h, 'GND');
  const pin = c.hook(h, 'SDA', 'digital', { prefer: ['2', '3', '4', '5', '6', '7'], dir: 'io' });
  const model = h.props?.model === 'DHT11' ? 'DHT11' : 'DHT22', d = s.uid('dht'), t = s.uid('tempC'), hu = s.uid('humidity');
  s.include('DHT.h'); s.global(`DHT ${d}(${pin}, ${model});`); s.setup(`${d}.begin();`);
  s.measure(`float ${t} = ${d}.readTemperature();`, 2000); s.measure(`float ${hu} = ${d}.readHumidity();`, 2000);
  s.show('Temp C', t, 1); s.show('Humidity %', hu, 0);
  offerLevel(c, `(int)(${d}.readTemperature() * 10)`, 'the temperature');
  s.title ||= `${model}: DATA on pin ${pin}. Right-click the sensor to change the weather.`;
  c.say(`${h.isNew ? 'Added a' : 'Used the'} ${model} (DATA on pin ${pin}); the sketch prints temperature and humidity every 2 s.`);
});

/* ── I²C: the MPU-6050 and the two screens ─────────────────────────────────────────────────────── */
const mpu = phase(SOURCE)((c, { n }) => {
  const s = c.sketch, h = c.part('mpu6050', { fresh: n > 0 });
  c.bus(h, 'SDA', 'SCL'); c.power(h, 'VCC'); c.ground(h, 'GND');
  const high = x => ['v5', 'v33'].includes(c.railOn(c.netOf(x, 'AD0'))) || x.ad0High;
  const others = c.handles.filter(o => o.type === 'mpu6050' && o !== h);
  let addr = high(h) ? 0x69 : 0x68;
  if (others.some(o => (high(o) ? 0x69 : 0x68) === addr)) {
    if (addr === 0x69 || others.some(o => high(o))) throw new PlanError('Only two MPU-6050 fit on one I²C bus (addresses 0x68 and 0x69), and both are already taken.', 'i2c-full');
    c.power(h, 'AD0'); h.ad0High = true; addr = 0x69;
  }
  const k = c.mem.mpu = (c.mem.mpu || 0) + 1, id = s.uid('MPU'), suffix = k > 1 ? ` ${k}` : '';
  s.include('Wire.h');
  s.global('int16_t mpuWord() {\n  int16_t high = Wire.read();\n  return (high << 8) | Wire.read();\n}');
  s.global(`const int ${id} = 0x${addr.toString(16)};`);
  s.setup('Wire.begin();'); s.setup(`Wire.beginTransmission(${id});`); s.setup('Wire.write(0x6B);          // wake the sensor up'); s.setup('Wire.write(0);'); s.setup('Wire.endTransmission();');
  const ax = s.uid('ax'), ay = s.uid('ay'), az = s.uid('az'), roll = s.uid('roll'), pitch = s.uid('pitch');
  s.measure(`Wire.beginTransmission(${id});`); s.measure('Wire.write(0x3B);          // X, Y, Z acceleration follow'); s.measure('Wire.endTransmission(false);'); s.measure(`Wire.requestFrom(${id}, 6);`);
  s.measure(`int16_t ${ax} = mpuWord(), ${ay} = mpuWord(), ${az} = mpuWord();`);
  s.measure(`float ${roll} = atan2(${ay}, ${az}) * 180.0 / PI;`); s.measure(`float ${pitch} = atan2(-${ax}, sqrt((float)${ay} * ${ay} + (float)${az} * ${az})) * 180.0 / PI;`);
  s.show(`Roll${suffix}`, roll, 0); s.show(`Pitch${suffix}`, pitch, 0);
  s.title ||= 'MPU-6050: tilt over I²C (roll and pitch in degrees). Right-click the sensor to tilt it.';
  c.say(`${h.isNew ? 'Added an' : 'Used the'} MPU-6050 on the I²C pins${addr === 0x69 ? ' (address 0x69: AD0 to the supply)' : ''}; the sketch prints roll and pitch.`);
});

const lcd = phase(SINK)((c, { n }) => {
  const s = c.sketch, h = c.part('lcd1602', { fresh: n > 0 });
  if (n > 0) throw new PlanError('One 16×2 screen is enough: two would answer at the same I²C address (0x27).', 'i2c-full');
  c.bus(h, 'SDA', 'SCL'); c.power(h, 'VCC'); c.ground(h, 'GND');
  if (c.logic < 4) c.notes.push('A 1602 LCD is really a 5 V part: on 3.3 V its text can look faint (turn the contrast screw). If it stays dark on real hardware, power it from VBUS and put a level shifter on SDA/SCL, because the backpack pulls those two lines up to 5 V and the Pico\'s pins only take 3.3 V.');
  s.sink('lcd', { includes: ['Wire.h', 'LiquidCrystal_I2C.h'], globals: ['LiquidCrystal_I2C lcd(0x27, 16, 2);'], setup: ['lcd.init();', 'lcd.backlight();'] });
  s.title ||= '16×2 LCD on I²C (address 0x27)';
  c.say(`${h.isNew ? 'Added a' : 'Used the'} 16×2 LCD on the I²C pins; it shows the readings of the other parts (or the uptime, if there are none).`);
});

const oled = phase(SINK)((c, { n }) => {
  const s = c.sketch, h = c.part('ssd1306', { fresh: n > 0 });
  if (n > 0) throw new PlanError('One OLED screen is enough: two would answer at the same I²C address (0x3C).', 'i2c-full');
  c.bus(h, 'DATA', 'CLK'); c.power(h, 'VIN'); c.ground(h, 'GND');
  s.serial();
  s.sink('oled', { includes: ['Wire.h', 'Adafruit_GFX.h', 'Adafruit_SSD1306.h'], globals: ['Adafruit_SSD1306 display(128, 64, &Wire, -1);'],
    setup: ['if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {', '  Serial.println(F("OLED not found"));', '  while (true) {}', '}', 'display.setTextColor(SSD1306_WHITE);'] });
  s.title ||= '128×64 OLED on I²C (address 0x3C)';
  c.say(`${h.isNew ? 'Added an' : 'Used the'} OLED screen on the I²C pins; it shows the readings of the other parts (or the uptime, if there are none).`);
});


/* ── distance, encoder, joystick, keypad, DIP bank ────────────────────────────────────────────── */
const ultrasonic = phase(SOURCE)((c, { n, type }) => {
  const s = c.sketch, def = PART_DEFS[type], r = roleMap(type), h = c.part(type, { fresh: n > 0 });
  c.power(h, r.vcc, 'v5'); c.ground(h, r.gnd);
  const trig = c.hook(h, r.trig, 'digital', { prefer: ['9', '7', '5', '3'], dir: 'out' }), echo = c.hook(h, r.echo, 'digital', { prefer: ['10', '8', '6', '4'] });
  const us = s.uid('echoUs'), cm = s.uid('distanceCm');
  s.setup(`pinMode(${trig}, OUTPUT);`); s.setup(`pinMode(${echo}, INPUT);`);
  s.measure(`digitalWrite(${trig}, LOW);`); s.measure('delayMicroseconds(2);'); s.measure(`digitalWrite(${trig}, HIGH);`); s.measure('delayMicroseconds(10);'); s.measure(`digitalWrite(${trig}, LOW);`);
  s.measure(`long ${us} = pulseIn(${echo}, HIGH, 30000);          // how long the echo took (0 = nothing heard)`);
  s.measure(`float ${cm} = ${us} * 0.0343 / 2;`);
  s.show('Distance cm', cm, 1);
  s.title ||= `${shortName(def)}: TRIG on pin ${trig}, ECHO on pin ${echo}. Right-click the sensor to move the "object".`;
  c.say(`${h.isNew ? 'Added an' : 'Used the'} ultrasonic sensor (TRIG on pin ${trig}, ECHO on pin ${echo}); the sketch prints the distance in cm.`);
});

const encoder = phase(SOURCE)((c, { n, type }) => {
  const s = c.sketch, r = roleMap(type), h = c.part(type, { fresh: n > 0 });
  if (h.def.pinById.has('VCC')) c.power(h, 'VCC');
  c.ground(h, r.common);
  const clk = c.hook(h, r.a, 'digital', { prefer: ['2', '4', '6'] }), dt = c.hook(h, r.b, 'digital', { prefer: ['3', '5', '7'] }), sw = r.sw ? c.hook(h, r.sw, 'digital', { prefer: ['4', '6', '8', '9'] }) : null;
  const pos = s.uid('position'), last = s.uid('lastClk');
  s.global(`int ${pos} = 0;`); s.global(`int ${last} = HIGH;`);
  s.setup(`pinMode(${clk}, INPUT_PULLUP);`); s.setup(`pinMode(${dt}, INPUT_PULLUP);`); if (sw) s.setup(`pinMode(${sw}, INPUT_PULLUP);`);
  s.sample(`int clk = digitalRead(${clk});`);
  s.sample(`if (clk != ${last} && clk == LOW) ${pos} += digitalRead(${dt}) != clk ? 1 : -1;     // one click, and which way`);
  s.sample(`${last} = clk;`);
  s.show('Position', pos);
  if (sw) { s.show('Button', `(digitalRead(${sw}) == LOW ? "pressed" : "released")`); offerBool(c, `digitalRead(${sw}) == LOW`, 'the knob button'); }
  offerLevel(c, `constrain(${pos} * 64, 0, 1023)`, 'the knob');
  s.title ||= `Rotary encoder: CLK on pin ${clk}, DT on pin ${dt}${sw ? `, button on pin ${sw}` : ''}`;
  c.say(`${h.isNew ? 'Added a' : 'Used the'} rotary encoder (CLK on pin ${clk}, DT on pin ${dt}${sw ? `, SW on pin ${sw}` : ''}); the sketch counts the clicks.`);
});

const joystick = phase(SOURCE)((c, { n, type }) => {
  const s = c.sketch, r = roleMap(type), h = c.part(type, { fresh: n > 0 });
  c.power(h, r.vcc); c.ground(h, r.gnd);
  const x = c.hook(h, r.horz, 'analog'), y = c.hook(h, r.vert, 'analog'), sel = r.sel ? c.hook(h, r.sel, 'digital', { prefer: ['2', '3', '4'] }) : null;
  if (sel) s.setup(`pinMode(${sel}, INPUT_PULLUP);`);
  s.show('X', `analogRead(${x})`); s.show('Y', `analogRead(${y})`);
  if (sel) { s.show('Press', `(digitalRead(${sel}) == LOW ? "yes" : "no")`); offerBool(c, `digitalRead(${sel}) == LOW`, 'the stick button'); }
  offerLevel(c, `analogRead(${x})`, 'the stick');
  s.title ||= `Joystick: X on ${x}, Y on ${y}${sel ? `, button on pin ${sel}` : ''} (about 512 in the middle)`;
  c.say(`${h.isNew ? 'Added a' : 'Used the'} joystick (X on ${x}, Y on ${y}${sel ? `, SEL on pin ${sel}` : ''}); the sketch prints the position.`);
});

const keypad = phase(SOURCE)((c, { n, type }) => {
  const s = c.sketch, b = PART_DEFS[type].spec.behaviour, h = c.part(type, { fresh: n > 0 });
  const rows = b.rows.map(p => c.hook(h, p, 'digital', { prefer: ['9', '8', '7', '6', '5', '4'], dir: 'out' }));
  const cols = b.cols.map(p => c.hook(h, p, 'digital', { prefer: ['5', '4', '3', '2', '10', '11', '12'] }));
  const map = rows.length === 4 && cols.length === 4 ? ['123A', '456B', '789C', '*0#D'] : rows.map((_, i) => cols.map((_, j) => String.fromCharCode(48 + ((i * cols.length + j) % 10))).join(''));
  const keys = s.uid('KEYS'), rp = s.uid('rowPins'), cp = s.uid('colPins'), last = s.uid('lastKey');
  s.global(`const char ${keys}[${rows.length}][${cols.length}] = {${map.map(r => `{${[...r].map(ch => `'${ch}'`).join(', ')}}`).join(', ')}};`);
  s.global(`const int ${rp}[] = {${rows.join(', ')}};`); s.global(`const int ${cp}[] = {${cols.join(', ')}};`); s.global(`char ${last} = 0;`);
  s.serial();
  s.setup(`for (int r = 0; r < ${rows.length}; r++) { pinMode(${rp}[r], OUTPUT); digitalWrite(${rp}[r], HIGH); }`);
  s.setup(`for (int k = 0; k < ${cols.length}; k++) pinMode(${cp}[k], INPUT_PULLUP);`);
  s.tick(30, [`char key = 0;`, `for (int r = 0; r < ${rows.length}; r++) {`, `  digitalWrite(${rp}[r], LOW);`, `  for (int k = 0; k < ${cols.length}; k++) if (digitalRead(${cp}[k]) == LOW) key = ${keys}[r][k];`, `  digitalWrite(${rp}[r], HIGH);`, '}', `if (key && key != ${last}) Serial.println(key);          // a new key went down`, `${last} = key;`]);
  s.title ||= `Keypad ${rows.length}×${cols.length}: rows on pins ${rows.join(', ')}, columns on pins ${cols.join(', ')}`;
  c.say(`${h.isNew ? 'Added a' : 'Used the'} keypad (rows on pins ${rows.join(', ')}, columns on pins ${cols.join(', ')}); the sketch prints each key you press.`);
});

const dip = phase(SOURCE)((c, { n, type }) => {
  const s = c.sketch, b = PART_DEFS[type].spec.behaviour, h = c.part(type, { fresh: n > 0 });
  const pins = b.a.map(p => c.hook(h, p, 'digital', { prefer: ['2', '3', '4', '5', '6', '7', '8', '9'] }));
  for (const p of b.b) c.ground(h, p);
  const arr = s.uid('switchPins'), v = s.uid('value');
  s.global(`const int ${arr}[] = {${pins.join(', ')}};`);
  s.setup(`for (int i = 0; i < ${pins.length}; i++) pinMode(${arr}[i], INPUT_PULLUP);`);
  s.measure(`int ${v} = 0;`); s.measure(`for (int i = 0; i < ${pins.length}; i++) if (digitalRead(${arr}[i]) == LOW) ${v} |= 1 << i;     // switch ON = LOW`);
  s.show('Value', v);
  s.title ||= `DIP switch bank: switches on pins ${pins.join(', ')} (the other side of each goes to GND)`;
  c.say(`${h.isNew ? 'Added a' : 'Used the'} ${b.a.length}-way DIP switch on pins ${pins.join(', ')}; the sketch prints the number they make.`);
});

/* ── a custom switch, a custom button, a variable resistor ────────────────────────────────────── */
const switchKind = phase(SOURCE)((c, { n, type }) => {
  const s = c.sketch, r = roleMap(type), h = c.part(type, { fresh: n > 0 });
  const pin = c.hook(h, r.common, 'digital', { prefer: ['2', '3', '4', '5'] });
  c.ground(h, r.throw1); if (r.throw2) c.power(h, r.throw2);
  s.setup(`pinMode(${pin}, ${r.throw2 ? 'INPUT' : 'INPUT_PULLUP'});`);
  const v = s.uid('switchOn'), flipped = r.throw2 ? 'HIGH' : 'LOW';
  s.global(`bool ${v} = false;`); s.sample(`${v} = digitalRead(${pin}) == ${flipped};`);
  offerBool(c, v, 'the switch'); s.title ||= `${shortName(PART_DEFS[type])} on pin ${pin}`;
  c.say(`${h.isNew ? 'Added a' : 'Used the'} ${shortName(PART_DEFS[type]).toLowerCase()} on pin ${pin}.`);
});
const buttonKind = phase(SOURCE)((c, { n, type }) => {
  const s = c.sketch, r = roleMap(type), h = c.part(type, { fresh: n > 0 });
  const pin = c.hook(h, r.a, 'digital', { prefer: ['2', '3', '4', '5'] }); c.ground(h, r.b);
  s.setup(`pinMode(${pin}, INPUT_PULLUP);`);
  const v = s.uid('pressed'); s.global(`bool ${v} = false;`); s.sample(`${v} = digitalRead(${pin}) == LOW;`);
  offerBool(c, v, 'the button'); s.title ||= `${shortName(PART_DEFS[type])} on pin ${pin} (wired to GND): pressing it reads LOW`;
  c.say(`${h.isNew ? 'Added a' : 'Used the'} ${shortName(PART_DEFS[type]).toLowerCase()} on pin ${pin}.`);
});
const variableResistor = phase(SOURCE)((c, { n, type }) => {
  const s = c.sketch, r = roleMap(type), h = c.part(type, { fresh: n > 0 }), label = shortName(PART_DEFS[type]).replace(/\s*Potentiometer$/i, ' pot');
  let pin;
  if (r.wiper) { c.ground(h, r.a); c.power(h, r.b); pin = c.hook(h, r.wiper, 'analog'); }
  else {                                                  // two legs only: make a voltage divider with a 10 kΩ resistor
    pin = c.hook(h, r.a, 'analog'); c.pull(h, r.a, 'logic', 10000); c.ground(h, r.b);
  }
  const v = s.uid('raw'); s.measure(`int ${v} = analogRead(${pin});`); s.show(label, v);
  offerLevel(c, `analogRead(${pin})`, label.toLowerCase()); s.title ||= `${shortName(PART_DEFS[type])}: signal on ${pin} (0 – 1023)`;
  c.say(`${h.isNew ? 'Added a' : 'Used the'} ${shortName(PART_DEFS[type]).toLowerCase()} (signal on ${pin}).`);
});

export const SENSORS_BY_TYPE = { 'ldr-module': ldr, 'ntc-sensor': ntc, 'pir-sensor': pir, dht, mpu6050: mpu, lcd1602: lcd, ssd1306: oled };
export const SENSORS_BY_KIND = { 'analog-sensor': analogKind, 'digital-sensor': digitalKind, ultrasonic, encoder, joystick, keypad, 'switch-bank': dip, switch: switchKind, button: buttonKind, 'variable-resistor': variableResistor };
