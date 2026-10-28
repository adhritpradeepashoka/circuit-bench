// Workspaces: an environment a project is made in — which parts the menu leads with, which parts come with it, and
// what a new project starts with. A workspace is ONE DATA FILE (a manifest); it can never contain code. Its own parts
// are the same declarative part specs the Part Creator makes, so they go through validatePartSpec like any other part.
//
// Built-in workspaces (Electronics, Bioelectronics) are manifests too — the community ones are the same thing loaded
// from a file (and, later, a GitHub repo) — so there is one mechanism, not two. DOM-free: tests run in Node.
import { WORKSPACES, DEFAULT_WORKSPACE } from './projects.js';
import { PART_DEFS } from './parts.js';
import { validatePartSpec, registerCustomPart } from './custom-parts.js';

export const WORKSPACE_FORMAT = 'circuitbench-workspace';
export const WORKSPACE_VERSION = 1;
const STORE_KEY = 'circuitbench:workspaces';
const MAX_PARTS = 40, MAX_STARTER = 60, MAX_FILE = 4_000_000;

const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
const num = (v, lo, hi, d = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const slug = s => str(s, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** The workspaces that ship with the app. `starter.extra` parts go on top of the board a new project starts with (world px). */
export const BUILTIN_WORKSPACES = [
  {
    format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, id: DEFAULT_WORKSPACE, builtin: true, name: 'Electronics',
    blurb: 'Microcontroller, breadboard, parts and real firmware', author: 'CircuitBench', menuFirst: [], parts: [], starter: { extra: [] },
    hint: { title: 'Build your first circuit', text: 'Drag an LED and a resistor onto the breadboard (right-click the resistor to change its value) — the leads snap into holes. Then drag from any pin or hole to another to wire it — D13 → resistor → LED → GND — and press Run. Open Code to change what the Arduino does.' },
  },
  {
    format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, id: 'bioelectronics', builtin: true, name: 'Bioelectronics',
    blurb: 'ECG, EMG, EEG and EOG: electrodes, amplifiers (BioAmp), signal sources, and an Arduino to read them',
    author: 'CircuitBench', menuFirst: ['Biosignal'], parts: [], visualizer: true,
    hint: { title: 'Read a heartbeat', text: 'The BODY block is the signal source (right-click it to pick ECG, EMG, EEG or EOG). Wire its electrode pins to the BioAmp EXG Pill inputs (IN+, IN−, REF), power the Pill from the Arduino 5V and GND, then connect the Pill OUT to A0 and press Run. Open Code to see the samples.' },
    starter: {
      extra: [
        { type: 'custom-signal-source', x: 40, y: 330 },
        { type: 'custom-bioamp-exg-pill', x: 260, y: 345 },
      ],
      sketch: 'ecg',
    },
  },
  {
    format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, id: 'robotics', builtin: true, name: 'Robotics',
    blurb: 'Import real parts, mark where they bolt together, and (soon) test the robot', author: 'CircuitBench', menuFirst: ['Drone', 'Motors'], parts: [], robotics: true,
    hint: { title: 'Build the circuit, then the robot', text: 'Circuit is the electronics, as always. Assembly is where you import 3D parts (STL, OBJ or glTF) and mark their holes, shafts and connectors. Test comes next.' },
    starter: { extra: [] },
  },
];

/**
 * Check a manifest. Nothing in it is trusted: part specs are re-validated, positions and counts are clamped,
 * and a starter part must be a known type or one of the manifest's own parts.
 * @returns {{ok: true, workspace: object} | {ok: false, errors: string[]}}
 */
export function validateWorkspace(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['A workspace file must be a JSON object.'] };
  if (raw.format !== WORKSPACE_FORMAT) errors.push('This is not a CircuitBench workspace file.');
  const name = str(raw.name, 40);
  if (!name) errors.push('A workspace needs a name.');
  const id = slug(raw.id) || slug(name);
  if (!id) errors.push('A workspace needs an id.');
  const parts = [], partIds = new Set();
  for (const p of (Array.isArray(raw.parts) ? raw.parts : []).slice(0, MAX_PARTS)) {
    const v = validatePartSpec(p);
    if (!v.ok) { errors.push(`Part “${str(p?.name, 30) || '?'}”: ${v.errors.join(' ')}`); continue; }
    parts.push(v.spec); partIds.add(v.spec.id);
  }
  const extra = [];
  for (const s of (Array.isArray(raw.starter?.extra) ? raw.starter.extra : []).slice(0, MAX_STARTER)) {
    const type = str(s?.type, 60);
    if (!PART_DEFS[type] && !partIds.has(type)) { errors.push(`The starter board uses “${type}”, which is not a known part.`); continue; }
    extra.push({ type, x: num(s.x, -2000, 4000), y: num(s.y, -2000, 4000), rot: [0, 90, 180, 270].includes(+s.rot) ? +s.rot : 0 });
  }
  const project = raw.starter?.project && typeof raw.starter.project === 'object' && Array.isArray(raw.starter.project.parts) ? raw.starter.project : null;
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    workspace: {
      format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, id, name, blurb: str(raw.blurb, 160), author: str(raw.author, 60), builtin: !!raw.builtin,
      visualizer: raw.visualizer === true, robotics: raw.robotics === true,
      menuFirst: (Array.isArray(raw.menuFirst) ? raw.menuFirst : []).slice(0, 6).map(c => str(c, 30)).filter(Boolean),
      hint: raw.hint && typeof raw.hint === 'object' ? { title: str(raw.hint.title, 60), text: str(raw.hint.text, 400) } : null,
      parts, starter: { extra, ...(project ? { project } : {}), ...(raw.starter?.sketch ? { sketch: str(raw.starter.sketch, 40) } : {}) },
    },
  };
}

