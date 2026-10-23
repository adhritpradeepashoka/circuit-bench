// Drives the *real* editor UI code inside jsdom with synthetic pointer events:
// add parts → drag them onto the breadboard → draw wires → Run → watch the LED blink.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { PART_DEFS } from '../src/core/parts.js';
import { pinWorld, placeFlex as placeFlexTest, allPinsWorld as allPinsWorldTest } from '../src/core/geometry.js';
import { compileSketch } from '../src/sim/compile-client.js';
import { DEFAULT_SKETCH, EXAMPLES } from '../src/sim/examples.js';
import { compileLogic, createLogicState, tickLogic, logicDrive } from '../src/core/logic.js';
import { layoutSpec, PITCH } from '../src/core/custom-parts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({ entryPoints: [join(root, 'test/fixtures/ui-entry.js')], bundle: true, write: false, format: 'iife', platform: 'browser', loader: { '.css': 'empty' } });
const html = readFileSync(join(root, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');

const opened = [];
test.after(() => { for (const d of opened) d.window.close(); });

// Real firmware built by Arduino CLI (npm run build-firmware) stands in for the compile service.
const fixtures = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/firmware.json'), 'utf8'));
const norm = t => t.replace(/\r\n?/g, '\n');
const bySource = new Map(Object.values(fixtures.sketches).map(f => [norm(f.source), f.result]));
const sketch = name => fixtures.sketches[name].source;
const offline = async () => { throw new TypeError('offline in tests'); };
const fixtureCompile = async files => (files.length === 1 && bySource.get(norm(files[0].content))) || compileSketch(files, { fetchImpl: offline });

function boot(compile = fixtureCompile, before = null) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window;
  before?.(w);
  // jsdom has no ImageData; the OLED element allocates one in its constructor
  w.ImageData ||= class ImageData { constructor(width, height) { this.width = width; this.height = height; this.data = new Uint8ClampedArray(width * height * 4); } };
  w.eval(out.outputFiles[0].text);
  const { Editor, initSidebar, Simulation, initCode, initResistorEditor, initLedEditor, initValueEditor } = w.__lab;
  const editor = new Editor();
  initSidebar(editor);
  const code = initCode({ compile });
  const sim = new Simulation(editor, code);
  editor.init();
  initResistorEditor(editor);
  initLedEditor(editor);
  initValueEditor(editor);
  const fire = (type, x, y, target = w.document.getElementById('canvas'), extra = {}) =>
    target.dispatchEvent(new w.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0, ...extra }));
  // world → client px at the current view (canvas rect is 0,0 in jsdom)
  const scr = p => ({ x: p.x * editor.view.z + editor.view.x, y: p.y * editor.view.z + editor.view.y });
  const drag = (from, to, target) => {
    const a = scr(from), b = scr(to);
    fire('pointerdown', a.x, a.y, target);
    fire('pointermove', (a.x + b.x) / 2, (a.y + b.y) / 2, w);
    fire('pointermove', b.x, b.y, w);
    fire('pointerup', b.x, b.y, w);
  };
  opened.push(dom);
  return { w, dom, editor, sim, code, fire, scr, drag };
}

test('ui: parts land on the default workspace and the grid column really shrinks on collapse', () => {
  const { w, editor } = boot();
  assert.equal(editor.state.parts.length, 2);
  assert.ok(editor.els.get('uno-1').querySelector('wokwi-arduino-uno'));
  assert.ok(editor.els.get('bb-1').querySelector('svg.bb'));
  const main = w.document.getElementById('main');
  w.document.getElementById('collapseBtn').click();
  assert.ok(main.classList.contains('parts-collapsed'));
  const css = readFileSync(join(root, 'src/styles.css'), 'utf8');
  assert.match(css, /\.main\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*var\(--parts-width\)/);
  assert.match(css, /\.main\.parts-collapsed\s*\{\s*--parts-width:\s*38px/);
});

test('ui: build a blinking LED circuit purely through pointer input, then run it', async () => {
  const { w, editor, sim, fire, scr, drag } = boot();
  const doc = w.document;

  // Add LED + resistor from the catalogue (Add buttons), then drag each onto the board.
  [...doc.querySelectorAll('.part-card')].find(c => c.textContent.includes('LED')).click();
  [...doc.querySelectorAll('.part-card')].find(c => c.textContent.includes('Resistor')).click();
  const led = editor.state.parts.find(p => p.type === 'led'), res = editor.state.parts.find(p => p.type === 'resistor');
  const bb = editor.partById('bb-1');
  const target = (part, pinId, holeId) => { const h = pinWorld(bb, holeId), p = pinWorld(part, pinId); return { x: part.x + (h.x - p.x) + 4, y: part.y + (h.y - p.y) - 3 }; };

  const dragPart = (part, pinId, holeId) => {
    // grab the body, not a lead end — pressing a lead end starts a wire now
    const off = part.type === 'resistor' ? (() => { const a = pinWorld(part, '1'), b = pinWorld(part, '2'); return { x: (a.x + b.x) / 2 - part.x, y: (a.y + b.y) / 2 - part.y }; })() : { x: 6, y: 6 };
    const t = target(part, pinId, holeId);
    drag({ x: part.x + off.x, y: part.y + off.y }, { x: t.x + off.x, y: t.y + off.y }, editor.els.get(part.id));
  };
  dragPart(led, 'A', 'E6');
  dragPart(res, '1', 'D5');
  let c = editor.getCircuit();
  assert.equal(c.attachments.size, 4, 'every lead should be seated after the drops');
  assert.equal(c.netOf(led.id, 'A'), c.netOf('bb-1', 'A6'));

  // Wiring works straight from Select mode: drag from a pin/hole to another — D13 → A6 (anode strip), A11 → GND
  assert.equal(editor.tool, 'select');
  const uno = editor.partById('uno-1');
  const wireDrag = (aPart, aPin, bPart, bPin) => {
    const a = pinWorld(editor.partById(aPart), aPin), b = pinWorld(editor.partById(bPart), bPin);
    drag(a, b, doc.getElementById('canvas'));
  };
  wireDrag('uno-1', '13', 'bb-1', 'A6');
  wireDrag('bb-1', 'A11', 'uno-1', 'GND.1');
  assert.equal(editor.state.wires.length, 2);
  assert.equal(editor.state.wires[1].color, '#22282c', 'GND wire is auto-coloured dark');

  // undo / redo
  editor.undo(); assert.equal(editor.state.wires.length, 1);
  editor.redo(); assert.equal(editor.state.wires.length, 2);

  // Run: LED must follow D13 (500 ms on / 500 ms off) and the Uno "L" LED too
  editor.setTool('select');
  await sim.start();
  assert.ok(sim.running);
  const ledEl = editor.els.get(led.id).querySelector('wokwi-led');
  const unoEl = editor.els.get('uno-1').querySelector('wokwi-arduino-uno');
  const samples = [], litBrightness = [];
  for (let i = 0; i < 40; i++) {                       // 40 × 50 ms of simulated time
    sim.mcu.run(0.05 * 16e6); sim.step();
    samples.push([sim.mcu.seconds, ledEl.value, unoEl.led13]);
    if (ledEl.value) litBrightness.push(ledEl.brightness);
  }
  const on = samples.filter(s => s[1]), off = samples.filter(s => !s[1]);
  assert.ok(on.length > 5 && off.length > 5, `LED should blink, got ${on.length} on / ${off.length} off`);
  assert.ok(samples.every(s => s[1] === s[2] || Math.abs(s[0] % 1 - 0.5) < 0.06 || s[0] % 1 < 0.06), 'external LED tracks D13');
  assert.ok(sim.result.warnings.length === 0);
  assert.ok(litBrightness.length > 5 && litBrightness.every(b => b > 0 && b <= 1), 'lit LED reports a brightness in (0,1]');
  sim.stop();
  assert.equal(ledEl.value, false);
});

test('ui: selecting a wire exposes style/colour/width and endpoint handles', () => {
  const { w, editor, drag } = boot();
  editor.setTool('wire');
  const a = pinWorld(editor.partById('uno-1'), '13'), b = pinWorld(editor.partById('bb-1'), 'A6');
  drag(a, b, w.document.getElementById('canvas'));
  const wire = editor.state.wires[0];
  editor.select({ kind: 'wire', id: wire.id });
  assert.equal(w.document.getElementById('wireEditor').hidden, false);
  assert.equal(w.document.querySelectorAll('[data-handle]').length, 2);        // straight: two end handles
  const style = w.document.getElementById('wireStyle');
  style.value = 'orthogonal'; style.dispatchEvent(new w.Event('change'));
  assert.equal(wire.style, 'orthogonal');
  assert.equal(w.document.querySelectorAll('[data-handle]').length, 3);        // + bend handle
  style.value = 'curve'; style.dispatchEvent(new w.Event('change'));
  assert.equal(w.document.querySelectorAll('[data-handle="mid"]').length, 1);
});

test('ui: rotate re-seats a component and delete cleans up wires', () => {
  const { editor } = boot();
  editor.addPart('led');
  const led = editor.state.parts.find(p => p.type === 'led');
  editor.select({ kind: 'part', id: led.id });
  editor.rotateSelected();
  assert.equal(led.rot, 90);
  editor.state.wires.push({ id: 'wx', a: { part: led.id, pin: 'A' }, b: { part: 'uno-1', pin: '13' }, style: 'straight', color: '#000', width: 3, bend: .5, sag: null });
  editor.deleteSelected();
  assert.equal(editor.state.wires.length, 0);
  assert.equal(editor.state.parts.some(p => p.id === led.id), false);
});

test('ui: the code dock drives the circuit — a sketch for D12 lights an LED on D12, errors block Run', async () => {
  const { w, editor, sim, code, fire, scr, drag } = boot();
  const doc = w.document;
  assert.ok(doc.getElementById('codeDock').classList.contains('collapsed'));
  doc.getElementById('codeToggle').click();
  assert.ok(!doc.getElementById('codeDock').classList.contains('collapsed'));
  assert.match(doc.getElementById('codeStatus').textContent, /Not compiled/);

  [...doc.querySelectorAll('.part-card')].find(c => c.textContent.includes('LED')).click();
  const led = editor.state.parts.find(p => p.type === 'led');
  const bb = editor.partById('bb-1');
  const seat = (part, pinId, holeId) => { const h = pinWorld(bb, holeId), p = pinWorld(part, pinId); return { x: part.x + (h.x - p.x) + 4, y: part.y + (h.y - p.y) - 3 }; };
  const t = seat(led, 'A', 'E6');
  drag({ x: led.x + 6, y: led.y + 6 }, { x: t.x + 6, y: t.y + 6 }, editor.els.get(led.id));
  editor.setTool('wire');
  const wireDrag = (aPart, aPin, bPart, bPin) => drag(pinWorld(editor.partById(aPart), aPin), pinWorld(editor.partById(bPart), bPin), doc.getElementById('canvas'));
  wireDrag('uno-1', '12', 'bb-1', 'A6');            // anode ← D12 (direct: this test only cares about D12 vs D13)
  wireDrag('bb-1', 'A5', 'uno-1', 'GND.1');         // cathode column → GND
  editor.setTool('select');
  const ledEl = editor.els.get(led.id).querySelector('wokwi-led');
  const sample = () => { const seen = []; for (let i = 0; i < 40; i++) { sim.mcu.run(0.05 * 16e6); sim.step(); seen.push(ledEl.value); } return seen; };

  await sim.start();                                       // default Blink only toggles D13 → D12 LED stays off
  assert.ok(sim.running);
  assert.match(doc.getElementById('codeStatus').textContent, /Compiled · \d+ bytes/);
  assert.ok(sample().every(v => v === false), 'D12 LED must stay dark under the default D13 Blink sketch');
  sim.stop();

  code.source = sketch('d12-blink');
  await sim.start();
  assert.ok(sim.running);
  const seen = sample();
  assert.ok(seen.filter(Boolean).length > 8 && seen.filter(v => !v).length > 8, 'D12 LED blinks under the custom sketch');
  sim.stop();

  code.source = sketch('broken');
  await sim.start();
  assert.equal(sim.running, false, 'a sketch with a compile error must not run');
  assert.match(doc.getElementById('codeStatus').textContent, /Compile error/);
  assert.match(doc.getElementById('outputPane').textContent, /Compilation failed · 1 error/);
  assert.match(doc.getElementById('outputPane').textContent, /sketch\.ino:3:3: error: expected ';' before 'undefinedThing'/);
  assert.equal(doc.querySelectorAll('#codeGutter .gn.err').length, 1, 'the failing line is marked in the gutter');
  assert.equal(doc.querySelector('#codeGutter .gn.err').textContent, '3');
  assert.match(doc.getElementById('status').textContent, /Compile failed — line 3/);
});

test('ui: right-click a resistor to edit its value — bands follow, invalid input is refused, Esc reverts, undo works', () => {
  const { w, editor } = boot();
  const doc = w.document;
  editor.addPart('resistor');
  const res = editor.state.parts.find(p => p.type === 'resistor');
  const model = () => editor.els.get(res.id).querySelector('wokwi-resistor');
  const box = doc.getElementById('resEditor'), input = doc.getElementById('resInput'), msg = doc.getElementById('resMsg');
  assert.equal(res.ohms, 220);
  assert.equal(String(model().getAttribute('value')), '220');
  assert.equal(box.hidden, true);

  const ctx = () => editor.els.get(res.id).dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200, button: 2 }));
  const type = v => { input.value = v; input.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const key = k => input.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  assert.equal(ctx(), false, 'the native context menu is suppressed on a resistor');
  assert.equal(box.hidden, false);
  assert.equal(input.value, '220');
  assert.equal(doc.querySelectorAll('#resBands i').length, 4);

  type('4.7k');                                        // live preview, not committed yet
  assert.equal(String(model().value), '4700');
  assert.match(msg.textContent, /4\.7 kΩ/);
  assert.equal(doc.querySelectorAll('#resBands i')[0].style.background.replace(/\s/g, ''), 'rgb(252,248,0)'.replace(/\s/g, ''));
  key('Enter');
  assert.equal(box.hidden, true);
  assert.equal(res.ohms, 4700);
  assert.match(doc.getElementById('workspaceList').textContent, /4\.7 kΩ/);
  assert.match(doc.getElementById('overlay').innerHTML, /4\.7 kΩ/, 'value label is drawn next to the part');
  assert.equal(editor.getCircuit().elements.find(e => e.partId === res.id).ohms, 4700, 'the solver sees the new value');

  ctx(); type('abc');                                  // invalid → refused, part keeps its value
  assert.equal(msg.classList.contains('bad'), true);
  assert.equal(res.ohms, 4700);
  key('Enter');
  assert.equal(box.hidden, false, 'invalid input keeps the editor open');
  type('10k'); assert.equal(res.ohms, 10000);
  key('Escape');                                       // cancel → reverts the preview
  assert.equal(box.hidden, true); assert.equal(res.ohms, 4700); assert.equal(String(model().value), '4700');

  ctx(); doc.querySelector('#resPresets button[data-ohms="330"]').click();   // preset applies immediately
  assert.equal(res.ohms, 330); assert.equal(box.hidden, true);

  const now = () => editor.partById(res.id);             // undo/redo replace the part objects
  editor.undo();                                       // one undo step per edit
  assert.equal(now().ohms, 4700); assert.equal(String(model().value), '4700');
  editor.redo(); assert.equal(now().ohms, 330); assert.equal(String(model().value), '330');
});

/* ───────────── catalogue batch 1 in the real UI code ───────────── */
const wireOf = (id, a, b) => ({ id, a, b, style: 'straight', color: '#22282c', width: 3, bend: .5, sag: null });

test('ui: catalogue lists the new parts by category, and each can be added', () => {
  const { w, editor } = boot();
  const doc = w.document;
  const titles = [...doc.querySelectorAll('#catalog .group-title')].map(e => e.textContent);
  assert.deepEqual(titles, ['Boards', 'Prototyping', 'Basic', 'Input', 'Displays', 'Sensors', 'Motors', 'Power', 'Semiconductors', 'Biosignal', 'Passives', 'Logic', 'Chips', 'Sound', 'My parts']);
  const names = [...doc.querySelectorAll('#catalog .part-card b')].map(e => e.textContent);
  for (const n of ['Servo Motor', 'Ultrasonic Sensor HC-SR04', 'Stepper 28BYJ-48 + ULN2003', 'Rotary Encoder (KY-040)', 'NPN transistor 2N2222', 'Buzzer', 'LED Bar Graph (10 segments)', 'Relay (KS2E-M-DC5)']) assert.ok(names.includes(n), `${n} ships in the default catalogue`);
  assert.equal(doc.querySelectorAll('#catalog .part-card .edit-part').length, 0, 'built-in parts have no edit button');
  editor.addPart('servo');
  assert.ok(editor.state.parts.some(p => p.type === 'servo'));
  assert.ok(editor.els.get(editor.state.parts.find(p => p.type === 'servo').id).querySelector('wokwi-servo'), 'the servo is the real wokwi-servo element');
  assert.ok(![...doc.querySelectorAll('#pcTemplate option')].some(o => o.value === 'servo-sg90'), 'popular parts are not in the template list');
  for (const n of ['RGB LED', 'Slide Switch', '7-Segment Display', 'PIR Motion Sensor', 'MPU-6050 Accelerometer + Gyro', 'OLED Display 128×64 (SSD1306)']) assert.ok(names.includes(n), `${n} in catalogue`);
  for (const type of ['rgb-led', 'slide-switch', 'seven-segment', 'pir-sensor', 'mpu6050', 'ssd1306', 'arduino-nano', 'arduino-mega', 'dht', 'lcd1602', 'dc-motor', 'l298n', 'battery']) {
    editor.addPart(type);
    assert.ok(editor.state.parts.some(p => p.type === type));
    assert.ok(editor.els.get(editor.state.parts.find(p => p.type === type).id).querySelector(PART_DEFS[type].tag), `${type} renders ${PART_DEFS[type].tag}`);
  }
  // searching finds them by what people call them
  const search = doc.getElementById('partsSearch');
  search.value = 'motion'; search.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.deepEqual([...doc.querySelectorAll('#catalog .part-card b')].map(e => e.textContent), ['PIR Motion Sensor', 'MPU-6050 Accelerometer + Gyro']);
  search.value = 'gy-521'; search.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(doc.querySelectorAll('#catalog .part-card').length, 1);
});

