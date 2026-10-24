// Resource packs: optional bundles of boards (and, later, parts, workspaces and community content) that a student adds when they need
// them, so the catalog stays small. The two boards everyone starts with — Arduino Uno and Raspberry Pi Pico — are always there.
// A pack is "installed" per browser; any project that already uses something from a pack switches that pack on by itself, so a saved
// or handed-in project never opens with missing parts. Pure apart from localStorage (every access is guarded). DOM-free.
import { PART_DEFS } from './parts.js';

export const PACKS = [
  {
    id: 'arduino-boards',
    name: 'More Arduino boards',
    blurb: 'Arduino Nano, Arduino Mega 2560 and Arduino Uno R4.',
    types: ['arduino-nano', 'arduino-mega', 'arduino-uno-r4'],
  },
];

const KEY = 'virtual-lab:packs';
let mem = null;           // used when storage is blocked
const listeners = new Set();

const read = () => {
  if (mem) return mem;
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter(id => PACKS.some(p => p.id === id)) : []; } catch { return []; }
};
const write = ids => {
  try { localStorage.setItem(KEY, JSON.stringify(ids)); mem = null; } catch { mem = ids; }
  for (const f of listeners) { try { f(ids); } catch { /* a listener must not break the others */ } }
};

export const installedPacks = () => [...read()];
export const isInstalled = id => read().includes(id);
export const onPacksChange = f => { listeners.add(f); return () => listeners.delete(f); };
export const packOf = type => PACKS.find(p => p.types.includes(type)) || null;
/** Parts a pack provides that exist in this build. */
export const packTypes = pack => pack.types.filter(t => PART_DEFS[t]);

/** Is this part usable right now? Everything outside a pack always is. */
export function partAvailable(type) { const p = packOf(type); return !p || isInstalled(p.id); }

export function installPack(id) { if (!PACKS.some(p => p.id === id) || isInstalled(id)) return false; write([...read(), id]); return true; }
export function removePack(id) { if (!isInstalled(id)) return false; write(read().filter(x => x !== id)); return true; }

/** Switch on the packs a set of parts needs (a project that was opened, a part the planner just added). → ids newly switched on. */
export function ensurePacksFor(types) {
  const need = new Set();
  for (const t of types || []) { const p = packOf(t); if (p && !isInstalled(p.id)) need.add(p.id); }
  for (const id of need) installPack(id);
  return [...need];
}

/** Boards for the "new project" picker: the two defaults, then whatever the installed packs add. */
export function availableBoards(allBoards) { return allBoards.filter(partAvailable); }