/* ── registry ────────────────────────────────────────────────── */
const registry = new Map();
let active = DEFAULT_WORKSPACE;

/** Make a (validated) workspace available: lists it for new projects and adds its own parts to the catalogue. */
export function registerWorkspace(ws) {
  registry.set(ws.id, ws);
  WORKSPACES[ws.id] = { name: ws.name, blurb: ws.blurb, available: true, builtin: !!ws.builtin };
  for (const spec of ws.parts) {
    const def = registerCustomPart(spec);
    def.fromWorkspace = ws.id; def.category = ws.name;
  }
}
for (const b of BUILTIN_WORKSPACES) { const v = validateWorkspace(b); if (v.ok) registerWorkspace(v.workspace); }

export const getWorkspace = id => registry.get(id) || registry.get(DEFAULT_WORKSPACE);
export const listWorkspaces = () => [...registry.values()];
export const setActiveWorkspace = id => { active = registry.has(id) ? id : DEFAULT_WORKSPACE; };
export const activeWorkspace = () => getWorkspace(active);
/** Catalogue sections the active workspace wants at the top of the parts menu. */
export const menuFirst = () => activeWorkspace().menuFirst || [];

/* ── saved (your own / imported) workspaces: this browser ───── */
export function loadSavedWorkspaces(storage = globalThis.localStorage) {
  let list = [];
  try { const v = JSON.parse(storage.getItem(STORE_KEY) || '[]'); list = Array.isArray(v) ? v : []; } catch { /* blocked or corrupt */ }
  const out = [];
  for (const raw of list) { const v = validateWorkspace(raw); if (v.ok && !registry.get(v.workspace.id)?.builtin) { registerWorkspace(v.workspace); out.push(v.workspace); } }
  return out;
}
const writeSaved = (list, storage) => storage.setItem(STORE_KEY, JSON.stringify(list));
const readSaved = storage => { try { const v = JSON.parse(storage.getItem(STORE_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

/** Save (or replace) a workspace of your own; built-in ids are never overwritten — a clash gets a new id. */
export function saveWorkspace(ws, storage = globalThis.localStorage) {
  const v = validateWorkspace(ws);
  if (!v.ok) return v;
  const w = v.workspace;
  if (registry.get(w.id)?.builtin) w.id = `${w.id}-mine`;
  w.builtin = false;
  registerWorkspace(w);
  const list = readSaved(storage).filter(x => x?.id !== w.id); list.push(w);
  try { writeSaved(list, storage); } catch { return { ok: false, errors: ['This browser could not store the workspace (storage is full or blocked).'] }; }
  return { ok: true, workspace: w };
}
export function removeWorkspace(id, storage = globalThis.localStorage) {
  if (registry.get(id)?.builtin) return false;
  registry.delete(id); delete WORKSPACES[id];
  try { writeSaved(readSaved(storage).filter(x => x?.id !== id), storage); } catch { /* ignore */ }
  return true;
}

/** Read a workspace file's text. Rejects anything oversized or unparseable with a plain message. */
export function parseWorkspaceFile(text) {
  if (String(text).length > MAX_FILE) return { ok: false, errors: ['That file is too large to be a workspace.'] };
  let raw; try { raw = JSON.parse(text); } catch { return { ok: false, errors: ['That file is not valid JSON.'] }; }
  return validateWorkspace(raw);
}

/** A workspace made from the project that is open now: its parts and wires become the starting board, and the custom parts travel with it. */
export function workspaceFromProject({ name, blurb = '', author = '' }, projectData, customSpecs = []) {
  return {
    format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, id: slug(name) || 'my-workspace', name, blurb, author, menuFirst: [],
    parts: customSpecs, starter: { extra: [], project: JSON.parse(JSON.stringify(projectData)) },
  };
}

/** The file to hand to someone else. */
export const workspaceFile = ws => JSON.stringify({ ...ws, builtin: undefined }, null, 2);
