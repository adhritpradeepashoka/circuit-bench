import { Mcu, CPU_HZ } from '../sim/mcu.js';
import { solveDrive } from '../core/solver.js';
import { PART_DEFS } from '../core/parts.js';
import { compileSketch } from '../sim/compile-client.js';
import { DEFAULT_SKETCH } from '../sim/examples.js';

const $ = id => document.getElementById(id);
const LED_FULL_A = 0.010;   // ≈ full brightness at 10 mA

/** Glue between the editor, the netlist, the DC solver and the avr8js CPU. */
export class Simulation {
  constructor(editor, code = null) {
    this.editor = editor;
    this.code = code || { compile: () => compileSketch(DEFAULT_SKETCH), setRunning() {}, open() {} };
    this.compiling = false;
    this.running = false; this.paused = false;
    this.mcu = null; this.result = null; this.lastSig = ''; this.raf = 0; this.last = 0;
    this.pressed = new Set();
    this.error = null;
    this.idleTimer = 0;

    $('runBtn').addEventListener('click', () => this.toggle());
    $('simPause').addEventListener('click', () => this.togglePause());
    $('simStop').addEventListener('click', () => this.stop());
    editor.on('toggle-run', () => this.toggle());
    editor.on('button', ({ partId, pressed }) => { pressed ? this.pressed.add(partId) : this.pressed.delete(partId); this.lastSig = ''; });
    editor.on('change', () => { this.lastSig = ''; if (!this.running) this.scheduleIdleRefresh(); });
    // Serial Monitor → the sketch's Serial input (returns true when delivered)
    this.code.serial?.onSend(text => { if (!this.running || !this.mcu) return false; this.mcu.serialWrite(text); return true; });
  }

  toggle() { return this.running ? this.stop() : this.start(); }

  setRunButton(state) {                       // 'idle' | 'compiling' | 'running'
    const btn = $('runBtn');
    btn.disabled = state === 'compiling';
    btn.classList.toggle('running', state === 'running');
    $('runIcon').textContent = state === 'running' ? '■' : state === 'compiling' ? '…' : '▶';
    $('runLabel').textContent = state === 'running' ? 'Stop' : state === 'compiling' ? 'Compiling' : 'Run';
  }

  /** Compile the sketch with Arduino CLI, then boot the resulting firmware on the simulated ATmega328P. */
  async start() {
    if (this.running || this.compiling) return;
    this.compiling = true; this.setRunButton('compiling');
    this.editor.status('Compiling with Arduino CLI…');
    let build = null;
    try { build = await this.code.compile(); }
    finally { this.compiling = false; this.setRunButton('idle'); }
    if (!build) return;                                          // superseded by a newer compile
    if (!build.ok) {
      this.code.open?.();
      const errors = (build.diagnostics || []).filter(d => d.severity === 'error');
      this.editor.status(build.unreachable ? build.error : errors.length ? `Compile failed — line ${errors[0].line}: ${errors[0].message}` : 'Compile failed — see the Output tab');
      if (errors.length) this.code.goToLine?.(errors[0].line);
      return;
    }
    try { this.mcu = new Mcu(build.hex); } catch (err) { this.fail(err); return; }
    const serial = this.code.serial;
    if (serial) {
      serial.clear(); serial.setBaud(0);
      this.mcu.onSerial = byte => serial.push(byte);
      this.mcu.usart.onConfigurationChange = () => serial.setBaud(Math.round(this.mcu.baud));
    }
    this.code.setRunning?.(true);
    this.running = true; this.paused = false; this.error = null; this.lastSig = ''; this.result = null;
    this.editor.setRunning(true);
    this.editor.probe = net => (this.result ? this.result.voltage(net) : null);
    this.last = performance.now();
    this.setRunButton('running');
    $('simPause').textContent = 'Pause';
    this.editor.status(`Running — real firmware (${build.size?.flash ?? '?'} bytes) on the simulated ATmega328P`);
    this.raf = requestAnimationFrame(t => this.frame(t));
    this.refreshTray();
  }

  stop() {
    if (!this.running) return;
    this.running = false; this.paused = false;
    cancelAnimationFrame(this.raf);
    for (const id of [...this.pressed]) this.editor.setButtonPressed(id, false);
    this.pressed.clear();
    this.editor.setRunning(false); this.editor.probe = null;
    this.mcu = null; this.result = null;
    this.code.setRunning?.(false);
    this.resetVisuals();
    this.setRunButton('idle');
    this.editor.status('Simulation stopped');
    this.refreshTray();
  }

  togglePause() {
    if (!this.running) return;
    this.paused = !this.paused; this.last = performance.now();
    $('simPause').textContent = this.paused ? 'Resume' : 'Pause';
    this.editor.status(this.paused ? 'Paused' : 'Resumed');
    this.refreshTray();
  }

