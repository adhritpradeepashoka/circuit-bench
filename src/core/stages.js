// Stages: the student's goals for this project, in order. Each one is a preset of which views are on screen (see ui/stages.js, which applies them).
// Which stages a project gets depends only on what it contains (mixContext) and which workspaces are on, so a plain circuit gets none to think about,
// an exoskeleton gets "Trigger & watch", and an ML + Bioelectronics project gets Build → Record → Train → Try it.
//
// A stage: { id, label, hint, circ (is the circuit on screen), panes: [[group, view?]…], ratio (the circuit's share of the width) }
// Groups: 'assembly' (view 'assembly' | 'test'), 'ml' (view 'train' | 'run' | 'viz'), 'viz' (electrode placement), 'body' (the person).

const NEED_AMP = 'Add a BioAmp EXG Pill (under Sensors) to the circuit first: it is the channel the electrodes attach to.';
const NEED_SAMPLES = 'Record some examples first: the model learns from them.';
const NEED_MODEL = 'Train the model first.';

/**
 * @param ctx the mixContext of the project; @param avail which workspaces are on: { ml, robotics, viz };
 * @param progress what has been done so far: { samples, model }
 * The journey is shown from the start (recognition over recall). A stage whose parts or data do not exist yet is `locked`, with the reason in `locked`;
 * it opens by itself the moment the project has what it needs.
 */
export function resolveStages(ctx = {}, avail = {}, progress = {}) {
  const body = !!ctx.hasBody || !!avail.viz, amp = !!ctx.hasBody, hasData = (progress.samples || 0) > 0 || !!progress.model, trained = !!progress.model;
  const L = (stage, reason) => (reason ? { ...stage, locked: reason } : stage);
  const S = [{ id: 'build', label: 'Build', circ: true, panes: [], hint: 'Drag parts onto the board and wire them up. Press Run when you want to see it work.' }];
  if (avail.robotics) S.push(
    { id: 'assemble', label: 'Assemble', circ: false, panes: [['assembly', 'assembly']], hint: 'Build the robot’s body from parts in 3D.' },
    { id: 'test', label: 'Test', circ: false, panes: [['assembly', 'test']], hint: 'Try your build in the physics test.' });
  if (avail.viz) S.push(L({ id: 'electrodes', label: 'Electrodes', circ: false, panes: [['viz']], hint: 'Drag each channel’s E+ and E− onto the body, or choose sites from the lists.' }, !amp && NEED_AMP));
  if (body && !avail.ml) S.push(L({ id: 'person', label: ctx.mover ? 'Trigger & watch' : 'Watch the person', circ: true, ratio: 0.4, panes: [['body']],
    hint: ctx.mover ? 'Press “Flex right arm” to tense a muscle, then Run: the servo and the joint follow.' : 'Press a muscle button and watch the signal on each channel.' }, !amp && NEED_AMP));
  if (body && avail.ml) S.push(
    L({ id: 'record', label: 'Record', circ: false, panes: [['body']], hint: 'Press “Record all”. The person does each gesture while the examples are collected.' }, !amp && NEED_AMP),
    L({ id: 'train', label: 'Train', circ: false, panes: [['ml', 'train']], hint: 'Check your examples, then press Train.' }, !amp ? NEED_AMP : !hasData && NEED_SAMPLES),
    L({ id: 'try', label: 'Try it', circ: true, ratio: 0.4, panes: [['body']], hint: 'Trigger a gesture and watch what the model sees.' }, !amp ? NEED_AMP : !trained && NEED_MODEL));
  if (!body && avail.ml) S.push(
    { id: 'train', label: 'Teach it', circ: false, panes: [['ml', 'train']], hint: 'Record examples from the board for each class, then press Train.' },
    { id: 'try', label: 'Try it', circ: true, ratio: 0.45, panes: [['ml', 'run']], hint: 'Press Run in the circuit and watch the model’s answer.' },
    L({ id: 'inside', label: 'See inside', circ: false, panes: [['ml', 'viz']], hint: 'The network’s neurons light up as it decides.' }, !trained && NEED_MODEL));
  return S;
}

/**
 * What to do next, from where the project is: { id, why } or null. Only stages that can be finished (electrodes placed, examples recorded, model trained) count:
 * the next one is the first of those not done. When that one is still locked, the next step is to add what it needs, back on Build.
 */
export function nextStep(stages, done = new Set()) {
  const track = stages.filter(s => ['electrodes', 'record', 'train'].includes(s.id));
  if (!track.length) return null;
  const first = track.find(s => !done.has(s.id));
  if (!first) { const last = track.at(-1), after = stages[stages.indexOf(last) + 1]; return after && !after.locked ? { id: after.id, why: after.hint } : null; }
  return first.locked ? { id: 'build', why: first.locked } : { id: first.id, why: first.hint };
}

/** The stage that is on screen now, or null for a layout that is none of them. `open` = { circ: bool, panes: { group: view } } */
export function matchStage(stages, open) {
  const names = Object.keys(open.panes || {});
  return stages.find(s => s.circ === !!open.circ && s.panes.length === names.length && s.panes.every(([g, v]) => g in open.panes && (!v || open.panes[g] === v))) || null;
}

/** Stages that are done, from what the project holds: samples recorded, a model trained. */
export function doneStages({ samples = 0, model = false, placed = false } = {}) {
  const d = new Set(); if (placed) d.add('electrodes'); if (samples > 0) d.add('record'); if (model) d.add('train'); return d;
}
