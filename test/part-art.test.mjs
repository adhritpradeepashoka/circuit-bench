import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSvg, cleanArt, renderArt } from '../src/core/part-art.js';
import { validatePartSpec, layoutSpec, registerCustomPart } from '../src/core/custom-parts.js';
globalThis.HTMLElement ||= class {};          // elements.js defines a custom element; only its pure drawing functions are used here
const { customPartSVG } = await import('../src/parts/elements.js');
import { Bldc, BldcEsc } from '../src/parts/timed.js';
import { PinState } from 'avr8js';

test('sanitizer keeps real drawing and drops everything dangerous', () => {
  const evil = `<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><g id="rotor" onclick="x()" fill="#fff"><circle cx="5" cy="5" r="4" style="x" fill="url(#g)"/><image href="http://evil/x.png"/><foreignObject><div>hi</div></foreignObject><a href="javascript:alert(1)"><rect width="3" height="3"/></a></g><path d="M0 0L5 5" stroke="javascript:alert(1)"/><text>Hi &lt;b&gt;</text></svg>`;
  const r = sanitizeSvg(evil);
  assert.ok(r.ok, r.error);
  for (const bad of ['script', 'onload', 'onclick', 'style', 'href', 'image', 'foreignObject', 'javascript', '<a', '<div']) assert.ok(!r.svg.includes(bad), bad);
  assert.match(r.svg, /<g id="rotor" fill="#fff">/);
  assert.match(r.svg, /<circle cx="5" cy="5" r="4" fill="url\(#g\)"\/>/);
  assert.ok(r.groups.has('rotor'));
  assert.match(r.svg, /<text>Hi &lt;b&gt;<\/text>/, 'text is escaped, not interpreted');
});

test('sanitizer refuses broken, empty and oversized pictures', () => {
  assert.equal(sanitizeSvg('').ok, false);
  assert.equal(sanitizeSvg('<g><circle r="2"/>').ok, false);
  assert.equal(sanitizeSvg('<g></h>').ok, false);
  assert.equal(sanitizeSvg('x'.repeat(30000)).ok, false);
  assert.equal(sanitizeSvg('<g>' + '<rect width="1" height="1"/>'.repeat(600) + '</g>').ok, false);
});

const bldcSpec = (over = {}) => ({
  name: 'Outrunner BLDC', label: 'BLDC', package: 'art', color: '#444', textColor: '#fff',
  pins: [{ id: 'U', x: 5, y: 10 }, { id: 'V', x: 5, y: 40 }, { id: 'W', x: 5, y: 70 }],
  art: { w: 100, h: 80, svg: '<circle cx="55" cy="40" r="30" fill="#9aa3ab"/><g id="rotor"><circle cx="55" cy="40" r="22" fill="#2b2f36"/><rect x="52" y="12" width="6" height="14" fill="#d33"/></g>', motion: [{ target: 'rotor', kind: 'spin', driver: 'rpm', pivot: [55, 40] }] },
  behaviour: { kind: 'bldc', roles: { u: 'U', v: 'V', w: 'W' }, poles: 7 }, ...over,
});

test('a drawn part validates, lays out at its picture size and renders its motion from the live rpm', () => {
  const v = validatePartSpec(bldcSpec());
  assert.ok(v.ok, v.errors?.join('; '));
  const lay = layoutSpec(v.spec);
  assert.deepEqual([lay.w, lay.h], [100, 80]);
  const still = customPartSVG(v.spec, { aux: 0 }), moving = customPartSVG(v.spec, { aux: 600 });
  assert.ok(!/animation/.test(still));
  assert.match(moving, /<g id="rotor" style="transform-origin:55px 40px;animation:cp-spin 0\.10s linear infinite">/);
  assert.match(customPartSVG(v.spec, { aux: -600 }), /infinite reverse/);
  assert.equal((moving.match(/<rect x="2\.6"/g) || []).length, 3, 'a lead dot sits on every pin');
});

test('art errors are specific: motion target must exist, pins must be inside the picture', () => {
  const bad = bldcSpec(); bad.art = { ...bad.art, motion: [{ target: 'nope', kind: 'spin', pivot: [1, 1] }] };
  assert.match(validatePartSpec(bad).errors.join(' '), /must be the id of a <g>/);
  const out = bldcSpec(); out.pins[0].x = 500;
  assert.match(validatePartSpec(out).errors.join(' '), /outside the picture/);
  assert.match(validatePartSpec({ ...bldcSpec(), art: undefined }).errors.join(' '), /art/);
});

