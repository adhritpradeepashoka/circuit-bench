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
