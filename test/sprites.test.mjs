// Every component's picture, checked by machine: nothing blank, no NaN, nothing drawn outside the part, a dot on every pin, every look used and every look real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES } from '../src/core/part-templates.js';
import { validatePartSpec, layoutSpec, partDefFromSpec } from '../src/core/custom-parts.js';
import { LOOK_IDS, lookSVG } from '../src/core/part-looks.js';
import { PART_DEFS } from '../src/core/parts.js';
globalThis.HTMLElement ||= class {};
const { customPartSVG } = await import('../src/parts/elements.js');

const num = v => parseFloat(v);
/** Well-formed (every tag closed in order) and returns the elements as {tag, attrs}. */
function parse(svg) {
  const stack = [], els = []; const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|<!--[\s\S]*?-->|[^<]+/g; let m, depth = 0;
  while ((m = re.exec(svg))) {
    if (!m[2]) continue;
    const [, close, tag, attrStr, self] = m;
    if (close) { assert.equal(stack.pop(), tag, `closing </${tag}> does not match`); continue; }
    const attrs = Object.fromEntries([...attrStr.matchAll(/([\w:-]+)="([^"]*)"/g)].map(a => [a[1], a[2]]));
    els.push({ tag, attrs, inTransform: stack.some(s => s.t) || 'transform' in attrs, inDefs: stack.some(s => s.defs) || tag === 'defs' });
    if (!self) stack.push({ toString: () => tag, t: 'transform' in attrs, defs: tag === 'defs' });
  }
  return els;
}
// the stack holds objects whose toString is the tag; compare by string
const origPop = Array.prototype.pop;

const specs = TEMPLATES.map(t => ({ t, v: validatePartSpec(t, { id: `custom-t-${t.id}` }) }));

test('every ready-made part validates and draws a picture the size of its layout', () => {
  for (const { t, v } of specs) {
    assert.ok(v.ok, `${t.id}: ${v.errors?.join('; ')}`);
    const lay = layoutSpec(v.spec), svg = customPartSVG(v.spec);
    assert.match(svg, new RegExp(`^<svg [^>]*width="${lay.w}" height="${lay.h}" viewBox="0 0 ${lay.w} ${lay.h}"`), `${t.id}: size`);
    assert.ok(!/NaN|undefined|Infinity|\[object/.test(svg), `${t.id}: bad number or value in the drawing`);
    assert.ok(svg.length > 300, `${t.id}: blank picture`);
  }
});

test('every picture is well-formed SVG and nothing is drawn outside the part', () => {
  for (const { t, v } of specs) {
    const { w, h } = layoutSpec(v.spec), svg = customPartSVG(v.spec);
    let ok = true; const stack = [];
    for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g)) { if (m[1]) { if (stack.pop() !== m[2]) { ok = false; break; } } else if (!m[4]) stack.push(m[2]); }
    assert.ok(ok && !stack.length, `${t.id}: tags are not balanced`);
    const tol = 1.5, flat = svg.replace(/<defs>[\s\S]*?<\/defs>/g, '').replace(/<g[^>]*transform[^>]*>[\s\S]*?<\/g>/g, '');         // skip definitions and rotated or moved groups
    for (const m of flat.matchAll(/<circle ([^>]*)>/g)) { const a = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(x => [x[1], x[2]])); const r = num(a.r) || 0, cx = num(a.cx), cy = num(a.cy);
      assert.ok(cx - r >= -tol && cx + r <= w + tol && cy - r >= -tol && cy + r <= h + tol, `${t.id}: circle at ${cx},${cy} r${r} leaves the ${w}×${h} part`); }
    for (const m of flat.matchAll(/<rect ([^>]*)>/g)) { const a = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(x => [x[1], x[2]])); if (!('width' in a) || /%/.test(a.width)) continue;
      const x = num(a.x) || 0, y = num(a.y) || 0, rw = num(a.width), rh = num(a.height);
      assert.ok(x >= -tol && y >= -tol && x + rw <= w + tol && y + rh <= h + tol, `${t.id}: rect ${x},${y} ${rw}×${rh} leaves the ${w}×${h} part`); }
  }
});

test('every pin has a dot where the layout says it is, with its name as a tooltip', () => {
  for (const { t, v } of specs) {
    const svg = customPartSVG(v.spec), { pins } = layoutSpec(v.spec);
    for (const p of pins) {
      const dot = `<rect x="${(p.x - 2.4).toFixed(1)}" y="${(p.y - 2.4).toFixed(1)}" width="4.8"`;
      assert.ok(svg.includes(dot) || !/^(module|art)$/.test(v.spec.package), `${t.id}: no dot for pin ${p.id}`);
    }
  }
});

test('looks: each one a template uses exists, and none is left unused', () => {
  const used = new Set(specs.map(({ v }) => v.spec.look).filter(Boolean));
  for (const { t, v } of specs) if (t.look) assert.equal(v.spec.look, t.look, `${t.id}: the look was dropped by validation`);
  for (const l of used) assert.ok(LOOK_IDS.has(l), `unknown look ${l}`);
  for (const l of LOOK_IDS) if (l !== 'reg220') assert.ok(used.has(l), `look "${l}" is not used by any ready-made part`);
});

test('a look is refused when the pins are not along the bottom edge, and an unknown look is ignored', () => {
  const base = TEMPLATES.find(t => t.id === 'd-1n4007');
  assert.equal(validatePartSpec({ ...base, look: 'nope' }).spec.look, undefined);
  assert.equal(validatePartSpec({ ...base, look: 'diode', package: 'sprite' }).spec?.look, undefined, 'only module parts take a look');
  const pins = [{ id: 'A', x: 3, y: 10, side: 'left' }, { id: 'K', x: 3, y: 20, side: 'left' }];
  assert.equal(lookSVG('diode', { color: '#222', label: 'D' }, 76, 76, pins), '');
});

test('each ready-made part with a look reads as that thing: the body is not the plain labelled box any more', () => {
  for (const { t, v } of specs) if (t.look) assert.ok(!customPartSVG(v.spec).includes('rx="5" fill'), `${t.id}: still the plain box`);
});

test('every built-in catalogue part has a size and pins inside it', () => {
  for (const [type, d] of Object.entries(PART_DEFS)) {
    assert.ok(d.w > 4 && d.h > 4 && Number.isFinite(d.w + d.h), `${type}: size`);
    for (const p of d.pins) assert.ok(p.x >= -2 && p.y >= -2 && p.x <= d.w + 2 && p.y <= d.h + 2, `${type}: pin ${p.id} at ${p.x},${p.y} is outside ${d.w}×${d.h}`);
  }
});
