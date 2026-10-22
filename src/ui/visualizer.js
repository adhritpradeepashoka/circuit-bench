// The Visualizer (Bioelectronics workspace): a 3D head you put electrodes on. Drag the E+ / E− / REF electrodes of the
// body source onto marked sites (or pick them from the lists) and the signal that reaches the circuit changes with where
// they are. three.js loads the first time this opens. The head is drawn here in code (an ellipsoid with a nose and
// ears) — an original shape, so there is no model file or licence to carry. Illustrative signals, not medical data.
import { SITES, SITE, SITE_GROUPS, HEAD_RADII, surfacePoint, describeMontage } from '../core/body-sites.js';
import { signalAt } from '../core/signals.js';
import { PART_DEFS } from '../core/parts.js';
import { activeWorkspace } from '../core/workspaces.js';

const ELECTRODES = [['sp', 'E+', '#d6453a'], ['sn', 'E−', '#2f6cf0'], ['sr', 'REF', '#27a560']];
const GROUP_COLOR = { EEG: 0x7a8f86, EOG: 0xc7863a, EMG: 0xa65d8c, Reference: 0x8d9a95 };
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

export function initVisualizer({ editor }) {
  const canvas = document.getElementById('canvas'), toolbar = document.querySelector('.toolbar');
  const toggle = el('div', { className: 'view-toggle', role: 'group', ariaLabel: 'View', hidden: true });
  const bCircuit = el('button', { type: 'button', textContent: 'Circuit' }), bViz = el('button', { type: 'button', textContent: 'Visualizer' });
  toggle.append(bCircuit, bViz);
  toolbar.prepend(toggle, el('span', { className: 'sep' }));
  const sepAfter = toolbar.children[1];

  const pane = el('div', { className: 'viz-pane', hidden: true });
  const stage = el('div', { className: 'viz-stage' });
  const hintEl = el('div', { className: 'viz-hint', textContent: 'Loading the 3D head…' });
  const labels = el('div', { className: 'viz-labels' });
  stage.append(hintEl, labels);
  const side = el('div', { className: 'viz-side' });
  const title = el('b', { textContent: 'Electrodes' });
  const lead = el('p', { className: 'viz-note', textContent: 'Drag an electrode onto the head, or choose a site from the list. Illustrative signals — not medical data.' });
  const chips = el('div', { className: 'viz-chips' }), selects = {};
  for (const [key, label, color] of ELECTRODES) {
    const chip = el('div', { className: 'viz-chip', textContent: label, title: `Drag ${label} onto the head` }); chip.style.background = color; chip.dataset.key = key;
    const sel = el('select', { ariaLabel: `${label} site` });
    sel.append(el('option', { value: '', textContent: '— not placed —' }));
    for (const g of SITE_GROUPS) {
      const og = el('optgroup', { label: g });
      for (const s of SITES.filter(x => x.group === g)) og.append(el('option', { value: s.id, textContent: s.name }));
      sel.append(og);
    }
    selects[key] = sel;
    chips.append(el('div', { className: 'viz-row' }, chip, sel));
    sel.addEventListener('change', () => place(key, sel.value));
  }
  const readout = el('p', { className: 'viz-read' });
  const trace = el('canvas', { className: 'viz-trace', width: 280, height: 90 });
  const traceNote = el('p', { className: 'viz-note' });
  const noSource = el('p', { className: 'viz-note', hidden: true, textContent: 'Add a “Biosignal source (body)” part to the circuit first — it is the body these electrodes are on.' });
  side.append(title, lead, noSource, chips, readout, trace, traceNote);
  pane.append(stage, side);
  canvas.append(pane);

  const source = () => editor.state.parts.find(p => PART_DEFS[p.type]?.spec?.behaviour?.kind === 'signal-source');
  let three = null, loading = null, timer = null, view = 'circuit';

  function place(key, id) {
    const p = source(); if (!p) return;
    const ids = { sp: p.sp, sn: p.sn, sr: p.sr }; ids[key] = id;
    // one electrode per site: moving onto a taken site sends the other one back to the tray
    for (const k of Object.keys(ids)) if (k !== key && id && ids[k] === id) editor.setPartProp(p.id, k, '', { commit: false });
    editor.setPartProp(p.id, key, id, { commit: true });
    paint();
  }

  function paint() {
    const p = source();
    noSource.hidden = !!p;
    for (const [key] of ELECTRODES) selects[key].value = p?.[key] || '';
    selects.sp.disabled = selects.sn.disabled = selects.sr.disabled = !p;
    readout.textContent = describeMontage(p?.sp, p?.sn, p?.sr);
    three?.mark(p);
    drawTrace();
  }

  function drawTrace() {
    const p = source(), c = trace.getContext('2d'), w = trace.width, h = trace.height;
    c.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    c.strokeStyle = css.getPropertyValue('--line') || '#ccd'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
    if (!p) return;
    const now = performance.now() / 1000, span = 4, n = 280, vs = [];
    let peak = 1e-5;
    for (let i = 0; i < n; i++) { const v = signalAt(p, now - span + (i / n) * span); vs.push(v); peak = Math.max(peak, Math.abs(v)); }
    c.strokeStyle = '#1b7f5a'; c.lineWidth = 1.5; c.beginPath();
    vs.forEach((v, i) => { const x = (i / (n - 1)) * w, y = h / 2 - (v / peak) * (h / 2 - 6); i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.stroke();
    const unit = peak >= 1e-3 ? `${(peak * 1e3).toFixed(1)} mV` : `${(peak * 1e6).toFixed(0)} µV`;
    traceNote.textContent = `Signal between E+ and E− over the last 4 s (peak ≈ ${unit}).`;
  }

  /* ── the 3D head ─────────────────────── */
  async function load3d() {
    if (three || loading) return loading;
    loading = (async () => {
      try {
        const THREE = await import('three');
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
        camera.up.set(0, 0, 1);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.5));
        const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(2, 4, 5); scene.add(sun);

        const head = new THREE.Group();
        const skin = new THREE.MeshStandardMaterial({ color: 0xe3b89c, roughness: 0.75 });
        const R = HEAD_RADII;
        const skullGeo = new THREE.SphereGeometry(1, 64, 48); skullGeo.rotateX(Math.PI / 2);      // poles on the head's z axis (crown)
        const skull = new THREE.Mesh(skullGeo, skin); skull.scale.set(R.x, R.y, R.z); head.add(skull);
        const nose = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 24), skin); nose.rotation.x = -Math.PI / 2; nose.position.set(0, R.y + 0.06, -0.12); head.add(nose);
        const jaw = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), skin); jaw.scale.set(0.58, 0.7, 0.55); jaw.position.set(0, 0.22, -0.78); head.add(jaw);
        for (const sx of [-1, 1]) {
          const ear = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), skin); ear.scale.set(0.05, 0.16, 0.22); ear.position.set(sx * (R.x + 0.02), -0.02, -0.08); head.add(ear);
          const eye = new THREE.Mesh(new THREE.SphereGeometry(0.085, 20, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 })); const ep = surfacePoint(95, sx * 20); eye.position.set(ep.x * 0.98, ep.y * 0.98, ep.z * 0.98); head.add(eye);
          const iris = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 12), new THREE.MeshStandardMaterial({ color: 0x3b2a20 })); iris.position.set(ep.x * 0.98 + sx * 0.0, ep.y * 1.0 + 0.07, ep.z * 0.98); head.add(iris);
        }
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.7, 24), skin); neck.rotation.x = Math.PI / 2; neck.position.set(0, -0.12, -1.05); head.add(neck);
        scene.add(head);

        const dots = new Map(), dotGeo = new THREE.SphereGeometry(1, 14, 10);
        for (const s of SITES) {
          const m = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: GROUP_COLOR[s.group] }));
          const p = surfacePoint(s.theta, s.phi), k = 1.012;
          m.position.set(p.x * k, p.y * k, p.z * k); m.scale.setScalar(0.03); head.add(m); dots.set(s.id, m);
        }
        const tags = new Map();
        const tag = (key, label, color) => { const n = el('div', { className: 'viz-tag', textContent: label }); n.style.background = color; n.hidden = true; labels.append(n); tags.set(key, n); };
        for (const [key, label, color] of ELECTRODES) tag(key, label, color);

        let yaw = 0.0, pitch = 0.18, dist = 4.4;
        const size = () => { const w = stage.clientWidth || 420, h = stage.clientHeight || 360; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
        const tmp = new THREE.Vector3();
        const project = (id) => {
          const m = dots.get(id); if (!m) return null;
          tmp.copy(m.position).applyMatrix4(head.matrixWorld);
          const front = tmp.clone().normalize().dot(camera.position.clone().sub(tmp).normalize()) > 0.05;
          const v = tmp.clone().project(camera);
          return { x: (v.x * 0.5 + 0.5) * (stage.clientWidth || 420), y: (-v.y * 0.5 + 0.5) * (stage.clientHeight || 360), front };
        };
        const frame = () => {
          head.rotation.set(0, 0, yaw);
          camera.position.set(0, dist * Math.cos(pitch), dist * Math.sin(pitch) + 0.1); camera.lookAt(0, 0, 0);
          head.updateMatrixWorld(); camera.updateMatrixWorld();
          renderer.render(scene, camera);
          const p = source();
          for (const [key] of ELECTRODES) {
            const t = tags.get(key), id = p?.[key], pr = id ? project(id) : null;
            t.hidden = !(pr && pr.front);
            if (!t.hidden) t.style.transform = `translate(${pr.x}px, ${pr.y}px) translate(-50%, -140%)`;
          }
        };
        let queued = false;
        const draw = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; frame(); }); };
        const mark = p => {
          const used = new Map(ELECTRODES.map(([k, , c]) => [p?.[k], c]).filter(([id]) => id));
          for (const [id, m] of dots) {
            const c = used.get(id);
            m.material.color.set(c || GROUP_COLOR[SITE[id].group]); m.scale.setScalar(c ? 0.062 : 0.03);
          }
          draw();
        };

        // turn the head: drag on empty space
        let last = null;
        stage.addEventListener('pointerdown', e => { if (e.target.closest('.viz-tag')) return; last = { x: e.clientX, y: e.clientY }; stage.setPointerCapture?.(e.pointerId); stage.classList.add('dragging'); });
        stage.addEventListener('pointermove', e => { if (!last) return; yaw += (e.clientX - last.x) * 0.01; pitch = Math.max(-0.6, Math.min(1.2, pitch + (e.clientY - last.y) * 0.008)); last = { x: e.clientX, y: e.clientY }; draw(); });
        const end = () => { last = null; stage.classList.remove('dragging'); };
        stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
        stage.addEventListener('wheel', e => { e.preventDefault(); dist = Math.max(2.6, Math.min(8, dist + e.deltaY * 0.004)); draw(); }, { passive: false });

        // the site nearest to a screen point (front-facing only), for dropping an electrode
        const siteAt = (cx, cy) => {
          const r = stage.getBoundingClientRect(); let best = null, bd = 34;
          head.updateMatrixWorld(); camera.updateMatrixWorld();
          for (const s of SITES) { const pr = project(s.id); if (!pr?.front) continue; const d = Math.hypot(pr.x - (cx - r.left), pr.y - (cy - r.top)); if (d < bd) { bd = d; best = s.id; } }
          return best;
        };
        stage.prepend(renderer.domElement); hintEl.hidden = true;
        three = { mark, size, draw, siteAt, turn: (y, p) => { yaw = y; pitch = p; draw(); } };
        size();
        return three;
      } catch (err) {
        hintEl.textContent = '3D view isn’t available in this browser — use the lists on the right.';
        return null;
      } finally { loading = null; }
    })();
    return loading;
  }

  // drag an electrode chip onto the head
  let drag = null;
  chips.addEventListener('pointerdown', e => {
    const chip = e.target.closest('.viz-chip'); if (!chip) return;
    const ghost = el('div', { className: 'viz-chip viz-ghost', textContent: chip.textContent }); ghost.style.background = chip.style.background;
    document.body.append(ghost); drag = { key: chip.dataset.key, ghost };
    ghost.style.left = `${e.clientX}px`; ghost.style.top = `${e.clientY}px`; chip.setPointerCapture?.(e.pointerId); e.preventDefault();
  });
  chips.addEventListener('pointermove', e => { if (drag) { drag.ghost.style.left = `${e.clientX}px`; drag.ghost.style.top = `${e.clientY}px`; } });
  const drop = e => {
    if (!drag) return;
    const { key, ghost } = drag; drag = null; ghost.remove();
    const r = stage.getBoundingClientRect();
    if (e.type === 'pointerup' && three && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      const id = three.siteAt(e.clientX, e.clientY);
      if (id) place(key, id); else editor.status?.('Drop the electrode on one of the dots on the head.');
    }
  };
  chips.addEventListener('pointerup', drop); chips.addEventListener('pointercancel', drop);

  /* ── switching views ─────────────────── */
  async function show(v) {
    view = v;
    const viz = v === 'viz';
    bCircuit.classList.toggle('on', !viz); bViz.classList.toggle('on', viz);
    bCircuit.setAttribute('aria-pressed', String(!viz)); bViz.setAttribute('aria-pressed', String(viz));
    pane.hidden = !viz;
    clearInterval(timer);
    if (viz) {
      paint(); await load3d(); three?.size(); three?.mark(source());
      timer = setInterval(drawTrace, 80);
    }
  }
  bCircuit.addEventListener('click', () => show('circuit')); bViz.addEventListener('click', () => show('viz'));
  addEventListener('resize', () => { if (view === 'viz') { three?.size(); three?.draw(); } });

  /** Only workspaces that ask for it (Bioelectronics) get the toggle; elsewhere the circuit editor is the only view. */
  function sync() {
    const on = !!activeWorkspace().visualizer;
    toggle.hidden = !on; sepAfter.hidden = !on;
    if (!on && view === 'viz') show('circuit');
    if (on && !bCircuit.classList.contains('on') && !bViz.classList.contains('on')) bCircuit.classList.add('on');
  }
  editor.on('catalog', sync);
  editor.on('workspace', () => { if (view === 'viz') paint(); });
  sync();
  return { show, paint, sync, source };
}
