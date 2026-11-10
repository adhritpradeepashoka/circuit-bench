// A little turnable cube in the corner of the 3D view (like Tinkercad's): it shows which way you are looking, a click on a face looks
// from that side (Front, Back, Left, Right, Top, Bottom), and dragging it turns the view. It replaces a row of view buttons.
const SIZE = 104;

/** @param {{THREE: object, camera: object, controls: object, onFace: (dir:number[])=>void, onHome: ()=>void, redraw: ()=>void}} o */
export function createViewCube({ THREE, camera, controls, onFace, onHome, redraw }) {
  const host = document.createElement('div'); host.className = 'viewcube'; host.setAttribute('role', 'group'); host.setAttribute('aria-label', 'View cube: click a side to look from it, drag to turn the view');
  const cv = document.createElement('canvas'); cv.width = cv.height = SIZE * 2; cv.style.width = cv.style.height = `${SIZE}px`; host.append(cv);
  const home = document.createElement('button'); home.type = 'button'; home.className = 'viewcube-home'; home.title = 'Home: a three-quarter view of the whole build'; home.setAttribute('aria-label', 'Home view'); home.textContent = '⌂'; home.addEventListener('click', () => onHome()); host.append(home);

  const renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true }); renderer.setPixelRatio(1); renderer.setSize(SIZE * 2, SIZE * 2, false);
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1.1, 1.1, 1.1, -1.1, 0.1, 10); cam.up.set(0, 0, 1);
  const label = (text, bg) => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, 128, 128); g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 6; g.strokeRect(3, 3, 122, 122); g.fillStyle = '#1b2a33'; g.font = '700 27px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 66); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  // BoxGeometry faces are +x −x +y −y +z −z; the mesh is turned a quarter about X so +y is the world's up (Z) and +z is the front (−Y)
  const NAMES = ['Right', 'Left', 'Top', 'Bottom', 'Front', 'Back'], BG = ['#dfe8ee', '#dfe8ee', '#f3f7f9', '#c9d5dc', '#e6eef3', '#e6eef3'];
  const mats = NAMES.map((n, i) => new THREE.MeshBasicMaterial({ map: label(n, BG[i]) }));
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), mats); mesh.rotation.x = Math.PI / 2; scene.add(mesh);
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, 1, 0]];       // where the camera goes to look at each face, as a direction from the middle

  const update = () => { cam.quaternion.copy(camera.quaternion); cam.position.set(0, 0, 4).applyQuaternion(camera.quaternion); cam.updateMatrixWorld(); renderer.render(scene, cam); };
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  const faceAt = e => { const r = cv.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)); ray.setFromCamera(ptr, cam); const h = ray.intersectObject(mesh)[0]; return h ? Math.floor(h.faceIndex / 2) : -1; };
  let down = null;
  cv.addEventListener('pointerdown', e => { e.stopPropagation(); cv.setPointerCapture(e.pointerId); down = { x: e.clientX, y: e.clientY, moved: false, face: faceAt(e) }; });
  cv.addEventListener('pointermove', e => {
    if (!down) { const f = faceAt(e); cv.style.cursor = f >= 0 ? 'pointer' : 'grab'; mats.forEach((m, i) => m.color.setScalar(i === f ? 0.82 : 1)); update(); return; }
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!down.moved && Math.hypot(dx, dy) < 4) return; down.moved = true; cv.style.cursor = 'grabbing';
    // turn the view about the point it looks at: sideways about the up axis, up and down about the camera's own sideways axis
    const off = camera.position.clone().sub(controls.target), az = -dx * 0.012, el = -dy * 0.012;
    off.applyAxisAngle(new THREE.Vector3(0, 0, 1), az);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).setZ(0).normalize(); const next = off.clone().applyAxisAngle(right, el), polar = Math.acos(Math.max(-1, Math.min(1, next.z / next.length())));
    if (polar > 0.05 && polar < Math.PI - 0.05) off.copy(next);
    camera.position.copy(controls.target).add(off); controls.update(); redraw(); down.x = e.clientX; down.y = e.clientY;
  });
  const end = e => { if (!down) return; const d = down; down = null; try { cv.releasePointerCapture(e.pointerId); } catch { /* already released */ } if (!d.moved && d.face >= 0) onFace(DIRS[d.face]); };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', () => { down = null; });
  cv.addEventListener('pointerleave', () => { mats.forEach(m => m.color.setScalar(1)); update(); });
  for (const t of ['wheel', 'contextmenu']) cv.addEventListener(t, e => { e.stopPropagation(); if (t === 'contextmenu') e.preventDefault(); }, { passive: false });
  update();
  return { el: host, update, dispose() { renderer.dispose(); mats.forEach(m => { m.map?.dispose(); m.dispose(); }); mesh.geometry.dispose(); host.remove(); } };
}
