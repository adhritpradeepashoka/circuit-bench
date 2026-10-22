import { PART_DEFS, boardSVGMarkup } from '../core/parts.js';
import { allPinsWorld, partBounds, pinWorld, partSize, placeFlex } from '../core/geometry.js';
import { findSnap, applySnap, boardHoles, holeAt, occupiedHoles, SNAP_RADIUS } from '../core/snap.js';
import { compile, pkey, splitKey } from '../core/netlist.js';
import { SKINS, visualTarget } from '../parts/skins.js';
import { isMcuBoard, boardPowerPin } from '../core/boards.js';
import { wireGeometry, paramFromHandle } from '../core/wirepath.js';
import { wireArt, resolveWireKind, DEFAULT_WIRE_KIND, LEGACY_WIRE_KIND, WIRE_KINDS, WIRE_KIND_ICONS, WIRE_KIND_ORDER } from '../core/wire-kinds.js';
import { snapshot, restore, toProjectFile, fromProjectFile } from '../core/project.js';
import { CONTROLS, SETTINGS, partLabel } from '../core/controls.js';

export const DRAG_MIME = 'application/x-virtual-lab-part';
const STORAGE_KEY = 'virtual-lab:v0.1:workspace';
const GRID = 4.8;                 // half a breadboard pitch
const MIN_Z = 0.2, MAX_Z = 4;
const $ = id => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const uid = p => `${p}-${Math.random().toString(36).slice(2, 7)}`;

/** DOM model for a part — the real @wokwi/elements web component, or our own breadboard SVG. */
// The resistor's visual: the Wokwi resistor body (a 38 px capsule, clipped out of the element) with our own leads drawn from
// each body end to the two lead points, so it can be any length ≥ the body. Element geometry (px): width 59.13, body centred at 29.57.
const RES_BODY_W = 38.6, RES_EL_CENTER = 29.57;
export function layoutResistor(root, len) {
  const h = PART_DEFS.resistor.h, mid = len / 2, half = RES_BODY_W / 2;
  root.style.width = `${len}px`; root.style.height = `${h}px`;
  const svg = root.querySelector('.res-leads');
  svg.setAttribute('width', len); svg.setAttribute('height', h); svg.setAttribute('viewBox', `0 0 ${len} ${h}`);
  const [l1, l2] = svg.querySelectorAll('line');
  l1.setAttribute('x1', 0); l1.setAttribute('x2', mid - half + 1); l2.setAttribute('x1', mid + half - 1); l2.setAttribute('x2', len);
  for (const l of [l1, l2]) { l.setAttribute('y1', h / 2); l.setAttribute('y2', h / 2); }
  const body = root.querySelector('.res-body');
  body.style.left = `${mid - half}px`; body.style.width = `${RES_BODY_W}px`; body.style.height = `${h}px`;
  root._len = len;
}
function buildResistor(part) {
  const def = PART_DEFS.resistor, root = document.createElement('div');
  root.className = 'model res-model';
  root.innerHTML = '<svg class="res-leads"><line class="lead"/><line class="lead"/></svg><div class="res-body"></div>';
  const el = document.createElement(def.tag);
  el.setAttribute('value', String(part?.ohms ?? def.ohms));
  el.style.cssText = `position:absolute;top:0;left:${-(RES_EL_CENTER - RES_BODY_W / 2)}px`;
  root.querySelector('.res-body').append(el);
  layoutResistor(root, Math.max(def.minLen, part?.len ?? def.len));
  return root;
}

export function createModelElement(type, part = null) {
  const def = PART_DEFS[type];
  if (type === 'breadboard') {
    const d = document.createElement('div');
    d.className = 'model';
    d.innerHTML = boardSVGMarkup();
    d.firstElementChild.classList.add('bb');
    return d;
  }
  if (type === 'resistor') return buildResistor(part);
  const el = document.createElement(def.tag);
  if (def.skin) { el.classList.add('model'); SKINS[def.skin]?.init?.(el, part); return el; }       // a real @wokwi/elements part (native-parts.js)
  if (def.custom) { el.classList.add('model'); el.spec = def.spec; return el; }
  el.classList.add('model');
  if (type === 'led') el.setAttribute('color', part?.color || 'red');
  if (type === 'slide-switch') el.value = part?.pos ? 1 : 0;
  if (type === 'seven-segment') { el.setAttribute('color', '#ff3b30'); el.setAttribute('offColor', '#3a3a3a'); }
  if (type === 'resistor') el.setAttribute('value', String(part?.ohms ?? def.ohms));
  if (type === 'pushbutton') el.setAttribute('color', 'green');
  if (type === 'lcd1602') { el.setAttribute('pins', 'i2c'); el.backlight = false; el.characters = new Uint8Array(32).fill(32); }
  if (type === 'battery') el.volts = part?.volts ?? def.props.volts;
  return el;
}

const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const c = s => Math.round(((n >> s) & 255) * f).toString(16).padStart(2, '0');
  return `#${c(16)}${c(8)}${c(0)}`;
};

export class Editor {
  constructor() {
    this.canvas = $('canvas'); this.world = $('world'); this.layer = $('partsLayer'); this.overlay = $('overlay');
    this.state = { parts: [], wires: [] };
    this.view = { x: 0, y: 0, z: 1 };
    this.tool = 'select';
    this.sel = null;                  // { kind: 'part' | 'wire', id }
    this.els = new Map();             // part id → wrapper element
    this.handlers = {};
    this.circuit = null; this.circuitVersion = 0;
    this.hover = null; this.draft = null; this.snapMarks = []; this.handleDrag = null;
    this.gesture = null; this.spaceDown = false;
    this.running = false; this.probe = null;
    this.colorIndex = 0;
    this.hist = []; this.hi = -1;
    this.bind();
  }

  /* ── tiny event bus ─────────────────────────────────── */
  on(evt, fn) { (this.handlers[evt] ||= []).push(fn); return this; }
  emit(evt, data) { (this.handlers[evt] || []).forEach(fn => fn(data)); }
  status(text) { $('status').textContent = text; }

