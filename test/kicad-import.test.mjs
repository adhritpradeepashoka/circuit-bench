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
