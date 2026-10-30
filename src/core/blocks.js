// Block coding: what the blocks are, and how a block program becomes an Arduino sketch. Pure (no DOM, no Blockly) — the editor
// (src/ui/blocks.js) only hands this file the program as Blockly's saved JSON, so the whole generator is testable in Node.
//
//   BLOCKS[type] = { json: <Blockly block definition>, dev?: kind(s) of part it needs, gen(b, cx) }
//   generateSketch(program, bench) → { code, warnings: [{ block, text }] }
//
// A device block holds a part id (field DEV). Its pin is looked up in `bench` (src/core/bench-devices.js) each time a sketch is
// made, so the same blocks follow a part when it is re-wired, and a part that is not wired yet gives a plain-words warning
// instead of broken code.
import { pinLabel } from './bench-devices.js';

export const HUES = { program: 45, control: 30, logic: 210, math: 120, vars: 330, say: 260, light: 5, input: 185, sensor: 160, screen: 285, motor: 15, pin: 230 };

const NUM = 'Number', BOOL = 'Boolean', TXT = 'String';
const ON_OFF = [['on', 'ON'], ['off', 'OFF']];
export const BLOCKS = {};
const def = (type, json, gen, dev) => { BLOCKS[type] = { json: { type, ...json }, gen, dev }; };
const stmt = { previousStatement: null, nextStatement: null };
const dev = kind => ({ type: 'input_dummy', name: 'DEVSLOT', _dev: kind });          // the editor puts a dropdown of that kind of part here (field DEV)

/* ───────────────────────── the program ───────────────────────── */
def('cb_setup', { message0: 'when the program starts %1 %2', args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], colour: HUES.program, tooltip: 'Everything inside runs once, at the start.' }, (b, cx) => b.stmts('DO'));
def('cb_loop', { message0: 'forever %1 %2', args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], colour: HUES.program, tooltip: 'Everything inside runs again and again, for ever.' }, (b, cx) => b.stmts('DO'));

/* ───────────────────────── control ───────────────────────── */
def('cb_wait', { message0: 'wait %1 seconds', args0: [{ type: 'input_value', name: 'S', check: NUM }], ...stmt, colour: HUES.control, tooltip: 'Pause the program.' },
  b => `delay((unsigned long)((${b.num('S', 1)}) * 1000.0));`);
def('cb_repeat', { message0: 'repeat %1 times %2 %3', args0: [{ type: 'input_value', name: 'N', check: NUM }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], ...stmt, colour: HUES.control },
  (b, cx) => { const i = cx.tmp('i'); return `for (int ${i} = 0; ${i} < (int)(${b.num('N', 10)}); ${i}++) {\n${cx.indent(b.stmts('DO'))}\n}`; });
def('cb_while', { message0: 'repeat while %1 %2 %3', args0: [{ type: 'input_value', name: 'C', check: BOOL }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], ...stmt, colour: HUES.control },
  (b, cx) => `while (${b.bool('C')}) {\n${cx.indent(b.stmts('DO'))}\n  delay(1);\n}`);
def('cb_wait_until', { message0: 'wait until %1', args0: [{ type: 'input_value', name: 'C', check: BOOL }], ...stmt, colour: HUES.control }, b => `while (!(${b.bool('C')})) { delay(1); }`);
def('cb_if', { message0: 'if %1 then %2 %3', args0: [{ type: 'input_value', name: 'C', check: BOOL }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], ...stmt, colour: HUES.control },
  (b, cx) => `if (${b.bool('C')}) {\n${cx.indent(b.stmts('DO'))}\n}`);
def('cb_ifelse', { message0: 'if %1 then %2 %3 otherwise %4 %5', args0: [{ type: 'input_value', name: 'C', check: BOOL }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'ELSE' }], ...stmt, colour: HUES.control },
  (b, cx) => `if (${b.bool('C')}) {\n${cx.indent(b.stmts('DO'))}\n} else {\n${cx.indent(b.stmts('ELSE'))}\n}`);

/* ───────────────────────── logic ───────────────────────── */
def('cb_bool', { message0: '%1', args0: [{ type: 'field_dropdown', name: 'V', options: [['true', 'true'], ['false', 'false']] }], output: BOOL, colour: HUES.logic }, b => [b.field('V') === 'false' ? 'false' : 'true', BOOL]);
const CMP = { '<': '<', '>': '>', '=': '==', '≠': '!=', '≤': '<=', '≥': '>=' };
def('cb_compare', { message0: '%1 %2 %3', args0: [{ type: 'input_value', name: 'A', check: NUM }, { type: 'field_dropdown', name: 'OP', options: Object.keys(CMP).map(k => [k, k]) }, { type: 'input_value', name: 'B', check: NUM }], output: BOOL, inputsInline: true, colour: HUES.logic },
  b => [`(${b.num('A')} ${CMP[b.field('OP')] || '=='} ${b.num('B')})`, BOOL]);