test('ui: right-click an LED to change its colour — model, workspace list and undo follow', () => {
  const { w, editor } = boot();
  const doc = w.document;
  editor.addPart('led');
  const led = () => editor.state.parts.find(p => p.type === 'led');
  const id = led().id, model = () => editor.els.get(id).querySelector('wokwi-led');
  assert.equal(led().color, 'red');
  const box = doc.getElementById('ledEditor');
  assert.equal(editor.els.get(id).dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200, button: 2 })), false);
  assert.equal(box.hidden, false);
  assert.equal(doc.getElementById('resEditor').hidden, true, 'the resistor editor stays closed for an LED');
  doc.querySelector('#ledSwatches button[data-color="blue"]').click();
  assert.equal(box.hidden, true);
  assert.equal(led().color, 'blue'); assert.equal(model().color, 'blue');
  assert.match(doc.getElementById('workspaceList').textContent, /LED · Blue/);
  assert.equal(editor.getCircuit().elements.find(e => e.partId === id).vf, 3.1, 'the solver uses the blue forward voltage');
  editor.undo();
  assert.equal(editor.partById(id).color, 'red'); assert.equal(model().color, 'red');
});

test('ui: clicking a slide switch flips it (once), and the circuit follows', () => {
  const { w, editor, drag, scr } = boot();
  editor.addPart('slide-switch');
  const sw = () => editor.state.parts.find(p => p.type === 'slide-switch');
  const id = sw().id, model = () => editor.els.get(id).querySelector('wokwi-slide-switch');
  assert.equal(sw().pos, 0);
  const swEl = editor.els.get(id), r = { x: sw().x + 8, y: sw().y + 8 };
  drag(r, r, swEl);                                                    // press + release without moving = a click
  assert.equal(sw().pos, 1); assert.equal(model().value, 1);
  const el = editor.getCircuit().elements.find(e => e.partId === id);
  assert.equal(el.b, editor.getCircuit().netOf(id, '3'), 'common now joins throw 3');
  drag(r, r, swEl); assert.equal(sw().pos, 0);
  // a real drag moves it and leaves the position alone
  const before = { x: sw().x, y: sw().y };
  drag(r, { x: r.x + 40, y: r.y + 30 }, swEl);
  assert.equal(sw().pos, 0); assert.ok(sw().x !== before.x || sw().y !== before.y);
  editor.undo(); editor.undo();                                       // undo the move… and the earlier toggles are separate history steps
  assert.ok(editor.partById(id));
});

test('ui: a sketch drives an RGB LED and a 7-segment digit through the whole stack', async () => {
  const { w, editor, sim, code } = boot();
  editor.addPart('rgb-led'); editor.addPart('seven-segment');
  const rgb = editor.state.parts.find(p => p.type === 'rgb-led'), seg = editor.state.parts.find(p => p.type === 'seven-segment');
  const rgbEl = editor.els.get(rgb.id).querySelector('wokwi-rgb-led'), segEl = editor.els.get(seg.id).querySelector('wokwi-7segment');
  // move them off the breadboard so their leads stay independent, then wire by hand
  rgb.x = 40; rgb.y = 300; seg.x = 200; seg.y = 300; editor.syncParts(); editor.markDirty();
  editor.state.wires.push(wireOf('g1', { part: rgb.id, pin: 'COM' }, { part: 'uno-1', pin: 'GND.1' }), wireOf('g2', { part: seg.id, pin: 'COM.1' }, { part: 'uno-1', pin: 'GND.1' }));
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'].forEach((s, i) => editor.state.wires.push(wireOf(`s${s}`, { part: 'uno-1', pin: String(2 + i) }, { part: seg.id, pin: s })));
  [['R', 'A0'], ['G', 'A1'], ['B', 'A2']].forEach(([ch, pin]) => editor.state.wires.push(wireOf(`c${ch}`, { part: 'uno-1', pin }, { part: rgb.id, pin: ch })));
  editor.markDirty();
  code.source = sketch('seg-rgb');
  await sim.start();
  assert.ok(sim.running, 'sketch compiled and started');
  sim.mcu.run(0.02 * 16e6); sim.step();
  assert.deepEqual([...segEl.values], [1, 1, 1, 1, 0, 0, 1, 0]);
  assert.ok(rgbEl.ledRed > 0 && rgbEl.ledBlue > 0 && rgbEl.ledGreen === 0, `RGB shows magenta: ${rgbEl.ledRed}/${rgbEl.ledGreen}/${rgbEl.ledBlue}`);
  sim.stop();
  assert.deepEqual([...segEl.values], [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(rgbEl.ledRed, 0);
});

test('ui: PIR — click while running toggles motion and drives OUT; a sketch reads it', async () => {
  const { w, editor, sim, code, drag } = boot();
  editor.addPart('pir-sensor'); editor.addPart('led');
  const pir = editor.state.parts.find(p => p.type === 'pir-sensor'), led = editor.state.parts.find(p => p.type === 'led');
  pir.x = 60; pir.y = 320; led.x = 300; led.y = 320; editor.syncParts(); editor.markDirty();
  editor.state.wires.push(wireOf('v', { part: 'uno-1', pin: '5V' }, { part: pir.id, pin: 'VCC' }), wireOf('g', { part: 'uno-1', pin: 'GND.1' }, { part: pir.id, pin: 'GND' }),
    wireOf('o', { part: pir.id, pin: 'OUT' }, { part: 'uno-1', pin: '2' }), wireOf('a', { part: 'uno-1', pin: '13' }, { part: led.id, pin: 'A' }), wireOf('c', { part: led.id, pin: 'C' }, { part: 'uno-1', pin: 'GND.1' }));
  editor.markDirty();
  code.source = sketch('pir-led');
  const ledEl = editor.els.get(led.id).querySelector('wokwi-led'), pirEl = editor.els.get(pir.id);
  const click = () => { const p = { x: pir.x + 20, y: pir.y + 20 }; drag(p, p, pirEl); };
  await sim.start(); assert.ok(sim.running);
  const settle = () => { for (let i = 0; i < 3; i++) { sim.mcu.run(0.01 * 16e6); sim.step(); } };
  settle(); assert.equal(ledEl.value, false, 'no motion → LED off');
  click(); settle();
  assert.ok(pirEl.classList.contains('triggered')); assert.equal(ledEl.value, true, 'motion → sketch sees HIGH → LED on');
  click(); settle();
  assert.ok(!pirEl.classList.contains('triggered')); assert.equal(ledEl.value, false);
  click(); sim.stop();
  assert.ok(!pirEl.classList.contains('triggered'), 'stopping clears the trigger');
});

/* ───────────── analog batch in the real UI code ───────────── */
test('ui: right-click a potentiometer — slider, presets, live value, label and undo', () => {
  const { w, editor } = boot();
  const doc = w.document;
  editor.addPart('potentiometer');
  const pot = () => editor.state.parts.find(p => p.type === 'potentiometer');
  const id = pot().id, model = () => editor.els.get(id).querySelector('wokwi-potentiometer');
  assert.equal(pot().level, 50); assert.equal(Math.round(model().value), 512);
  const box = doc.getElementById('valEditor'), slider = doc.getElementById('valSlider');
  assert.equal(editor.els.get(id).dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200, button: 2 })), false);
  assert.equal(box.hidden, false);
  assert.equal(doc.getElementById('valTitle').textContent, 'Potentiometer');
  assert.equal(doc.getElementById('resEditor').hidden, true); assert.equal(doc.getElementById('ledEditor').hidden, true);
  slider.value = '80'; slider.dispatchEvent(new w.Event('input', { bubbles: true }));       // dragging: live, not yet in history
  assert.equal(pot().level, 80); assert.equal(Math.round(model().value), 818);
  assert.equal(doc.getElementById('valReadout').textContent, '80 %');
  slider.dispatchEvent(new w.Event('change', { bubbles: true }));                           // released: one history step
  assert.match(doc.getElementById('overlay').innerHTML, /80 %/, 'value label on the canvas');
  doc.querySelector('#valPresets button[data-v="25"]').click();
  assert.equal(pot().level, 25);
  assert.equal(editor.getCircuit().elements.filter(e => e.partId === id && e.kind === 'R').map(e => Math.round(e.ohms)).sort((a, b) => a - b).join(), '2500,7500', 'track split 25 / 75 %');
  editor.undo(); assert.equal(editor.partById(id).level, 80);
  editor.undo(); assert.equal(editor.partById(id).level, 50); assert.equal(Math.round(model().value), 512);
});

test('ui: light and temperature values — log lux slider, presets, sensor labels', () => {
  const { w, editor } = boot();
  const doc = w.document;
  editor.addPart('ldr-module'); editor.addPart('ntc-sensor');
  const ldr = editor.state.parts.find(p => p.type === 'ldr-module'), ntc = editor.state.parts.find(p => p.type === 'ntc-sensor');
  const open = part => editor.els.get(part.id).dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200, button: 2 }));
  const slider = doc.getElementById('valSlider');
  open(ldr);
  assert.equal(doc.getElementById('valTitle').textContent, 'Light level'); assert.equal(doc.getElementById('valReadout').textContent, '500 lux');
  slider.value = '0'; slider.dispatchEvent(new w.Event('input', { bubbles: true })); assert.equal(editor.partById(ldr.id).lux, 0.1);
  slider.value = '100'; slider.dispatchEvent(new w.Event('input', { bubbles: true })); assert.equal(editor.partById(ldr.id).lux, 100000);
  slider.value = '50'; slider.dispatchEvent(new w.Event('input', { bubbles: true })); assert.ok(Math.abs(Math.log10(editor.partById(ldr.id).lux) - 2) < 0.01, 'middle of a log slider = 100 lux');
  doc.querySelector('#valPresets button[data-v="50000"]').click(); assert.equal(editor.partById(ldr.id).lux, 50000);
  open(ntc);
  assert.equal(doc.getElementById('valTitle').textContent, 'Temperature');
  doc.querySelector('#valPresets button[data-v="40"]').click(); assert.equal(editor.partById(ntc.id).temp, 40);
  const labels = doc.getElementById('overlay').innerHTML;
  assert.match(labels, /50000 lux/); assert.match(labels, /40 °C/);
  const ntcOhms = editor.getCircuit().elements.filter(e => e.partId === ntc.id && e.kind === 'R').map(e => e.ohms).sort((a, b) => a - b);
  assert.ok(ntcOhms[0] < 6000 && ntcOhms[1] === 10000, `warm NTC is below its 10 kΩ nominal: ${ntcOhms}`);
});

test('ui: potentiometer → analogRead → analogWrite dims a real LED (PWM averaged), even while turning the pot live', async () => {
  const { w, editor, sim, code } = boot();
  editor.addPart('potentiometer'); editor.addPart('led'); editor.addPart('resistor');
  const pot = editor.state.parts.find(p => p.type === 'potentiometer'), led = editor.state.parts.find(p => p.type === 'led'), res = editor.state.parts.find(p => p.type === 'resistor');
  pot.x = 40; pot.y = 320; led.x = 300; led.y = 330; res.x = 200; res.y = 340; editor.syncParts(); editor.markDirty();
  editor.state.wires.push(
    wireOf('v', { part: 'uno-1', pin: '5V' }, { part: pot.id, pin: 'VCC' }), wireOf('g', { part: 'uno-1', pin: 'GND.1' }, { part: pot.id, pin: 'GND' }), wireOf('s', { part: pot.id, pin: 'SIG' }, { part: 'uno-1', pin: 'A0' }),
    wireOf('a', { part: 'uno-1', pin: '9' }, { part: res.id, pin: '1' }), wireOf('b', { part: res.id, pin: '2' }, { part: led.id, pin: 'A' }), wireOf('c', { part: led.id, pin: 'C' }, { part: 'uno-1', pin: 'GND.2' }));
  editor.markDirty();
  code.source = sketch('pot-dimmer');
  const ledEl = editor.els.get(led.id).querySelector('wokwi-led');
  await sim.start(); assert.ok(sim.running);
  const settle = () => { for (let i = 0; i < 6; i++) { sim.mcu.run(0.02 * 16e6); sim.step(); } return ledEl.brightness; };
  const at = level => { editor.setPartProp(pot.id, 'level', level, { commit: false }); return settle(); };
  const b0 = at(0), b25 = at(25), b50 = at(50), b100 = at(100);
  assert.ok(b0 === 0 || b0 < 0.02, `pot at 0 → dark (${b0})`);
  assert.ok(b25 > 0.15 && b25 < 0.4, `25 % → ${b25}`);
  assert.ok(b50 > 0.45 && b50 < 0.8, `50 % → ${b50}`);
  assert.ok(b100 > 0.95, `100 % → ${b100}`);
  assert.ok(b25 < b50 && b50 < b100);
  at(50); sim.refreshTray();
  assert.match(w.document.getElementById('simPin').textContent, /D9~\d+%/, 'tray shows the PWM duty');
  sim.stop();
});

test('ui: the photoresistor module lights its own DO / power LEDs and a sketch reads AO and DO', async () => {
  const { w, editor, sim, code } = boot();
  editor.addPart('ldr-module'); editor.addPart('led');
  const ldr = editor.state.parts.find(p => p.type === 'ldr-module'), led = editor.state.parts.find(p => p.type === 'led');
  ldr.x = 40; ldr.y = 300; led.x = 330; led.y = 330; editor.syncParts(); editor.markDirty();
  editor.state.wires.push(
    wireOf('v', { part: 'uno-1', pin: '5V' }, { part: ldr.id, pin: 'VCC' }), wireOf('g', { part: 'uno-1', pin: 'GND.1' }, { part: ldr.id, pin: 'GND' }), wireOf('ao', { part: ldr.id, pin: 'AO' }, { part: 'uno-1', pin: 'A0' }),
    wireOf('a', { part: 'uno-1', pin: '13' }, { part: led.id, pin: 'A' }), wireOf('c', { part: led.id, pin: 'C' }, { part: 'uno-1', pin: 'GND.2' }));
  editor.markDirty();
  code.source = sketch('ldr-nightlight');
  const ledEl = editor.els.get(led.id).querySelector('wokwi-led'), mod = editor.els.get(ldr.id).querySelector('wokwi-photoresistor-sensor');
  await sim.start(); assert.ok(sim.running);
  const settle = () => { for (let i = 0; i < 4; i++) { sim.mcu.run(0.02 * 16e6); sim.step(); } };
  editor.setPartProp(ldr.id, 'lux', 5, { commit: false }); settle();
  assert.equal(mod.ledPower, true); assert.equal(mod.ledDO, true, 'dark → DO'); assert.equal(ledEl.value, true, 'dark → AO high → sketch turns the LED on');
  editor.setPartProp(ldr.id, 'lux', 50000, { commit: false }); settle();
  assert.equal(mod.ledDO, false); assert.equal(ledEl.value, false, 'bright → AO low → LED off');
  sim.stop(); assert.equal(mod.ledPower, false);
});


/* ───────────── V1: real compiler UI — output pane, Verify, Serial Monitor ───────────── */
test('ui: Verify compiles without running; the Output pane shows the real compiler report', async () => {
  const { w, code, sim } = boot();
  const doc = w.document, out = () => doc.getElementById('outputPane').textContent;
  assert.match(out(), /Compiler output appears here/);
  code.source = sketch('blink');                                   // not a bundled example → goes through the (fixture) compiler
  assert.match(doc.getElementById('codeStatus').textContent, /Not compiled|Edited/);
  doc.getElementById('codeCompile').click();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(sim.running, false, 'Verify never runs');
  assert.match(doc.getElementById('codeStatus').textContent, /Compiled · 924 bytes \(3 %\) of flash · 9 bytes \(0 %\) of RAM/);
  assert.match(out(), /Compiled successfully/); assert.match(out(), /Sketch uses 924 bytes/);
  code.source = sketch('blink') + '\n// edit';
  assert.match(doc.getElementById('codeStatus').textContent, /Edited — press Verify or Run/, 'stale status after an edit');
});

test('ui: compiler errors are clickable and jump to the line', async () => {
  const { w, code } = boot();
  const doc = w.document, ta = doc.getElementById('codeInput');
  code.source = sketch('broken');
  await code.compile();
  const link = doc.querySelector('#outputPane .out-line.diag.error');
  assert.ok(link, 'error line rendered as a link'); assert.equal(link.dataset.line, '3');
  link.click();
  assert.equal(ta.value.slice(ta.selectionStart, ta.selectionEnd), '  undefinedThing();', 'line 3 is selected');
  assert.ok(doc.getElementById('codeDock').classList.contains('has-error'));
  code.source = sketch('broken') + ' ';                             // editing clears the stale markers
  assert.equal(doc.querySelectorAll('#codeGutter .gn.err').length, 0);
});

test('ui: an unreachable compile service says how to start it — and bundled examples still run', async () => {
  const { w, editor, sim, code } = boot();
  const doc = w.document;
  code.source = 'void setup() {}\nvoid loop() { /* not a fixture */ }\n';
  await sim.start();
  assert.equal(sim.running, false);
  assert.match(doc.getElementById('outputPane').textContent, /npm run server/);
  assert.match(doc.getElementById('codeStatus').textContent, /Compile service not reachable/);
  assert.match(doc.getElementById('status').textContent, /Could not reach the compile service|offline|compile service/i);
  assert.equal(doc.getElementById('runBtn').disabled, false, 'the Run button is usable again');
  code.source = DEFAULT_SKETCH;
  await sim.start();
  assert.ok(sim.running, 'the bundled Blink example runs with no compile service');
  sim.stop();
});

