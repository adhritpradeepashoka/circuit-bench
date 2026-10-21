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
import { DEFAULT_SKETCH } from '../src/sim/examples.js';

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
    const grab = { x: part.x + 6, y: part.y + 6 };
    const t = target(part, pinId, holeId);
    drag(grab, { x: t.x + 6, y: t.y + 6 }, editor.els.get(part.id));
  };
  dragPart(led, 'A', 'E6');
  dragPart(res, '1', 'D5');
  let c = editor.getCircuit();
  assert.equal(c.attachments.size, 4, 'every lead should be seated after the drops');
  assert.equal(c.netOf(led.id, 'A'), c.netOf('bb-1', 'A6'));

  // Wire tool: D13 → A6 (anode strip), A11 (resistor far lead) → GND
  editor.setTool('wire');
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
  assert.deepEqual(titles, ['Boards', 'Prototyping', 'Basic', 'Input', 'Displays', 'Sensors']);
  const names = [...doc.querySelectorAll('#catalog .part-card b')].map(e => e.textContent);
  for (const n of ['RGB LED', 'Slide Switch', '7-Segment Display', 'PIR Motion Sensor']) assert.ok(names.includes(n), `${n} in catalogue`);
  for (const type of ['rgb-led', 'slide-switch', 'seven-segment', 'pir-sensor']) {
    editor.addPart(type);
    assert.ok(editor.state.parts.some(p => p.type === type));
    assert.ok(editor.els.get(editor.state.parts.find(p => p.type === type).id).querySelector(PART_DEFS[type].tag), `${type} renders ${PART_DEFS[type].tag}`);
  }
  // searching finds them by what people call them
  const search = doc.getElementById('partsSearch');
  search.value = 'motion'; search.dispatchEvent(new w.Event('input', { bubbles: true }));
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
  assert.equal(doc.getElementById('aiKeyRow').hidden, false);
  const prompt = doc.getElementById('aiPrompt');
  prompt.value = 'hello';
  doc.getElementById('aiGenerate').click();
  assert.equal(sent.length, 0);
  assert.equal(prompt.value, 'hello', 'nothing is lost');
  doc.getElementById('aiKeyInput').value = 'my-key';
  doc.getElementById('aiKeySave').click();
  await flush();
  assert.equal(doc.getElementById('aiKeyRow').hidden, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].userKey, 'my-key');
  assert.match(doc.getElementById('aiLog').textContent, /Hi!/);
});
