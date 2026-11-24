// The Visualizer (Bioelectronics workspace): a 3D head you put electrodes on. Every amplifier in the circuit (each BioAmp
// EXG Pill, or the body-source block) is a CHANNEL with its own E+ and E−: drag them onto marked sites on the head, or pick
// the sites from the lists, and the signal that channel's amplifier receives follows where they are. One reference
// electrode is shared by all channels, as on a real headset. three.js loads the first time this opens.
//
// Head: "3D human head scan" by celer (Thingiverse thing 4245056), CC BY — see ATTRIBUTION.md. If it cannot load, a plain
// head drawn in code is used instead. Signals are illustrative, not medical data.
import { joinViews } from './view-groups.js';
import { SITES, SITE, SITE_GROUPS, HEAD_RADII, surfacePoint, sitePosition, describeMontage } from '../core/body-sites.js';
import { bodyChannels } from '../core/mix-context.js';
import { bodyState } from './body-state.js';
import { signalAt } from '../core/signals.js';
import { subject as person, EVENT_KINDS, MINDS, LIMB_EVENTS } from '../core/subject.js';
import { PART_DEFS } from '../core/parts.js';
import { activeWorkspace } from '../core/workspaces.js';

const headUrl = new URL('../assets/head.glb', import.meta.url).href;
const GROUP_COLOR = { EEG: 0x7a8f86, EOG: 0xc7863a, EMG: 0xa65d8c, Reference: 0x8d9a95, 'Arm EMG': 0xa65d8c, 'Chest ECG': 0xc0392b };
const ALL_GROUPS = ['EEG', 'EOG', 'EMG', 'Arm EMG', 'Chest ECG', 'Reference'];
const REF_COLOR = '#27a560';
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const hue = i => (i * 47 + 8) % 360;
const colorOf = (i, key) => (key === 'sr' ? REF_COLOR : `hsl(${hue(i)} ${key === 'sp' ? '72% 46%' : '62% 30%'})`);

/** The parts that can sit on the body: body-source blocks and amplifiers that take electrode sites. */
export const channelParts = bodyChannels;