def('cb_andor', { message0: '%1 %2 %3', args0: [{ type: 'input_value', name: 'A', check: BOOL }, { type: 'field_dropdown', name: 'OP', options: [['and', '&&'], ['or', '||']] }, { type: 'input_value', name: 'B', check: BOOL }], output: BOOL, inputsInline: true, colour: HUES.logic },
  b => [`(${b.bool('A')} ${b.field('OP') === '||' ? '||' : '&&'} ${b.bool('B')})`, BOOL]);
def('cb_not', { message0: 'not %1', args0: [{ type: 'input_value', name: 'A', check: BOOL }], output: BOOL, colour: HUES.logic }, b => [`(!${b.bool('A')})`, BOOL]);

/* ───────────────────────── numbers ───────────────────────── */
def('cb_number', { message0: '%1', args0: [{ type: 'field_number', name: 'NUM', value: 0 }], output: NUM, colour: HUES.math }, b => [String(Number.isFinite(+b.field('NUM')) ? +b.field('NUM') : 0), NUM]);
const ARITH = { '+': '+', '−': '-', '×': '*', '÷': '/' };
def('cb_arith', { message0: '%1 %2 %3', args0: [{ type: 'input_value', name: 'A', check: NUM }, { type: 'field_dropdown', name: 'OP', options: [['+', '+'], ['−', '−'], ['×', '×'], ['÷', '÷'], ['remainder', '%']] }, { type: 'input_value', name: 'B', check: NUM }], output: NUM, inputsInline: true, colour: HUES.math },
  b => { const op = b.field('OP'); return [op === '%' ? `fmod(${b.num('A')}, ${b.num('B', 1)})` : `(${b.num('A')} ${ARITH[op] || '+'} ${b.num('B', op === '÷' ? 1 : 0)})`, NUM]; });
def('cb_random', { message0: 'random number from %1 to %2', args0: [{ type: 'input_value', name: 'A', check: NUM }, { type: 'input_value', name: 'B', check: NUM }], output: NUM, inputsInline: true, colour: HUES.math },
  (b, cx) => { cx.setup('randomSeed(analogRead(A5) + millis());'); return [`((float)random((long)(${b.num('A')}), (long)(${b.num('B', 10)}) + 1))`, NUM]; });
def('cb_map', { message0: 'convert %1 from %2 – %3 to %4 – %5', args0: [{ type: 'input_value', name: 'X', check: NUM }, { type: 'input_value', name: 'A', check: NUM }, { type: 'input_value', name: 'B', check: NUM }, { type: 'input_value', name: 'C', check: NUM }, { type: 'input_value', name: 'D', check: NUM }], output: NUM, inputsInline: true, colour: HUES.math, tooltip: 'Squeeze a number from one range into another, e.g. a knob 0–100 into brightness 0–255.' },
  (b, cx) => { cx.helper('cb_map', 'float cb_map(float x, float a, float b, float c, float d) {\n  if (a == b) return c;\n  return (x - a) * (d - c) / (b - a) + c;\n}'); return [`cb_map(${b.num('X')}, ${b.num('A')}, ${b.num('B', 100)}, ${b.num('C')}, ${b.num('D', 255)})`, NUM]; });
def('cb_round', { message0: '%1 %2', args0: [{ type: 'field_dropdown', name: 'OP', options: [['round', 'round'], ['round down', 'floor'], ['round up', 'ceil'], ['absolute value of', 'fabs']] }, { type: 'input_value', name: 'X', check: NUM }], output: NUM, inputsInline: true, colour: HUES.math },
  b => [`${['round', 'floor', 'ceil', 'fabs'].includes(b.field('OP')) ? b.field('OP') : 'round'}(${b.num('X')})`, NUM]);
def('cb_seconds', { message0: 'seconds since the program started', output: NUM, colour: HUES.math }, () => ['(millis() / 1000.0)', NUM]);

/* ───────────────────────── variables (Blockly's own blocks; every variable is a number) ───────────────────────── */
BLOCKS.variables_get = { json: null, gen: (b, cx) => [cx.varName(b.varId('VAR')), NUM] };
BLOCKS.variables_set = { json: null, gen: (b, cx) => `${cx.varName(b.varId('VAR'))} = ${b.num('VALUE')};` };
BLOCKS.math_change = { json: null, gen: (b, cx) => `${cx.varName(b.varId('VAR'))} += ${b.num('DELTA', 1)};` };

/* ───────────────────────── words ───────────────────────── */
def('cb_text', { message0: '“%1”', args0: [{ type: 'field_input', name: 'TEXT', text: 'hello' }], output: TXT, colour: HUES.say }, b => [`String("${String(b.field('TEXT') ?? '').replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7e]/g, '?')}")`, TXT]);
def('cb_join', { message0: 'join %1 %2', args0: [{ type: 'input_value', name: 'A' }, { type: 'input_value', name: 'B' }], output: TXT, inputsInline: true, colour: HUES.say },
  b => [`(String(${b.any('A')}) + String(${b.any('B')}))`, TXT]);
