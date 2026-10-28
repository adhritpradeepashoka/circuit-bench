// The Test tab for anything that is not a drone: a dog, a car, an arm, a single limb. The assembled robot is turned into rigid bodies and hinges
// (core/robot-model.js) and run on the MuJoCo physics engine (core/robot-sim.js) with gravity, a floor and friction. Every servo has a slider; a sketch
// (core/robot-fc.js) can drive them instead and read back angles, tilt and spin. three.js and the physics engine load the first time this opens.
// Everything shown is an ESTIMATE from the parts' masses and shapes and a typical hobby servo, and the page says so.
import { robotFromAssembly } from '../core/robot-model.js';
import { RobotSim, loadMujoco, DT } from '../core/robot-sim.js';
import { RobotController, STARTER_ROBOT_SKETCH, CONTROL_DT } from '../core/robot-fc.js';

const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const SKETCH_KEY = 'circuitbench:robot-sketch', WHICH_KEY = 'circuitbench:robot-which';
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* not saved */ } } };
const MODE_NAMES = { servo: 'Servo (angle)', motor: 'Motor (wheel)', free: 'Free (no motor)' };
const STEPS = Math.round(CONTROL_DT / DT);

export function initRobotTest({ host, getAsm, getAnchor, getHull, prepare, goAssembly, switchTo }) {
  host.replaceChildren();
  const stage = el('div', { className: 'asm-stage fly-stage' }), side = el('div', { className: 'asm-side fly-side' });
  host.append(stage, side); host.classList.add('fly-pane');
  for (const t of ['wheel', 'touchmove']) side.addEventListener(t, e => e.stopPropagation(), { passive: true });
  const hud = el('div', { className: 'fly-hud', id: 'robHud', role: 'status' }), msg = el('div', { className: 'fly-msg', id: 'robMsg', role: 'status', hidden: true }), empty = el('div', { className: 'fly-empty', id: 'robEmpty', hidden: true });
  const switchBtn = el('button', { type: 'button', className: 'asm-btn fly-switch', id: 'robSwitch', textContent: 'Fly it as a drone instead', title: 'Use the drone flight test for this build' }); switchBtn.addEventListener('click', () => switchTo?.('fly'));
  stage.append(hud, msg, empty, switchBtn);

  /* ── the side panel ── */
  const resetBtn = el('button', { type: 'button', className: 'asm-btn primary', id: 'robReset', textContent: 'Drop it again  (R)' });
  const camSel = el('select', { id: 'robCam', ariaLabel: 'Camera' }, el('option', { value: 'follow', textContent: 'Follow the robot' }), el('option', { value: 'fixed', textContent: 'Stay here, watch it' }));
  const speedSel = el('select', { id: 'robSpeed', ariaLabel: 'Speed of time' }, el('option', { value: '1', textContent: 'Real time' }), el('option', { value: '0.5', textContent: 'Half speed' }), el('option', { value: '0.2', textContent: 'Slow motion (0.2×)' }));
  const field = (label, ctl) => el('label', { className: 'asm-field' }, el('span', { textContent: label }), ctl);
  const summary = el('p', { className: 'asm-note', id: 'robSummary' }), notes = el('div', { className: 'asm-note bad', id: 'robNotes' }), jointBox = el('div', { className: 'fly-motors', id: 'robJoints' });
  const whichSel = el('select', { id: 'robWhich', ariaLabel: 'Which controller' }, el('option', { value: 'starter', textContent: 'Built-in (sliders and keys, read-only)' }), el('option', { value: 'mine', textContent: 'My sketch (edit below)' }));
  const code = el('textarea', { id: 'robCode', className: 'fly-code', spellcheck: false, rows: 16, ariaLabel: 'Robot sketch' });
  const applyBtn = el('button', { type: 'button', className: 'asm-btn primary', id: 'robApply', textContent: 'Run this sketch' }), restoreBtn = el('button', { type: 'button', className: 'asm-btn', id: 'robRestore', textContent: 'Start from the starter' });
  const errBox = el('div', { className: 'asm-note bad', id: 'robErr', hidden: true }), logBox = el('pre', { className: 'fly-log', id: 'robLog', hidden: true });
  side.append(el('h4', { textContent: 'Physics test' }), el('div', { className: 'asm-row' }, resetBtn), field('Camera', camSel), field('Time', speedSel),
    el('p', { className: 'asm-note', innerHTML: '<b>Keys:</b> ↑↓ / W S drive forward and back · ←→ / A D turn · Q E sideways · R drop it again. A game pad works too. Orbit with the mouse, scroll to zoom.' }),
    el('h4', { textContent: 'This robot' }), summary, notes, el('h4', { textContent: 'Joints' }), jointBox,
    el('p', { className: 'asm-note', textContent: 'Each hinge is a servo by default. A round part turning on its axle is found as a wheel (a motor). Choose “Free” for a hinge with no motor, like a passive wheel.' }),
    el('h4', { textContent: 'Controller' }), field('Runs', whichSel), code, el('div', { className: 'asm-row' }, applyBtn, restoreBtn), errBox, logBox,
    el('p', { className: 'asm-note', textContent: 'An estimate: rigid parts shaped from your 3D models, the masses you gave, a typical 9 g servo (0.18 N·m, 500°/s) and a hobby gear motor, friction 1.0 on a flat floor, and no wiring or battery limits yet. Parts only touch the floor, not each other. Your sketch runs as code in this page, so only run sketches you trust.' }));
  const saved = store.get(SKETCH_KEY); let mine = saved && saved.includes('loop') ? saved : STARTER_ROBOT_SKETCH, which = store.get(WHICH_KEY) === 'mine' ? 'mine' : 'starter';
  const showCode = () => { whichSel.value = which; code.value = which === 'mine' ? mine : STARTER_ROBOT_SKETCH; code.scrollTop = 0; code.readOnly = which !== 'mine'; applyBtn.textContent = which === 'mine' ? 'Run this sketch' : 'Drop it again'; restoreBtn.hidden = which !== 'mine'; };
  showCode();
  whichSel.addEventListener('change', () => { which = whichSel.value; store.set(WHICH_KEY, which); showCode(); restart(); });
  code.addEventListener('input', () => { if (which === 'mine') { mine = code.value; store.set(SKETCH_KEY, mine); } });
  code.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); const a = code.selectionStart; code.setRangeText('  ', a, code.selectionEnd, 'end'); code.dispatchEvent(new Event('input')); } e.stopPropagation(); });
  restoreBtn.addEventListener('click', () => { mine = STARTER_ROBOT_SKETCH; store.set(SKETCH_KEY, mine); showCode(); restart(); });
  applyBtn.addEventListener('click', () => restart()); resetBtn.addEventListener('click', () => restart());

  /* ── state ── */
  let T = null, loading = null, model = null, sim = null, ctl = null, groups = [], arrow = null, active = false, raf = 0, last = 0, acc = 0, hudAt = 0, building = 0, mj = null, rows = [];
  const modes = {}, sliders = [], keys = new Set(); let sayTimer = 0;
  const say = (t, bad = false) => { msg.textContent = t; msg.hidden = !t; msg.classList.toggle('bad', bad); clearTimeout(sayTimer); if (t) sayTimer = setTimeout(() => { msg.hidden = true; }, bad ? 9000 : 5000); };
  const showEmpty = (title, text, extra = []) => { hud.hidden = true; empty.hidden = false; empty.replaceChildren(el('div', { className: 'fly-empty-box' }, el('h3', { textContent: title }), el('p', { textContent: text }), el('div', { className: 'asm-row' }, ...extra, (() => { const b = el('button', { type: 'button', className: 'asm-btn', textContent: 'Open Assembly' }); b.addEventListener('click', () => goAssembly()); return b; })()))); };

  async function load3d() {
    if (T) return T; if (loading) return loading;
    return (loading = (async () => {
      const THREE = await import('three'), { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); stage.prepend(renderer.domElement);
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0xcfe3f1); scene.fog = new THREE.Fog(0xcfe3f1, 4000, 14000);
      const camera = new THREE.PerspectiveCamera(50, 1, 2, 60000); camera.up.set(0, 0, 1);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a8f, 1.5)); const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(300, -400, 800); scene.add(sun);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshStandardMaterial({ color: 0xc9d6c4, roughness: 1 })); ground.position.z = -0.5; scene.add(ground);
      const grid = new THREE.GridHelper(6000, 120, 0x8da08a, 0xaabda6); grid.rotation.x = Math.PI / 2; grid.position.z = 0; scene.add(grid);
      const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = false; controls.maxDistance = 8000; controls.minDistance = 30;
      T = { THREE, renderer, scene, camera, controls, ground, grid }; new ResizeObserver(size).observe(stage); size(); return T;
    })());
  }
  function size() { if (!T) return; const r = stage.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return; T.renderer.setSize(r.width, r.height, false); T.camera.aspect = r.width / r.height; T.camera.updateProjectionMatrix(); }

  /* ── the robot on screen ── */
  function clearScene() { for (const g of groups) T.scene.remove(g); groups = []; arrow = null; }
  function buildScene() {
    const { THREE } = T, asm = getAsm(); clearScene();
    model.bodies.forEach((b, i) => {
      const g = new THREE.Group(), o = b.origin.map(v => v * 1000);
      for (const id of b.members) { const inst = asm.get(id); if (!inst?.obj) continue; const c = inst.obj.clone(true); c.position.set(inst.T.t[0] - o[0], inst.T.t[1] - o[1], inst.T.t[2] - o[2]); c.quaternion.set(...inst.T.q); c.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.emissive?.setHex(0); m.material.transparent = false; m.material.opacity = 1; m.material.depthWrite = true; } }); g.add(c); }
      T.scene.add(g); groups.push(g);
    });
    const root = model.bodies[0], F = model.forward, rel = root.points.map(p => [(p[0] - root.origin[0]) * 1000, (p[1] - root.origin[1]) * 1000, (p[2] - root.origin[2]) * 1000]);
    const reach = Math.max(...rel.map(p => p[0] * F[0] + p[1] * F[1])) + 6, top = Math.max(...rel.map(p => p[2])) + 8;
    const ext = Math.max(...rel.map(p => Math.hypot(p[0], p[1])), 10), cr = clamp(ext * 0.07, 2.5, 14), cone = new THREE.Mesh(new THREE.ConeGeometry(cr, cr * 2.8, 14), new THREE.MeshBasicMaterial({ color: 0xff6a00, depthTest: false })); cone.renderOrder = 5; cone.rotation.z = F[0] ? -Math.PI / 2 * Math.sign(F[0]) : 0;
    cone.position.set(F[0] * reach, F[1] * reach, top); groups[0].add(cone); arrow = cone;
    pose(); frameCamera(true);
  }
  function pose() { for (let i = 0; i < groups.length; i++) { const p = sim.bodyPose(i); groups[i].position.set(p.pos[0] * 1000, p.pos[1] * 1000, p.pos[2] * 1000); groups[i].quaternion.set(...p.quat); } }
  function frameCamera(initial) {
    const { THREE, camera, controls } = T, p = sim.bodyPose(0).pos, t = new THREE.Vector3(p[0] * 1000, p[1] * 1000, p[2] * 1000);
    if (initial) { const s = Math.max(model.size.height * 1000, Math.cbrt(model.massKg) * 120, 90) * 2.6, F = model.forward, r = [F[1], -F[0]]; controls.target.copy(t); camera.position.set(t.x - F[0] * s * 0.9 + r[0] * s * 0.5, t.y - F[1] * s * 0.9 + r[1] * s * 0.5, t.z + s * 0.55); camera.lookAt(t); controls.update(); return; }
    if (camSel.value === 'follow') { const d = t.clone().sub(controls.target); camera.position.add(d); controls.target.copy(t); controls.update(); }
  }

  /* ── the joints panel ── */
  function makeRows() {
    jointBox.replaceChildren(); rows = [];
    model.joints.forEach((j, k) => {
      if (sliders[k] === undefined) sliders[k] = 0;
      const sel = el('select', { ariaLabel: `${j.name}: what drives it`, className: 'asm-mini-sel', id: `robMode${k}` }, ...Object.entries(MODE_NAMES).map(([v, t]) => el('option', { value: v, textContent: t, selected: v === j.mode })));
      sel.addEventListener('change', () => { modes[j.key] = sel.value; restart(true); });
      const slider = el('input', { type: 'range', min: -100, max: 100, step: 1, value: sliders[k] * 100, ariaLabel: `${j.name}: ${j.mode === 'motor' ? 'speed' : 'angle'}`, className: 'fly-mtest', id: `robSlider${k}`, disabled: j.mode === 'free' });
      slider.addEventListener('input', () => { sliders[k] = Number(slider.value) / 100; }); slider.addEventListener('dblclick', () => { slider.value = 0; sliders[k] = 0; });
      const info = el('span', { className: 'fly-minfo', textContent: '' });
      rows.push(info); jointBox.append(el('div', { className: 'fly-mrow' }, el('span', { className: 'fly-mname', textContent: `${k + 1}  ${j.name}`, title: j.wheel ? 'Looks like a wheel' : '' }), sel, slider, info));
    });
    if (!model.joints.length) jointBox.append(el('p', { className: 'asm-note', textContent: 'No hinges. Join two parts by a single screw in Assembly to make one.' }));
  }

  /* ── running ── */
  function input() {
    let drive = 0, turn = 0, strafe = 0, lift = 0; const k = c => keys.has(c);
    if (k('ArrowUp') || k('KeyW')) drive += 1; if (k('ArrowDown') || k('KeyS')) drive -= 1; if (k('ArrowRight') || k('KeyD')) turn += 1; if (k('ArrowLeft') || k('KeyA')) turn -= 1; if (k('KeyE')) strafe += 1; if (k('KeyQ')) strafe -= 1;
    const gp = [...(navigator.getGamepads?.() || [])].find(g => g && g.connected), dz = v => (Math.abs(v) < 0.1 ? 0 : v);
    if (gp) { drive += dz(-(gp.axes[1] || 0)); turn += dz(gp.axes[0] || 0); strafe += dz(gp.axes[2] || 0); lift += dz(-(gp.axes[3] || 0)); }
    return { drive: clamp(drive), turn: clamp(turn), strafe: clamp(strafe), lift: clamp(lift) };
  }
  function control() {
    const J = model.joints, st = { angles: J.map((_, k) => sim.angle(k)), speeds: J.map((_, k) => sim.speed(k)), imu: sim.imu(), input: input(), sliders };
    const w = ctl.tick(st, sim.t); w.forEach((v, k) => { if (v != null) sim.command(k, v); });
    if (ctl.error && errBox.hidden) { errBox.hidden = false; errBox.textContent = `Your sketch has a problem: ${ctl.error}`; }
    if (ctl.log.length) { logBox.hidden = false; logBox.textContent = ctl.log.slice(-40).join('\n'); }
  }
  function newController() {
    ctl = new RobotController(which === 'mine' ? mine : STARTER_ROBOT_SKETCH, model); errBox.hidden = !ctl.error; errBox.textContent = ctl.error ? `Your sketch has a problem: ${ctl.error}` : ''; logBox.hidden = true; logBox.textContent = '';
  }
  async function restart(rebuildModel = false) { if (rebuildModel || !sim) return rebuild(); sim.reset(); newController(); acc = 0; pose(); frameCamera(true); say(''); }
  async function rebuild() {
    const my = ++building; await load3d(); await prepare?.();
    const asm = getAsm(); if (sim) { sim.dispose(); sim = null; }
    const m = robotFromAssembly(asm, { anchorId: getAnchor?.() || null, hullOf: getHull, modes });
    if (!m.ok) { model = null; if (T) clearScene(); return showEmpty('Nothing to test yet', m.error); }
    empty.hidden = false; empty.replaceChildren(el('div', { className: 'fly-empty-box' }, el('p', { textContent: 'Loading the physics engine…' })));
    try { mj = await loadMujoco(); } catch (e) { return showEmpty('The physics engine did not load', e.message); }
    if (my !== building) return;
    try { sim = new RobotSim(mj, m); } catch (e) { console.error(e); return showEmpty('This robot could not be set up', `The physics engine did not accept it (${e?.message || e}). Check for parts with no size or mass in Assembly.`); }
    model = m; empty.hidden = true; hud.hidden = false; buildScene(); makeRows(); newController(); acc = 0;
    summary.textContent = `${Math.round(m.massKg * 1000)} g · ${m.bodies.length} rigid part${m.bodies.length > 1 ? 's' : ''} · ${m.joints.length} hinge${m.joints.length === 1 ? '' : 's'}${m.fixedBase ? ' · held still in place' : ' · free, dropped on the floor'}`;
    notes.textContent = m.notes.join(' '); notes.hidden = !m.notes.length;
    for (const k of m.joints.keys()) { modes[m.joints[k].key] ??= m.joints[k].mode; }
  }
  function frame(now) {
    raf = requestAnimationFrame(frame); const dt = Math.min(0.05, (now - last) / 1000) * Number(speedSel.value); last = now;
    if (sim && T) {
      acc += dt; let n = 0; while (acc >= CONTROL_DT && n < 8) { control(); sim.step(STEPS); acc -= CONTROL_DT; n++; } if (n === 8) acc = 0;
      pose(); frameCamera(false);
      if (now - hudAt > 100) {
        hudAt = now; const s = sim.imu();
        hud.replaceChildren(...[['Height', `${(s.height * 100).toFixed(1)} cm`], ['Speed', `${s.speed.toFixed(2)} m/s`], ['Tilt', `${s.roll.toFixed(0)}° / ${s.pitch.toFixed(0)}°`], ['Time', `${sim.t.toFixed(1)} s`]].flatMap(([a, b]) => [el('span', { textContent: a }), el('b', { textContent: b })]));
        rows.forEach((r, k) => { r.textContent = model.joints[k].mode === 'motor' ? `${(sim.speed(k) / 360 * 60).toFixed(0)} rpm` : `${sim.angle(k).toFixed(0)}°`; });
      }
    }
    if (T) T.renderer.render(T.scene, T.camera);
  }
  const typing = () => /input|select|textarea/i.test(document.activeElement?.tagName || '') && document.activeElement?.type !== 'range';
  addEventListener('keydown', e => { if (!active || typing() || e.ctrlKey || e.metaKey || e.altKey) return; if (e.code === 'KeyR') { restart(); return; } if (/^(Arrow|Key[WASDQE])/.test(e.code)) { keys.add(e.code); e.preventDefault(); } });
  addEventListener('keyup', e => keys.delete(e.code)); addEventListener('blur', () => keys.clear());

  return {
    async enter() { active = true; empty.hidden = true; say(''); await rebuild(); size(); if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } },
    leave() { active = false; if (raf) cancelAnimationFrame(raf); raf = 0; keys.clear(); },
    get sim() { return sim; }, get model() { return model; }, get controller() { return ctl; },
  };
}