test('rotate, glow and slide motions follow their drivers', () => {
  const art = cleanArt({ w: 50, h: 50, svg: '<g id="a"><rect width="5" height="5"/></g><g id="b"><rect width="5" height="5"/></g><g id="c"><rect width="5" height="5"/></g>', motion: [
    { target: 'a', kind: 'rotate', driver: 'angle', pivot: [5, 5] }, { target: 'b', kind: 'glow', driver: 'lit', min: 0.2 }, { target: 'c', kind: 'slide', driver: 'level', dx: 20, dy: 0 }] }).art;
  const svg = renderArt(art, { aux: 90, lit: 1, level: 0.5 });
  assert.match(svg, /<g id="a" style="transform-origin:5px 5px;transform:rotate\(90\.0deg\)">/);
  assert.match(svg, /<g id="b" style="opacity:1\.00">/);
  assert.match(svg, /<g id="c" style="transform:translate\(10\.0px,0\.0px\)">/);
  assert.match(renderArt(art, { lit: 0 }), /opacity:0\.20/);
});

// a fake MCU with three observable pins
function fakeMcu() {
  const state = {}; const listeners = [];
  const ports = { B: { pinState: bit => (state[bit] ? PinState.High : PinState.Low), addListener: f => listeners.push(f), removeListener: () => {} } };
  const mcu = { ports, seconds: 0, cpu: { cycles: 0, addClockEvent() {}, clearClockEvent() {} } };
  const set = (bit, v) => { state[bit] = v; listeners.forEach(f => f()); };
  return { mcu, set, state };
}

test('BLDC follows the six-step pattern: speed from step rate, direction from order', () => {
  const { mcu, set } = fakeMcu();
  const m = new Bldc({ poles: 7 }); m.attach(mcu, [{ port: 'B', bit: 0 }, { port: 'B', bit: 1 }, { port: 'B', bit: 2 }]);
  const SIX = ['100', '110', '010', '011', '001', '101'];
  const drive = (pattern) => [...pattern].forEach((c, i) => set(i, c === '1'));
  // 7 pole pairs, 1000 electrical rev/s... use 100 electrical rev/s → 6000 rpm... → 100/7*60 = 857 rpm
  const stepsPerSec = 600; let i = 0;
  for (let t = 0; t < 0.5; t += 1 / stepsPerSec) { mcu.seconds = t; drive(SIX[i++ % 6]); m.update(1 / 60); }
  assert.ok(Math.abs(m.rpm - 857) < 90, `rpm ${m.rpm}`);
  // reversed order spins the other way
  const r = new Bldc({ poles: 7 }); r.attach(mcu, [{ port: 'B', bit: 0 }, { port: 'B', bit: 1 }, { port: 'B', bit: 2 }]);
  i = 600; for (let t = 1; t < 1.5; t += 1 / stepsPerSec) { mcu.seconds = t; drive(SIX[(i--) % 6]); r.update(1 / 60); }
  assert.ok(r.rpm < -500, `rpm ${r.rpm}`);
  // stops coasting to zero when the pattern stops
  for (let t = 1.5; t < 3; t += 1 / 60) { mcu.seconds = t; r.update(1 / 60); }
  assert.equal(r.rpm, 0);
});

test('BLDC with ESC needs arming, then rpm = throttle × Kv × volts', () => {
  const { mcu, set } = fakeMcu();
  const esc = new BldcEsc({ kv: 1000, minUs: 1000, maxUs: 2000 });
  esc.attach(mcu, { port: 'B', bit: 0 });
  const pulse = us => { set(0, true); mcu.cpu.cycles += us * 16; mcu.seconds += us / 1e6; set(0, false); mcu.cpu.cycles += 18000 * 16; mcu.seconds += 0.018; };
  pulse(1500); for (let k = 0; k < 20; k++) { pulse(1500); esc.update(0.02, 11.1); }
  assert.equal(esc.rpm, 0, 'not armed: throttle ignored');
  for (let k = 0; k < 5; k++) pulse(1000);
  assert.ok(esc.armed);
  for (let k = 0; k < 100; k++) { pulse(1500); esc.update(0.02, 11.1); }
  assert.ok(Math.abs(esc.rpm - 5550) < 80, `rpm ${esc.rpm}`);
  for (let k = 0; k < 100; k++) { pulse(1500); esc.update(0.02, 3); }
  assert.equal(esc.rpm, 0, 'too little battery voltage');
});

test("the part-maker prompt teaches the behaviours and the format, not a stock drawing to copy", async () => {
  const { buildPartPrompt, extractJsonText } = await import('../src/core/ai-prompt.js');
  const t = buildPartPrompt('a brushless ESC');
  assert.ok(!t.includes('Worked example'), 'no worked examples to copy');
  assert.match(t, /"bldc-esc"/);                                   // every behaviour is still described
  assert.match(t, /STANDARD FIRST/);
  assert.match(t, /never silently drop a number/);
  assert.match(t, /speed controller \(ESC\)/);
  // a reply cut off before its closing fence, or sent without one, is still read
  assert.deepEqual(JSON.parse(extractJsonText('```json\n{"a":{"b":1}}')), { a: { b: 1 } });
  assert.deepEqual(JSON.parse(extractJsonText('Here you go: {"a":2} thanks')), { a: 2 });
  assert.equal(extractJsonText('no json here'), null);
});