export function initVisualizer({ editor }) {
  const canvas = document.getElementById('canvas'), toolbar = document.querySelector('.toolbar');
  const toggle = el('div', { className: 'view-toggle solo-tab', role: 'group', ariaLabel: 'View', hidden: true });
  const bCircuit = el('button', { type: 'button', textContent: 'Circuit' }), bViz = el('button', { type: 'button', textContent: 'Visualizer' });
  bCircuit.dataset.circuitTab = '1'; toggle.append(bCircuit, bViz);
  const sepAfter = el('span', { className: 'sep solo-sep', hidden: true });
  toolbar.prepend(toggle, sepAfter);

  const pane = el('div', { className: 'viz-pane', hidden: true });
  const stage = el('div', { className: 'viz-stage' });
  const hintEl = el('div', { className: 'viz-hint', textContent: 'Loading the 3D head…' });
  const labels = el('div', { className: 'viz-labels' });
  const hoverEl = el('div', { className: 'viz-hover' });
  const credit = el('a', { className: 'viz-credit', href: 'https://www.thingiverse.com/thing:4245056', target: '_blank', rel: 'noopener', textContent: 'Head scan by celer · CC BY' });
  const frameBar = el('div', { className: 'viz-frame', role: 'group', ariaLabel: 'What to show' }), bHead = el('button', { type: 'button', textContent: 'Head', id: 'vizFrame-head' }), bBody = el('button', { type: 'button', textContent: 'Whole body', id: 'vizFrame-body' });
  frameBar.append(bHead, bBody);
  stage.append(hintEl, labels, hoverEl, credit, frameBar);

  const side = el('div', { className: 'viz-side' });
  for (const t of ['wheel', 'touchmove']) side.addEventListener(t, e => e.stopPropagation(), { passive: true });   // the bench underneath zooms on the wheel and would swallow the scrolling of this panel
  const lead = el('p', { className: 'viz-note', textContent: 'Each amplifier is a channel. Drag its E+ and E− onto the head, or choose sites from the lists. Illustrative signals — not medical data.' });
  const refSel = siteSelect('Shared reference electrode', ['Reference', 'EEG']);
  const refRow = el('label', { className: 'viz-ref' }, el('span', { textContent: 'Shared REF' }), refSel);
  const subject = el('details', { className: 'viz-subject' });
  const sliders = {};
  subject.append(el('summary', { textContent: 'Subject settings' }));
  for (const [k, label, min, max, step, fmt] of [['effort', 'Muscle effort', 0, 100, 1, v => `${v} %`], ['contact', 'Electrode contact resistance', 1, 100, 1, v => `${v} kΩ`], ['hum', 'Mains hum (50 Hz)', 0, 100, 1, v => `${v} %`]]) {
    const inp = el('input', { type: 'range', min, max, step }), out = el('output');
    inp.addEventListener('input', () => { out.textContent = fmt(inp.value); setAll(k, +inp.value, false); });
    inp.addEventListener('change', () => editor.commit());
    sliders[k] = { inp, out, fmt };
    subject.append(el('label', { className: 'viz-slider' }, el('span', { textContent: label }), inp, out));
  }

  // What the simulated person does: mind state, where they look, one-off events. Which channel reacts depends on where its electrodes are.
  const events = el('div', { className: 'viz-events', id: 'vizEvents' });
  const group = (title, ...kids) => el('div', { className: 'viz-evgroup' }, el('span', { className: 'viz-evtitle', textContent: title }), el('div', { className: 'viz-evrow' }, ...kids));
  const evBtn = (label, fn, title, id) => { const b = el('button', { type: 'button', className: 'viz-evbtn', textContent: label, title: title || label, id }); b.addEventListener('click', () => { fn(); markState(); }); return b; };
  const tag = (b, key, val) => { b.dataset[key] = val; return b; };
  const mindBtns = Object.entries(MINDS).map(([k, label]) => tag(evBtn(label.split(',')[0], () => person.setMind(k), label, `vizMind-${k}`), 'mind', k));
  const gazeBtns = [['◀', 'left', 'Look left'], ['▲', 'up', 'Look up'], ['●', 'center', 'Look straight ahead'], ['▼', 'down', 'Look down'], ['▶', 'right', 'Look right'], ['Auto', 'auto', 'Glance about on its own']].map(([l, k, t]) => tag(evBtn(l, () => person.look(k), t, `vizGaze-${k}`), 'gaze', k));
  const autoBlink = el('input', { type: 'checkbox', checked: true, id: 'vizAutoBlink' }); autoBlink.addEventListener('change', () => { person.autoBlink = autoBlink.checked; });
  events.append(
    group('Mind', ...mindBtns), group('Eyes', ...gazeBtns, evBtn('Blink', () => person.fire('blink'), 'One blink', 'vizEv-blink')),
    el('label', { className: 'viz-check' }, autoBlink, el('span', { textContent: 'Random blinks' })),
    group('Face', ...['jaw', 'twitchL', 'twitchR', 'brow'].map(k => evBtn(EVENT_KINDS[k].label, () => person.fire(k), EVENT_KINDS[k].label, `vizEv-${k}`))),
    group('Arms (hold on)', ...LIMB_EVENTS.map(k => tag(evBtn(EVENT_KINDS[k].label, () => person.hold(k), `${EVENT_KINDS[k].label}: click to hold, click again to let go`, `vizHold-${k}`), 'hold', k)), evBtn('Rest', () => { person.holds = []; }, 'Let go of every held muscle', 'vizHold-rest')),
    el('p', { className: 'viz-note', textContent: 'Try it: put E+ and E− on the biceps and elbow of the Whole body view and hold Flex right arm; put them on the cheeks and clench the jaw; on the eye corners and look left or right; on the back of the head and switch between Relaxed and Focused. The same event barely shows at electrodes that are far from the muscle or eye involved.' }));
  const holdBtns = () => [...events.querySelectorAll('[data-hold]')];
  const markState = () => { for (const b of holdBtns()) b.classList.toggle('on', person.holds.includes(b.dataset.hold)); for (const b of mindBtns) b.classList.toggle('on', b.dataset.mind === person.mind); for (const b of gazeBtns) b.classList.toggle('on', b.dataset.gaze === (person.gaze?.to || 'auto')); autoBlink.checked = person.autoBlink !== false; };
  markState();
  const channelsEl = el('div', { className: 'viz-channels' });
  const noChannels = el('p', { className: 'viz-note', hidden: true, textContent: 'Add a BioAmp EXG Pill (or a “Biosignal source (body)”) to the circuit — each one becomes a channel here.' });
  const trace = el('canvas', { className: 'viz-trace' });
  const traceNote = el('p', { className: 'viz-note' });
  side.append(lead, noChannels, refRow, channelsEl, events, subject, trace, traceNote);
  pane.append(stage, side);
  canvas.append(pane);

  function siteSelect(label, groups = SITE_GROUPS) {
    const sel = el('select', { ariaLabel: label });
    sel.append(el('option', { value: '', textContent: '— not placed —' }));
    groups = groups.flatMap(g => (g === 'EMG' ? ['EMG', 'Arm EMG'] : [g]));
    for (const g of groups) {
      const og = el('optgroup', { label: g });
      for (const s of SITES.filter(x => x.group === g)) og.append(el('option', { value: s.id, textContent: s.name }));
      sel.append(og);
    }
    return sel;
  }

  let three = null, loading = null, timer = null, anim = null, view = 'circuit', cards = [], pickedFrame = false;
  const channels = () => channelParts(editor.state.parts);
  const nameOf = (p, i) => `${PART_DEFS[p.type].label || PART_DEFS[p.type].name || 'Channel'} ${i + 1}`;

  function setAll(key, value, commit) {
    for (const p of channels()) editor.setPartProp(p.id, key, value, { commit: false });
    if (commit) editor.commit();
  }

  /** Put electrode `key` (sp / sn / sr) of one channel on a site. E+ and E− are physical, so they cannot share a site; the reference can. */
  function place(partId, key, id) {
    const p = editor.partById(partId); if (!p) return;
    if (id && key !== 'sr') {
      for (const q of channels()) for (const k of ['sp', 'sn']) if (q[k] === id && !(q.id === partId && k === key)) editor.setPartProp(q.id, k, '', { commit: false });
    }
    editor.setPartProp(partId, key, id, { commit: true });
    if (id && three && SITE[id]?.frame !== three.mode) three.setMode(SITE[id].frame);        // a site on the other model: show that model
    paint();
  }
  function placeRef(id) { for (const p of channels()) editor.setPartProp(p.id, 'sr', id, { commit: false }); editor.commit(); paint(); }

  /* ── the channel list (rebuilt when the circuit's amplifiers change) ── */
  let built = '';
  function buildCards() {
    const list = channels(), sig = list.map(p => p.id).join(',');
    if (sig === built) return; built = sig;
    channelsEl.replaceChildren(); cards = [];
    list.forEach((p, i) => {
      const card = el('div', { className: 'viz-card' }), sels = {};
      card.append(el('b', { textContent: nameOf(p, i) }));
      for (const [key, label] of [['sp', 'E+'], ['sn', 'E−']]) {
        const chip = el('div', { className: 'viz-chip', textContent: `${i + 1}${label.replace('E', '')}`, title: `Drag ${label} of ${nameOf(p, i)} onto the head` });
        chip.style.background = colorOf(i, key); chip.dataset.part = p.id; chip.dataset.key = key;
        const sel = siteSelect(`${label} site, ${nameOf(p, i)}`, ['EEG', 'EOG', 'EMG', 'Chest ECG', 'Reference']);
        sel.addEventListener('change', () => place(p.id, key, sel.value));
        sels[key] = sel; card.append(el('div', { className: 'viz-row' }, chip, sel));
      }
      channelsEl.append(card); cards.push({ id: p.id, i, sels });
    });
  }

  function paint() {
    buildCards(); markState();
    const list = channels();
    noChannels.hidden = list.length > 0; refRow.hidden = subject.hidden = !list.length;
    for (const c of cards) { const p = editor.partById(c.id); if (!p) continue; for (const k of ['sp', 'sn']) c.sels[k].value = p[k] || ''; }
    refSel.value = list.find(p => p.sr)?.sr || '';
    const f = list[0] || {};
    for (const [k, s] of Object.entries(sliders)) { if (document.activeElement !== s.inp) s.inp.value = String(f[k] ?? { effort: 50, contact: 5, hum: 0 }[k]); s.out.textContent = s.fmt(s.inp.value); }
    three?.mark(list);
    drawTrace();
  }
  refSel.addEventListener('change', () => placeRef(refSel.value));

  function drawTrace() {
    const list = channels(), rowH = 34, w = 300, h = Math.max(rowH, list.length * rowH);
    if (trace.width !== w || trace.height !== h) { trace.width = w; trace.height = h; trace.style.height = `${h}px`; }
    const c = trace.getContext('2d'); c.clearRect(0, 0, w, h);
    if (!list.length) { traceNote.textContent = ''; return; }
    const now = person.now(), span = 4, n = 240;
    list.forEach((p, i) => {
      const y0 = i * rowH + rowH / 2, placed = p.sp && p.sn;
      c.strokeStyle = 'rgba(120,140,130,.35)'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, y0); c.lineTo(w, y0); c.stroke();
      c.fillStyle = colorOf(i, 'sp'); c.font = '600 10px system-ui, sans-serif'; c.fillText(String(i + 1), 3, i * rowH + 11);
      if (!placed) { c.fillStyle = '#8d9a95'; c.fillText('place E+ and E−', 18, y0 + 3); return; }
      const vs = []; let peak = 2e-5;
      for (let k = 0; k < n; k++) { const v = signalAt(p, now - span + (k / n) * span); vs.push(v); peak = Math.max(peak, Math.abs(v)); }
      c.strokeStyle = colorOf(i, 'sp'); c.lineWidth = 1.3; c.beginPath();
      vs.forEach((v, k) => { const x = 24 + (k / (n - 1)) * (w - 24), y = y0 - (v / peak) * (rowH / 2 - 4); k ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.stroke();
      c.fillStyle = '#6a7871'; c.textAlign = 'right'; c.fillText(peak >= 1e-3 ? `${(peak * 1e3).toFixed(1)} mV` : `${Math.round(peak * 1e6)} µV`, w - 2, i * rowH + 11); c.textAlign = 'left';
    });
    const first = list.find(p => p.sp && p.sn);
    traceNote.textContent = first ? `Last 4 s of each channel, each scaled to its own peak. ${describeMontage(first.sp, first.sn, first.sr)}` : 'Place a channel’s E+ and E− to see its signal.';
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
        const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
        camera.up.set(0, 0, 1);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.5));
        const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(2, 4, 5); scene.add(sun);

        const head = new THREE.Group();
        const skin = new THREE.MeshStandardMaterial({ color: 0xe3b89c, roughness: 0.8, metalness: 0 });
        let scan = false;
        try {
          const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
          const gltf = await new GLTFLoader().loadAsync(headUrl);
          gltf.scene.traverse(o => { if (o.isMesh) { o.material = skin; if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); } });
          head.add(gltf.scene); scan = true;      // the file is already in head units: x right, y nose, z up
        } catch { /* fall back to the plain head below */ }
        if (!scan) {
          const R = HEAD_RADII;
          const skullGeo = new THREE.SphereGeometry(1, 64, 48); skullGeo.rotateX(Math.PI / 2);
          const skull = new THREE.Mesh(skullGeo, skin); skull.scale.set(R.x, R.y, R.z); head.add(skull);
          const nose = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 24), skin); nose.rotation.x = -Math.PI / 2; nose.position.set(0, R.y + 0.06, -0.12); head.add(nose);
          for (const sx of [-1, 1]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), skin); ear.scale.set(0.05, 0.16, 0.22); ear.position.set(sx * (R.x + 0.02), -0.02, -0.08); head.add(ear); }
        }
        scene.add(head);

        const dots = new Map(), dotGeo = new THREE.SphereGeometry(1, 14, 10), outward = new THREE.Vector3();
        let mode = 'head', bodyRig = null, bodyG = null, bodyLoading = null, yawB = 0.4, distB = 23, panB = 10.2;
        for (const s of SITES.filter(x => x.frame === 'head')) {
          const m = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: GROUP_COLOR[s.group] }));
          const p = sitePosition(s.id); outward.set(p.x, p.y, p.z);
          m.position.set(p.x, p.y, p.z).add(outward.clone().normalize().multiplyScalar(0.012)); m.scale.setScalar(0.03); head.add(m); dots.set(s.id, m);
        }
        const tags = new Map();

        let yaw = 0.35, pitch = 0.1, dist = 7.2, panZ = -0.2;
        const size = () => { const w = stage.clientWidth || 420, h = stage.clientHeight || 360; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
        const tmp = new THREE.Vector3();
        // which way a body site faces (in the body's own frame): used to hide the labels of sites on the far side
        const faces = id => (/^(tricep|extensor|elbow|wrist)/.test(id) ? [0, -1, 0] : /^delt/.test(id) ? [0, 0, 1] : [0, 1, 0]);
        const project = id => {
          const m = dots.get(id); if (!m || SITE[id].frame !== mode) return null;
          const isBody = SITE[id].frame === 'body';
          tmp.copy(m.position).applyMatrix4((isBody ? bodyG : head).matrixWorld);
          let front;
          if (isBody) { const n = faces(id), c = Math.cos(yawB), sn = Math.sin(yawB), w = new THREE.Vector3(n[0] * c - n[1] * sn, n[0] * sn + n[1] * c, n[2]); front = w.dot(camera.position.clone().sub(tmp).normalize()) > -0.1; }
          else front = tmp.clone().normalize().dot(camera.position.clone().sub(tmp).normalize()) > 0.08;
          const v = tmp.clone().project(camera);
          return { x: (v.x * 0.5 + 0.5) * (stage.clientWidth || 420), y: (-v.y * 0.5 + 0.5) * (stage.clientHeight || 360), front };
        };
        let current = [];
        const frame = () => {
          if (mode === 'body' && bodyG) {
            bodyG.rotation.set(0, 0, yawB);
            const wide = Math.max(1, Math.sqrt(1 / camera.aspect)), dB = distB * wide;       // a narrow pane (split view) backs the camera off so nothing is cropped
            camera.position.set(0, dB * Math.cos(pitch), dB * Math.sin(pitch) + panB); camera.lookAt(0, 0, panB);
            bodyG.updateMatrixWorld(); camera.updateMatrixWorld();
            for (const [id, m] of dots) if (SITE[id].frame === 'body') { const q = bodyRig.sitePoint(id); if (q) m.position.set(q[0], q[1], q[2]); }
          } else {
            head.rotation.set(0, 0, yaw);
            const dH = dist * Math.max(1, Math.sqrt(1 / camera.aspect));
            camera.position.set(0, dH * Math.cos(pitch), dH * Math.sin(pitch) + panZ); camera.lookAt(0, 0, panZ);
            head.updateMatrixWorld(); camera.updateMatrixWorld();
          }
          renderer.render(scene, camera);
          for (const [tkey, t] of tags) {
            const [pid, key] = tkey.split('|'), p = current.find(q => q.id === pid), id = p?.[key], pr = id ? project(id) : null;
            t.hidden = !(pr && pr.front);
            if (!t.hidden) t.style.transform = `translate(${pr.x}px, ${pr.y}px) translate(-50%, -135%)`;
          }
        };
        let queued = false;
        const draw = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; frame(); }); };
        const mark = list => {
          current = list;
          const used = new Map(), want = new Set();
          list.forEach((p, i) => {
            for (const key of ['sp', 'sn']) if (p[key]) { used.set(p[key], colorOf(i, key)); want.add(`${p.id}|${key}`);
              if (!tags.has(`${p.id}|${key}`)) { const n = el('div', { className: 'viz-tag' }); n.hidden = true; labels.append(n); tags.set(`${p.id}|${key}`, n); }
              const t = tags.get(`${p.id}|${key}`); t.textContent = `${i + 1}${key === 'sp' ? '+' : '−'}`; t.style.background = colorOf(i, key); }
            if (p.sr) { used.set(p.sr, used.get(p.sr) || REF_COLOR); if (i === 0) { want.add(`${p.id}|sr`); if (!tags.has(`${p.id}|sr`)) { const n = el('div', { className: 'viz-tag', textContent: 'REF' }); n.hidden = true; labels.append(n); tags.set(`${p.id}|sr`, n); } tags.get(`${p.id}|sr`).style.background = REF_COLOR; } }
          });
          for (const [k, t] of [...tags]) if (!want.has(k)) { t.remove(); tags.delete(k); }
          for (const [id, m] of dots) { const c = used.get(id), b = SITE[id].frame === 'body'; m.material.color.set(c || GROUP_COLOR[SITE[id].group]); m.scale.setScalar(b ? (c ? 0.2 : 0.11) : (c ? 0.05 : 0.026)); }
          draw();
        };

        // turn the head: drag on empty space. Wheel zooms. Hover names the nearest site.
        let last = null;
        stage.addEventListener('pointerdown', e => { if (e.target.closest?.('.viz-frame, .viz-credit')) return; last = { x: e.clientX, y: e.clientY }; stage.setPointerCapture?.(e.pointerId); stage.classList.add('dragging'); });
        stage.addEventListener('pointermove', e => {
          if (last) { if (mode === 'body') yawB += (e.clientX - last.x) * 0.01; else yaw += (e.clientX - last.x) * 0.01; pitch = Math.max(-0.7, Math.min(1.3, pitch + (e.clientY - last.y) * 0.008)); last = { x: e.clientX, y: e.clientY }; draw(); return; }
          const id = siteAt(e.clientX, e.clientY); hoverEl.textContent = id ? SITE[id].name : '';
        });
        const end = () => { last = null; stage.classList.remove('dragging'); };
        stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
        stage.addEventListener('pointerleave', () => { hoverEl.textContent = ''; });
        stage.addEventListener('wheel', e => { e.preventDefault(); if (mode === 'body') distB = Math.max(6, Math.min(32, distB + e.deltaY * 0.02)); else dist = Math.max(2.8, Math.min(9, dist + e.deltaY * 0.004)); draw(); }, { passive: false });

        const siteAt = (cx, cy) => {
          const r = stage.getBoundingClientRect(); let best = null, bd = 30;
          head.updateMatrixWorld(); camera.updateMatrixWorld();
          for (const s of SITES.filter(x => x.frame === mode)) { const pr = project(s.id); if (!pr?.front) continue; const d = Math.hypot(pr.x - (cx - r.left), pr.y - (cy - r.top)); if (d < bd) { bd = d; best = s.id; } }
          return best;
        };
        /** Switch between the head scan and the whole body. The body model loads the first time. */
        async function setMode(m) {
          if (m === 'body' && !bodyG) {
            if (!bodyLoading) bodyLoading = (async () => {
              hintEl.hidden = false; hintEl.textContent = 'Loading the body…';
              try {
                const { loadBodyRig } = await import('./body-rig.js'); bodyRig = await loadBodyRig(THREE); bodyG = bodyRig.group; scene.add(bodyG);
                for (const s of SITES.filter(x => x.frame === 'body')) { const mm = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: GROUP_COLOR[s.group] })); mm.scale.setScalar(0.11); bodyG.add(mm); dots.set(s.id, mm); }
              } catch { hintEl.textContent = 'The body model could not load; the head still works.'; bodyLoading = null; return; }
              hintEl.hidden = true;
            })();
            await bodyLoading; if (!bodyG) return;
          }
          mode = m === 'body' && bodyG ? 'body' : 'head'; head.visible = mode === 'head'; if (bodyG) bodyG.visible = mode === 'body';
          bHead.classList.toggle('on', mode === 'head'); bBody.classList.toggle('on', mode === 'body');
          credit.textContent = mode === 'body' ? 'Body: MakeHuman base mesh · CC0' : 'Head scan by celer · CC BY'; credit.href = mode === 'body' ? 'https://github.com/makehumancommunity/makehuman' : 'https://www.thingiverse.com/thing:4245056';
          mark(current); hoverEl.textContent = '';
        }
        /** Called ~30 times a second while the body is showing: bend the elbows and light the muscles to match what the person is doing. */
        const tick = () => { if (mode === 'body' && bodyRig && bodyRig.setPose(bodyState.pose())) draw(); };
        stage.prepend(renderer.domElement); hintEl.hidden = true;
        three = { mark, size, draw, siteAt, scan, setMode, tick, get mode() { return mode; }, turn: (y, p) => { yaw = y; pitch = p; draw(); } };
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
  channelsEl.addEventListener('pointerdown', e => {
    const chip = e.target.closest('.viz-chip'); if (!chip) return;
    const ghost = el('div', { className: 'viz-chip viz-ghost', textContent: chip.textContent }); ghost.style.background = chip.style.background;
    document.body.append(ghost); drag = { part: chip.dataset.part, key: chip.dataset.key, ghost };
    ghost.style.left = `${e.clientX}px`; ghost.style.top = `${e.clientY}px`; chip.setPointerCapture?.(e.pointerId); e.preventDefault();
  });
  channelsEl.addEventListener('pointermove', e => { if (drag) { drag.ghost.style.left = `${e.clientX}px`; drag.ghost.style.top = `${e.clientY}px`; } });
  const drop = e => {
    if (!drag) return;
    const { part, key, ghost } = drag; drag = null; ghost.remove();
    const r = stage.getBoundingClientRect();
    if (e.type === 'pointerup' && three && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      const id = three.siteAt(e.clientX, e.clientY);
      if (id) place(part, key, id); else editor.status?.('Drop the electrode on one of the dots on the head.');
    }
  };
  channelsEl.addEventListener('pointerup', drop); channelsEl.addEventListener('pointercancel', drop);

  /* ── switching views ─────────────────── */
  const claim = joinViews('viz', () => view, () => show('circuit'), { label: 'Visualizer', open: () => show('viz'), available: () => !toggle.hidden });
  async function show(v) {
    claim();
    view = v;
    const viz = v === 'viz';
    bCircuit.classList.toggle('on', !viz); bViz.classList.toggle('on', viz);
    bCircuit.setAttribute('aria-pressed', String(!viz)); bViz.setAttribute('aria-pressed', String(viz));
    pane.hidden = !viz; document.body.classList.toggle('viz-view', viz);          // the circuit's wires sit above this pane: hide them while it is open
    clearInterval(timer); clearInterval(anim);
    if (viz) {
      paint(); await load3d(); three?.size();
      if (three && !pickedFrame) await three.setMode(channels().some(p => [p.sp, p.sn].some(id => SITE[id]?.frame === 'body')) ? 'body' : 'head');       // open on the model the electrodes are on
      three?.mark(channels());
      timer = setInterval(drawTrace, 80); anim = setInterval(() => three?.tick(), 33);
    }
  }
  bCircuit.addEventListener('click', () => show('circuit')); bViz.addEventListener('click', () => show('viz'));
  for (const [b, m] of [[bHead, 'head'], [bBody, 'body']]) b.addEventListener('click', async () => { pickedFrame = true; await load3d(); await three?.setMode(m); });
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
  return { show, paint, sync, channels };
}
