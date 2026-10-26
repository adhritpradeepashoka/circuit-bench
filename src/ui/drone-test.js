// The Test tab for a drone: fly the assembled drone. The physics is core/drone-sim.js (motors, props, battery, ESCs, floor), the flight controller is a sketch you can read and
// change (core/drone-fc.js). This file is the screen: a 3D view with spinning props, sticks and keys, readouts, a motor monitor and the sketch editor.
// three.js loads the first time this opens. Everything shown is an ESTIMATE from typical part values, and the page says so.
import { droneFromAssembly, DroneSim, DT } from '../core/drone-sim.js';
import { SketchController, STARTER_SKETCH } from '../core/drone-fc.js';

const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const SKETCH_KEY = 'circuitbench:fc-sketch', MODE_KEY = 'circuitbench:fc-which';
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* not saved */ } } };
const MODES = [['angle', 'Level (self-levelling)'], ['althold', 'Hold height'], ['acro', 'Rate (acro)']];
const motorName = (m, i, n) => (n === 4 ? `${m.r[1] >= 0 ? 'front' : 'back'} ${m.r[0] >= 0 ? 'right' : 'left'}` : `motor ${i + 1}`);

export function initDroneTest({ host, getAsm, prepare, buildExample, goAssembly }) {
  host.replaceChildren();
  const stage = el('div', { className: 'asm-stage fly-stage' }), side = el('div', { className: 'asm-side fly-side' });
  host.append(stage, side); host.classList.add('fly-pane');
  for (const t of ['wheel', 'touchmove']) side.addEventListener(t, e => e.stopPropagation(), { passive: true });
  const hud = el('div', { className: 'fly-hud', id: 'flyHud', role: 'status' }), msg = el('div', { className: 'fly-msg', id: 'flyMsg', role: 'status', hidden: true });
  const empty = el('div', { className: 'fly-empty', id: 'flyEmpty', hidden: true });
  const rc = { armed: false, throttle: 0, roll: 0, pitch: 0, yaw: 0, mode: 'angle' };
  const input = { thr: 0, keys: new Set(), shift: false }, tgt = { roll: 0, pitch: 0, yaw: 0 };

  /* ── sticks ── */
  function stick(label, { springY }) {
    const box = el('div', { className: 'fly-stick', role: 'group', ariaLabel: label }), knob = el('div', { className: 'fly-knob' }); box.append(el('span', { className: 'fly-stick-label', textContent: label }), knob);
    const s = { x: 0, y: 0, active: false, springY, box, show(x, y) { knob.style.left = `${50 + x * 40}%`; knob.style.top = `${50 - y * 40}%`; } };
    const at = e => { const r = box.getBoundingClientRect(); return [((e.clientX - r.left) / r.width * 2 - 1) / 0.8, -((e.clientY - r.top) / r.height * 2 - 1) / 0.8]; };
    box.addEventListener('pointerdown', e => { box.setPointerCapture(e.pointerId); s.active = true; [s.x, s.y] = at(e).map(v => clamp(v)); s.x = clamp(s.x); s.y = clamp(s.y); e.preventDefault(); e.stopPropagation(); });
    box.addEventListener('pointermove', e => { if (!s.active) return; const p = at(e); s.x = clamp(p[0]); s.y = clamp(p[1]); });
    const up = () => { s.active = false; s.x = 0; if (s.springY) s.y = 0; };
    box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up); s.show(0, 0); return s;
  }
  const left = stick('Throttle · turn', { springY: false }), right = stick('Forward / back · left / right', { springY: true });
  stage.append(hud, msg, empty, el('div', { className: 'fly-sticks' }, left.box, right.box));

  /* ── the side panel ── */
  const armBtn = el('button', { type: 'button', className: 'asm-btn primary fly-arm', id: 'flyArm', textContent: 'Arm  (Space)' });
  const modeSel = el('select', { id: 'flyMode', ariaLabel: 'Flight mode' }, ...MODES.map(([v, t]) => el('option', { value: v, textContent: t })));
  const resetBtn = el('button', { type: 'button', className: 'asm-btn', id: 'flyReset', textContent: 'Reset  (R)' });
  const camSel = el('select', { id: 'flyCam', ariaLabel: 'Camera' }, el('option', { value: 'follow', textContent: 'Follow the drone' }), el('option', { value: 'fixed', textContent: 'Stay here, watch it' }), el('option', { value: 'fpv', textContent: 'FPV (needs a camera part)' }));
  const speedSel = el('select', { id: 'flySpeed', ariaLabel: 'Speed of time' }, el('option', { value: '1', textContent: 'Real time' }), el('option', { value: '0.5', textContent: 'Half speed' }), el('option', { value: '0.2', textContent: 'Slow motion (0.2×)' }));
  const field = (label, ctl) => el('label', { className: 'asm-field' }, el('span', { textContent: label }), ctl);
  const summary = el('p', { className: 'asm-note', id: 'flySummary' }), notes = el('div', { className: 'asm-note bad', id: 'flyNotes' });
  const motorBox = el('div', { className: 'fly-motors', id: 'flyMotors' });
  const whichSel = el('select', { id: 'flyWhich', ariaLabel: 'Which flight controller' }, el('option', { value: 'starter', textContent: 'Built-in (the starter sketch, read-only)' }), el('option', { value: 'mine', textContent: 'My sketch (edit below)' }));
  const code = el('textarea', { id: 'flyCode', className: 'fly-code', spellcheck: false, rows: 16, ariaLabel: 'Flight controller sketch' });
  const applyBtn = el('button', { type: 'button', className: 'asm-btn primary', id: 'flyApply', textContent: 'Run this sketch' }), restoreBtn = el('button', { type: 'button', className: 'asm-btn', id: 'flyRestore', textContent: 'Start from the starter' });
  const errBox = el('div', { className: 'asm-note bad', id: 'flyErr', hidden: true }), logBox = el('pre', { className: 'fly-log', id: 'flyLog', hidden: true });
  const keysHelp = el('p', { className: 'asm-note', innerHTML: '<b>Keys:</b> Space arm · ↑↓ throttle · ←→ turn · W/S forward/back · A/D left/right · Shift = harder · R reset · C camera · M mode. Or drag the two sticks on screen.' });
  side.append(el('h4', { textContent: 'Fly' }), armBtn, field('Mode', modeSel), el('div', { className: 'asm-row' }, resetBtn), field('Camera', camSel), field('Time', speedSel), keysHelp,
    el('h4', { textContent: 'This drone' }), summary, notes, el('h4', { textContent: 'Motors' }), motorBox, el('p', { className: 'asm-note', textContent: 'The small sliders spin one motor by itself (a motor test, with the props on).' }),
    el('h4', { textContent: 'Flight controller' }), field('Runs', whichSel), code, el('div', { className: 'asm-row' }, applyBtn, restoreBtn), errBox, logBox,
    el('p', { className: 'asm-note', textContent: 'An estimate from typical part values: an ideal rigid body, no wind, no ground effect or prop wash, and a battery that gives its full rated capacity. Real hover times are usually shorter. Your sketch runs as code in this page, so only run sketches you wrote or have read.' }));
  const saved = store.get(SKETCH_KEY); let mine = saved && saved.includes('loop') ? saved : STARTER_SKETCH, which = store.get(MODE_KEY) === 'mine' ? 'mine' : 'starter';
  const showCode = () => { whichSel.value = which; code.value = which === 'mine' ? mine : STARTER_SKETCH; code.scrollTop = code.scrollLeft = 0; code.readOnly = which !== 'mine'; applyBtn.textContent = which === 'mine' ? 'Run this sketch' : 'Reset the flight'; restoreBtn.hidden = which !== 'mine'; };
  showCode();
  whichSel.addEventListener('change', () => { which = whichSel.value; store.set(MODE_KEY, which); showCode(); reset(); });
  code.addEventListener('input', () => { if (which === 'mine') { mine = code.value; store.set(SKETCH_KEY, mine); } });
  code.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); const a = code.selectionStart; code.setRangeText('  ', a, code.selectionEnd, 'end'); code.dispatchEvent(new Event('input')); } e.stopPropagation(); });
  restoreBtn.addEventListener('click', () => { mine = STARTER_SKETCH; store.set(SKETCH_KEY, mine); showCode(); reset(); });
  applyBtn.addEventListener('click', () => reset());

  /* ── state ── */
  let readySaid = false, T = null, loading = null, model = null, sim = null, fc = null, rig = null, inner = null, spinners = [], shadow = null, fpvCam = null, active = false, raf = 0, last = 0, acc = 0, hudAt = 0, ctrlTarget = null;
  const motorTest = [], rows = [];
  let sayTimer = 0;
  const say = (t, bad = false) => { msg.textContent = t; msg.hidden = !t; msg.classList.toggle('bad', bad); clearTimeout(sayTimer); if (t) sayTimer = setTimeout(() => { msg.hidden = true; }, bad ? 9000 : 5000); };

  async function load3d() {
    if (T) return T; if (loading) return loading;
    return (loading = (async () => {
      const THREE = await import('three'), { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); stage.prepend(renderer.domElement);
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0xcfe3f1); scene.fog = new THREE.Fog(0xcfe3f1, 60000, 160000);
      const camera = new THREE.PerspectiveCamera(50, 1, 20, 400000); camera.up.set(0, 0, 1);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a8f, 1.5)); const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(3000, -4000, 8000); scene.add(sun);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(400000, 400000), new THREE.MeshStandardMaterial({ color: 0xc9d6c4, roughness: 1 })); ground.position.z = -1; scene.add(ground);
      const grid = new THREE.GridHelper(200000, 200, 0x8da08a, 0xaabda6); grid.rotation.x = Math.PI / 2; scene.add(grid);
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshBasicMaterial({ color: 0xf3c24b })); pad.position.z = 0.5; scene.add(pad);
      const pole = new THREE.Group(); for (let k = 0; k < 20; k++) { const seg = new THREE.Mesh(new THREE.CylinderGeometry(35, 35, 1000, 8), new THREE.MeshStandardMaterial({ color: k % 2 ? 0xffffff : 0xe2552d })); seg.rotation.x = Math.PI / 2; seg.position.z = 500 + k * 1000; pole.add(seg); } pole.position.set(4000, 3000, 0); scene.add(pole);   // a 20 m pole, one band per metre
      for (const [r, c] of [[5000, 0x2d7fe2], [10000, 0x2d7fe2], [20000, 0x2d7fe2]]) { const ring = new THREE.Mesh(new THREE.RingGeometry(r - 25, r + 25, 96), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, side: THREE.DoubleSide })); ring.position.z = 1; scene.add(ring); }
      const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = false; controls.maxDistance = 60000;
      T = { THREE, renderer, scene, camera, controls }; new ResizeObserver(size).observe(stage); size(); return T;
    })());
  }
  function size() { if (!T) return; const r = stage.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return; T.renderer.setSize(r.width, r.height, false); for (const c of [T.camera, fpvCam]) if (c) { c.aspect = r.width / r.height; c.updateProjectionMatrix(); } }

  /* ── putting the drone on screen ── */
  function dispose() { if (rig) { T.scene.remove(rig); rig = null; } if (shadow) { T.scene.remove(shadow); shadow = null; } spinners = []; fpvCam = null; }
  function buildRig() {
    const { THREE } = T; dispose(); rig = new THREE.Group(); inner = new THREE.Group(); rig.add(inner); inner.position.set(...model.com.map(v => -v * 1000));
    const asm = getAsm(), mine_ = asm.instances.filter(i => !model.leftOut.includes(i.id));
    const props = new Map(model.motors.map((m, k) => [m.propId, k]));
    for (const inst of mine_) {
      if (!inst.obj) continue; const c = inst.obj.clone(true); c.position.fromArray(inst.T.t); c.quaternion.set(...inst.T.q);
      c.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive?.setHex(0); o.material.transparent = false; o.material.opacity = 1; o.material.depthWrite = true; } });
      if (props.has(inst.id)) {                                                                  // a prop: turns about its motor's shaft
        const k = props.get(inst.id), m = model.motors[k], pos = m.r.map((v, i) => (v + model.com[i]) * 1000), pivot = new THREE.Group(); pivot.position.fromArray(pos); c.position.sub(pivot.position);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(inst.part.drone.R, 40), new THREE.MeshBasicMaterial({ color: 0x2b3a34, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
        const axis = new THREE.Vector3(...m.axis), dq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis); disc.quaternion.copy(dq); disc.position.z = 0;
        disc.position.copy(axis).multiplyScalar(inst.part.drone.hubH / 2); pivot.add(c, disc); inner.add(pivot); spinners.push({ pivot, disc, axis, k, angle: 0, blades: c }); continue;
      }
      inner.add(c);
    }
    T.scene.add(rig);
    shadow = new THREE.Mesh(new THREE.CircleGeometry(110, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })); shadow.position.z = 2; T.scene.add(shadow);
    const cam = asm.instances.find(i => i.part.drone?.kind === 'camera' && !model.leftOut.includes(i.id));
    if (cam) { fpvCam = new THREE.PerspectiveCamera(105, 1, 10, 400000); fpvCam.up.set(0, 0, 1); const sz = cam.part.drone.sizeMm, p = new THREE.Vector3(...cam.T.t).add(new THREE.Vector3(0, sz[1] / 2 + 2, sz[2] * 0.6));
      fpvCam.position.copy(p).sub(new THREE.Vector3(...model.com.map(v => v * 1000))); const tilt = 25 * Math.PI / 180, f = new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt)), u = new THREE.Vector3(0, -Math.sin(tilt), Math.cos(tilt)), r = new THREE.Vector3().crossVectors(f, u);
      fpvCam.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, f.clone().negate())); inner.add(fpvCam); }
    camSel.querySelector('option[value=fpv]').disabled = !fpvCam; if (!fpvCam && camSel.value === 'fpv') camSel.value = 'follow'; size();
  }
  function placeCamera() {
    const { THREE, camera, controls } = T, p = new THREE.Vector3(sim.p[0] * 1000, sim.p[1] * 1000, sim.p[2] * 1000);
    if (!T.prev) { T.prev = p.clone(); camera.position.set(p.x - 330, p.y - 620, p.z + 300); controls.target.copy(p); }
    if (camSel.value === 'follow') camera.position.add(p.clone().sub(T.prev));
    controls.target.copy(p); T.prev.copy(p); controls.update();
  }

  /* ── the flight ── */
  function makeMotorRows() {
    motorBox.replaceChildren(); rows.length = 0; motorTest.length = 0;
    model.motors.forEach((m, i) => {
      const bar = el('div', { className: 'fly-bar' }, el('i')), slider = el('input', { type: 'range', min: 0, max: 50, step: 1, value: 0, ariaLabel: `Test motor ${i + 1} on its own`, className: 'fly-mtest' }), info = el('span', { className: 'fly-minfo' });
      slider.addEventListener('input', () => { motorTest[i] = Number(slider.value) / 100; }); motorTest[i] = 0;
      motorBox.append(el('div', { className: 'fly-mrow' }, el('span', { className: 'fly-mname', textContent: `M${i + 1} ${motorName(m, i, model.motors.length)} ${m.spin > 0 ? '↺' : '↻'}`, title: `This prop turns ${m.spin > 0 ? 'counter-clockwise' : 'clockwise'} seen from above` }), bar, info, slider)); rows.push({ bar: bar.firstChild, info, slider });
    });
  }
  function rebuild() {
    const asm = getAsm(), mdl = droneFromAssembly(asm);
    if (!mdl.ok) { model = null; sim = null; fc = null; if (rig) dispose(); empty.hidden = false; empty.replaceChildren(el('div', { className: 'fly-empty-box' }, el('h3', { textContent: 'Nothing to fly yet' }), el('p', { textContent: mdl.error }), el('div', { className: 'asm-row' }, (() => { const b = el('button', { type: 'button', className: 'asm-btn primary', id: 'flyBuildExample', textContent: 'Build a 5-inch quad for me' }); b.addEventListener('click', async () => { b.disabled = true; b.textContent = 'Building…'; await buildExample(); await rebuild(); }); return b; })(), (() => { const b = el('button', { type: 'button', className: 'asm-btn', textContent: 'Open Assembly' }); b.addEventListener('click', () => goAssembly()); return b; })()))); hud.hidden = true; return; }
    empty.hidden = true; hud.hidden = false; model = mdl; sim = new DroneSim(mdl); buildRig(); makeMotorRows();
    summary.textContent = `${Math.round(mdl.massKg * 1000)} g · ${mdl.motors.length} motors · ${mdl.battery.cells}S ${mdl.battery.mAh} mAh${mdl.escAmps ? ` · ESC ${mdl.escAmps} A` : ''}`; notes.textContent = mdl.notes.join(' ');
    T.prev = null; reset(true);
  }
  function reset(keepMsg = false) {
    if (!sim) return; sim.reset(); rc.armed = false; rc.throttle = 0; input.thr = 0; left.y = 0; for (const k of ['roll', 'pitch', 'yaw']) rc[k] = tgt[k] = 0; acc = 0; T.prev = null; readySaid = false;
    fc = new SketchController(which === 'mine' ? mine : STARTER_SKETCH, model); errBox.hidden = !fc.error; errBox.textContent = fc.error ? `Your sketch has a problem: ${fc.error}` : ''; logBox.hidden = true; logBox.textContent = '';
    if (!keepMsg) say(''); say(fc.error ? '' : 'Starting up the speed controllers… then press Space to arm.'); updateArm();
  }
  function updateArm() { armBtn.textContent = rc.armed ? 'Disarm  (Space)' : 'Arm  (Space)'; armBtn.classList.toggle('on', rc.armed); }
  function toggleArm() {
    if (!sim) return;
    if (rc.armed) { rc.armed = false; say(''); return updateArm(); }
    if (sim.crashed) return say('It crashed. Press R to reset it.', true);
    if (fc.error) return say('The sketch has an error, so there is no flight controller to arm.', true);
    if (!sim.escs.every(e => e.armed)) return say('The speed controllers are still starting up. Wait a second and try again.', true);
    if (rc.mode !== 'althold' && rc.throttle > 0.05) return say('Lower the throttle all the way before arming.', true);
    if (sim.tiltDeg > 60) return say('It is on its side or upside down. Press R to reset it.', true);
    rc.armed = true; say(rc.mode === 'althold' ? 'Armed. Push the throttle up to take off; the middle holds the height.' : 'Armed. Raise the throttle to take off.'); updateArm();
  }
  function setMode(m) { rc.mode = m; modeSel.value = m; left.springY = m === 'althold'; input.thr = m === 'althold' ? 0.5 : 0; left.y = m === 'althold' ? 0 : -1; }
  function pilot(dt) {
    const k = input.keys, s = input.shift ? 1 : 0.5, kv = (a, b) => (k.has(a) ? 1 : 0) - (k.has(b) ? 1 : 0);
    const want = { roll: clamp(right.x + s * kv('d', 'a')), pitch: clamp(right.y + s * kv('w', 's')), yaw: clamp(left.x + s * kv('arrowright', 'arrowleft')) };
    for (const a of ['roll', 'pitch', 'yaw']) { const d = want[a] - rc[a], step = 6 * dt; rc[a] += clamp(d, -step, step); }
    const up = kv('arrowup', 'arrowdown');
    if (rc.mode === 'althold') rc.throttle = clamp(0.5 + 0.5 * left.y + up * (input.shift ? 0.5 : 0.3), 0, 1);            // the stick springs back to the middle, which holds the height
    else { if (left.active) input.thr = clamp((left.y + 1) / 2, 0, 1); input.thr = clamp(input.thr + up * (input.shift ? 0.9 : 0.4) * dt, 0, 1); rc.throttle = input.thr; if (!left.active) left.y = input.thr * 2 - 1; }       // the stick stays where you leave it
    left.show(rc.yaw, (rc.throttle - 0.5) * 2); right.show(rc.roll, rc.pitch);
  }
  function advance(dt) {
    acc += dt; let n = 0;
    while (acc >= DT && n < 80) {
      let us = fc.tick(sim.sense(), rc, sim.t); if (fc.error) { us = us.map(() => 1000); if (rc.armed) { rc.armed = false; updateArm(); } }
      for (let i = 0; i < us.length; i++) if (motorTest[i] > 0) us[i] = 1050 + 950 * motorTest[i];
      sim.step(us); acc -= DT; n++;
    }
    if (n >= 80) acc = 0;
    if (sim.crashed && rc.armed) { rc.armed = false; updateArm(); say(`Crashed: it hit the ground at ${sim.crashSpeed.toFixed(1)} m/s. Press R to reset.`, true); }
    else if (!readySaid && sim.t > 1.1 && !rc.armed && !sim.crashed && !fc.error) { readySaid = true; say('Ready. Press Space to arm.'); }
    if (fc.error) { errBox.hidden = false; errBox.textContent = `Your sketch stopped: ${fc.error}`; say('The sketch stopped with an error (shown on the right). Fix it and press Run.', true); }
  }
  function visuals(dt) {
    const { THREE } = T, s = sim; rig.position.set(s.p[0] * 1000, s.p[1] * 1000, s.p[2] * 1000); rig.quaternion.set(...s.q);
    for (const sp of spinners) { const w = s.omega[sp.k], dir = model.motors[sp.k].spin; sp.angle += dir * Math.min(w * dt, 0.9); sp.pivot.setRotationFromAxisAngle(sp.axis, sp.angle); const blur = clamp(w / 1200, 0, 1); sp.disc.material.opacity = 0.28 * blur; sp.blades.traverse(o => { if (o.isMesh) { o.material.transparent = blur > 0.05; o.material.opacity = 1 - 0.65 * blur; } }); }
    const alt = Math.max(0, s.altitude); shadow.position.set(s.p[0] * 1000, s.p[1] * 1000, 2); const sc = 1 + alt * 0.25; shadow.scale.setScalar(sc); shadow.material.opacity = 0.35 / (1 + alt * 0.5);
    if (camSel.value === 'fpv' && fpvCam) { rig.updateMatrixWorld(true); } else placeCamera();
  }
  function paintHud(now) {
    if (now - hudAt < 90) return; hudAt = now; const s = sim.state, minLeft = s.amps > 0.3 ? Math.max(0, s.left - 0.15) * 0.95 * model.battery.mAh / 1000 / s.amps * 60 : null;
    const line = (k, v) => `<span>${k}</span><b>${v}</b>`;
    hud.innerHTML = [line('Height', `${Math.max(0, s.altitude).toFixed(1)} m`), line('Speed', `${(s.speed * 3.6).toFixed(0)} km/h`), line('Climb', `${s.climb.toFixed(1)} m/s`), line('Tilt', `${s.tilt.toFixed(0)}°`), line('Battery', `${s.volts.toFixed(1)} V (${s.cell.toFixed(2)} per cell)`), line('Current', `${s.amps.toFixed(1)} A`), line('Used', `${Math.round(s.usedMah)} mAh · ${Math.round(s.left * 100)} % left`), line('Time', `${s.t.toFixed(0)} s${minLeft && rc.armed ? ` · about ${minLeft.toFixed(1)} min until you should land, at this draw` : ''}`)].join('');
    s.rpm.forEach((r, i) => { const row = rows[i]; if (!row) return; row.bar.style.width = `${Math.round(s.throttle[i] * 100)}%`; row.info.textContent = `${Math.round(r).toLocaleString()} rpm · ${Math.round(s.thrustGrams[i])} g`; });
    const st = sim.escs.find(e => e.status !== 'armed')?.status; if (st && sim.t > 1.3 && rc.armed) say(`Speed controller: ${st}`, true);
    if (fc && fc.log.length) { logBox.hidden = false; logBox.textContent = fc.log.slice(-8).join('\n'); }
    if (sim.landed && !rc.armed && s.tilt > 120) say('Upside down on the ground. Press R to reset.', true);
  }
  function frame(ts) {
    raf = requestAnimationFrame(frame); const dt = Math.min(0.05, (ts - last) / 1000 || 0.016); last = ts;
    if (!T || !sim) { if (T) T.renderer.render(T.scene, T.camera); return; }
    pilot(dt); advance(dt * Number(speedSel.value)); visuals(dt * Number(speedSel.value)); paintHud(ts);
    T.renderer.render(T.scene, camSel.value === 'fpv' && fpvCam ? fpvCam : T.camera);
  }

  /* ── events ── */
  armBtn.addEventListener('click', toggleArm); resetBtn.addEventListener('click', () => reset());
  modeSel.addEventListener('change', () => { setMode(modeSel.value); if (rc.armed && modeSel.value !== 'althold') say('Mode changed. Watch the throttle: it now stays where you leave it.'); });
  camSel.addEventListener('change', () => { if (T) T.prev = null; });
  addEventListener('keydown', e => {
    if (!active || host.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    const a = document.activeElement; if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'range'))) return;          // typing in the sketch: keys are for the text
    if (a && (a.tagName === 'SELECT' || a.tagName === 'BUTTON' || a.tagName === 'INPUT') && !e.target?.closest?.('.fly-code')) a.blur();                          // a dropdown or button left focused must not eat the flying keys
    const k = e.key.toLowerCase(); input.shift = e.shiftKey;
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) { input.keys.add(k); e.preventDefault(); }
    else if (k === ' ') { e.preventDefault(); if (!e.repeat) toggleArm(); }
    else if (k === 'r') reset(); else if (k === 'c') { const o = [...camSel.options].filter(x => !x.disabled).map(x => x.value); camSel.value = o[(o.indexOf(camSel.value) + 1) % o.length]; if (T) T.prev = null; }
    else if (k === 'm') { const o = MODES.map(x => x[0]); setMode(o[(o.indexOf(rc.mode) + 1) % o.length]); }
  });
  addEventListener('keyup', e => { input.shift = e.shiftKey; input.keys.delete(e.key.toLowerCase()); });
  addEventListener('blur', () => input.keys.clear());
  setMode('angle');

  return {
    async enter() { active = true; empty.hidden = true; say(''); await load3d(); await prepare(); rebuild(); size(); if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } },
    leave() { active = false; if (raf) cancelAnimationFrame(raf); raf = 0; input.keys.clear(); if (rc.armed) { rc.armed = false; updateArm(); } },
    get sim() { return sim; }, get fc() { return fc; }, get rc() { return rc; }, get model() { return model; }, arm: toggleArm, reset, setMode,
  };
}
