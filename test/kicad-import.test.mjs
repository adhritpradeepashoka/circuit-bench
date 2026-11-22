import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSexp, readBoard, groupPads, boardToSpec } from '../src/core/kicad-import.js';
import { validatePartSpec, layoutSpec } from '../src/core/custom-parts.js';

const pcb = `(kicad_pcb (version 20260206)
  (footprint "Lib:J" (layer "F.Cu") (at 10 10 90)
    (property "Reference" "J1") (property "Value" "Conn")
    (pad "1" thru_hole circle (at 0 0) (size 1.7 1.7) (drill 1) (layers "*.Cu") (net 1 "SIG"))
    (pad "2" thru_hole circle (at 0 2.54) (size 1.7 1.7) (drill 1) (layers "*.Cu") (net 2 "GND")))
  (footprint "Lib:R" (layer "F.Cu") (at 20 20)
    (property "Reference" "R1") (property "Value" "10k")
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu" "F.Paste") (net 1 "SIG"))
    (pad "2" smd rect (at 1 0) (size 1 1) (layers "F.Cu" "F.Paste") (net 2 "GND")))
  (gr_rect (start 0 0) (end 40 30) (stroke (width 0.1) (type default)) (fill no) (layer "Edge.Cuts")))`;

test('parseSexp reads quoted strings, nesting and rejects non-KiCad text', () => {
  assert.deepEqual(parseSexp('(a (b "c d") e)').length, 3);
  assert.throws(() => parseSexp('hello'), /KiCad/);
  assert.throws(() => readBoard('(something_else)'), /not a KiCad PCB/);
});

test('pads rotate with their footprint (KiCad 90° = counter-clockwise on screen)', () => {
  const b = readBoard(pcb), p2 = b.pads.find(p => p.ref === 'J1' && p.num === '2');
  assert.ok(Math.abs(p2.x - 12.54) < 1e-6 && Math.abs(p2.y - 10) < 1e-6, `got ${p2.x},${p2.y}`);
});

test('a board with net names joins pads by net; the connector pads become the pins, named after their nets', () => {
  const { spec, report } = boardToSpec(pcb, { name: 'Test board' });
  assert.deepEqual(spec.pins.map(p => p.id).sort(), ['GND', 'SIG']);
  assert.equal(report.nodes, 2); assert.equal(spec.board.shape, 'rect');
  assert.equal(spec.board.w, 40);
  assert.ok(report.notes.some(n => /component footprint/.test(n)));
  const v = validatePartSpec(spec); assert.ok(v.ok, v.errors?.join(';'));
  const lay = layoutSpec(v.spec);
  assert.equal(lay.pins.length, 2); assert.ok(lay.w > 150, 'drawn at true size');
});

test('copper that touches is one node even when the file names no nets', () => {
  const noNets = `(kicad_pcb (footprint "x" (layer "F.Cu") (at 0 0)
    (pad "A" smd rect (at 0 0) (size 2 2) (layers "F.Cu")) (pad "B" thru_hole circle (at 10 0) (size 2 2) (drill 1) (layers "*.Cu")) (pad "C" thru_hole circle (at 10 10) (size 2 2) (drill 1) (layers "*.Cu")))
    (segment (start 0 0) (end 5 0) (width 0.2) (layer "F.Cu") (net "")) (segment (start 5 0) (end 10 0) (width 0.2) (layer "F.Cu") (net "")))`;
  const g = groupPads(readBoard(noNets));
  assert.equal(g.length, 2); assert.ok(g.some(x => x.length === 2));
  assert.throws(() => boardToSpec('(kicad_pcb (version 1))'), /no pads/);
});

/* ───────── real boards from every KiCad generation, and the formats the first version did not read ───────── */
import { readFileSync } from 'node:fs';
const fx = f => readFileSync(new URL(`./fixtures/pcb/${f}`, import.meta.url), 'utf8');

