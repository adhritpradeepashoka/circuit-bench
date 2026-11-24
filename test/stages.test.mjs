import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStages, matchStage, doneStages, nextStep } from '../src/core/stages.js';

const ids = s => s.map(x => x.id).join();

test('stages: a plain circuit has nothing to choose; every project starts with Build', () => {
  assert.equal(ids(resolveStages({}, {})), 'build');
  assert.equal(resolveStages({}, {})[0].circ, true);
});

test('stages: each kind of project gets its own story, in order', () => {
  assert.equal(ids(resolveStages({ hasBody: true, mover: true, scenario: 'exo' }, { viz: true })), 'build,electrodes,person');
  assert.equal(resolveStages({ hasBody: true, mover: true }, { viz: true }).at(-1).label, 'Trigger & watch');
  assert.equal(resolveStages({ hasBody: true, mover: false }, { viz: true }).at(-1).label, 'Watch the person');
  assert.equal(ids(resolveStages({ hasBody: true, learns: true, scenario: 'gesture' }, { ml: true, viz: true })), 'build,electrodes,record,train,try');
  assert.equal(ids(resolveStages({}, { ml: true })), 'build,train,try,inside');
  assert.equal(ids(resolveStages({}, { robotics: true })), 'build,assemble,test');
  assert.equal(resolveStages({ hasBody: true, learns: true }, { ml: true }).find(s => s.id === 'try').panes[0][0], 'body', 'with a person, trying it means watching the person');
  assert.equal(resolveStages({}, { ml: true }).find(s => s.id === 'try').panes[0][1], 'run', 'without one, it is the live model');
});

test('stages: the stage on screen is found from the open views; anything else is no stage', () => {
  const S = resolveStages({}, { ml: true });
  assert.equal(matchStage(S, { circ: true, panes: {} }).id, 'build');
  assert.equal(matchStage(S, { circ: false, panes: { ml: 'train' } }).id, 'train');
  assert.equal(matchStage(S, { circ: true, panes: { ml: 'run' } }).id, 'try');
  assert.equal(matchStage(S, { circ: false, panes: { ml: 'viz' } }).id, 'inside');
  assert.equal(matchStage(S, { circ: true, panes: { ml: 'train' } }), null, 'a layout of your own matches none');
});

test('stages: Record and Train tick off when there are samples and a model', () => {
  assert.equal([...doneStages({})].length, 0);
  assert.equal([...doneStages({ samples: 5 })].join(), 'record'); assert.equal([...doneStages({ samples: 5, model: true })].join(), 'record,train');
});

test('stages: the whole journey shows from the start; stages without their parts or data are locked, with the reason', () => {
  const lock = S => Object.fromEntries(S.map(s => [s.id, !!s.locked]));
  // an EMG + AI project before any amplifier is in the circuit: everything about the body is locked, nothing disappears
  const empty = resolveStages({ hasBody: false }, { viz: true, ml: true });
  assert.equal(ids(empty), 'build,electrodes,record,train,try');
  assert.deepEqual(lock(empty), { build: false, electrodes: true, record: true, train: true, try: true });
  assert.match(empty[1].locked, /BioAmp/);
  // with an amplifier: electrodes and recording open; training waits for examples, trying for a model
  assert.deepEqual(lock(resolveStages({ hasBody: true }, { viz: true, ml: true })), { build: false, electrodes: false, record: false, train: true, try: true });
  assert.deepEqual(lock(resolveStages({ hasBody: true }, { viz: true, ml: true }, { samples: 30 })), { build: false, electrodes: false, record: false, train: false, try: true });
  assert.deepEqual(lock(resolveStages({ hasBody: true }, { viz: true, ml: true }, { samples: 30, model: true })), { build: false, electrodes: false, record: false, train: false, try: false });
  // a robot with a body in it: nothing to wait for
  assert.deepEqual(lock(resolveStages({ hasBody: true, mover: true }, { viz: true, robotics: true })), { build: false, assemble: false, test: false, electrodes: false, person: false });
  // an AI board with no body: Teach it is always open; looking inside needs a model
  assert.deepEqual(lock(resolveStages({}, { ml: true })), { build: false, train: false, try: false, inside: true });
});

test('stages: the next step follows the project, and points back to Build when something has to be added', () => {
  const S = (ctx, p) => resolveStages(ctx, { viz: true, ml: true }, p);
  assert.equal(nextStep(S({ hasBody: false }), new Set()).id, 'build', 'no amplifier yet: add one');
  assert.match(nextStep(S({ hasBody: false }), new Set()).why, /BioAmp/);
  assert.equal(nextStep(S({ hasBody: true }), new Set()).id, 'electrodes');
  assert.equal(nextStep(S({ hasBody: true }), new Set(['electrodes'])).id, 'record');
  assert.equal(nextStep(S({ hasBody: true }, { samples: 9 }), new Set(['electrodes', 'record'])).id, 'train');
  assert.equal(nextStep(S({ hasBody: true }, { samples: 9, model: true }), new Set(['electrodes', 'record', 'train'])).id, 'try');
  assert.equal(nextStep(resolveStages({}, { robotics: true }), new Set()), null, 'a plain robot has no steps to nag about');
  assert.equal([...doneStages({ placed: true })].join(), 'electrodes');
});
