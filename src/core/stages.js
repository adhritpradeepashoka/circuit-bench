// Stages: the student's goals for this project, in order. Each one is a preset of which views are on screen (see ui/stages.js, which applies them).
// Which stages a project gets depends only on what it contains (mixContext) and which workspaces are on, so a plain circuit gets none to think about,
// an exoskeleton gets "Trigger & watch", and an ML + Bioelectronics project gets Build → Record → Train → Try it.
//
// A stage: { id, label, hint, circ (is the circuit on screen), panes: [[group, view?]…], ratio (the circuit's share of the width) }
// Groups: 'assembly' (view 'assembly' | 'test'), 'ml' (view 'train' | 'run' | 'viz'), 'viz' (electrode placement), 'body' (the person).

/** @param ctx the mixContext of the project; @param avail which workspaces are on: { ml, robotics, viz } */
export function resolveStages(ctx = {}, avail = {}) {
  const S = [{ id: 'build', label: 'Build', circ: true, panes: [], hint: 'Drag parts onto the board and wire them up. Press Run when you want to see it work.' }];
  if (avail.robotics) S.push(
    { id: 'assemble', label: 'Assemble', circ: false, panes: [['assembly', 'assembly']], hint: 'Build the robot’s body from parts in 3D.' },
    { id: 'test', label: 'Test', circ: false, panes: [['assembly', 'test']], hint: 'Try your build in the physics test.' });
  if (avail.viz) S.push({ id: 'electrodes', label: 'Electrodes', circ: false, panes: [['viz']], hint: 'Drag each channel’s E+ and E− onto the body, or choose sites from the lists.' });
  if (ctx.hasBody && !avail.ml) S.push({ id: 'person', label: ctx.mover ? 'Trigger & watch' : 'Watch the person', circ: true, ratio: 0.4, panes: [['body']],
    hint: ctx.mover ? 'Press “Flex right arm” to tense a muscle, then Run: the servo and the joint follow.' : 'Press a muscle button and watch the signal on each channel.' });
  if (ctx.hasBody && avail.ml) S.push(
    { id: 'record', label: 'Record', circ: false, panes: [['body']], hint: 'Press “Record all”. The person does each gesture while the examples are collected.' },
    { id: 'train', label: 'Train', circ: false, panes: [['ml', 'train']], hint: 'Check your examples, then press Train.' },
    { id: 'try', label: 'Try it', circ: true, ratio: 0.4, panes: [['body']], hint: 'Trigger a gesture and watch what the model sees.' });
  if (!ctx.hasBody && avail.ml) S.push(
    { id: 'train', label: 'Teach it', circ: false, panes: [['ml', 'train']], hint: 'Record examples from the board for each class, then press Train.' },
    { id: 'try', label: 'Try it', circ: true, ratio: 0.45, panes: [['ml', 'run']], hint: 'Press Run in the circuit and watch the model’s answer.' },
    { id: 'inside', label: 'See inside', circ: false, panes: [['ml', 'viz']], hint: 'The network’s neurons light up as it decides.' });
  return S;
}

/** The stage that is on screen now, or null for a layout that is none of them. `open` = { circ: bool, panes: { group: view } } */
export function matchStage(stages, open) {
  const names = Object.keys(open.panes || {});
  return stages.find(s => s.circ === !!open.circ && s.panes.length === names.length && s.panes.every(([g, v]) => g in open.panes && (!v || open.panes[g] === v))) || null;
}

/** Stages that are done, from what the project holds: samples recorded, a model trained. */
export function doneStages({ samples = 0, model = false } = {}) {
  const d = new Set(); if (samples > 0) d.add('record'); if (model) d.add('train'); return d;
}
