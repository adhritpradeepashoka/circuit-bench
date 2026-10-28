// Stress tests for the part maker (custom parts, Part Creator, AI-made parts, drawn parts). Seeded, so a failure repeats; nothing here may ever throw on bad input.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePartSpec, layoutSpec, partDefFromSpec, registerCustomPart, BEHAVIOURS, PACKAGES } from '../src/core/custom-parts.js';
import { sanitizeSvg, cleanArt } from '../src/core/part-art.js';
import { TEMPLATES } from '../src/core/part-templates.js';
import { PART_DEFS } from '../src/core/parts.js';
import { createAiService } from '../server/ai-service.mjs';
import { RequestError } from '../server/compile-service.mjs';
globalThis.HTMLElement ||= class {};
const { customPartSVG } = await import('../src/parts/elements.js');

let seed = 20261028; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)], int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const NASTY = ['', ' ', '<script>alert(1)</script>', '"><img src=x onerror=1>', '__proto__', 'constructor', '\u0000', '😀', 'x'.repeat(5000), '-1', 'NaN', '1e999', "'; DROP TABLE parts;--", '../../etc/passwd', '\n\t', 'ＡＢＣ'];
const junk = (d = 0) => { const k = int(0, d > 2 ? 5 : 8); return [() => null, () => undefined, () => rnd() * 1e6 - 5e5, () => NaN, () => Infinity, () => pick(NASTY), () => true, () => [], () => ({}), () => Array.from({ length: int(0, 4) }, () => junk(d + 1)), () => Object.fromEntries(Array.from({ length: int(0, 4) }, () => [pick(['id', 'name', 'x', 'y', 'side', 'kind', 'pins', 'art', 'roles', 'package', '__proto__', 'constructor']), junk(d + 1)]))][k](); };

test('validatePartSpec never throws, whatever it is given', () => {
  for (let i = 0; i < 1500; i++) { const raw = rnd() < 0.5 ? junk() : { name: junk(), label: junk(), color: junk(), package: junk(), pins: junk(), behaviour: junk(), art: junk(), board: junk(), sprite: junk(), look: junk(), breadboard: junk() };
    let r; assert.doesNotThrow(() => { r = validatePartSpec(raw); }, `input #${i}`); assert.ok(typeof r.ok === 'boolean'); if (!r.ok) assert.ok(r.errors.length > 0, 'a refusal says why'); }
  assert.equal(({}).polluted, undefined, 'no prototype pollution');
});

/** A plausible spec: random package, pins, sides and role assignment for a random behaviour. */
function randomSpec() {
  const kind = pick(Object.keys(BEHAVIOURS)), B = BEHAVIOURS[kind], pkg = pick(Object.keys(PACKAGES).filter(p => !PACKAGES[p].hidden));
  const n = pkg === 'quad' ? pick([8, 12, 16, 20, 32]) : pkg.startsWith('dip') ? pick([4, 6, 8, 14, 16, 20, 28]) : int(1, 20);
  const pins = Array.from({ length: n }, (_, i) => ({ id: `P${i + 1}`, side: pick(['left', 'right', 'top', 'bottom']) }));
  const shuffled = pins.map(p => p.id).sort(() => rnd() - 0.5), roles = {};
  B.roles.forEach((r, i) => { if (shuffled[i]) roles[r] = shuffled[i]; });
  return { name: `Fuzz ${i0++}`, color: '#' + int(0, 0xffffff).toString(16).padStart(6, '0'), pins, package: pkg, behaviour: { kind, roles }, breadboard: rnd() < 0.5 };
}
let i0 = 0;

test('any spec that passes validation lays out sanely, draws without NaN and registers as a part', () => {
  let ok = 0;
  for (let i = 0; i < 1200; i++) {
    const raw = randomSpec(), v = validatePartSpec(raw); if (!v.ok) continue; ok++;
    const lay = layoutSpec(v.spec);
    assert.ok(Number.isFinite(lay.w) && Number.isFinite(lay.h) && lay.w >= 20 && lay.h >= 20 && lay.w < 2000 && lay.h < 2000, `${raw.name}: size ${lay.w}×${lay.h}`);
    assert.equal(lay.pins.length, v.spec.pins.length);
    const seen = new Set();
    for (const p of lay.pins) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= -0.5 && p.y >= -0.5 && p.x <= lay.w + 0.5 && p.y <= lay.h + 0.5, `${raw.name}: pin ${p.id} at ${p.x},${p.y} outside ${lay.w}×${lay.h}`);
      const key = `${p.x},${p.y}`; assert.ok(!seen.has(key), `${raw.name}: two pins on the same spot ${key}`); seen.add(key);
    }
    const svg = customPartSVG(v.spec); assert.ok(!/NaN|undefined|Infinity/.test(svg), `${raw.name}: bad number in the drawing`); assert.ok(!/<script|onerror|onload/i.test(svg));
    const def = partDefFromSpec(v.spec); assert.equal(def.pins.length, v.spec.pins.length); assert.ok(def.w > 0 && def.h > 0);
  }
  assert.ok(ok > 150, `only ${ok} fuzz specs were valid: the generator is too wild to test anything`);
});

