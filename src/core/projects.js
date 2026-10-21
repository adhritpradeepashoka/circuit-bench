// Saved projects. A project is { id, name, workspace, createdAt, updatedAt, data }, where `data` is the
// same JSON a project file holds (the circuit from editor.exportProject() + the files from
// code.exportState()), and `workspace` names the environment it was made in.
//
// Workspaces are the roadmap's environment extension point: today there is one (an Arduino Uno on a
// breadboard), and later ones — PCB/KiCad, 3D/CAD assembly, robotics, bioelectronics — are new entries
// here rather than a change to how projects are stored. A project always opens in its own workspace.
//
// Stores are async on purpose: the local store below and a cloud store (Firestore, when signed in)
// expose the same five methods, so the UI never cares where a project lives. DOM-free; tests run in Node.

export const WORKSPACES = {
  'arduino-uno': { name: 'Arduino Uno + breadboard', blurb: 'Microcontroller, breadboard, parts and real firmware', available: true },
  pcb: { name: 'PCB design', blurb: 'Import KiCad, lay out boards', available: false },
  cad: { name: '3D / CAD assembly', blurb: 'Import CAD parts, mount and view in 3D', available: false },
  robotics: { name: 'Robotics', blurb: 'Motors, sensors and mechanisms', available: false },
};
export const DEFAULT_WORKSPACE = 'arduino-uno';

const INDEX_KEY = 'circuitbench:projects';
const itemKey = id => `circuitbench:project:${id}`;
const NAME_MAX = 80;

export const newId = () => `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
export const cleanName = (name, fallback = 'Untitled project') => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) || fallback;
const meta = p => ({ id: p.id, name: p.name, workspace: p.workspace, createdAt: p.createdAt, updatedAt: p.updatedAt });

/** "Untitled project", "Untitled project 2", … — the first name not already taken. */
export function uniqueName(base, taken) {
  const names = new Set(taken.map(n => n.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

export function newProject({ name, workspace = DEFAULT_WORKSPACE, data = null, now = Date.now() } = {}) {
  return { id: newId(), name: cleanName(name), workspace: WORKSPACES[workspace] ? workspace : DEFAULT_WORKSPACE, createdAt: now, updatedAt: now, data };
}

/** Projects in this browser (localStorage). Survives reloads; can come back empty (private window, cleared data). */
export function createLocalStore(storage = globalThis.localStorage) {
  const readIndex = () => {
    try { const v = JSON.parse(storage.getItem(INDEX_KEY) || '[]'); return Array.isArray(v) ? v.filter(m => m && typeof m.id === 'string') : []; } catch { return []; }
  };
  const writeIndex = list => storage.setItem(INDEX_KEY, JSON.stringify(list));
  return {
    kind: 'local',
    /** Newest first. */
    async list() { return readIndex().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); },
    async load(id) {
      try { const p = JSON.parse(storage.getItem(itemKey(id)) || 'null'); return p && p.id === id ? p : null; } catch { return null; }
    },
    /** Throws if storage is full/blocked, so the caller can tell the user their work isn't saved. */
    async save(project) {
      const p = { ...project, name: cleanName(project.name), updatedAt: project.updatedAt || Date.now() };
      storage.setItem(itemKey(p.id), JSON.stringify(p));
      const list = readIndex().filter(m => m.id !== p.id);
      list.push(meta(p)); writeIndex(list);
      return p;
    },
    async remove(id) {
      try { storage.removeItem(itemKey(id)); } catch { /* ignore */ }
      writeIndex(readIndex().filter(m => m.id !== id));
    },
  };
}
