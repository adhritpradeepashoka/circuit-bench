import test from 'node:test';
import assert from 'node:assert/strict';
import { mixContext, suggestPlacement, channelMuscles, channelLabel, bodyChannels } from '../src/core/mix-context.js';
import { sampleGesture, gestureDataset, defaultGestures, trainGesture, trainProblem, recognise, windowFeatures } from '../src/core/gesture.js';
import { neutralSubject } from '../src/core/subject.js';
import '../src/core/workspaces.js';

const ch = (id, sp = '', sn = '') => ({ id, type: 'custom-bioamp-exg-pill', sp, sn, sr: 'elbow-R', effort: 50 });

test('the context follows the parts: nothing without a body, then muscle→movement with a servo, gestures with AI', () => {
  assert.equal(mixContext([{ id: 'a', type: 'led' }], {}).scenario, '');
  assert.deepEqual(mixContext([ch('c1')], {}).modules, ['body']);
  const exo = mixContext([ch('c1'), { id: 's', type: 'servo' }], {});
  assert.equal(exo.scenario, 'exo'); assert.deepEqual(exo.modules, ['body', 'arm']);
  const ges = mixContext([ch('c1')], { ml: true }); assert.equal(ges.scenario, 'gesture'); assert.deepEqual(ges.modules, ['body', 'gesture']);
  assert.deepEqual(mixContext([ch('c1'), { id: 's', type: 'servo' }], { ml: true }).modules, ['body', 'arm', 'gesture']);
  assert.equal(mixContext([ch('c1')], { robotics: true }).scenario, 'exo');
});

test('placement suggestions and labels', () => {
  const chs = [ch('c1'), ch('c2')], s = suggestPlacement(chs);
  assert.deepEqual(s.assign.map(a => a.sp), ['bicep-R', 'flexor-R']);
  assert.deepEqual(channelMuscles(ch('c', 'bicep-R', 'elbow-R')), ['flexR']);
  assert.equal(channelLabel(ch('c', 'bicep-R', 'elbow-R')), 'right biceps'); assert.equal(channelLabel(ch('c')), 'Channel 1');
  assert.equal(bodyChannels([ch('c1'), { id: 'x', type: 'resistor' }]).length, 1);
});

test('the features tell a flex from a fist from rest, and a trained network recognises each', () => {
  const chs = [ch('c1', 'bicep-R', 'elbow-R'), ch('c2', 'flexor-R', 'wrist-R')], gs = defaultGestures();
  const rest = windowFeatures(chs, 5, neutralSubject()), flex = windowFeatures(chs, 5, { ...neutralSubject(), holds: ['flexR'] });
  assert.ok(flex[0] > 5 * rest[0], 'a flex lights up the biceps channel');
  const ds = gestureDataset(chs, gs, gs.map((g, i) => sampleGesture(chs, g.ev, 30, i + 1)));
  assert.equal(ds.samples.length, 90); assert.equal(trainProblem(ds), '');
  const r = trainGesture(ds); assert.ok(r.accuracy > 0.9, `accuracy ${r.accuracy}`);
  for (const [i, g] of gs.entries()) {
    let ok = 0; for (let k = 0; k < 20; k++) { const x = windowFeatures(chs, 70 + k * 0.7, { ...neutralSubject(), holds: g.ev ? [g.ev] : [] }); if (recognise(r.model, x).index === i) ok++; }
    assert.ok(ok >= 17, `${g.name}: ${ok}/20`);
  }
});

test('one channel on the biceps cannot tell a fist from rest: the trainer says so instead of pretending', () => {
  const chs = [ch('c1', 'bicep-R', 'elbow-R')], gs = defaultGestures();
  const ds = gestureDataset(chs, gs, gs.map((g, i) => sampleGesture(chs, g.ev, 30, i + 1))), r = trainGesture(ds);
  assert.ok(r.accuracy < 0.8);
  assert.match(trainProblem({ ...ds, samples: ds.samples.slice(0, 3) }), /Record/);
  assert.equal(recognise(r.model, [1, 2]), null);
});

test('the avatar follows a running servo first, then a recognised gesture, then the muscle', async () => {
  const { bodyState } = await import('../src/ui/body-state.js'), { subject } = await import('../src/core/subject.js');
  let t = 100; bodyState.servos = () => [{ partId: 's', angle: 90 }]; bodyState.running = () => false; bodyState.followGesture = false; bodyState.gesture = null; subject.holds = [];
  bodyState.pose(t);
  subject.holds = ['flexR']; for (let i = 0; i < 40; i++) bodyState.pose((t += 0.05));
  let p = bodyState.pose((t += 0.05)); assert.equal(p.source, 'muscle'); assert.ok(p.elbowR > 2, 'the muscle bends the elbow (about 140°)');
  bodyState.running = () => true; p = bodyState.pose((t += 0.05)); assert.equal(p.source, 'servo'); assert.ok(Math.abs(p.elbowR - 1.222) < 0.01, 'a servo at 90° is half the bend');
  bodyState.running = () => false; bodyState.followGesture = true; bodyState.gesture = { bend: 0, name: 'Rest' };
  for (let i = 0; i < 60; i++) p = bodyState.pose((t += 0.05)); assert.equal(p.source, 'gesture'); assert.ok(p.elbowR < 0.05, 'what the model sees (rest) moves the arm, even though the muscle is flexing');
  subject.holds = []; bodyState.gesture = null; bodyState.followGesture = false;
});
