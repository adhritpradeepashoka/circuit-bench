// Right-click an MPU-6050 → tilt it. A 3D board you grab and rotate (three.js, loaded the first time this
// opens so it never weighs on the initial page), plus roll / pitch / yaw sliders, presets and the live
// accelerometer reading. Orientation is stored on the part (roll, pitch, yaw in degrees, Z-Y-X), so it is
// saved with the project and the simulated chip reads it every frame — moving it while the sketch runs
// shows up in the gyroscope too. If WebGL isn't available the sliders still do everything.
import { gravityInBody } from '../parts/mpu6050.js';

const rad = d => (d * Math.PI) / 180, deg = r => (r * 180) / Math.PI;
const fix = v => Math.round(v * 10) / 10;

export function initMpuInspector(editor) {
  const $ = id => document.getElementById(id);
  const box = $('mpuEditor'), view = $('mpuView'), hint = $('mpuHint');
  const sliders = { roll: $('mpuRoll'), pitch: $('mpuPitch'), yaw: $('mpuYaw'), temp: $('mpuTemp') };
  const labels = { roll: $('mpuRollV'), pitch: $('mpuPitchV'), yaw: $('mpuYawV'), temp: $('mpuTempV') };
  let partId = null, three = null, loading = null;

  const part = () => (partId ? editor.partById(partId) : null);
  const isOpen = () => !box.hidden;
  function close() { box.hidden = true; partId = null; }

  function paint() {
    const p = part(); if (!p) return;
    for (const k of ['roll', 'pitch', 'yaw', 'temp']) {
      const v = p[k] ?? (k === 'temp' ? 25 : 0);
      if (document.activeElement !== sliders[k]) sliders[k].value = String(Math.round(v));
      labels[k].textContent = k === 'temp' ? `${Math.round(v)} °C` : `${Math.round(v)}°`;
    }
    const g = gravityInBody(p.roll || 0, p.pitch || 0);
    $('mpuRead').textContent = `accel  x ${g.x.toFixed(2)}  y ${g.y.toFixed(2)}  z ${g.z.toFixed(2)} g`;
    three?.pose(p);
  }

  function set(values, commit) {
    const p = part(); if (!p) return;
    for (const [k, v] of Object.entries(values)) editor.setPartProp(p.id, k, fix(v), { commit: false });
    if (commit) editor.commit();
    paint();
  }

  /* ── the 3D view ─────────────────────── */
  async function load3d() {
    if (three || loading) return loading;
    loading = (async () => {
      try {
        const THREE = await import('three');
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
        camera.up.set(0, 0, 1); camera.position.set(2.3, -3.1, 2.4); camera.lookAt(0, 0, 0);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
        const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(2, -3, 5); scene.add(sun);
        const grid = new THREE.GridHelper(6, 12, 0xb6c4be, 0xd3ddd8); grid.rotation.x = Math.PI / 2; grid.position.z = -1.2; scene.add(grid);
        const down = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1.9, 1.4, 0.9), 0.9, 0x8d9a95, 0.18, 0.1); scene.add(down);   // gravity, in the world

        // The GY-521 board: 21.6 × 16.2 mm PCB (1 unit = 10 mm), the chip, the 8-pin header along one edge,
        // and its own X / Y / Z axes as printed on the real module.
        const board = new THREE.Group();
        const pcb = new THREE.Mesh(new THREE.BoxGeometry(2.16, 1.62, 0.16), new THREE.MeshStandardMaterial({ color: 0x1d4f9e, roughness: 0.6 }));
        board.add(pcb);
        const chip = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.09), new THREE.MeshStandardMaterial({ color: 0x15181a, roughness: 0.4 }));
        chip.position.set(0, -0.1, 0.12); board.add(chip);
        const gold = new THREE.MeshStandardMaterial({ color: 0xd4a73a, metalness: 0.7, roughness: 0.35 });
        for (let i = 0; i < 8; i++) { const pin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.6), gold); pin.position.set(-0.89 + i * 0.254, 0.62, -0.2); board.add(pin); }
        const axis = (dir, color) => board.add(new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0, 0.1), 1.25, color, 0.22, 0.12));
        axis(new THREE.Vector3(1, 0, 0), 0xe0453a); axis(new THREE.Vector3(0, 1, 0), 0x27a560); axis(new THREE.Vector3(0, 0, 1), 0x2f6cf0);
        scene.add(board);

        const size = () => { const w = view.clientWidth || 244, h = view.clientHeight || 176; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
        view.prepend(renderer.domElement); hint.hidden = true;
        let queued = false;
        const draw = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; renderer.render(scene, camera); }); };
        const pose = p => { board.rotation.set(rad(p.roll || 0), rad(p.pitch || 0), rad(p.yaw || 0), 'ZYX'); draw(); };

        // Grab-and-turn: dragging spins the board about an axis perpendicular to the drag *on screen*
        // (Shift: about the view direction = roll it), then the result is read back as Z-Y-X angles.
        let last = null;
        const camRight = new THREE.Vector3(), camUp = new THREE.Vector3(), camFwd = new THREE.Vector3();
        view.addEventListener('pointerdown', e => { last = { x: e.clientX, y: e.clientY }; view.setPointerCapture?.(e.pointerId); view.classList.add('dragging'); });
        view.addEventListener('pointermove', e => {
          if (!last || !part()) return;
          const dx = e.clientX - last.x, dy = e.clientY - last.y; last = { x: e.clientX, y: e.clientY };
          camera.matrixWorld.extractBasis(camRight, camUp, camFwd);
          const q = new THREE.Quaternion();
          if (e.shiftKey) q.setFromAxisAngle(camFwd.clone().negate(), rad(dx * 0.6));
          else q.setFromAxisAngle(camUp, rad(dx * 0.6)).premultiply(new THREE.Quaternion().setFromAxisAngle(camRight, rad(dy * 0.6)));
          board.quaternion.premultiply(q);
          const eul = new THREE.Euler().setFromQuaternion(board.quaternion, 'ZYX');
          set({ roll: deg(eul.x), pitch: deg(eul.y), yaw: deg(eul.z) }, false);
        });
        const end = () => { if (!last) return; last = null; view.classList.remove('dragging'); editor.commit(); const p = part(); if (p) editor.status(`MPU-6050 tilted: roll ${Math.round(p.roll)}°, pitch ${Math.round(p.pitch)}°, yaw ${Math.round(p.yaw)}°`); };
        view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);
        three = { pose, size };
        size();
        return three;
      } catch (err) {
        hint.textContent = '3D view isn’t available in this browser — use the sliders below.';
        return null;
      } finally { loading = null; }
    })();
    return loading;
  }

  async function open({ part: p, clientX, clientY }) {
    if (p.type !== 'mpu6050') return;
    partId = p.id; box.hidden = false;
    const r = editor.canvas.getBoundingClientRect();
    box.style.left = `${Math.max(8, Math.min(clientX - r.left + 10, r.width - box.offsetWidth - 8))}px`;
    box.style.top = `${Math.max(8, Math.min(clientY - r.top + 10, r.height - box.offsetHeight - 8))}px`;
    paint();
    await load3d();
    if (three && isOpen()) { three.size(); paint(); }
  }

  editor.on('part-context', open);
  for (const k of ['roll', 'pitch', 'yaw', 'temp']) {
    sliders[k].addEventListener('input', () => set({ [k]: Number(sliders[k].value) }, false));
    sliders[k].addEventListener('change', () => set({ [k]: Number(sliders[k].value) }, true));
  }
  $('mpuPresets').addEventListener('click', e => {
    const b = e.target.closest('[data-pose]'); if (!b) return;
    const [roll, pitch, yaw] = b.dataset.pose.split(',').map(Number);
    set({ roll, pitch, yaw }, true); editor.status(`MPU-6050: ${b.textContent}`);
  });
  $('mpuClose').addEventListener('click', close);
  box.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.addEventListener('pointerdown', e => { if (isOpen() && !e.target.closest('.part-editor')) close(); }, true);
  editor.on('workspace', () => { if (isOpen()) { if (!part()) close(); else paint(); } });
  return { isOpen, open, close };
}
