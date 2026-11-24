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

// Pointer capture on mouse-down retargets the click, so a button inside the dragging stage never receives it.
test('the Visualizer stage does not capture the pointer for its Head / Whole body buttons', () => {
  assert.match(src('visualizer.js'), /stage\.addEventListener\('pointerdown', e => \{ if \(e\.target\.closest\?\.\('\.viz-frame/);
});

// Google's button is a light iframe; on a dark page (Forge) it gets an opaque white box unless it is told it is light.
test('the Google sign-in button keeps a transparent backdrop on dark skins', () => {
  assert.match(css, /\.gsi-host iframe \{ color-scheme: light/);
});

// A hard-coded light panel under a dark skin leaves its light headings and buttons unreadable: the drone's "Nothing to fly yet" panel takes the skin's colours.
test('the drone empty state follows the skin instead of a fixed light panel', () => {
  assert.doesNotMatch(css, /\.fly-empty \{[^}]*rgba\(238, 243, 240/);
  assert.match(css, /\.fly-empty \{[^}]*color-mix\(in srgb, var\(--mat-bg/);
});

test('the "What do you want to make?" dialog takes the skin\'s colours', () => {
  assert.match(css, /\.rt-card \{ background: var\(--surface/);
  assert.match(css, /\.rt-choice b \{[^}]*color: var\(--text/);
});