test('ui: while compiling the Run button shows progress, extra clicks are ignored, and a newer compile supersedes an older one', async () => {
  const gates = [];
  const controlled = files => new Promise(res => gates.push(() => res(fixtureCompile(files))));
  const { w, sim, code } = boot(controlled);
  const btn = w.document.getElementById('runBtn'), label = () => w.document.getElementById('runLabel').textContent;
  code.source = sketch('blink');
  const first = sim.start();
  assert.equal(sim.compiling, true); assert.equal(btn.disabled, true); assert.equal(label(), 'Compiling');
  assert.match(w.document.getElementById('codeStatus').textContent, /Compiling/);
  await sim.start();                                       // a second click while compiling does nothing
  assert.equal(gates.length, 1, 'only one compile in flight');
  gates[0](); await first;
  assert.ok(sim.running); assert.equal(btn.disabled, false); assert.equal(label(), 'Stop');
  sim.stop(); assert.equal(label(), 'Run');

  const older = code.compile(), newer = code.compile();    // the second supersedes the first
  gates[1](); gates[2]();
  assert.equal(await older, null, 'the older build is dropped');
  assert.ok((await newer).ok);
});

test('ui: Serial Monitor — real Serial.println output arrives byte by byte at the firmware’s baud rate, and typed text reaches Serial.read()', async () => {
  const { w, sim, code } = boot();
  const doc = w.document;
  code.source = sketch('serial-echo');
  await sim.start(); assert.ok(sim.running);
  assert.equal(code.serial.text, '');
  sim.mcu.run(0.004 * 16e6);
  assert.ok(code.serial.text.length > 0 && code.serial.text.length < 19, `paced: ${JSON.stringify(code.serial.text)}`);
  sim.mcu.run(0.05 * 16e6); sim.step();
  assert.equal(code.serial.text, 'Hello from Arduino\r\n');
  code.serial.flush();
  assert.equal(doc.getElementById('serialLog').textContent, 'Hello from Arduino\r\n');
  assert.match(doc.getElementById('serialBaud').textContent, /^96\d\d baud$/);
  assert.ok(doc.getElementById('tabSerial').classList.contains('unread'), 'unread dot while another tab is showing');
  doc.getElementById('tabSerial').click();
  assert.equal(doc.getElementById('serialPane').hidden, false); assert.equal(doc.getElementById('outputPane').hidden, true);
  assert.ok(!doc.getElementById('tabSerial').classList.contains('unread'));
  // type into the monitor → Send
  const input = doc.getElementById('serialInput');
  input.value = 'led on'; doc.getElementById('serialEol').value = 'nl';
  doc.getElementById('serialSend').click();
  assert.equal(input.value, '', 'sent text is cleared');
  sim.mcu.run(0.2 * 16e6);
  assert.equal(code.serial.text, 'Hello from Arduino\r\nLED ON\n');
  doc.getElementById('serialClear').click();
  assert.equal(code.serial.text, ''); assert.equal(doc.getElementById('serialLog').textContent, '');
  sim.stop();
});

test('ui: Serial Monitor refuses to send when nothing is running, and a fresh Run clears the old log', async () => {
  const { w, sim, code } = boot();
  const doc = w.document;
  doc.getElementById('serialInput').value = 'hi'; doc.getElementById('serialSend').click();
  assert.match(doc.getElementById('codeStatus').textContent, /not running/);
  assert.equal(doc.getElementById('serialInput').value, 'hi', 'text is kept so nothing is lost');
  code.source = sketch('serial-echo'); await sim.start();
  sim.mcu.run(0.05 * 16e6); assert.match(code.serial.text, /^Hello/);
  sim.stop(); await sim.start();
  assert.equal(code.serial.text, '', 'log restarts with the new run');
  sim.stop();
});

test('ui: real C++ output (float / long / String) shows up in the monitor', async () => {
  const { sim, code } = boot();
  code.source = sketch('real-cpp'); await sim.start();
  sim.mcu.run(0.4 * 16e6);
  assert.equal(code.serial.text, '1.4142\r\n300000\r\n25\r\nABC42\r\nearly\r\n');
  sim.stop();
});


/* ───────────── V1: .ino projects (multi-file) ───────────── */
// values coming out of the jsdom window live in another realm; compare their JSON form
const plain = x => JSON.parse(JSON.stringify(x));
const deepEq = (a, b, msg) => assert.deepEqual(plain(a), plain(b), msg);
const tabNames = doc => [...doc.querySelectorAll('#fileTabs .ftab')].map(t => t.dataset.name);
const addFileVia = (w, name) => {                              // the + button, then type the name and press Enter
  const doc = w.document; doc.getElementById('fileAdd').click();
  const input = doc.querySelector('#fileTabs .ftab-input'); input.value = name;
  input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
};

test('ui: a new project is one sketch.ino tab; + adds .h/.cpp/.ino files with sensible starters', () => {
  const { w, code } = boot();
  const doc = w.document, ta = doc.getElementById('codeInput');
  deepEq(tabNames(doc), ['sketch.ino']);
  assert.equal(doc.querySelectorAll('#fileTabs .ftab-x').length, 0, 'the only file cannot be deleted');
  addFileVia(w, 'config.h');
  deepEq(tabNames(doc), ['sketch.ino', 'config.h']);
  assert.equal(code.active, 'config.h'); assert.equal(ta.value, '#pragma once\n\n', 'header starter');
  addFileVia(w, 'util.cpp'); assert.equal(ta.value, '#include <Arduino.h>\n\n');
  addFileVia(w, 'extra.ino'); assert.equal(code.active, 'extra.ino');
  deepEq(code.files.map(f => f.name), ['sketch.ino', 'config.h', 'util.cpp', 'extra.ino']);
  assert.ok(doc.querySelector('#fileTabs .ftab.on').dataset.name === 'extra.ino');
});

test('ui: file names are validated and unique; bad input keeps the project unchanged', () => {
  const { w, code } = boot();
  const doc = w.document;
  for (const bad of ['../evil.h', 'notes.txt', 'a b.h', 'x', '.h', 'a/b.h']) { addFileVia(w, bad); assert.match(doc.getElementById('codeStatus').textContent, /not a valid file name/, bad); assert.equal(code.files.length, 1, bad); }
  addFileVia(w, 'a.h'); addFileVia(w, 'a.h');
  assert.match(doc.getElementById('codeStatus').textContent, /already exists/); assert.equal(code.files.length, 2);
  addFileVia(w, '');                                             // empty = cancel, no error, no file
  assert.equal(code.files.length, 2);
});

test('ui: each file keeps its own text while you switch tabs; only the tab you edit changes', () => {
  const { w, code } = boot();
  const doc = w.document, ta = doc.getElementById('codeInput');
  addFileVia(w, 'config.h');
  ta.value = '#define LED 7\n'; ta.dispatchEvent(new w.Event('input', { bubbles: true }));
  doc.querySelector('#fileTabs .ftab[data-name="sketch.ino"] .ftab-name').click();
  assert.equal(code.active, 'sketch.ino'); assert.match(ta.value, /void setup/);
  ta.value = 'void setup() { pinMode(LED, OUTPUT); }\nvoid loop() {}\n'; ta.dispatchEvent(new w.Event('input', { bubbles: true }));
  doc.querySelector('#fileTabs .ftab[data-name="config.h"] .ftab-name').click();
  assert.equal(ta.value, '#define LED 7\n');
  deepEq(code.files.map(f => f.content), ['void setup() { pinMode(LED, OUTPUT); }\nvoid loop() {}\n', '#define LED 7\n']);
  assert.equal(code.source, code.files[0].content, 'source = the main .ino');
});

test('ui: rename (double-click) and delete (×) — including the rules that keep a valid sketch', () => {
  const { w, code } = boot();
  const doc = w.document;
  addFileVia(w, 'old.h');
  const renameVia = (from, to) => {
    doc.querySelector(`#fileTabs .ftab[data-name="${from}"] .ftab-name`).dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }));
    const input = doc.querySelector('#fileTabs .ftab-input'); input.value = to;
    input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  };
  renameVia('old.h', 'new.h');
  deepEq(tabNames(doc), ['sketch.ino', 'new.h']); assert.equal(code.active, 'new.h'); assert.equal(code.files[1].content, '#pragma once\n\n');
  renameVia('new.h', 'sketch.ino'); assert.match(doc.getElementById('codeStatus').textContent, /already exists/);
  renameVia('sketch.ino', 'sketch.h'); assert.match(doc.getElementById('codeStatus').textContent, /needs at least one \.ino/);
  deepEq(tabNames(doc), ['sketch.ino', 'new.h']);
  doc.querySelector('#fileTabs .ftab[data-name="new.h"] .ftab-x').click();
  deepEq(tabNames(doc), ['sketch.ino']); assert.equal(code.active, 'sketch.ino');
  assert.equal(doc.getElementById('codeInput').value, code.files[0].content);
  // with two .ino files, either can go; the last one cannot
  addFileVia(w, 'more.ino');
  doc.querySelector('#fileTabs .ftab[data-name="sketch.ino"] .ftab-x').click();
  deepEq(tabNames(doc), ['more.ino']);
  assert.equal(doc.querySelectorAll('#fileTabs .ftab-x').length, 0);
});

test('ui: the whole project is compiled — every file is sent; errors in a header mark its tab and jump there', async () => {
  let sent = null;
  const stub = async files => {
    sent = files;
    return { ok: false, error: 'Compilation failed.', size: null,
      output: "config.h:2:1: error: 'oops' does not name a type\n oops;\n ^~~~\nsketch.ino:1:10: warning: unused\n",
      diagnostics: [{ file: 'config.h', line: 2, col: 1, severity: 'error', message: "'oops' does not name a type" }, { file: 'sketch.ino', line: 1, col: 10, severity: 'warning', message: 'unused' }] };
  };
  const { w, code } = boot(stub);
  const doc = w.document, ta = doc.getElementById('codeInput');
  addFileVia(w, 'config.h');
  ta.value = '#pragma once\noops;\n'; ta.dispatchEvent(new w.Event('input', { bubbles: true }));
  doc.querySelector('#fileTabs .ftab[data-name="sketch.ino"] .ftab-name').click();
  await code.compile();
  deepEq(sent.map(f => f.name), ['sketch.ino', 'config.h']); assert.equal(sent[1].content, '#pragma once\noops;\n');
  assert.ok(doc.querySelector('#fileTabs .ftab[data-name="config.h"]').classList.contains('has-error'), 'the failing file’s tab is flagged');
  assert.ok(!doc.querySelector('#fileTabs .ftab[data-name="sketch.ino"]').classList.contains('has-error'), 'a warning is not an error');
  assert.equal(code.active, 'sketch.ino');
  const link = doc.querySelector('#outputPane .out-line.diag.error');
  assert.equal(link.dataset.file, 'config.h'); assert.equal(link.dataset.line, '2');
  link.click();
  assert.equal(code.active, 'config.h', 'clicking jumps to the other file');
  assert.equal(code.editor.selectionText, 'oops;');
  assert.equal(doc.querySelector('#codeGutter .gn.err').textContent, '2');
  ta.value = '#pragma once\noops;\nint x;\n'; ta.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(doc.querySelectorAll('.ftab.has-error').length, 0, 'editing clears stale error markers');
});

test('ui: the project survives a reload (localStorage), older single-sketch saves migrate, and project files round-trip', () => {
  const first = boot();
  addFileVia(first.w, 'lib.h'); first.w.document.getElementById('codeInput').value = '// lib\n';
  first.w.document.getElementById('codeInput').dispatchEvent(new first.w.Event('input', { bubbles: true }));
  const stored = JSON.parse(first.w.localStorage.getItem('virtual-lab:v1:project'));
  deepEq(stored.files.map(f => f.name), ['sketch.ino', 'lib.h']); assert.equal(stored.active, 'lib.h');
  // a new page load with that storage brings the same project back
  const again = boot(fixtureCompile, w => w.localStorage.setItem('virtual-lab:v1:project', JSON.stringify(stored)));
  deepEq(tabNames(again.w.document), ['sketch.ino', 'lib.h']); assert.equal(again.code.active, 'lib.h');
  assert.equal(again.w.document.getElementById('codeInput').value, '// lib\n');
  // v0.1 saved a bare sketch under another key
  const legacy = boot(fixtureCompile, w => w.localStorage.setItem('virtual-lab:v0.1:sketch', 'void setup() {}\nvoid loop() {}\n'));
  deepEq(tabNames(legacy.w.document), ['sketch.ino']); assert.equal(legacy.code.source, 'void setup() {}\nvoid loop() {}\n');
  // corrupt storage falls back to the default sketch
  const corrupt = boot(fixtureCompile, w => w.localStorage.setItem('virtual-lab:v1:project', '{"files":[{"name":"../x.h","content":1}]}'));
  deepEq(tabNames(corrupt.w.document), ['sketch.ino']); assert.match(corrupt.code.source, /Blink/);
  // export → import
  const data = JSON.parse(JSON.stringify(first.code.exportState()));
  assert.equal(data.sketch, first.code.files[0].content); assert.equal(data.activeFile, 'lib.h'); assert.equal(data.files.length, 2);
  const other = boot();
  assert.equal(other.code.importState(data), true);
  deepEq(other.code.files, first.code.files); assert.equal(other.code.active, 'lib.h');
  assert.equal(other.code.importState({ sketch: 'int old;\nvoid setup(){}\nvoid loop(){}' }), true, 'older project files still load');
  deepEq(tabNames(other.w.document), ['sketch.ino']);
  for (const bad of [null, {}, { files: [] }, { files: [{ name: 'a.h', content: '' }] }, { files: [{ name: '../a.ino', content: '' }] }, { files: [{ name: 'a.ino', content: 1 }] }, { files: [{ name: 'a.ino', content: '' }, { name: 'a.ino', content: '' }] }])
    assert.equal(other.code.importState(bad), false, JSON.stringify(bad));
});

test('ui: Run sends a multi-file project and shows the real result for it', async () => {
  let sent = null;
  const okResult = { ok: true, hex: fixtures.sketches.blink.result.hex, size: { flash: 924, flashMax: 32256, ram: 9, ramMax: 2048 }, output: 'Sketch uses 924 bytes', diagnostics: [] };
  const { w, sim, code } = boot(async files => { sent = files; return okResult; });
  addFileVia(w, 'config.h');
  await sim.start();
  assert.ok(sim.running); deepEq(sent.map(f => f.name), ['sketch.ino', 'config.h']);
  sim.stop();
});


test('ui: while running, the tray states what is wrong in facts — a resistor lead going nowhere, an LED straight across the supply', async () => {
  const { w, editor, sim, code } = boot();
  const doc = w.document, notes = () => doc.getElementById('simNotes').textContent;
  editor.addPart('led'); editor.addPart('resistor');
  const led = editor.state.parts.find(p => p.type === 'led'), res = editor.state.parts.find(p => p.type === 'resistor');
  led.x = 40; led.y = 320; res.x = 200; res.y = 340; editor.syncParts();
  // LED across 5V and GND; resistor connected at one lead only (the user's report)
  editor.state.wires.push(wireOf('a', { part: 'uno-1', pin: '5V' }, { part: led.id, pin: 'A' }), wireOf('c', { part: led.id, pin: 'C' }, { part: 'uno-1', pin: 'GND.1' }), wireOf('r', { part: 'uno-1', pin: '5V' }, { part: res.id, pin: '1' }));
  editor.markDirty();
  code.source = sketch('blink');
  assert.doesNotMatch(notes(), /not connected to anything/, 'not shown while merely building');
  await sim.start(); sim.mcu.run(0.02 * 16e6); sim.step(); sim.refreshTray();
  assert.match(notes(), /Resistor 220 Ω: lead 2 is not connected to anything, so no current flows through it/);
  assert.match(notes(), /An LED is carrying \d+ mA .*anode is connected directly to 5V and its cathode directly to GND/);
  assert.doesNotMatch(notes(), /Short circuit/);
  sim.stop();
  editor.state.wires.push(wireOf('r2', { part: res.id, pin: '2' }, { part: 'uno-1', pin: 'GND.2' }));   // connect the other lead: no longer open
  editor.markDirty();
  await sim.start(); sim.mcu.run(0.02 * 16e6); sim.step(); sim.refreshTray();
  assert.doesNotMatch(notes(), /not connected to anything/);
  sim.stop();
});


/* ───────────── flexible resistor in the real UI code ───────────── */
test('ui: a selected resistor shows two lead handles; dragging one stretches it onto a hole while the other lead stays exactly put', () => {
  const { w, editor, drag } = boot();
  const doc = w.document;
  editor.addPart('resistor');
  const part = () => editor.state.parts.find(p => p.type === 'resistor');
  const id = part().id, bb = editor.partById('bb-1'), holeXY = h => pinWorld(bb, h);
  // seat lead 1 in D5 and lead 2 in D11 exactly
  const a = holeXY('D5'), b = holeXY('D11');
  placeFlexTest(part(), a, b); editor.syncParts(); editor.markDirty(); editor.commit(); editor.select({ kind: 'part', id });
  const handles = [...doc.querySelectorAll('#overlay .flex-handle')];
  assert.equal(handles.length, 2); assert.deepEqual(handles.map(h => h.dataset.flexEnd), ['1', '2']);
  assert.equal(editor.getCircuit().attachments.get(`${id}|1`), 'bb-1|D5'); assert.equal(editor.getCircuit().attachments.get(`${id}|2`), 'bb-1|D11');
  const el = editor.els.get(id), leadX = () => [...el.querySelectorAll('.res-leads line')].map(l => +l.getAttribute('x2'));
  assert.ok(Math.abs(parseFloat(el.style.width) - 57.6) < 1e-6);

  // drag lead 2 from D11 to D15 (4 holes further) — near, not exactly on it
  const target = holeXY('D15');
  drag(holeXY('D11'), { x: target.x + 3, y: target.y - 2 }, doc.querySelector('#overlay .flex-handle[data-flex-end="2"]'));
  const c = editor.getCircuit();
  assert.equal(c.attachments.get(`${id}|1`), 'bb-1|D5', 'lead 1 did not move');
  assert.equal(c.attachments.get(`${id}|2`), 'bb-1|D15', 'lead 2 snapped into D15');
  assert.ok(Math.abs(part().len - 96) < 1e-6, `length ${part().len}`);       // 10 pitches
  const [p1, p2] = allPinsWorldTest(part());
  assert.ok(Math.abs(p1.x - a.x) < 1e-6 && Math.abs(p1.y - a.y) < 1e-6, 'lead 1 is exactly where it was');
  assert.ok(Math.abs(p2.x - target.x) < 1e-6 && Math.abs(p2.y - target.y) < 1e-6, 'lead 2 is exactly on the hole');
  assert.ok(Math.abs(parseFloat(el.style.width) - 96) < 1e-6, 'the DOM box follows the length');
  assert.ok(leadX()[0] > 0 && leadX()[0] < 96, 'the drawn leads were re-laid out');
  assert.match(doc.getElementById('status').textContent, /stretched/);

  // undo restores the old length and the box
  editor.undo();
  assert.ok(Math.abs(editor.partById(id).len - 57.6) < 1e-6); assert.ok(Math.abs(parseFloat(editor.els.get(id).style.width) - 57.6) < 1e-6);
  assert.equal(editor.getCircuit().attachments.get(`${id}|2`), 'bb-1|D11');
  // other parts have no such handles
  editor.addPart('led'); const led = editor.state.parts.find(p => p.type === 'led'); editor.select({ kind: 'part', id: led.id });
  assert.equal(doc.querySelectorAll('#overlay .flex-handle').length, 0);
});

