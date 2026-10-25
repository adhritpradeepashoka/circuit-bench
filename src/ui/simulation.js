import { Mcu, CPU_HZ } from '../sim/mcu.js';
import { Rp2040Mcu } from '../sim/rp2040-mcu.js';
import { UnoR4Mcu } from '../sim/uno-r4-mcu.js';
import { solveDrive } from '../core/solver.js';
import { PART_DEFS } from '../core/parts.js';
import { compileSketch } from '../sim/compile-client.js';
import { BOARD_SPECS, DEFAULT_BOARD } from '../core/boards.js';
import { CHIPS } from '../sim/chips.js';
import { DEFAULT_SKETCH } from '../sim/examples.js';
import { i2cParts, i2cHex } from '../core/i2c.js';
import { Mpu6050 } from '../parts/mpu6050.js';
import { Ssd1306, OLED_W, OLED_H } from '../parts/ssd1306.js';
import { Lcd1602 } from '../parts/lcd1602.js';
import { Dht } from '../parts/dht.js';
import { dhtParts, timedParts } from '../core/digital.js';
import { Servo, Ultrasonic, Stepper, Bldc, BldcEsc, FreqProbe } from '../parts/timed.js';
import { Sound } from './audio.js';
import { visualTarget } from '../parts/skins.js';
import { motorRpm } from '../core/solver.js';
import { signalAt } from '../core/signals.js';
import { slimePotentials } from '../core/slime.js';
import { createLogicState, tickLogic, MIN_SUPPLY } from '../core/logic.js';

// Several boards can share a bench and each runs its own chip. The per-board state below lives on a "context" (this.cur); the older single-board
// methods keep reading `this.mcu`, `this.i2cInfo` … and get whichever board is current, so one board is the same code path it always was.
const BOARD_FIELDS = ['mcu', 'spec', 'chipName', 'boardName', 'models', 'i2cInfo', 'i2cVersion', 'dhts', 'dhtInfo', 'timed', 'timedInfo', 'probes', 'logicInfo', 'logicStates', 'logicPorts', 'logicMap', 'onLogicPort'];
const UART_BAUD_TOLERANCE = 0.04;

const I2C_MODELS = { mpu6050: () => new Mpu6050(), ssd1306: () => new Ssd1306(), lcd1602: () => new Lcd1602() };

const $ = id => document.getElementById(id);
const LED_FULL_A = 0.010;   // ≈ full brightness at 10 mA

/** Glue between the editor, the netlist, the DC solver and the avr8js CPU. */
export class Simulation {
  constructor(editor, code = null) {
    this.editor = editor;
    this.code = code || { compile: () => compileSketch(DEFAULT_SKETCH), setRunning() {}, open() {} };
    this.compiling = false;
    this.running = false; this.paused = false;
    this.cur = {}; this.ctxs = []; this.monitorCtx = null; this.uartLinks = new Map(); this.linkNotes = []; this.linkVersion = -1;
    this.mcu = null; this.result = null; this.lastSig = ''; this.raf = 0; this.last = 0;
    this.pressed = new Set();
    this.error = null;
    this.idleTimer = 0;
    this.sound = new Sound();
    this.timed = new Map(); this.timedInfo = []; this.probes = new Map(); this.reactive = new Map(); this.lastSolveAt = 0;
    const soundBtn = $('simSound');
    if (soundBtn) {
      const paint = () => { soundBtn.textContent = this.sound.enabled ? '🔊' : '🔇'; soundBtn.setAttribute('aria-pressed', String(this.sound.enabled)); };
      paint();
      soundBtn.addEventListener('click', () => { this.sound.setEnabled(!this.sound.enabled); paint(); });
    }

    $('runBtn').addEventListener('click', () => this.toggle());
    $('simPause').addEventListener('click', () => this.togglePause());
    $('simStop').addEventListener('click', () => this.stop());
    editor.on('toggle-run', () => this.toggle());
    this.code.onBoardView?.(id => { if (!this.running) return; const ctx = this.ctxs.find(c => c.id === id); if (ctx && ctx !== this.monitorCtx) this.showMonitor(ctx); });
    editor.on('button', ({ partId, pressed }) => { pressed ? this.pressed.add(partId) : this.pressed.delete(partId); this.lastSig = ''; });
    editor.on('change', () => { this.lastSig = ''; if (!this.running) this.scheduleIdleRefresh(); });
    // Serial Monitor → the sketch's Serial input (returns true when delivered)
    this.code.serial?.onSend(text => { if (!this.running || !this.monitorCtx?.mcu) return false; this.monitorCtx.mcu.serialWrite(text); return true; });
  }

  toggle() { return this.running ? this.stop() : this.start(); }

  setRunButton(state) {                       // 'idle' | 'compiling' | 'running'
    const btn = $('runBtn');
    btn.disabled = state === 'compiling';
    btn.classList.toggle('running', state === 'running');
    $('runIcon').textContent = state === 'running' ? '■' : state === 'compiling' ? '…' : '▶';
    $('runLabel').textContent = state === 'running' ? 'Stop' : state === 'compiling' ? 'Compiling' : 'Run';
  }

  /** The circuit as one board sees it: `uno` is that board (every older helper — I²C, DHT, timed parts — reads `circuit.uno`). */
  circuitFor(ctx = this.cur) {
    const c = this.editor.getCircuit();
    if (!ctx || !c.boards || ctx.boardIdx === 0 || !c.boards[ctx.boardIdx]) return c;
    return (c._views ||= [])[ctx.boardIdx] ||= { ...c, uno: c.boards[ctx.boardIdx] };
  }
  /** Run fn once for every board, then go back to the board that was current. */
  eachBoard(fn) {
    const keep = this.cur;
    try { for (const c of this.ctxs) { this.cur = c; fn(c); } } finally { this.cur = keep; }
  }
  /** The key a pin has in the solver's maps: plain on the first board, "<boardPartId>/<pin>" on the others. */
  pinKey(name, ctx = this.cur) { return ctx?.boardIdx > 0 && ctx.id ? `${ctx.id}/${name}` : name; }

