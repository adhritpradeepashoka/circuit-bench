import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demoDataset, createTrainer, evaluate, predict, predictClass, exportC, exampleSketch, parseCsv, toCsv, cleanDataset, paramCount } from '../src/core/ml.js';

test('a classifier learns the fan demo and holds up on samples it never trained on', () => {
  const ds = demoDataset('fan'), tr = createTrainer(ds, { hidden: [10, 6], lr: 0.03, seed: 3 });
  const h = tr.step(120);
  assert.ok(h.loss < tr.history[0].loss, 'loss falls');
  const ev = evaluate(tr.model, ds, tr.valIds);
  assert.ok(ev.accuracy > 0.88, `validation accuracy ${ev.accuracy}`);
  assert.equal(predictClass(tr.model, [800, 300]), 0, 'cool in daylight: fan off');
  assert.equal(predictClass(tr.model, [800, 760]), 2, 'hot in daylight: fan high');
  const p = predict(tr.model, [500, 500]); assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9, 'probabilities add up to 1');
});

test('a regression model learns the thermistor curve', () => {
  const ds = demoDataset('ntc'), tr = createTrainer(ds, { hidden: [12], lr: 0.03, seed: 2 });
  tr.step(200);
  const ev = evaluate(tr.model, ds, tr.valIds);
  assert.ok(ev.mae < 2.5, `mean error ${ev.mae} °C`);
});

test('training is deterministic for a seed', () => {
  const a = createTrainer(demoDataset('fan'), { seed: 5 }), b = createTrainer(demoDataset('fan'), { seed: 5 });
  a.step(5); b.step(5);
  assert.deepEqual(a.model.layers, b.model.layers);
});

test('CSV round trip and bad rows are reported', () => {
  const ds = demoDataset('fan'), { dataset, problems } = parseCsv(toCsv(ds));
  assert.equal(problems.length, 0); assert.equal(dataset.samples.length, ds.samples.length); assert.deepEqual(dataset.classes, ['off', 'low', 'high']);
  const bad = parseCsv('a,b,label\n1,2,x\n3,oops,y\n4,5');
  assert.ok(bad.problems.length >= 2);
  assert.equal(cleanDataset({ task: 'classify', features: [{ name: 'a' }], classes: ['p', 'q'], samples: [{ x: [1], y: 5 }, { x: [1], y: 1 }] }).samples.length, 1);
});

const cc = spawnSync('gcc', ['--version']).status === 0, avr = spawnSync('avr-gcc', ['-mmcu=atmega328p', '-E', '-'], { input: '#include <avr/pgm_space.h>\n#include <math.h>\n' }).status === 0;          // needs avr-libc too
function exportedMatches(ds, hidden) {
  const tr = createTrainer(ds, { hidden, seed: 4 }); tr.step(30);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbml-')), m = tr.model;
  fs.writeFileSync(path.join(dir, 'model.h'), exportC(m));
  const pts = ds.samples.slice(0, 12).map(s => s.x);
  fs.writeFileSync(path.join(dir, 'main.c'), `#include <stdio.h>\n#include "model.h"\nint main(void){ float pts[][${pts[0].length}] = {${pts.map(p => `{${p.join(',')}}`).join(',')}}; float out[model_OUTPUTS_];\n for (int i=0;i<${pts.length};i++){ int b = model_predict(pts[i], out); printf("%d", b); for(int k=0;k<model_OUTPUTS_;k++) printf(" %.5f", out[k]); printf("\\n"); } return 0; }\n`.replace(/model_OUTPUTS_/g, 'MODEL_OUTPUTS'));
  execFileSync('gcc', ['-O1', '-Wall', '-Werror', '-o', path.join(dir, 'a.out'), path.join(dir, 'main.c'), '-lm']);
  const lines = execFileSync(path.join(dir, 'a.out')).toString().trim().split('\n');
  pts.forEach((x, i) => {
    const want = predict(m, x), got = lines[i].split(' ').slice(1).map(Number);
    got.forEach((v, k) => assert.ok(Math.abs(v - want[k]) < 1e-3 * Math.max(1, Math.abs(want[k])), `point ${i} output ${k}: C ${v}, JS ${want[k]}`));
  });
  return { dir, m };
}
test('the exported C header gives the same answers as the page (classifier)', { skip: !cc }, () => { exportedMatches(demoDataset('fan'), [8, 5]); });
test('the exported C header gives the same answers as the page (regression)', { skip: !cc }, () => { exportedMatches(demoDataset('ntc'), [6]); });
test('the exported header and example sketch compile for an ATmega328P', { skip: !avr }, () => {
  const ds = demoDataset('fan'), tr = createTrainer(ds, { hidden: [8, 4] }); tr.step(5);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbml-avr-'));
  fs.writeFileSync(path.join(dir, 'model.h'), exportC(tr.model));
  const sk = exampleSketch(tr.model, ds);
  assert.match(sk, /analogRead\(A0\)/); assert.match(sk, /model_predict/);          // (the Arduino core is not here, so the header itself is what gets compiled)
  const h = spawnSync('avr-gcc', ['-mmcu=atmega328p', '-Wall', '-c', '-x', 'c', '-o', path.join(dir, 'h.o'), '-'], { input: `#include "model.h"\nint f(const float*i,float*o){return model_predict(i,o);}\n`, cwd: dir, encoding: 'utf8' });
  assert.equal(h.status, 0, h.stderr);
  assert.ok(paramCount(tr.model) > 0);
});

test('a project keeps its ML work: the dataset and trained model survive a save and load, and damaged data is dropped', async () => {
  const { cleanMl, setMl, updateMl, exportMl, getMl, hasMl } = await import('../src/core/ml-context.js');
  setMl(undefined); assert.equal(hasMl(), false); assert.equal(exportMl(), undefined);
  const ds = demoDataset('fan'), tr = createTrainer(ds, { seed: 2 }); tr.step(10);
  updateMl({ dataset: ds, model: JSON.parse(JSON.stringify(tr.model)), history: tr.history });
  const saved = JSON.parse(JSON.stringify(exportMl())); setMl(saved);
  assert.equal(getMl().dataset.samples.length, ds.samples.length);
  assert.deepEqual(predict(getMl().model, [600, 500]), predict(tr.model, [600, 500]));
  assert.equal(getMl().history.length, 10);
  const bad = cleanMl({ ...saved, model: { ...saved.model, sizes: [9, 3] } }); assert.equal(bad.model, null);
  assert.equal(cleanMl({ dataset: { task: 'classify', features: [{ name: 'a' }], samples: [{ x: [1, 2], y: 0 }] } }).dataset.samples.length, 0);
  setMl(undefined);
});