test('ui: dragging a lead off the board leaves it free (open), and Alt skips hole snapping', () => {
  const { w, editor, drag } = boot();
  const doc = w.document;
  editor.addPart('resistor');
  const part = () => editor.state.parts.find(p => p.type === 'resistor'), id = part().id, bb = editor.partById('bb-1');
  const a = pinWorld(bb, 'D5'), b = pinWorld(bb, 'D11');
  placeFlexTest(part(), a, b); editor.syncParts(); editor.markDirty(); editor.select({ kind: 'part', id });
  drag(b, { x: b.x + 200, y: b.y - 260 }, doc.querySelector('#overlay .flex-handle[data-flex-end="2"]'));   // far above the board
  assert.equal(editor.getCircuit().attachments.get(`${id}|1`), 'bb-1|D5');
  assert.equal(editor.getCircuit().attachments.has(`${id}|2`), false, 'lead 2 is in no hole');
  assert.ok(part().len > 200, `stretched a long way: ${part().len}`);
  assert.ok(editor.getCircuit().openLeads.some(o => o.pin === '2'), 'the free lead is reported as going nowhere');
});

/* ───────────── the code dock must never lose the editor (responsive layout + editor safety nets) ───────────── */
const widthOf = (w, dock, px) => { Object.defineProperty(dock, 'clientWidth', { configurable: true, value: px }); w.dispatchEvent(new w.Event('resize')); };

test('ui: the dock is responsive — wide: editor beside Output/Serial; narrow: Code · Output · Serial Monitor are tabs and the editor is never squeezed out', () => {
  const { w, code } = boot();
  const doc = w.document, dock = doc.getElementById('codeDock'), main = doc.getElementById('codeMain');
  const on = () => [...doc.querySelectorAll('.side-tabs button.on')].map(b => b.id);
  doc.getElementById('codeToggle').click();
  widthOf(w, dock, 1100);
  assert.ok(!dock.classList.contains('narrow')); assert.ok(!main.classList.contains('off')); assert.deepEqual(on(), ['tabOutput']);
  doc.getElementById('tabCode').click();                                   // the Code tab does nothing in the wide layout: the editor is already beside the panels
  assert.deepEqual(on(), ['tabOutput']); assert.ok(!main.classList.contains('off'));

  widthOf(w, dock, 500);                                                   // a small window: 500 px dock
  assert.ok(dock.classList.contains('narrow')); assert.deepEqual(on(), ['tabCode'], 'starts on the editor');
  assert.ok(!main.classList.contains('off')); assert.equal(doc.getElementById('outputPane').hidden, true); assert.equal(doc.getElementById('serialPane').hidden, true);
  doc.getElementById('tabOutput').click();
  assert.ok(main.classList.contains('off'), 'the editor gives its space to Output'); assert.equal(doc.getElementById('outputPane').hidden, false);
  doc.getElementById('tabSerial').click();
  assert.ok(main.classList.contains('off')); assert.equal(doc.getElementById('serialPane').hidden, false); assert.equal(doc.getElementById('outputPane').hidden, true);
  doc.getElementById('tabCode').click();
  assert.ok(!main.classList.contains('off')); assert.equal(doc.getElementById('serialPane').hidden, true); assert.deepEqual(on(), ['tabCode']);
  code.goToLine(1); assert.deepEqual(on(), ['tabCode']);
  doc.getElementById('tabOutput').click(); code.goToLine(1, 'sketch.ino');
  assert.deepEqual(on(), ['tabCode'], 'jumping to a line from Output brings the editor back');

  widthOf(w, dock, 1200);                                                  // window grows again
  assert.ok(!dock.classList.contains('narrow')); assert.ok(!main.classList.contains('off'), 'the editor is visible again');
  assert.ok(!on().includes('tabCode'), 'the Code tab is not an active tab in the wide layout');
});

test('ui: a collapsed dock (width 0) does not flip the layout, and a lone-empty saved project falls back to the default sketch', () => {
  const { w } = boot();
  const dock = w.document.getElementById('codeDock');
  widthOf(w, dock, 0); assert.ok(!dock.classList.contains('narrow'));
  const blank = boot(fixtureCompile, win => win.localStorage.setItem('virtual-lab:v1:project', JSON.stringify({ files: [{ name: 'sketch.ino', content: '  \n' }], active: 'sketch.ino' })));
  assert.match(blank.code.source, /Blink/, 'an empty saved sketch is treated as nothing saved');
  const real = boot(fixtureCompile, win => win.localStorage.setItem('virtual-lab:v1:project', JSON.stringify({ files: [{ name: 'sketch.ino', content: '// mine\n' }, { name: 'a.h', content: '' }], active: 'a.h' })));
  assert.equal(real.code.files.length, 2, 'a project with real content (even with an empty header) is kept');
});

const fakeEditor = (over = {}) => ({ kind: 'monaco', log: [], setFiles(f) { this.log.push(['setFiles', f.map(x => x.name)]); }, showFile(n) { this.log.push(['show', n]); }, getFiles() { return []; }, getActive() { return null; },
  addFile() {}, removeFile() {}, renameFile() {}, onChange() {}, setMarkers() {}, reveal() {}, focus() {}, dispose() { this.disposed = true; }, ...over });

test('ui: swapping editors is safe — a failing editor is rejected and the simple editor keeps showing the code; you can always switch back', () => {
  const { w, code } = boot();
  const doc = w.document, ta = doc.getElementById('codeInput'), btn = doc.getElementById('codeEditorKind');
  assert.equal(code.editor.kind, 'text'); assert.equal(btn.textContent, 'Monaco editor');
  const before = ta.value;
  const bad = fakeEditor({ setFiles() { throw new Error('boom'); } });
  assert.equal(code.setEditor(bad), false, 'a failing editor is refused');
  assert.equal(bad.disposed, true); assert.equal(code.editor.kind, 'text');
  assert.equal(ta.value, before, 'the code is still there'); assert.equal(btn.textContent, 'Monaco editor');

  const good = fakeEditor();
  assert.equal(code.setEditor(good), true);
  assert.equal(code.editor.kind, 'monaco'); assert.equal(btn.textContent, 'Simple editor');
  deepEq(good.log[0], ['setFiles', ['sketch.ino']]);
  addFileVia(w, 'x.h');
  assert.equal(code.useSimpleEditor(), true);
  assert.equal(good.disposed, true); assert.equal(code.editor.kind, 'text'); assert.equal(btn.textContent, 'Monaco editor');
  assert.deepEqual(plain(code.files.map(f => f.name)), ['sketch.ino', 'x.h'], 'the whole project came back to the simple editor');
  assert.equal(ta.value, code.files[code.files.findIndex(f => f.name === code.active)].content);

  let toggled = 0; code.onEditorToggle(() => toggled++);
  btn.click(); assert.equal(toggled, 1, 'the dock button asks the app to switch editors');
});

test('ui: the AI gets the truth — sim.snapshot() reports real pin states and LED currents while running, wiring problems when stopped', async () => {
  const { w, editor, sim, code, drag } = boot();
  const doc = w.document;
  [...doc.querySelectorAll('.part-card')].find(c => c.textContent.includes('LED')).click();
  const led = editor.state.parts.find(p => p.type === 'led');
  const bb = editor.partById('bb-1');
  const seat = (part, pinId, holeId) => { const h = pinWorld(bb, holeId), p = pinWorld(part, pinId); return { x: part.x + (h.x - p.x) + 4, y: part.y + (h.y - p.y) - 3 }; };
  const t = seat(led, 'A', 'E6');
  drag({ x: led.x + 6, y: led.y + 6 }, { x: t.x + 6, y: t.y + 6 }, editor.els.get(led.id));
  editor.setTool('wire');
  const wireDrag = (aPart, aPin, bPart, bPin) => drag(pinWorld(editor.partById(aPart), aPin), pinWorld(editor.partById(bPart), bPin), doc.getElementById('canvas'));
  wireDrag('uno-1', '12', 'bb-1', 'A6');
  wireDrag('bb-1', 'A5', 'uno-1', 'GND.1');
  editor.setTool('select');

  assert.equal(sim.snapshot().running, false);
  code.source = sketch('d12-blink');
  await sim.start();
  assert.ok(sim.running);
  let sawOn = false, sawOff = false;
  for (let i = 0; i < 40; i++) {
    sim.mcu.run(0.05 * 16e6); sim.step();
    const s = sim.snapshot();
    const d12 = s.pins.find(p => p.pin === 'D12'), l = s.leds.find(x => x.id === led.id);
    assert.ok(d12, 'D12 is reported — it is wired and driven');
    assert.ok(/OUTPUT (HIGH|LOW)/.test(d12.mode));
    if (d12.mode === 'OUTPUT HIGH') { assert.ok(l.on && l.mA > 1, 'LED current matches the pin'); sawOn = true; } else { assert.equal(l.on, false); sawOff = true; }
    assert.ok(!s.pins.some(p => p.pin === 'D7'), 'unused, unwired pins are left out');
  }
  assert.ok(sawOn && sawOff);
  assert.ok(sim.snapshot().seconds > 1);
  sim.stop();
});

test('ui: a failed compile offers "✨ Fix with AI" — it opens the AI panel and sends the compiler errors, flagged stale once edited', async () => {
  const { w, editor, sim, code } = boot(fixtureCompile, win => win.localStorage.setItem('virtual-lab:ai-key', 'test-key'));
  const doc = w.document;
  const sent = [];
  w.fetch = async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 200, json: async () => ({ ok: true, actions: [], code: 'void setup(){}\nvoid loop(){}\n', explanation: 'Added the missing semicolon on line 3.' }) }; };
  w.__lab.initAiPanel(editor, code, sim);

  code.source = sketch('broken');
  await code.compile();
  assert.equal(code.lastBuild.ok, false);
  assert.equal(code.lastBuild.stale, false);
  const fix = doc.getElementById('aiFixCompile');
  assert.ok(fix, 'Fix with AI button shown on the failed compile');
  fix.click();
  assert.equal(doc.getElementById('aiPane').hidden, false, 'the click opens the AI chat pane');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.instruction, /Fix the compile error/);
  const ctx = sent[0].body.context;
  assert.equal(ctx.compile.ok, false);
  assert.equal(ctx.compile.errors[0].line, 3);
  assert.match(ctx.compile.output, /expected ';' before 'undefinedThing'/);
  assert.equal(ctx.sim.running, false);
  assert.match([...doc.querySelectorAll('#aiLog .msg.ai .msg-text')].pop().textContent, /missing semicolon/);

  code.source = sketch('broken') + '\n// edited';
  assert.equal(code.lastBuild.stale, true, 'editing after a compile marks the result stale');
});

const flush = () => new Promise(r => setTimeout(r, 5));

test('ui: the sidebar is a stack of closable panes — open AI shares the column with Parts, close one and the other fills it, close both and a rail brings them back', () => {
  const { w, editor, code, sim } = boot();
  const doc = w.document, main = doc.getElementById('main');
  w.__lab.initAiPanel(editor, code, sim);
  const ai = doc.getElementById('aiPane'), parts = doc.getElementById('partsPanel'), rail = doc.getElementById('sideRail');
  assert.equal(ai.hidden, true, 'AI chat starts closed');
  assert.equal(parts.hidden, false);

  doc.getElementById('aiBtn').click();
  assert.equal(ai.hidden, false);
  assert.ok(main.classList.contains('panes-both') && main.classList.contains('ai-open'));
  assert.equal(doc.getElementById('aiBtn').getAttribute('aria-pressed'), 'true');

  doc.getElementById('collapseBtn').click();                       // close Parts → AI takes the whole column
  assert.equal(parts.hidden, true);
  assert.ok(!main.classList.contains('panes-both') && !main.classList.contains('parts-collapsed'));
  assert.ok(rail.classList.contains('strip'), 'a strip offers the closed pane back');
  assert.equal(doc.getElementById('railParts').hidden, false);
  assert.equal(doc.getElementById('railAi').hidden, true);

  doc.getElementById('aiClose').click();                           // close both → rail
  assert.ok(main.classList.contains('parts-collapsed'));
  assert.ok(!rail.classList.contains('strip'));
  doc.getElementById('railParts').click();
  assert.equal(parts.hidden, false);
  assert.ok(!main.classList.contains('parts-collapsed'));
  assert.deepEqual(JSON.parse(w.localStorage.getItem('virtual-lab:side-panes')), { ai: false, parts: true }, 'the layout is remembered');

  doc.getElementById('aiBtn').click(); doc.getElementById('aiBtn').click();   // the top-bar button toggles
  assert.equal(ai.hidden, true);
});

test('ui: AI chat — the input clears, messages roll, each reply has its own Apply, earlier turns are sent as history, and older proposals are superseded', async () => {
  const { w, editor, code, sim } = boot(fixtureCompile, win => win.localStorage.setItem('virtual-lab:ai-key', 'k'));
  const doc = w.document;
  const replies = [
    { ok: true, actions: [], code: 'void setup(){ pinMode(13, OUTPUT); }\nvoid loop(){ digitalWrite(13, HIGH); delay(250); digitalWrite(13, LOW); delay(250); }\n', explanation: 'Halved both delays so it blinks twice as fast.' },
    { ok: true, actions: [], code: null, explanation: 'delay() pauses the sketch for that many milliseconds.' },
    { ok: true, actions: [], code: 'void setup(){}\nvoid loop(){}\n', explanation: 'Version A.' },
    { ok: true, actions: [], code: 'void setup(){}\nvoid loop(){ }\n', explanation: 'Version B.' },
  ];
  const sent = [];
  w.fetch = async (url, opts) => { sent.push(JSON.parse(opts.body)); const r = replies.shift(); return { ok: true, status: 200, json: async () => r }; };
  w.__lab.initAiPanel(editor, code, sim);
  doc.getElementById('aiBtn').click();
  const prompt = doc.getElementById('aiPrompt'), logEl = doc.getElementById('aiLog');
  assert.ok(logEl.querySelector('.ai-empty'), 'an empty chat shows suggestions');

  const say = async text => { prompt.value = text; prompt.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await flush(); };

  prompt.value = 'make it blink twice as fast';
  prompt.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(prompt.value, '', 'the input clears as soon as you send');
  assert.equal(logEl.querySelector('.msg.me .bubble').textContent, 'make it blink twice as fast');
  assert.ok(logEl.querySelector('.msg.thinking'), 'a thinking bubble shows while waiting');
  await flush();
  assert.ok(!logEl.querySelector('.msg.thinking'));
  let last = [...logEl.querySelectorAll('.msg.ai')].pop();
  assert.match(last.textContent, /Halved both delays/);
  assert.ok(last.querySelector('.ai-code pre').textContent.includes('delay(250)'), 'the proposed sketch can be inspected');
  last.querySelector('[data-act="apply"]').click();
  assert.match(code.source, /delay\(250\)/);
  last = [...logEl.querySelectorAll('.msg.ai')].pop();
  assert.match(last.querySelector('.msg-state').textContent, /Applied/);

  await say('what does delay do?');                                 // a question: answered, nothing to apply
  assert.deepEqual(sent[1].history.map(h => h.role), ['user', 'assistant']);
  assert.equal(sent[1].history[0].text, 'make it blink twice as fast');
  assert.match(sent[1].history[1].text, /\[proposed edit: applied\]/, 'the model is told the earlier edit is really in the sketch');
  last = [...logEl.querySelectorAll('.msg.ai')].pop();
  assert.match(last.textContent, /pauses the sketch/);
  assert.equal(last.querySelector('.msg-actions'), null);

  await say('try A');
  await say('no, try B');                                          // A was never applied → superseded, B is pending
  const ais = [...logEl.querySelectorAll('.msg.ai')];
  assert.match(ais[ais.length - 2].querySelector('.msg-state').textContent, /newer reply/);
  assert.ok(ais[ais.length - 1].querySelector('[data-act="apply"]'));
  assert.match(sent[3].history.find(h => /Version A/.test(h.text)).text, /not applied/);
  assert.equal(logEl.querySelectorAll('.msg.me').length, 4);

  const saved = JSON.parse(w.localStorage.getItem('virtual-lab:ai-chat'));
  assert.equal(saved.length, 8, 'the conversation survives a reload');
  doc.getElementById('aiNewChat').click();
  assert.ok(logEl.querySelector('.ai-empty'));
  assert.deepEqual(JSON.parse(w.localStorage.getItem('virtual-lab:ai-chat')), []);
});