  /** Compile every board's sketch with Arduino CLI, then boot each firmware on its board's simulated chip. */
  async start() {
    if (this.running || this.compiling) return;
    this.compiling = true; this.setRunButton('compiling');
    const circuit0 = this.editor.getCircuit();
    const boards = circuit0.boards?.length ? circuit0.boards : [{ spec: BOARD_SPECS[DEFAULT_BOARD], board: null, index: 0 }];
    this.editor.status(boards.length > 1 ? `Compiling ${boards.length} sketches with Arduino CLI…` : 'Compiling with Arduino CLI…');
    let builds = null;
    try {
      builds = this.code.compileAll && boards.length > 1
        ? await this.code.compileAll(boards.map(b => ({ id: b.board?.id ?? null, fqbn: b.spec?.fqbn ?? null })))
        : [await this.code.compile()];
    } finally { this.compiling = false; this.setRunButton('idle'); }
    if (!builds || builds.some(b => !b)) return;                 // superseded by a newer compile
    for (const [i, build] of builds.entries()) {
      if (build.ok) continue;
      this.code.open?.();
      const errors = (build.diagnostics || []).filter(d => d.severity === 'error');
      const who = boards.length > 1 ? `${boards[i].spec.name}${boards.length > 1 ? ` ${i + 1}` : ''}: ` : '';
      this.editor.status(build.unreachable ? build.error : errors.length ? `${who}Compile failed — line ${errors[0].line}: ${errors[0].message}` : `${who}Compile failed — see the Output tab`);
      if (errors.length) { this.code.showBoard?.(boards[i].board?.id); this.code.goToLine?.(errors[0].line); }
      return;
    }
    if (boards.length > builds.length) { this.editor.status(`There is no sketch for the ${boards[builds.length].spec.name} yet — open the code editor and pick that board.`); return; }
    const ctxs = [];
    for (const [i, bd] of boards.entries()) {
      const build = builds[i], spec = bd.spec || BOARD_SPECS[DEFAULT_BOARD];
      const builtFor = Object.values(BOARD_SPECS).find(b => b.fqbn === build.fqbn);
      if (builtFor && (builtFor.chip !== spec.chip || builtFor.emulation !== spec.emulation)) { this.editor.status(`This firmware was built for the ${builtFor.name}, but the board is a ${spec.name} — press Run again to rebuild`); return; }
      const ctx = { id: bd.board?.id ?? null, boardIdx: i, spec, chipName: spec.chipName || CHIPS[spec.chip]?.name || spec.chip, boardName: boards.length > 1 ? `${spec.name} ${i + 1}` : spec.name, build };
      try { ctx.mcu = spec.chip === 'rp2040' ? new Rp2040Mcu(build.firmware) : spec.emulation === 'uno-r4' ? new UnoR4Mcu(build.hex) : new Mcu(build.hex, spec.chip); } catch (err) { this.fail(err); return; }
      Object.assign(ctx, { models: new Map(), i2cInfo: [], i2cVersion: -1, dhts: new Map(), dhtInfo: [], timed: new Map(), timedInfo: [], probes: new Map(), logicInfo: [], logicStates: new Map(), logicPorts: [], logicMap: new Map() });
      ctx.onLogicPort = () => { const keep = this.cur; this.cur = ctx; try { this.logicTick(); } finally { this.cur = keep; } };
      ctxs.push(ctx);
    }
    this.ctxs = ctxs; this.cur = ctxs[0]; this.monitorCtx = ctxs[0]; this.linkVersion = -1; this.uartLinks = new Map(); this.linkNotes = [];
    for (const ctx of ctxs) ctx.mcu.attachSerial?.(byte => { if (this.monitorCtx === ctx) this.code.serial?.push(byte); }, (i, byte) => this.routeUart(ctx, i, byte));
    this.showMonitor(ctxs[0]);
    $('simChip').textContent = ctxs.length > 1 ? ctxs.map(c => c.chipName).join(' + ') : ctxs[0].chipName;
    this.code.setRunning?.(true);
    this.reactive = new Map(); this.lastSolveAt = 0; this.modes = new Map(); this.duty = new Map(); this.slopes = [];
    this.prepareAll();                                  // attach I²C devices before setup() runs its Wire.begin()/begin() calls
    this.running = true; this.paused = false; this.error = null; this.lastSig = ''; this.result = null;
    this.editor.setRunning(true);
    this.editor.probe = net => (this.result ? this.result.voltage(net) : null);
    this.last = performance.now();
    this.setRunButton('running');
    $('simPause').textContent = 'Pause';
    const first = ctxs[0];
    this.editor.status(ctxs.length > 1 ? `Running — real firmware on ${ctxs.length} boards (${ctxs.map(c => c.boardName).join(', ')})` : `Running — real firmware (${first.build.size?.flash ?? '?'} bytes) on the simulated ${first.boardName} (${first.chipName})`);
    this.raf = requestAnimationFrame(t => this.frame(t));
    this.refreshTray();
  }

  /** Point the serial monitor at one board (its output, its baud rate, what you type goes to it). */
  showMonitor(ctx) {
    this.monitorCtx = ctx;
    const serial = this.code.serial;
    if (!serial || !ctx) return;
    serial.clear(); serial.setBaud(0);
    if (ctx.mcu.usart) ctx.mcu.usart.onConfigurationChange = () => { if (this.monitorCtx === ctx) serial.setBaud(Math.round(ctx.mcu.baud)); };
    if (ctx.spec.chip !== 'rp2040') serial.setBaud(Math.round(ctx.mcu.baud) || 0);               // USB serial has no baud rate to show
  }

