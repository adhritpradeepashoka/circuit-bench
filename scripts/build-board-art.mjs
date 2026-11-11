// Builds the board sprites from Arduino's own top-view drawings (arduino/docs-content, CC BY-SA 4.0 — credit: Arduino).
//   node scripts/build-board-art.mjs [docs-content checkout]
// For each board it optimises the drawing, finds the header pads (so pins land exactly on the art) and the LED-matrix LEDs (so they can be
// lit by the simulator), and writes src/parts/art/<slug>.js (the drawing, loaded on demand) and src/core/board-geometry.generated.js (pins, sizes).
import fs from 'node:fs';
import path from 'node:path';
import { optimizeSvg } from './board-art-optimize.mjs';
import { parseAbs } from './board-art-path.mjs';

const ROOT = process.argv[2] || '/home/claude/arduino/docs-content/content/hardware';
const PX_PER_MM = 96 / 25.4, PITCH_MM = 2.54;
export const BOARDS = [
  { type: 'arduino-uno-q', slug: 'uno-q', file: 'uno/boards/uno-q/image.svg', pad: '#8b7867', led: '#ebaa01', cols: 13, rows: 8 },
  { type: 'arduino-uno-r4', slug: 'uno-r4-minima', file: 'uno/boards/uno-r4-minima/image.svg', pad: '#8b7866' },
  { type: 'arduino-uno-r4-wifi', slug: 'uno-r4-wifi', file: 'uno/boards/uno-r4-wifi/image.svg', pad: '#8b7866', led: '#eba900', cols: 12, rows: 8 },
];
const r1 = n => Math.round(n * 10) / 10;
const attr = (t, n) => +(new RegExp(`\\s${n}="([^"]*)"`).exec(t)?.[1]);
/** every drawn shape in document order: its tag text, colour and subpath boxes (a circle is one box) */
const tags = svg => [...svg.replace(/<defs>[\s\S]*?<\/defs>|<clipPath[\s\S]*?<\/clipPath>/g, '').matchAll(/<(?:path|circle)\b[^>]*\/>/g)].map(m => {
  const t = m[0], d = /\sd="([^"]*)"/.exec(t)?.[1], f = (/\sfill="([^"]*)"/.exec(t) || /fill:([^;"]*)/.exec(t))?.[1];
  const boxes = d ? parseAbs(d) : [{ x: attr(t, 'cx') - attr(t, 'r'), y: attr(t, 'cy') - attr(t, 'r'), w: 2 * attr(t, 'r'), h: 2 * attr(t, 'r') }];
  return { tag: t, d, boxes, fill: f?.toLowerCase() };
});

const out = {}, geomOut = {};
for (const b of BOARDS) {
  const svg = optimizeSvg(fs.readFileSync(path.join(ROOT, b.file), 'utf8'));
  const vb = /viewBox="([^"]*)"/.exec(svg)[1].split(/\s+/).map(Number);
  const els = tags(svg);
  const outline = els[0].boxes.sort((p, q) => q.w * q.h - p.w * p.h)[0];            // the board: the first, largest shape
  // header pads: square subpaths in the pad colour, in two long rows
  const pads = []; for (const e of els) if (e.fill === b.pad) for (const s of e.boxes) if (s.w > vb[2] / 140 && s.w < vb[2] / 25 && Math.abs(s.w - s.h) < s.w * 0.3) pads.push({ x: s.x + s.w / 2, y: s.y + s.h / 2 });
  const rowsOf = {}; for (const p of pads) (rowsOf[Math.round(p.y / 3)] ||= []).push(p);
  const rows = Object.values(rowsOf).filter(r => r.length >= 12).map(r => r.sort((p, q) => p.x - q.x)).sort((p, q) => p[0].y - q[0].y);
  if (rows.length !== 2) throw new Error(`${b.type}: expected two header rows, found ${rows.length}`);
  const pitch = (rows[0][1].x - rows[0][0].x);
  for (const r of rows) for (let i = r.length - 1; i >= 0; i--) if (!r.some((q, j) => j !== i && Math.abs(q.x - r[i].x) < pitch * 1.5)) r.splice(i, 1);          // a stray pad-coloured shape is not a header pin                                              // 2.54 mm in drawing units
  const k = (PITCH_MM * PX_PER_MM) / pitch;                                                 // drawing unit → px
  const box = { x: outline.x, y: outline.y, w: outline.w, h: outline.h };
  // matrix LEDs
  let leds = [], ledR = 0, drop = new Map();
  if (b.led) {
    const cand = els.map((e, i) => ({ e, i })).filter(({ e }) => e.fill === b.led).map(({ e, i }) => { const s = e.boxes; const x0 = Math.min(...s.map(q => q.x)), y0 = Math.min(...s.map(q => q.y)), x1 = Math.max(...s.map(q => q.x + q.w)), y1 = Math.max(...s.map(q => q.y + q.h)); return { i, x: (x0 + x1) / 2, y: (y0 + y1) / 2, r: (x1 - x0) / 2 }; });
    // cluster by y (a gap bigger than a third of a header pitch starts a new row), keep the clusters with a full row of LEDs
    cand.sort((p, q) => p.y - q.y);
    const clusters = []; for (const c of cand) { const l = clusters[clusters.length - 1]; if (l && c.y - l[l.length - 1].y < pitch / 3) l.push(c); else clusters.push([c]); }
    const rowsSorted = clusters.filter(r => r.length >= b.cols - 1).map(r => r.sort((p, q) => p.x - q.x));
    if (rowsSorted.length !== b.rows || rowsSorted.some(r => r.length !== b.cols)) throw new Error(`${b.type}: matrix LEDs found as rows of ${clusters.map(r => r.length)}, wanted ${b.rows} x ${b.cols}`);
    leds = rowsSorted.flat(); ledR = r1((leds[1].x - leds[0].x) * 0.36);   drop = new Map(leds.map((c, n) => [c.i, `${Math.floor(n / b.cols) * 13 + (n % b.cols)}`]));      // drawing index → data-i (row * 13 + column)
  }
  const ledTag = (t, n) => t.replace(/\sstyle="[^"]*"/, '').replace(/\sfill="[^"]*"/, '').replace(/^<(path|circle)/, `<$1 class="mx" data-i="${n}" fill="${b.led}"`);
const body = els.map((e, i) => (drop.has(i) ? ledTag(e.tag, drop.get(i)) : e.tag)).join('');
  const W = r1(box.w * k), H = r1(box.h * k);
  out[b.slug] = `// ${b.type}: top view drawn by Arduino (arduino/docs-content, CC BY-SA 4.0), converted by scripts/build-board-art.mjs. Do not edit.\nexport const ART = ${JSON.stringify({ vb: [r1(box.x), r1(box.y), r1(box.w), r1(box.h)], w: W, h: H, matrix: leds.length, svg: body })};\n`;
  const px = p => [r1((p.x - box.x) * k), r1((p.y - box.y) * k)];
  geomOut[b.type] = { w: W, h: H, k: +k.toFixed(5), top: rows[0].map(px), bottom: rows[1].map(px), ...(b.led ? { cols: b.cols, rows: b.rows } : {}) };
  console.log(`${b.type}: ${W}×${H}px, pads ${rows[0].length}+${rows[1].length}, matrix ${leds.length}, drawing ${(body.length / 1024).toFixed(0)} KB`);
}
fs.mkdirSync('src/parts/art', { recursive: true });
for (const [slug, code] of Object.entries(out)) fs.writeFileSync(`src/parts/art/${slug}.js`, code);
fs.writeFileSync('src/core/board-geometry.generated.js', `// Sizes and header-pad positions (px) of the boards drawn from Arduino's top-view drawings. Generated by scripts/build-board-art.mjs.\nexport const BOARD_GEOM = ${JSON.stringify(geomOut)};\n`);