test('ui: AI chat without a key shows the key setup in the pane and keeps your message; saving the key sends it', async () => {
  const { w, editor, code, sim } = boot();
  const doc = w.document;
  const sent = [];
  w.fetch = async (url, opts) => { sent.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({ ok: true, actions: [], code: null, explanation: 'Hi!' }) }; };
  w.__lab.initAiPanel(editor, code, sim);
  doc.getElementById('aiBtn').click();
  assert.equal(doc.getElementById('aiSetup').hidden, false, 'a setup bar points at Settings');
  const prompt = doc.getElementById('aiPrompt');
  prompt.value = 'hello';
  doc.getElementById('aiGenerate').click();
  assert.equal(sent.length, 0);
  assert.equal(prompt.value, 'hello', 'nothing is lost');
  doc.getElementById('aiKeyInput').value = 'my-key';
  doc.getElementById('aiKeySave').click();
  await flush();
  assert.equal(doc.getElementById('aiSetup').hidden, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].userKey, 'my-key');
  assert.match(doc.getElementById('aiLog').textContent, /Hi!/);
});

test('ui: AI providers — each keeps its own key, switching is one click, and the chosen provider and model go to the server', async () => {
  const { w, editor, code, sim } = boot();
  const doc = w.document;
  const sent = [];
  w.fetch = async (url, opts) => { sent.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({ ok: true, actions: [], code: null, explanation: 'Hi!' }) }; };
  w.__lab.initAiPanel(editor, code, sim);
  doc.getElementById('aiBtn').click();
  const tabs = () => [...doc.querySelectorAll('#aiProviderTabs [data-provider]')];
  assert.deepEqual(tabs().map(b => b.dataset.provider), ['gemini', 'groq', 'nvidia', 'meta', 'openrouter']);
  const pick = id => doc.getElementById(`aiProvider-${id}`).click();
  const save = (key, model = '') => { doc.getElementById('aiKeyInput').value = key; doc.getElementById('aiModelInput').value = model; doc.getElementById('aiKeySave').click(); };
  pick('groq'); save('groq-key');
  assert.equal(doc.getElementById('aiSetup').hidden, true);
  pick('nvidia'); assert.equal(doc.getElementById('aiSetup').hidden, false, 'no key for NVIDIA yet');
  save('nv-key', 'meta/llama-3.1-70b-instruct');
  assert.ok(tabs().length === 5);
  doc.getElementById('aiForgetKey').click();
  assert.ok(doc.getElementById('aiProvider-groq').textContent.includes('✓') && doc.getElementById('aiProvider-nvidia').textContent.includes('✓'));
  assert.ok(!doc.getElementById('aiProvider-gemini').textContent.includes('✓'));
  pick('groq');                                                        // a saved key: one click switches
  assert.equal(doc.getElementById('aiSetup').hidden, true);
  const prompt = doc.getElementById('aiPrompt');
  prompt.value = 'hi'; doc.getElementById('aiGenerate').click(); await flush();
  assert.equal(sent.at(-1).provider, 'groq'); assert.equal(sent.at(-1).userKey, 'groq-key');
  doc.getElementById('aiForgetKey').click(); pick('nvidia');
  prompt.value = 'again'; doc.getElementById('aiGenerate').click(); await flush();
  assert.equal(sent.at(-1).provider, 'nvidia'); assert.equal(sent.at(-1).userKey, 'nv-key'); assert.equal(sent.at(-1).model, 'meta/llama-3.1-70b-instruct');
  // the dropdown under the chat box switches provider without opening anything
  const sel = doc.getElementById('aiProviderSelect');
  assert.equal(sel.value, 'nvidia');
  assert.ok([...sel.options].find(o => o.value === 'groq').textContent.includes('✓'));
  sel.value = 'groq'; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  prompt.value = 'third'; doc.getElementById('aiGenerate').click(); await flush();
  assert.equal(sent.at(-1).provider, 'groq');
  sel.value = 'meta'; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(doc.getElementById('aiSetup').hidden, false, 'no key for Meta: the setup bar shows');
  assert.match(doc.getElementById('aiGetKey').href, /llama\.developer\.meta\.com/);
  const ki = doc.getElementById('aiKeyInput'); ki.value = 'pasted-key-1234567890abcdef';
  ki.dispatchEvent(new w.Event('paste', { bubbles: true })); await new Promise(r => setTimeout(r, 5));
  assert.equal(doc.getElementById('aiSetup').hidden, true, 'pasting a key saves it straight away');
});

test('ui: Part Creator — pick which AI makes the part (shared with the chat); a provider without a key asks for one right there, and pasting it saves it', () => {
  const { w, editor } = boot();
  const doc = w.document, $ = id => doc.getElementById(id);
  w.__lab.initPartCreator(editor, { createPart: async () => ({ ok: false }) });
  editor.emit('create-part');
  assert.deepEqual([...$('pcProvider').options].map(o => o.value), ['gemini', 'groq', 'nvidia', 'meta', 'openrouter']);
  $('pcProvider').value = 'groq'; $('pcProvider').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(w.localStorage.getItem('virtual-lab:ai-provider'), 'groq');
  assert.equal($('pcKey').hidden, false, 'no Groq key yet');
  assert.match($('pcGetKey').href, /console\.groq\.com/);
  $('pcKey').value = 'gsk_abcdefghijklmnopqrstuvwxyz'; $('pcKey').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal($('pcKey').hidden, true);
  assert.equal(w.localStorage.getItem('virtual-lab:ai-key:groq'), 'gsk_abcdefghijklmnopqrstuvwxyz');
  assert.ok([...$('pcProvider').options].find(o => o.value === 'groq').textContent.includes('✓'));
});

test('ui: My projects — first run adopts your existing work, new projects start clean, switching restores each one’s circuit and code, and it all survives a reload', async () => {
  const { w, editor, code, sim } = boot();
  const doc = w.document;
  [...doc.querySelectorAll('.part-card')].find(c => c.textContent.includes('LED')).click();
  code.source = '// my blink\nvoid setup(){}\nvoid loop(){}\n';
  const projects = w.__lab.initProjects({ editor, code, sim });
  await projects.ready;
  assert.equal(projects.current.name, 'My first project');
  assert.equal(doc.getElementById('projectName').textContent, 'My first project');
  assert.equal(projects.current.workspace, 'arduino-uno');

  doc.getElementById('projectBtn').click();
  assert.equal(doc.getElementById('projectsModal').hidden, false);
  doc.getElementById('projNewName').value = 'Traffic light';
  doc.getElementById('projNewForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await flush(); await flush();
  assert.equal(projects.current.name, 'Traffic light');
  assert.equal(doc.getElementById('projectsModal').hidden, true);
  assert.equal(editor.state.parts.length, 2, 'a new project starts from the default Uno + breadboard');
  assert.match(code.source, /Blink/, 'and the default sketch');
  code.source = '// traffic\n';
  await projects.saveNow();

  const first = (await projects.ready, [...JSON.parse(w.localStorage.getItem('circuitbench:projects'))].find(m => m.name === 'My first project'));
  await projects.open(first.id);
  assert.equal(editor.state.parts.filter(p => p.type === 'led').length, 1, 'the LED came back with its project');
  assert.match(code.source, /my blink/);
  assert.equal(editor.hi, 0, 'switching starts a fresh undo history');

  // rename, duplicate, delete from the dialog
  projects.openModal();
  await flush();
  const row = name => [...doc.querySelectorAll('.proj-row')].find(r => r.querySelector('.proj-open, .proj-rename')?.textContent === name || r.querySelector('.proj-rename')?.value === name);
  row('My first project').querySelector('[data-act="rename"]').click(); await flush();
  const input = doc.querySelector('.proj-rename');
  input.value = 'Blinky'; input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await flush();
  assert.equal(projects.current.name, 'Blinky');
  assert.equal(doc.getElementById('projectName').textContent, 'Blinky');
  row('Traffic light').querySelector('[data-act="duplicate"]').click(); await flush();
  assert.ok(row('Traffic light copy'), 'duplicate appears');
  row('Traffic light copy').querySelector('[data-act="delete"]').click(); await flush();
  row('Traffic light copy').querySelector('[data-act="delete-yes"]').click(); await flush();
  assert.equal(doc.querySelectorAll('.proj-row').length, 2);

  // reload: same storage, new page — the open project and its work come back
  const saved = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); saved[k] = w.localStorage.getItem(k); }
  const again = boot(fixtureCompile, win => { for (const [k, v] of Object.entries(saved)) win.localStorage.setItem(k, v); });
  const p2 = again.w.__lab.initProjects({ editor: again.editor, code: again.code, sim: again.sim });
  await p2.ready;
  assert.equal(p2.current.name, 'Blinky');
  assert.match(again.code.source, /my blink/);
  assert.equal(again.editor.state.parts.filter(p => p.type === 'led').length, 1);
});

test('ui: My projects — deleting the open project opens another; importing a file makes a new project and a bad file leaves nothing behind', async () => {
  const { w, editor, code, sim } = boot();
  const projects = w.__lab.initProjects({ editor, code, sim });
  await projects.ready;
  const firstId = projects.current.id;
  const file = { ...editor.exportProject(), sketch: '// imported\n' };
  file.parts = [...file.parts, { id: 'led-x', type: 'led', x: 500, y: 60, rotate: 0 }];
  await projects.importFile(file, 'From a friend');
  assert.equal(projects.current.name, 'From a friend');
  assert.match(code.source, /imported/);
  assert.ok(editor.partById('led-x'));
  await assert.rejects(() => projects.importFile({ nope: 1 }, 'Broken'), /not a Virtual Lab project/);
  assert.equal(JSON.parse(w.localStorage.getItem('circuitbench:projects')).length, 2, 'no empty project left behind');
  await projects.remove(projects.current.id);
  assert.equal(projects.current.id, firstId, 'the remaining project opens');
  await projects.remove(firstId);
  assert.equal(projects.current.name, 'My first project', 'deleting the last one gives you a fresh project, never nothing');
});

test('ui: I²C end to end — wire an MPU-6050 and an OLED, run real firmware, tilt it from the inspector, see the OLED pixels and the AI snapshot; a missing wire is named in the tray', async () => {
  const { w, editor, sim, code } = boot();
  const doc = w.document;
  w.__lab.initMpuInspector(editor);
  const file = editor.exportProject();
  const W = (id, a, ap, b, bp) => ({ id, from: { part: a, pin: ap }, to: { part: b, pin: bp }, style: 'straight', color: '#2f6cf0', width: 2 });
  file.parts.push({ id: 'mpu1', type: 'mpu6050', x: 700, y: 40, rotate: 0 }, { id: 'oled1', type: 'ssd1306', x: 700, y: 200, rotate: 0 });
  file.wires = [W('w1', 'uno-1', 'A4', 'mpu1', 'SDA'), W('w2', 'uno-1', 'A5', 'mpu1', 'SCL'), W('w3', 'uno-1', '5V', 'mpu1', 'VCC'), W('w4', 'uno-1', 'GND.1', 'mpu1', 'GND'),
    W('w5', 'uno-1', 'A4.2', 'oled1', 'DATA'), W('w6', 'uno-1', 'A5.2', 'oled1', 'CLK'), W('w7', 'mpu1', 'VCC', 'oled1', 'VIN'), W('w8', 'mpu1', 'GND', 'oled1', 'GND')];
  editor.importProject(file);
  const tick = s => { for (let t = 0; t < s; t += 0.05) { sim.i2cPrepare(); sim.mcu.run(0.05 * 16e6); sim.step(); } code.serial.flush(); };

  code.source = sketch('i2c-mpu-adafruit');
  await sim.start(); assert.ok(sim.running);
  tick(0.6);
  assert.match(code.serial.text, /mpu ok/);
  let snap = sim.snapshot();
  const m = snap.i2c.find(d => d.id === 'mpu1');
  assert.equal(m.onBus, true); assert.equal(m.address, '0x68'); assert.equal(m.asleep, false);
  assert.equal(m.accelG.z, 1);
  assert.ok(editor.els.get('mpu1').querySelector('wokwi-mpu6050').led1, 'power LED on');

  // right-click → inspector; a preset tilts it and the running firmware sees it
  editor.emit('part-context', { part: editor.partById('mpu1'), clientX: 300, clientY: 200 });
  assert.equal(doc.getElementById('mpuEditor').hidden, false);
  [...doc.querySelectorAll('#mpuPresets button')].find(b => b.textContent === 'On its side').click();
  assert.equal(editor.partById('mpu1').roll, 90);
  assert.match(doc.getElementById('mpuRead').textContent, /y 1\.00/);
  tick(0.3);
  assert.match(code.serial.text.trim().split(/\r?\n/).pop(), /^z:0\.0 x:0\.0/);
  assert.equal(sim.snapshot().i2c.find(d => d.id === 'mpu1').accelG.y, 1);
  const pitch = doc.getElementById('mpuPitch');
  pitch.value = '-30'; pitch.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(editor.partById('mpu1').pitch, -30);
  sim.stop();

  code.source = sketch('i2c-oled');
  await sim.start(); tick(1.2);
  assert.match(code.serial.text, /drawn/);
  const px = (x, y) => editor.els.get('oled1').querySelector('wokwi-ssd1306').imageData.data[(y * 128 + x) * 4];
  assert.ok(px(0, 0) > 100 && px(9, 9) > 100 && px(127, 63) > 100, 'drawn pixels are lit on the element');
  assert.ok(px(64, 32) < 50, 'the rest is dark');
  assert.equal(sim.snapshot().i2c.find(d => d.id === 'oled1').litPixels, 101);
  sim.stop();

  // pull SCL off the MPU: it drops off the bus, the tray says why, the sketch reports it
  const cut = editor.exportProject(); cut.wires = cut.wires.filter(x => x.id !== 'w2'); editor.importProject(cut);
  code.source = sketch('i2c-mpu-adafruit');
  await sim.start(); tick(0.4);
  assert.match(code.serial.text, /no mpu/);
  assert.match(doc.getElementById('simNotes').textContent, /SCL is not connected to A5/);
  snap = sim.snapshot();
  assert.equal(snap.i2c.find(d => d.id === 'mpu1').onBus, false);
  sim.stop();
});

test('ui: two tabs — each tab opens its own project, startup trusts the saved project over the shared working copy, and an idle tab follows saves from another tab instead of overwriting them', async () => {
  // Tab A creates two projects and leaves "Alpha" with its own sketch.
  const a = boot();
  const pa = a.w.__lab.initProjects({ editor: a.editor, code: a.code, sim: a.sim });
  await pa.ready;
  await pa.rename(pa.current.id, 'Alpha');
  a.code.source = '// alpha sketch\n'; await pa.saveNow();
  const alpha = pa.current;
  await pa.create({ name: 'Beta' });
  a.code.source = '// beta sketch\n'; await pa.saveNow();
  const beta = pa.current;
  const storage = {}; for (let i = 0; i < a.w.localStorage.length; i++) { const k = a.w.localStorage.key(i); storage[k] = a.w.localStorage.getItem(k); }

  // This is what went wrong: the shared working copy (last written by *some* tab) holds Beta's sketch, but this
  // tab had Alpha open. It must come back as Alpha with Alpha's own sketch — from the store, not the working copy.
  const b = boot(fixtureCompile, win => { for (const [k, v] of Object.entries(storage)) win.localStorage.setItem(k, v); win.sessionStorage.setItem('circuitbench:tab-project', alpha.id); });
  const pb = b.w.__lab.initProjects({ editor: b.editor, code: b.code, sim: b.sim });
  await pb.ready;
  assert.equal(pb.current.name, 'Alpha', 'the tab reopens its own project, not the last one opened anywhere');
  assert.match(b.code.source, /alpha sketch/, 'with that project\'s saved sketch, not the shared working copy');

  // A new tab with no tab memory opens the last project opened anywhere.
  const c = boot(fixtureCompile, win => { for (const [k, v] of Object.entries(storage)) win.localStorage.setItem(k, v); });
  const pc = c.w.__lab.initProjects({ editor: c.editor, code: c.code, sim: c.sim });
  await pc.ready;
  assert.equal(pc.current.id, beta.id);

  // Another tab saves Alpha: an idle tab B follows it…
  const newer = { ...JSON.parse(storage[`circuitbench:project:${alpha.id}`]), updatedAt: Date.now() + 1000 };
  newer.data = { ...newer.data, sketch: '// alpha edited elsewhere\n', files: [{ name: 'sketch.ino', content: '// alpha edited elsewhere\n' }] };
  b.w.dispatchEvent(new b.w.StorageEvent('storage', { key: `circuitbench:project:${alpha.id}`, newValue: JSON.stringify(newer) }));
  await flush();
  assert.match(b.code.source, /alpha edited elsewhere/);
  assert.match(b.w.document.getElementById('status').textContent, /updated in another tab/);
  // …but a tab with unsaved edits keeps them and says so.
  b.code.source = '// my unsaved edit\n';
  const newest = { ...newer, updatedAt: Date.now() + 5000 };
  b.w.dispatchEvent(new b.w.StorageEvent('storage', { key: `circuitbench:project:${alpha.id}`, newValue: JSON.stringify(newest) }));
  await flush();
  assert.match(b.code.source, /my unsaved edit/);
  assert.match(b.w.document.getElementById('status').textContent, /also changed in another tab/);
});

test('ui: the AI chat belongs to its project — switching projects switches conversations', async () => {
  const { w, editor, code, sim } = boot(fixtureCompile, win => win.localStorage.setItem('virtual-lab:ai-key', 'k'));
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, actions: [], code: null, explanation: 'Answer.' }) });
  const ai = w.__lab.initAiPanel(editor, code, sim);
  const projects = w.__lab.initProjects({ editor, code, sim });
  projects.onSwitch(p => ai.setScope(p.id));
  await projects.ready;
  const first = projects.current.id;
  w.document.getElementById('aiPrompt').value = 'question about project one';
  await ai.send(); await flush();
  assert.equal(ai.messages.length, 2);
  await projects.create({ name: 'Second' });
  assert.equal(ai.messages.length, 0, 'a new project starts a fresh conversation');
  await projects.open(first);
  assert.equal(ai.messages[0].text, 'question about project one', 'and the first project\'s chat comes back');
});

