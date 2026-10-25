// The Robotics workspace's tabs — Circuit · Assembly · Test — and the Assembly tab: import a part's 3D model (STL, OBJ or glTF/GLB),
// click its holes, shafts and connectors to place named frames, give it its mass, and save it as a robot-part description (core/robot-part.js).
// There is no CAD here on purpose: geometry comes from the user's own CAD; this tab only ANNOTATES it. three.js loads the first time it opens.
import { PartDraft, formatOf, UNIT_MM } from '../core/assembly-draft.js';
import { FRAME_KINDS, THREADS, SOURCES, provenanceOf, validateRobotPart } from '../core/robot-part.js';
import { featureEdges, circleNear, findHoles } from '../core/hole-finder.js';
import { Assembly, worldFrame, screwFor } from '../core/assembly-scene.js';
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

export function initAssembly({ editor }) {
  const canvas = document.getElementById('canvas'), toolbar = document.querySelector('.toolbar');
  const tabs = el('div', { className: 'view-toggle robot-tabs', role: 'group', ariaLabel: 'Robot views', hidden: true });
  const tabBtn = {};
  for (const [id, label] of [['circuit', 'Circuit'], ['assembly', 'Assembly'], ['test', 'Test']]) { tabBtn[id] = el('button', { type: 'button', textContent: label, id: `tab-${id}` }); tabs.append(tabBtn[id]); }
  const sepAfter = el('span', { className: 'sep', hidden: true });
  toolbar.prepend(tabs, sepAfter);

  const draft = new PartDraft(); let mode = 'part';
  const pane = el('div', { className: 'asm-pane', hidden: true });
  const stage = el('div', { className: 'asm-stage' });
  const hint = el('div', { className: 'asm-hint', textContent: 'Import a 3D model of a part (STL, OBJ or glTF) to start marking where it connects.' });
  stage.append(hint);
  const side = el('div', { className: 'asm-side' });
  const testPane = el('div', { className: 'asm-pane test-pane', hidden: true }, el('div', { className: 'asm-hint', textContent: 'Test is next: the sketch will drive the assembled robot with real physics. For now, build and check your parts in Assembly.' }));
  canvas.append(pane, testPane);
  for (const t of ['pointerdown', 'mousedown']) for (const el0 of [pane, testPane]) el0.addEventListener(t, e => e.stopPropagation());      // the circuit canvas starts a pan on press and cancels it, which closed every dropdown here
  for (const t of ['wheel', 'touchmove']) side.addEventListener(t, e => e.stopPropagation(), { passive: true });      // the circuit canvas zooms on wheel; the side panel must just scroll
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
  const partBox = el('div', { className: 'asm-box' }), buildBox = el('div', { className: 'asm-box', hidden: true });
  const modeBar = el('div', { className: 'view-toggle asm-mode', role: 'group', ariaLabel: 'Mark parts or build' });
  const modeBtn = { part: el('button', { type: 'button', id: 'asmModePart', textContent: 'Mark a part' }), build: el('button', { type: 'button', id: 'asmModeBuild', textContent: 'Build' }) };
  modeBar.append(modeBtn.part, modeBtn.build); side.append(modeBar, partBox, buildBox);
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
        down = null; if (mode === 'build') return buildClick(e.clientX, e.clientY);
        const p = pick(e.clientX, e.clientY);
        if (p.hit === 'frame') { draft.selected = p.id; renderFrames(); drawGizmos(); draw(); }
        else if (p.hit === 'model') { draft.addFrame({ pos: p.pos, dir: p.dir, kind: kindSel.value, diameter: p.diameter }); renderFrames(); drawGizmos(); draw(); }
      });
      addEventListener('resize', size);
      three = { edges, THREE, root, gizmos, sceneRoot, sceneGizmos, controls, ray, setModel, applyUnits, drawGizmos, draw, size, pick, hasModel: () => !!model, camera, renderer, scene, fit: () => model && (fit(), draw()) };
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
      syncForm(); renderFrames(); say(`Loaded ${file.name}. Check the size below, set the units if it looks wrong, then click the model to mark connection points.`);
    } catch (e) { say(`Could not read that model: ${e?.message || e}`, true); }
  }
  let stagedMesh = null;
  importBtn.addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) importFile(f); });
  // dropping a file onto the stage works too
  stage.addEventListener('dragover', e => e.preventDefault());
  stage.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) importFile(f); });

  // ── forms ─────────────────────────────────────────────────────
  function say(text, bad = false) { msg.textContent = text; msg.classList.toggle('bad', !!bad); }
  function syncForm() {
    nameIn.value = draft.name; unitsSel.value = draft.model.units; upSel.value = draft.model.up; massIn.value = draft.massGrams; massSrc.value = draft.massSource;
    const s = draft.sizeMm; dimsEl.textContent = s ? `Size from the model: ${s.map(v => +v.toFixed(2)).join(' × ')} mm (check this against the real part).` : 'No model yet.';
  }
  nameIn.addEventListener('input', () => { draft.name = nameIn.value; });
  massIn.addEventListener('input', () => { draft.massGrams = massIn.value; });
  massSrc.addEventListener('change', () => { draft.massSource = massSrc.value; });
  unitsSel.addEventListener('change', () => { draft.setUnits(unitsSel.value); three?.applyUnits(true); syncForm(); });
  upSel.addEventListener('change', () => { draft.model.up = upSel.value; three?.applyUnits(true); syncForm(); });

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
  async function save() {
    const v = draft.validate();
    if (!v.ok) return say(`Not saved: ${v.errors.slice(0, 3).join(' ')}`, true);
    if (!stagedMesh && !(await getMesh(`${v.part.id}/${v.part.model.file}`))) return say('Import a model first.', true);
    const list = libraryParts().filter(p => p.id !== v.part.id); list.unshift(v.part); saveLibrary(list.slice(0, 80));
    if (stagedMesh) await putMesh(`${v.part.id}/${v.part.model.file}`, stagedMesh);
    renderLibrary(); const pv = provenanceOf(v.part);
    say(`Saved “${v.part.name}”.${pv.verified ? '' : ` Still estimated: ${pv.estimated.slice(0, 4).join(', ')}${pv.estimated.length > 4 ? '…' : ''} — measure and mark them when you can.`}`);
  }
  saveBtn.addEventListener('click', save);
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

  // ── building: several parts in one space, joined by mates ─────
  const asm = new Assembly(), meshCache = new Map(), objCache = new Map();
  let pickA = null, bmsg = '';
  const instList = el('div', { className: 'asm-lib', id: 'asmInst' }), mateList = el('div', { className: 'asm-lib', id: 'asmMates' }), bomEl = el('div', { className: 'asm-note', id: 'asmBom' });
  const addSel = el('select', { id: 'asmAddSel', ariaLabel: 'Part to add' }), addBtn = el('button', { type: 'button', className: 'asm-btn primary', textContent: 'Add to scene', id: 'asmAdd' });
  const bnote = el('p', { className: 'asm-msg', id: 'asmBuildMsg', role: 'status' });
  buildBox.append(
    el('p', { className: 'asm-note', textContent: 'Add parts, then click a hole ring on one part and a hole ring on another. The second part moves onto the first, holes lined up and facing each other.' }),
    el('div', { className: 'asm-row' }, addSel, addBtn), bnote,
    el('h4', { textContent: 'In the scene' }), instList, el('h4', { textContent: 'Mates' }), mateList, el('h4', { textContent: 'Parts & screws' }), bomEl);
  const bsay = (t, bad) => { bnote.textContent = t; bnote.classList.toggle('bad', !!bad); };
  const everyPart = () => [...libraryParts().map(p => ({ ...p, example: false })), ...examples];
  function refreshAddList() {
    const parts = everyPart(), cur = addSel.value; addSel.replaceChildren(...parts.map(p => el('option', { value: p.id, textContent: p.name })));
    if (parts.some(p => p.id === cur)) addSel.value = cur;
  }
  async function meshOf(part) { return part.example ? fetch(EX_DIR + part.model.file).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null) : getMesh(`${part.id}/${part.model.file}`); }
  /** A part's mesh in the same space the frames were marked in: scaled to mm, turned Z-up, centred in X/Y and resting on z = 0. */
  async function partObject(t, part) {
    if (!objCache.has(part.id)) {
      const buf = await meshOf(part); if (!buf) throw new Error(`The model file for “${part.name}” is not stored in this browser.`);
      const raw = await parseModel(t.THREE, { name: part.model.file }, buf), g = new t.THREE.Group(); g.add(raw);
      raw.traverse(o => { if (o.isMesh) o.material = new t.THREE.MeshStandardMaterial({ color: 0xb8c4cc, metalness: 0.15, roughness: 0.6, side: t.THREE.DoubleSide }); });
      g.rotation.set(part.model.up === 'y' ? Math.PI / 2 : 0, 0, 0); g.scale.setScalar(UNIT_MM[part.model.units] || 1); g.updateMatrixWorld(true);
      const b = new t.THREE.Box3().setFromObject(g), c = b.getCenter(new t.THREE.Vector3()); g.position.set(-c.x, -c.y, -b.min.z);
      const holder = new t.THREE.Group(); holder.add(g); objCache.set(part.id, holder);
    }
    return objCache.get(part.id).clone(true);
  }
  const colourOf = (inst, f) => pickA && pickA.inst === inst.id && pickA.frame === f.id ? 0xe0562a : asm.mates.some(m => (m.a.inst === inst.id && m.a.frame === f.id) || (m.b.inst === inst.id && m.b.frame === f.id)) ? 0x4aa36b : 0x1f7a8c;
  function drawBuild() {
    const t = three; if (!t) return; const { THREE } = t;
    t.sceneGizmos.clear();
    for (const inst of asm.instances) {
      const grp = inst.obj; if (!grp) continue;
      grp.position.fromArray(inst.T.t); grp.quaternion.set(...inst.T.q); grp.updateMatrixWorld(true);
      for (const f of inst.part.frames) {
        const w = worldFrame(inst, f), r = Math.max((f.diameter || 3) / 2, 0.8) + 0.3, ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.28, 8, 28), new THREE.MeshBasicMaterial({ color: colourOf(inst, f), depthTest: false }));
        const col = colourOf(inst, f), disc = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.28, depthTest: false, side: THREE.DoubleSide }));   // a filled target: a bare ring is hard to hit
        ring.add(disc); ring.position.fromArray(w.pos); ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...w.dir)); ring.renderOrder = disc.renderOrder = 10; ring.userData = { inst: inst.id, frame: f.id };
        t.sceneGizmos.add(ring);
      }
    }
    t.draw();
  }
  async function addToScene(part) {
    const t = await load3d();
    try {
      const obj = await partObject(t, part), inst = asm.add(part, [0, 0, 0]); inst.obj = obj; t.sceneRoot.add(obj);
      const bb = new t.THREE.Box3().setFromObject(obj).getSize(new t.THREE.Vector3()), n = asm.instances.length - 1;      // lay new parts out in a row so they start apart
      inst.T.t = [n * (Math.max(bb.x, 30) + 15) - 40, 0, 0]; hint.hidden = true; renderBuild(); drawBuild(); fitScene();
      if (!part.frames.length) bsay(`“${part.name}” has no marked holes yet. Mark them in “Mark a part”, save, and add it again.`, true);
    } catch (e) { bsay(e.message, true); }
  }
  function fitScene() {
    const t = three, b = new t.THREE.Box3().setFromObject(t.sceneRoot); if (b.isEmpty()) return;
    const s = b.getSize(new t.THREE.Vector3()), c = b.getCenter(new t.THREE.Vector3()), d = Math.max(s.x, s.y, s.z, 20) * 2.2;
    t.controls.target.copy(c); t.camera.position.set(c.x + d * 0.5, c.y - d, c.z + d * 0.6); t.camera.near = d / 100; t.camera.far = d * 100; t.camera.updateProjectionMatrix(); t.controls.update(); t.draw();
  }
  function buildClick(x, y) {
    const t = three; if (!t) return; const r = t.renderer.domElement.getBoundingClientRect();
    t.ray.setFromCamera(new t.THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -(((y - r.top) / r.height) * 2 - 1)), t.camera);
    const g = t.ray.intersectObjects(t.sceneGizmos.children, true)[0]; if (g) { let o = g.object; while (o && !o.userData.inst) o = o.parent; g.object = o || g.object; }
    if (!g) { if (pickA) { pickA = null; bsay('Pick cancelled.'); drawBuild(); } return; }
    pickFrame(g.object.userData.inst, g.object.userData.frame);
  }
  function pickFrame(instId, frameId) {
    if (!pickA) { pickA = { inst: instId, frame: frameId }; bsay(`Now click a hole on a different part. It will move onto ${frameId} of ${asm.get(instId).part.name}.`); return drawBuild(); }
    if (pickA.inst === instId) { pickA = { inst: instId, frame: frameId }; bsay('Pick a hole on a different part.'); return drawBuild(); }
    const a = pickA; pickA = null; const res = asm.mate(a.inst, a.frame, instId, frameId);
    if (!res.ok) bsay(res.error, true); else bsay(`Mated. ${res.check.notes[0] || ''}`, res.check.level === 'bad');
    renderBuild(); drawBuild();
  }
  function renderBuild() {
    refreshAddList(); instList.replaceChildren(); mateList.replaceChildren();
    if (!asm.instances.length) instList.append(el('p', { className: 'asm-note', textContent: 'Nothing here yet. Add a part above.' }));
    for (const inst of asm.instances) {
      const del = el('button', { type: 'button', className: 'asm-x', textContent: '✕', title: 'Remove from the scene', ariaLabel: `Remove ${inst.part.name}` });
      del.addEventListener('click', () => { three?.sceneRoot.remove(inst.obj); asm.remove(inst.id); if (pickA?.inst === inst.id) pickA = null; renderBuild(); drawBuild(); });
      instList.append(el('div', { className: 'asm-lib-row' }, el('span', { className: 'asm-lib-name', textContent: inst.part.name, title: inst.id }), el('span', { className: 'asm-badge', textContent: `${inst.part.frames.length} holes` }), del));
    }
    asm.mates.forEach((m, i) => {
      const ck = asm.check(m), A = asm.get(m.a.inst), B = asm.get(m.b.inst);
      const scr = el('select', { ariaLabel: 'Screw', className: 'asm-mini-sel' }, el('option', { value: '', textContent: 'auto screw' }), ...Object.keys(THREADS).map(k => el('option', { value: k, textContent: k.replace('_', '.'), selected: k === m.screw })));
      scr.addEventListener('change', () => { m.screw = scr.value || null; renderBuild(); });
      const del = el('button', { type: 'button', className: 'asm-x', textContent: '✕', title: 'Undo this mate (the part stays where it is)', ariaLabel: 'Remove mate' });
      del.addEventListener('click', () => { asm.mates.splice(i, 1); renderBuild(); drawBuild(); });
      mateList.append(el('div', { className: 'asm-mate' }, el('div', { className: 'asm-lib-row' }, el('span', { className: 'asm-lib-name', textContent: `${A?.part.name ?? '?'} ${m.a.frame} ⇄ ${B?.part.name ?? '?'} ${m.b.frame}` }), el('span', { className: `asm-badge ${ck.level}`, textContent: ck.level === 'ok' ? 'fits' : ck.level === 'warn' ? 'check' : 'problem' }), scr, del), el('div', { className: 'asm-note', textContent: ck.notes.join(' ') })));
    });
    const bom = asm.bom();
    bomEl.textContent = asm.instances.length ? `${bom.parts.map(p => `${p.count} × ${p.name}`).join(', ')}${bom.screws.length ? '; screws: ' + bom.screws.map(s => `${s.count} × ${s.thread.replace('_', '.')}`).join(', ') : ''}. About ${bom.grams} g (printed-part masses are estimates).` : '';
  }
  addBtn.addEventListener('click', () => { const p = everyPart().find(q => q.id === addSel.value); if (p) addToScene(p); });
  async function setMode(m) {
    mode = m; for (const [k, b] of Object.entries(modeBtn)) { b.classList.toggle('on', k === m); b.setAttribute('aria-pressed', String(k === m)); }
    partBox.hidden = m !== 'part'; buildBox.hidden = m !== 'build';
    const t = await load3d();
    t.root.visible = t.gizmos.visible = m === 'part'; t.sceneRoot.visible = t.sceneGizmos.visible = m === 'build';
    if (m === 'build') { await loadExamples(); renderBuild(); hint.textContent = 'Add parts from the list on the right.'; hint.hidden = asm.instances.length > 0; drawBuild(); if (asm.instances.length) fitScene(); }
    else { hint.textContent = 'Import a 3D model of a part (STL, OBJ or glTF) to start marking where it connects.'; hint.hidden = t.hasModel(); t.drawGizmos(); t.draw(); }
  }
  for (const [k, b] of Object.entries(modeBtn)) b.addEventListener('click', () => setMode(k));
  modeBtn.part.classList.add('on');
  holesBtn.addEventListener('click', async () => {
    const t = await load3d(); if (!t.hasModel()) return say('Import or open a model first.', true);
    let found; try { found = findHoles(edges()); } catch { found = []; }
    if (!found.length) return say('No round holes found. Click the model to mark them by hand.', true);
    let added = 0;
    for (const h of found) { if (draft.frames.some(f => f.kind === 'hole' && Math.hypot(f.pos[0] - h.center[0], f.pos[1] - h.center[1], f.pos[2] - h.center[2]) < 0.3)) continue; draft.addFrame({ pos: h.center, dir: h.axis, kind: 'hole', diameter: h.radius * 2 }); added++; }
    renderFrames(); t.drawGizmos(); t.draw(); say(`Marked ${added} hole${added === 1 ? '' : 's'}. Check each one, then save the part.`);
  });

  // ── tabs ──────────────────────────────────────────────────────
  let view = 'circuit';
  async function show(v) {
    view = v;
    for (const [id, b] of Object.entries(tabBtn)) { b.classList.toggle('on', id === v); b.setAttribute('aria-pressed', String(id === v)); }
    pane.hidden = v !== 'assembly'; testPane.hidden = v !== 'test'; document.body.classList.toggle('robot-asm', v !== 'circuit');
    if (v === 'assembly') { if (mode === 'build') await setMode('build'); syncForm(); renderFrames(); renderLibrary(); loadExamples().then(renderLibrary); const t = await load3d(); t.size(); t.drawGizmos(); t.draw(); }
    editor.emit?.('robot-view', v);
  }
  for (const [id, b] of Object.entries(tabBtn)) b.addEventListener('click', () => show(id));
  const sync = () => {
    const on = !!activeWorkspace().robotics;
    tabs.hidden = !on; sepAfter.hidden = !on;
    if (!on && view !== 'circuit') show('circuit');
    if (on && !tabBtn.circuit.classList.contains('on') && !tabBtn.assembly.classList.contains('on') && !tabBtn.test.classList.contains('on')) tabBtn.circuit.classList.add('on');
  };
  editor.on('catalog', sync); sync();
  return { show, sync, draft, importFile, pick: (x, y) => three?.pick(x, y), get three() { return three; }, get view() { return view; } };
}