  fail(err) {
    console.error(err);
    this.error = String(err?.message || err);
    this.editor.status(`Simulator failed to start: ${this.error}`);
    this.setRunButton('idle');
    this.refreshTray();
  }

  frame(ts) {
    if (!this.running) return;
    try {
      if (!this.paused) {
        const dt = Math.min(0.05, (ts - this.last) / 1000);
        this.mcu.run(dt * CPU_HZ);
        this.step();
      }
      this.last = ts;
      this.refreshTray();
    } catch (err) { this.running = true; this.stop(); this.fail(err); return; }
    this.raf = requestAnimationFrame(t => this.frame(t));
  }

  /** One electrical evaluation: firmware pin states → DC solve → inputs back into the MCU → visuals. */
  step() {
    const circuit = this.editor.getCircuit();
    const modes = new Map(), duty = new Map();
    for (const pin of circuit.uno.pins) {
      const d = /^\d+$/.test(pin.name) ? this.mcu.pwmDuty(Number(pin.name)) : null;       // analogWrite → average duty, not the fast waveform
      if (d !== null) { duty.set(pin.name, d); modes.set(pin.name, 'P'); } else modes.set(pin.name, this.mcu.pinMode(pin));
    }
    this.duty = duty;
    const sig = `${circuit.version}|${[...modes].join(',')}|${[...duty].map(([n, d]) => `${n}:${d.toFixed(3)}`).join(',')}|${[...this.pressed].join(',')}`;
    if (sig === this.lastSig && this.result) return;
    this.lastSig = sig;
    this.modes = modes;
    this.result = solveDrive(circuit, { pins: modes, pressed: this.pressed, duty });
    for (const pin of circuit.uno.pins) {
      const m = modes.get(pin.name);
      if (m === 'Z' || m === 'U') {
        const v = this.result.voltage(pin.net);
        this.mcu.setInput(pin, v == null ? m === 'U' : v > 2.5);
      }
    }
    for (let ch = 0; ch < 6; ch++) {                       // ADC: every analog pin sees the solved net voltage
      const pin = circuit.uno.pins.find(p => p.name === `A${ch}`);
      const v = pin ? this.result.voltage(pin.net) : null;
      this.mcu.setAnalog(ch, v == null ? 0 : v);
    }
    this.applyVisuals(circuit);
  }

  applyVisuals(circuit) {
    const { editor, result } = this;
    for (const part of editor.state.parts) {
      const root = editor.els.get(part.id);
      if (!root) continue;
      if (part.type === 'led') {
        const el = root.querySelector('wokwi-led'), i = result.ledCurrent.get(part.id) || 0, on = i > 5e-5;
        if (el.value !== on) el.value = on;
        const b = Math.min(1, i / LED_FULL_A);
        if (Math.abs((el.brightness ?? 1) - b) > 0.02) el.brightness = b;
      } else if (part.type === 'rgb-led') {
        const el = root.querySelector('wokwi-rgb-led');
        const level = ch => { const i = result.ledCurrent.get(`${part.id}:${ch}`) || 0; return i > 5e-5 ? Math.min(1, i / LED_FULL_A) : 0; };
        for (const [ch, prop] of [['R', 'ledRed'], ['G', 'ledGreen'], ['B', 'ledBlue']]) { const v = level(ch); if (Math.abs((el[prop] ?? 0) - v) > 0.02) el[prop] = v; }
      } else if (part.type === 'seven-segment') {
        const el = root.querySelector('wokwi-7segment');
        const values = PART_DEFS['seven-segment'].segments.map(s => ((result.ledCurrent.get(`${part.id}:${s}`) || 0) > 5e-5 ? 1 : 0));
        if (values.join() !== (el.values || []).join()) el.values = values;
      } else if (part.type === 'ldr-module') {
        const el = root.querySelector('wokwi-photoresistor-sensor'), m = result.modules?.get(part.id);
        if (el && m) { if (el.ledPower !== m.powered) el.ledPower = m.powered; if (el.ledDO !== m.out) el.ledDO = m.out; }
      } else if (part.type === 'arduino-uno') {
        const el = root.querySelector('wokwi-arduino-uno');
        if (!el.ledPower) el.ledPower = true;
        const l = this.modes?.get('13') === 'H';
        if (el.led13 !== l) el.led13 = l;
      }
    }
  }