test('hostile text in names, labels and pins is escaped in the picture and never becomes markup', () => {
  for (const bad of NASTY) {
    const v = validatePartSpec({ name: `A${bad}`, label: bad || 'x', pins: [{ id: 'A', label: bad }, { id: 'B' }], behaviour: { kind: 'resistor', roles: { a: 'A', b: 'B' }, ohms: 100 }, package: 'module', color: '#336699' });
    if (!v.ok) continue; const svg = customPartSVG(v.spec); assert.ok(!/<script|<img|onerror/i.test(svg), `markup leaked for ${JSON.stringify(bad).slice(0, 30)}`);
  }
});

test('limits hold: pin count, name length, colours, sizes', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ id: `P${i}` }));
  assert.equal(validatePartSpec({ name: 'x', pins: many, behaviour: { kind: 'none' } }).ok, false, 'too many pins');
  const v = validatePartSpec({ name: 'N'.repeat(500), color: 'url(javascript:1)', textColor: 'red;}', pins: [{ id: 'A' }, { id: 'B' }], behaviour: { kind: 'none' } });
  assert.ok(v.ok); assert.ok(v.spec.name.length <= 40 && /^#[0-9a-f]{6}$/i.test(v.spec.color) && /^#[0-9a-f]{6}$/i.test(v.spec.textColor));
  assert.equal(validatePartSpec({ name: 'dup', pins: [{ id: 'A' }, { id: 'a' }], behaviour: { kind: 'none' } }).ok, false, 'pin names differ only by case');
});

test('roles must name real, distinct pins', () => {
  const pins = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
  assert.equal(validatePartSpec({ name: 'r', pins, behaviour: { kind: 'resistor', roles: { a: 'A', b: 'A' }, ohms: 10 } }).ok, false, 'one pin cannot be both ends');
  assert.equal(validatePartSpec({ name: 'r', pins, behaviour: { kind: 'resistor', roles: { a: 'A', b: 'Z' }, ohms: 10 } }).ok, false, 'no such pin');
  assert.equal(validatePartSpec({ name: 'r', pins, behaviour: { kind: 'resistor', roles: { a: 'A', b: 'B' }, ohms: 0 } }).ok, false, 'zero ohms');
  assert.equal(validatePartSpec({ name: 'r', pins, behaviour: { kind: 'resistor', roles: { a: 'A', b: 'B' }, ohms: 1e12 } }).ok, false, 'a trillion ohms');
});

test('a DIP or quad needs the right number of pins, and they land on the right rows', () => {
  const mk = (n, package_) => ({ name: 'c', package: package_, pins: Array.from({ length: n }, (_, i) => ({ id: `P${i + 1}` })), behaviour: { kind: 'none' } });
  assert.equal(validatePartSpec(mk(7, 'dip')).ok, false); assert.equal(validatePartSpec(mk(2, 'dip')).ok, false); assert.equal(validatePartSpec(mk(14, 'dip')).ok, true);
  assert.equal(validatePartSpec(mk(10, 'quad')).ok, false); assert.equal(validatePartSpec(mk(16, 'quad')).ok, true);
  const lay = layoutSpec(validatePartSpec(mk(8, 'dip')).spec); assert.equal(lay.pins.filter(p => p.side === 'bottom').length, 4); assert.equal(lay.pins[0].number, 1);
});

test('every ready-made template and every part in the catalogue survives a save and reload (validate → JSON → validate gives the same spec)', () => {
  for (const t of TEMPLATES) { const a = validatePartSpec(t, { id: `custom-t-${t.id}` }); assert.ok(a.ok, t.id); const b = validatePartSpec(JSON.parse(JSON.stringify(a.spec))); assert.ok(b.ok, `${t.id} after reload: ${b.errors}`); assert.deepEqual(b.spec, a.spec, `${t.id} changed on reload`); }
  for (const [type, d] of Object.entries(PART_DEFS)) if (d.custom && d.spec) { const b = validatePartSpec(JSON.parse(JSON.stringify(d.spec)), { id: d.spec.id }); assert.ok(b.ok, `${type}: ${b.errors}`); }
});

