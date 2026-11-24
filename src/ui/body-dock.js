// The Person tab: its own view (a tab, a split side or a tile; it never floats over the circuit) that adapts to what the project is. Put a BioAmp in the circuit and it offers a person you can
// trigger (flex an arm, make a fist) with the live signal levels; add a servo or a robot and it shows the joint moving; add the AI workspace and it
// becomes a gesture lab (record, train, and watch the model recognise what the person does). It reads the parts with mixContext() and rebuilds itself
// when they change. The 3D person is body-view.js; what the simulated body is doing is core/subject.js; training is core/ml.js through core/gesture.js.
import { activeWorkspace } from '../core/workspaces.js';
import { mixContext, channelLabel, suggestPlacement } from '../core/mix-context.js';
import { subject as person, EVENT_KINDS } from '../core/subject.js';
import { defaultGestures, GESTURE_ACTIONS, windowFeatures, featureNames, gestureDataset, trainProblem, trainGesture, recognise } from '../core/gesture.js';
import { getMl, updateMl, onMl } from '../core/ml-context.js';
import { bodyState } from './body-state.js';
import { SITE } from '../core/body-sites.js';
import { joinViews } from './view-groups.js';

const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const hue = i => (i * 47 + 8) % 360, chColor = i => `hsl(${hue(i)} 72% 46%)`;
const GKEY = 'circuitbench:gestures';
const bendOf = ev => (ev === 'flexR' || ev === 'flexL' ? 1 : ev === 'fistR' || ev === 'fistL' ? 0.25 : 0);
const guessEvent = name => (/flex|bicep|curl|bend/i.test(name) ? 'flexR' : /fist|grip|clench|grab|squeeze/i.test(name) ? 'fistR' : '');
const loadGestures = () => { try { const g = JSON.parse(localStorage.getItem(GKEY)); if (Array.isArray(g) && g.length >= 2) return g.slice(0, 6).map(x => ({ name: String(x.name || 'Gesture').slice(0, 24), ev: x.ev in GESTURE_ACTIONS ? x.ev : '' })); } catch { /* none saved */ } return defaultGestures().map(({ name, ev }) => ({ name, ev })); };