  resetVisuals() {
    for (const part of this.editor.state.parts) {
      const root = this.editor.els.get(part.id);
      if (part.type === 'led') { const el = root?.querySelector('wokwi-led'); if (el) { el.value = false; el.brightness = 1; } }
      if (part.type === 'rgb-led') { const el = root?.querySelector('wokwi-rgb-led'); if (el) { el.ledRed = 0; el.ledGreen = 0; el.ledBlue = 0; } }
      if (part.type === 'seven-segment') { const el = root?.querySelector('wokwi-7segment'); if (el) el.values = [0, 0, 0, 0, 0, 0, 0, 0]; }
      if (part.type === 'ldr-module') { const el = root?.querySelector('wokwi-photoresistor-sensor'); if (el) { el.ledPower = false; el.ledDO = false; } }
      if (part.type === 'arduino-uno') { const el = root?.querySelector('wokwi-arduino-uno'); if (el) { el.ledPower = false; el.led13 = false; } }
    }
  }

  /**
   * Plain-data picture of what the circuit is actually doing right now, for the AI to reason from instead
   * of guessing runtime behaviour from the code. Static wiring problems are included even when stopped.
   */
  snapshot() {
    const circuit = this.editor.getCircuit();
    const issues = [...new Set([...circuit.issues.map(i => i.text), ...(circuit.openLeads || []).map(o => o.text)])];
    if (!this.running || !this.mcu || !this.result) return { running: false, issues, error: this.error };
    const r2 = v => Math.round(v * 100) / 100;
    const MODE = { H: 'OUTPUT HIGH', L: 'OUTPUT LOW', U: 'INPUT_PULLUP', Z: 'INPUT' };
    const pins = [];
    for (const pin of circuit.uno.pins) {
      const m = this.modes?.get(pin.name), v = this.result.voltage(pin.net), analog = /^A\d$/.test(pin.name);
      if (v == null && (m === 'Z' || !m)) continue;                       // nothing attached, firmware not using it
      const entry = { pin: analog ? pin.name : `D${pin.name}`, mode: m === 'P' ? `PWM ${Math.round((this.duty?.get(pin.name) || 0) * 100)}%` : MODE[m] || m, volts: v == null ? null : r2(v) };
      if (analog && v != null) entry.adc = Math.round(Math.max(0, Math.min(5, v)) / 5 * 1023);   // what analogRead() returns
      pins.push(entry);
    }
    const leds = [];
    for (const part of this.editor.state.parts) {
      if (part.type === 'led') { const i = this.result.ledCurrent.get(part.id) || 0; leds.push({ id: part.id, mA: r2(i * 1000), on: i > 5e-5 }); }
      else if (part.type === 'rgb-led') for (const ch of ['R', 'G', 'B']) { const i = this.result.ledCurrent.get(`${part.id}:${ch}`) || 0; leds.push({ id: `${part.id}:${ch}`, mA: r2(i * 1000), on: i > 5e-5 }); }
    }
    return {
      running: true, paused: this.paused, seconds: r2(this.mcu.seconds),
      pins, leds, pressed: [...this.pressed],
      warnings: [...new Set(this.result.warnings.map(w => w.text))], issues, error: this.error,
    };
  }

  scheduleIdleRefresh() {
    if (this.idleTimer) return;
    this.idleTimer = requestAnimationFrame(() => { this.idleTimer = 0; this.refreshTray(); });
  }

  refreshTray() {
    const tray = $('simTray'), circuit = this.editor.getCircuit();
    const notes = [...circuit.issues.map(i => i.text), ...(this.running ? (circuit.openLeads || []).map(o => o.text) : []), ...(this.running && this.result ? this.result.warnings.map(w => w.text) : [])];
    if (this.error) notes.unshift(`Simulator error: ${this.error}`);
    const uniq = [...new Set(notes)];
    tray.hidden = !this.running && !uniq.length;
    if (tray.hidden) return;
    $('simDot').className = `sim-dot${this.running ? (this.paused ? ' pause' : ' run') : ''}`;
    $('simStatus').textContent = this.running ? (this.paused ? 'Paused' : 'Running') : 'Stopped';
    $('simTime').textContent = this.mcu ? `${this.mcu.seconds.toFixed(2)} s` : '–';
    const label = n => `D${n}`.replace('DA', 'A');
    const high = this.modes ? [...this.modes].filter(([, m]) => m === 'H').map(([n]) => label(n)) : [];
    if (this.modes) for (const [n, d] of this.duty || []) high.push(`${label(n)}~${Math.round(d * 100)}%`);
    $('simPin').textContent = !this.running ? '–' : high.length ? high.join(' ') : 'none';
    document.querySelector('.sim-row').classList.toggle('idle', !this.running);
    $('simPause').parentElement.hidden = !this.running;
    document.querySelectorAll('.sim-readout').forEach(el => { el.hidden = !this.running; });
    const ul = $('simNotes'), html = uniq.map(t => `<li>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</li>`).join('');
    if (ul.innerHTML !== html) ul.innerHTML = html;
  }
}