test('ui: no tool switching — in Select mode a pin starts a wire, a part body moves the part, and the breadboard still drags from between its holes', () => {
  const { editor, drag, w } = boot();
  assert.equal(editor.tool, 'select');
  const uno = editor.partById('uno-1'), bb = editor.partById('bb-1');
  drag(pinWorld(uno, '13'), pinWorld(bb, 'A10'), w.document.getElementById('canvas'));
  assert.equal(editor.state.wires.length, 1, 'pin → hole made a wire');
  assert.equal(editor.tool, 'select', 'and you are still in Select');
  const unoX = uno.x;
  drag({ x: uno.x + 120, y: uno.y + 120 }, { x: uno.x + 160, y: uno.y + 120 }, editor.els.get('uno-1'));
  assert.ok(Math.abs(uno.x - (unoX + 40)) < 6, `the Uno body moved (${unoX} → ${uno.x})`);
  // the middle trench of the breadboard has no holes: dragging there moves the board
  const e = pinWorld(bb, 'E15'), f = pinWorld(bb, 'F15'), mid = { x: (e.x + f.x) / 2, y: (e.y + f.y) / 2 };
  const bbX = bb.x;
  drag(mid, { x: mid.x + 30, y: mid.y }, editor.els.get('bb-1'));
  assert.ok(Math.abs(bb.x - (bbX + 30)) < 6, `breadboard moved (${bbX} → ${bb.x})`);
  assert.equal(editor.state.wires.length, 1, 'no stray wire from the board drag');
});

test('ui: first-visit tour — "Welcome to CircuitBench!", one popup per button/area (every target exists), then what you need for a first project; shown once', async () => {
  const { w, editor, code, sim } = boot();
  const doc = w.document;
  const projects = w.__lab.initProjects({ editor, code, sim }); await projects.ready;
  const tour = w.__lab.initTour({ editor, sim, code, projects });
  tour.maybeAutoStart();
  assert.equal(tour.active, true, 'first visit → the tour opens by itself');
  assert.equal(doc.getElementById('tourTitle').textContent, 'Welcome to CircuitBench!');
  const seen = [];
  while (tour.step && tour.index < 40) {
    const s = tour.step;
    seen.push(s.title);
    for (const t of (Array.isArray(s.spots) ? s.spots : [])) assert.ok(doc.querySelector(t), `"${s.title}" points at ${t}, which exists`);
    if (/first project/.test(s.title)) break;
    doc.getElementById('tourNext').click();
  }
  for (const t of ['Your workbench', 'Parts', 'Search parts', 'Rotate & delete', 'Undo & redo', 'Zoom', 'Code', 'Ask AI', 'Your project']) assert.ok(seen.includes(t), `covers ${t}`);
  assert.ok(seen.some(t => /^Select/.test(t)) && seen.some(t => /^Run/.test(t)) && seen.some(t => /^Wire-only/.test(t)));
  assert.match(doc.getElementById('tourBody').textContent, /1 LED.*1 resistor \(220 Ω\).*2 wires/s);
  doc.getElementById('tourSkip').click();                  // "I'll explore on my own"
  assert.equal(doc.getElementById('tourTitle').textContent, 'The world is yours to build.');
  assert.match(doc.getElementById('tourBody').textContent, /Start creating\./);
  assert.equal(doc.getElementById('tourSkip').hidden, true, 'the last word has nothing to skip');
  assert.equal(doc.getElementById('tourNext').textContent, 'Start creating');
  doc.getElementById('tourNext').click();
  assert.equal(tour.active, false);
  tour.maybeAutoStart();
  assert.equal(tour.active, false, 'not shown again once seen');
  assert.equal(doc.getElementById('helpBtn'), null, 'the ? button is gone; Settings replays the tour');
  tour.start();
  assert.equal(tour.active, true, 'Settings brings it back');
  tour.end();
});

test('ui: "Build it with me" — points at each part, hole and pin in order, and advances only when the circuit is really wired that way, through to a running blink', async () => {
  const { w, editor, code, sim, drag } = boot();
  const doc = w.document;
  const projects = w.__lab.initProjects({ editor, code, sim }); await projects.ready;
  const tour = w.__lab.initTour({ editor, sim, code, projects });
  const tick = () => new Promise(r => setTimeout(r, 380));
  await tour.startGuide();
  assert.equal(projects.current.name, 'First circuit: Blink', 'the guide works in a fresh project');
  assert.equal(doc.getElementById('tourTitle').textContent, 'Add an LED');
  assert.equal(doc.getElementById('tourWait').hidden, false, 'it waits for you');
  await tick();
  assert.equal(tour.index, 0, 'and does not move on by itself');

  [...doc.querySelectorAll('.part-card')].find(c => c.querySelector('b').textContent === 'LED').querySelector('.add').click();
  await tick();
  assert.equal(doc.getElementById('tourTitle').textContent, 'Plug the LED into the breadboard');
  const led = editor.state.parts.find(p => p.type === 'led'), bb = editor.partById('bb-1');
  const seat = (part, pinId, holeId, grab) => { const h = pinWorld(bb, holeId), p = pinWorld(part, pinId), t = { x: part.x + (h.x - p.x) + 4, y: part.y + (h.y - p.y) - 3 }; drag({ x: part.x + grab.x, y: part.y + grab.y }, { x: t.x + grab.x, y: t.y + grab.y }, editor.els.get(part.id)); };
  seat(led, 'A', 'E11', { x: 20, y: 8 });
  await tick();
  assert.equal(doc.getElementById('tourTitle').textContent, 'Add a resistor');

  [...doc.querySelectorAll('.part-card')].find(c => c.querySelector('b').textContent === 'Resistor').querySelector('.add').click();
  await tick();
  assert.match(doc.getElementById('tourBody').textContent, /column 11/, 'names the exact column of the LED\'s + leg');
  const res = editor.state.parts.find(p => p.type === 'resistor');
  const mid = () => { const a = pinWorld(res, '1'), b = pinWorld(res, '2'); return { x: (a.x + b.x) / 2 - res.x, y: (a.y + b.y) / 2 - res.y }; };
  seat(res, '1', 'D11', mid());
  await tick();
  assert.equal(doc.getElementById('tourTitle').textContent, 'Wire pin 13 to the resistor');
  const far = /column (\d+)/.exec(doc.getElementById('tourBody').textContent)[1];
  drag(pinWorld(editor.partById('uno-1'), '13'), pinWorld(bb, `A${far}`), doc.getElementById('canvas'));
  await tick();
  assert.equal(doc.getElementById('tourTitle').textContent, 'Wire the LED\'s − leg to GND');
  assert.match(doc.getElementById('tourBody').textContent, /column 10/);
  drag(pinWorld(bb, 'A10'), pinWorld(editor.partById('uno-1'), 'GND.1'), doc.getElementById('canvas'));
  await tick();
  assert.equal(doc.getElementById('tourTitle').textContent, 'Press Run');
  await sim.start();
  await tick();
  assert.match(doc.getElementById('tourTitle').textContent, /blinking/);
  const ledEl = editor.els.get(led.id).querySelector('wokwi-led'), seenOn = new Set();
  for (let k = 0; k < 30; k++) { sim.mcu.run(0.05 * 16e6); sim.step(); seenOn.add(ledEl.value); }
  assert.deepEqual([...seenOn].sort(), [false, true], 'and it really blinks');
  sim.stop();
  doc.getElementById('tourNext').click();
  doc.getElementById('tourNext').click();                  // Finish
  assert.equal(doc.getElementById('tourTitle').textContent, 'The world is yours to build.', 'the guide ends on the same last word');
  doc.getElementById('tourNext').click();
  assert.equal(tour.active, false, 'Start creating closes it');
});

test('ui: Sign in with Google — hidden without a client ID; with one, Google\'s button renders, signing in shows your name and picture (kept only in this browser), sign out clears it', async () => {
  const fakeJwt = p => `x.${Buffer.from(JSON.stringify(p)).toString('base64url')}.sig`;
  const none = boot();
  const a0 = none.w.__lab.initAccount({ fetchConfig: async () => ({ googleClientId: null }), load: async () => { throw new Error('must not load'); } });
  await a0.ready;
  assert.equal(none.w.document.getElementById('accountSlot').hidden, true);

  const { w } = boot();
  const doc = w.document;
  let init = null, rendered = 0, disabled = 0;
  w.google = { accounts: { id: { initialize: o => { init = o; }, renderButton: el => { rendered++; el.textContent = 'Sign in with Google'; }, disableAutoSelect: () => { disabled++; } } } };
  const statuses = [];
  const acc = w.__lab.initAccount({ fetchConfig: async () => ({ googleClientId: 'abc.apps.googleusercontent.com' }), load: async () => {}, status: t => statuses.push(t) });
  await acc.ready;
  assert.equal(init.client_id, 'abc.apps.googleusercontent.com');
  assert.equal(doc.getElementById('accountSlot').hidden, false);
  assert.ok(rendered >= 1 && /Sign in with Google/.test(doc.getElementById('accountSlot').textContent));

  init.callback({ credential: fakeJwt({ sub: '123', name: 'Adhrit Pradeep', given_name: 'Adhrit', email: 'a@example.com', picture: 'https://example.com/p.png' }) });
  assert.equal(acc.user.given, 'Adhrit');
  assert.match(doc.getElementById('accountBtn').textContent, /Adhrit/);
  assert.equal(doc.querySelector('#accountBtn img').getAttribute('src'), 'https://example.com/p.png');
  assert.match(statuses.pop(), /Signed in as Adhrit Pradeep/);
  assert.equal(JSON.parse(w.localStorage.getItem('circuitbench:account')).email, 'a@example.com');

  doc.getElementById('accountBtn').click();
  assert.equal(doc.getElementById('accountMenu').hidden, false);
  assert.equal(doc.getElementById('accountEmail').textContent, 'a@example.com');
  doc.getElementById('accountSignOut').click();
  assert.equal(acc.user, null);
  assert.equal(w.localStorage.getItem('circuitbench:account'), null);
  assert.equal(disabled, 1);
  assert.ok(/Sign in with Google/.test(doc.getElementById('accountSlot').textContent), 'back to the sign-in button');

  init.callback({ credential: 'garbage' });
  assert.equal(acc.user, null, 'a bad token signs nobody in');
});

test('ui: wire types — a Normal / Hookup / Alligator menu on the selected wire; new wires are plain jumpers, and old "Automatic" wires load as jumpers', () => {
  const { w, editor, drag } = boot();
  const doc = w.document, bb = editor.partById('bb-1'), uno = editor.partById('uno-1');
  const canvas = doc.getElementById('canvas');
  drag(pinWorld(bb, 'A3'), pinWorld(bb, 'A9'), canvas);                     // hole → hole
  drag(pinWorld(uno, '13'), pinWorld(bb, 'J3'), canvas);                    // header → hole
  const [hh, hdr] = editor.state.wires;
  assert.equal(hh.kind, 'normal', 'new wires are normal jumpers');
  assert.equal(editor.wireKindOf(hh), 'normal');
  // a resistor lying loose on the bench: a wire to its leg stays a plain jumper (no clip unless you choose one)
  editor.addPart('resistor', { x: 120, y: 420 });
  const res = editor.state.parts.find(p => p.type === 'resistor');
  drag(pinWorld(uno, '12'), pinWorld(res, '1'), canvas);
  const loose = editor.state.wires[2];
  assert.equal(editor.wireKindOf(loose), 'normal');
  assert.equal(doc.querySelector(`[data-wire="${loose.id}"] .wire-clip`), null, 'no clip unless chosen');

  // choose a type from the menu
  editor.select({ kind: 'wire', id: hdr.id });
  doc.getElementById('wireKindBtn').click();
  const menu = doc.getElementById('wireKindMenu');
  assert.equal(menu.hidden, false);
  assert.deepEqual([...menu.querySelectorAll('[data-kind] span:last-child')].map(e => e.textContent), ['Normal', 'Hookup', 'Alligator']);
  assert.ok(menu.querySelector('[data-kind="normal"]').classList.contains('on'));
  menu.querySelector('[data-kind="alligator"]').click();
  assert.equal(hdr.kind, 'alligator');
  assert.equal(menu.hidden, true);
  assert.equal(doc.getElementById('wireKindName').textContent, 'Alligator');
  assert.ok(doc.querySelector(`.wire-alligator[data-wire="${hdr.id}"]`));
  editor.undo();
  assert.equal(editor.state.wires.find(x => x.id === hdr.id).kind, 'normal', 'undoable');

  // saved with the project; files from before wire types — or from the removed Automatic type — load as jumpers
  const file = editor.exportProject();
  assert.equal(file.wires.find(x => x.id === hh.id).kind, 'normal');
  delete file.wires[0].kind; file.wires[1].kind = 'auto';
  editor.importProject(file);
  assert.equal(editor.state.wires[0].kind, 'normal');
  assert.equal(editor.state.wires[1].kind, 'normal');
});

test('ui: weather station — DHT22 + 16×2 LCD run the real libraries; right-click the DHT to change the weather and the LCD follows', async () => {
  const { w, editor, sim, code } = boot();
  const doc = w.document;
  w.__lab.initSettingsEditor(editor);
  const file = editor.exportProject();
  const W = (id, a, ap, b, bp) => ({ id, from: { part: a, pin: ap }, to: { part: b, pin: bp }, style: 'straight', color: '#2f6cf0', width: 2 });
  file.parts.push({ id: 'dht1', type: 'dht', x: 700, y: 40, rotate: 0, model: 'DHT22', temp: 21.5, humidity: 48 }, { id: 'lcd1', type: 'lcd1602', x: 700, y: 260, rotate: 0 });
  file.wires = [W('w1', 'uno-1', '2', 'dht1', 'SDA'), W('w2', 'uno-1', '5V', 'dht1', 'VCC'), W('w3', 'uno-1', 'GND.1', 'dht1', 'GND'),
    W('w4', 'uno-1', 'A4', 'lcd1', 'SDA'), W('w5', 'uno-1', 'A5', 'lcd1', 'SCL'), W('w6', 'dht1', 'VCC', 'lcd1', 'VCC'), W('w7', 'dht1', 'GND', 'lcd1', 'GND')];
  editor.importProject(file);
  const lcdEl = () => editor.els.get('lcd1').querySelector('wokwi-lcd1602');
  assert.equal(lcdEl().getAttribute('pins'), 'i2c');
  const glass = () => { const c = lcdEl().characters; return [0, 1].map(r => String.fromCharCode(...[...c.slice(r * 16, r * 16 + 16)].map(x => (x < 16 ? 0xb0 : x)))); };
  const tick = s => { for (let t = 0; t < s; t += 0.05) { sim.mcu.run(0.05 * 16e6); sim.step(); } code.serial.flush(); };

  code.source = EXAMPLES.weather.code;
  await sim.start(); assert.ok(sim.running);
  tick(1.6);
  assert.match(code.serial.text, /21\.5 C, 48 %/);
  assert.deepEqual(glass(), ['Weather station ', '21.5°C  48%     ']);
  assert.equal(lcdEl().backlight, true);
  const snap = sim.snapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(snap.dht[0])), { id: 'dht1', model: 'DHT22', tempC: 21.5, humidity: 48, reads: snap.dht[0].reads, dataPin: 'D2' });
  assert.deepEqual([...snap.i2c.find(d => d.id === 'lcd1').text], ['Weather station ', '21.5?C  48%     ']);

  // right-click → settings; the sketch reads the new values within its 2 s loop
  editor.emit('part-context', { part: editor.partById('dht1'), clientX: 300, clientY: 200 });
  const box = doc.getElementById('setEditor');
  assert.equal(box.hidden, false);
  const t = doc.getElementById('set-temp'); t.value = '-3.5'; t.dispatchEvent(new w.Event('change', { bubbles: true }));
  const h = doc.getElementById('set-humidity'); h.value = '90'; h.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(editor.partById('dht1').temp, -3.5);
  tick(2.2);
  assert.equal(glass()[1], '-3.5°C  90%     ');
  // DHT11 in the circuit, DHT22 in the sketch → garbage, like the real thing; mismatch is visible to the AI via model
  const sel = doc.getElementById('set-model'); sel.value = 'DHT11'; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(editor.partById('dht1').model, 'DHT11');
  tick(2.2);
  assert.equal(sim.snapshot().dht[0].model, 'DHT11');
  sim.stop();
  assert.equal(glass()[0].trim(), '', 'LCD clears when stopped');
});

test('ui: motor control — L298N + battery + DC motor; the example ramps the motor forward then reverse; the AI snapshot has its speed', async () => {
  const { editor, sim, code } = boot();
  const file = editor.exportProject();
  const W = (id, a, ap, b, bp) => ({ id, from: { part: a, pin: ap }, to: { part: b, pin: bp }, style: 'straight', color: '#2f6cf0', width: 2 });
  file.parts.push({ id: 'drv', type: 'l298n', x: 700, y: 40, rotate: 0 }, { id: 'mot', type: 'dc-motor', x: 950, y: 40, rotate: 0 }, { id: 'bat', type: 'battery', x: 700, y: 300, rotate: 0, volts: 9 });
  file.wires = [W('w1', 'uno-1', '8', 'drv', 'IN1'), W('w2', 'uno-1', '7', 'drv', 'IN2'), W('w3', 'uno-1', '9', 'drv', 'ENA'), W('w4', 'drv', 'OUT1', 'mot', '1'), W('w5', 'drv', 'OUT2', 'mot', '2'),
    W('w6', 'bat', '+', 'drv', '12V'), W('w7', 'bat', '-', 'drv', 'GND'), W('w8', 'drv', 'GND', 'uno-1', 'GND.1')];
  editor.importProject(file);
  const motorEl = () => editor.els.get('mot').querySelector('cb-dc-motor') || editor.els.get('mot');
  const tick = s => { for (let t = 0; t < s; t += 0.05) { sim.mcu.run(0.05 * 16e6); sim.step(); } code.serial.flush(); };
  code.source = EXAMPLES.motor.code;
  await sim.start();
  tick(1.5);                                     // speed 102 (40 %) around now
  const slow = motorEl().rpm;
  assert.ok(slow > 0, `turning forward: ${slow}`);
  tick(1.9);                                     // 255
  const fast = motorEl().rpm;
  assert.ok(fast > slow, `faster: ${slow} → ${fast}`);
  assert.equal(editor.els.get('drv').querySelector('cb-l298n')?.ledPower ?? editor.els.get('drv').ledPower, true);
  tick(2.6);                                     // into the reverse ramp
  assert.ok(motorEl().rpm < 0, `reverse: ${motorEl().rpm}`);
  const snap = sim.snapshot();
  assert.equal(snap.motors[0].id, 'mot'); assert.ok(snap.motors[0].rpm < 0);
  assert.deepEqual(JSON.parse(JSON.stringify(snap.drivers[0])), { id: 'drv', powered: true, motorA: 'rev', motorB: 'stopped' });
  sim.stop();
  assert.equal(motorEl().rpm, 0);
});