def('cb_say', { message0: 'say %1', args0: [{ type: 'input_value', name: 'X' }], ...stmt, colour: HUES.say, tooltip: 'Show something in the Serial Monitor (open it from the Code tab).' },
  b => `Serial.println(${b.any('X', '""')});`);

/* ───────────────────────── lights ───────────────────────── */
const pinMode = (cx, pin, mode) => cx.pinMode(pin, mode);
def('led_set', { message0: 'turn %1 %2', args0: [dev('led'), { type: 'field_dropdown', name: 'S', options: ON_OFF }], ...stmt, colour: HUES.light },
  (b, cx) => { const d = b.device(); const p = d?.pins.out; if (!p) return b.skip(d, 'light'); pinMode(cx, p, 'OUTPUT'); const high = (b.field('S') === 'ON') !== !!d.activeLow; return `digitalWrite(${p.name}, ${high ? 'HIGH' : 'LOW'});`; }, 'led');
def('led_bright', { message0: 'set %1 brightness to %2 %%', args0: [dev('led'), { type: 'input_value', name: 'V', check: NUM }], ...stmt, inputsInline: true, colour: HUES.light, tooltip: '0 is off, 100 is full. Only some pins can dim (marked ~ on the board).' },
  (b, cx) => {
    const d = b.device(); const p = d?.pins.out; if (!p) return b.skip(d, 'light'); pinMode(cx, p, 'OUTPUT');
    const v = `constrain((${b.num('V', 100)}) * 2.55, 0, 255)`, val = d.activeLow ? `255 - ${v}` : v;
    if (p.pwm) return `analogWrite(${p.name}, (int)(${val}));`;
    b.warn(`${pinLabel(p)} cannot dim a light (only pins marked ~ can), so ${d.label} just goes on or off`);
    return `digitalWrite(${p.name}, (${v}) >= 128 ? ${d.activeLow ? 'LOW' : 'HIGH'} : ${d.activeLow ? 'HIGH' : 'LOW'});`;
  }, 'led');
def('rgb_set', { message0: 'set %1 colour: red %2 green %3 blue %4', args0: [dev('rgb'), { type: 'input_value', name: 'R', check: NUM }, { type: 'input_value', name: 'G', check: NUM }, { type: 'input_value', name: 'B', check: NUM }], ...stmt, inputsInline: true, colour: HUES.light, tooltip: 'Each colour goes from 0 (off) to 255 (full).' },
  (b, cx) => {
    const d = b.device(); if (!d || !['R', 'G', 'B'].some(c => d.pins[c])) return b.skip(d, 'RGB light');
    const out = [];
    for (const [c, name] of [['R', 'red'], ['G', 'green'], ['B', 'blue']]) {
      const p = d.pins[c]; if (!p) { b.warn(`${d.label}'s ${name} leg is not connected, so ${name} is skipped`); continue; }
      pinMode(cx, p, 'OUTPUT'); const v = `constrain(${b.num(c)}, 0, 255)`;
      if (p.pwm) out.push(`analogWrite(${p.name}, (int)(${v}));`);
      else { b.warn(`${pinLabel(p)} cannot fade the ${name} (only pins marked ~ can), so it is just on or off`); out.push(`digitalWrite(${p.name}, (${v}) >= 128 ? HIGH : LOW);`); }
    }
    return out.join('\n');
  }, 'rgb');

/* ───────────────────────── inputs ───────────────────────── */
def('button_down', { message0: 'is %1 pressed?', args0: [dev('button')], output: BOOL, colour: HUES.input },
  (b, cx) => { const d = b.device(); const p = d?.pins.in; if (!p) return b.skipValue(d, 'button', 'false', BOOL); pinMode(cx, p, d.mode); return [`(digitalRead(${p.name}) == ${d.pressedHigh ? 'HIGH' : 'LOW'})`, BOOL]; }, 'button');
def('switch_on', { message0: 'is %1 switched on?', args0: [dev('switch')], output: BOOL, colour: HUES.input },
  (b, cx) => { const d = b.device(); const p = d?.pins.in; if (!p) return b.skipValue(d, 'switch', 'false', BOOL); pinMode(cx, p, d.mode); return [`(digitalRead(${p.name}) == ${d.onHigh ? 'HIGH' : 'LOW'})`, BOOL]; }, 'switch');
def('pot_value', { message0: '%1 value (0–100)', args0: [dev('pot')], output: NUM, colour: HUES.input, tooltip: 'Turn the knob: 0 at one end, 100 at the other.' },
  (b, cx) => { const d = b.device(); const p = d?.pins.sig; if (!p || !p.analog) return b.skipValue(d, 'knob', '0', NUM); pinMode(cx, p, 'INPUT'); return [`(analogRead(${p.name}) * 100.0 / 1023.0)`, NUM]; }, 'pot');
