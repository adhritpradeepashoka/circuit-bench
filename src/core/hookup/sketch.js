// Builds one sketch out of the pieces every part of a circuit contributes (its #includes, globals, setup lines, what it reads,
// what it does), so "make an MPU and OLED circuit" gives ONE sketch where the OLED shows the MPU's numbers. Pure and DOM-free.
//
//   include(h)            #include <h>
//   global(line)          a declaration above setup()
//   setup(line)           inside setup()
//   sample(line)          every pass of loop() (cheap reads that actuators need right away, e.g. the knob position)
//   measure(line, ms)     inside the report tick: compute the numbers that are shown (ms = the slowest this may be asked for)
//   show(label, expr, d)  one number shown on Serial and on any LCD / OLED in the circuit (d = decimals)
//   tick(ms, lines)       something that happens every `ms` (a servo step, the next note…)
//   sink(kind, {...})     a screen: 'lcd' or 'oled'
// One timed block → plain delay(); several → millis()-gated blocks so they never wait for each other.

export class Sketch {
  constructor() {
    this.title = ''; this.wiring = []; this.includes = []; this.globals = []; this.setups = []; this.samples = []; this.measures = [];
    this.ticks = []; this.readouts = []; this.sinks = new Map(); this.reportMs = 0; this.ctl = null; this.names = new Set(); this.serialOn = false; this.baud = 9600;
  }
  uid(base) { let n = 1; const clean = base.replace(/[^A-Za-z0-9_]/g, ''); while (this.names.has(`${clean}${n}`)) n++; this.names.add(`${clean}${n}`); return `${clean}${n}`; }
  include(h) { if (!this.includes.includes(h)) this.includes.push(h); return this; }
  global(l) { if (!this.globals.includes(l)) this.globals.push(l); return this; }
  setup(l) { if (!this.setups.includes(l)) this.setups.push(l); return this; }
  sample(l) { this.samples.push(l); return this; }
  measure(l, ms = 250) { this.measures.push(l); this.reportMs = Math.max(this.reportMs, ms); return this; }
  show(label, expr, digits = null) { this.readouts.push({ label, expr, digits }); return this; }
  tick(ms, lines) { this.ticks.push({ ms, lines: [].concat(lines) }); return this; }
  sink(kind, def) { if (!this.sinks.has(kind)) this.sinks.set(kind, def); return this; }
  serial() { this.serialOn = true; return this; }

  render() {
    const out = [];
    const hasShow = this.readouts.length > 0 || this.sinks.size > 0;
    const readouts = this.readouts.length || !this.sinks.size ? this.readouts : [{ label: 'Uptime s', expr: 'millis() / 1000', digits: null }];
    const serial = this.serialOn || this.readouts.length > 0;
    const lines = [];
    if (this.title) lines.push(`// ${this.title}`);
    for (const w of this.wiring) lines.push(`// ${w}`);
    if (lines.length) out.push(lines.join('\n'));
    const inc = [...this.includes]; for (const s of this.sinks.values()) for (const i of s.includes || []) if (!inc.includes(i)) inc.push(i);
    if (inc.length) out.push(inc.map(i => `#include <${i}>`).join('\n'));
    const globals = [...this.globals]; for (const s of this.sinks.values()) for (const g of s.globals || []) if (!globals.includes(g)) globals.push(g);
    if (globals.length) out.push(globals.join('\n'));

    const setup = [...(serial ? [`Serial.begin(${this.baud});`] : []), ...this.setups];
    for (const s of this.sinks.values()) setup.push(...(s.setup || []));
    if (setup.some(l => /INPUT_PULLUP/.test(l))) setup.push('delay(50);                       // let the pull-ups settle before the first read');
    out.push(`void setup() {\n${setup.map(l => `  ${l}`).join('\n')}${setup.length ? '\n' : ''}}`);

    // the report tick: measure, then show
    const blocks = [];
    if (hasShow && (readouts.length || this.measures.length)) {
      const body = [...this.measures];
      if (serial) {
        readouts.forEach((r, i) => {
          body.push(`Serial.print("${r.label} ");`);
          body.push(`Serial.print(${r.expr}${r.digits === null ? '' : `, ${r.digits}`});`);
          body.push(i < readouts.length - 1 ? 'Serial.print("   ");' : 'Serial.println();');
        });
      }
      const lcd = this.sinks.get('lcd'), oled = this.sinks.get('oled');
      if (lcd) readouts.slice(0, 2).forEach((r, i) => body.push(`lcd.setCursor(0, ${i});`, `lcd.print("${r.label} ");`, `lcd.print(${r.expr}${r.digits === null ? '' : `, ${r.digits}`});`, 'lcd.print("        ");'));
      if (oled) {
        body.push('display.clearDisplay();', 'display.setTextSize(1);');
        readouts.slice(0, 4).forEach((r, i) => body.push(`display.setCursor(0, ${i * 16});`, `display.print(F("${r.label} "));`, `display.print(${r.expr}${r.digits === null ? '' : `, ${r.digits}`});`));
        body.push('display.display();');
      }
      blocks.push({ ms: Math.max(this.reportMs, 250), lines: body });
    }
    for (const t of this.ticks) blocks.push(t);

    const loop = [];
    if (blocks.length <= 1) {
      loop.push(...this.samples);
      if (blocks[0]) loop.push(...blocks[0].lines, `delay(${blocks[0].ms});`);
    } else {
      loop.push('unsigned long now = millis();', ...this.samples);
      blocks.forEach((b, i) => {
        const v = `next${i + 1}`;
        loop.push('', `static unsigned long ${v} = 0;`, `if (now >= ${v}) {`, `  ${v} = now + ${b.ms};`, ...b.lines.map(l => `  ${l}`), '}');
      });
    }
    out.push(`void loop() {\n${loop.map(l => (l ? `  ${l}` : '')).join('\n')}\n}`);
    return `${out.join('\n\n')}\n`;
  }
}