  /** A byte left one board's UART: hand it to whichever board it is wired to (TX → RX), if the grounds are shared. */
  routeUart(from, index, byte) {
    const targets = this.uartLinks.get(`${from.id ?? from.boardIdx}:${index}`);
    if (!targets) return;
    for (const t of targets) {
      if (t.garble) { t.to.mcu.uartWrite?.(t.uart, 0xff); continue; }      // baud rates differ: the other end hears noise
      t.to.mcu.uartWrite?.(t.uart, byte);
    }
  }
  /** Find the boards wired TX → RX (re-checked when the wiring changes) and say what is wrong with a link that cannot work. */
  uartPrepare(circuit) {
    this.linkVersion = circuit.version;
    this.uartLinks = new Map(); this.linkNotes = [];
    const bds = circuit.boards || [];
    const netOfPin = (bd, name) => bd.pins.find(p => p.name === name)?.net;
    const sharedGround = (a, b) => [...a.gnd].some(n => b.gnd.has(n));
    const note = t => { if (!this.linkNotes.includes(t)) this.linkNotes.push(t); };
    for (const a of this.ctxs) for (const b of this.ctxs) {
      if (a === b) continue;
      const A = bds[a.boardIdx], B = bds[b.boardIdx];
      (a.spec.uarts || []).forEach((ua, i) => (b.spec.uarts || []).forEach((ub, j) => {
        const tx = netOfPin(A, ua.tx), rx = netOfPin(B, ub.rx);
        if (tx == null || rx == null || tx !== rx) return;
        if (!sharedGround(A, B)) { note(`${a.boardName} TX is wired to ${b.boardName} RX, but the two boards share no GND — connect their GND pins together or the serial link can't work.`); return; }
        if (a.spec.logic > b.spec.logic + 0.5) note(`${a.boardName} sends 5 V logic into ${b.boardName}, which only takes ${b.spec.logic} V on its pins — put a voltage divider (say 1 kΩ + 2 kΩ) between TX and RX, or a real ${b.spec.name} would be damaged.`);
        const entry = { to: b, uart: j, get garble() { const x = a.mcu.uartBaud?.(i), y = b.mcu.uartBaud?.(j); return !!(x && y && Math.abs(x - y) / Math.max(x, y) > UART_BAUD_TOLERANCE); } };
        const key = `${a.id ?? a.boardIdx}:${i}`;
        this.uartLinks.set(key, [...(this.uartLinks.get(key) || []), entry]);
      }));
      // TX wired to TX / RX to RX — the classic mistake
      (a.spec.uarts || []).forEach(ua => (b.spec.uarts || []).forEach(ub => {
        const t1 = netOfPin(bds[a.boardIdx], ua.tx), t2 = netOfPin(bds[b.boardIdx], ub.tx);
        if (t1 != null && t1 === t2) note(`${a.boardName} TX is wired to ${b.boardName} TX — cross them: TX goes to the other board's RX.`);
      }));
    }
  }
  /** Mismatched baud rates between linked boards (checked live: the sketch sets the rate when it starts). */
  linkWarnings() {
    const out = [...this.linkNotes];
    for (const [key, list] of this.uartLinks) {
      const [id, i] = [key.slice(0, key.lastIndexOf(':')), +key.slice(key.lastIndexOf(':') + 1)];
      const a = this.ctxs.find(c => String(c.id ?? c.boardIdx) === id);
      for (const t of list) if (t.garble && a) out.push(`${a.boardName} sends at ${a.mcu.uartBaud(i)} baud but ${t.to.boardName} listens at ${t.to.mcu.uartBaud(t.uart)} — use the same Serial.begin() rate on both, or the data arrives as noise.`);
    }
    return out;
  }

  /** Per board: attach the I²C devices, DHTs and timed parts wired to it; then make sure a part is owned by one board only; then find serial links. */
  prepareAll() {
    let rebuilt = false;
    this.eachBoard(() => { if (this.i2cPrepare()) rebuilt = true; });
    if (rebuilt && this.ctxs.length > 1) this.dedupeDevices();
    const c = this.editor.getCircuit();
    if (c.version !== this.linkVersion) this.uartPrepare(c);
  }
  /** A part wired to the second board must not also show up (unconnected) on the first: keep each part with the board it is attached to. */
  dedupeDevices() {
    const elsewhere = (ctx, list, id) => this.ctxs.some(o => o !== ctx && o[list].some(d => d.partId === id && d.attached));
    for (const ctx of this.ctxs) {
      const keep = (list, d) => d.attached || (ctx.boardIdx === 0 && !elsewhere(ctx, list, d.partId));
      ctx.i2cInfo = ctx.i2cInfo.filter(d => keep('i2cInfo', d));
      for (const id of [...ctx.models.keys()]) if (!ctx.i2cInfo.some(d => d.partId === id)) ctx.models.delete(id);
      ctx.dhtInfo = ctx.dhtInfo.filter(d => keep('dhtInfo', d));
      for (const [id, m] of [...ctx.dhts]) if (!ctx.dhtInfo.some(d => d.partId === id)) { m.detach(); ctx.dhts.delete(id); }
      ctx.timedInfo = ctx.timedInfo.filter(t => keep('timedInfo', t));
      for (const [id, e] of [...ctx.timed]) if (!ctx.timedInfo.some(t => t.partId === id)) { e.model.detach(); ctx.timed.delete(id); }
    }
  }