def('ldr_bright', { message0: 'brightness at %1 (0–100)', args0: [dev('ldr')], output: NUM, colour: HUES.sensor, tooltip: '0 is dark, 100 is very bright.' },
  (b, cx) => { const d = b.device(); if (!d) return b.skipValue(d, 'light sensor', '0', NUM);
    if (d.pins.ao?.analog) { pinMode(cx, d.pins.ao, 'INPUT'); return [`(100.0 - analogRead(${d.pins.ao.name}) * 100.0 / 1023.0)`, NUM]; }
    if (d.pins.do) { pinMode(cx, d.pins.do, 'INPUT'); return [`(digitalRead(${d.pins.do.name}) == HIGH ? 0.0 : 100.0)`, NUM]; }
    return b.skipValue(d, 'light sensor', '0', NUM); }, 'ldr');
def('ntc_temp', { message0: 'temperature at %1 (°C)', args0: [dev('ntc')], output: NUM, colour: HUES.sensor },
  (b, cx) => { const d = b.device(); const p = d?.pins.out; if (!p || !p.analog) return b.skipValue(d, 'temperature sensor', '0', NUM); pinMode(cx, p, 'INPUT');
    cx.helper('cb_ntc', 'float cb_ntc(int pin) {            // NTC thermistor module: 10 kΩ at 25 °C, beta 3950\n  float a = analogRead(pin);\n  if (a < 1) a = 1;\n  if (a > 1022) a = 1022;\n  float r = 10000.0 * a / (1023.0 - a);\n  return 1.0 / (log(r / 10000.0) / 3950.0 + 1.0 / 298.15) - 273.15;\n}');
    return [`cb_ntc(${p.name})`, NUM]; }, 'ntc');
def('pir_motion', { message0: 'does %1 see movement?', args0: [dev('pir')], output: BOOL, colour: HUES.sensor },
  (b, cx) => { const d = b.device(); const p = d?.pins.out; if (!p) return b.skipValue(d, 'motion sensor', 'false', BOOL); pinMode(cx, p, 'INPUT'); return [`(digitalRead(${p.name}) == HIGH)`, BOOL]; }, 'pir');
def('dht_read', { message0: '%1 of %2', args0: [{ type: 'field_dropdown', name: 'W', options: [['temperature (°C)', 'T'], ['humidity (%)', 'H']] }, dev('dht')], output: NUM, colour: HUES.sensor },
  (b, cx) => { const d = b.device(); const p = d?.pins.data; if (!d || !p) return b.skipValue(d, 'humidity sensor', '0', NUM);
    const v = cx.name('dht', d.id); cx.include('DHT.h'); cx.global(`DHT ${v}(${p.name}, ${d.model});`); cx.setup(`${v}.begin();`, 'init');
    cx.helper('cb_num', 'float cb_num(float v) { return isnan(v) ? 0 : v; }');
    return [`cb_num(${v}.${b.field('W') === 'H' ? 'readHumidity' : 'readTemperature'}())`, NUM]; }, 'dht');
def('mpu_tilt', { message0: '%1 of %2', args0: [{ type: 'field_dropdown', name: 'W', options: [['roll (°)', 'roll'], ['pitch (°)', 'pitch']] }, dev('mpu')], output: NUM, colour: HUES.sensor, tooltip: 'How far the sensor leans, in degrees. Right-click it on the bench to tilt it.' },
  (b, cx) => { const d = b.device(); if (!d || !d.i2c) return b.skipValue(d, 'tilt sensor', '0', NUM);
    cx.include('Wire.h'); const a = `0x${d.address.toString(16)}`;
    cx.setup('Wire.begin();', 'bus'); cx.setup(`Wire.beginTransmission(${a});\nWire.write(0x6B);\nWire.write(0);\nWire.endTransmission();`, 'init');
    cx.helper('cb_tilt', `float cb_tilt(int addr, bool wantRoll) {          // MPU-6050: read the three acceleration values\n  Wire.beginTransmission(addr);\n  Wire.write(0x3B);\n  Wire.endTransmission(false);\n  Wire.requestFrom(addr, 6);\n  int16_t ax = Wire.read() << 8 | Wire.read();\n  int16_t ay = Wire.read() << 8 | Wire.read();\n  int16_t az = Wire.read() << 8 | Wire.read();\n  if (wantRoll) return atan2((float)ay, (float)az) * 180.0 / PI;\n  return atan2(-(float)ax, sqrt((float)ay * ay + (float)az * az)) * 180.0 / PI;\n}`);
    return [`cb_tilt(${a}, ${b.field('W') === 'pitch' ? 'false' : 'true'})`, NUM]; }, 'mpu');

