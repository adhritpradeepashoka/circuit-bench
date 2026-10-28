// The Robotics workspace's tabs — Circuit · Assembly · Test — and the Assembly tab: import a part's 3D model (STL, OBJ or glTF/GLB),
// click its holes, shafts and connectors to place named frames, give it its mass, and save it as a robot-part description (core/robot-part.js).
// There is no CAD here on purpose: geometry comes from the user's own CAD; this tab only ANNOTATES it. three.js loads the first time it opens.
import { PartDraft, formatOf, UNIT_MM } from '../core/assembly-draft.js';
import { FRAME_KINDS, THREADS, SOURCES, provenanceOf, validateRobotPart } from '../core/robot-part.js';
import { featureEdges, circleNear, findHoles } from '../core/hole-finder.js';
import { Assembly, worldFrame, mateTransform, turn } from '../core/assembly-scene.js';
import { makeDronePart, parseDroneId, DRONE_PRESETS, DRONE_ID_HELP, MOTOR_SIZE_LIST, motorId, defaultBore } from '../core/drone-parts.js';
import { MOTOR_SIZES, STACKS, makeMotor, makeProp, makeBattery, analyseQuad } from '../core/drone.js';
import { buildDroneMesh } from './drone-models.js';
import { initRobotTest } from './robot-test.js';
import { initDroneTest } from './drone-test.js';
import { droneWiring } from '../core/drone-wiring.js';
import { describeAssembly, runAssemblyOps } from '../core/assembly-actions.js';
import { buildRig, dragTo, setAngle, connected, pointOn, heldPart, movingSide } from '../core/assembly-pose.js';
import { activeWorkspace } from '../core/workspaces.js';

const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const LIB_KEY = 'circuitbench:robot-parts', DB = 'circuitbench-robot-meshes';
const MAX_MESH = 25_000_000;

/* ── the library: descriptions in localStorage, mesh bytes in IndexedDB (memory when blocked) ── */
const memMeshes = new Map();
const idb = () => new Promise((res, rej) => { try { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('m'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } });
async function putMesh(key, buf) { try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction('m', 'readwrite'); t.objectStore('m').put(buf, key); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch { memMeshes.set(key, buf); } }
async function getMesh(key) { try { const db = await idb(); return await new Promise((res, rej) => { const q = db.transaction('m').objectStore('m').get(key); q.onsuccess = () => res(q.result || memMeshes.get(key) || null); q.onerror = () => rej(q.error); }); } catch { return memMeshes.get(key) || null; } }
async function delMesh(key) { memMeshes.delete(key); try { const db = await idb(); db.transaction('m', 'readwrite').objectStore('m').delete(key); } catch { /* nothing stored */ } }
let memLib = null;
export const libraryParts = () => {
  if (memLib) return memLib;
  try { const v = JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); return (Array.isArray(v) ? v : []).map(p => validateRobotPart(p)).filter(r => r.ok).map(r => r.part); } catch { return []; }
};
const saveLibrary = list => { try { localStorage.setItem(LIB_KEY, JSON.stringify(list)); memLib = null; } catch { memLib = list; } };