test('ui: Part Creator — build a part by hand, save & place it, it lands in My parts; edit it; or describe it and the AI fills the form', async () => {
  const { w, editor } = boot();
  const doc = w.document, $ = id => doc.getElementById(id);
  const calls = [];
  const fakeCreate = async ({ description }) => { calls.push(description); return { ok: true, note: 'DO is simplified', spec: { id: 'custom-ignored-1', name: 'Buzzer', label: 'BZ', color: '#111111', textColor: '#ffffff', description: 'Active buzzer', breadboard: true, pins: [{ id: '+', label: '+', side: 'bottom' }, { id: '-', label: '-', side: 'bottom' }], behaviour: { kind: 'resistor', roles: { a: '+', b: '-' }, ohms: 42 } } }; };
  const pc = w.__lab.initPartCreator(editor, { createPart: fakeCreate });
  const set = (id, v, ev = 'input') => { const e = $(id); e.value = v; e.dispatchEvent(new w.Event(ev, { bubbles: true })); };

  $('createPartBtn').click();
  assert.equal($('partModal').hidden, false);
  assert.equal($('pcSave').disabled, true, 'needs a name first');
  assert.match($('pcErrors').textContent, /name/);
  set('pcName', 'Moisture probe'); set('pcLabel', 'SOIL');
  assert.equal($('pcSave').disabled, false);
  assert.ok($('pcPreview').querySelector('svg'), 'live preview');
  // rename a pin: the role that pointed at it follows
  const firstPinName = $('pcPins').querySelector('input');
  firstPinName.value = 'V+'; firstPinName.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal($('pcRole-vcc').value, 'V+');
  $('pcSave').click();
  assert.equal($('partModal').hidden, true);
  const placed = editor.state.parts.find(p => p.type.startsWith('custom-'));
  assert.ok(placed, 'placed on the workbench');
  assert.ok(editor.els.get(placed.id).querySelector('cb-custom-part svg'));
  const cards = [...doc.querySelectorAll('#catalog .part-card b')].map(b => b.textContent);
  assert.ok(cards.includes('Moisture probe'));
  assert.equal(pc.library().length, 1);
  // its saved copy is in the project file
  assert.equal(editor.exportProject().customParts[0].name, 'Moisture probe');

  // edit: rename + remove a pin; the wire to that pin goes, the rest stays
  editor.state.wires.push({ id: 'wx', a: { part: placed.id, pin: 'OUT' }, b: { part: 'uno-1', pin: 'A0' }, style: 'straight', color: '#000', width: 2 });
  editor.emit('edit-part', placed.type);
  assert.match($('partTitle').textContent, /Edit/);
  set('pcName', 'Soil probe');
  $('pcSave').click();
  assert.ok([...doc.querySelectorAll('#catalog .part-card b')].some(b => b.textContent === 'Soil probe'));
  assert.ok(editor.state.wires.some(w2 => w2.id === 'wx'), 'pin still exists → wire kept');

  // AI path
  $('createPartBtn').click();
  set('pcDescribe', 'an active buzzer with + and -');
  $('pcAiGo').click();
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(calls, ['an active buzzer with + and -']);
  assert.equal($('pcName').value, 'Buzzer');
  assert.equal($('pcKind').value, 'resistor'); assert.equal($('pcOhms').value, '42');
  assert.match($('pcAiStatus').textContent, /DO is simplified/);
  $('pcSave').click();
  assert.ok([...doc.querySelectorAll('#catalog .part-card b')].some(b => b.textContent === 'Buzzer'));
  assert.equal(pc.library().length, 2);
});

test('ui: the rules editor builds a working chip — memory, rules and driven pins, with bad expressions explained', () => {
  const { w, editor } = boot();
  const doc = w.document, $ = id => doc.getElementById(id);
  w.__lab.initPartCreator(editor, { createPart: async () => ({ ok: false, error: 'not used here' }) });
  const set = (el2, v, ev = 'input') => { el2.value = v; el2.dispatchEvent(new w.Event(ev, { bubbles: true })); };

  $('createPartBtn').click();
  set($('pcName'), 'D flip-flop');
  for (const id of ['VCC', 'GND', 'CLK', 'D', 'Q']) {
    if (!$('pcPins').querySelector(`input[value="${id}"]`)) $('pcAddPin').click();
  }
  const names = [...$('pcPins').querySelectorAll('.pc-pin input:first-child')];
  ['VCC', 'GND', 'CLK', 'D', 'Q'].forEach((id, i) => set(names[i], id));
  set($('pcKind'), 'logic', 'change');
  assert.ok($('pcLogic').textContent.includes('Memory'), 'the rules editor appears');
  set($('pcRole-vcc'), 'VCC', 'change'); set($('pcRole-gnd'), 'GND', 'change');

  // memory: q starts at 0
  $('pcLogic').querySelectorAll('.pc-pins-head button')[0].click();
  const varRow = $('pcLogic').querySelector('.pc-logic-row');
  set(varRow.querySelector('input'), 'q', 'change');
  // rule: on a rising clock, q = D
  $('pcLogic').querySelectorAll('.pc-pins-head button')[1].click();
  const rule = $('pcLogic').querySelector('.pc-rule');
  set(rule.querySelector('.pc-expr'), 'rising(CLK)');
  rule.querySelector('.pc-mini').click();
  const setRow = $('pcLogic').querySelector('.pc-rule .pc-set');
  set(setRow.querySelector('.pc-expr'), 'D');
  // drive Q
  $('pcLogic').querySelectorAll('.pc-pins-head button')[2].click();
  const outRow = [...$('pcLogic').querySelectorAll('.pc-logic-row')].pop();
  set(outRow.querySelector('select'), 'Q', 'change');
  set([...$('pcLogic').querySelectorAll('.pc-logic-row')].pop().querySelector('.pc-expr'), 'q');
  assert.equal($('pcErrors').textContent, '', $('pcErrors').textContent);
  assert.equal($('pcSave').disabled, false);

  // a typo is explained in plain words instead of being saved
  set([...$('pcLogic').querySelectorAll('.pc-logic-row')].pop().querySelector('.pc-expr'), 'qq + nope(');
  assert.equal($('pcSave').disabled, true);
  assert.match($('pcErrors').textContent, /Output Q/);
  set([...$('pcLogic').querySelectorAll('.pc-logic-row')].pop().querySelector('.pc-expr'), 'q');

  $('pcSave').click();
  assert.equal($('partModal').hidden, true);
  const placed = editor.state.parts.find(p => p.type.startsWith('custom-'));
  assert.ok(placed);
  const saved = editor.exportProject().customParts[0];
  assert.deepEqual(JSON.parse(JSON.stringify(saved.behaviour.rules)), [{ when: 'rising(CLK)', set: { q: 'D' } }]);
  assert.deepEqual({ ...saved.behaviour.outputs }, { Q: 'q' });
  const compiled = compileLogic(saved);                      // the saved data really is simulatable
  assert.equal(compiled.outputs.length, 1);
  const state = createLogicState(compiled), v = { VCC: 5, GND: 0, CLK: 0, D: 5 };
  const read = pin => v[pin] ?? null;
  tickLogic(compiled, state, saved.behaviour.roles, read);
  v.CLK = 5; tickLogic(compiled, state, saved.behaviour.roles, read);
  assert.equal(state.vars.q, 1, 'the clock edge latched D');
  assert.ok(logicDrive(compiled, state, saved.behaviour.roles, read).get('Q') > 4.5);
});

test('ui: the Package dropdown turns a part into a DIP chip — two rows of legs, sides decided by pin order', () => {
  const { w, editor } = boot();
  const doc = w.document, $ = id => doc.getElementById(id);
  w.__lab.initPartCreator(editor, { createPart: async () => ({ ok: false, error: 'unused' }) });
  const set = (el2, v, ev = 'input') => { el2.value = v; el2.dispatchEvent(new w.Event(ev, { bubbles: true })); };

  $('createPartBtn').click();
  set($('pcName'), '555 timer');
  set($('pcPackage'), 'dip', 'change');
  assert.ok($('pcBreadboard').closest('.pc-check').hidden, 'a DIP always plugs in, so the checkbox goes away');
  assert.match($('pcPinsHint').textContent, /datasheet order/);
  assert.equal($('pcPins').querySelector('select'), null, 'no per-pin side chooser on a DIP');
  assert.match($('pcPins').textContent, /pin 1/);
  // three pins is odd, and the part can't be saved until it's a real package shape
  assert.match($('pcErrors').textContent, /even|at least 4 pins/);
  assert.equal($('pcSave').disabled, true);
  $('pcAddPin').click();
  const names = [...$('pcPins').querySelectorAll('.pc-pin input:first-child')];
  ['GND', 'TRIG', 'OUT', 'RESET'].forEach((id, i) => set(names[i], id));
  set($('pcKind'), 'none', 'change');
  assert.equal($('pcErrors').textContent, '');
  $('pcSave').click();

  const saved = editor.exportProject().customParts[0];
  assert.equal(saved.package, 'dip');
  assert.equal(saved.breadboard, true);
  const laid = layoutSpec(saved);
  assert.deepEqual([...laid.pins].map(p => `${p.id}:${p.side}`), ['GND:bottom', 'TRIG:bottom', 'OUT:top', 'RESET:top']);
  assert.ok(Math.abs(laid.pins[0].y - laid.pins[3].y - 3 * PITCH) < 1e-6, 'pin 1 and the last pin face each other 0.3" apart');
});

test('ui: searching for a part that does not exist offers to make it (AI or by hand)', async () => {
  const { w, editor } = boot();
  const doc = w.document, $ = id => doc.getElementById(id);
  const calls = [];
  w.__lab.initPartCreator(editor, { createPart: async ({ description }) => { calls.push(description); return { ok: false, error: 'offline' }; } });
  const search = v => { const e = $('partsSearch'); e.value = v; e.dispatchEvent(new w.Event('input', { bubbles: true })); };
  search('zzqx9000');
  assert.match(doc.querySelector('#catalog .no-match').textContent, /No part called .zzqx9000./);
  $('makeMissingBtn').click();
  assert.equal($('partModal').hidden, false);
  assert.equal($('pcName').value, 'zzqx9000');
  assert.equal(calls.length, 1, 'AI lookup started');
  assert.match(calls[0], /zzqx9000/);
  $('partClose').click();
  search('zzqx9000');
  $('drawMissingBtn').click();
  assert.equal($('pcName').value, 'zzqx9000');
  assert.equal(calls.length, 1, 'drawing it yourself does not call the AI');
});

// ── the component library in the real UI ──
import { TEMPLATES } from '../src/core/part-templates.js';
import { validatePartSpec } from '../src/core/custom-parts.js';
const libSpec = (tplId, id) => { const { id: _i, group: _g, ...t } = TEMPLATES.find(x => x.id === tplId); const v = validatePartSpec({ ...t, id }); assert.ok(v.ok, v.errors?.join()); return v.spec; };
const wire = (id, a, ap, b, bp) => ({ id, from: { part: a, pin: ap }, to: { part: b, pin: bp }, style: 'straight', color: '#2f6cf0', width: 2 });

test('ui: Part Creator — start from a ready-made switch, save it, click it to flip it; its symbol and the circuit follow', () => {
  const { w, editor, drag } = boot();
  const doc = w.document, $ = id => doc.getElementById(id);
  w.__lab.initPartCreator(editor, { createPart: async () => ({ ok: false, error: 'no AI in this test' }) });
  assert.ok($('pcKind').querySelectorAll('optgroup').length >= 4, 'behaviours are grouped');
  assert.ok($('pcTemplate').querySelectorAll('option').length > 15, 'a long template list');
  $('createPartBtn').click();
  $('pcTemplate').value = 'sw-spst'; $('pcTemplate').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal($('pcName').value, 'Toggle switch (on / off)');
  assert.equal($('pcKind').value, 'switch');
  assert.equal($('pcSave').disabled, false);
  $('pcSave').click();
  const part = editor.state.parts.find(p => p.type.startsWith('custom-'));
  assert.ok(part, 'placed');
  const el = () => editor.els.get(part.id).querySelector('cb-custom-part');
  assert.equal(el().lit, 0);
  const r = { x: part.x + 20, y: part.y + 20 };
  drag(r, r, editor.els.get(part.id));                                   // a click
  assert.equal(part.pos, 1); assert.equal(el().lit, 1);
  const sw = editor.getCircuit().elements.find(e => e.partId === part.id);
  assert.equal(sw.kind, 'SW'); assert.equal(sw.closed, true);
  drag(r, r, editor.els.get(part.id)); assert.equal(part.pos, 0);
  assert.equal(editor.getCircuit().elements.find(e => e.partId === part.id).closed, false);
});

test('ui: Part Creator — a behaviour’s numbers appear as fields, are validated, and a template can be tuned before saving', () => {
  const { w, editor } = boot();
  const doc = w.document, $ = id => doc.getElementById(id);
  const pc = w.__lab.initPartCreator(editor, { createPart: async () => ({ ok: false }) });
  const set = (id, v, ev = 'input') => { const e = $(id); e.value = v; e.dispatchEvent(new w.Event(ev, { bubbles: true })); };
  editor.emit('create-part');
  $('pcTemplate').value = 'q-irf540'; $('pcTemplate').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal($('pcKind').value, 'nmos');
  assert.equal($('pcParam-vth').value, '5.5'); assert.equal($('pcParam-rds').value, '0.044');
  assert.equal($('pcRole-gate').value, 'G'); assert.equal($('pcRole-drain').value, 'D');
  set('pcParam-vth', '3.3');
  $('pcSave').click();
  assert.equal(pc.library()[0].behaviour.vth, 3.3);
  // switching what a part does re-guesses the roles from the pin names and resets the numbers
  editor.emit('create-part');
  $('pcTemplate').value = 'd-schottky'; $('pcTemplate').dispatchEvent(new w.Event('change', { bubbles: true }));
  set('pcKind', 'npn', 'change');
  assert.equal($('pcParam-beta').value, '100');
  set('pcKind', 'diode', 'change');
  assert.equal($('pcRole-anode').value, 'A'); assert.equal($('pcRole-cathode').value, 'K');
  assert.ok($('pcParam-vz'), 'Zener field');
  assert.ok(pc.library().length === 1);
});

test('ui: a capacitor charges over simulated time (RC), frame by frame, and the AI snapshot reports its voltage', async () => {
  const { editor, sim, code } = boot();
  const cap = libSpec('cap-100u', 'custom-cap-ui');
  const file = editor.exportProject();
  file.customParts = [cap];
  file.parts.push({ id: 'r1', type: 'resistor', x: 700, y: 40, rotate: 0, ohms: 10000 }, { id: 'c1', type: cap.id, x: 900, y: 40, rotate: 0 });
  file.wires = [wire('w1', 'uno-1', '5V', 'r1', '1'), wire('w2', 'r1', '2', 'c1', '+'), wire('w3', 'c1', '-', 'uno-1', 'GND.1')];
  editor.importProject(file);
  code.source = EXAMPLES.blink.code;
  await sim.start();
  const v = () => sim.result.voltage(editor.getCircuit().netOf('c1', '+'));
  const tick = s => { for (let t = 0; t < s; t += 0.05) { sim.mcu.run(0.05 * 16e6); sim.step(); } };
  tick(0.05); assert.ok(v() < 1, `starts empty: ${v()}`);
  tick(1); assert.ok(v() > 2.8 && v() < 3.5, `about one time constant in: ${v()}`);
  tick(6); assert.ok(v() > 4.9, `full: ${v()}`);
  const lib = sim.snapshot().library.find(x => x.id === 'c1');
  assert.equal(lib.kind, 'capacitor'); assert.ok(lib.volts > 4.9);
  sim.stop();
});