/* ───────────────────────── screens ───────────────────────── */
def('oled_text', { message0: 'show %1 on %2 line %3', args0: [{ type: 'input_value', name: 'X' }, dev('oled'), { type: 'field_dropdown', name: 'L', options: [['1', '0'], ['2', '1'], ['3', '2'], ['4', '3']] }], ...stmt, inputsInline: true, colour: HUES.screen },
  (b, cx) => { const d = b.device(); if (!d || !d.i2c) return b.skip(d, 'screen');
    cx.include('Wire.h'); cx.setup('Wire.begin();', 'bus'); cx.include('Adafruit_GFX.h'); cx.include('Adafruit_SSD1306.h'); cx.global('Adafruit_SSD1306 cb_oled(128, 64, &Wire, -1);');
    cx.setup('if (!cb_oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) { Serial.println(F("OLED not found")); while (true) {} }\ncb_oled.setTextColor(SSD1306_WHITE);\ncb_oled.clearDisplay();\ncb_oled.display();', 'init');
    cx.helper('cb_oled_line', 'void cb_oled_line(int line, String s) {          // 4 big lines of text\n  cb_oled.fillRect(0, line * 16, 128, 16, SSD1306_BLACK);\n  cb_oled.setTextSize(2);\n  cb_oled.setCursor(0, line * 16);\n  cb_oled.print(s);\n  cb_oled.display();\n}');
    return `cb_oled_line(${+b.field('L') || 0}, String(${b.any('X', '""')}));`; }, 'oled');
def('oled_clear', { message0: 'clear %1', args0: [dev('oled')], ...stmt, colour: HUES.screen },
  (b, cx) => { const d = b.device(); if (!d || !d.i2c) return b.skip(d, 'screen');
    cx.include('Wire.h'); cx.setup('Wire.begin();', 'bus'); cx.include('Adafruit_GFX.h'); cx.include('Adafruit_SSD1306.h'); cx.global('Adafruit_SSD1306 cb_oled(128, 64, &Wire, -1);');
    cx.setup('if (!cb_oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) { Serial.println(F("OLED not found")); while (true) {} }\ncb_oled.setTextColor(SSD1306_WHITE);\ncb_oled.clearDisplay();\ncb_oled.display();', 'init');
    return 'cb_oled.clearDisplay();\ncb_oled.display();'; }, 'oled');
def('lcd_text', { message0: 'show %1 on %2 row %3 from column %4', args0: [{ type: 'input_value', name: 'X' }, dev('lcd'), { type: 'field_dropdown', name: 'R', options: [['1', '0'], ['2', '1']] }, { type: 'field_number', name: 'C', value: 1, min: 1, max: 16, precision: 1 }], ...stmt, inputsInline: true, colour: HUES.screen },
  (b, cx) => { const d = b.device(); if (!d || !d.i2c) return b.skip(d, 'screen');
    cx.include('Wire.h'); cx.setup('Wire.begin();', 'bus'); cx.include('LiquidCrystal_I2C.h'); cx.global('LiquidCrystal_I2C cb_lcd(0x27, 16, 2);'); cx.setup('cb_lcd.init();\ncb_lcd.backlight();', 'init');
    cx.helper('cb_lcd_print', 'void cb_lcd_print(int col, int row, String s) {          // writes s, then blanks the rest of the row\n  cb_lcd.setCursor(col, row);\n  cb_lcd.print(s);\n  for (int i = col + s.length(); i < 16; i++) cb_lcd.print(" ");\n}');
    return `cb_lcd_print(${Math.min(15, Math.max(0, (+b.field('C') || 1) - 1))}, ${+b.field('R') || 0}, String(${b.any('X', '""')}));`; }, 'lcd');
def('lcd_clear', { message0: 'clear %1', args0: [dev('lcd')], ...stmt, colour: HUES.screen },
  (b, cx) => { const d = b.device(); if (!d || !d.i2c) return b.skip(d, 'screen');
    cx.include('Wire.h'); cx.setup('Wire.begin();', 'bus'); cx.include('LiquidCrystal_I2C.h'); cx.global('LiquidCrystal_I2C cb_lcd(0x27, 16, 2);'); cx.setup('cb_lcd.init();\ncb_lcd.backlight();', 'init'); return 'cb_lcd.clear();'; }, 'lcd');
const SEG = { 0: 'ABCDEF', 1: 'BC', 2: 'ABGED', 3: 'ABGCD', 4: 'FGBC', 5: 'AFGCD', 6: 'AFGEDC', 7: 'ABC', 8: 'ABCDEFG', 9: 'ABCDFG' };
def('seg_digit', { message0: 'show digit %1 on %2', args0: [{ type: 'input_value', name: 'N', check: NUM }, dev('seg')], ...stmt, inputsInline: true, colour: HUES.screen, tooltip: 'Shows 0 to 9.' },
  (b, cx) => { const d = b.device(); if (!d) return b.skip(d, 'digit display'); const segs = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'].filter(s => d.pins[s]); if (!segs.length) return b.skip(d, 'digit display');
    const fn = `cb_digit_${cx.name('seg', d.id).replace(/^seg_/, '')}`; const pins = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(s => d.pins[s]?.name ?? -1);
    for (const s of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) if (d.pins[s]) pinMode(cx, d.pins[s], 'OUTPUT');
    const masks = Object.values(SEG).map(g => `0b${['G', 'F', 'E', 'D', 'C', 'B', 'A'].map(s => (g.includes(s) ? 1 : 0)).join('')}`);
    cx.helper(fn, `void ${fn}(int n) {          // pins for segments A B C D E F G (-1 = not wired)\n  const int pins[7] = {${pins.map(p => (/^A\d/.test(String(p)) ? p : p)).join(', ')}};\n  const byte masks[10] = {${masks.join(', ')}};\n  for (int s = 0; s < 7; s++) if (pins[s] >= 0) digitalWrite(pins[s], (n >= 0 && n <= 9 && (masks[n] >> s) & 1) ? HIGH : LOW);\n}`);
    return `${fn}((int)(${b.num('N')}));`; }, 'seg');