export function initBodyDock({ editor, sim, ai }) {
  const canvas = document.getElementById('canvas'); if (!canvas) return null;
  bodyState.servos = () => sim?.servoAngles?.() || []; bodyState.running = () => !!sim?.running;
  const toolbar = document.querySelector('.toolbar');
  const dock = el('aside', { className: 'body-dock', hidden: true, ariaLabel: 'The person' });
  for (const t of ['pointerdown', 'wheel', 'touchmove', 'dblclick', 'contextmenu']) dock.addEventListener(t, e => e.stopPropagation(), { passive: t === 'wheel' || t === 'touchmove' ? true : undefined });
  const head = el('div', { className: 'bd-head' }), body = el('div', { className: 'bd-body' });
  dock.append(head, body); canvas.append(dock);
  let open = false, ctx = mixContext([], {}), sig = '', view = null, viewLoading = false, gestures = loadGestures(), recording = null, live = null, trainNote = '', timer = 0;
  const refs = {};

  // the tab: only projects with a body (a BioAmp on the body) get it, and it joins the other tab groups
  const toggle = el('div', { className: 'view-toggle solo-tab', role: 'group', ariaLabel: 'Person view', hidden: true }), sepAfter = el('span', { className: 'sep solo-sep', hidden: true });
  const bCircuit = el('button', { type: 'button', textContent: 'Circuit' }), bPerson = el('button', { type: 'button', textContent: 'Person', id: 'bdTab', title: 'A person you can trigger, with the signals and the joint' });
  bCircuit.dataset.circuitTab = '1'; toggle.append(bCircuit, bPerson); toolbar?.prepend(toggle, sepAfter);
  const claim = joinViews('body', () => (open ? 'person' : 'circuit'), () => setOpen(false), { label: 'Person', open: () => setOpen(true), available: () => ctx.hasBody });
  bCircuit.addEventListener('click', () => setOpen(false)); bPerson.addEventListener('click', () => setOpen(true));
  function setOpen(v) {
    v = !!v && ctx.hasBody; claim(); open = v; paintOpen(); refresh(true);
  }
  function paintOpen() {
    dock.hidden = !open; document.body.classList.toggle('body-view', open);
    bCircuit.classList.toggle('on', !open); bPerson.classList.toggle('on', open); bCircuit.setAttribute('aria-pressed', String(!open)); bPerson.setAttribute('aria-pressed', String(open));
    toggle.hidden = sepAfter.hidden = !ctx.hasBody;
  }
  const paintHead = () => { head.textContent = ctx.title || 'The person'; };
  addEventListener('resize', () => { if (open) view?.resize(); });

  const chs = () => ctx.channels;
  const placeRight = () => {
    const { assign, ref } = suggestPlacement(chs());
    for (const a of assign) { editor.setPartProp(a.id, 'sp', a.sp, { commit: false }); editor.setPartProp(a.id, 'sn', a.sn, { commit: false }); }
    for (const p of chs()) editor.setPartProp(p.id, 'sr', ref, { commit: false });
    editor.commit(); refresh(true);
  };

  /* ── building the panel ── */
  function build() {
    body.replaceChildren(); for (const k of Object.keys(refs)) delete refs[k];
    const stage = el('div', { className: 'bd-stage' }); refs.stage = stage; const left = el('div', { className: 'bd-left' }), right = el('div', { className: 'bd-right' }); body.append(left, right);
    const fr = el('div', { className: 'bd-frames' }, ...[['Arm', 'arm'], ['Upper body', 'upper'], ['Whole body', 'full']].map(([l, k]) => { const b = el('button', { type: 'button', textContent: l }); b.addEventListener('click', () => view?.frame(k)); return b; }));
    left.append(stage, fr); ensureView();
    if (ctx.modules.includes('body')) right.append(bodyModule());
    if (ctx.modules.includes('arm')) right.append(armModule());
    if (ctx.modules.includes('gesture')) right.append(gestureModule());
    paintDots();
  }
  async function ensureView() {
    if (view || viewLoading) { if (view) { refs.stage.append(view.el); view.resize(); } return; }
    viewLoading = true;
    try { const { createBodyView } = await import('./body-view.js'); const host = el('div', { className: 'bd-view' }); refs.stage.append(host); view = await createBodyView(host, { frame: ctx.scenario === 'exo' ? 'arm' : 'upper' }); view.el = host; paintDots(); }
    catch { refs.stage?.append(el('p', { className: 'bd-note', textContent: '3D view isn’t available in this browser. The buttons and meters still work.' })); }
    finally { viewLoading = false; }
  }
  function paintDots() {
    if (!view) return; const list = [];
    chs().forEach((p, i) => { for (const [k, c] of [['sp', chColor(i)], ['sn', `hsl(${hue(i)} 62% 30%)`]]) if (SITE[p[k]]?.frame === 'body') list.push({ id: p[k], color: c }); });
    const ref = chs().find(p => SITE[p.sr]?.frame === 'body')?.sr; if (ref) list.push({ id: ref, color: '#27a560' });
    view.setDots(list);
  }

  /* trigger the muscles */
  function bodyModule() {
    const sec = el('section', { className: 'bd-sec' }); sec.append(el('h4', { textContent: 'Trigger the person' }));
    const covered = new Set(ctx.covered), row = el('div', { className: 'bd-btns' }); refs.btns = {};
    for (const k of ['flexR', 'fistR', 'flexL', 'fistL']) {
      const b = el('button', { type: 'button', className: 'bd-btn', textContent: EVENT_KINDS[k].label, id: `bdHold-${k}`, title: covered.has(k) ? 'Hold this on (click again to let go)' : 'No channel has electrodes on this muscle yet' });
      b.classList.toggle('dim', !covered.has(k)); b.addEventListener('click', () => { person.hold(k); paintHolds(); }); refs.btns[k] = b; row.append(b);
    }
    const rest = el('button', { type: 'button', className: 'bd-btn quiet', textContent: 'Rest', id: 'bdRest', title: 'Let go of everything' }); rest.addEventListener('click', () => { person.holds = []; paintHolds(); }); row.append(rest);
    sec.append(row);
    if (!ctx.placed.length || !ctx.covered.length) {
      const pl = el('button', { type: 'button', className: 'bd-btn primary', textContent: 'Place electrodes on the right arm', id: 'bdPlace' }); pl.addEventListener('click', placeRight);
      sec.append(el('p', { className: 'bd-note', textContent: ctx.placed.length ? 'The electrodes are not on an arm muscle, so these buttons will not show up in your signal.' : 'No channel has electrodes yet.' }), pl);
    }
    refs.meters = el('div', { className: 'bd-meters' }); sec.append(refs.meters);
    chs().forEach((p, i) => {
      const bar = el('i'), val = el('span', { className: 'bd-val' }), r = el('div', { className: 'bd-meter' }, el('span', { className: 'bd-dot', style: `background:${chColor(i)}` }), el('span', { className: 'bd-mname', textContent: p.sp && p.sn ? channelLabel(p, i) : `Channel ${i + 1} (not placed)` }), el('span', { className: 'bd-bar' }, bar), val);
      refs.meters.append(r); (refs.meter ||= []).push({ p, bar, val });
    });
    paintHolds(); return sec;
  }
  const paintHolds = () => { for (const [k, b] of Object.entries(refs.btns || {})) { const on = person.holds.includes(k); b.classList.toggle('on', on); b.ariaPressed = String(on); } };

  /* the joint */
  function armModule() {
    const sec = el('section', { className: 'bd-sec' }); sec.append(el('h4', { textContent: 'The joint' }));
    refs.chain = el('div', { className: 'bd-chain' }); refs.source = el('p', { className: 'bd-note' }); sec.append(refs.chain, refs.source);
    if (ctx.servos.length) {
      const wire = el('button', { type: 'button', className: 'bd-btn', textContent: 'Wire the BioAmp to the servo for me', id: 'bdWire', title: 'Asks the assistant to write the sketch: BioAmp reading → servo angle' });
      wire.addEventListener('click', () => ai?.askAi?.('The servo has to be controlled by the BioAmp EXG pill', { send: true })); sec.append(wire);
    } else sec.append(el('p', { className: 'bd-note', textContent: 'No servo in the circuit yet: the arm follows the muscle directly. Add a servo (or build your exoskeleton’s joint in Assembly) and it will follow that instead.' }));
    return sec;
  }
  function paintArm(p) {
    if (!refs.chain) return;
    const lvl = Math.round(Math.max(bodyState.cur.flexR, bodyState.cur.fistR * 0.25) * 100), deg = Math.round(p.elbowR * 180 / Math.PI), servo = p.servoAngle;
    refs.chain.replaceChildren(...[[`Muscle`, `${lvl}%`], ...(ctx.servos.length ? [['Servo', servo != null ? `${Math.round(servo)}°` : '–']] : []), ['Elbow', `${deg}°`]].flatMap(([k, v], i) => [i ? el('span', { className: 'bd-arrow', textContent: '→' }) : '', el('span', { className: 'bd-chip' }, el('small', { textContent: k }), el('b', { textContent: v }))]).filter(Boolean));
    refs.source.textContent = p.source === 'servo' ? 'The arm is following the servo in your running circuit: the whole chain works (muscle → BioAmp → sketch → servo).'
      : p.source === 'gesture' ? 'The arm is following the gesture the model recognises.'
        : ctx.servos.length ? (sim?.running ? 'The servo is not moving: check that the sketch reads the BioAmp and drives it.' : 'Press Run: the sketch reads the BioAmp and drives the servo, and the arm will follow the servo.') : 'The arm follows the muscle directly.';
  }

  /* gestures: record, train, recognise */
  const saveGestures = () => { try { localStorage.setItem(GKEY, JSON.stringify(gestures)); } catch { /* storage full or off: they simply are not remembered */ } };
  const dsFor = () => { const d = getMl().dataset; return d && d.task === 'classify' && d.features.length === chs().length && d.features.every(f => /RMS$/.test(f.name)) ? d : null; };
  const counts = () => { const d = dsFor(); return gestures.map((g, i) => (d && d.classes[i] === g.name ? d.samples.filter(s => s.y === i).length : 0)); };
  function addSamples(i, xs) {
    const d = dsFor(); const have = d && d.classes.length === gestures.length && gestures.every((g, k) => d.classes[k] === g.name);
    const base = have ? d : gestureDataset(chs(), gestures, []);
    updateMl({ dataset: { ...base, features: featureNames(chs()).map(name => ({ name })), samples: [...base.samples, ...xs.map(x => ({ x, y: i }))].slice(-5000) }, model: null, history: [] }, 'data');
    live = null; bodyState.gesture = null;
  }
  function record(list) {         // record gestures one after another: the person performs each one live
    if (recording) return; const queue = list.slice(); const next = () => {
      const i = queue.shift(); if (i == null) { recording = null; person.holds = []; paintHolds(); refresh(true); return; }
      const g = gestures[i], xs = []; person.holds = g.ev ? [g.ev] : []; paintHolds(); recording = { i, n: 0, total: 20 };
      const tick = () => {
        if (!recording) return; xs.push(windowFeatures(chs(), person.now(), person)); recording.n = xs.length; refs.gstatus && (refs.gstatus.textContent = `Recording “${g.name}” ${xs.length}/${recording.total}: ${g.ev ? EVENT_KINDS[g.ev]?.label || g.ev : 'staying relaxed'}…`);
        if (xs.length >= recording.total) { addSamples(i, xs); setTimeout(next, 250); } else setTimeout(tick, 100);
      }; setTimeout(tick, 350);
    }; next();
  }
  function train() {
    const d = dsFor(), why = trainProblem(d); if (why) { trainNote = why; refresh(true); return; }
    const m = getMl(), r = trainGesture(d, { hidden: m.hidden, epochs: 120 });
    updateMl({ model: r.model, history: r.history }, 'model');
    trainNote = `Trained. It gets ${Math.round(r.accuracy * 100)}% right on examples it had not seen${r.accuracy < 0.8 ? ' — the channels cannot tell these gestures apart; try electrodes on different muscles.' : '.'}`;
    refresh(true);
  }
  function gestureModule() {
    const sec = el('section', { className: 'bd-sec' }); sec.append(el('h4', { textContent: 'Teach it gestures' }));
    const n = counts(), list = el('div', { className: 'bd-gl' });
    gestures.forEach((g, i) => {
      const name = el('input', { value: g.name, maxLength: 24, ariaLabel: 'Gesture name' }), act = el('select', { ariaLabel: 'What the person does' }, ...Object.entries(GESTURE_ACTIONS).map(([k, l]) => el('option', { value: k, textContent: l, selected: g.ev === k })));
      name.addEventListener('change', () => { g.name = name.value.trim() || g.name; saveGestures(); refresh(true); }); act.addEventListener('change', () => { g.ev = act.value; saveGestures(); });
      const rec = el('button', { type: 'button', className: 'bd-btn small', textContent: `● ${n[i]}`, title: 'Record 2 seconds of the person doing this', id: `bdRec-${i}` }); rec.addEventListener('click', () => record([i]));
      const rm = el('button', { type: 'button', className: 'bd-btn small quiet', textContent: '✕', title: 'Remove this gesture', disabled: gestures.length <= 2 }); rm.addEventListener('click', () => { gestures.splice(i, 1); saveGestures(); updateMl({ dataset: null, model: null, history: [] }, 'data'); refresh(true); });
      list.append(el('div', { className: 'bd-grow' }, name, act, rec, rm));
    });
    const add = el('button', { type: 'button', className: 'bd-btn small', textContent: '+ Gesture', disabled: gestures.length >= 6 }); add.addEventListener('click', () => { gestures.push({ name: `Gesture ${gestures.length + 1}`, ev: '' }); saveGestures(); refresh(true); });
    const all = el('button', { type: 'button', className: 'bd-btn', textContent: 'Record all', id: 'bdRecAll', title: 'The person does each gesture in turn for 2 seconds' }); all.addEventListener('click', () => record(gestures.map((_, i) => i)));
    const tr = el('button', { type: 'button', className: 'bd-btn primary', textContent: 'Train', id: 'bdTrain' }); tr.addEventListener('click', train);
    refs.gstatus = el('p', { className: 'bd-note', textContent: trainNote || (n.some(c => c) ? 'Record every gesture, then Train.' : 'Press “Record all”: the person does each gesture while it collects examples. The channels must be on different muscles for it to tell them apart.') });
    sec.append(list, el('div', { className: 'bd-btns' }, add, all, tr), refs.gstatus);
    const m = getMl().model, ok = m && m.sizes[0] === chs().length && m.classes?.length === gestures.length;
    if (ok) {
      refs.big = el('div', { className: 'bd-big', id: 'bdRecognised', textContent: '…' }); refs.probs = el('div', { className: 'bd-probs' });
      const follow = el('input', { type: 'checkbox', checked: bodyState.followGesture, id: 'bdFollow' }); follow.addEventListener('change', () => { bodyState.followGesture = follow.checked; });
      sec.append(el('h4', { textContent: 'What the model sees' }), refs.big, refs.probs, el('label', { className: 'bd-check' }, follow, el('span', { textContent: 'The arm follows what the model sees' })),
        el('p', { className: 'bd-note', textContent: 'Now trigger a gesture above and watch it. The same data is in the Train tab, and Run model can put the network on the board.' }));
      refs.pbars = gestures.map((g, i) => { const b = el('i'), r = el('div', { className: 'bd-prob' }, el('span', { textContent: g.name }), el('span', { className: 'bd-bar' }, b)); refs.probs.append(r); return b; });
    }
    return sec;
  }
  function paintGesture() {
    if (!refs.big) return; const m = getMl().model; if (!m) return;
    const r = recognise(m, windowFeatures(chs(), person.now(), person)); if (!r) return;
    live = live && live.length === r.probs.length ? live.map((v, i) => v + (r.probs[i] - v) * 0.45) : r.probs.slice();
    const idx = live.indexOf(Math.max(...live)), g = gestures[idx]; if (!g) return;
    refs.big.textContent = `${g.name}  ${Math.round(live[idx] * 100)}%`; refs.pbars?.forEach((b, i) => { b.style.width = `${Math.round((live[i] || 0) * 100)}%`; });
    bodyState.gesture = { bend: bendOf(g.ev), name: g.name };
  }

  /* ── keeping it live ── */
  function paintMeters() {
    const t = person.now();
    for (const m of refs.meter || []) { const placed = m.p.sp && m.p.sn, v = placed ? windowFeatures([m.p], t, person)[0] : 0; m.bar.style.width = `${Math.min(100, (v / 1.3) * 100)}%`; m.val.textContent = placed ? `${v.toFixed(2)} mV` : '–'; }
  }
  function frameTick() { if (!open) return; paintMeters(); const p = bodyState.pose(); paintArm(p); paintGesture(); }

  function refresh(force = false) {
    const parts = editor.state.parts, next = mixContext(parts, activeWorkspace());
    const s = [next.modules.join(), next.channels.map(p => `${p.id}:${p.sp || ''}:${p.sn || ''}:${p.sr || ''}`).join(), next.servos.length, gestures.map(g => g.name + g.ev).join(), getMl().model ? 1 : 0].join('|');
    ctx = next; if (!ctx.hasBody && open) open = false;      // the body went away (the BioAmp was deleted): leave the tab
    paintOpen(); dock.dataset.scenario = ctx.scenario; paintHead();
    if (!open) { clearInterval(timer); timer = 0; return; }
    if (!timer) timer = setInterval(frameTick, 110);
    if (force || s !== sig) { sig = s; build(); view?.resize(); }
  }
  editor.on('change', () => refresh()); editor.on('workspace', () => refresh(true)); editor.on('catalog', () => refresh());
  onMl((_, why) => { if (why === 'load') { gestures = loadGestures(); refresh(true); } });
  refresh(true);
  return { refresh, setOpen, get open() { return open; }, get context() { return ctx; } };
}