test('ui: a servo follows the Servo library’s pulses and an ultrasonic sensor answers pulseIn(), both through the whole stack', async () => {
  const { editor, sim, code } = boot();
  const servo = libSpec('servo-sg90', 'custom-servo-ui'), sonar = libSpec('hcsr04', 'custom-sonar-ui');
  const file = editor.exportProject();
  file.customParts = [servo, sonar];
  file.parts.push({ id: 'sv', type: servo.id, x: 700, y: 40, rotate: 0 }, { id: 'us', type: sonar.id, x: 900, y: 40, rotate: 0, dist: 80 });
  file.wires = [wire('a', 'uno-1', '9', 'sv', 'SIG'), wire('b', 'uno-1', '5V', 'sv', 'VCC'), wire('c', 'uno-1', 'GND.1', 'sv', 'GND'),
    wire('d', 'uno-1', '7', 'us', 'TRIG'), wire('e', 'uno-1', '8', 'us', 'ECHO'), wire('f', 'uno-1', '5V', 'us', 'VCC'), wire('g', 'uno-1', 'GND.1', 'us', 'GND')];
  editor.importProject(file);
  const tick = s => { for (let t = 0; t < s; t += 0.05) { sim.mcu.run(0.05 * 16e6); sim.step(); sim.animate(0.05); } };
  code.source = sketch('servo-cmd');
  await sim.start();
  tick(0.8);
  const horn = () => editor.els.get('sv').querySelector('cb-custom-part').aux;
  assert.ok(Math.abs(horn() - 90) < 3, `centred: ${horn()}`);
  sim.mcu.serialWrite('c'); tick(0.8);
  assert.ok(horn() > 170, `swung to 180: ${horn()}`);
  const snap = sim.snapshot();
  assert.equal(snap.library.find(x => x.id === 'sv').targetDeg, 180);
  sim.stop();
  assert.equal(editor.els.get('sv').querySelector('cb-custom-part').aux, 0);

  code.source = sketch('ultrasonic-read');
  await sim.start();
  tick(1);
  const us = sim.snapshot().library.find(x => x.id === 'us');
  assert.equal(us.distanceCm, 80); assert.ok(us.measurements >= 3, `measured ${us.measurements} times`);
  editor.setPartProp('us', 'dist', 120);
  tick(0.6);
  assert.equal(sim.snapshot().library.find(x => x.id === 'us').distanceCm, 120);
  sim.stop();
});

test('ui: the catalogue’s real Wokwi parts — a wokwi-servo follows the Servo library, a wokwi-hc-sr04 answers pulseIn(), a wokwi-led-bar-graph lights per-LED, a DPDT relay switches both poles', async () => {
  const { editor, sim, code } = boot();
  const file = editor.exportProject();
  assert.ok(PART_DEFS.servo.native && PART_DEFS['led-bar-graph'].native);
  assert.equal(PART_DEFS.servo.tag, 'wokwi-servo');
  assert.deepEqual(PART_DEFS.servo.pins.map(p => p.id), ['GND', 'V+', 'PWM']);
  assert.equal(file.customParts?.length || 0, 0);
  file.parts.push({ id: 'sv', type: 'servo', x: 700, y: 40, rotate: 0 }, { id: 'us', type: 'hc-sr04', x: 900, y: 40, rotate: 0, dist: 80 });
  file.wires = [wire('a', 'uno-1', '9', 'sv', 'PWM'), wire('b', 'uno-1', '5V', 'sv', 'V+'), wire('c', 'uno-1', 'GND.1', 'sv', 'GND'),
    wire('d', 'uno-1', '7', 'us', 'TRIG'), wire('e', 'uno-1', '8', 'us', 'ECHO'), wire('f', 'uno-1', '5V', 'us', 'VCC'), wire('g', 'uno-1', 'GND.1', 'us', 'GND')];
  editor.importProject(file);
  assert.ok(editor.els.get('sv').querySelector('wokwi-servo') && editor.els.get('us').querySelector('wokwi-hc-sr04'));
  const tick = s => { for (let t = 0; t < s; t += 0.05) { sim.mcu.run(0.05 * 16e6); sim.step(); sim.animate(0.05); } };
  code.source = sketch('servo-cmd');
  await sim.start();
  tick(0.8);
  const horn = () => editor.els.get('sv').querySelector('wokwi-servo').angle;
  assert.ok(Math.abs(horn() - 90) < 3, `centred: ${horn()}`);
  sim.mcu.serialWrite('c'); tick(0.8);
  assert.ok(horn() > 170, `swung to 180: ${horn()}`);
  sim.stop();
  code.source = sketch('ultrasonic-read');
  await sim.start(); tick(1);
  assert.equal(sim.snapshot().library.find(x => x.id === 'us').distanceCm, 80);
  sim.stop();
  // the project file carries only the part's name, not a copy of its spec
  assert.ok(!editor.exportProject().customParts?.length);

  // LED bar: each LED has its own two pins
  const f2 = editor.exportProject();
  f2.parts = f2.parts.filter(p => p.id !== 'sv' && p.id !== 'us');
  f2.parts.push({ id: 'bar', type: 'led-bar-graph', x: 700, y: 40, rotate: 0 }, { id: 'r1', type: 'resistor', x: 700, y: 300, rotate: 0, ohms: 220 });
  f2.wires = [wire('a', 'uno-1', '13', 'r1', '1'), wire('b', 'r1', '2', 'bar', 'A3'), wire('c', 'bar', 'C3', 'uno-1', 'GND.1')];
  editor.importProject(f2);
  code.source = EXAMPLES.blink.code;
  await sim.start(); 
  let lit = 0; for (let i = 0; i < 24; i++) { tick(0.05); const v = editor.els.get('bar').querySelector('wokwi-led-bar-graph').values; if (v?.[2]) lit++; assert.ok(!v || !v.some((x, k) => x && k !== 2), 'only segment 3 can light'); }
  assert.ok(lit > 3, `segment 3 lit ${lit} times`);
  sim.stop();
});

test('ui: the real Wokwi keypad, DIP switch, joystick, gas and flame sensors are in the catalogue, draw as their elements, and clicks operate them', () => {
  const { editor } = boot();
  for (const [id, tag] of [['keypad-4x4', 'wokwi-membrane-keypad'], ['dip-switch-8', 'wokwi-dip-switch-8'], ['joystick', 'wokwi-analog-joystick'], ['gas-sensor', 'wokwi-gas-sensor'], ['flame-sensor', 'wokwi-flame-sensor']]) {
    assert.ok(PART_DEFS[id]?.native && PART_DEFS[id].tag === tag, `${id} is the real ${tag}`);
  }
  const file = editor.exportProject();
  file.parts.push({ id: 'kp', type: 'keypad-4x4', x: 700, y: 40, rotate: 0 }, { id: 'dp', type: 'dip-switch-8', x: 900, y: 40, rotate: 0, bits: 5 });
  editor.importProject(file);
  assert.ok(editor.els.get('kp').querySelector('wokwi-membrane-keypad'));
  assert.deepEqual([...editor.els.get('dp').querySelector('wokwi-dip-switch-8').values], [1, 0, 1, 0, 0, 0, 0, 0], 'saved switch positions are drawn');
});

test('ui: a KiCad board imported as a part travels in the project, is drawn as the round board, and its electrode pins can be wired', async () => {
  const { editor } = boot();
  const { boardToSpec } = await import('../src/core/kicad-import.js');
  const { validatePartSpec } = await import('../src/core/custom-parts.js');
  const pcb = `(kicad_pcb (version 20260206)
    (footprint "Library:electrodes" (layer "F.Cu") (at 100 100)
      (property "Reference" "REF**") (property "Value" "electrodes")
      (pad "1" smd roundrect (at 0 -10) (size 8 8) (layers "F.Cu" "F.Mask"))
      (pad "1" thru_hole rect (at 20 0) (size 1.7 1.7) (drill 1) (layers "*.Cu" "*.Mask"))
      (pad "2" smd roundrect (at 0 10) (size 8 8) (layers "F.Cu" "F.Mask"))
      (pad "2" thru_hole rect (at 20 5) (size 1.7 1.7) (drill 1) (layers "*.Cu" "*.Mask")))
    (gr_circle (center 100 100) (end 130 100) (stroke (width 0.05) (type default)) (fill no) (layer "Edge.Cuts"))
    (segment (start 100 90) (end 120 100) (width 0.2) (layer "F.Cu") (net ""))
    (segment (start 100 110) (end 120 105) (width 0.2) (layer "F.Cu") (net "")))`;
  const v = validatePartSpec({ ...boardToSpec(pcb, { name: 'petri test' }).spec, id: 'custom-petri-test' });
  assert.ok(v.ok, v.errors?.join('; '));
  assert.deepEqual(v.spec.pins.map(p => p.id), ['P1', 'P2'], 'the two electrodes were found by tracing copper');
  const file = editor.exportProject();
  file.customParts = [...(file.customParts || []), v.spec];
  file.parts.push({ id: 'pb', type: 'custom-petri-test', x: 700, y: 40, rotate: 0 });
  file.wires = [wire('a', 'uno-1', '5V', 'pb', 'P1'), wire('b', 'uno-1', 'GND.1', 'pb', 'P2')];
  editor.importProject(file);
  const svg = editor.els.get('pb').innerHTML;
  assert.ok(svg.includes('<circle') && svg.includes('P1'), 'drawn as the round board with its pins');
  assert.equal(editor.exportProject().wires.length, 2, 'wires to the board survive a save');
});

test('ui: a firmware analogRead() sees the ECG moving while it runs — a BioAmp Pill fed by a biosignal source swings the ADC far above and below its half-supply rest level', async () => {
  const { editor, sim, code } = boot();
  const file = editor.exportProject();
  file.parts.push({ id: 'bs', type: 'custom-signal-source', x: 700, y: 40, rotate: 0, signal: 'ecg', bpm: 70, scale: 100 }, { id: 'px', type: 'custom-bioamp-exg-pill', x: 900, y: 40, rotate: 0 });
  file.wires = [wire('a', 'uno-1', '5V', 'px', 'VCC'), wire('b', 'uno-1', 'GND.1', 'px', 'GND'), wire('c', 'uno-1', 'A0', 'px', 'OUT'),
    wire('d', 'bs', 'E+', 'px', 'IN+'), wire('e', 'bs', 'E-', 'px', 'IN-'), wire('f', 'bs', 'REF', 'px', 'REF')];
  editor.importProject(file);
  code.source = sketch('bio-ecg');
  await sim.start(); sim.step();
  for (let t = 0; t < 3.4; t += 0.05) { sim.mcu.run(0.05 * 16e6); sim.step(); sim.animate(0.05); }
  const m = /max=(\d+) min=(\d+)/.exec(code.serial.text.replace(/\r/g, '')) || /max=(\d+) min=(\d+)/.exec(sim.mcu.serialText?.() || '');
  assert.ok(m, `the sketch reported: ${JSON.stringify(code.serial.text)}`);
  const [hi, lo] = [+m[1], +m[2]];
  assert.ok(hi - lo > 100, `ECG swing is visible at the ADC (max ${hi}, min ${lo})`);
  assert.ok(lo > 300 && hi < 900, `it rests near half supply (≈512) and does not clip (max ${hi}, min ${lo})`);
  sim.stop();
});

test('ui: Workspaces — a Bioelectronics project starts with the signal source and BioAmp Pill on the board and the sketch loaded, the menu leads with Biosignal, and saved/imported workspaces are checked and reusable', async () => {
  const { w, editor, code, sim } = boot();
  const doc = w.document;
  const projects = w.__lab.initProjects({ editor, code, sim }); await projects.ready;
  w.__lab.initWorkspaces({ editor, code, projects });
  const titles = () => [...doc.querySelectorAll('#catalog .group-title')].map(e => e.textContent);
  assert.notEqual(titles()[0], 'Biosignal', 'the plain Electronics workspace does not lead with it');
  doc.getElementById('workspacesBtn').click();
  assert.equal(doc.getElementById('workspacesModal').hidden, false);
  assert.ok([...doc.querySelectorAll('#wsList .ws-row b')].some(b => b.textContent === 'Bioelectronics'), 'built-in workspaces are listed');
  await projects.create({ name: 'Heart', workspace: 'bioelectronics' }); await flush(); await flush();
  assert.equal(projects.current.workspace, 'bioelectronics');
  const types = editor.state.parts.map(p => p.type);
  assert.ok(types.includes('arduino-uno') && types.includes('custom-signal-source') && types.includes('custom-bioamp-exg-pill'), `starter parts: ${types}`);
  assert.match(code.source, /BioAmp EXG Pill/, 'and the heartbeat sketch');
  assert.equal(titles()[0], 'Biosignal', 'the menu leads with the workspace’s section');
  // save the open project as a workspace → listed under Mine → starts new projects as that board
  doc.getElementById('wsSaveName').value = 'My heart lab';
  doc.getElementById('wsSaveForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
  const mine = w.__lab.workspaceCore.listWorkspaces().find(x => x.name === 'My heart lab');
  assert.ok(mine && !mine.builtin && mine.starter.project.parts.length >= 4);
  assert.ok(w.localStorage.getItem('circuitbench:workspaces').includes('My heart lab'), 'kept in this browser');
  await projects.create({ name: 'From mine', workspace: mine.id }); await flush(); await flush();
  assert.equal(editor.state.parts.filter(p => p.type === 'custom-bioamp-exg-pill').length, 1);
  // a hostile / broken file is refused; a good one with its own part is imported
  const { validateWorkspace } = w.__lab.workspaceCore;
  assert.equal(validateWorkspace({ format: 'nope' }).ok, false);
  assert.equal(validateWorkspace({ format: 'circuitbench-workspace', name: 'X', starter: { extra: [{ type: 'no-such-part', x: 0, y: 0 }] } }).ok, false, 'unknown starter parts are rejected');
  const good = validateWorkspace({ format: 'circuitbench-workspace', name: 'Pico lab', menuFirst: ['Pico lab'], parts: [{ name: 'Test gizmo', pins: [{ id: 'A' }, { id: 'B' }], behaviour: { kind: 'resistor', roles: { a: 'A', b: 'B' }, ohms: 100 } }] });
  assert.ok(good.ok, good.errors?.join(';'));
  assert.equal(w.__lab.workspaceCore.saveWorkspace(good.workspace, w.localStorage).ok, true);
  assert.ok(Object.values(w.__lab.workspaceCore.listWorkspaces()).some(x => x.parts.length === 1));
});

test('ui: Settings dialog — opens from the top bar, themes apply and persist, custom colours work, AI setup lives in it', async () => {
  const { w, editor, code, sim } = boot();
  const doc = w.document;
  const ai = w.__lab.initAiPanel(editor, code, sim);
  w.__lab.initSettings({ tour: { start() {} }, ai });
  const modal = doc.getElementById('settingsModal');
  assert.equal(modal.hidden, true);
  doc.getElementById('settingsBtn').click();
  assert.equal(modal.hidden, false);
  assert.ok(modal.contains(doc.getElementById('aiKeyRow')), 'the key form is in Settings, not the chat');
  const themes = [...doc.querySelectorAll('#themeList [data-theme]')].map(b => b.dataset.theme);
  assert.deepEqual(themes, ['classic', 'kids', 'hacker', 'techno', 'contrast', 'custom']);
  doc.querySelector('#themeList [data-theme="hacker"]').click();
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'hacker');
  assert.equal(w.localStorage.getItem('virtual-lab:theme'), 'hacker');
  assert.equal(doc.getElementById('themeCustom').hidden, true);
  doc.querySelector('#themeList [data-theme="custom"]').click();
  assert.equal(doc.getElementById('themeCustom').hidden, false);
  const acc = doc.getElementById('cu-accent'); acc.value = '#112233'; acc.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(doc.documentElement.style.getPropertyValue('--blue'), '#112233');
  w.__lab.themeCore.setCustom({ accent: 'not a colour' });          // junk never reaches the page
  assert.equal(w.__lab.themeCore.getCustom().accent, '#112233');
  doc.querySelector('#themeList [data-theme="classic"]').click();
  assert.equal(doc.documentElement.getAttribute('data-theme'), null);
  assert.equal(doc.documentElement.style.getPropertyValue('--blue'), '');
  doc.getElementById('settingsClose').click();
  assert.equal(modal.hidden, true);
});

test('ui: members panel for admins, and beta members use the included AI with no key', async () => {
  const me = { email: 'boss@example.com', name: 'Boss', role: 'owner', entitlements: { hostedAi: true, premium: true, seat: true, admin: true, owner: true }, hostedAiReady: true };
  const { w, editor, code, sim } = boot(undefined, win => { win.localStorage.setItem('circuitbench:session', 'tok'); win.localStorage.setItem('circuitbench:me', JSON.stringify(me)); });
  const doc = w.document, sent = [];
  w.fetch = async (url, opts = {}) => {
    sent.push({ url, opts, body: opts.body ? JSON.parse(opts.body) : null });
    if (url === '/api/admin/users' && opts.method !== 'POST') return { status: 200, json: async () => ({ ok: true, online: { online: 2, free: 1, privileged: 1, cap: 5 }, users: [{ email: 'boss@example.com', role: 'owner', name: 'Boss' }, { email: 'kid@example.com', role: 'user', name: 'Kid', lastSeen: 1 }] }) };
    if (url === '/api/admin/users') return { status: 200, json: async () => ({ ok: true }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, actions: [], code: null, explanation: 'from the server key' }) };
  };
  const ai = w.__lab.initAiPanel(editor, code, sim);
  w.__lab.initSettings({ tour: { start() {} }, ai });
  doc.getElementById('settingsBtn').click();
  await flush();
  assert.equal(doc.getElementById('setAdmin').hidden, false);
  assert.match(doc.getElementById('setAdminOnline').textContent, /2 online/);
  assert.deepEqual([...doc.querySelectorAll('#adminRole option')].map(o => o.value), ['beta', 'admin'], 'only the owner can make admins');
  const rows = [...doc.querySelectorAll('#adminList .proj-row')];
  assert.equal(rows.length, 2); assert.equal(rows[0].querySelector('button'), null, 'the owner row has no controls');
  rows[1].querySelector('button').click(); await flush();
  const grant = sent.find(r => r.opts.method === 'POST');
  assert.deepEqual(grant.body, { email: 'kid@example.com', role: 'beta' });
  assert.equal(grant.opts.headers.authorization, 'Bearer tok');
  // the included AI: no key anywhere, still chats, through the server's key
  doc.getElementById('settingsClose').click();
  doc.getElementById('aiBtn').click();
  assert.equal(doc.getElementById('aiSetup').hidden, true);
  assert.ok(doc.getElementById('aiProvider-hosted'));
  const prompt = doc.getElementById('aiPrompt'); prompt.value = 'hi'; doc.getElementById('aiGenerate').click(); await flush();
  const call = sent.filter(r => r.url.includes('generate-code')).at(-1);
  assert.equal(call.body.hosted, true); assert.equal(call.body.userKey, undefined);
  assert.equal(call.opts.headers.authorization, 'Bearer tok');
  assert.match(doc.getElementById('aiLog').textContent, /from the server key/);
});