def('seg_off', { message0: 'switch off %1', args0: [dev('seg')], ...stmt, colour: HUES.screen },
  (b, cx) => { const d = b.device(); if (!d) return b.skip(d, 'digit display'); const out = []; for (const s of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP']) if (d.pins[s]) { pinMode(cx, d.pins[s], 'OUTPUT'); out.push(`digitalWrite(${d.pins[s].name}, LOW);`); } return out.join('\n') || b.skip(d, 'digit display'); }, 'seg');

/* ───────────────────────── motors ───────────────────────── */
def('motor_run', { message0: 'run %1 %2 at speed %3 %%', args0: [dev('driver'), { type: 'field_dropdown', name: 'DIR', options: [['forwards', 'F'], ['backwards', 'B']] }, { type: 'input_value', name: 'V', check: NUM }], ...stmt, inputsInline: true, colour: HUES.motor, tooltip: 'Speed 0 to 100.' },
  (b, cx) => { const d = b.device(); if (!d || !d.pins.in1 || !d.pins.in2) return b.skip(d, 'motor driver');
    pinMode(cx, d.pins.in1, 'OUTPUT'); pinMode(cx, d.pins.in2, 'OUTPUT'); const fw = b.field('DIR') !== 'B', out = [`digitalWrite(${d.pins.in1.name}, ${fw ? 'HIGH' : 'LOW'});`, `digitalWrite(${d.pins.in2.name}, ${fw ? 'LOW' : 'HIGH'});`];
    if (d.pins.en) { pinMode(cx, d.pins.en, 'OUTPUT'); if (d.pins.en.pwm) out.push(`analogWrite(${d.pins.en.name}, (int)constrain((${b.num('V', 100)}) * 2.55, 0, 255));`); else { b.warn(`${pinLabel(d.pins.en)} cannot set speed (only pins marked ~ can), so the motor is just on or off`); out.push(`digitalWrite(${d.pins.en.name}, (${b.num('V', 100)}) > 0 ? HIGH : LOW);`); } }
    else b.warn(`${d.label} has nothing wired to its enable pin, so it always runs at full speed`);
    return out.join('\n'); }, 'driver');
def('motor_stop', { message0: 'stop %1', args0: [dev('driver')], ...stmt, colour: HUES.motor },
  (b, cx) => { const d = b.device(); if (!d || !d.pins.in1 || !d.pins.in2) return b.skip(d, 'motor driver'); pinMode(cx, d.pins.in1, 'OUTPUT'); pinMode(cx, d.pins.in2, 'OUTPUT');
    const out = [`digitalWrite(${d.pins.in1.name}, LOW);`, `digitalWrite(${d.pins.in2.name}, LOW);`]; if (d.pins.en) { pinMode(cx, d.pins.en, 'OUTPUT'); out.push(`digitalWrite(${d.pins.en.name}, LOW);`); } return out.join('\n'); }, 'driver');

/* ───────────────────────── any other part, and any pin ───────────────────────── */
def('pin_set', { message0: 'set %1 to %2', args0: [dev('pin'), { type: 'field_dropdown', name: 'S', options: [['HIGH (on)', 'HIGH'], ['LOW (off)', 'LOW']] }], ...stmt, colour: HUES.pin, tooltip: 'Any part that is wired to a board pin.' },
  (b, cx) => { const d = b.device(); const p = d?.pins.pin; if (!p) return b.skip(d, 'part'); pinMode(cx, p, 'OUTPUT'); return `digitalWrite(${p.name}, ${b.field('S') === 'LOW' ? 'LOW' : 'HIGH'});`; }, 'pin');
def('pin_read', { message0: 'is %1 HIGH?', args0: [dev('pin')], output: BOOL, colour: HUES.pin },
  (b, cx) => { const d = b.device(); const p = d?.pins.pin; if (!p) return b.skipValue(d, 'part', 'false', BOOL); pinMode(cx, p, 'INPUT'); return [`(digitalRead(${p.name}) == HIGH)`, BOOL]; }, 'pin');
def('pin_analog', { message0: 'analog value of %1 (0–1023)', args0: [dev('pin')], output: NUM, colour: HUES.pin },
  (b, cx) => { const d = b.device(); const p = d?.pins.pin; if (!p || !p.analog) return b.skipValue(d, 'part (it needs an analog pin A0–A5)', '0', NUM); pinMode(cx, p, 'INPUT'); return [`analogRead(${p.name})`, NUM]; }, 'pin');
def('pin_pwm', { message0: 'set %1 to %2 (0–255)', args0: [dev('pin'), { type: 'input_value', name: 'V', check: NUM }], ...stmt, inputsInline: true, colour: HUES.pin },
  (b, cx) => { const d = b.device(); const p = d?.pins.pin; if (!p) return b.skip(d, 'part'); pinMode(cx, p, 'OUTPUT'); if (!p.pwm) { b.warn(`${pinLabel(p)} cannot fade (only pins marked ~ can), so it is just on or off`); return `digitalWrite(${p.name}, (${b.num('V')}) >= 128 ? HIGH : LOW);`; } return `analogWrite(${p.name}, (int)constrain(${b.num('V')}, 0, 255));`; }, 'pin');
const anyPin = b => { const n = String(b.field('PIN') || ''); return /^(A\d{1,2}|\d{1,2})$/.test(n) ? n : null; };
const PINOPT = { type: 'input_dummy', name: 'PINSLOT', _pin: true };                       // the editor puts a dropdown of the board's pins here (field PIN)
def('anypin_set', { message0: 'set pin %1 to %2', args0: [{ ...PINOPT }, { type: 'field_dropdown', name: 'S', options: [['HIGH (on)', 'HIGH'], ['LOW (off)', 'LOW']] }], ...stmt, colour: HUES.pin },
  (b, cx) => { const n = anyPin(b); if (!n) return ''; pinMode(cx, { name: n }, 'OUTPUT'); return `digitalWrite(${n}, ${b.field('S') === 'LOW' ? 'LOW' : 'HIGH'});`; });
def('anypin_pwm', { message0: 'set pin %1 to %2 (0–255)', args0: [{ ...PINOPT }, { type: 'input_value', name: 'V', check: NUM }], ...stmt, inputsInline: true, colour: HUES.pin },
  (b, cx) => { const n = anyPin(b); if (!n) return ''; pinMode(cx, { name: n }, 'OUTPUT'); return `analogWrite(${n}, (int)constrain(${b.num('V')}, 0, 255));`; });
def('anypin_read', { message0: 'is pin %1 HIGH?', args0: [{ ...PINOPT }], output: BOOL, colour: HUES.pin },
  (b, cx) => { const n = anyPin(b); if (!n) return ['false', BOOL]; pinMode(cx, { name: n }, 'INPUT_PULLUP'); return [`(digitalRead(${n}) == HIGH)`, BOOL]; });
def('anypin_analog', { message0: 'analog value of pin %1 (0–1023)', args0: [{ ...PINOPT }], output: NUM, colour: HUES.pin },
  (b, cx) => { const n = anyPin(b); if (!n) return ['0', NUM]; pinMode(cx, { name: n }, 'INPUT'); return [`analogRead(${n})`, NUM]; });

/* ───────────────────────── generating a sketch ───────────────────────── */
const ident = s => { const t = String(s || 'x').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase(); return t || 'x'; };
const RESERVED = new Set(['int', 'float', 'void', 'if', 'else', 'for', 'while', 'do', 'return', 'byte', 'char', 'long', 'bool', 'true', 'false', 'delay', 'loop', 'setup', 'pin', 'high', 'low', 'input', 'output', 'serial', 'string', 'millis', 'random', 'abs', 'min', 'max', 'map', 'round', 'log', 'sin', 'cos', 'tan']);

/**
 * @param {object} program Blockly's saved workspace: { blocks: { blocks: [...] }, variables: [{ id, name }] }
 * @param {object} bench   describeBench(...) result
 * @returns {{ code: string, warnings: {block: string|null, text: string}[], empty: boolean }}
 */
/** An empty block workspace stands for "no program yet". It may replace code the blocks wrote themselves (Clear), but never a sketch they did not write: the starter Blink, or code typed in Code mode. */
export const GENERATED_HEADER = '// Made with blocks';
export const emptyMayReplace = (source, force) => !!force && (!String(source || '').trim() || String(source).startsWith(GENERATED_HEADER));

export function generateSketch(program, bench) {
  const devices = new Map((bench?.devices || []).map(d => [d.id, d]));
  const varNames = new Map(), varUsed = new Set(), globals = [], includes = new Set(), helpers = new Map(), pins = new Map(), initLines = [], setupLines = [], busLines = [], warnings = [];
  const names = new Map(), counters = {};
  let currentBlock = null;
  const warn = text => { if (!warnings.some(w => w.text === text && w.block === currentBlock)) warnings.push({ block: currentBlock, text }); };
  for (const v of program?.variables || []) { let n = `v_${ident(v.name)}`; while (varUsed.has(n) || RESERVED.has(n)) n += '_'; varUsed.add(n); varNames.set(v.id, n); }
  const varsSeen = new Set();

  const cx = {
    indent: s => String(s).split('\n').map(l => (l ? `  ${l}` : l)).join('\n'),
    tmp: p => { counters[p] = (counters[p] || 0) + 1; return `${p}${counters[p]}`; },
    name: (p, id) => { const k = `${p}:${id}`; if (!names.has(k)) names.set(k, `${p}_${ident(id)}`); return names.get(k); },
    include: h => includes.add(h),
    global: line => { if (!globals.includes(line)) globals.push(line); },
    helper: (n, code) => { if (!helpers.has(n)) helpers.set(n, code); },
    setup: (line, where) => { const list = where === 'bus' ? busLines : where === 'init' ? initLines : setupLines; if (!list.includes(line)) list.push(line); },
    pinMode: (pin, mode) => { const cur = pins.get(pin.name); if (!cur || mode === 'OUTPUT' || (mode === 'INPUT_PULLUP' && cur === 'INPUT')) pins.set(pin.name, mode); },
    varName: id => { const n = varNames.get(id) || `v_${ident(id)}`; varsSeen.add(n); return n; },
  };

  const child = blk => blk?.block || blk?.shadow || null;
  const run = block => BLOCKS[block.type]?.gen(api(block), cx);
  const exprOf = (block, fallback, want) => {
    if (!block) return { c: fallback, t: want };
    const prev = currentBlock; currentBlock = block.id || null;
    let r; try { r = run(block); } finally { currentBlock = prev; }
    if (r === undefined || r === null) { warn(`The block "${block.type}" is not known here`); return { c: fallback, t: want }; }
    return Array.isArray(r) ? { c: r[0], t: r[1] } : { c: String(r), t: want };
  };
  const api = block => {
    const fields = block.fields || {};
    const dev = () => { const id = fields.DEV; const d = devices.get(id); if (!d) warn(id ? 'That part is no longer on the bench — pick another one in the block.' : 'There is no part on the bench for this block yet — add one and wire it to the board.'); return d || null; };
    const b = {
      field: n => fields[n],
      varId: n => (typeof fields[n] === 'object' ? fields[n]?.id : fields[n]),
      device: dev,
      warn,
      skip: (d, what) => { if (d) { warn(d.warn.length ? `${d.label} ${d.warn[0]}` : `${d.label} is not wired to a board pin yet`); return `// ${d.label} is not wired yet`; } return `// no ${what} on the bench`; },
      skipValue: (d, what, v, t) => { if (d) warn(d.warn.length ? `${d.label} ${d.warn[0]}` : `${d.label} is not wired to a board pin yet`); return [v, t]; },
      num: (n, d = 0) => { const e = exprOf(child(block.inputs?.[n]), String(d), NUM); return e.t === BOOL ? `(${e.c} ? 1 : 0)` : e.c; },
      bool: (n, d = 'false') => { const e = exprOf(child(block.inputs?.[n]), d, BOOL); return e.t === NUM ? `((${e.c}) != 0)` : e.c; },
      any: (n, d = '0') => exprOf(child(block.inputs?.[n]), d, NUM).c,
      stmts: n => walk(block.inputs?.[n]?.block),
    };
    return b;
  };
  const walk = first => {
    const out = [];
    for (let blk = first; blk; blk = blk.next?.block) {
      if (!BLOCKS[blk.type]) { warn(`The block "${blk.type}" is not known here`); continue; }
      const prev = currentBlock; currentBlock = blk.id || null;
      let r; try { r = run(blk); } finally { currentBlock = prev; }
      if (typeof r === 'string' && r) out.push(r);
    }
    return out.join('\n');
  };

  const tops = (program?.blocks?.blocks || []).slice().sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
  const setupBody = [], loopBody = []; let any = false;
  for (const t of tops) {
    if (t.type === 'cb_setup') { setupBody.push(walk(t.inputs?.DO?.block)); any = true; }
    else if (t.type === 'cb_loop') { loopBody.push(walk(t.inputs?.DO?.block)); any = true; }
    else { const prev = currentBlock; currentBlock = t.id || null; warn('This block is on its own, so it never runs. Put it inside "forever" or "when the program starts".'); currentBlock = prev; }
  }

  const lines = [GENERATED_HEADER + ' — change the blocks and this code updates.'];
  for (const h of [...includes].sort()) lines.push(`#include <${h}>`);
  if (includes.size) lines.push('');
  for (const g of globals) lines.push(g);
  for (const v of [...varsSeen].sort()) lines.push(`float ${v} = 0;`);
  if (globals.length || varsSeen.size) lines.push('');
  for (const code of helpers.values()) lines.push(code, '');
  lines.push('void setup() {', '  Serial.begin(9600);');
  for (const l of busLines) lines.push(cx.indent(l));
  for (const l of initLines) lines.push(cx.indent(l));
  for (const l of setupLines) lines.push(cx.indent(l));
  for (const [pin, mode] of [...pins.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }))) lines.push(`  pinMode(${pin}, ${mode});`);
  for (const body of setupBody) if (body) lines.push(cx.indent(body));
  lines.push('}', '', 'void loop() {');
  for (const body of loopBody) if (body) lines.push(cx.indent(body));
  lines.push('}', '');
  return { code: lines.join('\n'), warnings, empty: !any };
}