  stop() {
    if (!this.running) return;
    this.running = false; this.paused = false;
    cancelAnimationFrame(this.raf);
    for (const id of [...this.pressed]) this.editor.setButtonPressed(id, false);
    this.pressed.clear();
    this.editor.setRunning(false); this.editor.probe = null;
    this.eachBoard(() => {
      this.logicDetach(); this.logicInfo = []; this.logicStates = new Map(); this.logicMap = new Map();
      for (const m of this.dhts?.values() || []) m.detach();
      this.dhts = new Map(); this.dhtInfo = [];
      this.timedDetach();
    });
    this.sound.silence();
    this.reactive = new Map();
    this.ctxs = []; this.cur = {}; this.monitorCtx = null; this.uartLinks = new Map(); this.linkNotes = []; this.result = null;
    this.code.setRunning?.(false);
    this.resetVisuals();
    this.editor.applyPartValues?.();                   // switches / encoders go back to showing the position they are in
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
        this.prepareAll();                         // devices see this frame's wiring + tilt before the firmware runs
        this.eachBoard(() => this.mcu.run(dt * (this.mcu.hz || CPU_HZ)));
        this.step();
        this.eachBoard(() => this.animate(dt));
        this.animateBuzzers();
      }
      this.last = ts;
      this.refreshTray();
    } catch (err) { this.running = true; this.stop(); this.fail(err); return; }
    this.raf = requestAnimationFrame(t => this.frame(t));
  }

  /** One electrical evaluation: every board's pin states → ONE DC solve → inputs back into every MCU → visuals. */
  step() {
    const circuit = this.editor.getCircuit();
    this.prepareAll();
    const modes = new Map(), duty = new Map();
    this.eachBoard(ctx => {
      const view = this.circuitFor(ctx);
      for (const pin of view.uno.pins) {
        if (!pin.port) continue;                                                              // analog-only input (Nano A6/A7)
        const d = this.mcu.pwmDutyOf ? this.mcu.pwmDutyOf(pin) : /^\d+$/.test(pin.name) ? this.mcu.pwmDuty(Number(pin.name)) : null;       // analogWrite → average duty, not the fast waveform
        const key = pin.key ?? pin.name;
        if (d !== null) { duty.set(key, d); modes.set(key, 'P'); } else modes.set(key, this.mcu.pinMode(pin));
      }
      // the on-board LED is wired inside the board (the Pico's GP25 has no header pin), so read it from the chip directly
      const led = this.spec?.ledPin, ledKey = led && this.pinKey(led);
      if (led && !modes.has(ledKey) && this.spec.pins[led]?.port) modes.set(ledKey, this.mcu.pinMode(this.spec.pins[led]));
      // a UART the sketch has started holds its TX line high (idle) — that is what a wire to another board's RX sees
      if (this.ctxs.length > 1) (this.spec.uarts || []).forEach((u, i) => { if (this.mcu.uartActive?.(i)) modes.set(this.pinKey(u.tx), 'H'); });
    });
    this.duty = duty;
    const sig = `${circuit.version}|${[...modes].join(',')}|${[...duty].map(([n, d]) => `${n}:${d.toFixed(3)}`).join(',')}|${[...this.pressed].join(',')}`;
    this.eachBoard(() => this.i2cVisuals());           // an OLED redraws whenever the firmware changed its RAM, even if no pin did
    // A capacitor or coil changes with TIME, so a circuit that has one is solved every frame (not only when a pin changes)
    const reactive = circuit.elements.some(e => e.kind === 'CAP' || e.kind === 'IND');
    const bios = circuit.elements.filter(e => e.kind === 'BIO');         // a biosignal source changes with time too, so the circuit is solved every frame
    const slimes = circuit.elements.filter(e => e.kind === 'SLIME');     // a slime mold's potentials drift with time too
    if (!reactive && !bios.length && !slimes.length && sig === this.lastSig && this.result) return;
    this.lastSig = sig;
    this.modes = modes;
    this.eachBoard(() => this.logicTick());             // inputs that aren't MCU pins (a switch, another chip) settle here
    this.logicMapAll = new Map(this.ctxs.flatMap(c => [...c.logicMap]));
    const now = this.ctxs[0].mcu.seconds, dt = reactive ? Math.min(0.1, Math.max(1e-5, now - this.lastSolveAt)) : 0;
    this.lastSolveAt = now;
    const signalOf = e => signalAt(this.editor.partById(e.partId) || {}, now);
    const signals = new Map(bios.map(e => [e.partId, signalOf(e)]));
    for (const e of slimes) signals.set(e.partId, slimePotentials(e.taps, this.editor.partById(e.partId) || {}, now));
    const driveOf = sg => ({ pins: modes, pressed: this.pressed, duty, logic: this.logicMapAll, dt, reactive: this.reactive, signals: sg });
    this.result = solveDrive(circuit, driveOf(signals));
    if (reactive) this.reactive = new Map(this.result.reactive);
    // How much each analog pin moves per volt of each electrode signal — lets the ADC follow the waveform at the instant of every analogRead()
    const allPins = (circuit.boards || [circuit.uno]).flatMap(bd => bd.pins);
    const slopes = [];
    for (const e of bios) {
      const bumped = new Map(signals); bumped.set(e.partId, signals.get(e.partId) + 1e-4);
      const r2 = solveDrive(circuit, driveOf(bumped));
      slopes.push({ e, s0: signals.get(e.partId), k: new Map(allPins.filter(p => p.adc != null).map(p => [p.key ?? p.name, ((r2.voltage(p.net) ?? 0) - (this.result.voltage(p.net) ?? 0)) / 1e-4])) });
    }
    this.slopes = slopes;
    this.eachBoard(ctx => {
      const view = this.circuitFor(ctx);
      const digitalDriven = new Set([...this.dhtInfo.filter(d => d.attached).map(d => d.pin.key ?? d.pin.name),            // a DHT times its own line, cycle by cycle
        ...this.timedInfo.filter(t => t.attached && t.kind === 'ultrasonic').map(t => t.pins.echo.key ?? t.pins.echo.name)]);   // so does an ultrasonic sensor's ECHO
      const uartTx = new Set(this.ctxs.length > 1 ? (this.spec.uarts || []).filter((u, i) => this.mcu.uartActive?.(i)).map(u => this.pinKey(u.tx)) : []);          // the UART owns its TX line
      for (const pin of view.uno.pins) {
        const key = pin.key ?? pin.name, m = modes.get(key);
        if (pin.port && (m === 'Z' || m === 'U' || m === 'D') && !digitalDriven.has(key) && !uartTx.has(key)) {
          const v = this.result.voltage(pin.net);
          this.mcu.setInput(pin, v == null ? m === 'U' : v > (this.spec?.inputThreshold ?? 2.5));
        }
      }
      // a closed switch between two pins of THIS chip (a keypad key, a button): the chip applies it between instructions, because a scan
      // reads the columns microseconds after it drives a row, long before the next frame's solve could
      if (this.mcu.setCoupling) {
        const pairs = [];
        for (const e of circuit.elements) {
          if (e.kind !== 'SW' || e.a === e.b || !(e.closed || (!e.fixed && this.pressed.has(e.partId)))) continue;
          const as = view.uno.pins.filter(p => p.port && p.net === e.a), bs = view.uno.pins.filter(p => p.port && p.net === e.b);
          for (const a of as) for (const b of bs) pairs.push([a, b]);
        }
        this.mcu.setCoupling(pairs);
      }
      for (const pin of view.uno.pins) {                 // ADC: every analog pin sees the solved net voltage
        if (pin.adc == null) continue;
        const key = pin.key ?? pin.name, v = this.result.voltage(pin.net);
        if (this.slopes?.some(sl => Math.abs(sl.k.get(key) || 0) > 1e-6)) {
          const v0 = v == null ? 0 : v, parts = this.slopes.filter(sl => Math.abs(sl.k.get(key) || 0) > 1e-6);
          this.mcu.setAnalogWave(pin.adc, t => v0 + parts.reduce((a, sl) => a + sl.k.get(key) * (signalAt(this.editor.partById(sl.e.partId) || {}, t) - sl.s0), 0));
        } else this.mcu.setAnalog(pin.adc, v == null ? 0 : v);
      }
    });
    this.applyVisuals(circuit);
  }

  /** Which I²C parts are on the bus (re-checked when the wiring changes), and feed them the user's inputs (e.g. the MPU-6050's tilt). */
  i2cPrepare() {
    const circuit = this.circuitFor();
    let rebuilt = false;
    if (circuit.version !== this.i2cVersion) {
      rebuilt = true;
      this.i2cVersion = circuit.version;
      this.i2cInfo = i2cParts(circuit, this.editor.state.parts);
      for (const id of [...this.models.keys()]) if (!this.i2cInfo.some(d => d.partId === id)) this.models.delete(id);
      for (const d of this.i2cInfo) if (!this.models.has(d.partId)) this.models.set(d.partId, I2C_MODELS[d.type]());
      this.mcu.i2c.setDevices(new Map(this.i2cInfo.filter(d => d.attached).map(d => [d.address, this.models.get(d.partId)])));
      this.logicPrepare(circuit);
      this.timedPrepare(circuit);
      this.dhtInfo = dhtParts(circuit, this.editor.state.parts);
      for (const [id, m] of [...this.dhts]) if (!this.dhtInfo.some(d => d.partId === id && d.model === m.model)) { m.detach(); this.dhts.delete(id); }
      for (const d of this.dhtInfo) {
        if (!this.dhts.has(d.partId)) this.dhts.set(d.partId, new Dht(d.model));
        const m = this.dhts.get(d.partId);
        if (d.attached) m.attach(this.mcu, d.pin); else m.detach();
      }
    }
    for (const t of this.timedInfo) if (t.kind === 'ultrasonic') this.timed.get(t.partId)?.model.setDistance(this.editor.partById(t.partId)?.dist ?? 50);
    for (const d of this.dhtInfo) { const p = this.editor.partById(d.partId); if (p) this.dhts.get(d.partId)?.setValues({ temp: p.temp ?? 24, humidity: p.humidity ?? 40 }); }
    for (const d of this.i2cInfo) {
      const m = this.models.get(d.partId);
      if (m instanceof Mpu6050) m.setPose(this.editor.partById(d.partId) || {}, this.mcu.seconds);
    }
    return rebuilt;
  }

  /** Student-made servos, ultrasonic sensors and steppers listen to the firmware's pins; a passive buzzer listens for tone(). */
  timedPrepare(circuit) {
    this.timedInfo = timedParts(circuit, this.editor.state.parts);
    for (const [id, e] of [...this.timed]) if (!this.timedInfo.some(t => t.partId === id && t.kind === e.kind)) { e.model.detach(); this.timed.delete(id); }
    for (const t of this.timedInfo) {
      let e = this.timed.get(t.partId);
      if (!e) {
        const b = t.spec.behaviour;
        const model = t.kind === 'servo' ? new Servo(b) : t.kind === 'ultrasonic' ? new Ultrasonic() : t.kind === 'bldc' ? new Bldc(b) : t.kind === 'bldc-esc' ? new BldcEsc(b) : new Stepper(b);
        e = { kind: t.kind, model }; this.timed.set(t.partId, e);
      }
      if (!t.attached) { e.model.detach(); continue; }
      if (t.kind === 'servo' || t.kind === 'bldc-esc') e.model.attach(this.mcu, t.pins.signal);
      else if (t.kind === 'bldc') e.model.attach(this.mcu, t.pins.phases);
      else if (t.kind === 'ultrasonic') e.model.attach(this.mcu, t.pins.trig, t.pins.echo);
      else e.model.attach(this.mcu, t.pins.coils);
    }
    // passive buzzers: the board pin on either terminal carries the tone
    const seen = new Set();
    for (const part of this.editor.state.parts) {
      const def = PART_DEFS[part.type];
      if (!def?.custom || def.spec.behaviour.kind !== 'buzzer' || def.spec.behaviour.mode === 'active') continue;
      seen.add(part.id);
      const { a, b } = def.spec.behaviour.roles;
      const pin = circuit.uno.pins.find(p => p.port && (p.net === circuit.netOf(part.id, a) || p.net === circuit.netOf(part.id, b)));
      let probe = this.probes.get(part.id);
      if (!pin) { probe?.detach(); this.probes.delete(part.id); continue; }
      if (!probe) { probe = new FreqProbe(); this.probes.set(part.id, probe); }
      probe.attach(this.mcu, pin);
    }
    for (const [id, probe] of [...this.probes]) if (!seen.has(id)) { probe.detach(); this.probes.delete(id); }
  }
  timedDetach() {
    for (const e of this.timed.values()) e.model.detach();
    for (const p of this.probes.values()) p.detach();
    this.timed = new Map(); this.timedInfo = []; this.probes = new Map();
  }
  /** Every frame: servo horns and stepper shafts move, buzzers sound. */
  animate(dt) {
    const r = this.result;
    const supply = (net1, net2) => { const a = r?.voltage(net1), b = r?.voltage(net2); return a == null || b == null ? 0 : a - b; };
    const circuit = this.editor.getCircuit();
    for (const t of this.timedInfo) {
      const e = this.timed.get(t.partId), root = this.editor.els.get(t.partId), el = visualTarget(root, PART_DEFS[this.editor.partById(t.partId)?.type]);
      if (!e || !el) continue;
      const roles = t.spec.behaviour.roles, volts = roles.vcc ? supply(circuit.netOf(t.partId, roles.vcc), circuit.netOf(t.partId, roles.gnd)) : 5, powered = volts >= 3.5;
      if (t.kind === 'servo') { e.model.update(dt, powered); el.aux = e.model.angle; el.lit = powered && t.attached ? 1 : 0; }
      else if (t.kind === 'stepper') el.aux = powered ? e.model.angle : el.aux;
      else if (t.kind === 'bldc') { e.model.update(dt); el.aux = e.model.rpm; el.lit = e.model.rpm ? 1 : 0; }
      else if (t.kind === 'bldc-esc') { e.model.update(dt, volts); el.aux = e.model.rpm; el.lit = e.model.rpm ? 1 : 0; }
    }
  }

  /** Buzzers sound whichever board's tone() is playing on them (every board listens; the loudest wins). */
  animateBuzzers() {
    const r = this.result;
    for (const part of this.editor.state.parts) {
      const def = PART_DEFS[part.type];
      if (!def?.custom || def.spec.behaviour.kind !== 'buzzer') continue;
      const b = def.spec.behaviour, root = this.editor.els.get(part.id), el = visualTarget(root, def);
      let freq = 0;
      if (b.mode !== 'active') freq = Math.max(0, ...this.ctxs.map(c => c.probes.get(part.id)?.update() || 0));
      if (freq === 0 && b.mode !== 'passive' && (r?.loadVolts?.get(part.id) ?? 0) >= b.vmin) freq = 2700;
      if (el) el.lit = freq > 0 ? 1 : 0;
      this.sound.tone(part.id, freq);
    }
    const tray = $('simSound');
    if (tray) tray.hidden = !this.editor.state.parts.some(p => PART_DEFS[p.type]?.custom && PART_DEFS[p.type].spec.behaviour.kind === 'buzzer');
  }

  /** Student-made "rules" parts (src/core/logic.js): give each one its state, and watch the MCU pins it listens to. */
  logicPrepare(circuit) {
    this.logicDetach();
    this.logicInfo = [];
    const touches = (bd, e) => Object.values(e.nets).some(net => bd.pins.some(p => p.net === net && p.port));
    const mine = e => touches(circuit.uno, e) || (this.cur.boardIdx === 0 && !(circuit.boards || []).some(bd => touches(bd, e)));      // a rules-part belongs to the board whose pins it listens to
    for (const e of circuit.elements.filter(x => x.kind === 'LOGIC' && mine(x))) {
      const compiled = PART_DEFS[e.partType]?.logic;
      if (!compiled) continue;
      const state = this.logicStates.get(e.partId) || createLogicState(compiled);
      const mcu = new Map();
      for (const [pin, net] of Object.entries(e.nets)) {
        const bp = circuit.uno.pins.find(p => p.net === net && p.port);
        if (bp) mcu.set(pin, bp);
      }
      this.logicInfo.push({ ...e, compiled, state, mcu });
    }
    this.logicStates = new Map(this.logicInfo.map(i => [i.partId, i.state]));
    this.logicMap = new Map(this.logicInfo.map(i => [i.partId, { compiled: i.compiled, state: i.state }]));
    // A clock from the firmware can pulse thousands of times inside one animation frame, so listen to the
    // port itself rather than sampling once a frame — the chip sees every edge exactly as the sketch sent it.
    const ports = new Set(this.logicInfo.flatMap(i => [...i.mcu.values()].map(p => p.port)));
    for (const name of ports) {
      const port = this.mcu?.ports[name];
      if (port) { port.addListener(this.onLogicPort); this.logicPorts.push(port); }
    }
  }
  logicDetach() {
    for (const p of this.logicPorts) p.removeListener(this.onLogicPort);
    this.logicPorts = [];
  }
  /** One evaluation of every rules-part, with MCU-driven pins read straight from the chip. */
  logicTick() {
    for (const info of this.logicInfo) {
      const read = pin => {
        const bp = info.mcu.get(pin);
        if (bp) { const m = this.mcu.pinMode(bp); if (m === 'H') return this.spec?.logic ?? 5; if (m === 'L') return 0; }
        const net = info.nets[pin];
        return net == null ? null : this.result?.voltage(net) ?? (bp ? null : null);
      };
      tickLogic(info.compiled, info.state, info.roles, read);
    }
  }

  i2cVisuals() {
    for (const d of this.i2cInfo) {
      const root = this.editor.els.get(d.partId), m = this.models.get(d.partId);
      if (!root || !m) continue;
      if (d.type === 'mpu6050') { const el = root.querySelector('wokwi-mpu6050'); const on = !d.problems.some(p => /power|GND/.test(p)); if (el && el.led1 !== on) el.led1 = on; }
      else if (d.type === 'lcd1602') {
        const el = root.querySelector('wokwi-lcd1602');
        if (el && el._drawn !== m.version) {
          el._drawn = m.version;
          if (!el._baseFont) el._baseFont = el.font;
          el.font = m.font(el._baseFont);
          el.characters = m.characters();
          el.backlight = m.backlight;
          const c = m.cursor(); el.cursor = c.show; el.blink = c.blink && m.displayOn; el.cursorX = c.x; el.cursorY = c.y;
        }
      } else if (d.type === 'ssd1306') {
        const el = root.querySelector('wokwi-ssd1306');
        if (el?.imageData && el._drawn !== m.version) { el._drawn = m.version; m.renderRGBA(el.imageData.data); el.redraw?.(); }
      }
    }
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
      } else if (PART_DEFS[part.type]?.custom) {
        const el = visualTarget(root, PART_DEFS[part.type]), b = PART_DEFS[part.type].spec.behaviour;
        if (!el) continue;
        if (b.kind === 'led') el.lit = Math.min(1, (result.ledCurrent.get(part.id) || 0) / LED_FULL_A);
        else if (b.kind === 'relay') el.lit = result.relays?.get(part.id) ? 1 : 0;
        else if (b.kind === 'motor') el.aux = motorRpm(result.loadVolts?.get(part.id) || 0);
        else if (b.kind === 'led-array') el.levels = b.segments.map(seg => Math.min(1, (result.ledCurrent.get(`${part.id}:${seg}`) || 0) / LED_FULL_A));
        else if (b.kind === 'encoder') el.lit = this.pressed.has(part.id) ? 1 : 0;
        else if (b.kind === 'analog-sensor' || b.kind === 'digital-sensor') { const c = this.editor.getCircuit(), v = a => result.voltage(c.netOf(part.id, a)); el.aux = 0; el.powered = (v(b.roles.vcc) ?? 0) - (v(b.roles.gnd) ?? 0) >= 3; }
      } else if (part.type === 'dc-motor') {
        const el = root.matches?.('cb-dc-motor') ? root : root.querySelector('cb-dc-motor');
        if (el) el.rpm = motorRpm(result.motorVolts?.get(part.id) || 0);
      } else if (part.type === 'l298n') {
        const el = root.matches?.('cb-l298n') ? root : root.querySelector('cb-l298n'), d = result.drivers?.get(part.id);
        if (el) { el.ledPower = !!d?.powered; el.channels = d?.ch || ['', '']; }
      } else if (BOARD_SPECS[part.type]) {
        const el = root.querySelector(PART_DEFS[part.type].tag);
        if (!el) continue;
        const ctx = this.ctxs.find(c => c.id === part.id) || (this.ctxs.length === 1 && part.id === circuit.uno.board?.id ? this.ctxs[0] : null), live = !!ctx;
        if (el.ledPower !== live) el.ledPower = live;
        const l = live && this.modes?.get(this.pinKey(BOARD_SPECS[part.type].ledPin, ctx)) === 'H';
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
      if (BOARD_SPECS[part.type]) { const el = root?.querySelector(PART_DEFS[part.type].tag); if (el) { el.ledPower = false; el.led13 = false; } }
      if (part.type === 'mpu6050') { const el = root?.querySelector('wokwi-mpu6050'); if (el) el.led1 = false; }
      if (PART_DEFS[part.type]?.custom) { const el = visualTarget(root, PART_DEFS[part.type]); if (el) { el.lit = 0; el.aux = 0; el.levels = null; } }
      if (part.type === 'dc-motor') { const el = root?.matches?.('cb-dc-motor') ? root : root?.querySelector('cb-dc-motor'); if (el) el.rpm = 0; }
      if (part.type === 'l298n') { const el = root?.matches?.('cb-l298n') ? root : root?.querySelector('cb-l298n'); if (el) { el.ledPower = false; el.channels = ['', '']; } }
      if (part.type === 'lcd1602') { const el = root?.querySelector('wokwi-lcd1602'); if (el) { el.characters = new Uint8Array(32).fill(32); el.backlight = false; el.cursor = false; el.blink = false; el._drawn = null; } }
      if (part.type === 'ssd1306') { const el = root?.querySelector('wokwi-ssd1306'); if (el?.imageData) { el.imageData.data.fill(0); for (let i = 3; i < el.imageData.data.length; i += 4) el.imageData.data[i] = 255; el._drawn = null; el.redraw?.(); } }
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
    const many = this.ctxs.length > 1;
    for (const bd of circuit.boards || [circuit.uno]) for (const pin of bd.pins) {
      const key = pin.key ?? pin.name, ctx = this.ctxs[bd.index ?? 0];
      const m = this.modes?.get(key), v = this.result.voltage(pin.net), analog = /^A\d+$/.test(pin.name);
      if (v == null && (m === 'Z' || !m)) continue;                       // nothing attached, firmware not using it
      const entry = { ...(many ? { board: ctx?.boardName } : {}), pin: analog ? pin.name : `D${pin.name}`, mode: m === 'P' ? `PWM ${Math.round((this.duty?.get(key) || 0) * 100)}%` : MODE[m] || m, volts: v == null ? null : r2(v) };
      if (analog && v != null) { const lg = ctx?.spec?.logic ?? 5, bits = ctx?.spec?.adcBits ?? 10; entry.adc = Math.round(Math.max(0, Math.min(lg, v)) / lg * ((2 ** Math.min(bits, 10)) - 1)); }   // what analogRead() returns (10-bit default)
      pins.push(entry);
    }
    const leds = [];
    for (const part of this.editor.state.parts) {
      if (part.type === 'led') { const i = this.result.ledCurrent.get(part.id) || 0; leds.push({ id: part.id, mA: r2(i * 1000), on: i > 5e-5 }); }
      else if (part.type === 'rgb-led') for (const ch of ['R', 'G', 'B']) { const i = this.result.ledCurrent.get(`${part.id}:${ch}`) || 0; leds.push({ id: `${part.id}:${ch}`, mA: r2(i * 1000), on: i > 5e-5 }); }
    }
    const i2c = this.ctxs.flatMap(c => c.i2cInfo.map(d => ({ d, c }))).map(({ d, c }) => {
      const m = c.models.get(d.partId), e = { id: d.partId, type: d.type, address: i2cHex(d.address), onBus: d.attached };
      if (d.problems.length) e.problems = d.problems;
      if (m instanceof Mpu6050) { const r = m.readings(); e.asleep = m.asleep; e.accelG = Object.fromEntries(Object.entries(r.accel).map(([k, v]) => [k, r2(v)])); e.gyroDps = Object.fromEntries(Object.entries(r.gyro).map(([k, v]) => [k, r2(v)])); e.tempC = r2(r.tempC); }
      if (m instanceof Ssd1306 || m instanceof Lcd1602) Object.assign(e, m.summary());
      return e;
    });
    const dht = this.ctxs.flatMap(c => c.dhtInfo.map(d => ({ d, c }))).map(({ d, c }) => ({ id: d.partId, ...(c.dhts.get(d.partId)?.summary() || { model: d.model }), dataPin: d.pin ? `D${d.pin.name}`.replace(/^DA/, 'A') : null, ...(d.problems.length ? { problems: d.problems } : {}) }));
    const motors = [...(this.result.motorVolts || [])].map(([id, v]) => ({ id, volts: r2(v), rpm: motorRpm(v) }));
    const logic = this.ctxs.flatMap(c => c.logicInfo).map(i => {
      const out = this.result.logicOut?.get(i.partId);
      const supply = (this.result.voltage(i.nets[i.roles.vcc]) ?? 0) - (this.result.voltage(i.nets[i.roles.gnd]) ?? 0);
      return {
        id: i.partId, type: i.partType, powered: supply >= MIN_SUPPLY,
        memory: Object.fromEntries(Object.entries(i.state.vars).map(([k, v]) => [k, r2(v)])),
        driving: out && out.size ? Object.fromEntries([...out].map(([p, v]) => [p, v > 2.5 ? 'HIGH' : v < 0.7 ? 'LOW' : `${r2(v)} V`])) : null,
      };
    });
    const muxes = [...(this.result.muxChannels || [])].map(([id, ch]) => ({ id, channel: ch >= 0 ? ch : null }));
    const drivers = [...(this.result.drivers || [])].map(([id, d]) => ({ id, powered: d.powered, motorA: d.ch[0] || 'stopped', motorB: d.ch[1] || 'stopped' }));
    const unanswered = this.i2cUnanswered();
    const library = this.libraryState(r2);
    return {
      running: true, paused: this.paused, seconds: r2(this.mcu.seconds), board: this.boardName, chip: this.chipName, ...(this.ctxs.length > 1 ? { boards: this.ctxs.map(c => ({ name: c.boardName, chip: c.chipName })), serialLinks: [...this.uartLinks].flatMap(([k, list]) => list.map(t => `${this.ctxs.find(c => String(c.id ?? c.boardIdx) === k.slice(0, k.lastIndexOf(':')))?.boardName} TX → ${t.to.boardName} RX`)) } : {}),
      pins, leds, pressed: [...this.pressed], i2c, ...(dht.length ? { dht } : {}), ...(motors.length ? { motors, drivers } : {}), ...(muxes.length ? { muxes } : {}), ...(logic.length ? { logic } : {}), ...(library.length ? { library } : {}), ...(unanswered.length ? { i2cUnanswered: unanswered } : {}),
      warnings: [...new Set(this.result.warnings.map(w => w.text))], issues, error: this.error,
    };
  }

  /** What the component-library parts (switches, diodes, transistors, regulators, servos…) are doing right now, as plain data for the AI. */
  libraryState(r2) {
    const r = this.result, out = [];
    for (const part of this.editor.state.parts) {
      const def = PART_DEFS[part.type];
      if (!def?.custom) continue;
      const b = def.spec.behaviour, e = { id: part.id, name: def.name, kind: b.kind };
      const dev = r.devices?.get(part.id), amps = r.deviceAmps?.get(part.id);
      switch (b.kind) {
        case 'switch': e.state = part.pos ? (b.roles.throw2 ? 'on throw 2' : 'closed') : (b.roles.throw2 ? 'on throw 1' : 'open'); break;
        case 'relay': e.energized = !!r.relays?.get(part.id); break;
        case 'variable-resistor': e.positionPct = Math.round(part.level ?? 50); break;
        case 'diode': e.state = dev || 'blocking'; e.mA = r2((amps || 0) * 1000); break;
        case 'npn': case 'pnp': case 'nmos': case 'pmos': e.state = dev || 'off'; e.mA = r2((amps || 0) * 1000); break;
        case 'regulator': { const g = r.regulators?.get(part.id); if (g) Object.assign(e, { outputVolts: r2(g.volts), outputMA: r2(g.amps * 1000), regulating: g.regulating }); break; }
        case 'capacitor': e.volts = r2(r.reactive?.get(part.id)?.v ?? 0); break;
        case 'inductor': e.mA = r2((r.reactive?.get(part.id)?.i ?? 0) * 1000); break;
        case 'buzzer': const fq = Math.max(0, ...this.ctxs.map(c => c.probes.get(part.id)?.freq || 0)); e.sounding = (r.loadVolts?.get(part.id) ?? 0) >= b.vmin || (b.mode !== 'active' && fq > 0); if (b.mode !== 'active') e.hz = Math.round(fq); break;
        case 'motor': e.volts = r2(r.loadVolts?.get(part.id) ?? 0); e.rpm = motorRpm(e.volts); break;
        case 'servo': case 'ultrasonic': case 'stepper': case 'bldc': case 'bldc-esc': { const owner = this.ctxs.find(c => c.timed.has(part.id)), m = owner?.timed.get(part.id)?.model; if (m) Object.assign(e, m.summary()); const info = this.ctxs.flatMap(c => c.timedInfo).find(t => t.partId === part.id); if (info?.problems.length) e.problems = info.problems; break; }
        case 'encoder': e.phase = part.phase ?? 0; break;
        default: continue;
      }
      out.push(e);
    }
    return out;
  }

  /** Addresses the sketch tried that no part could ever answer (e.g. 0x3D when the display is at 0x3C). */
  i2cUnanswered() {
    const out = [];
    for (const c of this.ctxs) {
      if (!c.mcu) continue;
      const own = new Set((c.i2cInfo || []).map(d => d.address));
      for (const a of c.mcu.i2c.unanswered()) if (!own.has(a) && !out.includes(i2cHex(a))) out.push(i2cHex(a));
    }
    return out;
  }

  scheduleIdleRefresh() {
    if (this.idleTimer) return;
    this.idleTimer = requestAnimationFrame(() => { this.idleTimer = 0; this.refreshTray(); });
  }

  refreshTray() {
    const tray = $('simTray'), circuit = this.editor.getCircuit();
    const notes = [...circuit.issues.map(i => i.text), ...(this.running ? (circuit.openLeads || []).map(o => o.text) : []), ...(this.running && this.result ? this.result.warnings.map(w => w.text) : []),
      ...(this.running ? this.linkWarnings() : []), ...(this.running ? this.ctxs.flatMap(c => c.i2cInfo.flatMap(d => d.problems)) : []), ...(this.running ? this.ctxs.flatMap(c => c.timedInfo.flatMap(t => t.problems)) : []), ...(this.running ? this.i2cUnanswered().map(a => `The sketch is looking for an I²C device at ${a}, but nothing on the bus has that address`) : [])];
    if (this.error) notes.unshift(`Simulator error: ${this.error}`);
    const uniq = [...new Set(notes)];
    tray.hidden = !this.running && !uniq.length;
    if (tray.hidden) return;
    $('simDot').className = `sim-dot${this.running ? (this.paused ? ' pause' : ' run') : ''}`;
    $('simStatus').textContent = this.running ? (this.paused ? 'Paused' : 'Running') : 'Stopped';
    $('simTime').textContent = this.ctxs[0]?.mcu ? `${this.ctxs[0].mcu.seconds.toFixed(2)} s` : '–';
    const label = k => { const i = k.lastIndexOf('/'), n = i < 0 ? k : k.slice(i + 1), c = i < 0 ? null : this.ctxs.find(x => x.id === k.slice(0, i)); return `${c ? `${c.boardName}: ` : ''}D${n}`.replace('DA', 'A'); };
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

for (const f of BOARD_FIELDS) Object.defineProperty(Simulation.prototype, f, { get() { return this.cur?.[f]; }, set(v) { if (this.cur) this.cur[f] = v; }, configurable: true });
