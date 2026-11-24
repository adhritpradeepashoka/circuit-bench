// A small 3D viewport showing the full-body model: it bends the elbow as the person flexes (or as the servo moves), lights the working muscles and
// marks where the electrodes are. Used by the dock; the Visualizer has its own scene. three.js loads the first time one is made.
import { bodyState } from './body-state.js';
import { loadBodyRig } from './body-rig.js';

const FRAMES = { arm: { t: [3.0, 0, 11.8], dist: 12.5, yaw: 0.55, pitch: 0.12 }, upper: { t: [0, 0, 10.6], dist: 23.5, yaw: 0.45, pitch: 0.1 }, full: { t: [0, 0, 8.6], dist: 28, yaw: 0.4, pitch: 0.08 } };

export async function createBodyView(container, { frame = 'upper' } = {}) {
  const THREE = await import('three');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100); camera.up.set(0, 0, 1);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.5)); const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(3, 8, 10); scene.add(sun);
  const rig = await loadBodyRig(THREE); scene.add(rig.group);
  const dots = new Map(), dotGeo = new THREE.SphereGeometry(1, 14, 10);
  let f = FRAMES[frame] || FRAMES.upper, yaw = f.yaw, pitch = f.pitch, dist = f.dist, T = f.t.slice(), dead = false, dirty = true;
  const size = () => { const w = container.clientWidth || 280, h = container.clientHeight || 220; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true; };
  container.append(renderer.domElement); renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab';
  /** Mark electrode sites: [{ id, color }]. */
  function setDots(list) {
    const want = new Set(list.map(d => d.id));
    for (const [id, m] of dots) if (!want.has(id)) { scene.remove(m); m.material.dispose(); dots.delete(id); }
    for (const d of list) {
      let m = dots.get(d.id); if (!m) { m = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: d.color })); m.scale.setScalar(0.17); scene.add(m); dots.set(d.id, m); }
      m.material.color.set(d.color);
    }
    dirty = true;
  }
  const loop = () => {
    if (dead) return; requestAnimationFrame(loop);
    if (!container.isConnected || !container.offsetParent) return;
    const p = bodyState.pose(); if (rig.setPose(p)) dirty = true;
    if (!dirty && !dots.size) return;
    rig.group.rotation.z = yaw; rig.group.updateMatrixWorld();
    for (const [id, m] of dots) { const q = rig.sitePoint(id); if (q) { m.position.set(...q).applyMatrix4(rig.group.matrixWorld); } }
    const back = dist * Math.max(1, 1.15 / camera.aspect) ** 0.6;       // a tall, narrow viewport has to stand further back to keep the person in frame
    camera.position.set(T[0], T[1] + back * Math.cos(pitch), T[2] + back * Math.sin(pitch)); camera.lookAt(T[0], T[1], T[2]);
    renderer.render(scene, camera); dirty = false;
  };
  let last = null;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', e => { last = { x: e.clientX, y: e.clientY }; el.setPointerCapture?.(e.pointerId); el.style.cursor = 'grabbing'; });
  el.addEventListener('pointermove', e => { if (!last) return; yaw += (e.clientX - last.x) * 0.01; pitch = Math.max(-0.5, Math.min(1.2, pitch + (e.clientY - last.y) * 0.006)); last = { x: e.clientX, y: e.clientY }; dirty = true; });
  const end = () => { last = null; el.style.cursor = 'grab'; }; el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', e => { e.preventDefault(); dist = Math.max(5, Math.min(30, dist + e.deltaY * 0.01)); dirty = true; }, { passive: false });
  size(); new ResizeObserver(size).observe(container); loop();
  return {
    setDots, resize: size,
    frame(name) { const g = FRAMES[name]; if (!g) return; f = g; yaw = g.yaw; pitch = g.pitch; dist = g.dist; T = g.t.slice(); dirty = true; },
    dispose() { dead = true; rig.dispose(); renderer.dispose(); el.remove(); },
  };
}
