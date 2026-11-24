import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStages, matchStage, doneStages } from '../src/core/stages.js';

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
