// Rebuilds test/fixtures/xiao-*.hex from the sketches below, the same way the compile service does (ESP header + AVR build).
// Needs avr-gcc and the Arduino AVR core: node tools/build-xiao-fixtures.mjs /path/to/ArduinoCore-avr /path/to/Servo
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { espSource, espCompatHeader, ESP_HEADER_NAME } from '../src/core/esp-boards.js';
import { R4_COMPAT_H, R4_HEADER_NAME } from '../src/core/r4-compat.js';

const [core, servoLib] = process.argv.slice(2);
const SKETCHES = {
  'xiao-blink': 'void setup(){ pinMode(LED_BUILTIN, OUTPUT); } void loop(){ digitalWrite(LED_BUILTIN, LOW); delay(10); digitalWrite(LED_BUILTIN, HIGH); delay(10); }',
  'xiao-servo': '#include <ESP32Servo.h>\nServo arm;\nvoid setup(){ arm.setPeriodHertz(50); arm.attach(D8, 500, 2400); }\nvoid loop(){ int raw = analogRead(D0); arm.write(map(raw, 0, 4095, 0, 180)); delay(5); }',
  'xiao-pwm': 'void setup(){ ledcAttach(D9, 5000, 8); ledcWrite(D9, 64); } void loop(){}',
  'xiao-pins': 'void setup(){ pinMode(D1, OUTPUT); pinMode(D2, INPUT_PULLUP); pinMode(D6, OUTPUT); } void loop(){ digitalWrite(D1, digitalRead(D2)); digitalWrite(D6, !digitalRead(D2)); }',
};
const out = new URL('../test/fixtures/', import.meta.url).pathname;
const work = '/tmp/xiao-build'; mkdirSync(work, { recursive: true });
writeFileSync(join(work, R4_HEADER_NAME), R4_COMPAT_H);
writeFileSync(join(work, ESP_HEADER_NAME), espCompatHeader());
const flags = ['-Os', '-w', '-mmcu=atmega328p', '-DF_CPU=16000000L', '-DARDUINO=10819', '-DARDUINO_AVR_UNO', '-DARDUINO_ARCH_AVR', '-ffunction-sections', '-fdata-sections',
  `-I${core}/cores/arduino`, `-I${core}/variants/standard`, `-I${servoLib}/src`, `-I${work}`];
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
const objs = [];
const coreFiles = [...readdirSync(`${core}/cores/arduino`).filter(f => /\.(c|cpp|S)$/.test(f)).map(f => `${core}/cores/arduino/${f}`), `${servoLib}/src/avr/Servo.cpp`];
for (const f of coreFiles) { const o = join(work, f.replace(/\W/g, '_') + '.o'); run(f.endsWith('.c') ? 'avr-gcc' : 'avr-g++', [...flags, ...(f.endsWith('.S') ? ['-x', 'assembler-with-cpp'] : []), '-c', f, '-o', o]); objs.push(o); }
for (const [name, text] of Object.entries(SKETCHES)) {
  const src = join(work, name + '.cpp'); writeFileSync(src, '#include <Arduino.h>\n' + espSource(text));
  const o = join(work, name + '.o'); run('avr-g++', [...flags, '-c', src, '-o', o]);
  const elf = join(work, name + '.elf'); run('avr-gcc', ['-mmcu=atmega328p', '-Wl,--gc-sections', '-Os', '-o', elf, o, ...objs, '-lm']);
  run('avr-objcopy', ['-O', 'ihex', '-R', '.eeprom', elf, join(out, name + '.hex')]);
  console.log('built', name, readFileSync(join(out, name + '.hex'), 'utf8').length, 'bytes');
}