test('KiCad 5 (legacy "module" files) imports: same pads, tracks and vias as the file holds, references from fp_text', () => {
  const text = fx('kicad5-pic-programmer.kicad_pcb'), b = readBoard(text);
  assert.equal(b.pads.length, (text.match(/\(pad\s/g) || []).length);
  assert.equal(b.tracks.length, (text.match(/\(segment\s/g) || []).length);
  assert.equal(b.vias.length, (text.match(/\(via\s/g) || []).length);
  assert.ok(b.parts.filter(p => p.ref && p.ref !== 'REF**').length >= 60, 'references read from fp_text');
  const { spec, report } = boardToSpec(text, { name: 'PIC programmer' });
  assert.equal(validatePartSpec(spec).ok, true); assert.equal(spec.pins.length, 64);
  assert.match(report.notes.join(' '), /connectors \(J, P, CN/);
  assert.ok(report.notes.some(n => /copper pour/.test(n)));
});

test('copper-connectivity computed from positions agrees with the nets the file declares (no shorts) on real boards, front and back side', () => {
  for (const f of ['kicad5-pic-programmer.kicad_pcb', 'kicad9-microwave.kicad_pcb']) {
    const b = readBoard(fx(f)), groups = groupPads(b, { useNets: false });
    for (const g of groups) assert.ok(new Set(g.map(k => b.pads[k].net).filter(Boolean)).size <= 1, `${f}: two nets shorted by position`);
    const nets = new Map(); b.pads.forEach((p, k) => { if (p.net) (nets.get(p.net) || nets.set(p.net, []).get(p.net)).push(k); });
    const of = new Map(); groups.forEach((g, i) => g.forEach(k => of.set(k, i)));
    let split = 0; for (const ks of nets.values()) if (new Set(ks.map(k => of.get(k))).size > 1) split++;
    assert.ok(split <= 2, `${f}: ${split} nets split (only a copper pour may join them)`);
  }
});

test('every connection point sits on a pad of the board, and the drawing carries every pin', async () => {
  const { spec } = boardToSpec(fx('kicad5-pic-programmer.kicad_pcb'));
  for (const p of spec.pins) assert.ok(spec.board.pads.some(d => Math.hypot(d.x - p.x, d.y - p.y) < 0.02), `pin ${p.id} is not on a pad`);
  const { partSVG } = await import('../src/parts/elements.js').catch(() => ({}));
  const lay = layoutSpec(spec); assert.equal(lay.pins.length, spec.pins.length);
});

test('a pad turned 90 degrees stands on end: file angles are absolute, not added to the footprint turn', () => {
  const t = `(kicad_pcb (version 20241229) (footprint "L:DIP" (layer "F.Cu") (at 10 10 90) (property "Reference" "U1") (pad "1" thru_hole oval (at 0 0 90) (size 2.4 1.6) (drill 0.8) (layers "*.Cu")) (pad "2" thru_hole oval (at 0 2.54 90) (size 2.4 1.6) (drill 0.8) (layers "*.Cu"))))`;
  const p = readBoard(t).pads[0]; assert.deepEqual([p.w, p.h, p.rot], [1.6, 2.4, 90]);
});

test('KiCad 6+ curved tracks (arc) keep copper connected; KiCad 5 gr_arc outlines get their middle point', () => {
  const t = `(kicad_pcb (version 20221018)
    (footprint "L:A" (layer "F.Cu") (at 0 0) (property "Reference" "J1") (pad "1" thru_hole circle (at 0 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu")))
    (footprint "L:B" (layer "F.Cu") (at 10 0) (property "Reference" "J2") (pad "1" thru_hole circle (at 0 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu")))
    (arc (start 0 0) (mid 5 -2) (end 10 0) (width 0.25) (layer "F.Cu") (net 0)))`;
  const b = readBoard(t); assert.equal(b.tracks.length, 2);
  assert.equal(groupPads(b).length, 1, 'the two pads joined by the arc are one node');
  const legacy = `(kicad_pcb (version 20171130) (module "X" (layer F.Cu) (at 5 5) (fp_text reference J1 (at 0 0) (layer F.SilkS)) (pad 1 thru_hole circle (at 0 0) (size 1.6 1.6) (drill 0.8) (layers *.Cu)))
    (gr_arc (start 5 5) (end 15 5) (angle 90) (layer Edge.Cuts) (width 0.1)))`;
  const lb = readBoard(legacy); assert.equal(lb.edge[0].pts.length, 3); assert.ok(Math.abs(lb.edge[0].pts[2][0] - 5) < 1e-6 && Math.abs(lb.edge[0].pts[2][1] - 15) < 1e-6, 'a 90 degree sweep from (15,5) about (5,5) ends at (5,15)');
  assert.equal(lb.pads[0].ref, 'J1');
});

test('a big board imports in well under a second per thousand pads (was quadratic: 12 s for a 2 000-pad board)', () => {
  const parts = [`(kicad_pcb (version 20241229)`];
  for (let i = 0; i < 150; i++) for (let j = 0; j < 100; j++) parts.push(`(segment (start ${i} ${j * 0.5}) (end ${i + 0.9} ${j * 0.5}) (width 0.2) (layer "F.Cu") (net 0))`);
  for (let i = 0; i < 150; i++) parts.push(`(footprint "L:P" (layer "F.Cu") (at ${i} 0) (property "Reference" "J${i}") (pad "1" thru_hole circle (at 0 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu")))`);
  parts.push(')');
  const t0 = Date.now(); const r = boardToSpec(parts.join('\n')); const ms = Date.now() - t0;
  assert.ok(r.report.pins > 0); assert.ok(ms < 3000, `${ms} ms for 15 000 tracks`);
});
