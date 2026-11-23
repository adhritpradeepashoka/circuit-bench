import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const src = f => readFileSync(new URL(`../src/ui/${f}`, import.meta.url), 'utf8');

// The circuit's wires (#overlay, z-index 30) sit above every full-screen view pane (z-index 20): each tab group must hide them while its pane is open.
const GROUPS = [['robot-asm', 'assembly.js'], ['ml-view', 'ml.js'], ['viz-view', 'visualizer.js']];
for (const [cls, file] of GROUPS) {
  test(`wires do not draw over the ${cls} tabs`, () => {
    assert.match(css, new RegExp(`\\.${cls} #overlay, \\.${cls} #world, \\.${cls} #wireEditor \\{ display: none !important`.replace(/ \\\{/, '[^}]*\\{')), `${cls} hides #overlay, #world and #wireEditor`);
    assert.match(src(file), new RegExp(`classList\\.toggle\\('${cls}'`), `${file} sets the ${cls} class`);
  });
}
test('every full-screen pane has its hide rule (a new pane with z-index 20 must be added here)', () => {
  const panes = [...css.matchAll(/^\.([a-z-]+-pane) \{[^}]*position: absolute; inset: 0; z-index: 20/gm)].map(m => m[1]);
  assert.deepEqual(panes.sort(), ['asm-pane', 'ml-pane', 'viz-pane']);
});

test('split view: a pane takes only its share of the canvas, and the circuit is clipped to the other share instead of hidden', () => {
  assert.match(css, /body\.split \.asm-pane, body\.split \.ml-pane, body\.split \.viz-pane \{ inset: 0 0 0 calc\(var\(--circ/);
  for (const c of ['robot-asm', 'ml-view', 'viz-view']) assert.match(css, new RegExp(`body\\.split\\.${c} #overlay`), `${c}: the wires are shown (clipped) in split view`);
  assert.match(css, /clip-path: inset\(0 calc\(\(1 - var\(--circ/);
});
