// The part being annotated in the Assembly tab: the imported model's facts plus the frames the user placed on it. Pure and DOM-free —
// the viewer only feeds it hit points; turning it into a robot-part description (and checking that) happens here, so it is testable in Node.
import { validateRobotPart, ROBOT_PART_FORMAT, ROBOT_PART_VERSION, FRAME_KINDS, THREADS } from './robot-part.js';

export const UNIT_MM = { mm: 1, cm: 10, m: 1000, in: 25.4 };
export const MODEL_FORMATS = ['stl', 'obj', 'glb', 'gltf'];
const KIND_DEFAULTS = { hole: { diameter: 3, through: true }, shaft: { diameter: 4 }, horn: { diameter: 5 }, face: {}, connector: {}, point: {} };
const r3 = v => Math.round(v * 1000) / 1000;

export const formatOf = fileName => { const m = /\.([a-z0-9]+)$/i.exec(String(fileName || '')); const e = m ? m[1].toLowerCase() : ''; return e === 'gltf' ? 'glb' : MODEL_FORMATS.includes(e) ? e : null; };

export class PartDraft {
  constructor() { this.reset(); }
  reset() {
    this.name = ''; this.category = 'Parts'; this.blurb = '';
    this.massGrams = ''; this.massSource = 'estimated';
    this.model = { file: '', format: null, units: 'mm', up: 'z', bytes: 0 };
    this.sizeMm = null;                 // bounding-box size in mm, measured from the mesh once units are known
    this.dimsSource = 'measured';
    this.frames = []; this.joints = [];
    this.selected = null; this.counter = 0;
  }
  /** What the viewer learned from the mesh: its size in its own units. */
  setMesh({ file, format, bytes, rawSize }) {
    this.model = { ...this.model, file, format, bytes: bytes || 0 }; this.rawSize = rawSize; this.refreshSize();
    if (!this.name) this.name = String(file || '').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 60);
  }
  refreshSize() { this.sizeMm = this.rawSize ? this.rawSize.map(v => r3(v * UNIT_MM[this.model.units])) : null; }
  setUnits(u) { if (UNIT_MM[u]) { this.model.units = u; this.refreshSize(); } }
  /** Frames are stored in mm in the part's own (Z-up) space. */
  addFrame({ pos, dir, kind = 'hole', diameter = null }) {
    if (!FRAME_KINDS.includes(kind)) kind = 'point';
    const n = ++this.counter;
    const f = { id: `${kind}-${n}`, kind, pos: pos.map(r3), dir: dir.map(r3), source: 'estimated', ...KIND_DEFAULTS[kind] };
    if (diameter && 'diameter' in f) { f.diameter = r3(diameter); f.source = 'measured'; }       // snapped to a real circle in the mesh
    this.frames.push(f); this.selected = f.id; return f;
  }
  frame(id) { return this.frames.find(f => f.id === id) || null; }
  updateFrame(id, patch) {
    const f = this.frame(id); if (!f) return null;
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'id') { const nid = String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); if (nid && !this.frame(nid)) { if (this.selected === f.id) this.selected = nid; f.id = nid; } }
      else if (k === 'kind') { if (FRAME_KINDS.includes(v)) { f.kind = v; for (const [dk, dv] of Object.entries(KIND_DEFAULTS[v])) if (f[dk] === undefined) f[dk] = dv; if (v !== 'hole') { delete f.thread; delete f.depth; delete f.through; } } }
      else if (k === 'thread') { if (!v) delete f.thread; else f.thread = v; }
      else if (v === '' || v === null) delete f[k];
      else f[k] = v;
    }
    return f;
  }
  removeFrame(id) { this.frames = this.frames.filter(f => f.id !== id); this.joints = this.joints.filter(j => j.frame !== id); if (this.selected === id) this.selected = null; }
  /** A hole's thread picks its nominal clearance diameter, as a convenience (the user can still type another). */
  static clearanceFor(thread) { return THREADS[thread]?.[1] ?? null; }

  toDescription() {
    const d = {
      format: ROBOT_PART_FORMAT, version: ROBOT_PART_VERSION, name: this.name, category: this.category, blurb: this.blurb,
      model: { ...this.model }, mass: { grams: this.massGrams === '' ? undefined : Number(this.massGrams), source: this.massSource },
      frames: this.frames.map(f => ({ ...f })), joints: this.joints.map(j => ({ ...j })), actuators: [], sensors: [], ports: [],
    };
    if (this.sizeMm) d.dims = { size: this.sizeMm, source: this.dimsSource };
    return d;
  }
  validate() { return validateRobotPart(this.toDescription()); }
  load(part) {
    this.reset();
    this.name = part.name; this.category = part.category; this.blurb = part.blurb || '';
    this.massGrams = part.mass.grams; this.massSource = part.mass.source;
    this.model = { file: part.model.file, format: part.model.format, units: part.model.units, up: part.model.up, bytes: part.model.bytes || 0 };
    this.sizeMm = part.dims?.size || null; this.dimsSource = part.dims?.source || 'measured';
    this.frames = part.frames.map(f => ({ ...f })); this.joints = part.joints.map(j => ({ ...j }));
    this.counter = this.frames.length;
  }
}