export function initAssembly({ editor, projects = null }) {
  const canvas = document.getElementById('canvas'), toolbar = document.querySelector('.toolbar');
  const tabs = el('div', { className: 'view-toggle robot-tabs', role: 'group', ariaLabel: 'Robot views', hidden: true });
  const tabBtn = {};
  for (const [id, label] of [['circuit', 'Circuit'], ['assembly', 'Assembly'], ['test', 'Test']]) { tabBtn[id] = el('button', { type: 'button', textContent: label, id: `tab-${id}` }); tabs.append(tabBtn[id]); }
  const sepAfter = el('span', { className: 'sep', hidden: true });
  toolbar.prepend(tabs, sepAfter);

  const draft = new PartDraft(); let mode = 'build';
  const pane = el('div', { className: 'asm-pane', hidden: true });
  const stage = el('div', { className: 'asm-stage' });
  const hint = el('div', { className: 'asm-hint', textContent: '', hidden: true });
  stage.append(hint);
  const side = el('div', { className: 'asm-side' });
  const testPane = el('div', { className: 'asm-pane test-pane', hidden: true }, el('div', { className: 'asm-hint', textContent: 'Opening the flight test…' }));
  const robotPane = el('div', { className: 'asm-pane test-pane', hidden: true }, el('div', { className: 'asm-hint', textContent: 'Opening the physics test…' }));
  canvas.append(pane, testPane, robotPane);
  for (const t of ['pointerdown', 'mousedown']) for (const el0 of [pane, testPane, robotPane]) el0.addEventListener(t, e => e.stopPropagation());      // the circuit canvas starts a pan on press and cancels it, which closed every dropdown here
  for (const t of ['wheel', 'touchmove']) { side.addEventListener(t, e => e.stopPropagation(), { passive: true }); testPane.addEventListener(t, e => e.stopPropagation(), { passive: true }); robotPane.addEventListener(t, e => e.stopPropagation(), { passive: true }); }      // the circuit canvas zooms on wheel; the side panel must just scroll
  pane.append(stage, side);

  // ── side panel ────────────────────────────────────────────────
  const fileIn = el('input', { type: 'file', accept: '.stl,.obj,.glb,.gltf', hidden: true, id: 'asmFile' });
  const importBtn = el('button', { type: 'button', className: 'asm-btn primary', textContent: 'Import model…', id: 'asmImport' });
  const nameIn = el('input', { type: 'text', placeholder: 'Part name', maxLength: 60, id: 'asmName', ariaLabel: 'Part name' });
  const unitsSel = el('select', { id: 'asmUnits', ariaLabel: 'Model units' }, ...Object.keys(UNIT_MM).map(u => el('option', { value: u, textContent: u })));
  const upSel = el('select', { id: 'asmUp', ariaLabel: 'Which way is up in the model' }, el('option', { value: 'z', textContent: 'Z up' }), el('option', { value: 'y', textContent: 'Y up' }));
  const massIn = el('input', { type: 'number', min: 0, step: 'any', placeholder: 'grams', id: 'asmMass', ariaLabel: 'Mass in grams' });
  const sourceSel = (id, label) => el('select', { id, ariaLabel: label }, ...SOURCES.map(s => el('option', { value: s, textContent: s })));
  const massSrc = sourceSel('asmMassSrc', 'Where the mass came from');
  const dimsEl = el('p', { className: 'asm-note', id: 'asmDims' });
  const framesEl = el('div', { className: 'asm-frames', id: 'asmFrames' });
  const kindSel = el('select', { id: 'asmKind', ariaLabel: 'What the next click marks' }, ...FRAME_KINDS.map(k => el('option', { value: k, textContent: k })));
  const msg = el('p', { className: 'asm-msg', id: 'asmMsg', role: 'status' });
  const saveBtn = el('button', { type: 'button', className: 'asm-btn primary', textContent: 'Save part', id: 'asmSave' });
  const exportBtn = el('button', { type: 'button', className: 'asm-btn', textContent: 'Download description', id: 'asmExport' });
  const libEl = el('div', { className: 'asm-lib', id: 'asmLib' });
  const DEV = (() => { try { return localStorage.getItem('circuitbench:parts-dev') === '1' || /[?&]partsdev\b/.test(location.search); } catch { return false; } })();      // marking holes on your own models is a maker's tool, kept out of the way
  const partBox = el('div', { className: 'asm-box', hidden: true }), buildBox = el('div', { className: 'asm-box' });
  const modeBar = el('div', { className: 'view-toggle asm-mode', role: 'group', ariaLabel: 'Import a part or build' });
  const modeBtn = { part: el('button', { type: 'button', id: 'asmModePart', textContent: 'Import a part' }), build: el('button', { type: 'button', id: 'asmModeBuild', textContent: 'Build' }) };
  modeBar.append(modeBtn.part, modeBtn.build); modeBtn.build.classList.add('on'); side.append(modeBar, partBox, buildBox);
  const holesBtn = el('button', { type: 'button', className: 'asm-btn', textContent: 'Find all holes', id: 'asmFindHoles', title: 'Mark every round hole in the model' });
  partBox.append(
    el('div', { className: 'asm-row' }, importBtn, fileIn),
    el('label', { className: 'asm-field' }, el('span', { textContent: 'Name' }), nameIn),
    el('div', { className: 'asm-row' }, el('label', { className: 'asm-field' }, el('span', { textContent: 'Units' }), unitsSel), el('label', { className: 'asm-field' }, el('span', { textContent: 'Up' }), upSel)),
    el('div', { className: 'asm-row' }, el('label', { className: 'asm-field' }, el('span', { textContent: 'Mass (g)' }), massIn), el('label', { className: 'asm-field' }, el('span', { textContent: 'from' }), massSrc)),
    dimsEl,
    el('h4', { textContent: 'Connection points' }),
    el('label', { className: 'asm-field' }, el('span', { textContent: 'Next click marks a' }), kindSel),
    el('p', { className: 'asm-note', textContent: 'Click the model to place a frame. Drag to orbit, scroll to zoom. A frame points out of the part (the arrow).' }),
    el('div', { className: 'asm-row' }, holesBtn), framesEl, msg, el('div', { className: 'asm-row' }, saveBtn, exportBtn),
    el('h4', { textContent: 'Your parts' }), libEl,
  );

  // ── the 3D viewer ─────────────────────────────────────────────
  let three = null, loading = null;
  async function load3d() {
    if (three) return three;
    if (!loading) loading = (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 20000); camera.up.set(0, 0, 1); camera.position.set(120, -160, 100);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1));
      const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(150, -200, 300); scene.add(sun);
      const grid = new THREE.GridHelper(400, 40, 0x7f8f88, 0xb9c4bf); grid.rotation.x = Math.PI / 2; scene.add(grid);
      const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = false;
      const root = new THREE.Group(), gizmos = new THREE.Group(), sceneRoot = new THREE.Group(), sceneGizmos = new THREE.Group(); sceneRoot.visible = sceneGizmos.visible = false; scene.add(root, gizmos, sceneRoot, sceneGizmos);
      const ray = new THREE.Raycaster();
      let model = null, scale = 1;

      const size = () => { const r = stage.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return; renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); draw(); };
      const draw = () => renderer.render(scene, camera);
      controls.addEventListener('change', draw);

      /** Put a parsed object into the scene: scaled to mm, turned Z-up, resting on the grid, centred on the origin. */
      function setModel(obj) {
        if (model) { root.remove(model); model.traverse(o => { o.geometry?.dispose(); }); }
        model = new THREE.Group(); model.add(obj); root.add(model);
        model.traverse(o => { if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ color: 0xb8c4cc, metalness: 0.15, roughness: 0.6, side: THREE.DoubleSide }); });
        applyUnits(true);
      }
      function applyUnits(refit) {
        if (!model) return;
        model.rotation.set(draft.model.up === 'y' ? Math.PI / 2 : 0, 0, 0); model.scale.setScalar(1); model.position.set(0, 0, 0); model.updateMatrixWorld(true);
        const raw = new THREE.Box3().setFromObject(model), rs = raw.getSize(new THREE.Vector3());
        draft.rawSize = [rs.x, rs.y, rs.z]; draft.refreshSize();
        scale = UNIT_MM[draft.model.units]; model.scale.setScalar(scale); model.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(model), c = b.getCenter(new THREE.Vector3());
        model.position.set(-c.x, -c.y, -b.min.z); model.updateMatrixWorld(true);       // centred in X/Y, sitting on the grid
        if (refit) fit();
        drawGizmos(); draw();
      }
      function fit() {
        const b = new THREE.Box3().setFromObject(model), s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3()), d = Math.max(s.x, s.y, s.z, 1) * 2.4;
        controls.target.copy(c); camera.position.set(c.x + d * 0.7, c.y - d, c.z + d * 0.6); camera.near = d / 100; camera.far = d * 100; camera.updateProjectionMatrix(); controls.update();
      }
      const unit = () => Math.max(...(draft.sizeMm || [20])) / 40;       // gizmo scale follows the part's size
      function drawGizmos() {
        gizmos.clear();
        if (!model) return;
        const u = unit();
        for (const f of draft.frames) {
          const sel = f.id === draft.selected, col = sel ? 0xe0562a : 0x1f7a8c, g = new THREE.Group();
          const ringR = Math.max(f.diameter ? f.diameter / 2 : 0, u * 0.6);
          g.add(new THREE.Mesh(new THREE.TorusGeometry(ringR, u * 0.12, 8, 28), new THREE.MeshBasicMaterial({ color: col, depthTest: false })));
          const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), u * 4, col, u * 1.4, u * 0.9); arrow.line.material.depthTest = false; arrow.cone.material.depthTest = false; g.add(arrow);
          g.position.fromArray(f.pos); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...f.dir).normalize());
          g.renderOrder = 10; g.traverse(o => { o.renderOrder = 10; o.userData.frame = f.id; });
          gizmos.add(g);
        }
      }
      /** The model's triangles in mm, in the part's frame (what the hole finder works on). Rebuilt when units or up-axis change. */
      let fe = null, feKey = '';
      function edges() {
        const key = `${draft.model.units}|${draft.model.up}|${model.uuid}`;
        if (fe && key === feKey) return fe;
        const out = []; model.updateMatrixWorld(true); const v = new THREE.Vector3();
        model.traverse(o => { if (!o.isMesh) return; const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, a = g.attributes.position;
          for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld); out.push(v.x, v.y, v.z); } });
        feKey = key; return (fe = featureEdges(Float32Array.from(out)));
      }
      /** A click on the canvas: a gizmo selects its frame; the model places a new one. → { hit:'frame'|'model'|null } */
      function pick(clientX, clientY) {
        const r = renderer.domElement.getBoundingClientRect();
        ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1)), camera);
        const g = ray.intersectObjects(gizmos.children, true)[0];
        if (g) return { hit: 'frame', id: g.object.userData.frame };
        if (!model) return { hit: null };
        const h = ray.intersectObject(model, true)[0];
        if (!h || !h.face) return { hit: null };
        const n = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize();
        if (n.dot(ray.ray.direction) > 0) n.negate();                              // the face we see points at us
        const P = [h.point.x, h.point.y, h.point.z], N = [n.x, n.y, n.z];
        let snap = null; try { snap = model.children.length ? circleNear(edges(), P, N) : null; } catch { /* snapping is a convenience */ }
        return snap ? { hit: 'model', pos: snap.center, dir: N, diameter: snap.radius * 2 } : { hit: 'model', pos: P, dir: N };
      }
      const el3 = renderer.domElement; stage.prepend(el3); hint.hidden = !!model;
      let down = null;
      el3.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
      el3.addEventListener('pointerup', e => {
        if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { down = null; return; }
        down = null; if (mode !== 'part') return;
        const p = pick(e.clientX, e.clientY);
        if (p.hit === 'frame') { draft.selected = p.id; renderFrames(); drawGizmos(); draw(); }
        else if (p.hit === 'model') { draft.addFrame({ pos: p.pos, dir: p.dir, kind: kindSel.value, diameter: p.diameter }); renderFrames(); drawGizmos(); draw(); }
      });
      addEventListener('resize', size);
      /** The model's volume in mm³ (from its triangles; a mesh with holes in it is approximate), used to guess how much a 3D-printed part weighs. */
      function volumeMm3() {
        if (!model) return 0; model.updateMatrixWorld(true); let vol = 0; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        model.traverse(o => { if (!o.isMesh) return; const g = o.geometry, pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count;
          for (let i = 0; i + 2 < n; i += 3) { const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2; a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld); vol += a.dot(b.cross(c)) / 6; } });
        if (Math.abs(vol) < 1) { const s = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()); return s.x * s.y * s.z * 0.15; } return Math.abs(vol);
      }
      three = { volumeMm3, edges, THREE, root, gizmos, sceneRoot, sceneGizmos, controls, ray, setModel, applyUnits, drawGizmos, draw, size, pick, hasModel: () => !!model, camera, renderer, scene, fit: () => model && (fit(), draw()) };
      size(); return three;
    })();
    return loading;
  }

  // ── importing ─────────────────────────────────────────────────
  async function parseModel(THREE, file, buf) {
    const fmt = formatOf(file.name);
    if (fmt === 'stl') { const { STLLoader } = await import('three/addons/loaders/STLLoader.js'); const g = new STLLoader().parse(buf); g.computeVertexNormals?.(); return new THREE.Mesh(g, new THREE.MeshStandardMaterial()); }
    if (fmt === 'obj') { const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js'); return new OBJLoader().parse(new TextDecoder().decode(buf)); }
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    return (await new GLTFLoader().parseAsync(buf, '')).scene;
  }
  async function importFile(file) {
    const fmt = formatOf(file?.name);
    if (!fmt) return say('That file type is not supported yet. Use STL, OBJ, GLB or glTF (export STEP from your CAD as one of these).', true);
    if (file.size > MAX_MESH) return say(`That model is ${(file.size / 1e6).toFixed(1)} MB; the limit is ${MAX_MESH / 1e6} MB. Decimate or simplify it in your CAD tool first.`, true);
    say('Loading the model…');
    try {
      const buf = await file.arrayBuffer(), t = await load3d();
      const obj = await parseModel(t.THREE, file, buf);
      draft.reset(); draft.model.format = fmt;
      draft.setMesh({ file: file.name, format: fmt, bytes: file.size, rawSize: null });
      draft.model.units = unitsSel.value; draft.model.up = upSel.value;
      t.setModel(obj); hint.hidden = true; stagedMesh = buf;
      draft.name = draft.name || file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 60); massTouched = false; estimateMass(t);
      syncForm(); renderFrames(); const n = await autoHoles(); const s = draft.sizeMm;
      say(`Loaded ${file.name}${s ? ` (${s.map(v => +v.toFixed(1)).join(' × ')} mm)` : ''}. ${n ? `Marked ${n} round hole${n > 1 ? 's' : ''} for you. ` : 'No round holes found; click the model to mark connection points by hand. '}Check the size and units, then Save part.`);
    } catch (e) { say(`Could not read that model: ${e?.message || e}`, true); }
  }
  let stagedMesh = null, massTouched = false;
  /** A guess at a printed part's weight: its volume as PLA (1.24 g/cm³) at about a third solid. Labelled "estimated" until you weigh it. */
  function estimateMass(t) { if (massTouched || !t?.hasModel()) return; const g = t.volumeMm3() * 0.00124 * 0.33; if (g > 0) { draft.massGrams = Math.max(0.1, Math.round(g * 10) / 10); draft.massSource = 'estimated'; } }
  async function autoHoles() {
    const t = await load3d(); if (!t.hasModel()) return 0; let found; try { found = findHoles(t.edges()); } catch { found = []; } let added = 0;
    for (const h of found) { if (draft.frames.some(f => f.kind === 'hole' && Math.hypot(f.pos[0] - h.center[0], f.pos[1] - h.center[1], f.pos[2] - h.center[2]) < 0.3)) continue; draft.addFrame({ pos: h.center, dir: h.axis, kind: 'hole', diameter: h.radius * 2 }); added++; }
    renderFrames(); t.drawGizmos(); t.draw(); return added;
  }
  /** Bring in a file from anywhere (the list, a drop on the 3D view): go to the import screen first. */
  async function startImport(file) { if (!file) return; if (view !== 'assembly') await show('assembly'); if (mode !== 'part') await setMode('part'); await importFile(file); }
  importBtn.addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) startImport(f); });
  // dropping a file onto the stage works too
  stage.addEventListener('dragover', e => e.preventDefault());
  stage.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) startImport(f); });

  // ── forms ─────────────────────────────────────────────────────
  function say(text, bad = false) { msg.textContent = text; msg.classList.toggle('bad', !!bad); }
  function syncForm() {
    nameIn.value = draft.name; unitsSel.value = draft.model.units; upSel.value = draft.model.up; massIn.value = draft.massGrams; massSrc.value = draft.massSource;
    const s = draft.sizeMm; dimsEl.textContent = s ? `Size from the model: ${s.map(v => +v.toFixed(2)).join(' × ')} mm (check this against the real part).` : 'No model yet.';
  }
  nameIn.addEventListener('input', () => { draft.name = nameIn.value; });
  massIn.addEventListener('input', () => { draft.massGrams = massIn.value; massTouched = true; if (massSrc.value === 'estimated' && massIn.value !== '') { draft.massSource = 'measured'; massSrc.value = 'measured'; } });
  massSrc.addEventListener('change', () => { draft.massSource = massSrc.value; });
  unitsSel.addEventListener('change', () => { draft.setUnits(unitsSel.value); three?.applyUnits(true); estimateMass(three); syncForm(); });
  upSel.addEventListener('change', () => { draft.model.up = upSel.value; three?.applyUnits(true); estimateMass(three); syncForm(); });

  function numField(label, value, onChange, { step = 'any', min = 0 } = {}) {
    const i = el('input', { type: 'number', step, min, value: value ?? '' }); i.addEventListener('change', () => onChange(i.value === '' ? '' : Number(i.value)));
    return el('label', { className: 'asm-mini' }, el('span', { textContent: label }), i);
  }
  function renderFrames() {
    framesEl.replaceChildren();
    if (!draft.frames.length) framesEl.append(el('p', { className: 'asm-note', textContent: 'No connection points yet.' }));
    for (const f of draft.frames) {
      const card = el('div', { className: `asm-frame${f.id === draft.selected ? ' sel' : ''}`, tabIndex: 0 });
      card.dataset.frame = f.id;
      card.addEventListener('click', e => { if (e.target.closest('input,select,button')) return; draft.selected = f.id; renderFrames(); three?.drawGizmos(); three?.draw(); });
      const idIn = el('input', { type: 'text', value: f.id, className: 'asm-frame-id', ariaLabel: 'Frame name' });
      idIn.addEventListener('change', () => { draft.updateFrame(f.id, { id: idIn.value }); renderFrames(); three?.drawGizmos(); three?.draw(); });
      const kind = el('select', { ariaLabel: 'Kind' }, ...FRAME_KINDS.map(k => el('option', { value: k, textContent: k, selected: k === f.kind })));
      kind.addEventListener('change', () => { draft.updateFrame(f.id, { kind: kind.value }); renderFrames(); three?.drawGizmos(); three?.draw(); });
      const del = el('button', { type: 'button', className: 'asm-x', textContent: '✕', title: 'Remove this frame', ariaLabel: `Remove ${f.id}` });
      del.addEventListener('click', () => { draft.removeFrame(f.id); renderFrames(); three?.drawGizmos(); three?.draw(); });
      card.append(el('div', { className: 'asm-row' }, idIn, kind, del));
      const fields = el('div', { className: 'asm-row wrap' });
      const redraw = () => { three?.drawGizmos(); three?.draw(); };
      if (['hole', 'shaft', 'horn'].includes(f.kind)) fields.append(numField('⌀ mm', f.diameter, v => { draft.updateFrame(f.id, { diameter: v }); redraw(); }, { min: 0 }));
      if (f.kind === 'hole') {
        const th = el('select', { ariaLabel: 'Thread' }, el('option', { value: '', textContent: 'no thread' }), ...Object.keys(THREADS).map(t => el('option', { value: t, textContent: t.replace('_', '.'), selected: t === f.thread })));
        th.addEventListener('change', () => { const c = PartDraft.clearanceFor(th.value); draft.updateFrame(f.id, { thread: th.value }); if (c && !f.diameter) draft.updateFrame(f.id, { diameter: c }); renderFrames(); redraw(); });
        fields.append(el('label', { className: 'asm-mini' }, el('span', { textContent: 'thread' }), th));
      }
      const src = el('select', { ariaLabel: 'Where this came from' }, ...SOURCES.map(s => el('option', { value: s, textContent: s, selected: s === f.source })));
      src.addEventListener('change', () => draft.updateFrame(f.id, { source: src.value }));
      fields.append(el('label', { className: 'asm-mini' }, el('span', { textContent: 'from' }), src));
      card.append(fields, el('div', { className: 'asm-pos', textContent: `at ${f.pos.map(v => +v.toFixed(1)).join(', ')} mm` }));
      framesEl.append(card);
    }
  }

  // ── saving ────────────────────────────────────────────────────
  async function savePart() {
    const v = draft.validate();
    if (!v.ok) return say(`Not saved: ${v.errors.slice(0, 3).join(' ')}`, true);
    if (!stagedMesh && !(await getMesh(`${v.part.id}/${v.part.model.file}`))) return say('Import a model first.', true);
    const list = libraryParts().filter(p => p.id !== v.part.id); list.unshift(v.part); saveLibrary(list.slice(0, 80));
    if (stagedMesh) await putMesh(`${v.part.id}/${v.part.model.file}`, stagedMesh);
    renderLibrary(); const pv = provenanceOf(v.part);
    say(`Saved “${v.part.name}”.${pv.verified ? '' : ` Still estimated: ${pv.estimated.slice(0, 4).join(', ')}${pv.estimated.length > 4 ? '…' : ''} — measure and mark them when you can.`}`);
    const made = findPart(v.part.id); if (made) { await setMode('build'); await addToScene(made); bsay(`“${v.part.name}” is saved in your 3D parts list and added to the scene.`); }
  }
  saveBtn.addEventListener('click', savePart);
  exportBtn.addEventListener('click', () => {
    const v = draft.validate(); if (!v.ok) return say(`Cannot export yet: ${v.errors.slice(0, 3).join(' ')}`, true);
    const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(v.part, null, 1)], { type: 'application/json' })), download: `${v.part.id}.circuitbench-part.json` }); a.click(); URL.revokeObjectURL(a.href);
  });
  let examples = [];                                  // ready-made parts shipped with the app (public/robot-parts)
  const EX_DIR = '/robot-parts/kame32/';
  async function loadExamples() {
    if (examples.length) return;
    try { const r = await fetch(`${EX_DIR}index.json`); if (!r.ok) return; const j = await r.json(); examples = (j.parts || []).map(p => validateRobotPart(p)).filter(x => x.ok).map(x => ({ ...x.part, example: true })); } catch { /* offline: the examples just don't show */ }
  }
  async function openPart(part) {
    let buf = part.example ? await fetch(EX_DIR + part.model.file).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null) : await getMesh(`${part.id}/${part.model.file}`);
    if (!buf) return say('The model file for this part is not stored in this browser (re-import it, then save again).', true);
    const t = await load3d();
    const obj = await parseModel(t.THREE, { name: part.model.file }, buf);
    draft.load(part); t.setModel(obj); hint.hidden = true; stagedMesh = buf;
    draft.rawSize = null; t.applyUnits(true); draft.sizeMm = part.dims?.size || draft.sizeMm;
    syncForm(); renderFrames(); t.drawGizmos(); t.draw(); say(`Opened “${part.name}”.`);
  }
  function renderLibrary() {
    const list = libraryParts(); libEl.replaceChildren();
    if (!list.length) libEl.append(el('p', { className: 'asm-note', textContent: 'Parts you save appear here.' }));
    if (examples.length) {
      libEl.append(el('p', { className: 'asm-note', textContent: 'Examples: the Kame32 SG90 quadruped leg (GPL-3.0, by Javier Isabel). Open one, then click its holes to mark them.' }));
      for (const p of examples) { const open = el('button', { type: 'button', className: 'asm-lib-open', textContent: p.name, title: `${p.dims?.size?.map(v => +v.toFixed(1)).join(' × ')} mm` }); open.addEventListener('click', () => openPart(p)); libEl.append(el('div', { className: 'asm-lib-row' }, open, el('span', { className: 'asm-badge', textContent: 'example' }))); }
    }
    for (const p of list) {
      const open = el('button', { type: 'button', className: 'asm-lib-open', textContent: p.name, title: `${p.frames.length} frames · ${p.mass.grams} g` });
      open.addEventListener('click', () => openPart(p));
      const pv = provenanceOf(p), del = el('button', { type: 'button', className: 'asm-x', textContent: '✕', title: 'Delete this part', ariaLabel: `Delete ${p.name}` });
      del.addEventListener('click', async () => { saveLibrary(libraryParts().filter(q => q.id !== p.id)); await delMesh(`${p.id}/${p.model.file}`); renderLibrary(); });
      libEl.append(el('div', { className: 'asm-lib-row' }, open, el('span', { className: `asm-badge${pv.verified ? ' ok' : ''}`, textContent: pv.verified ? 'verified' : 'estimated', title: pv.verified ? '' : pv.estimated.join(', ') }), del));
    }
  }

  // ── building: move parts with handles or the mouse; join holes by dragging them together or with the Join tool ─────
  const asm = new Assembly(), objCache = new Map(), LEGACY_SCENE_KEY = 'circuitbench:robot-scene';
  // Each project keeps its own 3D scene. (It used to be one scene shared by every project, so opening a new project showed the last project's parts, and deleting them here deleted them there.)
  const legacyBox = el('div', { className: 'asm-note', id: 'asmLegacy', hidden: true });
  let sceneFor = null, restoreToken = 0; const sceneKey = () => `${LEGACY_SCENE_KEY}:${sceneFor || 'none'}`;
  const PALETTE = [0xb8c4cc, 0x7fb3d5, 0xe8b26a, 0x9ccc9c, 0xd59fb8, 0xb7a3d8, 0xd9d27a, 0x8fd0c8], hex = n => `#${n.toString(16).padStart(6, '0')}`;
  const colourOf = inst => PALETTE[(parseInt(String(inst.id).split('#')[1], 10) - 1 + PALETTE.length) % PALETTE.length];
  let anchorId = null, selected = null, drag = null, snapShow = null, attached = false, history = [], future = [], thumbs = new Map(), tip = null, xray = false, joinMode = false, joinFirst = null, hoverInst = null, spotMode = false;
  const cards = el('div', { className: 'asm-cards', id: 'asmCards' }), selBox = el('div', { className: 'asm-sel', id: 'asmSel', hidden: true }), instList = el('div', { className: 'asm-insts', id: 'asmInst' }), mateList = el('div', { className: 'asm-lib', id: 'asmMates' }), bomEl = el('div', { className: 'asm-note', id: 'asmBom' }), droneEl = el('div', { className: 'asm-drone', id: 'asmDrone', hidden: true });
  const bnote = el('p', { className: 'asm-msg', id: 'asmBuildMsg', role: 'status' });
  buildBox.append(
    el('p', { className: 'asm-note', textContent: 'Click a part to add it, or drag it into the scene. Drag a part by its body or its arrows; near a hole on another part it snaps on. Or press “Join holes” and click two holes. Have your own STL, OBJ or glTF file? Drop it on the 3D view or use “Import your own 3D part”.' }), bnote, selBox,
    legacyBox, el('h4', { textContent: 'In the scene' }), instList, el('h4', { textContent: 'Joints' }), mateList, bomEl, droneEl);
  const bsay = (t, bad) => { bnote.textContent = t; bnote.classList.toggle('bad', !!bad); };
  const dyn = new Map();                                                   // drone parts, made from their ids on demand
  const dronePart = id => { if (dyn.has(id)) return dyn.get(id); const raw = makeDronePart(id), v = raw && validateRobotPart(raw); if (!v?.ok) return null; const p = { ...v.part, drone: raw.drone, generated: true }; dyn.set(id, p); return p; };
  const everyPart = () => [...examples, ...libraryParts().map(p => ({ ...p, example: false })), ...DRONE_PRESETS.map(([, id]) => dronePart(id)).filter(Boolean)];
  const findPart = id => everyPart().find(p => p.id === id) || dronePart(id);
  // the floating bar over the 3D view
  const mkBtn = (label, title, fn, id) => { const b = el('button', { type: 'button', className: 'asm-tool', textContent: label, title, ariaLabel: title, id }); b.addEventListener('click', fn); return b; };
  const spotBtn = mkBtn('Add spots', 'Mark connection spots on a part\'s surface, where there is no hole. Click a part to add one, click a spot to remove it. Then use Join holes to fasten two spots together.', () => setSpot(!spotMode), 'asmSpot');
  const joinBtn = mkBtn('Join holes', 'Click a hole on one part, then a hole on another (J)', () => setJoin(!joinMode), 'asmJoin'), xrayBtn = mkBtn('X-ray', 'See through the parts', () => { xray = !xray; xrayBtn.classList.toggle('on', xray); render(); }, 'asmXray');
  const toolbarEl = el('div', { className: 'asm-floating', hidden: true },
    ...[['Front', 'front'], ['Top', 'top'], ['Side', 'side'], ['3D', 'iso']].map(([l, v]) => mkBtn(l, `${l} view`, () => viewTo(v), `asmView-${v}`)), mkBtn('Fit', 'Fit everything in view', () => fitScene(), 'asmFit'),
    el('span', { className: 'asm-tsep' }), spotBtn, joinBtn, xrayBtn, mkBtn('Drop all', 'Lower the whole model until its lowest point rests on the floor (everything stays where it is relative to everything else)', () => dropAll(), 'asmDropAll'), mkBtn('Clear', 'Remove every part', () => clearAll(), 'asmClear'));
  const helpEl = el('div', { className: 'asm-help', hidden: true });
  // the 3D parts list lives in the same right-hand Parts panel as the electronics list (it shows only in Assembly and Test)
  const robotDock = el('div', { id: 'robotParts', role: 'region', ariaLabel: '3D parts' }), dockSearch = el('input', { type: 'search', placeholder: 'Search 3D parts', ariaLabel: 'Search 3D parts', className: 'asm-dock-search', id: 'robotPartsSearch', autocomplete: 'off' });
  robotDock.append(dockSearch, cards); document.getElementById('partsPanel')?.append(robotDock);
  const dockImport = el('button', { type: 'button', className: 'asm-btn primary asm-dock-import', id: 'asmDockImport', textContent: 'Import your own 3D part…', title: 'STL, OBJ, GLB or glTF. You can also drop a file onto the 3D view.' });
  dockImport.addEventListener('click', () => fileIn.click()); robotDock.insertBefore(dockImport, dockSearch); robotDock.append(fileIn);
  dockSearch.addEventListener('input', () => renderCards());
  // "Make a drone part": a few numbers in, a real part (with its holes and weight) out. Nothing is stored; the numbers live in the part's name.
  const bField = (label, input, id) => { input.id = id; return el('label', { className: 'asm-field' }, el('span', { textContent: label }), input); };
  const bNum = (v, o = {}) => el('input', { type: 'number', value: v ?? '', ...o }), bSel = (opts, v) => { const x = el('select', {}, ...opts.map(o => el('option', { value: o, textContent: o, selected: String(o) === String(v) }))); return x; };
  const bld = el('details', { className: 'asm-builder', id: 'asmBuilder' }, el('summary', { textContent: 'Make a drone part…' })), bBody = el('div', { className: 'asm-builder-body' }), dKind = bSel(['Motor', 'Prop', 'Battery', 'Frame', 'Standoff'], 'Motor');
  dKind.id = 'asmBKind'; dKind.ariaLabel = 'What to make'; bld.append(el('label', { className: 'asm-field' }, el('span', { textContent: 'Part' }), dKind), bBody); robotDock.insertBefore(bld, cards);
  const bMsg = el('p', { className: 'asm-note', id: 'asmBMsg', role: 'status' });
  function paintBuilder() {
    const k = dKind.value; bBody.replaceChildren(); let make = null;
    if (k === 'Motor') {
      const size = bSel(MOTOR_SIZE_LIST, '2207'), kv = bNum(MOTOR_SIZES['2207'].kvRef, { step: 50, min: 100 }), R = bNum('', { step: 1, min: 1 }), I0 = bNum('', { step: 0.05, min: 0.05 }), M = bNum('', { step: 0.1, min: 0.1 }), A = bNum('', { step: 1, min: 1 }), info = el('p', { className: 'asm-note' });
      const typical = () => { const m = makeMotor({ size: size.value, kv: Number(kv.value) }); R.placeholder = `${Math.round(m.resistance * 1000)} (typical)`; I0.placeholder = `${m.noLoadAmps.toFixed(2)} (typical)`; M.placeholder = `${m.massGrams} (typical)`; A.placeholder = `${m.maxAmps} (typical)`; const s = MOTOR_SIZES[size.value]; info.textContent = `Stator ${s.stator[0]} × ${s.stator[1]} mm · mounts ${s.mount.pattern.join('×')} mm with ${s.mount.screw.replace('_', '.')} · usually ${s.cells[0] === s.cells[1] ? s.cells[0] : s.cells.join('–')}S`; };
      size.addEventListener('change', () => { kv.value = MOTOR_SIZES[size.value].kvRef; typical(); }); kv.addEventListener('input', typical); typical();
      const adv = el('details', { className: 'asm-adv' }, el('summary', { textContent: 'Advanced (your own motor data)' }), bField('Winding resistance, mΩ', R, 'asmBR'), bField('No-load current, A', I0, 'asmBI'), bField('Mass, g', M, 'asmBM'), bField('Max current, A', A, 'asmBA'));
      bBody.append(bField('Size (stator, mm)', size, 'asmBSize'), bField('Kv (rpm per volt)', kv, 'asmBKv'), info, adv);
      make = () => { const over = {}; if (Number(R.value) > 0) over.resistance = Number(R.value) / 1000; if (Number(I0.value) > 0) over.noLoadAmps = Number(I0.value); if (Number(M.value) > 0) over.massGrams = Number(M.value); if (Number(A.value) > 0) over.maxAmps = Number(A.value); return motorId({ size: size.value, kv: Number(kv.value), over }); };
    } else if (k === 'Prop') {
      const dia = bNum(5, { step: 0.1, min: 0.8, max: 12 }), pitch = bNum(4.3, { step: 0.1, min: 0.5, max: 10 }), bl = bSel([2, 3, 4, 5, 6], 3), bore = bNum('', { step: 0.5, min: 0.8 }); dia.addEventListener('input', () => { bore.placeholder = `${defaultBore(Number(dia.value))} (typical)`; }); bore.placeholder = `${defaultBore(5)} (typical)`;
      bBody.append(bField('Diameter, in', dia, 'asmBPD'), bField('Pitch, in', pitch, 'asmBPP'), bField('Blades', bl, 'asmBPB'), bField('Bore, mm (must match the shaft)', bore, 'asmBPBore'));
      make = () => `prop-${Number(dia.value)}x${Number(pitch.value)}x${bl.value}-b${Number(bore.value) > 0 ? Number(bore.value) : defaultBore(Number(dia.value))}`;
    } else if (k === 'Battery') {
      const cells = bSel([1, 2, 3, 4, 5, 6], 4), mah = bNum(1500, { step: 50, min: 100 }), c = bNum(75, { step: 5, min: 10 });
      bBody.append(bField('Cells (S)', cells, 'asmBBS'), bField('Capacity, mAh', mah, 'asmBBM'), bField('Discharge rating, C', c, 'asmBBC')); make = () => `battery-${cells.value}s-${Math.round(Number(mah.value))}-${Math.round(Number(c.value))}`;
    } else if (k === 'Frame') {
      const wb = bNum(220, { step: 5, min: 40 }), mp = bSel([9, 12, 16, 19, 't6.6'], 16), st = bSel(Object.keys(STACKS), '30.5');
      bBody.append(bField('Wheelbase (motor to motor), mm', wb, 'asmBFW'), bField('Motor mount, mm (t6.6 = 3-prong whoop)', mp, 'asmBFM'), bField('Stack, mm', st, 'asmBFS')); make = () => `frame-quad-${Math.round(Number(wb.value))}-${mp.value}-${st.value}`;
    } else {
      const sc = bSel(['M2', 'M3', 'M1_6'], 'M3'), h = bNum(6, { step: 1, min: 2, max: 40 }); bBody.append(bField('Screw', sc, 'asmBSS'), bField('Height, mm', h, 'asmBSH')); make = () => `standoff-${sc.value.toLowerCase()}-${Number(h.value)}`;
    }
    const go = el('button', { type: 'button', className: 'asm-btn primary', textContent: 'Add to the scene', id: 'asmBAdd' });
    go.addEventListener('click', async () => { const id = make(), p = dronePart(id); if (!p) { bMsg.textContent = 'Those numbers do not make a part.'; return; } bMsg.textContent = ''; await addToScene(p); });
    bBody.append(go, bMsg);
  }
  dKind.addEventListener('change', paintBuilder); paintBuilder();
  stage.append(toolbarEl, helpEl);

  async function meshOf(part) { return part.example ? fetch(EX_DIR + part.model.file).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null) : getMesh(`${part.id}/${part.model.file}`); }
  /** A part's mesh in the space its holes were marked in: mm, Z up, centred in X/Y, resting on z = 0. */
  async function partObject(t, part) {          // (drone parts are drawn from their numbers instead of loaded)
    if (!objCache.has(part.id) && part.generated) { const holder = new t.THREE.Group(); holder.add(buildDroneMesh(t.THREE, part)); objCache.set(part.id, holder); }
    if (!objCache.has(part.id)) {
      const buf = await meshOf(part); if (!buf) throw new Error(`The model for “${part.name}” could not be loaded.`);
      const raw = await parseModel(t.THREE, { name: part.model.file }, buf), g = new t.THREE.Group(); g.add(raw);
      g.rotation.set(part.model.up === 'y' ? Math.PI / 2 : 0, 0, 0); g.scale.setScalar(UNIT_MM[part.model.units] || 1); g.updateMatrixWorld(true);
      const b = new t.THREE.Box3().setFromObject(g), c = b.getCenter(new t.THREE.Vector3()); g.position.set(-c.x, -c.y, -b.min.z);
      const holder = new t.THREE.Group(); holder.add(g); objCache.set(part.id, holder);
    }
    const o = objCache.get(part.id).clone(true);
    o.traverse(m => { if (m.isMesh) m.material = m.userData.fixed ? m.material.clone() : new t.THREE.MeshStandardMaterial({ color: 0xb8c4cc, metalness: 0.1, roughness: 0.55, side: t.THREE.DoubleSide, emissive: 0x000000 }); });      // drone parts keep their own colours (one material each, so selecting one does not light them all)
    return o;
  }
  /** A small picture of each part for its card, drawn once with a throwaway renderer. */
  async function makeThumbs() {
    const t = await load3d(), parts = everyPart().filter(p => !thumbs.has(p.id)); if (!parts.length) return;
    const { THREE } = t; let r; try { r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch { return; }
    r.setSize(120, 90); const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 120 / 90, 0.1, 5000);
    sc.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.5)); const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(100, -150, 200); sc.add(sun);
    for (const p of parts) {
      try {
        const o = await partObject(t, p); o.traverse(m => { if (m.isMesh) { if (m.userData.fixed) m.material.color.offsetHSL(0, 0, 0.22); else m.material.color.set(0x9fb0ba); } }); sc.add(o); o.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3()), d = Math.max(...b.getSize(new THREE.Vector3()).toArray()) * 2.6;
        cam.up.set(0, 0, 1); cam.position.set(c.x + d * 0.6, c.y - d * 0.8, c.z + d * 0.55); cam.lookAt(c); r.render(sc, cam); thumbs.set(p.id, r.domElement.toDataURL('image/png')); sc.remove(o);
      } catch { /* a part without a picture still has its name */ }
    }
    r.dispose(); r.forceContextLoss?.(); renderCards();
  }
  function renderCards() {
    cards.replaceChildren(); const q = dockSearch.value.trim().toLowerCase(); let group = null;
    for (const p of everyPart().filter(p => !q || `${p.name} ${p.category || ''}`.toLowerCase().includes(q))) {
      if (p.category !== group) { group = p.category; cards.append(el('div', { className: 'group-title asm-group', textContent: group || 'Parts' })); }
      const img = thumbs.get(p.id) ? el('img', { src: thumbs.get(p.id), alt: '', draggable: false }) : el('div', { className: 'asm-thumb-empty' });
      const c = el('button', { type: 'button', className: 'asm-card', draggable: true, title: p.id === 'motor-2207-1900' ? 'One motor for every size: add it, then pick its size (0802, 1404, 2207 …) and Kv in the panel' : `${p.name} · ${p.frames.length} holes` }, img, el('span', { textContent: p.id === 'motor-2207-1900' ? 'Drone motor' : p.name.replace(/^Kame32 /, '') }));
      c.dataset.part = p.id; c.addEventListener('click', () => addToScene(p)); c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', `circuitbench-part:${p.id}`); e.dataTransfer.effectAllowed = 'copy'; });
      cards.append(c);
    }
  }

  // — history, saving
  let batch = false;
  const keep = () => { if (batch) return; history.push(asm.snapshot()); if (history.length > 60) history.shift(); future = []; refreshTools(); };
  // The top bar is the one place for undo, redo and delete. In Circuit it drives the circuit (editor.js keeps it current);
  // in Assembly it drives the 3D scene; the tools that make no sense in the current tab are greyed out.
  const $t = id => document.getElementById(id);
  const refreshTools = () => syncTop();
  function syncTop() {
    if (view === 'circuit') { editor.afterStructureChange?.(); for (const id of ['selectTool', 'wireTool', 'rotateTool', 'deleteTool', 'zoomOut', 'zoomFit', 'zoomIn']) { const b = $t(id); if (b) b.disabled = false; } return; }
    const build = view === 'assembly' && mode === 'build', set = (id, off, why) => { const b = $t(id); if (!b) return; b.disabled = off; if (!b.dataset.t) b.dataset.t = b.title; b.title = off && why ? `${b.dataset.t} (${why})` : b.dataset.t; };
    const none = view === 'test' ? 'not used in the Test tab' : 'circuit tool';
    set('selectTool', true, 'circuit tool'); set('wireTool', true, 'circuit tool'); set('rotateTool', true, 'circuit tool'); set('zoomOut', true, 'use the mouse wheel in 3D'); set('zoomIn', true, 'use the mouse wheel in 3D'); set('zoomFit', true, 'use Fit in the 3D view');
    set('undoTool', !build || !history.length, build ? 'nothing to undo' : none); set('redoTool', !build || !future.length, build ? 'nothing to redo' : none);
    set('deleteTool', !build || !selected, build ? 'select a part first' : none);
  }
  function applyScene() {
    const t = three; if (!t) return;
    for (const c of [...t.sceneRoot.children]) if (!asm.instances.some(i => i.obj === c)) t.sceneRoot.remove(c);
    for (const i of asm.instances) if (i.obj && !i.obj.parent) t.sceneRoot.add(i.obj);
    if (selected && !asm.get(selected)) selected = null; joinFirst = null; render();
  }
  function undo() { if (!history.length) return; future.push(asm.snapshot()); asm.restore(history.pop()); applyScene(); }
  function redo() { if (!future.length) return; history.push(asm.snapshot()); asm.restore(future.pop()); applyScene(); }
  function save() { try { localStorage.setItem(sceneKey(), JSON.stringify({ parts: asm.instances.map(i => ({ part: i.part.id, T: i.T, ...(i.noSnap ? { noSnap: true } : {}), ...(i.part.frames.some(f => f.custom) ? { spots: i.part.frames.filter(f => f.custom).map(f => ({ id: f.id, pos: f.pos, dir: f.dir, custom: true })) } : {}) })), mates: asm.mates.map(m => ({ a: asm.instances.findIndex(i => i.id === m.a.inst), af: m.a.frame, b: asm.instances.findIndex(i => i.id === m.b.inst), bf: m.b.frame, screw: m.screw, angle: m.angle, min: m.min, max: m.max, fixed: m.fixed })), anchor: anchorId && asm.instances.findIndex(i => i.id === anchorId) })); try { dispatchEvent(new CustomEvent('cb-scene-saved', { detail: sceneKey().split(':').pop() })); } catch { /* no window (tests) */ } } catch { /* unsaved is fine */ } }
  async function restoreSaved() {
    if (asm.instances.length) return; const tok = ++restoreToken; let j = null; try { j = JSON.parse(localStorage.getItem(sceneKey()) || 'null'); } catch { /* none */ }
    if (!j?.parts?.length) { legacyOffer(); return; } legacyBox.hidden = true; const t = await load3d(), ids = [];
    for (const rec of j.parts) {
      const p = findPart(rec.part); if (!p) { ids.push(null); continue; }
      try { const obj = await partObject(t, p); if (tok !== restoreToken) return; const inst = asm.add(p); inst.T = rec.T; if (rec.noSnap) inst.noSnap = true; if (rec.spots?.length) inst.part = { ...p, frames: [...p.frames, ...rec.spots] }; inst.obj = obj; inst.obj.userData.inst = inst.id; tint(inst); ids.push(inst.id); } catch { ids.push(null); }       // (a project switch mid-way drops the rest)
    }
    if (tok !== restoreToken) return;
    for (const m of j.mates || []) if (ids[m.a] && ids[m.b]) asm.mates.push({ a: { inst: ids[m.a], frame: m.af }, b: { inst: ids[m.b], frame: m.bf }, screw: m.screw || null, angle: m.angle || 0, min: m.min, max: m.max, fixed: !!m.fixed });
    if (j.anchor >= 0 && ids[j.anchor]) anchorId = ids[j.anchor];
    applyScene(); fitScene();
  }
  /** A scene saved before projects had their own: offered once to whichever project is open, never forced on one. */
  function legacyOffer() {
    let j = null; try { j = JSON.parse(localStorage.getItem(LEGACY_SCENE_KEY) || 'null'); } catch { /* none */ }
    if (!j?.parts?.length) { legacyBox.hidden = true; return; }
    const use = el('button', { type: 'button', className: 'asm-btn', id: 'asmLegacyUse', textContent: 'Bring it into this project' }), skip = el('button', { type: 'button', className: 'asm-btn', textContent: 'Not now' });
    use.addEventListener('click', async () => { try { localStorage.setItem(sceneKey(), localStorage.getItem(LEGACY_SCENE_KEY)); localStorage.removeItem(LEGACY_SCENE_KEY); } catch { /* keep it where it is */ } legacyBox.hidden = true; await restoreSaved(); });
    skip.addEventListener('click', () => { legacyBox.hidden = true; });
    legacyBox.replaceChildren(`An earlier 3D scene (${j.parts.length} part${j.parts.length > 1 ? 's' : ''}) was saved before each project kept its own. It is not in this project unless you bring it in. `, use, ' ', skip); legacyBox.hidden = false;
  }
  /** The open project changed: put away its scene, show the new project's own. */
  async function switchScene(id) {
    if (id === sceneFor) return; if (sceneFor && asm.instances.length) save();
    sceneFor = id; restoreToken++; for (const i of asm.instances) three?.sceneRoot.remove(i.obj);
    asm.instances = []; asm.mates = []; selected = null; anchorId = null; history = []; future = []; joinFirst = null; legacyBox.hidden = true;
    if (three && view !== 'circuit') { await restoreSaved(); render(); }
    three?.draw();
  }
  const tint = inst => inst.obj.traverse(m => { if (m.isMesh && !m.userData.fixed) m.material.color.setHex(colourOf(inst)); });

  // — adding and removing
  async function addToScene(part, at = null) {
    const t = await load3d();
    try {
      const obj = await partObject(t, part); keep(); const inst = asm.add(part);
      inst.obj = obj; obj.userData.inst = inst.id; tint(inst); t.sceneRoot.add(obj);
      const sz = new t.THREE.Box3().setFromObject(obj).getSize(new t.THREE.Vector3());
      if (at) inst.T.t = [at[0], at[1], 0];
      else { const others = asm.instances.filter(i => i !== inst); let x = 0; if (others.length) { const bb = new t.THREE.Box3(); others.forEach(o => bb.expandByObject(o.obj)); x = bb.max.x + 14 + sz.x / 2; } inst.T.t = [x, 0, 0]; }
      selected = inst.id; applyScene(); if (!at) fitScene(); bsay('');
      if (!part.frames.length) bsay(`“${part.name}” has no marked holes, so it cannot snap to anything.`, true);
      return inst;
    } catch (e) { bsay(e.message, true); return null; }
  }
  /** A ready 5-inch quad (frame, four motors with props, a battery under it, an ESC and flight-controller board, an FPV camera), joined the way a person would join it, as one undo step. */
  async function buildExampleQuad() {
    const t = await load3d(); await loadExamples(); keep(); batch = true;
    try {
      for (const i of asm.instances) t.sceneRoot.remove(i.obj); asm.instances = []; asm.mates = []; selected = null;
      const add = (id, at = [0, 0]) => addToScene(dronePart(id), at), fail = (r, what) => { if (!r.ok) throw new Error(`${what}: ${r.error}`); };
      const frame = await add('frame-quad-220-16-30.5'); let k = 0;
      for (const n of ['fr', 'fl', 'bl', 'br']) {
        const m = await add('motor-2207-1900', [300 + 70 * k, 0]); fail(asm.mateAll(frame.id, `${n}-1-top`, m.id, 'mount-1'), 'motor');
        const p = await add('prop-5x4.3x3-b5', [300 + 70 * k, 200]); fail(asm.mateAll(m.id, 'shaft', p.id, 'bore-bottom'), 'prop'); k++;
      }
      const bat = await add('battery-4s-1500-75', [0, 400]); fail(asm.mateAll(frame.id, 'strap-1-bottom', bat.id, 'strap-top-a'), 'battery');
      for (let q = 0; q < 4 && !asm.autoMatch(frame.id, bat.id); q++) turn(bat, [0, 0, 1], worldFrame(frame, frame.part.frames.find(f => f.id === 'strap-1-bottom')).pos, 90);      // swing it round until its second strap hole meets the frame's
      const esc = await add('board-esc-30.5', [0, -300]); fail(asm.mateAll(frame.id, 'stack-1-top', esc.id, 'mount-1-bottom'), 'ESC');
      const fcb = await add('board-fc-30.5', [0, -400]); fail(asm.mateAll(esc.id, 'mount-1-top', fcb.id, 'mount-1-bottom'), 'flight controller');
      const cam = await add('camera-micro', [0, 500]); fail(asm.mateAll(frame.id, 'camera-1-top', cam.id, 'mount-1-bottom'), 'camera');
      anchorId = frame.id; selected = null;
    } finally { batch = false; }
    applyScene(); render2(); fitScene(); bsay('Built a 5-inch quad. Open Test to fly it.');
  }
  function removeInst(id) { keep(); const i = asm.get(id); if (i) three?.sceneRoot.remove(i.obj); asm.remove(id); if (selected === id) selected = null; applyScene(); }
  function clearAll() { if (!asm.instances.length) return; keep(); for (const i of asm.instances) three?.sceneRoot.remove(i.obj); asm.instances = []; asm.mates = []; selected = null; applyScene(); }
  const select = id => { selected = id; render(); };
  const centreOf = inst => { const b = new three.THREE.Box3().setFromObject(inst.obj), c = b.getCenter(new three.THREE.Vector3()); return [c.x, c.y, c.z]; };
  const detach = inst => { const n = asm.mates.length; asm.mates = asm.mates.filter(m => m.a.inst !== inst.id && m.b.inst !== inst.id); if (asm.mates.length < n) bsay('Unjoined from the parts it was attached to, so it can move freely. Ctrl+Z undoes this.'); };

  // — the camera
  function fitScene() {
    const t = three, b = new t.THREE.Box3().setFromObject(t.sceneRoot); if (b.isEmpty()) return;
    const s = b.getSize(new t.THREE.Vector3()), c = b.getCenter(new t.THREE.Vector3()), d = Math.max(s.x, s.y, s.z, 40) * 2.2;
    t.controls.target.copy(c); t.camera.position.set(c.x + d * 0.5, c.y - d, c.z + d * 0.6); t.camera.near = d / 100; t.camera.far = d * 100; t.camera.updateProjectionMatrix(); t.controls.update(); t.draw();
  }
  function viewTo(name, focusInst = null) {
    const t = three; if (!t) return; const b = new t.THREE.Box3(); if (focusInst) b.setFromObject(focusInst.obj); else b.setFromObject(t.sceneRoot); if (b.isEmpty()) return;
    const s = b.getSize(new t.THREE.Vector3()), c = b.getCenter(new t.THREE.Vector3()), d = Math.max(s.x, s.y, s.z, 30) * (focusInst ? 2.6 : 2.2);
    const dir = { front: [0, -1, 0.001], top: [0, -0.001, 1], side: [1, 0, 0.001], iso: [0.5, -1, 0.6] }[name] || [0.5, -1, 0.6], L = Math.hypot(...dir);
    t.controls.target.copy(c); t.camera.position.set(c.x + dir[0] / L * d, c.y + dir[1] / L * d, c.z + dir[2] / L * d); t.camera.near = d / 100; t.camera.far = d * 100; t.camera.updateProjectionMatrix(); t.controls.update(); t.draw();
  }

  // — drawing the scene
  function overlays() {
    const t = three, { THREE } = t; t.sceneGizmos.clear();
    const size = new THREE.Box3().setFromObject(t.sceneRoot).getSize(new THREE.Vector3()), U = Math.max(Math.max(size.x, size.y, size.z) * 0.035, 2.5);
    for (const inst of asm.instances) for (const f of inst.part.frames) {
      const w = worldFrame(inst, f), mated = asm.isMated(inst.id, f.id), r0 = Math.max((f.diameter || 3) / 2, joinMode ? 2.6 : 2.0) + 0.3;
      const hot = snapShow && ((snapShow.a === inst.id && snapShow.aFrame === f.id) || (snapShow.b === inst.id && snapShow.bFrame === f.id)), first = joinFirst && joinFirst.inst === inst.id && joinFirst.frame === f.id;
      const sp = !!f.custom, col = first ? 0xe0562a : hot ? 0x1fae5a : mated ? 0x6f8f7b : sp ? 0xe8a317 : 0x1f7a8c, r = hot || first ? r0 * 1.4 : sp ? Math.max(U * 0.55, 3) : r0;
      const g = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: hot || first ? 0.85 : mated ? 0.3 : joinMode || spotMode ? 0.75 : sp ? 0.7 : 0.55, depthTest: false, side: THREE.DoubleSide }));
      g.position.fromArray(w.pos).addScaledVector(new THREE.Vector3(...w.dir), 0.05); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...w.dir));
      const edge = new THREE.Mesh(new THREE.RingGeometry(r * 0.88, r, 28), new THREE.MeshBasicMaterial({ color: col, depthTest: false, side: THREE.DoubleSide })); edge.renderOrder = 10; g.add(edge);
      g.renderOrder = 10; g.userData = { hole: true, spot: sp, label: sp ? `Connection spot ${f.id.replace('spot-', '#')}${mated ? ' (joined)' : ''} on ${inst.part.name}${spotMode ? ' · click to remove' : ''}` : `${f.diameter ? f.diameter.toFixed(1) + ' mm ' : ''}hole ${f.id.replace('hole-', '#')}${mated ? ' (joined)' : ''} on ${inst.part.name}`, inst: inst.id, frame: f.id }; t.sceneGizmos.add(g);
    }
    if (snapShow) {                                                                              // a line from the dragged hole to the one it will join
      const A = asm.get(snapShow.a), B = asm.get(drag?.id), fa = A?.part.frames.find(f => f.id === snapShow.aFrame);
      if (A && fa) { const p = worldFrame(A, fa).pos, ln = new THREE.Mesh(new THREE.SphereGeometry(U * 0.4, 12, 8), new THREE.MeshBasicMaterial({ color: 0x1fae5a, depthTest: false })); ln.position.fromArray(p); ln.renderOrder = 11; t.sceneGizmos.add(ln); }
    }
    const sel = selected && asm.get(selected);                                                   // move handles on the selected part
    if (sel && !joinMode && !spotMode) {
      const c = new THREE.Vector3(...centreOf(sel)), L = U * 5;
      for (const [axis, col, dir] of [['x', 0xd9453b, [1, 0, 0]], ['y', 0x3aa24f, [0, 1, 0]], ['z', 0x2f6fd6, [0, 0, 1]]]) {
        const grp = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: col, depthTest: false });
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(U * 0.18, U * 0.18, L, 10), mat), tip0 = new THREE.Mesh(new THREE.ConeGeometry(U * 0.55, U * 1.6, 14), mat);
        shaft.position.y = L / 2; tip0.position.y = L + U * 0.8; grp.add(shaft, tip0); grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir)); grp.position.copy(c);
        grp.traverse(m => { m.renderOrder = 12; m.userData = { axis, dir }; }); t.sceneGizmos.add(grp);
        const bb = new THREE.Box3().setFromObject(sel.obj).getSize(new THREE.Vector3()), R = Math.max(L * 0.75, bb.length() * 0.42), ring = new THREE.Mesh(new THREE.TorusGeometry(R, U * 0.14, 8, 64), new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: 0.8 }));
        ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...dir)); ring.position.copy(c); ring.renderOrder = 12; ring.userData = { ring: axis, dir }; t.sceneGizmos.add(ring);
      }
    }
  }
  function render() {
    if (view !== 'circuit') syncTop();
    const t = three; if (!t) return;
    for (const inst of asm.instances) {
      inst.obj.position.fromArray(inst.T.t); inst.obj.quaternion.set(...inst.T.q); inst.obj.updateMatrixWorld(true);
      const glow = inst.id === selected ? 0x1d4e75 : snapShow && (snapShow.a === inst.id || snapShow.b === inst.id) ? 0x14602f : inst.id === hoverInst ? 0x2a3a44 : 0x000000;
      inst.obj.traverse(m => { if (m.isMesh) { m.material.emissive.setHex(glow); m.material.transparent = xray; m.material.opacity = xray ? 0.38 : 1; m.material.depthWrite = !xray; } });
    }
    overlays(); t.draw(); renderPanel(); refreshTools(); save();
    helpEl.hidden = false;
    helpEl.textContent = drag?.mode === 'pose' && drag.moved ? 'Pulling the robot. It only bends where its joints allow.' : !asm.instances.length ? 'Pick a part on the right to start.' : spotMode ? 'Click a part to add a connection spot · click a spot to remove it · Esc to finish' : joinMode ? (joinFirst ? 'Now click a hole on a different part. It will move onto the first one.' : 'Click a hole on the part that stays put.') : drag?.moved ? (snapShow ? 'Let go to snap it on.' : 'Move it next to a hole on another part.') : selected ? 'Drag the part, its arrows to slide, its rings to turn · drag the background to look around · scroll to zoom' : 'Click a part to select it · drag the background to look around';
  }
  const render2 = () => { for (const inst of asm.instances) { inst.obj.position.fromArray(inst.T.t); inst.obj.quaternion.set(...inst.T.q); inst.obj.updateMatrixWorld(true); } overlays(); three.draw(); save(); };
  /** One motor part for every size: pick the size and Kv here and this motor is rebuilt in place (same spot, same joints). */
  function motorRow(inst) {
    const d = parseDroneId(inst.part.id), size = el('select', { id: 'asmMotorSize', ariaLabel: 'Motor size', className: 'asm-mini-sel', title: 'Stator size: the first two digits are the width, the last two the height, in mm' }, ...MOTOR_SIZE_LIST.map(k => el('option', { value: k, textContent: k, selected: k === d.size })));
    const kv = el('input', { type: 'number', id: 'asmMotorKv', step: 50, min: 100, value: d.kv, ariaLabel: 'Motor Kv (rpm per volt)' });
    size.addEventListener('change', () => { const ref = MOTOR_SIZES[size.value]?.kvRef; if (ref) kv.value = ref; swapMotor(inst, size.value, Number(kv.value)); });
    kv.addEventListener('change', () => { const v = Number(kv.value); if (v >= 100) swapMotor(inst, size.value, v); });
    return el('div', { className: 'asm-row wrap' }, el('label', { className: 'asm-field' }, el('span', { textContent: 'Motor size' }), size), el('label', { className: 'asm-field' }, el('span', { textContent: 'Kv' }), kv));
  }
  async function swapMotor(inst, size, kv) {
    const t = await load3d(), np = dronePart(motorId({ size, kv })), old = parseDroneId(inst.part.id); if (!np) return bsay('That motor size is not available.', true);
    keep(); const keepSpots = inst.part.frames.filter(f => f.custom);
    const links = asm.matesOf(inst.id).map(m => (m.a.inst === inst.id ? { mine: m.a.frame, other: m.b.inst, of: m.b.frame, isA: true } : { mine: m.b.frame, other: m.a.inst, of: m.a.frame, isA: false }));
    const resized = old.size !== size; if (resized) asm.mates = asm.mates.filter(m => m.a.inst !== inst.id && m.b.inst !== inst.id);
    const obj = await partObject(t, np); t.sceneRoot.remove(inst.obj); inst.part = keepSpots.length && !resized ? { ...np, frames: [...np.frames, ...keepSpots] } : np; inst.obj = obj; obj.userData.inst = inst.id; tint(inst); t.sceneRoot.add(obj);
    let note = '';
    if (resized) {                                                                              // the motor moves onto what it was fastened to; whatever hung on its shaft is moved back onto the new shaft
      const mounts = links.filter(x => x.mine !== 'shaft'); let extra = 0;
      mounts.forEach((l, k) => { const r = k === 0 ? asm.mateAll(l.other, l.of, inst.id, l.mine) : { ok: false }; if (r.ok) extra = r.extra || 0; });
      for (const l of links.filter(x => x.mine === 'shaft')) asm.mate(inst.id, l.mine, l.other, l.of);       // (the prop moves, the motor stays)
      if (mounts.length > 1 && extra + 1 < mounts.length) note = ' Its screw holes are a different spacing from the frame\'s, so only one screw joins it. Use a frame made for this motor size.';
    }
    applyScene(); bsay(`Now ${np.name}.${note}`, !!note);
  }
  function setJoin(on) { joinMode = on; joinFirst = null; if (on) { spotMode = false; spotBtn.classList.remove('on'); } joinBtn.classList.toggle('on', on); render(); }
  /** Lower the whole model, joined or not, until its lowest point rests on the floor. Nothing moves relative to anything else. */
  function dropAll() {
    if (!asm.instances.length || !three) return;
    let levelled = 0;                                                                           // a drone that is tilted is stood level first (motors pointing up), then dropped
    const ms = asm.instances.filter(i => i.part.drone?.kind === 'motor' && i.part.frames.some(f => f.id === 'shaft'));
    if (ms.length) {
      const avg = ms.reduce((a, m) => { const d = worldFrame(m, m.part.frames.find(f => f.id === 'shaft')).dir; return [a[0] + d[0], a[1] + d[1], a[2] + d[2]]; }, [0, 0, 0]), l = Math.hypot(...avg);
      if (l > 1e-6) { const u = avg.map(v => v / l), tilt = Math.acos(Math.max(-1, Math.min(1, u[2]))) * 180 / Math.PI;
        if (tilt > 0.3) { const ax = [u[1], -u[0], 0], al = Math.hypot(ax[0], ax[1]) || 1, c = asm.instances.reduce((a, i) => [a[0] + i.T.t[0] / asm.instances.length, a[1] + i.T.t[1] / asm.instances.length, a[2] + i.T.t[2] / asm.instances.length], [0, 0, 0]);
          keep(); for (const i of asm.instances) turn(i, tilt > 179.7 ? [1, 0, 0] : [ax[0] / al, ax[1] / al, 0], c, tilt); levelled = tilt; applyScene(); } }
    }
    const B = new three.THREE.Box3(); for (const i of asm.instances) { i.obj.updateMatrixWorld(true); B.expandByObject(i.obj); }
    const dz = -B.min.z; if (Math.abs(dz) < 0.01) return bsay(levelled ? `Stood the model level (it was tilted ${levelled.toFixed(0)}°); it is on the floor.` : 'The whole model is already on the floor.');
    if (!levelled) keep(); for (const i of asm.instances) i.T.t[2] += dz; applyScene(); bsay(`${levelled ? `Stood level (was tilted ${levelled.toFixed(0)}°) and dropped` : 'Dropped'} the whole model ${dz > 0 ? 'down' : 'up'} ${Math.abs(dz).toFixed(1)} mm onto the floor.`);
  }
  function setSpot(on) { spotMode = on; if (on) { joinMode = false; joinFirst = null; joinBtn.classList.remove('on'); } spotBtn.classList.toggle('on', on); if (on) bsay('Click anywhere on a part to add a connection spot there (it faces away from the surface you click). Click a spot to remove it. Then press Join holes and click two spots to fasten the parts.'); render(); }
  /** Add (or take away) a connection spot where the surface was clicked: a joinable point with no hole, so parts can be fastened with glue, tape or a clip. */
  function spotAt(e, t, ndcOf) {
    t.ray.setFromCamera(ndcOf(e), t.camera); const hit = t.ray.intersectObjects(t.sceneRoot.children, true).find(h => h.face); if (!hit) return false;
    let o = hit.object; while (o && !o.userData.inst) o = o.parent; const inst = o && asm.get(o.userData.inst); if (!inst) return false;
    const { THREE } = t, n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize(); if (n.dot(t.ray.ray.direction) > 0) n.negate();
    let wp = hit.point.clone(), snappedTo = null;                                              // close to a free hole or spot on another part, facing this surface: sit exactly on it, so the pair lines up
    for (const other of asm.instances) if (other !== inst) for (const f of other.part.frames) {
      if (asm.isMated(other.id, f.id)) continue; const w = worldFrame(other, f), d = Math.hypot(w.pos[0] - wp.x, w.pos[1] - wp.y, w.pos[2] - wp.z);
      if (d <= 6 && n.x * w.dir[0] + n.y * w.dir[1] + n.z * w.dir[2] < -0.6 && (!snappedTo || d < snappedTo.d)) snappedTo = { d, w, part: other.part.name, spot: !!f.custom };
    }
    if (snappedTo) { wp = new THREE.Vector3(...snappedTo.w.pos); n.set(-snappedTo.w.dir[0], -snappedTo.w.dir[1], -snappedTo.w.dir[2]); }
    const lp = inst.obj.worldToLocal(wp.clone()), ln = n.applyQuaternion(inst.obj.quaternion.clone().invert()).normalize();
    keep(); const k = 1 + Math.max(0, ...inst.part.frames.filter(f => f.custom).map(f => Number(String(f.id).replace('spot-', '')) || 0));
    inst.part = { ...inst.part, frames: [...inst.part.frames, { id: `spot-${k}`, pos: [lp.x, lp.y, lp.z], dir: [ln.x, ln.y, ln.z], custom: true }] };
    selected = inst.id; bsay(`Spot ${k} added to “${inst.part.name}”${snappedTo ? `, lined up exactly with the ${snappedTo.spot ? 'spot' : 'hole'} on “${snappedTo.part}”` : ''}. Add another, or press Join holes and click two spots.`); render(); return true;
  }
  function dropSpot(instId, frameId) {
    const inst = asm.get(instId); if (!inst) return; keep();
    inst.part = { ...inst.part, frames: inst.part.frames.filter(f => f.id !== frameId) }; asm.mates = asm.mates.filter(m => !((m.a.inst === instId && m.a.frame === frameId) || (m.b.inst === instId && m.b.frame === frameId)));
    bsay('Spot removed.'); render();
  }

  function renderPanel() {
    selBox.replaceChildren(); const inst = selected && asm.get(selected); selBox.hidden = !inst;
    instList.replaceChildren();
    for (const i of asm.instances) {
      const row = el('button', { type: 'button', className: `asm-inst${i.id === selected ? ' on' : ''}` }, el('span', { className: 'asm-swatch', style: `background:${hex(colourOf(i))}` }), el('span', { className: 'asm-lib-name', textContent: i.part.name }), el('span', { className: 'asm-badge', textContent: connected(asm, i.id).length > 1 && heldPart(asm, anchorId, i.id) === i.id ? 'held ⚓' : `${i.part.frames.filter(f => !f.custom).length} holes${i.part.frames.some(f => f.custom) ? ` · ${i.part.frames.filter(f => f.custom).length} spots` : ''}` }));
      row.addEventListener('click', () => select(i.id)); row.addEventListener('dblclick', () => viewTo('iso', i)); row.addEventListener('mouseenter', () => { hoverInst = i.id; render2h(); }); row.addEventListener('mouseleave', () => { hoverInst = null; render2h(); });
      instList.append(row);
    }
    if (!asm.instances.length) instList.append(el('p', { className: 'asm-note', textContent: 'Nothing here yet.' }));
    if (inst) {
      const act = (label, title, fn) => { const b = el('button', { type: 'button', className: 'asm-btn', textContent: label, title, ariaLabel: title }); b.addEventListener('click', fn); return b; };
      const c = centreOf(inst), num = (label, k) => { const inp = el('input', { type: 'number', step: 1, value: +c[k].toFixed(1), ariaLabel: `${label} position in mm`, id: `asmPos-${label.toLowerCase()}` }); inp.addEventListener('change', () => { const v = Number(inp.value); if (!Number.isFinite(v)) return; keep(); const cur = centreOf(inst); inst.T.t[k] += v - cur[k]; detach(inst); render(); }); return el('label', { className: 'asm-field' }, el('span', { textContent: label }), inp); };
      selBox.append(
        el('div', { className: 'asm-sel-name' }, el('span', { className: 'asm-swatch', style: `background:${hex(colourOf(inst))}` }), inst.part.name),
        el('div', { className: 'asm-row' }, num('X', 0), num('Y', 1), num('Z', 2)),
        (() => { const cb = el('input', { type: 'checkbox', id: 'asmSnapOn', checked: !inst.noSnap }); cb.addEventListener('change', () => { keep(); if (cb.checked) delete inst.noSnap; else inst.noSnap = true; save(); bsay(cb.checked ? `“${inst.part.name}” snaps to holes again.` : `“${inst.part.name}” will not snap to holes or join extra ones. Use Join to fasten it yourself.`); }); return el('label', { className: 'asm-row', title: 'Turn off to move this part freely: it will not jump onto holes, and nothing will jump onto it' }, cb, ' Snap to holes'); })(),
        ...(parseDroneId(inst.part.id)?.kind === 'motor' ? [motorRow(inst)] : []),
        ...(inst.part.frames.some(f => f.custom) ? [el('div', { className: 'asm-row wrap' }, act('Clear spots', 'Remove every connection spot on this part', () => { keep(); const gone = new Set(inst.part.frames.filter(f => f.custom).map(f => f.id)); inst.part = { ...inst.part, frames: inst.part.frames.filter(f => !f.custom) }; asm.mates = asm.mates.filter(m => !((m.a.inst === inst.id && gone.has(m.a.frame)) || (m.b.inst === inst.id && gone.has(m.b.frame)))); render(); }))] : []),
        el('div', { className: 'asm-row wrap' }, act('Drop to floor', 'Lower it until it rests on the floor', () => { keep(); const b = new three.THREE.Box3().setFromObject(inst.obj); inst.T.t[2] -= b.min.z; detach(inst); render(); }), act(anchorId === inst.id ? 'Held still ✓' : 'Hold still', 'Keep this part in place while you pull the rest of the robot around', () => { anchorId = anchorId === inst.id ? null : inst.id; render(); }), act('Join holes…', 'Pick two holes to join this part to another', () => setJoin(true)), act('Remove', 'Remove this part', () => removeInst(inst.id))));
    }
    mateList.replaceChildren();
    if (!asm.mates.length) mateList.append(el('p', { className: 'asm-note', textContent: 'Nothing joined yet.' }));
    asm.mates.forEach((m, i) => {
      const ck = asm.check(m), A = asm.get(m.a.inst), B = asm.get(m.b.inst); if (!A || !B) return;
      const scr = el('select', { ariaLabel: 'Screw', className: 'asm-mini-sel' }, el('option', { value: '', textContent: 'auto' }), ...Object.keys(THREADS).map(k => el('option', { value: k, textContent: k.replace('_', '.'), selected: k === m.screw })));
      scr.addEventListener('change', () => { m.screw = scr.value || null; render(); });
      const un = el('button', { type: 'button', className: 'asm-x', textContent: '✕', title: 'Unjoin (the parts stay where they are)', ariaLabel: 'Unjoin' });
      un.addEventListener('click', () => { keep(); asm.mates.splice(i, 1); render(); });
      const nm = x => x.part.name.replace(/^Kame32 /, '');
      const hinge = buildRig(asm).joints.some(j => j.mate === m), fx = el('select', { ariaLabel: 'Joint type', className: 'asm-mini-sel' }, el('option', { value: 'hinge', textContent: 'Hinge', selected: !m.fixed }), el('option', { value: 'fixed', textContent: 'Fixed', selected: !!m.fixed }));
      fx.addEventListener('change', () => { keep(); m.fixed = fx.value === 'fixed'; if (m.fixed && m.angle) { setAngle(asm, anchorId, m, 0); } render(); });
      const jbox = el('div', { className: 'asm-joint' }, el('span', { className: 'asm-lbl', textContent: 'Joint' }), fx);
      if (hinge && !m.fixed) {
        const mv = movingSide(asm, anchorId, m), swap = el('button', { type: 'button', className: 'asm-btn', textContent: '⇄ Swap', title: mv ? `Now ${asm.get(mv)?.part.name} swings. Click to hold it still and let the other side swing instead.` : 'Swap which side moves', ariaLabel: 'Swap which side of this joint moves' });
        swap.addEventListener('click', () => { if (!mv) return; anchorId = mv; render(); }); jbox.append(swap);
      }
      if (hinge && !m.fixed) {
        const lo = m.min ?? -90, hi = m.max ?? 90, sl = el('input', { type: 'range', min: lo, max: hi, step: 1, value: m.angle || 0, ariaLabel: 'Joint angle', className: 'asm-jslider' }), val = el('span', { className: 'asm-lbl', textContent: `${Math.round(m.angle || 0)}°` });
        const lim = (k, v0) => { const inp = el('input', { type: 'number', value: v0, step: 5, ariaLabel: k === 'min' ? 'Lowest angle' : 'Highest angle', className: 'asm-limit' }); inp.addEventListener('change', () => { const v = Number(inp.value); if (!Number.isFinite(v)) return; keep(); m[k] = v; if (k === 'min' && (m.angle || 0) < v) setAngle(asm, anchorId, m, v); if (k === 'max' && (m.angle || 0) > v) setAngle(asm, anchorId, m, v); render(); }); return inp; };
        sl.addEventListener('pointerdown', () => keep()); sl.addEventListener('input', () => { setAngle(asm, anchorId, m, Number(sl.value)); val.textContent = `${Math.round(m.angle || 0)}°`; render2(); });
        jbox.append(lim('min', lo), sl, lim('max', hi), val);
      } else if (!hinge && !m.fixed) jbox.append(el('span', { className: 'asm-note', textContent: 'Held by two or more screws, so it is rigid.' }));
      mateList.append(el('div', { className: 'asm-mate' }, el('div', { className: 'asm-lib-row' }, el('span', { className: `asm-dot ${ck.level}` }), el('span', { className: 'asm-lib-name', textContent: `${nm(A)} ⇄ ${nm(B)}` }), scr, un), jbox, el('div', { className: 'asm-note', textContent: ck.notes.join(' ') })));
    });
    renderDrone();
    const bom = asm.bom();
    bomEl.textContent = asm.instances.length ? `${bom.parts.map(p => `${p.count} × ${p.name}`).join(', ')}${bom.screws.length ? ' · screws: ' + bom.screws.map(s => `${s.count} × ${s.thread.replace('_', '.')}`).join(', ') : ''} · about ${bom.grams} g` : '';
  }
  /** A drone in the scene: what it weighs, whether it lifts, how long it hovers (typical values; see core/drone.js). */
  function renderDrone() {
    const ds = asm.instances.filter(i => i.part.drone), of = k => ds.filter(i => i.part.drone.kind === k), motors = of('motor'), props = of('prop'), bats = of('battery');
    droneEl.hidden = !motors.length; if (!motors.length) return; droneEl.replaceChildren();
    const line = (t, cls = '') => droneEl.append(el('div', { className: `asm-note ${cls}`, textContent: t })); droneEl.append(el('h4', { textContent: 'Drone check' }));
    const withProp = motors.filter(m => asm.matesOf(m.id).some(x => props.some(p => p.id === (x.a.inst === m.id ? x.b.inst : x.a.inst)))).length;
    if (!props.length) return line('Put a prop on each motor (join the prop’s bore-bottom to the motor’s shaft) to see thrust.');
    if (!bats.length) return line('Add a battery to see flight time.');
    const m0 = motors[0].part.drone, p0 = props[0].part.drone, b0 = bats[0].part.drone, motor = makeMotor({ size: m0.size, kv: m0.kv, over: m0.over }), prop = makeProp({ diameterIn: p0.dia, pitchIn: p0.pitch, blades: p0.blades }), battery = makeBattery({ cells: b0.cells, mAh: b0.mAh, c: b0.c });
    const other = asm.instances.filter(i => !i.part.drone || !['motor', 'prop', 'battery'].includes(i.part.drone.kind)).reduce((g, i) => g + (i.part.mass?.grams || 0), 0) + 5, r = analyseQuad({ motor, prop, battery, extraGrams: other, motors: motors.length });
    line(`${motors.length} motors (${withProp} with a prop) · ${r.massGrams} g · thrust-to-weight ${r.twr}:1${r.hoverThrottle ? ` · hovers at ${Math.round(r.hoverThrottle * 100)} % throttle, about ${r.hoverAmps} A, about ${r.flightMinutes} min` : ''}`);
    if (withProp < motors.length) line(`${motors.length - withProp} motor${motors.length - withProp > 1 ? 's have' : ' has'} no prop yet.`, 'bad');
    for (const n of r.notes) line(n, 'bad'); line('Estimates from typical values. Open “Advanced” when you make a motor to enter your own numbers. Open the Test tab to fly it.');
  }
  const render2h = () => { for (const inst of asm.instances) inst.obj.traverse(m => { if (m.isMesh) m.material.emissive.setHex(inst.id === selected ? 0x1d4e75 : inst.id === hoverInst ? 0x2a3a44 : 0x000000); }); three?.draw(); };
  /** The point on the line p + s·a that is closest to a ray, as the parameter s. */
  function axisParam(ray, p, a) {
    const d = ray.direction, w = [p.x - ray.origin.x, p.y - ray.origin.y, p.z - ray.origin.z], B = a[0] * d.x + a[1] * d.y + a[2] * d.z, D = a[0] * w[0] + a[1] * w[1] + a[2] * w[2], E = d.x * w[0] + d.y * w[1] + d.z * w[2], den = 1 - B * B;
    return Math.abs(den) < 1e-6 ? null : (B * E - D) / den;
  }

  // — the mouse: grab a part or an arrow to move it, drag the background to look around
  function attach(t) {
    if (attached) return; attached = true; const dom = t.renderer.domElement, { THREE } = t, plane = new THREE.Plane(), hitPt = new THREE.Vector3();
    const ndc = e => { const r = dom.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)); };
    const ownerOf = o => { while (o && !o.userData.inst && !o.userData.axis) o = o.parent; return o; };
    const instAt = e => { t.ray.setFromCamera(ndc(e), t.camera); const h = t.ray.intersectObjects(t.sceneRoot.children, true)[0]; if (!h) return null; let o = h.object; while (o && !o.userData.inst) o = o.parent; return o ? { id: o.userData.inst, point: h.point } : null; };
    const gizmoAt = e => { t.ray.setFromCamera(ndc(e), t.camera); const hs = t.ray.intersectObjects(t.sceneGizmos.children, true); return hs.map(h => ({ data: h.object.userData, point: h.point })).find(x => x.data.axis || x.data.hole || x.data.ring) || null; };
    const snapAndPlace = inst => {
      const r0 = dom.getBoundingClientRect(), px = p => { const v = new THREE.Vector3(...p).project(t.camera); return [(v.x + 1) / 2 * r0.width, (1 - v.y) / 2 * r0.height]; };
      const s = asm.snapFor(inst.id, { reach: 30, maxSizeGap: 1.5, measure: (a, b) => { const A = px(a), B = px(b); return Math.hypot(A[0] - B[0], A[1] - B[1]); } }); snapShow = s;      // close ON SCREEN counts, so you needn't judge depth
      if (s) { const A = asm.get(s.a); inst.T = mateTransform(A, A.part.frames.find(f => f.id === s.aFrame), inst, inst.part.frames.find(f => f.id === s.bFrame)); }
    };
    dom.addEventListener('pointerdown', e => {
      if (mode !== 'build' || e.button !== 0) return;
      const g = gizmoAt(e);
      if (spotMode) { if (g?.data.spot) dropSpot(g.data.inst, g.data.frame); else spotAt(e, t, ndc); return; }
      if (joinMode) { if (g?.data.hole) joinPick(g.data.inst, g.data.frame); else if (joinFirst) { joinFirst = null; render(); } return; }
      if (g?.data.ring && selected && asm.get(selected)) {                                    // a ring: turn about that axis, 15° steps (Shift = free)
        const inst = asm.get(selected), c = new THREE.Vector3(...centreOf(inst)), a = new THREE.Vector3(...g.data.dir), ref = Math.abs(a.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0), u = ref.clone().sub(a.clone().multiplyScalar(ref.dot(a))).normalize(), v = a.clone().cross(u);
        const ang = ev => { t.ray.setFromCamera(ndc(ev), t.camera); const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(a, c), q = new THREE.Vector3(); if (!t.ray.ray.intersectPlane(pl, q)) return null; q.sub(c); return Math.atan2(q.dot(v), q.dot(u)) * 180 / Math.PI; };
        const a0 = ang(e); if (a0 == null) return; t.controls.enabled = false; dom.setPointerCapture(e.pointerId);
        drag = { id: inst.id, mode: 'ring', ang, a0, applied: 0, axis: g.data.dir, c: [c.x, c.y, c.z], start: { x: e.clientX, y: e.clientY }, moved: false, pending: asm.snapshot() }; return;
      }
      if (g?.data.axis && selected && asm.get(selected)) {                                    // an arrow: slide along that axis
        const inst = asm.get(selected), a = g.data.dir, c = new THREE.Vector3(...centreOf(inst)); t.ray.setFromCamera(ndc(e), t.camera);
        const s0 = axisParam(t.ray.ray, c, a); if (s0 == null) return; t.controls.enabled = false; dom.setPointerCapture(e.pointerId);
        drag = { id: inst.id, mode: 'axis', a, c, s0, start: { x: e.clientX, y: e.clientY }, t0: [...inst.T.t], moved: false, pending: asm.snapshot() }; return;
      }
      const h = instAt(e); if (!h) { if (selected) select(null); return; }
      t.controls.enabled = false; dom.setPointerCapture(e.pointerId); selected = h.id;
      const inst = asm.get(h.id);
      if (connected(asm, h.id).length > 1 && !e.altKey) {                                      // part of a robot: pull it and the rest follows, within the hinges
        const dirV = new THREE.Vector3(); t.camera.getWorldDirection(dirV); plane.setFromNormalAndCoplanarPoint(dirV, h.point); const lp = inst.obj.worldToLocal(h.point.clone());
        drag = { id: h.id, mode: 'pose', local: [lp.x, lp.y, lp.z], grab: h.point.clone(), start: { x: e.clientX, y: e.clientY }, moved: false, pending: asm.snapshot() }; render(); return;
      }
      plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), h.point);
      drag = { id: h.id, mode: 'plane', start: { x: e.clientX, y: e.clientY }, t0: [...inst.T.t], grab: h.point.clone(), moved: false, pending: asm.snapshot() }; render();
    }, true);
    dom.addEventListener('pointermove', e => {
      if (mode !== 'build') return;
      if (!drag) {                                                                             // hovering: say what a hole is
        const g = gizmoAt(e), over = instAt(e); dom.style.cursor = g?.data.axis || g?.data.ring ? 'grab' : joinMode && g?.data.hole ? 'pointer' : over ? 'grab' : '';
        const lab = g?.data.hole ? g.data.label : g?.data.axis ? `Drag to move along ${g.data.axis.toUpperCase()}` : g?.data.ring ? `Drag to turn about ${g.data.ring.toUpperCase()} (Shift for free)` : '';
        if (tip) { tip.hidden = !lab; if (lab) { tip.textContent = lab; tip.style.left = `${e.clientX - dom.getBoundingClientRect().left + 12}px`; tip.style.top = `${e.clientY - dom.getBoundingClientRect().top + 12}px`; } }
        const nh = over?.id || null; if (nh !== hoverInst) { hoverInst = nh; render2h(); }
        return;
      }
      if (!drag.moved && Math.hypot(e.clientX - drag.start.x, e.clientY - drag.start.y) < 4) return;
      const inst = asm.get(drag.id); if (!inst) return;
      if (!drag.moved) { drag.moved = true; history.push(drag.pending); future = []; if (drag.mode !== 'pose') detach(inst); dom.style.cursor = 'grabbing'; }
      if (drag.mode === 'ring') { const cur = drag.ang(e); if (cur == null) return; let d = cur - drag.a0; d = ((d + 540) % 360) - 180; if (!e.shiftKey) d = Math.round(d / 15) * 15; if (d !== drag.applied) { turn(inst, drag.axis, drag.c, d - drag.applied); drag.applied = d; bsay(`Turned ${d}°`); render(); } return; }
      t.ray.setFromCamera(ndc(e), t.camera);
      if (drag.mode === 'pose') { if (!t.ray.ray.intersectPlane(plane, hitPt)) return; const r = dragTo(asm, anchorId, drag.id, drag.local, [hitPt.x, hitPt.y, hitPt.z]); bsay(r.mode === 'move' ? '' : r.miss > 2 ? 'The joints will not bend any further that way.' : ''); render2(); return; }
      if (drag.mode === 'axis') { const s = axisParam(t.ray.ray, drag.c, drag.a); if (s == null) return; const d = s - drag.s0; inst.T = { q: inst.T.q, t: [drag.t0[0] + drag.a[0] * d, drag.t0[1] + drag.a[1] * d, drag.t0[2] + drag.a[2] * d] }; }
      else { if (!t.ray.ray.intersectPlane(plane, hitPt)) return; inst.T = { q: inst.T.q, t: [drag.t0[0] + hitPt.x - drag.grab.x, drag.t0[1] + hitPt.y - drag.grab.y, drag.t0[2] + hitPt.z - drag.grab.z] }; }
      snapAndPlace(inst); render();
    });
    const end = e => {
      if (!drag) return; const d = drag; drag = null; t.controls.enabled = true; dom.style.cursor = ''; try { dom.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      if (d.moved && snapShow && d.mode !== 'ring') { const s = snapShow, r = asm.mateAll(s.a, s.aFrame, d.id, s.bFrame); if (r.ok) bsay(`Joined${r.extra ? ` (and ${r.extra} more matching hole${r.extra > 1 ? 's' : ''})` : ''}. ${r.check.notes[0] || ''}`, r.check.level === 'bad'); }
      else if (d.moved) bsay('');
      snapShow = null; render();
    };
    dom.addEventListener('pointerup', end); dom.addEventListener('pointercancel', end);
    dom.addEventListener('dblclick', e => { if (mode !== 'build') return; const h = instAt(e); if (h) { select(h.id); viewTo('iso', asm.get(h.id)); } });
    dom.addEventListener('dragover', e => { if (mode === 'build') e.preventDefault(); });
    dom.addEventListener('drop', e => {
      const m = /^circuitbench-part:(.+)$/.exec(e.dataTransfer?.getData('text/plain') || ''); if (!m || mode !== 'build') return; e.preventDefault();
      const p = findPart(m[1]); if (!p) return; t.ray.setFromCamera(ndc(e), t.camera); const g0 = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), at = new THREE.Vector3();
      addToScene(p, t.ray.ray.intersectPlane(g0, at) ? [at.x, at.y] : null);
    });
    tip = el('div', { className: 'asm-tip', hidden: true }); stage.append(tip);
    addEventListener('keydown', e => {
      if (mode !== 'build' || pane.hidden || /input|select|textarea/i.test(document.activeElement?.tagName || '')) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && k === 'z') { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (e.shiftKey && k === 'z'))) { e.preventDefault(); redo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); removeInst(selected); }
      else if (k === 'j') setJoin(!joinMode);
      else if (e.key === 'Escape') { if (spotMode) setSpot(false); else if (joinMode) setJoin(false); else if (selected) select(null); }
      else if (k === 'f') fitScene();
    });
  }
  /** The Join tool: the first hole stays put, the part with the second hole moves onto it. */
  function joinPick(instId, frameId) {
    if (!joinFirst) { joinFirst = { inst: instId, frame: frameId }; return render(); }
    if (joinFirst.inst === instId) { joinFirst = { inst: instId, frame: frameId }; bsay('Pick the second hole on a different part.'); return render(); }
    const a = joinFirst, carried = asm.component(instId).length - 1; keep(); const r = asm.mateAll(a.inst, a.frame, instId, frameId); joinFirst = null;
    if (!r.ok) { history.pop(); bsay(r.error, true); } else { bsay(`Joined${r.extra ? ` (and ${r.extra} more matching hole${r.extra > 1 ? 's' : ''})` : ''}${carried > 0 ? ` (brought ${carried} connected part${carried > 1 ? 's' : ''} along)` : ''}. ${r.check.notes[0] || ''}`, r.check.level === 'bad'); selected = instId; }
    joinMode = false; joinBtn.classList.remove('on'); render();
  }
  async function setMode(m) {
    mode = m; syncTop(); for (const [k, b] of Object.entries(modeBtn)) { b.classList.toggle('on', k === m); b.setAttribute('aria-pressed', String(k === m)); }
    partBox.hidden = m !== 'part'; buildBox.hidden = m !== 'build';
    const t = await load3d();
    t.root.visible = t.gizmos.visible = m === 'part'; t.sceneRoot.visible = t.sceneGizmos.visible = m === 'build'; toolbarEl.hidden = m !== 'build'; helpEl.hidden = m !== 'build';
    if (m === 'build') { attach(t); await loadExamples(); renderCards(); makeThumbs(); await restoreSaved(); hint.hidden = true; render(); if (asm.instances.length) fitScene(); }
    else { hint.textContent = 'Import a 3D model of a part (STL, OBJ or glTF) to start marking where it connects.'; hint.hidden = t.hasModel(); t.drawGizmos(); t.draw(); }
  }
  for (const [k, b] of Object.entries(modeBtn)) b.addEventListener('click', () => setMode(k));
  holesBtn.addEventListener('click', async () => {
    const t = await load3d(); if (!t.hasModel()) return say('Import or open a model first.', true);
    const n = await autoHoles(); say(n ? `Marked ${n} hole${n === 1 ? '' : 's'}. Check each one, then save the part.` : 'No new round holes found. Click the model to mark them by hand.', !n);
  });

  // ── tabs ──────────────────────────────────────────────────────
  let view = 'circuit', droneTest = null, robotTest = null, testChoice = null;
  /** A drone has motors (and props); anything else that is built is tested as a robot with physics. The person can switch either way. */
  const autoKind = () => (asm.instances.some(i => i.part.drone?.kind === 'motor') || !asm.instances.length ? 'fly' : 'robot');
  /** Every vertex of a part in the world (mm, flat x,y,z), for the physics shape. */
  function hullPoints(inst) {
    const out = [], t = three; if (!t || !inst.obj) return out; inst.obj.position.fromArray(inst.T.t); inst.obj.quaternion.set(...inst.T.q); inst.obj.updateMatrixWorld(true); const v = new t.THREE.Vector3();
    inst.obj.traverse(o => { const pos = o.isMesh && o.geometry?.attributes?.position; if (!pos) return; for (let i = 0; i < pos.count && out.length < 1_500_000; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); out.push(v.x, v.y, v.z); } });
    return out;
  }
  async function show(v) {
    view = v;
    for (const [id, b] of Object.entries(tabBtn)) { b.classList.toggle('on', id === v); b.setAttribute('aria-pressed', String(id === v)); }
    document.querySelector('#partsPanel .parts-title').textContent = v === 'circuit' ? 'Parts' : '3D parts';
    let kind = 'fly'; if (v === 'test') { await load3d(); await loadExamples(); await restoreSaved(); kind = testChoice || autoKind(); }
    pane.hidden = v !== 'assembly'; testPane.hidden = !(v === 'test' && kind === 'fly'); robotPane.hidden = !(v === 'test' && kind === 'robot'); document.body.classList.toggle('robot-asm', v !== 'circuit');
    if (!(v === 'test' && kind === 'fly')) droneTest?.leave(); if (!(v === 'test' && kind === 'robot')) robotTest?.leave();
    const switchTo = k => { testChoice = k; show('test'); }, prepare = async () => { await load3d(); await loadExamples(); await restoreSaved(); };
    if (v === 'test' && kind === 'fly') { droneTest ||= initDroneTest({ host: testPane, getAsm: () => asm, getWiring: () => droneWiring(editor.state), prepare, buildExample: buildExampleQuad, goAssembly: () => show('assembly'), switchTo }); await droneTest.enter(); }
    if (v === 'test' && kind === 'robot') { robotTest ||= initRobotTest({ host: robotPane, getAsm: () => asm, getAnchor: () => anchorId, getHull: hullPoints, prepare, goAssembly: () => show('assembly'), switchTo }); await robotTest.enter(); }
    if (v === 'assembly') { if (mode === 'build') await setMode('build'); syncForm(); renderFrames(); renderLibrary(); loadExamples().then(renderLibrary); const t = await load3d(); t.size(); t.drawGizmos(); t.draw(); }
    editor.emit?.('robot-view', v); syncTop();
  }
  for (const [id, b] of Object.entries(tabBtn)) b.addEventListener('click', () => show(id));
  const sync = () => {
    const on = !!activeWorkspace().robotics;
    tabs.hidden = !on; sepAfter.hidden = !on;
    if (!on && view !== 'circuit') show('circuit');
    if (on && !tabBtn.circuit.classList.contains('on') && !tabBtn.assembly.classList.contains('on') && !tabBtn.test.classList.contains('on')) tabBtn.circuit.classList.add('on');
  };
  editor.on('catalog', sync); sync();
  // the top bar's undo / redo / delete act on the 3D scene while Assembly is showing (captured before the circuit handlers see the click)
  document.querySelector('.stage .toolbar')?.addEventListener('click', e => {
    if (view === 'circuit') return; const b = e.target.closest?.('button'); if (!b) return;
    const act = { undoTool: undo, redoTool: redo, deleteTool: () => selected && removeInst(selected) }[b.id]; if (!act) return;   // (the tab buttons share this bar)
    e.stopImmediatePropagation(); e.preventDefault(); if (!b.disabled && view === 'assembly' && mode === 'build') act();
  }, true);
  /** For the AI chat: read the scene, and carry out the edits it proposes (as one undo step). */
  const ai = {
    active: () => view === 'assembly',
    async describe() { await loadExamples(); const d = describeAssembly(asm, everyPart().filter(p => !p.generated), anchorId); const presets = DRONE_PRESETS.map(([name, id]) => { const p = dronePart(id); return p ? `- ${id} — ${name} (Drone), ${p.mass?.grams ?? '?'} g. Holes: ${p.frames.map(f => f.id).join(', ')}` : null; }).filter(Boolean);
      d.parts += `\n${presets.join('\n')}\n${DRONE_ID_HELP}`; return d; },
    async run(ops) {
      const t = await load3d(); attach(t); await loadExamples(); const before = asm.snapshot(), ctx = { anchorId, addPart: (p, at) => addToScene(p, at), partById: findPart, removePart: id => { const i = asm.get(id); if (i) t.sceneRoot.remove(i.obj); asm.remove(id); if (selected === id) selected = null; } };
      batch = true; let out; try { out = await runAssemblyOps(asm, ops, ctx); } finally { batch = false; }
      anchorId = ctx.anchorId; if (out.done) { history.push(before); if (history.length > 60) history.shift(); future = []; }
      applyScene(); if (out.done) fitScene(); return out;
    },
  };
  projects?.onSwitch(p => { switchScene(p.id); });
  return { ai, show, sync, scene: asm, draft, importFile, pick: (x, y) => three?.pick(x, y), get three() { return three; }, get view() { return view; } };
}