test('registering the same part twice, or a part with an id of a built-in, does not damage the catalogue', () => {
  const t = TEMPLATES.find(x => x.id === 'd-1n4007'), a = validatePartSpec(t, { id: 'custom-twice-1' }); registerCustomPart(a.spec); registerCustomPart(a.spec);
  assert.equal(Object.keys(PART_DEFS).filter(k => k === 'custom-twice-1').length, 1);
  const before = PART_DEFS['arduino-uno'].pins.length; validatePartSpec({ ...t, id: 'arduino-uno' }); assert.equal(PART_DEFS['arduino-uno'].pins.length, before);
  const b = validatePartSpec({ ...t, id: 'arduino-uno' }); if (b.ok) assert.notEqual(b.spec.id, 'arduino-uno', 'a part cannot take a built-in’s id');
});

test('drawn parts: the SVG cleaner never throws and never lets script, handlers, links or images through', () => {
  const base = ['<circle cx="5" cy="5" r="4" fill="#fff"/>', '<g id="rotor"><rect x="1" y="1" width="8" height="8"/></g>', '<path d="M0 0 L10 10"/>', '<text x="2" y="2">Hi</text>'];
  const evil = ['<script>x()</script>', '<circle onclick="x()" r="2"/>', '<image href="http://e/x.png"/>', '<a href="javascript:1"><rect/></a>', '<foreignObject><div/></foreignObject>', '<use href="#x"/>', '<style>*{}</style>', '<rect style="x" width="1" height="1"/>', '<circle fill="url(http://e)" r="1"/>', '<!DOCTYPE x [<!ENTITY y "z">]>', '<![CDATA[x]]>', '<svg onload="1"/>'];
  for (let i = 0; i < 800; i++) {
    let s = Array.from({ length: int(1, 6) }, () => pick(rnd() < 0.3 ? evil : base)).join('');
    if (rnd() < 0.4) { const k = int(0, s.length); s = s.slice(0, k) + s.slice(k + int(1, 8)); }
    if (rnd() < 0.2) s = s.replace(/"/g, pick(['', "'", '\\"']));
    let r; assert.doesNotThrow(() => { r = sanitizeSvg(s); }, JSON.stringify(s).slice(0, 80));
    if (r.ok) assert.ok(!/<script|\son\w+=|href|<image|foreignObject|javascript:|<style|<use|!ENTITY|CDATA|http/i.test(r.svg), `unsafe output for ${s.slice(0, 80)} → ${r.svg.slice(0, 80)}`);
  }
  for (let i = 0; i < 300; i++) assert.doesNotThrow(() => cleanArt(junk()));
});

test('the AI part maker: garbage, cut-off and hostile replies end in a clean refusal, never a crash or a bad part', async () => {
  const text = t => async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: t }] } }] }) });
  const replies = ['', 'I cannot do that', '```json\n{"name":', '```json\n[]\n```', '```json\n{"name":"x","pins":[],"behaviour":{"kind":"none"}}\n```', '```json\n{"name":"<script>","pins":[{"id":"A"},{"id":"A"}],"behaviour":{"kind":"zap"}}\n```', '```json\n' + JSON.stringify(junk()) + '\n```'];
  for (const r of replies) {
    const ai = createAiService({ fetchImpl: text(r) });
    await assert.rejects(() => ai.createPart({ description: 'a thing', userKey: 'k' }), e => e instanceof RequestError && e.status >= 400, JSON.stringify(r).slice(0, 50));
  }
  const good = { name: 'Fuzz diode', color: '#223344', package: 'module', look: 'diode', pins: [{ id: 'A' }, { id: 'K' }], behaviour: { kind: 'diode', roles: { anode: 'A', cathode: 'K' }, vf: 0.7 } };
  const ai = createAiService({ fetchImpl: text('```json\n' + JSON.stringify(good) + '\n```') }), r = await ai.createPart({ description: 'a diode', userKey: 'k' });
  assert.equal(r.ok, true); assert.equal(r.spec.look, 'diode', 'the AI can pick a picture for its part'); assert.ok(customPartSVG(r.spec).includes('<svg'));
});
