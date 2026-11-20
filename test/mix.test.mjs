import { mixNotes, buildPrompt } from '../src/core/ai-prompt.js';
import assert from 'node:assert/strict';
import { mixId, MIXABLE, getWorkspace } from '../src/core/workspaces.js';
assert.equal(mixId(['robotics']), 'robotics');
assert.equal(mixId(['ai', 'robotics']), 'mix-robotics-ai');
assert.equal(mixId(['ai', 'bioelectronics', 'robotics']), 'mix-robotics-bioelectronics-ai');
assert.equal(mixId([]), '');
const w = getWorkspace;
const rb = w('mix-robotics-bioelectronics');
assert.ok(rb && rb.mix && rb.robotics && rb.visualizer && !rb.ml);
const ra = w('mix-robotics-ai');
assert.ok(ra.robotics && ra.ml);
assert.deepEqual(MIXABLE, ['robotics', 'bioelectronics', 'ai']);
console.log('mix ok');


{   // the AI is told how a Mix project works: servo order, the EMG chain, and to add a board despite the robotics note
  const n = mixNotes('mix-robotics-bioelectronics');
  assert.match(n, /nth servo/); assert.match(n, /OVERRIDES/); assert.match(n, /BioAmp/); assert.doesNotMatch(n, /Train tab/);
  assert.match(mixNotes('mix-robotics-ai'), /Train tab/);
  assert.equal(mixNotes('robotics'), ''); assert.equal(mixNotes('mix-<script>'), '');
  const prompt = buildPrompt({ instruction: 'move the arm with my muscle', circuit: { parts: [], wires: [] }, workspace: 'robotics', mix: 'mix-robotics-bioelectronics' });
  assert.ok(prompt.includes('THIS PROJECT MIXES WORKSPACES') && prompt.includes('ROBOTICS workspace'));
  assert.ok(!buildPrompt({ instruction: 'x', circuit: { parts: [], wires: [] }, workspace: 'robotics' }).includes('MIXES WORKSPACES'));
}
console.log('mix prompt ok');