  /* ── lifecycle ──────────────────────────────────────── */
  init() {
    let loaded = false;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) { Object.assign(this.state, fromProjectFile(JSON.parse(saved))); loaded = true; }
    } catch { /* corrupt autosave: start fresh */ }
    if (!loaded) this.defaultWorkspace();
    this.syncParts();
    this.hist = [snapshot(this.state)]; this.hi = 0;
    this.fit();
    this.markDirty();
    this.afterStructureChange();
    this.status('Add an LED and a resistor from Parts, then wire them to the Arduino.');
  }

  /** A fresh canvas: the chosen board with a breadboard beside it. */
  defaultWorkspace(board = 'arduino-uno') {
    const type = PART_DEFS[board] && isMcuBoard(board) ? board : 'arduino-uno';
    const bbX = { 'arduino-uno': 360, 'arduino-nano': 300, 'arduino-mega': 470 }[type];
    this.state.parts = [
      { id: { 'arduino-uno': 'uno-1', 'arduino-nano': 'nano-1', 'arduino-mega': 'mega-1' }[type], type, x: 40, y: 56, rot: 0 },
      { id: 'bb-1', type: 'breadboard', x: bbX, y: 78, rot: 0 },
    ];
    this.state.wires = [];
  }

  newWorkspace(board) {
    this.sel = null; this.defaultWorkspace(board); this.syncParts();
    this.markDirty(); this.commit(); this.fit(); this.status('New workspace');
  }

  exportProject() { return toProjectFile(this.state); }
  /** Switch to another saved project: its circuit (or the default Uno + breadboard if it has none yet), with a fresh undo history. */
  openProject(data, { board } = {}) {
    if (data && Array.isArray(data.parts)) this.importProject(data); else this.newWorkspace(board);
    this.hist = [snapshot(this.state)]; this.hi = 0; this.afterStructureChange();
  }
  importProject(data) {
    const next = fromProjectFile(data);
    if (Array.isArray(data.customParts) && data.customParts.length) this.emit('catalog');      // the project brought its own parts
    this.state.parts = next.parts; this.state.wires = next.wires; this.sel = null;
    this.syncParts(); this.markDirty(); this.commit(); this.fit();
    this.status(`Opened project — ${next.parts.length} parts, ${next.wires.length} wires`);
  }

  /* ── model access ───────────────────────────────────── */
  partById(id) { return this.state.parts.find(p => p.id === id); }
  selectedPart() { return this.sel?.kind === 'part' ? this.partById(this.sel.id) : null; }
  selectedWire() { return this.sel?.kind === 'wire' ? this.state.wires.find(w => w.id === this.sel.id) : null; }

  getCircuit() {
    if (!this.circuit) { this.circuit = compile(this.state); this.circuit.version = ++this.circuitVersion; }
    return this.circuit;
  }
  markDirty() { this.circuit = null; this.emit('change'); }

  pinsOf(part) {
    const k = `${part.x}|${part.y}|${part.rot}|${part.len}`;
    if (!part._pc || part._pc.k !== k) part._pc = { k, pins: allPinsWorld(part) };
    return part._pc.pins;
  }
  anchor(ep) { const part = this.partById(ep.part); return part ? pinWorld(part, ep.pin) : null; }
  pinLabel(ep) { const part = this.partById(ep.part); return part ? PART_DEFS[part.type].pinById.get(ep.pin)?.label ?? ep.pin : '?'; }

  /* ── view ───────────────────────────────────────────── */
  toWorld(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - this.view.x) / this.view.z, y: (e.clientY - r.top - this.view.y) / this.view.z };
  }
  viewCenterWorld() {
    const r = this.canvas.getBoundingClientRect();
    return { x: (r.width / 2 - this.view.x) / this.view.z, y: (r.height / 2 - this.view.y) / this.view.z };
  }
  applyView() {
    const { x, y, z } = this.view;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    const s = this.canvas.style;
    s.setProperty('--gx', `${x}px`); s.setProperty('--gy', `${y}px`);
    s.setProperty('--gmajor', `${96 * z}px`);
    s.setProperty('--gminor', z * 9.6 >= 5 ? `${9.6 * z}px` : '0px');
    $('zoomFit').textContent = `${Math.round(z * 100)}%`;
    this.positionWireEditor();
  }
  zoomAt(f, cx, cy) {
    const z0 = this.view.z, z1 = clamp(z0 * f, MIN_Z, MAX_Z);
    this.view.x = cx - (cx - this.view.x) * (z1 / z0);
    this.view.y = cy - (cy - this.view.y) * (z1 / z0);
    this.view.z = z1;
    this.applyView(); this.renderOverlay();
  }
  zoomBy(f) { const r = this.canvas.getBoundingClientRect(); this.zoomAt(f, r.width / 2, r.height / 2); }
  fit() {
    const parts = this.state.parts;
    const cw = this.canvas.clientWidth || 900, ch = this.canvas.clientHeight || 600;
    if (!parts.length) { this.view = { x: cw / 2, y: ch / 2, z: 1 }; this.applyView(); this.renderOverlay(); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of parts) { const b = partBounds(p); x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
    const pad = 70, bw = x1 - x0, bh = y1 - y0;
    const z = clamp(Math.min((cw - pad * 2) / bw, (ch - pad * 2) / bh), 0.3, 1.6);
    this.view = { z, x: cw / 2 - ((x0 + x1) / 2) * z, y: ch / 2 - ((y0 + y1) / 2) * z };
    this.applyView(); this.renderOverlay();
  }

  /* ── DOM reconciliation ─────────────────────────────── */
  syncParts() {
    const ids = new Set(this.state.parts.map(p => p.id));
    for (const [id, el] of this.els) if (!ids.has(id)) { el.remove(); this.els.delete(id); }
    for (const p of this.state.parts) {
      if (this.els.has(p.id)) continue;
      const def = PART_DEFS[p.type];
      const el = document.createElement('div');
      el.className = `part part-${p.type}`;
      el.dataset.id = p.id;
      const size = partSize(p);
      el.style.width = `${size.w}px`; el.style.height = `${size.h}px`;
      // stacking: breadboard at the bottom, a board beside it, a board that plugs in (Nano) on it, every other part on top
      el.style.setProperty('--z', p.type === 'breadboard' ? 1 : isMcuBoard(p.type) ? (def.insertable ? 3 : 2) : 5);
      el.append(createModelElement(p.type, p));
      this.layer.append(el);
      this.els.set(p.id, el);
    }
    this.applyPartValues();
    this.updateTransforms();
  }
  /** Push per-part values (resistance → colour bands) into the visual models. */
  applyPartValues() {
    for (const p of this.state.parts) {
      const root = this.els.get(p.id);
      if (!root) continue;
      if (p.type === 'battery') {
        const model = root.matches?.('cb-battery') ? root : root.querySelector('cb-battery');
        if (model) model.volts = p.volts;
      } else if (p.type === 'resistor') {
        const model = root.querySelector('wokwi-resistor');
        if (model && model.value !== String(p.ohms)) model.value = String(p.ohms);
      } else if (p.type === 'led') {
        const model = root.querySelector('wokwi-led');
        if (model && model.color !== p.color) model.color = p.color;
      } else if (p.type === 'slide-switch') {
        const model = root.querySelector('wokwi-slide-switch');
        if (model && model.value !== p.pos) model.value = p.pos;
      } else if (PART_DEFS[p.type]?.custom) {
        const kind = PART_DEFS[p.type].spec.behaviour.kind, model = visualTarget(root, PART_DEFS[p.type]);
        const skinEl = PART_DEFS[p.type].skin && model?.el; if (skinEl) SKINS[PART_DEFS[p.type].skin]?.apply?.(skinEl, p);
        if (model && kind === 'switch') model.lit = p.pos ? 1 : 0;                           // the lever shows which way it is flipped
        else if (model && kind === 'encoder' && !this.running) model.aux = this.encAngle?.get(p.id) ?? 0;
      } else if (p.type === 'potentiometer') {
        const model = root.querySelector('wokwi-potentiometer'), v = Math.round(p.level * 10.23 * 100) / 100;    // element range is 0–1023
        if (model && model.value !== v) model.value = v;
      }
    }
  }
  /** Change one editable property of a part (LED colour, …) and re-evaluate the circuit. */
  setPartProp(partId, key, value, { commit = true } = {}) {
    const part = this.partById(partId);
    if (!part || !(key in (PART_DEFS[part.type].props || {}))) return;
    part[key] = value;
    this.applyPartValues(); this.markDirty(); this.renderOverlay();
    if (commit) this.commit();
  }
  /** Where a pointer is on a part, in the element's own millimetres (undoes the part's rotation about its centre). */
  localMm(part, e) {
    const w = this.toWorld(e), { w: pw, h: ph } = PART_DEFS[part.type], a = -((part.rot || 0) * Math.PI) / 180;
    const dx = w.x - (part.x + pw / 2), dy = w.y - (part.y + ph / 2), MM = 96 / 25.4;
    return { x: (dx * Math.cos(a) - dy * Math.sin(a) + pw / 2) / MM, y: (dx * Math.sin(a) + dy * Math.cos(a) + ph / 2) / MM };
  }
  /** Click handling for the Wokwi input parts whose controls are drawn inside the element: keypad keys, DIP switches, the joystick. Returns true when it used the click. */
  beginPartInput(e, part, kind) {
    const m = this.localMm(part, e), id = part.id;
    if (kind === 'keypad') {
      const cx = [7, 22, 37, 52], ry = [10.7, 25, 39.3, 53.6];
      const c = cx.findIndex(x => m.x >= x && m.x <= x + 11.2), r = ry.findIndex(y => m.y >= y && m.y <= y + 11);
      if (c < 0 || r < 0) return false;
      e.preventDefault();
      const bit = 1 << (r * 4 + c), keys = PART_DEFS[part.type].skin ? ['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D'] : [];
      const set = on => { part.keys = on ? (part.keys | bit) : (part.keys & ~bit); this.applyPartValues(); this.markDirty(); };
      set(true); this.status(`Keypad: key ${keys[r * 4 + c] ?? ''} held down`);
      this.track(() => {}, () => set(false));
      return true;
    }
    if (kind === 'switch-bank') {
      const off = [0, 9.6, 19.4, 29.1, 38.5, 48.1, 57.7, 67.3];
      const i = off.findIndex(x => m.x >= x + 3.7 && m.x <= x + 11.5);
      if (i < 0 || m.y < 14 || m.y > 36) return false;
      e.preventDefault();
      part.bits ^= 1 << i; this.applyPartValues(); this.markDirty(); this.commit();
      this.status(`DIP switch ${i + 1} is now ${(part.bits >> i) & 1 ? 'ON' : 'OFF'}`);
      return true;
    }
    if (kind === 'joystick') {
      const w = 27.2, h = 31.8;
      if (m.x < 0 || m.x > w || m.y < 0 || m.y > 27) return false;
      e.preventDefault();
      const s0 = { x: e.clientX, y: e.clientY }; let moved = false;
      const move = ev => {
        if (!moved && Math.hypot(ev.clientX - s0.x, ev.clientY - s0.y) < 4) return;
        moved = true; const q = this.localMm(part, ev);
        part.jx = Math.round(Math.min(100, Math.max(0, (q.x / w) * 100))); part.jy = Math.round(Math.min(100, Math.max(0, (q.y / 24) * 100)));
        this.applyPartValues(); this.markDirty();
      };
      this.status('Joystick: drag to move the stick, or just click to press it');
      part.jsel = 1; this.applyPartValues(); this.markDirty();
      this.track(ev => { if (part.jsel && !moved) { move(ev); if (moved) { part.jsel = 0; } } else move(ev); }, () => { part.jsel = 0; part.jx = 50; part.jy = 50; this.applyPartValues(); this.markDirty(); });
      return true;
    }
    return false;
  }
  /** A student-made switch: click flips it (works while the simulation runs too). */
  toggleCustomSwitch(part) {
    part.pos = part.pos ? 0 : 1;
    this.applyPartValues(); this.markDirty(); this.commit();
    const b = PART_DEFS[part.type].spec.behaviour;
    this.status(b.roles.throw2 ? `${PART_DEFS[part.type].name}: common now joins ${part.pos ? 'throw 2' : 'throw 1'}` : `${PART_DEFS[part.type].name}: ${part.pos ? 'closed — current can flow' : 'open'}`);
  }
  /** Turn a rotary encoder one notch: its A and B outputs walk through the four quadrature phases, ~25 ms apart so the firmware sees each edge. */
  rotateEncoder(partId, dir) {
    this.encAngle ||= new Map(); this.encChain ||= new Map();
    const run = async () => {
      this.encAngle.set(partId, (this.encAngle.get(partId) || 0) + dir * 18);
      for (let i = 0; i < 4; i++) {
        const p = this.partById(partId); if (!p) return;
        p.phase = ((((p.phase ?? 0) + dir) % 4) + 4) % 4;
        const m = visualTarget(this.els.get(partId), PART_DEFS[this.partById(partId)?.type]); if (m) m.aux = this.encAngle.get(partId);
        this.markDirty();
        await new Promise(r => setTimeout(r, 25));
      }
      this.commit();
    };
    this.encChain.set(partId, (this.encChain.get(partId) || Promise.resolve()).then(run));
    this.status(`Encoder turned ${dir > 0 ? 'clockwise' : 'anticlockwise'} one notch`);
  }
  toggleSwitch(part) {
    part.pos = part.pos ? 0 : 1;
    this.applyPartValues(); this.markDirty(); this.commit();
    this.status(`Slide switch moved to ${part.pos ? 'throw 3 (right)' : 'throw 1 (left)'} — the common pin now connects to it`);
  }
  setResistance(partId, ohms, { commit = true } = {}) {
    const part = this.partById(partId);
    if (!part || part.type !== 'resistor') return;
    part.ohms = ohms;
    this.applyPartValues(); this.markDirty(); this.renderOverlay();
    if (commit) this.commit();
  }
  updateTransforms() {
    for (const p of this.state.parts) {
      const el = this.els.get(p.id);
      if (!el) continue;
      if (PART_DEFS[p.type].flex) {                                     // a flexible part follows its lead spacing
        const size = partSize(p), m = el.querySelector('.res-model');
        el.style.width = `${size.w}px`;
        if (m && m._len !== size.w) layoutResistor(m, size.w);
      }
      el.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${p.rot}deg)`;
      el.classList.toggle('selected', this.sel?.kind === 'part' && this.sel.id === p.id);
    }
  }
  afterStructureChange() {
    const hasWork = this.state.wires.length > 0 || this.state.parts.some(p => PART_DEFS[p.type].insertable);
    $('hintCard').hidden = hasWork;
    $('undoTool').disabled = this.hi <= 0;
    $('redoTool').disabled = this.hi >= this.hist.length - 1;
    this.renderOverlay();
    this.emit('workspace');
  }

  /* ── history + autosave ─────────────────────────────── */
  commit() {
    const s = snapshot(this.state);
    if (s !== this.hist[this.hi]) {
      this.hist = this.hist.slice(0, this.hi + 1); this.hist.push(s);
      if (this.hist.length > 150) this.hist.shift();
      this.hi = this.hist.length - 1;
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(toProjectFile(this.state))); } catch { /* storage unavailable */ }
    this.afterStructureChange();
  }
  undo() { if (this.hi > 0) { this.hi--; this.applySnapshot(); this.status('Undo'); } }
  redo() { if (this.hi < this.hist.length - 1) { this.hi++; this.applySnapshot(); this.status('Redo'); } }
  applySnapshot() {
    restore(this.state, this.hist[this.hi]);
    if (this.sel && !(this.sel.kind === 'part' ? this.partById(this.sel.id) : this.selectedWire())) this.sel = null;
    this.syncParts(); this.markDirty(); this.afterStructureChange();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(toProjectFile(this.state))); } catch { /* ignore */ }
  }

  /* ── part operations ────────────────────────────────── */
  addPart(type, at = null) {
    const def = PART_DEFS[type];
    const count = this.state.parts.filter(p => p.type === type).length;
    const c = at || this.viewCenterWorld();
    const off = at ? 0 : (count % 6) * 14;
    const part = { id: uid(type === 'arduino-uno' ? 'uno' : type === 'arduino-nano' ? 'nano' : type === 'arduino-mega' ? 'mega' : type === 'breadboard' ? 'bb' : type.slice(0, 3)), type, rot: 0, ...(def.props || {}),
      x: Math.round((c.x - def.w / 2 + off) / GRID) * GRID, y: Math.round((c.y - def.h / 2 + off) / GRID) * GRID };
    this.state.parts.push(part);
    const s = findSnap(this.state.parts, part);
    applySnap(part, s);
    this.sel = { kind: 'part', id: part.id };
    this.syncParts(); this.markDirty(); this.commit();
    this.status(`${def.name} added — ${this.describePlacement(part)}`);
  }
  /** The extra parts a workspace starts a new project with, at the given spots (world px). */
  addStarter(list) {
    for (const s of list || []) {
      const def = PART_DEFS[s.type]; if (!def) continue;
      this.state.parts.push({ id: uid(s.type.replace(/^custom-/, '').slice(0, 6)), type: s.type, rot: s.rot || 0, ...(def.props || {}), x: s.x, y: s.y });
    }
    this.sel = null; this.syncParts(); this.markDirty(); this.commit(); this.fit();
  }
  describePlacement(part) {
    if (!PART_DEFS[part.type].insertable) return 'drag to position';
    const c = this.getCircuit();
    const seated = PART_DEFS[part.type].pins.map(pin => c.attachments.get(pkey(part.id, pin.id))).filter(Boolean).map(k => this.pinLabel({ part: splitKey(k).partId, pin: splitKey(k).pinId }));
    return seated.length ? `seated in ${seated.join(' and ')}` : 'not in the breadboard yet — drag it onto the holes';
  }
  rotateSelected() {
    const part = this.selectedPart();
    if (!part) { this.status('Select a part first'); return; }
    part.rot = (part.rot + 90) % 360;
    const s = findSnap(this.state.parts, part);
    applySnap(part, s);
    this.updateTransforms(); this.markDirty(); this.commit();
    this.status(`${PART_DEFS[part.type].name} rotated ${part.rot}° — ${this.describePlacement(part)}`);
  }
  deleteSelected() {
    const wire = this.selectedWire();
    if (wire) {
      this.state.wires = this.state.wires.filter(w => w !== wire); this.sel = null;
      this.markDirty(); this.commit(); this.status('Wire deleted'); return;
    }
    const part = this.selectedPart();
    if (!part) { this.status('Select a part or wire first'); return; }
    this.state.parts = this.state.parts.filter(p => p !== part);
    this.state.wires = this.state.wires.filter(w => w.a.part !== part.id && w.b.part !== part.id);
    this.sel = null; this.syncParts(); this.markDirty(); this.commit();
    this.status(`${PART_DEFS[part.type].name} deleted`);
  }
  select(sel) {
    this.sel = sel;
    this.updateTransforms(); this.renderOverlay(); this.emit('select', sel); this.emit('workspace');
  }
  setTool(tool) {
    this.tool = tool;
    this.cancelDraft();
    $('selectTool').classList.toggle('active', tool === 'select'); $('selectTool').setAttribute('aria-pressed', tool === 'select');
    $('wireTool').classList.toggle('active', tool === 'wire'); $('wireTool').setAttribute('aria-pressed', tool === 'wire');
    this.canvas.classList.toggle('wire-mode', tool === 'wire');
    this.status(tool === 'wire' ? 'Wire: drag from a connection point to another (or click, then click).' : 'Drag a part to move it · drag from any pin or hole to draw a wire · drag empty space to pan');
  }
  setRunning(on) {
    this.running = on;
    this.canvas.classList.toggle('running', on);
  }
  /** A custom part's definition changed: redraw every copy, and drop wires to pins it no longer has. */
  refreshPartType(type) {
    const def = PART_DEFS[type];
    for (const p of this.state.parts) if (p.type === type) { this.els.get(p.id)?.remove(); this.els.delete(p.id); }
    this.state.wires = this.state.wires.filter(w => [w.a, w.b].every(end => this.partById(end.part)?.type !== type || def.pinById.has(end.pin)));
    this.syncParts(); this.markDirty(); this.commit(); this.renderOverlay();
  }
  setButtonPressed(partId, pressed) {
    const el = this.els.get(partId)?.querySelector('wokwi-pushbutton');
    if (el) el.pressed = pressed;
    this.els.get(partId)?.classList.toggle('triggered', pressed);
    this.emit('button', { partId, pressed });
  }

  /* ── hit-testing ────────────────────────────────────── */
  pinAt(w, rScreen = 9, exclude = null) {
    const r = rScreen / this.view.z;
    let best = null, bd = r;
    for (const part of this.state.parts) {
      const def = PART_DEFS[part.type];
      for (const p of this.pinsOf(part)) {
        if (exclude && exclude.part === part.id && exclude.pin === p.pin.id) continue;
        const d = Math.hypot(p.x - w.x, p.y - w.y) - (def.isBoard ? 0 : 1.5);   // real leads win ties over holes
        if (d < bd) { bd = d; best = { part: part.id, pin: p.pin.id, x: p.x, y: p.y, label: p.pin.label, type: part.type }; }
      }
    }
    return best;
  }

  /* ── pointer input ──────────────────────────────────── */
  bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => this.onPointerDown(e));
    c.addEventListener('pointermove', e => this.onHover(e));
    c.addEventListener('pointerleave', () => this.clearHover());
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    c.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes(DRAG_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    c.addEventListener('drop', e => {
      const type = e.dataTransfer?.getData(DRAG_MIME);
      if (!type || !PART_DEFS[type]) return;
      e.preventDefault();
      this.addPart(type, this.toWorld(e));
    });
    c.addEventListener('contextmenu', e => {
      if (this.draft) { e.preventDefault(); return; }
      if (e.target.closest?.('.part-editor')) return;
      const partEl = e.target.closest?.('.part'), part = partEl && this.partById(partEl.dataset.id);
      if (part && (part.type === 'resistor' || part.type === 'led' || CONTROLS[part.type] || SETTINGS[part.type] || PART_DEFS[part.type]?.inspector)) {          // right-click → edit value / colour
        e.preventDefault();
        this.select({ kind: 'part', id: part.id });
        this.emit('part-context', { part, clientX: e.clientX, clientY: e.clientY });
      }
    });
    window.addEventListener('keydown', e => this.onKey(e));
    window.addEventListener('keyup', e => { if (e.key === ' ') { this.spaceDown = false; c.classList.remove('pan-ready'); } });
    window.addEventListener('resize', () => this.positionWireEditor());

    $('wireStyle').addEventListener('change', e => this.editWire(w => { w.style = e.target.value; }, true));
    $('wireColor').addEventListener('input', e => this.editWire(w => { w.color = e.target.value; }, false));
    $('wireColor').addEventListener('change', () => this.commit());
    $('wireWidth').addEventListener('change', e => this.editWire(w => { w.width = Number(e.target.value); }, true));
    // Wire type menu (Normal / Hookup / Alligator) — the electrical connection is identical; this is how it looks
    const kindMenu = $('wireKindMenu'), kindBtn = $('wireKindBtn');
    kindMenu.innerHTML = '<div class="wk-head">Wire type</div>' + WIRE_KIND_ORDER.map(k => `<button type="button" role="menuitemradio" data-kind="${k}" title="${WIRE_KINDS[k].blurb}"><span class="wk-ico">${WIRE_KIND_ICONS[k]}</span><span>${WIRE_KINDS[k].name}</span></button>`).join('');
    const setMenu = open => { kindMenu.hidden = !open; kindBtn.setAttribute('aria-expanded', String(open)); };
    kindBtn.addEventListener('click', e => { e.stopPropagation(); setMenu(kindMenu.hidden); });
    kindMenu.addEventListener('click', e => {
      const b = e.target.closest('[data-kind]'); if (!b) return;
      this.editWire(w => { w.kind = b.dataset.kind; }, true);
      setMenu(false); this.syncWireEditor();
      const w = this.selectedWire(); if (w) this.status(`Wire type: ${WIRE_KINDS[b.dataset.kind].name}`);
    });
    document.addEventListener('pointerdown', e => { if (!kindMenu.hidden && !e.target.closest('.we-kind')) setMenu(false); }, true);
    $('wireDelete').addEventListener('click', () => this.deleteSelected());
  }

  track(move, up) {
    const done = ev => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', done);
      window.removeEventListener('pointercancel', done);
      this.gesture = null;
      up(ev);
    };
    this.gesture = true;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', done);
    window.addEventListener('pointercancel', done);
  }

  onPointerDown(e) {
    if (e.target.closest('.wire-editor, .part-editor, .sim-tray, .hint-card')) return;
    this.hideTip();
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) { e.preventDefault(); this.beginPan(e); return; }
    if (e.button !== 0) return;
    const w = this.toWorld(e);
    if (this.draft?.armed) { this.finishArmed(w); return; }
    const flexEnd = e.target.closest?.('[data-flex-end]');
    if (flexEnd) { e.preventDefault(); this.beginFlexEnd(flexEnd.dataset.flexEnd, e); return; }
    const handle = e.target.closest?.('[data-handle]');
    if (handle) { e.preventDefault(); this.beginHandle(handle.dataset.handle, e); return; }
    const wireEl = e.target.closest?.('[data-wire]');
    if (this.tool === 'wire') {
      const pin = this.pinAt(w, 10);
      if (pin) { this.beginWire(e, pin); return; }
      if (wireEl) { this.select({ kind: 'wire', id: wireEl.dataset.wire }); return; }
      this.select(null); this.beginPan(e); return;
    }
    // No tool switching to wire: in Select mode too, pressing right on a connection point (an Uno header pin,
    // a breadboard hole, a component lead) starts a wire; pressing anywhere else on a part moves it.
    // The radius is tight so a part's body — and the breadboard between holes — still drags normally.
    const pin = this.pinAt(w, 6);
    if (pin && !((pin.type === 'pushbutton' || PART_DEFS[pin.type]?.spec?.behaviour.kind === 'button') && this.running)) { this.beginWire(e, pin); return; }
    if (wireEl) { e.preventDefault(); this.select({ kind: 'wire', id: wireEl.dataset.wire }); return; }
    const partEl = e.target.closest?.('.part');
    if (partEl) { this.beginPartDrag(e, partEl.dataset.id); return; }
    this.select(null); this.beginPan(e);
  }

  beginPan(e) {
    e.preventDefault();
    const s = { x: e.clientX, y: e.clientY }, v0 = { ...this.view };
    this.canvas.classList.add('panning');
    this.track(ev => {
      this.view.x = v0.x + ev.clientX - s.x; this.view.y = v0.y + ev.clientY - s.y;
      this.applyView();
    }, () => this.canvas.classList.remove('panning'));
  }

  beginPartDrag(e, id) {
    const part = this.partById(id);
    if (!part) return;
    this.select({ kind: 'part', id });
    const custom = PART_DEFS[part.type].custom ? PART_DEFS[part.type].spec.behaviour.kind : null;
    if ((part.type === 'pushbutton' || custom === 'button') && this.running) {
      e.preventDefault();
      this.setButtonPressed(id, true);
      this.track(() => {}, () => this.setButtonPressed(id, false));
      return;
    }
    if ((custom === 'keypad' && this.running) || custom === 'switch-bank' || (custom === 'joystick' && this.running)) {
      if (this.beginPartInput(e, part, custom)) return;       // clicked a key / switch / the stick: operate it instead of dragging the part
    }
    if (custom === 'encoder' && this.running) {                                              // left = back, right = forward, middle = press the shaft
      e.preventDefault();
      const box = this.els.get(id).getBoundingClientRect(), f = (e.clientX - box.left) / Math.max(1, box.width);
      if (f < 0.34) this.rotateEncoder(id, -1);
      else if (f > 0.66) this.rotateEncoder(id, 1);
      else { this.setButtonPressed(id, true); this.track(() => {}, () => this.setButtonPressed(id, false)); }
      return;
    }
    if ((part.type === 'pir-sensor' || custom === 'digital-sensor') && this.running) {      // while running: click = trigger / clear
      e.preventDefault();
      const on = !this.els.get(id).classList.contains('triggered');
      this.setButtonPressed(id, on);
      const name = custom ? PART_DEFS[part.type].name : 'PIR';
      this.status(on ? `${name}: triggered — OUT goes HIGH (click again to clear)` : `${name}: idle — OUT is LOW`);
      return;
    }
    e.preventDefault();
    const def = PART_DEFS[part.type];
    const circuit = this.getCircuit();
    const carried = !def.isBoard ? [] : [...new Set([...circuit.attachments]
      .filter(([, hole]) => splitKey(hole).partId === id).map(([lead]) => splitKey(lead).partId))]
      .map(pid => this.partById(pid)).filter(Boolean).map(p => ({ p, x: p.x, y: p.y }));
    const origin = { x: part.x, y: part.y }, start = this.toWorld(e);
    let moved = false;
    const lift = on => { [part, ...carried.map(c => c.p)].forEach(p => this.els.get(p.id)?.classList.toggle('dragging', on)); };
    lift(true);
    this.track(ev => {
      const w = this.toWorld(ev);
      const dx = w.x - start.x, dy = w.y - start.y;
      if (!moved && Math.hypot(dx, dy) * this.view.z < 3) return;
      moved = true;
      let nx = origin.x + dx, ny = origin.y + dy;
      if (!ev.altKey) { nx = Math.round(nx / GRID) * GRID; ny = Math.round(ny / GRID) * GRID; }
      part.x = nx; part.y = ny;
      carried.forEach(c => { c.p.x = c.x + (nx - origin.x); c.p.y = c.y + (ny - origin.y); });
      this.snapMarks = [];
      if (def.insertable && !ev.altKey) {
        const s = findSnap(this.state.parts, part);
        applySnap(part, s);
        this.snapMarks = this.seatMarks(part);
      }
      this.updateTransforms(); this.markDirty(); this.renderOverlay();
    }, () => {
      lift(false); this.snapMarks = [];
      if (moved) { this.markDirty(); this.commit(); this.status(`${def.name} placed — ${this.describePlacement(part)}`); }
      else if (part.type === 'slide-switch') this.toggleSwitch(part);
      else if (custom === 'switch') this.toggleCustomSwitch(part);
      else if (part.type === 'pir-sensor') { this.renderOverlay(); this.status('PIR selected — press Run, then click the sensor to trigger motion'); }
      else { this.renderOverlay(); this.status(`${def.name} selected`); }
    });
  }
  /** Drag one lead of a flexible part (resistor): it snaps to the nearest free hole; the other lead stays exactly where it is. */
  beginFlexEnd(end, e) {
    const part = this.selectedPart();
    if (!part || !PART_DEFS[part.type].flex) return;
    const fixed = pinWorld(part, end === '1' ? '2' : '1');
    const holes = boardHoles(this.state.parts), taken = occupiedHoles(this.state.parts, holes, new Set([part.id]));
    let moved = false;
    this.track(ev => {
      const w = this.toWorld(ev);
      let target = w;
      if (!ev.altKey) { const h = holeAt(holes, w.x, w.y, SNAP_RADIUS, taken); if (h) target = { x: h.x, y: h.y }; }
      if (end === '1') placeFlex(part, target, fixed); else placeFlex(part, fixed, target);
      moved = true;
      this.snapMarks = this.seatMarks(part);
      this.updateTransforms(); this.markDirty(); this.renderOverlay();
    }, () => {
      this.snapMarks = [];
      if (moved) { this.markDirty(); this.commit(); this.status(`${PART_DEFS[part.type].name} stretched — ${this.describePlacement(part)}`); }
      this.renderOverlay();
    });
  }
  seatMarks(part) {
    const holes = boardHoles(this.state.parts);
    return this.pinsOf(part).map(p => holeAt(holes, p.x, p.y)).filter(Boolean);
  }

  /* wires */
  autoColor(a, b) {
    const cls = ep => {
      const part = this.partById(ep.part);
      if (isMcuBoard(part.type)) { const pw = boardPowerPin(ep.pin); if (pw === 'gnd') return 'gnd'; if (pw) return 'pwr'; }
      if (part.type === 'breadboard') { if (/^(TN|BN)/.test(ep.pin)) return 'gnd'; if (/^(TP|BP)/.test(ep.pin)) return 'pwr'; }
      return null;
    };
    const k = cls(a) || cls(b);
    if (k === 'gnd') return '#22282c';
    if (k === 'pwr') return '#d33a30';
    const pal = ['#2f6fe4', '#2f9a54', '#e0a81f', '#e9782a', '#8b56d6', '#17a3b8'];
    return pal[this.colorIndex++ % pal.length];
  }
  beginWire(e, start) {
    e.preventDefault();
    const excl = { part: start.part, pin: start.pin };
    this.draft = { a: excl, cursor: { x: start.x, y: start.y }, target: null, armed: false };
    const p0 = this.toWorld(e);
    let moved = false;
    this.status('Release on another connection point (Esc cancels)');
    this.renderOverlay();
    this.track(ev => {
      const w = this.toWorld(ev);
      if (Math.hypot(w.x - p0.x, w.y - p0.y) * this.view.z > 4) moved = true;
      this.updateDraft(w);
    }, ev => {
      const t = this.pinAt(this.toWorld(ev), 12, excl);
      if (moved && t) this.finishWire(t);
      else if (!moved) { this.draft.armed = true; this.status('Click a second connection point to finish the wire (Esc cancels)'); this.renderOverlay(); }
      else this.cancelDraft('Wire cancelled — release on a connection point');
    });
  }
  updateDraft(w) {
    const t = this.pinAt(w, 12, this.draft.a);
    this.draft.cursor = t ? { x: t.x, y: t.y } : w; this.draft.target = t;
    this.renderOverlay();
  }
  finishArmed(w) {
    const t = this.pinAt(w, 12, this.draft.a);
    if (t) this.finishWire(t); else this.cancelDraft('Wire cancelled');
  }
  finishWire(t) {
    const a = this.draft.a, b = { part: t.part, pin: t.pin };
    this.draft = null;
    const same = (p, q) => p.part === q.part && p.pin === q.pin;
    if (this.state.wires.some(w => (same(w.a, a) && same(w.b, b)) || (same(w.a, b) && same(w.b, a)))) {
      this.renderOverlay(); this.status('Those two points are already wired together'); return;
    }
    this.state.wires.push({ id: uid('w'), a, b, style: 'straight', color: this.autoColor(a, b), width: 3, bend: 0.5, sag: null, kind: DEFAULT_WIRE_KIND });
    this.markDirty(); this.commit();
    const c = this.getCircuit(), net = c.nets[c.netOf(a.part, a.pin)];
    this.status(`Wire added: ${this.pinLabel(a)} → ${this.pinLabel(b)} (net ${net.name})`);
  }
  cancelDraft(msg) {
    if (!this.draft) return;
    this.draft = null; this.renderOverlay(); if (msg) this.status(msg);
  }
  beginHandle(kind, e) {
    const wire = this.selectedWire();
    if (!wire) return;
    const before = JSON.stringify(wire);
    this.handleDrag = { kind, pos: null };
    this.track(ev => {
      const w = this.toWorld(ev);
      if (kind === 'mid') {
        const a = this.anchor(wire.a), b = this.anchor(wire.b);
        Object.assign(wire, paramFromHandle(a, b, wire, w));
      } else {
        const other = kind === 'a' ? wire.b : wire.a;
        const t = this.pinAt(w, 12, other);
        this.handleDrag.pos = t ? { x: t.x, y: t.y } : w;
      }
      this.renderOverlay();
    }, ev => {
      if (kind !== 'mid') {
        const other = kind === 'a' ? wire.b : wire.a;
        const t = this.pinAt(this.toWorld(ev), 12, other);
        if (t) { wire[kind] = { part: t.part, pin: t.pin }; this.status(`Wire end moved to ${t.label}`); }
        else this.status('Wire end unchanged — release on a connection point');
      }
      this.handleDrag = null;
      this.markDirty();
      if (JSON.stringify(wire) !== before) this.commit(); else this.renderOverlay();
    });
  }
  editWire(fn, commit) {
    const w = this.selectedWire();
    if (!w) return;
    fn(w); this.renderOverlay();
    if (commit) this.commit();
  }

  /* hover / tooltip */
  onHover(e) {
    if (this.gesture) return;
    const w = this.toWorld(e);
    if (this.draft?.armed) { this.updateDraft(w); return; }
    const pin = this.pinAt(w, 7);
    const key = pin ? pkey(pin.part, pin.pin) : null;
    if (key !== (this.hover && pkey(this.hover.part, this.hover.pin))) { this.hover = pin; this.renderOverlay(); }
    if (pin) this.showTip(e, pin); else this.hideTip();
  }
  clearHover() { if (this.hover) { this.hover = null; this.renderOverlay(); } this.hideTip(); }
  showTip(e, pin) {
    const c = this.getCircuit(), net = c.nets[c.netOf(pin.part, pin.pin)];
    const v = this.running && this.probe ? this.probe(net.index) : null;
    const tip = $('tip'), r = this.canvas.getBoundingClientRect();
    const partName = PART_DEFS[pin.type].name;
    tip.innerHTML = `<b>${pin.label}</b> <span>${partName}</span><br><span>net ${net.name}${v == null ? '' : ` · ${v.toFixed(2)} V`}</span>`;
    tip.hidden = false;
    tip.style.left = `${Math.min(r.width - tip.offsetWidth - 8, e.clientX - r.left + 14)}px`;
    tip.style.top = `${Math.max(6, e.clientY - r.top - tip.offsetHeight - 10)}px`;
  }
  hideTip() { $('tip').hidden = true; }

  /* keyboard */
  onKey(e) {
    if (e.target.matches?.('input, select, textarea, [contenteditable]')) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
    else if (mod && k === 'y') { e.preventDefault(); this.redo(); }
    else if (mod && k === 'enter') { e.preventDefault(); this.emit('toggle-run'); }
    else if (mod) return;
    else if (k === 'delete' || k === 'backspace') { e.preventDefault(); this.deleteSelected(); }
    else if (k === 'r') this.rotateSelected();
    else if (k === 'v') this.setTool('select');
    else if (k === 'w') this.setTool('wire');
    else if (k === 'f') this.fit();
    else if (k === '+' || k === '=') this.zoomBy(1.25);
    else if (k === '-') this.zoomBy(0.8);
    else if (k === 'escape') { if (this.draft) this.cancelDraft('Wire cancelled'); else this.select(null); }
    else if (k === ' ' && e.target === document.body) { e.preventDefault(); this.spaceDown = true; this.canvas.classList.add('pan-ready'); }
  }

  /* ── overlay (wires, lead status, highlights) ───────── */
  renderOverlay() {
    const z = this.view.z, out = [];
    const c = this.getCircuit();

    // lead status: green when a lead is seated in a hole or wired, hollow amber when floating
    const wired = new Set(this.state.wires.flatMap(w => [pkey(w.a.part, w.a.pin), pkey(w.b.part, w.b.pin)]));
    for (const part of this.state.parts) {
      if (!PART_DEFS[part.type].insertable) continue;
      for (const p of this.pinsOf(part)) {
        const k = pkey(part.id, p.pin.id), ok = c.attachments.has(k) || wired.has(k);
        out.push(`<circle cx="${p.x}" cy="${p.y}" r="${ok ? 2.6 : 3.2}" class="ring" stroke="${ok ? '#1f9d55' : '#c98a1a'}" stroke-width="${1.4}" fill="${ok ? 'rgba(31,157,85,.28)' : 'rgba(255,255,255,.55)'}"/>`);
      }
    }

    // value labels (resistance, potentiometer %, lux, °C) — colour bands / knobs are tiny at low zoom
    for (const part of this.state.parts) {
      const label = partLabel(part);
      if (!label) continue;
      const b = partBounds(part);
      out.push(`<text x="${(b.x0 + b.x1) / 2}" y="${b.y0 - 3.5 / z}" class="res-label" text-anchor="middle" font-size="${11 / z}" stroke-width="${3 / z}">${label}</text>`);
    }

    // snap preview while dragging a lead-bearing part
    for (const h of this.snapMarks) out.push(`<circle cx="${h.x}" cy="${h.y}" r="${5 / z + 1}" class="ring" stroke="#1d63ed" stroke-width="${1.5 / z}" fill="rgba(29,99,237,.22)"/>`);

    // wires
    const selWire = this.selectedWire();
    for (const wire of this.state.wires) {
      const a = this.endPos(wire, 'a'), b = this.endPos(wire, 'b');
      if (!a || !b) continue;
      const g = wireGeometry(a, b, wire), sw = wire.width || 3, col = wire.color || '#454d53', edge = shade(col, 0.55);
      const on = selWire === wire, kind = this.wireKindOf(wire);
      out.push(`<g class="wire wire-${kind}" data-wire="${wire.id}">`
        + (on ? `<path class="wire-edge" d="${g.d}" stroke="#1d63ed" stroke-opacity=".32" stroke-width="${sw + 7}"/>` : '')
        + wireArt(kind, a, b, g, col, edge, sw)
        + `<path class="wire-hit" data-wire="${wire.id}" d="${g.d}" stroke-width="${Math.max(sw + 6, 12 / z)}"/></g>`);
    }

    // hovered pin + everything on its net
    if (this.hover && !this.draft) {
      const net = c.nets[c.netOf(this.hover.part, this.hover.pin)];
      for (const k of net.keys) {
        const { partId, pinId } = splitKey(k), part = this.partById(partId), pos = part && pinWorld(part, pinId);
        if (pos && !(partId === this.hover.part && pinId === this.hover.pin)) out.push(`<circle cx="${pos.x}" cy="${pos.y}" r="${3 / z + 0.6}" class="ring" stroke="#1d63ed" stroke-width="${1 / z}" fill="rgba(29,99,237,.35)"/>`);
      }
      out.push(`<circle cx="${this.hover.x}" cy="${this.hover.y}" r="${6 / z}" class="ring" stroke="#1d63ed" stroke-width="${1.6 / z}" fill="rgba(29,99,237,.16)"/>`);
    }

    // wire being drawn
    if (this.draft) {
      const a = this.anchor(this.draft.a), b = this.draft.cursor;
      if (a) out.push(`<path d="${wireGeometry(a, b, { style: 'straight' }).d}" fill="none" stroke="#1d63ed" stroke-width="${3}" stroke-dasharray="7 5" stroke-linecap="round" opacity=".85" pointer-events="none"/>`);
      if (a) out.push(`<circle cx="${a.x}" cy="${a.y}" r="${6 / z}" class="ring" stroke="#1d63ed" stroke-width="${1.6 / z}" fill="rgba(29,99,237,.2)"/>`);
      if (this.draft.target) out.push(`<circle cx="${this.draft.target.x}" cy="${this.draft.target.y}" r="${7 / z}" class="ring" stroke="#1f9d55" stroke-width="${2 / z}" fill="rgba(31,157,85,.22)"/>`);
    }

    // handles for the selected wire
    if (selWire) {
      const a = this.endPos(selWire, 'a'), b = this.endPos(selWire, 'b');
      if (a && b) {
        const g = wireGeometry(a, b, selWire);
        out.push(`<circle class="handle" data-handle="a" cx="${a.x}" cy="${a.y}" r="${6 / z}" stroke-width="${2 / z}"/>`);
        out.push(`<circle class="handle" data-handle="b" cx="${b.x}" cy="${b.y}" r="${6 / z}" stroke-width="${2 / z}"/>`);
        if (g.axis) out.push(`<rect class="handle mid" data-handle="mid" x="${g.mid.x - 5 / z}" y="${g.mid.y - 5 / z}" width="${10 / z}" height="${10 / z}" rx="${2 / z}" stroke-width="${2 / z}"/>`);
      }
    }
    // lead-end handles for a selected flexible part (drag a lead to any hole; the body stretches and turns to fit)
    const selPart = this.selectedPart();
    if (selPart && PART_DEFS[selPart.type].flex) {
      for (const pin of ['1', '2']) {
        const q = pinWorld(selPart, pin);
        out.push(`<circle class="handle flex-handle" data-flex-end="${pin}" cx="${q.x}" cy="${q.y}" r="${5.5 / z}" stroke-width="${2 / z}"/>`);
      }
    }
    this.overlay.innerHTML = out.join('');
    this.syncWireEditor();
  }
  endPos(wire, which) {
    if (this.handleDrag && this.handleDrag.kind === which && this.handleDrag.pos && this.selectedWire() === wire) return this.handleDrag.pos;
    return this.anchor(wire[which]);
  }
  /** How a wire is drawn right now. */
  wireKindOf(wire) { return resolveWireKind(wire); }
  syncWireEditor() {
    const w = this.selectedWire(), box = $('wireEditor');
    box.hidden = !w;
    if (!w) return;
    $('wireStyle').value = w.style || 'straight';
    $('wireColor').value = /^#[0-9a-f]{6}$/i.test(w.color) ? w.color : '#454d53';
    $('wireWidth').value = String(w.width || 3);
    const chosen = this.wireKindOf(w);
    $('wireKindIco').innerHTML = WIRE_KIND_ICONS[chosen];
    $('wireKindName').textContent = WIRE_KINDS[chosen].name;
    $('wireKindBtn').title = WIRE_KINDS[chosen].blurb;
    for (const b of $('wireKindMenu').querySelectorAll('[data-kind]')) { const on = b.dataset.kind === chosen; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
    this.positionWireEditor();
  }
  positionWireEditor() {
    const w = this.selectedWire(), box = $('wireEditor');
    if (!w || box.hidden) return;
    const a = this.anchor(w.a), b = this.anchor(w.b);
    if (!a || !b) return;
    const { x, y, z } = this.view, cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    const mx = ((a.x + b.x) / 2) * z + x, my = ((a.y + b.y) / 2) * z + y;
    box.style.left = `${clamp(mx - box.offsetWidth / 2, 8, Math.max(8, cw - box.offsetWidth - 8))}px`;
    box.style.top = `${clamp(my - 54, 8, Math.max(8, ch - 44))}px`;
  }
}
